import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BLANK_TOKEN,
  activeFilterColumns,
  applyColumnFilters,
  columnIsFiltered,
  columnOptions,
  setAllOptions,
  toggleOption,
} from './columnFilters.js'
import { WIDTH_UNITS, widthUnitsFor, widthUnitsLabel } from './config.js'
import { spanForWidth } from './gridSpan.js'

const rows = [
  { Model: 'SPLENDOR +', SKU: 'A1', Stock: '159' },
  { Model: 'SPLENDOR +', SKU: 'A2', Stock: '63' },
  { Model: 'HF DELUXE', SKU: 'B1', Stock: '85' },
  { Model: 'HF DELUXE', SKU: 'B2', Stock: '12' },
  { Model: '', SKU: 'C1', Stock: '4' },
]

// --- the basics ---------------------------------------------------------

test('no filter means no filtering', () => {
  assert.equal(columnIsFiltered(undefined), false)
  assert.equal(columnIsFiltered({ exclude: [], text: '' }), false)
  assert.equal(applyColumnFilters(rows, {}).length, 5)
  assert.deepEqual(activeFilterColumns({ Model: { exclude: [] } }), [])
})

test('excluding a value removes exactly its rows', () => {
  const out = applyColumnFilters(rows, { Model: { exclude: ['HF DELUXE'] } })
  assert.equal(out.length, 3)
  assert.ok(out.every((r) => r.Model !== 'HF DELUXE'))
})

test('filters on different columns combine', () => {
  const out = applyColumnFilters(rows, {
    Model: { exclude: ['HF DELUXE'] },
    SKU: { exclude: ['A2'] },
  })
  assert.deepEqual(out.map((r) => r.SKU), ['A1', 'C1'])
})

test('blanks are a filterable value in their own right', () => {
  const out = applyColumnFilters(rows, { Model: { exclude: [BLANK_TOKEN] } })
  assert.equal(out.length, 4)
  assert.ok(out.every((r) => r.Model !== ''))
})

// --- why exclude rather than include ------------------------------------

test('a value added later is shown, not silently hidden', () => {
  // The reason filters store what is EXCLUDED: with an include list, a row
  // whose value did not exist when the filter was set would vanish.
  const filters = { Model: { exclude: ['HF DELUXE'] } }
  const grown = [...rows, { Model: 'PASSION +', SKU: 'D1', Stock: '9' }]
  assert.ok(applyColumnFilters(grown, filters).some((r) => r.Model === 'PASSION +'))
})

// --- the text box -------------------------------------------------------

test('the text box matches on substring, case-insensitively', () => {
  assert.equal(applyColumnFilters(rows, { Model: { text: 'splen' } }).length, 2)
  assert.equal(applyColumnFilters(rows, { Model: { text: 'SPLEN' } }).length, 2)
})

test('a leading comparison operator makes it a numeric test', () => {
  // Matching ">100" as literal text would never find anything, so typing it
  // is taken as the numeric comparison it obviously is.
  assert.deepEqual(applyColumnFilters(rows, { Stock: { text: '>100' } }).map((r) => r.SKU), ['A1'])
  assert.equal(applyColumnFilters(rows, { Stock: { text: '>=63' } }).length, 3)
  assert.equal(applyColumnFilters(rows, { Stock: { text: '<20' } }).length, 2)
  assert.deepEqual(applyColumnFilters(rows, { Stock: { text: '=85' } }).map((r) => r.SKU), ['B1'])
})

test('a numeric test skips rows with no number rather than counting them', () => {
  const mixed = [{ V: '10' }, { V: 'n/a' }, { V: '' }]
  assert.equal(applyColumnFilters(mixed, { V: { text: '>5' } }).length, 1)
})

test('text and exclusions stack on the same column', () => {
  const out = applyColumnFilters(rows, { Model: { exclude: ['HF DELUXE'], text: 'splen' } })
  assert.equal(out.length, 2)
})

// --- the options a menu offers ------------------------------------------

test('options are the values present, with counts, blanks last', () => {
  const options = columnOptions(rows, 'Model', {})
  assert.deepEqual(options.map((o) => o.label), ['HF DELUXE', 'SPLENDOR +', '(blank)'])
  assert.equal(options.find((o) => o.label === 'SPLENDOR +').count, 2)
  assert.ok(options.every((o) => o.selected), 'everything is ticked until something is unticked')
})

test("a column's options respect the OTHER columns' filters", () => {
  // Excel's behaviour, and the part that is easy to get wrong: filtering
  // Model to Splendor must leave the SKU menu offering Splendor SKUs only,
  // or you are choosing between options that would return nothing.
  const options = columnOptions(rows, 'SKU', { Model: { exclude: ['HF DELUXE', BLANK_TOKEN] } })
  assert.deepEqual(options.map((o) => o.label), ['A1', 'A2'])
})

test("a column's own filter never narrows its own options", () => {
  // Otherwise unticking a value would remove it from the list and there
  // would be no way to tick it back on.
  const options = columnOptions(rows, 'Model', { Model: { exclude: ['HF DELUXE'] } })
  assert.equal(options.length, 3)
  assert.equal(options.find((o) => o.label === 'HF DELUXE').selected, false)
})

// --- toggling -----------------------------------------------------------

test('toggling flips one value on and off', () => {
  const options = columnOptions(rows, 'Model', {})
  const off = toggleOption({}, 'SPLENDOR +', options)
  assert.deepEqual(off.exclude, ['SPLENDOR +'])
  assert.deepEqual(toggleOption(off, 'SPLENDOR +', options).exclude, [])
})

test('unticking the last visible value clears the filter instead of emptying the table', () => {
  // An empty table with every box unticked is a dead end -- there is nothing
  // left to click to get back.
  const options = columnOptions(rows, 'Model', {})
  let filter = {}
  for (const option of options) filter = toggleOption(filter, option.key, options)
  assert.deepEqual(filter.exclude, [])
})

test('deselecting the shown values leaves other exclusions alone', () => {
  // With a search active, "deselect shown" must add only those and must not
  // wipe exclusions the search is hiding. The menu passes the FULL option
  // list as the fourth argument so the dead-end check is judged against
  // every value, not just the visible subset.
  const all = columnOptions(rows, 'Model', {})
  const justOne = all.filter((o) => o.label === 'SPLENDOR +')

  const filter = setAllOptions({ exclude: ['HF DELUXE'] }, justOne, false, all)
  assert.ok(filter.exclude.includes('HF DELUXE'), 'the hidden exclusion survives')
  assert.ok(filter.exclude.includes('SPLENDOR +'))
  assert.equal(filter.exclude.length, 2)
})

test('excluding every value really does clear, rather than emptying the table', () => {
  const all = columnOptions(rows, 'Model', {})
  const filter = setAllOptions({}, all, false, all)
  assert.deepEqual(filter.exclude, [])
})

test('unticking the last SEARCH result does not wipe unrelated exclusions', () => {
  // The bug this guards: judging "everything is excluded" from the visible
  // subset meant unticking one search result cleared the whole column.
  const all = columnOptions(rows, 'Model', {})
  const justOne = all.filter((o) => o.label === 'SPLENDOR +')

  const filter = toggleOption({ exclude: ['HF DELUXE'] }, 'SPLENDOR +', justOne, all)
  assert.equal(filter.exclude.length, 2)
})

// --- widget width -------------------------------------------------------

test('a widget with no exact span falls back to its named preset', () => {
  assert.equal(widthUnitsFor({ width: 'quarter' }), 3)
  assert.equal(widthUnitsFor({ width: 'half' }), 6)
  assert.equal(widthUnitsFor({ width: 'full' }), 12)
  assert.equal(widthUnitsFor({}), 12)
})

test('an exact span wins over the preset and is clamped', () => {
  assert.equal(widthUnitsFor({ width: 'full', widthUnits: 2 }), 2)
  assert.equal(widthUnitsFor({ widthUnits: 99 }), WIDTH_UNITS)
  assert.equal(widthUnitsFor({ widthUnits: 0 }), 12, 'zero is not a width')
})

test('spans read back as fractions people recognise', () => {
  assert.equal(widthUnitsLabel(12), 'Full width')
  assert.equal(widthUnitsLabel(6), '1/2')
  assert.equal(widthUnitsLabel(4), '1/3')
  assert.equal(widthUnitsLabel(3), '1/4')
  assert.equal(widthUnitsLabel(2), '1/6')
  assert.equal(widthUnitsLabel(8), '2/3')
  assert.equal(widthUnitsLabel(5), '5/12')
})

test('an exact span still goes full width on a phone', () => {
  // A 2-unit widget held at 2 units on a 360px screen would be an
  // unreadable sliver.
  assert.equal(spanForWidth(null, 'lg', 3), 3)
  assert.equal(spanForWidth(null, 'md', 3), 6)
  assert.equal(spanForWidth(null, 'base', 3), 12)
  // A widget already half the canvas doesn't double past full width.
  assert.equal(spanForWidth(null, 'md', 8), 12)
})

test('without an exact span the named presets behave as before', () => {
  assert.equal(spanForWidth('quarter', 'lg'), 3)
  assert.equal(spanForWidth('quarter', 'base'), 12)
  assert.equal(spanForWidth('full', 'lg'), 12)
})
