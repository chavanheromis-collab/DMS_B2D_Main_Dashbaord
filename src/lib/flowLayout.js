// ---------------------------------------------------------------------
// Laying a flow out as a diagram
// ---------------------------------------------------------------------
// The indented tree answers "what is under this", and answers it on a
// phone. A diagram answers a different question -- "what is the SHAPE of
// this process" -- and no amount of indentation shows a shape.
//
// So this is the second view of the same tree, and it is deliberately a
// classic tidy tree rather than a free-form canvas of draggable boxes:
//
//  - Every node is placed by the data, so a flow cannot drift into a mess
//    that has to be tidied by hand, and two people looking at the same page
//    see the same picture.
//  - A parent sits centred over its children, which is the one convention
//    every org chart, decision tree and process map already shares.
//  - The EDGE carries the volume. Its thickness is the child's share of its
//    parent, so a fat line into a thin one is visible as a drop-off before
//    you have read a single number -- the thing a Sankey does well, without
//    a Sankey's inability to show anything but flow.
//
// Pure geometry, no React: everything here is numbers in, numbers out, so
// the layout can be tested without a DOM.

export const FLOW_ORIENTATIONS = [
  { value: 'vertical', label: 'Top to bottom' },
  { value: 'horizontal', label: 'Left to right' },
]

export const FLOW_LAYOUT_DEFAULTS = {
  nodeW: 178,
  nodeH: 58,
  metricsH: 20,
  gapX: 22,
  gapY: 54,
  padding: 20,
}

/** Every node that is actually on screen: the subtree of what is open. */
function visibleChildren(node) {
  return node.open ? node.children || [] : []
}

/**
 * Assigns each node a slot on the cross axis.
 *
 * Leaves take the next free slot; a parent is centred over the span of its
 * children. Walking post-order means a parent is placed only once every
 * child it has to sit above already knows where it is.
 */
function assignSlots(node, depth, state) {
  const children = visibleChildren(node)
  const laid = { node, depth, children: [] }

  if (children.length === 0) {
    laid.slot = state.next
    state.next += 1
  } else {
    for (const child of children) laid.children.push(assignSlots(child, depth + 1, state))
    const first = laid.children[0].slot
    const last = laid.children[laid.children.length - 1].slot
    laid.slot = (first + last) / 2
  }

  state.maxDepth = Math.max(state.maxDepth, depth)
  return laid
}

function flatten(laid, into = []) {
  into.push(laid)
  for (const child of laid.children) flatten(child, into)
  return into
}

/**
 * The bezier from a parent's edge to a child's, and the point halfway along
 * it where the edge's label sits.
 *
 * Control points are pulled straight out along the flow axis, which is what
 * gives the familiar soft "S" instead of a diagonal -- and what keeps two
 * edges leaving the same parent visually distinct where they separate.
 */
function edgeGeometry(from, to, orientation) {
  const vertical = orientation !== 'horizontal'

  const x1 = vertical ? from.x + from.w / 2 : from.x + from.w
  const y1 = vertical ? from.y + from.h : from.y + from.h / 2
  const x2 = vertical ? to.x + to.w / 2 : to.x
  const y2 = vertical ? to.y : to.y + to.h / 2

  const c1x = vertical ? x1 : x1 + (x2 - x1) / 2
  const c1y = vertical ? y1 + (y2 - y1) / 2 : y1
  const c2x = vertical ? x2 : x2 - (x2 - x1) / 2
  const c2y = vertical ? y2 - (y2 - y1) / 2 : y2

  return {
    d: `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`,
    // B(0.5) of a cubic is (P0 + 3P1 + 3P2 + P3) / 8.
    mx: (x1 + 3 * c1x + 3 * c2x + x2) / 8,
    my: (y1 + 3 * c1y + 3 * c2y + y2) / 8,
  }
}

/** How heavy an edge is drawn, from the share flowing along it. */
export function edgeWidth(share, min = 1.5, max = 9) {
  const s = Number.isFinite(share) ? Math.max(0, Math.min(1, share)) : 0
  return min + (max - min) * s
}

/**
 * Positions every visible node and the edges between them.
 *
 * Returns pixel boxes in a coordinate space that starts at 0,0 -- the
 * renderer scales and pans that space rather than recomputing it, so
 * zooming never re-lays anything out.
 */
export function layoutFlow(root, options = {}) {
  const o = { ...FLOW_LAYOUT_DEFAULTS, ...options }
  const orientation = o.orientation === 'horizontal' ? 'horizontal' : 'vertical'
  const vertical = orientation === 'vertical'

  if (!root) return { nodes: [], edges: [], width: 0, height: 0, orientation }

  const state = { next: 0, maxDepth: 0 }
  const laidRoot = assignSlots(root, 0, state)
  const laid = flatten(laidRoot)

  // One height for every card, so rows line up and the eye can read across
  // a level. Metrics are all-or-nothing per flow, not per node.
  const hasMetrics = laid.some((l) => (l.node.metrics || []).length > 0)
  const nodeH = o.nodeH + (hasMetrics ? o.metricsH : 0)

  const stepMain = (vertical ? nodeH : o.nodeW) + (vertical ? o.gapY : o.gapX)
  const stepCross = (vertical ? o.nodeW : nodeH) + (vertical ? o.gapX : o.gapY)

  // An offset lets several trees share one coordinate space. Applied to the
  // boxes BEFORE the edges are computed, so every path comes out already in
  // the right place rather than needing its `d` string rewritten afterwards.
  const dx = o.offsetX || 0
  const dy = o.offsetY || 0

  const boxes = new Map()
  for (const item of laid) {
    const main = o.padding + item.depth * stepMain
    const cross = o.padding + item.slot * stepCross
    const box = {
      node: item.node,
      depth: item.depth,
      x: (vertical ? cross : main) + dx,
      y: (vertical ? main : cross) + dy,
      w: o.nodeW,
      h: nodeH,
    }
    boxes.set(item.node.path, box)
  }

  const edges = []
  for (const item of laid) {
    const from = boxes.get(item.node.path)
    for (const child of item.children) {
      const to = boxes.get(child.node.path)
      const { d, mx, my } = edgeGeometry(from, to, orientation)
      edges.push({
        id: `${item.node.path}->${child.node.path}`,
        from: item.node.path,
        to: child.node.path,
        node: child.node,
        share: child.node.share,
        width: edgeWidth(child.node.share),
        d,
        mx,
        my,
      })
    }
  }

  const nodes = Array.from(boxes.values())
  const width = Math.max(...nodes.map((n) => n.x + n.w), 0) + o.padding
  const height = Math.max(...nodes.map((n) => n.y + n.h), 0) + o.padding

  return { nodes, edges, width, height, orientation, nodeH }
}

/**
 * Several trees, laid out side by side in ONE coordinate space.
 *
 * Not several canvases stacked: one canvas, one zoom, one pan. Trees that
 * answer related questions are read by looking between them, and two
 * separately-scrolling boxes make that comparison impossible -- you can
 * never get both at the same size on the same screen.
 *
 * They are laid out ACROSS the flow axis: top-to-bottom trees stand side by
 * side, left-to-right trees stack. Each keeps its own internal spacing, so
 * a wide tree and a narrow one still read as the same kind of object.
 */
export function layoutForest(roots, options = {}) {
  const list = (roots || []).filter(Boolean)
  if (list.length === 0) return layoutFlow(null, options)
  if (list.length === 1) return layoutFlow(list[0], options)

  const o = { ...FLOW_LAYOUT_DEFAULTS, ...options }
  const vertical = o.orientation !== 'horizontal'
  // A wider gutter between trees than between siblings, so the eye groups
  // each tree before it compares them.
  const gutter = (vertical ? o.gapX : o.gapY) * 2.5

  const nodes = []
  const edges = []
  const bands = []
  let offset = 0
  let width = 0
  let height = 0
  let nodeH = 0

  for (const root of list) {
    const one = layoutFlow(root, { ...options, offsetX: vertical ? offset : 0, offsetY: vertical ? 0 : offset })
    nodes.push(...one.nodes)
    edges.push(...one.edges)
    bands.push({ root, x: vertical ? offset : 0, y: vertical ? 0 : offset, width: one.width, height: one.height })

    offset += (vertical ? one.width : one.height) + gutter
    width = Math.max(width, vertical ? offset - gutter : one.width)
    height = Math.max(height, vertical ? one.height : offset - gutter)
    nodeH = Math.max(nodeH, one.nodeH || 0)
  }

  return { nodes, edges, bands, width, height, orientation: vertical ? 'vertical' : 'horizontal', nodeH }
}

/**
 * The zoom that fits a layout inside a viewport, and the offset that centres
 * it there.
 *
 * Capped at 1: a two-node flow blown up to fill a 400px-tall card looks
 * broken, and reading a diagram is not helped by making it enormous.
 */
export function fitToViewport(layout, viewport, { max = 1, min = 0.25, margin = 8 } = {}) {
  const vw = Math.max(1, viewport.width - margin * 2)
  const vh = Math.max(1, viewport.height - margin * 2)
  if (!layout.width || !layout.height) return { zoom: 1, x: margin, y: margin }

  const zoom = Math.max(min, Math.min(max, Math.min(vw / layout.width, vh / layout.height)))
  return {
    zoom,
    x: (viewport.width - layout.width * zoom) / 2,
    y: Math.max(margin, (viewport.height - layout.height * zoom) / 2),
  }
}
