import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  boundsOf,
  bottomOf,
  canvasHeight,
  changedIn,
  clampRect,
  DESIGN_WIDTH,
  edgesOf,
  freeSpot,
  HANDLES,
  isPinned,
  isPlaced,
  MAGNET,
  drawnWidth,
  MAX_CANVAS,
  MIN_H,
  MIN_W,
  marquee,
  moveBy,
  moveMany,
  patchOf,
  pinnedShift,
  placeAll,
  rectOf,
  resizeBy,
  scaleFor,
  seedFrom,
  SNAP,
  snapRect,
  stacked,
  toggle,
  toPixels,
  within,
} from './freeLayout.js'

const r = (id, x, y, w, h) => ({ id, x, y, w, h })

// ---------------------------------------------------------------------
// Reading a rectangle off a widget
// ---------------------------------------------------------------------

test('a widget that has been placed has a rectangle', () => {
  assert.deepEqual(rectOf({ id: 'a', boxX: 40, boxY: 80, boxW: 400, boxH: 240 }), r('a', 40, 80, 400, 240))
})

test('and one saved as strings is the same widget', () => {
  // Everything on this page saves through the same box-and-string path.
  assert.deepEqual(
    rectOf({ id: 'a', boxX: '40', boxY: '80', boxW: '400', boxH: '240' }),
    r('a', 40, 80, 400, 240)
  )
})

test('a widget nobody has placed has no rectangle, which is not a zero', () => {
  // A zero would pile every new widget into the top-left corner. "Not
  // placed" is what `placeAll` exists to answer.
  assert.equal(rectOf({ id: 'a' }), null)
  assert.equal(rectOf({ id: 'a', boxX: 0, boxY: 0 }), null, 'a position with no size is not a rectangle')
  assert.equal(rectOf({ id: 'a', boxX: 0, boxY: 0, boxW: 400 }), null, 'nor a width with no height')
  assert.equal(rectOf({ id: 'a', boxX: 0, boxY: 0, boxW: 0, boxH: 240 }), null, 'nor a width of nothing')
  assert.equal(isPlaced({ id: 'a', boxX: 0, boxY: 0, boxW: 400, boxH: 240 }), true)
})

test('a rectangle at the origin is a real place', () => {
  // Zero is falsy and this is the one field where zero is the commonest
  // real answer -- the widget in the top-left corner.
  assert.deepEqual(rectOf({ id: 'a', boxX: 0, boxY: 0, boxW: 400, boxH: 240 }), r('a', 0, 0, 400, 240))
})

test('a rectangle is stored as the strings the saver takes', () => {
  assert.deepEqual(patchOf(r('a', 40, 80, 400, 240)), {
    boxX: '40',
    boxY: '80',
    boxW: '400',
    boxH: '240',
  })
})

test('only what moved is written back', () => {
  const before = [r('a', 0, 0, 400, 240), r('b', 420, 0, 400, 240)]
  const after = [r('a', 0, 0, 400, 240), r('b', 420, 260, 400, 240)]
  assert.deepEqual(changedIn(before, after).map((i) => i.id), ['b'])
  assert.deepEqual(changedIn(before, before), [])
})

// ---------------------------------------------------------------------
// Keeping a rectangle sane
// ---------------------------------------------------------------------

test('nothing can be dragged off the left or the top', () => {
  assert.deepEqual(clampRect(r('a', -50, -50, 400, 240)), r('a', 0, 0, 400, 240))
})

test('nor off the right', () => {
  const out = clampRect(r('a', 1200, 0, 400, 240), { canvasWidth: 1280 })
  assert.equal(out.x, 880)
  assert.equal(out.x + out.w, 1280)
})

test('a widget wider than the canvas is narrowed, not shoved off the side', () => {
  // Clamping the left edge first would leave it at x=0 and still overhang.
  const out = clampRect(r('a', 0, 0, 2000, 240), { canvasWidth: 1280 })
  assert.deepEqual([out.x, out.w], [0, 1280])
})

test('nothing can be made smaller than it can be read', () => {
  const out = clampRect(r('a', 0, 0, 1, 1))
  assert.deepEqual([out.w, out.h], [MIN_W, MIN_H])
})

test('a rectangle has four edges and two centre lines', () => {
  assert.deepEqual(edgesOf(r('a', 100, 50, 400, 200)), {
    left: 100,
    right: 500,
    centreX: 300,
    top: 50,
    bottom: 250,
    centreY: 150,
  })
})

// ---------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------

const neighbour = r('n', 500, 300, 400, 200)

test('a left edge close to a neighbour left edge lines up with it', () => {
  const out = snapRect(r('a', 503, 0, 300, 100), [neighbour])
  assert.equal(out.rect.x, 500)
})

test('and it says which line caught it', () => {
  // A snap you cannot see is a widget that moved on its own.
  const out = snapRect(r('a', 503, 0, 300, 100), [neighbour])
  assert.deepEqual(out.guides, [{ axis: 'x', at: 500 }])
})

test('a left edge lines up with a neighbour RIGHT edge too', () => {
  // Sitting a card against the end of another is the commonest thing
  // anybody does, and it is a different pair of edges.
  const out = snapRect(r('a', 897, 0, 300, 100), [neighbour])
  assert.equal(out.rect.x, 900)
})

test('centres line up with centres', () => {
  const out = snapRect(r('a', 0, 0, 400, 100), [neighbour])
  // Its own centre is 200; the neighbour's is 700. Put it near that.
  const near = snapRect(r('a', 498, 0, 400, 100), [neighbour])
  assert.equal(near.rect.x + 200, 700)
  assert.ok(out.rect.x === 0, 'and something far away is left alone')
})

test('tops line up with tops, and bottoms with tops', () => {
  assert.equal(snapRect(r('a', 0, 296, 200, 100), [neighbour]).rect.y, 300)
  assert.equal(snapRect(r('a', 0, 197, 200, 100), [neighbour]).rect.y, 200, 'bottom to top')
})

test('an edge further away than the magnet is not pulled', () => {
  const far = MAGNET + 5
  assert.equal(snapRect(r('a', 500 + far, 0, 300, 100), [neighbour]).rect.x, 500 + far - ((500 + far) % SNAP))
})

test('with nothing to line up with, it lands on a round number anyway', () => {
  // Free placement with no help at all is how a page ends up with eight
  // cards each three pixels out of true.
  const out = snapRect(r('a', 103, 51, 300, 100), [])
  assert.deepEqual([out.rect.x, out.rect.y], [104, 48])
  assert.equal(out.rect.x % SNAP, 0)
  assert.deepEqual(out.guides, [], 'and nothing is drawn, because nothing was lined up with')
})

test('the closest line wins when two are in reach', () => {
  const a = r('a', 100, 0, 100, 100)
  const b = r('b', 106, 0, 100, 100)
  assert.equal(snapRect(r('me', 104, 400, 50, 50), [a, b]).rect.x, 106)
})

test('both axes snap at once', () => {
  const out = snapRect(r('a', 497, 303, 200, 100), [neighbour])
  assert.deepEqual([out.rect.x, out.rect.y], [500, 300])
  assert.equal(out.guides.length, 2)
})

// ---------------------------------------------------------------------
// Picking one up
// ---------------------------------------------------------------------

test('a widget goes exactly where it is dragged', () => {
  // No flow, no wrapping, no compaction. This is the whole point.
  const out = moveBy(r('a', 0, 0, 400, 240), 200, 480, [])
  assert.deepEqual([out.rect.x, out.rect.y], [200, 480])
})

test('and it stays there even with a hole above it', () => {
  // Every engine this replaced would have floated it back up.
  const out = moveBy(r('a', 0, 0, 400, 240), 0, 2000, [])
  assert.equal(out.rect.y, 2000)
})

test('and it may sit on top of another one, because that is what was asked', () => {
  // Nothing is pushed aside and nothing is refused. Free placement means
  // the page is the admin's problem, not the layout engine's opinion.
  const other = r('b', 0, 0, 400, 240)
  const out = moveBy(r('a', 0, 0, 400, 240), 60, 60, [other])
  assert.deepEqual([out.rect.x, out.rect.y], [64, 64], 'it went where it was dragged')
  assert.ok(out.rect.x < other.x + other.w && out.rect.y < other.y + other.h, 'and it is overlapping')
})

test('a dragged widget lines up with its neighbours on the way', () => {
  const out = moveBy(r('a', 0, 0, 300, 100), 503, 300, [neighbour])
  assert.deepEqual([out.rect.x, out.rect.y], [500, 300])
})

test('holding the modifier places it exactly, magnets off', () => {
  const out = moveBy(r('a', 0, 0, 300, 100), 503, 301, [neighbour], { loose: true })
  assert.deepEqual([out.rect.x, out.rect.y], [503, 301])
  assert.deepEqual(out.guides, [])
})

test('a widget cannot be dragged out of the canvas', () => {
  const out = moveBy(r('a', 0, 0, 400, 240), -900, -900, [])
  assert.deepEqual([out.rect.x, out.rect.y], [0, 0])
})

// ---------------------------------------------------------------------
// Picking up several at once
// ---------------------------------------------------------------------

test('a selection is the one rectangle that contains all of it', () => {
  assert.deepEqual(boundsOf([r('a', 100, 50, 200, 100), r('b', 400, 200, 100, 300)]), {
    id: '(selection)',
    x: 100,
    y: 50,
    w: 400,
    h: 450,
  })
})

test('an empty selection has no bounds, which is not a zero-sized one', () => {
  assert.equal(boundsOf([]), null)
  assert.equal(boundsOf(null), null)
})

test('everything selected moves by the same amount', () => {
  // The one promise dragging several things has to keep.
  const chosen = [r('a', 0, 0, 200, 100), r('b', 300, 400, 200, 100)]
  const out = moveMany(chosen, 80, 160, [])
  assert.deepEqual(out.rects.map((i) => [i.id, i.x, i.y]), [['a', 80, 160], ['b', 380, 560]])
})

test('and the gaps inside the selection do not change', () => {
  // Snapping each widget separately would let two of them drift apart by
  // a few pixels each drag, which is how a tidy row stops being one.
  const chosen = [r('a', 0, 0, 200, 100), r('b', 203, 0, 200, 100)]
  const before = chosen[1].x - (chosen[0].x + chosen[0].w)
  const out = moveMany(chosen, 497, 300, [neighbour])
  const after = out.rects[1].x - (out.rects[0].x + out.rects[0].w)
  assert.equal(after, before, 'the 3px gap survived a snap')
})

test('the selection as a whole lines up with its neighbours', () => {
  const chosen = [r('a', 0, 0, 200, 100), r('b', 220, 0, 200, 100)]
  const out = moveMany(chosen, 497, 300, [neighbour])
  assert.equal(out.rects[0].x, 500, 'the left of the group met the line')
  assert.equal(out.guides.length, 2)
})

test('a selection cannot be dragged off the page', () => {
  const chosen = [r('a', 0, 0, 200, 100), r('b', 300, 0, 200, 100)]
  const out = moveMany(chosen, -900, -900, [], { canvasWidth: 1280 })
  assert.deepEqual(out.rects.map((i) => [i.x, i.y]), [[0, 0], [300, 0]])
})

test('...nor off the right of it, as a whole', () => {
  // Clamping widget by widget would stack them all against the edge.
  const chosen = [r('a', 0, 0, 200, 100), r('b', 300, 0, 200, 100)]
  const out = moveMany(chosen, 9999, 0, [], { canvasWidth: 1280 })
  assert.equal(out.rects[1].x + out.rects[1].w, 1280)
  assert.equal(out.rects[1].x - out.rects[0].x, 300, 'and they kept their spacing')
})

test('a selection wider than the page keeps its shape rather than being squeezed', () => {
  const chosen = [r('a', 0, 0, 900, 100), r('b', 950, 0, 900, 100)]
  const out = moveMany(chosen, 0, 0, [], { canvasWidth: 1280 })
  assert.equal(out.rects[1].x - out.rects[0].x, 950)
})

test('the modifier places a selection exactly, magnets off', () => {
  const chosen = [r('a', 0, 0, 200, 100), r('b', 300, 0, 200, 100)]
  const out = moveMany(chosen, 497, 301, [neighbour], { loose: true })
  assert.deepEqual(out.rects.map((i) => [i.x, i.y]), [[497, 301], [797, 301]])
  assert.deepEqual(out.guides, [])
})

test('dragging one widget is a selection of one, not a second way of doing it', () => {
  // Two code paths for "move a thing" is two places for it to be wrong.
  const single = moveBy(r('a', 0, 0, 400, 240), 200, 480, [])
  const group = moveMany([r('a', 0, 0, 400, 240)], 200, 480, [])
  assert.deepEqual(single.rect, group.rects[0])
})

// ---------------------------------------------------------------------
// The rubber band
// ---------------------------------------------------------------------

test('a band is the rectangle between where it started and where it is', () => {
  assert.deepEqual(marquee({ x: 100, y: 50 }, { x: 300, y: 250 }), {
    id: '(marquee)',
    x: 100,
    y: 50,
    w: 200,
    h: 200,
  })
})

test('and it works dragged up and to the left as well', () => {
  // Half of all marquees are drawn backwards.
  assert.deepEqual(marquee({ x: 300, y: 250 }, { x: 100, y: 50 }), {
    id: '(marquee)',
    x: 100,
    y: 50,
    w: 200,
    h: 200,
  })
})

const spread = [r('a', 0, 0, 200, 100), r('b', 300, 0, 200, 100), r('c', 0, 300, 200, 100)]

test('a band picks up everything it touches', () => {
  assert.deepEqual(within(spread, { x: 0, y: 0, w: 350, h: 50 }), ['a', 'b'])
})

test('touched, not swallowed whole', () => {
  // Requiring a widget to be enclosed means dragging the band past the edge
  // of the screen to catch a wide chart.
  assert.deepEqual(within(spread, { x: 190, y: 10, w: 20, h: 20 }), ['a'])
})

test('and it picks up nothing when it touches nothing', () => {
  assert.deepEqual(within(spread, { x: 220, y: 150, w: 40, h: 40 }), [])
})

test('a band that only grazes an edge does not count it', () => {
  // Edge to edge is beside, not on top of -- the same rule the magnets use.
  // Both axes: the horizontal one was tested and the vertical one was not,
  // so a band whose bottom just touched a widget picked it up.
  assert.deepEqual(within(spread, { x: 200, y: 0, w: 100, h: 100 }), [], 'right edge to left edge')
  assert.deepEqual(within(spread, { x: 0, y: 200, w: 100, h: 100 }), [], 'bottom edge to top edge')
})

// ---------------------------------------------------------------------
// What is chosen
// ---------------------------------------------------------------------

test('a plain click chooses one thing and forgets the rest', () => {
  assert.deepEqual([...toggle(new Set(['a', 'b']), 'c')], ['c'])
})

test('a held modifier adds to what is chosen', () => {
  assert.deepEqual([...toggle(new Set(['a']), 'b', true)].sort(), ['a', 'b'])
})

test('and clicking a chosen one again takes it out', () => {
  // The only way to correct a band that caught one thing too many.
  assert.deepEqual([...toggle(new Set(['a', 'b']), 'b', true)], ['a'])
})

test('choosing never alters the selection it was given', () => {
  // It is state somewhere else; handing back a mutated copy is how a
  // component stops re-rendering when it should.
  const before = new Set(['a'])
  toggle(before, 'b', true)
  assert.deepEqual([...before], ['a'])
})

// ---------------------------------------------------------------------
// Resizing, from any of the eight handles
// ---------------------------------------------------------------------

const box = r('a', 400, 400, 400, 200)

test('there is a handle on every corner and every side', () => {
  assert.equal(HANDLES.length, 8)
})

test('the east handle changes the width and leaves the left edge alone', () => {
  const out = resizeBy(box, 'e', 100, 0, [], { loose: true })
  assert.deepEqual([out.rect.x, out.rect.w], [400, 500])
})

test('the south handle changes the height and leaves the top alone', () => {
  const out = resizeBy(box, 's', 0, 100, [], { loose: true })
  assert.deepEqual([out.rect.y, out.rect.h], [400, 300])
})

test('the west handle moves the left edge and keeps the right one still', () => {
  // The difference between resizing from a corner and resizing from the
  // one opposite it. Getting this wrong makes a widget jump sideways.
  const out = resizeBy(box, 'w', 100, 0, [], { loose: true })
  assert.deepEqual([out.rect.x, out.rect.w], [500, 300])
  assert.equal(out.rect.x + out.rect.w, 800, 'the right edge did not move')
})

test('the north handle moves the top and keeps the bottom still', () => {
  const out = resizeBy(box, 'n', 0, 50, [], { loose: true })
  assert.deepEqual([out.rect.y, out.rect.h], [450, 150])
  assert.equal(out.rect.y + out.rect.h, 600, 'the bottom did not move')
})

test('a corner handle does both', () => {
  const out = resizeBy(box, 'nw', 100, 50, [], { loose: true })
  assert.deepEqual([out.rect.x, out.rect.y, out.rect.w, out.rect.h], [500, 450, 300, 150])
})

test('a handle dragged past its opposite edge stops rather than turning inside out', () => {
  const out = resizeBy(box, 'w', 9999, 0, [], { loose: true })
  assert.equal(out.rect.w, MIN_W)
  assert.equal(out.rect.x + out.rect.w, 800, 'and the edge it was not dragging stayed put')
})

test('...in the other direction too', () => {
  const out = resizeBy(box, 'n', 0, 9999, [], { loose: true })
  assert.equal(out.rect.h, MIN_H)
  assert.equal(out.rect.y + out.rect.h, 600)
})

test('a resized edge lines up with a neighbour', () => {
  const out = resizeBy(r('a', 100, 300, 397, 200), 'e', 0, 0, [neighbour])
  assert.equal(out.rect.x + out.rect.w, 500)
})

test('an east drag lines up the right edge, and only the right edge', () => {
  // The widget's LEFT edge is 3px from a neighbour line and its right edge
  // is nowhere near one. Snapping to the left edge would change the width
  // by the amount the left edge would have had to move -- a number with
  // nothing to do with the edge under the hand.
  const out = resizeBy(r('a', 497, 100, 150, 200), 'e', 0, 0, [neighbour])
  assert.equal(out.rect.x, 497, 'the left edge was not being dragged')
  assert.equal(out.rect.w, 152, 'so the width only rounded, it did not snap')
})

test('a handle that is not moving an edge does not snap it', () => {
  // The "only the moving edges" rule needs a handle that moves NEITHER
  // side edge to prove it: a south-east drag exercises the east branch
  // whether it is guarded or not.
  const out = resizeBy(r('a', 497, 100, 300, 200), 'n', 0, 0, [neighbour])
  assert.equal(out.rect.w, 300, 'a north drag left the width alone')
  assert.equal(out.rect.x, 497, 'and the left edge')
})

test('a west resize keeps the right edge exactly where it was', () => {
  // The edge the hand is not holding must not move, and it only stays put
  // if the width gives up precisely what the left edge takes.
  const out = resizeBy(r('a', 497, 300, 300, 200), 'w', 0, 0, [neighbour])
  assert.equal(out.rect.x, 500, 'the dragged edge lined up')
  assert.equal(out.rect.x + out.rect.w, 797, 'and the far edge did not move')
})

test('but only the edges the hand is actually moving', () => {
  // A south-east drag that snapped the widget's TOP would move an edge
  // nobody is touching.
  const out = resizeBy(r('a', 100, 303, 300, 200), 'se', 0, 0, [neighbour])
  assert.equal(out.rect.y, 303, 'the top stayed where it was')
})

test('a resize with nothing near it lands on a round size', () => {
  const out = resizeBy(r('a', 0, 0, 400, 200), 'e', 13, 0, [])
  assert.equal(out.rect.w % SNAP, 0)
})

test('every handle keeps the rectangle inside the canvas', () => {
  for (const handle of HANDLES) {
    const out = resizeBy(r('a', 0, 0, 400, 200), handle, -9999, -9999, [], { loose: true })
    assert.ok(out.rect.x >= 0, handle)
    assert.ok(out.rect.y >= 0, handle)
    assert.ok(out.rect.w >= MIN_W, handle)
    assert.ok(out.rect.h >= MIN_H, handle)
  }
})

// ---------------------------------------------------------------------
// Placing what has nothing
// ---------------------------------------------------------------------

test('a new widget is given room of its own', () => {
  // Nothing STOPS two widgets overlapping, but one that arrives already on
  // top of another is one nobody asked to overlap.
  const spot = freeSpot([r('a', 0, 0, 400, 240)], 400, 240, { canvasWidth: 1280 })
  assert.ok(spot.x >= 400 || spot.y >= 240)
})

test('and dropped below when the row is full', () => {
  const spot = freeSpot([r('a', 0, 0, 1280, 240)], 400, 240, { canvasWidth: 1280 })
  assert.ok(spot.y >= 240)
})

test('a page of widgets nobody has placed still comes out laid out', () => {
  const out = placeAll([{ id: 'a' }, { id: 'b' }], { canvasWidth: 1280, defaultW: 400, defaultH: 240 })
  assert.equal(out.length, 2)
  assert.deepEqual([out[0].x, out[0].y], [0, 0])
  assert.ok(out[1].x >= 400 || out[1].y >= 240, 'not on top of the first')
})

test('and one that has been placed is left exactly where it is', () => {
  const out = placeAll([{ id: 'a', boxX: 600, boxY: 700, boxW: 300, boxH: 200 }, { id: 'b' }])
  assert.deepEqual(out.find((i) => i.id === 'a'), r('a', 600, 700, 300, 200))
})

test('a widget brings its own estimated size rather than a default one', () => {
  const out = placeAll([{ id: 'a', estimatedWidth: 260, estimatedHeight: 120 }])
  assert.deepEqual([out[0].w, out[0].h], [260, 120])
})

test('the bottom of the canvas is the lowest edge, not the lowest top', () => {
  assert.equal(bottomOf([r('a', 0, 0, 100, 300), r('b', 0, 100, 100, 100)]), 300)
  assert.equal(bottomOf([]), 0)
})

// ---------------------------------------------------------------------
// The same arrangement on another screen
// ---------------------------------------------------------------------

test('a narrower screen shrinks the whole arrangement, both ways', () => {
  // Shrinking only the widths would squash it: a chart half as wide and
  // just as tall is not the same picture.
  assert.deepEqual(scaleFor(640, 1280), { x: 0.5, y: 0.5 })
})

test('a wider one uses the room, and only in the direction there is room', () => {
  // The complaint this answers: a page pinned at 1280 on a desktop, with
  // the rest of the monitor left empty. It now fills -- but only the
  // widths grow, because inflating the text as well is a dashboard viewed
  // through a magnifying glass.
  assert.deepEqual(scaleFor(1920, 1280), { x: 1.5, y: 1 })
})

test('an ultra-wide monitor turns the extra room into margin', () => {
  // Past a point, more width is not a reason to draw a KPI card two feet
  // across.
  assert.deepEqual(scaleFor(4000, 1280), { x: MAX_CANVAS / 1280, y: 1 })
  assert.equal(drawnWidth(4000), MAX_CANVAS)
  assert.equal(drawnWidth(1600), 1600, 'and anything narrower is drawn as it is')
  assert.equal(drawnWidth(0), 0, 'an unmeasured canvas has no width yet')
})

test('an unmeasured canvas is drawn at its design size, not at nothing', () => {
  assert.deepEqual(scaleFor(0, 1280), { x: 1, y: 1 })
})

test('a rectangle is drawn at the scale the canvas is at', () => {
  assert.deepEqual(toPixels(r('a', 100, 200, 400, 240), { x: 0.5, y: 0.5 }), {
    left: 50,
    top: 100,
    width: 200,
    height: 120,
  })
})

test('and a stretched one grows sideways only', () => {
  assert.deepEqual(toPixels(r('a', 100, 200, 400, 240), { x: 1.5, y: 1 }), {
    left: 150,
    top: 200,
    width: 600,
    height: 240,
  })
})

test('the canvas is as tall as its lowest widget', () => {
  assert.equal(canvasHeight([r('a', 0, 100, 100, 300)], { x: 1, y: 0.5 }), 200)
  assert.equal(canvasHeight([r('a', 0, 100, 100, 300)], { x: 1.5, y: 1 }), 400, 'stretching does not add height')
})

test('on a phone everything goes full width, in reading order', () => {
  const out = stacked([r('b', 500, 0, 300, 150), r('a', 0, 0, 400, 200)], 360)
  assert.deepEqual(out.map((i) => i.id), ['a', 'b'])
  assert.deepEqual(out.map((i) => [i.x, i.w]), [[0, 360], [0, 360]])
})

test('and each keeps its own proportions, so a KPI stays short', () => {
  // 400x200 is half as tall as it is wide; at 360 across it should be 180.
  const out = stacked([r('a', 0, 0, 400, 200)], 360)
  assert.equal(out[0].h, 180)
})

test('a phone stack has nothing on top of anything else', () => {
  const out = stacked([r('a', 0, 0, 400, 200), r('b', 0, 0, 400, 200)], 360, { gap: 12 })
  assert.equal(out[1].y, out[0].y + out[0].h + 12)
})

// ---------------------------------------------------------------------
// Widgets that stay put while the page scrolls
// ---------------------------------------------------------------------

test('a widget is only pinned when the admin said so', () => {
  assert.equal(isPinned({ id: 'a' }), false)
  assert.equal(isPinned({ id: 'a', pinned: false }), false)
  assert.equal(isPinned({ id: 'a', pinned: true }), true)
  // Everything on this page saves through the same box-and-string path.
  assert.equal(isPinned({ id: 'a', pinned: 'true' }), true)
  assert.equal(isPinned(undefined), false)
  // ...which is exactly why "truthy" is the wrong test: the STRING "false"
  // is truthy, and a setting saved that way would pin the widget while the
  // control that wrote it showed off.
  assert.equal(isPinned({ id: 'a', pinned: 'false' }), false)
  assert.equal(isPinned({ id: 'a', pinned: 'no' }), false)
  assert.equal(isPinned({ id: 'a', pinned: 1 }), false)
})

const drawn = { left: 0, top: 200, width: 400, height: 100 }

test('a pinned widget does not move until the page scrolls past it', () => {
  // What makes it feel pinned rather than detached: it behaves like any
  // other widget right up until it would leave the top of the screen.
  assert.equal(pinnedShift(drawn, { scrollY: 0, stageTop: 60 }), 0)
  assert.equal(pinnedShift(drawn, { scrollY: 260, stageTop: 60 }), 0, 'exactly level is not past')
})

test('and then it holds its place, however far the page goes', () => {
  assert.equal(pinnedShift(drawn, { scrollY: 400, stageTop: 60 }), 140)
  assert.equal(pinnedShift(drawn, { scrollY: 900, stageTop: 60 }), 640)
})

test('an inset holds it below whatever sits above the canvas', () => {
  // A page header the widget would otherwise slide under.
  assert.equal(pinnedShift(drawn, { scrollY: 400, stageTop: 60, inset: 50 }), 190)
})

test('it never rides the scroll off the bottom of its own canvas', () => {
  // Without a limit a pinned widget follows the scroll for ever and ends
  // up hanging below the page it belongs to.
  assert.equal(pinnedShift(drawn, { scrollY: 9999, stageTop: 0, limit: 1000 }), 700)
  assert.equal(pinnedShift(drawn, { scrollY: 9999, stageTop: 0, limit: 250 }), 0, 'a canvas with no room')
})

test('a widget with no box is not nudged anywhere', () => {
  assert.equal(pinnedShift(null, { scrollY: 400 }), 0)
})

test('several pinned widgets keep their arrangement instead of piling up', () => {
  // The bug this replaced: each stuck to the top of the screen on its own,
  // so three KPI cards laid out one below another all converged on the same
  // line and drew over each other. Pinning several means keeping the
  // ARRANGEMENT of them on screen.
  const cards = [
    { id: 'a', x: 0, y: 100, w: 200, h: 60 },
    { id: 'b', x: 0, y: 180, w: 200, h: 60 },
    { id: 'c', x: 0, y: 260, w: 200, h: 60 },
  ]
  const group = boundsOf(cards)
  const shift = pinnedShift(toPixels(group, { x: 1, y: 1 }), { scrollY: 500, stageTop: 0 })

  // One number, applied to all of them -- so the gaps between them are the
  // gaps they were arranged with.
  const after = cards.map((c) => ({ ...c, y: c.y + shift }))
  assert.equal(after[1].y - after[0].y, 80)
  assert.equal(after[2].y - after[1].y, 80)
  // ...and the topmost has been brought to where the scroll has reached.
  assert.equal(after[0].y, 500)
})

test('and the group does not move until the scroll reaches the FIRST of them', () => {
  // Taken from the box that contains the lot: if it were measured from the
  // lowest widget the group would jump the moment the scroll passed the
  // top one.
  const group = boundsOf([
    { id: 'a', x: 0, y: 100, w: 200, h: 60 },
    { id: 'b', x: 0, y: 400, w: 200, h: 60 },
  ])
  const px = toPixels(group, { x: 1, y: 1 })
  assert.equal(pinnedShift(px, { scrollY: 50, stageTop: 0 }), 0)
  assert.equal(pinnedShift(px, { scrollY: 300, stageTop: 0 }), 200)
})

// ---------------------------------------------------------------------
// Arriving from the engine this replaced
// ---------------------------------------------------------------------

test('a page laid out by the old engine keeps the arrangement it had', () => {
  // Every page in the workspace was arranged with rows and pixel widths.
  // Throwing those away would rearrange every dashboard overnight.
  const out = seedFrom(
    { a: { left: 0, top: 0, width: 640, height: 200 }, b: { left: 652, top: 0, width: 628, height: 200 } },
    { canvasWidth: 1280, designWidth: 1280 }
  )
  assert.deepEqual(out.map((i) => [i.id, i.x, i.w]), [['a', 0, 640], ['b', 652, 628]])
})

test('and it is stored against the design width, not the screen it was seeded on', () => {
  // Otherwise a page seeded on a laptop is half size for everybody else.
  const out = seedFrom({ a: { left: 0, top: 0, width: 320, height: 100 } }, {
    canvasWidth: 640,
    designWidth: 1280,
  })
  assert.deepEqual([out[0].w, out[0].h], [640, 200])
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const readFile = (p) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

test('there is one layout engine left, and this is it', () => {
  // The whole point of the change: three ways to place a widget that
  // disagreed with each other, replaced by one.
  const canvas = readFile('src/components/WidgetCanvas.jsx')
  for (const gone of ['packRowGroups', 'gridLayout', 'freeDrag', 'columnsFor', 'rowSpan', 'colSpan']) {
    assert.ok(!canvas.includes(gone), `${gone} is still in the canvas`)
  }
  assert.ok(canvas.includes("from '../lib/freeLayout'"))
})

test('the canvas draws every widget at its own rectangle', () => {
  const canvas = readFile('src/components/WidgetCanvas.jsx')
  assert.ok(canvas.includes('placeAll(items'))
  assert.ok(canvas.includes('toPixels(rect, scale)'))
})

test('a drag and a resize both go through the one model', () => {
  const canvas = readFile('src/components/WidgetCanvas.jsx')
  assert.ok(canvas.includes('moveMany('))
  assert.ok(canvas.includes('resizeBy('))
})

test('the page saves a rectangle and nothing else', () => {
  const dash = readFile('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('async function saveLayout'))
  assert.ok(dash.includes('changedIn('))
})

test('a page from the old engine is seeded once, not every time it loads', () => {
  const dash = readFile('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('seedFrom('))
  // It used to leave the moment every widget had a rectangle. That guard is
  // the same question asked the other way round -- and it had to change,
  // because ADDING one widget made it false again and re-seeded the whole
  // page from measured pixels. Now the unplaced ones are counted, so the
  // migration and a new widget can be told apart.
  assert.ok(dash.includes('const unplaced = (levelWidgets || []).filter((w) => !isPlaced(w))'))
  assert.ok(dash.includes('if (unplaced.length === 0) return'), 'and only when something is unplaced')
})

// ---------------------------------------------------------------------
// Wiring: the canvas
// ---------------------------------------------------------------------

const canvasSrc = () => readFile('src/components/WidgetCanvas.jsx')
const dashSrc = () => readFile('src/pages/Dashboard.jsx')
const barSrc = () => readFile('src/components/ArrangeBar.jsx')

test('the drag is finished on the window, not on the widget', () => {
  // On the element alone, a hand that outruns the widget mid-drag drops it
  // wherever it happened to be.
  const canvas = canvasSrc()
  assert.ok(canvas.includes("window.addEventListener('pointermove', move)"))
  assert.ok(canvas.includes("window.addEventListener('pointerup', up)"))
  assert.ok(canvas.includes("window.addEventListener('pointercancel', up)"))
})

test('nothing is draggable unless somebody is arranging', () => {
  const canvas = canvasSrc()
  assert.ok(canvas.includes('onPointerDown={free && !phone ? (event) => startDrag(event, item.id) : undefined}'))
  assert.ok(canvas.includes('if (!free || event.button !== 0) return'), 'the handles are gated too')
  assert.ok(canvas.includes('free = false,'), 'and it is off unless the page asks')
})

test('a press that did not move is a click, not a drag', () => {
  // Otherwise opening a widget moves it.
  const canvas = canvasSrc()
  // Worked out once and used by the band and the move alike, so the two
  // cannot end up disagreeing about what counts as a drag.
  assert.ok(
    canvas.includes(
      'const far = drag && (Math.abs(drag.dx) >= DRAG_THRESHOLD || Math.abs(drag.dy) >= DRAG_THRESHOLD)'
    )
  )
  assert.ok(canvas.includes("if (!drag || !free || drag.mode === 'band' || !far) return null"))
})

test('a drag is measured in design pixels, not in the pixels under the hand', () => {
  // On a scaled canvas those differ, and the design is what gets saved.
  const canvas = canvasSrc()
  assert.ok(canvas.includes('const dx = drag.dx / scale'))
  assert.ok(canvas.includes('const dy = drag.dy / scale'))
})

test('and letting go saves it', () => {
  const canvas = canvasSrc()
  assert.ok(canvas.includes('const changed = changedIn(d.base, d.result)'))
  assert.ok(canvas.includes('if (changed.length > 0) commit.current?.(changed)'))
})

test('a phone gets the stack, not the arrangement shrunk to nothing', () => {
  const canvas = canvasSrc()
  assert.ok(canvas.includes('phone ? stacked(stored, width, { gap: gapY }) : stored'))
  assert.ok(canvas.includes('const phone = width > 0 && width < STACK_BELOW'))
})

test('a widget own controls keep working while the page is arranged', () => {
  // A search box you cannot type in is not an arranged page, it is a
  // broken one.
  const canvas = canvasSrc()
  assert.ok(canvas.includes('input, textarea, select, button, a, [contenteditable="true"]'))
})

// ---------------------------------------------------------------------
// Wiring: the page
// ---------------------------------------------------------------------

test('the page saves what the canvas hands it', () => {
  const dash = dashSrc()
  assert.ok(dash.includes('onLayout={saveLayout}'))
  assert.ok(dash.includes('free={isAdmin && arranging}'), 'and only for an arranging admin')
})

test('a typed number goes through the same clamping a drag does', () => {
  // Two ways of saying it, one layout -- so typing 9999 cannot put a
  // widget somewhere dragging could never reach.
  const dash = dashSrc()
  assert.ok(dash.includes('const next = clampRect({ ...rect, ...part })'))
})

test('a gesture is one write and one undo entry', () => {
  const dash = dashSrc()
  const at = dash.indexOf('async function saveLayout')
  const body = dash.slice(at, dash.indexOf('function setRect'))
  assert.ok(at > 0)
  assert.equal(body.split('writeWidgets(').length, 2, 'exactly one write')
  assert.ok(!/for \(|\.forEach\(|while \(/.test(body), 'and not that one write in a loop')
})

test('a half-measured page is not seeded from half of itself', () => {
  // Seeding needs every widget's box. Part of a page would place the rest
  // on top of each other and save it.
  const dash = dashSrc()
  assert.ok(dash.includes('if (measured.length !== levelWidgets.length) return'))
})

// ---------------------------------------------------------------------
// Wiring: the boxes
// ---------------------------------------------------------------------

test('the four numbers can be typed as well as dragged', () => {
  const bar = barSrc()
  assert.ok(bar.includes('onCommit={(raw) => onRect?.({ x: Math.max(0, Math.round(Number(raw) || 0)) })}'))
  assert.ok(bar.includes('onCommit={(raw) => onRect?.({ y: Math.max(0, Math.round(Number(raw) || 0)) })}'))
  assert.ok(bar.includes('onCommit={(raw) => onRect?.({ w: Math.round(Number(raw) || 0) })}'))
  assert.ok(bar.includes('onCommit={(raw) => onRect?.({ h: Math.round(Number(raw) || 0) })}'))
})

test('and each box shows its own number', () => {
  const bar = barSrc()
  for (const [label, field] of [['x', 'x'], ['y', 'y'], ['wide', 'w'], ['tall', 'h']]) {
    const at = bar.indexOf(`label="${label}"`)
    assert.ok(at > 0, label)
    assert.ok(bar.slice(at, at + 120).includes(`value={rect?.${field} ?? ''}`), label)
  }
})

// ---------------------------------------------------------------------
// Wiring: choosing several
// ---------------------------------------------------------------------

test('a band starts on the canvas itself, not on a widget', () => {
  // Otherwise pressing on a card both drags it and draws a box.
  const canvas = canvasSrc()
  assert.ok(canvas.includes('onPointerDown={free ? startBand : undefined}'))
  assert.ok(canvas.includes('if (event.target !== stageRef.current) return'))
})

test('a shift-click chooses rather than drags', () => {
  // Somebody adding a fourth card to a selection is choosing, not moving.
  const canvas = canvasSrc()
  assert.ok(canvas.includes('const additive = event.shiftKey || event.ctrlKey || event.metaKey'))
  assert.ok(canvas.includes('setSelection((prev) => toggle(prev, id, true))'))
})

test('grabbing something already chosen drags all of it', () => {
  const canvas = canvasSrc()
  assert.ok(canvas.includes('const chosen = selection.has(id) ? [...selection] : [id]'))
  assert.ok(canvas.includes('if (!selection.has(id)) setSelection(new Set([id]))'))
})

test('a group moves through the group mover, not one widget at a time', () => {
  const canvas = canvasSrc()
  assert.ok(canvas.includes('return moveMany(chosen, dx, dy, others, { loose: drag.loose })'))
  assert.ok(canvas.includes('const others = shown.filter((item) => !drag.ids.includes(item.id))'))
})

test('a handle resizes the one widget it is on, whatever else is chosen', () => {
  // Guessing at "make these five the same size" would let one careless
  // drag rewrite five widgets.
  const canvas = canvasSrc()
  assert.ok(canvas.includes('begin(event, { handle, ids: [id] })'))
  assert.ok(canvas.includes('selection.size <= 1 && ('), 'and they are hidden for a group')
})

test('letting go of a band chooses what it caught', () => {
  const canvas = canvasSrc()
  assert.ok(canvas.includes('setSelection(d.chose ? new Set(d.chose) : new Set())'))
})

test('every widget a drag moved is saved, not just the one under the hand', () => {
  const canvas = canvasSrc()
  assert.ok(canvas.includes('const changed = changedIn(d.base, d.result)'))
})

test('a selection cannot outlive the widgets in it', () => {
  // A deleted widget left in the set would be dragged by every gesture
  // and saved by none.
  const canvas = canvasSrc()
  assert.ok(canvas.includes('new Set([...prev].filter((id) => live.has(id)))'))
})

test('escape lets go, and so does leaving arrange mode', () => {
  const canvas = canvasSrc()
  assert.ok(canvas.includes("if (event.key === 'Escape') setSelection(new Set())"))
  assert.ok(canvas.includes('if (!free) setSelection(new Set())'))
})

test('what is chosen is visible before anything moves', () => {
  const canvas = canvasSrc()
  assert.ok(canvas.includes("chosen ? 'widget-chosen' : ''"))
  const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
  assert.ok(css.includes('.widget-chosen > * > .card'))
  // An outline, not a border: a border would change the widget's own size,
  // and the promise of this canvas is that a widget IS its rectangle.
  assert.ok(css.includes('outline: 2px solid rgb(99 102 241)'))
  assert.ok(!/\.widget-chosen[^{]*\{[^}]*border:/.test(css))
})

// ---------------------------------------------------------------------
// Wiring: filling the screen
// ---------------------------------------------------------------------

test('the canvas scales in both directions, not one number for both', () => {
  const canvas = canvasSrc()
  assert.ok(canvas.includes('const dx = drag.dx / scale.x'))
  assert.ok(canvas.includes('const dy = drag.dy / scale.y'))
  assert.ok(canvas.includes('minWidth: MIN_W * scale.x, minHeight: MIN_H * scale.y'))
})

test('what is measured is not what is resized', () => {
  // Setting the width of the element the observer is watching is a loop:
  // the new width changes what it reads, which changes the width again.
  // On an ultra-wide monitor the page would flicker for ever.
  const canvas = canvasSrc()
  assert.ok(canvas.includes('const ro = new ResizeObserver(read)'))
  assert.ok(canvas.includes('ro.observe(el)'))
  const measured = canvas.slice(canvas.indexOf('const el = '), canvas.indexOf('ro.disconnect'))
  assert.ok(measured.includes('const el = hostRef.current'), 'the host is what is watched')
  assert.ok(!measured.includes('stageRef'), 'and the stage never is')
  // ...and the host carries no width of its own.
  const host = canvas.slice(canvas.indexOf('<div ref={hostRef}'), canvas.indexOf('<div ref={stageRef}'))
  assert.ok(!host.includes('width:'), 'the measured element is never given a width')
  assert.ok(canvas.includes('width: drawn > 0 ? drawn : undefined'), 'the stage is')
})

test('the band is drawn against the stage, which is what it is drawn on', () => {
  // Against the host, a centred canvas would put every band a few hundred
  // pixels to the left of the hand.
  const canvas = canvasSrc()
  assert.ok(canvas.includes('if (event.target !== stageRef.current) return'))
  assert.ok(canvas.includes('const host = stageRef.current.getBoundingClientRect()'))
  // ...and read back into DESIGN pixels. On a stretched canvas the pixels
  // under the hand and the pixels the widgets live in are not the same, so
  // a band read straight off the screen would catch the wrong widgets.
  assert.ok(canvas.includes('x: (event.clientX - host.left) / scale.x'))
  assert.ok(canvas.includes('y: (event.clientY - host.top) / scale.y'))
})

// ---------------------------------------------------------------------
// Wiring: staying put
// ---------------------------------------------------------------------

test('a pinned widget is nudged, not repositioned', () => {
  // A transform costs no layout and leaves `top` saying where the widget
  // actually belongs -- which is what the arrange boxes read back.
  const canvas = canvasSrc()
  assert.ok(canvas.includes('transform: held > 0 ? `translateY(${held}px)` : undefined'))
  assert.ok(canvas.includes('zIndex: held > 0 ? 20 : undefined'), 'and drawn above what slides under it')
})

test('...and only for a reader, never while the canvas is being arranged', () => {
  // It would slide out from under the hand trying to move it.
  const canvas = canvasSrc()
  assert.ok(canvas.includes('if (pinnedIds.size === 0 || free || phone || width <= 0) return 0'))
})

test('it cannot ride the scroll off the bottom of its own canvas', () => {
  const canvas = canvasSrc()
  assert.ok(canvas.includes('limit: canvasHeight(shown, scale)'))
})

test('a page with nothing pinned listens to no scroll at all', () => {
  // A scroll handler that never changes anything is still a scroll handler
  // running on every frame of every scroll.
  const canvas = canvasSrc()
  assert.ok(canvas.includes('if (pinnedIds.size === 0) return undefined'))
  assert.ok(canvas.includes("window.addEventListener('scroll', read, { passive: true })"))
  assert.ok(canvas.includes("window.removeEventListener('scroll', read)"))
})

test('the admin turns it on, and only the admin', () => {
  const bar = barSrc()
  assert.ok(bar.includes('onClick={() => onPinned(!pinned)}'))
  const dash = dashSrc()
  assert.ok(dash.includes('pinned={widget.pinned === true}'))
  assert.ok(dash.includes('onPinned={ isAdmin ?'))
  assert.ok(dash.includes('pinned: widget.pinned,'), 'and the canvas is told')
})

test('a widget that will behave differently for a reader says so while arranging', () => {
  const canvas = canvasSrc()
  assert.ok(canvas.includes('stays put'))
  const bar = barSrc()
  assert.ok(bar.includes('{pinned && <Pin size={9}'), 'and on the closed pill')
})

test('the whole pinned group is nudged by one number, not each widget by its own', () => {
  const canvas = canvasSrc()
  assert.ok(canvas.includes('const group = boundsOf(shown.filter((rect) => pinnedIds.has(rect.id)))'))
  // The scroll and the canvas top, unaltered. A stray offset here would
  // make the group jump early or late, and nothing else would notice.
  assert.ok(canvas.includes('scrollY: scroll.y,'))
  assert.ok(canvas.includes('stageTop: scroll.stageTop,'))
  assert.ok(canvas.includes('limit: canvasHeight(shown, scale),'))
  assert.ok(canvas.includes('const held = isPinned(item) ? pinShift : 0'))
  // Worked out once, outside the loop that draws the widgets.
  assert.equal(canvas.split('pinnedShift(').length, 2, 'exactly one place computes it')
})

// --- adding a widget to a page that is already arranged ------------------

test('a widget with a rectangle keeps it, to the pixel', () => {
  // The bug this is the floor under: adding one widget re-seeded the WHOLE
  // page from measured pixels, and measured pixels do not survive the round
  // trip -- divided back by the canvas scale, rounded, clamped. Every
  // widget shifted a little, and the shift was saved.
  const arranged = [
    { id: 'a', boxX: '0', boxY: '0', boxW: '400', boxH: '240' },
    { id: 'b', boxX: '408', boxY: '0', boxW: '400', boxH: '240' },
    { id: 'c', boxX: '0', boxY: '252', boxW: '816', boxH: '300' },
  ]
  const before = placeAll(arranged)
  const after = placeAll([...arranged, { id: 'new' }])

  for (const rect of before) {
    const now = after.find((r) => r.id === rect.id)
    assert.deepEqual(now, rect, `${rect.id} moved when a widget was added`)
  }
})

test('...and the new one is the only thing written back', () => {
  // Which is what `changedIn` is for: whatever else placeAll returns, only
  // a rectangle that is actually new or actually different is saved.
  const arranged = [
    { id: 'a', boxX: '0', boxY: '0', boxW: '400', boxH: '240' },
    { id: 'b', boxX: '408', boxY: '0', boxW: '400', boxH: '240' },
  ]
  const before = placeAll(arranged)
  const after = placeAll([...arranged, { id: 'new' }])
  assert.deepEqual(changedIn(before, after).map((r) => r.id), ['new'])
})

test('the new one lands somewhere free, not on top of what is there', () => {
  const arranged = [{ id: 'a', boxX: '0', boxY: '0', boxW: '1280', boxH: '240' }]
  const [, fresh] = placeAll([...arranged, { id: 'new', estimatedWidth: 400, estimatedHeight: 200 }])
  assert.ok(fresh.y >= 240, `it landed at ${fresh.y}, over the widget already there`)
  // And within the canvas, so it is not off the right-hand edge.
  assert.ok(fresh.x >= 0 && fresh.x + fresh.w <= DESIGN_WIDTH)
})

test('the size it lands at is the one it was guessed to need', () => {
  const [rect] = placeAll([{ id: 'k', estimatedWidth: 240, estimatedHeight: 150 }])
  assert.equal(rect.w, 240)
  assert.equal(rect.h, 150)
  // A guess that is missing or absurd still produces something drawable.
  // Both directions, and both floors: a widget half a centimetre tall is
  // on the page and cannot be found to be dragged bigger.
  const [fallback] = placeAll([{ id: 'x' }])
  assert.ok(fallback.w >= MIN_W && fallback.h >= MIN_H)
  const [tiny] = placeAll([{ id: 't', estimatedWidth: 2, estimatedHeight: 3 }])
  assert.equal(tiny.w, MIN_W)
  assert.equal(tiny.h, MIN_H)
  const [huge] = placeAll([{ id: 'h', estimatedWidth: 99999, estimatedHeight: 400 }])
  assert.equal(huge.w, DESIGN_WIDTH, 'a wide guess is not brought back onto the canvas')
})

test('only a page where NOTHING is placed is seeded from the screen', () => {
  // Seeding from measured pixels is a migration, and running it on a page
  // that is already arranged is what moved everything.
  const dashboard = fs.readFileSync(path.join(ROOT, 'src/pages/Dashboard.jsx'), 'utf8')
  assert.ok(dashboard.includes('if (unplaced.length < levelWidgets.length) {'), 'the two cases are not told apart')
  assert.ok(dashboard.includes('placeAll(guessed).filter((rect) => wanted.has(rect.id))'), 'more than the new one is saved')
  // The migration is still there for the page that needs it.
  assert.ok(dashboard.includes('seedFrom(Object.fromEntries(measured)'), 'an unarranged page is left unplaced')
})
