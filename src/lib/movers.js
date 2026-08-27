// ---------------------------------------------------------------------
// Top movers -- what changed, rather than what is big
// ---------------------------------------------------------------------
// A leaderboard answers "who is biggest". After the first week nobody
// reads it, because the answer is the same every week and everybody
// already knows it. The question that stays interesting is "what is
// DIFFERENT from last time" -- which branch fell off a cliff, which model
// suddenly doubled -- and no widget in the app could answer it.
//
// The trap in a movers list is that percentage change is dominated by tiny
// numbers. A dealer who sold one car last month and three this month is up
// 200%, and will out-rank the branch that went from 400 to 480 every
// single week. That is not a finding, it is arithmetic noise.
//
// So there are two defences, and both are on by default:
//
//   - Rank by ABSOLUTE change by default, not percentage. +80 beats +2.
//   - A floor: a group has to clear a minimum on one side or the other
//     before it is eligible at all.
//
// Two ways to say what "before" means: two condition sets (this quarter vs
// last), or two windows on a date column (the last 30 days vs the 30
// before). Same output either way.

import { aggregate, formatNumber, isBlank, startOfDay, toDate } from './dataUtils.js'
import { matchesConditions } from './filterEngine.js'

export const MOVER_PERIODS = [
  { value: 'date', label: 'Two windows on a date column' },
  { value: 'conditions', label: 'Two rules you write' },
]

export const MOVER_RANKS = [
  { value: 'abs_change', label: 'Biggest change, either way' },
  { value: 'gain', label: 'Biggest gains first' },
  { value: 'loss', label: 'Biggest falls first' },
  { value: 'percent', label: 'Biggest percentage change' },
]

export const DEFAULT_MOVERS = {
  groupBy: '',
  aggregation: 'count',
  column: null,
  format: 'comma',
  periodMode: 'date',
  dateColumn: '',
  periodDays: 30,
  matchNow: 'all',
  conditionsNow: [],
  matchBefore: 'all',
  conditionsBefore: [],
  limit: 8,
  rank: 'abs_change',
  // The floor. Expressed on the metric itself rather than on the row count,
  // because for a sum the row count says nothing about whether the change
  // is worth reading.
  minimum: 0,
  lowerIsBetter: false,
  showNew: true,
  showGone: true,
  splitDirections: true,
  colorUp: '#059669',
  colorDown: '#DC2626',
}

const DAY_MS = 86400000

function scoped(rows, conditions, match, dateOrder) {
  const conds = (conditions || []).filter((c) => c.column)
  if (conds.length === 0) return rows
  return rows.filter((row) => matchesConditions(row, conds, match || 'all', dateOrder))
}

/**
 * The two sets of rows being compared.
 *
 * With a date column the windows are adjacent and equal in length, anchored
 * on today. With conditions they are whatever the admin wrote -- including,
 * deliberately, overlapping sets, because "financed vs all" is a
 * comparison somebody legitimately wants even though it is not a period.
 */
export function moverPeriods(rows, config, dateOrder = 'DMY', today = new Date()) {
  if (config.periodMode === 'conditions') {
    return {
      now: scoped(rows, config.conditionsNow, config.matchNow, dateOrder),
      before: scoped(rows, config.conditionsBefore, config.matchBefore, dateOrder),
      nowLabel: 'Now',
      beforeLabel: 'Before',
    }
  }

  const span = Math.max(1, Math.min(3650, Math.round(Number(config.periodDays) || 30)))
  if (!config.dateColumn) return { now: [], before: [], nowLabel: '', beforeLabel: '', missingDate: true }

  const todayMs = startOfDay(today).getTime()
  const nowFrom = todayMs - (span - 1) * DAY_MS
  const beforeFrom = nowFrom - span * DAY_MS

  const now = []
  const before = []
  for (const row of rows || []) {
    const d = toDate(row[config.dateColumn], dateOrder)
    if (!d) continue
    const ms = startOfDay(d).getTime()
    if (ms > todayMs) continue
    if (ms >= nowFrom) now.push(row)
    else if (ms >= beforeFrom) before.push(row)
  }

  return { now, before, nowLabel: `Last ${span} days`, beforeLabel: `Previous ${span} days`, span }
}

const RANKERS = {
  abs_change: (a, b) => Math.abs(b.change) - Math.abs(a.change),
  gain: (a, b) => b.change - a.change,
  loss: (a, b) => a.change - b.change,
  percent: (a, b) => Math.abs(b.percent ?? 0) - Math.abs(a.percent ?? 0),
}

/** Every group, with what it did in each period and how that reads. */
export function moversData(widget, { rows = [], dateOrder = 'DMY', today } = {}) {
  const config = { ...DEFAULT_MOVERS, ...(widget || {}) }
  if (!config.groupBy) return { ready: false, movers: [], reason: 'Pick a column to group by' }

  const periods = moverPeriods(rows, config, dateOrder, today || new Date())
  if (periods.missingDate) return { ready: false, movers: [], reason: 'Pick a date column' }

  const agg = config.aggregation || 'count'
  const key = (row) => (isBlank(row[config.groupBy]) ? '(blank)' : String(row[config.groupBy]).trim())

  const bucket = (list) => {
    const map = new Map()
    for (const row of list) {
      const k = key(row)
      const found = map.get(k)
      if (found) found.push(row)
      else map.set(k, [row])
    }
    return map
  }

  const nowRows = bucket(periods.now)
  const beforeRows = bucket(periods.before)
  const names = new Set([...nowRows.keys(), ...beforeRows.keys()])

  const minimum = Math.max(0, Number(config.minimum) || 0)
  const all = []

  for (const name of names) {
    const nowList = nowRows.get(name) || []
    const beforeList = beforeRows.get(name) || []
    const now = aggregate(nowList, config.column, agg)
    const before = aggregate(beforeList, config.column, agg)
    const change = now - before

    // The floor is checked against the LARGER side. Checking the smaller
    // one would drop exactly the groups that collapsed to nothing, which
    // are the most important movers on the list.
    if (Math.max(Math.abs(now), Math.abs(before)) < minimum) continue
    if (change === 0 && now === 0) continue

    const isNew = beforeList.length === 0 && nowList.length > 0
    const isGone = nowList.length === 0 && beforeList.length > 0
    if (isNew && !config.showNew) continue
    if (isGone && !config.showGone) continue

    all.push({
      name,
      now,
      before,
      change,
      nowRows: nowList,
      beforeRows: beforeList,
      // Null rather than Infinity when there was nothing to grow from. A
      // "+∞%" on a dashboard is a rendering artefact, not a measurement.
      percent: before === 0 ? null : ((now - before) / Math.abs(before)) * 100,
      isNew,
      isGone,
      formatted: formatNumber(now, config.format, agg),
      beforeFormatted: formatNumber(before, config.format, agg),
      changeFormatted: formatNumber(change, 'signed', agg),
      tone: change === 0 ? 'flat' : (config.lowerIsBetter ? change < 0 : change > 0) ? 'good' : 'bad',
    })
  }

  all.sort(RANKERS[config.rank] || RANKERS.abs_change)
  const limit = Math.max(1, Math.min(50, Math.round(Number(config.limit) || 8)))

  // Split view shows the top N of each direction rather than the top N
  // overall -- otherwise a week where everything grew shows nothing but
  // gains, and "nothing fell" is a claim the widget has not checked.
  const gains = all.filter((m) => m.change > 0).sort(RANKERS.gain).slice(0, limit)
  const falls = all.filter((m) => m.change < 0).sort(RANKERS.loss).slice(0, limit)

  const biggest = Math.max(1, ...all.map((m) => Math.abs(m.change)))

  const withBar = (list) => list.map((m) => ({ ...m, magnitude: Math.abs(m.change) / biggest }))

  return {
    ready: true,
    movers: withBar(all.slice(0, limit)),
    gains: withBar(gains),
    falls: withBar(falls),
    total: all.length,
    hidden: Math.max(0, all.length - limit),
    nowLabel: periods.nowLabel,
    beforeLabel: periods.beforeLabel,
    nowCount: periods.now.length,
    beforeCount: periods.before.length,
    span: periods.span,
  }
}
