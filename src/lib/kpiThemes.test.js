import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  KPI_THEMES,
  THEME_VALUES,
  deltaChip,
  inkOn,
  kpiSurface,
  markColor,
  shade,
  themeOf,
} from './kpiThemes.js'
import {
  KPI_SHAPES,
  WANTS_SIZE,
  WANTS_TARGET,
  boxRatio,
  deltaOf,
  deltaText,
  isDial,
  isNeedle,
  isRound,
  isSegmented,
  needleGeometry,
  ringGeometry,
  segmentBlocks,
} from './kpiShapes.js'

// ---------------------------------------------------------------------
// What a KPI card is, and what shape it takes
// ---------------------------------------------------------------------
// Two settings that multiply: six shapes by six themes. What is worth
// testing is that they stay independent (a theme must not decide a
// shape's geometry), that nothing here changes a card nobody touched,
// and the one thing a theme can actually get wrong -- ink that cannot be
// read on its own surface.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const kpi = read('components/widgets/KpiWidget.jsx')
const panel = read('pages/admin/WidgetsPanel.jsx')

// --- nothing changes for anybody who did not ask ------------------------

test('a card nobody has themed is exactly what it was', () => {
  // A theme that sets no variables cannot change a dashboard.
  const plain = kpiSurface('plain', '#4F46E5')
  assert.deepEqual(plain.vars, {})
  assert.equal(plain.className, '')
  assert.equal(plain.ink, '')
  assert.equal(plain.onFill, false)
  // An unknown or missing theme IS plain.
  assert.equal(themeOf({}), 'plain')
  assert.equal(themeOf(null), 'plain')
  assert.equal(themeOf({ kpiTheme: 'neon' }), 'plain')
  assert.equal(themeOf({ kpiTheme: 'dark' }), 'dark')
})

test('every theme speaks in the variables the Look tab already uses', () => {
  // So a colour somebody typed still wins: a theme is a preset, not a
  // decision. Anything inventing its own class would sit outside that.
  for (const theme of THEME_VALUES) {
    const surface = kpiSurface(theme, '#4F46E5')
    for (const key of Object.keys(surface.vars)) {
      assert.match(key, /^--card-/, `${theme} sets ${key}`)
    }
  }
  assert.ok(kpi.includes('style={{ ...surface.vars, ...(isDrilled ? {'), 'the vars never reach the card')
})

test('a card that owns its background says so, or it gets a grey smear', () => {
  // `.card` paints a white sheen down its first few centimetres, which
  // is right on near-white and dirt on anything darker. `card-ownbg` is
  // the existing switch that turns it off.
  for (const theme of ['solid', 'gradient', 'dark', 'outline']) {
    assert.match(kpiSurface(theme, '#4F46E5').className, /card-ownbg/, theme)
  }
  assert.match(kpiSurface('dark').className, /card-invert/)
  // ...and the ones that keep the stock surface do not claim it.
  assert.equal(kpiSurface('plain').className, '')
  assert.equal(kpiSurface('tinted').className, '')
})

// --- the one thing a theme can get wrong --------------------------------

test('ink is chosen against the surface, not against a guess', () => {
  // The accent is the admin's: a solid card in pale yellow and one in
  // navy cannot both take white text.
  assert.equal(inkOn('#0f172a'), '#ffffff')
  assert.equal(inkOn('#FDE047'), '#0f172a', 'white on pale yellow is unreadable')
  assert.equal(inkOn('#4F46E5'), '#ffffff')
  // Green carries most of the perceived brightness, which is why a mid
  // green takes dark ink where a mid blue does not.
  assert.equal(inkOn('#22C55E'), '#0f172a')
  assert.equal(inkOn('#3B82F6'), '#ffffff')
  // Nonsense gets the safe answer rather than an exception.
  assert.equal(inkOn(''), '#ffffff')
  assert.equal(inkOn(null), '#ffffff')
})

test('a filled card carries that ink all the way through', () => {
  const pale = kpiSurface('solid', '#FDE047')
  assert.equal(pale.ink, '#0f172a')
  assert.equal(pale.vars['--card-text'], '#0f172a')
  // Muted is the ink at strength, never a grey: grey on a colour is dirt.
  assert.match(pale.muted, /^rgba\(15,23,42/)

  const deep = kpiSurface('solid', '#1E3A8A')
  assert.equal(deep.ink, '#ffffff')
  assert.match(deep.muted, /^rgba\(255,255,255/)
})

test('a mark drawn in the accent is not drawn on a card that IS the accent', () => {
  // It would be invisible. The ink stands in for it.
  const solid = kpiSurface('solid', '#4F46E5')
  assert.equal(solid.onFill, true)
  assert.equal(markColor(solid, '#4F46E5'), solid.ink)
  // ...and on every other theme the accent is the accent.
  const tinted = kpiSurface('tinted', '#4F46E5')
  assert.equal(tinted.onFill, false)
  assert.equal(markColor(tinted, '#4F46E5'), '#4F46E5')
  assert.equal(markColor(null, '#4F46E5'), '#4F46E5')
})

test('the wash goes where it would be a smudge', () => {
  // A wash of a colour over a card already painted in it is a smudge.
  assert.equal(kpiSurface('solid').onFill, true)
  assert.equal(kpiSurface('gradient').onFill, true)
  assert.equal(kpiSurface('tinted').onFill, false)
  assert.ok(kpi.includes('{!surface.onFill && ('))
})

test('no card has a coloured stripe down its side any more', () => {
  // A stripe is a second statement of what the wash and the figure
  // already make. The field is gone too, not just its use: a theme
  // carrying one nothing reads is a setting that lies about existing.
  assert.equal(kpi.includes('absolute left-0 top-0 h-full w-1'), false)
  for (const theme of THEME_VALUES) {
    assert.equal('rail' in kpiSurface(theme, '#4F46E5'), false, theme)
  }
})

test('every theme gives a ring somewhere to sit', () => {
  // A dial needs an unfilled track, and #f1f5f9 on a near-black card is
  // a white ring nobody asked for.
  for (const theme of THEME_VALUES) {
    assert.ok(kpiSurface(theme, '#4F46E5').track, theme)
  }
  assert.notEqual(kpiSurface('dark').track, kpiSurface('plain').track)
})

test('the gradient ends somewhere the colour actually goes', () => {
  assert.equal(shade('#808080', -28), '#646464')
  assert.equal(shade('#000000', -28), '#000000', 'clamped rather than wrapped')
  assert.equal(shade('#ffffff', 28), '#ffffff')
  assert.equal(shade('nonsense'), 'nonsense')
  assert.match(kpiSurface('gradient', '#4F46E5').vars['--card-bg'], /^linear-gradient/)
})

test('the up-or-down chip is coloured for what it sits on', () => {
  // Green on a white card, because that is what green means. Green on an
  // orange card is a clash, and reads as a second measurement.
  const up = deltaOf(120, { target: 100 })
  assert.equal(deltaChip(up, kpiSurface('plain')).color, '#15803d')
  assert.equal(deltaChip(deltaOf(80, { target: 100 }), kpiSurface('plain')).color, '#be123c')
  assert.equal(deltaChip(up, kpiSurface('solid', '#4F46E5')).color, '#ffffff')
  assert.equal(deltaChip(up, kpiSurface('dark')).color, '#f8fafc')
  assert.equal(deltaChip(null, kpiSurface('plain')), undefined)
})

// --- the new shapes ------------------------------------------------------

test('the shapes that existed still are what they were', () => {
  // Nothing above 'inline' moved, so no stored card changes its look.
  const first = KPI_SHAPES.slice(0, 7).map((s) => s.value)
  assert.deepEqual(first, ['classic', 'centred', 'ring', 'badge', 'gauge', 'arc', 'side'])
  for (const shape of ['inline', 'stat', 'bar', 'segment', 'needle']) {
    assert.ok(KPI_SHAPES.some((s) => s.value === shape), shape)
    assert.ok(KPI_SHAPES.find((s) => s.value === shape).hint, `${shape} has no hint`)
  }
})

test('the two new dials are dials, and the two new panels are not', () => {
  for (const shape of ['segment', 'needle']) {
    assert.equal(isRound(shape), true, shape)
    assert.equal(isDial(shape), true, shape)
  }
  for (const shape of ['inline', 'stat', 'bar']) {
    assert.equal(isRound(shape), false, shape)
    assert.equal(isDial(shape), false, shape)
  }
  assert.equal(isSegmented('segment'), true)
  assert.equal(isSegmented('ring'), false)
  assert.equal(isNeedle('needle'), true)
  assert.equal(isNeedle('gauge'), false)
  // A needle's dial leaves its bottom quarter open, so its box can lose
  // some of it -- but not as much as an arc, which is half a circle.
  assert.ok(boxRatio('needle') < 1 && boxRatio('needle') > boxRatio('arc'))
})

test('a block lights once the value has REACHED it, never before', () => {
  // Rounding up would show a full set of blocks for a target that was
  // missed, which is the one thing this shape must never do.
  const g = ringGeometry(0.94, 100, 8, 'segment')
  const lit = (f, n = 10) => segmentBlocks(f, g, n).filter((b) => b.on).length
  assert.equal(lit(0.94), 9)
  assert.equal(lit(1), 10)
  assert.equal(lit(0), 0)
  assert.equal(lit(0.099), 0)
  assert.equal(lit(0.1), 1)
})

test('...and the blocks tile the track without overlapping', () => {
  const g = ringGeometry(1, 120, 10, 'segment')
  const blocks = segmentBlocks(1, g, 8)
  assert.equal(blocks.length, 8)
  const step = g.track / 8
  assert.ok(blocks[0].length < step, 'no air between blocks')
  assert.ok(blocks[0].length > 0)
  // Walked round by whole steps, backwards, the way a dash offset counts.
  assert.equal(blocks[0].offset, 0)
  assert.ok(Math.abs(blocks[1].offset + step) < 0.001)
  // A nonsense count is clamped rather than obeyed.
  assert.equal(segmentBlocks(1, g, 0).length, 10)
  assert.equal(segmentBlocks(1, g, 500).length, 24)
  assert.equal(segmentBlocks(1, g, 1).length, 2)
})

test('the needle points where the track says, in the same frame', () => {
  // If the pointer and its track disagreed about where empty is, the
  // dial would read wrong by exactly a quarter turn.
  const empty = needleGeometry(0, 100)
  const half = needleGeometry(0.5, 100)
  const full = needleGeometry(1, 100)
  assert.equal(empty.angle, 135, 'empty is half past seven, where a gauge opens')
  assert.equal(half.angle, 270, 'half is straight up')
  assert.equal(full.angle, 405, 'full is half past four')
  // Straight up means the same x as the hub and a smaller y.
  assert.ok(Math.abs(half.x - half.centre) < 0.001)
  assert.ok(half.y < half.centre)
  assert.ok(half.hub >= 3)
  // Out-of-range values are clamped, not wrapped round the dial again.
  assert.equal(needleGeometry(4, 100).angle, full.angle)
  assert.equal(needleGeometry(-2, 100).angle, empty.angle)
})

// --- the change a stat card reports -------------------------------------

test('the change is measured against the target where there is one', () => {
  // The same order of preference the ring fills by, so a card showing
  // both cannot measure them against different things.
  assert.equal(deltaOf(120, { target: 100, baseline: 200 }).basis, 'target')
  assert.equal(deltaOf(120, { target: 100 }).percent, 20)
  assert.equal(deltaOf(120, { baseline: 200 }).basis, 'unfiltered')
  assert.equal(deltaOf(120, { baseline: 200 }).percent, -40)
})

test('nothing to measure against is nothing, not zero', () => {
  // "On target" and "no target" are different states, and a calm 0% for
  // the second claims to have been measured.
  assert.equal(deltaOf(120, {}), null)
  assert.equal(deltaOf(120, { target: 0 }), null)
  assert.equal(deltaText(null), '')
  // An empty aggregate is a real zero, though -- the card shows 0, so it
  // is 100% short of its target and says so. That is a measurement, not
  // a missing one.
  assert.equal(deltaOf(null, { target: 100 }).percent, -100)
})

test('a hair either side of nothing is level', () => {
  // Two readings differing in the fourth decimal place are one reading.
  assert.equal(deltaOf(100.01, { target: 100 }).dir, 'level')
  assert.equal(deltaOf(100.1, { target: 100 }).dir, 'up')
  assert.equal(deltaOf(99.9, { target: 100 }).dir, 'down')
  assert.equal(deltaText(deltaOf(100.01, { target: 100 })), '0% vs target')
})

test('the change reads as a sentence, with what it is against in it', () => {
  assert.equal(deltaText(deltaOf(120, { target: 100 })), '+20.0% vs target')
  assert.equal(deltaText(deltaOf(80, { baseline: 100 })), '−20.0% vs unfiltered')
  // A big one drops the decimal: "+340%" is the fact, "+340.0%" is noise.
  assert.equal(deltaText(deltaOf(440, { target: 100 })), '+340% vs target')
})

// --- and how it is wired -------------------------------------------------

test('the shape picker is reachable without pasting an image first', () => {
  // It used to live inside a block that only appears once an image URL
  // has been typed -- so a ring, a gauge and a badge, none of which have
  // anything to do with an image, could not be chosen at all.
  const shapeAt = panel.indexOf('onChange={(v) => set({ kpiShape: v })}')
  const imageGate = panel.indexOf('{safeImageUrl(widget.iconUrl) && (')
  assert.ok(shapeAt > 0 && imageGate > 0)
  assert.ok(shapeAt < imageGate, 'the shape picker is still behind the image gate')
})

test('the theme is its own picker, beside the shape', () => {
  assert.ok(panel.includes('onChange={(v) => set({ kpiTheme: v })}'))
  assert.ok(panel.includes('options={KPI_THEMES}'))
  assert.ok(panel.includes('value={themeOf(widget)}'))
  // Every theme says what it is for, or the list is six words.
  for (const theme of KPI_THEMES) assert.ok(theme.hint, theme.value)
})

test('a setting is offered only where it changes something', () => {
  assert.ok(panel.includes('{WANTS_SIZE.includes(widget.kpiShape) && ('))
  assert.ok(panel.includes("{widget.kpiShape === 'segment' && ("))
  // Sizing a circle is for the shapes that have one.
  for (const shape of WANTS_SIZE) assert.ok(isRound(shape), shape)
  assert.equal(WANTS_TARGET.includes('classic'), false)
  assert.equal(WANTS_SIZE.includes('inline'), false)
})

test('the card works its numbers out once, for whichever shape is drawn', () => {
  // A bar and a change measured against different things would be two
  // answers to one question.
  assert.ok(kpi.includes('const fraction = ringFraction(value, { target: widget.kpiTarget, baseline })'))
  assert.ok(kpi.includes('deltaOf(value, { target: widget.kpiTarget, baseline })'))
  assert.ok(kpi.includes('fraction={fraction}'))
})

test('the needle is drawn outside the rotated layer', () => {
  // `needleGeometry` already works in absolute degrees from three
  // o'clock, so putting it inside the rotated svg would turn it twice
  // and point it at the wrong number.
  const round = kpi.slice(kpi.indexOf('function RoundKpi('))
  const rotated = round.indexOf('transform: `rotate(${ring.rotation}deg)`')
  const needle = round.indexOf('{isNeedle(shape) && (')
  assert.ok(rotated > 0 && needle > rotated)
  assert.ok(round.includes('className="pointer-events-none absolute inset-0"'))
})

test('a segmented dial is one colour, like every other dial', () => {
  // The bug: lit blocks in the accent and the rest in a grey meant a
  // cross-filter -- which moves the value, and so the boundary --
  // visibly changed the card's COLOUR rather than its reading. Every
  // other dial here is one hue at two strengths.
  const round = kpi.slice(kpi.indexOf('function RoundKpi('))
  const blocks = round.slice(round.indexOf('isSegmented(shape) ? ('), round.indexOf('The track first'))
  assert.ok(blocks.includes('stroke={mark}'), 'the blocks are not all one colour')
  assert.equal(blocks.includes('surface.track'), false, 'a second hue is back')
  // The same faint track the other dials draw, so the two families
  // sit together.
  assert.ok(blocks.includes('strokeOpacity={block.on ? 1 : 0.16}'))
  assert.ok(round.includes('strokeOpacity={0.16}'), 'the other dials changed instead')
})

test('...and it animates its reading, never its palette', () => {
  // A hue cross-fading over half a second is what made a filter look
  // like a restyle. The other dials animate their LENGTH.
  const round = kpi.slice(kpi.indexOf('function RoundKpi('))
  assert.equal(round.includes('transition-[stroke]'), false)
  assert.ok(round.includes('transition-opacity'))
  assert.ok(round.includes('transition-[stroke-dashoffset]'), 'the smooth dials stopped animating')
})
