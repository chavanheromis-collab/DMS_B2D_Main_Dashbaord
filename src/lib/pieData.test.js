import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_PIE_OPTIONS, labelledSlices, pieSlices, rollupNote, sliceLabel } from './pieData.js'

const many = (n) => Array.from({ length: n }, (_, i) => ({ name: `C${i + 1}`, value: n - i }))

const names = (result) => result.slices.map((s) => s.name)
const sum = (result) => result.slices.reduce((t, s) => t + s.value, 0)

// --- the correctness problem, first --------------------------------------

test('a rolled-up chart still adds up to the whole', () => {
  // The bug this exists to kill: keep the top 12 of 120 and every
  // percentage on screen is a percentage of twelve. A slice reading 34%
  // might be 4% of the data, and nothing says so.
  const result = pieSlices(many(120), { maxSlices: 8 })
  assert.equal(sum(result), result.total)
  assert.equal(
    result.slices.reduce((t, s) => t + s.percent, 0).toFixed(6),
    '1.000000'
  )
})

test('percentages are of the real total, not of what survived', () => {
  const result = pieSlices([{ name: 'A', value: 50 }, { name: 'B', value: 30 }, { name: 'C', value: 20 }], {
    maxSlices: 2,
  })
  assert.equal(result.slices[0].percent, 0.5, 'A is half of everything, not two-thirds of the top two')
})

test('120 categories become a chart you can look at', () => {
  const result = pieSlices(many(120), { maxSlices: 8 })
  assert.equal(result.slices.length, 8)
  assert.equal(result.truncated, true)
  assert.equal(result.rolled, 113)
  assert.match(result.slices.at(-1).name, /^Other \(113\)$/)
})

test('the tail keeps its members, so “other what?” is answerable', () => {
  const result = pieSlices(many(10), { maxSlices: 3 })
  const other = result.slices.at(-1)
  assert.equal(other.isOther, true)
  assert.equal(other.members.length, 8)
  assert.equal(other.members[0].name, 'C3', 'in the same biggest-first order')
})

// --- the judgement calls --------------------------------------------------

test('slices are ordered biggest first, because a pie is read clockwise', () => {
  const result = pieSlices([{ name: 'small', value: 1 }, { name: 'big', value: 9 }], { rollup: false })
  assert.deepEqual(names(result), ['big', 'small'])
})

test('a sliver goes to Other even when there is room for it', () => {
  // Thinner than its own outline, and it would take a label slot that a
  // visible slice needs.
  const result = pieSlices(
    [{ name: 'A', value: 990 }, { name: 'B', value: 5 }, { name: 'C', value: 5 }],
    { maxSlices: 10, minPercent: 1 }
  )
  assert.deepEqual(names(result), ['A', 'Other (2)'])
})

test('one straggler is not worth an “Other (1)”', () => {
  // B is half a percent, so the floor would push it out -- but "Other (1)"
  // says strictly less than the category's own name, so it stays.
  const result = pieSlices([{ name: 'A', value: 995 }, { name: 'B', value: 5 }], { maxSlices: 10, minPercent: 1 })
  assert.deepEqual(names(result), ['A', 'B'])
  assert.equal(result.truncated, false)
})

test('the cap leaves room for Other rather than spending it on a sliver', () => {
  const result = pieSlices(many(20), { maxSlices: 5, minPercent: 0 })
  assert.equal(result.slices.length, 5)
  assert.equal(result.slices.at(-1).isOther, true, 'four real slices and the roll-up')
})

test('a chart that fits is left completely alone', () => {
  const result = pieSlices(many(5), { maxSlices: 8 })
  assert.equal(result.truncated, false)
  assert.equal(result.rolled, 0)
  assert.equal(result.slices.every((s) => !s.isOther), true)
})

test('roll-up can be switched off for someone who wants all 120', () => {
  const result = pieSlices(many(120), { maxSlices: 8, rollup: false })
  assert.equal(result.slices.length, 120)
  assert.equal(result.truncated, false)
})

// --- the awkward inputs ---------------------------------------------------

test('nothing to chart is not an error', () => {
  assert.deepEqual(pieSlices([]).slices, [])
  assert.deepEqual(pieSlices(null).slices, [])
  assert.equal(pieSlices([]).total, 0)
})

test('a chart of zeroes cannot divide by zero', () => {
  const result = pieSlices([{ name: 'A', value: 0 }, { name: 'B', value: 0 }])
  assert.deepEqual(result.slices, [])
  assert.equal(result.total, 0)
})

test('rows that are not numbers are dropped rather than poisoning the total', () => {
  const result = pieSlices([{ name: 'A', value: 10 }, { name: 'B', value: 'oops' }, null])
  assert.equal(result.total, 10)
  assert.deepEqual(names(result), ['A'])
})

// --- labels ---------------------------------------------------------------

test('only slices with room get a label on the chart', () => {
  const result = pieSlices(many(20), { maxSlices: 20, minPercent: 0, rollup: false })
  const labelled = labelledSlices(result.slices, 5)
  assert.ok(labelled.length < result.slices.length)
  assert.equal(labelled.every((s) => s.percent >= 0.05), true)
})

test('dropping a label never drops the category', () => {
  const result = pieSlices(many(20), { maxSlices: 20, minPercent: 0, rollup: false })
  assert.equal(result.slices.length, 20, 'all twenty are still slices, still hoverable, still in the legend')
})

test('a label says what the admin asked it to', () => {
  const slice = { name: 'SPLENDOR', value: 1284, percent: 0.4235 }
  const fmt = (v) => v.toLocaleString('en-IN')
  assert.equal(sliceLabel(slice, 'name_percent', fmt), 'SPLENDOR 42%')
  assert.equal(sliceLabel(slice, 'percent', fmt), '42%')
  assert.equal(sliceLabel(slice, 'value', fmt), '1,284')
  assert.equal(sliceLabel(slice, 'name_value', fmt), 'SPLENDOR 1,284')
  assert.equal(sliceLabel(slice, 'value_percent', fmt), '1,284 · 42%')
  assert.equal(sliceLabel(slice, 'name', fmt), 'SPLENDOR')
})

test('a tiny percentage keeps a decimal rather than rounding to nothing', () => {
  assert.equal(sliceLabel({ name: 'x', value: 1, percent: 0.004 }, 'percent'), '0.4%')
})

// --- saying so ------------------------------------------------------------

test('the caption says what was rolled up and how much of the total it was', () => {
  const result = pieSlices(many(120), { maxSlices: 8 })
  const note = rollupNote(result, (v) => String(v))
  assert.match(note, /^113 smaller categories grouped into Other/)
  assert.match(note, /% of the total$/)
})

test('a chart that hid nothing says nothing', () => {
  assert.equal(rollupNote(pieSlices(many(3))), '')
  assert.equal(rollupNote(null), '')
})

test('the defaults are the ones a 120-slice pie needs', () => {
  assert.ok(DEFAULT_PIE_OPTIONS.maxSlices <= 12)
  assert.ok(DEFAULT_PIE_OPTIONS.rollup)
})
