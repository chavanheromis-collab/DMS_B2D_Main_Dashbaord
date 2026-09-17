// ---------------------------------------------------------------------
// Going inside a period
// ---------------------------------------------------------------------
// A trend answers "how much, over time" at whatever grain the admin chose.
// The question it always provokes is the next one: 2026 is down -- which
// part of it? And until now the only way to ask was to open the admin
// panel, change the bucket to Month, look, and change it back.
//
// So a click goes INSIDE the period it lands on. The year becomes its
// quarters, a quarter its months, a month its weeks, a week its days. A
// trail along the top says where you are and takes you back.
//
// Five decisions:
//
//   THE LADDER IS THE CALENDAR, and only the calendar: year, quarter,
//   month, week, day. A folded bucket -- "March", "Monday" -- is three
//   Marches from three different years, so there is nothing to go inside:
//   it is a way of READING the whole span, not a slice of it. Clicking one
//   still filters the page, as it always did; it just cannot zoom, and the
//   chart says so rather than doing something surprising.
//
//   WHICH RUNGS IS THE ADMIN'S. The chart carries buttons for the buckets
//   the admin chose to offer, and a click steps to the next finer TIMELINE
//   button -- so a chart offering Year, Month and Day goes Year, Month, Day,
//   and never lands on a Quarter nobody can see a button for. A chart
//   nobody has configured offers the whole timeline, exactly as before.
//
//   THE WINDOW COMES FROM THE BUCKET, not from its label. The series
//   already knows where each bucket starts and ends -- to the millisecond,
//   leap years and all -- and reverse-engineering "Sep 26" back into dates
//   is how a drill lands on the wrong month every February.
//
//   IT IS THE READER'S, NOT THE WIDGET'S. Going into September changes
//   nothing for anybody else and nothing about what the admin saved. It
//   lives for as long as the page is open, like a legend a reader has
//   switched a series off in.
//
//   IT DOES NOT REPLACE THE PAGE FILTER. Clicking a period still narrows
//   the dashboard exactly as it did before. The zoom is what happens to
//   THIS chart; the cross-filter is what happens to the others.
//
// Pure: a trail and some rows in, a trail and some rows out. No React.

import { toDate } from './dataUtils.js'

/**
 * The rungs, coarsest first.
 *
 * Week sits between month and day deliberately: a month of days is thirty
 * bars and the shape of a month is its weeks. Day is the floor -- an hour
 * needs a time of day, and a spreadsheet column of dates rarely has one.
 */
export const ZOOM_LADDER = ['year', 'quarter', 'month', 'week', 'day']

/**
 * The rung below this one, or '' at the bottom (and off the ladder).
 *
 * `ladder` is the rungs this chart actually offers -- see zoomLadderFor.
 * Ranked by the calendar rather than by position in `ladder`, so a ladder
 * with gaps in it (Year, Month, Day) steps over the rungs it does not have.
 */
export function finerGrain(grain, ladder = ZOOM_LADDER) {
  const rank = ZOOM_LADDER.indexOf(grain)
  if (rank === -1) return ''
  return ZOOM_LADDER.find((rung, i) => i > rank && ladder.includes(rung)) || ''
}

/** Is this a grain a click can go inside at all? */
export const isZoomable = (grain) => ZOOM_LADDER.includes(grain)

/**
 * Can this particular bucket be opened?
 *
 * Both halves matter: there must be a finer rung to land on, and the bucket
 * must be a real span. A folded bucket carries no start, which is exactly
 * what says "this is a reading of the whole period, not a piece of it".
 */
export function canZoom(grain, bucket, ladder = ZOOM_LADDER) {
  return Boolean(finerGrain(grain, ladder)) && Boolean(bucket?.start) && Boolean(bucket?.end)
}

const PLURAL = { year: 'Years', quarter: 'Quarters', month: 'Months', week: 'Weeks' }

/** Why a click cannot go deeper, in words -- or '' when it can. */
export function zoomBlocked(grain, bucket, ladder = ZOOM_LADDER) {
  if (!bucket?.start || !bucket?.end) return 'A folded period is every year at once, so there is nothing inside it'
  if (!finerGrain(grain, ladder)) {
    // Day is the calendar's floor; anything else is this chart's choice.
    return grain === 'day' ? 'Days are as fine as this goes' : `${PLURAL[grain] || 'These'} are as fine as this chart goes`
  }
  return ''
}

const time = (value) => {
  const at = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(at) ? at : null
}

/**
 * The trail after going into one bucket.
 *
 * Epoch numbers rather than Dates: this is state, it is compared on every
 * render, and two Date objects for the same instant are never equal.
 */
export function stepInto(trail, bucket, grain, ladder = ZOOM_LADDER) {
  if (!canZoom(grain, bucket, ladder)) return trail || []
  const from = time(bucket.start)
  const to = time(bucket.end)
  if (from === null || to === null) return trail || []
  return [
    ...(trail || []),
    // `span` is what the period IS (a year); `grain` is what it is read by
    // (its months). A button pressed inside it needs both -- see regrain.
    { label: bucket.fullName || bucket.name || '', from, to, span: grain, grain: finerGrain(grain, ladder) },
  ]
}

/** Where we are: the innermost step's window, or null at the top. */
export function zoomWindow(trail) {
  const last = (trail || [])[(trail || []).length - 1]
  return last ? { from: last.from, to: last.to } : null
}

/** The grain actually in force -- the trail's, or the widget's own. */
export function trailGrain(trail, fallback = 'month') {
  const last = (trail || [])[(trail || []).length - 1]
  return last?.grain || fallback
}

/** Back to a crumb: -1 is all the way out. */
export const backTo = (trail, index) => (index < 0 ? [] : (trail || []).slice(0, index + 1))

/**
 * The crumbs to draw, including the way out.
 *
 * The root is always there, even at the top, so the trail is a place rather
 * than something that appears only once you are lost in it.
 */
export function crumbs(trail, root = 'All time') {
  return [{ label: root, index: -1 }, ...(trail || []).map((step, i) => ({ label: step.label, index: i }))]
}

/** Only the rows inside the window -- both ends included, as the filter is. */
export function rowsInWindow(rows, column, window, order = 'DMY') {
  if (!window || !column) return rows || []
  return (rows || []).filter((row) => {
    const at = toDate(row[column], order)
    if (!at) return false
    const ms = at.getTime()
    return ms >= window.from && ms <= window.to
  })
}

const iso = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The window as a condition, in the one form the filter engine reads.
 *
 * The same shape the chart already writes when a period is clicked, so the
 * zoom and the page agree about which rows a period holds.
 */
export function windowConditions(column, window) {
  if (!column || !window) return null
  return [{ column, operator: 'date_between', value: iso(window.from), value2: iso(window.to) }]
}

/** "Sep 2026 · by day" -- what the caption says while zoomed in. */
export function zoomNote(trail, grain) {
  const last = (trail || [])[(trail || []).length - 1]
  if (!last) return ''
  return `${last.label} · by ${grain}`
}

// ---------------------------------------------------------------------
// The buttons on the chart
// ---------------------------------------------------------------------
// A reader switches what the chart is read by with buttons on it -- every
// option in sight, one press each -- rather than a dropdown that hid ten
// choices behind a click and named them in admin language. WHICH buttons
// is the admin's call: a sales chart may want Month, Week and Day and
// nothing else, and ten buttons on a small card is a toolbar, not a chart.

/**
 * Every bucket a button can offer, in the order they are drawn.
 *
 * The timeline first, coarsest first, so the row reads the way a click
 * drills: one button to the right. Folded buckets after it, named by their
 * range, because "Day of week (Mon–Sun)" does not fit on a button and
 * "Mon–Sun" says the same thing.
 */
export const GRAIN_BUTTONS = [
  { value: 'year', label: 'Year', title: 'One bar per year' },
  { value: 'quarter', label: 'Quarter', title: 'One bar per quarter' },
  { value: 'month', label: 'Month', title: 'One bar per month' },
  { value: 'week', label: 'Week', title: 'One bar per week' },
  { value: 'day', label: 'Day', title: 'One bar per day' },
  { value: 'quarterOfYear', label: 'Q1–Q4', title: 'Quarter of year, every year folded together' },
  { value: 'monthOfYear', label: 'Jan–Dec', title: 'Month of year, every year folded together' },
  { value: 'weekOfYear', label: 'W1–W53', title: 'Week of year, every year folded together' },
  { value: 'dayOfMonth', label: '1–31', title: 'Day of month, every month folded together' },
  { value: 'dayOfWeek', label: 'Mon–Sun', title: 'Day of week, every week folded together' },
]

/** The same buttons, grouped the way the admin picks them. */
export const GRAIN_BUTTON_GROUPS = [
  { label: 'Along a timeline', buttons: GRAIN_BUTTONS.filter((b) => isZoomable(b.value)) },
  { label: 'Folded onto one cycle', buttons: GRAIN_BUTTONS.filter((b) => !isZoomable(b.value)) },
]

/**
 * What a chart nobody has configured offers: the timeline.
 *
 * Which is the drill ladder it always had, as buttons -- so an existing
 * chart drills exactly as it did the day before this setting existed.
 */
export const DEFAULT_GRAIN_BUTTONS = [...ZOOM_LADDER]

const BUTTON_ORDER = GRAIN_BUTTONS.map((b) => b.value)

/** Known values only, once each, in drawing order. */
export function cleanGrainButtons(list) {
  const wanted = new Set(Array.isArray(list) ? list : [])
  return BUTTON_ORDER.filter((value) => wanted.has(value))
}

/** The admin's choice, or the default when there is none. */
const chosenOf = (widget) =>
  Array.isArray(widget?.grainButtons) ? cleanGrainButtons(widget.grainButtons) : [...DEFAULT_GRAIN_BUTTONS]

/**
 * The buttons to draw on this chart -- or none.
 *
 * The chart's own bucket is always among them. Without it, a reader who
 * pressed Week would have no way back to the Month the chart opened on,
 * short of reloading the page. And one button is not a choice, so a chart
 * left with only its own bucket is drawn with none.
 */
export function grainButtonsFor(widget) {
  const chosen = chosenOf(widget)
  if (chosen.length === 0) return []
  const offered = cleanGrainButtons([...chosen, widget?.grain || 'month'])
  if (offered.length < 2) return []
  return offered.map((value) => GRAIN_BUTTONS.find((b) => b.value === value))
}

/**
 * The rungs a click walks down on this chart.
 *
 * The timeline buttons it offers, plus its own bucket -- so the lit button
 * always moves to one the reader can see.
 */
export function zoomLadderFor(widget) {
  const chosen = chosenOf(widget)
  const own = widget?.grain || 'month'
  return ZOOM_LADDER.filter((rung) => chosen.includes(rung) || rung === own)
}

/**
 * The trail after a button is pressed.
 *
 * At the top there is no trail: the caller changes the bucket and that is
 * all. Inside a period the question is whether the new bucket has anything
 * to show IN it. A finer one does (2026 by month), and so does a folded one
 * (2026 by weekday). One as coarse as the period itself does not -- a year
 * read by years is a single bar -- so that goes back out to the top.
 */
export function regrain(trail, value) {
  const list = trail || []
  const last = list[list.length - 1]
  if (!last) return []
  if (!BUTTON_ORDER.includes(value)) return list
  const finer = ZOOM_LADDER.indexOf(value) > ZOOM_LADDER.indexOf(last.span)
  if (isZoomable(value) && !finer) return []
  return [...list.slice(0, -1), { ...last, grain: value }]
}

const labelOf = (value) => GRAIN_BUTTONS.find((b) => b.value === value)?.label || value

/**
 * What a click on a period will do, in one line for the admin.
 *
 * Choosing buttons changes where a click drills to, and a setting whose
 * consequence stays invisible until a reader stumbles on it is a setting
 * nobody trusts -- so the editor says it while the choice is being made.
 */
export function drillSummary(widget) {
  const ladder = zoomLadderFor(widget)
  if (ladder.length < 2) {
    return 'Clicking a period filters the page. Offer two or more timeline buttons to let it drill in as well.'
  }
  return `Clicking a period drills ${ladder.map(labelOf).join(' → ')}, and filters the page.`
}
