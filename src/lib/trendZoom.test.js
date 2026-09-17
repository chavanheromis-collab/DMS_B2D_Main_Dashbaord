import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  DEFAULT_GRAIN_BUTTONS,
  GRAIN_BUTTONS,
  GRAIN_BUTTON_GROUPS,
  ZOOM_LADDER,
  backTo,
  canZoom,
  cleanGrainButtons,
  crumbs,
  drillSummary,
  finerGrain,
  grainButtonsFor,
  isZoomable,
  regrain,
  rowsInWindow,
  stepInto,
  trailGrain,
  windowConditions,
  zoomBlocked,
  zoomLadderFor,
  zoomNote,
  zoomWindow,
} from './trendZoom.js'
import { ALL_TIME_GRAINS, timeSeriesBy } from './seriesData.js'
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

// --- the buttons -----------------------------------------------------------

const values = (buttons) => buttons.map((b) => b.value)
const year2026 = () => series('year').data.find((d) => d.name === '2026')

test('a button exists for every bucket the chart can draw, and fits on one', () => {
  // Two lists that drift apart is a bucket the admin can choose and no
  // reader can ever press.
  assert.deepEqual([...values(GRAIN_BUTTONS)].sort(), ALL_TIME_GRAINS.map((g) => g.value).sort())
  for (const b of GRAIN_BUTTONS) assert.ok(b.label.length <= 8, `${b.label} is a sentence, not a button`)
  // The timeline first and coarsest first, which is the way a click drills.
  assert.deepEqual(values(GRAIN_BUTTON_GROUPS[0].buttons), ZOOM_LADDER)
  assert.equal(GRAIN_BUTTON_GROUPS[1].buttons.length, GRAIN_BUTTONS.length - ZOOM_LADDER.length)
  assert.deepEqual(DEFAULT_GRAIN_BUTTONS, ZOOM_LADDER)
})

test('a chart nobody has configured offers the timeline, and drills as it always did', () => {
  assert.deepEqual(values(grainButtonsFor({ grain: 'month' })), ['year', 'quarter', 'month', 'week', 'day'])
  assert.deepEqual(zoomLadderFor({ grain: 'month' }), ZOOM_LADDER)
  assert.deepEqual(zoomLadderFor({}), ZOOM_LADDER)
  assert.equal(
    drillSummary({ grain: 'month' }),
    'Clicking a period drills Year → Quarter → Month → Week → Day, and filters the page.'
  )
})

test('the admin’s buttons are what a reader sees, and the chart’s own bucket is always one', () => {
  // Without its own bucket, a reader who pressed Week could never get back
  // to the Month the chart opened on.
  assert.deepEqual(values(grainButtonsFor({ grain: 'month', grainButtons: ['day', 'week'] })), ['month', 'week', 'day'])
  assert.deepEqual(
    values(grainButtonsFor({ grain: 'month', grainButtons: ['dayOfWeek', 'year'] })),
    ['year', 'month', 'dayOfWeek']
  )
  // What was saved is cleaned on the way out, whatever it was.
  assert.deepEqual(cleanGrainButtons(['day', 'bogus', 'day', 'year']), ['year', 'day'])
  assert.deepEqual(cleanGrainButtons('nonsense'), [])
  // None is a real answer, and one button is not a choice.
  assert.deepEqual(grainButtonsFor({ grain: 'month', grainButtons: [] }), [])
  assert.deepEqual(grainButtonsFor({ grain: 'month', grainButtons: ['month'] }), [])
})

test('a click steps to the next button the reader can see', () => {
  const widget = { grain: 'year', grainButtons: ['year', 'month', 'day'] }
  const ladder = zoomLadderFor(widget)
  assert.deepEqual(ladder, ['year', 'month', 'day'])
  // Never onto a Quarter or a Week nobody offered.
  assert.equal(finerGrain('year', ladder), 'month')
  assert.equal(finerGrain('month', ladder), 'day')
  assert.equal(finerGrain('day', ladder), '')
  assert.equal(finerGrain('dayOfWeek', ladder), '')

  const trail = stepInto([], year2026(), 'year', ladder)
  assert.equal(trail[0].grain, 'month')
  assert.equal(trail[0].span, 'year')
  assert.equal(inside(trail, 'month').data.length, 12, 'the year, read by its months')
  assert.equal(drillSummary(widget), 'Clicking a period drills Year → Month → Day, and filters the page.')

  // A chart whose finest button is Month says so rather than doing nothing.
  const monthly = zoomLadderFor({ grain: 'month', grainButtons: ['year'] })
  assert.equal(canZoom('month', year2026(), monthly), false)
  assert.match(zoomBlocked('month', year2026(), monthly), /Months are as fine as this chart goes/)
})

test('without two timeline buttons a click filters and does not drill, and the admin is told', () => {
  for (const grainButtons of [[], ['dayOfWeek', 'monthOfYear']]) {
    const widget = { grain: 'month', grainButtons }
    assert.deepEqual(zoomLadderFor(widget), ['month'])
    assert.equal(canZoom('month', year2026(), zoomLadderFor(widget)), false)
    assert.match(drillSummary(widget), /^Clicking a period filters the page\./)
  }
})

test('a button pressed inside a period re-reads that period where it can', () => {
  const trail = stepInto([], year2026(), 'year')

  // Finer: 2026, by month.
  const byMonth = regrain(trail, 'month')
  assert.equal(byMonth.length, 1)
  assert.equal(byMonth[0].grain, 'month')
  assert.equal(byMonth[0].from, trail[0].from)
  assert.equal(inside(byMonth, 'month').data.length, 12)

  // Folded: 2026, by weekday -- all of 2026's rows and nothing else.
  const byWeekday = regrain(trail, 'dayOfWeek')
  assert.equal(byWeekday[0].grain, 'dayOfWeek')
  const weekdays = inside(byWeekday, 'dayOfWeek').data
  assert.equal(weekdays.length, 7)
  assert.equal(weekdays.reduce((sum, d) => sum + d.count, 0), 4, 'the 2025 row is not in 2026')

  // As coarse as the period itself: a year by years is one bar, so out.
  assert.deepEqual(regrain(trail, 'year'), [])
  // At the top there is nothing to re-read; the caller changes the bucket.
  assert.deepEqual(regrain([], 'week'), [])
  // And something that is not a button changes nothing.
  assert.deepEqual(regrain(trail, 'bogus'), trail)
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
  assert.ok(
    widget.includes('if (canZoom(grain, bucket, ladder)) setTrail((current) => stepInto(current, bucket, grain, ladder))')
  )
  assert.ok(widget.includes('const ladder = useMemo(() => zoomLadderFor(widget), [widget.grainButtons, widget.grain])'))
  // The cross-filter below it is untouched: the zoom is this chart, the
  // filter is the rest of the dashboard.
  assert.ok(widget.includes("id: `trend_${widget.id}`"))
})

test('there is a way back, and the admin’s buckets are buttons rather than a dropdown', () => {
  assert.ok(widget.includes('setTrail(backTo(trail, crumb.index))'))

  const trend = widget.slice(widget.indexOf('export function TrendWidget('), widget.indexOf('function TrendTooltip('))
  assert.ok(trend.length > 0, 'the trend widget moved')
  assert.ok(trend.includes('const buttons = useMemo(() => grainButtonsFor(widget), [widget.grainButtons, widget.grain])'))
  assert.ok(trend.includes('{buttons.map((b) => {'))
  assert.ok(trend.includes('onClick={() => chooseGrain(b.value)}'))
  assert.ok(trend.includes('aria-pressed={on}'))
  assert.ok(trend.includes('const on = b.value === grain'), 'the lit button is the grain in force')
  assert.ok(!trend.includes('<select'), 'the dropdown is back')
  // Pressed inside a period, it re-reads that period.
  assert.ok(trend.includes('const next = regrain(trail, value)'))
  // The admin changing the chart -- its buttons included -- resets where the
  // reader was standing.
  assert.ok(trend.includes('}, [widget.grain, widget.dateColumn, offered])'))
})

test('the admin picks the buttons, and is told what a click will do', () => {
  const editor = read('pages/admin/WidgetEditors.jsx')
  assert.ok(editor.includes("{part === 'buttons' && <GrainButtonsEditor widget={widget} set={set} />}"))
  assert.ok(editor.includes('const choose = (list) => set({ grainButtons: cleanGrainButtons(list) })'))
  assert.ok(editor.includes('{drillSummary(widget)}'))
  // The chart's own bucket cannot be switched off.
  assert.ok(editor.includes('disabled={fixed}'))
})
