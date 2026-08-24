import { aggregate, bucketLabel, bucketStart, isBlank, nextBucket, toDate } from './dataUtils.js'
import { PALETTE } from './config.js'

// ---------------------------------------------------------------------
// Breaking a chart down into series
// ---------------------------------------------------------------------
// "Sales by month" answers a question. "Sales by month, split by model"
// answers the one everybody asks straight afterwards -- and it is a
// different chart, not a filtered version of the first, because the shape
// of the whole and the shape of each part rarely move together. A flat
// total can hide one model collapsing while another takes its place.
//
// Two rules carried over from the pie work, for the same reason:
//
//   Never drop a series. Twelve models on one chart is a plate of spaghetti,
//   so the tail is rolled into "Other" -- but rolled, not discarded, so the
//   stack still adds up to the total the reader could get from a KPI.
//
//   Never invent one. A blank cell becomes "(blank)" and is charted, rather
//   than quietly leaving its rows out of a total that claims to be complete.

export const SERIES_MODES = [
  { value: 'line', label: 'Lines', hint: 'Best for comparing shapes over time.' },
  { value: 'area', label: 'Stacked areas', hint: 'Shows the total and the mix at once.' },
  { value: 'percent', label: '100% stacked', hint: 'Mix only — every period fills the height.' },
  { value: 'bar', label: 'Stacked bars', hint: 'Discrete periods rather than a continuous line.' },
  { value: 'group', label: 'Grouped bars', hint: 'Side by side — best for a handful of series.' },
]

export const SERIES_PALETTES = [
  { value: 'default', label: 'Standard', colors: PALETTE },
  {
    value: 'cool',
    label: 'Cool',
    colors: ['#0EA5E9', '#6366F1', '#14B8A6', '#8B5CF6', '#0891B2', '#4F46E5', '#059669', '#7C3AED'],
  },
  {
    value: 'warm',
    label: 'Warm',
    colors: ['#F97316', '#EF4444', '#F59E0B', '#EC4899', '#DC2626', '#D97706', '#DB2777', '#B45309'],
  },
  {
    value: 'earth',
    label: 'Earth',
    colors: ['#65A30D', '#CA8A04', '#0D9488', '#A16207', '#4D7C0F', '#15803D', '#92400E', '#166534'],
  },
  {
    value: 'mono',
    label: 'One hue',
    colors: ['#1E3A8A', '#1D4ED8', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE', '#DBEAFE'],
  },
]

export const OTHER_SERIES = 'Other'

export function paletteFor(name) {
  return (SERIES_PALETTES.find((p) => p.value === name) || SERIES_PALETTES[0]).colors
}

/**
 * The colour one series gets.
 *
 * An explicit assignment always wins, and it is matched case-insensitively
 * because "HDFC" in the admin panel and "hdfc" in the sheet are the same
 * bank. Everything else cycles the chosen palette by POSITION, which is
 * stable as long as the series order is -- and the series order is by total,
 * so it only changes when the data genuinely changes.
 */
export function seriesColor(name, index, assignments, palette = 'default') {
  const colors = paletteFor(palette)
  if (name === OTHER_SERIES) return '#cbd5e1'

  const wanted = String(name ?? '').trim().toLowerCase()
  for (const rule of assignments || []) {
    if (!rule?.color) continue
    if (String(rule.value ?? '').trim().toLowerCase() === wanted) return rule.color
  }
  return colors[index % colors.length]
}

const labelOf = (value) => (isBlank(value) ? '(blank)' : String(value).trim())

/**
 * Which series to draw, and in what order.
 *
 * Ordered by total, biggest first: a legend sorted by size is a ranking as
 * well as a key, and a stack whose biggest band is at the bottom is easier
 * to read along than one in alphabetical order.
 */
export function pickSeries(totals, { maxSeries = 6, otherLabel = OTHER_SERIES } = {}) {
  const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1])
  const cap = Number(maxSeries) > 0 ? Number(maxSeries) : sorted.length

  if (sorted.length <= cap) return { series: sorted.map((e) => e[0]), rolled: [], otherLabel }

  // One over the cap is not worth an "Other" that holds a single series and
  // hides its name for nothing.
  if (sorted.length === cap + 1) return { series: sorted.map((e) => e[0]), rolled: [], otherLabel }

  const kept = sorted.slice(0, cap - 1).map((e) => e[0])
  const rolled = sorted.slice(cap - 1).map((e) => e[0])
  return { series: [...kept, otherLabel], rolled, otherLabel }
}

/**
 * A time series, optionally split by a second column.
 *
 * Buckets are continuous -- an empty month is a zero, not a gap -- because a
 * line that skips a quiet period slopes straight over it and tells a story
 * that did not happen.
 */
export function timeSeriesBy(
  rows,
  {
    dateColumn,
    grain = 'month',
    breakdown,
    valueColumn,
    aggregation = 'count',
    order = 'DMY',
    maxBuckets = 36,
    maxSeries = 6,
  }
) {
  if (!dateColumn) return { data: [], series: [], rolled: [] }

  const buckets = new Map()
  const totals = new Map()
  let min = null
  let max = null

  for (const row of rows || []) {
    const d = toDate(row[dateColumn], order)
    if (!d) continue
    const start = bucketStart(d, grain)
    const key = start.getTime()
    const series = breakdown ? labelOf(row[breakdown]) : 'value'

    if (!buckets.has(key)) buckets.set(key, new Map())
    const bucket = buckets.get(key)
    if (!bucket.has(series)) bucket.set(series, [])
    bucket.get(series).push(row)

    if (min === null || key < min) min = key
    if (max === null || key > max) max = key
  }

  if (min === null) return { data: [], series: [], rolled: [] }

  // Series are chosen on their TOTAL over the whole window, not on any one
  // bucket -- otherwise a one-off spike in March could evict a series that
  // is steadily second-biggest all year.
  for (const bucket of buckets.values()) {
    for (const [series, list] of bucket.entries()) {
      totals.set(series, (totals.get(series) || 0) + aggregate(list, valueColumn, aggregation))
    }
  }

  const picked = breakdown
    ? pickSeries(totals, { maxSeries })
    : { series: ['value'], rolled: [], otherLabel: OTHER_SERIES }
  const keep = new Set(picked.series)
  const rolled = new Set(picked.rolled)

  const data = []
  let cursor = new Date(min)
  while (cursor.getTime() <= max && data.length < maxBuckets * 4) {
    const key = cursor.getTime()
    const bucket = buckets.get(key) || new Map()
    const next = nextBucket(cursor, grain)

    const entry = { name: bucketLabel(cursor, grain), start: new Date(cursor), end: new Date(next.getTime() - 1) }
    for (const series of picked.series) entry[series] = 0

    let rows_ = 0
    for (const [series, list] of bucket.entries()) {
      const value = aggregate(list, valueColumn, aggregation)
      const target = keep.has(series) ? series : rolled.has(series) ? picked.otherLabel : null
      if (target !== null) entry[target] = (entry[target] || 0) + value
      rows_ += list.length
    }

    entry.total = picked.series.reduce((sum, s) => sum + (entry[s] || 0), 0)
    entry.count = rows_
    // The unbroken-down chart keeps its old key, so nothing that reads
    // `value` has to learn about series.
    if (!breakdown) entry.value = entry.value || 0

    data.push(entry)
    cursor = next
  }

  const trimmed = data.length > maxBuckets ? data.slice(data.length - maxBuckets) : data
  return { data: trimmed, series: picked.series, rolled: picked.rolled, otherLabel: picked.otherLabel }
}

/**
 * Running totals, in place of the per-period value.
 *
 * The question "how are we doing against the year" is a cumulative one, and
 * answering it by making the reader add up twelve bars in their head is how
 * a dashboard loses an argument.
 */
export function cumulative(data, series) {
  const running = new Map()
  return (data || []).map((row) => {
    const out = { ...row }
    let total = 0
    for (const key of series) {
      const next = (running.get(key) || 0) + (Number(row[key]) || 0)
      running.set(key, next)
      out[key] = next
      total += next
    }
    out.total = total
    return out
  })
}

/**
 * Each period rescaled to 100%, for reading the MIX rather than the volume.
 *
 * A period with nothing in it stays at zero rather than being drawn as an
 * arbitrary full bar -- there is no mix to show, and inventing one is worse
 * than a gap.
 */
export function asPercent(data, series) {
  return (data || []).map((row) => {
    const total = series.reduce((sum, key) => sum + (Number(row[key]) || 0), 0)
    const out = { ...row, __total: total }
    for (const key of series) out[key] = total > 0 ? ((Number(row[key]) || 0) / total) * 100 : 0
    return out
  })
}

/**
 * A trailing moving average, as an extra key per series.
 *
 * Trailing rather than centred, because a centred average needs future
 * periods and the most recent point -- the one everybody looks at -- would
 * be the one it could not draw.
 */
export function movingAverage(data, series, window = 3) {
  const size = Math.max(2, Math.floor(Number(window) || 3))
  const rows = data || []

  return rows.map((row, i) => {
    const out = { ...row }
    for (const key of series) {
      const from = Math.max(0, i - size + 1)
      const slice = rows.slice(from, i + 1)
      const sum = slice.reduce((total, r) => total + (Number(r[key]) || 0), 0)
      // Only once there is a full window: an "average" of one point is the
      // point itself, drawn as though it were smoothed.
      out[`${key}__ma`] = i + 1 >= size ? sum / slice.length : null
    }
    return out
  })
}

/** "3 smaller series grouped into Other", or nothing at all. */
export function seriesRollupNote(rolled, otherLabel = OTHER_SERIES) {
  if (!rolled?.length) return ''
  return `${rolled.length} smaller series grouped into ${otherLabel}: ${rolled.slice(0, 6).join(', ')}${
    rolled.length > 6 ? `, and ${rolled.length - 6} more` : ''
  }`
}
