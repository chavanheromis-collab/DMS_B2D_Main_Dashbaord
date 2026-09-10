// ---------------------------------------------------------------------
// Which rows an action is about to fire at
// ---------------------------------------------------------------------
// A selection looks like the easy half of row operations and is the half
// that decides whether they are safe. "Delete" is only ever as correct as
// the set of rows it is handed, and every way that set can quietly stop
// matching what is on screen is a way to delete the wrong records.
//
// Three rules, and all three are about the same thing -- the selection must
// never contain a row the reader cannot currently see:
//
//   IT IS HELD BY ROW NUMBER, not by index or by object. Sorting the table,
//   paging it, or reloading after a save all rebuild the row objects and
//   reorder them; an index-based selection would silently move to different
//   records under every one of those.
//
//   IT IS PRUNED AGAINST WHAT IS ON SCREEN. Tick four rows, then type in
//   the search box until three of them are gone, and those three are still
//   ticked and still in the count. `pruneSelection` is what stops "Delete
//   4 rows" being three rows nobody can see plus one they can.
//
//   "SELECT ALL" MEANS THE FILTERED SET, NOT THE TAB. Everything the
//   current filters and search have left -- which is what somebody who has
//   just narrowed a table to eleven rows and pressed the header tick
//   expects. The count on the bar says the number either way, because that
//   is the number that will be acted on.
//
// Pure: a set and an event in, a set out.

/** Nothing ticked. */
export const NO_SELECTION = []

const numbersOf = (rows) => (rows || []).map((r) => r?._row).filter((n) => n !== undefined && n !== null)

export const isSelected = (selection, row) => (selection || []).includes(row?._row)

/**
 * One row ticked or unticked.
 *
 * Order is kept as ticked. Nothing downstream depends on it -- the server
 * sorts deletions for itself -- but a bar reading "3 rows" that reorders
 * every time you tick a fourth looks like it is doing something else.
 */
export function toggleRow(selection, row) {
  const id = row?._row
  if (id === undefined || id === null) return selection || []
  const list = selection || []
  return list.includes(id) ? list.filter((n) => n !== id) : [...list, id]
}

/**
 * Shift-click: every row between the last one ticked and this one, AS
 * DISPLAYED.
 *
 * As displayed rather than by row number, because the reader is picking out
 * a block they can see. On a table sorted by amount, the rows between two
 * clicks are neighbours on screen and scattered through the sheet, and
 * taking the numeric span between them would select a hundred rows nobody
 * pointed at.
 *
 * It only ever ADDS. A shift-click that also cleared what was outside the
 * span would throw away a selection built up elsewhere in the table, which
 * is not what the gesture means anywhere else.
 */
export function selectRange(selection, visibleRows, fromRow, toRow) {
  const order = numbersOf(visibleRows)
  const a = order.indexOf(fromRow?._row)
  const b = order.indexOf(toRow?._row)
  // One of the ends has been filtered away since it was clicked: fall back
  // to the plain tick rather than guessing at a span with no start.
  if (a === -1 || b === -1) return toggleRow(selection, toRow)

  const span = order.slice(Math.min(a, b), Math.max(a, b) + 1)
  const have = new Set(selection || [])
  return [...(selection || []), ...span.filter((n) => !have.has(n))]
}

/** Every row the filters have left, ticked. */
export function selectAll(visibleRows) {
  return numbersOf(visibleRows)
}

/**
 * Whether the header tick is on, off, or in between.
 *
 * The third state is the one that matters: with some of the visible rows
 * ticked, a plain checkbox shows "off" and pressing it appears to do
 * nothing, because it selects everything -- including what was already
 * selected. `mixed` is what makes that press predictable.
 */
export function headerState(selection, visibleRows) {
  const order = numbersOf(visibleRows)
  if (order.length === 0) return 'none'
  const have = new Set(selection || [])
  const hit = order.filter((n) => have.has(n)).length
  if (hit === 0) return 'none'
  return hit === order.length ? 'all' : 'mixed'
}

/** What pressing the header tick does, from whichever of the three it is in. */
export function toggleAll(selection, visibleRows) {
  return headerState(selection, visibleRows) === 'all' ? [] : selectAll(visibleRows)
}

/**
 * The selection, with anything no longer on screen dropped.
 *
 * Called whenever the visible rows change -- a filter, a search, a reload
 * after somebody else's edit. Keeping a row that has been filtered away is
 * what turns "Delete 4 rows" into four rows the reader can no longer look
 * at before agreeing to it.
 *
 * Returns the SAME array when nothing was pruned, so a component can use it
 * as a state setter without re-rendering on every keystroke.
 */
export function pruneSelection(selection, visibleRows) {
  const list = selection || []
  if (list.length === 0) return list
  const there = new Set(numbersOf(visibleRows))
  const kept = list.filter((n) => there.has(n))
  return kept.length === list.length ? list : kept
}

/**
 * The selected rows themselves, in the order they are displayed.
 *
 * Display order rather than selection order: it is what a preview lists and
 * what a copy writes onto the other tab, and a block somebody picked out
 * top-to-bottom should not arrive shuffled by the order they happened to
 * tick it in.
 */
export function selectedRows(selection, visibleRows) {
  const have = new Set(selection || [])
  return (visibleRows || []).filter((r) => have.has(r?._row))
}

/**
 * What a destructive request carries: the address and the proof.
 *
 * Both, always. See lib/rowFingerprint.js -- the row number says where to
 * write and the fingerprint says that what is there is still what was read.
 */
export function rowRefs(rows) {
  return (rows || [])
    .filter((r) => r?._row !== undefined && r?._row !== null)
    .map((r) => ({ row: r._row, fp: r._fp }))
}
