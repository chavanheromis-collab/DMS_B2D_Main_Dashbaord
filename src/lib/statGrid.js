// ---------------------------------------------------------------------
// Stat Grid -- several numbers in one card
// ---------------------------------------------------------------------
// A KPI card is one number and one card. That is right for the number a
// page is ABOUT, and wrong for the six supporting figures underneath it:
// six cards is six borders, six titles and six shadows for six small
// numbers nobody is looking at individually.
//
// So this is one card holding a grid of stats, each with its own
// calculation, its own rule about which rows count, and -- the part a KPI
// card never had -- its own answer to "compared to what?".
//
// "Compared to what" is the whole reason a number on a dashboard means
// anything. 412 enquiries is not information; 412, up 18% on the month
// before, against a target of 500, is. Five comparison modes, because the
// honest baseline differs by metric:
//
//   none        -- the number stands alone (a stock level, a headcount)
//   unfiltered  -- against the same metric before the page's filters
//   previous    -- against the period immediately before this one
//   conditions  -- against the same metric under a different rule
//   target      -- against a number somebody committed to
//
// Pure: rows in, numbers out. Nothing here renders anything, which is what
// lets every one of these decisions be tested without a browser.

import { aggregate, formatNumber, startOfDay, toDate } from './dataUtils.js'
import { matchesConditions } from './filterEngine.js'

export const COMPARE_MODES = [
  { value: 'none', label: 'Nothing — just the number' },
  { value: 'unfiltered', label: 'The same figure before the page filters' },
  { value: 'previous', label: 'The period immediately before this one' },
  { value: 'conditions', label: 'The same figure under a different rule' },
  { value: 'target', label: 'A target somebody typed' },
]

export const STAT_LAYOUTS = [
  { value: 'tiles', label: 'Tiles — a tinted panel each', hint: 'The accent colour reads as a group.' },
  { value: 'plain', label: 'Plain — numbers on the card', hint: 'Quietest. Good under a chart.' },
  { value: 'ruled', label: 'Ruled — divided by hairlines', hint: 'Reads as a table of figures.' },
  { value: 'rows', label: 'Rows — one per line, label left', hint: 'Best in a narrow column.' },
]

/** A stat with nothing configured still draws a row count, so it is never blank. */
export const DEFAULT_STAT = {
  label: 'Rows',
  icon: '',
  color: '#4F46E5',
  aggregation: 'count',
  column: null,
  format: 'comma',
  match: 'all',
  conditions: [],
  compare: 'none',
  compareMatch: 'all',
  compareConditions: [],
  target: 100,
  // Which direction is the good one. Not cosmetic: it decides whether a
  // fall is drawn green or red, and getting that backwards on a "days to
  // deliver" metric turns an improvement into an alarm.
  lowerIsBetter: false,
}

export const DEFAULT_STAT_GRID = {
  columns: 3,
  layout: 'tiles',
  showSparkline: true,
  sparkDays: 30,
  dateColumn: '',
  // The window `compare: 'previous'` measures, in days. 30 against the 30
  // before is the common reading of "this month vs last".
  periodDays: 30,
  stats: [],
}

const clampInt = (value, lo, hi, fallback) => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, n))
}

/** The rows one stat is allowed to count. */
function scoped(rows, conditions, match, dateOrder) {
  const conds = (conditions || []).filter((c) => c.column)
  if (conds.length === 0) return rows
  return rows.filter((row) => matchesConditions(row, conds, match || 'all', dateOrder))
}

/**
 * Rows split into "this period" and "the one before it".
 *
 * Both windows are the same length and they do not overlap, which is the
 * only way the two numbers are comparable at all. Anchored on TODAY rather
 * than on the newest row in the data: a sheet that stopped updating a week
 * ago should show a falling number, not a flattering one measured against
 * a window that quietly moved with it.
 */
export function splitPeriods(rows, dateColumn, days, dateOrder = 'DMY') {
  const span = clampInt(days, 1, 3650, 30)
  if (!dateColumn) return { current: [], previous: [], span }

  const todayMs = startOfDay(new Date()).getTime()
  const currentFrom = todayMs - (span - 1) * 86400000
  const previousFrom = currentFrom - span * 86400000

  const current = []
  const previous = []
  for (const row of rows || []) {
    const d = toDate(row[dateColumn], dateOrder)
    if (!d) continue
    const ms = startOfDay(d).getTime()
    if (ms > todayMs) continue
    if (ms >= currentFrom) current.push(row)
    else if (ms >= previousFrom) previous.push(row)
  }
  return { current, previous, span }
}

/**
 * The baseline one stat is measured against, and what to call it.
 *
 * Returns `null` where there is no honest comparison to draw -- which is a
 * real answer, not a failure. A stat with no baseline shows its number and
 * says nothing about change, rather than inventing a zero to be up from.
 */
export function baselineFor(stat, { rows, unfilteredRows, dateColumn, periodDays, dateOrder = 'DMY' }) {
  const mode = stat.compare || 'none'
  const agg = stat.aggregation || 'count'

  if (mode === 'unfiltered') {
    const base = scoped(unfilteredRows || [], stat.conditions, stat.match, dateOrder)
    return { value: aggregate(base, stat.column, agg), label: 'unfiltered' }
  }

  if (mode === 'conditions') {
    const conds = (stat.compareConditions || []).filter((c) => c.column)
    if (conds.length === 0) return null
    const base = scoped(rows || [], conds, stat.compareMatch, dateOrder)
    return { value: aggregate(base, stat.column, agg), label: 'the other rule' }
  }

  if (mode === 'target') {
    const target = Number(stat.target)
    if (!Number.isFinite(target)) return null
    return { value: target, label: 'target', isTarget: true }
  }

  if (mode === 'previous') {
    if (!dateColumn) return null
    const eligible = scoped(rows || [], stat.conditions, stat.match, dateOrder)
    const { previous, span } = splitPeriods(eligible, dateColumn, periodDays, dateOrder)
    return { value: aggregate(previous, stat.column, agg), label: `previous ${span} days` }
  }

  return null
}

/**
 * How a change should READ -- good, bad or neither.
 *
 * Separated from the arithmetic because the sign of a delta and its meaning
 * are different facts. Deliveries falling and complaints falling are the
 * same minus sign and opposite news, and only the widget's own
 * `lowerIsBetter` can tell them apart.
 */
export function toneFor(delta, lowerIsBetter) {
  if (!Number.isFinite(delta) || delta === 0) return 'flat'
  const up = delta > 0
  return (lowerIsBetter ? !up : up) ? 'good' : 'bad'
}

/**
 * A percentage change that stays honest when the baseline is zero.
 *
 * Going from 0 to 5 is not "up 500%" and it is certainly not "up ∞" -- it
 * is a start from nothing, and the only truthful thing to show is the
 * absolute change. Returning `null` says exactly that, and lets the widget
 * print "+5" rather than a percentage nobody can act on.
 */
export function percentChange(value, baseline) {
  if (!Number.isFinite(value) || !Number.isFinite(baseline)) return null
  if (baseline === 0) return null
  return ((value - baseline) / Math.abs(baseline)) * 100
}

/**
 * Every stat in the grid, computed.
 *
 * The current period is applied ONLY when a stat is comparing against the
 * previous one. A stat asking for no comparison should count everything the
 * page is showing -- silently narrowing it to the last thirty days because
 * a sibling stat wanted a trend would make the same metric read differently
 * depending on what was configured next to it.
 */
export function computeStats(widget, { rows = [], unfilteredRows = [], dateOrder = 'DMY' } = {}) {
  const grid = { ...DEFAULT_STAT_GRID, ...(widget || {}) }
  const stats = (grid.stats || []).length ? grid.stats : [{ ...DEFAULT_STAT, id: 'stat_default' }]
  const dateColumn = grid.dateColumn || ''
  const periodDays = clampInt(grid.periodDays, 1, 3650, 30)
  const sparkDays = clampInt(grid.sparkDays, 2, 365, 30)

  return stats.map((raw, index) => {
    const stat = { ...DEFAULT_STAT, ...raw }
    const agg = stat.aggregation || 'count'
    const eligible = scoped(rows, stat.conditions, stat.match, dateOrder)

    // Only the "previous period" comparison changes what the headline
    // number counts, and it has to: comparing all-time against the last
    // thirty days is not a comparison, it is a category error.
    const windowed =
      stat.compare === 'previous' && dateColumn
        ? splitPeriods(eligible, dateColumn, periodDays, dateOrder).current
        : eligible

    const value = aggregate(windowed, stat.column, agg)
    const baseline = baselineFor(stat, { rows, unfilteredRows, dateColumn, periodDays, dateOrder })

    const delta = baseline ? value - baseline.value : null
    const pct = baseline ? percentChange(value, baseline.value) : null

    return {
      id: stat.id || `stat_${index}`,
      label: stat.label || `Stat ${index + 1}`,
      icon: stat.icon || '',
      color: stat.color || DEFAULT_STAT.color,
      value,
      formatted: formatNumber(value, stat.format, agg),
      rowCount: windowed.length,
      baseline,
      delta,
      deltaFormatted: delta === null ? null : formatNumber(delta, 'signed', agg),
      percent: pct,
      tone: delta === null ? 'flat' : toneFor(delta, stat.lowerIsBetter),
      // Progress only means something against a target. Against last month
      // a bar filling up says nothing, so it is not drawn.
      progress:
        baseline?.isTarget && baseline.value > 0
          ? Math.max(0, Math.min(1, value / baseline.value))
          : null,
      // The sparkline is a COUNT of rows per day, always -- it is showing
      // activity, not the metric. Summing a median over a day would be a
      // number with no meaning, and a line nobody could interpret.
      sparkSource: grid.showSparkline && dateColumn ? eligible : null,
      sparkDays,
      lowerIsBetter: !!stat.lowerIsBetter,
    }
  })
}

/** Columns for the grid, clamped to what actually fits on a card. */
export function statColumns(widget) {
  return clampInt(widget?.columns, 1, 6, 3)
}
