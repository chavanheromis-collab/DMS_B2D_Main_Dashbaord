import test from 'node:test'
import assert from 'node:assert/strict'

import { blendRows } from './blend.js'
import { groupRows } from './dataUtils.js'

const STOCK = [
  { VIN: 'V1', Model: 'SPLENDOR +', 'Default Yard': 'Main Store' },
  { VIN: 'V2', Model: 'HF DELUXE', 'Default Yard': 'Main Store' },
  { VIN: 'V3', Model: 'PASSION +', 'Default Yard': '' },
]

const YARD = [
  { 'Chassis No': 'V1', Location: 'Pune Yard' },
  // V2 matched but its Location cell is empty -- looks identical on screen
  // to no match at all, and must be handled the same way.
  { 'Chassis No': 'V2', Location: '' },
  // V3 has no row here at all.
]

const base = {
  enabled: true,
  ref: 'yard',
  leftKey: 'VIN',
  rightKey: 'Chassis No',
  prefix: 'Yard.',
  columns: ['Location'],
}

const headers = ['Chassis No', 'Location']
const blend = (extra) => blendRows(STOCK, YARD, { ...base, ...extra }, headers)
const locations = (rows) => rows.map((r) => r['Yard.Location'])

test('without a fallback both kinds of gap stay blank', () => {
  assert.deepEqual(locations(blend()), ['Pune Yard', '', ''])
})

test('a fallback fills from a column on the widget’s own tab', () => {
  const out = blend({ fallbacks: [{ column: 'Location', from: 'Default Yard' }] })
  assert.deepEqual(locations(out), ['Pune Yard', 'Main Store', ''])
})

test('the literal catches what the column could not', () => {
  // V3's own Default Yard is empty too, so it falls through to the text.
  const out = blend({ fallbacks: [{ column: 'Location', from: 'Default Yard', text: 'Not allocated' }] })
  assert.deepEqual(locations(out), ['Pune Yard', 'Main Store', 'Not allocated'])
})

test('the literal works on its own, with no column chosen', () => {
  const out = blend({ fallbacks: [{ column: 'Location', text: 'Not allocated' }] })
  assert.deepEqual(locations(out), ['Pune Yard', 'Not allocated', 'Not allocated'])
})

test('a real value is never overwritten', () => {
  const out = blend({ fallbacks: [{ column: 'Location', from: 'Default Yard', text: 'Not allocated' }] })
  assert.equal(out[0]['Yard.Location'], 'Pune Yard')
})

test('a fallback names ONE column and leaves the others alone', () => {
  const withRule = blendRows(
    STOCK,
    [{ 'Chassis No': 'V1', Location: '', Days: '' }],
    { ...base, columns: ['Location', 'Days'], fallbacks: [{ column: 'Location', text: 'X' }] },
    ['Chassis No', 'Location', 'Days']
  )
  assert.equal(withRule[0]['Yard.Location'], 'X')
  assert.equal(withRule[0]['Yard.Days'], '', 'Days had no rule, so it stays blank')
})

test('the match count still tells the truth', () => {
  // A fallback fills the display, but it must not pretend a match happened.
  const out = blend({ fallbacks: [{ column: 'Location', text: 'Not allocated' }] })
  assert.equal(out.find((r) => r.VIN === 'V3')['Yard.Match count'], 0)
  assert.equal(out.find((r) => r.VIN === 'V1')['Yard.Match count'], 1)
})

test('fallbacks reach the expand join too', () => {
  const out = blendRows(
    STOCK,
    [{ 'Chassis No': 'V1', Location: '' }],
    { ...base, type: 'expand', fallbacks: [{ column: 'Location', from: 'Default Yard' }] },
    headers
  )
  assert.equal(out.length, 1)
  assert.equal(out[0]['Yard.Location'], 'Main Store')
})

test('an inner join drops unmatched rows before a fallback can reach them', () => {
  // Worth asserting because it is the one case where a fallback appears not
  // to work -- the row is already gone.
  const out = blendRows(STOCK, YARD, { ...base, type: 'inner', fallbacks: [{ column: 'Location', text: 'X' }] }, headers)
  assert.deepEqual(out.map((r) => r.VIN), ['V1', 'V2'])
  assert.equal(out.find((r) => r.VIN === 'V2')['Yard.Location'], 'X', 'a matched-but-blank cell still falls back')
})

// --- the reason this matters --------------------------------------------

test('without a fallback, a chart silently loses rows', () => {
  const chart = groupRows(blend(), { groupBy: 'Yard.Location', aggregation: 'count' })
  const plotted = chart.reduce((sum, d) => sum + d.value, 0)
  assert.equal(plotted, 1, 'two of three vehicles vanish -- grouping skips blanks')
})

test('with a fallback the chart adds up again', () => {
  const out = blend({ fallbacks: [{ column: 'Location', from: 'Default Yard', text: 'Not allocated' }] })
  const chart = groupRows(out, { groupBy: 'Yard.Location', aggregation: 'count' })
  const plotted = chart.reduce((sum, d) => sum + d.value, 0)
  assert.equal(plotted, STOCK.length)
  assert.deepEqual(
    chart.map((d) => d.name).sort(),
    ['Main Store', 'Not allocated', 'Pune Yard']
  )
})
