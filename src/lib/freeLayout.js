// ---------------------------------------------------------------------
// A canvas with no columns
// ---------------------------------------------------------------------
// Every layout problem on this project has had the same root. The canvas is
// divided into columns; a widget has to claim whole ones; a widget pinned to
// 260px on 316px columns therefore claims 316 and leaves 56px that nothing
// can ever fill. Three of those in a row is a strip of nothing, and the
// four-column widget underneath cannot fit in the three-column gap the row
// left behind, so the hole is permanent.
//
// Every fix so far has been a better way to live with columns: scale the
// presets, make the count a setting, snap widths up, pack in rows. They all
// help and none of them removes the cause.
//
// So this is a canvas with no columns at all. A widget has a FRAME -- where
// it starts and how big it is -- and that is what is drawn. Nothing is
// rounded to anything. There is no grid to be out of step with.
//
// The one thing a free canvas usually gets wrong is screens: a layout in
// pixels is a layout for the monitor it was made on, and it falls apart on
// anybody else's. So a frame is stored in MIXED units, which is the whole
// trick:
//
//   x and w are FRACTIONS of the canvas width (0 to 1)
//   y and h are PIXELS
//
// Horizontal space is shared out -- a widget half the page wide is half the
// page wide on any screen -- while vertical space is absolute, because a
// chart 300px tall is 300px tall whatever the width of the window. That is
// how a design made on a laptop still reads on a 4K monitor without anybody
// re-doing it, and it is why nothing here ever needs a column again.
//
// Pure: numbers in, numbers out, no DOM.

export const MIN_W = 0.06 // a sliver narrower than this is a mistake, not a design
export const MIN_H = 60

export const SNAP_STEPS = [
  { value: 0, label: 'Off — anywhere' },
  { value: 4, label: 'Fine (4px)' },
  { value: 8, label: 'Normal (8px)' },
  { value: 16, label: 'Coarse (16px)' },
  { value: 24, label: 'Very coarse (24px)' },
]

/** How close two edges have to be before they are treated as aligned. */
export const GUIDE_TOLERANCE = 6

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

/** A frame with every value forced into what can actually be drawn. */
export function normalizeFrame(frame) {
  const w = clamp(Number(frame?.w) || 0.25, MIN_W, 1)
  const x = clamp(Number(frame?.x) || 0, 0, 1 - w)
  return {
    x,
    w,
    y: Math.max(0, Math.round(Number(frame?.y) || 0)),
    h: Math.max(MIN_H, Math.round(Number(frame?.h) || 240)),
  }
}

/** Where a frame lands on a canvas this wide. */
export function frameToPx(frame, canvasWidth) {
  const f = normalizeFrame(frame)
  return {
    left: Math.round(f.x * canvasWidth),
    top: f.y,
    width: Math.max(1, Math.round(f.w * canvasWidth)),
    height: f.h,
  }
}

/** ...and back again, which is what a drag and a resize produce. */
export function pxToFrame(box, canvasWidth) {
  const width = canvasWidth > 0 ? canvasWidth : 1
  return normalizeFrame({
    x: box.left / width,
    w: box.width / width,
    y: box.top,
    h: box.height,
  })
}

/**
 * The lowest edge on the canvas.
 *
 * A free canvas has no rows to add up, so its height is simply where the
 * bottom-most widget ends.
 */
export function canvasHeight(frames, extra = 0) {
  let bottom = 0
  for (const frame of Object.values(frames || {})) {
    const f = normalizeFrame(frame)
    bottom = Math.max(bottom, f.y + f.h)
  }
  return bottom + extra
}

// ---------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------
/**
 * Rounded to a step -- or not rounded at all, which is the point.
 *
 * Snapping here is a convenience an admin switches on because lining things
 * up by hand is tedious. It is not the layout model. `step: 0` means every
 * position on the canvas is available, and that is a supported way to work
 * rather than a broken one.
 */
export function snapValue(value, step) {
  const s = Number(step) || 0
  if (s <= 0) return value
  return Math.round(value / s) * s
}

export function snapBox(box, step) {
  if (!(Number(step) > 0)) return box
  return {
    left: snapValue(box.left, step),
    top: snapValue(box.top, step),
    width: Math.max(1, snapValue(box.width, step)),
    height: Math.max(MIN_H, snapValue(box.height, step)),
  }
}

// ---------------------------------------------------------------------
// Lining up with the neighbours
// ---------------------------------------------------------------------
/**
 * The edges of everything else that this box is nearly level with.
 *
 * The reason a free canvas usually looks untidy is that "nearly aligned" is
 * indistinguishable from "aligned" at a glance and glaring in a screenshot.
 * So a box being dragged snaps to its neighbours' edges and centres when it
 * comes within a few pixels, and the lines it snapped to are returned for
 * drawing -- which is the difference between a canvas you fight and one
 * that helps.
 *
 * Returns `{ box, guides }` where each guide is `{ axis, at }`.
 */
export function alignBox(box, others, { tolerance = GUIDE_TOLERANCE, canvasWidth = 0 } = {}) {
  const guides = []
  const out = { ...box }

  // Candidate lines: every other widget's near edge, far edge and middle,
  // plus the canvas's own edges and centre.
  const vertical = []
  const horizontal = []
  for (const other of others || []) {
    vertical.push(other.left, other.left + other.width, other.left + other.width / 2)
    horizontal.push(other.top, other.top + other.height, other.top + other.height / 2)
  }
  if (canvasWidth > 0) vertical.push(0, canvasWidth, canvasWidth / 2)
  horizontal.push(0)

  const nearest = (value, candidates) => {
    let best = null
    for (const c of candidates) {
      const gap = Math.abs(value - c)
      if (gap <= tolerance && (!best || gap < best.gap)) best = { at: c, gap }
    }
    return best
  }

  // Left edge, right edge, then centre -- in that order, so a box that
  // could align two ways takes the one nearest its leading edge.
  const left = nearest(out.left, vertical)
  const right = nearest(out.left + out.width, vertical)
  const centreX = nearest(out.left + out.width / 2, vertical)

  if (left) {
    out.left = left.at
    guides.push({ axis: 'x', at: left.at })
  } else if (right) {
    out.left = right.at - out.width
    guides.push({ axis: 'x', at: right.at })
  } else if (centreX) {
    out.left = centreX.at - out.width / 2
    guides.push({ axis: 'x', at: centreX.at })
  }

  const top = nearest(out.top, horizontal)
  const bottom = nearest(out.top + out.height, horizontal)
  const centreY = nearest(out.top + out.height / 2, horizontal)

  if (top) {
    out.top = top.at
    guides.push({ axis: 'y', at: top.at })
  } else if (bottom) {
    out.top = bottom.at - out.height
    guides.push({ axis: 'y', at: bottom.at })
  } else if (centreY) {
    out.top = centreY.at - out.height / 2
    guides.push({ axis: 'y', at: centreY.at })
  }

  return { box: out, guides }
}

// ---------------------------------------------------------------------
// Resizing
// ---------------------------------------------------------------------
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/**
 * A box dragged by one of its eight handles.
 *
 * The edges the handle does not name stay exactly where they were, which is
 * what makes a resize feel like moving one edge rather than moving the box
 * and changing its size at the same time.
 */
export function resizeBox(box, handle, dx, dy, { minWidth = 60, minHeight = MIN_H } = {}) {
  let { left, top, width, height } = box

  if (handle.includes('e')) width = Math.max(minWidth, width + dx)
  if (handle.includes('s')) height = Math.max(minHeight, height + dy)

  if (handle.includes('w')) {
    const next = Math.max(minWidth, width - dx)
    left += width - next
    width = next
  }
  if (handle.includes('n')) {
    const next = Math.max(minHeight, height - dy)
    top += height - next
    height = next
  }

  return { left, top: Math.max(0, top), width, height }
}

// ---------------------------------------------------------------------
// Starting from what is already there
// ---------------------------------------------------------------------
/**
 * Frames that reproduce the layout currently on screen.
 *
 * Switching to a free canvas must not rearrange anything. An admin who
 * turns it on to nudge one widget should find every widget exactly where it
 * was a moment ago -- otherwise the feature's first act is to destroy the
 * layout it was opened to adjust.
 */
export function framesFromBoxes(boxes, canvasWidth) {
  const out = {}
  for (const [id, box] of Object.entries(boxes || {})) {
    if (!box) continue
    out[id] = pxToFrame(box, canvasWidth)
  }
  return out
}

/**
 * A fallback layout for a widget that has never had a frame.
 *
 * Two to a row, in order, at a readable height. Only ever used when
 * something is added to a page that is already free and there is nothing
 * measured to copy -- a placed widget is always better than one at 0,0
 * underneath another.
 */
export function defaultFrame(index, perRow = 2, height = 280) {
  const w = 1 / perRow
  return normalizeFrame({
    x: (index % perRow) * w,
    y: Math.floor(index / perRow) * (height + 12),
    w,
    h: height,
  })
}

// ---------------------------------------------------------------------
// Tidying up
// ---------------------------------------------------------------------
/**
 * Everything nudged onto the nearest shared edge.
 *
 * A free canvas drifts: forty small adjustments leave forty edges a pixel
 * or two apart. This pulls them together without moving anything far --
 * each edge goes to the nearest edge already in use, or stays where it is.
 * It is a tidy, not a re-layout, and it is undoable like anything else.
 */
export function tidyFrames(frames, canvasWidth, tolerance = 12) {
  const ids = Object.keys(frames || {})
  const boxes = ids.map((id) => ({ id, ...frameToPx(frames[id], canvasWidth) }))

  const out = {}
  for (const box of boxes) {
    const others = boxes.filter((b) => b.id !== box.id)
    const { box: aligned } = alignBox(box, others, { tolerance, canvasWidth })
    out[box.id] = pxToFrame(aligned, canvasWidth)
  }
  return out
}
