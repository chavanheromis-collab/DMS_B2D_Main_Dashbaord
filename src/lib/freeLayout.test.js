import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GUIDE_TOLERANCE,
  HANDLES,
  MIN_H,
  MIN_W,
  SNAP_STEPS,
  alignBox,
  canvasHeight,
  defaultFrame,
  frameToPx,
  framesFromBoxes,
  normalizeFrame,
  pxToFrame,
  resizeBox,
  snapBox,
  snapValue,
  tidyFrames,
} from './freeLayout.js'

// --- the frame ------------------------------------------------------------

test('a frame is drawn at exactly the size it says, with nothing rounded to a column', () => {
  // The whole point: 260px on a 1264px canvas is 260px, not 316.
  const frame = pxToFrame({ left: 0, top: 0, width: 260, height: 94 }, 1264)
  const box = frameToPx(frame, 1264)
  assert.equal(box.width, 260)
  assert.equal(box.height, 94)
})

test('three of them in a row leave no strip of nothing', () => {
  // The exact layout that started all this: three KPIs and a 12px gap.
  const canvas = 1264
  const frames = [0, 272, 544].map((left) => pxToFrame({ left, top: 0, width: 260, height: 94 }, canvas))
  const boxes = frames.map((f) => frameToPx(f, canvas))

  assert.deepEqual(boxes.map((b) => b.left), [0, 272, 544])
  assert.deepEqual(boxes.map((b) => b.width), [260, 260, 260])
  // And a fourth widget can start immediately after the third, at any
  // position at all -- there is no column boundary to wait for.
  const fourth = frameToPx(pxToFrame({ left: 816, top: 0, width: 448, height: 94 }, canvas), canvas)
  assert.equal(fourth.left, 816)
  assert.equal(fourth.left + fourth.width, canvas, 'flush to the right-hand edge')
})

test('the horizontal half is a fraction, so a design survives a different screen', () => {
  // A layout in pixels is a layout for the monitor it was made on.
  const frame = pxToFrame({ left: 300, top: 40, width: 600, height: 300 }, 1200)
  const wide = frameToPx(frame, 2400)
  assert.equal(wide.left, 600, 'a quarter of the way across, on any screen')
  assert.equal(wide.width, 1200, 'still half the page wide')
  assert.equal(wide.height, 300, 'but a 300px chart is 300px tall whatever the width')
  assert.equal(wide.top, 40)
})

test('a frame that cannot be drawn is brought back to one that can', () => {
  const f = normalizeFrame({ x: -3, y: -100, w: 9, h: 2 })
  assert.equal(f.x, 0)
  assert.equal(f.y, 0)
  assert.equal(f.w, 1, 'never wider than the canvas')
  assert.equal(f.h, MIN_H, 'and never a two-pixel sliver')
})

test('a widget can never be pushed off the right-hand edge', () => {
  const f = normalizeFrame({ x: 0.9, w: 0.5, y: 0, h: 100 })
  assert.ok(f.x + f.w <= 1.0001, `${f.x} + ${f.w}`)
})

test('nonsense is a sensible frame, not NaN', () => {
  const f = normalizeFrame({ x: 'left', w: null, y: undefined, h: 'tall' })
  assert.ok(Number.isFinite(f.x) && Number.isFinite(f.w) && Number.isFinite(f.y) && Number.isFinite(f.h))
  assert.ok(f.w >= MIN_W)
})

test('the canvas is as tall as its lowest widget', () => {
  assert.equal(canvasHeight({ a: { x: 0, y: 0, w: 0.5, h: 200 }, b: { x: 0.5, y: 300, w: 0.5, h: 150 } }), 450)
  assert.equal(canvasHeight({}), 0)
  assert.equal(canvasHeight(null, 24), 24)
})

// --- snapping is optional -------------------------------------------------

test('snapping off means every position on the canvas is available', () => {
  assert.equal(snapValue(137, 0), 137)
  const box = { left: 137, top: 41, width: 263, height: 97 }
  assert.deepEqual(snapBox(box, 0), box)
})

test('snapping on rounds to the step, and never below the minimum height', () => {
  assert.equal(snapValue(137, 8), 136)
  assert.equal(snapValue(144, 8), 144, 'something already on the step does not move')
  const snapped = snapBox({ left: 137, top: 41, width: 263, height: 20 }, 8)
  assert.deepEqual([snapped.left, snapped.top, snapped.width], [136, 40, 264])
  assert.equal(snapped.height, MIN_H, 'a snap cannot squash a widget out of existence')
})

test('every snap step offered is one the snapper understands', () => {
  for (const { value } of SNAP_STEPS) assert.ok(Number.isFinite(snapValue(100, value)))
})

// --- lining up with the neighbours ---------------------------------------

const neighbour = { left: 300, top: 100, width: 200, height: 150 }

test('a box nearly level with a neighbour snaps to it, and says which line', () => {
  const { box, guides } = alignBox({ left: 303, top: 400, width: 100, height: 80 }, [neighbour])
  assert.equal(box.left, 300)
  assert.ok(guides.some((g) => g.axis === 'x' && g.at === 300))
})

test('a right edge lines up with a left edge', () => {
  // Butting one widget against another is the commonest thing anybody does.
  const { box } = alignBox({ left: 197, top: 400, width: 100, height: 80 }, [neighbour])
  assert.equal(box.left + box.width, 300)
})

test('centres line up too', () => {
  const { box } = alignBox({ left: 353, top: 400, width: 100, height: 80 }, [neighbour])
  assert.equal(box.left + box.width / 2, 400, 'the neighbour’s centre')
})

test('the canvas edges and centre are lines as well', () => {
  const { box } = alignBox({ left: 4, top: 400, width: 100, height: 80 }, [], { canvasWidth: 1200 })
  assert.equal(box.left, 0)

  const middle = alignBox({ left: 597, top: 400, width: 100, height: 80 }, [], { canvasWidth: 1200 })
  assert.equal(middle.box.left, 600)
})

test('a box that is nowhere near anything is left exactly where it is', () => {
  const box = { left: 700, top: 700, width: 100, height: 80 }
  const out = alignBox(box, [neighbour], { canvasWidth: 1200 })
  assert.equal(out.box.left, 700)
  assert.deepEqual(out.guides.filter((g) => g.axis === 'x'), [])
})

test('the tolerance is a few pixels, not a magnet', () => {
  const far = alignBox({ left: 300 + GUIDE_TOLERANCE + 2, top: 900, width: 100, height: 80 }, [neighbour])
  assert.equal(far.box.left, 300 + GUIDE_TOLERANCE + 2)
})

// --- resizing -------------------------------------------------------------

const start = { left: 100, top: 100, width: 200, height: 150 }

test('a handle moves its own edge and leaves the others alone', () => {
  const east = resizeBox(start, 'e', 50, 0)
  assert.deepEqual(east, { left: 100, top: 100, width: 250, height: 150 })

  const west = resizeBox(start, 'w', 50, 0)
  assert.equal(west.left, 150, 'the left edge moved')
  assert.equal(west.left + west.width, 300, 'the right edge did not')

  const north = resizeBox(start, 'n', 0, 50)
  assert.equal(north.top, 150)
  assert.equal(north.top + north.height, 250, 'the bottom stayed put')
})

test('a corner moves two edges at once', () => {
  const se = resizeBox(start, 'se', 40, 30)
  assert.deepEqual([se.width, se.height], [240, 180])
  assert.deepEqual([se.left, se.top], [100, 100])
})

test('a widget cannot be dragged smaller than it can be read', () => {
  const tiny = resizeBox(start, 'se', -500, -500)
  assert.ok(tiny.width >= 60 && tiny.height >= MIN_H)
})

test('shrinking from the west stops rather than turning inside out', () => {
  const squashed = resizeBox(start, 'w', 500, 0)
  assert.ok(squashed.width >= 60)
  assert.ok(squashed.left <= 300, 'and the left edge never passes the right one')
})

test('every handle the UI draws is one the resizer understands', () => {
  for (const handle of HANDLES) {
    const out = resizeBox(start, handle, 10, 10)
    for (const v of Object.values(out)) assert.ok(Number.isFinite(v), handle)
  }
})

test('a resize never lifts a widget above the top of the canvas', () => {
  assert.equal(resizeBox({ left: 0, top: 10, width: 200, height: 150 }, 'n', 0, -100).top, 0)
})

// --- switching to it ------------------------------------------------------

test('turning the free canvas on does not move anything', () => {
  // Its first act must not be to destroy the layout it was opened to adjust.
  const boxes = {
    a: { left: 0, top: 0, width: 260, height: 94 },
    b: { left: 272, top: 0, width: 260, height: 94 },
    c: { left: 0, top: 106, width: 416, height: 583 },
  }
  const frames = framesFromBoxes(boxes, 1264)
  for (const [id, was] of Object.entries(boxes)) {
    const now = frameToPx(frames[id], 1264)
    assert.deepEqual([now.left, now.top, now.width, now.height], [was.left, was.top, was.width, was.height], id)
  }
})

test('a widget with no frame is placed, not dropped in the corner', () => {
  const first = defaultFrame(0)
  const second = defaultFrame(1)
  const third = defaultFrame(2)
  assert.equal(first.x, 0)
  assert.ok(second.x > first.x, 'the second sits beside the first')
  assert.equal(third.x, 0)
  assert.ok(third.y > first.y, 'the third starts a new row')
})

// --- tidying --------------------------------------------------------------

test('tidy pulls edges that are nearly level onto each other', () => {
  const canvas = 1200
  const frames = {
    a: pxToFrame({ left: 0, top: 0, width: 400, height: 200 }, canvas),
    b: pxToFrame({ left: 403, top: 2, width: 400, height: 200 }, canvas),
  }
  const tidy = tidyFrames(frames, canvas)
  const b = frameToPx(tidy.b, canvas)
  assert.equal(b.top, 0, 'two pixels out is now level')
  assert.equal(b.left, 400, 'and butted against its neighbour')
})

test('tidy does not move anything far', () => {
  const canvas = 1200
  const frames = {
    a: pxToFrame({ left: 0, top: 0, width: 300, height: 200 }, canvas),
    b: pxToFrame({ left: 700, top: 500, width: 300, height: 200 }, canvas),
  }
  const tidy = tidyFrames(frames, canvas)
  const b = frameToPx(tidy.b, canvas)
  assert.ok(Math.abs(b.left - 700) <= 12, 'a tidy, not a re-layout')
  assert.ok(Math.abs(b.top - 500) <= 12)
})
