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
      // Pinned, not worked out: the gradient's two ends land either side of
      // whatever threshold `auto` uses, and a page whose text colour flips
      // halfway down is worse than one that is simply told.
      textMode: 'dark',
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
      textMode: 'dark',
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
    value: 'paper',
    label: 'Paper',
    hint: 'The stock look. Light ground, white cards.',
    swatch: ['#F8FAFC', '#FFFFFF', '#CBD5E1'],
    background: { ...DEFAULT_BACKGROUND },
    design: {
      cardBg: null,
      cardBorder: null,
      cardRadius: null,
      cardPadding: null,
      gapX: 12,
      gapY: 12,
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
 * decides the surface and the ground, and has no opinion about the fonts,
 * the chart visuals or the max width somebody has already chosen.
 */
export function applyPreset(preset, { background, design } = {}) {
  const p = typeof preset === 'string' ? presetByValue(preset) : preset
  if (!p) return { background, design }
  return {
    background: { ...DEFAULT_BACKGROUND, ...(background || {}), ...p.background },
    design: { ...(design || {}), ...p.design },
  }
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
  for (const [k, v] of Object.entries(p.background)) {
    if (bg[k] !== v) return false
  }
  for (const [k, v] of Object.entries(p.design)) {
    if ((design || {})[k] !== v) return false
  }
  return true
}

/** Which preset a page is wearing, or '' for one that has been made its own. */
export function currentPreset(state) {
  const hit = PAGE_PRESETS.find((p) => presetMatches(p, state))
  return hit ? hit.value : ''
}
