import test from 'node:test'
import assert from 'node:assert/strict'

import { apportion, waffleData } from './waffleData.js'

const rows = (spec) => spec.flatMap(([name, n]) => Array.from({ length: n }, () => ({ S: name, Amount: '10' })))

// --- the arithmetic that makes a waffle trustworthy ----------------------

test('the squares always add up to the grid', () => {
  // Naive rounding of five shares to a hundred squares routinely produces
  // 99 or 101, and a waffle that does not fill its own grid is a waffle
  // nobody believes.
  const awkward = [
    [1, 1, 1],
    [33, 33, 34],
    [17, 23, 41, 19],
    [1, 1, 1, 1, 1, 1, 1],
    [99, 1],
    [2, 3, 5, 7, 11, 13],
  ]
  for (const values of awkward) {
    for (const total of [25, 50, 100, 144]) {
      const cells = apportion(values, total)
      assert.equal(cells.reduce((a, b) => a + b, 0), total, `${values} into ${total}`)
    }
  }
})

test('the leftover squares go to whoever the rounding robbed most', () => {
  // Three equal thirds of 100: two get 33 and one gets 34, never 33/33/33.
  const cells = apportion([1, 1, 1], 100)
  assert.deepEqual([...cells].sort(), [33, 33, 34])
})

test('a share with nothing in it gets nothing', () => {
  assert.deepEqual(apportion([0, 0, 0], 100), [0, 0, 0])
  assert.deepEqual(apportion([10, 0], 10), [10, 0])
})

test('a grid bigger than the slice count still fills', () => {
  const cells = apportion([1, 1], 100)
  assert.equal(cells.reduce((a, b) => a + b, 0), 100)
})

// --- the chart -----------------------------------------------------------

test('no column to split by means nothing to draw', () => {
  assert.equal(waffleData({ groupBy: '' }, { rows: rows([['A', 3]]) }).ready, false)
})

test('overflow merges rather than vanishing, so the total stays honest', () => {
  const spec = Array.from({ length: 12 }, (_, i) => [`S${i}`, 12 - i])
  const total = spec.reduce((a, s) => a + s[1], 0)
  const data = waffleData({ groupBy: 'S', maxSlices: 4 }, { rows: rows(spec) })

  assert.equal(data.slices.length, 4)
  assert.equal(data.total, total, 'the merged slice carries its full weight')
  assert.equal(data.slices.reduce((a, s) => a + s.value, 0), total)
  assert.ok(data.slices[3].isOther)
  assert.equal(data.slices[3].merged, 9)
})

test('shares are of everything, not of what survived the cut', () => {
  const data = waffleData({ groupBy: 'S', maxSlices: 2 }, { rows: rows([['A', 50], ['B', 30], ['C', 20]]) })
  assert.equal(Math.round(data.slices[0].share), 50, 'A is half of everything, not five-eighths of the top two')
})

test('every cell in the grid is accounted for', () => {
  const data = waffleData({ groupBy: 'S', cells: 100, columns: 10 }, { rows: rows([['A', 7], ['B', 3]]) })
  assert.equal(data.cells.length, 100)
  assert.equal(data.cells.filter((c) => c.slice).length, 100, 'no unassigned holes when the shares are whole')
  assert.equal(data.rows, 10)
})

test('one square is worth the total divided by the grid, and the card says so', () => {
  const data = waffleData({ groupBy: 'S', cells: 50 }, { rows: rows([['A', 100]]) })
  assert.equal(data.perCell, 2, 'a waffle without this is a proportion with its units filed off')
})

test('filling across and filling down place the same cells differently', () => {
  const spec = [['A', 1]]
  const across = waffleData({ groupBy: 'S', cells: 20, columns: 5, direction: 'row' }, { rows: rows(spec) })
  const down = waffleData({ groupBy: 'S', cells: 20, columns: 5, direction: 'column' }, { rows: rows(spec) })

  assert.deepEqual(
    across.cells.slice(0, 6).map((c) => [c.row, c.col]),
    [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 0]]
  )
  assert.deepEqual(
    down.cells.slice(0, 5).map((c) => [c.row, c.col]),
    [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1]]
  )
})

test('a blank cell is a named slice, not a dropped row', () => {
  const data = waffleData({ groupBy: 'S' }, { rows: [{ S: '' }, { S: 'A' }] })
  assert.ok(data.slices.some((s) => s.name === '(blank)'))
  assert.equal(data.total, 2)
})

test('the grid is clamped to something a card can hold', () => {
  const data = waffleData({ groupBy: 'S', cells: 99999, columns: 999 }, { rows: rows([['A', 5]]) })
  assert.ok(data.cellCount <= 400)
  assert.ok(data.columns <= 40)
})
