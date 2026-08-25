// ---------------------------------------------------------------------
// The briefing -- what somebody who runs the business needs to be told
// ---------------------------------------------------------------------
// Every other widget here answers a question you already knew to ask. A
// chart shows stock by model *once you have decided* that stock by model is
// the thing to look at. That is the analyst's job, and the analyst is not
// the person the dashboard is usually open in front of.
//
// An MD opening this at 8am is not asking "show me a breakdown". They are
// asking four things, in this order:
//
//   What changed since I last looked?
//   What is wrong right now, and how much is it worth?
//   Where exactly is it?
//   Show me those rows.
//
// So this reads the table and WRITES THOSE ANSWERS, as sentences, ranked by
// how much money is behind them. Not a shape to interpret -- a short list of
// findings, each with the number in it, each clickable through to the exact
// rows it is talking about.
//
// Three rules it must never break.
//
//   NOTHING WITHOUT ITS ARITHMETIC. Every finding carries the rows and the
//   value it was computed from, and the conditions that select them, so it
//   can be checked rather than believed. A dashboard that asserts things it
//   cannot show you is worse than one that asserts nothing.
//
//   NOTHING IMMATERIAL. A three-row anomaly in a forty-thousand-row sheet is
//   noise, and a briefing full of noise gets closed. Findings are ranked by
//   share of the measure, and the small ones are dropped rather than listed
//   at the bottom.
//
//   NEVER A PARTIAL PERIOD AGAINST A WHOLE ONE. "Down 60% on last month" on
//   the 4th of the month is the single most common lie a dashboard tells.
//   Movement here is always a rolling window against the window before it,
//   which is the same length by construction.

import { aggregate, isBlank, toDate } from './dataUtils.js'

export const SEVERITIES = ['high', 'medium', 'low']

export const DEFAULT_BRIEFING = {
  // Which columns are worth being told about. Everything else is ignored --
  // a briefing that reported on `_row` would be a briefing nobody reads.
  dimensions: [],
  valueColumn: null,
  aggregation: 'count',
  format: 'comma',
  dateColumn: '',
  // The rolling window, in days, for "what changed".
  windowDays: 30,
  // Age thresholds, oldest first: the first one with material volume behind
  // it is the one reported.
  ageDays: [90, 60, 30],
  // A finding has to be worth at least this share of the measure to be
  // shown at all.
  minShare: 0.05,
  checks: { concentration: true, aging: true, movement: true, outliers: true, quality: true },
  // Admin-written watches: a condition set, a threshold and a severity.
  watches: [],
  limit: 6,
}

const MS_PER_DAY = 86400000
const groupKey = (row, column) => {
  const raw = row?.[column]
  return isBlank(raw) ? '' : String(raw).trim()
}

/** Severity from how much of the measure a finding accounts for. */
export function severityFor(share, { high = 0.25, medium = 0.1 } = {}) {
  const s = Math.abs(Number(share) || 0)
  if (s >= high) return 'high'
  if (s >= medium) return 'medium'
  return 'low'
}

/** The measure, over a set of rows. One place, so every check agrees. */
function measure(rows, config) {
  return aggregate(rows || [], config.valueColumn, config.aggregation || 'count')
}

/** Rows grouped by one column, biggest first. */
function byGroup(rows, column, config) {
  const map = new Map()
  for (const row of rows || []) {
    const key = groupKey(row, column)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(row)
  }
  return Array.from(map, ([name, list]) => ({
    name,
    rows: list,
    count: list.length,
    value: measure(list, config),
  })).sort((a, b) => b.value - a.value)
}

/** The condition that selects one group -- blank included, properly. */
function selectGroup(column, name) {
  return name === ''
    ? [{ column, operator: 'is_empty', value: '' }]
    : [{ column, operator: 'equals', value: name }]
}

// ---------------------------------------------------------------------
// Where it is concentrated
// ---------------------------------------------------------------------
/**
 * "Four of thirty-one locations hold 68% of it."
 *
 * The first thing anybody running something wants to know about a number is
 * how evenly it is spread, because that decides whether the problem is a
 * systems problem or a two-phone-calls problem. Reported as the SMALLEST
 * set of groups that clears the threshold, which is the form the answer is
 * useful in.
 */
export function concentrationFinding(rows, config, column) {
  const groups = byGroup(rows, column, config).filter((g) => g.value > 0)
  const total = groups.reduce((sum, g) => sum + g.value, 0)
  if (groups.length < 4 || total <= 0) return null

  const target = total * 0.6
  let running = 0
  let taken = 0
  for (const group of groups) {
    running += group.value
    taken += 1
    if (running >= target) break
  }

  // Half the groups holding 60% is just arithmetic. It is only worth saying
  // when it is lopsided.
  if (taken / groups.length > 0.35) return null

  const top = groups.slice(0, taken)
  const share = running / total
  return {
    id: `concentration:${column}`,
    kind: 'concentration',
    column,
    severity: severityFor(share, { high: 0.75, medium: 0.6 }),
    headline: `${taken} of ${groups.length} ${plural(column)} hold ${pct(share)} of it`,
    detail: top
      .slice(0, 4)
      .map((g) => `${label(g.name)} ${pct(g.value / total)}`)
      .join(' · '),
    value: running,
    rows: top.reduce((sum, g) => sum + g.count, 0),
    share,
    // Drilling a concentration means "show me those few", which is an OR.
    conditions: top.flatMap((g) => selectGroup(column, g.name)),
    match: 'any',
  }
}

// ---------------------------------------------------------------------
// What is getting old
// ---------------------------------------------------------------------
/**
 * "312 units have been sitting for over 90 days -- 24% of everything."
 *
 * Age is the number a dashboard is worst at showing and a business is most
 * hurt by, because nothing about a row changes when it gets old. The
 * thresholds are tried oldest-first and the first one with material volume
 * wins: being told about the 30-day pile when there is a 90-day pile is
 * being told the smaller thing.
 */
export function agingFinding(rows, config, { today = new Date() } = {}) {
  const column = config.dateColumn
  if (!column) return null

  const dateOrder = config.dateOrder || 'DMY'
  const total = measure(rows, config)
  if (total <= 0) return null

  const aged = (days) =>
    (rows || []).filter((row) => {
      const date = toDate(row[column], dateOrder)
      if (!date) return false
      return (today - date) / MS_PER_DAY >= days
    })

  for (const days of [...(config.ageDays || DEFAULT_BRIEFING.ageDays)].sort((a, b) => b - a)) {
    const list = aged(days)
    if (list.length === 0) continue
    const value = measure(list, config)
    const share = total > 0 ? value / total : 0
    if (share < (config.minShare ?? DEFAULT_BRIEFING.minShare)) continue

    return {
      id: `aging:${days}`,
      kind: 'aging',
      column,
      severity: severityFor(share),
      headline: `${count(list.length)} have been sitting over ${days} days`,
      detail: `${pct(share)} of the total, by ${column}`,
      value,
      rows: list.length,
      share,
      // An ABSOLUTE cutoff, not "older than 90 days". A relative
      // condition is re-evaluated whenever the reader clicks it, so a
      // finding written at 8am and drilled at midnight would select a
      // different set of rows from the one it counted.
      conditions: [{ column, operator: 'date_before', value: isoDay(new Date(today.getTime() - days * MS_PER_DAY)) }],
      match: 'all',
    }
  }
  return null
}

// ---------------------------------------------------------------------
// What changed
// ---------------------------------------------------------------------
/**
 * "Down 18% on the previous 30 days -- Pune accounts for most of it."
 *
 * Always a rolling window against the window before it. Comparing a
 * part-finished month to a whole one is the single most common lie a
 * dashboard tells, and it is told by accident every time somebody groups by
 * calendar month and reads the last bar.
 */
export function movementFindings(rows, config, { today = new Date() } = {}) {
  const column = config.dateColumn
  const days = Number(config.windowDays) || DEFAULT_BRIEFING.windowDays
  if (!column || !days) return []

  const dateOrder = config.dateOrder || 'DMY'
  const now = today.getTime()
  const cut = now - days * MS_PER_DAY
  const back = now - days * 2 * MS_PER_DAY

  const current = []
  const previous = []
  for (const row of rows || []) {
    const date = toDate(row[column], dateOrder)
    if (!date) continue
    const t = date.getTime()
    if (t > now) continue
    if (t >= cut) current.push(row)
    else if (t >= back) previous.push(row)
  }
  if (current.length === 0 && previous.length === 0) return []

  const out = []
  const nowValue = measure(current, config)
  const wasValue = measure(previous, config)
  const change = wasValue > 0 ? (nowValue - wasValue) / wasValue : null

  // Absolute, for the same reason: the window that was measured is the
  // window the click has to show.
  const windowConditions = [
    { column, operator: 'date_between', value: isoDay(new Date(cut)), value2: isoDay(new Date(now)) },
  ]

  if (change !== null && Math.abs(change) >= 0.1) {
    out.push({
      id: 'movement:total',
      kind: 'movement',
      column,
      severity: severityFor(change, { high: 0.3, medium: 0.15 }),
      direction: change < 0 ? 'down' : 'up',
      headline: `${change < 0 ? 'Down' : 'Up'} ${pct(Math.abs(change))} on the previous ${days} days`,
      detail: `${short(nowValue)} in the last ${days} days, against ${short(wasValue)} before that`,
      value: Math.abs(nowValue - wasValue),
      rows: current.length,
      share: Math.abs(change),
      conditions: windowConditions,
      match: 'all',
    })
  }

  // And who moved. One riser and one faller at most: a briefing is a
  // briefing, not a variance report.
  const dimension = (config.dimensions || [])[0]
  if (dimension) {
    const nowBy = new Map(byGroup(current, dimension, config).map((g) => [g.name, g]))
    const wasBy = new Map(byGroup(previous, dimension, config).map((g) => [g.name, g]))
    const names = new Set([...nowBy.keys(), ...wasBy.keys()])

    const moves = []
    for (const name of names) {
      const a = nowBy.get(name)?.value || 0
      const b = wasBy.get(name)?.value || 0
      const delta = a - b
      if (delta === 0) continue
      const share = wasValue > 0 ? Math.abs(delta) / wasValue : 0
      if (share < (config.minShare ?? DEFAULT_BRIEFING.minShare)) continue
      moves.push({ name, delta, share, a, b, rows: nowBy.get(name)?.count || 0 })
    }
    moves.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))

    const faller = moves.find((m) => m.delta < 0)
    const riser = moves.find((m) => m.delta > 0)

    for (const move of [faller, riser].filter(Boolean)) {
      out.push({
        id: `movement:${dimension}:${move.name}`,
        kind: 'movement',
        column: dimension,
        severity: severityFor(move.share, { high: 0.2, medium: 0.1 }),
        direction: move.delta < 0 ? 'down' : 'up',
        headline: `${label(move.name)} is ${move.delta < 0 ? 'down' : 'up'} ${short(Math.abs(move.delta))} on the previous ${days} days`,
        detail: `${short(move.b)} → ${short(move.a)}, ${pct(move.share)} of the whole period's movement`,
        value: Math.abs(move.delta),
        rows: move.rows,
        share: move.share,
        conditions: [...selectGroup(dimension, move.name), ...windowConditions],
        match: 'all',
      })
    }
  }

  return out
}

// ---------------------------------------------------------------------
// What is out of line
// ---------------------------------------------------------------------
/**
 * A group a long way from what its peers look like.
 *
 * Measured against the MEDIAN and the median absolute deviation, not the
 * mean and the standard deviation. One enormous branch drags a mean far
 * enough to hide itself -- the outlier becomes the thing that defines
 * normal -- and the whole point here is to find that branch.
 */
export function outlierFinding(rows, config, column) {
  const groups = byGroup(rows, column, config).filter((g) => g.name !== '' && g.count > 0)
  if (groups.length < 5) return null

  const per = groups.map((g) => g.value / g.count)
  const mid = median(per)
  const deviations = per.map((v) => Math.abs(v - mid))

  // The median deviation is the robust choice, but it is ZERO whenever more
  // than half the groups are identical -- which is exactly the shape a real
  // outlier makes. Falling back to the mean deviation there keeps the one
  // case this check exists for from being the one case it misses.
  let spread = median(deviations)
  if (!(spread > 0)) spread = deviations.reduce((a, b) => a + b, 0) / (deviations.length || 1)
  if (!(spread > 0)) return null

  const total = groups.reduce((sum, g) => sum + g.value, 0)
  let worst = null
  groups.forEach((group, i) => {
    const score = Math.abs(per[i] - mid) / spread
    const share = total > 0 ? group.value / total : 0
    // Far out AND worth caring about. Either alone is noise.
    if (score < 4 || share < (config.minShare ?? DEFAULT_BRIEFING.minShare)) return
    if (!worst || score > worst.score) worst = { group, score, per: per[i], share }
  })
  if (!worst) return null

  const higher = worst.per > mid
  return {
    id: `outlier:${column}:${worst.group.name}`,
    kind: 'outlier',
    column,
    severity: severityFor(worst.share),
    headline: `${label(worst.group.name)} is ${higher ? 'well above' : 'well below'} every other ${singular(column)}`,
    detail: `${short(worst.per)} per row against a typical ${short(mid)} — ${worst.score.toFixed(1)}× the usual spread`,
    value: worst.group.value,
    rows: worst.group.count,
    share: worst.share,
    conditions: selectGroup(column, worst.group.name),
    match: 'all',
  }
}

// ---------------------------------------------------------------------
// What is missing
// ---------------------------------------------------------------------
/**
 * "One row in five has no Delivery Location."
 *
 * The quiet one. A blank in a column everything else is grouped by does not
 * announce itself -- it just makes every chart on the page slightly wrong,
 * and the wrongness is invisible because the chart still draws. Worth
 * saying out loud before any of the analysis is believed.
 */
export function qualityFinding(rows, config, column) {
  const list = rows || []
  if (list.length === 0) return null

  const blanks = list.filter((row) => isBlank(row[column]))
  if (blanks.length === 0) return null

  const share = blanks.length / list.length
  if (share < 0.05) return null

  const value = measure(blanks, config)
  return {
    id: `quality:${column}`,
    kind: 'quality',
    column,
    severity: severityFor(share, { high: 0.2, medium: 0.1 }),
    headline: `${pct(share)} of rows have no ${column}`,
    detail: `${count(blanks.length)} of ${count(list.length)} — every breakdown by ${column} is missing them`,
    value,
    rows: blanks.length,
    share,
    conditions: [{ column, operator: 'is_empty', value: '' }],
    match: 'all',
  }
}

// ---------------------------------------------------------------------
// What somebody asked to be told about
// ---------------------------------------------------------------------
/**
 * An admin-written watch: a condition set, a threshold, and a sentence.
 *
 * The automatic checks find what is statistically notable. A watch finds
 * what is notable to THIS business -- "tell me when unallocated stock goes
 * over 50" is not a pattern any general rule could have discovered, and it
 * is the finding the MD actually asked for.
 */
export function watchFinding(rows, config, watch, matchesConditions, dateOrder) {
  const conditions = (watch.conditions || []).filter((c) => c.column)
  if (conditions.length === 0 || !watch.label) return null

  const list = (rows || []).filter((row) => matchesConditions(row, conditions, watch.match || 'all', dateOrder))
  const value = measure(list, config)
  const total = measure(rows, config)
  const share = total > 0 ? value / total : 0

  const threshold = Number(watch.threshold)
  const over = Number.isFinite(threshold) ? value >= threshold : list.length > 0
  // A watch that is not tripped is still worth showing as met, quietly --
  // an MD who is told nothing cannot tell "fine" from "not checked".
  return {
    id: `watch:${watch.id}`,
    kind: 'watch',
    column: conditions[0].column,
    severity: over ? watch.severity || 'high' : 'ok',
    tripped: over,
    headline: over
      ? `${watch.label}: ${short(value)}${Number.isFinite(threshold) ? ` (over ${short(threshold)})` : ''}`
      : `${watch.label}: ${short(value)} — within ${short(threshold)}`,
    detail: `${count(list.length)} rows`,
    value,
    rows: list.length,
    share,
    conditions,
    match: watch.match || 'all',
  }
}

// ---------------------------------------------------------------------
// The whole briefing
// ---------------------------------------------------------------------
/**
 * Every check, ranked, trimmed, and honest about what it could not run.
 *
 * `skipped` is not an internal detail: a briefing missing its "what
 * changed" section looks identical to a business where nothing changed,
 * and those are extremely different situations.
 */
export function buildBriefing(rows, config, { matchesConditions, today = new Date(), dateOrder = 'DMY' } = {}) {
  const cfg = { ...DEFAULT_BRIEFING, ...(config || {}), dateOrder }
  const list = rows || []
  const dimensions = (cfg.dimensions || []).filter(Boolean)
  const checks = { ...DEFAULT_BRIEFING.checks, ...(cfg.checks || {}) }

  const findings = []
  const skipped = []

  for (const watch of cfg.watches || []) {
    const found = watchFinding(list, cfg, watch, matchesConditions, dateOrder)
    if (found) findings.push(found)
  }

  if (checks.movement) {
    if (!cfg.dateColumn) skipped.push('What changed — no date column chosen')
    else findings.push(...movementFindings(list, cfg, { today }))
  }

  if (checks.aging) {
    if (!cfg.dateColumn) skipped.push('What is ageing — no date column chosen')
    else {
      const found = agingFinding(list, cfg, { today })
      if (found) findings.push(found)
    }
  }

  if (dimensions.length === 0) {
    skipped.push('Concentration, outliers and blanks — no columns chosen to look at')
  } else {
    for (const column of dimensions) {
      if (checks.concentration) {
        const found = concentrationFinding(list, cfg, column)
        if (found) findings.push(found)
      }
      if (checks.outliers) {
        const found = outlierFinding(list, cfg, column)
        if (found) findings.push(found)
      }
      if (checks.quality) {
        const found = qualityFinding(list, cfg, column)
        if (found) findings.push(found)
      }
    }
  }

  const rank = { high: 0, medium: 1, low: 2, ok: 3 }
  findings.sort((a, b) => {
    // A tripped watch outranks anything a statistic noticed: somebody asked
    // to be told about it by name.
    if ((a.kind === 'watch') !== (b.kind === 'watch')) return a.kind === 'watch' ? -1 : 1
    if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity]
    return (b.share || 0) - (a.share || 0)
  })

  const limit = Number(cfg.limit) || DEFAULT_BRIEFING.limit
  const shown = findings.slice(0, limit)

  return {
    findings: shown,
    more: Math.max(0, findings.length - shown.length),
    skipped,
    total: measure(list, cfg),
    rows: list.length,
    quiet: findings.length === 0,
  }
}

// ---------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------
function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function pct(v) {
  const n = Math.abs(Number(v) || 0) * 100
  return `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10}%`
}

export function short(v) {
  const n = Number(v) || 0
  if (Math.abs(n) >= 1000)
    return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
  return String(Math.round(n * 10) / 10)
}

const count = (n) => `${Number(n || 0).toLocaleString('en-IN')} row${n === 1 ? '' : 's'}`
const label = (name) => (name === '' ? '(blank)' : name)

/** A date the filter engine's date inputs understand. */
const isoDay = (d) => {
  const date = d instanceof Date ? d : new Date(d)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** "Delivery Location" -> "delivery locations", for a readable sentence. */
function plural(column) {
  const word = String(column || 'group').toLowerCase()
  if (/s$/.test(word)) return word
  if (/y$/.test(word)) return `${word.slice(0, -1)}ies`
  return `${word}s`
}

function singular(column) {
  const word = String(column || 'group').toLowerCase()
  return /s$/.test(word) ? word.slice(0, -1) : word
}

