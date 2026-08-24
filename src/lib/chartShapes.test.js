import test from 'node:test'
import assert from 'node:assert/strict'

import { arrowRightPath, arrowUpPath, cylinderCapRadius, nestedCircles } from './chartShapes.js'

const points = (d) =>
  d
    .split(/[ML]\s*/)
    .slice(1)
    .map((p) => p.replace('Z', '').trim().split(/\s+/).map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite))

// --- arrows ---------------------------------------------------------------

test('an arrow spans exactly the box a bar would', () => {
  // Length is the measurement. A shape that overshot its own extent would
  // read as a bigger number than it is.
  const p = points(arrowUpPath(10, 20, 40, 100))
  const xs = p.map((q) => q[0])
  const ys = p.map((q) => q[1])
  assert.equal(Math.min(...xs), 10)
  assert.equal(Math.max(...xs), 50)
  assert.equal(Math.min(...ys), 20, 'the tip is the top of the box')
  assert.equal(Math.max(...ys), 120, 'and the tail is the baseline')
})

test('the tip is centred over the shaft', () => {
  const p = points(arrowUpPath(0, 0, 40, 100))
  const tip = p.find((q) => q[1] === 0)
  assert.equal(tip[0], 20)
})

test('a short arrow keeps a shaft instead of becoming a lone head', () => {
  // Otherwise a small value draws a big triangle and outranks its taller
  // neighbour at a glance.
  const short = points(arrowUpPath(0, 0, 40, 10))
  const neck = Math.min(...short.filter((q) => q[1] > 0).map((q) => q[1]))
  assert.ok(neck < 10, 'the head cannot swallow the whole bar')
  assert.ok(neck > 0)
})

test('a horizontal arrow is the same idea on its side', () => {
  const p = points(arrowRightPath(5, 10, 100, 40))
  const xs = p.map((q) => q[0])
  const ys = p.map((q) => q[1])
  assert.equal(Math.min(...xs), 5)
  assert.equal(Math.max(...xs), 105, 'the tip is the end of the box')
  assert.equal(Math.min(...ys), 10)
  assert.equal(Math.max(...ys), 50)
  const tip = p.find((q) => q[0] === 105)
  assert.equal(tip[1], 30, 'and it points at the middle')
})

test('a zero-height bar still produces a drawable path', () => {
  assert.match(arrowUpPath(0, 0, 0, 0), /^M /)
  assert.match(arrowRightPath(0, 0, 0, 0), /^M /)
})

// --- cylinders ------------------------------------------------------------

test('a cap is shallow on a narrow bar and never a drum on a wide one', () => {
  assert.ok(cylinderCapRadius(20) < cylinderCapRadius(60))
  assert.equal(cylinderCapRadius(1000), 14, 'capped in absolute terms')
  assert.ok(cylinderCapRadius(1) >= 2, 'and never invisible')
})

// --- nested circles -------------------------------------------------------

const DATA = [{ name: 'A', value: 100 }, { name: 'B', value: 25 }, { name: 'C', value: 400 }]

test('circles are sized by area, not by radius', () => {
  // Doubling a radius quadruples the ink. A reader judging by ink would read
  // a doubled value as four times bigger -- the classic bubble-chart lie.
  const out = nestedCircles(DATA, { width: 200, height: 200, padding: 0 })
  const [big, mid, small] = out
  assert.equal(big.name, 'C')
  assert.equal((mid.r / big.r).toFixed(3), Math.sqrt(100 / 400).toFixed(3))
  assert.equal((small.r / big.r).toFixed(3), Math.sqrt(25 / 400).toFixed(3))
})

test('they nest: same centre line, same bottom edge', () => {
  const out = nestedCircles(DATA, { width: 200, height: 200, padding: 10 })
  const bottoms = out.map((c) => c.cy + c.r)
  assert.deepEqual(new Set(bottoms).size, 1, 'all tangent to the same floor')
  assert.deepEqual(new Set(out.map((c) => c.cx)).size, 1)
})

test('the biggest circle fits inside the box', () => {
  const out = nestedCircles(DATA, { width: 200, height: 120, padding: 8 })
  assert.ok(out[0].r * 2 <= 120 - 8)
})

test('a tiny value is still visible', () => {
  const out = nestedCircles([{ name: 'A', value: 1000 }, { name: 'B', value: 1 }], {
    width: 200,
    height: 200,
    padding: 8,
  })
  assert.ok(out[1].r >= 6)
})

test('nothing to draw is not a crash', () => {
  assert.deepEqual(nestedCircles([], { width: 100, height: 100 }), [])
  assert.deepEqual(nestedCircles(DATA, { width: 0, height: 0 }), [])
  assert.deepEqual(nestedCircles(null, { width: 100, height: 100 }), [])
  assert.deepEqual(nestedCircles([{ name: 'z', value: 0 }], { width: 100, height: 100 }), [])
})
