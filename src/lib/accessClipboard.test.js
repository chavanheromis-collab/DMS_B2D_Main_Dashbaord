import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  ACCESS_FIELDS,
  accessOf,
  clearCopiedAccess,
  copiedAccess,
  copiedLabel,
  copyAccess,
  hasCopiedAccess,
  pasteInto,
  pasteNote,
  refsOfPage,
  widgetIdsOfPage,
} from './accessClipboard.js'

// ---------------------------------------------------------------------
// Copying one page's permissions onto another
// ---------------------------------------------------------------------
// What is worth testing here is not the copying -- it is everything the
// paste REFUSES to carry. Half of a permission set is keyed by things
// that exist only on the page it came from, and a paste that carried
// them anyway would put ticks in the admin screen against things the
// page cannot show. The admin would read those ticks as the truth.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const SALES = 'src1::SALES'
const STOCK = 'src1::STOCK'
const HR = 'src2::HR'

/** A page that reads SALES through its widgets and STOCK through a control. */
const salesPage = () => ({
  id: 'p1',
  widgets: [
    { id: 'w1', type: 'table', tab: SALES },
    { id: 'w2', type: 'kpi', tab: SALES },
  ],
  controls: [{ id: 'c1', kind: 'dropdown', tab: STOCK }],
})

/** Another page, reading one of the same tabs and one of its own. */
const hrPage = () => ({
  id: 'p2',
  widgets: [{ id: 'w9', type: 'table', tab: SALES }],
  controls: [{ id: 'c9', kind: 'dropdown', tab: HR }],
})

const fullAccess = () => ({
  canView: true,
  editable: { [SALES]: ['Region', 'Owner'], [HR]: ['Salary'] },
  downloadable: { [SALES]: true, [HR]: true },
  rowOps: { [SALES]: { canDeleteRows: true }, [HR]: { canCopyRows: true } },
  hiddenWidgets: ['w2'],
  widgetOrder: { w1: 0, w2: 1 },
  scope: {
    match: 'all',
    conditions: [
      { tab: SALES, column: 'Region', operator: 'equals', value: 'West' },
      { tab: STOCK, column: 'Band', operator: 'equals', value: 'C' },
    ],
  },
})

test.beforeEach(() => clearCopiedAccess())

// ---------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------

test('a copy is a snapshot, not a window onto the card that made it', () => {
  // The card goes on being edited after Copy is pressed. If the clipboard
  // held the same objects, carrying on typing in the source page would
  // rewrite what is about to be pasted somewhere else.
  const live = fullAccess()
  copyAccess(live, { pageId: 'p1' })

  live.editable[SALES].push('Cost')
  live.rowOps[SALES].canDeleteRows = false
  live.hiddenWidgets.push('w1')

  const { access } = copiedAccess()
  assert.deepEqual(access.editable[SALES], ['Region', 'Owner'])
  assert.equal(access.rowOps[SALES].canDeleteRows, true)
  assert.deepEqual(access.hiddenWidgets, ['w2'])
})

test('and reading it twice cannot damage it either', () => {
  copyAccess(fullAccess(), { pageId: 'p1' })
  copiedAccess().access.editable[SALES].length = 0
  assert.deepEqual(copiedAccess().access.editable[SALES], ['Region', 'Owner'])
})

test('the snapshot keeps the whole set and invents nothing', () => {
  const snap = accessOf(fullAccess())
  assert.deepEqual(Object.keys(snap).sort(), [...ACCESS_FIELDS].sort())
  // Absent stays absent: a document saved before a field existed must not
  // gain a silent default here, where the PASTE is the thing that decides
  // what a missing field means.
  assert.deepEqual(Object.keys(accessOf({ canView: true })), ['canView'])
  assert.deepEqual(accessOf(null), {})
})

test('the clipboard is empty until something is put on it, and can be emptied', () => {
  assert.equal(hasCopiedAccess(), false)
  assert.equal(copiedAccess(), null)
  assert.equal(copiedLabel(), '')

  copyAccess(fullAccess(), { pageId: 'p1', pageName: 'Sales', userName: 'Ravi' })
  assert.equal(hasCopiedAccess(), true)
  assert.equal(copiedLabel(), 'Ravi · Sales')

  clearCopiedAccess()
  assert.equal(hasCopiedAccess(), false)
})

test('the label says what it knows and no more', () => {
  copyAccess({}, { pageId: 'p1', pageName: 'Sales' })
  assert.equal(copiedLabel(), 'Sales')
  copyAccess({}, { pageId: 'p1' })
  assert.equal(copiedLabel(), '')
})

// ---------------------------------------------------------------------
// What a page can be given
// ---------------------------------------------------------------------

test('a page reads tabs through its controls as well as its widgets', () => {
  // A grant for the tab behind a dropdown is a real grant. Collecting from
  // widgets alone would drop it on every paste.
  assert.deepEqual(refsOfPage(salesPage()).sort(), [SALES, STOCK].sort())
  assert.deepEqual(refsOfPage(null), [])
  assert.deepEqual(widgetIdsOfPage(salesPage()), ['w1', 'w2'])
})

// ---------------------------------------------------------------------
// Pasting
// ---------------------------------------------------------------------

test('a grant is kept where the page reads that tab, whichever page it came from', () => {
  copyAccess(fullAccess(), { pageId: 'p1', pageName: 'Sales' })
  const { access, dropped } = pasteInto(copiedAccess(), hrPage())

  assert.deepEqual(access.editable, { [SALES]: ['Region', 'Owner'], [HR]: ['Salary'] })
  assert.deepEqual(access.downloadable, { [SALES]: true, [HR]: true })
  assert.deepEqual(access.rowOps, {
    [SALES]: { canDeleteRows: true },
    [HR]: { canCopyRows: true },
  })
  assert.deepEqual(dropped.refs, [])
})

test('a grant for a tab the target page cannot read is left behind', () => {
  copyAccess(fullAccess(), { pageId: 'p1' })
  const noStock = hrPage()
  noStock.controls = []
  const { access, dropped } = pasteInto(copiedAccess(), noStock)

  assert.deepEqual(Object.keys(access.editable), [SALES])
  assert.deepEqual(dropped.refs, [HR])
})

test('and is reported once, not once for every field that mentioned it', () => {
  copyAccess(
    {
      canView: true,
      editable: { [STOCK]: ['Qty'] },
      downloadable: { [STOCK]: true },
      rowOps: { [STOCK]: { canDeleteRows: true } },
    },
    { pageId: 'p1' }
  )
  const { access, dropped } = pasteInto(copiedAccess(), hrPage())

  assert.deepEqual(access.editable, {})
  assert.deepEqual(access.downloadable, {})
  assert.deepEqual(access.rowOps, {})
  assert.deepEqual(dropped.refs, [STOCK])
})

test('what is keyed by widget id travels only to the page those widgets are on', () => {
  // An id from another page names nothing here. Carrying it would hide
  // nothing, while looking in the admin screen exactly like hiding
  // something.
  copyAccess(fullAccess(), { pageId: 'p1' })
  const { access, dropped } = pasteInto(copiedAccess(), hrPage())

  assert.deepEqual(access.hiddenWidgets, [])
  assert.deepEqual(access.widgetOrder, {})
  assert.equal(dropped.widgets, 3)
})

test('and does travel on the same page -- the next person in the same role', () => {
  copyAccess(fullAccess(), { pageId: 'p1' })
  const { access, dropped } = pasteInto(copiedAccess(), salesPage())

  assert.deepEqual(access.hiddenWidgets, ['w2'])
  assert.deepEqual(access.widgetOrder, { w1: 0, w2: 1 })
  assert.equal(dropped.widgets, 0)
})

test('even there, a widget deleted since the copy is not carried', () => {
  copyAccess(fullAccess(), { pageId: 'p1' })
  const trimmed = salesPage()
  trimmed.widgets = trimmed.widgets.filter((w) => w.id !== 'w2')
  const { access } = pasteInto(copiedAccess(), trimmed)

  assert.deepEqual(access.hiddenWidgets, [])
  assert.deepEqual(access.widgetOrder, { w1: 0 })
})

test('a copy with no origin cannot claim to be the same page', () => {
  // Two pages with an empty id are not the same page, and an access
  // document that arrived from nowhere must not be trusted to say so.
  copyAccess(fullAccess(), {})
  const { access } = pasteInto(copiedAccess(), { id: '', widgets: [{ id: 'w1', tab: SALES }] })
  assert.deepEqual(access.hiddenWidgets, [])
})

test('a row limit written against a tab this page cannot read is dropped', () => {
  // Not for safety -- the engine only applies a condition to its own tab.
  // A limit that silently does nothing is worse than no limit at all: it
  // is read off the screen as protection that is not there.
  copyAccess(fullAccess(), { pageId: 'p1' })
  const { access, dropped } = pasteInto(copiedAccess(), hrPage())

  assert.deepEqual(
    access.scope.conditions.map((c) => c.tab),
    [SALES]
  )
  assert.equal(access.scope.match, 'all')
  assert.equal(dropped.scope, 1)
})

test('a half-written limit is kept, because the admin is still writing it', () => {
  copyAccess(
    { scope: { match: 'any', conditions: [{ column: 'Region', operator: 'equals', value: '' }] } },
    { pageId: 'p1' }
  )
  const { access, dropped } = pasteInto(copiedAccess(), hrPage())
  assert.equal(access.scope.conditions.length, 1)
  assert.equal(access.scope.match, 'any')
  assert.equal(dropped.scope, 0)
})

test('a paste always produces a complete access document', () => {
  // The card sets seven pieces of state from this. An undefined among them
  // is an uncontrolled input, and after that a save that writes undefined
  // over a grant somebody still has.
  const { access } = pasteInto({ access: {}, from: {} }, hrPage())
  for (const key of ACCESS_FIELDS) assert.notEqual(access[key], undefined, key)
  assert.equal(access.canView, false)
  assert.deepEqual(access.scope, { match: 'all', conditions: [] })
})

test('pasting nothing at all is a no-op, not a crash', () => {
  const { access, dropped } = pasteInto(null, null)
  assert.equal(access.canView, false)
  assert.deepEqual(dropped, { refs: [], widgets: 0, scope: 0 })
})

test('being allowed in is a plain yes, whatever shape it was stored in', () => {
  copyAccess({ canView: 1 }, { pageId: 'p1' })
  assert.equal(pasteInto(copiedAccess(), hrPage()).access.canView, true)
})

// ---------------------------------------------------------------------
// Saying what did not travel
// ---------------------------------------------------------------------

test('a paste that took everything says nothing', () => {
  assert.equal(pasteNote({ refs: [], widgets: 0, scope: 0 }), '')
  assert.equal(pasteNote(), '')
})

test('a paste that left something behind names it in the reader own words', () => {
  const note = pasteNote({ refs: [HR], widgets: 0, scope: 0 }, (r) => r.split('::')[1])
  assert.ok(note.includes('a grant for HR'), note)
  assert.equal(note.includes('::'), false)
})

test('and counts rather than lists when there are many', () => {
  const note = pasteNote({ refs: ['a', 'b', 'c', 'd', 'e'], widgets: 2, scope: 1 })
  assert.ok(note.includes('5 grants for a, b, c and 2 more'), note)
  assert.ok(note.includes('2 widget settings'), note)
  assert.ok(note.includes('1 row limit'), note)
})

test('one of a thing is called one of a thing', () => {
  const note = pasteNote({ refs: [], widgets: 1, scope: 1 })
  assert.ok(note.includes('1 widget setting from'), note)
  assert.ok(note.includes('1 row limit'), note)
  assert.equal(note.includes('settings'), false)
  assert.equal(note.includes('limits'), false)
})

// ---------------------------------------------------------------------
// Wired into the card
// ---------------------------------------------------------------------

const panel = read('pages/admin/UsersPanel.jsx')

test('the copy and paste buttons are on the summary line, outside the fold', () => {
  // The job this removes is "make these four pages match". Having to open
  // every card to do it IS the work, so the buttons cannot live in the
  // part that folds away.
  const card = panel.slice(panel.indexOf('function AccessCard('))
  const summary = card.slice(0, card.indexOf('{open && ('))
  assert.ok(summary.includes('copyAccess('))
  assert.ok(summary.includes('pasteInto(copiedAccess(), page)'))
})

test('and they are not buttons inside a button', () => {
  // The whole summary line is the expander. A <button> nested inside a
  // <button> is invalid, and the browser resolves it by dropping one.
  const card = panel.slice(panel.indexOf('function AccessCard('))
  const opens = card.indexOf('onClick={onToggleOpen}')
  const closes = card.indexOf('</button>', opens)
  assert.ok(opens > -1 && closes > opens)
  assert.equal(card.slice(opens, closes).includes('copyAccess('), false)
})

test('a paste sets every part of the card, not the ones that caught the eye', () => {
  // Leaving one setter out would merge half of the pasted set into
  // whatever the card already held, which is the one outcome nobody could
  // predict from the screen.
  const card = panel.slice(panel.indexOf('function AccessCard('))
  for (const setter of [
    'setCanView(access.canView)',
    'setHidden(access.hiddenWidgets)',
    'setEditable(access.editable)',
    'setDownloadable(access.downloadable)',
    'setRowOps(access.rowOps)',
    'setWidgetOrder(access.widgetOrder)',
    'setScope(access.scope)',
  ]) {
    assert.ok(card.includes(setter), setter)
  }
})

test('what the paste left behind is shown, not swallowed', () => {
  assert.ok(panel.includes('setPasted(pasteNote(dropped, labelFor))'))
  assert.ok(panel.includes('{pasted && ('))
  // And it goes when it no longer describes anything pending.
  assert.ok(panel.includes("setPasted('')"))
})

test('a paste stages the change and leaves the admin looking at Save', () => {
  // Rights are not written to the server on one click from a line that
  // shows four words about the page. But Save is inside the fold, so a
  // paste onto a collapsed card that did not open it would leave a
  // change nobody can see or apply.
  const card = panel.slice(panel.indexOf('function AccessCard('))
  assert.ok(card.includes('if (!open) onToggleOpen?.()'))
  const paste = card.indexOf('pasteInto(copiedAccess(), page)')
  assert.equal(card.slice(paste, paste + 900).includes('onSave('), false)
})

test('the paste button knows about a copy made on another card', () => {
  // The clipboard is module state, which React does not watch. If the
  // button asked it directly, pressing Copy would leave every OTHER
  // card's Paste greyed out until something unrelated re-rendered it.
  assert.ok(panel.includes('const [clipLabel, setClipLabel] = useState(copiedLabel)'))
  assert.ok(panel.includes('clipLabel={clipLabel}'))
  assert.ok(panel.includes('onCopied={setClipLabel}'))
  assert.ok(panel.includes('onCopied?.(copiedLabel())'))
  assert.ok(panel.includes('disabled={!clipLabel}'))
  assert.equal(panel.includes('hasCopiedAccess()'), false)
})

test('the button says where the copy came from', () => {
  assert.ok(panel.includes('Paste the permissions from ${clipLabel}'))
  assert.ok(panel.includes('{ pageId: page.id, pageName: navLabelFor(page), userName }'))
})
