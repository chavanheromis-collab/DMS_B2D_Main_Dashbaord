import { PALETTE } from './config.js'
import { pinnedColor, valueColor } from './valueColors.js'
import { toNumber } from './dataUtils.js'

// ---------------------------------------------------------------------
// Advanced chart behaviour
// ---------------------------------------------------------------------
// Colour rules, reference lines and axis scaling -- the parts of a chart an
// admin needs to control once the chart is doing real work rather than just
// existing.

// ---------------------------------------------------------------------
// What each chart style can actually do
// ---------------------------------------------------------------------
// Not every advanced option means something on every chart: a reference line
// has nowhere to go on a pie, and an axis step has no axis to sit on. Rather
// than silently ignoring settings the admin turned on -- which is how you end
// up believing a feature is broken -- the capability table is published, the
// editor greys out what does not apply and says why, and the widget only
// renders what the style supports.
// `trend` is the analytics overlay -- a trend line and a running total.
// Not every cartesian chart earns one: a trend through a HISTOGRAM is a
// trend through a distribution, which is a line through a shape rather than
// through a series, and a running total over a WATERFALL is the waterfall.
export const CHART_CAPABILITIES = {
  bar: { cartesian: true, refLines: true, axisStep: true, grid: true, labels: true, perDatumColor: true, legend: false, trend: true },
  hbar: { cartesian: true, horizontal: true, refLines: true, axisStep: true, grid: true, labels: true, perDatumColor: true },
  lollipop: { cartesian: true, refLines: true, axisStep: true, grid: true, labels: true, perDatumColor: true },
  arrow: { cartesian: true, refLines: true, axisStep: true, grid: true, labels: true, perDatumColor: true, trend: true },
  arrowRow: { cartesian: true, horizontal: true, refLines: true, axisStep: true, grid: true, labels: true, perDatumColor: true },
  cylinder: { cartesian: true, refLines: true, axisStep: true, grid: true, labels: true, perDatumColor: true, trend: true },
  circles: { labels: true, perDatumColor: true },
  waterfall: { cartesian: true, refLines: true, axisStep: true, grid: true, labels: true, perDatumColor: 'signed' },
  pareto: { cartesian: true, refLines: true, axisStep: true, grid: true, labels: true, perDatumColor: true, legend: true },
  histogram: { cartesian: true, binned: true, refLines: true, axisStep: true, grid: true, labels: true, perDatumColor: true },
  line: { cartesian: true, refLines: true, axisStep: true, grid: true, labels: true, trend: true },
  step: { cartesian: true, refLines: true, axisStep: true, grid: true, labels: true, trend: true },
  area: { cartesian: true, refLines: true, axisStep: true, grid: true, labels: true, trend: true },
  pie: { labels: true, perDatumColor: true, legend: true },
  donut: { labels: true, perDatumColor: true, legend: true },
  rose: { labels: true, perDatumColor: true, legend: true },
  radar: { grid: true, labels: true, legend: true },
  radial: { labels: true, perDatumColor: true, legend: true },
  treemap: { labels: true, perDatumColor: true },
  funnel: { labels: true, perDatumColor: true },
  progress: { perDatumColor: true },
}

export function chartCaps(type) {
  return CHART_CAPABILITIES[type] || CHART_CAPABILITIES.bar
}

export function chartSupports(type, feature) {
  return Boolean(chartCaps(type)[feature])
}

/** Plain-English note for the admin about what this style ignores. */
export function unsupportedNote(type) {
  const caps = chartCaps(type)
  const missing = []
  if (!caps.refLines) missing.push('reference lines')
  if (!caps.axisStep) missing.push('axis steps')
  if (!caps.grid) missing.push('grid lines')
  if (!caps.labels) missing.push('value labels')
  if (!caps.perDatumColor) missing.push('per-bar colour rules')
  if (!caps.trend) missing.push('trend lines or a running total')
  if (missing.length === 0) return ''
  return `This chart style has no ${missing.join(', ')}.`
}

export const COLOR_MODES = [
  { value: 'single', label: 'One colour', hint: 'Every bar the same.' },
  { value: 'palette', label: 'A colour per category', hint: 'One palette colour each, and it stays with the value.' },
  { value: 'scale', label: 'Shade by value', hint: 'Darker where the number is bigger.' },
  { value: 'rules', label: 'Conditional colours', hint: 'Your own thresholds — red under target, green over.' },
  { value: 'rank', label: 'Highlight best & worst', hint: 'Top and bottom stand out, the rest recede.' },
]

// The reference lines moved to lib/chartAnalytics.js when bands and trend
// lines joined them -- they are one pane, not three. Re-exported rather
// than re-declared, so there is exactly one list of kinds in the app and no
// second one to fall behind it.
export { DEFAULT_REFERENCE, REFERENCE_KINDS, referenceValue, resolvedReferences } from './chartAnalytics.js'

/** Mixes `hex` toward white (t<0) or black (t>0). */
function shade(hex, t) {
  const m = String(hex || '').match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return hex
  const to = t < 0 ? 255 : 0
  const amt = Math.abs(t)
  const ch = (c) => Math.round(parseInt(c, 16) * (1 - amt) + to * amt)
  return `rgb(${ch(m[1])}, ${ch(m[2])}, ${ch(m[3])})`
}

/**
 * The colour for one datum.
 *
 * A PIN WINS OVER THE MODE. If an admin has said Cancelled is red, then
 * Cancelled is red in the one-colour chart and the shaded-by-value chart
 * too -- otherwise pinning a colour would mean something different in every
 * chart on the page, which is the opposite of what pinning is for. The
 * modes below decide the colour of everything nobody has spoken for.
 *
 * `scale` deliberately spans a light-to-full band rather than 0-to-full: a
 * bar shaded to near-white against a white card reads as missing data, not
 * as a small number.
 */
export function colorForDatum(widget, entry, index, data, book = {}) {
  const base = widget.color || PALETTE[0]
  const mode = widget.colorMode || 'single'

  const pinned = pinnedColor(entry?.name, book.assignments)
  if (pinned) return pinned

  // A palette colour belongs to the value, not to the seat it is drawn in,
  // so a filter narrows the chart without recolouring what is left.
  if (mode === 'palette') return valueColor(entry?.name, index, book)

  if (mode === 'scale') {
    const values = data.map((d) => d.value)
    const max = Math.max(...values, 0)
    const min = Math.min(...values, 0)
    const span = max - min || 1
    const t = (entry.value - min) / span
    return shade(base, -0.65 * (1 - t))
  }

  if (mode === 'rank') {
    const values = data.map((d) => d.value)
    const max = Math.max(...values)
    const min = Math.min(...values)
    if (entry.value === max) return widget.bestColor || '#059669'
    if (entry.value === min) return widget.worstColor || '#DC2626'
    return shade(base, -0.55)
  }

  if (mode === 'rules') {
    // First match wins, so an admin can order rules from most to least
    // specific and reason about them top-down.
    for (const rule of widget.colorRules || []) {
      const threshold = toNumber(rule.value)
      if (threshold === null) continue
      const op = rule.operator || 'gte'
      const v = entry.value
      const hit =
        (op === 'gte' && v >= threshold) ||
        (op === 'gt' && v > threshold) ||
        (op === 'lte' && v <= threshold) ||
        (op === 'lt' && v < threshold) ||
        (op === 'eq' && v === threshold)
      if (hit) return rule.color || base
    }
    return widget.fallbackColor || base
  }

  return base
}

/** Resolves a reference line's configured kind into an actual y value. */
// ---------------------------------------------------------------------
// Shapes derived from the grouped data
// ---------------------------------------------------------------------

/**
 * A waterfall bridge: each bar starts where the last one finished, so the
 * chart shows how a running total is built up rather than how the parts
 * compare.
 *
 * Rendered as two stacked bars with the lower one transparent -- recharts has
 * no waterfall type, and a floating bar IS an invisible base with a visible
 * block sitting on it. A final "Total" column is appended, anchored back at
 * zero.
 */
export function waterfallData(data, { includeTotal = true, totalLabel = 'Total' } = {}) {
  let running = 0
  const out = (data || []).map((entry) => {
    const delta = entry.value || 0
    // A decrease hangs DOWN from the running total, so its base is where it
    // ends up, not where it started.
    const base = delta >= 0 ? running : running + delta
    running += delta
    return {
      name: entry.name,
      base,
      delta: Math.abs(delta),
      value: delta,
      running,
      // The sign decides the colour; a bridge where a fall looks like a rise
      // is worse than no chart.
      direction: delta >= 0 ? 'up' : 'down',
    }
  })

  if (includeTotal && out.length > 0) {
    out.push({ name: totalLabel, base: Math.min(0, running), delta: Math.abs(running), value: running, running, direction: 'total' })
  }
  return out
}

/**
 * Pareto: bars descending, plus the cumulative share as a line.
 *
 * The whole point of the chart is the 80% crossing -- "these four categories
 * are four fifths of the problem" -- so the cumulative percentage is computed
 * here rather than left to the eye.
 */
export function paretoData(data) {
  const sorted = [...(data || [])].sort((a, b) => b.value - a.value)
  const total = sorted.reduce((sum, entry) => sum + (entry.value || 0), 0)
  let running = 0
  return sorted.map((entry) => {
    running += entry.value || 0
    return {
      ...entry,
      cumulative: running,
      // With no total there is no share to speak of; zero is the honest
      // answer and it keeps the line off the top of the chart.
      cumulativePct: total > 0 ? (running / total) * 100 : 0,
    }
  })
}

/**
 * Axis ticks at a fixed interval -- "steps of 50", "steps of 100".
 *
 * Recharts picks its own round numbers by default, which is usually right
 * but can't express "this chart is read in hundreds". Given a step, the
 * domain is rounded OUTWARD to the next multiple so the topmost bar always
 * has headroom and never touches the frame.
 *
 * Reference lines are included in the domain: a target line above every bar
 * would otherwise be clipped off the top of the chart, which is precisely
 * when you most need to see it.
 */
export function axisTicks(data, step, references = []) {
  const size = toNumber(step)
  if (size === null || size <= 0) return null

  const values = [
    ...(data || []).map((d) => d.value),
    ...references.map((r) => r.y),
  ].filter((n) => Number.isFinite(n))
  if (values.length === 0) return null

  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)

  const hi = Math.ceil(max / size) * size
  const lo = Math.floor(min / size) * size

  // A step that would produce hundreds of gridlines is a mistake, not an
  // instruction -- fall back to letting recharts choose.
  const count = (hi - lo) / size
  if (count > 200) return null

  const ticks = []
  for (let v = lo; v <= hi + size / 2; v += size) ticks.push(Number(v.toFixed(6)))
  return { ticks, domain: [lo, hi] }
}
