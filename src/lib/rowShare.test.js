import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  MAX_SHARED_FIELDS,
  MAX_SHARED_VALUE,
  cleanSharedRow,
  isDefaultShareBody,
  linkOf,
  pageHref,
  rowSnapshot,
  sharableColumns,
  shareBody,
  shareColumnsOf,
  shareEnabled,
  sharePreview,
  shareProblem,
  shareTitle,
  sharedFrom,
  sharedRowText,
  toggleShareColumn,
  visibleFields,
} from './rowShare.js'
import { messageDoc } from './messages.js'
import { conversationsFor, entriesOf } from './conversations.js'

// ---------------------------------------------------------------------
// Sending a row to somebody
// ---------------------------------------------------------------------
// The thing that must never go wrong is a column leaving the page that an
// admin did not say could leave -- the customer's phone number in a card
// sent to a colleague who was never allowed to see the page it lives on.
// Most of what is tested is that edge, from every direction a value could
// slip out: the fields, the heading, a stale column list, a hand-made card.

const SRC = path.resolve(import.meta.dirname, '..')
const ROOT = path.resolve(SRC, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const WIDGET = {
  title: 'Open deals',
  tab: 'Deals',
  rowShare: true,
  shareColumns: ['Deal', 'Model', 'Status', 'Gone'],
  // Both of these are the obvious heading, and neither is shared.
  noteKeyColumn: 'Customer',
  detailTitleColumn: 'Customer',
}
const HEADERS = ['Deal', 'Customer', 'Phone', 'Model', 'Status']
const ROW = { _row: 7, Deal: 'DL-1', Customer: 'Ravi Kumar', Phone: '9876543210', Model: 'Splendor', Status: '' }

// --- whether a table offers it ----------------------------------------------

test('a send button needs the switch AND a column to send', () => {
  assert.equal(shareEnabled({ rowShare: true }), false, 'an empty card is a message saying nothing')
  assert.equal(shareEnabled({ shareColumns: ['A'] }), false)
  assert.equal(shareEnabled({ rowShare: true, shareColumns: ['A'] }), true)
  assert.equal(shareEnabled({ rowShare: 'true', shareColumns: ['A'] }), false)
  assert.equal(shareEnabled(null), false)
})

test('the column list is read defensively, once each', () => {
  assert.deepEqual(shareColumnsOf({ shareColumns: ['A', '', null, 'A', 3, 'B'] }), ['A', 'B'])
  assert.deepEqual(shareColumnsOf({ shareColumns: 'A' }), [])
  assert.deepEqual(shareColumnsOf(undefined), [])
})

test('a ticked column the tab no longer has is not sent as a blank', () => {
  assert.deepEqual(sharableColumns(WIDGET, HEADERS), ['Deal', 'Model', 'Status'])
  // Before headers load, the admin's list stands.
  assert.deepEqual(sharableColumns(WIDGET, []), ['Deal', 'Model', 'Status', 'Gone'])
})

test('ticking keeps the tab order, and keeps a column the tab has lost', () => {
  const cols = ['A', 'B', 'C']
  assert.deepEqual(toggleShareColumn({ shareColumns: ['C', 'A'] }, 'B', cols), ['A', 'B', 'C'])
  assert.deepEqual(toggleShareColumn({ shareColumns: ['C', 'A'] }, 'A', cols), ['C'])
  assert.deepEqual(toggleShareColumn({ shareColumns: ['Z', 'A'] }, 'B', cols), ['A', 'B', 'Z'])
  assert.deepEqual(toggleShareColumn({ shareColumns: ['Z', 'A'] }, 'Z', cols), ['A'])
})

// --- what leaves the page ----------------------------------------------------

test('only the columns the admin ticked leave the page', () => {
  const card = rowSnapshot(ROW, WIDGET, { headers: HEADERS, pageId: 'p_1', pageName: 'Nashik sales' })
  assert.deepEqual(
    card.fields.map((f) => f.column),
    ['Deal', 'Model', 'Status']
  )
  const everything = JSON.stringify(card)
  assert.equal(everything.includes('Ravi'), false, 'the customer left the page')
  assert.equal(everything.includes('9876543210'), false, 'the phone number left the page')
})

test('the heading is never a column that was not ticked', () => {
  // The remarks key and the detail title are both the customer's name here.
  // Heading the card with it would send it anyway, in bold.
  assert.equal(rowSnapshot(ROW, WIDGET, { headers: HEADERS }).title, 'DL-1')
  assert.equal(shareTitle(ROW, { ...WIDGET, shareTitleColumn: 'Model' }, ['Deal', 'Model']), 'Splendor')
  // A heading column the admin later unticked is not used either.
  assert.equal(shareTitle(ROW, { ...WIDGET, shareTitleColumn: 'Customer' }, ['Deal', 'Model']), 'DL-1')
  // When nothing shared has a value, the sheet row -- which says nothing.
  assert.equal(shareTitle({ _row: 9, Deal: '' }, WIDGET, ['Deal']), 'Row 9')
})

test('a card says where it came from, and a blank stays a blank', () => {
  const card = rowSnapshot(ROW, WIDGET, { headers: HEADERS, pageId: 'p_1', pageName: 'Nashik sales' })
  assert.equal(card.widget, 'Open deals')
  assert.equal(card.page, 'Nashik sales')
  assert.equal(card.pageId, 'p_1')
  assert.equal(card.sheetRow, 7)
  // "Status: —" is very often the question being asked.
  assert.deepEqual(card.fields.find((f) => f.column === 'Status'), { column: 'Status', value: '' })
  assert.equal(sharedFrom(card), 'Open deals · Nashik sales')
  assert.equal(pageHref(card), '/d/p_1')
})

test('no row, or no ticked column on this tab, is no card', () => {
  assert.equal(rowSnapshot(null, WIDGET), null)
  assert.equal(rowSnapshot(ROW, { ...WIDGET, shareColumns: ['Gone'] }, { headers: HEADERS }), null)
})

// --- a card anybody could have written by hand ------------------------------

test('a card that is not a card is nothing, not a crash', () => {
  for (const bad of [null, undefined, 'x', {}, { fields: 'x' }, { fields: [] }, { fields: [{ column: '' }] }]) {
    assert.equal(cleanSharedRow(bad), null, JSON.stringify(bad))
  }
})

test('a card is bounded, in fields and in length', () => {
  const many = { title: 'T', fields: Array.from({ length: 60 }, (_, i) => ({ column: `C${i}`, value: i })) }
  assert.equal(cleanSharedRow(many).fields.length, MAX_SHARED_FIELDS)
  const long = cleanSharedRow({ title: 'T', fields: [{ column: 'A', value: 'x'.repeat(2000) }] })
  assert.equal(long.fields[0].value.length, MAX_SHARED_VALUE)
  assert.ok(long.fields[0].value.endsWith('…'))
  // The same column twice is one field.
  assert.equal(cleanSharedRow({ fields: [{ column: 'A', value: 1 }, { column: 'A', value: 2 }] }).fields.length, 1)
})

test('only a real page id becomes part of a link', () => {
  const card = (pageId) => cleanSharedRow({ fields: [{ column: 'A', value: 1 }], pageId }).pageId
  assert.equal(card('p_abc-1'), 'p_abc-1')
  assert.equal(card('javascript:alert(1)'), '')
  assert.equal(card('../admin'), '')
  assert.equal(card('https://evil.example'), '')
  assert.equal(cleanSharedRow({ fields: [{ column: 'A' }], sheetRow: -3 }).sheetRow, null)
})

test('cleaning twice changes nothing', () => {
  const once = rowSnapshot(ROW, WIDGET, { headers: HEADERS, pageId: 'p_1', pageName: 'Nashik' })
  assert.deepEqual(cleanSharedRow(once), once)
})

// --- the message it goes in ---------------------------------------------------

test('a message always has words, even when the sender wrote none', () => {
  const card = rowSnapshot(ROW, WIDGET, { headers: HEADERS })
  assert.equal(shareBody(card, '  can you check this one?  '), 'can you check this one?')
  assert.equal(shareBody(card, ''), 'Shared a row: DL-1')
  assert.equal(isDefaultShareBody({ row: card, body: 'Shared a row: DL-1' }), true)
  assert.equal(isDefaultShareBody({ row: card, body: 'can you check' }), false)
  assert.equal(isDefaultShareBody({ body: 'Shared a row: DL-1' }), false)
})

test('the chat list says a row came, with or without a note', () => {
  const card = rowSnapshot(ROW, WIDGET, { headers: HEADERS })
  assert.equal(sharePreview({ row: card, body: 'Shared a row: DL-1' }), 'Row · DL-1')
  assert.equal(sharePreview({ row: card, body: 'why pending?' }), 'Row · DL-1 — why pending?')
  assert.equal(sharePreview({ body: 'hello' }), 'hello')
})

test('nothing goes without a card and somebody to send it to', () => {
  const card = rowSnapshot(ROW, WIDGET, { headers: HEADERS })
  assert.equal(shareProblem({ to: ['u1'], snapshot: null }), 'Nothing on this row is set to be shared')
  assert.equal(shareProblem({ to: [], snapshot: card }), 'Pick who it goes to')
  assert.match(shareProblem({ to: ['u1'], snapshot: card, note: 'x'.repeat(501) }), /too long by 1/)
  assert.equal(shareProblem({ to: ['u1'], snapshot: card, note: 'fine' }), '')
})

test('the stored message carries the cleaned card, and a plain one carries none', () => {
  const doc = messageDoc(
    { audience: 'people', to: ['u1'], body: 'x', row: { title: 'T', fields: [{ column: 'A', value: 12 }], pageId: 'no/pe' } },
    { uid: 'me' }
  )
  assert.deepEqual(doc.row, {
    title: 'T',
    fields: [{ column: 'A', value: '12' }],
    widget: '',
    page: '',
    pageId: '',
    sheetRow: null,
  })
  assert.equal('row' in messageDoc({ audience: 'people', to: ['u1'], body: 'x' }, { uid: 'me' }), false)
  assert.equal('row' in messageDoc({ audience: 'people', to: ['u1'], body: 'x', row: { fields: [] } }, { uid: 'me' }), false)
})

test('a row arrives in the chat as part of the message it came in', () => {
  const card = rowSnapshot(ROW, WIDGET, { headers: HEADERS })
  const m = {
    id: 'm1',
    from: 'ravi',
    to: ['me', 'ravi'],
    audience: 'people',
    body: 'Shared a row: DL-1',
    row: card,
    createdAt: '2026-09-15T10:00:00.000Z',
    readBy: [],
    replies: [],
  }
  assert.deepEqual(entriesOf([m], 'me', 'ravi')[0].row, card)
  assert.equal('row' in entriesOf([{ ...m, row: undefined }], 'me', 'ravi')[0], false)
  const [row] = conversationsFor([m], 'me', {})
  assert.equal(row.lastText, 'Row · DL-1')
})

// --- drawing it ------------------------------------------------------------------

test('only a web link becomes a link', () => {
  assert.equal(linkOf(' https://drive.google.com/file/d/abc/view '), 'https://drive.google.com/file/d/abc/view')
  assert.equal(linkOf('http://example.com'), 'http://example.com')
  assert.equal(linkOf('javascript:alert(1)'), null)
  assert.equal(linkOf('JaVaScRiPt:alert(1)'), null)
  assert.equal(linkOf('data:text/html,<script>'), null)
  assert.equal(linkOf('http://a b'), null)
  assert.equal(linkOf('DL-1'), null)
})

test('a long card folds, but never hides a single field behind a button', () => {
  const card = (n) => ({ fields: Array.from({ length: n }, (_, i) => ({ column: `C${i}`, value: '' })) })
  assert.equal(visibleFields(card(7), { limit: 6 }).hidden, 0)
  assert.deepEqual(
    [visibleFields(card(8), { limit: 6 }).shown.length, visibleFields(card(8), { limit: 6 }).hidden],
    [6, 2]
  )
  assert.equal(visibleFields(card(8), { limit: 6, expanded: true }).shown.length, 8)
  assert.deepEqual(visibleFields(null), { shown: [], hidden: 0 })
})

test('copy as text is the heading and every field, blanks said as blanks', () => {
  const card = cleanSharedRow({ title: 'DL-1', fields: [{ column: 'Deal', value: 'DL-1' }, { column: 'Status', value: '' }] })
  assert.equal(sharedRowText(card), 'DL-1\nDeal: DL-1\nStatus: —')
  assert.equal(sharedRowText(null), '')
})

// --- the rule ----------------------------------------------------------------------

test('the rules bound a card at the same size the app does', () => {
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8')
  const messageRule = rules.slice(rules.indexOf('match /messages/'), rules.indexOf('match /dataSources/'))
  const bound = messageRule.match(/request\.resource\.data\.row\.fields\.size\(\) <= (\d+)/)
  assert.ok(bound, 'no bound on a shared row')
  assert.equal(Number(bound[1]), MAX_SHARED_FIELDS)
  assert.ok(messageRule.includes("!('row' in request.resource.data) ||"), 'a message without a row is refused')
})

// --- where it is wired ---------------------------------------------------------------

test('the table offers it only when the admin, the tab and the sender all allow it', () => {
  const table = read('components/widgets/TableWidget.jsx')
  assert.ok(
    table.includes(
      'const showShare = shareEnabled(widget) && canSendMessages(userDoc) && sharableColumns(widget, tabHeaders).length > 0'
    )
  )
  // A snapshot of what was clicked, built by the model -- never the row.
  assert.ok(
    table.includes(
      'setSharing(rowSnapshot(row, widget, { headers: tabHeaders, pageId: shareFrom.pageId, pageName: shareFrom.pageName }))'
    )
  )
  assert.ok(table.includes('{showShare && <th className="w-10 px-2 py-2" aria-label="Send" />}'))
  assert.ok(table.includes('e.stopPropagation() shareRow(row)'), 'sending also opens the detail panel')
  assert.ok(table.includes('(showShare ? 1 : 0) +'), 'the empty row spans one column short')
  // Card view and the row panel, from the same state.
  assert.ok(table.includes('onShare={showShare ? shareRow : undefined}'))
  assert.ok(table.includes('onShare={showShare && detailRow ? () => shareRow(detailRow) : undefined}'))
  assert.ok(table.includes('{sharing && <ShareRowDialog snapshot={sharing} onClose={() => setSharing(null)} />}'))
})

test('the dashboard says which page a row came from', () => {
  assert.ok(read('pages/Dashboard.jsx').includes('shareFrom={{ pageId, pageName: page?.name }}'))
})

test('cards and the zoom send without opening what they open', () => {
  const cards = read('components/widgets/CardGrid.jsx')
  assert.ok(cards.includes('e.stopPropagation() onShare(row)'))
  assert.ok(cards.includes('onShare={onShare}'))
  assert.ok(cards.includes('onClick={() => onShare(row)}'))
})

test('the dialog sends an ordinary message, only to people who can receive one', () => {
  const dialog = read('components/ShareRowDialog.jsx')
  assert.ok(
    dialog.includes("send({ audience: 'people', to: picked, body: shareBody(snapshot, note), tone, row: snapshot })")
  )
  assert.ok(dialog.includes('people.filter((p) => p.id !== me && canReceiveMessages(p))'))
  assert.ok(dialog.includes('disabled={Boolean(problem) || sending || !maySend}'))
  // Portalled: opened from inside a widget, whose box may be transformed or
  // clipped by the layout, and a `fixed` dialog would be pinned to it.
  assert.ok(dialog.includes('return createPortal('))
  assert.ok(dialog.includes('document.body )'))
})

test('a card is drawn wherever the message is: chat, banner and pop-up', () => {
  const chat = read('components/Conversations.jsx')
  assert.ok(chat.includes('{entry.row && <SharedRowCard row={entry.row} className="my-1 w-64 max-w-full" />}'))
  const centre = read('components/MessageCenter.jsx')
  assert.ok(centre.includes('{message.row && <SharedRowCard row={message.row} compact className="mt-1.5 max-w-sm" />}'))
  assert.ok(centre.includes('{message.row && <SharedRowCard row={message.row} compact className="mt-2" />}'))
})

test('a link in a card cannot reach back into the dashboard', () => {
  const card = read('components/SharedRowCard.jsx')
  assert.ok(card.includes('const link = linkOf(field.value)'))
  assert.ok(card.includes('rel="noopener noreferrer"'))
  assert.ok(card.includes('const row = cleanSharedRow(raw)'), 'a card is drawn from what arrived, unchecked')
})

test('the admin chooses the columns in the table settings', () => {
  const editor = read('pages/admin/WidgetsPanel.jsx')
  assert.ok(editor.includes("key: 'sharing',"))
  assert.ok(editor.includes('onChange={(v) => set({ [ROW_SHARE]: v })}'))
  assert.ok(editor.includes('set({ [SHARE_COLUMNS]: toggleShareColumn(widget, col, cols) })'))
  // The heading picker offers only columns that are sent.
  assert.ok(editor.includes('options={shareColumnsOf(widget)}'))
})
