// ---------------------------------------------------------------------
// Calendar heat map -- a year of days, as a grid
// ---------------------------------------------------------------------
// A trend line over a year says whether the number went up. It cannot say
// that nothing at all happens on Sundays, that the last week of every month
// is triple the first, or that there was a fortnight in June when the sheet
// simply stopped being filled in. Those are shapes in a CALENDAR, and the
// only way to see them is to draw one.
//
// Two layouts, and they answer different questions:
//
//   strip  -- 53 columns of 7 days, the whole year in one band. Best for
//             spotting rhythm and gaps across the year.
//   months -- twelve small month grids. Best when the reader needs to find
//             a specific date, because a month grid is the shape everyone
//             already knows how to read.
//
// Every cell carries the rows behind it, so a click can drill into exactly
// that day rather than into an approximation of it.
//
// Pure: rows in, a grid of cells out. No dates are formatted for display
// here beyond the labels a grid genuinely needs.

import { aggregate, startOfDay, toDate } from './dataUtils.js'

export const CALENDAR_LAYOUTS = [
  { value: 'strip', label: 'One band — the whole span in a row of weeks' },
  { value: 'months', label: 'Month blocks — twelve small calendars' },
]

export const CALENDAR_SPANS = [
  { value: '365', label: 'The last 365 days' },
  { value: '180', label: 'The last 6 months' },
  { value: '90', label: 'The last 90 days' },
  { value: 'ytd', label: 'This year so far' },
  { value: 'year', label: 'The whole of this calendar year' },
  { value: 'data', label: 'Whatever the data covers' },
]

export const WEEK_STARTS = [
  { value: 'mon', label: 'Monday' },
  { value: 'sun', label: 'Sunday' },
]

export const DEFAULT_CALENDAR = {
  dateColumn: '',
  aggregation: 'count',
  column: null,
  format: 'comma',
  layout: 'strip',
  span: '365',
  weekStart: 'mon',
  scale: 'emerald',
  // Fixed steps rather than a continuous ramp. A continuous one looks
  // smoother and is much harder to read a value off; five steps can be
  // counted, and a legend of five swatches is a legend somebody uses.
  steps: 5,
  showMonthLabels: true,
  showDayLabels: true,
  showLegend: true,
  cellSize: 13,
}

const DAY_MS = 86400000

const DAY_NAMES = {
  mon: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  sun: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function dayLabels(weekStart = 'mon') {
  return DAY_NAMES[weekStart === 'sun' ? 'sun' : 'mon']
}

/** A date as `2026-03-14`, which sorts correctly as a plain string. */
export function dayKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Which column of the week a date sits in, given where the week starts. */
export function weekIndex(date, weekStart = 'mon') {
  const dow = date.getDay() // 0 = Sunday
  return weekStart === 'sun' ? dow : (dow + 6) % 7
}

/**
 * Rows bucketed by the day they fall on.
 *
 * A Map keyed by `YYYY-MM-DD` rather than by a Date, because two Date
 * objects for the same midnight are different keys and would split one
 * day's rows into two buckets that never find each other again.
 */
export function rowsByDay(rows, dateColumn, dateOrder = 'DMY') {
  const byDay = new Map()
  if (!dateColumn) return byDay
  for (const row of rows || []) {
    const d = toDate(row[dateColumn], dateOrder)
    if (!d) continue
    const key = dayKey(d)
    const list = byDay.get(key)
    if (list) list.push(row)
    else byDay.set(key, [row])
  }
  return byDay
}

/**
 * The first and last day the grid covers.
 *
 * `data` spans whatever is actually in the sheet, which is the honest
 * choice for a historical extract; everything else is anchored on today,
 * because a "last 365 days" that quietly ends when the data does would
 * hide precisely the gap it exists to reveal.
 */
export function calendarRange(spec, byDay, today = new Date()) {
  const end = startOfDay(today)

  if (spec === 'data') {
    const keys = [...byDay.keys()].sort()
    if (keys.length === 0) return { from: new Date(end.getTime() - 364 * DAY_MS), to: end }
    return { from: startOfDay(new Date(keys[0])), to: startOfDay(new Date(keys[keys.length - 1])) }
  }

  if (spec === 'ytd') return { from: new Date(end.getFullYear(), 0, 1), to: end }
  if (spec === 'year') return { from: new Date(end.getFullYear(), 0, 1), to: new Date(end.getFullYear(), 11, 31) }

  const days = Number(spec)
  const span = Number.isFinite(days) && days > 0 ? Math.min(1830, Math.round(days)) : 365
  return { from: new Date(end.getTime() - (span - 1) * DAY_MS), to: end }
}

/** Every day between two dates inclusive, as cells with their rows attached. */
function cellsBetween(from, to, byDay, widget, dateOrder) {
  const cells = []
  const agg = widget.aggregation || 'count'
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const last = startOfDay(to).getTime()
  // A hard stop, so a malformed range can never spin: five years of days is
  // already far more than a calendar can usefully draw.
  let guard = 0

  while (cursor.getTime() <= last && guard < 1900) {
    guard += 1
    const key = dayKey(cursor)
    const dayRows = byDay.get(key) || []
    cells.push({
      key,
      date: new Date(cursor),
      day: cursor.getDate(),
      month: cursor.getMonth(),
      year: cursor.getFullYear(),
      weekday: cursor.getDay(),
      rowCount: dayRows.length,
      // An empty day is a real zero, not a missing value -- which is why it
      // gets a cell and a colour of its own rather than a hole in the grid.
      value: dayRows.length ? aggregate(dayRows, widget.column, agg) : 0,
      empty: dayRows.length === 0,
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return cells
}

/**
 * The grid, as columns of seven.
 *
 * The first column is padded at the top so that every row of the strip is
 * one weekday all the way across -- which is the entire point of the
 * layout. Padding cells are `null` rather than zero-valued days, so nothing
 * downstream can mistake the padding for quiet Mondays.
 */
export function stripWeeks(cells, weekStart = 'mon') {
  if (cells.length === 0) return { weeks: [], monthLabels: [] }

  const weeks = []
  let current = new Array(weekIndex(cells[0].date, weekStart)).fill(null)

  for (const cell of cells) {
    if (current.length === 7) {
      weeks.push(current)
      current = []
    }
    current.push(cell)
  }
  if (current.length) weeks.push([...current, ...new Array(7 - current.length).fill(null)])

  // A month label sits above the week in which that month FIRST appears,
  // and only when the month has enough of the strip to carry a label --
  // otherwise December's label lands on top of January's.
  const monthLabels = []
  weeks.forEach((week, index) => {
    const first = week.find(Boolean)
    if (!first) return
    const previous = monthLabels[monthLabels.length - 1]
    if (previous && previous.month === first.month && previous.year === first.year) return
    if (previous && index - previous.index < 3) return
    monthLabels.push({ index, month: first.month, year: first.year, label: MONTH_NAMES[first.month] })
  })

  return { weeks, monthLabels }
}

/** The same cells, cut into month blocks with leading blanks. */
export function monthBlocks(cells, weekStart = 'mon') {
  const blocks = []
  let block = null

  for (const cell of cells) {
    if (!block || block.month !== cell.month || block.year !== cell.year) {
      block = { month: cell.month, year: cell.year, label: `${MONTH_NAMES[cell.month]} ${cell.year}`, cells: [] }
      blocks.push(block)
    }
    block.cells.push(cell)
  }

  return blocks.map((b) => {
    const pad = new Array(weekIndex(b.cells[0].date, weekStart)).fill(null)
    const flat = [...pad, ...b.cells]
    const weeks = []
    for (let i = 0; i < flat.length; i += 7) {
      const week = flat.slice(i, i + 7)
      weeks.push(week.length === 7 ? week : [...week, ...new Array(7 - week.length).fill(null)])
    }
    return { ...b, weeks }
  })
}

/**
 * Which of the N shades a value gets.
 *
 * Zero is always step 0 and always drawn as "nothing", never as the palest
 * shade -- a faint tint on an empty day is how a calendar ends up looking
 * uniformly busy. Above zero the steps are cut on the range of the
 * non-empty days, so a single enormous outlier cannot flatten every other
 * day into the same colour.
 */
export function stepFor(value, max, steps = 5) {
  const n = Math.max(2, Math.min(9, Math.round(steps) || 5))
  if (!Number.isFinite(value) || value <= 0 || !(max > 0)) return 0
  const step = Math.ceil((value / max) * (n - 1))
  return Math.max(1, Math.min(n - 1, step))
}

/** Everything the calendar widget needs, in one pass. */
export function calendarData(widget, { rows = [], dateOrder = 'DMY', today } = {}) {
  const config = { ...DEFAULT_CALENDAR, ...(widget || {}) }
  if (!config.dateColumn) {
    return { ready: false, cells: [], weeks: [], monthLabels: [], blocks: [], max: 0, total: 0, activeDays: 0 }
  }

  const byDay = rowsByDay(rows, config.dateColumn, dateOrder)
  const { from, to } = calendarRange(config.span, byDay, today || new Date())
  const cells = cellsBetween(from, to, byDay, config, dateOrder)

  const values = cells.filter((c) => !c.empty).map((c) => c.value)
  const max = values.length ? Math.max(...values) : 0
  const total = values.reduce((a, b) => a + b, 0)

  const { weeks, monthLabels } = stripWeeks(cells, config.weekStart)

  return {
    ready: true,
    from,
    to,
    cells,
    weeks,
    monthLabels,
    blocks: monthBlocks(cells, config.weekStart),
    max,
    total,
    activeDays: values.length,
    // The busiest single day, which is almost always the first thing
    // somebody asks after seeing the grid.
    peak: cells.reduce((best, c) => (best && best.value >= c.value ? best : c), null),
  }
}
