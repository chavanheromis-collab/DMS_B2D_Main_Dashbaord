import test from 'node:test'
import assert from 'node:assert/strict'

import { bucketedCell, bucketedValues, dateBucket } from './dataUtils.js'
import { controlOptions, optionRows, visibleChips } from './pageControls.js'
import { applyFilters } from './filterEngine.js'

const ROWS = [
  { _row: 2, Sold: '05/01/2026', Model: 'A' },
  { _row: 3, Sold: '20/03/2026', Model: 'B' },
  { _row: 4, Sold: '02/11/2025', Model: 'A' },
  { _row: 5, Sold: '15/03/2025', Model: 'C' },
  { _row: 6, Sold: '', Model: 'D' },
]

const control = (extra) => ({ id: 'f1', kind: 'select', tab: 'T', column: 'Sold', ...extra })
const run = (ctrl, value) => applyFilters(ROWS, { tab: 'T', filters: [ctrl], values: { f1: value } })

// --- what a control offers ------------------------------------------------

test('an unbucketed date column offers every date, which is the problem', () => {
  assert.equal(controlOptions(control(), ROWS).length, 4)
})

test('bucketed by year it offers years', () => {
  assert.deepEqual(controlOptions(control({ bucket: 'year' }), ROWS), ['2025', '2026'])
})

test('and the buckets come out in their own order, not alphabetical', () => {
  // "April" before "August" is alphabetical nonsense; "Mar 2026" before
  // "Mar 2025" is worse.
  assert.deepEqual(controlOptions(control({ bucket: 'month' }), ROWS), ['Mar 2025', 'Nov 2025', 'Jan 2026', 'Mar 2026'])
  assert.deepEqual(controlOptions(control({ bucket: 'monthOfYear' }), ROWS), ['January', 'March', 'November'])
  assert.deepEqual(controlOptions(control({ bucket: 'quarter' }), ROWS), ['2025 Q1', '2025 Q4', '2026 Q1'])
})

test('a blank cell offers nothing, as it always did', () => {
  assert.equal(controlOptions(control({ bucket: 'year' }), ROWS).includes(''), false)
})

test('a value that will not parse keeps its own text, and sorts last', () => {
  // "31/02/2026" is a data-quality finding; a filter that ignored it would
  // hide exactly the rows somebody needs to fix.
  const messy = [...ROWS, { Sold: 'unknown' }]
  const out = controlOptions(control({ bucket: 'year' }), messy)
  assert.deepEqual(out, ['2025', '2026', 'unknown'])
})

// --- what it then filters -------------------------------------------------

test('choosing a year keeps that year’s rows', () => {
  assert.deepEqual(run(control({ bucket: 'year' }), '2026').map((r) => r._row), [2, 3])
})

test('the same value means nothing without the bucket', () => {
  // Proof the engine is comparing the bucket and not the cell: unbucketed,
  // "2026" matches no raw date at all.
  assert.equal(run(control(), '2026').length, 0)
})

test('a multi-choice bucket takes several at once', () => {
  const out = run(control({ kind: 'multi', bucket: 'monthOfYear' }), ['March', 'November'])
  assert.deepEqual(out.map((r) => r._row), [3, 4, 5])
})

test('a bucket is only for the kinds that list values', () => {
  // A date RANGE is not a list of things to press, and bucketing one would
  // be meaningless -- the engine leaves those kinds alone.
  const range = { id: 'f1', kind: 'date', tab: 'T', column: 'Sold', bucket: 'year' }
  const out = applyFilters(ROWS, { tab: 'T', filters: [range], values: { f1: { from: '2026-01-01' } } })
  assert.deepEqual(out.map((r) => r._row), [2, 3])
})

test('an unbucketed control still matches exactly as before', () => {
  assert.deepEqual(run({ ...control(), column: 'Model' }, 'A').map((r) => r._row), [2, 4])
})

// --- the labels themselves ------------------------------------------------

test('every bucket knows its own sort order', () => {
  const d = new Date(2026, 2, 15) // Sunday 15 March 2026
  assert.deepEqual(dateBucket(d, 'year'), { label: '2026', sort: 2026 })
  assert.equal(dateBucket(d, 'quarter').label, '2026 Q1')
  assert.equal(dateBucket(d, 'month').label, 'Mar 2026')
  assert.equal(dateBucket(d, 'monthOfYear').label, 'March')
  assert.equal(dateBucket(d, 'dayOfWeek').label, 'Sunday')
  assert.equal(dateBucket(d, 'dayOfWeek').sort, 6, 'Monday first, so the weekend stays at the end')
  assert.equal(dateBucket(d, 'nonsense'), null)
  assert.equal(dateBucket(null, 'year'), null)
})

test('a cell with no bucket is just its own trimmed text', () => {
  assert.equal(bucketedCell('  Pune  ', ''), 'Pune')
  assert.equal(bucketedCell(null, ''), '')
  assert.equal(bucketedCell('05/01/2026', 'year'), '2026')
})

test('bucketing an empty list is not an error', () => {
  assert.deepEqual(bucketedValues([], 'Sold', 'year'), [])
  assert.deepEqual(bucketedValues(ROWS, '', 'year'), [])
  assert.deepEqual(bucketedValues(null, 'Sold', 'year'), [])
})

// --- how many chips ------------------------------------------------------

test('chips show every value unless an admin capped them', () => {
  // The default used to be twelve of ninety, with nothing saying so.
  const values = Array.from({ length: 90 }, (_, i) => `V${i}`)
  assert.equal(visibleChips(values, 0).shown.length, 90)
  assert.equal(visibleChips(values, undefined).shown.length, 90)
  assert.equal(visibleChips(values, null).hidden, 0)
})

test('a cap says what it is holding back', () => {
  const { shown, hidden } = visibleChips(['a', 'b', 'c', 'd'], 2)
  assert.deepEqual(shown, ['a', 'b'])
  assert.equal(hidden, 2)
})

test('a cap bigger than the list is not a cap', () => {
  assert.deepEqual(visibleChips(['a', 'b'], 10), { shown: ['a', 'b'], hidden: 0 })
})

test('nothing to show is not an error', () => {
  assert.deepEqual(visibleChips(null, 5), { shown: [], hidden: 0 })
  assert.deepEqual(visibleChips([], 5), { shown: [], hidden: 0 })
})

// --- controls narrowing each other ---------------------------------------

const SALES = [
  { _row: 2, Region: 'West', DSE: 'Ravi' },
  { _row: 3, Region: 'West', DSE: 'Sunil' },
  { _row: 4, Region: 'East', DSE: 'Asha' },
]

const region = { id: 'r', kind: 'select', tab: 'T', column: 'Region' }
const dse = { id: 'd', kind: 'select', tab: 'T', column: 'DSE' }

const rowsFor = (control, values) =>
  optionRows(control, { rows: SALES, tab: 'T', filters: [region, dse], values })

test('a control lists only what the rest of the page still shows', () => {
  // Otherwise every name that does not sell in the west is a trap: pick one
  // and the dashboard empties with nothing to explain why.
  const rows = rowsFor(dse, { r: 'West' })
  assert.deepEqual(controlOptions(dse, rows), ['Ravi', 'Sunil'])
})

test('...but never narrows its own list', () => {
  // Otherwise picking West leaves West as the only region on offer, and
  // there is no way back to East.
  const rows = rowsFor(region, { r: 'West' })
  assert.deepEqual(controlOptions(region, rows), ['East', 'West'])
})

test('a selected value stays listed even once nothing matches it', () => {
  // Pick two things that do not overlap and one of them would vanish while
  // still filtering the page -- an empty dashboard and no way to undo it.
  const rows = rowsFor(dse, { r: 'East' })
  assert.deepEqual(controlOptions(dse, rows), ['Asha'])
  assert.deepEqual(controlOptions(dse, rows, 'DMY', 'Ravi'), ['Asha', 'Ravi'])
})

test('a multi-choice control keeps all of its selections listed', () => {
  const rows = rowsFor(dse, { r: 'East' })
  assert.deepEqual(controlOptions(dse, rows, 'DMY', ['Ravi', 'Sunil']), ['Asha', 'Ravi', 'Sunil'])
})

test('an independent control lists everything, whatever else is on', () => {
  // Some lists are a reference -- every branch we have, whether or not it
  // sold anything -- and shrinking them hides the zeroes that matter.
  const rows = rowsFor({ ...dse, independent: true }, { r: 'West' })
  assert.deepEqual(controlOptions(dse, rows), ['Asha', 'Ravi', 'Sunil'])
})

test('with nothing else on, the list is simply everything', () => {
  assert.deepEqual(controlOptions(dse, rowsFor(dse, {})), ['Asha', 'Ravi', 'Sunil'])
})
