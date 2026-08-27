import test from 'node:test'
import assert from 'node:assert/strict'

import { axisTicks, ganttData, rowSpan } from './ganttData.js'

const NOW = new Date(2026, 5, 15)
const base = { startColumn: 'Start', endMode: 'column', endColumn: 'End', labelColumn: 'Name' }

// --- one row's span ------------------------------------------------------

test('a row with no start date has no bar', () => {
  assert.equal(rowSpan({ Start: '', End: '01/06/2026' }, base, 'DMY', NOW), null)
  assert.equal(rowSpan({ Start: 'not a date', End: '01/06/2026' }, base, 'DMY', NOW), null)
})

test('a row with no end date runs to today and says it is still open', () => {
  // An open job is usually the most interesting row on the chart. Dropping
  // it for being incomplete hides exactly what somebody needs to chase.
  const span = rowSpan({ Start: '01/03/2026', End: '' }, base, 'DMY', NOW)
  assert.equal(span.open, true)
  assert.equal(span.to.getTime(), new Date(2026, 5, 15).getTime())
  assert.ok(span.days > 100)
})

test('a duration column becomes an end date', () => {
  const span = rowSpan(
    { Start: '01/03/2026', Days: '10' },
    { ...base, endMode: 'duration', durationColumn: 'Days' },
    'DMY',
    NOW
  )
  assert.equal(span.days, 10)
  assert.equal(span.open, false)
})

test('a blank duration is still an open bar, not a zero-length one', () => {
  const span = rowSpan(
    { Start: '01/03/2026', Days: '' },
    { ...base, endMode: 'duration', durationColumn: 'Days' },
    'DMY',
    NOW
  )
  assert.equal(span.open, true)
})

test('an end before its start is flagged, not drawn backwards', () => {
  const span = rowSpan({ Start: '10/03/2026', End: '01/03/2026' }, base, 'DMY', NOW)
  assert.equal(span.reversed, true)
  assert.equal(span.days, 0)
  assert.equal(span.to.getTime(), span.from.getTime(), 'a mark at the start, so the row stays visible')
})

// --- the axis ------------------------------------------------------------

test('the tick grain follows the span, not a fixed rule', () => {
  const days = axisTicks(new Date(2026, 5, 1), new Date(2026, 5, 14))
  const months = axisTicks(new Date(2025, 0, 1), new Date(2026, 5, 1))
  const years = axisTicks(new Date(2016, 0, 1), new Date(2026, 0, 1))

  assert.ok(days.length > 0 && days.length <= 14)
  assert.ok(months.some((t) => /^[A-Z][a-z]{2}$/.test(t.label)), 'month names over a year and a half')
  assert.ok(years.every((t) => /^\d{4}$/.test(t.label)), 'just years over a decade')
  assert.ok(years.length <= 11)
})

test('every tick sits inside the axis it labels', () => {
  const ticks = axisTicks(new Date(2026, 0, 15), new Date(2026, 8, 3))
  assert.ok(ticks.every((t) => t.fraction >= 0 && t.fraction <= 1))
})

// --- the chart -----------------------------------------------------------

const rows = [
  { Name: 'A', Start: '01/03/2026', End: '10/03/2026' },
  { Name: 'B', Start: '05/03/2026', End: '20/03/2026' },
  { Name: 'C', Start: '15/03/2026', End: '' },
  { Name: 'D', Start: '', End: '20/03/2026' },
]

test('rows with no start are counted as skipped rather than silently dropped', () => {
  const data = ganttData(base, { rows, dateOrder: 'DMY', today: NOW })
  assert.equal(data.bars.length, 3)
  assert.equal(data.skipped, 1, 'the widget says so on the card')
  assert.equal(data.openCount, 1)
})

test('a same-day job is still visible', () => {
  const data = ganttData(base, {
    rows: [{ Name: 'X', Start: '01/03/2026', End: '01/03/2026' }],
    dateOrder: 'DMY',
    today: NOW,
  })
  assert.ok(data.bars[0].widthFraction > 0, '"finished the day it started" is not "was never here"')
})

test('the axis covers the bars actually drawn, not the ones cut by the limit', () => {
  // Reserving room for hidden bars leaves dead space at one end with
  // nothing in it and no way to tell why.
  const many = Array.from({ length: 20 }, (_, i) => ({
    Name: `R${i}`,
    Start: `01/${String((i % 12) + 1).padStart(2, '0')}/2026`,
    End: `10/${String((i % 12) + 1).padStart(2, '0')}/2026`,
  }))
  const data = ganttData({ ...base, limit: 3, sort: 'start_asc' }, { rows: many, dateOrder: 'DMY', today: NOW })

  assert.equal(data.bars.length, 3)
  assert.equal(data.hidden, 17)
  assert.ok(data.to.getMonth() <= 2, 'the axis stops with the three January-ish bars')
})

test('today is marked only when today is on the axis', () => {
  const past = ganttData(base, {
    rows: [{ Name: 'A', Start: '01/01/2020', End: '10/01/2020' }],
    dateOrder: 'DMY',
    today: NOW,
  })
  assert.equal(past.today, null, 'a "today" line pinned to the edge is a lie about where today is')

  const current = ganttData(base, {
    rows: [{ Name: 'A', Start: '01/06/2026', End: '30/06/2026' }],
    dateOrder: 'DMY',
    today: NOW,
  })
  assert.ok(current.today > 0 && current.today < 1)
})

test('lanes keep the order the bars are in', () => {
  const data = ganttData(
    { ...base, groupBy: 'Team', sort: 'start_asc' },
    {
      rows: [
        { Name: 'A', Team: 'Blue', Start: '01/03/2026', End: '05/03/2026' },
        { Name: 'B', Team: 'Red', Start: '02/03/2026', End: '06/03/2026' },
        { Name: 'C', Team: 'Blue', Start: '03/03/2026', End: '07/03/2026' },
      ],
      dateOrder: 'DMY',
      today: NOW,
    }
  )
  assert.deepEqual(data.lanes.map((l) => l.name), ['Blue', 'Red'])
  assert.equal(data.lanes[0].bars.length, 2)
})

test('sorting by duration puts the longest first', () => {
  const data = ganttData({ ...base, sort: 'duration_desc' }, { rows, dateOrder: 'DMY', today: NOW })
  assert.equal(data.bars[0].label, 'C', 'the open one has been running longest')
  const lengths = data.bars.map((b) => b.days)
  assert.deepEqual(lengths, [...lengths].sort((a, b) => b - a))
})

test('no start column at all means the widget is not ready', () => {
  assert.equal(ganttData({ startColumn: '' }, { rows }).ready, false)
})
