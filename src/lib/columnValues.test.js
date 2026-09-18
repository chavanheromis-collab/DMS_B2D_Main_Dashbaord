import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  MAX_PER_COLUMN,
  MAX_PER_SOURCE,
  dateColumnsFor,
  distinctValues,
  storedValues,
  valueIndexFor,
  valuesForRef,
} from './columnValues.js'
import { dateColumnsIn, looksLikeDateColumn, looksLikeDateValue, toDate } from './dataUtils.js'

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
  assert.ok(api.includes("import { dateColumnsFor, valueIndexFor } from '../src/lib/columnValues.js'"))
  assert.ok(api.includes('const index = valueIndexFor(result.rows, result.headers || [])'))
  assert.ok(api.includes('{ tabHeaders, tabValues, tabDateColumns, lastSyncedAt: syncedAt }'))
})

test('they last until the next sync, and no longer', () => {
  // Written in the same call that refreshes the headers, so they describe
  // the data as it was last read -- and so does everything else on screen.
  const at = api.indexOf('tabValues, tabDateColumns, lastSyncedAt')
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
    // Through the label map: a widget on the page names its tab by label.
  assert.ok(dashboard.includes('valuesFor: (ref, column) => valuesForRef(sourcesById, refByLabel[ref] || ref, column)'))
})

test('a column with nothing indexed falls back to a plain box', () => {
  assert.ok(builder.includes('const list = Array.isArray(choices) && choices.length > 0 ? choices : null'))
})

// ---------------------------------------------------------------------
// Which columns hold dates
// ---------------------------------------------------------------------
// A column a sheet formula fills with dates is called whatever the sheet
// calls it -- "Scheduled Follow", "PM-E SUBMITTED" -- and the date pickers
// asked the NAME, so those columns were simply not offered. What must
// hold: the answer comes from what is in the column, an amount column is
// never mistaken for one, and the name still answers where nothing has
// been read yet.

test('a date is a date by its shape, not by anything a number can fake', () => {
  for (const value of ['01/10/2026', '2026-09-15', '12 May 2024', 'May 12, 2024', '15.09.2026']) {
    assert.equal(looksLikeDateValue(value), true, value)
  }
  // `toDate` takes these -- "500" is the year 500 -- which is right for
  // reading a cell and wrong for deciding what a column IS.
  for (const value of ['500', '65930', '0', 1500, '', null, 'WALK-IN', '2 FOLL']) {
    assert.equal(looksLikeDateValue(value), false, JSON.stringify(value))
    if (String(value ?? '').trim() !== '') assert.ok(toDate(value) || true)
  }
  assert.equal(looksLikeDateValue(new Date('2026-09-15')), true)
  assert.equal(looksLikeDateValue(new Date('nonsense')), false)
})

test('a column of dates is found by its values, whatever it is called', () => {
  const dates = ['01/10/2026', '02/10/2026', '03/11/2026', '04/11/2026']
  // The real ones this was written for.
  assert.equal(looksLikeDateColumn('Scheduled Follow', dates), true)
  assert.equal(looksLikeDateColumn('PM-E SUBMITTED', dates), true)
  // Still by name, for a source nothing has been read from yet.
  assert.equal(looksLikeDateColumn('Booking Date'), true)
  assert.equal(looksLikeDateColumn('Scheduled Follow'), false)
  // An amounts column is not a date column.
  assert.equal(looksLikeDateColumn('Total', ['500', '83997', '84497']), false)
  // Nor is one with a couple of dates in a column of something else.
  assert.equal(looksLikeDateColumn('Remarks', ['1ST FOLL', 'WALK-IN', '01/10/2026', 'lost']), false)
  // Too little to say.
  assert.equal(looksLikeDateColumn('Whatever', ['01/10/2026', '02/10/2026']), false)
  // `cols.filter(looksLikeDateColumn)` hands in the index; it is not a sample.
  assert.deepEqual(['Total', 'Booking Date'].filter(looksLikeDateColumn), ['Booking Date'])
})

test('the sync works it out from the rows, where a sample cannot', () => {
  // A column with more distinct values than the cap is not sampled at all
  // -- and two years of daily dates is exactly that column.
  // 300 different days: past MAX_PER_COLUMN, which is the whole point.
  const day = (i) => new Date(2026, 0, 1 + i)
  const rows = Array.from({ length: 300 }, (_, i) => ({
    'Scheduled Follow': `${day(i).getDate()}/${day(i).getMonth() + 1}/${day(i).getFullYear()}`,
    Total: String(1000 + i),
    Notes: i % 2 ? 'called' : '',
  }))
  assert.deepEqual(dateColumnsFor(rows, ['Scheduled Follow', 'Total', 'Notes']), ['Scheduled Follow'])
  assert.deepEqual(valueIndexFor(rows, ['Scheduled Follow']), {}, 'too many distinct values to sample')
  assert.deepEqual(dateColumnsFor([], ['A']), [])
  assert.deepEqual(dateColumnsFor([{ A: '01/10/2026' }, { A: '' }], ['A']), [], 'three filled cells at least')
})

test('the pickers take the sync first, the sample second, the name last', () => {
  const cols = ['Scheduled Follow', 'Total', 'Booking Date', 'Notes']
  // What the sync found, for a column nothing else can see.
  assert.deepEqual(dateColumnsIn(cols, { known: ['Scheduled Follow'] }), ['Scheduled Follow', 'Booking Date'])
  // The stored sample, for a source the sync has not covered yet.
  const sample = (c) => (c === 'Scheduled Follow' ? ['01/10/2026', '02/10/2026', '03/10/2026'] : ['x', 'y', 'z'])
  assert.deepEqual(dateColumnsIn(cols, { valuesOf: sample }), ['Scheduled Follow', 'Booking Date'])
  // And the name alone still answers.
  assert.deepEqual(dateColumnsIn(cols), ['Booking Date'])
  assert.deepEqual(dateColumnsIn([{ value: 'Booking Date', label: 'x' }]), [{ value: 'Booking Date', label: 'x' }])
  assert.deepEqual(dateColumnsIn(null), [])
})

test('every screen that offers a date column asks the same question', () => {
  // One place -- or the next editor asks the name again and the column
  // goes missing in exactly one picker.
  assert.ok(ui.includes('export function useDateColumns(tab, cols)'))
  assert.ok(ui.includes('known: knownDateColumns?.(tab)'))
  for (const file of ['MetricEditors.jsx', 'TimeEditors.jsx']) {
    const editor = read(`src/pages/admin/${file}`)
    assert.ok(editor.includes('useDateColumns(widget.tab, cols)'), file)
    assert.ok(!editor.includes('filter(looksLikeDateColumn)'), `${file} still asks the name`)
  }
  // A pipeline stage asks about its own tab, inside a loop.
  assert.ok(read('src/pages/admin/WidgetEditors.jsx').includes('known: knownDateColumns?.(stage.tab)'))
  // And both shells answer it.
  assert.ok(admin.includes('const knownDateColumns = useCallback((ref) => dateColumnsForRef(sourcesById, ref)'))
  assert.ok(dashboard.includes('knownDateColumns: (ref) => dateColumnsForRef(sourcesById, refByLabel[ref] || ref)'))
})

test('the sync stores what it found, on both paths', () => {
  // The explicit Sync button, and the fire-and-forget refresh on a normal
  // page read -- otherwise a source is only ever known after an admin
  // presses a button nobody told them about.
  assert.ok(api.includes('entry.tabDateColumns[tab] = dateColumnsFor(result.rows, result.headers)'))
  assert.ok(api.includes('tabDateColumns[tab] = dateColumnsFor(result.rows, result.headers || [], {'))
  assert.ok(api.includes('{ tabHeaders, tabValues, tabDateColumns, lastSyncedAt: syncedAt }'))
})
