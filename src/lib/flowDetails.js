// ---------------------------------------------------------------------
// Looking at the rows behind a branch
// ---------------------------------------------------------------------
// A flow answers "how many" and then "how many of those" -- and the whole
// time, the question at the end of it is "which ones". Until now the only
// way to get there was to filter the entire page to a branch and go and
// read the table, which means leaving the flow, losing the shape you were
// reading, and coming back to find it closed.
//
// So: a branch can be opened rather than followed. One button per row, a
// small window, and the columns an admin chose -- not every column, which
// is a table, and not a fixed set, because what identifies a record is
// different in every sheet: a chassis number here, a customer and a date
// there.
//
// Everything below is arithmetic on rows the flow has already built.
// Nothing here reads a sheet, and nothing here draws.

/** How many rows one window will list before it says "and N more". */
export const DETAIL_MAX = 25

/** The most columns worth putting in a window this size. */
export const DETAIL_COLUMNS_MAX = 8

export const DEFAULT_DETAILS = {
  // Off by default. A button on every row of every existing flow, appearing
  // the day this ships, is a change to dashboards nobody asked to change.
  showDetails: false,
  detailColumns: [],
  detailRows: 8,
}

const clampInt = (value, lo, hi, fallback) => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, n))
}

/**
 * The columns to show, narrowed to the ones these rows actually have.
 *
 * A flow can HOP to another tab part way down -- that is the point of a hop
 * -- and the columns chosen on the starting tab mean nothing there. Rather
 * than print a column of dashes, the window shows what it can and says
 * nothing about the rest.
 *
 * Order is the admin's, not the sheet's: the list is read top to bottom and
 * whoever chose it put the identifying column first.
 */
export function detailColumns(flow, rows) {
  const chosen = (flow?.detailColumns || []).filter(Boolean)
  if (chosen.length === 0) return []
  const present = new Set()
  for (const row of rows || []) {
    for (const key of Object.keys(row || {})) present.add(key)
  }
  return chosen.filter((c) => present.has(c)).slice(0, DETAIL_COLUMNS_MAX)
}

/**
 * Is there a window to open on this branch at all?
 *
 * Three ways there is not, and each of them would otherwise be a button
 * that opens an empty box: the admin has not turned it on, has not said
 * which columns, or this branch carries no rows of its own -- which is what
 * a metric-only node is.
 */
export function canShowDetails(flow, node) {
  if (!flow?.showDetails) return false
  if ((flow.detailColumns || []).filter(Boolean).length === 0) return false
  return (node?.rows?.length || 0) > 0
}

/**
 * What one window shows: some rows, some columns, and the truth about how
 * much was left out.
 *
 * The cap is not a detail. A branch at the top of a flow can hold every row
 * in the sheet, and a window that tries to list forty thousand of them
 * locks the tab -- so it lists the first few and says how many there are.
 * Which few: the order they came in, because that is the order of the sheet
 * and the only one nobody has to have explained.
 */
export function detailsFor(node, flow) {
  const all = node?.rows || []
  const columns = detailColumns(flow, all)
  const limit = clampInt(flow?.detailRows, 1, DETAIL_MAX, DEFAULT_DETAILS.detailRows)
  const rows = all.slice(0, limit)
  return {
    columns,
    rows,
    total: all.length,
    hidden: Math.max(0, all.length - rows.length),
    // Said separately from `columns.length`, because "the admin chose four
    // columns and this tab has none of them" and "the admin chose none" are
    // different problems with different fixes.
    mismatched: columns.length === 0 && (flow?.detailColumns || []).filter(Boolean).length > 0,
  }
}

/**
 * One row's values, in the chosen order, as label/value pairs.
 *
 * Blank stays blank rather than becoming a dash: a dash reads as "not
 * applicable" and an empty cell means "nobody has filled this in", which on
 * a follow-up list is the most interesting thing on the row.
 */
export function detailPairs(row, columns) {
  return (columns || []).map((column) => ({
    column,
    value: row?.[column] === null || row?.[column] === undefined ? '' : String(row[column]),
  }))
}
