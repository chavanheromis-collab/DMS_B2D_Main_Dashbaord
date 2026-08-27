// ---------------------------------------------------------------------
// One ramp, shared by everything that shades a cell
// ---------------------------------------------------------------------
// The heat map, the calendar and the cohort grid all answer the same
// question -- "how strong is this cell?" -- and all three must answer it
// the same way, or the same number is two different colours on one page
// and the reader learns to distrust the shading.
//
// The ramps themselves live in config.js next to the other named lists.
// What lives here is the arithmetic that turns one into a colour, plus the
// contrast rule that decides whether the text on top of it is dark or
// light. That rule is the reason this is a module rather than a one-liner
// repeated three times: getting it wrong produces text nobody can read,
// and it is exactly the kind of thing that gets copied and then fixed in
// only one of the copies.

import { HEAT_SCALES } from './config.js'

/** A `#rgb` or `#rrggbb` as three channels. Anything else reads as black. */
export function parseHex(hex) {
  const s = String(hex || '').trim().replace('#', '')
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [0, 0, 0]
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

/** Two colours blended, `t` running 0 → 1 from the first to the second. */
export function mixColor(from, to, t) {
  const a = parseHex(from)
  const b = parseHex(to)
  const k = Math.max(0, Math.min(1, Number(t) || 0))
  const channel = (i) => Math.round(a[i] + (b[i] - a[i]) * k)
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`
}

/** A named ramp, falling back to the first one rather than to undefined. */
export function heatScale(name) {
  return HEAT_SCALES.find((s) => s.value === name) || HEAT_SCALES[0]
}

/**
 * Perceived lightness, 0 (black) to 1 (white).
 *
 * The weights are the standard luma coefficients rather than a plain
 * average of the channels: the eye is far more sensitive to green than to
 * blue, so an average calls pure blue "mid-bright" and puts dark text on
 * something almost black.
 */
export function luminance(color) {
  const [r, g, b] = typeof color === 'string' && color.startsWith('rgb')
    ? color.match(/\d+/g).slice(0, 3).map(Number)
    : parseHex(color)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** Dark ink or light, whichever survives on this background. */
export function inkOn(background, { dark = '#334155', light = '#FFFFFF' } = {}) {
  return luminance(background) > 0.62 ? dark : light
}

/**
 * The colour for a step on an N-step ramp.
 *
 * Step 0 is deliberately NOT the pale end of the ramp -- it is "nothing
 * here", and it gets a neutral so that an empty cell reads as empty rather
 * than as a small amount. Every other step is spaced evenly from a light
 * starting point up to the ramp's full strength, and the first live step
 * starts well clear of the background so that "one" is visible at a
 * glance rather than a tint you have to hunt for.
 */
export function stepColor(step, steps, scaleName, emptyColor = '#F1F5F9') {
  const n = Math.max(2, Math.min(9, Math.round(steps) || 5))
  const index = Math.max(0, Math.min(n - 1, Math.round(step) || 0))
  if (index === 0) return emptyColor
  const scale = heatScale(scaleName)
  const t = 0.22 + (index / (n - 1)) * 0.78
  return mixColor(scale.from, scale.to, t)
}

/** A continuous shade for a value on a 0..max range. */
export function valueColor(value, max, scaleName, emptyColor = '#F1F5F9') {
  if (!(max > 0) || !Number.isFinite(value) || value <= 0) return emptyColor
  const scale = heatScale(scaleName)
  return mixColor(scale.from, scale.to, Math.min(1, value / max))
}

/** The swatches for a legend, palest to strongest. */
export function legendSwatches(steps, scaleName, emptyColor = '#F1F5F9') {
  const n = Math.max(2, Math.min(9, Math.round(steps) || 5))
  return Array.from({ length: n }, (_, i) => stepColor(i, n, scaleName, emptyColor))
}
