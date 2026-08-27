import test from 'node:test'
import assert from 'node:assert/strict'

import { boxStats, boxplotData } from './boxplot.js'

const rows = (values, group = 'All') => values.map((v, i) => ({ _row: i + 2, V: String(v), G: group }))

// --- the five numbers ----------------------------------------------------

test('the quartiles of a plain run are the plain answers', () => {
  const s = boxStats([1, 2, 3, 4, 5])
  assert.equal(s.min, 1)
  assert.equal(s.median, 3)
  assert.equal(s.max, 5)
  assert.equal(s.q1, 2)
  assert.equal(s.q3, 4)
  assert.equal(s.count, 5)
})

test('one value is its own everything', () => {
  const s = boxStats([7])
  assert.equal(s.median, 7)
  assert.equal(s.q1, 7)
  assert.equal(s.q3, 7)
  assert.equal(s.iqr, 0)
  assert.equal(s.outliers.length, 0)
})

test('nothing at all is null rather than a box of zeroes', () => {
  assert.equal(boxStats([]), null)
  assert.equal(boxStats(null), null)
})

test('the input need not be sorted', () => {
  assert.deepEqual(
    [boxStats([5, 1, 3, 2, 4]).median, boxStats([5, 1, 3, 2, 4]).min],
    [3, 1]
  )
})

// --- Tukey's rule, which is the whole point ------------------------------

test('a whisker stops at a value something actually reached', () => {
  // The common mistake is to draw the whisker to q1 - 1.5*IQR itself, which
  // is a number no row ever hit -- a whisker pointing at nothing.
  const s = boxStats([10, 11, 12, 13, 14, 15, 100])
  assert.ok(s.whiskerHigh < 100, 'the outlier is outside the fence')
  assert.ok([10, 11, 12, 13, 14, 15].includes(s.whiskerHigh), 'and the whisker lands on a real observation')
  assert.deepEqual(s.outliers, [100])
})

test('a tight distribution has no outliers and whiskers at the true extremes', () => {
  const s = boxStats([10, 10, 11, 11, 12, 12])
  assert.equal(s.outliers.length, 0)
  assert.equal(s.whiskerLow, 10)
  assert.equal(s.whiskerHigh, 12)
})

test('outliers are found at both ends', () => {
  const s = boxStats([-500, 10, 11, 12, 13, 14, 15, 900])
  assert.equal(s.outliers.length, 2)
  assert.ok(s.outliers.includes(-500) && s.outliers.includes(900))
})

test('skew says which way the tail runs', () => {
  const right = boxStats([1, 2, 3, 4, 100])
  assert.ok(right.skew > 0, 'a long right tail is what makes the average misleading')
  assert.equal(right.median, 3)
  assert.equal(right.mean, 22, 'and here is the average it makes misleading')

  const left = boxStats([-100, 10, 11, 12, 13])
  assert.ok(left.skew < 0)

  const symmetric = boxStats([1, 2, 3, 4, 5])
  assert.equal(symmetric.skew, 0)
})

test('skew survives a column whose middle is perfectly flat', () => {
  // Every middle value identical means an interquartile range of zero, and
  // dividing by it would produce Infinity on a chart.
  const s = boxStats([10, 10, 10, 10, 900])
  assert.ok(Number.isFinite(s.skew))
  assert.ok(s.skew > 0)

  const identical = boxStats([5, 5, 5, 5])
  assert.equal(identical.skew, 0, 'no spread at all is no skew, not a division by zero')
})

// --- the chart -----------------------------------------------------------

test('no column means nothing to draw', () => {
  assert.equal(boxplotData({ column: '' }, { rows: rows([1, 2, 3]) }).ready, false)
})

test('a group too small to summarise is listed, not silently dropped', () => {
  // Three numbers have no meaningful quartiles. Drawing a box for them
  // would be three dots pretending to be a distribution.
  const data = boxplotData(
    { column: 'V', groupBy: 'G', minRows: 4 },
    { rows: [...rows([1, 2, 3, 4, 5], 'Big'), ...rows([9, 9], 'Small')] }
  )
  assert.equal(data.boxes.length, 1)
  assert.equal(data.tooSmall.length, 1)
  assert.equal(data.tooSmall[0].name, 'Small')
})

test('text in a numeric column is counted as unusable rather than read as zero', () => {
  const data = boxplotData(
    { column: 'V', minRows: 1 },
    { rows: [{ V: '10' }, { V: 'n/a' }, { V: '' }, { V: '20' }] }
  )
  assert.equal(data.boxes[0].stats.count, 2)
  assert.equal(data.unusable, 1, 'the blank is blank; "n/a" is a data-quality finding')
})

test('every box shares one scale', () => {
  // Per-box scales would make two very different distributions look
  // identical, which is the one thing this chart exists to prevent.
  const data = boxplotData(
    { column: 'V', groupBy: 'G', minRows: 2 },
    { rows: [...rows([1, 2, 3, 4], 'Small'), ...rows([100, 200, 300, 400], 'Big')] }
  )
  const small = data.boxes.find((b) => b.name === 'Small')
  const big = data.boxes.find((b) => b.name === 'Big')
  assert.ok(small.fractions.median < 0.2, 'the small group sits near the bottom of the shared axis')
  assert.ok(big.fractions.median > 0.4)
})

test('every drawn position stays inside the plot', () => {
  const data = boxplotData(
    { column: 'V', groupBy: 'G', minRows: 2 },
    { rows: [...rows([1, 2, 3, 4, 500], 'A'), ...rows([-90, 5, 6, 7], 'B')] }
  )
  for (const box of data.boxes) {
    for (const [key, value] of Object.entries(box.fractions)) {
      assert.ok(value >= 0 && value <= 1, `${box.name}.${key} is on the axis`)
    }
    for (const o of box.outlierFractions) assert.ok(o.fraction >= 0 && o.fraction <= 1)
  }
})

test('hiding the outliers rescales the axis to the whiskers', () => {
  const withThem = boxplotData({ column: 'V', minRows: 2, showOutliers: true }, { rows: rows([1, 2, 3, 4, 900]) })
  const without = boxplotData({ column: 'V', minRows: 2, showOutliers: false }, { rows: rows([1, 2, 3, 4, 900]) })
  assert.ok(withThem.max > 800)
  assert.ok(without.max < 100, 'otherwise hiding one dot leaves the chart squashed into a corner')
})

test('groups beyond the limit are counted', () => {
  const many = Array.from({ length: 20 }, (_, i) => rows([i, i + 1, i + 2, i + 3], `G${i}`)).flat()
  const data = boxplotData({ column: 'V', groupBy: 'G', limit: 5, minRows: 2 }, { rows: many })
  assert.equal(data.boxes.length, 5)
  assert.equal(data.hidden, 15)
})
