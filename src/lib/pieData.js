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

/** Text for one slice's label, in the style the admin picked. */
export function sliceLabel(slice, style, format = (v) => String(v)) {
  const pct = `${((slice.percent ?? 0) * 100).toFixed((slice.percent ?? 0) < 0.1 ? 1 : 0)}%`
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

export const PIE_LABEL_STYLES = [
  { value: 'name_percent', label: 'Name and %' },
  { value: 'name_value', label: 'Name and value' },
  { value: 'percent', label: '% only' },
  { value: 'value', label: 'Value only' },
  { value: 'name', label: 'Name only' },
  { value: 'value_percent', label: 'Value and %' },
]

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
