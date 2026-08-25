// ---------------------------------------------------------------------
// Laying widgets out by the space they actually need
// ---------------------------------------------------------------------
// Every layout problem on this project came from the same place: the canvas
// was divided into a fixed number of columns, a widget had to claim whole
// ones, and a widget pinned to 260px where the columns were 316px therefore
// claimed 316 and left 56px beside it that nothing could ever fill. Three in
// a row was a strip of nothing, and the wider widget below could not fit in
// the gap the row left behind, so the hole was permanent.
//
// There are no columns here. A widget asks for a width in pixels and gets
// exactly that. They are placed in the admin's own order, left to right,
// each starting where the one before it ended -- and when the next one will
// not fit in what is left of the row, it starts a new one.
//
// That is the whole model, and it has the three properties the column grid
// could not have at the same time:
//
//   NOTHING IS ROUNDED UP. A widget occupies the space it asked for and not
//   one pixel more, so there is no dead strip beside anything.
//
//   THE ORDER IS THE ORDER. Nothing is ever moved past anything else to fill
//   a hole, so what an admin arranged is what a reader reads.
//
//   IT ADAPTS BY ITSELF. The row breaks wherever the canvas happens to end,
//   so the same page reflows on a laptop, a monitor and a phone with nobody
//   configuring breakpoints.
//
// Pure: numbers in, numbers out, no DOM.

/** Below this a widget is a sliver rather than a decision. */
export const MIN_WIDTH = 80
export const MIN_HEIGHT = 60

/** What a widget takes when it has not been given a pixel width. */
export const NAMED_FRACTIONS = {
  quarter: 0.25,
  third: 1 / 3,
  half: 0.5,
  twothird: 2 / 3,
  full: 1,
}

/**
 * How wide this widget is asking to be, on a canvas this wide.
 *
 * A pinned pixel width is honoured exactly. Anything else falls back to the
 * named width it was built with, as a fraction -- so a page nobody has ever
 * sized still looks like the page it always was.
 *
 * Never wider than the canvas: a 900px widget on a phone is the phone's
 * width, not a horizontal scrollbar across the whole page.
 */
export function requiredWidth(item, canvasWidth) {
  const canvas = Math.max(1, canvasWidth || 0)
  const pinned = Number(item?.widthPx)
  if (Number.isFinite(pinned) && pinned > 0) return Math.min(canvas, Math.max(MIN_WIDTH, Math.round(pinned)))

  const fraction = NAMED_FRACTIONS[item?.width] ?? 1
  return Math.min(canvas, Math.max(MIN_WIDTH, Math.round(canvas * fraction)))
}

/**
 * Every widget placed, in order, wrapping when the row runs out.
 *
 * `heights` is what each widget has actually measured; the estimate is only
 * used before it has. A row is as tall as its tallest widget, and the next
 * row starts below it -- so rows line up, which is the thing a masonry
 * cannot give you and the thing that makes a dashboard readable.
 *
 * Returns `{ positions, containerHeight, rows }`.
 */
export function packFlow(items, { canvasWidth = 0, gapX = 12, gapY = 12, heights = {}, fallback = 220 } = {}) {
  const canvas = Math.max(1, canvasWidth || 0)
  const positions = {}
  const rows = []

  let x = 0
  let top = 0
  let rowHeight = 0
  let row = []

  const closeRow = () => {
    if (row.length === 0) return
    rows.push({ top, height: rowHeight, ids: row.map((r) => r.id) })
    top += rowHeight + gapY
    x = 0
    rowHeight = 0
    row = []
  }

  for (const item of items || []) {
    const width = requiredWidth(item, canvas)

    // Wrap when what is left of this row cannot hold it. The first widget
    // in a row is always placed, however wide it is, or a widget wider than
    // the canvas would loop for ever.
    if (row.length > 0 && x + width > canvas + 0.5) closeRow()

    const height = Math.max(MIN_HEIGHT, Math.round(heights[item.id] ?? item.estimatedHeight ?? fallback))
    positions[item.id] = { left: x, top, width, height }
    row.push({ id: item.id })
    rowHeight = Math.max(rowHeight, height)
    x += width + gapX
  }

  // The last row's height counts, but its trailing gap does not.
  const containerHeight = row.length > 0 ? top + rowHeight : Math.max(0, top - gapY)
  if (row.length > 0) rows.push({ top, height: rowHeight, ids: row.map((r) => r.id) })

  return { positions, containerHeight, rows }
}

/**
 * How much of a row is left over.
 *
 * Not used to stretch anything -- a widget gets the width it asked for and
 * that is the point of this file. It is reported so the arrange bar can say
 * "there are 340px going spare on this row", which is the number somebody
 * needs in order to decide what to type into the width box.
 */
export function rowSlack(rows, positions, canvasWidth, gapX = 12) {
  const out = {}
  for (const row of rows || []) {
    const used = row.ids.reduce((sum, id) => sum + (positions[id]?.width || 0), 0) + gapX * (row.ids.length - 1)
    const spare = Math.max(0, Math.round(canvasWidth - used))
    for (const id of row.ids) out[id] = spare
  }
  return out
}
