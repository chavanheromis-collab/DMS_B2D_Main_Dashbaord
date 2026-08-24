import test from 'node:test'
import assert from 'node:assert/strict'

import {
  OTHER_SERIES,
  dateSeriesLabel,
  isCyclical,
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

// --- a cyclical axis, and a date as the breakdown -------------------------

const YEARS = [
  { Date: '10/03/2024', Amount: '100' },
  { Date: '12/03/2025', Amount: '200' },
  { Date: '15/11/2025', Amount: '300' },
  { Date: '02/11/2026', Amount: '400' },
]

const yoy = (extra = {}) =>
  timeSeriesBy(YEARS, {
    dateColumn: 'Date',
    grain: 'monthOfYear',
    breakdown: 'Date',
    breakdownGrain: 'year',
    valueColumn: 'Amount',
    aggregation: 'sum',
    order: 'DMY',
    ...extra,
  })

test('every month of the year exists, in calendar order', () => {
  // A March with no sales is the finding. A chart that simply omits March
  // hides it.
  const { data, cyclical } = yoy()
  assert.equal(cyclical, true)
  assert.equal(data.length, 12)
  assert.deepEqual(data.map((d) => d.name).slice(0, 3), ['Jan', 'Feb', 'Mar'])
  assert.equal(data[0].total, 0, 'January had nothing and says so')
})

test('one line per year, from the same date column', () => {
  // The chart everybody actually wants: how does this November compare with
  // the last two.
  const { series, data } = yoy()
  assert.deepEqual(series.sort(), ['2024', '2025', '2026'])
  const nov = data[10]
  assert.equal(nov['2025'], 300)
  assert.equal(nov['2026'], 400)
  assert.equal(nov['2024'], 0)
})

test('years can be ordered newest-first rather than by size', () => {
  // Keeping which series is decided by size; only the drawing order follows
  // the sort, so a legend reads 2026, 2025, 2024.
  assert.deepEqual(yoy({ seriesSort: 'name_desc' }).series, ['2026', '2025', '2024'])
  assert.deepEqual(yoy({ seriesSort: 'name' }).series, ['2024', '2025', '2026'])
})

test('a cyclical bucket carries its rows, since it has no date range', () => {
  const { data } = yoy()
  assert.equal(data[2].rows.length, 2, 'both Marches, from different years')
  assert.equal(data[2].start, null, 'and no single span to filter by')
})

test('other cycles fold the same way', () => {
  const week = timeSeriesBy(YEARS, { dateColumn: 'Date', grain: 'dayOfWeek', order: 'DMY' })
  assert.equal(week.data.length, 7)
  assert.equal(week.data[0].name, 'Mon', 'the week starts on Monday, so the weekend stays together')

  const q = timeSeriesBy(YEARS, { dateColumn: 'Date', grain: 'quarterOfYear', order: 'DMY' })
  assert.deepEqual(q.data.map((d) => d.name), ['Q1', 'Q2', 'Q3', 'Q4'])
  assert.equal(q.data[0].value, 2, 'both March rows')
  assert.equal(q.data[3].value, 2)
})

test('a continuous axis is unchanged by any of it', () => {
  const { data, cyclical } = timeSeriesBy(YEARS, { dateColumn: 'Date', grain: 'year', order: 'DMY' })
  assert.equal(cyclical, false)
  assert.deepEqual(data.map((d) => d.value), [1, 2, 1])
  assert.ok(data[0].start instanceof Date)
})

test('a date breakdown can be bucketed any of several ways', () => {
  const byQuarter = timeSeriesBy(YEARS, {
    dateColumn: 'Date',
    grain: 'year',
    breakdown: 'Date',
    breakdownGrain: 'quarter',
    order: 'DMY',
  })
  assert.deepEqual(byQuarter.series.sort(), ['2024 Q1', '2025 Q1', '2025 Q4', '2026 Q4'])

  const byDay = timeSeriesBy(YEARS, {
    dateColumn: 'Date',
    grain: 'year',
    breakdown: 'Date',
    breakdownGrain: 'dayOfWeek',
    order: 'DMY',
  })
  assert.ok(byDay.series.every((n) => /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day$/.test(n)))
})

test('a value that will not parse as a date keeps its own text', () => {
  // "2026-13-01" is a data-quality finding, not a row to drop.
  const rows = [{ Date: '10/03/2025', When: 'not a date' }, { Date: '11/03/2025', When: '05/06/2024' }]
  const { series } = timeSeriesBy(rows, {
    dateColumn: 'Date',
    grain: 'month',
    breakdown: 'When',
    breakdownGrain: 'year',
    order: 'DMY',
  })
  assert.deepEqual(series.sort(), ['2024', 'not a date'])
})

test('the label helpers cover every grain they offer', () => {
  const d = new Date(2026, 2, 15) // 15 March 2026
  assert.equal(dateSeriesLabel(d, 'year'), '2026')
  assert.equal(dateSeriesLabel(d, 'quarter'), '2026 Q1')
  assert.equal(dateSeriesLabel(d, 'month'), 'Mar 2026')
  assert.equal(dateSeriesLabel(d, 'monthOfYear'), 'March')
  assert.equal(dateSeriesLabel(d, 'dayOfWeek'), 'Sunday')
  assert.equal(dateSeriesLabel(d, 'nonsense'), null)
  assert.equal(dateSeriesLabel(null, 'year'), null)
})

test('cyclical grains are recognised as such', () => {
  assert.equal(isCyclical('monthOfYear'), true)
  assert.equal(isCyclical('month'), false)
  assert.equal(isCyclical(undefined), false)
})
