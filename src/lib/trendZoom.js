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
// Four decisions:
//
//   THE LADDER IS THE CALENDAR, and only the calendar: year, quarter,
//   month, week, day. A folded bucket -- "March", "Monday" -- is three
//   Marches from three different years, so there is nothing to go inside:
//   it is a way of READING the whole span, not a slice of it. Clicking one
//   still filters the page, as it always did; it just cannot zoom, and the
//   chart says so rather than doing something surprising.
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

/** The rung below this one, or '' at the bottom (and off the ladder). */
export function finerGrain(grain) {
  const at = ZOOM_LADDER.indexOf(grain)
  return at === -1 || at === ZOOM_LADDER.length - 1 ? '' : ZOOM_LADDER[at + 1]
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
export function canZoom(grain, bucket) {
  return Boolean(finerGrain(grain)) && Boolean(bucket?.start) && Boolean(bucket?.end)
}

/** Why a click cannot go deeper, in words -- or '' when it can. */
export function zoomBlocked(grain, bucket) {
  if (!bucket?.start || !bucket?.end) return 'A folded period is every year at once, so there is nothing inside it'
  if (!finerGrain(grain)) return 'Days are as fine as this goes'
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
export function stepInto(trail, bucket, grain) {
  if (!canZoom(grain, bucket)) return trail || []
  const from = time(bucket.start)
  const to = time(bucket.end)
  if (from === null || to === null) return trail || []
  return [...(trail || []), { label: bucket.fullName || bucket.name || '', from, to, grain: finerGrain(grain) }]
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
