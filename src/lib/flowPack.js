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
// exactly that, and it is placed in the ROW it was put in -- left to right,
// each starting where the one before it ended. When a row runs out of width
// the next widget spills into the row below rather than being squashed.
//
// A row is a real thing an admin assigns a widget to, not just whatever
// happened to fit on one line. A page where nobody has set one behaves
// exactly as it always did, because unset means row 1 and row 1 spills.
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
 * Which row a widget has been put in.
 *
 * Unset means row 1, which is not a special case: everything starts in the
 * first row and spills into the second, the second into the third, and a
 * page nobody has assigned rows to behaves exactly as it always did. Setting
 * a number is how an admin says "this one belongs on the second row", and
 * everything else still flows around it.
 */
export function rowOf(item) {
  const n = Number(item?.row)
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : 1
}

/**
 * Every widget placed into its row, spilling into the next when it will not
 * fit.
 *
 * A row is a real thing an admin can put a widget IN, not just whatever
 * happened to fit on one line. The rule is the one anybody would guess:
 *
 *   go through the rows in order;
 *   put each widget in the row it asked for, if there is room left in it;
 *   if there is not, it goes to the next row, ahead of whatever was
 *   already assigned there, because it came first.
 *
 * So a widget can be pinned to row 2 and stay there whatever happens above
 * it, and a row that runs out of width overflows downward instead of
 * silently squashing anything.
 *
 * Rows are as tall as their tallest widget, so they line up -- which is the
 * thing that makes a page of rows readable and a masonry not.
 */
export function packRowGroups(items, { canvasWidth = 0, gapX = 12, gapY = 12, heights = {}, fallback = 220 } = {}) {
  const canvas = Math.max(1, canvasWidth || 0)
  const list = items || []

  // What each row has been asked to hold, in the admin's own order.
  const queued = new Map()
  for (const item of list) {
    const row = rowOf(item)
    if (!queued.has(row)) queued.set(row, [])
    queued.get(row).push(item)
  }

  const positions = {}
  const rows = []
  let top = 0
  let overflow = []
  let rowNumber = 1
  const highest = Math.max(1, ...list.map(rowOf))

  while (rowNumber <= highest || overflow.length > 0) {
    // Whatever spilled from above comes first: it was earlier in the sort.
    const waiting = [...overflow, ...(queued.get(rowNumber) || [])]
    overflow = []

    let x = 0
    let height = 0
    const placed = []

    for (let i = 0; i < waiting.length; i += 1) {
      const item = waiting[i]
      const width = requiredWidth(item, canvas)

      // The first widget in a row is always placed, however wide it is, or
      // one wider than the canvas would fall down the page for ever.
      if (placed.length > 0 && x + width > canvas + 0.5) {
        overflow = waiting.slice(i)
        break
      }

      const h = Math.max(MIN_HEIGHT, Math.round(heights[item.id] ?? item.estimatedHeight ?? fallback))
      positions[item.id] = { left: x, top, width, height: h, row: rowNumber }
      placed.push(item.id)
      height = Math.max(height, h)
      x += width + gapX
    }

    if (placed.length > 0) {
      rows.push({ row: rowNumber, top, height, ids: placed })
      top += height + gapY
    }
    rowNumber += 1
  }

  return { positions, rows, containerHeight: Math.max(0, top - gapY) }
}

/**
 * The empty rectangle at the end of each row -- where it is, and what would
 * fit in it.
 *
 * A number in a corner ("340 free") tells an admin there is room. A dotted
 * box exactly where the room is, labelled with the width and height that
 * would fit in it, tells them what to type -- which is the actual question
 * anybody has while arranging a page.
 *
 * Rows with less than a gap's worth left over produce nothing: a strip
 * narrower than the space between two widgets is not somewhere a widget
 * could go, and drawing it would be noise.
 */
export function rowGaps(rows, positions, canvasWidth, gapX = 12, minimum = MIN_WIDTH) {
  const out = []
  for (const row of rows || []) {
    let edge = 0
    for (const id of row.ids) {
      const box = positions[id]
      if (box) edge = Math.max(edge, box.left + box.width)
    }

    const left = edge + gapX
    const width = Math.round(canvasWidth - left)
    if (width < minimum) continue

    out.push({ row: row.row, left, top: row.top, width, height: row.height })
  }
  return out
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
