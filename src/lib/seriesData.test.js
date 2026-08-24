import test from 'node:test'
import assert from 'node:assert/strict'

import {
  OTHER_SERIES,
  asPercent,
  cumulative,
  movingAverage,
  paletteFor,
  pickSeries,
  seriesColor,
  seriesRollupNote,
  timeSeriesBy,
} from './seriesData.js'

const SALES = [
  { Date: '05/01/2026', Model: 'A', Amount: '100' },
  { Date: '20/01/2026', Model: 'B', Amount: '50' },
  { Date: '02/02/2026', Model: 'A', Amount: '200' },
  { Date: '11/02/2026', Model: 'A', Amount: '100' },
  // March has nothing at all.
  { Date: '03/04/2026', Model: 'B', Amount: '25' },
  { Date: '04/04/2026', Model: '', Amount: '10' },
]

const run = (extra = {}) =>
  timeSeriesBy(SALES, { dateColumn: 'Date', grain: 'month', order: 'DMY', ...extra })

// --- the breakdown --------------------------------------------------------

test('without a breakdown it is the series it always was', () => {
  const { data, series } = run()
  assert.deepEqual(series, ['value'])
  assert.deepEqual(data.map((d) => d.value), [2, 2, 0, 2])
})

test('a breakdown turns one line into one per value', () => {
  const { data, series } = run({ breakdown: 'Model' })
  assert.deepEqual(series.sort(), ['(blank)', 'A', 'B'])
  const jan = data[0]
  assert.equal(jan.A, 1)
  assert.equal(jan.B, 1)
  assert.equal(jan['(blank)'], 0, 'a series absent from a period is a zero, not a hole')
})

test('a blank value is charted, not quietly dropped from the total', () => {
  const { data, series } = run({ breakdown: 'Model' })
  assert.ok(series.includes('(blank)'))
  assert.equal(data.at(-1)['(blank)'], 1)
})

test('an empty period is still a period', () => {
  // A line that skips March slopes straight over it and tells a story that
  // did not happen.
  const { data } = run({ breakdown: 'Model' })
  assert.equal(data.length, 4)
  assert.equal(data[2].total, 0)
  assert.match(data[2].name, /Mar/)
})

test('every bucket keeps the span it covers, so a click can filter to it', () => {
  const { data } = run({ breakdown: 'Model' })
  assert.ok(data[0].start instanceof Date)
  assert.ok(data[0].end instanceof Date)
  assert.ok(data[0].end > data[0].start)
})

test('the measure follows the aggregation, not just the row count', () => {
  const { data } = run({ breakdown: 'Model', valueColumn: 'Amount', aggregation: 'sum' })
  assert.equal(data[0].A, 100)
  assert.equal(data[1].A, 300)
})

test('the total of a bucket is the sum of its series', () => {
  const { data, series } = run({ breakdown: 'Model', valueColumn: 'Amount', aggregation: 'sum' })
  for (const row of data) {
    assert.equal(row.total, series.reduce((sum, s) => sum + row[s], 0))
  }
})

// --- too many series ------------------------------------------------------

const wide = Array.from({ length: 30 }, (_, i) => ({
  Date: '05/01/2026',
  Model: `M${i}`,
  Amount: String(30 - i),
}))

test('a plate of spaghetti is rolled up rather than served', () => {
  const { series, rolled, data } = timeSeriesBy(wide, {
    dateColumn: 'Date',
    grain: 'month',
    order: 'DMY',
    breakdown: 'Model',
    valueColumn: 'Amount',
    aggregation: 'sum',
    maxSeries: 5,
  })
  assert.equal(series.length, 5)
  assert.equal(series.at(-1), OTHER_SERIES)
  assert.equal(rolled.length, 26)
  // ...and rolled, not discarded: the stack still adds up.
  const total = wide.reduce((sum, r) => sum + Number(r.Amount), 0)
  assert.equal(data[0].total, total)
})

test('series are ranked by their total over the whole window', () => {
  // Not by any one bucket: a one-off spike in March must not evict a series
  // that is steadily second-biggest all year.
  const rows = [
    { Date: '05/01/2026', Model: 'steady', Amount: '10' },
    { Date: '05/02/2026', Model: 'steady', Amount: '10' },
    { Date: '05/03/2026', Model: 'steady', Amount: '10' },
    { Date: '05/03/2026', Model: 'spike', Amount: '15' },
  ]
  const { series } = timeSeriesBy(rows, {
    dateColumn: 'Date',
    grain: 'month',
    order: 'DMY',
    breakdown: 'Model',
    valueColumn: 'Amount',
    aggregation: 'sum',
    maxSeries: 1,
  })
  // Both survive -- one over the cap keeps its name -- but the ORDER is the
  // claim: steady is 30 across the window, spike is 15 in one bucket.
  assert.deepEqual(series, ['steady', 'spike'])
})

test('one over the cap keeps its name instead of hiding in Other', () => {
  const totals = new Map([['a', 3], ['b', 2], ['c', 1]])
  assert.deepEqual(pickSeries(totals, { maxSeries: 2 }).series, ['a', 'b', 'c'])
})

test('the cap counts Other as one of the series it draws', () => {
  const totals = new Map([['a', 5], ['b', 4], ['c', 3], ['d', 2], ['e', 1]])
  const picked = pickSeries(totals, { maxSeries: 3 })
  assert.deepEqual(picked.series, ['a', 'b', OTHER_SERIES])
  assert.deepEqual(picked.rolled, ['c', 'd', 'e'])
})

test('the caption names what got rolled up', () => {
  assert.match(seriesRollupNote(['c', 'd']), /^2 smaller series grouped into Other: c, d$/)
  assert.equal(seriesRollupNote([]), '')
})

// --- colours --------------------------------------------------------------

test('an assigned colour wins, whatever the case', () => {
  const rules = [{ value: 'hdfc', color: '#ff0000' }]
  assert.equal(seriesColor('HDFC', 3, rules), '#ff0000')
  assert.equal(seriesColor(' hdfc ', 3, rules), '#ff0000')
})

test('anything unassigned cycles the chosen palette', () => {
  const cool = paletteFor('cool')
  assert.equal(seriesColor('X', 0, [], 'cool'), cool[0])
  assert.equal(seriesColor('Y', 1, [], 'cool'), cool[1])
  assert.equal(seriesColor('Z', cool.length, [], 'cool'), cool[0], 'and wraps')
})

test('an unknown palette falls back rather than throwing', () => {
  assert.equal(paletteFor('nonsense'), paletteFor('default'))
})

test('Other is always grey, so it never looks like a category', () => {
  assert.equal(seriesColor(OTHER_SERIES, 0, [{ value: 'Other', color: '#ff0000' }], 'warm'), '#cbd5e1')
})

test('a rule with no colour is ignored rather than blanking the series', () => {
  assert.equal(seriesColor('A', 0, [{ value: 'A', color: '' }]), paletteFor('default')[0])
})

// --- the readings ---------------------------------------------------------

const DATA = [
  { name: 'Jan', A: 10, B: 5 },
  { name: 'Feb', A: 20, B: 0 },
  { name: 'Mar', A: 30, B: 15 },
]

test('cumulative adds up as it goes, per series', () => {
  const out = cumulative(DATA, ['A', 'B'])
  assert.deepEqual(out.map((d) => d.A), [10, 30, 60])
  assert.deepEqual(out.map((d) => d.B), [5, 5, 20])
  assert.equal(out.at(-1).total, 80)
})

test('100% stacked shows the mix, and each period fills the height', () => {
  const out = asPercent(DATA, ['A', 'B'])
  assert.equal(Math.round(out[0].A), 67)
  assert.equal(Math.round(out[0].B), 33)
  assert.equal(Math.round(out[0].A + out[0].B), 100)
})

test('an empty period stays empty rather than being drawn as a full bar', () => {
  const out = asPercent([{ name: 'x', A: 0, B: 0 }], ['A', 'B'])
  assert.equal(out[0].A, 0)
  assert.equal(out[0].B, 0)
})

test('a moving average waits for a full window', () => {
  // An "average" of one point is the point itself, drawn as if smoothed --
  // which is a line that claims more than it knows.
  const out = movingAverage(DATA, ['A'], 3)
  assert.equal(out[0].A__ma, null)
  assert.equal(out[1].A__ma, null)
  assert.equal(out[2].A__ma, 20)
})

test('the average is trailing, so the newest point is always drawable', () => {
  const out = movingAverage([{ A: 0 }, { A: 10 }, { A: 20 }, { A: 30 }], ['A'], 2)
  assert.deepEqual(out.map((d) => d.A__ma), [null, 5, 15, 25])
})

test('none of the readings mutate what they were given', () => {
  const before = JSON.stringify(DATA)
  cumulative(DATA, ['A'])
  asPercent(DATA, ['A'])
  movingAverage(DATA, ['A'])
  assert.equal(JSON.stringify(DATA), before)
})

// --- nothing to chart -----------------------------------------------------

test('no dates, no chart, no crash', () => {
  assert.deepEqual(timeSeriesBy([], { dateColumn: 'Date' }).data, [])
  assert.deepEqual(timeSeriesBy(null, { dateColumn: 'Date' }).data, [])
  assert.deepEqual(timeSeriesBy(SALES, {}).data, [])
  assert.deepEqual(timeSeriesBy([{ Date: 'not a date' }], { dateColumn: 'Date' }).data, [])
})
