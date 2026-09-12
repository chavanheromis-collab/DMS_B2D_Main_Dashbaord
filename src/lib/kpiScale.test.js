import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { boxScale, kpiScale, lengthFactor, sizeStyle } from './kpiScale.js'
import { NO_COLOUR, drawColour, isColourless, kpiSurface } from './kpiThemes.js'

// ---------------------------------------------------------------------
// A card that fits the box it was dragged to
// ---------------------------------------------------------------------
// Every size on a KPI used to be a constant, which is right for exactly
// one card size: the one it was chosen against. Two things have to hold
// for the sizing to be an improvement rather than a new way to go wrong
// -- it must never overflow, and it must never change a card that has
// not been measured yet.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const kpi = read('components/widgets/KpiWidget.jsx')
const hook = read('hooks/useElementSize.js')
const panel = read('pages/admin/WidgetsPanel.jsx')

const box = (width, height) => ({ width, height })

// --- nothing happens before anything is known ---------------------------

test('an unmeasured card keeps every size it always had', () => {
  // A ResizeObserver has not fired on the first paint. A card that
  // rendered at 14px for one frame and then jumped would flicker on
  // every single page load.
  assert.equal(kpiScale(box(0, 0)), null)
  assert.equal(kpiScale(box(0, 300)), null)
  assert.equal(kpiScale(null), null)
  assert.equal(kpiScale(undefined), null)
  // ...and the component falls back rather than passing nothing on.
  // Written through the role variable, so the measured size is the
  // FALLBACK and an admin who states one in the Look tab is not
  // overridden by an inline style. See scaledFont.
  assert.ok(kpi.includes("fontSize: `var(--wvalue-size, ${scale?.number ? scale.number + 'px' : '1.5rem'})`"))
  assert.ok(kpi.includes('var(--wlabel-size,'))
  assert.ok(kpi.includes('scale?.circle || Math.max(72, Math.min(160, Number(widget.kpiRingSize) || 104))'))
  assert.ok(kpi.includes('scale?.stroke || Math.max(6, Math.round(size / 13))'))
})

test('a style object is undefined rather than empty when there is nothing to say', () => {
  // React treats a fresh empty object as a change on every render, and
  // this is handed to an element that re-renders on every tick of the
  // count-up animation.
  assert.equal(sizeStyle(0), undefined)
  assert.equal(sizeStyle(null), undefined)
  assert.deepEqual(sizeStyle(18), { fontSize: '18px' })
})

// --- how much room there is ---------------------------------------------

test('a wide card counts as roomier than a small square one', () => {
  // The smaller side alone would give a 600x90 strip and a 90x90 square
  // identical type, and the strip plainly has room for more.
  assert.ok(boxScale(box(600, 90)) > boxScale(box(90, 90)))
  // ...but it still leans on the short side: a strip is not as roomy as
  // a square of its own width, or the number would not fit in it.
  assert.ok(boxScale(box(600, 90)) < boxScale(box(600, 600)))
  assert.equal(boxScale(box(0, 100)), 0)
  assert.equal(boxScale(null), 0)
})

test('the number grows with the card, between a floor and a ceiling', () => {
  const small = kpiScale(box(140, 90))
  const medium = kpiScale(box(300, 200))
  const huge = kpiScale(box(1600, 1200))

  assert.ok(small.number < medium.number)
  assert.ok(medium.number < huge.number)
  // Nothing grows for ever: past a point it is a poster of a number.
  assert.ok(huge.number <= 84)
  // The floors are LOW on purpose. A floor is a promise to draw
  // something no smaller than this -- which, in a card too small to
  // hold it, is a promise to overflow. There is no scrollbar to
  // overflow into, so the promise has to be one a tiny card can keep.
  const tiny = kpiScale(box(60, 40))
  assert.ok(tiny.number >= 10 && tiny.number < 20, tiny.number)
  assert.ok(tiny.label >= 7 && tiny.label <= tiny.number, tiny.label)
})

test('a long figure gets smaller type, not a clipped one', () => {
  // "8" and "1,24,85,000" are the same measurement in the same card.
  const short = kpiScale(box(300, 200), { textLength: 1 })
  const long = kpiScale(box(300, 200), { textLength: 12 })
  assert.ok(long.number < short.number)
  assert.equal(lengthFactor(1), 1)
  assert.equal(lengthFactor(4), 1, 'four characters is the reference, not a penalty')
  assert.ok(lengthFactor(8) < 1)
  // Floored: a very long figure in a small card is tight whatever
  // happens, and shrinking it to nothing helps nobody.
  assert.ok(lengthFactor(40) >= 0.38)
  assert.equal(lengthFactor(0), 1)
})

test('the label and the caption stay under the number, at every size', () => {
  for (const [w, h] of [[140, 90], [300, 200], [700, 400], [1600, 1200]]) {
    const scale = kpiScale(box(w, h))
    assert.ok(scale.label < scale.number, `${w}x${h}`)
    assert.ok(scale.caption <= scale.label, `${w}x${h}`)
  }
})

test('a one-line card sizes itself for one line', () => {
  // The title and the figure share the width, so neither can have the
  // height to itself.
  const inline = kpiScale(box(400, 300), { shape: 'inline' })
  const classic = kpiScale(box(400, 300), { shape: 'classic' })
  assert.ok(inline.number < classic.number)
})

// --- the circle ----------------------------------------------------------

test('a dial fills the card it was dragged to', () => {
  const small = kpiScale(box(160, 160), { shape: 'ring' })
  const big = kpiScale(box(520, 420), { shape: 'ring' })
  assert.ok(big.circle > small.circle)
  // It is sized off the SMALLER side, or a wide short card draws a
  // circle taller than the card.
  const strip = kpiScale(box(800, 120), { shape: 'ring' })
  assert.ok(strip.circle <= 120)
  assert.ok(kpiScale(box(3000, 3000), { shape: 'ring' }).circle <= 260)
})

test('a number inside a circle is sized against the circle, not the card', () => {
  // Otherwise a wide card draws a small dial with a number too big to
  // sit in it.
  const round = kpiScale(box(800, 200), { shape: 'ring' })
  assert.ok(round.number < round.circle * 0.5)
})

test('a size the admin typed is a ceiling, not a fixed number', () => {
  // "No bigger than 120" is what somebody typing 120 means. Reading it
  // as "always 120" is what made a card dragged down to a strip draw a
  // dial larger than itself and get cut off -- the card is the harder
  // constraint of the two and has to win.
  assert.equal(kpiScale(box(900, 700), { shape: 'ring', fixed: 120 }).circle, 120)
  const cramped = kpiScale(box(120, 120), { shape: 'ring', fixed: 240 }).circle
  assert.ok(cramped < 240 && cramped <= 120, cramped)

  // Blank, zero and nonsense mean "fit the card".
  const auto = kpiScale(box(400, 400), { shape: 'ring' }).circle
  assert.equal(kpiScale(box(400, 400), { shape: 'ring', fixed: null }).circle, auto)
  assert.equal(kpiScale(box(400, 400), { shape: 'ring', fixed: 0 }).circle, auto)
  assert.equal(kpiScale(box(400, 400), { shape: 'ring', fixed: 'big' }).circle, auto)
  // ...and even a typed one is held inside what can be drawn.
  assert.equal(kpiScale(box(4000, 4000), { shape: 'ring', fixed: 9999 }).circle, 260)
})

test('the circle leaves room for the name under it', () => {
  // Sizing a dial against the whole height is what put a circle and a
  // label into a box with room for only the circle -- and with no
  // scrollbar to hide behind, the label was simply gone.
  const scale = kpiScale(box(200, 200), { shape: 'ring' })
  assert.ok(scale.circle + scale.label * 1.9 <= 200, `${scale.circle} + label overflows 200`)
  for (const [w, h] of [[90, 60], [140, 110], [300, 180], [520, 420]]) {
    const fit = kpiScale(box(w, h), { shape: 'ring' })
    assert.ok(fit.circle <= w, `${w}x${h} is wider than its card`)
    assert.ok(fit.circle + fit.label * 1.9 <= h + 1, `${w}x${h} is taller than its card`)
  }
})

test('the stroke follows the circle', () => {
  assert.ok(kpiScale(box(600, 600), { shape: 'ring' }).stroke > kpiScale(box(120, 120), { shape: 'ring' }).stroke)
  // Thin on a tiny dial, because the alternative is a dial that is all
  // stroke and no track.
  assert.ok(kpiScale(box(60, 60), { shape: 'ring' }).stroke >= 2)
})

// --- measuring it --------------------------------------------------------

test('the card is measured rather than asked to contain itself', () => {
  // `container-type: size` makes an element size-contained on both axes,
  // so its content stops contributing to its height -- which collapses
  // every auto-height card in the app to nothing.
  assert.ok(hook.includes('new ResizeObserver('))
  assert.equal(hook.includes('container-type'), false)
  // Rounded, and only on a real change: an observer fires on sub-pixel
  // changes throughout a drag, and each one would re-render a card
  // whose number is mid-animation.
  assert.ok(hook.includes('if (width === current.width && height === current.height) return current'))
  assert.ok(hook.includes('observer.disconnect()'))
  // A browser without one is not a broken card.
  assert.ok(hook.includes("typeof ResizeObserver === 'undefined'"))
})

test('the card hands its own box to the measurement', () => {
  assert.ok(kpi.includes('const { ref: boxRef, width: boxW, height: boxH } = useElementSize()'))
  assert.ok(kpi.includes('ref={boxRef}'))
  assert.ok(kpi.includes('kpiScale( { width: boxW, height: boxH },'))
  // ...and says whether that height is one the card was GIVEN.
  assert.ok(kpi.includes('sized: fillHeight'))
  assert.ok(kpi.includes('fillHeight = false,'))
})

test('a card with no height of its own is not measured for one', () => {
  // The loop this avoids: on a card whose height comes from its
  // contents, bigger type makes a taller card, which asks for bigger
  // type. It settles, but somewhere arbitrary, and visibly.
  const auto = kpiScale({ width: 320, height: 900 }, { sized: false })
  const alsoAuto = kpiScale({ width: 320, height: 120 }, { sized: false })
  assert.deepEqual(auto, alsoAuto, 'the measured height leaked in')
  // It is still sized -- by the width, which nothing inside the card
  // can move.
  const wider = kpiScale({ width: 640, height: 120 }, { sized: false })
  assert.ok(wider.number > auto.number)
  // And a card that WAS given a height uses it.
  const tall = kpiScale({ width: 320, height: 900 }, { sized: true })
  assert.ok(tall.number > auto.number)
})

test('the figure is formatted once and read everywhere', () => {
  // It has to be, now that the type is sized against its length: a
  // second copy formatted differently would be sized for a string that
  // is not the one on screen.
  assert.ok(kpi.includes('const shown = formatNumber('))
  assert.ok((kpi.match(/\{shown\}/g) || []).length >= 6)
})

// --- no colour at all ----------------------------------------------------

test('a card can be given no colour, which is a real thing to want', () => {
  // A page of eight cards each with a coloured rail and a tinted wash
  // is a page with no emphasis left to give.
  assert.equal(isColourless(NO_COLOUR), true)
  assert.equal(isColourless('#4F46E5'), false)
  assert.equal(isColourless(''), false)
  assert.equal(isColourless(null), false)
})

test('no colour still draws a visible ring', () => {
  // "No colour" means "not a statement", not "invisible": a dial that
  // cannot be seen is not a quieter card, it is a broken one.
  assert.equal(drawColour(NO_COLOUR), '#64748b')
  assert.equal(drawColour('#4F46E5'), '#4F46E5')
  assert.equal(drawColour(''), '#4F46E5')
  assert.equal(drawColour('', '#000'), '#000')
})

test('what disappears is the wash', () => {
  const none = kpiSurface('plain', NO_COLOUR)
  assert.equal(none.colourless, true)
  assert.equal(none.onFill, false)
  // The component drops the wash on anything that has no colour of its
  // own to wash with.
  assert.ok(kpi.includes('{!surface.onFill && ('))
})

test('there is no coloured stripe down the side of a card', () => {
  // A stripe is a second statement of what the wash and the figure
  // already make, and on a row of cards it reads as a table of
  // contents nobody asked for.
  assert.equal(kpi.includes('absolute left-0 top-0 h-full w-1'), false)
  assert.equal(kpi.includes('surface.rail'), false)
  const themes = read('lib/kpiThemes.js')
  assert.equal(/\brail\b/.test(themes), false, 'a field nothing reads is a setting that lies')
})

test('a solid card of no colour is a plain card, not an invisible one', () => {
  // "Solid, in nothing" has one honest reading.
  const solid = kpiSurface('solid', NO_COLOUR)
  assert.deepEqual(solid.vars, {})
  assert.equal(solid.onFill, false)
  // Dark still works, because its surface was never the accent.
  const dark = kpiSurface('dark', NO_COLOUR)
  assert.equal(dark.vars['--card-bg'], '#0f172a')
  assert.match(dark.className, /card-invert/)
  // ...and every theme still gives a ring somewhere to sit.
  for (const theme of ['plain', 'tinted', 'outline', 'solid', 'gradient', 'dark']) {
    assert.ok(kpiSurface(theme, NO_COLOUR).track, theme)
  }
})

test('a KPI never shows a scrollbar', () => {
  // `.widget-sized > .card` is `overflow: auto`, which is right for a
  // table and wrong for a KPI: it has no body to scroll, it is one
  // figure that is supposed to fit. The utility on the card is one
  // class and loses to that two-class rule, so the rule names both.
  const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')
  assert.ok(kpi.includes('card kpi-card group relative overflow-hidden'))
  // THREE selectors, because there are three ways a card gets its
  // height and two of them set overflow of their own. Naming one is
  // why this worked on some KPIs and not others: a widget on the
  // canvas goes through `.widget-fit`, whose rule is further down the
  // file and won the tie on order alone.
  for (const selector of [
    '.widget-fit > * > .card.kpi-card',
    '.widget-sized > .card.kpi-card',
    '.card.kpi-card',
  ]) {
    assert.ok(css.includes(selector), `nothing stops ${selector} scrolling`)
  }
  // Each names the card class as well as the container, or the
  // container's own two-class rule outranks it.
  for (const container of ['.widget-fit > * > .card {', '.widget-sized > .card {']) {
    const at = css.indexOf(container)
    if (at === -1) continue
    assert.ok(css.slice(at, at + 700).includes('overflow: auto'), container)
  }
})

test('the admin can reach it, since a colour input cannot express it', () => {
  // `<input type="color">` has no empty state at all.
  assert.ok(panel.includes('set({ color: isColourless(widget.color) ? PALETTE[0] : NO_COLOUR })'))
  assert.ok(panel.includes('disabled={isColourless(widget.color)}'))
  assert.ok(panel.includes('aria-pressed={isColourless(widget.color)}'))
})

test('and the circle size says that blank means fit', () => {
  assert.ok(panel.includes('placeholder="fit the card"'))
  assert.ok(panel.includes("onChange={(v) => set({ kpiRingSize: v === '' ? null : Number(v) || null })}"))
})
