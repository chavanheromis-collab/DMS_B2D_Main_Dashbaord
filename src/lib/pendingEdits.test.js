import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  addAllPending,
  addPending,
  applyPending,
  applyPendingByRef,
  dropPending,
  editKey,
  newPending,
  pendingCount,
  pendingFor,
  settlePending,
} from './pendingEdits.js'

const REF = 'src_a::MASTER'
const OTHER = 'src_a::Quotations'

const rows = () => [
  { _row: 2, Status: 'In Progress', Finance: 'HDFC' },
  { _row: 3, Status: 'Delivered', Finance: 'ICICI' },
]

const byRef = () => ({
  [REF]: { headers: ['Status', 'Finance'], rows: rows() },
  [OTHER]: { headers: ['Stage'], rows: [{ _row: 2, Stage: 'Open' }] },
})

const edit = (row, column, value, ref = REF) => newPending(ref, row, column, value)

// ---------------------------------------------------------------------
// Holding an edit
// ---------------------------------------------------------------------

test('an edit is remembered against the cell it changes', () => {
  const pending = addPending({}, edit(2, 'Status', 'Cancelled'))
  assert.equal(pendingCount(pending), 1)
  assert.deepEqual(pending[editKey(REF, 2, 'Status')], {
    ref: REF,
    row: 2,
    column: 'Status',
    value: 'Cancelled',
  })
})

test('typing twice in one cell leaves the second value, not both', () => {
  // Keeping both would let the older one win, depending on which response
  // came back first.
  let pending = addPending({}, edit(2, 'Status', 'Cancelled'))
  pending = addPending(pending, edit(2, 'Status', 'Delivered'))
  assert.equal(pendingCount(pending), 1)
  assert.equal(pending[editKey(REF, 2, 'Status')].value, 'Delivered')
})

test('the same column on two rows, and two columns on one row, are separate cells', () => {
  const pending = addAllPending({}, [
    edit(2, 'Status', 'Cancelled'),
    edit(3, 'Status', 'Cancelled'),
    edit(2, 'Finance', ''),
  ])
  assert.equal(pendingCount(pending), 3)
})

test('the same cell on two different tabs is two cells', () => {
  const pending = addAllPending({}, [edit(2, 'Status', 'x'), edit(2, 'Status', 'y', OTHER)])
  assert.equal(pendingCount(pending), 2)
})

test('row 0 is a row, and an empty value is a value', () => {
  // Both are falsy, and both are ordinary edits.
  const pending = addAllPending({}, [edit(0, 'Status', ''), edit(2, 'Finance', '')])
  assert.equal(pendingCount(pending), 2)
})

test('an edit with nothing to address is not recorded', () => {
  assert.equal(pendingCount(addPending({}, { ref: '', row: 2, column: 'Status', value: 'x' })), 0)
  assert.equal(pendingCount(addPending({}, { ref: REF, row: null, column: 'Status', value: 'x' })), 0)
  assert.equal(pendingCount(addPending({}, { ref: REF, row: 2, column: '', value: 'x' })), 0)
  assert.equal(pendingCount(addPending({}, null)), 0)
})

// ---------------------------------------------------------------------
// Laying it over the sheet
// ---------------------------------------------------------------------

test('the value is on screen before it is on the sheet', () => {
  const pending = addPending({}, edit(2, 'Status', 'Cancelled'))
  const out = applyPending(rows(), pendingFor(pending, REF))
  assert.equal(out[0].Status, 'Cancelled')
  assert.equal(out[1].Status, 'Delivered', 'and nothing else moved')
})

test('the row underneath is not mutated', () => {
  // Everything downstream compares rows; changing one in place would mean
  // the "before" and the "after" were the same object.
  const original = rows()
  applyPending(original, [edit(2, 'Status', 'Cancelled')])
  assert.equal(original[0].Status, 'In Progress')
})

test('two edits to one row both land', () => {
  const out = applyPending(rows(), [edit(2, 'Status', 'Cancelled'), edit(2, 'Finance', '')])
  assert.equal(out[0].Status, 'Cancelled')
  assert.equal(out[0].Finance, '')
})

test('an edit against a row the tab no longer has changes nothing', () => {
  const out = applyPending(rows(), [edit(99, 'Status', 'Cancelled')])
  assert.deepEqual(out, rows())
})

test('nothing pending returns the very same array', () => {
  // A page with no unsaved edit -- which is nearly always -- must not make
  // every chart, filter and KPI below recompute.
  const original = rows()
  assert.equal(applyPending(original, []), original)
  assert.equal(applyPending(original, null), original)
  const map = byRef()
  assert.equal(applyPendingByRef(map, {}), map)
})

test('only the tab an edit belongs to is rebuilt', () => {
  const map = byRef()
  const out = applyPendingByRef(map, addPending({}, edit(2, 'Status', 'Cancelled')))
  assert.equal(out[REF].rows[0].Status, 'Cancelled')
  assert.equal(out[OTHER], map[OTHER], 'the other tab is handed back untouched')
})

test('the headers of an overlaid tab survive', () => {
  const out = applyPendingByRef(byRef(), addPending({}, edit(2, 'Status', 'Cancelled')))
  assert.deepEqual(out[REF].headers, ['Status', 'Finance'])
})

// ---------------------------------------------------------------------
// Letting it go
// ---------------------------------------------------------------------

test('an edit the sheet has caught up with stops being held over it', () => {
  const pending = addPending({}, edit(2, 'Status', 'Cancelled'))
  const fresh = byRef()
  fresh[REF].rows[0].Status = 'Cancelled'
  assert.equal(pendingCount(settlePending(pending, fresh)), 0)
})

test('an edit the sheet has NOT caught up with is kept', () => {
  // Between a 200 and the page reading it back, Google has the value and
  // this page does not. Dropping the entry there snaps the cell to its old
  // value for one render, which looks exactly like the save having failed.
  const pending = addPending({}, edit(2, 'Status', 'Cancelled'))
  assert.equal(pendingCount(settlePending(pending, byRef())), 1)
})

test('settling one edit does not let go of another', () => {
  let pending = addAllPending({}, [edit(2, 'Status', 'Cancelled'), edit(3, 'Finance', 'Axis')])
  const fresh = byRef()
  fresh[REF].rows[0].Status = 'Cancelled'
  pending = settlePending(pending, fresh)
  assert.equal(pendingCount(pending), 1)
  assert.equal(pending[editKey(REF, 3, 'Finance')].value, 'Axis')
})

test('an edit whose row has left the tab is let go of', () => {
  // There is nothing left to lay it over, and holding it would keep alive
  // a row the sheet no longer has.
  const pending = addPending({}, edit(99, 'Status', 'Cancelled'))
  assert.equal(pendingCount(settlePending(pending, byRef())), 0)
})

test('a tab that was not part of the read is left alone', () => {
  // Saying nothing about it is the only honest answer -- "not in this
  // response" is not "the sheet disagrees".
  const pending = addPending({}, edit(2, 'Stage', 'Won', OTHER))
  const partial = { [REF]: byRef()[REF] }
  assert.equal(pendingCount(settlePending(pending, partial)), 1)
  assert.equal(pendingCount(settlePending(pending, null)), 1)
})

test('a number and the text of that number are the same answer', () => {
  // The sheet hands back 42 where the edit sent "42". Comparing them raw
  // would keep the entry forever, and the overlay would never empty.
  const pending = addPending({}, edit(2, 'Finance', '42'))
  const fresh = { [REF]: { rows: [{ _row: 2, Finance: 42 }] } }
  assert.equal(pendingCount(settlePending(pending, fresh)), 0)
})

test('an emptied cell settles against a blank one', () => {
  const pending = addPending({}, edit(2, 'Finance', ''))
  const fresh = { [REF]: { rows: [{ _row: 2 }] } }
  assert.equal(pendingCount(settlePending(pending, fresh)), 0)
})

test('nothing pending settles to the very same object', () => {
  const empty = {}
  assert.equal(settlePending(empty, byRef()), empty)
})

test('a refused write is taken back off the screen', () => {
  const edits = [edit(2, 'Status', 'Cancelled'), edit(2, 'Finance', '')]
  const pending = addAllPending({}, edits)
  assert.equal(pendingCount(dropPending(pending, edits)), 0)
  assert.equal(pendingCount(dropPending(pending, [])), 2)
})

// ---------------------------------------------------------------------
// Wiring: where the overlay sits in the page
// ---------------------------------------------------------------------

const DASH = fs.readFileSync(path.join(process.cwd(), 'src/pages/Dashboard.jsx'), 'utf8')
const HOOK = fs.readFileSync(path.join(process.cwd(), 'src/hooks/usePageData.js'), 'utf8')

test('the overlay goes on before anything else reads the rows', () => {
  // Above the calculated columns, so a formula worked out from an edited
  // field recomputes with the new value -- and so the charts, filters and
  // KPIs see the same sheet the table does.
  const overlay = DASH.indexOf('const editedByRef = useMemo(() => applyPendingByRef(dataByRef, pending)')
  assert.ok(overlay >= 0, 'the overlay is still applied')
  assert.ok(overlay < DASH.indexOf('const computedByRef = useMemo('), 'and applied first')
  assert.match(DASH, /for \(const \[ref, data\] of Object\.entries\(editedByRef\)\)/)
  assert.match(DASH, /\}, \[editedByRef, sourcesById, dateOrder\]\)/, 'and recomputed when it changes')
})

test('every write goes down one path, and shows before it sends', () => {
  const start = DASH.indexOf('async function runEdits(')
  const body = DASH.slice(start, DASH.indexOf('\n  }\n', start))
  const show = body.indexOf('addAllPending(current, optimistic)')
  assert.ok(show >= 0, 'the value goes on screen')
  assert.ok(show < body.indexOf('await write(idToken)'), 'before the write is sent')
})

test('a refused write does not leave a lie on the screen', () => {
  const start = DASH.indexOf('async function runEdits(')
  const body = DASH.slice(start, DASH.indexOf('\n  }\n', start))
  assert.match(body, /setPending\(\(current\) => dropPending\(current, optimistic\)\)/)
  assert.match(body, /setEditError\(e\.message\)/)
})

test('and says so where it cannot be missed', () => {
  // A banner in the page header was honest while a save blocked the screen
  // until it finished -- you were looking at the top of the page because
  // you had just pressed something there. Saves go to the background now:
  // the failure arrives while somebody is three thousand pixels down a
  // table, or behind the detail drawer, and a banner they have scrolled
  // past is an alert that was never given.
  const start = DASH.indexOf('const editAlert = editError ? (')
  assert.ok(start >= 0, 'the alert still exists')
  const body = DASH.slice(start, DASH.indexOf('\n  ) : null', start))
  assert.match(body, /className="fixed /, 'not something that can be scrolled away from')
  assert.match(body, /z-\[60\]/, 'and not behind the drawer the edit came from')
  assert.match(body, /role="alert"/)
  assert.match(body, /onClick=\{\(\) => setEditError\(null\)\}/, 'it waits to be dismissed rather than fading')
  assert.match(body, /That change was not saved/, 'in words, not just an error string')

  // Mounted OUTSIDE the shell, or the drawer covers the thing telling you
  // the drawer's save failed.
  assert.match(DASH, /<\/AppShell>[\s\S]{0,300}?\{editAlert\}/)
  assert.equal(DASH.includes('{editError && ('), false, 'and the old banner is not still there as well')
})

test('the overlay is lifted by what the sheet says, not by the write returning', () => {
  const start = DASH.indexOf('async function runEdits(')
  const body = DASH.slice(start, DASH.indexOf('\n  }\n', start))
  assert.match(body, /const fresh = await reload\(\)/)
  assert.match(body, /setPending\(\(current\) => settlePending\(current, fresh\)\)/)
})

test('a failed re-read keeps the value on screen', () => {
  // The write landed. Only the reading back failed, and the value is on
  // the sheet either way.
  const start = DASH.indexOf('async function runEdits(')
  const body = DASH.slice(start, DASH.indexOf('\n  }\n', start))
  const settle = body.indexOf('settlePending')
  const secondTry = body.indexOf('try {', body.indexOf('await write(idToken)'))
  assert.ok(secondTry >= 0 && secondTry < settle, 'the re-read is guarded separately from the write')
})

test('pressing refresh settles the overlay too', () => {
  // Scoped to the function: an unbounded search would run straight past it
  // and find the settle that belongs to runEdits.
  const start = DASH.indexOf('const refresh = useCallback(')
  assert.ok(start >= 0, 'the refresh button still has a handler')
  const body = DASH.slice(start, DASH.indexOf('\n  }, [reload])', start))
  assert.match(body, /settlePending\(current, fresh\)/)
  assert.equal((DASH.match(/onClick=\{refresh\}/g) || []).length, 2)
  assert.equal((DASH.match(/onClick=\{reload\}/g) || []).length, 0, 'nothing calls the raw reload any more')
})

test('a reload hands back what it read, not just a promise that it did', () => {
  // State lands a render later, which is too late to compare against the
  // edits still being held on screen.
  //
  // The ORDER is the assertion: a `return null` slipped in above leaves the
  // real return standing, unreachable, and every settle silently comparing
  // against nothing.
  assert.match(
    HOOK,
    /const fresh = result\.tabs \|\| \{\}\n\s*setTabs\(fresh\)\n\s*setLastLoaded\(new Date\(\)\)\n\s*return fresh\n/
  )
  assert.match(HOOK, /load\(\)\.catch\(\(\) => \{\}\)/, 'and the effect that calls it does not care')
})
