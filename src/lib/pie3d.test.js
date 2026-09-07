import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  DEPTH_MAX,
  PIE3D_DEFAULTS,
  TILT_MAX,
  TILT_MIN,
  ellipsePoint,
  frontRanges,
  pie3dGeometry,
  shade,
} from './pie3d.js'
import { CHART_TYPES, isPieChart } from './config.js'

const SRC = path.resolve(import.meta.dirname, '..')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')

const SLICES = [
  { name: 'A', value: 40 },
  { name: 'B', value: 30 },
  { name: 'C', value: 20 },
  { name: 'D', value: 10 },
]

// --- the projection -------------------------------------------------------

test('the circle is squashed, not shrunk', () => {
  // A tilt scales the HEIGHT and leaves the width alone. Scaling both is
  // not a tilt, it is a smaller pie.
  const geo = pie3dGeometry(SLICES, { size: 260, tilt: 0.5 })
  assert.equal(geo.rx, 128)
  assert.equal(geo.ry, 64)
})

test('a tilt nobody could have meant is brought back', () => {
  // Face-on is a flat pie drawn the slow way; below about a third the pie
  // is a stripe and the slices cannot be told apart.
  assert.equal(pie3dGeometry(SLICES, { size: 200, tilt: 9 }).ry / pie3dGeometry(SLICES, { size: 200 }).rx, TILT_MAX)
  assert.equal(pie3dGeometry(SLICES, { size: 200, tilt: 0.01 }).ry / pie3dGeometry(SLICES, { size: 200 }).rx, TILT_MIN)
  const fallback = pie3dGeometry(SLICES, { size: 200, tilt: 'flat' })
  assert.equal(fallback.ry / fallback.rx, PIE3D_DEFAULTS.tilt)
})

test('the drawing is centred on everything drawn, wall included', () => {
  // Centred on the ellipse alone, a deep pie sits low in its box with a
  // band of nothing above it.
  const shallow = pie3dGeometry(SLICES, { size: 260, depth: 0 })
  const deep = pie3dGeometry(SLICES, { size: 260, depth: 60 })
  assert.ok(deep.cy < shallow.cy, 'a deeper pie is not lifted to make room for its wall')
  assert.ok(deep.cy - deep.ry > 0, 'the top of the pie is off the canvas')
  assert.ok(deep.cy + deep.ry + deep.depth <= deep.height + 1, 'the wall runs off the bottom')
})

test('a point on the ellipse is where the angles say it is', () => {
  const p = ellipsePoint(100, 100, 50, 25, 0)
  assert.deepEqual(p, { x: 150, y: 100 }, 'three o’clock is not to the right')
  const bottom = ellipsePoint(100, 100, 50, 25, Math.PI / 2)
  assert.ok(Math.abs(bottom.x - 100) < 1e-9)
  assert.equal(Math.round(bottom.y), 125, 'a quarter turn is not the front of the pie')
})

// --- which side has a wall ------------------------------------------------

test('only the half facing the reader has a wall', () => {
  // A wall on the back half draws straight through the top of the pie, and
  // the result reads as a bowl.
  assert.deepEqual(frontRanges(0, Math.PI), [[0, Math.PI]])
  assert.deepEqual(frontRanges(Math.PI, Math.PI * 2), [])
  const half = frontRanges(Math.PI / 2, Math.PI * 1.5)
  assert.equal(half.length, 1)
  assert.deepEqual(half[0].map((n) => Number(n.toFixed(4))), [Number((Math.PI / 2).toFixed(4)), Number(Math.PI.toFixed(4))])
})

test('a slice that goes round the edge shows its wall in two pieces', () => {
  // A big slice that starts in the front, goes round the back and comes
  // out in the front again: the wall is what is left, on both sides of the
  // gap where the other slices are.
  const ranges = frontRanges(2, 7.5)
  assert.equal(ranges.length, 2, 'the wall is drawn as one piece across the gap')
  // Both inside the front half, and neither touching the other.
  for (const [a, b] of ranges) {
    assert.ok(a >= 0 && b <= Math.PI + 1e-9, `${a}..${b} is behind the pie`)
  }
  assert.ok(ranges[0][1] < ranges[1][0], 'the two pieces overlap')

  // And a slice that covers the whole front is ONE piece, not two.
  assert.equal(frontRanges(-0.4, Math.PI * 2 - 0.4).length, 1)
})

test('a whole-circle slice still only walls its front', () => {
  const [only] = frontRanges(0, Math.PI * 2)
  assert.deepEqual(only, [0, Math.PI])
})

// --- the pieces, and the order they are painted in ------------------------

test('every slice gets a top, and only the front ones a wall', () => {
  const geo = pie3dGeometry(SLICES, { size: 260 })
  assert.equal(geo.tops.length, SLICES.length)
  assert.ok(geo.pieces.length > 0 && geo.pieces.length < SLICES.length * 2)
  for (const top of geo.tops) assert.ok(top.d.startsWith('M '), 'a top with no path')
})

test('the nearest wall is painted last, so a corner reads as a corner', () => {
  // SVG has no depth buffer: the order IS the three-dimensionality. Painted
  // the other way round, the wall behind covers the one in front and the
  // join between two slices becomes a seam.
  const geo = pie3dGeometry(SLICES, { size: 260 })
  const walls = geo.pieces.filter((p) => p.near !== undefined)
  const nears = walls.map((w) => w.near)
  assert.deepEqual(nears, [...nears].sort((a, b) => b - a), 'the walls are painted in no particular order')
})

test('a donut shows the inside of its ring, behind everything', () => {
  const solid = pie3dGeometry(SLICES, { size: 260, hole: 0 })
  const ring = pie3dGeometry(SLICES, { size: 260, hole: 0.5 })
  assert.ok(ring.pieces.length > solid.pieces.length, 'the inside of the ring is never drawn')
  // First, because it is the furthest thing away.
  assert.equal(ring.pieces[0].near, undefined, 'the inner wall is painted over the outer one')
  // And the top is a band rather than a wedge: no line to the centre.
  assert.ok(!ring.tops[0].d.startsWith(`M ${ring.cx} ${ring.cy}`), 'a donut is drawn as a solid pie')
  assert.ok(solid.tops[0].d.startsWith(`M ${solid.cx} ${solid.cy}`), 'a pie is drawn with a hole')
})

test('the angles are the values, however it is projected', () => {
  // The distortion is in the projection, not in the arithmetic: a 40% slice
  // is 40% of the turn whatever the tilt.
  for (const tilt of [TILT_MIN, 0.55, TILT_MAX]) {
    const geo = pie3dGeometry([{ name: 'half', value: 1 }, { name: 'rest', value: 1 }], { size: 200, tilt })
    assert.equal(geo.tops.length, 2)
    assert.equal(geo.tops[0].value, 1)
  }
})

test('nothing to draw is nothing drawn, not a crash', () => {
  assert.deepEqual(pie3dGeometry([], { size: 200 }).tops, [])
  assert.deepEqual(pie3dGeometry(null).tops, [])
  assert.deepEqual(pie3dGeometry([{ name: 'z', value: 0 }]).tops, [])
  // And among real ones, where it would be a hairline seam across the pie
  // that nobody can click and nothing explains. The all-zero case above
  // leaves early, so it proves nothing about this on its own.
  const mixed = pie3dGeometry([{ name: 'A', value: 40 }, { name: 'z', value: 0 }, { name: 'B', value: 60 }])
  assert.deepEqual(mixed.tops.map((t) => t.name), ['A', 'B'], 'a slice worth nothing is drawn anyway')
  assert.deepEqual(pie3dGeometry([{ name: 'x', value: -5 }]).tops, [])
})

test('a hand-edited depth cannot bury the pie', () => {
  assert.equal(pie3dGeometry(SLICES, { size: 200, depth: 9999 }).depth, DEPTH_MAX)
  assert.equal(pie3dGeometry(SLICES, { size: 200, depth: -20 }).depth, 0)
  assert.equal(pie3dGeometry(SLICES, { size: 200, depth: 'thick' }).depth, PIE3D_DEFAULTS.depth)
})

// --- the light ------------------------------------------------------------

test('the wall is darker than the top, because it faces down', () => {
  // A side lit the same as the top is not a side: it reads as a flat shape
  // with a lump on it.
  assert.equal(shade('#4F46E5'), '#3932a5')
  assert.equal(shade('#FFFFFF', 0.5), '#808080')
  // Three-digit hex is a colour too.
  assert.equal(shade('#fff', 1), '#ffffff')
  // Anything it cannot read is passed through rather than turned to black.
  assert.equal(shade('rgb(1,2,3)'), 'rgb(1,2,3)')
  assert.equal(shade(null), '')
})

// --- the wiring -----------------------------------------------------------

test('both 3D pies are offered, and treated as pies everywhere', () => {
  const named = CHART_TYPES.map((t) => t.value)
  assert.ok(named.includes('pie3d') && named.includes('donut3d'), 'they are not on the menu')
  for (const type of ['pie', 'donut', 'rose', 'pie3d', 'donut3d']) {
    assert.equal(isPieChart(type), true, type)
  }
  assert.equal(isPieChart('bar'), false)

  // One list. There were four -- the widget, and three places in the editor
  // deciding which settings to offer -- and adding a type to one of them is
  // how a chart ends up offered an axis label it has no axis for.
  const panel = read('pages/admin/WidgetsPanel.jsx')
  assert.ok(!panel.includes("['pie', 'donut', 'rose']"), 'the editor keeps its own copy of the list')
  assert.ok(read('components/widgets/ChartWidget.jsx').includes('new Set(PIE_CHART_TYPES)'))
})

test('the slices, the roll-up and the legend are the pie’s own', () => {
  // Only the DRAWING is different. A second implementation of "which
  // slices, and what goes in Other" would drift from the flat pie's.
  const pie = read('components/widgets/PiePanel.jsx')
  assert.ok(pie.includes('const is3d ='), 'the panel cannot tell it is drawing one')
  assert.ok(pie.includes('{is3d ? ('), 'the 3D pie is drawn somewhere else entirely')
  assert.ok(pie.includes('slices={slices}'), 'it works out its own slices')
  assert.ok(pie.includes('onPick={onDrill ? drill : undefined}'), 'a 3D slice cannot be drilled')
})

test('a distorted pie always says its numbers', () => {
  // The one thing that has to be true of it: the angles cannot be trusted,
  // so the figure must be somewhere the eye does not have to estimate it.
  const pie = read('components/widgets/PiePanel.jsx')
  const at = pie.indexOf('function Pie3D(')
  const body = pie.slice(at, pie.indexOf('export default function PiePanel'))
  assert.ok(body.includes('Math.round(share * 100)'), 'the slices are unlabelled')
  // And the admin is told, where the choice is made.
  const panel = read('pages/admin/WidgetsPanel.jsx')
  assert.match(panel, /distorts its angles/, 'nothing warns what a tilt costs')
})
