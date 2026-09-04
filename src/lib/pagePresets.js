// ---------------------------------------------------------------------
// A whole page look, in one press
// ---------------------------------------------------------------------
// Everything here is already settable one field at a time -- the canvas
// background, the card surface, the text, the gaps. What was missing is the
// FIRST press: eleven fields, each individually reasonable, that have to
// agree with each other before a page looks like anything.
//
// A preset is not a mode. It writes the ordinary fields and then gets out of
// the way, so the next thing an admin nudges behaves exactly as it always
// did. Nothing reads "which preset is this page on", because a page that
// remembers a preset is a page that fights you when you change one colour.
//
// The showcase look is the reason this exists: a dark full-bleed ground,
// glassy cards floating on it, one large object and its numbers. It is a
// report you present rather than one you scroll, and it needs the surface
// and the type to move together.

import { DEFAULT_BACKGROUND } from './pageBackground.js'
import { CHART_VISUAL_PRESETS, DEFAULT_CHART_VISUALS } from './chartVisuals.js'

/**
 * The chart look a preset wants, taken from the chart presets rather than
 * written out again here. Two copies of "raised" would drift, and the one
 * in the pages panel would be the copy nobody remembered to update.
 */
const chartLook = (value) => {
  const hit = CHART_VISUAL_PRESETS.find((p) => p.value === value)
  return hit ? { ...DEFAULT_CHART_VISUALS, ...hit.preset } : { ...DEFAULT_CHART_VISUALS }
}

/**
 * `background` and `design` patches, applied together.
 *
 * Both, because the halves are meaningless apart: pale cards on a black
 * ground is not a dark theme, it is an unreadable one.
 */
export const PAGE_PRESETS = [
  {
    value: 'showcase-black',
    label: 'Showcase — black',
    hint: 'Full-bleed black, glass cards, big numbers. For a page you present.',
    swatch: ['#050506', '#141418', '#3f3f46'],
    background: {
      mode: 'gradient',
      gradientFrom: '#08080B',
      gradientTo: '#161620',
      angle: 165,
      opacity: 100,
      overlayOpacity: 0,
      // Pinned rather than worked out, so nudging the angle or the second
      // colour can never flip the heading to slate on near-black.
      textMode: 'light',
      fixed: true,
    },
    design: {
      // Glass, the way the reference does it: a lift off the ground rather
      // than a box drawn on it.
      cardBg: 'rgba(255,255,255,0.05)',
      cardBorder: 'rgba(255,255,255,0.12)',
      cardRadius: 18,
      cardPadding: 18,
      // Room to breathe. A showcase page has fewer things on it and they
      // are meant to be looked at one at a time.
      gapX: 18,
      gapY: 18,
    },
  },
  {
    value: 'showcase-graphite',
    label: 'Showcase — graphite',
    hint: 'The same, a shade lighter. Kinder to photographs with dark edges.',
    swatch: ['#101014', '#1c1c22', '#52525b'],
    background: {
      mode: 'gradient',
      gradientFrom: '#101014',
      gradientTo: '#23232C',
      angle: 165,
      opacity: 100,
      overlayOpacity: 0,
      textMode: 'light',
      fixed: true,
    },
    design: {
      cardBg: 'rgba(255,255,255,0.06)',
      cardBorder: 'rgba(255,255,255,0.14)',
      cardRadius: 18,
      cardPadding: 18,
      gapX: 18,
      gapY: 18,
    },
  },
  {
    value: 'infographic-indigo',
    label: 'Infographic — indigo',
    hint: 'Deep indigo ground, white cards well spaced, marks raised off them.',
    swatch: ['#1B2559', '#FFFFFF', '#F97362'],
    background: {
      mode: 'gradient',
      gradientFrom: '#1B2559',
      gradientTo: '#2D3E7E',
      angle: 165,
      opacity: 100,
      overlayOpacity: 0,
      // Light, and pinned: both ends of this gradient are dark, so `auto`
      // would agree -- but a page that re-decides its own text colour when
      // somebody nudges the angle is a page that surprises people.
      textMode: 'light',
      fixed: true,
    },
    design: {
      // Opaque white, not glass. The whole look is paper panels laid on a
      // coloured board; a translucent card would take the indigo up into
      // the charts and lose the contrast the style is built on.
      cardBg: '#FFFFFF',
      cardBorder: 'rgba(15,23,42,0.06)',
      cardRadius: 20,
      cardPadding: 18,
      gapX: 16,
      gapY: 16,
      chartVisuals: chartLook('raised'),
    },
  },
  {
    value: 'infographic-coral',
    label: 'Infographic — coral',
    hint: 'The same panels on a warm pale field, for a page read up close.',
    swatch: ['#FFF1F2', '#FFFFFF', '#F97362'],
    background: {
      mode: 'gradient',
      gradientFrom: '#FFF1F2',
      gradientTo: '#FFE4E6',
      angle: 150,
      opacity: 100,
      overlayOpacity: 0,
      textMode: 'dark',
      fixed: true,
    },
    design: {
      cardBg: '#FFFFFF',
      cardBorder: 'rgba(15,23,42,0.05)',
      cardRadius: 20,
      cardPadding: 18,
      gapX: 16,
      gapY: 16,
      chartVisuals: chartLook('raised'),
    },
  },
  {
    value: 'paper',
    label: 'Paper',
    hint: 'The stock look. Light ground, white cards, flat marks.',
    swatch: ['#F8FAFC', '#FFFFFF', '#CBD5E1'],
    background: { ...DEFAULT_BACKGROUND },
    design: {
      cardBg: null,
      cardBorder: null,
      cardRadius: null,
      cardPadding: null,
      gapX: 12,
      gapY: 12,
      // Paper is the way back. A preset that can raise the marks and no
      // preset that can put them down again is a door that only opens.
      chartVisuals: { ...DEFAULT_CHART_VISUALS },
    },
  },
]

export function presetByValue(value) {
  return PAGE_PRESETS.find((p) => p.value === value) || null
}

/**
 * The two patches a preset applies.
 *
 * Merged onto what is already there rather than replacing it: a preset
 * decides the ground, the surface and -- where the marks are part of the
 * look rather than just sitting on it -- how the charts are drawn. It has
 * no opinion about the fonts or the max width somebody has already chosen.
 *
 * The patch is copied a level deep on the way out, so two pages wearing the
 * same preset don't end up sharing one chart-visuals object between them.
 */
export function applyPreset(preset, { background, design } = {}) {
  const p = typeof preset === 'string' ? presetByValue(preset) : preset
  if (!p) return { background, design }
  return {
    background: { ...DEFAULT_BACKGROUND, ...(background || {}), ...copy(p.background) },
    design: { ...(design || {}), ...copy(p.design) },
  }
}

/** A patch, with its nested objects detached from the preset's own. */
const copy = (patch) =>
  Object.fromEntries(
    Object.entries(patch).map(([k, v]) => [k, v && typeof v === 'object' ? { ...v } : v])
  )

/**
 * Are these the same setting?
 *
 * Structural rather than `!==`, because a preset can now carry an object
 * and two identical chart looks are never the same object -- which would
 * have left the infographic presets unable to show as selected the instant
 * after they were pressed.
 */
function same(a, b) {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((k) => same(a[k], b[k]))
}

/**
 * Is this page already wearing this preset?
 *
 * Compares only the fields the preset SETS. A page that matches the
 * showcase surface and has had its font changed is still wearing the
 * showcase -- otherwise the highlight would vanish the moment anybody
 * touched anything, which teaches people the button did not work.
 */
export function presetMatches(preset, { background, design } = {}) {
  const p = typeof preset === 'string' ? presetByValue(preset) : preset
  if (!p) return false
  const bg = { ...DEFAULT_BACKGROUND, ...(background || {}) }
  // Both halves through one comparison, deliberately. Two loops with two
  // copies of "is this the same" is how one of them ends up structural and
  // the other one `!==`, and then half a preset stops recognising itself.
  for (const [patch, state] of [[p.background, bg], [p.design, design || {}]]) {
    for (const [k, v] of Object.entries(patch)) {
      if (!same(state[k], v)) return false
    }
  }
  return true
}

/** Which preset a page is wearing, or '' for one that has been made its own. */
export function currentPreset(state) {
  const hit = PAGE_PRESETS.find((p) => presetMatches(p, state))
  return hit ? hit.value : ''
}
