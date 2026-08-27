import test from 'node:test'
import assert from 'node:assert/strict'

import { inkOn, legendSwatches, luminance, mixColor, parseHex, stepColor, valueColor } from './heatColor.js'
import { HEAT_SCALES } from './config.js'

const channels = (rgb) => rgb.match(/\d+/g).map(Number)

// --- parsing -------------------------------------------------------------

test('both hex lengths parse, and anything else is black rather than NaN', () => {
  assert.deepEqual(parseHex('#4F46E5'), [79, 70, 229])
  assert.deepEqual(parseHex('4F46E5'), [79, 70, 229])
  assert.deepEqual(parseHex('#abc'), [170, 187, 204])
  assert.deepEqual(parseHex('nonsense'), [0, 0, 0])
  assert.deepEqual(parseHex(null), [0, 0, 0])
})

// --- mixing --------------------------------------------------------------

test('the ends of a mix are the colours themselves', () => {
  assert.deepEqual(channels(mixColor('#000000', '#FFFFFF', 0)), [0, 0, 0])
  assert.deepEqual(channels(mixColor('#000000', '#FFFFFF', 1)), [255, 255, 255])
  assert.deepEqual(channels(mixColor('#000000', '#FFFFFF', 0.5)), [128, 128, 128])
})

test('a mix outside 0..1 is clamped rather than extrapolated', () => {
  assert.deepEqual(channels(mixColor('#000000', '#FFFFFF', -3)), [0, 0, 0])
  assert.deepEqual(channels(mixColor('#000000', '#FFFFFF', 9)), [255, 255, 255])
  assert.deepEqual(channels(mixColor('#000000', '#FFFFFF', NaN)), [0, 0, 0])
})

test('every channel stays a real colour value', () => {
  for (const scale of HEAT_SCALES) {
    for (const t of [0, 0.13, 0.5, 0.87, 1]) {
      for (const c of channels(mixColor(scale.from, scale.to, t))) {
        assert.ok(Number.isInteger(c) && c >= 0 && c <= 255, `${scale.value} at ${t}`)
      }
    }
  }
})

// --- contrast ------------------------------------------------------------

test('luminance weights green the way the eye does', () => {
  // A plain average of the channels calls pure blue mid-bright and then
  // puts dark text on something almost black.
  assert.ok(luminance('#00FF00') > luminance('#0000FF'))
  assert.equal(luminance('#000000'), 0)
  assert.equal(luminance('#FFFFFF'), 1)
})

test('luminance reads an rgb() string as well as a hex one', () => {
  assert.equal(luminance('rgb(255, 255, 255)'), 1)
  assert.equal(luminance('rgb(0, 0, 0)'), 0)
})

test('the ink on a cell is whichever survives on it', () => {
  assert.equal(inkOn('#FFFFFF'), '#334155')
  assert.equal(inkOn('#0F172A'), '#FFFFFF')
  assert.equal(inkOn('#0000FF'), '#FFFFFF', 'a saturated blue is dark, whatever it looks like')
})

test('every step of every ramp gets text that can be read on it', () => {
  for (const scale of HEAT_SCALES) {
    for (let step = 0; step < 5; step += 1) {
      const bg = stepColor(step, 5, scale.value)
      const ink = inkOn(bg)
      const contrast = Math.abs(luminance(bg) - luminance(ink))
      assert.ok(contrast > 0.25, `${scale.value} step ${step}: ${bg} under ${ink}`)
    }
  }
})

// --- steps ---------------------------------------------------------------

test('step zero is “nothing here”, not the palest shade', () => {
  // A faint tint on an empty cell is how a grid ends up looking uniformly
  // busy when half of it is nothing at all.
  assert.equal(stepColor(0, 5, 'emerald'), '#F1F5F9')
  assert.notEqual(stepColor(1, 5, 'emerald'), '#F1F5F9')
})

test('the first live step is clear of the background', () => {
  const first = stepColor(1, 5, 'indigo')
  const empty = stepColor(0, 5, 'indigo')
  assert.ok(Math.abs(luminance(first) - luminance(empty)) > 0.08, '"one" is visible at a glance, not a hunt')
})

test('the shades get stronger, monotonically', () => {
  for (const scale of HEAT_SCALES) {
    const shades = legendSwatches(6, scale.value).slice(1).map(luminance)
    for (let i = 1; i < shades.length; i += 1) {
      assert.ok(shades[i] <= shades[i - 1] + 0.001, `${scale.value} step ${i} is not lighter than the one before`)
    }
  }
})

test('a step off either end is clamped rather than undefined', () => {
  assert.equal(stepColor(-4, 5, 'indigo'), stepColor(0, 5, 'indigo'))
  assert.equal(stepColor(99, 5, 'indigo'), stepColor(4, 5, 'indigo'))
})

test('the number of shades is clamped to what anybody could count', () => {
  assert.equal(legendSwatches(1, 'indigo').length, 2)
  assert.equal(legendSwatches(99, 'indigo').length, 9)
  assert.equal(legendSwatches(5, 'indigo').length, 5)
})

// --- continuous ----------------------------------------------------------

test('a continuous value of zero is empty, and the max is full strength', () => {
  assert.equal(valueColor(0, 100, 'indigo'), '#F1F5F9')
  assert.equal(valueColor(-5, 100, 'indigo'), '#F1F5F9')
  assert.equal(valueColor(50, 0, 'indigo'), '#F1F5F9', 'no max means no scale')
  assert.deepEqual(channels(valueColor(100, 100, 'indigo')), channels(mixColor('#EEF2FF', '#4338CA', 1)))
})

test('an unknown ramp falls back to a real one rather than to undefined', () => {
  assert.ok(stepColor(2, 5, 'no-such-ramp').startsWith('rgb('))
  assert.ok(valueColor(5, 10, 'no-such-ramp').startsWith('rgb('))
})
