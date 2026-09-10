// ---------------------------------------------------------------------
// The month a date-range picker draws, and what clicking a day means
// ---------------------------------------------------------------------
// A date range was two native date inputs sitting in the control bar. Each
// of them opens the browser's own picker, which shows ONE month, knows
// nothing about the other box, and so cannot show the thing the reader is
// actually choosing: the span between them. Picking "the 3rd to the 19th"
// meant two separate calendars and holding the first date in your head
// while you found the second.
//
// So the two boxes become one popover with a real calendar in it, and this
// is the arithmetic behind it. All of it pure -- a month in, a grid of days
// out; a click in, the next range out -- because the interesting part is
// the edge cases and they are much easier to argue with in a test than in
// a component.
//
// Two conventions, both inherited rather than invented. Weeks start on
// MONDAY, as they do in the Trend widget and the date presets. And a month
// is always drawn as SIX rows, even when five would hold it -- see
// `monthGrid`.

import { startOfDay } from './dataUtils.js'

/** Monday first, matching every other week in this app. */
export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** Which slot of a Monday-first week this date sits in. Mon = 0. */
export const weekdayIndex = (d) => (d.getDay() + 6) % 7

export const sameDay = (a, b) =>
  Boolean(a && b) &&
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

export const sameMonth = (a, b) =>
  Boolean(a && b) && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()

/** The 1st of the month `date` falls in, `offset` months away. */
export function monthStart(date, offset = 0) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1)
}

/**
 * The grid one month is drawn as: six rows of seven days, Monday first,
 * padded at both ends with the neighbouring months' days.
 *
 * SIX rows always, even for a February that fits in four. A grid that
 * changes height as you page through it makes the buttons below it jump
 * under the cursor -- you go to click "Clear" and press a date instead.
 * The cost is a row of greyed-out days; the alternative is a picker that
 * moves while being used.
 *
 * Built by adding days to the 1st rather than by mutating one cursor date,
 * so a month boundary and a DST change are the Date constructor's problem
 * and not this function's.
 */
export function monthGrid(date) {
  const first = monthStart(date)
  const lead = weekdayIndex(first)
  const weeks = []
  for (let w = 0; w < 6; w += 1) {
    const days = []
    for (let d = 0; d < 7; d += 1) {
      days.push(new Date(first.getFullYear(), first.getMonth(), 1 - lead + w * 7 + d))
    }
    weeks.push(days)
  }
  return weeks
}

/** The two dates the right way round, whichever order they were picked in. */
export function orderRange(a, b) {
  if (!a) return { from: b || null, to: null }
  if (!b) return { from: a, to: null }
  return a <= b ? { from: a, to: b } : { from: b, to: a }
}

/**
 * What clicking `day` does to the range being picked.
 *
 * The two-click flow every date picker uses: the first click starts a new
 * range and the second closes it. A range that is already closed starts
 * over, because the alternative -- extending whichever end is nearer -- is
 * unpredictable to use and impossible to undo without knowing which end it
 * decided to move.
 *
 * Clicking the open range's own start closes it onto that single day, which
 * is what somebody who wants one day expects from clicking it twice.
 */
export function nextPick({ from, to } = {}, day) {
  const picked = startOfDay(day)
  if (!from || to) return { from: picked, to: null }
  return orderRange(from, picked)
}

// ---------------------------------------------------------------------
// Dragging across the days
// ---------------------------------------------------------------------
// Clicking a start and then an end is the flow every date picker has, and
// it is the only one that works on a touchscreen or a keyboard -- so it
// stays. But a range is a physical span, and the gesture people reach for
// first is to press on one day and pull across to the other. Both, then,
// and the whole difficulty is telling them apart: a press and a release on
// the SAME day is a click, and has to fall through to the two-click flow
// rather than committing a one-day range nobody asked for.
//
// So a drag is only a drag once the pointer has actually reached a
// different day. That is what `moved` records, and it is the one piece of
// state that decides which of the two gestures just happened.
//
// The range is not written anywhere until the button comes up. Every write
// re-filters the whole page, and a drag across three weeks would otherwise
// be twenty of those in a second.

/** The press that may become a drag. */
export function startDrag(day) {
  const at = startOfDay(day)
  return { anchor: at, last: at, moved: false }
}

/**
 * The pointer reaching a day. Ignores the day it is already on, so wobbling
 * inside one cell never turns a click into a drag.
 */
export function extendDrag(drag, day) {
  if (!drag) return null
  const at = startOfDay(day)
  if (sameDay(drag.last, at)) return drag
  return { anchor: drag.anchor, last: at, moved: true }
}

/**
 * What the release means: a closed range, or null for "that was a click".
 *
 * Null is not a failure -- it is the answer that hands the gesture back to
 * the two-click flow, which is why a plain click still starts a range that
 * a second click closes.
 */
export function dragRange(drag) {
  if (!drag?.moved || !drag.anchor || !drag.last || sameDay(drag.anchor, drag.last)) return null
  return orderRange(drag.anchor, drag.last)
}

/**
 * What the grid should SHOW while the pointer is down.
 *
 * An open range anchored where the press started, with the day currently
 * under the pointer as its other end -- which is exactly the shape
 * `dayState` already draws for a half-made two-click range. One preview,
 * one code path, and a drag looks like what it is going to commit.
 */
export function dragPreview(drag) {
  if (!drag) return null
  return { from: drag.anchor, to: null, hover: drag.last }
}

/**
 * How one cell should be drawn.
 *
 * `hover` is the day under the cursor while a range is open, so the span
 * being considered is shaded before it is committed -- without it the first
 * click appears to do nothing and the reader cannot see what they are about
 * to pick.
 */
export function dayState(day, { from, to, hover, month, today } = {}) {
  // While the range is still open, the day under the cursor IS the other
  // end -- and it can be on either side of the anchor, because nobody
  // should have to know which end to click first. `orderRange` is what
  // makes hovering backwards shade the same span as hovering forwards.
  const open = Boolean(from) && !to && Boolean(hover)
  const { from: start, to: end } = open ? orderRange(from, hover) : { from, to }

  const within = Boolean(start && end && day >= startOfDay(start) && day <= startOfDay(end))
  const isStart = sameDay(day, start)
  const isEnd = sameDay(day, end)

  return {
    // A single-day range is both ends at once, and must still be drawn as
    // one rounded cell rather than as a start with no finish.
    inRange: within || isStart || isEnd,
    isStart: isStart || (isEnd && !start),
    isEnd: isEnd || (isStart && !end),
    // Everything outside the month being paged is still drawn -- clicking
    // it is a legitimate way to reach the 31st of last month -- but muted,
    // so the month you are looking at is obvious.
    outside: Boolean(month) && !sameMonth(day, month),
    isToday: sameDay(day, today || new Date()),
    provisional: !to && within,
  }
}

/** "September 2026", for the head of the grid. */
export function monthLabel(date) {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
