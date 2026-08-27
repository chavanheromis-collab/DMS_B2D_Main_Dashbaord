import test from 'node:test'
import assert from 'node:assert/strict'

import {
  calendarData,
  calendarRange,
  dayKey,
  monthBlocks,
  rowsByDay,
  stepFor,
  stripWeeks,
  weekIndex,
} from './calendarHeat.js'

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

// --- keys and columns ----------------------------------------------------

test('a day key sorts as a string', () => {
  assert.equal(dayKey(new Date(2026, 2, 4)), '2026-03-04')
  const keys = [new Date(2026, 11, 1), new Date(2026, 0, 9), new Date(2026, 0, 10)].map(dayKey)
  assert.deepEqual([...keys].sort(), ['2026-01-09', '2026-01-10', '2026-12-01'])
})

test('the week starts where the admin said it does', () => {
  const monday = new Date(2026, 2, 2) // a Monday
  const sunday = new Date(2026, 2, 1)
  assert.equal(weekIndex(monday, 'mon'), 0)
  assert.equal(weekIndex(sunday, 'mon'), 6, 'Sunday closes a Monday week')
  assert.equal(weekIndex(sunday, 'sun'), 0)
  assert.equal(weekIndex(monday, 'sun'), 1)
})

test('two dates on the same day land in one bucket', () => {
  // Keyed by the day STRING, not by a Date -- two Date objects for the same
  // midnight are different keys and would split one day into two buckets
  // that never find each other again.
  const byDay = rowsByDay(
    [{ D: '04/03/2026' }, { D: '4/3/2026' }, { D: '05/03/2026' }],
    'D'
  )
  assert.equal(byDay.size, 2)
  assert.equal(byDay.get('2026-03-04').length, 2)
})

test('an unparseable date is left out rather than guessed at', () => {
  const byDay = rowsByDay([{ D: 'sometime' }, { D: '' }, { D: '04/03/2026' }], 'D')
  assert.equal(byDay.size, 1)
})

// --- the strip -----------------------------------------------------------

test('every row of the strip is one weekday all the way across', () => {
  // The entire point of the layout. Without the leading pad, a strip
  // beginning mid-week puts Wednesdays in the Monday row.
  const cells = []
  for (let d = 0; d < 40; d += 1) {
    const date = new Date(2026, 2, 4 + d) // starts on a Wednesday
    cells.push({ key: dayKey(date), date, day: date.getDate(), month: date.getMonth(), value: d, empty: false })
  }
  const { weeks } = stripWeeks(cells, 'mon')

  for (const week of weeks) {
    assert.equal(week.length, 7, 'every column is a full week')
  }
  for (let row = 0; row < 7; row += 1) {
    const days = weeks.map((w) => w[row]).filter(Boolean).map((c) => c.date.getDay())
    assert.equal(new Set(days).size, 1, `row ${row} is a single weekday`)
  }
})

test('padding cells are empty holes, not quiet Mondays', () => {
  const date = new Date(2026, 2, 4) // Wednesday
  const { weeks } = stripWeeks(
    [{ key: dayKey(date), date, day: 4, month: 2, value: 0, empty: true }],
    'mon'
  )
  assert.equal(weeks[0][0], null)
  assert.equal(weeks[0][1], null)
  assert.ok(weeks[0][2], 'Wednesday is where the data starts')
})

test('month labels never stack on top of each other', () => {
  const cells = []
  for (let d = 0; d < 365; d += 1) {
    const date = new Date(2026, 0, 1 + d)
    cells.push({ key: dayKey(date), date, day: date.getDate(), month: date.getMonth(), value: 1, empty: false })
  }
  const { monthLabels } = stripWeeks(cells, 'mon')
  for (let i = 1; i < monthLabels.length; i += 1) {
    assert.ok(monthLabels[i].index - monthLabels[i - 1].index >= 3, 'labels are at least three weeks apart')
  }
})

// --- the ranges ----------------------------------------------------------

test('“this year so far” ends today, and the whole year ends in December', () => {
  const today = new Date(2026, 5, 15)
  const ytd = calendarRange('ytd', new Map(), today)
  assert.equal(ytd.from.getMonth(), 0)
  assert.equal(ytd.to.getMonth(), 5)

  const year = calendarRange('year', new Map(), today)
  assert.equal(year.to.getMonth(), 11)
  assert.equal(year.to.getDate(), 31)
})

test('“whatever the data covers” follows the data, and everything else follows today', () => {
  const today = new Date(2026, 5, 15)
  const byDay = new Map([['2024-01-05', []], ['2024-03-09', []]])

  const data = calendarRange('data', byDay, today)
  assert.equal(data.from.getFullYear(), 2024)

  const fixed = calendarRange('90', byDay, today)
  assert.equal(fixed.to.getTime(), new Date(2026, 5, 15).getTime(), 'anchored on today, so a gap at the end shows')
})

// --- shades --------------------------------------------------------------

test('zero is never the palest shade', () => {
  // A faint tint on an empty day is how a calendar ends up looking
  // uniformly busy when half of it is nothing at all.
  assert.equal(stepFor(0, 100, 5), 0)
  assert.equal(stepFor(-3, 100, 5), 0)
  assert.ok(stepFor(1, 100, 5) >= 1, 'one is visible')
})

test('the busiest day gets the strongest shade and nothing exceeds it', () => {
  assert.equal(stepFor(100, 100, 5), 4)
  assert.equal(stepFor(500, 100, 5), 4, 'clamped rather than off the end of the ramp')
  assert.equal(stepFor(50, 100, 5), 2)
})

test('a max of zero means everything is nothing', () => {
  assert.equal(stepFor(0, 0, 5), 0)
})

// --- the whole thing -----------------------------------------------------

test('a calendar with no date column says so rather than drawing an empty year', () => {
  const data = calendarData({ dateColumn: '' }, { rows: [{ D: '01/01/2026' }] })
  assert.equal(data.ready, false)
})

test('an empty day is a real zero with a cell of its own', () => {
  const today = new Date()
  const day = `${today.getDate()}/${today.getMonth() + 1}/${today.getFullYear()}`
  const data = calendarData({ dateColumn: 'D', span: '90' }, { rows: [{ D: day }] })

  assert.equal(data.ready, true)
  assert.equal(data.cells.length, 90, 'every day in the span has a cell')
  assert.equal(data.activeDays, 1)
  assert.equal(data.max, 1)
  assert.equal(data.cells.filter((c) => c.empty).length, 89)
})

test('month blocks start where their month starts', () => {
  const cells = []
  for (let d = 0; d < 62; d += 1) {
    const date = new Date(2026, 0, 1 + d)
    cells.push({ key: dayKey(date), date, day: date.getDate(), month: date.getMonth(), year: 2026, value: 1, empty: false })
  }
  const blocks = monthBlocks(cells, 'mon')
  assert.equal(blocks.length, 3, 'January, February and one day of March')
  assert.equal(blocks[0].label, 'Jan 2026')
  assert.equal(blocks[0].cells.length, 31)
  assert.ok(blocks[0].weeks.every((w) => w.length === 7))
})

test('the peak is the busiest day, not the last one', () => {
  const byDay = new Map()
  const rows = []
  for (let d = 1; d <= 5; d += 1) {
    for (let n = 0; n < d; n += 1) rows.push({ D: iso(2026, 3, d) })
  }
  const data = calendarData({ dateColumn: 'D', span: 'data' }, { rows, today: new Date(2026, 3, 5) })
  assert.equal(data.peak.value, 5)
  assert.equal(byDay.size, 0)
})
