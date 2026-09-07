import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  FILL_LIMIT,
  canFill,
  fillColumnsOf,
  fillIsOffered,
  fillRange,
  fillTargets,
  filledNote,
  inFillRange,
} from './fillDown.js'

const widget = (extra = {}) => ({
  type: 'table',
  tab: 'MASTER',
  editable: true,
  fillColumns: ['Status'],
  ...extra,
})

// The page as drawn: filtered, sorted, paged. The sheet row numbers are
// deliberately not in order, because the displayed order is not the sheet's.
const PAGE = [
  { _row: 14, Status: 'Cancelled', Finance: 'HDFC', Branch: 'Nashik' },
  { _row: 9, Status: 'In Progress', Finance: 'ICICI', Branch: 'Pune' },
  { _row: 22, Status: 'In Progress', Finance: '', Branch: 'Nashik' },
  { _row: 5, Status: 'Cancelled', Finance: 'Axis', Branch: 'Pune' },
  { _row: 31, Status: 'Delivered', Finance: 'SBI', Branch: 'Nashik' },
]

const GRANTED = ['Status', 'Finance']

// ---------------------------------------------------------------------
// Who may drag what
// ---------------------------------------------------------------------

test('the gesture is off until an admin turns it on, per column', () => {
  assert.deepEqual(fillColumnsOf(widget()), ['Status'])
  assert.deepEqual(fillColumnsOf(widget({ fillColumns: undefined })), [])
  assert.equal(canFill(widget(), 'Status', GRANTED), true)
  assert.equal(canFill(widget(), 'Finance', GRANTED), false, 'granted, but the admin did not open it up')
})

test('a reader without the column granted does not get a handle on it', () => {
  // Two people on the same table see the handle on different columns.
  assert.equal(canFill(widget(), 'Status', ['Finance']), false)
  assert.equal(canFill(widget(), 'Status', []), false)
})

test('a table that is not editable offers it nowhere', () => {
  assert.equal(canFill(widget({ editable: false }), 'Status', GRANTED), false)
  assert.equal(fillIsOffered(widget({ editable: false }), GRANTED), false)
})

test('a table is asked once whether the gesture appears at all', () => {
  assert.equal(fillIsOffered(widget(), GRANTED), true)
  assert.equal(fillIsOffered(widget({ fillColumns: ['Branch'] }), GRANTED), false, 'not granted')
  assert.equal(fillIsOffered(widget({ fillColumns: [] }), GRANTED), false)
})

// ---------------------------------------------------------------------
// The span being dragged
// ---------------------------------------------------------------------

test('the span covers the anchor and everything crossed since', () => {
  assert.deepEqual(fillRange(1, 3, 5), { from: 1, to: 3, anchor: 1 })
})

test('dragging upward is a fill too', () => {
  assert.deepEqual(fillRange(3, 1, 5), { from: 1, to: 3, anchor: 3 })
})

test('the pointer leaving the table does not run the span off the end', () => {
  assert.deepEqual(fillRange(2, 99, 5), { from: 2, to: 4, anchor: 2 })
  assert.deepEqual(fillRange(2, -5, 5), { from: 0, to: 2, anchor: 2 })
})

test('nothing to drag over is no span', () => {
  assert.equal(fillRange(0, 0, 0), null)
  assert.equal(fillRange(null, 2, 5), null)
  assert.equal(fillRange(0, null, 5), null)
})

test('the highlight is the whole span, including the row it started on', () => {
  const range = fillRange(1, 3, 5)
  assert.equal(inFillRange(range, 0), false)
  assert.equal(inFillRange(range, 1), true, 'a span that excludes its own anchor reads as starting one row late')
  assert.equal(inFillRange(range, 3), true)
  assert.equal(inFillRange(range, 4), false)
  assert.equal(inFillRange(null, 2), false)
})

// ---------------------------------------------------------------------
// What actually gets written
// ---------------------------------------------------------------------

test('the anchor value goes into the rows below it', () => {
  const { value, writes } = fillTargets(PAGE, { column: 'Status', anchorIndex: 0, toIndex: 2 })
  assert.equal(value, 'Cancelled')
  assert.deepEqual(
    writes.map((w) => w.row._row),
    [9, 22],
    'addressed by sheet row, in displayed order'
  )
  assert.ok(writes.every((w) => w.value === 'Cancelled'))
})

test('the anchor is never written back over itself', () => {
  const { writes } = fillTargets(PAGE, { column: 'Status', anchorIndex: 0, toIndex: 2 })
  assert.equal(
    writes.some((w) => w.row._row === 14),
    false,
    'the source of the value is not one of its destinations'
  )
})

test('rows that already hold the value cost nothing', () => {
  // Index 3 is already Cancelled. Dragging over it must not write it.
  const { writes } = fillTargets(PAGE, { column: 'Status', anchorIndex: 0, toIndex: 4 })
  assert.deepEqual(
    writes.map((w) => w.row._row),
    [9, 22, 31]
  )
})

test('dragging upward writes upward', () => {
  const { value, writes } = fillTargets(PAGE, { column: 'Status', anchorIndex: 4, toIndex: 2 })
  assert.equal(value, 'Delivered')
  assert.deepEqual(
    writes.map((w) => w.row._row),
    [22, 5]
  )
})

test('an empty anchor is a value like any other', () => {
  // Clearing a run of cells by dragging a blank one down is the same
  // gesture and has to work, or the only way to empty forty cells is forty
  // times by hand.
  const { value, writes } = fillTargets(PAGE, { column: 'Finance', anchorIndex: 2, toIndex: 4 })
  assert.equal(value, '')
  assert.deepEqual(
    writes.map((w) => w.row._row),
    [5, 31]
  )
})

test('a drag that goes nowhere writes nothing', () => {
  const { writes } = fillTargets(PAGE, { column: 'Status', anchorIndex: 1, toIndex: 1 })
  assert.deepEqual(writes, [])
})

test('a row with no sheet number cannot be addressed, so it is not pretended to be', () => {
  const rows = [{ _row: 2, Status: 'Cancelled' }, { Status: 'x' }, { _row: 4, Status: 'y' }]
  const { writes } = fillTargets(rows, { column: 'Status', anchorIndex: 0, toIndex: 2 })
  assert.deepEqual(
    writes.map((w) => w.row._row),
    [4]
  )
})

test('nothing is asked for without a column to fill', () => {
  assert.deepEqual(fillTargets(PAGE, { anchorIndex: 0, toIndex: 3 }).writes, [])
  assert.deepEqual(fillTargets(null, { column: 'Status', anchorIndex: 0, toIndex: 3 }).writes, [])
  assert.deepEqual(fillTargets(PAGE, {}).writes, [])
})

test('a runaway drag stops, and says that it stopped', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ _row: i + 2, Status: i === 0 ? 'Cancelled' : 'Open' }))
  const short = fillTargets(many, { column: 'Status', anchorIndex: 0, toIndex: 39, limit: 5 })
  assert.equal(short.writes.length, 5)
  assert.equal(short.capped, true, 'filling the first few in silence is worse than saying so')

  const whole = fillTargets(many, { column: 'Status', anchorIndex: 0, toIndex: 39 })
  assert.equal(whole.capped, false)
  assert.equal(whole.writes.length, 39)
})

test('the default cap is the one the server enforces', () => {
  // Two different numbers here and in the API means a drag the table
  // allows and the sheet rejects, which is a failed write with no
  // explanation anybody can act on.
  const api = fs.readFileSync(path.join(process.cwd(), 'api/_lib/googleSheets.js'), 'utf8')
  const match = api.match(/const MAX_BATCH_CELLS = (\d+)/)
  assert.ok(match, 'the server still caps a batch')
  assert.equal(Number(match[1]), FILL_LIMIT)
})

// ---------------------------------------------------------------------
// Saying what happened
// ---------------------------------------------------------------------

test('the note counts the rows and names the column', () => {
  assert.equal(filledNote('Status', 1), 'Filled Status into 1 row')
  assert.equal(filledNote('Status', 12), 'Filled Status into 12 rows')
  assert.match(filledNote('Status', 500, true), /the most one drag can change/)
  assert.equal(filledNote('Status', 0), '')
})

// ---------------------------------------------------------------------
// Wiring: the table, the batch write, and the panel
// ---------------------------------------------------------------------

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const TABLE = read('src/components/widgets/TableWidget.jsx')
const PANEL = read('src/pages/admin/WidgetsPanel.jsx')
const DASH = read('src/pages/Dashboard.jsx')
const API = read('api/sheets.js')
const SHEETS = read('api/_lib/googleSheets.js')
const CLIENT = read('src/lib/sheetsApi.js')

test('the handle appears only where all three answers are yes', () => {
  assert.match(TABLE, /const canDragFill = \(col\) => Boolean\(onEditCells\) && canFill\(widget, col, editableColumns\)/)
  assert.match(TABLE, /\{fillable && !isEditing && \(/, 'and never over an open editor')
})

test('the drag follows the rows as they are displayed', () => {
  // Reading the underlying order instead would fill rows that are not on
  // screen -- the one outcome nobody could predict from the gesture.
  assert.match(TABLE, /pageRows\.map\(\(row, rowIndex\) => \(/)
  assert.match(TABLE, /data-fill-row=\{rowIndex\}/)
  assert.match(TABLE, /fillTargets\(pageRows, \{/)
})

test('the pointer is followed on the document, not on the cells', () => {
  // It leaves the handle the instant the drag starts, and a listener per
  // cell loses it in the gaps between them.
  assert.match(TABLE, /document\.addEventListener\('pointermove', onMove\)/)
  assert.match(TABLE, /document\.addEventListener\('pointerup', onUp\)/)
  assert.match(TABLE, /elementFromPoint\(e\.clientX, e\.clientY\)/)
  assert.match(TABLE, /closest\?\.\('\[data-fill-row\]'\)/)
})

test('there is a way out of a drag that is not undo', () => {
  assert.match(TABLE, /if \(e\.key === 'Escape'\) setFill\(null\)/)
})

test('the span is read at the moment the pointer is released, not after', () => {
  // `setFill(null)` and the commit happen in the same breath; reading the
  // span back out of state would commit whatever is left after the clear.
  assert.match(TABLE, /const span = fillRef\.current\n\s*setFill\(null\)\n\s*commitFill\(span\)/)
})

test('a fill fires the same clearing rules a typed edit does', () => {
  // A rule that applies when you type Cancelled and not when you drag it
  // is a rule nobody can rely on.
  const start = TABLE.indexOf('async function commitFill(')
  const body = TABLE.slice(start, TABLE.indexOf('\n  }\n', start))
  // Through the same plan a typed edit builds, so the rules, the grant and
  // the date order cannot drift between the two paths.
  assert.match(body, /editPlan\(row, \{ \[span\.column\]: value \}\)/)
  const plan = TABLE.slice(TABLE.indexOf('function editPlan('))
  const planBody = plan.slice(0, plan.indexOf('\n  }\n'))
  assert.match(planBody, /columnsToClear\(widget, row, \{/)
  assert.match(planBody, /editable: editableColumns/, 'and still only where this reader may write')
  assert.match(planBody, /dateOrder/)
})

test('the whole drag is one request per column, not one per cell', () => {
  const start = TABLE.indexOf('async function commitFill(')
  const body = TABLE.slice(start, TABLE.indexOf('\n  }\n', start))
  assert.match(body, /await onEditCells\(widget\.tab, batches\)/)
  assert.equal((body.match(/await onEditCell\b/g) || []).length, 0, 'nothing writes a cell at a time')
})

test('what a drag did is said out loud, and waits to be dismissed', () => {
  assert.match(TABLE, /filledNote\(span\.column, writes\.length, capped\)/)
  assert.match(TABLE, /\{notice &&/)
})

test('the batch write names its column once, at the top', () => {
  // Per-entry columns would let one grant write anywhere on the sheet: the
  // permission upstream clears exactly one column by name.
  assert.match(CLIENT, /body: JSON\.stringify\(\{ page: pageId, ref, column: columnName, cells \}\)/)
  assert.match(API, /const cells = Array\.isArray\(body\.cells\) \? body\.cells : null/)
  assert.match(SHEETS, /export async function updateCells\(sheetId, tabName, columnName, entries\)/)
})

test('the batch is checked against the same permission a single cell is', () => {
  // One check, before either branch: the batch must not be a way round it.
  const post = API.slice(API.indexOf('async function handlePost('))
  const grant = post.indexOf('const allowed = access.isAdmin || (access.editable?.[targetRef] || []).includes(column)')
  assert.ok(grant >= 0, 'the per-ref column grant is still checked')
  assert.ok(grant < post.indexOf('updateCells(source.sheetId'), 'and checked before the batch is written')
})

test('the batch refuses everything a single write refuses, per cell', () => {
  const fn = SHEETS.slice(SHEETS.indexOf('export async function updateCells('))
  const body = fn.slice(0, fn.indexOf('\n}\n'))
  assert.match(body, /row < 2/, 'the header row renames a column for everybody')
  assert.match(body, /row > lastRow/, 'past the last row is an append somewhere arbitrary')
  assert.match(body, /sheet\.headers\.indexOf\(columnName\)/, 'the column comes from the sheet, never the request')
  // ...and a name the sheet does not have is refused, rather than turned
  // into column index -1 and written somewhere arbitrary.
  assert.match(body, /if \(colIdx === -1\) \{\s*throw badRequest/)
  assert.match(body, /seen\.has\(row\)/, 'the same cell twice is two answers to one question')
  assert.match(body, /MAX_BATCH_CELLS/)
})

test('the page reloads once, at the end', () => {
  // Every column of the drag is written before anything is re-read: a
  // reload between columns is a full refetch of every tab on the page,
  // per column, while somebody waits.
  const start = DASH.indexOf('async function handleEditCells(')
  const body = DASH.slice(start, DASH.indexOf('\n  }\n', start))
  const loop = body.indexOf('for (const { column, cells } of writes)')
  assert.ok(loop >= 0, 'the columns are still written in one pass')
  assert.equal((body.match(/reload\(\)/g) || []).length, 0, 'the reload belongs to runEdits, once')
  // The loop over the columns has to be INSIDE the one call, not the other
  // way round: one runEdits per column is one reload per column wearing a
  // different shape, and it still reads as a single `reload()` in the file.
  assert.equal((body.match(/runEdits\(/g) || []).length, 1, 'one write, not one per column')
  assert.match(
    body,
    /await runEdits\(ref, optimistic, async \(idToken\) => \{\s*for \(const \{ column, cells \} of writes\) \{/
  )

  const runStart = DASH.indexOf('async function runEdits(')
  const run = DASH.slice(runStart, DASH.indexOf('\n  }\n', runStart))
  assert.equal((run.match(/await reload\(\)/g) || []).length, 1)
  assert.ok(run.indexOf('await write(idToken)') < run.indexOf('await reload()'), 'written first, then re-read')
  assert.match(DASH, /onEditCells=\{handleEditCells\}/)
})

test('an admin can turn it on, and is told what it costs', () => {
  assert.match(PANEL, /set\(\{ fillColumns: on \? current\.filter\(\(c\) => c !== col\) : \[\.\.\.current, col\] \}\)/)
  assert.match(PANEL, /Drag to fill down/)
  // The import line also says FILL_LIMIT; the number has to reach the
  // screen, not just the module.
  assert.match(PANEL, /\{FILL_LIMIT\.toLocaleString\('en-IN'\)\} cells/, 'the cap is stated where the switch is')
})
