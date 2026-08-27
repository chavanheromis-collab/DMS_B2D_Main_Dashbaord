// ---------------------------------------------------------------------
// Cohort / retention -- did they ever come back?
// ---------------------------------------------------------------------
// A sales sheet answers "how many did we sell in March" easily and "did
// March's customers ever come back" not at all. Those are different
// questions and only the second one is about the business rather than
// about the month: a dealership that sells four hundred cars a year to
// four hundred people is in a completely different position from one that
// sells them to two hundred.
//
// A cohort grid answers it by refusing to mix people up. Every entity is
// pinned to the period it FIRST appeared in -- that is its cohort, for
// good -- and each column counts how many of that same cohort showed up
// again N periods later. Reading down a column compares like with like;
// reading across a row follows one group as it decays.
//
// Two things this is careful about, both of which sink most hand-rolled
// retention grids:
//
//   - The bottom-right of the grid is not real. A cohort from last month
//     has not HAD six months to come back, and drawing a 0% there
//     invents a collapse that has not happened. Those cells come back
//     marked `future` and are meant to be left blank.
//   - Period 0 is definitionally 100%. It is shown because its SIZE
//     matters, but it is never what the colour scale is normalised on --
//     otherwise every grid is one dark column and a wash of nothing.

import { aggregate, bucketLabel, bucketStart, isBlank, nextBucket, startOfDay, toDate } from './dataUtils.js'

export const COHORT_GRAINS = [
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
  { value: 'year', label: 'Yearly' },
]

export const COHORT_METRICS = [
  { value: 'retention', label: 'Retention — % of the cohort that returned' },
  { value: 'active', label: 'How many returned' },
  { value: 'value', label: 'What they were worth' },
]

export const DEFAULT_COHORT = {
  entityColumn: '',
  dateColumn: '',
  grain: 'month',
  periods: 8,
  maxCohorts: 12,
  metric: 'retention',
  aggregation: 'sum',
  column: null,
  format: 'comma',
  scale: 'indigo',
  showFuture: false,
  showSize: true,
  // Whether period 0 is drawn at all. It is always 100% and always the
  // widest cell, so hiding it lets the scale spend itself on the columns
  // where the differences actually are.
  hideFirstPeriod: false,
}

const GRAIN_MS = { week: 7, month: 30, quarter: 91, year: 365 }

const clampInt = (value, lo, hi, fallback) => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, n))
}

/**
 * How many whole periods separate two bucket starts.
 *
 * Counted by stepping the calendar rather than by dividing milliseconds,
 * because months are not a fixed length -- dividing by 30 puts a January
 * and a March event three periods apart in one year and two in another,
 * and the grid develops a diagonal smear nobody can explain.
 */
export function periodsBetween(from, to, grain, cap = 60) {
  if (to.getTime() < from.getTime()) return -1
  let cursor = bucketStart(from, grain)
  let n = 0
  while (n <= cap) {
    const next = nextBucket(cursor, grain)
    if (to.getTime() < next.getTime()) return n
    cursor = next
    n += 1
  }
  return cap + 1
}

/**
 * Every entity's events, and the period each one landed in.
 *
 * An entity with no parseable date anywhere is dropped entirely rather
 * than assigned to a cohort of "unknown" -- a cohort whose start date is
 * unknown cannot have a period-since, so every one of its cells would be
 * meaningless.
 */
export function entityEvents(rows, config, dateOrder = 'DMY') {
  const entities = new Map()

  for (const row of rows || []) {
    if (isBlank(row[config.entityColumn])) continue
    const date = toDate(row[config.dateColumn], dateOrder)
    if (!date) continue

    const key = String(row[config.entityColumn]).trim()
    const day = startOfDay(date)
    const found = entities.get(key)
    if (found) {
      found.events.push({ date: day, row })
      if (day.getTime() < found.first.getTime()) found.first = day
    } else {
      entities.set(key, { key, first: day, events: [{ date: day, row }] })
    }
  }

  return entities
}

/** The grid: one row per cohort, one column per period since it started. */
export function cohortData(widget, { rows = [], dateOrder = 'DMY', today } = {}) {
  const config = { ...DEFAULT_COHORT, ...(widget || {}) }
  if (!config.entityColumn || !config.dateColumn) {
    return { ready: false, cohorts: [], periods: [], reason: 'Pick who repeats, and when' }
  }

  const grain = GRAIN_MS[config.grain] ? config.grain : 'month'
  const periodCount = clampInt(config.periods, 1, 24, 8)
  const now = startOfDay(today || new Date())

  const entities = entityEvents(rows, config, dateOrder)
  if (entities.size === 0) return { ready: true, cohorts: [], periods: [], entityCount: 0 }

  // Group entities by the bucket their first event fell in.
  const byCohort = new Map()
  for (const entity of entities.values()) {
    const start = bucketStart(entity.first, grain)
    const key = start.getTime()
    const found = byCohort.get(key)
    if (found) found.entities.push(entity)
    else byCohort.set(key, { key, start, label: bucketLabel(start, grain), entities: [entity] })
  }

  const ordered = [...byCohort.values()].sort((a, b) => b.start.getTime() - a.start.getTime())
  const maxCohorts = clampInt(config.maxCohorts, 1, 48, 12)
  const shown = ordered.slice(0, maxCohorts)

  const cohorts = shown.map((cohort) => {
    // How many periods this cohort has actually had the chance to live
    // through. Everything past this is unlived, not lost.
    const elapsed = periodsBetween(cohort.start, now, grain)
    const size = cohort.entities.length

    // Each event is placed into its period ONCE, up front. The obvious
    // shape -- loop the periods, and for each one ask every event whether
    // it belongs -- re-walks the calendar for every cell, which on a sheet
    // of any size is millions of date steps to produce a grid of ninety
    // numbers. One pass over the events builds the same grid.
    const activePerPeriod = new Array(periodCount).fill(0)
    const rowsPerPeriod = Array.from({ length: periodCount }, () => [])

    for (const entity of cohort.entities) {
      const hitPeriods = new Set()
      for (const event of entity.events) {
        const p = periodsBetween(cohort.start, event.date, grain, periodCount)
        if (p < 0 || p >= periodCount) continue
        rowsPerPeriod[p].push(event.row)
        hitPeriods.add(p)
      }
      // An entity counts ONCE per period however many times it appeared in
      // it -- retention is about people coming back, not about how much
      // they bought when they did.
      for (const p of hitPeriods) activePerPeriod[p] += 1
    }

    const cells = []
    for (let p = 0; p < periodCount; p += 1) {
      const future = p > elapsed
      const active = future ? 0 : activePerPeriod[p]
      const eventRows = future ? [] : rowsPerPeriod[p]

      const value =
        config.metric === 'value'
          ? aggregate(eventRows, config.column, config.aggregation || 'sum')
          : config.metric === 'active'
            ? active
            : size > 0
              ? (active / size) * 100
              : 0

      cells.push({
        period: p,
        future,
        size,
        active,
        rows: eventRows,
        value,
        // Retention is the reading everybody wants alongside whatever the
        // chosen metric is, so it always comes back.
        retention: size > 0 ? (active / size) * 100 : 0,
      })
    }

    return { ...cohort, size, elapsed, cells }
  })

  // The scale is normalised on the cells the reader is comparing -- never
  // on period 0, which is 100% for every cohort by construction and would
  // otherwise be the only cell with any colour in it.
  const scaleCells = cohorts.flatMap((c) => c.cells.filter((cell) => !cell.future && cell.period > 0))
  const max = scaleCells.length ? Math.max(...scaleCells.map((c) => c.value), 0) : 0

  return {
    ready: true,
    cohorts: cohorts.reverse(), // oldest at the top, so time reads downwards
    periods: Array.from({ length: periodCount }, (_, i) => i),
    grain,
    max,
    entityCount: entities.size,
    hidden: Math.max(0, ordered.length - shown.length),
    // Repeat rate over everything, which is the single number the grid is
    // an elaboration of.
    repeatRate:
      entities.size > 0
        ? ([...entities.values()].filter((e) => new Set(e.events.map((x) => x.date.getTime())).size > 1).length /
            entities.size) *
          100
        : 0,
  }
}
