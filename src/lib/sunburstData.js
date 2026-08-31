// ---------------------------------------------------------------------
// A hierarchy drawn as rings
// ---------------------------------------------------------------------
// Region, then branch, then model. A treemap answers "which is biggest" in
// one glance and loses the levels; a pivot keeps the levels and makes you
// read forty numbers. A sunburst keeps both: the ring says which level, the
// sweep says how much, and a wedge is always exactly as wide as its
// children add up to.
//
// The nesting is `pivotTree`'s -- the same function the pivot table uses,
// already sorted at every level, already bucketed, already measure-aware.
// Rebuilding it here would be a second hierarchy to disagree with the first.
// All this file does is turn a tree into angles.
//
// Pure: a tree in, arcs out. No React, no SVG.

/** How deep a sunburst is worth drawing. */
export const MAX_RINGS = 4

export const DEFAULT_RINGS = 3

/**
 * The smallest wedge worth drawing, as a fraction of the whole circle.
 *
 * Below about a third of a degree a wedge is a hairline that cannot be
 * hovered, cannot be labelled and cannot be told from the stroke beside it.
 * Drawing it anyway costs a DOM node and buys a smudge; leaving it out and
 * SAYING SO is the honest version, which is what `hidden` is for.
 */
export const MIN_SLICE = 0.001

/**
 * A tree, as flat arcs with angles.
 *
 * Each level divides its parent's sweep in proportion to value, so a child
 * can never be wider than its parent and the ring always closes. Angles are
 * in degrees clockwise from twelve o'clock, which is where a reader starts.
 *
 * Values are treated as magnitudes: a negative aggregation -- an average of
 * a column with credits in it -- has no sweep to give, and a wedge of
 * negative width is not a thing. They are skipped rather than flipped,
 * because a returned car is not "minus one car" of the circle.
 */
export function sunburstArcs(tree, { rings = DEFAULT_RINGS, minSlice = MIN_SLICE } = {}) {
  const depth = Math.max(1, Math.min(MAX_RINGS, Math.round(Number(rings) || DEFAULT_RINGS)))
  const arcs = []
  let hidden = 0

  const total = sumOf(tree)
  if (!(total > 0)) return { arcs, total: 0, hidden: 0, rings: depth }

  function walk(nodes, level, start, sweep, parentTotal, path) {
    if (level >= depth || !nodes || nodes.length === 0) return
    if (!(parentTotal > 0)) return

    let cursor = start
    for (const node of nodes) {
      const value = Number(node?.value)
      if (!Number.isFinite(value) || value <= 0) continue

      const share = value / parentTotal
      const width = sweep * share
      const label = node.label ?? ''
      const here = [...path, label]

      if (width / 360 < minSlice) {
        hidden += 1
        cursor += width
        continue
      }

      arcs.push({
        label,
        path: here,
        // The whole path, for a tooltip and for a drill: "West" on its own
        // is ambiguous once two regions have a branch of the same name.
        key: here.join(' › '),
        value,
        depth: level,
        startAngle: cursor,
        endAngle: cursor + width,
        // Of the WHOLE, not of the parent -- "4% of everything" is the
        // number somebody quotes, and the parent share is recoverable from
        // the wedge in front of them.
        share: value / total,
        parentShare: share,
      })

      walk(node.children, level + 1, cursor, width, value, here)
      cursor += width
    }
  }

  walk(tree, 0, 0, 360, total, [])
  return { arcs, total, hidden, rings: depth }
}

/** The top level's values added up, which is what the circle stands for. */
export function sumOf(nodes) {
  let total = 0
  for (const node of nodes || []) {
    const value = Number(node?.value)
    if (Number.isFinite(value) && value > 0) total += value
  }
  return total
}

/**
 * The radius band one ring occupies, as fractions of the outer radius.
 *
 * A hole in the middle, because the centre of a sunburst is where the total
 * goes -- and because the innermost ring is otherwise a disc whose angles
 * are unreadable at the point where they all meet.
 */
export function ringBand(depth, rings, { hole = 0.34 } = {}) {
  const count = Math.max(1, rings)
  const band = (1 - hole) / count
  const inner = hole + band * depth
  return { inner, outer: inner + band * 0.94 }
}

/**
 * An SVG path for one wedge.
 *
 * Written here rather than in the component because it is arithmetic, and
 * arithmetic that is wrong by a sign draws a chart that is subtly, silently
 * inside out.
 */
export function arcPath(arc, { rings, radius = 100, hole = 0.34 } = {}) {
  const band = ringBand(arc.depth, rings, { hole })
  const r0 = band.inner * radius
  const r1 = band.outer * radius

  // A full circle cannot be drawn as one arc -- the start and end points are
  // the same, and the renderer has no way to tell which way round to go.
  const sweep = arc.endAngle - arc.startAngle
  if (sweep >= 359.999) {
    return [
      `M 0 ${-r1}`,
      `A ${r1} ${r1} 0 1 1 0 ${r1}`,
      `A ${r1} ${r1} 0 1 1 0 ${-r1}`,
      `M 0 ${-r0}`,
      `A ${r0} ${r0} 0 1 0 0 ${r0}`,
      `A ${r0} ${r0} 0 1 0 0 ${-r0}`,
      'Z',
    ].join(' ')
  }

  const a0 = polar(arc.startAngle, r1)
  const a1 = polar(arc.endAngle, r1)
  const b1 = polar(arc.endAngle, r0)
  const b0 = polar(arc.startAngle, r0)
  const big = sweep > 180 ? 1 : 0

  return [
    `M ${a0.x} ${a0.y}`,
    `A ${r1} ${r1} 0 ${big} 1 ${a1.x} ${a1.y}`,
    `L ${b1.x} ${b1.y}`,
    `A ${r0} ${r0} 0 ${big} 0 ${b0.x} ${b0.y}`,
    'Z',
  ].join(' ')
}

/** Degrees clockwise from twelve o'clock, in SVG's y-down coordinates. */
export function polar(degrees, radius) {
  const rad = ((degrees - 90) * Math.PI) / 180
  return { x: round(Math.cos(rad) * radius), y: round(Math.sin(rad) * radius) }
}

const round = (n) => Math.round(n * 1000) / 1000

/**
 * Whether a wedge is wide enough to write in.
 *
 * A label that does not fit is not a label -- it is a word lying across
 * three other wedges. The threshold is in degrees rather than pixels
 * because the wedge's angle is what the text has to fit inside.
 */
export function fitsLabel(arc, { minDegrees = 14 } = {}) {
  return arc.endAngle - arc.startAngle >= minDegrees
}

/** The middle of a wedge, where a label sits. */
export function arcMid(arc, { rings, radius = 100, hole = 0.34 } = {}) {
  const band = ringBand(arc.depth, rings, { hole })
  const mid = (band.inner + band.outer) / 2
  return polar((arc.startAngle + arc.endAngle) / 2, mid * radius)
}
