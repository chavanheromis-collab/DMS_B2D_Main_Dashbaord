// ---------------------------------------------------------------------
// Per-widget appearance
// ---------------------------------------------------------------------
// Admins can restyle any widget -- background, border colour and thickness,
// corner radius, shadow, accent -- without a code change.
//
// The mechanism is deliberately indirect. Every widget already renders its
// own `.card` (or a hand-rolled equivalent), and rewriting all fourteen of
// them to accept style props would be a large, risky change for a cosmetic
// feature. Instead `.card` in index.css reads CSS CUSTOM PROPERTIES, and
// this module turns a widget's saved style into exactly those properties on
// a wrapper element. A widget inherits whatever its wrapper sets and needs
// no knowledge of theming at all.
//
// The default for every field is `null`, meaning "inherit the system theme".
// A widget nobody has restyled emits no custom properties whatsoever, so the
// stock look is quite literally unchanged -- not re-specified, just absent.

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
  {
    value: 'dark',
    label: 'Dark',
    // `invert` is a flag, not a colour: it switches on the neutral-text
    // remapping in index.css. Widgets hard-code slate-* text classes, which
    // are unreadable on a dark card.
    preset: { bg: '#0F172A', borderColor: '#1E293B', borderWidth: 1, radius: 16, shadow: 'lg', invert: true },
  },
]

export const SHADOW_LEVELS = [
  { value: 'none', label: 'None', css: 'none' },
  { value: 'sm', label: 'Subtle', css: '0 4px 14px rgba(15,23,42,0.05)' },
  { value: 'md', label: 'Medium', css: '0 10px 30px rgba(15,23,42,0.08)' },
  { value: 'lg', label: 'Strong', css: '0 18px 45px rgba(15,23,42,0.12)' },
]

export const DEFAULT_WIDGET_STYLE = {
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

/** Resolves a widget's style, folding in its named theme's preset first. */
export function resolveStyle(style) {
  if (!style) return null
  const preset = WIDGET_THEMES.find((t) => t.value === style.theme)?.preset
  const merged = { ...(preset || {}) }

  // An explicitly set field always beats the theme it came from, so an admin
  // can pick "Elevated" and then override just the border colour.
  for (const [key, value] of Object.entries(style)) {
    if (key === 'theme') continue
    if (value !== null && value !== undefined && value !== '') merged[key] = value
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

  const vars = {}
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

/** Wrapper class for a widget -- carries the dark-card text inversion. */
export function styleClass(style) {
  return resolveStyle(style)?.invert ? 'card-invert' : ''
}
