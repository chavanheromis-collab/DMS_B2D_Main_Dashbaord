import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  MAX_REMARK,
  authorTooltip,
  editProblem,
  editedRemark,
  editedTooltip,
  countLabel,
  exactWhen,
  isEdited,
  isMine,
  latestSummary,
  noteDoc,
  noteId,
  noteIdFor,
  notesEnabled,
  remarkCount,
  remarkDoc,
  remarkProblem,
  remarksOf,
  rowKeyOf,
} from './rowNotes.js'
import { hash32 } from './avatar.js'

const ME = 'u_me'
const BOSS = 'u_boss'

const remark = (extra = {}) => ({
  text: 'Customer asked to postpone to the 14th',
  by: BOSS,
  byName: 'Ravi Kumar',
  at: '2026-08-20T10:00:00.000Z',
  ...extra,
})

// ---------------------------------------------------------------------
// What a remark is attached to -- the only decision here that matters
// ---------------------------------------------------------------------

test('the key column identifies the record, not its position in the sheet', () => {
  // Insert a row in Google Sheets and every `_row` below it shifts by one.
  // Pinning remarks to that number moves them onto other people's records,
  // silently. The key column is what stops it.
  const row = { _row: 7, 'Deal ID': 'D-1042', Name: 'Sharma' }
  assert.equal(rowKeyOf(row, 'Deal ID'), 'D-1042')
  // The same record, one row further down the sheet tomorrow.
  assert.equal(rowKeyOf({ ...row, _row: 8 }, 'Deal ID'), 'D-1042')
})

test('and the note id follows it, so the same record has one note', () => {
  const a = { _row: 7, 'Deal ID': 'D-1042' }
  const b = { _row: 99, 'Deal ID': 'D-1042' }
  assert.equal(noteIdFor('src_a::MASTER', a, 'Deal ID'), noteIdFor('src_a::MASTER', b, 'Deal ID'))
})

test('the row number is the fallback, not the design', () => {
  // A feature that refuses to work until it is configured perfectly is a
  // feature nobody switches on.
  assert.equal(rowKeyOf({ _row: 7 }, ''), '7')
  assert.equal(rowKeyOf({ _row: 7, 'Deal ID': '  ' }, 'Deal ID'), '7', 'a blank key falls back too')
})

test('a row that identifies nothing carries no note', () => {
  // A remark attached to nothing would be attached to every nothing.
  assert.equal(rowKeyOf({}, 'Deal ID'), null)
  assert.equal(rowKeyOf(null, 'Deal ID'), null)
  assert.equal(noteIdFor('src_a::MASTER', {}, 'Deal ID'), null)
})

test('two tabs with the same key are two different notes', () => {
  assert.notEqual(noteId('src_a::MASTER', 'D-1'), noteId('src_a::ARCHIVE', 'D-1'))
  assert.notEqual(noteId('src_a::MASTER', 'D-1'), noteId('src_b::MASTER', 'D-1'))
})

test('an id with no scope is no id', () => {
  assert.equal(noteId('', 'D-1'), null)
  assert.equal(noteId('src_a::MASTER', ''), null)
  assert.equal(noteId('src_a::MASTER', null), null)
})

// ---------------------------------------------------------------------
// The id itself
// ---------------------------------------------------------------------

test('the id hash is stable, or every remark moves note on the next deploy', () => {
  assert.equal(noteId('s::T', 'D-1042'), noteId('s::T', 'D-1042'))
  assert.equal(hash32('D-1042'), hash32('D-1042'))
})

test('keys that clean up the same way still get different notes', () => {
  // "A/B" and "A_B" both sanitise to "A_B". Two records sharing one note is
  // the failure nobody would think to look for, so the hash is taken over
  // the raw address rather than the cleaned one.
  assert.notEqual(noteId('s::T', 'A/B'), noteId('s::T', 'A_B'))
  assert.notEqual(noteId('s::T', 'a b'), noteId('s::T', 'a-b'))
})

test('an id is legal wherever a sheet value is not', () => {
  // Firestore ids may not contain a slash, may not be `.` or `..`, and may
  // not both begin and end with a double underscore.
  for (const key of ['A/B', '..', '.', '__x__', 'x'.repeat(400), 'श्री', 'a b/c\\d']) {
    const id = noteId('src_a::MASTER', key)
    assert.ok(id && id.length > 0 && id.length <= 1500, key)
    // The real guarantee, not just "no slash": an id is made of the safe
    // alphabet, so it is legal, URL-safe and readable in the console.
    assert.ok(/^[A-Za-z0-9_-]+$/.test(id), `${key} -> ${id}`)
    assert.ok(id !== '.' && id !== '..', key)
    assert.ok(!(id.startsWith('__') && id.endsWith('__')), key)
  }
})

test('a very long key still produces a workable id', () => {
  const id = noteId('src_a::MASTER', 'x'.repeat(5000))
  assert.ok(id.length < 200)
})

// ---------------------------------------------------------------------
// The thread
// ---------------------------------------------------------------------

test('a conversation is read downwards', () => {
  const note = {
    remarks: [
      remark({ at: '2026-08-22T10:00:00.000Z', text: 'third' }),
      remark({ at: '2026-08-20T10:00:00.000Z', text: 'first' }),
      remark({ at: '2026-08-21T10:00:00.000Z', text: 'second' }),
    ],
  }
  assert.deepEqual(remarksOf(note).map((r) => r.text), ['first', 'second', 'third'])
})

test('an empty or missing note is an empty thread, not a crash', () => {
  assert.deepEqual(remarksOf(undefined), [])
  assert.deepEqual(remarksOf({}), [])
  assert.deepEqual(remarksOf({ remarks: 'nonsense' }), [])
  assert.equal(remarkCount(undefined), 0)
})

test('sorting does not disturb the stored order', () => {
  // The array comes straight out of a Firestore snapshot; sorting it in
  // place would mutate what the rest of the render is reading.
  const remarks = [remark({ at: '2026-08-22T10:00:00.000Z' }), remark({ at: '2026-08-20T10:00:00.000Z' })]
  const before = [...remarks]
  remarksOf({ remarks })
  assert.deepEqual(remarks, before)
})

test('the badge is capped, like the bell', () => {
  assert.equal(countLabel(0), '')
  assert.equal(countLabel(3), '3')
  assert.equal(countLabel(9), '9')
  assert.equal(countLabel(40), '9+')
  assert.equal(countLabel(undefined), '')
})

// ---------------------------------------------------------------------
// Writing one
// ---------------------------------------------------------------------

test('an empty remark is not saved', () => {
  assert.ok(remarkProblem(''))
  assert.ok(remarkProblem('   '))
  assert.equal(remarkProblem('ok'), '')
})

test('a wall of text is refused before it is written, and said in characters', () => {
  const problem = remarkProblem('x'.repeat(MAX_REMARK + 1))
  assert.ok(problem.includes(String(MAX_REMARK)))
  assert.equal(remarkProblem('x'.repeat(MAX_REMARK)), '')
})

test('a stored remark is trimmed, capped and stamped', () => {
  const at = new Date('2026-08-29T09:30:00.000Z')
  const doc = remarkDoc('  spoke to the customer  ', { uid: ME, name: 'Asha' }, at)
  assert.equal(doc.text, 'spoke to the customer')
  assert.equal(doc.by, ME)
  assert.equal(doc.byName, 'Asha')
  assert.equal(doc.at, at.toISOString())
  assert.equal(remarkDoc('x'.repeat(900), { uid: ME }, at).text.length, MAX_REMARK)
})

test('the name is written down, not looked up later', () => {
  // A remark is a record of what was said and who said it AT THE TIME.
  // Resolving the name on read would rewrite history whenever somebody
  // edited their profile, and show a blank for anyone who had left.
  assert.equal(remarkDoc('x', { uid: ME, name: 'Asha' }).byName, 'Asha')
  assert.equal(remarkDoc('x', { uid: ME, email: 'a@b.com' }).byName, 'a@b.com')
  assert.equal(remarkDoc('x', {}).byName, 'Someone', 'never blank')
})

test('a new note carries what it is about', () => {
  // Without `scope` the listener that reads a tab's notes cannot find it,
  // and the note exists but is invisible.
  assert.deepEqual(noteDoc('src_a::MASTER', 'D-1'), {
    scope: 'src_a::MASTER',
    key: 'D-1',
    remarks: [],
  })
})

test('only the author owns a remark', () => {
  assert.equal(isMine(remark({ by: ME }), ME), true)
  assert.equal(isMine(remark({ by: BOSS }), ME), false)
  // Two people with no uid are not the same person.
  assert.equal(isMine(remark({ by: '' }), ''), false)
  assert.equal(isMine(undefined, ME), false)
})

// ---------------------------------------------------------------------
// Reading it at a glance
// ---------------------------------------------------------------------

test('the exact moment is always available, not just "2d ago"', () => {
  // A remark is a record. "2d ago" is not a date anybody can quote back.
  assert.ok(exactWhen('2026-08-20T10:00:00.000Z').length > 6)
  assert.equal(exactWhen('nonsense'), '')
  assert.equal(exactWhen(undefined), '')
})

test('pointing at the picture says who, in full, and exactly when', () => {
  const NL = String.fromCharCode(10)
  const tip = authorTooltip(remark({ byName: 'Ravi Kumar', at: '2026-08-20T10:00:00.000Z' }))
  const [who, when] = tip.split(NL)
  assert.equal(who, 'Ravi Kumar')
  // The exact moment, not "2d ago" -- a remark is a record, and the avatar
  // is what people point at when they ask who wrote this and when.
  assert.equal(when, exactWhen('2026-08-20T10:00:00.000Z'))
  assert.ok(when.length > 6)
})

test('the full name even on your own, where the line above says only "You"', () => {
  // This is the one place the author's real name appears on their own
  // remark, which is most of the reason to hover it at all.
  assert.ok(authorTooltip(remark({ byName: 'Asha Patil', by: ME })).startsWith('Asha Patil'))
})

test('a nameless or undated remark still says something', () => {
  const NL = String.fromCharCode(10)
  assert.equal(authorTooltip({ byName: '', at: 'nonsense' }), 'Someone')
  assert.equal(authorTooltip(undefined), 'Someone')
  assert.equal(authorTooltip({ byName: '  ' }), 'Someone', 'and whitespace is not a name')
  assert.ok(!authorTooltip({ byName: 'Asha', at: 'nonsense' }).includes(NL), 'no dangling separator')
})

test('the tooltip shows the newest remark, which is the one worth knowing', () => {
  const note = {
    remarks: [
      remark({ at: '2026-08-20T10:00:00.000Z', text: 'old', byName: 'Asha' }),
      remark({ at: '2026-08-22T10:00:00.000Z', text: 'new', byName: 'Ravi' }),
    ],
  }
  assert.equal(latestSummary(note), 'Ravi: new')
  assert.equal(latestSummary({}), 'Add a remark')
})

test('a long remark is cut for the tooltip, and its newlines flattened', () => {
  const long = latestSummary({ remarks: [remark({ text: `a${'x'.repeat(200)}` })] })
  assert.ok(long.length < 120)
  assert.ok(long.endsWith('…'))
  assert.ok(!latestSummary({ remarks: [remark({ text: 'one\ntwo' })] }).includes('\n'))
})

// ---------------------------------------------------------------------
// Off unless an admin says so
// ---------------------------------------------------------------------

test('absent means off', () => {
  // Unlike the messaging rights, where absent means yes: this one ADDS a
  // column to a table that did not have one, so every existing table must
  // stay exactly as it was.
  assert.equal(notesEnabled({}), false)
  assert.equal(notesEnabled(undefined), false)
  assert.equal(notesEnabled({ rowNotes: true }), true)
  assert.equal(notesEnabled({ rowNotes: 'yes' }), false, 'only a real true')
})

// ---------------------------------------------------------------------
// The rules are the real boundary
// ---------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8')
const read = (p) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const table = read('src/components/widgets/TableWidget.jsx')
const popover = read('src/components/RowNotePopover.jsx')
const hook = read('src/hooks/useRowNotes.js')
const panel = read('src/pages/admin/WidgetsPanel.jsx')
const dashboard = read('src/pages/Dashboard.jsx')

const noteRule = rules.slice(rules.indexOf('match /rowNotes/'), rules.indexOf('match /dataSources/'))

test('you cannot write a remark signed by somebody else', () => {
  // On a note colleagues make decisions from, this is the whole game.
  assert.ok(noteRule.includes('remarksIn(request.resource.data)[0].by == request.auth.uid'))
  assert.ok(noteRule.includes('added()[0].by == request.auth.uid'))
})

test('and you cannot delete anybody else’s', () => {
  // The whole delete branch: the edit branch says the same words, so a bare
  // search for them is satisfied with the deletion rule unguarded.
  assert.ok(
    noteRule.includes("(gone().size() == 1 && gone()[0].by == request.auth.uid && added().size() == 0)")
  )
})

test('the difference is taken both ways, not counted', () => {
  // `hasAll` would prove a list did not shrink while saying nothing about
  // WHOSE remark had gone.
  assert.ok(noteRule.includes('function added()'))
  assert.ok(noteRule.includes('function gone()'))
  assert.ok(noteRule.includes('remarksIn(request.resource.data).removeAll(remarksIn(resource.data))'))
  assert.ok(noteRule.includes('remarksIn(resource.data).removeAll(remarksIn(request.resource.data))'))
})

test('one remark moves at a time, and only one direction at a time', () => {
  // Add one and delete one in the same write and the deletion is unchecked.
  assert.ok(noteRule.includes('added().size() == 1') && noteRule.includes('gone().size() == 0'))
  assert.ok(noteRule.includes('gone().size() == 1') && noteRule.includes('added().size() == 0'))
})

test('nothing already saved can be rewritten', () => {
  // An edit is a remove plus an add of a different object, which fails both
  // branches -- so a remark somebody has acted on cannot become a different
  // sentence.
  assert.ok(noteRule.includes("hasOnly(['scope', 'key', 'remarks'])"))
})

test('a note cannot be moved to another record', () => {
  // Change `scope` or `key` and a thread lands on somebody else's row.
  assert.ok(noteRule.includes("request.resource.data.get('scope', '') == resource.data.get('scope', '')"))
  assert.ok(noteRule.includes("request.resource.data.get('key', '') == resource.data.get('key', '')"))
})

test('a note is created with exactly one remark, and it says what it is about', () => {
  assert.ok(noteRule.includes('remarksIn(request.resource.data).size() == 1'))
  assert.ok(noteRule.includes('request.resource.data.scope is string'))
  assert.ok(noteRule.includes('request.resource.data.key is string'))
})

test('binning a whole thread is an admin’s job', () => {
  assert.ok(noteRule.includes('allow delete: if isAdmin()'))
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

test('one listener per tab, not one per row', () => {
  // 25 rows would otherwise open 25 subscriptions, tear them down on the
  // next page, and open 25 more.
  assert.ok(hook.includes("query(collection(db, 'rowNotes'), where('scope', '==', scope))"))
  assert.ok(hook.includes('if (!enabled || !scope || !user?.uid)'), 'and none at all when it is off')
})

test('the first remark creates the note, without a read to find out', () => {
  // Checking first would be a read on every row anybody opened, plus a race
  // between two people writing the first remark at the same moment.
  const add = hook.slice(hook.indexOf('const addRemark'), hook.indexOf('const removeRemark'))
  assert.ok(add.includes('{ merge: true }'), 'the write that creates the note must merge')
  assert.ok(add.includes('arrayUnion(remark)'))
})

test('two people writing at once both keep theirs', () => {
  // Read-modify-write would have the second overwrite the first.
  assert.ok(hook.includes('arrayUnion'))
  assert.ok(!hook.includes('remarks: [...'))
})

test('deleting matches the whole remark, not its text', () => {
  // An identical sentence written by somebody else at a different moment is
  // a different object and must stay.
  assert.ok(hook.includes('arrayRemove(remark)'))
})

test('the table addresses the real tab, not its display label', () => {
  // Labels are per page and can be disambiguated differently on the next
  // one, so a note would move when a second source was added.
  assert.ok(dashboard.includes('noteScope={refByLabel[widget.tab] || widget.tab}'))
})

test('the button is drawn per row and does not open the row', () => {
  // Per BUTTON: `e.stopPropagation()` appears half a dozen times in this
  // table, so a bare search for it is satisfied by the download menu.
  const button = table.slice(table.indexOf('function NoteButton'), table.indexOf('export default function'))
  assert.ok(button.length > 0)
  // From the element to its own close: `{hasDownloadColumn &&` appears
  // earlier in the file too, and slicing to THAT gives an empty string that
  // satisfies nothing while looking like it does.
  const at = table.indexOf('<NoteButton')
  const call = table.slice(at, table.indexOf('/>', at))
  assert.ok(call.includes('onOpen={(rect) =>'), 'the button must be handed something to open')
  assert.ok(button.includes('onClick={(e) => { e.stopPropagation()'))
  assert.ok(button.includes('onOpen(e.currentTarget.getBoundingClientRect())'))
})

test('a row that carries no note gets no button', () => {
  assert.ok(table.includes('if (!id) return null'))
})

test('a row that has been talked about looks different', () => {
  // Somebody scanning a table should see WHICH rows have remarks without
  // opening anything.
  assert.ok(table.includes('border-amber-300 bg-amber-50'))
  assert.ok(table.includes('countLabel(count)'))
})

test('the empty state spans the note column too', () => {
  assert.ok(table.includes('(showNotes ? 1 : 0)'))
})

test('the panel escapes the table it is drawn in', () => {
  // The table scrolls inside a card with `overflow: auto`, so a panel
  // rendered in the row would be clipped by the row below it.
  assert.ok(popover.includes('createPortal('))
  assert.ok(popover.includes('document.body'))
  assert.ok(popover.includes('fixed z-50'))
})

test('it is measured before it is placed', () => {
  // Rendering at the final position first is a note that flashes in the
  // corner of the screen; flipping is what keeps it on screen at the bottom
  // row or against the right edge.
  assert.ok(popover.includes('useLayoutEffect(() => { if (!anchorRect'), 'the measuring pass, not just the import')
  assert.ok(popover.includes("visibility: pos ? 'visible' : 'hidden'"))
  assert.ok(popover.includes('window.innerHeight - MARGIN'))
  assert.ok(popover.includes('window.innerWidth - box.width - MARGIN'))
})

test('escape, a click outside and a scroll all close it', () => {
  // A fixed panel would otherwise drift away from the row it belongs to.
  assert.ok(popover.includes("document.addEventListener('keydown', onKey)"))
  assert.ok(popover.includes("document.addEventListener('mousedown', onDown)"))
  assert.ok(popover.includes("window.addEventListener('scroll', onScroll, true)"))
})

test('and it stops listening when it goes', () => {
  // Four listeners left on the document is four listeners calling setState
  // on something React has unmounted.
  for (const line of [
    "document.removeEventListener('keydown', onKey)",
    "document.removeEventListener('mousedown', onDown)",
    "window.removeEventListener('scroll', onScroll, true)",
    "window.removeEventListener('resize', onClose)",
  ]) {
    assert.ok(popover.includes(line), line)
  }
})

test('scrolling inside the note does not close the note', () => {
  assert.ok(popover.includes('if (ref.current && e.target && ref.current.contains(e.target)) return'))
})

test('the box is focused and Enter saves', () => {
  // The button was pressed to write something. Asserted on the COMPOSER at
  // the foot of the panel: `EditBox` carries the same Enter handling, so a
  // bare search of the file passes with this one's deleted.
  const composer = popover.slice(popover.indexOf('border-t border-slate-100 bg-slate-50/70'))
  assert.ok(composer.length > 0)
  assert.ok(popover.includes('useEffect(() => { boxRef.current?.focus() }, [])'), 'on mount, not only after a save')
  assert.ok(composer.includes("if (e.key === 'Enter' && !e.shiftKey)"), 'and Shift+Enter is a new line')
  assert.ok(composer.includes('e.preventDefault()'))
})

test('a failed write is said, not swallowed', () => {
  // Silence means somebody believes they wrote something they did not.
  assert.ok(popover.includes("setFailed(e?.message || 'That could not be saved')"))
  assert.ok(popover.includes('catch (e)'))
})

test('a remark is never printed onto a report', () => {
  assert.ok(popover.includes('no-print'))
})

test('the picture is what you point at to see who and when', () => {
  assert.ok(popover.includes('title={authorTooltip(r)}'))
  // A native tooltip, because the thread SCROLLS -- and a container that
  // scrolls clips both axes, so a styled bubble drawn inside it would be cut
  // off on the first and last remarks, which are the ones people reach for.
  assert.ok(popover.includes('cursor-help'), 'and it looks hoverable')
  // The DIV, not the querySelector that finds it -- `data-thread` appears
  // in both, and the first one is the string in the scroll effect.
  const thread = popover.slice(popover.indexOf('data-thread className'))
  assert.ok(thread.slice(0, 120).includes('overflow-y-auto'), 'the clipping this avoids')
})

test('edit and delete are offered only on your own', () => {
  assert.ok(popover.includes('{mine && !editing && ('))
  assert.ok(popover.includes('isMine(r, uid)'))
  assert.ok(popover.includes('aria-label="Edit this remark"'))
  assert.ok(popover.includes('aria-label="Delete this remark"'))
})

test('the admin has the switch, and a column to attach remarks to', () => {
  assert.ok(panel.includes('onChange={(v) => set({ rowNotes: v })}'))
  assert.ok(panel.includes('onChange={(v) => set({ noteKeyColumn: v })}'))
})

test('and is told what no column costs, where the decision is made', () => {
  // Not in a manual nobody opens.
  assert.ok(panel.includes('pinned to the sheet row number'))
  assert.ok(panel.includes('wrong'))
})

test('the note is headed by whatever identifies the record', () => {
  assert.ok(table.includes('const noteTitleColumn = noteKeyColumn || titleColumn'))
})

// ---------------------------------------------------------------------
// Editing your own
// ---------------------------------------------------------------------

test('an edit changes the words and nothing else', () => {
  // "Edit" must not become a way to put your words in somebody else's
  // mouth, or to make a remark look older than the thing it is about.
  const original = remark({ by: ME, byName: 'Asha', at: '2026-08-20T10:00:00.000Z' })
  const next = editedRemark(original, '  actually the 15th  ', new Date('2026-08-22T09:00:00.000Z'))
  assert.equal(next.text, 'actually the 15th')
  assert.equal(next.by, original.by, 'the author is carried over')
  assert.equal(next.byName, original.byName, 'and the name against it')
  assert.equal(next.at, original.at, 'and the moment it was first written')
  assert.equal(next.editedAt, '2026-08-22T09:00:00.000Z')
})

test('an edit is trimmed and capped like anything else written', () => {
  assert.equal(editedRemark(remark(), 'x'.repeat(900)).text.length, MAX_REMARK)
})

test('an edit says it happened', () => {
  // A remark colleagues have already acted on quietly becoming a different
  // sentence is the hazard. One that says it was changed is a correction.
  assert.equal(isEdited(remark()), false)
  assert.equal(isEdited(editedRemark(remark(), 'new words')), true)
  assert.equal(isEdited({ editedAt: 'nonsense' }), false, 'a broken stamp is not a claim')
  assert.equal(isEdited(undefined), false)
})

test('and when', () => {
  const tip = editedTooltip(editedRemark(remark(), 'new', new Date('2026-08-22T09:00:00.000Z')))
  assert.ok(tip.startsWith('Edited '))
  assert.ok(tip.includes(exactWhen('2026-08-22T09:00:00.000Z')))
  assert.equal(editedTooltip(remark()), '', 'nothing to say about an unedited one')
})

test('the same words back is not an edit', () => {
  // Saving it would stamp `editedAt` on a remark nobody changed, which is
  // the marker crying wolf.
  const original = remark({ text: 'postponed to the 14th' })
  assert.ok(editProblem(original, 'postponed to the 14th'))
  assert.ok(editProblem(original, '  postponed to the 14th  '), 'and whitespace is not a change')
  assert.equal(editProblem(original, 'postponed to the 15th'), '')
})

test('an edit is refused on the same grounds as a new remark', () => {
  assert.ok(editProblem(remark(), ''))
  assert.ok(editProblem(remark(), 'x'.repeat(MAX_REMARK + 1)).includes(String(MAX_REMARK)))
})

// ---------------------------------------------------------------------
// The rules, for editing
// ---------------------------------------------------------------------

test('a reworded remark keeps its author', () => {
  assert.ok(noteRule.includes('added()[0].by == gone()[0].by'))
  assert.ok(noteRule.includes('gone()[0].by == request.auth.uid'))
})

test('...and the name against it, so an edit cannot re-sign it', () => {
  assert.ok(noteRule.includes('added()[0].byName == gone()[0].byName'))
})

test('...and the moment it was first written, so it cannot be re-dated', () => {
  // Without this, one out and one in is just a delete and an unrelated add
  // wearing a disguise -- which is how somebody deletes their own remark and
  // replaces it with a different one dated to last week.
  assert.ok(noteRule.includes('added()[0].at == gone()[0].at'))
})

test('and it must arrive stamped as edited', () => {
  assert.ok(noteRule.includes("'editedAt' in added()[0]"))
})

test('an edit is one out and one in, in the same write', () => {
  assert.ok(noteRule.includes('added().size() == 1 && gone().size() == 1'))
})

// ---------------------------------------------------------------------
// Wiring an edit
// ---------------------------------------------------------------------

test('an edit is a transaction, because it has to send the whole list', () => {
  // `arrayUnion` and `arrayRemove` are transforms on the same field and
  // Firestore will not apply two in one write. A plain get-then-set would
  // discard whatever somebody else added in between; a transaction re-reads
  // and retries.
  const fn = hook.slice(hook.indexOf('const editRemark'), hook.indexOf('return { addRemark'))
  assert.ok(fn.length > 0)
  assert.ok(fn.includes('runTransaction(db, async (tx) =>'))
  assert.ok(fn.includes('await tx.get(ref)'))
  assert.ok(fn.includes('tx.update(ref, { remarks: updated })'))
})

test('an edit finds its remark by author, moment and words', () => {
  // An identical sentence written by somebody else at a different moment is
  // a different remark and must be left alone.
  const fn = hook.slice(hook.indexOf('const editRemark'), hook.indexOf('return { addRemark'))
  assert.ok(fn.includes('r.by === remark.by && r.at === remark.at && r.text === remark.text'))
})

test('editing something already gone says so rather than recreating it', () => {
  const fn = hook.slice(hook.indexOf('const editRemark'), hook.indexOf('return { addRemark'))
  assert.ok(fn.includes("if (!snap.exists()) throw new Error('That remark is no longer there')"))
  assert.ok(fn.includes("if (at === -1) throw new Error('That remark is no longer there')"))
})

test('the table hands the panel a way to edit', () => {
  assert.ok(table.includes('onEdit={(remark, text) =>'))
  assert.ok(table.includes('editRemark(noteIdFor(noteScope, noteOpen.row, noteKeyColumn), remark, text)'))
})

test('a remark is edited where it sits, not in the box at the bottom', () => {
  // An edit is a correction to something with a position in the
  // conversation; moving it to the end would lose what it was answering.
  assert.ok(popover.includes('{editing ? ( <EditBox'))
  assert.ok(popover.includes('function EditBox('))
})

test('the remark being edited is tracked by its moment, not its position', () => {
  // An index would follow the wrong remark the instant somebody else's
  // arrives and the thread re-sorts underneath it.
  assert.ok(popover.includes('const [editingAt, setEditingAt] = useState(null)'))
  assert.ok(popover.includes('const editing = mine && editingAt === r.at'))
})

test('escape cancels the edit without closing the whole note', () => {
  // The panel has its own Escape listener on the document; without stopping
  // the event, one keystroke would cancel the edit AND shut the note.
  const box = popover.slice(popover.indexOf('function EditBox('), popover.indexOf('export default function'))
  assert.ok(box.includes("if (e.key === 'Escape') { e.stopPropagation() onCancel() }"))
})

test('the edit box opens with the cursor at the end, not selecting everything', () => {
  // An edit is usually a few words added. Select-all means one keystroke
  // destroys the lot.
  const box = popover.slice(popover.indexOf('function EditBox('), popover.indexOf('export default function'))
  assert.ok(box.includes('box.setSelectionRange(box.value.length, box.value.length)'))
  assert.ok(box.includes('box.focus()'))
})

test('Enter saves an edit, Shift+Enter is a new line', () => {
  const box = popover.slice(popover.indexOf('function EditBox('), popover.indexOf('export default function'))
  assert.ok(box.includes("if (e.key === 'Enter' && !e.shiftKey)"))
  assert.ok(box.includes('e.preventDefault()'))
})

test('an unchanged edit cannot be saved, and says why', () => {
  const box = popover.slice(popover.indexOf('function EditBox('), popover.indexOf('export default function'))
  assert.ok(box.includes('const problem = editProblem(remark, text)'))
  assert.ok(box.includes('disabled={Boolean(problem) || saving}'))
  assert.ok(box.includes("{problem || 'Enter to save'}"), 'the reason is shown, not just a dead button')
})

test('an edited remark is marked as such in the thread', () => {
  assert.ok(popover.includes('{isEdited(r) && ('))
  assert.ok(popover.includes('title={editedTooltip(r)}'))
})
