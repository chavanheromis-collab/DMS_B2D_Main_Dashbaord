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
