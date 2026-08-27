import test from 'node:test'
import assert from 'node:assert/strict'

import { moverPeriods, moversData } from './movers.js'

const NOW = new Date(2026, 5, 15)
const ago = (n) => {
  const d = new Date(NOW.getTime() - n * 86400000)
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
}

const rows = (spec) =>
  spec.flatMap(([branch, days, n, amount = 10]) =>
    Array.from({ length: n }, () => ({ B: branch, D: ago(days), A: String(amount) }))
  )

const byDate = { groupBy: 'B', dateColumn: 'D', periodDays: 30, periodMode: 'date' }

// --- the two periods -----------------------------------------------------

test('the two windows are adjacent, equal and anchored on today', () => {
  const { now, before, span } = moverPeriods(rows([['X', 5, 2], ['X', 40, 3], ['X', 80, 4]]), byDate, 'DMY', NOW)
  assert.equal(span, 30)
  assert.equal(now.length, 2)
  assert.equal(before.length, 3)
  // The 80-day-old rows are in neither, and that is the point of a window.
})

test('conditions mode compares whatever two rules were written', () => {
  const { now, before } = moverPeriods(
    [{ B: 'X', S: 'Won' }, { B: 'X', S: 'Lost' }, { B: 'Y', S: 'Won' }],
    {
      periodMode: 'conditions',
      conditionsNow: [{ column: 'S', operator: 'equals', value: 'Won' }],
      conditionsBefore: [{ column: 'S', operator: 'equals', value: 'Lost' }],
    },
    'DMY',
    NOW
  )
  assert.equal(now.length, 2)
  assert.equal(before.length, 1)
})

// --- the defences against noise -----------------------------------------

test('the default ranking is absolute change, so tiny numbers cannot lead', () => {
  // A dealer going 1 -> 3 is up 200% and will out-rank 400 -> 480 every
  // week. That is arithmetic noise, not a finding.
  const data = moversData(
    { ...byDate, rank: 'abs_change', limit: 5 },
    { rows: rows([['Tiny', 40, 1], ['Tiny', 5, 3], ['Big', 40, 400], ['Big', 5, 480]]), dateOrder: 'DMY', today: NOW }
  )
  assert.equal(data.movers[0].name, 'Big')
  assert.equal(data.movers[0].change, 80)
})

test('the floor is checked against the larger side, so a collapse survives it', () => {
  // Checking the smaller side would drop exactly the groups that fell to
  // nothing, which are the most important movers on the list.
  const data = moversData(
    { ...byDate, minimum: 10 },
    { rows: rows([['Gone', 40, 50], ['Small', 40, 2], ['Small', 5, 3]]), dateOrder: 'DMY', today: NOW }
  )
  const names = data.movers.map((m) => m.name)
  assert.ok(names.includes('Gone'), '50 to nothing clears the floor on its "before" side')
  assert.ok(!names.includes('Small'), '2 to 3 does not clear it on either')
})

test('growing from nothing has no percentage', () => {
  const data = moversData(
    { ...byDate },
    { rows: rows([['New', 5, 7]]), dateOrder: 'DMY', today: NOW }
  )
  const mover = data.movers.find((m) => m.name === 'New')
  assert.equal(mover.percent, null, '"+∞%" is a rendering artefact, not a measurement')
  assert.equal(mover.isNew, true)
  assert.equal(mover.change, 7)
})

test('a value that disappeared is reported as gone', () => {
  const data = moversData({ ...byDate }, { rows: rows([['Old', 40, 6]]), dateOrder: 'DMY', today: NOW })
  const mover = data.movers.find((m) => m.name === 'Old')
  assert.equal(mover.isGone, true)
  assert.equal(mover.now, 0)
  assert.equal(mover.change, -6)
})

test('new and gone values can each be switched off', () => {
  const list = rows([['New', 5, 7], ['Old', 40, 6], ['Both', 40, 3], ['Both', 5, 5]])
  const without = moversData(
    { ...byDate, showNew: false, showGone: false },
    { rows: list, dateOrder: 'DMY', today: NOW }
  )
  assert.deepEqual(without.movers.map((m) => m.name), ['Both'])
})

// --- direction -----------------------------------------------------------

test('lower-is-better makes a fall the good news', () => {
  const list = rows([['X', 40, 10], ['X', 5, 4]])
  const normal = moversData({ ...byDate }, { rows: list, dateOrder: 'DMY', today: NOW })
  assert.equal(normal.movers[0].tone, 'bad')

  const inverted = moversData({ ...byDate, lowerIsBetter: true }, { rows: list, dateOrder: 'DMY', today: NOW })
  assert.equal(inverted.movers[0].tone, 'good')
})

test('the split view takes the top of EACH direction, not the top overall', () => {
  // In a good week a merged list shows nothing but gains, and "nothing
  // fell" becomes a claim the widget never checked.
  const list = rows([
    ['A', 40, 1], ['A', 5, 40],
    ['B', 40, 1], ['B', 5, 30],
    ['C', 40, 1], ['C', 5, 20],
    ['D', 40, 5], ['D', 5, 3],
  ])
  const data = moversData({ ...byDate, limit: 2 }, { rows: list, dateOrder: 'DMY', today: NOW })

  assert.equal(data.gains.length, 2)
  assert.equal(data.falls.length, 1)
  assert.equal(data.falls[0].name, 'D', 'the only faller is still visible')
})

test('bars are scaled against the biggest mover, not against each row', () => {
  const list = rows([['A', 40, 1], ['A', 5, 41], ['B', 40, 1], ['B', 5, 11]])
  const data = moversData({ ...byDate }, { rows: list, dateOrder: 'DMY', today: NOW })
  const a = data.movers.find((m) => m.name === 'A')
  const b = data.movers.find((m) => m.name === 'B')
  assert.equal(a.magnitude, 1)
  assert.equal(b.magnitude, 0.25)
})

// --- readiness -----------------------------------------------------------

test('no column to group by, and no date column, are both said out loud', () => {
  assert.equal(moversData({ groupBy: '' }, { rows: [] }).ready, false)
  assert.equal(moversData({ groupBy: 'B', periodMode: 'date', dateColumn: '' }, { rows: [] }).ready, false)
})

test('a sum is compared as a sum', () => {
  const data = moversData(
    { ...byDate, aggregation: 'sum', column: 'A' },
    { rows: rows([['X', 40, 2, 100], ['X', 5, 3, 100]]), dateOrder: 'DMY', today: NOW }
  )
  const mover = data.movers[0]
  assert.equal(mover.before, 200)
  assert.equal(mover.now, 300)
  assert.equal(mover.change, 100)
})
