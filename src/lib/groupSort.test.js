import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_REDUCER,
  GROUP_SORTS,
  OPTION_SORTS,
  SORT_REDUCERS,
  byKey,
  compareKeys,
  reduceKeys,
  reducerIsNumeric,
  sortDirection,
  sortsByColumn,
} from './groupSort.js'
import { groupRows, groupSeries, groupSortKey, groupStacked, pivotTree } from './dataUtils.js'
import { controlOptions, orderOptions } from './pageControls.js'

// ---------------------------------------------------------------------
// The options themselves
// ---------------------------------------------------------------------

test('sorting by a column is a mode, not a column being set', () => {
  // Otherwise a half-filled form -- a column chosen, the mode still "value"
  // -- would silently reorder a chart nobody asked to reorder.
  assert.equal(sortsByColumn('column_asc'), true)
  assert.equal(sortsByColumn('column_desc'), true)
  assert.equal(sortsByColumn('value_desc'), false)
  assert.equal(sortsByColumn(undefined), false)
})

test('the direction is in the name, for every sort that has one', () => {
  for (const { value } of GROUP_SORTS) {
    assert.equal(sortDirection(value), value.endsWith('_asc') ? 1 : -1, value)
  }
})

test('a control cannot be sorted by a value it has not got', () => {
  // A control's options are values, not groups with a number attached.
  const values = OPTION_SORTS.map((o) => o.value)
  assert.equal(values.includes('value_desc'), false)
  assert.equal(values.includes('value_asc'), false)
  assert.ok(values.includes('sheet'), 'and sheet order is offered, being unreconstructable otherwise')
  assert.ok(values.includes(''), 'and doing nothing is an option, because it is the default')
})

test('sum and average are the reducers that only mean something for numbers', () => {
  assert.equal(reducerIsNumeric('sum'), true)
  assert.equal(reducerIsNumeric('avg'), true)
  assert.equal(reducerIsNumeric('first'), false)
  assert.equal(reducerIsNumeric('min'), false)
  assert.ok(SORT_REDUCERS.some((r) => r.value === DEFAULT_REDUCER))
})

// ---------------------------------------------------------------------
// Many rows, one key
// ---------------------------------------------------------------------

test('the default is sheet order, which is what a per-group constant needs', () => {
  // A branch's region is the same on every row of the branch: the first one
  // is the answer, and asking for a total of it would be nonsense.
  assert.equal(reduceKeys(['West', 'West', 'West']), 'West')
  assert.equal(DEFAULT_REDUCER, 'first')
  assert.equal(reduceKeys(['b', 'a'], 'first'), 'b', 'first means FIRST, not smallest')
})

test('lowest, highest, total and average', () => {
  assert.equal(reduceKeys([3, 1, 2], 'min'), 1)
  assert.equal(reduceKeys([3, 1, 2], 'max'), 3)
  assert.equal(reduceKeys([3, 1, 2], 'sum'), 6)
  assert.equal(reduceKeys([3, 1, 2], 'avg'), 2)
})

test('a total of words is not zero, it is the lowest word', () => {
  // Adding text produces either NaN or a concatenation; neither is an order
  // anybody can predict. The lowest at least is one.
  assert.equal(reduceKeys(['pear', 'apple'], 'sum'), 'apple')
  assert.equal(reduceKeys(['pear', 'apple'], 'avg'), 'apple')
  assert.equal(reduceKeys(['pear', 'apple'], 'max'), 'pear')
})

test('nothing to reduce is nothing, not zero', () => {
  assert.equal(reduceKeys([]), null)
  assert.equal(reduceKeys(null), null)
  assert.equal(reduceKeys([null, undefined, '']), null)
  assert.equal(reduceKeys([null, 5, ''], 'min'), 5, 'and blanks do not drag a minimum down')
})

// ---------------------------------------------------------------------
// Two keys, compared
// ---------------------------------------------------------------------

test('a group with no value in the column goes LAST, both ways round', () => {
  // It is not the smallest or the largest; it is the one that did not
  // answer, and burying it is kinder than letting it lead.
  const rows = [{ n: 'a', k: 2 }, { n: 'b' }, { n: 'c', k: 1 }]
  const up = [...rows].sort(byKey((r) => r.k, 'column_asc')).map((r) => r.n)
  const down = [...rows].sort(byKey((r) => r.k, 'column_desc')).map((r) => r.n)
  assert.deepEqual(up, ['c', 'a', 'b'])
  assert.deepEqual(down, ['a', 'c', 'b'])
})

test('numbers before text, stated rather than left to the data', () => {
  assert.ok(compareKeys(5, 'apple') < 0)
  assert.ok(compareKeys('apple', 5) > 0)
  assert.equal(compareKeys(1, 2) < 0, true)
  assert.equal(compareKeys('a', 'B') < 0, true, 'and case is not an order')
})

test('two missing keys are equal, not one after the other', () => {
  assert.equal(compareKeys(null, ''), 0)
  assert.equal(compareKeys(undefined, null), 0)
})

// ---------------------------------------------------------------------
// A column read off a group's rows
// ---------------------------------------------------------------------

const ORDERED = [
  { Branch: 'Pune', Region: 'West', Rank: '2', Amount: '10' },
  { Branch: 'Delhi', Region: 'North', Rank: '1', Amount: '50' },
  { Branch: 'Nashik', Region: 'West', Rank: '3', Amount: '20' },
  { Branch: 'Pune', Region: 'West', Rank: '2', Amount: '30' },
]

test('a number in the column sorts as a number, not as text', () => {
  const rows = [{ g: 'a', n: '9' }, { g: 'b', n: '10' }]
  assert.equal(groupSortKey(rows, 'n', 'min'), 9)
  assert.equal(groupSortKey(rows, 'n', 'max'), 10)
})

test('a date in the column sorts as a date, in the sheet’s own order', () => {
  const dmy = groupSortKey([{ d: '01/03/2020' }], 'd', 'first', 'DMY')
  const mdy = groupSortKey([{ d: '01/03/2020' }], 'd', 'first', 'MDY')
  assert.ok(typeof dmy === 'number' && typeof mdy === 'number')
  assert.notEqual(dmy, mdy, 'the same digits are two different days')
})

test('anything else is text, trimmed', () => {
  assert.equal(groupSortKey([{ s: '  West ' }], 's'), 'West')
  assert.equal(groupSortKey([{ s: 'N/A' }], 's'), 'N/A')
})

test('a date is not eaten by the number parser, nor a number by the date one', () => {
  // toNumber strips punctuation and would read 01/03/2020 as 1032020;
  // toDate takes a bare number as a sheet serial and would read 42 as a day
  // in 2041. Each has to be kept off the other's values.
  const key = (v) => groupSortKey([{ s: v }], 's', 'first', 'DMY')
  assert.equal(key('42'), 42)
  assert.equal(key('1,234'), 1234)
  assert.equal(key('(500)'), -500)
  assert.equal(key('45.5%'), 45.5)
  assert.ok(key('01/03/2020') > 1e11, 'a slashed date is a time, not a seven-digit number')
  assert.ok(key('2020-03-01') > 1e11)
  assert.ok(key('5 Mar 2020') > 1e11)
})

test('a blank row does not become a key', () => {
  assert.equal(groupSortKey([{ s: '' }, { s: 'West' }], 's', 'first'), 'West')
  assert.equal(groupSortKey([], 's'), null)
  assert.equal(groupSortKey([{ s: 'x' }], ''), null)
})

// ---------------------------------------------------------------------
// Every path that groups
// ---------------------------------------------------------------------

const names = (list) => list.map((e) => e.name)

test('a chart’s bars can be ordered by a third column', () => {
  const out = groupRows(ORDERED, {
    groupBy: 'Branch',
    aggregation: 'count',
    limit: 0,
    sort: 'column_asc',
    sortColumn: 'Rank',
  })
  assert.deepEqual(names(out), ['Delhi', 'Pune', 'Nashik'])
})

test('and the same order runs backwards', () => {
  const out = groupRows(ORDERED, {
    groupBy: 'Branch',
    limit: 0,
    sort: 'column_desc',
    sortColumn: 'Rank',
  })
  assert.deepEqual(names(out), ['Nashik', 'Pune', 'Delhi'])
})

test('the reducer decides what a group of unequal rows sorts on', () => {
  const rows = [
    { g: 'a', k: '5' },
    { g: 'a', k: '1' },
    { g: 'b', k: '3' },
  ]
  const by = (sortReducer) =>
    names(groupRows(rows, { groupBy: 'g', limit: 0, sort: 'column_asc', sortColumn: 'k', sortReducer }))
  assert.deepEqual(by('min'), ['a', 'b'], 'a’s lowest is 1')
  assert.deepEqual(by('max'), ['b', 'a'], 'a’s highest is 5')
  assert.deepEqual(by('sum'), ['b', 'a'], 'a totals 6')
  assert.deepEqual(by('first'), ['b', 'a'], 'a’s first row is 5')
})

test('a group whose rows are all blank in the column sinks to the bottom', () => {
  const rows = [
    { g: 'quiet', k: '' },
    { g: 'loud', k: '2' },
    { g: 'mid', k: '1' },
  ]
  const by = (sort) => names(groupRows(rows, { groupBy: 'g', limit: 0, sort, sortColumn: 'k' }))
  assert.deepEqual(by('column_asc'), ['mid', 'loud', 'quiet'])
  assert.deepEqual(by('column_desc'), ['loud', 'mid', 'quiet'])
})

test('naming no column falls back to the default order, not to no order', () => {
  // A half-filled form must leave a chart looking like a chart.
  const plain = names(groupRows(ORDERED, { groupBy: 'Branch', limit: 0, sort: 'value_desc', valueColumn: 'Amount', aggregation: 'sum' }))
  const half = names(groupRows(ORDERED, { groupBy: 'Branch', limit: 0, sort: 'column_asc', valueColumn: 'Amount', aggregation: 'sum' }))
  assert.deepEqual(half, plain)
  assert.deepEqual(plain, ['Delhi', 'Pune', 'Nashik'], 'and the default really is biggest first')
})

test('the cap is applied AFTER the order, so it keeps the right ones', () => {
  const out = groupRows(ORDERED, {
    groupBy: 'Branch',
    limit: 2,
    sort: 'column_asc',
    sortColumn: 'Rank',
  })
  assert.deepEqual(names(out), ['Delhi', 'Pune'])
})

test('a stacked chart’s bars too', () => {
  const { data } = groupStacked(ORDERED, {
    groupBy: 'Branch',
    stackBy: 'Region',
    limit: 0,
    sort: 'column_desc',
    sortColumn: 'Rank',
  })
  assert.deepEqual(names(data), ['Nashik', 'Pune', 'Delhi'])
})

test('a combo chart’s groups too', () => {
  const out = groupSeries(ORDERED, {
    groupBy: 'Branch',
    series: [{ key: 'n', column: '', aggregation: 'count' }],
    limit: 0,
    sort: 'column_asc',
    sortColumn: 'Rank',
  })
  assert.deepEqual(names(out), ['Delhi', 'Pune', 'Nashik'])
})

test('a pivot orders EVERY level by the column, not just the top one', () => {
  const rows = [
    { Region: 'West', Branch: 'Pune', BRank: '2' },
    { Region: 'West', Branch: 'Delhi', BRank: '1' },
    { Region: 'North', Branch: 'Agra', BRank: '9' },
  ]
  const out = pivotTree(rows, {
    rowColumns: ['Region', 'Branch'],
    aggregation: 'count',
    sort: 'column_asc',
    sortColumn: 'BRank',
  })
  // West leads because its first row reads 2 against North's 9 -- and then
  // its own branches are ordered by their own ranks, which is the part a
  // top-level-only sort would get wrong.
  assert.deepEqual(
    out.rows.map((r) => r.parts.join('/')),
    ['West/Delhi', 'West/Pune', 'North/Agra']
  )
})

// ---------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------

const CONTROL_ROWS = [
  { Stage: 'Delivered', Step: '4' },
  { Stage: 'Enquiry', Step: '1' },
  { Stage: 'Booked', Step: '3' },
  { Stage: 'Quoted', Step: '2' },
]
const control = (extra) => ({ id: 'c1', kind: 'select', column: 'Stage', ...extra })

test('a control left alone keeps the order it always had', () => {
  // Which for a bucketed control is chronological, and re-sorting it here
  // would put Jan 2026 before Mar 2025.
  assert.deepEqual(controlOptions(control(), CONTROL_ROWS), ['Booked', 'Delivered', 'Enquiry', 'Quoted'])
  assert.deepEqual(orderOptions(['b', 'a'], control(), CONTROL_ROWS), ['b', 'a'])
})

test('a control’s values can follow a column', () => {
  const out = controlOptions(control({ optionSort: 'column_asc', sortColumn: 'Step' }), CONTROL_ROWS)
  assert.deepEqual(out, ['Enquiry', 'Quoted', 'Booked', 'Delivered'])
})

test('or the order the sheet has them in', () => {
  const out = controlOptions(control({ optionSort: 'sheet' }), CONTROL_ROWS)
  assert.deepEqual(out, ['Delivered', 'Enquiry', 'Booked', 'Quoted'])
})

test('or plain alphabetical, forwards and back', () => {
  assert.deepEqual(controlOptions(control({ optionSort: 'name_desc' }), CONTROL_ROWS), [
    'Quoted',
    'Enquiry',
    'Delivered',
    'Booked',
  ])
})

test('a selected value is added to the REORDERED list, not the old one', () => {
  // The rule that keeps a currently-filtering value on the list even after
  // the page has narrowed it out of existence -- which must not quietly
  // hand back the list as it was before the order was applied.
  const out = controlOptions(control({ optionSort: 'name_desc' }), CONTROL_ROWS, 'DMY', 'Gone')
  assert.deepEqual(out, ['Quoted', 'Enquiry', 'Delivered', 'Booked', 'Gone'])
})

test('a control naming no column is left alone', () => {
  const out = controlOptions(control({ optionSort: 'column_asc' }), CONTROL_ROWS)
  assert.deepEqual(out, ['Booked', 'Delivered', 'Enquiry', 'Quoted'])
})

test('a bucketed control keeps its dates in date order under sheet order too', () => {
  // Sheet order is the ROWS' order, so it has to survive bucketing: the
  // labels it reorders are the bucket labels, not the raw cells.
  const rows = [
    { When: '05/03/2026' },
    { When: '09/01/2025' },
    { When: '02/11/2025' },
  ]
  const bucketed = control({ column: 'When', bucket: 'year', optionSort: 'sheet' })
  assert.deepEqual(controlOptions(bucketed, rows), ['2026', '2025'])
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const read = (p) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const chart = read('src/components/widgets/ChartWidget.jsx')
const comparison = read('src/components/widgets/ComparisonWidgets.jsx')
const analytics = read('src/components/widgets/AnalyticsWidgets.jsx')
const editors = read('src/pages/admin/WidgetEditors.jsx')
const comparisonEd = read('src/pages/admin/ComparisonEditors.jsx')
const panel = read('src/pages/admin/WidgetsPanel.jsx')
const controlsEd = read('src/pages/admin/ControlsPanel.jsx')
const widgetControlsEd = read('src/pages/admin/WidgetControlsEditor.jsx')

test('every widget that groups passes the column through', () => {
  for (const [name, src] of [
    ['chart', chart],
    ['comparison', comparison],
    ['analytics', analytics],
  ]) {
    assert.ok(src.includes('sortColumn: widget.sortColumn'), name)
    assert.ok(src.includes('sortReducer: widget.sortReducer'), name)
  }
  assert.equal(
    (comparison.match(/sortColumn: widget\.sortColumn/g) || []).length,
    2,
    'the stacked chart AND the combo chart'
  )
})

test('the combo chart is TOLD how its sheet writes dates', () => {
  // It reads a date column now, and a component that reads one without
  // being told reads 01/03 as January.
  const at = comparison.indexOf('export function ComboWidget(')
  assert.ok(comparison.slice(at, at + 300).includes("dateOrder = 'DMY'"), 'the prop exists')
  assert.ok(
    read('src/pages/Dashboard.jsx').includes('<ComboWidget {...common} crossFilters={crossFilters} onCrossFilter={drill} dateOrder={dateOrder} />'),
    'and the page passes it'
  )
})

test('one picker, not several copies of a list', () => {
  // The four-option list used to be written out in three places; a fifth
  // option added to one of them would have missed the other two.
  assert.ok(editors.includes('export function SortFields('))
  for (const [name, src] of [
    ['comparison', comparisonEd],
    ['panel', panel],
  ]) {
    assert.ok(src.includes('<SortFields'), name)
    assert.ok(!src.includes("{ value: 'name_desc', label: 'Name, Z→A' }"), name + ' still has its own copy')
  }
  assert.ok(!editors.includes("{ value: 'name_desc', label: 'Name, Z→A' }"), 'and the pivot uses it too')
})

test('the column and the reducer are asked for only once they are needed', () => {
  const at = editors.indexOf('export function SortFields(')
  const body = editors.slice(at, at + 1400)
  assert.ok(body.includes('{sortsByColumn(sort) && ('))
  assert.ok(body.indexOf('sortColumn: v') > body.indexOf('sortsByColumn(sort) &&'))
})

test('a control offers the same order, in both places a control is edited', () => {
  for (const [name, src] of [
    ['page', controlsEd],
    ['widget', widgetControlsEd],
  ]) {
    assert.ok(src.includes('options={OPTION_SORTS}'), name)
    assert.ok(src.includes('sortsByColumn(control.optionSort)'), name)
    assert.ok(src.includes('options={SORT_REDUCERS}'), name)
  }
})

test('a control’s fixed value can be picked from the column', () => {
  assert.ok(controlsEd.includes('choices={valuesFor(control.tab, control.column)}'))
  assert.ok(controlsEd.includes('<datalist id={listId}>'))
  const at = controlsEd.indexOf('choices={valuesFor')
  assert.ok(!controlsEd.slice(at, at + 200).includes('filter'), 'narrowed by nothing')
})
