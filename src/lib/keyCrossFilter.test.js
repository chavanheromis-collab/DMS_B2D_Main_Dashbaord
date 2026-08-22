import test from 'node:test'
import assert from 'node:assert/strict'

import { applyFilters } from './filterEngine.js'
import { blendRows, normalizeKey } from './blend.js'

// The VIN / yard example, end to end.
const STOCK = [
  { VIN: 'MA3ABC001', Model: 'SPLENDOR +' },
  { VIN: 'MA3ABC002', Model: 'SPLENDOR +' },
  { VIN: 'MA3ABC003', Model: 'HF DELUXE' },
  { VIN: 'MA3ABC004', Model: 'HF DELUXE' },
  { VIN: 'MA3ABC005', Model: 'PASSION +' },
]

const YARD = [
  { 'Chassis No': 'MA3ABC001', Location: 'Pune Yard' },
  { 'Chassis No': 'MA3ABC002', Location: 'Pune Yard' },
  { 'Chassis No': 'MA3ABC003', Location: 'Nashik Yard' },
  { 'Chassis No': 'MA3ABC004', Location: 'Showroom' },
]

// A third tab that shares the VIN column but knows nothing about the blend.
const SERVICE = [
  { VIN: 'MA3ABC001', Job: 'PDI' },
  { VIN: 'MA3ABC003', Job: 'Repair' },
  { VIN: 'MA3ABC005', Job: 'PDI' },
]

const blend = { enabled: true, ref: 'yard', leftKey: 'VIN', rightKey: 'Chassis No', prefix: 'Yard.' }

/** The key filter the dashboard builds when a blended bar is clicked. */
function drillOnBlendedColumn(value) {
  const blended = blendRows(STOCK, YARD, blend, ['Chassis No', 'Location'])
  const keys = Array.from(
    new Set(
      blended
        .filter((r) => String(r['Yard.Location'] ?? '').trim() === value)
        .map((r) => normalizeKey(r.VIN))
        .filter((k) => k !== null)
    )
  )
  return {
    id: 'chart_1',
    kind: 'keys',
    value,
    keys,
    keyColumns: [
      { tab: 'STOCK', column: 'VIN' },
      { tab: 'YARD', column: 'Chassis No' },
    ],
    keyNames: ['VIN', 'Chassis No'],
  }
}

const run = (rows, tab, cf) => applyFilters(rows, { tab, crossFilters: [cf] })

test('the blend produces the column the chart groups by', () => {
  const blended = blendRows(STOCK, YARD, blend, ['Chassis No', 'Location'])
  assert.equal(blended.length, 5)
  assert.equal(blended.find((r) => r.VIN === 'MA3ABC001')['Yard.Location'], 'Pune Yard')
  // The unmatched vehicle survives a left join with a blank location.
  assert.equal(blended.find((r) => r.VIN === 'MA3ABC005')['Yard.Location'], '')
})

test('drilling a blended column resolves to the join keys', () => {
  const cf = drillOnBlendedColumn('Pune Yard')
  assert.equal(cf.keys.length, 2)
  assert.deepEqual(cf.keys, [normalizeKey('MA3ABC001'), normalizeKey('MA3ABC002')])
})

test('the LEFT tab narrows to those keys', () => {
  // The bug this fixes: filtering raw STOCK rows by "Yard.Location" found a
  // column that isn't there and emptied every widget on the page.
  const out = run(STOCK, 'STOCK', drillOnBlendedColumn('Pune Yard'))
  assert.deepEqual(out.map((r) => r.VIN), ['MA3ABC001', 'MA3ABC002'])
})

test('the RIGHT tab narrows too, on its own differently-named key', () => {
  const out = run(YARD, 'YARD', drillOnBlendedColumn('Pune Yard'))
  assert.deepEqual(out.map((r) => r['Chassis No']), ['MA3ABC001', 'MA3ABC002'])
})

test('a third tab sharing the key column name narrows as well', () => {
  // This is what carries the drill to widgets nowhere near the blend.
  const out = run(SERVICE, 'SERVICE', drillOnBlendedColumn('Pune Yard'))
  assert.deepEqual(out.map((r) => r.VIN), ['MA3ABC001'])
})

test('a tab with no matching key column is left completely alone', () => {
  // Silence, not an empty table -- the same rule every other filter follows.
  const reviews = [{ Reviewer: 'A' }, { Reviewer: 'B' }]
  assert.equal(run(reviews, 'REVIEWS', drillOnBlendedColumn('Pune Yard')).length, 2)
})

test('a drill matching nothing empties the tabs it applies to, not the others', () => {
  const cf = drillOnBlendedColumn('Nowhere')
  assert.equal(cf.keys.length, 0)
  assert.equal(run(STOCK, 'STOCK', cf).length, 0)
  // ...but a tab it cannot address is still untouched.
  assert.equal(run([{ Reviewer: 'A' }], 'REVIEWS', cf).length, 1)
})

test('keys match despite case and padding, as the blend itself does', () => {
  const messy = [{ VIN: ' ma3abc001 ' }, { VIN: 'MA3ABC009' }]
  const out = run(messy, 'SERVICE', drillOnBlendedColumn('Pune Yard'))
  assert.equal(out.length, 1)
})

test('the explicit pair beats a same-named column', () => {
  // YARD happens to have no VIN column, but if it did, the pair the blend
  // stated must still win -- it is the one the admin actually declared.
  const cf = drillOnBlendedColumn('Showroom')
  const yardWithVin = YARD.map((r) => ({ ...r, VIN: 'DIFFERENT' }))
  const out = run(yardWithVin, 'YARD', cf)
  assert.deepEqual(out.map((r) => r['Chassis No']), ['MA3ABC004'])
})

test('a key drill stacks with an ordinary filter rather than replacing it', () => {
  const out = applyFilters(STOCK, {
    tab: 'STOCK',
    crossFilters: [drillOnBlendedColumn('Pune Yard')],
    filters: [{ id: 'f1', kind: 'select', tab: 'STOCK', column: 'Model' }],
    values: { f1: 'SPLENDOR +' },
  })
  assert.equal(out.length, 2)

  const none = applyFilters(STOCK, {
    tab: 'STOCK',
    crossFilters: [drillOnBlendedColumn('Pune Yard')],
    filters: [{ id: 'f1', kind: 'select', tab: 'STOCK', column: 'Model' }],
    values: { f1: 'HF DELUXE' },
  })
  assert.equal(none.length, 0, 'Pune Yard holds no HF DELUXE')
})

test('unblended drills are untouched by any of this', () => {
  const plain = { id: 'c1', kind: 'value', tab: 'STOCK', column: 'Model', value: 'HF DELUXE' }
  assert.equal(run(STOCK, 'STOCK', plain).length, 2)
  assert.equal(run(SERVICE, 'SERVICE', plain).length, 3, 'and it still only touches its own tab')
})
