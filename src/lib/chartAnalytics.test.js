import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  BAND_KINDS,
  CUMULATIVE_MODES,
  DEFAULT_TREND_WINDOW,
  REFERENCE_KINDS,
  TREND_KINDS,
  bandRange,
  linearTrend,
  mean,
  median,
  movingAverage,
  percentile,
  referenceValue,
  resolvedBands,
  resolvedReferences,
  stdDev,
  trendIsDrawable,
  trendLabel,
  withAnalytics,
  withCumulative,
  withTrend,
} from './chartAnalytics.js'
import { chartCaps } from './chartOptions.js'

const bars = (...values) => values.map((value, i) => ({ name: `g${i}`, value }))

// ---------------------------------------------------------------------
// The statistics
// ---------------------------------------------------------------------

test('the spread is the POPULATION one, because the bars are the population', () => {
  // They are every group the chart is drawing, not a sample from a larger
  // set of bars. Dividing by n-1 would estimate a spread the chart knows.
  assert.equal(stdDev([2, 4, 4, 4, 5, 5, 7, 9]), 2)
  assert.equal(mean([2, 4, 6]), 4)
  assert.equal(stdDev([]), null)
  assert.equal(mean([]), null)
})

test('a percentile interpolates, the way a spreadsheet does', () => {
  // Somebody will check this against the sheet, and the two have to agree.
  const values = [1, 2, 3, 4]
  assert.equal(percentile(values, 0), 1)
  assert.equal(percentile(values, 100), 4)
  assert.equal(percentile(values, 50), 2.5)
  assert.equal(percentile(values, 25), 1.75)
  assert.equal(percentile([5], 90), 5, 'one value is every percentile of itself')
})

test('a percentile outside 0–100 is clamped, not wrapped', () => {
  assert.equal(percentile([1, 2, 3], 200), 3)
  assert.equal(percentile([1, 2, 3], -50), 1)
  assert.equal(percentile([1, 2, 3], 'x'), null)
  assert.equal(percentile([], 50), null)
})

test('the median is the 50th percentile, not a second implementation', () => {
  assert.equal(median([10, 50, 100]), 50)
  assert.equal(median([10, 20, 30, 40]), 25)
})

// ---------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------

test('the four kinds a chart always had still mean the same thing', () => {
  const data = bars(10, 50, 100)
  assert.equal(referenceValue({ kind: 'avg' }, data), (10 + 50 + 100) / 3)
  assert.equal(referenceValue({ kind: 'median' }, data), 50)
  assert.equal(referenceValue({ kind: 'max' }, data), 100)
  assert.equal(referenceValue({ kind: 'min' }, data), 10)
  assert.equal(referenceValue({ kind: 'value', value: 42 }, data), 42)
})

test('and the new ones move with the data, which a typed threshold cannot', () => {
  const data = bars(10, 20, 30, 40)
  assert.equal(referenceValue({ kind: 'sum' }, data), 100)
  assert.equal(referenceValue({ kind: 'percentile', value: 75 }, data), 32.5)
  assert.equal(referenceValue({ kind: 'target_pct', value: 120 }, data), 30, '120% of an average of 25')

  const sigma = referenceValue({ kind: 'sigma', value: 1 }, data)
  assert.ok(Math.abs(sigma - (25 + stdDev([10, 20, 30, 40]))) < 1e-9)
  const below = referenceValue({ kind: 'sigma', value: -2 }, data)
  assert.ok(Number.isFinite(below), 'a negative sigma is the lower side, not an error')
  assert.ok(Math.abs(below - (25 - 2 * stdDev([10, 20, 30, 40]))) < 1e-9)
})

test('a line that cannot be worked out is not drawn', () => {
  assert.equal(referenceValue({ kind: 'avg' }, []), null)
  assert.equal(referenceValue({ kind: 'value', value: 'abc' }, bars(1)), null)
  assert.equal(referenceValue({ kind: 'percentile' }, bars(1, 2)), null)
  assert.equal(referenceValue({ kind: 'sigma' }, bars(1, 2)), null)
  assert.deepEqual(resolvedReferences({ references: [{ kind: 'value', value: 'x' }] }, bars(1)), [])
})

test('a line without a label borrows the name of what it is', () => {
  const [line] = resolvedReferences({ references: [{ kind: 'avg' }] }, bars(10, 20))
  assert.equal(line.text, 'Average of the bars')
  const [named] = resolvedReferences({ references: [{ kind: 'avg', label: 'Target' }] }, bars(10, 20))
  assert.equal(named.text, 'Target')
})

// ---------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------

test('a band is a range, not two lines the reader has to shade between', () => {
  const data = bars(10, 20, 30, 40)
  assert.deepEqual(bandRange({ kind: 'values', from: 15, to: 35 }, data), { from: 15, to: 35 })
  assert.deepEqual(bandRange({ kind: 'minmax' }, data), { from: 10, to: 40 })
  assert.deepEqual(bandRange({ kind: 'iqr' }, data), { from: 17.5, to: 32.5 })
  assert.deepEqual(bandRange({ kind: 'p10p90' }, data), { from: 13, to: 37 })
})

test('a sigma band is symmetric about the average', () => {
  const data = bars(10, 20, 30, 40)
  const s = stdDev([10, 20, 30, 40])
  const band = bandRange({ kind: 'sigma', value: 2 }, data)
  assert.ok(Math.abs(band.from - (25 - 2 * s)) < 1e-9)
  assert.ok(Math.abs(band.to - (25 + 2 * s)) < 1e-9)
})

test('typed the wrong way round is still a band', () => {
  // Nobody means "an empty range" by entering 120 and then 80.
  assert.deepEqual(bandRange({ kind: 'values', from: 120, to: 80 }, bars(1)), { from: 80, to: 120 })
})

test('a band that cannot be worked out is not drawn', () => {
  assert.equal(bandRange({ kind: 'minmax' }, []), null)
  assert.equal(bandRange({ kind: 'values', from: 'a', to: 5 }, bars(1)), null)
  assert.equal(bandRange({ kind: 'sigma' }, bars(1, 2)), null)
  assert.deepEqual(resolvedBands({ bands: [{ kind: 'values', from: 'x' }] }, bars(1)), [])
})

// ---------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------

test('a straight trend is the least-squares fit, which is what a ruler says', () => {
  const fit = linearTrend(bars(1, 2, 3, 4))
  assert.equal(fit.slope, 1)
  assert.equal(fit.intercept, 1)

  const flat = linearTrend(bars(5, 5, 5))
  assert.equal(flat.slope, 0)
  assert.equal(flat.intercept, 5)

  const down = linearTrend(bars(10, 8, 6, 4))
  assert.equal(down.slope, -2)
})

test('there is no line through one point', () => {
  assert.equal(linearTrend(bars(5)), null)
  assert.equal(linearTrend([]), null)
  assert.equal(linearTrend(bars(NaN, NaN)), null)
  assert.equal(linearTrend(bars(5, NaN)), null, 'and one usable point is one point')
})

test('a moving average trails, so March does not know about April', () => {
  // A centred window reads half a window into the future.
  assert.deepEqual(movingAverage(bars(1, 2, 3, 4, 5), 3), [null, null, 2, 3, 4])
})

test('a window with no full window behind it is nothing, not an average of fewer', () => {
  // A "3-month average" made of one month is not a 3-month average.
  const out = movingAverage(bars(10, 20, 30), 3)
  assert.equal(out[0], null)
  assert.equal(out[1], null)
  assert.equal(out[2], 20)
  assert.deepEqual(movingAverage(bars(1, 2), 5), [null, null], 'a window longer than the chart draws nothing')
})

test('a gap in the data breaks the average rather than being skipped over', () => {
  const data = [{ value: 1 }, { value: null }, { value: 3 }, { value: 4 }]
  assert.deepEqual(movingAverage(data, 2), [null, null, null, 3.5])
})

test('the trend rides on the same rows the chart draws', () => {
  const out = withTrend(bars(1, 2, 3), { trend: 'linear' })
  assert.deepEqual(out.map((d) => d.__trend), [1, 2, 3])
  assert.deepEqual(withTrend(bars(1, 2, 3), {}), bars(1, 2, 3), 'and is absent when nobody asked')
})

test('a trend nobody can read is not drawn', () => {
  assert.equal(trendIsDrawable(bars(1, 2), { trend: 'linear' }), false, 'two bars joined up is not a trend')
  assert.equal(trendIsDrawable(bars(1, 2, 3), { trend: 'linear' }), true)
  assert.equal(trendIsDrawable(bars(1, 2), { trend: 'movingAvg', trendWindow: 5 }), false)
  assert.equal(trendIsDrawable(bars(1, 2, 3, 4, 5), { trend: 'movingAvg', trendWindow: 5 }), true)
  assert.equal(trendIsDrawable(bars(1, 2, 3), {}), false)
})

test('the trend says what it is, including how long its window is', () => {
  assert.equal(trendLabel({ trend: 'linear' }), 'Trend')
  assert.equal(trendLabel({ trend: 'movingAvg', trendWindow: 7 }), '7-point average')
  assert.equal(trendLabel({ trend: 'movingAvg' }), `${DEFAULT_TREND_WINDOW}-point average`)
  assert.equal(trendLabel({}), '')
})

test('no polynomial fit is offered', () => {
  // A cubic through fifteen points fits the noise, looks authoritative and
  // forecasts nonsense. A chart that makes a reader more confident than the
  // data warrants is worse than no chart.
  const kinds = TREND_KINDS.map((k) => k.value)
  assert.deepEqual(kinds, ['', 'linear', 'movingAvg'])
})

// ---------------------------------------------------------------------
// Running total
// ---------------------------------------------------------------------

test('a running total is where the chart has got to, bar by bar', () => {
  const out = withCumulative(bars(10, 20, 30), { cumulative: 'total' })
  assert.deepEqual(out.map((d) => d.__cumulative), [10, 30, 60])
})

test('as a percentage it ends at 100, which is the point of it', () => {
  const out = withCumulative(bars(10, 20, 30, 40), { cumulative: 'percent' })
  assert.deepEqual(out.map((d) => d.__cumulative), [10, 30, 60, 100])
})

test('nothing to total is zero, not a division by zero', () => {
  const out = withCumulative(bars(0, 0), { cumulative: 'percent' })
  assert.deepEqual(out.map((d) => d.__cumulative), [0, 0])
  assert.deepEqual(withCumulative(bars(1, 2), {}), bars(1, 2))
})

test('both overlays are worked out in ONE pass over the same rows', () => {
  // Or a chart ends up with the trend of one dataset and the running total
  // of another.
  const out = withAnalytics(bars(1, 2, 3), { trend: 'linear', cumulative: 'total' })
  assert.deepEqual(out.map((d) => d.__trend), [1, 2, 3])
  assert.deepEqual(out.map((d) => d.__cumulative), [1, 3, 6])
})

// ---------------------------------------------------------------------
// Where it applies
// ---------------------------------------------------------------------

test('a trend needs a series to run along', () => {
  // A trend through a histogram is a line through a distribution; a running
  // total over a waterfall IS the waterfall.
  for (const type of ['bar', 'cylinder', 'arrow', 'line', 'step', 'area']) {
    assert.equal(chartCaps(type).trend, true, type)
  }
  for (const type of ['histogram', 'waterfall', 'pie', 'donut', 'treemap', 'radar', 'funnel']) {
    assert.ok(!chartCaps(type).trend, type)
  }
})

test('the modes offered are the ones the renderer knows', () => {
  assert.deepEqual(CUMULATIVE_MODES.map((m) => m.value), ['', 'total', 'percent'])
  assert.ok(REFERENCE_KINDS.some((k) => k.value === 'percentile'))
  assert.ok(BAND_KINDS.some((k) => k.value === 'iqr'))
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const read = (p) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const chart = read('src/components/widgets/ChartWidget.jsx')
const panel = read('src/pages/admin/WidgetsPanel.jsx')
const options = read('src/lib/chartOptions.js')

test('there is ONE list of reference kinds in the app', () => {
  // It moved when bands and trends joined it -- they are one pane, not
  // three -- and chartOptions re-exports rather than re-declaring, so there
  // is no second list to fall behind.
  assert.ok(options.includes("export { DEFAULT_REFERENCE, REFERENCE_KINDS, referenceValue, resolvedReferences } from './chartAnalytics.js'"))
  assert.ok(!options.includes('export const REFERENCE_KINDS = ['))
  assert.ok(!options.includes('export function referenceValue('))
})

test('the chart draws bands under its marks, not over them', () => {
  // A band is the ground a bar stands on.
  assert.ok(chart.includes('const refBands ='))
  assert.ok(chart.includes('<ReferenceArea'))
  // EVERY band site, not just the first: a chart whose bands drifted over
  // its bars would still pass on the strength of its neighbours.
  const sites = (chart.match(/\{refBands\('y'\)\}/g) || []).length
  assert.ok(sites >= 4, 'every cartesian style has them')
  assert.equal(
    (chart.match(/\{refBands\('y'\)\} \{refLines\('y'\)\}/g) || []).length,
    sites,
    'and every one of them is immediately under its lines'
  )
  assert.ok(chart.includes("{refBands('x')} {refLines('x')}"), 'the horizontal chart too')
})

test('the overlay rides on the plotted rows, in one call', () => {
  assert.ok(chart.includes('return caps.trend ? withAnalytics(base, widget) : base'))
  assert.ok(chart.includes('const showTrend = caps.trend && trendIsDrawable(data, widget)'))
})

test('a percentage running total gets an axis of its own', () => {
  // 100% beside 14,000 flattens the line onto the floor.
  assert.ok(chart.includes('yAxisId="cum"'), 'the axis exists')
  assert.ok(chart.includes('domain={[0, 100]}'))
  assert.ok(
    chart.includes("yAxisId={widget.cumulative === 'percent' ? 'cum' : undefined}"),
    'and the line is actually bound to it'
  )
})

test('a moving average is not joined across the bars it has no value for', () => {
  const at = chart.indexOf('dataKey="__trend"')
  assert.ok(at > 0)
  assert.ok(chart.slice(at, at + 400).includes('connectNulls={false}'))
})

test('the editor offers all three, and says when they cannot apply', () => {
  assert.ok(panel.includes('options={BAND_KINDS}'))
  assert.ok(panel.includes('options={TREND_KINDS}'))
  assert.ok(panel.includes('options={CUMULATIVE_MODES}'))
  assert.ok(panel.includes('{caps.trend ? ('))
  assert.ok(panel.includes('this chart style has none') || panel.includes('chart style has none'))
})

test('the capability note tells an admin what a style ignores', () => {
  assert.ok(options.includes("if (!caps.trend) missing.push('trend lines or a running total')"))
})
