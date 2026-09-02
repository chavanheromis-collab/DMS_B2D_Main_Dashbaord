// ---------------------------------------------------------------------
// One layout: pick it up, put it down, drag it to size
// ---------------------------------------------------------------------
// There were three ways to place a widget on this page and they disagreed
// with each other. Rows and positions that flowed and wrapped; pixel widths
// that were then scaled; a column share that silently beat the pixels; and
// latterly a twelve-column grid that floated everything upward to close
// holes. Every one of them could be made to produce the right picture, and
// none of them could be made to produce it OBVIOUSLY.
//
// So: one model, and the simplest one that can say anything.
//
//   A WIDGET IS A RECTANGLE ON A CANVAS. `x, y, w, h`, in pixels, measured
//   on a canvas of a fixed design width. Nothing is derived from what is
//   beside it, so nothing changes when what is beside it changes.
//
//   WHERE YOU PUT IT IS WHERE IT STAYS. No flow, no wrapping, no
//   compaction, no pushing the neighbours down. A page that rearranges
//   itself after you let go is a page you cannot arrange.
//
//   IT SNAPS TO WHAT IS ALREADY THERE. Free placement without help is how
//   you get eight cards that are each three pixels out. Edges and centres
//   pull to their neighbours' edges and centres, and the line you snapped
//   to is drawn so you can see why.
//
//   AND IT SCALES. The canvas has a design width; a narrower screen draws
//   the same arrangement proportionally smaller. One layout, every screen,
//   with nobody configuring breakpoints.
//
// Pure: rectangles in, rectangles out. Nothing here touches the DOM.

/** The width every stored rectangle is measured against. */
export const DESIGN_WIDTH = 1280

/** The quiet grid underneath. Fine enough to be free, coarse enough to tidy. */
export const SNAP = 8

/** How close an edge has to be before it is pulled into line. */
export const MAGNET = 7

/** Below this a widget is a sliver rather than a decision. */
export const MIN_W = 120
export const MIN_H = 80

/** Every corner and every side. */
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const num = (value, fallback = null) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// ---------------------------------------------------------------------
// Reading a widget's rectangle
// ---------------------------------------------------------------------

/**
 * The rectangle a widget claims, or null if it has never been placed.
 *
 * Null is a real answer, not a zero: "not placed yet" is what `placeAll`
 * exists to settle, and a zero would pile every new widget into the corner.
 */
export function rectOf(item) {
  const x = num(item?.boxX)
  const y = num(item?.boxY)
  const w = num(item?.boxW)
  const h = num(item?.boxH)
  if (x === null || y === null || !(w > 0) || !(h > 0)) return null
  return { id: item.id, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

/** Has this widget been put somewhere? */
export function isPlaced(item) {
  return rectOf(item) !== null
}

/** The fields a rectangle is stored in, as the strings the saver takes. */
export function patchOf(rect) {
  return {
    boxX: String(Math.round(rect.x)),
    boxY: String(Math.round(rect.y)),
    boxW: String(Math.round(rect.w)),
    boxH: String(Math.round(rect.h)),
  }
}

/**
 * Only the widgets whose rectangle actually changed.
 *
 * A gesture moves one widget. Writing back the ones it did not touch is a
 * needless entry in the undo history and a needless write to the document.
 */
export function changedIn(before, after) {
  const was = new Map((before || []).map((item) => [item.id, item]))
  return (after || []).filter((item) => {
    const old = was.get(item.id)
    return !old || old.x !== item.x || old.y !== item.y || old.w !== item.w || old.h !== item.h
  })
}

// ---------------------------------------------------------------------
// Keeping a rectangle sane
// ---------------------------------------------------------------------

const round = (n, step) => Math.round(n / step) * step

/**
 * A rectangle brought inside the canvas and up to a size it can be read at.
 *
 * The width is clamped before the left edge is, so a widget wider than the
 * canvas is narrowed rather than dragged off the side of it.
 */
export function clampRect(rect, { canvasWidth = DESIGN_WIDTH } = {}) {
  const w = Math.max(MIN_W, Math.min(canvasWidth, Math.round(rect.w)))
  const h = Math.max(MIN_H, Math.round(rect.h))
  return {
    ...rect,
    w,
    h,
    x: Math.max(0, Math.min(Math.round(rect.x), canvasWidth - w)),
    y: Math.max(0, Math.round(rect.y)),
  }
}

/** The four edges and the two centre lines of a rectangle. */
export function edgesOf(rect) {
  return {
    left: rect.x,
    right: rect.x + rect.w,
    centreX: rect.x + rect.w / 2,
    top: rect.y,
    bottom: rect.y + rect.h,
    centreY: rect.y + rect.h / 2,
  }
}

// ---------------------------------------------------------------------
// Snapping, and saying what was snapped to
// ---------------------------------------------------------------------

const X_LINES = ['left', 'centreX', 'right']
const Y_LINES = ['top', 'centreY', 'bottom']

/**
 * The nearest thing worth lining up with, in one axis.
 *
 * `values` are MY lines -- all three when a widget is being moved, one when
 * a single edge is being dragged. Taking them as a list rather than reading
 * them back off an object by key is the point: the earlier version looked
 * up all three keys on whatever it was handed, so a caller that only had
 * one edge produced two `undefined`s, and `undefined` compares false
 * against everything, which let a NaN overwrite a perfectly good match.
 *
 * Returns how far to move and the line that pulled it, or null. Closest
 * wins; a tie goes to the first found, which is the topmost, leftmost
 * widget, because that is the order the page is read in.
 */
function magnetFor(values, theirs, keys, magnet) {
  let best = null
  for (const value of values) {
    for (const other of theirs) {
      for (const key of keys) {
        const gap = other[key] - value
        // Spelt as "not within" rather than "further than" so that a
        // stray value would fall out here instead of sailing through every
        // comparison below it. Both callers hand this real numbers, so it
        // is a habit rather than a guard -- but it is the habit that would
        // have stopped the bug this function had, where a one-edge caller
        // produced undefined gaps that beat every honest match.
        if (!(Math.abs(gap) <= magnet)) continue
        if (best && Math.abs(gap) >= Math.abs(best.gap)) continue
        best = { gap, at: other[key] }
      }
    }
  }
  return best
}

/**
 * A rectangle pulled into line with its neighbours.
 *
 * Free placement with no help is how a page ends up with eight cards each
 * three pixels out of true. Every edge and centre is offered to every edge
 * and centre of every other widget, and the closest within `MAGNET` wins.
 *
 * Nothing found, it falls back to the quiet 8px grid underneath -- so a
 * widget with no neighbour to line up with still lands on a round number.
 *
 * Returns the rectangle AND the lines that caught it, because a snap you
 * cannot see is a widget that moved on its own.
 */
export function snapRect(rect, others, { magnet = MAGNET, snap = SNAP } = {}) {
  const mine = edgesOf(rect)
  const theirs = (others || []).map(edgesOf)

  const x = magnetFor(X_LINES.map((key) => mine[key]), theirs, X_LINES, magnet)
  const y = magnetFor(Y_LINES.map((key) => mine[key]), theirs, Y_LINES, magnet)

  return {
    rect: {
      ...rect,
      x: x ? rect.x + x.gap : round(rect.x, snap),
      y: y ? rect.y + y.gap : round(rect.y, snap),
    },
    guides: [
      ...(x ? [{ axis: 'x', at: x.at }] : []),
      ...(y ? [{ axis: 'y', at: y.at }] : []),
    ],
  }
}

// ---------------------------------------------------------------------
// Picking one up and putting it down
// ---------------------------------------------------------------------

/** The one rectangle that contains all of them. */
export function boundsOf(rects) {
  const list = rects || []
  if (list.length === 0) return null
  return {
    id: '(selection)',
    x: Math.min(...list.map((r) => r.x)),
    y: Math.min(...list.map((r) => r.y)),
    w: Math.max(...list.map((r) => r.x + r.w)) - Math.min(...list.map((r) => r.x)),
    h: Math.max(...list.map((r) => r.y + r.h)) - Math.min(...list.map((r) => r.y)),
  }
}

/**
 * Where a whole selection ends up after being dragged by (dx, dy).
 *
 * The SELECTION is what snaps and what is clamped, not each widget in it.
 * Snapping them one at a time would pull the group apart -- two cards a
 * hair's breadth from different magnets would end up a hair's breadth
 * further apart than they started, which is the one thing dragging several
 * things at once has to promise it will not do. So the bounding box moves,
 * and every widget in it moves by exactly what the box moved by.
 *
 * `loose` is the modifier key: exact placement, no snapping, for the one
 * time in ten that a page needs something a magnet will not allow.
 */
export function moveMany(chosen, dx, dy, others, { canvasWidth = DESIGN_WIDTH, loose = false, ...opts } = {}) {
  const box = boundsOf(chosen)
  if (!box) return { rects: [], guides: [] }

  const moved = { ...box, x: box.x + dx, y: box.y + dy }
  const snapped = loose ? { rect: moved, guides: [] } : snapRect(moved, others, opts)

  // Clamped as one thing. A selection wider than the canvas keeps its left
  // edge rather than being squeezed, because moving is not resizing.
  const x = Math.max(0, Math.min(snapped.rect.x, canvasWidth - box.w))
  const y = Math.max(0, snapped.rect.y)
  const shiftX = x - box.x
  const shiftY = y - box.y

  return {
    rects: chosen.map((rect) => ({ ...rect, x: rect.x + shiftX, y: rect.y + shiftY })),
    guides: snapped.guides,
  }
}

/**
 * Where one widget ends up after being dragged by (dx, dy).
 *
 * A selection of one, deliberately: dragging a single widget and dragging
 * five must not be two pieces of code that can drift apart.
 */
export function moveBy(rect, dx, dy, others, opts = {}) {
  const out = moveMany([rect], dx, dy, others, opts)
  return { rect: out.rects[0], guides: out.guides }
}

// ---------------------------------------------------------------------
// Choosing several at once
// ---------------------------------------------------------------------

/** The rectangle between where a rubber band started and where it is now. */
export function marquee(from, to) {
  return {
    id: '(marquee)',
    x: Math.min(from?.x ?? 0, to?.x ?? 0),
    y: Math.min(from?.y ?? 0, to?.y ?? 0),
    w: Math.abs((to?.x ?? 0) - (from?.x ?? 0)),
    h: Math.abs((to?.y ?? 0) - (from?.y ?? 0)),
  }
}

/**
 * Everything the rubber band is touching.
 *
 * TOUCHED, not enclosed. Requiring a widget to be swallowed whole means
 * dragging the band past the edge of the screen to catch a wide chart, and
 * "I dragged a box over it and it was not picked" is the complaint that
 * makes people stop using a marquee.
 */
export function within(layout, box) {
  return (layout || [])
    .filter(
      (rect) =>
        rect.x < box.x + box.w &&
        rect.x + rect.w > box.x &&
        rect.y < box.y + box.h &&
        rect.y + rect.h > box.y
    )
    .map((rect) => rect.id)
}

/**
 * The selection after clicking a widget.
 *
 * A plain click replaces the selection; a held modifier adds to it, and
 * clicking an already-chosen one with the modifier down takes it out again,
 * which is the only way to correct a marquee that caught one thing too many.
 */
export function toggle(selection, id, additive = false) {
  const next = new Set(additive ? selection || [] : [])
  if (additive && next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/**
 * Where a widget ends up after one of its eight handles is dragged.
 *
 * A north or west handle moves the far edge as well as the size, which is
 * the whole difference between resizing from a corner and resizing from the
 * one opposite it. The minimum is applied to the SIZE and the edge is then
 * worked back from it, so a handle dragged past its opposite edge stops
 * there rather than turning the rectangle inside out.
 */
export function resizeBy(rect, handle, dx, dy, others, { canvasWidth = DESIGN_WIDTH, loose = false, ...opts } = {}) {
  const right = rect.x + rect.w
  const bottom = rect.y + rect.h
  let { x, y, w, h } = rect

  if (handle.includes('e')) w = rect.w + dx
  if (handle.includes('s')) h = rect.h + dy
  if (handle.includes('w')) {
    w = Math.max(MIN_W, rect.w - dx)
    x = right - w
  }
  if (handle.includes('n')) {
    h = Math.max(MIN_H, rect.h - dy)
    y = bottom - h
  }

  const grown = { ...rect, x, y, w, h }
  if (loose) return { rect: clampRect(grown, { canvasWidth }), guides: [] }

  // Only the edges this handle is actually moving are offered to the
  // magnets. A south-east drag that snapped the widget's TOP would move an
  // edge the hand is not touching.
  const snapped = snapEdges(grown, handle, others, opts)
  return { rect: clampRect(snapped.rect, { canvasWidth }), guides: snapped.guides }
}

/** Snapping for a resize: the moving edges only, and the size follows. */
function snapEdges(rect, handle, others, { magnet = MAGNET, snap = SNAP } = {}) {
  const theirs = (others || []).map(edgesOf)
  const mine = edgesOf(rect)
  const guides = []
  let { x, y, w, h } = rect

  // One edge of mine, offered to every line of theirs.
  const pull = (key, keys) => magnetFor([mine[key]], theirs, keys, magnet)

  if (handle.includes('e')) {
    const hit = pull('right', X_LINES)
    if (hit) {
      w += hit.gap
      guides.push({ axis: 'x', at: hit.at })
    } else w = round(w, snap)
  }
  if (handle.includes('w')) {
    const hit = pull('left', X_LINES)
    if (hit) {
      x += hit.gap
      w -= hit.gap
      guides.push({ axis: 'x', at: hit.at })
    } else w = round(w, snap)
  }
  if (handle.includes('s')) {
    const hit = pull('bottom', Y_LINES)
    if (hit) {
      h += hit.gap
      guides.push({ axis: 'y', at: hit.at })
    } else h = round(h, snap)
  }
  if (handle.includes('n')) {
    const hit = pull('top', Y_LINES)
    if (hit) {
      y += hit.gap
      h -= hit.gap
      guides.push({ axis: 'y', at: hit.at })
    } else h = round(h, snap)
  }

  return { rect: { ...rect, x, y, w, h }, guides }
}

// ---------------------------------------------------------------------
// Giving a rectangle to something that has not got one
// ---------------------------------------------------------------------

/** How far down the canvas anything reaches. */
export function bottomOf(layout) {
  return (layout || []).reduce((n, rect) => Math.max(n, rect.y + rect.h), 0)
}

/**
 * The first free spot for a new widget, scanning left to right then down.
 *
 * Free placement means nothing STOPS two widgets overlapping -- but a
 * widget that arrives already on top of another is a widget nobody asked
 * to overlap, so a new one is given room of its own.
 */
export function freeSpot(layout, w, h, { canvasWidth = DESIGN_WIDTH, gap = 12 } = {}) {
  const overlaps = (rect) =>
    (layout || []).some(
      (other) =>
        rect.x < other.x + other.w &&
        rect.x + rect.w > other.x &&
        rect.y < other.y + other.h &&
        rect.y + rect.h > other.y
    )
  for (let y = 0; y <= bottomOf(layout) + gap; y += SNAP) {
    for (let x = 0; x + w <= canvasWidth; x += SNAP) {
      if (!overlaps({ x, y, w, h })) return { x, y }
    }
  }
  return { x: 0, y: bottomOf(layout) + gap }
}

/**
 * Every widget with a rectangle -- and one invented, in the page's own
 * order, for each widget that has not got one.
 *
 * A widget added to the page has no rectangle until somebody drags it, and
 * "no rectangle" must not mean "invisible".
 */
export function placeAll(items, { canvasWidth = DESIGN_WIDTH, defaultW = 400, defaultH = 240, gap = 12 } = {}) {
  const layout = []
  for (const item of items || []) {
    const rect = rectOf(item)
    if (rect) {
      layout.push(clampRect(rect, { canvasWidth }))
      continue
    }
    const w = Math.min(canvasWidth, Math.max(MIN_W, num(item?.estimatedWidth, defaultW)))
    const h = Math.max(MIN_H, num(item?.estimatedHeight, defaultH))
    const spot = freeSpot(layout, w, h, { canvasWidth, gap })
    layout.push({ id: item.id, x: spot.x, y: spot.y, w, h })
  }
  return layout
}

// ---------------------------------------------------------------------
// The same arrangement on a screen that is not the design width
// ---------------------------------------------------------------------

/**
 * Beyond this the canvas stops stretching and is centred in what is left.
 *
 * An ultra-wide monitor is not a reason to draw a KPI card two feet across.
 * Past this width the extra room becomes margin, which is what every wide
 * layout on the web does and what a reader's eye expects.
 */
export const MAX_CANVAS = 2048

/**
 * How much to scale the canvas by, horizontally and vertically.
 *
 * Two numbers, because the two directions want different answers.
 *
 *   NARROWER THAN THE DESIGN, both shrink together. The arrangement was
 *   drawn to fit a certain width and shrinking only one axis would squash
 *   it -- a chart half as wide and just as tall is not the same picture.
 *
 *   WIDER, only the widths grow. A monitor with more room is a reason to
 *   make the cards wider, not to inflate the text inside them: blowing the
 *   whole thing up is how a dashboard on a big screen ends up looking like
 *   a dashboard on a small screen viewed through a magnifying glass.
 *
 * That is the whole responsive story, and it needs no breakpoints: the page
 * fills a laptop, fills a desktop, and gives up and stacks on a phone.
 */
export function scaleFor(canvasWidth, designWidth = DESIGN_WIDTH) {
  const width = num(canvasWidth, 0)
  if (!(width > 0) || !(designWidth > 0)) return { x: 1, y: 1 }
  const room = Math.min(width, MAX_CANVAS) / designWidth
  return room < 1 ? { x: room, y: room } : { x: room, y: 1 }
}

/** How wide the canvas actually draws, which past MAX_CANVAS is a margin. */
export function drawnWidth(canvasWidth) {
  const width = num(canvasWidth, 0)
  return width > 0 ? Math.min(width, MAX_CANVAS) : 0
}

/** A rectangle as it is actually drawn, at this scale. */
export function toPixels(rect, scale = { x: 1, y: 1 }) {
  return {
    left: Math.round(rect.x * scale.x),
    top: Math.round(rect.y * scale.y),
    width: Math.round(rect.w * scale.x),
    height: Math.round(rect.h * scale.y),
  }
}

/** How tall the canvas has to be, at this scale. */
export function canvasHeight(layout, scale = { x: 1, y: 1 }) {
  return Math.round(bottomOf(layout) * scale.y)
}

/**
 * On a phone, the arrangement is the wrong question.
 *
 * Below this the design does not scale -- a 400px card drawn at a third of
 * its size is a card nobody can read. Everything goes full width, one to a
 * line, in the order it is arranged in: top to bottom, then left to right.
 */
export const STACK_BELOW = 640

export function stacked(layout, canvasWidth, { gap = 12 } = {}) {
  const order = [...(layout || [])].sort(
    (a, b) => a.y - b.y || a.x - b.x || String(a.id).localeCompare(String(b.id))
  )
  let top = 0
  return order.map((rect) => {
    // Its own proportions, at the width it now has -- so a short KPI card
    // stays short and a tall chart stays tall.
    const height = Math.max(MIN_H, Math.round((rect.h / Math.max(1, rect.w)) * canvasWidth))
    const box = { ...rect, x: 0, y: top, w: canvasWidth, h: height }
    top += height + gap
    return box
  })
}

// ---------------------------------------------------------------------
// Arriving from the engine this replaced
// ---------------------------------------------------------------------

/**
 * Rectangles matching what the old flowed-row layout was drawing.
 *
 * Run once per page, the first time it is opened after the change. Every
 * page that exists was arranged with rows, positions, pixel widths and
 * column shares; throwing those away would have meant every dashboard in
 * the workspace rearranging itself overnight, which is not an upgrade.
 *
 * `positions` is what the flow packer worked out, keyed by widget id.
 */
export function seedFrom(positions, { canvasWidth = DESIGN_WIDTH, designWidth = DESIGN_WIDTH } = {}) {
  // Measured on the screen it was drawn on, stored against the design
  // width -- otherwise a page seeded on a laptop would be half size for
  // everybody else.
  const back = canvasWidth > 0 ? designWidth / canvasWidth : 1
  return Object.entries(positions || {}).map(([id, box]) =>
    clampRect(
      {
        id,
        x: Math.round((box.left || 0) * back),
        y: Math.round((box.top || 0) * back),
        w: Math.round((box.width || 0) * back),
        h: Math.round((box.height || 0) * back),
      },
      { canvasWidth: designWidth }
    )
  )
}
