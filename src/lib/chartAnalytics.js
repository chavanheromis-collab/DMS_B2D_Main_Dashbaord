// ---------------------------------------------------------------------
// The layer over a chart that is not the data
// ---------------------------------------------------------------------
// A chart shows what happened. An analytics layer says what it MEANS: the
// direction under the noise, the band you wanted to stay inside, how far
// from typical the worst one is, where the running total gets to.
//
// This is the pane every serious tool calls Analytics -- Power BI's
// Analytics pane, Looker Studio's reference lines and bands, Google Charts'
// trendlines -- and the thing this app had instead was five static
// reference kinds. A chart could be told "draw a line at the average"; it
// could not be told "draw the trend", "shade the target range", or "mark
// two standard deviations", which is where reading a chart usually starts.
//
// Everything here is a function of the BARS, not of the rows. By the time a
// chart has data it is a list of `{ name, value }`, and the whole point of
// an overlay is that it describes what is drawn -- an average of the rows
// behind a limited chart would be an average of numbers the reader cannot
// see.
//
// Pure: numbers in, numbers out. No React, no recharts, no rows.

/**
 * A line at one value.
 *
 * The first four are what the chart already knew how to draw. The rest are
 * the ones a reader asks for next, and each is a statistic that MOVES with
 * the data -- which is the difference between a threshold somebody typed
 * and a line that keeps being true.
 */
export const REFERENCE_KINDS = [
  { value: 'value', label: 'A fixed value', needsValue: true },
  { value: 'avg', label: 'Average of the bars' },
  { value: 'median', label: 'Median of the bars' },
  { value: 'max', label: 'Highest bar' },
  { value: 'min', label: 'Lowest bar' },
  { value: 'percentile', label: 'A percentile', needsValue: true, valueLabel: 'Which percentile (0–100)' },
  { value: 'sigma', label: 'Average ± standard deviations', needsValue: true, valueLabel: 'How many σ (may be negative)' },
  { value: 'sum', label: 'Total of the bars' },
  { value: 'target_pct', label: '% of the average', needsValue: true, valueLabel: 'Percent' },
]

/**
 * A shaded range rather than a line.
 *
 * "Between 80 and 120" is a different question from "at 100", and drawing
 * it as two lines makes the reader do the shading in their head. Every
 * major tool grew a band for exactly this reason.
 */
export const BAND_KINDS = [
  { value: 'values', label: 'Between two values I choose', needsBoth: true },
  { value: 'minmax', label: 'From the lowest bar to the highest' },
  { value: 'sigma', label: 'Average ± n standard deviations', needsValue: true, valueLabel: 'How many σ' },
  { value: 'iqr', label: 'The middle half (25th–75th percentile)' },
  { value: 'p10p90', label: 'The middle 80% (10th–90th percentile)' },
]

/**
 * A line THROUGH the data rather than across it.
 *
 * A trend answers "which way is this going", which is the question a chart
 * of forty noisy bars cannot answer by itself. Two honest kinds:
 *
 *  - `linear` is the least-squares fit. One straight line, no parameters,
 *    and it says what a ruler laid on the chart would say.
 *  - `movingAvg` is the rolling mean. It follows the shape instead of
 *    replacing it, which is what you want when the trend is not straight.
 *
 * Deliberately NOT polynomial. A cubic through fifteen points fits the
 * noise, looks authoritative, and forecasts nonsense -- and a chart that
 * makes a reader more confident than the data warrants is worse than no
 * chart.
 */
export const TREND_KINDS = [
  { value: '', label: 'None' },
  { value: 'linear', label: 'Straight line (least squares)' },
  { value: 'movingAvg', label: 'Moving average', needsWindow: true },
]

export const DEFAULT_REFERENCE = {
  kind: 'avg',
  value: 0,
  label: '',
  color: '#EF4444',
  dashed: true,
}

export const DEFAULT_BAND = {
  kind: 'iqr',
  from: 0,
  to: 0,
  value: 1,
  label: '',
  color: '#6366F1',
  opacity: 0.1,
}

export const DEFAULT_TREND_WINDOW = 3

// ---------------------------------------------------------------------
// The statistics
// ---------------------------------------------------------------------

const numbers = (data) => (data || []).map((d) => d?.value).filter((n) => Number.isFinite(n))

export function mean(values) {
  if (!values.length) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * The population standard deviation, not the sample one.
 *
 * The bars ARE the population: they are every group the chart is drawing,
 * not a sample from a larger set of bars. Dividing by n-1 would be
 * estimating a spread the chart already knows exactly.
 */
export function stdDev(values) {
  const m = mean(values)
  if (m === null) return null
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length)
}

/**
 * A percentile by linear interpolation between the two nearest ranks.
 *
 * The same method a spreadsheet's PERCENTILE uses, so a number worked out
 * here and a number worked out in the sheet agree -- which matters, because
 * somebody will check.
 */
export function percentile(values, p) {
  if (!values.length) return null
  const pct = Math.min(100, Math.max(0, Number(p)))
  if (!Number.isFinite(pct)) return null

  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]

  const rank = (pct / 100) * (sorted.length - 1)
  const low = Math.floor(rank)
  const high = Math.ceil(rank)
  if (low === high) return sorted[low]
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low)
}

export function median(values) {
  return percentile(values, 50)
}

// ---------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------

/** Where one reference line sits, or null if it cannot be worked out. */
export function referenceValue(reference, data) {
  const values = numbers(data)
  if (values.length === 0) return null
  const n = Number(reference?.value)

  switch (reference?.kind) {
    case 'avg':
      return mean(values)
    case 'median':
      return median(values)
    case 'max':
      return Math.max(...values)
    case 'min':
      return Math.min(...values)
    case 'sum':
      return values.reduce((a, b) => a + b, 0)
    case 'percentile':
      return percentile(values, n)
    case 'sigma': {
      const m = mean(values)
      const s = stdDev(values)
      return Number.isFinite(n) && s !== null ? m + n * s : null
    }
    case 'target_pct': {
      const m = mean(values)
      return Number.isFinite(n) ? (m * n) / 100 : null
    }
    case 'value':
    default:
      return Number.isFinite(n) ? n : null
  }
}

/** Every reference line that resolves to a real number, with its label. */
export function resolvedReferences(widget, data) {
  return (widget?.references || [])
    .map((reference) => {
      const y = referenceValue(reference, data)
      if (y === null || !Number.isFinite(y)) return null
      const auto = REFERENCE_KINDS.find((k) => k.value === reference.kind)?.label || ''
      return { ...reference, y, text: reference.label || auto }
    })
    .filter(Boolean)
}

// ---------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------

/** The two edges of one band, lowest first, or null. */
export function bandRange(band, data) {
  const values = numbers(data)
  if (values.length === 0) return null
  const n = Number(band?.value)

  let from = null
  let to = null
  switch (band?.kind) {
    case 'minmax':
      from = Math.min(...values)
      to = Math.max(...values)
      break
    case 'sigma': {
      const m = mean(values)
      const s = stdDev(values)
      if (!Number.isFinite(n) || s === null) return null
      from = m - n * s
      to = m + n * s
      break
    }
    case 'iqr':
      from = percentile(values, 25)
      to = percentile(values, 75)
      break
    case 'p10p90':
      from = percentile(values, 10)
      to = percentile(values, 90)
      break
    case 'values':
    default:
      from = Number(band?.from)
      to = Number(band?.to)
      break
  }

  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  // Typed the wrong way round is a band, not an error: nobody means "an
  // empty range" by entering 120 and then 80.
  return from <= to ? { from, to } : { from: to, to: from }
}

export function resolvedBands(widget, data) {
  return (widget?.bands || [])
    .map((band) => {
      const range = bandRange(band, data)
      if (!range) return null
      const auto = BAND_KINDS.find((k) => k.value === band.kind)?.label || ''
      return { ...band, ...range, text: band.label || auto }
    })
    .filter(Boolean)
}

// ---------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------

/**
 * The least-squares line through the bars, as a value per bar.
 *
 * Bars are evenly spaced and their order is the chart's own, so x is simply
 * the index. That is what a ruler laid across the chart measures, and a
 * chart of categories has no other x to fit against.
 */
export function linearTrend(data) {
  const points = (data || [])
    .map((d, i) => ({ x: i, y: d?.value }))
    .filter((p) => Number.isFinite(p.y))
  const n = points.length
  if (n < 2) return null

  const sumX = points.reduce((s, p) => s + p.x, 0)
  const sumY = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0)

  // x is the index, so two points can never share one and the denominator
  // is only zero for a single point -- which the count above has already
  // turned away. There is no line through one point.
  const denom = n * sumXX - sumX * sumX
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

/**
 * The rolling mean over `window` bars, ending at each bar.
 *
 * Trailing rather than centred: a centred window reads half a bar into the
 * future, which on a chart of months means the line for March already knows
 * about April. The first bars have no full window and come back null rather
 * than being averaged over fewer -- a "3-month average" made of one month
 * is not a 3-month average.
 */
export function movingAverage(data, window = DEFAULT_TREND_WINDOW) {
  const size = Math.max(2, Math.round(Number(window) || DEFAULT_TREND_WINDOW))
  const values = (data || []).map((d) => (Number.isFinite(d?.value) ? d.value : null))

  return values.map((_, i) => {
    if (i + 1 < size) return null
    const slice = values.slice(i + 1 - size, i + 1)
    if (slice.some((v) => v === null)) return null
    return slice.reduce((a, b) => a + b, 0) / size
  })
}

/**
 * The data with a `__trend` field on each entry, or the data untouched.
 *
 * A field on the same rows rather than a second series, because the chart
 * draws the trend as a line in the same cartesian space -- and because a
 * separate array would have to be kept the same length by hand.
 */
export function withTrend(data, widget) {
  const kind = widget?.trend
  if (!kind || !Array.isArray(data) || data.length === 0) return data

  if (kind === 'movingAvg') {
    const avg = movingAverage(data, widget.trendWindow)
    return data.map((d, i) => ({ ...d, __trend: avg[i] }))
  }

  const fit = linearTrend(data)
  if (!fit) return data
  return data.map((d, i) => ({ ...d, __trend: fit.intercept + fit.slope * i }))
}

/** What the trend line should be called in a legend or tooltip. */
export function trendLabel(widget) {
  if (widget?.trend === 'movingAvg') {
    const size = Math.max(2, Math.round(Number(widget.trendWindow) || DEFAULT_TREND_WINDOW))
    return `${size}-point average`
  }
  return widget?.trend === 'linear' ? 'Trend' : ''
}

/**
 * Whether the trend is worth drawing at all.
 *
 * Two bars make a line that is merely the two bars joined up, and a moving
 * average whose window is longer than the chart draws nothing. Saying so
 * beats a setting that is on and invisible.
 */
export function trendIsDrawable(data, widget) {
  const kind = widget?.trend
  if (!kind) return false
  const n = (data || []).filter((d) => Number.isFinite(d?.value)).length
  if (kind === 'movingAvg') {
    return n >= Math.max(2, Math.round(Number(widget.trendWindow) || DEFAULT_TREND_WINDOW))
  }
  return n >= 3
}

// ---------------------------------------------------------------------
// Running total
// ---------------------------------------------------------------------

/**
 * A cumulative line over the bars.
 *
 * The pareto chart has always had one, wired into that chart alone. It is
 * the same question anywhere the order means something -- "where are we up
 * to" -- so it is an overlay rather than a chart type.
 *
 * `percent` scales to 100, which is the version that answers "how much of
 * the whole do the first few account for".
 */
export function withCumulative(data, widget) {
  if (!widget?.cumulative || !Array.isArray(data) || data.length === 0) return data

  const total = numbers(data).reduce((a, b) => a + b, 0)
  let running = 0
  return data.map((d) => {
    running += Number.isFinite(d?.value) ? d.value : 0
    const value = widget.cumulative === 'percent' ? (total > 0 ? (running / total) * 100 : 0) : running
    return { ...d, __cumulative: value }
  })
}

export const CUMULATIVE_MODES = [
  { value: '', label: 'None' },
  { value: 'total', label: 'Running total' },
  { value: 'percent', label: 'Running total, as a % of everything' },
]

/**
 * Everything the analytics layer adds to the plotted data, in one pass.
 *
 * One call so a chart cannot end up with the trend of one dataset and the
 * running total of another.
 */
export function withAnalytics(data, widget) {
  return withCumulative(withTrend(data, widget), widget)
}
