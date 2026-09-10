// ---------------------------------------------------------------------
// The periods people actually ask for
// ---------------------------------------------------------------------
// A date range was two boxes and nothing else, which means the question
// everybody asks first -- "how did this month go?" -- costs two calendar
// pickers, two clicks each, and has to be retyped tomorrow. Nobody does
// that twice a day. They set a wide range once and read a number that is
// not the one they wanted.
//
// So the periods get names. Three things follow from that, and they are the
// whole design:
//
//   A PERIOD IS NOT A PAIR OF DATES. "This month to date" saved in a view,
//   or fixed on a page, has to mean THIS month whenever somebody opens it
//   -- not the month it was saved in. So the name is what gets stored and
//   the dates are worked out at the moment the filter runs. A preset that
//   resolved once, at save time, would be a bookmark quietly going stale:
//   right on the day it was made and wrong every day after.
//
//   THE CONVENTIONS ARE THE ONES THIS APP ALREADY USES. Weeks start on
//   Monday, because the Trend widget's weeks do (see `startOfWeek` in
//   dataUtils.js) and two different weeks in one dashboard is a bug report
//   nobody can describe. Quarters are calendar quarters, for the same
//   reason -- the chart bucketed by quarter says Q1 is Jan-Mar.
//
//   "TO DATE" AND THE WHOLE PERIOD ARE DIFFERENT QUESTIONS, so both are
//   offered. On a sales tab they are the same thing; on a tab of delivery
//   promises or follow-up dates they are not, and "this month" that stops
//   at today would hide every commitment made for next week.
//
// Pure: a name and a clock in, two dates out. Nothing here reads a row.

import { endOfDay, fromDateInput, startOfDay } from './dataUtils.js'

/** The stored value that means "the two boxes, as typed". */
export const CUSTOM_RANGE = ''

/** Which month a financial year opens in, when nobody has said. */
export const DEFAULT_FY_START = 4 // April -- the Indian financial year

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * The periods, in the order they are offered.
 *
 * Grouped, because a flat list of twenty-two is a list nobody reads to the
 * end -- and the groups are the shapes of the question rather than the
 * lengths of the answer: a day, a rolling window, or a named period.
 */
export const DATE_PRESET_GROUPS = [
  {
    label: 'Days',
    presets: [
      { value: 'today', label: 'Today' },
      { value: 'yesterday', label: 'Yesterday' },
      { value: 'tomorrow', label: 'Tomorrow' },
    ],
  },
  {
    label: 'Rolling windows',
    presets: [
      { value: 'last_7', label: 'Last 7 days' },
      { value: 'last_30', label: 'Last 30 days' },
      { value: 'last_90', label: 'Last 90 days' },
      { value: 'last_365', label: 'Last 365 days' },
      { value: 'next_7', label: 'Next 7 days' },
      { value: 'next_30', label: 'Next 30 days' },
    ],
  },
  {
    label: 'Week',
    presets: [
      { value: 'week_to_date', label: 'This week to date' },
      { value: 'this_week', label: 'This week' },
      { value: 'last_week', label: 'Last week' },
    ],
  },
  {
    label: 'Month',
    presets: [
      { value: 'month_to_date', label: 'This month to date' },
      { value: 'this_month', label: 'This month' },
      { value: 'last_month', label: 'Last month' },
    ],
  },
  {
    label: 'Quarter',
    presets: [
      { value: 'quarter_to_date', label: 'This quarter to date' },
      { value: 'this_quarter', label: 'This quarter' },
      { value: 'last_quarter', label: 'Last quarter' },
    ],
  },
  {
    label: 'Year',
    presets: [
      { value: 'year_to_date', label: 'This year to date' },
      { value: 'this_year', label: 'This year' },
      { value: 'last_year', label: 'Last year' },
    ],
  },
  {
    label: 'Financial year',
    presets: [
      { value: 'fy_to_date', label: 'This financial year to date' },
      { value: 'this_fy', label: 'This financial year' },
      { value: 'last_fy', label: 'Last financial year' },
    ],
  },
]

/** Every preset, flat, for lookups. */
export const DATE_PRESETS = DATE_PRESET_GROUPS.flatMap((g) =>
  g.presets.map((p) => ({ ...p, group: g.label }))
)

export function isDatePreset(value) {
  return DATE_PRESETS.some((p) => p.value === value)
}

export function datePresetLabel(value) {
  return DATE_PRESETS.find((p) => p.value === value)?.label || ''
}

// --- The arithmetic ------------------------------------------------------
// All of it on whole local days. A date column in a spreadsheet is a day,
// not an instant, and doing this in UTC is how a range comes out one day
// short every time the office is east of Greenwich.

const shiftDays = (d, n) => {
  const x = startOfDay(d)
  x.setDate(x.getDate() + n)
  return x
}

/** Monday, matching the Trend widget's weeks. */
const startOfWeek = (d) => shiftDays(d, -((startOfDay(d).getDay() + 6) % 7))

const monthStart = (d, offset = 0) => new Date(d.getFullYear(), d.getMonth() + offset, 1)

const quarterStart = (d, offset = 0) =>
  new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + offset * 3, 1)

const yearStart = (d, offset = 0) => new Date(d.getFullYear() + offset, 0, 1)

/**
 * The 1st of the financial year `d` falls in.
 *
 * An FY named by the calendar year it OPENS in, so April 2026 to March 2027
 * is "this" financial year on both of those dates. Anything before the
 * opening month belongs to the year that opened last calendar year.
 */
function fyStartOf(d, fyStart, offset = 0) {
  const month = clampMonth(fyStart) - 1
  const year = d.getMonth() >= month ? d.getFullYear() : d.getFullYear() - 1
  return new Date(year + offset, month, 1)
}

function clampMonth(month) {
  const n = Math.round(Number(month))
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : DEFAULT_FY_START
}

/** A period from its first day to the day before the next one starts. */
const until = (from, nextStart) => ({ from, to: endOfDay(shiftDays(nextStart, -1)) })

/**
 * What a named period means right now.
 *
 * `now` is injectable so this is testable and so a page rendered at 23:59
 * and read at 00:01 is not two different answers to the same question --
 * the caller decides when "now" is.
 *
 * Returns null for anything unrecognised, which the caller reads as "no
 * period" rather than as an empty range. The difference matters: an empty
 * range filters nothing, and a preset an old page names but this build has
 * never heard of must not silently become "all time" on a page whose whole
 * point was a date filter.
 */
export function resolveDatePreset(preset, { now = new Date(), fyStart = DEFAULT_FY_START } = {}) {
  const today = startOfDay(now)
  const rolling = (backDays, forwardDays) => ({
    from: shiftDays(today, -backDays),
    to: endOfDay(shiftDays(today, forwardDays)),
  })

  switch (preset) {
    case 'today':
      return rolling(0, 0)
    case 'yesterday':
      return { from: shiftDays(today, -1), to: endOfDay(shiftDays(today, -1)) }
    case 'tomorrow':
      return { from: shiftDays(today, 1), to: endOfDay(shiftDays(today, 1)) }

    // Today counts as one of the seven. It is the commoner reading, and the
    // one that makes "last 7 days" on a Monday morning include this
    // morning's bookings -- which is what somebody looking at it wants.
    case 'last_7':
      return rolling(6, 0)
    case 'last_30':
      return rolling(29, 0)
    case 'last_90':
      return rolling(89, 0)
    case 'last_365':
      return rolling(364, 0)
    case 'next_7':
      return rolling(0, 6)
    case 'next_30':
      return rolling(0, 29)

    case 'week_to_date':
      return { from: startOfWeek(today), to: endOfDay(today) }
    case 'this_week':
      return until(startOfWeek(today), shiftDays(startOfWeek(today), 7))
    case 'last_week':
      return until(shiftDays(startOfWeek(today), -7), startOfWeek(today))

    case 'month_to_date':
      return { from: monthStart(today), to: endOfDay(today) }
    case 'this_month':
      return until(monthStart(today), monthStart(today, 1))
    case 'last_month':
      return until(monthStart(today, -1), monthStart(today))

    case 'quarter_to_date':
      return { from: quarterStart(today), to: endOfDay(today) }
    case 'this_quarter':
      return until(quarterStart(today), quarterStart(today, 1))
    case 'last_quarter':
      return until(quarterStart(today, -1), quarterStart(today))

    case 'year_to_date':
      return { from: yearStart(today), to: endOfDay(today) }
    case 'this_year':
      return until(yearStart(today), yearStart(today, 1))
    case 'last_year':
      return until(yearStart(today, -1), yearStart(today))

    case 'fy_to_date':
      return { from: fyStartOf(today, fyStart), to: endOfDay(today) }
    case 'this_fy':
      return until(fyStartOf(today, fyStart), fyStartOf(today, fyStart, 1))
    case 'last_fy':
      return until(fyStartOf(today, fyStart, -1), fyStartOf(today, fyStart))

    default:
      return null
  }
}

/**
 * The window a date control's whole value describes.
 *
 * One place that knows a value can be a named period OR two typed boxes, so
 * the filter engine, the control bar and anything asking later all agree.
 * A named period wins over the boxes when it is set -- the boxes are still
 * carried, because switching to "Custom range" hands them back rather than
 * making somebody retype the range they were just looking at.
 */
export function dateWindow(value, { now = new Date(), fyStart = DEFAULT_FY_START } = {}) {
  const range = value?.preset ? resolveDatePreset(value.preset, { now, fyStart }) : null
  if (range) return range
  return { from: fromDateInput(value?.from), to: fromDateInput(value?.to) }
}

/** Is this value saying anything at all? */
export function dateValueIsSet(value) {
  return Boolean(value && (value.preset || value.from || value.to))
}

/** A Date as the yyyy-mm-dd an <input type="date"> wants. */
export function toDateInput(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The value to store when somebody switches to a typed range.
 *
 * Whatever the period had resolved to, kept. Picking "Last month" and then
 * nudging one end is a real thing people do, and clearing the boxes on the
 * way would make them look it up again.
 */
export function toCustomRange(value, { now = new Date(), fyStart = DEFAULT_FY_START } = {}) {
  if (!value?.preset) return { ...(value || {}), preset: CUSTOM_RANGE }
  const { from, to } = dateWindow(value, { now, fyStart })
  return { preset: CUSTOM_RANGE, from: toDateInput(from), to: toDateInput(to) }
}

/** A short "1 Sep – 9 Sep 2026", for saying what a period came out as. */
export function describeRange({ from, to } = {}) {
  if (!from && !to) return ''
  const sameYear = from && to && from.getFullYear() === to.getFullYear()
  const short = (d, withYear) =>
    d.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : null),
    })
  if (from && to) return `${short(from, !sameYear)} – ${short(to, true)}`
  return from ? `from ${short(from, true)}` : `to ${short(to, true)}`
}
