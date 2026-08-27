import test from 'node:test'
import assert from 'node:assert/strict'

import { bandEdges, bandOf, bulletRow, bulletRows } from './bullet.js'

const rows = (n, amount = 10) => Array.from({ length: n }, (_, i) => ({ _row: i + 2, Amount: String(amount), S: i % 2 ? 'Won' : 'Lost' }))

// --- the bands -----------------------------------------------------------

test('percentage bands follow the target when the target moves', () => {
  assert.deepEqual(bandEdges({ bandMode: 'percent', poorAt: 60, goodAt: 90 }, 100), [60, 90])
  assert.deepEqual(bandEdges({ bandMode: 'percent', poorAt: 60, goodAt: 90 }, 200), [120, 180])
})

test('absolute bands do not', () => {
  assert.deepEqual(bandEdges({ bandMode: 'absolute', poorAt: 60, goodAt: 90 }, 500), [60, 90])
})

test('bands typed the wrong way round are drawn in the order that can exist', () => {
  // An admin who puts "poor" above "good" has made a typo. Drawing a chart
  // where poor is better than good is not the honest response to it.
  assert.deepEqual(bandEdges({ bandMode: 'absolute', poorAt: 90, goodAt: 60 }, 100), [60, 90])
})

test('a value lands in exactly one band', () => {
  const edges = [60, 90]
  assert.equal(bandOf(10, edges), 'poor')
  assert.equal(bandOf(59.9, edges), 'poor')
  assert.equal(bandOf(60, edges), 'fair', 'the edge belongs upwards, so nothing lands in two')
  assert.equal(bandOf(89.9, edges), 'fair')
  assert.equal(bandOf(90, edges), 'good')
})

test('lower-is-better flips which end is the good news, not where the bands sit', () => {
  const edges = [60, 90]
  assert.equal(bandOf(10, edges, true), 'good', 'a low number is the point')
  assert.equal(bandOf(95, edges, true), 'poor')
  assert.equal(bandOf(70, edges, true), 'fair', 'the middle is the middle either way')
})

// --- geometry ------------------------------------------------------------

test('the three bands tile the axis exactly', () => {
  const line = bulletRow(
    { label: 'X', aggregation: 'count', target: 100 },
    { rows: rows(80), config: { bandMode: 'percent', poorAt: 60, goodAt: 90 } }
  )
  const total = line.bands.reduce((a, b) => a + b.width, 0)
  assert.equal(total.toFixed(6), '1.000000', 'a rounding gap would show as a hairline of card')
  assert.ok(line.bands.every((b) => b.width >= 0), 'no band is drawn backwards')
})

test('the axis always holds the biggest thing on the line', () => {
  // An overshoot pinned to the right edge cannot be SEEN to be an
  // overshoot, which is the outcome everybody most wants to look at.
  const line = bulletRow({ label: 'X', aggregation: 'count', target: 10 }, { rows: rows(40), config: { headroom: 15 } })
  assert.ok(line.ceiling > 40)
  assert.ok(line.valueFraction < 1, 'the bar stops short of the edge')
  assert.ok(line.targetFraction < line.valueFraction)
  assert.equal(Math.round(line.attainment), 400)
})

test('a target of zero produces no attainment rather than an infinity', () => {
  const line = bulletRow({ label: 'X', aggregation: 'count', target: 0 }, { rows: rows(5) })
  assert.equal(line.attainment, null)
  assert.ok(Number.isFinite(line.ceiling) && line.ceiling > 0, 'the axis is still drawable')
})

test('everything at zero still yields a drawable axis', () => {
  const line = bulletRow({ label: 'X', aggregation: 'count', target: 0 }, { rows: [] })
  assert.equal(line.ceiling, 1)
  assert.equal(line.valueFraction, 0)
  assert.ok(line.bands.every((b) => Number.isFinite(b.width)))
})

// --- measured targets ----------------------------------------------------

test('a measured target is counted over its own rows', () => {
  const list = rows(10)
  const line = bulletRow(
    {
      label: 'Won vs all',
      aggregation: 'count',
      match: 'all',
      conditions: [{ column: 'S', operator: 'equals', value: 'Won' }],
      targetMode: 'measured',
      targetAggregation: 'count',
      targetConditions: [],
    },
    { rows: list }
  )
  assert.equal(line.value, 5, 'the measure obeys its own rule')
  assert.equal(line.target, 10, 'the target obeys its own, which here is “everything”')
})

// --- the list ------------------------------------------------------------

test('a chart with no metrics still draws one', () => {
  const lines = bulletRows({ rows: [] }, { rows: rows(7) })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].value, 7)
})

test('every line shares the band configuration but keeps its own target', () => {
  const lines = bulletRows(
    {
      poorAt: 50,
      goodAt: 80,
      rows: [
        { id: 'a', label: 'A', aggregation: 'count', target: 10 },
        { id: 'b', label: 'B', aggregation: 'count', target: 100 },
      ],
    },
    { rows: rows(9) }
  )
  assert.equal(lines[0].band, 'good', '9 of 10 is 90%')
  assert.equal(lines[1].band, 'poor', '9 of 100 is 9%')
})
