import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  MAX_PER_COLUMN,
  MAX_PER_SOURCE,
  distinctValues,
  storedValues,
  valueIndexFor,
  valuesForRef,
} from './columnValues.js'

const ROWS = [
  { Stage: 'Pending', DSE: 'Ravi', Amount: '100' },
  { Stage: 'Done', DSE: 'Sunil', Amount: '200' },
  { Stage: 'Pending', DSE: 'Ravi ', Amount: '' },
  { Stage: '', DSE: 'Amit', Amount: '100' },
]

// ---------------------------------------------------------------------
// What is actually IN a column
// ---------------------------------------------------------------------

test('every distinct value, in the order a person reads them', () => {
  assert.deepEqual(distinctValues(ROWS, 'DSE').values, ['Amit', 'Ravi', 'Sunil'])
  assert.deepEqual(distinctValues(ROWS, 'Stage').values, ['Done', 'Pending'])
})

test('blanks are not values', () => {
  // "(blank)" is not something anybody types into a condition, and the
  // operators that care about emptiness have their own.
  assert.equal(distinctValues(ROWS, 'Stage').values.includes(''), false)
  assert.equal(distinctValues(ROWS, 'Amount').values.length, 2)
})

test('a stray trailing space is the same value', () => {
  // "Ravi " and "Ravi" are one name in a sheet and one entry here.
  assert.equal(distinctValues(ROWS, 'DSE').values.filter((v) => v.trim() === 'Ravi').length, 1)
})

test('numbers sort like numbers', () => {
  const rows = [{ n: '10' }, { n: '9' }, { n: '100' }]
  assert.deepEqual(distinctValues(rows, 'n').values, ['9', '10', '100'])
})

test('no column, no answer -- and no crash', () => {
  assert.deepEqual(distinctValues(ROWS, '').values, [])
  assert.deepEqual(distinctValues(null, 'DSE').values, [])
  assert.deepEqual(distinctValues(undefined, undefined).values, [])
})

test('a column with too many values is left OUT, not truncated', () => {
  // A list of the first two hundred VINs is worse than no list: it looks
  // complete, and the one being looked for is almost certainly not in it.
  const rows = Array.from({ length: MAX_PER_COLUMN + 50 }, (_, i) => ({ VIN: `V${i}`, Stage: i % 2 ? 'A' : 'B' }))
  const index = valueIndexFor(rows, ['VIN', 'Stage'])
  assert.equal(index.VIN, undefined)
  assert.deepEqual(index.Stage, ['A', 'B'])
})

test('the cap is reported, so a short list is never mistaken for a whole one', () => {
  const rows = Array.from({ length: MAX_PER_COLUMN + 5 }, (_, i) => ({ VIN: `V${i}` }))
  const out = distinctValues(rows, 'VIN')
  assert.equal(out.capped, true)
  assert.equal(out.values.length, MAX_PER_COLUMN)
  assert.ok(out.total > MAX_PER_COLUMN)
})

test('the whole source has a budget, because a document is 1MB', () => {
  // Twenty columns of two hundred values each is four thousand strings, and
  // a spreadsheet has more than twenty columns.
  const rows = Array.from({ length: 60 }, (_, r) => {
    const row = {}
    for (let c = 0; c < 200; c += 1) row[`c${c}`] = `v${r}`
    return row
  })
  const headers = Array.from({ length: 200 }, (_, c) => `c${c}`)
  const index = valueIndexFor(rows, headers)
  const stored = Object.values(index).reduce((n, v) => n + v.length, 0)
  assert.ok(stored <= MAX_PER_SOURCE, `${stored} values stored`)
  assert.ok(Object.keys(index).length > 0, 'and it still indexes what it can')
})

test('an empty column is not indexed at all', () => {
  assert.deepEqual(valueIndexFor([{ a: '', b: 'x' }], ['a', 'b']), { b: ['x'] })
})

// --- reading it back -----------------------------------------------------

test('nothing indexed is null, which is different from empty', () => {
  // Null means "offer a plain box"; an empty array would mean "this column
  // has no values", which is not a thing this ever stores.
  assert.equal(storedValues({ tabValues: {} }, 'MASTER', 'Stage'), null)
  assert.equal(storedValues(null, 'MASTER', 'Stage'), null)
  assert.equal(storedValues({ tabValues: { MASTER: { Stage: [] } } }, 'MASTER', 'Stage'), null)
  assert.deepEqual(storedValues({ tabValues: { MASTER: { Stage: ['A'] } } }, 'MASTER', 'Stage'), ['A'])
})

test('a ref is split the way the rest of the app splits one', () => {
  const sources = { s1: { tabValues: { MASTER: { Stage: ['A', 'B'] } } } }
  assert.deepEqual(valuesForRef(sources, 's1::MASTER', 'Stage'), ['A', 'B'])
  assert.equal(valuesForRef(sources, 'MASTER', 'Stage'), null, 'an unqualified ref is not a ref')
  assert.equal(valuesForRef(sources, 's1::OTHER', 'Stage'), null)
  assert.equal(valuesForRef({}, 's1::MASTER', 'Stage'), null)
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

const api = read('api/sheets.js')
const builder = read('src/pages/admin/ConditionBuilder.jsx')
const admin = read('src/pages/Admin.jsx')
const dashboard = read('src/pages/Dashboard.jsx')
const ui = read('src/pages/admin/ui.jsx')

test('the values are collected where the rows already are', () => {
  // During a sync, which has just read every tab: no extra call to Google.
  assert.ok(api.includes("import { valueIndexFor } from '../src/lib/columnValues.js'"))
  assert.ok(api.includes('const index = valueIndexFor(result.rows, result.headers || [])'))
  assert.ok(api.includes('{ tabHeaders, tabValues, lastSyncedAt: syncedAt }'))
})

test('they last until the next sync, and no longer', () => {
  // Written in the same call that refreshes the headers, so they describe
  // the data as it was last read -- and so does everything else on screen.
  const at = api.indexOf('tabValues, lastSyncedAt')
  assert.ok(at > 0)
  assert.ok(api.slice(0, at).includes('const syncedAt = new Date().toISOString()'))
})

test('the value box can be typed in OR picked from', () => {
  // A datalist, not a select: a condition may legitimately name a value
  // that is not in the column today, and a select would make that
  // impossible to express.
  assert.ok(builder.includes('<datalist id={listId}>'))
  assert.ok(builder.includes('list={list ? listId : undefined}'))
  assert.ok(ui.includes('list={list}'), 'and the field carries it through')
})

test('the list is EVERY value, narrowed by nothing', () => {
  // Somebody writing a rule is describing what the data CAN say, not what
  // it happens to be saying while they write.
  assert.ok(builder.includes('choices={valuesFor?.(cond.tab, cond.column)}'))
  const at = builder.indexOf('choices={valuesFor')
  assert.ok(!builder.slice(at, at + 200).includes('filter'))
})

test('it says how many there are', () => {
  assert.ok(builder.includes('`value (${list.length})`'))
})

test('both editors offer it -- the panel and the page', () => {
  assert.ok(admin.includes('const valuesFor = useCallback((ref, column) => valuesForRef(sourcesById, ref, column)'))
  assert.ok(dashboard.includes('valuesFor: (ref, column) => valuesForRef(sourcesById, ref, column)'))
})

test('a column with nothing indexed falls back to a plain box', () => {
  assert.ok(builder.includes('const list = Array.isArray(choices) && choices.length > 0 ? choices : null'))
})
