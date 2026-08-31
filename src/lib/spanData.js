// ---------------------------------------------------------------------
// Two numbers per category, and the distance between them
// ---------------------------------------------------------------------
// "Quoted 140, booked 96" per branch. A grouped bar chart draws that as six
// bars and asks the reader to subtract them in their head, twelve times.
// A dumbbell draws the GAP -- two dots and the line between them -- and the
// eye reads the widest line first, which is the branch the meeting is
// actually about.
//
// The same shape answers before-and-after, target-and-actual, this-month
// and last, and plan against spend. What they have in common is that the
// question is the distance, not either end.
//
// Built on `groupSeries`, which already turns rows into two aggregations per
// group. Nothing here regroups anything: this is the arithmetic of the gap
// and the order it puts the rows in.
//
// Pure: entries in, entries out. No React, no rows of a sheet.

import { groupSeries } from './dataUtils.js'

/**
 * How the rows are ordered.
 *
 * `gap_desc` is the default and the reason the chart exists -- the widest
 * distance is the thing to look at, and any other order buries it. The rest
 * are here because sometimes the question really is "who is biggest".
 */
export const SPAN_SORTS = [
  { value: 'gap_desc', label: 'Widest gap first' },
  { value: 'gap_asc', label: 'Narrowest gap first' },
  { value: 'to_desc', label: 'Second value, highest first' },
  { value: 'from_desc', label: 'First value, highest first' },
  { value: 'name_asc', label: 'Name, A → Z' },
  { value: 'name_desc', label: 'Name, Z → A' },
]

export const DEFAULT_SPAN_SORT = 'gap_desc'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * One row per group: where it starts, where it ends, and how far that is.
 *
 * `gap` is signed -- to minus from -- because the direction is half the
 * finding. A branch that went from 96 to 140 and one that went from 140 to
 * 96 have the same distance and opposite meanings, and a chart that showed
 * them identically would be worse than no chart.
 *
 * `spread` is the unsigned distance, which is what the ordering uses: the
 * widest line is the widest line whichever way it points.
 */
export function spanRows(rows, {
  groupBy,
  fromColumn,
  fromAggregation = 'count',
  toColumn,
  toAggregation = 'count',
  limit = 12,
  sort = DEFAULT_SPAN_SORT,
  dateOrder = 'DMY',
} = {}) {
  if (!groupBy) return []

  // Grouped ONCE, with no cap: the cap has to fall after the ordering, or a
  // chart of the widest gaps would be a chart of the widest gaps among
  // whichever twelve groups happened to be biggest.
  const grouped = groupSeries(rows, {
    groupBy,
    series: [
      { key: 'from', column: fromColumn, aggregation: fromAggregation },
      { key: 'to', column: toColumn, aggregation: toAggregation },
    ],
    limit: 0,
    sort: 'name_asc',
    dateOrder,
  })

  const out = grouped.map((entry) => {
    const from = Number.isFinite(entry.from) ? entry.from : 0
    const to = Number.isFinite(entry.to) ? entry.to : 0
    return {
      name: entry.name,
      from,
      to,
      gap: to - from,
      spread: Math.abs(to - from),
      // What the chart is "about" for anything that wants one number --
      // a tooltip, a drill, the value a colour rule reads.
      value: to,
      count: entry.count,
    }
  })

  sortSpans(out, sort)
  return limit > 0 ? out.slice(0, limit) : out
}

/** In place, because the caller has just built the array. */
export function sortSpans(list, sort = DEFAULT_SPAN_SORT) {
  if (sort === 'gap_asc') list.sort((a, b) => a.spread - b.spread)
  else if (sort === 'to_desc') list.sort((a, b) => b.to - a.to)
  else if (sort === 'from_desc') list.sort((a, b) => b.from - a.from)
  else if (sort === 'name_asc') list.sort((a, b) => collator.compare(a.name, b.name))
  else if (sort === 'name_desc') list.sort((a, b) => collator.compare(b.name, a.name))
  else list.sort((a, b) => b.spread - a.spread)
  return list
}

/**
 * The span the axis has to cover.
 *
 * Both ends of every row, padded a little so a dot is never drawn half off
 * the edge. NOT anchored at zero: the whole point is the distance between
 * two numbers, and forcing zero in compresses every gap on the chart into
 * the same short line.
 *
 * That is the one case where a truncated axis is the honest choice, because
 * the chart is not claiming the bars are proportional -- it has no bars.
 */
export function spanDomain(list, { pad = 0.06 } = {}) {
  const values = []
  for (const row of list || []) {
    if (Number.isFinite(row?.from)) values.push(row.from)
    if (Number.isFinite(row?.to)) values.push(row.to)
  }
  if (values.length === 0) return [0, 1]

  const low = Math.min(...values)
  const high = Math.max(...values)
  if (low === high) {
    // One value everywhere. A zero-width axis draws every dot on top of
    // itself; a little room either side draws a chart that says "these are
    // all the same", which is the true finding.
    const room = Math.abs(low) * 0.1 || 1
    return [low - room, high + room]
  }

  const room = (high - low) * pad
  return [low - room, high + room]
}

/** Totals for the caption: how many rose, how many fell, how many held. */
export function spanTally(list) {
  let up = 0
  let down = 0
  let flat = 0
  for (const row of list || []) {
    if (row.gap > 0) up += 1
    else if (row.gap < 0) down += 1
    else flat += 1
  }
  return { up, down, flat, total: (list || []).length }
}
