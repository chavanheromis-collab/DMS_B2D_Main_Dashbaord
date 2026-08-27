// ---------------------------------------------------------------------
// Waffle / pictogram -- a share you can count
// ---------------------------------------------------------------------
// A pie chart asks the reader to judge an angle, which people are famously
// bad at: 38% and 42% are the same wedge to almost everybody. A waffle
// asks them to count squares instead, and 38 squares out of 100 is not a
// judgement at all -- it is a number, sitting there, already counted.
//
// That makes it the right chart for exactly one job: a small number of
// categories whose SHARE is the point. Twenty categories in a hundred
// squares is confetti, so the overflow merges into one block rather than
// shredding the grid.
//
// The arithmetic that matters here is the rounding. Naive rounding of five
// shares to a hundred squares routinely produces 99 or 101 squares, and a
// waffle that does not add up to its own grid is a waffle nobody trusts.
// Largest-remainder apportionment -- the method parliaments use to turn
// vote shares into whole seats -- guarantees the total lands exactly.

import { aggregate, isBlank } from './dataUtils.js'

export const WAFFLE_SHAPES = [
  { value: 'square', label: 'Squares' },
  { value: 'rounded', label: 'Rounded squares' },
  { value: 'circle', label: 'Dots' },
  { value: 'heart', label: '❤️ Hearts' },
  { value: 'star', label: '⭐ Stars' },
  { value: 'person', label: '🧍 People' },
  { value: 'car', label: '🚗 Cars' },
  { value: 'rupee', label: '₹ Rupees' },
]

export const DEFAULT_WAFFLE = {
  groupBy: '',
  aggregation: 'count',
  column: null,
  format: 'comma',
  // 100 cells is the default because "out of a hundred" needs no
  // explanation. 25 and 50 exist for narrow cards, where 100 cells become
  // too small to count.
  cells: 100,
  columns: 10,
  maxSlices: 5,
  otherLabel: 'Other',
  shape: 'rounded',
  gap: 3,
  showLegend: true,
  showPercent: true,
  palette: 'default',
  // Fill down the columns rather than across the rows. Down reads like a
  // stacked bar, across reads like a paragraph -- both are defensible and
  // people are surprisingly firm about which they want.
  direction: 'row',
}

const clampInt = (value, lo, hi, fallback) => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, n))
}

/**
 * Whole cells apportioned to shares, adding up EXACTLY to the total.
 *
 * Every slice takes its floor, and the leftover cells go one each to
 * whoever was robbed of the most by that flooring. This is the largest
 * remainder method, and it has the two properties a waffle needs: the
 * counts always sum to the grid, and a slice with any share at all is
 * never rounded down to nothing while a smaller one keeps a square.
 */
export function apportion(values, total) {
  const sum = values.reduce((a, b) => a + b, 0)
  if (!(sum > 0) || !(total > 0)) return values.map(() => 0)

  const exact = values.map((v) => (v / sum) * total)
  const floors = exact.map(Math.floor)
  let left = total - floors.reduce((a, b) => a + b, 0)

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)

  for (let i = 0; left > 0 && i < order.length; i += 1) {
    floors[order[i].index] += 1
    left -= 1
  }
  // A remainder larger than the number of slices can only happen when the
  // grid is bigger than the slice count, so the passes simply repeat.
  while (left > 0) {
    for (let i = 0; left > 0 && i < order.length; i += 1) {
      floors[order[i].index] += 1
      left -= 1
    }
  }

  return floors
}

/** The slices, the cells they own, and the grid those cells sit in. */
export function waffleData(widget, { rows = [] } = {}) {
  const config = { ...DEFAULT_WAFFLE, ...(widget || {}) }
  if (!config.groupBy) return { ready: false, slices: [], cells: [], total: 0 }

  const groups = new Map()
  for (const row of rows || []) {
    const key = isBlank(row[config.groupBy]) ? '(blank)' : String(row[config.groupBy]).trim()
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  const agg = config.aggregation || 'count'
  let slices = [...groups.entries()]
    .map(([name, groupRows]) => ({ name, value: aggregate(groupRows, config.column, agg), rows: groupRows }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value || String(a.name).localeCompare(String(b.name)))

  // The cap counts the merged slice ITSELF -- "5 slices" means five blocks
  // of colour, not six -- and one slice over the cap is left alone, because
  // an "Other" holding a single value hides its name for nothing. Both
  // rules are the ones the series charts already use (pickSeries in
  // seriesData.js); a second dialect of "max slices" would be worse than
  // either on its own.
  const maxSlices = clampInt(config.maxSlices, 1, 12, 5)
  if (slices.length > maxSlices + 1) {
    const kept = slices.slice(0, maxSlices - 1)
    const rest = slices.slice(maxSlices - 1)
    kept.push({
      name: config.otherLabel || 'Other',
      value: rest.reduce((a, s) => a + s.value, 0),
      rows: rest.flatMap((s) => s.rows),
      isOther: true,
      merged: rest.length,
    })
    slices = kept
  }

  const total = slices.reduce((a, s) => a + s.value, 0)
  const cellCount = clampInt(config.cells, 10, 400, 100)
  const counts = apportion(slices.map((s) => s.value), cellCount)

  const withCounts = slices.map((slice, i) => ({
    ...slice,
    index: i,
    cells: counts[i],
    share: total > 0 ? (slice.value / total) * 100 : 0,
  }))

  // The grid, flattened. Building the cells here rather than in the
  // component means the fill DIRECTION is a tested decision and not a
  // nested loop somebody has to read twice.
  const columns = clampInt(config.columns, 2, 40, 10)
  const rowsCount = Math.ceil(cellCount / columns)
  const flat = []
  withCounts.forEach((slice) => {
    for (let i = 0; i < slice.cells; i += 1) flat.push(slice.index)
  })
  while (flat.length < cellCount) flat.push(-1)

  const cells = flat.slice(0, cellCount).map((sliceIndex, position) => {
    const [r, c] =
      config.direction === 'column'
        ? [position % rowsCount, Math.floor(position / rowsCount)]
        : [Math.floor(position / columns), position % columns]
    return { position, row: r, col: c, sliceIndex, slice: sliceIndex >= 0 ? withCounts[sliceIndex] : null }
  })

  return {
    ready: true,
    slices: withCounts,
    cells,
    columns,
    rows: rowsCount,
    cellCount,
    total,
    // What one square is worth. Printed on the card, because a waffle
    // without it is a proportion with no units.
    perCell: cellCount > 0 ? total / cellCount : 0,
  }
}
