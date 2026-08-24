import test from 'node:test'
import assert from 'node:assert/strict'

import { bucketNeeds, bucketedCell, bucketedValues, valueBucket } from './dataUtils.js'
import { controlOptions } from './pageControls.js'
import { applyFilters } from './filterEngine.js'

const AMOUNTS = [
  { _row: 2, Amount: '40', Name: 'Ravi', Note: '' },
  { _row: 3, Amount: '140', Name: 'Rakesh', Note: 'ok' },
  { _row: 4, Amount: '260', Name: 'asha', Note: '' },
  { _row: 5, Amount: '-10', Name: '9 Lives', Note: 'ok' },
  { _row: 6, Amount: 'n/a', Name: 'Sunil', Note: 'ok' },
]

const control = (extra) => ({ id: 'f1', kind: 'select', tab: 'T', column: 'Amount', ...extra })
const run = (ctrl, value) => applyFilters(AMOUNTS, { tab: 'T', filters: [ctrl], values: { f1: value } })

// --- numbers --------------------------------------------------------------

test('a number column can be banded', () => {
  const options = controlOptions(control({ bucket: 'band', bucketSize: 100 }), AMOUNTS)
  assert.deepEqual(options, ['-100 – 0', '0 – 100', '100 – 200', '200 – 300', 'n/a'])
})

test('bands are half open, so nothing falls in two of them', () => {
  const spec = { bucket: 'band', bucketSize: 100 }
  assert.equal(valueBucket('100', spec).label, '100 – 200')
  assert.equal(valueBucket('199.99', spec).label, '100 – 200')
  assert.equal(valueBucket('200', spec).label, '200 – 300')
})

test('bands sort by their value, not by their text', () => {
  // "1,000 – 1,100" before "200 – 300" is what sorting the text would give.
  const rows = [{ A: '1000' }, { A: '200' }]
  assert.deepEqual(bucketedValues(rows, 'A', { bucket: 'band', bucketSize: 100 }), ['200 – 300', '1,000 – 1,100'])
})

test('a filter on a band keeps the rows in it', () => {
  assert.deepEqual(run(control({ bucket: 'band', bucketSize: 100 }), '100 – 200').map((r) => r._row), [3])
})

test('my own breakpoints, including the open ends', () => {
  const spec = { bucket: 'breaks', bucketBreaks: '0, 100, 250' }
  assert.equal(valueBucket('-10', spec).label, '< 0')
  assert.equal(valueBucket('40', spec).label, '0 – 100')
  assert.equal(valueBucket('140', spec).label, '100 – 250')
  assert.equal(valueBucket('260', spec).label, '250+')
})

test('breakpoints out of order are put in order', () => {
  assert.equal(valueBucket('40', { bucket: 'breaks', bucketBreaks: '250, 0, 100' }).label, '0 – 100')
})

test('breakpoints that are not numbers are ignored, and none at all is no bucket', () => {
  assert.equal(valueBucket('40', { bucket: 'breaks', bucketBreaks: 'a, b' }), null)
  assert.equal(valueBucket('40', { bucket: 'breaks', bucketBreaks: '' }), null)
})

test('negative, zero and positive', () => {
  assert.equal(valueBucket('-1', 'sign').label, 'Negative')
  assert.equal(valueBucket('0', 'sign').label, 'Zero')
  assert.equal(valueBucket('7', 'sign').label, 'Positive')
  assert.deepEqual(bucketedValues(AMOUNTS, 'Amount', 'sign'), ['Negative', 'Positive', 'n/a'])
})

// --- text -----------------------------------------------------------------

test('a long list of names can be indexed by first letter', () => {
  assert.deepEqual(controlOptions(control({ column: 'Name', bucket: 'firstLetter' }), AMOUNTS), ['A', 'R', 'S', '#'])
})

test('case does not split a letter in two, and non-letters share one bucket', () => {
  assert.equal(valueBucket('asha', 'firstLetter').label, 'A')
  assert.equal(valueBucket('9 Lives', 'firstLetter').label, '#')
  assert.equal(valueBucket('  ravi', 'firstLetter').label, 'R')
})

test('first word, and first few characters', () => {
  assert.equal(valueBucket('9 Lives', 'firstWord').label, '9')
  assert.equal(valueBucket('MA3ABC001', { bucket: 'prefix', bucketSize: 5 }).label, 'MA3AB')
  assert.equal(valueBucket('MA3ABC001', { bucket: 'prefix' }).label, 'MA3', 'three by default')
})

test('text buckets with no natural order sort alphabetically', () => {
  assert.deepEqual(bucketedValues([{ A: 'zeta one' }, { A: 'alpha two' }], 'A', 'firstWord'), ['alpha', 'zeta'])
})

// --- anything -------------------------------------------------------------

test('filled or blank is the one bucket a blank belongs in', () => {
  assert.deepEqual(controlOptions(control({ column: 'Note', bucket: 'filled' }), AMOUNTS), ['Filled', 'Blank'])
  assert.deepEqual(run(control({ column: 'Note', bucket: 'filled' }), 'Blank').map((r) => r._row), [2, 4])
})

test('everywhere else, a blank is still nothing', () => {
  assert.equal(controlOptions(control({ column: 'Note', bucket: 'firstLetter' }), AMOUNTS).includes(''), false)
})

// --- values the rule does not fit -----------------------------------------

test('a value the bucket cannot take keeps its own text', () => {
  // "n/a" in a column of amounts is a finding, not a row to swallow.
  assert.equal(bucketedCell('n/a', { bucket: 'band', bucketSize: 100 }), 'n/a')
  assert.equal(valueBucket('n/a', { bucket: 'band' }), null)
})

test('...and sorts last, out of the way but still reachable', () => {
  assert.equal(controlOptions(control({ bucket: 'band', bucketSize: 100 }), AMOUNTS).at(-1), 'n/a')
})

test('such a value can still be filtered to', () => {
  assert.deepEqual(run(control({ bucket: 'band', bucketSize: 100 }), 'n/a').map((r) => r._row), [6])
})

// --- the shape of it ------------------------------------------------------

test('the editor is told which buckets need a number', () => {
  assert.equal(bucketNeeds('band'), 'size')
  assert.equal(bucketNeeds('prefix'), 'size')
  assert.equal(bucketNeeds('breaks'), 'breaks')
  assert.equal(bucketNeeds('year'), null)
  assert.equal(bucketNeeds('nonsense'), null)
})

test('no bucket is still no bucket', () => {
  assert.equal(valueBucket('x', ''), null)
  assert.equal(valueBucket('x', undefined), null)
  assert.equal(bucketedCell('  x  ', ''), 'x')
})

test('a bare grain string still works, as it did before there were options', () => {
  assert.equal(valueBucket('05/01/2026', 'year').label, '2026')
  assert.equal(bucketedCell('05/01/2026', 'year'), '2026')
})

// --- the same buckets, wherever a widget groups ---------------------------

import { groupRows, groupStacked, pivot, bucketConditions, groupKey } from './dataUtils.js'

const DEALS = [
  { _row: 2, Amount: '40', Region: 'West', Sold: '05/01/2026' },
  { _row: 3, Amount: '140', Region: 'West', Sold: '20/03/2026' },
  { _row: 4, Amount: '160', Region: 'East', Sold: '02/11/2025' },
  { _row: 5, Amount: '250', Region: 'East', Sold: '15/03/2025' },
]

const band = { bucket: 'band', bucketSize: 100 }

test('a chart groups by the bucket', () => {
  const out = groupRows(DEALS, { groupBy: 'Amount', bucket: band, sort: 'name_asc', limit: 0 })
  assert.deepEqual(out.map((d) => d.name), ['0 – 100', '100 – 200', '200 – 300'])
  assert.deepEqual(out.map((d) => d.value), [1, 2, 1])
})

test('bucketed groups sorted by name follow the bucket’s order', () => {
  // Not the text's: "1,000 – 1,100" would otherwise come before "200 – 300".
  const rows = [{ A: '1000' }, { A: '200' }]
  const out = groupRows(rows, { groupBy: 'A', bucket: band, sort: 'name_asc' })
  assert.deepEqual(out.map((d) => d.name), ['200 – 300', '1,000 – 1,100'])
})

test('a stacked chart can bucket both axes independently', () => {
  const { data, series } = groupStacked(DEALS, {
    groupBy: 'Region',
    stackBy: 'Amount',
    stackBucket: band,
    limit: 0,
  })
  assert.deepEqual(series.sort(), ['0 – 100', '100 – 200', '200 – 300'])
  assert.equal(data.find((d) => d.name === 'West')['100 – 200'], 1)
})

test('a pivot buckets each axis column on its own', () => {
  // "Region / Sold" wants the region as it is and the date by month; one
  // setting for the pair would force the wrong answer on one of them.
  const out = pivot(DEALS, {
    rowColumns: ['Region'],
    colColumns: ['Sold'],
    buckets: { Sold: { bucket: 'year' } },
  })
  assert.deepEqual(out.colLabels.sort(), ['2025', '2026'])
  assert.deepEqual(out.rowLabels.sort(), ['East', 'West'])
})

test('an unbucketed group is exactly what it always was', () => {
  const out = groupRows(DEALS, { groupBy: 'Region', sort: 'name_asc' })
  assert.deepEqual(out.map((d) => d.name), ['East', 'West'])
})

// --- clicking a bucketed bar ---------------------------------------------

test('a band drills to the range behind it, half open', () => {
  assert.deepEqual(bucketConditions('Amount', '100 – 200', band), [
    { column: 'Amount', operator: 'gte', value: '100' },
    { column: 'Amount', operator: 'lt', value: '200' },
  ])
})

test('the open ends of custom breakpoints drill too', () => {
  const spec = { bucket: 'breaks', bucketBreaks: '0, 100' }
  assert.deepEqual(bucketConditions('A', '< 0', spec), [{ column: 'A', operator: 'lt', value: '0', value2: undefined }])
  assert.deepEqual(bucketConditions('A', '100+', spec), [{ column: 'A', operator: 'gte', value: '100', value2: undefined }])
})

test('a year drills to that year’s dates', () => {
  assert.deepEqual(bucketConditions('Sold', '2026', 'year'), [
    { column: 'Sold', operator: 'date_between', value: '2026-01-01', value2: '2026-12-31' },
  ])
})

test('a quarter and a month know their own last day', () => {
  assert.equal(bucketConditions('D', '2026 Q1', 'quarter')[0].value2, '2026-03-31')
  assert.equal(bucketConditions('D', 'Feb 2024', 'month')[0].value2, '2024-02-29', 'a leap year, counted not assumed')
})

test('filled and sign drill to the obvious thing', () => {
  assert.equal(bucketConditions('A', 'Blank', 'filled')[0].operator, 'is_empty')
  assert.equal(bucketConditions('A', 'Filled', 'filled')[0].operator, 'is_not_empty')
  assert.equal(bucketConditions('A', 'Zero', 'sign')[0].operator, 'equals')
  assert.equal(bucketConditions('A', 'Negative', 'sign')[0].operator, 'lt')
})

test('a first letter drills, but "#" cannot and says so', () => {
  assert.deepEqual(bucketConditions('N', 'R', 'firstLetter'), [
    { column: 'N', operator: 'starts_with', value: 'R', value2: undefined },
  ])
  // "anything that is not a letter" is no single condition -- the caller
  // falls back to selecting the rows themselves.
  assert.equal(bucketConditions('N', '#', 'firstLetter'), null)
})

test('a bucket with no exact form returns nothing rather than something wrong', () => {
  assert.equal(bucketConditions('N', 'March', 'monthOfYear'), null)
  assert.equal(bucketConditions('N', 'Ravi', 'firstWord'), null)
  assert.equal(bucketConditions('N', 'MA3', { bucket: 'prefix' }), null)
  assert.equal(bucketConditions('N', 'x', ''), null)
})

test('grouping and drilling agree on what a row is', () => {
  // The pair that matters: whatever the bar grouped, the drill must select.
  for (const row of DEALS) {
    const label = groupKey(row, 'Amount', band)
    const conditions = bucketConditions('Amount', label, band)
    const lo = Number(conditions[0].value)
    const hi = Number(conditions[1].value)
    const n = Number(row.Amount)
    assert.ok(n >= lo && n < hi, `${n} should fall inside ${label}`)
  }
})
