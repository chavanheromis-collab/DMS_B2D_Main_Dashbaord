import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  WEEKDAY_INITIALS,
  dayState,
  dragPreview,
  dragRange,
  extendDrag,
  monthGrid,
  monthLabel,
  monthStart,
  nextPick,
  orderRange,
  sameDay,
  sameMonth,
  startDrag,
  weekdayIndex,
} from './calendarGrid.js'
import { toDateInput } from './datePresets.js'

// ---------------------------------------------------------------------
// The calendar behind the date range
// ---------------------------------------------------------------------
// Two native date inputs became one popover with a real calendar in it,
// because each of those opens the browser's own picker, shows one month and
// knows nothing about the other box -- so the span being chosen was never
// on screen at once.
//
// The component is a grid of buttons. Everything that can actually be WRONG
// is here: which days a month is drawn as, what a click means, and how a
// half-made range is shown before it is finished.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const d = (y, m, day) => new Date(y, m - 1, day)
const iso = (x) => toDateInput(x)

// --- the grid ------------------------------------------------------------

test('a month is always six rows of seven', () => {
  // Even a February that fits in four. A grid that changes height as you
  // page through it makes the buttons below jump under the cursor -- you go
  // to click Clear and press a date instead.
  for (const month of [d(2026, 2, 1), d(2026, 9, 1), d(2021, 2, 1), d(2024, 2, 1)]) {
    const grid = monthGrid(month)
    assert.equal(grid.length, 6)
    for (const week of grid) assert.equal(week.length, 7)
  }
})

test('every row starts on a Monday', () => {
  for (const week of monthGrid(d(2026, 9, 1))) {
    assert.equal(weekdayIndex(week[0]), 0)
    assert.equal(week[0].getDay(), 1)
  }
  assert.equal(WEEKDAY_INITIALS.length, 7)
  assert.equal(WEEKDAY_INITIALS[0], 'M')
})

test('the grid is padded with the neighbouring months, not with blanks', () => {
  // Clicking the 31st of last month is a legitimate way to reach it, so
  // those cells are real days rather than holes.
  const grid = monthGrid(d(2026, 9, 1)) // Sep 2026 opens on a Tuesday
  assert.equal(iso(grid[0][0]), '2026-08-31')
  assert.equal(iso(grid[0][1]), '2026-09-01')
  assert.equal(iso(grid[5][6]), '2026-10-11')
})

test('a month opening on a Monday still gets a full leading week', () => {
  // The case that tempts an off-by-one into showing the previous month's
  // last week twice, or dropping it entirely.
  const june = d(2026, 6, 1)
  assert.equal(june.getDay(), 1)
  const grid = monthGrid(june)
  assert.equal(iso(grid[0][0]), '2026-06-01')
  assert.equal(grid.flat().filter((x) => sameMonth(x, june)).length, 30)
})

test('the days are consecutive, across every boundary it crosses', () => {
  // Built by adding to the 1st rather than by mutating a cursor, so a month
  // end and a DST change are the Date constructor's problem.
  for (const month of [d(2026, 1, 1), d(2026, 3, 1), d(2026, 10, 1), d(2024, 2, 1)]) {
    const days = monthGrid(month).flat()
    assert.equal(days.length, 42)
    for (let i = 1; i < days.length; i += 1) {
      const gap = (days[i] - days[i - 1]) / 3600000
      assert.ok(gap >= 23 && gap <= 25, `${iso(days[i - 1])} -> ${iso(days[i])} is ${gap}h`)
    }
  }
})

test('monthStart walks months without landing on the 31st of a short one', () => {
  assert.equal(iso(monthStart(d(2026, 3, 31), -1)), '2026-02-01')
  assert.equal(iso(monthStart(d(2026, 1, 15), -1)), '2025-12-01')
  assert.equal(iso(monthStart(d(2026, 12, 15), 1)), '2027-01-01')
})

// --- clicking ------------------------------------------------------------

test('the first click starts a range and the second closes it', () => {
  const first = nextPick({}, d(2026, 9, 3))
  assert.equal(iso(first.from), '2026-09-03')
  assert.equal(first.to, null)

  const closed = nextPick(first, d(2026, 9, 19))
  assert.equal(iso(closed.from), '2026-09-03')
  assert.equal(iso(closed.to), '2026-09-19')
})

test('picking backwards is the same range, in order', () => {
  // Nobody should have to know which end to click first.
  const open = nextPick({}, d(2026, 9, 19))
  const closed = nextPick(open, d(2026, 9, 3))
  assert.equal(iso(closed.from), '2026-09-03')
  assert.equal(iso(closed.to), '2026-09-19')
})

test('a closed range starts over rather than stretching', () => {
  // Extending whichever end is nearer is unpredictable to use and
  // impossible to undo without knowing which end it decided to move.
  const closed = { from: d(2026, 9, 3), to: d(2026, 9, 19) }
  const again = nextPick(closed, d(2026, 9, 25))
  assert.equal(iso(again.from), '2026-09-25')
  assert.equal(again.to, null)
})

test('clicking the same day twice is that one day', () => {
  const open = nextPick({}, d(2026, 9, 8))
  const one = nextPick(open, d(2026, 9, 8))
  assert.equal(iso(one.from), '2026-09-08')
  assert.equal(iso(one.to), '2026-09-08')
})

test('a click keeps the day and drops the clock', () => {
  const picked = nextPick({}, new Date(2026, 8, 8, 17, 45))
  assert.equal(picked.from.getHours(), 0)
  assert.equal(picked.from.getMinutes(), 0)
})

test('orderRange copes with one end missing', () => {
  assert.deepEqual(orderRange(null, null), { from: null, to: null })
  assert.equal(iso(orderRange(null, d(2026, 9, 4)).from), '2026-09-04')
  assert.equal(orderRange(null, d(2026, 9, 4)).to, null)
  assert.equal(orderRange(d(2026, 9, 4), null).to, null)
})

// --- dragging across the days --------------------------------------------

const pull = (from, ...through) => through.reduce((d, day) => extendDrag(d, day), startDrag(from))

test('pulling across the days is a closed range', () => {
  const drag = pull(d(2026, 9, 3), d(2026, 9, 4), d(2026, 9, 5), d(2026, 9, 6))
  const picked = dragRange(drag)
  assert.equal(iso(picked.from), '2026-09-03')
  assert.equal(iso(picked.to), '2026-09-06')
})

test('pulling backwards is the same range, in order', () => {
  const picked = dragRange(pull(d(2026, 9, 19), d(2026, 9, 12), d(2026, 9, 3)))
  assert.equal(iso(picked.from), '2026-09-03')
  assert.equal(iso(picked.to), '2026-09-19')
})

test('a press and a release on one day is a CLICK, not a one-day range', () => {
  // The whole difficulty of having both gestures. Null hands it back to the
  // two-click flow rather than committing a range nobody drew.
  assert.equal(dragRange(startDrag(d(2026, 9, 3))), null)
  assert.equal(dragRange(null), null)
})

test('wobbling inside one cell never turns a click into a drag', () => {
  // The pointer re-enters the same button on every stray pixel; only
  // reaching a DIFFERENT day counts as having moved.
  const drag = pull(d(2026, 9, 3), d(2026, 9, 3), d(2026, 9, 3))
  assert.equal(drag.moved, false)
  assert.equal(dragRange(drag), null)
})

test('a drag that comes back to where it started is still a click', () => {
  // Out and back is a change of mind, and committing one day on it would
  // be a range the reader watched themselves not draw.
  const drag = pull(d(2026, 9, 3), d(2026, 9, 8), d(2026, 9, 3))
  assert.equal(drag.moved, true)
  assert.equal(dragRange(drag), null)
})

test('the drag is shown as the open range it is about to become', () => {
  // One preview and one code path: the same shape `dayState` already draws
  // for a half-made two-click range.
  const drag = pull(d(2026, 9, 3), d(2026, 9, 6))
  const preview = dragPreview(drag)
  assert.equal(iso(preview.from), '2026-09-03')
  assert.equal(preview.to, null)
  assert.equal(iso(preview.hover), '2026-09-06')

  const state = dayState(d(2026, 9, 4), { ...preview, month })
  assert.equal(state.inRange, true)
  assert.equal(state.provisional, true)
  assert.equal(dragPreview(null), null)
})

test('a drag keeps the day and drops the clock, at both ends', () => {
  const drag = pull(new Date(2026, 8, 3, 9, 15), new Date(2026, 8, 6, 22, 40))
  const picked = dragRange(drag)
  assert.equal(picked.from.getHours(), 0)
  assert.equal(picked.to.getHours(), 0)
})

test('a drag can cross a month boundary', () => {
  // The grid draws the neighbouring months' days for exactly this reason.
  const picked = dragRange(pull(d(2026, 8, 28), d(2026, 9, 2)))
  assert.equal(iso(picked.from), '2026-08-28')
  assert.equal(iso(picked.to), '2026-09-02')
})

// --- how a day is drawn --------------------------------------------------

const month = d(2026, 9, 1)
const today = d(2026, 9, 10)
const at = (day, opts) => dayState(day, { month, today, ...opts })

test('the ends are ends and the middle is the middle', () => {
  const range = { from: d(2026, 9, 3), to: d(2026, 9, 6) }
  assert.deepEqual(
    [at(d(2026, 9, 3), range).isStart, at(d(2026, 9, 3), range).isEnd],
    [true, false]
  )
  assert.deepEqual([at(d(2026, 9, 6), range).isStart, at(d(2026, 9, 6), range).isEnd], [false, true])

  const middle = at(d(2026, 9, 4), range)
  assert.equal(middle.inRange, true)
  assert.equal(middle.isStart, false)
  assert.equal(middle.isEnd, false)

  assert.equal(at(d(2026, 9, 7), range).inRange, false)
})

test('a one-day range is both ends, so it draws as one cell', () => {
  const one = { from: d(2026, 9, 3), to: d(2026, 9, 3) }
  const state = at(d(2026, 9, 3), one)
  assert.equal(state.isStart, true)
  assert.equal(state.isEnd, true)
})

test('a half-made range is shaded to where the cursor is', () => {
  // Without this the first click appears to do nothing, and the reader
  // cannot see what they are about to pick.
  const open = { from: d(2026, 9, 3), to: null, hover: d(2026, 9, 6) }
  assert.equal(at(d(2026, 9, 4), open).inRange, true)
  assert.equal(at(d(2026, 9, 4), open).provisional, true)
  assert.equal(at(d(2026, 9, 6), open).isEnd, true)
  assert.equal(at(d(2026, 9, 8), open).inRange, false)
})

test('...including backwards, before either end is committed', () => {
  const open = { from: d(2026, 9, 10), to: null, hover: d(2026, 9, 7) }
  assert.equal(at(d(2026, 9, 8), open).inRange, true)
  assert.equal(at(d(2026, 9, 7), open).isStart, true)
  assert.equal(at(d(2026, 9, 12), open).inRange, false)
})

test('a finished range ignores the cursor', () => {
  // Or moving the mouse over a picked range would appear to redraw it.
  const closed = { from: d(2026, 9, 3), to: d(2026, 9, 6), hover: d(2026, 9, 25) }
  assert.equal(at(d(2026, 9, 20), closed).inRange, false)
  assert.equal(at(d(2026, 9, 4), closed).provisional, false)
})

test('the days from the neighbouring months are marked as such', () => {
  assert.equal(at(d(2026, 8, 31), {}).outside, true)
  assert.equal(at(d(2026, 9, 1), {}).outside, false)
  assert.equal(at(d(2026, 10, 1), {}).outside, true)
})

test('today is marked, and only today', () => {
  assert.equal(at(today, {}).isToday, true)
  assert.equal(at(d(2026, 9, 11), {}).isToday, false)
  assert.equal(sameDay(today, new Date(2026, 8, 10, 23, 59)), true)
  assert.equal(sameDay(today, d(2025, 9, 10)), false)
})

test('nothing picked is nothing shaded', () => {
  const state = at(d(2026, 9, 15), {})
  assert.equal(state.inRange, false)
  assert.equal(state.isStart, false)
  assert.equal(state.isEnd, false)
})

test('a month has a name on it', () => {
  assert.match(monthLabel(d(2026, 9, 1)), /2026/)
})

// --- still wired ---------------------------------------------------------

const picker = read('components/DateRange.jsx')
const bar = read('components/ControlBar.jsx')

test('the bar shows one button, and the picker is behind it', () => {
  // The whole point of the change: a date range used to sit open in the bar
  // as a label, a dropdown and two date inputs -- about 380px of a bar that
  // also has to hold four other filters.
  assert.match(bar, /if \(control\.kind === 'date'\) \{ return \( <DateRange/)
  assert.equal(/control\.kind === 'date' \|\| control\.kind === 'number'/.test(bar), false)
})

test('the picker offers the periods and a calendar, and closes on Escape', () => {
  assert.match(picker, /DATE_PRESET_GROUPS\.map/)
  assert.match(picker, /monthGrid\(month\)/)
  assert.match(picker, /e\.key === 'Escape'/)
  // Outside-click, the same way every other popover in this bar does it.
  assert.match(picker, /document\.addEventListener\('mousedown', onDown\)/)
})

test('the period is still stored by name, not resolved into the boxes', () => {
  // What makes "this month to date" still mean this month next month.
  assert.match(picker, /onChange\(\{ \.\.\.v, preset: p\.value \}\)/)
})

test('the calendar only jumps when the picker is opened', () => {
  // Moving it whenever the range changes would drag the month out from
  // under somebody paging back through last year to find a start date.
  assert.match(picker, /setMonth\(openingMonth\(range\)\)/)
  assert.match(picker, /\}, \[open\]\)/)
})

test('the days can be dragged across, and a click still works', () => {
  assert.match(picker, /onMouseDown=\{\(e\) => \{ e\.preventDefault\(\) setDrag\(startDrag\(day\)\) \}\}/)
  assert.match(picker, /setDrag\(\(d\) => extendDrag\(d, day\)\)/)
  assert.match(picker, /onClick=\{\(\) => pickDay\(day\)\}/)
  // The release is watched on the document: a drag very often ends with the
  // pointer off the grid, and a press left "down" would have the next thing
  // the pointer touched extending a range nobody was drawing any more.
  assert.match(picker, /document\.addEventListener\('mouseup', onUp\)/)
})

test('nothing is written until the button comes up', () => {
  // Every write re-filters the whole page. A drag across three weeks would
  // otherwise be twenty of those in a second.
  assert.equal(/onMouseEnter=\{[^}]*commit\(/.test(picker), false)
  assert.equal(/onMouseEnter=\{[^}]*onChange\(/.test(picker), false)
})

test('a drag that closed the panel cannot eat the next click', () => {
  // The flag suppressing the click after a drag is cleared when the picker
  // opens, because a drag that closes the panel never sees that click.
  assert.match(picker, /draggedRef\.current = false \} \}, \[open\]\)/)
})
