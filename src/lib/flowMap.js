// ---------------------------------------------------------------------
// The whole flow, on one plate
// ---------------------------------------------------------------------
// The Flow widget is a thing you OPEN. That is the right shape for
// exploring -- you choose the depth, and nothing below the top costs
// anything until you ask for it -- and the wrong shape for the other half
// of the job, which is looking at the whole process at once and seeing
// where it goes.
//
// This is that other half. Same trees, same numbers, same drill-throughs;
// no clicking. Every level is drawn at the same time, area is volume, and
// the drop-off between one level and the next is a hole you can see rather
// than a percentage you have to look up.
//
// Four plates, because "which shape reads best" genuinely depends on the
// data and nobody can pick for you in advance:
//
//   BANDS (Sankey)  volume flowing left to right, and what was lost drawn
//                   as an explicit gap rather than implied by subtraction.
//   ICICLE          every level as a solid column. The densest of the four
//                   -- two hundred branches stay readable.
//   TREEMAP         area against area, for comparing leaves rather than
//                   following paths.
//   SUNBURST        the icicle wrapped into a circle. Depth reads as
//                   distance from the middle, which is the one layout that
//                   makes a deep, narrow tree look small instead of long.
//
// Pure geometry: numbers in, numbers out, no React and no DOM, so every
// one of them can be tested.

const EPSILON = 1e-9

/** A node's identity across trees -- the same key the diagram view uses. */
export const nodeKey = (node) => `${node.treeId || ''}${node.path}`

/**
 * The tree, cut off at a depth.
 *
 * A depth control is the single most useful thing on a whole-flow view:
 * level four is where a diagram stops being readable, and being able to say
 * "just the first two" without rebuilding anything is what makes the plate
 * usable on a wide tree.
 */
export function limitDepth(roots, maxDepth) {
  const max = Number.isFinite(maxDepth) ? maxDepth : Infinity
  const walk = (node, depth) => {
    const children = depth >= max ? [] : (node.children || []).map((c) => walk(c, depth + 1))
    return { ...node, children, cutOff: depth >= max && (node.children || []).length > 0 }
  }
  return (roots || []).map((root) => walk(root, 0))
}

/** How many levels deep the given roots actually go. */
export function depthOf(roots) {
  let deepest = 0
  const walk = (node, depth) => {
    deepest = Math.max(deepest, depth)
    for (const child of node.children || []) walk(child, depth + 1)
  }
  for (const root of roots || []) walk(root, 0)
  return deepest
}

/**
 * What a parent has that none of its children account for.
 *
 * On a funnel this is the whole point: 600 came in, 400 went one way and
 * 150 the other, and the 50 that went nowhere is the number somebody is
 * paid to care about. Every plate here draws it rather than leaving it to
 * be worked out by subtraction.
 */
export function unaccounted(node) {
  const children = node.children || []
  if (children.length === 0) return 0
  const claimed = children.reduce((sum, c) => sum + (c.value || 0), 0)
  return Math.max(0, (node.value || 0) - claimed)
}

// ---------------------------------------------------------------------
// Bands -- the Sankey
// ---------------------------------------------------------------------
/**
 * Every level as a column of bars, joined by bands as thick as the volume
 * flowing along them.
 *
 * Children are stacked inside their parent's own extent, in order, which is
 * what makes a tree's Sankey readable: no band ever crosses another, so
 * following one path from the left edge to a leaf is a straight read rather
 * than an untangling exercise. What that costs is the usual Sankey trick of
 * sorting each column independently -- and for a drill tree, where a node
 * only means anything under its parent, that trick was never worth having.
 *
 * One scale for the whole plate, shared across every tree on it, so two
 * trees side by side can be compared by eye. That is the entire reason
 * several trees share a canvas.
 */
export function sankeyLayout(roots, options = {}) {
  const {
    width = 900,
    height = 460,
    padding = 12,
    nodeWidth = 16,
    treeGap = 22,
    minBand = 1.5,
  } = options

  const list = roots || []
  if (list.length === 0) return { nodes: [], links: [], gaps: [], width, height, columns: 0 }

  const levels = depthOf(list)
  const columnStep = levels > 0 ? (width - padding * 2 - nodeWidth) / levels : 0

  const total = list.reduce((sum, r) => sum + (r.value || 0), 0)
  const usable = Math.max(1, height - padding * 2 - treeGap * Math.max(0, list.length - 1))
  const scale = total > EPSILON ? usable / total : 0

  const nodes = []
  const links = []
  const gaps = []

  let cursor = padding

  const place = (node, depth, top) => {
    const h = Math.max(minBand, (node.value || 0) * scale)
    const x = padding + depth * columnStep
    nodes.push({ node, key: nodeKey(node), depth, x, y: top, w: nodeWidth, h, value: node.value || 0 })

    let childTop = top
    for (const child of node.children || []) {
      const childH = Math.max(minBand, (child.value || 0) * scale)
      const childX = padding + (depth + 1) * columnStep
      links.push({
        key: `${nodeKey(node)}->${nodeKey(child)}`,
        node: child,
        parent: node,
        // The band leaves the parent at the same offset it occupies in the
        // next column, so it is a flat ribbon when nothing is lost above it
        // and visibly steps down when something is.
        d: bandPath(x + nodeWidth, childTop, childX, childTop, childH),
        thickness: childH,
        y: childTop,
      })
      place(child, depth + 1, childTop)
      childTop += childH
    }

    // The hole at the bottom of the parent's band: what came in and did not
    // go on anywhere. Drawn, not implied.
    const lost = unaccounted(node)
    if (lost > EPSILON && (node.children || []).length > 0) {
      gaps.push({
        key: `${nodeKey(node)}!lost`,
        node,
        x: x + nodeWidth,
        y: childTop,
        w: Math.max(0, columnStep - nodeWidth),
        h: Math.max(minBand, lost * scale),
        value: lost,
        share: node.value ? lost / node.value : 0,
      })
    }
  }

  for (const root of list) {
    place(root, 0, cursor)
    cursor += Math.max(minBand, (root.value || 0) * scale) + treeGap
  }

  return { nodes, links, gaps, width, height, columns: levels + 1, scale }
}

/** A ribbon from one edge to another: two beziers and a straight end. */
function bandPath(x1, y1, x2, y2, thickness) {
  const cx = (x1 + x2) / 2
  return [
    `M ${x1} ${y1}`,
    `C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`,
    `L ${x2} ${y2 + thickness}`,
    `C ${cx} ${y2 + thickness}, ${cx} ${y1 + thickness}, ${x1} ${y1 + thickness}`,
    'Z',
  ].join(' ')
}

// ---------------------------------------------------------------------
// Icicle
// ---------------------------------------------------------------------
/**
 * Every level as a solid column, each node's extent proportional to its
 * value inside its parent's.
 *
 * The densest of the four and the one to reach for when a tree is wide:
 * there is no whitespace between siblings to spend, so two hundred branches
 * still fit. A parent whose children do not add up leaves a real gap at the
 * end of its run, which is the drop-off, in the same place your eye is
 * already looking.
 *
 * `orientation: 'horizontal'` puts depth on the x axis (labels read
 * normally, which matters when branch names are long); vertical stacks
 * depth downward and fits more levels on a wide card.
 */
export function icicleLayout(roots, options = {}) {
  const { width = 900, height = 460, padding = 8, orientation = 'horizontal', gap = 1 } = options

  const list = roots || []
  if (list.length === 0) return { nodes: [], width, height, columns: 0 }

  const levels = depthOf(list)
  const across = orientation === 'horizontal' ? width - padding * 2 : height - padding * 2
  const along = orientation === 'horizontal' ? height - padding * 2 : width - padding * 2
  const step = levels >= 0 ? across / (levels + 1) : across

  const total = list.reduce((sum, r) => sum + (r.value || 0), 0)
  const scale = total > EPSILON ? along / total : 0

  const nodes = []

  const place = (node, depth, offset) => {
    const size = Math.max(0, (node.value || 0) * scale)
    const main = padding + depth * step
    const cross = padding + offset

    nodes.push({
      node,
      key: nodeKey(node),
      depth,
      x: orientation === 'horizontal' ? main : cross,
      y: orientation === 'horizontal' ? cross : main,
      w: orientation === 'horizontal' ? Math.max(0, step - gap) : Math.max(0, size - gap),
      h: orientation === 'horizontal' ? Math.max(0, size - gap) : Math.max(0, step - gap),
      value: node.value || 0,
    })

    let childOffset = offset
    for (const child of node.children || []) {
      place(child, depth + 1, childOffset)
      childOffset += Math.max(0, (child.value || 0) * scale)
    }
  }

  let cursor = 0
  for (const root of list) {
    place(root, 0, cursor)
    cursor += Math.max(0, (root.value || 0) * scale)
  }

  return { nodes, width, height, columns: levels + 1, orientation, scale }
}

// ---------------------------------------------------------------------
// Sunburst
// ---------------------------------------------------------------------
/**
 * The icicle wrapped into a circle.
 *
 * Depth reads as distance from the middle, which is the one layout that
 * makes a deep, narrow tree look small rather than long -- five levels fit
 * in a square card where an icicle would have run off the edge. Arcs are
 * returned as ready-made path strings so the renderer stays dumb.
 */
export function sunburstLayout(roots, options = {}) {
  const { width = 460, height = 460, padding = 8, innerRadius = 26 } = options

  const list = roots || []
  const cx = width / 2
  const cy = height / 2
  if (list.length === 0) return { nodes: [], width, height, cx, cy }

  const levels = depthOf(list)
  const outer = Math.max(10, Math.min(width, height) / 2 - padding)
  const ring = (outer - innerRadius) / (levels + 1)

  const total = list.reduce((sum, r) => sum + (r.value || 0), 0)
  const scale = total > EPSILON ? (Math.PI * 2) / total : 0

  const nodes = []

  const place = (node, depth, startAngle) => {
    const angle = Math.max(0, (node.value || 0) * scale)
    const r0 = innerRadius + depth * ring
    const r1 = r0 + ring

    nodes.push({
      node,
      key: nodeKey(node),
      depth,
      startAngle,
      endAngle: startAngle + angle,
      innerRadius: r0,
      outerRadius: r1,
      d: arcPath(cx, cy, r0, r1, startAngle, startAngle + angle),
      // Where a label would sit, if there is room for one.
      labelAngle: startAngle + angle / 2,
      labelRadius: (r0 + r1) / 2,
      value: node.value || 0,
    })

    let childStart = startAngle
    for (const child of node.children || []) {
      place(child, depth + 1, childStart)
      childStart += Math.max(0, (child.value || 0) * scale)
    }
  }

  let cursor = -Math.PI / 2 // twelve o'clock, the way a person reads a dial
  for (const root of list) {
    place(root, 0, cursor)
    cursor += Math.max(0, (root.value || 0) * scale)
  }

  return { nodes, width, height, cx, cy, innerRadius, ring, scale }
}

function arcPath(cx, cy, r0, r1, a0, a1) {
  const span = a1 - a0
  if (span <= EPSILON) return ''

  // A full circle cannot be drawn as one arc -- start and end would be the
  // same point -- so it is drawn as two halves.
  if (span >= Math.PI * 2 - EPSILON) {
    const half = (p) => `M ${cx + p} ${cy} A ${p} ${p} 0 1 1 ${cx - p} ${cy} A ${p} ${p} 0 1 1 ${cx + p} ${cy}`
    return `${half(r1)} ${half(r0)}`
  }

  const large = span > Math.PI ? 1 : 0
  const p = (r, a) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`
  return [
    `M ${p(r0, a0)}`,
    `L ${p(r1, a0)}`,
    `A ${r1} ${r1} 0 ${large} 1 ${p(r1, a1)}`,
    `L ${p(r0, a1)}`,
    `A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)}`,
    'Z',
  ].join(' ')
}

// ---------------------------------------------------------------------
// Treemap
// ---------------------------------------------------------------------
/**
 * Area against area: the layout for comparing leaves rather than following
 * paths.
 *
 * Squarified, so the rectangles come out as close to square as the numbers
 * allow. The naive slice-and-dice alternative produces slivers, and a
 * sliver is a rectangle whose area nobody can judge -- which defeats the
 * only thing a treemap is for.
 *
 * Nested: each parent keeps a header strip with its name, and its children
 * are laid out inside what is left. A flat treemap of leaves loses the
 * hierarchy, and the hierarchy is the flow.
 */
export function treemapLayout(roots, options = {}) {
  const { width = 900, height = 460, padding = 4, headerHeight = 15, minSide = 6 } = options

  const list = roots || []
  if (list.length === 0) return { nodes: [], width, height }

  const nodes = []

  const place = (items, rect, depth) => {
    const total = items.reduce((sum, n) => sum + Math.max(0, n.value || 0), 0)
    if (total <= EPSILON || rect.w <= 0 || rect.h <= 0) return

    for (const { node, box } of squarify(items, rect, total)) {
      nodes.push({ node, key: nodeKey(node), depth, x: box.x, y: box.y, w: box.w, h: box.h, value: node.value || 0 })

      const children = node.children || []
      if (children.length === 0) continue

      // Room for a header and a margin, or the nesting is unreadable and
      // the child rectangles are lies about their own size.
      const inner = {
        x: box.x + padding,
        y: box.y + headerHeight,
        w: box.w - padding * 2,
        h: box.h - headerHeight - padding,
      }
      if (inner.w > minSide && inner.h > minSide) place(children, inner, depth + 1)
    }
  }

  place(list, { x: 0, y: 0, w: width, h: height }, 0)
  return { nodes, width, height }
}

/**
 * Squarified treemap, the Bruls/Huizing/van Wijk method.
 *
 * Fills the shorter side of what is left, keeping a running row and closing
 * it the moment adding one more would make its worst aspect ratio worse.
 */
function squarify(items, rect, total) {
  const sorted = [...items].sort((a, b) => (b.value || 0) - (a.value || 0))
  const out = []

  let free = { ...rect }
  let scale = total > EPSILON ? (free.w * free.h) / total : 0
  let row = []
  let rowValue = 0

  const worst = (list, side, sum) => {
    if (side <= EPSILON || sum <= EPSILON) return Infinity
    const areaSum = sum * scale
    const thickness = areaSum / side
    let bad = 0
    for (const item of list) {
      const area = Math.max(EPSILON, (item.value || 0) * scale)
      const length = area / thickness
      bad = Math.max(bad, Math.max(thickness / length, length / thickness))
    }
    return bad
  }

  const flushRow = () => {
    if (row.length === 0) return
    const horizontal = free.w >= free.h
    const side = horizontal ? free.h : free.w
    const thickness = side > EPSILON ? (rowValue * scale) / side : 0

    let along = 0
    for (const item of row) {
      const area = Math.max(0, (item.value || 0) * scale)
      const length = thickness > EPSILON ? area / thickness : 0
      out.push({
        node: item,
        box: horizontal
          ? { x: free.x, y: free.y + along, w: thickness, h: length }
          : { x: free.x + along, y: free.y, w: length, h: thickness },
      })
      along += length
    }

    if (horizontal) free = { x: free.x + thickness, y: free.y, w: free.w - thickness, h: free.h }
    else free = { x: free.x, y: free.y + thickness, w: free.w, h: free.h - thickness }

    row = []
    rowValue = 0
  }

  for (const item of sorted) {
    const value = Math.max(0, item.value || 0)
    if (value <= EPSILON) continue

    const side = free.w >= free.h ? free.h : free.w
    if (row.length === 0 || worst([...row, item], side, rowValue + value) <= worst(row, side, rowValue)) {
      row.push(item)
      rowValue += value
    } else {
      flushRow()
      // A flushed row changes what is left, so the scale it is measured
      // against changes with it.
      scale = free.w * free.h > EPSILON ? (free.w * free.h) / remaining(sorted, out) : scale
      row = [item]
      rowValue = value
    }
  }
  flushRow()

  return out
}

/** The value still to be placed, for rescaling after a row is closed. */
function remaining(items, placed) {
  const done = new Set(placed.map((p) => p.node))
  return items.reduce((sum, item) => (done.has(item) ? sum : sum + Math.max(0, item.value || 0)), 0) || EPSILON
}

// ---------------------------------------------------------------------
// One way in
// ---------------------------------------------------------------------
export const FLOW_MAP_PLATES = [
  { value: 'bands', label: 'Bands', hint: 'Volume flowing left to right, with what was lost drawn as a gap' },
  { value: 'icicle', label: 'Icicle', hint: 'Every level as a solid column — the densest, for a wide tree' },
  { value: 'treemap', label: 'Treemap', hint: 'Area against area, for comparing leaves' },
  { value: 'sunburst', label: 'Sunburst', hint: 'Depth as distance from the middle, for a deep tree' },
]

export function flowMapLayout(plate, roots, options = {}) {
  switch (plate) {
    case 'icicle':
      return icicleLayout(roots, options)
    case 'treemap':
      return treemapLayout(roots, options)
    case 'sunburst':
      return sunburstLayout(roots, options)
    default:
      return sankeyLayout(roots, options)
  }
}
