// ---------------------------------------------------------------------
// Per-widget appearance
// ---------------------------------------------------------------------
// Admins can restyle any widget -- background, border colour and thickness,
// corner radius, shadow, accent -- without a code change.
//
// The mechanism is deliberately indirect. Every widget already renders its
// own `.card` (or a hand-rolled equivalent), and rewriting every one of
// them to accept style props would be a large, risky change for a cosmetic
// feature. Instead `.card` in index.css reads CSS CUSTOM PROPERTIES, and
// this module turns a widget's saved style into exactly those properties on
// a wrapper element. A widget inherits whatever its wrapper sets and needs
// no knowledge of theming at all.
//
// The default for every field is `null`, meaning "inherit the system theme".
// A widget nobody has restyled emits no custom properties whatsoever, so the
// stock look is quite literally unchanged -- not re-specified, just absent.

import {
  DEFAULT_MARK_TEXT,
  DEFAULT_TYPOGRAPHY,
  markTextClass,
  markTextVars,
  typographyClass,
  typographyVars,
} from './typography.js'
import { DEFAULT_CHART_VISUALS, chartVisualClass, chartVisualVars } from './chartVisuals.js'

/**
 * "No colour at all", as a value rather than an absence.
 *
 * Absence already means something else here -- every field defaults to null
 * for "inherit the theme" -- so transparency needs a word of its own. It is
 * the CSS keyword, which means every place that already writes one of these
 * into a custom property needs no special case.
 */
export const TRANSPARENT = 'transparent'

/** Named starting points, so nobody has to pick six colours from scratch. */
export const WIDGET_THEMES = [
  { value: '', label: 'System default', preset: null },
  {
    value: 'plain',
    label: 'Plain white',
    preset: { bg: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, radius: 16, shadow: 'sm' },
  },
  {
    value: 'soft',
    label: 'Soft tint',
    preset: { bg: '#F8FAFC', borderColor: '#E2E8F0', borderWidth: 1, radius: 20, shadow: 'sm' },
  },
  {
    value: 'outlined',
    label: 'Outlined',
    preset: { bg: '#FFFFFF', borderColor: '#94A3B8', borderWidth: 2, radius: 12, shadow: 'none' },
  },
  {
    value: 'elevated',
    label: 'Elevated',
    preset: { bg: '#FFFFFF', borderColor: '#F1F5F9', borderWidth: 1, radius: 20, shadow: 'lg' },
  },
  {
    value: 'flat',
    label: 'Flat / borderless',
    preset: { bg: '#FFFFFF', borderColor: 'transparent', borderWidth: 0, radius: 14, shadow: 'none' },
  },
  // --- named looks, rather than named ingredients ------------------
  // The six above describe a surface ("outlined", "elevated"). These
  // describe a REPORT: a palette, a corner radius and an accent that go
  // together, so a page can be restyled with one choice instead of six.
  {
    value: 'report',
    label: 'Report (olive)',
    preset: { bg: '#FBFAF4', borderColor: '#D9D3B4', borderWidth: 1, radius: 10, shadow: 'sm', accent: '#7C7A3A' },
  },
  {
    value: 'saas',
    label: 'Soft product',
    preset: { bg: '#FFFFFF', borderColor: '#E6F4EC', borderWidth: 1, radius: 20, shadow: 'sm', accent: '#10B981' },
  },
  {
    value: 'glass',
    label: 'Glass',
    preset: {
      bg: 'rgba(255,255,255,0.62)',
      borderColor: 'rgba(255,255,255,0.85)',
      borderWidth: 1,
      radius: 22,
      shadow: 'md',
      accent: '#6366F1',
    },
  },
  {
    value: 'paper',
    label: 'Paper',
    preset: { bg: '#FFFDF7', borderColor: '#EBE4D6', borderWidth: 1, radius: 6, shadow: 'none', accent: '#B45309' },
  },
  {
    value: 'contrast',
    label: 'High contrast',
    // Not a style choice so much as an accessibility one: a hard 2px border
    // and a near-black accent survive a projector and a bright room.
    preset: { bg: '#FFFFFF', borderColor: '#0F172A', borderWidth: 2, radius: 4, shadow: 'none', accent: '#0F172A' },
  },
  {
    value: 'midnight',
    label: 'Midnight',
    preset: {
      bg: '#0B1220',
      borderColor: '#1E293B',
      borderWidth: 1,
      radius: 18,
      shadow: 'lg',
      accent: '#38BDF8',
      invert: true,
    },
  },
  {
    value: 'dark',
    label: 'Dark',
    // `invert` is a flag, not a colour: it switches on the neutral-text
    // remapping in index.css. Widgets hard-code slate-* text classes, which
    // are unreadable on a dark card.
    preset: { bg: '#0F172A', borderColor: '#1E293B', borderWidth: 1, radius: 16, shadow: 'lg', invert: true },
  },

  // ------------------------------------------------------------------
  // More named looks
  // ------------------------------------------------------------------
  // Each is a surface, a border and an accent chosen together, the same way
  // the six above are -- so picking one is one decision rather than six,
  // and a whole page set to one of them looks composed rather than tinted.
  //
  // Every light preset keeps its text on the near-black the widgets already
  // use, so contrast is never worse than the stock card. The dark ones set
  // `invert`, which is the only way slate-* text survives on them.
  {
    value: 'linen',
    label: 'Linen',
    preset: { bg: '#FDFCFA', borderColor: '#E7E2D9', borderWidth: 1, radius: 14, shadow: 'sm', accent: '#8C7851' },
  },
  {
    value: 'porcelain',
    label: 'Porcelain',
    preset: { bg: '#FCFDFE', borderColor: '#DDE7F0', borderWidth: 1, radius: 18, shadow: 'md', accent: '#0369A1' },
  },
  {
    value: 'mint',
    label: 'Mint',
    preset: { bg: '#F6FDFA', borderColor: '#C7EBDC', borderWidth: 1, radius: 18, shadow: 'sm', accent: '#0F766E' },
  },
  {
    value: 'lavender',
    label: 'Lavender',
    preset: { bg: '#FAF8FF', borderColor: '#DED7F5', borderWidth: 1, radius: 18, shadow: 'sm', accent: '#6D28D9' },
  },
  {
    value: 'blush',
    label: 'Blush',
    preset: { bg: '#FFF9FA', borderColor: '#F6D9DF', borderWidth: 1, radius: 18, shadow: 'sm', accent: '#BE185D' },
  },
  {
    value: 'sand',
    label: 'Sand',
    preset: { bg: '#FEFBF3', borderColor: '#EDDFC4', borderWidth: 1, radius: 12, shadow: 'sm', accent: '#B45309' },
  },
  {
    value: 'slate',
    label: 'Cool slate',
    preset: { bg: '#F7F9FB', borderColor: '#D8E0E8', borderWidth: 1, radius: 14, shadow: 'sm', accent: '#334155' },
  },
  {
    value: 'newsprint',
    label: 'Newsprint',
    // A rule at the top and nothing else. Print does not use shadows to
    // separate things, it uses whitespace and a line -- which is why a page
    // of these reads as a document rather than as a set of tiles.
    preset: { bg: '#FFFFFF', borderColor: '#0F172A', borderWidth: 0, radius: 0, shadow: 'none', accent: '#0F172A' },
  },
  {
    value: 'blueprint',
    label: 'Blueprint',
    preset: { bg: '#F2F7FD', borderColor: '#9CC1E8', borderWidth: 1, radius: 4, shadow: 'none', accent: '#1D4ED8' },
  },
  {
    value: 'terminal',
    label: 'Terminal',
    preset: { bg: '#0A0F0A', borderColor: '#1C3B22', borderWidth: 1, radius: 6, shadow: 'none', accent: '#4ADE80', invert: true },
  },
  {
    value: 'carbon',
    label: 'Carbon',
    preset: { bg: '#161616', borderColor: '#2E2E2E', borderWidth: 1, radius: 4, shadow: 'md', accent: '#78A9FF', invert: true },
  },
  {
    value: 'graphite',
    label: 'Graphite',
    preset: { bg: '#1C1F26', borderColor: '#2E333D', borderWidth: 1, radius: 14, shadow: 'lg', accent: '#A5B4FC', invert: true },
  },
  {
    value: 'ocean',
    label: 'Deep ocean',
    preset: { bg: '#08203A', borderColor: '#14406B', borderWidth: 1, radius: 18, shadow: 'lg', accent: '#22D3EE', invert: true },
  },
  {
    value: 'plum',
    label: 'Plum',
    preset: { bg: '#1B1027', borderColor: '#3B2255', borderWidth: 1, radius: 18, shadow: 'lg', accent: '#E879F9', invert: true },
  },
  {
    value: 'forest',
    label: 'Forest',
    preset: { bg: '#0C1F18', borderColor: '#1B3D30', borderWidth: 1, radius: 16, shadow: 'lg', accent: '#34D399', invert: true },
  },
  {
    value: 'espresso',
    label: 'Espresso',
    preset: { bg: '#211A14', borderColor: '#3D3128', borderWidth: 1, radius: 12, shadow: 'md', accent: '#F59E0B', invert: true },
  },
  {
    value: 'glassdark',
    label: 'Smoked glass',
    preset: {
      bg: 'rgba(15,23,42,0.58)',
      borderColor: 'rgba(148,163,184,0.28)',
      borderWidth: 1,
      radius: 22,
      shadow: 'lg',
      accent: '#7DD3FC',
      invert: true,
    },
  },
]

export const SHADOW_LEVELS = [
  { value: 'none', label: 'None', css: 'none' },
  { value: 'sm', label: 'Subtle', css: '0 4px 14px rgba(15,23,42,0.05)' },
  { value: 'md', label: 'Medium', css: '0 10px 30px rgba(15,23,42,0.08)' },
  { value: 'lg', label: 'Strong', css: '0 18px 45px rgba(15,23,42,0.12)' },
]

export const DEFAULT_WIDGET_STYLE = {
  ...DEFAULT_TYPOGRAPHY,
  // A chart's two kinds of text, set apart from the card's and from each
  // other -- see lib/typography.js for why they are not one control.
  chartText: { ...DEFAULT_MARK_TEXT },
  legendText: { ...DEFAULT_MARK_TEXT },
  // And how the chart is DRAWN, which is a third decision again: the grid,
  // the axes, the tooltip, and the writing that sits on the marks rather
  // than beside them. See lib/chartVisuals.js.
  chartVisuals: { ...DEFAULT_CHART_VISUALS },
  theme: '',
  bg: null,
  borderColor: null,
  borderWidth: null,
  radius: null,
  shadow: null,
  text: null,
  accent: null,
  padding: null,
}

/**
 * A widget's style, with the PAGE's theme standing in where it has none.
 *
 * A page theme is a default, not an override: a widget the admin restyled
 * deliberately keeps its own look, because the alternative -- one page
 * setting silently undoing a dozen individual decisions -- is the kind of
 * change nobody can find afterwards.
 */
export function withPageTheme(style, pageTheme) {
  if (!pageTheme) return style
  if (style?.theme) return style
  return { ...(style || {}), theme: pageTheme }
}

const isGroup = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const anySet = (group) => Object.values(group).some((v) => v !== null && v !== undefined && v !== '')

/** Resolves a widget's style, folding in its named theme's preset first. */
export function resolveStyle(style) {
  if (!style) return null
  const preset = WIDGET_THEMES.find((t) => t.value === style.theme)?.preset
  const merged = { ...(preset || {}) }

  // An explicitly set field always beats the theme it came from, so an admin
  // can pick "Elevated" and then override just the border colour.
  for (const [key, value] of Object.entries(style)) {
    if (key === 'theme') continue
    if (value === null || value === undefined || value === '') continue
    // A group of fields -- a chart's text, its legend's -- counts as set
    // only when something INSIDE it is. The empty group is written by the
    // editor on every save, and treating its presence as a decision would
    // report every widget on the page as restyled.
    if (isGroup(value) && !anySet(value)) continue
    merged[key] = value
  }
  return Object.keys(merged).length ? merged : null
}

/**
 * The inline `style` object for a widget's wrapper: only the custom
 * properties this widget actually overrides.
 *
 * Returning `undefined` for an unstyled widget matters -- it means React
 * writes no style attribute at all, so `.card` falls through to its own
 * defaults rather than to a set of values we happened to re-state here.
 */
export function styleVars(style) {
  const s = resolveStyle(style)
  if (!s) return undefined

  // The text decisions come from one place, so a widget and a page agree
  // about what "muted" means -- see lib/typography.js.
  const vars = {
    ...(typographyVars(s) || {}),
    ...(markTextVars(s.chartText, 'chart') || {}),
    ...(markTextVars(s.legendText, 'legend') || {}),
    ...(chartVisualVars(s.chartVisuals) || {}),
  }
  if (s.bg) vars['--card-bg'] = s.bg
  if (s.borderColor) vars['--card-border-color'] = s.borderColor
  if (s.borderWidth !== undefined && s.borderWidth !== null) vars['--card-border-width'] = `${s.borderWidth}px`
  if (s.radius !== undefined && s.radius !== null) vars['--card-radius'] = `${s.radius}px`
  if (s.padding !== undefined && s.padding !== null) vars['--card-padding'] = `${s.padding}px`
  if (s.accent) vars['--card-accent'] = s.accent
  if (s.shadow) {
    vars['--card-shadow'] = SHADOW_LEVELS.find((l) => l.value === s.shadow)?.css || 'none'
  }
  return Object.keys(vars).length ? vars : undefined
}

/** True when this widget has any styling of its own worth mentioning. */
export function hasCustomStyle(style) {
  return resolveStyle(style) !== null
}

/**
 * Wrapper classes for a widget -- the dark-card text inversion, plus
 * whichever typography rules this widget has switched on.
 */
export function styleClass(style) {
  const s = resolveStyle(style)
  if (!s) return ''
  return [
    s.invert ? 'card-invert' : '',
    // A background somebody TYPED is one they get. `.card` paints a white
    // sheen over its top few centimetres, which is right for the stock
    // near-white surface and a grey smear on anything darker -- so a card
    // with its own colour opts out of it. See index.css.
    //
    // `style.bg`, not the resolved `s.bg`: every named theme sets a
    // background too, and those were designed WITH the sheen. Reading the
    // resolved one would silently flatten every card already using a
    // preset, which is a look change nobody asked for.
    style.bg ? 'card-ownbg' : '',
    // Transparent means transparent. `.card` frosts whatever is behind it
    // with a `backdrop-filter`, which on a see-through card is a blurred
    // smear of the page rather than the page -- so a card asked for no
    // background gets no blur either. See index.css.
    style.bg === TRANSPARENT ? 'card-clear' : '',
    // An accent was offered on every widget and honoured by one of them.
    // This is the switch that lets the rest of them honour it too.
    s.accent ? 'card-accented' : '',
    typographyClass(s),
    markTextClass(s.chartText, 'chart'),
    markTextClass(s.legendText, 'legend'),
    chartVisualClass(s.chartVisuals),
  ]
    .filter(Boolean)
    .join(' ')
}
