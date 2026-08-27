// ---------------------------------------------------------------------
// Box plot -- the shape of a column, not its total
// ---------------------------------------------------------------------
// Every other chart in the app reduces a group of rows to ONE number. That
// is what a bar chart is, and it is why a bar chart can say two branches
// are identical when one sells forty steady cars a month and the other
// sells two and then thirty-eight.
//
// A box shows the whole group at once: the middle half of it as a box, the
// typical range as whiskers, and every row outside that range as its own
// dot. The dots are not noise to be cleaned up -- they are the deals worth
// asking about, and they are the reason this widget exists.
//
// Tukey's convention throughout: the whiskers stop at the last real value
// within 1.5 interquartile ranges of the box, not at 1.5 IQR itself. The
// difference matters -- a whisker drawn to a number no row actually
// reached is a whisker pointing at nothing.

import { isBlank, percentile, toNumber } from './dataUtils.js'

export const BOX_ORIENTATIONS = [
  { value: 'vertical', label: 'Vertical — boxes side by side' },
  { value: 'horizontal', label: 'Horizontal — boxes stacked down' },
]

export const BOX_SORTS = [
  { value: 'median_desc', label: 'Median, highest first' },
  { value: 'median_asc', label: 'Median, lowest first' },
  { value: 'spread_desc', label: 'Widest spread first' },
  { value: 'count_desc', label: 'Most rows first' },
  { value: 'name_asc', label: 'Name, A→Z' },
]

export const DEFAULT_BOXPLOT = {
  column: '',
  groupBy: '',
  limit: 10,
  sort: 'median_desc',
  orientation: 'vertical',
  showOutliers: true,
  showPoints: false,
  showMean: true,
  format: 'comma',
  color: '#4F46E5',
  palette: 'default',
  height: 300,
  // A group of three rows has no meaningful quartiles. Rather than draw a
  // box that is really just three dots pretending to be a distribution,
  // small groups are listed separately and said out loud.
  minRows: 4,
}

/**
 * The five-number summary, plus whiskers and outliers.
 *
 * `values` need not be sorted; they are sorted here once. Everything after
 * that is index arithmetic on the sorted array, which is why this is cheap
 * enough to run on every group of a large sheet.
 */
export function boxStats(values) {
  const nums = (values || []).filter((n) => Number.isFinite(n))
  if (nums.length === 0) return null

  const sorted = [...nums].sort((a, b) => a - b)
  const q1 = percentile(sorted, 25)
  const median = percentile(sorted, 50)
  const q3 = percentile(sorted, 75)
  const iqr = q3 - q1
  const fenceLow = q1 - 1.5 * iqr
  const fenceHigh = q3 + 1.5 * iqr

  // Tukey: the whisker reaches the furthest ACTUAL observation still inside
  // the fence. With a tight distribution that is the true min and max, and
  // no outliers are drawn at all -- which is the correct picture.
  const inside = sorted.filter((n) => n >= fenceLow && n <= fenceHigh)
  const low = inside.length ? inside[0] : sorted[0]
  const high = inside.length ? inside[inside.length - 1] : sorted[sorted.length - 1]

  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length

  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    q1,
    median,
    q3,
    iqr,
    mean,
    whiskerLow: low,
    whiskerHigh: high,
    outliers: sorted.filter((n) => n < low || n > high),
    values: sorted,
    // Which way the tail runs, measured as how far the MEAN has been
    // dragged from the median -- which is precisely the condition under
    // which quoting the average becomes misleading.
    //
    // Not the quartile (Bowley) version, which only sees the box: on
    // 1, 2, 3, 4, 100 the box is perfectly symmetric and Bowley reports
    // zero skew, while the mean sits at 22 against a median of 3. The
    // whole reason to draw a box plot is that one enormous value is
    // hiding inside an ordinary-looking average, so the measure has to be
    // one the outlier can move.
    //
    // Divided by the spread to keep it dimensionless, so two groups in
    // different units can be compared. The interquartile range is the
    // robust denominator; where every middle value is identical it is
    // zero, and the full range stands in.
    skew: (() => {
      const spread = iqr || sorted[sorted.length - 1] - sorted[0]
      return spread > 0 ? (mean - median) / spread : 0
    })(),
  }
}

const SORTERS = {
  median_desc: (a, b) => b.stats.median - a.stats.median,
  median_asc: (a, b) => a.stats.median - b.stats.median,
  spread_desc: (a, b) => b.stats.iqr - a.stats.iqr,
  count_desc: (a, b) => b.stats.count - a.stats.count,
  name_asc: (a, b) => String(a.name).localeCompare(String(b.name)),
}

/** Every box on the chart, on one shared scale. */
export function boxplotData(widget, { rows = [] } = {}) {
  const config = { ...DEFAULT_BOXPLOT, ...(widget || {}) }
  if (!config.column) return { ready: false, boxes: [], reason: 'Pick a numeric column' }

  const groups = new Map()
  let unusable = 0

  for (const row of rows || []) {
    const n = toNumber(row[config.column])
    if (n === null) {
      if (!isBlank(row[config.column])) unusable += 1
      continue
    }
    const key = config.groupBy ? (isBlank(row[config.groupBy]) ? '(blank)' : String(row[config.groupBy]).trim()) : 'All rows'
    const bucket = groups.get(key)
    if (bucket) {
      bucket.values.push(n)
      bucket.rows.push(row)
    } else {
      groups.set(key, { name: key, values: [n], rows: [row] })
    }
  }

  const minRows = Math.max(1, Math.round(Number(config.minRows) || 4))
  const all = [...groups.values()]
    .map((g) => ({ ...g, stats: boxStats(g.values) }))
    .filter((g) => g.stats)

  const drawable = all.filter((g) => g.stats.count >= minRows)
  const tooSmall = all.filter((g) => g.stats.count < minRows)

  drawable.sort(SORTERS[config.sort] || SORTERS.median_desc)
  const limit = Math.max(1, Math.min(50, Math.round(Number(config.limit) || 10)))
  const boxes = drawable.slice(0, limit)

  if (boxes.length === 0) {
    return { ready: true, boxes: [], tooSmall, unusable, min: 0, max: 0, hidden: 0 }
  }

  // One scale for every box, always. Per-box scales would make two very
  // different distributions look identical, which is the one thing this
  // chart exists to prevent.
  const lows = boxes.map((b) => (config.showOutliers ? b.stats.min : b.stats.whiskerLow))
  const highs = boxes.map((b) => (config.showOutliers ? b.stats.max : b.stats.whiskerHigh))
  const rawMin = Math.min(...lows)
  const rawMax = Math.max(...highs)
  const pad = (rawMax - rawMin) * 0.06 || Math.abs(rawMax) * 0.1 || 1
  const min = rawMin - pad
  const max = rawMax + pad
  const spread = max - min || 1

  const at = (value) => Math.max(0, Math.min(1, (value - min) / spread))

  return {
    ready: true,
    boxes: boxes.map((box, index) => ({
      ...box,
      index,
      fractions: {
        min: at(box.stats.min),
        max: at(box.stats.max),
        q1: at(box.stats.q1),
        median: at(box.stats.median),
        q3: at(box.stats.q3),
        mean: at(box.stats.mean),
        whiskerLow: at(box.stats.whiskerLow),
        whiskerHigh: at(box.stats.whiskerHigh),
      },
      outlierFractions: box.stats.outliers.map((v) => ({ value: v, fraction: at(v) })),
    })),
    min,
    max,
    hidden: Math.max(0, drawable.length - boxes.length),
    tooSmall,
    unusable,
    // Axis ticks at the five points a reader looks for anyway.
    ticks: [0, 0.25, 0.5, 0.75, 1].map((t) => ({ fraction: t, value: min + t * spread })),
  }
}
