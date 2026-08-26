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
 * The height somebody typed for this widget, if they typed one.
 *
 * Worth asking separately from the measurement because a widget that spans
 * is DRAWN at the height of the rows it covers -- so once it has been drawn
 * once, measuring it just reads that height back, and the number the admin
 * typed would be quietly outvoted by the consequence of itself.
 */
export function pinnedHeight(item) {
  const n = Number(item?.heightPx)
  return Number.isFinite(n) && n > 0 ? Math.max(MIN_HEIGHT, Math.round(n)) : null
}

/** A widget cannot span more rows than a page plausibly has. */
export const MAX_ROW_SPAN = 12

/**
 * How many rows a widget was told to cover.
 *
 * One is the answer for everything nobody has spanned, so a page that has
 * never heard of this behaves exactly as it did. A number greater than one
 * says "hold this width all the way down through those rows, and be as tall
 * as they are together" -- which is the tall chart beside three stacked
 * KPIs, the layout a single row could never express.
 */
export function rowSpanOf(item) {
  const n = Number(item?.rowSpan)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(MAX_ROW_SPAN, Math.round(n))
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
  let overflow = []
  let rowNumber = 1
  const highest = Math.max(1, ...list.map(rowOf))

  // Widgets still holding their width in the rows BELOW the one they start
  // in. A span is a vertical reservation: rows keep filling left to right
  // around it, and it is as tall as the rows it covers are together.
  const spans = []
  const heldIn = (row) => spans.filter((sp) => sp.startRow < row && sp.lastRow >= row)
  const lastHeld = () => spans.reduce((m, sp) => Math.max(m, sp.lastRow), 0)

  while (rowNumber <= highest || overflow.length > 0 || lastHeld() >= rowNumber) {
    // Whatever spilled from above comes first: it was earlier in the sort.
    const waiting = [...overflow, ...(queued.get(rowNumber) || [])]
    overflow = []

    // The stretches of this row somebody upstairs is still standing in.
    const blocked = heldIn(rowNumber)
      .map((sp) => ({ left: sp.left, right: sp.left + sp.width }))
      .sort((a, b) => a.left - b.left)

    // The first x at or after `from` where `width` clears every one of them.
    // Sorted ascending and only ever moving right, so one pass is enough.
    const clear = (from, width) => {
      let x = from
      for (const b of blocked) {
        if (x < b.right && x + width > b.left) x = b.right + gapX
      }
      return x
    }

    let x = 0
    let height = 0
    const placed = []
    // What sits at each x position on this row, and how far down it reaches
    // -- measured from the top of the row, because how far down the PAGE the
    // row starts is not known until every row's height is settled.
    //
    // A widget shorter than its neighbours leaves room underneath it, and
    // that room is somewhere a later widget can go.
    const shelves = []

    for (let i = 0; i < waiting.length; i += 1) {
      const item = waiting[i]
      const width = requiredWidth(item, canvas)
      const span = rowSpanOf(item)
      const pin = pinnedHeight(item)
      // A spanning widget is drawn at the height of its band, so measuring
      // it reads that height straight back. A typed height has to be taken
      // as read or it could never change anything.
      const h =
        span > 1 && pin
          ? pin
          : Math.max(MIN_HEIGHT, Math.round(heights[item.id] ?? item.estimatedHeight ?? fallback))

      let left = clear(x, width)
      let atTop = 0

      if (left + width > canvas + 0.5) {
        // No room along the row. Before giving up on it, look UNDER what is
        // already here: a widget half the height of the one beside it has
        // left a rectangle, and a rectangle that fits is not a rectangle
        // anybody wants left empty.
        //
        // Only tried when the row is full, so the reading order still runs
        // left to right -- nothing jumps into a hole ahead of its turn. And
        // never for a widget that spans: it would be stacking something
        // under one row that is meant to reach down through several.
        const shelf =
          span > 1
            ? null
            : shelves.find((sh) => sh.width >= width - 0.5 && height - sh.bottom - gapY >= h - 0.5)
        if (!shelf) {
          overflow = waiting.slice(i)
          break
        }
        left = shelf.left
        atTop = shelf.bottom + gapY
        shelf.bottom = atTop + h
        positions[item.id] = { left, top: atTop, width, height: h, row: rowNumber, rowSpan: 1, stacked: true }
        placed.push(item.id)
        continue
      }

      positions[item.id] = { left, top: atTop, width, height: h, row: rowNumber, rowSpan: span }
      placed.push(item.id)
      x = left + width + gapX

      if (span > 1) {
        // Deliberately not a shelf and not part of this row's height: a
        // spanning widget is measured against the rows it covers, and
        // letting it set the height of the first one would make every row
        // below it as tall as the whole span.
        spans.push({
          id: item.id,
          left,
          width,
          height: h,
          pinned: Boolean(pin),
          startRow: rowNumber,
          lastRow: rowNumber + span - 1,
        })
        continue
      }

      shelves.push({ left, width, bottom: atTop + h })
      height = Math.max(height, h)
    }

    // A row nothing was placed in is still a real row while a span is
    // reaching through it -- that is the room the span is being given.
    if (placed.length > 0 || blocked.length > 0) {
      rows.push({ row: rowNumber, top: 0, height, ids: placed, shelves, blocked })
    }
    rowNumber += 1
  }

  // --- how tall the rows a span covers have to be ------------------------
  //
  // The rows it passes through are sized by everything ELSE in them, and
  // only if that leaves the span short is the last of them grown to make up
  // the difference. So three KPIs beside a chart set the height, the chart
  // fills it, and a chart taller than all three pushes only the bottom row
  // down rather than spreading slack through rows that did not need it.
  const covered = (sp) => rows.filter((r) => r.row >= sp.startRow && r.row <= sp.lastRow)
  for (const sp of [...spans].sort((a, b) => a.lastRow - b.lastRow || a.startRow - b.startRow)) {
    const band = covered(sp)
    if (band.length === 0) continue
    const available = band.reduce((sum, r) => sum + r.height, 0) + gapY * (band.length - 1)
    if (sp.height > available + 0.5) band[band.length - 1].height += sp.height - available
  }

  // --- and now, finally, where each row starts ---------------------------
  let top = 0
  for (const row of rows) {
    row.top = top
    for (const shelf of row.shelves) shelf.bottom += top
    top += row.height + gapY
  }

  const rowAt = new Map(rows.map((r) => [r.row, r]))
  for (const box of Object.values(positions)) {
    box.top += rowAt.get(box.row)?.top || 0
  }

  // A span is as tall as its band, so it is bordered by the rows it covers
  // rather than floating in the middle of them.
  for (const sp of spans) {
    const band = covered(sp)
    const box = positions[sp.id]
    if (!box || band.length === 0) continue
    const last = band[band.length - 1]
    const bandHeight = Math.round(last.top + last.height - box.top)
    // A typed height is exact -- it is the one number on this widget the
    // admin chose rather than inherited, and stretching past it would make
    // the box do nothing on precisely the widgets it matters most on. The
    // band grew to hold it above, so it still sits inside its rows.
    box.height = sp.pinned ? sp.height : Math.max(box.height, bandHeight)
    box.bandHeight = bandHeight
    box.spanned = true
  }

  return { positions, rows, spans, containerHeight: Math.max(0, top - gapY) }
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
export function rowGaps(rows, positions, canvasWidth, gapX = 12, minimum = MIN_WIDTH, gapY = 12) {
  const out = []
  for (const row of rows || []) {
    let edge = 0
    for (const id of row.ids) {
      const box = positions[id]
      if (box) edge = Math.max(edge, box.left + box.width)
    }

    // The space at the END of the row -- which ends early if a widget
    // from a row above is still standing in it. A dotted box drawn across
    // something already there would be an invitation to a collision.
    const left = edge + gapX
    let limit = canvasWidth
    for (const b of row.blocked || []) {
      if (b.left >= left) limit = Math.min(limit, b.left - gapX)
    }
    const width = Math.round(limit - left)
    if (width >= minimum) out.push({ row: row.row, left, top: row.top, width, height: row.height })

    // And the space UNDER anything shorter than the row it is on. This is
    // the room a widget could actually be moved into, so it is worth as much
    // as the space at the end -- and it is invisible unless it is drawn.
    for (const shelf of row.shelves || []) {
      const free = Math.round(row.top + row.height - shelf.bottom - gapY)
      if (free < MIN_HEIGHT) continue
      out.push({
        row: row.row,
        left: shelf.left,
        top: shelf.bottom + gapY,
        width: Math.round(shelf.width),
        height: free,
        under: true,
      })
    }
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
    // Space a widget from a row above is holding is not space going spare,
    // however empty it looks from down here.
    const held = (row.blocked || []).reduce((sum, b) => sum + (b.right - b.left) + gapX, 0)
    const used =
      row.ids.reduce((sum, id) => sum + (positions[id]?.width || 0), 0) +
      gapX * Math.max(0, row.ids.length - 1) +
      held
    const spare = Math.max(0, Math.round(canvasWidth - used))
    for (const id of row.ids) out[id] = spare
  }
  return out
}
