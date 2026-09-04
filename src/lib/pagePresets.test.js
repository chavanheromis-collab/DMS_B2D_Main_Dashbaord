import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  PAGE_PRESETS,
  applyPreset,
  currentPreset,
  presetByValue,
  presetMatches,
} from './pagePresets.js'
import { backgroundLayers, luminance, usesLightText } from './pageBackground.js'
import { clampDesign } from './pageDesign.js'
import { chartVisualClass } from './chartVisuals.js'

const SRC = path.resolve(import.meta.dirname, '..')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')

const byValue = (v) => PAGE_PRESETS.find((p) => p.value === v)

// --- every preset is a whole look ---------------------------------------

test('every preset is named, identified and previewable', () => {
  const seen = new Set()
  for (const p of PAGE_PRESETS) {
    assert.ok(p.value && p.label && p.hint, `${p.value}: half a preset`)
    assert.ok(!seen.has(p.value), `${p.value} twice`)
    seen.add(p.value)
    // The swatch is what an admin picks from. Without it the row is three
    // words of prose and no idea what the page will look like.
    assert.equal(p.swatch.length, 3, `${p.value}: swatch`)
    for (const c of p.swatch) assert.match(c, /^#[0-9A-Fa-f]{6}$/, `${p.value}: ${c}`)
  }
})

test('every preset paints a ground and does not paint nothing', () => {
  for (const p of PAGE_PRESETS) {
    const layers = backgroundLayers(p.background)
    // Paper is the app default, which deliberately renders no layer at all.
    if (p.value === 'paper') {
      assert.equal(layers, null)
      continue
    }
    assert.ok(layers?.base?.background, `${p.value} renders nothing`)
    assert.ok(!/undefined|NaN/.test(layers.base.background), `${p.value}: ${layers.base.background}`)
  }
})

test('a dark ground asks for light writing over it', () => {
  // The failure is invisible to whoever ships it and total for whoever
  // picks the preset: slate text on deep indigo.
  for (const value of ['infographic-indigo', 'showcase-black', 'showcase-graphite']) {
    assert.equal(usesLightText(byValue(value).background), true, `${value} keeps dark text`)
  }
  for (const value of ['infographic-coral', 'paper']) {
    assert.equal(usesLightText(byValue(value).background), false, `${value} flips to light text`)
  }
})

test('no preset pins text that cannot be read on its own ground', () => {
  // The bug this caught: both Showcase presets pinned DARK text on a
  // near-black gradient. The page chrome -- the heading, the tab strip, the
  // arrange bar -- sits directly on that ground, so it was slate on black:
  // present, correct, and invisible. Pinning is still right (a page whose
  // text flips when somebody nudges the angle is worse), but it has to be
  // pinned to the side the ground is actually on.
  //
  // Measured rather than listed, so the next preset is covered by the same
  // rule without anybody remembering to add it here.
  for (const p of PAGE_PRESETS) {
    const bg = p.background
    const ink = usesLightText(bg)
    const lit =
      bg.mode === 'gradient'
        ? (luminance(bg.gradientFrom) + luminance(bg.gradientTo)) / 2
        : bg.mode === 'color'
          ? luminance(bg.color)
          : null
    if (lit === null) continue
    // The same threshold `auto` uses. A preset may pin its text, but not
    // to the wrong side of this.
    assert.equal(ink, lit < 0.42, `${p.value}: ${ink ? 'light' : 'dark'} text on a ground of ${lit.toFixed(3)}`)
  }
})

test('every card surface a preset writes survives being clamped', () => {
  // A radius of 60 or a padding of -4 is saved happily and then quietly
  // adjusted on the way out, so the page never looks like its own preview.
  for (const p of PAGE_PRESETS) {
    const applied = applyPreset(p, {}).design
    const clamped = clampDesign(applied)
    for (const key of ['cardRadius', 'cardPadding', 'gapX', 'gapY']) {
      if (applied[key] === undefined) continue
      assert.equal(clamped[key], applied[key], `${p.value}: ${key} is clamped away from ${applied[key]}`)
    }
  }
})

// --- pressing one -------------------------------------------------------

test('a preset shows as chosen the instant it is pressed', () => {
  // The round trip that makes the button feel like a button. It is also the
  // one that broke when a preset first carried an object: two identical
  // chart looks are never the same object, so `!==` said "not this one".
  for (const p of PAGE_PRESETS) {
    const state = applyPreset(p, { background: { mode: 'color', color: '#123456' }, design: { gapX: 3 } })
    assert.equal(currentPreset(state), p.value, `${p.value} does not recognise itself`)
    assert.ok(presetMatches(p, state))
  }
})

test('one preset can be pressed after another, both ways', () => {
  // Presets that only stack up are presets you cannot undo.
  let state = applyPreset('infographic-indigo', {})
  assert.equal(currentPreset(state), 'infographic-indigo')
  state = applyPreset('paper', state)
  assert.equal(currentPreset(state), 'paper')
  state = applyPreset('showcase-black', state)
  assert.equal(currentPreset(state), 'showcase-black')
})

test('paper puts the marks back down again', () => {
  // The infographic look raises them. If nothing lowers them, the raised
  // shadow is a one-way door and the only way out is field by field.
  const raised = applyPreset('infographic-indigo', {}).design
  assert.ok(chartVisualClass(raised.chartVisuals).includes('cv-depth'))
  const flat = applyPreset('paper', { design: raised }).design
  assert.ok(!chartVisualClass(flat.chartVisuals).includes('cv-depth'), 'paper leaves the marks raised')
})

test('a preset keeps its hands off what it has no opinion about', () => {
  const before = { fontFamily: 'Georgia', fontScale: 1.2, maxWidth: 1600, titleColor: '#FF0000' }
  const after = applyPreset('infographic-indigo', { design: before }).design
  for (const [k, v] of Object.entries(before)) assert.equal(after[k], v, `${k} was overwritten`)
})

test('an unknown preset changes nothing at all', () => {
  const state = { background: { mode: 'color', color: '#abcdef' }, design: { gapX: 5 } }
  assert.deepEqual(applyPreset('no-such-look', state), state)
  assert.deepEqual(applyPreset(null, state), state)
  assert.equal(presetByValue('no-such-look'), null)
  assert.equal(presetMatches('no-such-look', state), false)
})

test('repainting either half takes the preset off', () => {
  // Both halves, because a preset that only checks its cards would call a
  // page with the infographic surface on a photograph "infographic" -- and
  // then pressing the button, which is meant to fix that, would look like
  // it had done nothing.
  const state = applyPreset('infographic-indigo', {})
  assert.equal(currentPreset(state), 'infographic-indigo')

  const ground = { ...state, background: { ...state.background, gradientFrom: '#7C2D12' } }
  assert.equal(currentPreset(ground), '', 'a repainted ground still counts as the preset')

  const cards = { ...state, design: { ...state.design, cardBg: '#000000' } }
  assert.equal(currentPreset(cards), '', 'a recoloured card still counts as the preset')
})

test('a page nobody has pressed anything on is not wearing a preset', () => {
  assert.equal(currentPreset({ background: { mode: 'color', color: '#903030' }, design: {} }), '')
})

test('two pages wearing one preset do not share its innards', () => {
  // The patch is spread, so without a copy both pages would hold the SAME
  // chart-visuals object -- and editing one page would edit the other, and
  // the preset itself, for the rest of the session.
  const a = applyPreset('infographic-indigo', {}).design
  const b = applyPreset('infographic-indigo', {}).design
  assert.notEqual(a.chartVisuals, b.chartVisuals)
  a.chartVisuals.markDepth = 3
  assert.notEqual(b.chartVisuals.markDepth, 3)
  assert.notEqual(byValue('infographic-indigo').design.chartVisuals.markDepth, 3)
})

// --- and it is reachable ------------------------------------------------

test('the presets are offered, and pressing one writes both halves', () => {
  const panel = read('pages/admin/PagesPanel.jsx')
  assert.ok(panel.includes('PAGE_PRESETS.map'), 'the row is not rendered')
  assert.ok(panel.includes('applyPreset(preset'), 'pressing one does nothing')
  assert.ok(panel.includes('currentPreset('), 'nothing is ever shown as chosen')
})

test('the infographic chart look is the chart preset, not a second copy of it', () => {
  // Two hand-written "raised" looks would drift, and the one in the pages
  // panel is the copy nobody would remember to update.
  const src = read('lib/pagePresets.js')
  assert.ok(src.includes("chartLook('raised')"))
  assert.ok(!/markDepth:\s*\d/.test(src), 'the depth is written out by hand here as well')
})
