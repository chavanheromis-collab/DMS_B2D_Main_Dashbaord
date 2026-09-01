// ---------------------------------------------------------------------
// What the entrance looks like
// ---------------------------------------------------------------------
// The splash was one fixed look: near-black, an indigo orb and a teal one.
// That suits a lot of businesses and clashes with plenty of others, and the
// entrance is the one screen whose whole job is to look like WHOSE
// dashboard this is.
//
// A theme is a set of colours, nothing more. The animation, the timings and
// the layout are the same in all of them -- what changes is the ground the
// wordmark sits on and the two drifting fields behind it. They are applied
// as CSS custom properties on the splash root, so the stylesheet keeps
// owning the motion and this file never grows a keyframe.
//
// Each theme declares whether it is DARK, and that is not decoration: it
// decides the text colours, and it is what the logo backdrop needs to know.
// A logo saved as transparent-on-nothing is drawn in whatever ink the
// designer chose, and dark ink on a dark ground is an invisible logo. See
// `LOGO_BACKDROPS`.

/**
 * Ten grounds for a wordmark.
 *
 * Eight dark and two light, because an entrance is usually a dark screen --
 * but a business whose identity is a light one should not have to accept a
 * black rectangle for the sake of it.
 */
export const ENTRANCE_THEMES = [
  {
    value: 'midnight',
    label: 'Midnight',
    hint: 'Near-black with indigo and teal. The original.',
    dark: true,
    bg: '#020617',
    orbA: 'rgba(99, 102, 241, 0.5)',
    orbB: 'rgba(45, 212, 191, 0.4)',
    grid: 'rgba(148, 163, 184, 0.07)',
    rule: '#818cf8',
  },
  {
    value: 'royal',
    label: 'Royal',
    hint: 'Deep violet, with fuchsia.',
    dark: true,
    bg: '#1a0b2e',
    orbA: 'rgba(168, 85, 247, 0.5)',
    orbB: 'rgba(236, 72, 153, 0.38)',
    grid: 'rgba(216, 180, 254, 0.08)',
    rule: '#c084fc',
  },
  {
    value: 'ember',
    label: 'Ember',
    hint: 'Charcoal with amber and a low orange glow.',
    dark: true,
    bg: '#140c06',
    orbA: 'rgba(251, 146, 60, 0.45)',
    orbB: 'rgba(239, 68, 68, 0.32)',
    grid: 'rgba(253, 186, 116, 0.07)',
    rule: '#fb923c',
  },
  {
    value: 'forest',
    label: 'Forest',
    hint: 'Dark green, with emerald and lime.',
    dark: true,
    bg: '#04140d',
    orbA: 'rgba(16, 185, 129, 0.45)',
    orbB: 'rgba(163, 230, 53, 0.3)',
    grid: 'rgba(167, 243, 208, 0.07)',
    rule: '#34d399',
  },
  {
    value: 'ocean',
    label: 'Deep ocean',
    hint: 'Navy, with sky and cyan.',
    dark: true,
    bg: '#041226',
    orbA: 'rgba(56, 189, 248, 0.45)',
    orbB: 'rgba(14, 165, 233, 0.35)',
    grid: 'rgba(186, 230, 253, 0.07)',
    rule: '#38bdf8',
  },
  {
    value: 'rosewood',
    label: 'Rosewood',
    hint: 'Dark maroon, with rose.',
    dark: true,
    bg: '#1a060f',
    orbA: 'rgba(244, 63, 94, 0.42)',
    orbB: 'rgba(217, 70, 239, 0.3)',
    grid: 'rgba(254, 205, 211, 0.07)',
    rule: '#fb7185',
  },
  {
    value: 'graphite',
    label: 'Graphite',
    hint: 'Neutral and quiet. Lets a colourful logo do the talking.',
    dark: true,
    bg: '#0f1115',
    orbA: 'rgba(148, 163, 184, 0.3)',
    orbB: 'rgba(100, 116, 139, 0.26)',
    grid: 'rgba(203, 213, 225, 0.06)',
    rule: '#94a3b8',
  },
  {
    value: 'aurora',
    label: 'Aurora',
    hint: 'Teal-navy, with green and violet.',
    dark: true,
    bg: '#03121a',
    orbA: 'rgba(52, 211, 153, 0.42)',
    orbB: 'rgba(139, 92, 246, 0.38)',
    grid: 'rgba(153, 246, 228, 0.07)',
    rule: '#5eead4',
  },
  {
    value: 'sand',
    label: 'Sand',
    hint: 'Warm and light. Dark text.',
    dark: false,
    bg: '#faf6f0',
    orbA: 'rgba(251, 191, 36, 0.32)',
    orbB: 'rgba(249, 115, 22, 0.22)',
    grid: 'rgba(120, 113, 108, 0.08)',
    rule: '#d97706',
  },
  {
    value: 'paper',
    label: 'Paper',
    hint: 'Clean white. Dark text.',
    dark: false,
    bg: '#f8fafc',
    orbA: 'rgba(99, 102, 241, 0.22)',
    orbB: 'rgba(14, 165, 233, 0.18)',
    grid: 'rgba(100, 116, 139, 0.09)',
    rule: '#6366f1',
  },
]

export const DEFAULT_THEME = 'midnight'

/**
 * The theme an entrance is set to.
 *
 * Falls back to the original rather than to nothing: a config naming a theme
 * this build has never heard of must still draw an entrance.
 */
export function themeOf(entrance) {
  const wanted = entrance?.theme
  return ENTRANCE_THEMES.find((t) => t.value === wanted) || ENTRANCE_THEMES[0]
}

/**
 * What to put behind the logo.
 *
 * A transparent logo is the right thing to upload -- it sits on whatever
 * ground the theme provides instead of carrying a white rectangle around.
 * But transparent means the ink is whatever the designer chose, and:
 *
 *   dark ink on a dark theme is invisible
 *   light ink on a light theme is invisible
 *
 * A glow rescues the first, a plate rescues either, and `none` is for a logo
 * that already reads on the chosen ground.
 */
export const LOGO_BACKDROPS = [
  {
    value: 'glow',
    label: 'Soft glow',
    hint: 'A halo behind the logo. Lifts a dark logo off a dark background.',
  },
  {
    value: 'none',
    label: 'None',
    hint: 'The logo alone. Right when it already reads on this background.',
  },
  {
    value: 'light',
    label: 'White plate',
    hint: 'A rounded white panel. For a dark logo on a dark theme.',
  },
  {
    value: 'dark',
    label: 'Dark plate',
    hint: 'A rounded dark panel. For a white logo on a light theme.',
  },
]

export const DEFAULT_BACKDROP = 'glow'

export function backdropOf(entrance) {
  const wanted = entrance?.logoBackdrop
  return LOGO_BACKDROPS.find((b) => b.value === wanted) || LOGO_BACKDROPS[0]
}

/**
 * The custom properties the stylesheet reads.
 *
 * Returned as a plain style object so the splash can hand it straight to
 * React, and so a theme is testable without rendering anything.
 */
export function themeVars(theme) {
  const t = theme || ENTRANCE_THEMES[0]
  return {
    '--splash-bg': t.bg,
    '--splash-orb-a': t.orbA,
    '--splash-orb-b': t.orbB,
    '--splash-grid': t.grid,
    '--splash-rule': t.rule,
    // Text follows the ground, not the accent: an entrance whose tagline is
    // unreadable is worse than one that is plain.
    '--splash-title': t.dark ? '#ffffff' : '#0f172a',
    '--splash-tagline': t.dark ? '#94a3b8' : '#475569',
    '--splash-hint': t.dark ? '#475569' : '#94a3b8',
    '--splash-item-text': t.dark ? '#ffffff' : '#0f172a',
    '--splash-item-sub': t.dark ? '#cbd5e1' : '#475569',
  }
}

/** The class that draws whatever goes behind the logo. */
export function backdropClass(backdrop) {
  switch (backdrop?.value || backdrop) {
    case 'none':
      return ''
    case 'light':
      return 'rounded-2xl bg-white/95 p-4 shadow-[0_10px_40px_rgba(0,0,0,0.25)]'
    case 'dark':
      return 'rounded-2xl bg-slate-900/90 p-4 shadow-[0_10px_40px_rgba(0,0,0,0.25)]'
    default:
      return 'drop-shadow-[0_0_38px_rgba(148,163,184,0.45)]'
  }
}
