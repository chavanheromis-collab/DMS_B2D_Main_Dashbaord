// ---------------------------------------------------------------------
// Bar shapes that are not rectangles
// ---------------------------------------------------------------------
// A rectangle is the honest default: length is the only thing the eye has to
// compare, and it compares it well. These shapes trade a little of that
// precision for a strong read at a glance, which is the right trade on a
// wall-mounted report that nobody walks up to.
//
// Both keep the ONE property that matters: total length still encodes the
// value, from baseline to tip. An arrow whose head grew with the value, or a
// cylinder whose cap was drawn outside its own extent, would be decoration
// pretending to be a measurement.
//
// Pure geometry so the paths can be tested: SVG path strings in, no React.

/**
 * An upward arrow occupying the same box a bar would.
 *
 * The head is capped at a fraction of the length as well as the width, so a
 * short bar becomes a stubby arrow rather than a head with no shaft -- which
 * would read as a bigger value than its neighbour twice its size.
 */
export function arrowUpPath(x, y, width, height, { headRatio = 0.34, shaftRatio = 0.52 } = {}) {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const head = Math.min(h * headRatio, w * 0.75)
  const shaft = w * shaftRatio
  const left = x + (w - shaft) / 2
  const right = left + shaft
  const base = y + h
  const neck = y + head

  return [
    `M ${left} ${base}`,
    `L ${left} ${neck}`,
    `L ${x} ${neck}`,
    `L ${x + w / 2} ${y}`,
    `L ${x + w} ${neck}`,
    `L ${right} ${neck}`,
    `L ${right} ${base}`,
    'Z',
  ].join(' ')
}

/** The same arrow, pointing right -- for a horizontal bar. */
export function arrowRightPath(x, y, width, height, { headRatio = 0.34, shaftRatio = 0.52 } = {}) {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const head = Math.min(w * headRatio, h * 0.75)
  const shaft = h * shaftRatio
  const top = y + (h - shaft) / 2
  const bottom = top + shaft
  const tip = x + w
  const neck = tip - head

  return [
    `M ${x} ${top}`,
    `L ${neck} ${top}`,
    `L ${neck} ${y}`,
    `L ${tip} ${y + h / 2}`,
    `L ${neck} ${y + h}`,
    `L ${neck} ${bottom}`,
    `L ${x} ${bottom}`,
    'Z',
  ].join(' ')
}

/**
 * The body of a cylinder: the rectangle between its two caps.
 *
 * `ry` is the ellipse's vertical radius, derived from the width so a narrow
 * bar gets a shallow cap rather than a circle. Capped in absolute terms too,
 * because a very wide bar with a proportional cap stops looking like a
 * cylinder and starts looking like a drum.
 */
export function cylinderCapRadius(width, { ratio = 0.16, max = 14 } = {}) {
  return Math.max(2, Math.min(max, Math.max(1, width) * ratio))
}

/**
 * Circles sized so their AREA is proportional to the value, sharing a bottom
 * tangent -- the nested-proportion picture.
 *
 * Area, not radius: doubling a radius quadruples the ink, and a reader who
 * judges by ink would read a doubled value as four times bigger. That is the
 * single most common way a bubble chart lies.
 */
export function nestedCircles(data, { width, height, padding = 8, minRadius = 6 } = {}) {
  const rows = (data || []).filter((d) => Number(d?.value) > 0)
  if (rows.length === 0 || !width || !height) return []

  const sorted = [...rows].sort((a, b) => Number(b.value) - Number(a.value))
  const biggest = Number(sorted[0].value)
  const maxR = Math.max(minRadius, Math.min(width, height) / 2 - padding)
  const cx = width / 2
  const floor = height - padding

  return sorted.map((row, i) => {
    const r = Math.max(minRadius, maxR * Math.sqrt(Number(row.value) / biggest))
    return {
      ...row,
      index: i,
      r,
      cx,
      cy: floor - r,
      // Where a label sits without covering the ring inside it: just under
      // this circle's own top edge.
      labelY: floor - 2 * r + 14,
    }
  })
}
