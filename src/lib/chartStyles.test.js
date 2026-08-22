import test from 'node:test'
import assert from 'node:assert/strict'

import { histogram, timeSeries } from './dataUtils.js'
import { chartCaps, chartSupports, paretoData, unsupportedNote, waterfallData } from './chartOptions.js'
import { CHART_TYPES } from './config.js'

// --- capability table ---------------------------------------------------

test('every chart style in the picker has a capability entry', () => {
  // Without one it would silently fall back to the bar chart's abilities and
  // the editor would offer options the style cannot honour.
  for (const { value } of CHART_TYPES) {
    assert.ok(CHART_TYPES.length > 0)
    assert.notEqual(chartCaps(value), undefined, `${value} needs a capability entry`)
  }
})

test('capabilities describe what each style can really do', () => {
  assert.equal(chartSupports('bar', 'refLines'), true)
  assert.equal(chartSupports('pie', 'refLines'), false, 'a pie has no axis to draw against')
  assert.equal(chartSupports('pie', 'perDatumColor'), true)
  assert.equal(chartSupports('line', 'perDatumColor'), false, 'a single line has one colour')
  assert.equal(chartSupports('histogram', 'binned'), true)
  assert.equal(chartSupports('bar', 'binned'), false)
})

test('the editor is told, in words, what a style ignores', () => {
  assert.equal(unsupportedNote('bar'), '', 'bar supports everything')
  const pie = unsupportedNote('pie')
  assert.match(pie, /reference lines/)
  assert.match(pie, /axis steps/)
})

// --- waterfall ----------------------------------------------------------

const changes = [
  { name: 'Opening', value: 100 },
  { name: 'Won', value: 40 },
  { name: 'Lost', value: -30 },
  { name: 'Won again', value: 10 },
]

test('each bar starts where the last one finished', () => {
  const out = waterfallData(changes, { includeTotal: false })
  // Running total goes 0 → 100 → 140 → 110 → 120. A rise sits ON the previous
  // total; a fall hangs down TO the new one, so "Lost" and the rise after it
  // both have a base of 110.
  assert.deepEqual(out.map((d) => d.base), [0, 100, 110, 110])
  assert.deepEqual(out.map((d) => d.running), [100, 140, 110, 120])
  // Each block's top edge is its own running total -- that is the invariant
  // that makes the bridge join up.
  for (const bar of out) assert.equal(bar.base + bar.delta, Math.max(bar.running, bar.running - bar.value))
})

test('a fall hangs down from the running total rather than up from it', () => {
  const out = waterfallData(changes, { includeTotal: false })
  const lost = out.find((d) => d.name === 'Lost')
  assert.equal(lost.direction, 'down')
  // It ran 140 -> 110, so the visible block sits on 110 and is 30 tall.
  assert.equal(lost.base, 110)
  assert.equal(lost.delta, 30)
})

test('the closing total is anchored at zero and is optional', () => {
  const withTotal = waterfallData(changes)
  const total = withTotal[withTotal.length - 1]
  assert.equal(total.name, 'Total')
  assert.equal(total.direction, 'total')
  assert.equal(total.base, 0)
  assert.equal(total.delta, 120)

  assert.equal(waterfallData(changes, { includeTotal: false }).length, 4)
})

test('an empty waterfall does not invent a total out of nothing', () => {
  assert.deepEqual(waterfallData([]), [])
})

// --- pareto -------------------------------------------------------------

test('pareto sorts descending and accumulates to 100%', () => {
  const out = paretoData([
    { name: 'a', value: 10 },
    { name: 'c', value: 60 },
    { name: 'b', value: 30 },
  ])
  assert.deepEqual(out.map((d) => d.name), ['c', 'b', 'a'])
  assert.deepEqual(out.map((d) => d.cumulative), [60, 90, 100])
  assert.deepEqual(out.map((d) => Math.round(d.cumulativePct)), [60, 90, 100])
})

test('an all-zero pareto reports 0%, not NaN', () => {
  // Dividing by a zero total would put NaN on the axis and blank the line.
  const out = paretoData([{ name: 'a', value: 0 }, { name: 'b', value: 0 }])
  assert.equal(out[0].cumulativePct, 0)
  assert.ok(Number.isFinite(out[1].cumulativePct))
})

// --- histogram ----------------------------------------------------------

const numbers = [1, 2, 2, 3, 5, 8, 9, 10].map((n) => ({ Amount: String(n) }))

test('a histogram bins a numeric column and counts each bin', () => {
  const bins = histogram(numbers, { column: 'Amount', bins: 3 })
  assert.equal(bins.length, 3)
  assert.equal(bins.reduce((sum, b) => sum + b.value, 0), numbers.length, 'every value lands in exactly one bin')
})

test('the top value lands in the last bin rather than falling off the end', () => {
  const bins = histogram(numbers, { column: 'Amount', bins: 3 })
  assert.ok(bins[bins.length - 1].value > 0)
})

test('bins carry their real range, so a click can filter to it', () => {
  const [first] = histogram(numbers, { column: 'Amount', bins: 2 })
  assert.equal(typeof first.from, 'number')
  assert.equal(typeof first.to, 'number')
  assert.ok(first.to > first.from)
})

test('rows without a number are skipped, not counted as zero', () => {
  // Counting them would invent a spike at the bottom of the range.
  const bins = histogram([{ V: '5' }, { V: 'n/a' }, { V: '' }], { column: 'V', bins: 4 })
  assert.equal(bins.reduce((sum, b) => sum + b.value, 0), 1)
})

test('a column where every value is identical gives one bin, not a divide by zero', () => {
  const bins = histogram([{ V: '7' }, { V: '7' }], { column: 'V', bins: 5 })
  assert.equal(bins.length, 1)
  assert.equal(bins[0].value, 2)
})

test('a pinned range is respected and out-of-range rows are excluded', () => {
  const bins = histogram(numbers, { column: 'Amount', bins: 2, min: 0, max: 4 })
  assert.equal(bins.reduce((sum, b) => sum + b.value, 0), 4, 'only 1,2,2,3 fall inside 0-4')
})

test('no column, or no numbers at all, returns nothing rather than throwing', () => {
  assert.deepEqual(histogram(numbers, { column: '' }), [])
  assert.deepEqual(histogram([{ V: 'x' }], { column: 'V' }), [])
})

// --- trend buckets carry their span -------------------------------------

test('every time bucket knows its own start and end', () => {
  // Clicking a bucket filters to a DATE RANGE; "Mar 26" is a caption, not a
  // value any row holds, so the range cannot be reverse engineered.
  const series = timeSeries(
    [{ D: '2026-01-15' }, { D: '2026-02-10' }],
    { dateColumn: 'D', grain: 'month' }
  )
  assert.equal(series.length, 2)
  for (const bucket of series) {
    assert.ok(bucket.start instanceof Date)
    assert.ok(bucket.end instanceof Date)
    assert.ok(bucket.end > bucket.start)
  }
  // Consecutive buckets must not overlap, or a click would double-count.
  assert.ok(series[0].end < series[1].start)
})
