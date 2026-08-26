import { PALETTE } from './config.js'

/**
 * One colour, one value, everywhere.
 *
 * A colour is a label. A reader who has learned that red means Cancelled
 * reads the chart without the legend -- and that only works if the colour
 * belongs to the VALUE rather than to the position it happens to occupy.
 *
 * Cycling a palette by rendered index breaks it the moment anything is
 * filtered: drop Delivered and every category behind it shifts up a seat,
 * so Cancelled turns from red to amber and the reader's learned colour is
 * now a lie about a different category. Two charts of the same column on
 * one page disagree with each other for the same reason.
 *
 * So a colour comes from, in order:
 *   1. an explicit pin -- the admin said Cancelled is red,
 *   2. the value's SEAT in the roster: the order the chart draws with
 *      nothing filtered, so a filter narrows the chart without moving
 *      anybody's colour,
 *   3. the rendered position, when there is no roster to consult.
 *
 * Step 2 is why an unfiltered chart looks exactly as it always did: its
 * roster order IS its render order.
 */

/** Trimmed and case-folded: "HDFC " in a sheet is `HDFC` in the panel. */
export function colorKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

/** What a roll-up bucket is painted. Never a palette colour -- a bucket the
 *  chart invented must not look like a category the data holds. */
export const ROLLUP_COLOR = '#cbd5e1'

const ROLLUP_KEYS = new Set(['other', 'not in view'])

export function isRollup(value) {
  return ROLLUP_KEYS.has(colorKey(value))
}

export const SERIES_PALETTES = [
  { value: 'default', label: 'Standard', colors: PALETTE },
  {
    value: 'cool',
    label: 'Cool',
    colors: ['#0EA5E9', '#6366F1', '#14B8A6', '#8B5CF6', '#0891B2', '#4F46E5', '#059669', '#7C3AED'],
  },
  {
    value: 'warm',
    label: 'Warm',
    colors: ['#F97316', '#EF4444', '#F59E0B', '#EC4899', '#DC2626', '#D97706', '#DB2777', '#B45309'],
  },
  {
    value: 'earth',
    label: 'Earth',
    colors: ['#65A30D', '#CA8A04', '#0D9488', '#A16207', '#4D7C0F', '#15803D', '#92400E', '#166534'],
  },
  {
    value: 'mono',
    label: 'One hue',
    colors: ['#1E3A8A', '#1D4ED8', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE', '#DBEAFE'],
  },
]

/** By name, or a list of colours passed straight through. */
export function paletteFor(name) {
  if (Array.isArray(name) && name.length > 0) return name
  return (SERIES_PALETTES.find((p) => p.value === name) || SERIES_PALETTES[0]).colors
}

/**
 * The seating plan: value -> the seat it holds when nothing is filtered.
 *
 * Built from the names in their unfiltered order, so seat 0 is the first
 * category the chart would draw and takes the first palette colour, exactly
 * as index cycling did before there was a roster.
 */
export function buildRoster(names) {
  const roster = new Map()
  for (const name of names || []) {
    const key = colorKey(name)
    // First appearance wins; a repeated name is the same category.
    if (!roster.has(key)) roster.set(key, roster.size)
  }
  return roster
}

/** The pinned colour for a value, or null. */
export function pinnedColor(value, assignments) {
  const wanted = colorKey(value)
  for (const rule of assignments || []) {
    if (!rule?.color) continue
    if (colorKey(rule.value) === wanted) return rule.color
  }
  return null
}

/**
 * The seat a value holds -- its roster seat, else where it is being drawn.
 *
 * A value the roster has never heard of sits BEHIND everyone it does know:
 * a chart capped at twelve categories has a roster of twelve, and a filter
 * can lift a thirteenth into view. Seating it at its rendered position
 * would drop it straight on top of whoever holds that seat.
 */
export function seatOf(value, index, roster) {
  const at = Number.isFinite(index) ? index : 0
  if (roster && typeof roster.get === 'function') {
    const seat = roster.get(colorKey(value))
    return seat === undefined ? roster.size + at : seat
  }
  return at
}

/**
 * The colour for one value.
 *
 * The roll-up grey wins even over a pin. "Other" is a bucket the chart
 * invented out of the tail it could not draw -- painting it like a category
 * would make a chart claim a category exists that no row holds, and an
 * admin who pins it a colour has almost certainly pinned a real value of
 * that name in some other chart.
 */
export function valueColor(value, index, { assignments, palette, roster, rollupColor = ROLLUP_COLOR } = {}) {
  if (isRollup(value)) return rollupColor

  const pinned = pinnedColor(value, assignments)
  if (pinned) return pinned

  const colors = paletteFor(palette)
  const seat = seatOf(value, index, roster)
  return colors[((seat % colors.length) + colors.length) % colors.length]
}

/**
 * The next colour to offer when pinning another value.
 *
 * The first palette colour nobody has taken, so an admin adding four pins
 * gets four different colours rather than having to notice that two of them
 * came out identical.
 */
export function nextPinColor(assignments, palette) {
  const colors = paletteFor(palette)
  const taken = new Set((assignments || []).map((r) => String(r?.color || '').toLowerCase()))
  return colors.find((c) => !taken.has(c.toLowerCase())) || colors[(assignments?.length || 0) % colors.length]
}

/**
 * Pins that paint two different values the same colour.
 *
 * Two categories in one chart sharing a colour is not a crash, it is worse:
 * a chart that reads fine and means nothing. The editor says so rather than
 * silently renumbering, because which of the two should move is the admin's
 * call.
 */
export function clashingPins(assignments) {
  const byColor = new Map()
  for (const rule of assignments || []) {
    if (!rule?.color || !String(rule.value ?? '').trim()) continue
    const color = String(rule.color).toLowerCase()
    if (!byColor.has(color)) byColor.set(color, [])
    const names = byColor.get(color)
    // The same value pinned twice is a duplicate row, not a clash.
    if (!names.some((n) => colorKey(n) === colorKey(rule.value))) names.push(String(rule.value).trim())
  }
  return [...byColor.values()].filter((names) => names.length > 1)
}

/**
 * Whether the roster is worth building at all.
 *
 * With nothing filtered the roster order IS the render order, so consulting
 * it would return the same colours the index already gives -- and grouping
 * the whole sheet a second time to learn that is pure waste on every render
 * of every unfiltered chart.
 */
export function needsRoster(rows, unfilteredRows) {
  if (!Array.isArray(rows) || !Array.isArray(unfilteredRows)) return false
  return rows.length !== unfilteredRows.length
}
