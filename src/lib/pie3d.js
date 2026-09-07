// ---------------------------------------------------------------------
// A pie with thickness
// ---------------------------------------------------------------------
// The extruded pie off a printed infographic: a circle tilted away from
// the reader, given a side wall, so it sits on the page like an object
// rather than a diagram.
//
// It is worth saying plainly what this costs, because it is the one chart
// in this app that is harder to read than the flat version of itself:
//
//   TILTING DISTORTS THE ANGLES. A slice at the front subtends more screen
//   area than the same slice at the back, so a 20% wedge near the reader
//   looks bigger than a 20% wedge behind. The eye is comparing an ellipse
//   as though it were a circle, and it is not.
//
//   THE WALL ADDS AREA THAT MEANS NOTHING. The front slices get a visible
//   side; the back ones do not. That is more ink for the same number.
//
// Which is why the flat pie stays the default and this is a look somebody
// chooses -- and why the component that draws it always labels the slices.
// A chart whose angles cannot be trusted must not be the only place the
// number appears.
//
// Everything here is geometry: an ellipse, some arcs, and the order to
// paint them in. Nothing draws, and nothing knows what a slice means.

/** The projection, and how thick the pie is. */
export const PIE3D_DEFAULTS = {
  // How far the circle is tilted away, as the ratio of the drawn height to
  // its width. 1 is face-on (and pointless); below about 0.35 the pie is a
  // stripe and the slices cannot be told apart.
  tilt: 0.55,
  // The side wall, in pixels of the drawn size.
  depth: 26,
  // A hole, as a fraction of the radius. 0 is a solid pie.
  hole: 0,
}

export const TILT_MIN = 0.35
export const TILT_MAX = 0.9
export const DEPTH_MIN = 0
export const DEPTH_MAX = 80

const TAU = Math.PI * 2

const clamp = (n, lo, hi, fallback) => {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.max(lo, Math.min(hi, v))
}

/** Where an angle lands on the projected circle. */
export function ellipsePoint(cx, cy, rx, ry, angle) {
  return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) }
}

/**
 * The angles, normalised so 0 is three o'clock and they increase DOWNWARD
 * through the front of the pie.
 *
 * Which means the front half is simply `0..PI` -- and the front half is the
 * only part with a side wall anybody can see. Getting this convention wrong
 * is how a 3D pie ends up with its wall on the wrong side, which reads as a
 * bowl rather than as a disc.
 */
export const FRONT_START = 0
export const FRONT_END = Math.PI

/**
 * The part of `[a, b]` that faces the reader, as zero, one or two ranges.
 *
 * Two, because a slice can begin behind the pie, come round the right-hand
 * edge and go behind again -- and the wall it shows is then in two pieces
 * with the back of the pie between them.
 */
export function frontRanges(a, b) {
  const out = []
  // Walk the slice in whole turns so a range that wraps is handled by the
  // same arithmetic as one that does not.
  for (let turn = -1; turn <= 1; turn += 1) {
    const from = Math.max(a + turn * TAU, FRONT_START)
    const to = Math.min(b + turn * TAU, FRONT_END)
    if (to - from > 1e-9) out.push([from, to])
  }
  return out
}

/** An SVG arc along the projected circle, from one angle to another. */
export function arcTo(cx, cy, rx, ry, from, to) {
  const end = ellipsePoint(cx, cy, rx, ry, to)
  const large = Math.abs(to - from) > Math.PI ? 1 : 0
  const sweep = to > from ? 1 : 0
  return `A ${rx} ${ry} 0 ${large} ${sweep} ${end.x} ${end.y}`
}

/** The flat top of one slice: a wedge, or a band when there is a hole. */
export function topPath(cx, cy, rx, ry, from, to, holeRatio = 0) {
  const outer = ellipsePoint(cx, cy, rx, ry, from)
  if (!(holeRatio > 0)) {
    return `M ${cx} ${cy} L ${outer.x} ${outer.y} ${arcTo(cx, cy, rx, ry, from, to)} Z`
  }
  const ix = rx * holeRatio
  const iy = ry * holeRatio
  const innerEnd = ellipsePoint(cx, cy, ix, iy, to)
  return [
    `M ${outer.x} ${outer.y}`,
    arcTo(cx, cy, rx, ry, from, to),
    `L ${innerEnd.x} ${innerEnd.y}`,
    arcTo(cx, cy, ix, iy, to, from),
    'Z',
  ].join(' ')
}

/**
 * The side wall under one stretch of arc.
 *
 * Down from the front edge, along the bottom, and back up -- so the shape
 * is the band swept by the arc as it drops by `depth`.
 */
export function wallPath(cx, cy, rx, ry, from, to, depth) {
  const start = ellipsePoint(cx, cy, rx, ry, from)
  const end = ellipsePoint(cx, cy, rx, ry, to)
  return [
    `M ${start.x} ${start.y}`,
    arcTo(cx, cy, rx, ry, from, to),
    `L ${end.x} ${end.y + depth}`,
    arcTo(cx, cy + depth, rx, ry, to, from),
    'Z',
  ].join(' ')
}

/**
 * Every piece of a 3D pie, in the order they must be painted.
 *
 * SVG has no depth buffer: what is drawn last is what is on top. So the
 * order IS the three-dimensionality, and it is the whole difficulty here.
 * Three passes, and each is a different question:
 *
 *   THE INSIDE OF THE RING, at the back. Only a donut has one, and it is
 *   the furthest thing away.
 *
 *   THE OUTER WALL, front half only -- the back half is behind the top and
 *   would draw straight through it. Sorted by how far from the front each
 *   piece is, so a wall nearer the reader covers the one behind it where
 *   they meet.
 *
 *   THE TOP FACES, last and in any order. They tile the ellipse without
 *   overlapping, so nothing there can fight.
 *
 * `slices` is `[{ name, value }]` -- whatever the caller already has. The
 * ANGLES come from the values, so a slice's share is its angle exactly as
 * on a flat pie; the distortion is in the projection, not in the maths.
 */
export function pie3dGeometry(slices, { size = 260, tilt, depth, hole, start = -Math.PI / 2 } = {}) {
  const list = (slices || []).filter((s) => Number(s?.value) > 0)
  const total = list.reduce((sum, s) => sum + Number(s.value), 0)
  const t = clamp(tilt, TILT_MIN, TILT_MAX, PIE3D_DEFAULTS.tilt)
  const d = clamp(depth, DEPTH_MIN, DEPTH_MAX, PIE3D_DEFAULTS.depth)
  const holeRatio = clamp(hole, 0, 0.85, PIE3D_DEFAULTS.hole)

  const box = Math.max(40, Number(size) || 260)
  const rx = box / 2 - 2
  const ry = rx * t
  const cx = box / 2
  // Centred on what is DRAWN, wall included, or a deep pie sits low in its
  // box with a band of nothing above it.
  const cy = (box - (ry * 2 + d)) / 2 + ry

  if (total <= 0) return { width: box, height: box, cx, cy, rx, ry, depth: d, hole: holeRatio, pieces: [], tops: [] }

  const walls = []
  const innerWalls = []
  const tops = []
  let angle = start

  list.forEach((slice, index) => {
    const span = (Number(slice.value) / total) * TAU
    const from = angle
    const to = angle + span
    angle = to

    tops.push({
      id: `${slice.name}-${index}`,
      name: slice.name,
      value: Number(slice.value),
      index,
      d: topPath(cx, cy, rx, ry, from, to, holeRatio),
    })

    for (const [a, b] of frontRanges(from, to)) {
      walls.push({
        id: `${slice.name}-${index}-w${walls.length}`,
        name: slice.name,
        index,
        // How near the front this piece comes. The front of the pie is at
        // a quarter turn, so a piece straddling it is the nearest of all.
        near: a <= Math.PI / 2 && b >= Math.PI / 2 ? 0 : Math.min(Math.abs(a - Math.PI / 2), Math.abs(b - Math.PI / 2)),
        d: wallPath(cx, cy, rx, ry, a, b, d),
      })
    }

    // The inside of a ring shows on the BACK half -- you are looking across
    // the hole at the far wall.
    if (holeRatio > 0) {
      for (const [a, b] of frontRanges(from + Math.PI, to + Math.PI)) {
        innerWalls.push({
          id: `${slice.name}-${index}-i${innerWalls.length}`,
          name: slice.name,
          index,
          d: wallPath(cx, cy, rx * holeRatio, ry * holeRatio, a, b, d),
        })
      }
    }
  })

  // Furthest first. A wall nearer the reader is painted over the one behind
  // it, which is what makes the join between two slices read as a corner
  // rather than as a seam.
  walls.sort((a, b) => b.near - a.near)

  return {
    width: box,
    height: box,
    cx,
    cy,
    rx,
    ry,
    depth: d,
    hole: holeRatio,
    // In paint order: inside of the ring, then the outer wall, then tops.
    pieces: [...innerWalls, ...walls],
    tops,
  }
}

/**
 * A wall's colour: the slice's own, darkened.
 *
 * A side lit the same as the top is not a side -- it reads as a flat shape
 * with a lump on it. Darkening is what says "this surface faces down".
 */
export function shade(hex, amount = 0.72) {
  const s = String(hex || '').trim()
  const m = /^#([0-9a-f]{6})$/i.exec(s) || /^#([0-9a-f]{3})$/i.exec(s)
  if (!m) return s
  const full = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  const k = Math.max(0, Math.min(1, amount))
  return `#${rgb.map((c) => Math.round(c * k).toString(16).padStart(2, '0')).join('')}`
}
