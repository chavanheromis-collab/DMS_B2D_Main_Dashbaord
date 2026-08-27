// ---------------------------------------------------------------------
// Bullet chart -- actual against target, on one line
// ---------------------------------------------------------------------
// A gauge answers "how far to the target" using a quarter of a card and a
// semicircle. That is fine for one metric and hopeless for eight, which is
// what a review meeting actually has: eight targets, and the question is
// which of them is in trouble.
//
// A bullet chart is the answer to that question. One horizontal line per
// metric: a bar for what happened, a tick for what was promised, and
// shaded bands behind both saying what counts as poor, fair and good.
// Eight of them stack into the height of two gauges and can be scanned in
// one pass, because every bar shares an axis and the ticks line up.
//
// The bands are the part people skip and the part that does the work.
// Without them a bar at 84% of target is a number; with them it is
// "comfortably inside the fair band, nowhere near good", which is a
// sentence somebody can act on.
//
// Pure: rows and a config in, geometry out.

import { aggregate, formatNumber } from './dataUtils.js'
import { matchesConditions } from './filterEngine.js'

/**
 * Where the bands come from.
 *
 * Percentages of the target are the default because that is how targets
 * are discussed ("anything under 70% is a problem") and because they stay
 * right when the target changes. Absolute numbers exist for the metrics
 * where the thresholds are the real decision and the target is derived
 * from them rather than the other way round.
 */
export const BAND_MODES = [
  { value: 'percent', label: 'Percentages of the target', hint: 'Move the target, the bands follow.' },
  { value: 'absolute', label: 'Fixed numbers', hint: 'The thresholds are the decision.' },
]

export const DEFAULT_BULLET_ROW = {
  label: 'Metric',
  aggregation: 'count',
  column: null,
  format: 'comma',
  match: 'all',
  conditions: [],
  // The target, either typed or measured the same way the actual is. A
  // measured target is what "last year's number" means -- the commitment
  // is to beat something that itself moves.
  targetMode: 'fixed',
  target: 100,
  targetAggregation: 'count',
  targetColumn: null,
  targetMatch: 'all',
  targetConditions: [],
  color: '#4F46E5',
  lowerIsBetter: false,
}

export const DEFAULT_BULLET = {
  rows: [],
  bandMode: 'percent',
  // Two numbers, three bands: everything under `poor` is poor, everything
  // over `good` is good, the gap between them is fair. Two thresholds
  // rather than three ranges because ranges can be made to overlap or leave
  // a gap, and there is no sensible thing to draw when they do.
  poorAt: 60,
  goodAt: 90,
  bandColors: ['#FEE2E2', '#FEF3C7', '#DCFCE7'],
  showValues: true,
  // How far past the target the axis runs. A bar pinned to the right edge
  // cannot show that it OVERSHOT, and overshooting is the outcome everyone
  // most wants to see.
  headroom: 15,
  barHeight: 18,
}

const num = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** The rows one bullet line is allowed to measure. */
function scoped(rows, conditions, match, dateOrder) {
  const conds = (conditions || []).filter((c) => c.column)
  if (conds.length === 0) return rows
  return rows.filter((row) => matchesConditions(row, conds, match || 'all', dateOrder))
}

/**
 * The two band edges as ABSOLUTE numbers on this line's own scale.
 *
 * Sorted, always. An admin who types a "poor" threshold above the "good"
 * one has made a typo, and the honest response is to draw the bands in the
 * order that can exist rather than to render a chart where poor is better
 * than good.
 */
export function bandEdges(config, target) {
  const c = { ...DEFAULT_BULLET, ...(config || {}) }
  const poor = num(c.poorAt, DEFAULT_BULLET.poorAt)
  const good = num(c.goodAt, DEFAULT_BULLET.goodAt)

  const [lo, hi] =
    c.bandMode === 'absolute'
      ? [poor, good]
      : [(target * poor) / 100, (target * good) / 100]

  return lo <= hi ? [lo, hi] : [hi, lo]
}

/** Which band a value falls in. Half-open upwards, so nothing lands in two. */
export function bandOf(value, [lo, hi], lowerIsBetter = false) {
  // With a lower-is-better metric the bands still sit where they sit on the
  // axis -- what flips is which END of it is the good news. Reading the
  // band by position and then relabelling it is the only way the colours
  // and the words stay in agreement.
  const position = value < lo ? 'low' : value < hi ? 'mid' : 'high'
  if (position === 'mid') return 'fair'
  const isGood = lowerIsBetter ? position === 'low' : position === 'high'
  return isGood ? 'good' : 'poor'
}

/**
 * One bullet line, ready to draw.
 *
 * Every geometry number comes back as a FRACTION of the axis rather than a
 * pixel, because the component that draws this does not know how wide it
 * is until it is on screen -- and a percentage width is the one thing CSS
 * can turn into pixels without being told.
 */
export function bulletRow(raw, { rows = [], dateOrder = 'DMY', config } = {}) {
  const row = { ...DEFAULT_BULLET_ROW, ...raw }
  const c = { ...DEFAULT_BULLET, ...(config || {}) }

  const actualRows = scoped(rows, row.conditions, row.match, dateOrder)
  const value = aggregate(actualRows, row.column, row.aggregation || 'count')

  const target =
    row.targetMode === 'measured'
      ? aggregate(
          scoped(rows, row.targetConditions, row.targetMatch, dateOrder),
          row.targetColumn,
          row.targetAggregation || 'count'
        )
      : num(row.target, 0)

  const edges = bandEdges(c, target)

  // The axis has to hold the biggest thing on the line, whichever it is --
  // an overshoot, a band edge above the target, or the target itself.
  const headroom = Math.max(0, num(c.headroom, DEFAULT_BULLET.headroom)) / 100
  const ceiling = Math.max(value, target, edges[1], 0) * (1 + headroom) || 1

  const frac = (v) => Math.max(0, Math.min(1, v / ceiling))
  const band = bandOf(value, edges, row.lowerIsBetter)

  return {
    id: row.id,
    label: row.label || 'Metric',
    color: row.color || DEFAULT_BULLET_ROW.color,
    value,
    target,
    formatted: formatNumber(value, row.format, row.aggregation),
    targetFormatted: formatNumber(target, row.format, row.targetAggregation || row.aggregation),
    // How far past (or short of) the promise, as the percentage people
    // actually say out loud: "we're at 112% of target".
    attainment: target !== 0 ? (value / target) * 100 : null,
    band,
    ceiling,
    valueFraction: frac(value),
    targetFraction: frac(target),
    // Three widths that tile the axis exactly, so no rounding gap shows
    // between the bands as a hairline of card background.
    bands: [
      { key: 'poor', width: frac(edges[0]), color: c.bandColors?.[0] || DEFAULT_BULLET.bandColors[0] },
      { key: 'fair', width: frac(edges[1]) - frac(edges[0]), color: c.bandColors?.[1] || DEFAULT_BULLET.bandColors[1] },
      { key: 'good', width: 1 - frac(edges[1]), color: c.bandColors?.[2] || DEFAULT_BULLET.bandColors[2] },
    ],
    conditions: (row.conditions || []).filter((x) => x.column),
    match: row.match || 'all',
  }
}

/** Every line on the chart. */
export function bulletRows(widget, { rows = [], dateOrder = 'DMY' } = {}) {
  const config = { ...DEFAULT_BULLET, ...(widget || {}) }
  const list = (config.rows || []).length ? config.rows : [{ ...DEFAULT_BULLET_ROW, id: 'bullet_default' }]
  return list.map((row, i) => bulletRow({ id: `bullet_${i}`, ...row }, { rows, dateOrder, config }))
}
