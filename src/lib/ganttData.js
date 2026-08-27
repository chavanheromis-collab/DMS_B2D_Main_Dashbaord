// ---------------------------------------------------------------------
// Timeline / Gantt -- a bar per row, from one date to another
// ---------------------------------------------------------------------
// Two date columns on the same row are a DURATION, and every widget in the
// app so far throws that away. A trend chart counts the rows that started;
// a table shows both dates as text and leaves the reader to subtract them.
// Neither can show the thing a pair of dates is actually for: what was
// running at the same time as what.
//
// That is what this draws. One bar per row, laid on a shared time axis, so
// overlap is a shape rather than an arithmetic exercise -- which is how
// anybody spots that four deliveries were promised for the same week, or
// that one enquiry has been open since March.
//
// Rows with no end date are not dropped. An open-ended job is usually the
// most interesting row on the chart, so it gets a bar that runs to today
// and is marked as still running rather than quietly disappearing.
//
// Pure: rows in, geometry out. Every position is a fraction of the axis,
// because this module has no idea how wide the card will be.

import { isBlank, startOfDay, toDate, toNumber } from './dataUtils.js'

export const GANTT_SORTS = [
  { value: 'start_asc', label: 'Earliest start first' },
  { value: 'start_desc', label: 'Latest start first' },
  { value: 'duration_desc', label: 'Longest first' },
  { value: 'duration_asc', label: 'Shortest first' },
  { value: 'end_asc', label: 'Earliest finish first' },
  { value: 'label_asc', label: 'Label, A→Z' },
]

export const GANTT_ENDS = [
  { value: 'column', label: 'A second date column' },
  { value: 'duration', label: 'A number of days in a column' },
  { value: 'fixed', label: 'A fixed number of days' },
]

export const DEFAULT_GANTT = {
  startColumn: '',
  endMode: 'column',
  endColumn: '',
  durationColumn: '',
  fixedDays: 7,
  labelColumn: '',
  groupBy: '',
  colorColumn: '',
  limit: 40,
  sort: 'start_asc',
  barHeight: 22,
  showToday: true,
  showGrid: true,
  // Lanes stack rows that share a value of `groupBy` under one heading.
  // Off by default, because a flat list is the honest default when nobody
  // has said which column names the lanes.
  laneMode: 'flat',
  palette: 'default',
  color: '#4F46E5',
  format: 'comma',
}

const DAY_MS = 86400000

/** One row's start and end, or `null` where it has no start worth drawing. */
export function rowSpan(row, config, dateOrder = 'DMY', today = new Date()) {
  const start = toDate(row[config.startColumn], dateOrder)
  if (!start) return null

  const from = startOfDay(start)
  let to = null
  let open = false

  if (config.endMode === 'duration') {
    const days = toNumber(row[config.durationColumn])
    to = days === null ? null : new Date(from.getTime() + Math.max(0, days) * DAY_MS)
  } else if (config.endMode === 'fixed') {
    const days = Number(config.fixedDays)
    to = new Date(from.getTime() + (Number.isFinite(days) ? Math.max(0, days) : 7) * DAY_MS)
  } else {
    const end = isBlank(row[config.endColumn]) ? null : toDate(row[config.endColumn], dateOrder)
    to = end ? startOfDay(end) : null
  }

  if (!to) {
    // Still running. The bar goes to today, and says so -- an open job is
    // the row most worth looking at, not the one to drop for being
    // incomplete.
    to = startOfDay(today)
    open = true
  }

  // A finish before its start is a data error, not a negative bar. Drawing
  // it as a zero-length mark at the start date keeps the row visible and
  // flaggable rather than hiding the mistake.
  const reversed = to.getTime() < from.getTime()
  return {
    from,
    to: reversed ? from : to,
    open,
    reversed,
    days: Math.max(0, Math.round((Math.max(to.getTime(), from.getTime()) - from.getTime()) / DAY_MS)),
  }
}

/**
 * Axis ticks at a grain the span can actually carry.
 *
 * Chosen by how many labels would fit rather than by a fixed rule: a
 * fortnight wants days, five years wants years, and a chart labelled every
 * day across five years is a grey smear where an axis should be.
 */
export function axisTicks(from, to) {
  const spanDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS))
  const ticks = []
  const push = (date, label) => {
    if (date.getTime() < from.getTime() || date.getTime() > to.getTime()) return
    ticks.push({ date: new Date(date), label, fraction: (date.getTime() - from.getTime()) / (to.getTime() - from.getTime() || 1) })
  }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  if (spanDays <= 21) {
    const cursor = new Date(from)
    while (cursor.getTime() <= to.getTime()) {
      push(cursor, `${cursor.getDate()} ${months[cursor.getMonth()]}`)
      cursor.setDate(cursor.getDate() + Math.max(1, Math.round(spanDays / 7)))
    }
  } else if (spanDays <= 120) {
    // Week starts, so the ticks land somewhere meaningful rather than every
    // seventh day counted from an arbitrary first row.
    const cursor = new Date(from)
    cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7))
    while (cursor.getTime() <= to.getTime()) {
      push(cursor, `${cursor.getDate()} ${months[cursor.getMonth()]}`)
      cursor.setDate(cursor.getDate() + 7)
    }
  } else if (spanDays <= 1100) {
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1)
    const stride = spanDays > 550 ? 3 : 1
    while (cursor.getTime() <= to.getTime()) {
      push(cursor, stride > 1 ? `${months[cursor.getMonth()]} ${String(cursor.getFullYear()).slice(2)}` : months[cursor.getMonth()])
      cursor.setMonth(cursor.getMonth() + stride)
    }
  } else {
    const cursor = new Date(from.getFullYear(), 0, 1)
    while (cursor.getTime() <= to.getTime()) {
      push(cursor, String(cursor.getFullYear()))
      cursor.setFullYear(cursor.getFullYear() + 1)
    }
  }

  return ticks
}

const SORTERS = {
  start_asc: (a, b) => a.startMs - b.startMs,
  start_desc: (a, b) => b.startMs - a.startMs,
  duration_desc: (a, b) => b.days - a.days,
  duration_asc: (a, b) => a.days - b.days,
  end_asc: (a, b) => a.endMs - b.endMs,
  label_asc: (a, b) => String(a.label).localeCompare(String(b.label)),
}

/**
 * Every bar on the chart, plus the axis they share.
 *
 * The axis is padded by a day at each end so that the first and last bars
 * are not welded to the border of the card, which makes both look like
 * they continue off the edge.
 */
export function ganttData(widget, { rows = [], dateOrder = 'DMY', today } = {}) {
  const config = { ...DEFAULT_GANTT, ...(widget || {}) }
  const now = today || new Date()

  if (!config.startColumn) return { ready: false, bars: [], lanes: [], ticks: [], skipped: 0 }

  const limit = Math.max(1, Math.min(500, Math.round(Number(config.limit) || 40)))
  const all = []
  let skipped = 0

  for (const row of rows || []) {
    const span = rowSpan(row, config, dateOrder, now)
    if (!span) {
      skipped += 1
      continue
    }
    all.push({
      row,
      label: config.labelColumn ? String(row[config.labelColumn] ?? '—') : `Row ${row._row ?? ''}`.trim(),
      group: config.groupBy ? String(row[config.groupBy] ?? '(blank)') : '',
      colorKey: config.colorColumn ? String(row[config.colorColumn] ?? '(blank)') : '',
      start: span.from,
      end: span.to,
      startMs: span.from.getTime(),
      endMs: span.to.getTime(),
      days: span.days,
      open: span.open,
      reversed: span.reversed,
    })
  }

  if (all.length === 0) return { ready: true, bars: [], lanes: [], ticks: [], skipped, total: 0 }

  all.sort(SORTERS[config.sort] || SORTERS.start_asc)
  const total = all.length
  const shown = all.slice(0, limit)

  // The axis covers the bars actually DRAWN. Reserving room for the ones
  // cut by the limit would leave dead space at one end with nothing in it
  // and no way to tell why.
  const minMs = Math.min(...shown.map((b) => b.startMs))
  const maxMs = Math.max(...shown.map((b) => b.endMs))
  const pad = Math.max(DAY_MS, (maxMs - minMs) * 0.02)
  const from = new Date(minMs - pad)
  const to = new Date(maxMs + pad)
  const spread = to.getTime() - from.getTime() || 1

  const bars = shown.map((bar, index) => ({
    ...bar,
    index,
    startFraction: (bar.startMs - from.getTime()) / spread,
    // A same-day job has zero width and would vanish. A minimum of half a
    // percent is the difference between "finished the day it started" and
    // "was never here".
    widthFraction: Math.max(0.005, (bar.endMs - bar.startMs) / spread),
  }))

  // Lanes, when a column names them. Order follows first appearance in the
  // sorted list, so the lanes read in the same order as the bars do.
  const laneMap = new Map()
  for (const bar of bars) {
    const key = bar.group || ''
    if (!laneMap.has(key)) laneMap.set(key, [])
    laneMap.get(key).push(bar)
  }

  const nowFraction = (startOfDay(now).getTime() - from.getTime()) / spread

  return {
    ready: true,
    bars,
    lanes: [...laneMap.entries()].map(([name, items]) => ({ name, bars: items })),
    from,
    to,
    ticks: axisTicks(from, to),
    total,
    hidden: Math.max(0, total - shown.length),
    skipped,
    // Only drawn when today is actually on the axis. A "today" line pinned
    // to the edge of a chart about last year is a lie about where today is.
    today: nowFraction >= 0 && nowFraction <= 1 ? nowFraction : null,
    openCount: bars.filter((b) => b.open).length,
    reversedCount: bars.filter((b) => b.reversed).length,
  }
}
