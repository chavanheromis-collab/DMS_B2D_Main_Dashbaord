// ---------------------------------------------------------------------
// Making a part-of-whole chart readable
// ---------------------------------------------------------------------
// A pie of 120 categories is not a hard chart to read. It is an unreadable
// one: 120 labels around a circle overlap into a grey smear, the slices
// below about 2% are thinner than their own outline, and the palette has
// long since started repeating so colour means nothing.
//
// The usual "fix" is a top-N limit, and on its own that is WORSE than the
// smear, because it is wrong rather than merely ugly. Keep the top 12 of
// 120 and every percentage on screen is a percentage of those twelve. A
// slice reading 34% might be 4% of the data. Nothing on the chart says so.
//
// So the rule here: a part-of-whole chart may hide a category, but it may
// never lose one. Everything past the cut is rolled into a single "Other"
// slice that carries its own members, and every percentage is computed
// against the REAL total. The circle keeps adding up to the thing it claims
// to be a picture of.

export const DEFAULT_PIE_OPTIONS = {
  maxSlices: 8,
  // Below this, a slice is thinner than its own label and contributes
  // nothing but noise -- it belongs in Other whatever the count allows.
  minPercent: 1.5,
  otherLabel: 'Other',
  rollup: true,
  // Labels are drawn only where they fit. Everything else is in the legend,
  // which can hold 120 rows and stay readable because it is a list.
  labelMinPercent: 4,
}

/**
 * The slices a part-of-whole chart should actually draw.
 *
 * Sorted biggest-first, because a pie is read clockwise from twelve and an
 * unsorted one makes the reader hunt. `percent` is a fraction of the whole,
 * always -- including on the rolled-up slice, which is exactly the number
 * the reader needs to judge whether the tail matters.
 */
export function pieSlices(data, options = {}) {
  const o = { ...DEFAULT_PIE_OPTIONS, ...options }
  const rows = (data || []).filter((d) => d && Number.isFinite(Number(d.value)))

  const total = rows.reduce((sum, d) => sum + Number(d.value), 0)
  if (rows.length === 0 || total <= 0) {
    return { slices: [], total: 0, rolled: 0, hiddenValue: 0, truncated: false }
  }

  const sorted = [...rows].sort((a, b) => Number(b.value) - Number(a.value))
  const withPct = sorted.map((d) => ({ ...d, value: Number(d.value), percent: Number(d.value) / total }))

  if (!o.rollup) {
    return { slices: withPct, total, rolled: 0, hiddenValue: 0, truncated: false }
  }

  const max = Number(o.maxSlices) > 0 ? Number(o.maxSlices) : withPct.length
  const floor = Math.max(0, Number(o.minPercent) || 0) / 100

  const kept = []
  const rest = []
  for (const slice of withPct) {
    // The count is a cap, not a quota: a slice under the floor goes to Other
    // even when there is room for it, and the cap keeps the last visible
    // slot free for Other rather than spending it on one more sliver.
    const room = kept.length < (withPct.length > max ? max - 1 : max)
    if (room && slice.percent >= floor) kept.push(slice)
    else rest.push(slice)
  }

  if (rest.length === 0) return { slices: kept, total, rolled: 0, hiddenValue: 0, truncated: false }

  // One straggler is not worth an "Other (1)" that says less than its own
  // name would.
  if (rest.length === 1) {
    return { slices: [...kept, rest[0]], total, rolled: 0, hiddenValue: 0, truncated: false }
  }

  const hiddenValue = rest.reduce((sum, d) => sum + d.value, 0)
  const other = {
    name: `${o.otherLabel} (${rest.length})`,
    value: hiddenValue,
    percent: hiddenValue / total,
    isOther: true,
    // Kept so the tooltip can answer "other WHAT" without another pass over
    // the data, and so a click can still say what it selected.
    members: rest.map((d) => ({ name: d.name, value: d.value, percent: d.percent })),
  }

  return { slices: [...kept, other], total, rolled: rest.length, hiddenValue, truncated: true }
}

/**
 * Which slices are big enough to carry a label on the chart itself.
 *
 * Everything else is still on screen -- in the legend, in the tooltip, and
 * as a slice you can point at. It is the LABEL that is dropped, not the
 * category, which is the difference between a clean chart and a lying one.
 */
export function labelledSlices(slices, labelMinPercent = DEFAULT_PIE_OPTIONS.labelMinPercent) {
  const floor = Math.max(0, Number(labelMinPercent) || 0) / 100
  return (slices || []).filter((s) => (s.percent ?? 0) >= floor)
}

/**
 * Text for one slice's label, in the style the admin picked.
 *
 * `base` decides which percentage a "%" means: the share of everything, or
 * the share of what the circle is currently showing. They are the same
 * number until a pie is scrolled through a long tail, and wildly different
 * after that -- which is exactly why it is the admin's choice and why the
 * caption underneath says which one is on.
 */
export function sliceLabel(slice, style, format = (v) => String(v), base = 'total') {
  const share = base === 'shown' && slice.percentShown !== undefined ? slice.percentShown : slice.percent ?? 0
  const pct = `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`
  switch (style) {
    case 'value':
      return format(slice.value)
    case 'name':
      return slice.name
    case 'percent':
      return pct
    case 'value_percent':
      return `${format(slice.value)} · ${pct}`
    case 'name_value':
      return `${slice.name} ${format(slice.value)}`
    case 'name_percent':
    default:
      return `${slice.name} ${pct}`
  }
}

export const PIE_PERCENT_BASES = [
  { value: 'total', label: '% of everything' },
  { value: 'shown', label: '% of what is on screen' },
]

export const PIE_LABEL_STYLES = [
  { value: 'name_percent', label: 'Name and %' },
  { value: 'name_value', label: 'Name and value' },
  { value: 'percent', label: '% only' },
  { value: 'value', label: 'Value only' },
  { value: 'name', label: 'Name only' },
  { value: 'value_percent', label: 'Value and %' },
]

/**
 * What the category list beside the pie shows in each row.
 *
 * The same six the slice labels offer, plus all three together -- which is
 * what the list has always drawn, and so has to remain sayable, or turning
 * the option on for the first time would silently change every existing
 * pie in the workspace.
 */
export const PIE_LIST_STYLES = [
  { value: 'name_value_percent', label: 'Name, value and %' },
  ...PIE_LABEL_STYLES,
]

/**
 * Which of the three columns a list style asks for.
 *
 * Booleans rather than a string, because the list is a ROW of aligned
 * columns and not a sentence: the values have to line up under each other
 * down the list, which they cannot do if they arrive already joined
 * together. `sliceLabel` next door builds the sentence for the pie itself.
 */
export function listColumns(style) {
  switch (style) {
    case 'name':
      return { name: true, value: false, percent: false }
    case 'value':
      return { name: false, value: true, percent: false }
    case 'percent':
      return { name: false, value: false, percent: true }
    case 'name_value':
      return { name: true, value: true, percent: false }
    case 'name_percent':
      return { name: true, value: false, percent: true }
    case 'value_percent':
      return { name: false, value: true, percent: true }
    case 'name_value_percent':
    default:
      // What the list drew before it was ever an option.
      return { name: true, value: true, percent: true }
  }
}

/**
 * A one-line description of what was rolled up, for the caption under the
 * chart. Silence about a roll-up is how a reader ends up trusting a picture
 * that is hiding a third of the data.
 */
export function rollupNote(result, format = (v) => String(v)) {
  if (!result?.truncated) return ''
  const share = ((result.hiddenValue / result.total) * 100).toFixed(result.hiddenValue / result.total < 0.1 ? 1 : 0)
  return `${result.rolled} smaller categories grouped into Other — ${format(result.hiddenValue)}, ${share}% of the total`
}

// ---------------------------------------------------------------------
// Scrolling through the slices instead of rolling them up
// ---------------------------------------------------------------------
// Rolling a hundred and twenty categories into "Other (113)" is honest and
// often right, but it answers the wrong question when the tail is the point
// -- when somebody wants to see all hundred and twenty, in order, and read
// each one's share.
//
// So the other way: every category in a scrollable legend, and the pie draws
// the ones currently in view. Scrolling the list moves the pie through the
// data, which is what makes a hundred and twenty categories readable in a
// space that fits eight.
//
// The circle still adds up to the whole. Everything outside the window is
// drawn as ONE quiet wedge with its own share on it -- because a pie that
// silently showed 6% of the data as a full circle would be the worst kind of
// wrong: confident, well drawn, and off by a factor of sixteen.

export const REST_LABEL = 'Not in view'

/**
 * The slices to draw for a legend scrolled to `start`, showing `count`.
 *
 * Percentages are untouched -- they are shares of the WHOLE, not of the
 * window, so the number beside a slice means the same thing however the
 * list happens to be scrolled.
 */
export function pieWindow(slices, { start = 0, count = 8, restLabel = REST_LABEL, fill = true } = {}) {
  const list = slices || []
  const size = Math.max(1, Math.round(count))
  const from = Math.max(0, Math.min(Math.round(start), Math.max(0, list.length - size)))
  const shown = list.slice(from, from + size)

  const total = list.reduce((sum, s) => sum + (s.value || 0), 0)
  const shownValue = shown.reduce((sum, s) => sum + (s.value || 0), 0)
  const restValue = Math.max(0, total - shownValue)

  // Two numbers per slice, because they answer two different questions and
  // a chart that offers only one of them is answering the wrong one half
  // the time:
  //
  //   `percent`      its share of EVERYTHING -- the honest number, the one
  //                  that means the same thing however the list is scrolled
  //   `percentShown` its share of what is on screen -- the one the geometry
  //                  uses when the circle is filled by the window
  //
  // Deep in the tail of a hundred and twenty categories, eight slices worth
  // 1% between them drawn against a 99% grey wedge is a chart of nothing.
  // Filling the circle with them is what makes the tail readable at all --
  // and it is only not a lie because the caption says what the circle is,
  // and every label can still carry the share of the whole.
  const withShare = shown.map((s) => ({
    ...s,
    percentShown: shownValue > 0 ? (s.value || 0) / shownValue : 0,
  }))

  const out = [...withShare]
  if (!fill && restValue > 0 && total > 0) {
    out.push({
      name: restLabel,
      value: restValue,
      percent: restValue / total,
      percentShown: 0,
      isRest: true,
      hidden: list.length - shown.length,
    })
  }

  return {
    slices: out,
    start: from,
    count: size,
    total,
    shownValue,
    restValue,
    restCount: list.length - shown.length,
    // What the circle is a picture of, as a share of everything.
    shownShare: total > 0 ? shownValue / total : 0,
    fill,
  }
}

/** How many legend rows fit, given the room and the height of one. */
export function legendWindowSize(availableHeight, rowHeight = 22, min = 3) {
  const rows = Math.floor((Number(availableHeight) || 0) / Math.max(1, rowHeight))
  return Math.max(min, rows)
}

/** Which row a scrolled legend is showing first. */
export function legendScrollStart(scrollTop, rowHeight = 22) {
  return Math.max(0, Math.round((Number(scrollTop) || 0) / Math.max(1, rowHeight)))
}
