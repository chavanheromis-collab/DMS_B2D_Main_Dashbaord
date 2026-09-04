import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  boxRatio,
  isDial,
  isRound,
  KPI_SHAPES,
  ringFraction,
  ringGeometry,
  ringIsMeaningful,
  shapeOf,
  STARTS,
  SWEEPS,
} from './kpiShapes.js'

// ---------------------------------------------------------------------
// Which shape a card is
// ---------------------------------------------------------------------

test('a card nobody has restyled is the shape it has always been', () => {
  // The whole of "this changes no existing dashboard".
  assert.equal(shapeOf({}), 'classic')
  assert.equal(shapeOf(undefined), 'classic')
  assert.equal(KPI_SHAPES[0].value, 'classic', 'and it is the first thing offered')
})

test('a shape nobody has heard of is the classic one, not a blank card', () => {
  assert.equal(shapeOf({ kpiShape: 'hexagon' }), 'classic')
})

test('an image placed beside the number still means that shape', () => {
  // Plenty of cards are stored that way, from before there was a shape to
  // name -- and they must go on looking the same.
  assert.equal(shapeOf({}, true), 'side')
})

test('but a shape named outright wins over the old way of saying it', () => {
  // It is the more deliberate of the two statements.
  assert.equal(shapeOf({ kpiShape: 'ring' }, true), 'ring')
  assert.equal(shapeOf({ kpiShape: 'side' }, false), 'side')
})

test('every shape offered is one the picker can name', () => {
  const seen = new Set()
  for (const s of KPI_SHAPES) {
    assert.ok(s.label && s.hint, s.value)
    assert.ok(!seen.has(s.value), `${s.value} twice`)
    seen.add(s.value)
    assert.equal(shapeOf({ kpiShape: s.value }), s.value)
  }
})

test('the round ones are the round ones', () => {
  assert.equal(isRound('ring'), true)
  assert.equal(isRound('badge'), true)
  assert.equal(isRound('classic'), false)
  assert.equal(isRound('centred'), false)
  assert.equal(isRound('side'), false)
})

// ---------------------------------------------------------------------
// How full the ring is
// ---------------------------------------------------------------------

test('a target the admin typed is what the ring measures against', () => {
  // The only one of the three answers somebody chose on purpose.
  assert.equal(ringFraction(300, { target: 1200 }), 0.25)
  assert.equal(ringFraction(600, { target: 1200, baseline: 6000 }), 0.5, 'a target beats the total')
})

test('with no target, it is the share the filters have left', () => {
  // The same number the progress bar under a classic card already shows.
  assert.equal(ringFraction(250, { baseline: 1000 }), 0.25)
})

test('with neither, the ring is full rather than empty', () => {
  // An empty ring reads as "none of it", and a KPI with nothing to be a
  // proportion OF has not failed at anything.
  assert.equal(ringFraction(42, {}), 1)
  assert.equal(ringFraction(42), 1)
  assert.equal(ringFraction(42, { target: 0, baseline: 0 }), 1)
})

test('a target that was beaten fills the ring and no further', () => {
  // A ring that has gone round twice is unreadable; the number in the
  // middle is what says by how much it was beaten.
  assert.equal(ringFraction(2400, { target: 1200 }), 1)
})

test('and a negative figure empties it rather than drawing backwards', () => {
  assert.equal(ringFraction(-50, { target: 1200 }), 0)
})

test('nonsense in is a full ring, not a NaN one', () => {
  assert.equal(ringFraction('lots', { target: 1200 }), 0)
  assert.equal(ringFraction(300, { target: 'soon' }), 1)
  assert.equal(ringFraction(300, { target: null, baseline: undefined }), 1)
})

// ---------------------------------------------------------------------
// The circle it draws
// ---------------------------------------------------------------------

test('a full ring leaves nothing undrawn, and an empty one leaves all of it', () => {
  // A dash offset counts BACKWARDS, which is the one thing here that is
  // easy to get the wrong way round.
  const full = ringGeometry(1, 96, 8)
  assert.equal(Math.round(full.offset), 0)
  const empty = ringGeometry(0, 96, 8)
  assert.equal(Math.round(empty.offset), Math.round(empty.circumference))
})

test('a quarter leaves three quarters undrawn', () => {
  const g = ringGeometry(0.25, 96, 8)
  assert.equal(Math.round(g.offset), Math.round(g.circumference * 0.75))
})

test('the circle fits inside the box, stroke and all', () => {
  // Half the stroke sits outside the radius, so a ring drawn at the full
  // half-width would be clipped all the way round.
  const g = ringGeometry(1, 96, 8)
  assert.equal(g.r, (96 - 8) / 2)
  assert.equal(g.centre, 48)
})

test('a size or stroke that could not be drawn is brought up to one that can', () => {
  const tiny = ringGeometry(1, 0, 0)
  assert.ok(tiny.r >= 1)
  assert.ok(tiny.stroke >= 2)
  assert.ok(tiny.circumference > 0)
})

test('a fraction outside nought to one is brought back into it', () => {
  assert.equal(Math.round(ringGeometry(9, 96, 8).offset), 0)
  assert.equal(
    Math.round(ringGeometry(-9, 96, 8).offset),
    Math.round(ringGeometry(0, 96, 8).circumference)
  )
  assert.equal(Math.round(ringGeometry('x', 96, 8).offset), Math.round(ringGeometry(0).circumference))
})

// ---------------------------------------------------------------------
// The dials: a ring, a gauge and an arc
// ---------------------------------------------------------------------

test('each dial draws its own amount of the circle', () => {
  assert.equal(SWEEPS.ring, 1)
  assert.equal(SWEEPS.gauge, 0.75, 'a quarter open at the bottom')
  assert.equal(SWEEPS.arc, 0.5, 'the top half only')
})

test('and each starts where it should, not at three o’clock', () => {
  // An SVG circle begins at three o'clock, which is nobody's idea of the
  // top of anything.
  assert.equal(STARTS.ring, -90, 'twelve')
  assert.equal(STARTS.gauge, 135, 'half past seven, so the gap is centred below')
  assert.equal(STARTS.arc, 180, 'nine, sweeping over the top')
})

test('a gauge only ever draws three quarters, however full it is', () => {
  const g = ringGeometry(1, 96, 8, 'gauge')
  assert.equal(Math.round(g.track), Math.round(g.circumference * 0.75))
  assert.equal(Math.round(g.offset), 0, 'and full means the whole of that')
})

test('a half-full gauge fills half of ITS track, not half the circle', () => {
  // The trap: measuring against the circumference would make a gauge read
  // two thirds full when it is half full.
  const g = ringGeometry(0.5, 96, 8, 'gauge')
  assert.equal(Math.round(g.offset), Math.round(g.track / 2))
})

test('an arc is the top half and starts at nine', () => {
  const a = ringGeometry(1, 96, 8, 'arc')
  assert.equal(Math.round(a.track), Math.round(a.circumference / 2))
  assert.equal(a.rotation, 180)
})

test('the missing part is not drawn at all, rather than drawn faintly', () => {
  // A gauge with a ghost of its missing quarter is a ring with a smudge.
  // The gap has to be longer than the circle, or the dash wraps round and
  // starts drawing a second time.
  const g = ringGeometry(0.5, 96, 8, 'gauge')
  const [run, gap] = g.dashArray.split(' ').map(Number)
  assert.equal(Math.round(run), Math.round(g.track))
  assert.ok(gap >= g.circumference)
})

test('a ring is unchanged by any of this', () => {
  // Every card already drawn as a ring has to stay exactly as it was.
  const ring = ringGeometry(0.25, 96, 8, 'ring')
  assert.equal(Math.round(ring.track), Math.round(ring.circumference))
  assert.equal(ring.rotation, -90)
  assert.equal(Math.round(ring.offset), Math.round(ring.circumference * 0.75))
  assert.deepEqual(ringGeometry(0.25, 96, 8), ring, 'and it is still the default')
})

test('a shape nobody has heard of is drawn as a ring, not as nothing', () => {
  const odd = ringGeometry(0.5, 96, 8, 'hexagon')
  assert.equal(odd.sweep, 1)
  assert.equal(odd.rotation, -90)
})

test('an arc gets a shorter box, or it leaves a hole under the number', () => {
  assert.ok(boxRatio('arc') < 1)
  assert.equal(boxRatio('ring'), 1)
  assert.equal(boxRatio('gauge'), 1)
  assert.equal(boxRatio('badge'), 1)
})

test('the dials are the ones with a track that fills', () => {
  // A badge is round but is not a proportion of anything.
  assert.deepEqual(['ring', 'gauge', 'arc'].map(isDial), [true, true, true])
  assert.equal(isDial('badge'), false)
  assert.equal(isDial('classic'), false)
  for (const shape of ['ring', 'gauge', 'arc', 'badge']) {
    assert.equal(isRound(shape), true, shape)
  }
})

// ---------------------------------------------------------------------
// Whether a ring is worth drawing
// ---------------------------------------------------------------------

test('a ring means something when there is something to be a share of', () => {
  assert.equal(ringIsMeaningful({ target: 1200 }), true)
  assert.equal(ringIsMeaningful({ baseline: 5000 }), true)
})

test('and means nothing when there is not, which the picker says out loud', () => {
  // A ring that is always full is a decoration, and a control that does
  // nothing is worse than a missing one.
  assert.equal(ringIsMeaningful({}), false)
  assert.equal(ringIsMeaningful(), false)
  assert.equal(ringIsMeaningful({ target: 0, baseline: 0 }), false)
  assert.equal(ringIsMeaningful({ target: 'soon' }), false)
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const read = (p) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

test('the card asks which shape it is, and honours the old way of saying it', () => {
  const kpi = read('src/components/widgets/KpiWidget.jsx')
  assert.ok(kpi.includes('const shape = shapeOf(widget, sideImage)'))
})

test('the ring is drawn from the geometry rather than from arithmetic in a render', () => {
  const kpi = read('src/components/widgets/KpiWidget.jsx')
  assert.ok(kpi.includes('ringGeometry('))
  assert.ok(kpi.includes('ringFraction(value, { target: widget.kpiTarget, baseline })'))
  // The exact expression: `strokeDashoffset` appearing anywhere would
  // still match if the fill were told to draw nothing.
  assert.ok(kpi.includes('strokeDashoffset={ring.offset}'))
})

test('every shape is offered in the admin panel', () => {
  const panel = read('src/pages/admin/WidgetsPanel.jsx')
  assert.ok(panel.includes('options={KPI_SHAPES}'))
  assert.ok(panel.includes("value={widget.kpiShape || 'classic'}"))
  assert.ok(panel.includes('onChange={(v) => set({ kpiShape: v })}'))
})

test('a target is only asked for where it would be drawn', () => {
  // Offering "target" on a shape that cannot show one is a control that
  // does nothing.
  const panel = read('src/pages/admin/WidgetsPanel.jsx')
  // Every dial, not just the ring: a gauge and an arc measure against a
  // target in exactly the same way.
  assert.ok(panel.includes("{['ring', 'gauge', 'arc'].includes(widget.kpiShape) && ("))
  assert.ok(panel.includes('onChange={(v) => set({ kpiTarget: v })}'))
})

test('a ring with nothing to measure against says so', () => {
  // A full circle looks like an achievement, and this one would only be a
  // shape -- so the card says what it needs instead of drawing it.
  const kpi = read('src/components/widgets/KpiWidget.jsx')
  assert.ok(kpi.includes('const meaningful = ringIsMeaningful({ target: widget.kpiTarget, baseline })'))
  assert.ok(kpi.includes("{shape === 'ring' && !meaningful && ("))
  assert.ok(kpi.includes('set a target to fill this ring'))
  // ...and the percentage is only shown where it means something.
  assert.ok(kpi.includes("{shape === 'ring' && meaningful && ("))
})

test('a gauge and an arc are drawn as dials, turned to start in the right place', () => {
  const kpi = read('src/components/widgets/KpiWidget.jsx')
  assert.ok(kpi.includes('ringGeometry(fraction, size, Math.max(6, Math.round(size / 13)), shape)'))
  assert.ok(kpi.includes('isDial(shape) ? ('))
  assert.ok(kpi.includes('transform: `rotate(${ring.rotation}deg)`'))
})

test('the track is only as long as the shape draws', () => {
  // On BOTH circles. A faint full ring behind a three-quarter gauge is a
  // ring with a smudge in it.
  const kpi = read('src/components/widgets/KpiWidget.jsx')
  assert.equal(kpi.split('strokeDasharray={ring.dashArray}').length, 3)
  assert.ok(!kpi.includes('strokeDasharray={ring.circumference}'))
})

test('an arc gets a shorter box, and its number stays over the drawn part', () => {
  const kpi = read('src/components/widgets/KpiWidget.jsx')
  assert.ok(kpi.includes('const boxH = Math.round(size * boxRatio(shape))'))
  assert.ok(kpi.includes('style={{ width: size, height: boxH }}'))
  assert.ok(kpi.includes('style={{ height: boxH }}'))
})
