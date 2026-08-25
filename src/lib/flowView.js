// ---------------------------------------------------------------------
// Reading a flow -- the analysis layer
// ---------------------------------------------------------------------
// lib/flow.js builds the tree and lib/flowLayout.js places it. This is the
// part in between the picture and the person: finding a branch in a canvas
// of three hundred, following one path through the noise, hiding the
// hairlines, and saying what the diagram would tell you if you had time to
// read every node.
//
// All of it is pure. A zoom button, a search box and a minimap are three
// buttons in a component and three functions here -- and a function is the
// half that can actually be tested, so that is where the behaviour lives.

import { flattenFlow } from './flow.js'

// ---------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------
export const ZOOM_MIN = 0.15
export const ZOOM_MAX = 4
export const ZOOM_STEP = 1.25

export function clampZoom(zoom) {
  const n = Number(zoom)
  if (!Number.isFinite(n)) return 1
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(n.toFixed(4))))
}

/**
 * Zoom about a fixed point, so whatever is under the cursor stays under it.
 *
 * Zooming about the centre instead is the thing that makes a canvas feel
 * like it is fighting you: you point at the branch you care about, zoom,
 * and it slides away off the edge.
 */
export function zoomAbout(view, factor, px, py) {
  const zoom = clampZoom(view.zoom * factor)
  const k = zoom / view.zoom
  return { zoom, x: px - (px - view.x) * k, y: py - (py - view.y) * k }
}

/** The view that puts one node in the middle of the viewport. */
export function centreOn(box, viewport, zoom) {
  if (!box) return null
  const z = clampZoom(zoom)
  return {
    zoom: z,
    x: viewport.width / 2 - (box.x + box.w / 2) * z,
    y: viewport.height / 2 - (box.y + box.h / 2) * z,
  }
}

/**
 * What a key press does.
 *
 * Named rather than switched inline, because "does the keyboard still work"
 * is a question a test can answer about a table and cannot answer about an
 * event handler.
 */
export function flowKeyAction(key, { ctrl = false } = {}) {
  if (ctrl) return null
  switch (key) {
    case '+':
    case '=':
      return { type: 'zoom', factor: ZOOM_STEP }
    case '-':
    case '_':
      return { type: 'zoom', factor: 1 / ZOOM_STEP }
    case '0':
      return { type: 'fit' }
    case '1':
      return { type: 'actual' }
    case 'f':
    case 'F':
      return { type: 'fullscreen' }
    case '/':
      return { type: 'search' }
    case 'Escape':
      return { type: 'clear' }
    case 'ArrowLeft':
      return { type: 'pan', dx: 80, dy: 0 }
    case 'ArrowRight':
      return { type: 'pan', dx: -80, dy: 0 }
    case 'ArrowUp':
      return { type: 'pan', dx: 0, dy: 80 }
    case 'ArrowDown':
      return { type: 'pan', dx: 0, dy: -80 }
    default:
      return null
  }
}

// ---------------------------------------------------------------------
// Finding something
// ---------------------------------------------------------------------
/**
 * Every visible node whose label -- or the trail that led to it -- matches.
 *
 * The trail counts because "Pune" should find *Pune → Splendor → Financed*
 * even though that node is called "Financed": on a drill tree, where a node
 * sits is most of what it means.
 */
export function searchFlow(roots, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []

  const out = []
  for (const root of roots || []) {
    for (const node of flattenFlow(root)) {
      const label = String(node.label ?? '').toLowerCase()
      const trail = (node.trail || []).join(' → ').toLowerCase()
      if (label.includes(q) || trail.includes(q)) {
        out.push({ node, key: `${node.treeId || ''}${node.path}`, onLabel: label.includes(q) })
      }
    }
  }

  // A hit on the node's own name beats one that only matched its ancestry,
  // and a bigger branch beats a smaller one -- searching is nearly always a
  // question about where the volume went.
  return out.sort((a, b) => (a.onLabel === b.onLabel ? (b.node.value || 0) - (a.node.value || 0) : a.onLabel ? -1 : 1))
}

/** Wraps around at both ends, so ▲/▼ on the last match never dead-ends. */
export function stepMatch(count, current, delta) {
  if (count <= 0) return -1
  return (((current + delta) % count) + count) % count
}

// ---------------------------------------------------------------------
// Following one path
// ---------------------------------------------------------------------
/**
 * The node, everything above it, and everything below it.
 *
 * Hovering a branch in a wide canvas and having its whole lineage light up
 * while the rest goes quiet is the difference between a diagram you can
 * trace and a diagram you squint at. Descendants are included because the
 * question is nearly always "and where did THAT go".
 */
export function lineagePaths(roots, key) {
  if (!key) return null

  for (const root of roots || []) {
    const nodes = flattenFlow(root)
    const found = nodes.find((n) => `${n.treeId || ''}${n.path}` === key)
    if (!found) continue

    const prefix = found.treeId || ''
    const keys = new Set()

    // Ancestors: a path is "/a/b/c", so every prefix of it is a forebear.
    let walk = ''
    for (const part of found.path.split('/').slice(1)) {
      walk += `/${part}`
      keys.add(`${prefix}${walk}`)
    }
    keys.add(key)

    for (const node of flattenFlow(found)) keys.add(`${prefix}${node.path}`)
    return keys
  }
  return null
}

// ---------------------------------------------------------------------
// Hiding the hairlines
// ---------------------------------------------------------------------
export const SIGNIFICANCE_STEPS = [0, 0.01, 0.02, 0.05, 0.1]

/**
 * Drops branches below a share of their parent, and says what it dropped.
 *
 * A split that fans out forty ways where thirty-four are under one percent
 * is unreadable, and the six that matter are the whole point. But a diagram
 * that silently loses rows is a diagram that lies, so this returns the
 * count and the value it removed for the caller to print. Nothing is
 * hidden without being counted.
 *
 * The root of a tree is never dropped, whatever its share.
 */
export function pruneBySignificance(roots, minShare) {
  const min = Number(minShare) || 0
  if (min <= 0) return { roots: roots || [], hidden: 0, hiddenValue: 0 }

  let hidden = 0
  let hiddenValue = 0

  const prune = (node) => {
    const children = node.children || []
    if (children.length === 0) return node

    const kept = []
    for (const child of children) {
      const share = child.share
      if (share !== null && share !== undefined && share < min) {
        hidden += flattenFlow(child).length
        hiddenValue += child.value || 0
        continue
      }
      kept.push(prune(child))
    }
    return { ...node, children: kept }
  }

  return { roots: (roots || []).map(prune), hidden, hiddenValue }
}

// ---------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------
export const FLOW_VIEW_SORTS = [
  { value: 'natural', label: 'As built' },
  { value: 'value_desc', label: 'Biggest first' },
  { value: 'value_asc', label: 'Smallest first' },
  { value: 'name_asc', label: 'A → Z' },
  { value: 'drop_desc', label: 'Worst drop-off first' },
]

/**
 * Re-orders every level of every tree, without touching the numbers.
 *
 * The admin chose an order when the flow was built; a reader looking for
 * where the volume went, or where it was lost, wants a different one, and
 * neither is wrong. Roll-up buckets ("Other", "(blank)") stay last however
 * it is sorted -- they are a footnote, not a branch, and a big Other at the
 * top of a list reads as the answer.
 */
export function sortFlowRoots(roots, order) {
  if (!order || order === 'natural') return roots || []

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  const isFootnote = (n) => n.kind === 'other' || n.kind === 'blank' || n.kind === 'else'

  const compare = (a, b) => {
    if (isFootnote(a) !== isFootnote(b)) return isFootnote(a) ? 1 : -1
    switch (order) {
      case 'value_asc':
        return (a.value || 0) - (b.value || 0)
      case 'name_asc':
        return collator.compare(String(a.label ?? ''), String(b.label ?? ''))
      case 'drop_desc':
        return (b.dropOff || 0) - (a.dropOff || 0)
      default:
        return (b.value || 0) - (a.value || 0)
    }
  }

  const walk = (node) => {
    const children = node.children || []
    if (children.length === 0) return node
    return { ...node, children: [...children].map(walk).sort(compare) }
  }

  return (roots || []).map(walk)
}

// ---------------------------------------------------------------------
// What the diagram would tell you
// ---------------------------------------------------------------------
/**
 * The three or four sentences somebody would write under this diagram.
 *
 * Not decoration: on a canvas of two hundred nodes the biggest drop-off is
 * the thing you opened it to find, and hunting for it by eye across four
 * levels is exactly the work a computer should have done first.
 */
export function flowStats(roots) {
  const all = []
  for (const root of roots || []) all.push(...flattenFlow(root))

  const open = all.filter((n) => n.open).length
  const leaves = all.filter((n) => !n.children || n.children.length === 0).length
  const depth = all.reduce((max, n) => Math.max(max, n.level || 0), 0)

  // The worst drop-off, and the biggest single branch, both ignoring roots:
  // a root has nothing above it to have dropped from.
  let worstDrop = null
  let biggest = null
  for (const node of all) {
    if (node.level === 0) continue
    if (node.dropOff > 0 && (!worstDrop || node.dropOff > worstDrop.dropOff)) worstDrop = node
    if (!biggest || (node.value || 0) > (biggest.value || 0)) biggest = node
  }

  return { nodes: all.length, open, leaves, depth, worstDrop, biggest }
}

// ---------------------------------------------------------------------
// The minimap
// ---------------------------------------------------------------------
/**
 * The whole canvas shrunk to fit a small box, and the rectangle showing
 * which part of it is on screen.
 *
 * Orientation, on a canvas big enough to get lost in. `view` is the pan and
 * zoom the viewport is at; the rectangle is where that lands in minimap
 * space, clamped so it stays visible even when the reader has panned right
 * off the edge of the diagram.
 */
export function minimapGeometry(layout, view, viewport, box = { width: 132, height: 96 }) {
  const lw = layout?.width || 0
  const lh = layout?.height || 0
  if (!lw || !lh) return null

  const scale = Math.min(box.width / lw, box.height / lh)
  const width = lw * scale
  const height = lh * scale

  const zoom = view?.zoom || 1
  // The world coordinates of the viewport's top-left corner.
  const worldX = -(view?.x || 0) / zoom
  const worldY = -(view?.y || 0) / zoom

  const rect = {
    x: worldX * scale,
    y: worldY * scale,
    width: (viewport.width / zoom) * scale,
    height: (viewport.height / zoom) * scale,
  }

  return { scale, width, height, rect }
}

/** Where to pan so a click at (mx, my) in the minimap becomes the centre. */
export function minimapJump(layout, viewport, view, point, box = { width: 132, height: 96 }) {
  const geo = minimapGeometry(layout, view, viewport, box)
  if (!geo) return view
  const zoom = view?.zoom || 1
  return {
    zoom,
    x: viewport.width / 2 - (point.x / geo.scale) * zoom,
    y: viewport.height / 2 - (point.y / geo.scale) * zoom,
  }
}

// ---------------------------------------------------------------------
// The peek -- a magnified window over one branch
// ---------------------------------------------------------------------
// Zoomed out far enough to see the shape of a flow, the cards are too small
// to read. Zoomed in far enough to read them, you cannot see the shape. That
// is the permanent bind of any canvas, and panning between the two is what
// makes people give up on one.
//
// So: hover a branch and a fixed-size square opens over it, at full size
// whatever the canvas is scaled to, listing everything directly under that
// branch. It scrolls, so a branch with forty children is all there. And
// clicking a row moves the window down into that child, which means a whole
// path can be walked without touching the canvas at all.
//
// Screen coordinates, not canvas ones: a window drawn inside the zoom
// transform would be scaled with everything else, which is the exact
// problem it exists to solve.

export const PEEK_SIZE = 272

/**
 * Where to put the window so that all of it is on screen.
 *
 * Beside the branch by preference -- above or below would cover the level
 * the reader is comparing against. It flips to the other side when there is
 * no room, and only falls back to overlapping when neither side fits, which
 * on a phone-width screen is every time.
 */
export function peekPlacement(anchor, size, viewport, gap = 10) {
  const w = size?.width || PEEK_SIZE
  const h = size?.height || PEEK_SIZE
  const margin = 8

  const roomRight = viewport.width - anchor.right
  const roomLeft = anchor.left

  let side = 'right'
  let x = anchor.right + gap
  if (roomRight < w + gap && roomLeft >= w + gap) {
    side = 'left'
    x = anchor.left - w - gap
  } else if (roomRight < w + gap) {
    side = 'over'
    x = Math.max(margin, Math.min(anchor.left, viewport.width - w - margin))
  }

  // Vertically centred on the branch, then pushed back inside the viewport.
  let y = anchor.top + anchor.height / 2 - h / 2
  y = Math.max(margin, Math.min(y, viewport.height - h - margin))

  return { x: Math.max(margin, Math.min(x, viewport.width - w - margin)), y, side }
}

/**
 * The rows the window lists: everything directly under this branch.
 *
 * Plus, when the children do not add up to the parent, a final row for what
 * is missing. A split capped at the top six, or one that excluded blanks,
 * leaves rows in the parent that are in none of its children -- and a list
 * that quietly omitted them would have the reader adding up six numbers,
 * getting the wrong total, and trusting the list.
 */
export function peekRows(node) {
  const children = node?.children || []
  const rows = children.map((child) => ({
    key: `${child.treeId || ''}${child.path}`,
    node: child,
    label: child.label,
    value: child.value || 0,
    share: child.share,
    hasChildren: !!child.hasChildren,
    kind: child.kind,
  }))

  const claimed = children.reduce((sum, c) => sum + (c.value || 0), 0)
  const missing = (node?.value || 0) - claimed
  // A rounding-sized difference is not a finding; a real one is.
  if (children.length > 0 && missing > 0.0001 && node.value > 0 && missing / node.value > 0.001) {
    rows.push({
      key: `${node.treeId || ''}${node.path}!rest`,
      node: null,
      label: 'in none of these',
      value: missing,
      share: missing / node.value,
      hasChildren: false,
      kind: 'rest',
    })
  }

  return rows
}

// ---------------------------------------------------------------------
// The magnifier
// ---------------------------------------------------------------------
// A round glass held over the page, the way you would over a newspaper.
//
// It answers the same question as the peek window and answers it
// differently: the peek tells you what is UNDER a branch, in words; the
// glass just makes the ink bigger. On a canvas zoomed out far enough to see
// the shape of a whole flow, that is often all anybody wants -- to read the
// three labels they are pointing at without losing the shape by zooming in.
//
// It is drawn as a second copy of the same content, transformed so that the
// point under the cursor sits in the middle of the glass at a larger scale.
// A copy rather than a CSS filter because there is no CSS that magnifies
// what is behind an element -- and because a copy stays crisp, since it is
// the same vector drawing rendered again rather than a bitmap blown up.

export const LENS_RADIUS = 92
export const LENS_FACTORS = [1.75, 2.5, 4]

/**
 * How to transform the copy inside the glass.
 *
 * `point` is where the cursor is, relative to the viewport. `view` is the
 * canvas's own pan and zoom. The world point under the cursor is worked out
 * from those, and then placed at the centre of the glass at the magnified
 * scale -- so whatever you are pointing at is exactly what you see, however
 * far the canvas itself has been panned or zoomed.
 */
export function lensTransform(point, view, { radius = LENS_RADIUS, factor = 2.5 } = {}) {
  const zoom = clampZoom((view?.zoom || 1) * factor)

  // Where the cursor is in the diagram's own coordinates.
  const worldX = (point.x - (view?.x || 0)) / (view?.zoom || 1)
  const worldY = (point.y - (view?.y || 0)) / (view?.zoom || 1)

  return {
    zoom,
    x: radius - worldX * zoom,
    y: radius - worldY * zoom,
  }
}

/** Where the glass itself sits, clamped so it never leaves the canvas. */
export function lensPosition(point, viewport, radius = LENS_RADIUS) {
  const size = radius * 2
  return {
    left: Math.max(0, Math.min(point.x - radius, (viewport?.width || 0) - size)),
    top: Math.max(0, Math.min(point.y - radius, (viewport?.height || 0) - size)),
  }
}
