import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  ZOOM_LADDER,
  backTo,
  canZoom,
  crumbs,
  finerGrain,
  isZoomable,
  rowsInWindow,
  stepInto,
  trailGrain,
  windowConditions,
  zoomBlocked,
  zoomNote,
  zoomWindow,
} from './trendZoom.js'
import { timeSeriesBy } from './seriesData.js'
import { matchesConditions } from './filterEngine.js'

// ---------------------------------------------------------------------
// Going inside a period
// ---------------------------------------------------------------------
// "2026 is down -- which part of it?" used to mean opening the admin
// panel, changing the bucket, looking, and changing it back. What must
// hold: the window comes from the bucket rather than from its label, a
// folded bucket is honestly refused, and the rows the chart shows are the
// same rows the filter it writes would select.

const ROWS = [
  { _row: 2, Date: '15/01/2026', Amount: '10' },
  { _row: 3, Date: '20/03/2026', Amount: '20' },
  { _row: 4, Date: '05/09/2026', Amount: '30' },
  { _row: 5, Date: '25/09/2026', Amount: '40' },
  { _row: 6, Date: '31/12/2025', Amount: '50' },
]
const series = (grain, rows = ROWS, window = null) =>
  timeSeriesBy(rows, {
    dateColumn: 'Date',
    grain,
    aggregation: 'count',
    order: 'DMY',
    from: window ? window.from : null,
    to: window ? window.to : null,
  })

/** The rows and the span of a trail, the way the widget draws it. */
const inside = (trail, grain) => series(grain, rowsIn(trail), zoomWindow(trail))

// --- the ladder ------------------------------------------------------------

test('a click goes one rung finer, and day is the floor', () => {
  assert.deepEqual(ZOOM_LADDER, ['year', 'quarter', 'month', 'week', 'day'])
  assert.equal(finerGrain('year'), 'quarter')
  assert.equal(finerGrain('quarter'), 'month')
  assert.equal(finerGrain('month'), 'week')
  assert.equal(finerGrain('week'), 'day')
  assert.equal(finerGrain('day'), '', 'a spreadsheet date rarely carries a time of day')
  // A folded bucket is not on the ladder at all.
  assert.equal(finerGrain('monthOfYear'), '')
  assert.equal(isZoomable('month'), true)
  assert.equal(isZoomable('dayOfWeek'), false)
})

test('a folded period is refused, and says why', () => {
  // "March" is three Marches from three different years: a way of reading
  // the whole span, not a piece of it.
  const folded = series('monthOfYear').data.find((d) => d.name === 'Mar')
  assert.ok(folded, 'the folded axis still draws every slot')
  assert.equal(canZoom('monthOfYear', folded), false)
  assert.match(zoomBlocked('monthOfYear', folded), /nothing inside it/)

  const real = series('year').data.find((d) => d.name === '2026')
  assert.equal(canZoom('year', real), true)
  assert.equal(zoomBlocked('year', real), '')
  assert.match(zoomBlocked('day', real), /as fine as this goes/)
})

// --- going in --------------------------------------------------------------

test('the window comes from the bucket, not from its label', () => {
  // Reverse-engineering "Sep 26" into dates is how a drill lands on the
  // wrong month every February.
  const year = series('year').data.find((d) => d.name === '2026')
  const trail = stepInto([], year, 'year')
  assert.equal(trail.length, 1)
  assert.equal(trail[0].grain, 'quarter')
  assert.equal(new Date(trail[0].from).getFullYear(), 2026)
  assert.equal(new Date(trail[0].from).getMonth(), 0)
  assert.equal(new Date(trail[0].to).getMonth(), 11)
  assert.deepEqual(zoomWindow(trail), { from: trail[0].from, to: trail[0].to })
  assert.equal(zoomWindow([]), null)
})

test('a bucket that cannot be opened leaves the trail alone', () => {
  const folded = series('dayOfWeek').data[0]
  assert.deepEqual(stepInto([], folded, 'dayOfWeek'), [])
  assert.deepEqual(stepInto([], null, 'year'), [])
})

test('the grain in force is the trail’s, and the widget’s at the top', () => {
  const year = series('year').data.find((d) => d.name === '2026')
  const trail = stepInto([], year, 'year')
  assert.equal(trailGrain([], 'month'), 'month')
  assert.equal(trailGrain(trail, 'month'), 'quarter')
  assert.equal(trailGrain(null, 'dayOfWeek'), 'dayOfWeek')
})

test('going in twice reaches the months of one quarter', () => {
  const year = series('year').data.find((d) => d.name === '2026')
  const intoYear = stepInto([], year, 'year')
  const quarters = inside(intoYear, 'quarter').data
  const q3 = quarters.find((d) => d.name.startsWith('Q3'))
  const intoQuarter = stepInto(intoYear, q3, 'quarter')

  assert.equal(intoQuarter.length, 2)
  assert.equal(intoQuarter[1].grain, 'month')
  const months = inside(intoQuarter, 'month').data
  // July, August, September of 2026 -- and both September rows in it.
  assert.deepEqual(months.map((m) => m.name), ['Jul 26', 'Aug 26', 'Sep 26'])
  assert.equal(months.find((m) => m.name === 'Sep 26').count, 2)
})

test('inside a period, an empty stretch reads as zero rather than vanishing', () => {
  // The whole point of going in. July and August have no rows at all; an
  // axis built from the rows would start at September and quietly answer a
  // different question than the one that was asked.
  const year = series('year').data.find((d) => d.name === '2026')
  const intoYear = stepInto([], year, 'year')
  const quarters = inside(intoYear, 'quarter').data
  assert.deepEqual(quarters.map((q) => q.name), ['Q1 26', 'Q2 26', 'Q3 26', 'Q4 26'])
  assert.deepEqual(quarters.map((q) => q.count), [2, 0, 2, 0])

  // And a period that turns out to be empty is still a chart, not an error.
  const q2 = quarters.find((d) => d.name.startsWith('Q2'))
  const intoQ2 = stepInto(intoYear, q2, 'quarter')
  const months = inside(intoQ2, 'month').data
  assert.deepEqual(months.map((m) => m.name), ['Apr 26', 'May 26', 'Jun 26'])
  assert.deepEqual(months.map((m) => m.count), [0, 0, 0])
})

function rowsIn(trail) {
  return rowsInWindow(ROWS, 'Date', zoomWindow(trail), 'DMY')
}

// --- what is inside it -----------------------------------------------------

test('only the rows inside the window, both ends included', () => {
  const year = series('year').data.find((d) => d.name === '2026')
  const inside = rowsIn(stepInto([], year, 'year'))
  assert.deepEqual(inside.map((r) => r._row), [2, 3, 4, 5], 'the 2025 row is outside it')
  // At the top, everything.
  assert.equal(rowsInWindow(ROWS, 'Date', null).length, ROWS.length)
  assert.equal(rowsInWindow(ROWS, '', { from: 0, to: 1 }).length, ROWS.length)
})

test('the chart and the filter it writes agree about a period', () => {
  // The zoom narrows rows itself; clicking also filters the page. If the
  // two disagreed, the chart would show one September and the rest of the
  // dashboard another.
  const sep = series('month').data.find((d) => d.name === 'Sep 26')
  const trail = stepInto([], sep, 'month')
  const window = zoomWindow(trail)
  const conditions = windowConditions('Date', window)
  assert.deepEqual(conditions, [{ column: 'Date', operator: 'date_between', value: '2026-09-01', value2: '2026-09-30' }])

  const byWindow = rowsInWindow(ROWS, 'Date', window, 'DMY').map((r) => r._row)
  const byFilter = ROWS.filter((row) => matchesConditions(row, conditions, 'all', 'DMY')).map((r) => r._row)
  assert.deepEqual(byWindow, [4, 5])
  assert.deepEqual(byFilter, byWindow)
  assert.equal(windowConditions('', window), null)
  assert.equal(windowConditions('Date', null), null)
})

// --- the way back ----------------------------------------------------------

test('the trail says where you are and takes you back', () => {
  const year = series('year').data.find((d) => d.name === '2026')
  const intoYear = stepInto([], year, 'year')
  const q3 = series('quarter', rowsIn(intoYear)).data.find((d) => d.name.startsWith('Q3'))
  const trail = stepInto(intoYear, q3, 'quarter')

  assert.deepEqual(crumbs(trail).map((c) => c.index), [-1, 0, 1])
  assert.equal(crumbs(trail)[0].label, 'All time')
  assert.equal(crumbs(trail, 'Everything')[0].label, 'Everything')
  assert.deepEqual(backTo(trail, 0), [trail[0]], 'back to the year')
  assert.deepEqual(backTo(trail, -1), [], 'and all the way out')
  assert.deepEqual(backTo(trail, 1), trail)
  assert.match(zoomNote(trail, 'month'), / · by month$/)
  assert.equal(zoomNote([], 'month'), '')
})

// --- wiring ----------------------------------------------------------------

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const widget = read('components/widgets/AnalyticsWidgets.jsx')

test('the chart draws the period it is standing in, at the grain in force', () => {
  assert.ok(widget.includes('const grain = trailGrain(trail, adminGrain)'))
  assert.ok(widget.includes('const window = useMemo(() => zoomWindow(trail), [trail])'))
  // The span goes to the series, or an empty July inside a quarter would
  // simply not be drawn.
  assert.ok(widget.includes('from: window ? window.from : null'))
  assert.ok(widget.includes('rowsInWindow(source, widget.dateColumn, window, dateOrder)'))
  assert.ok(widget.includes('() => shape(inWindow)'))
})

test('a click goes in, and still filters the page as it always did', () => {
  assert.ok(widget.includes('if (canZoom(grain, bucket)) setTrail((current) => stepInto(current, bucket, grain))'))
  // The cross-filter below it is untouched: the zoom is this chart, the
  // filter is the rest of the dashboard.
  assert.ok(widget.includes("id: `trend_${widget.id}`"))
})

test('there is a way back, and every bucket is reachable without an admin', () => {
  assert.ok(widget.includes('setTrail(backTo(trail, crumb.index))'))
  assert.ok(widget.includes('{ALL_TIME_GRAINS.map((g) => ('))
  // The admin changing the chart resets where the reader was standing.
  assert.ok(widget.includes('}, [widget.grain, widget.dateColumn])'))
})
