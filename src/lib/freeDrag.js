// ---------------------------------------------------------------------
// Moving a widget by dragging it
// ---------------------------------------------------------------------
// The arrange bar is exact, repeatable and the same on every screen. It is
// also six numbers, and somebody who knows exactly where they want a card
// should not have to work out which row that is.
//
// So: free mode. Drag a widget to move it, drag its corner to resize. The
// numbers do not go away and nothing new is stored -- a drag WRITES THE
// SAME FIELDS the boxes do. That is the whole design:
//
//   dropping decides `row` and `rowOrder`
//   resizing decides `widthPx` and `heightPx`
//
// which means a page arranged by dragging can be tidied up by typing, and
// one arranged by typing can be nudged by dragging, and neither is a
// separate mode the page remembers being in.
//
// Pure: rectangles in, field values out. Nothing here touches the DOM.

/** Below this, a press is a click on the widget rather than a drag of it. */
export const DRAG_THRESHOLD = 4

/** A drag resizes in whole steps, so two cards dragged alike end up alike. */
export const SNAP = 10

/** Nothing may be dragged smaller than it can be drawn. */
export const MIN_W = 120
export const MIN_H = 80

/** Has the pointer moved far enough to mean it? */
export function isDrag(dx, dy, threshold = DRAG_THRESHOLD) {
  return Math.abs(dx) >= threshold || Math.abs(dy) >= threshold
}

const snapTo = (n, step) => Math.max(step, Math.round(n / step) * step)

/**
 * The size a resize drag has reached.
 *
 * Snapped, because a card 341px wide beside one 344px wide is a page that
 * looks wrong and no number anybody typed. Clamped, because a widget
 * dragged to nothing is one that cannot be grabbed again.
 */
export function resizeTo(start, dx, dy, { snap = SNAP, canvasWidth = 0 } = {}) {
  const width = snapTo(Math.max(MIN_W, (start?.width || 0) + dx), snap)
  const height = snapTo(Math.max(MIN_H, (start?.height || 0) + dy), snap)
  return {
    width: canvasWidth > 0 ? Math.min(width, Math.round(canvasWidth)) : width,
    height,
  }
}

/**
 * Which row a drop landed in, and where along it.
 *
 * `boxes` are the widgets as drawn -- `{ id, left, top, width, height, row }`
 * -- and `point` is where the pointer let go, in the same coordinates.
 *
 * The row is the one whose band contains the drop. Dropped past the last
 * band, it goes to a NEW row after the last: dragging a card below
 * everything is how somebody says "put it at the bottom", and snapping it
 * back into the last row is the one thing that would make free mode feel
 * broken.
 *
 * The position within the row counts how many widgets in that row start
 * left of the drop -- so dropping between two cards puts it between them,
 * which is what the pointer was pointing at.
 */
export function dropAt(boxes, point, { movingId = null } = {}) {
  const others = (boxes || []).filter((b) => b && b.id !== movingId)
  const rows = new Map()
  for (const box of others) {
    const row = Math.max(1, Math.round(Number(box.row) || 1))
    const band = rows.get(row) || { row, top: box.top, bottom: box.top + box.height, boxes: [] }
    band.top = Math.min(band.top, box.top)
    band.bottom = Math.max(band.bottom, box.top + box.height)
    band.boxes.push(box)
    rows.set(row, band)
  }

  const bands = [...rows.values()].sort((a, b) => a.top - b.top)
  if (bands.length === 0) return { row: 1, rowOrder: 1 }

  const y = point?.y ?? 0
  const hit = bands.find((band) => y >= band.top && y <= band.bottom)

  // Past the bottom of everything: a new row of its own, after the last.
  if (!hit) {
    const last = bands[bands.length - 1]
    if (y > last.bottom) return { row: last.row + 1, rowOrder: 1 }
    // Above everything, which is a new first row -- and every existing row
    // keeps its own number, so nothing else moves.
    const first = bands[0]
    if (y < first.top && first.row > 1) return { row: first.row - 1, rowOrder: 1 }
    return { row: first.row, rowOrder: 1 }
  }

  const before = hit.boxes.filter((box) => (box.left + box.width / 2) < (point?.x ?? 0)).length
  return { row: hit.row, rowOrder: before + 1 }
}

/**
 * What a drop actually changes.
 *
 * Returns only the fields that MOVED. A drag that ends where it started
 * writes nothing, so picking a card up and putting it back does not mark
 * the page as edited -- and does not renumber a row somebody had set by
 * hand.
 */
export function dropPatch(current, next) {
  const patch = {}
  if (String(next.row) !== String(current?.row ?? '')) patch.row = String(next.row)
  if (String(next.rowOrder) !== String(current?.rowOrder ?? '')) patch.rowOrder = String(next.rowOrder)
  return patch
}

/**
 * What a resize changes.
 *
 * A resize is always in PIXELS, and it clears a column width if one was
 * set. Dragging a corner is somebody saying "this size", and leaving a
 * column share on top of it would mean the drag appeared to do nothing --
 * the share would win, exactly the confusion the size switch was added to
 * end.
 */
export function resizePatch(size) {
  return {
    widthPx: String(Math.round(size.width)),
    heightPx: String(Math.round(size.height)),
    colSpan: '',
  }
}
