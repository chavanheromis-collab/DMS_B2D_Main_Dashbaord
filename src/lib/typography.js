// ---------------------------------------------------------------------
// Who decides what the text looks like
// ---------------------------------------------------------------------
// The answer is the admin, on every widget and on every control, and it is
// worth saying why that was not already true: a "Text" colour picker existed
// on the widget paint panel, saved its value, and did nothing at all,
// because nothing ever turned it into a property anything read.
//
// The mechanism is the one the surface colours already use. Widgets hard-
// code Tailwind classes -- `text-slate-500` for a caption, `text-ink` for a
// heading -- and rewriting fifteen of them to accept typography props would
// be a large, risky change for a cosmetic feature. Instead the wrapper emits
// CUSTOM PROPERTIES and a class, and two rules in index.css remap exactly
// the NEUTRAL greys to them. Semantic colours are deliberately left alone:
// an error stays rose and a KPI keeps its accent, because an admin choosing
// a text colour has not asked for their errors to become invisible.
//
// Everything here defaults to null, meaning "inherit". A page nobody has
// touched emits no properties and no classes, so the stock look is not
// re-stated -- it is simply absent.
//
// Pure: an object in, an object out.

/**
 * Font stacks rather than font files.
 *
 * Nothing here is downloaded. A dashboard that waits on a webfont shows a
 * page of invisible text first, and an admin picking a typeface from a
 * dropdown has not agreed to that on behalf of forty readers.
 */
export const CARD_FONTS = [
  { value: '', label: 'Inherit', css: null },
  { value: 'sans', label: 'Sans (the app’s own)', css: "Inter, -apple-system, 'Segoe UI', sans-serif" },
  { value: 'serif', label: 'Serif', css: "ui-serif, Georgia, Cambria, 'Times New Roman', serif" },
  {
    value: 'mono',
    label: 'Monospace',
    css: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  },
  {
    value: 'rounded',
    label: 'Rounded',
    css: "ui-rounded, 'SF Pro Rounded', 'Segoe UI Variable Display', 'Nunito', sans-serif",
  },
  {
    value: 'condensed',
    label: 'Condensed',
    css: "'Roboto Condensed', 'Arial Narrow', 'Segoe UI Semilight', sans-serif",
  },
  { value: 'system', label: 'System UI', css: 'system-ui, sans-serif' },
]

export const TEXT_ALIGNS = [
  { value: '', label: 'Inherit' },
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centre' },
  { value: 'right', label: 'Right' },
]

/**
 * Letter spacing in em, so it tracks the text size rather than fighting it.
 */
export const TRACKING_LEVELS = [
  { value: '', label: 'Inherit', em: null },
  { value: 'tight', label: 'Tight', em: -0.02 },
  { value: 'normal', label: 'Normal', em: 0 },
  { value: 'wide', label: 'Wide', em: 0.03 },
  { value: 'wider', label: 'Wider', em: 0.06 },
]

export const WEIGHTS = [
  { value: '', label: 'Inherit', css: null },
  { value: 'light', label: 'Light', css: 300 },
  { value: 'normal', label: 'Normal', css: 400 },
  { value: 'medium', label: 'Medium', css: 500 },
  { value: 'semibold', label: 'Semibold', css: 600 },
  { value: 'bold', label: 'Bold', css: 700 },
]

export const TEXT_SCALE_MIN = 0.7
export const TEXT_SCALE_MAX = 1.6

/** The fields this module owns, so a style editor need not list them twice. */
export const TYPOGRAPHY_KEYS = ['text', 'textMuted', 'font', 'textScale', 'tracking', 'align', 'weight']

export const DEFAULT_TYPOGRAPHY = {
  // The strong greys: headings, values, table cells.
  text: null,
  // The quiet ones: captions, axis labels, "3 of 120".
  textMuted: null,
  font: null,
  textScale: null,
  tracking: null,
  align: null,
  weight: null,
}

/**
 * The zoom this setting asks for, or null for "no opinion".
 *
 * Exactly 100% is no opinion. Emitting `zoom: 1` would put every widget in
 * its own compositing layer for the sake of saying nothing.
 */
function zoomOf(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  const scale = Math.round(Math.max(TEXT_SCALE_MIN, Math.min(TEXT_SCALE_MAX, n)) * 100) / 100
  return scale === 1 ? null : scale
}

/**
 * The custom properties for a typography setting.
 *
 * Only what was actually chosen, so an inherited field stays inherited
 * instead of being pinned to whatever the default happened to be on the day
 * it was written.
 */
export function typographyVars(t) {
  if (!t) return undefined
  const vars = {}

  if (t.text) vars['--card-text'] = t.text
  if (t.textMuted) vars['--card-text-muted'] = t.textMuted

  const font = CARD_FONTS.find((f) => f.value === t.font)?.css
  if (font) vars['--card-font'] = font

  const scale = zoomOf(t.textScale)
  if (scale !== null) vars['--card-zoom'] = scale

  const tracking = TRACKING_LEVELS.find((l) => l.value === t.tracking)
  if (tracking && tracking.em !== null) vars['--card-tracking'] = `${tracking.em}em`

  if (t.align) vars['--card-align'] = t.align

  const weight = WEIGHTS.find((w) => w.value === t.weight)?.css
  if (weight) vars['--card-weight'] = String(weight)

  return Object.keys(vars).length ? vars : undefined
}

/**
 * The classes that switch the remapping rules on.
 *
 * A class per DECISION rather than one for all of them: setting a heading
 * colour must not drag the captions along with it, or the two would always
 * be the same colour and the hierarchy the greys exist to create would be
 * flattened by using the feature at all.
 */
export function typographyClass(t) {
  if (!t) return ''
  const out = []
  if (t.text) out.push('card-ink')
  if (t.textMuted) out.push('card-muted')
  if (t.weight && WEIGHTS.some((w) => w.value === t.weight && w.css)) out.push('card-weight')
  // One class carries the properties that simply inherit -- font, tracking,
  // alignment, size -- because they need a hook to hang the size rule on.
  if (t.font || t.tracking || t.align || zoomOf(t.textScale) !== null) out.push('card-typo')
  return out.join(' ')
}

// ---------------------------------------------------------------------
// The text inside a chart
// ---------------------------------------------------------------------
// A chart is two kinds of writing in one picture. The AXES and the labels
// on the marks are part of the drawing -- small, quiet, there to be read
// off. The LEGEND is a key: it is read once, deliberately, and it is very
// often the thing that is too small on a screen across the room.
//
// So they are set separately. Making them one control would mean that
// enlarging a legend enlarged forty axis ticks with it and the chart lost
// the space it was drawn in.
//
// Both are a smaller set of decisions than a card's, because the rest do
// not mean anything here: there is no muted grey in an axis, and aligning
// an axis tick is the axis's job.

/** Widgets that actually draw one. Offering this on the others would be a
 *  control that does nothing, which is the bug this file exists to fix. */
export const CHART_TEXT_TYPES = new Set(['chart', 'trend', 'stacked', 'combo', 'scatter'])

export function hasChartText(type) {
  return CHART_TEXT_TYPES.has(type)
}

export const MARK_TEXT_KEYS = ['text', 'font', 'size', 'weight']

export const DEFAULT_MARK_TEXT = { text: null, font: null, size: null, weight: null }

/** Below 6px nothing is readable; above 36 an axis tick is a headline. */
export const MARK_SIZE_MIN = 6
export const MARK_SIZE_MAX = 36

function markSize(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(Math.max(MARK_SIZE_MIN, Math.min(MARK_SIZE_MAX, n)))
}

/**
 * Properties for one of a chart's two kinds of text.
 *
 * A size in PIXELS rather than a percentage, because the thing being sized
 * is a `fontSize` the chart set element by element -- 11 for a tick, 9 for a
 * radius axis -- and a multiplier over several different bases is a number
 * nobody can predict the result of.
 */
export function markTextVars(t, prefix) {
  if (!t || !prefix) return undefined
  const vars = {}
  if (t.text) vars[`--${prefix}-text`] = t.text

  const font = CARD_FONTS.find((f) => f.value === t.font)?.css
  if (font) vars[`--${prefix}-font`] = font

  const size = markSize(t.size)
  if (size !== null) vars[`--${prefix}-size`] = `${size}px`

  const weight = WEIGHTS.find((w) => w.value === t.weight)?.css
  if (weight) vars[`--${prefix}-weight`] = String(weight)

  return Object.keys(vars).length ? vars : undefined
}

/**
 * A class per property rather than one for the lot.
 *
 * `font-size: var(--chart-size, inherit)` under a single class would reset
 * every tick to its parent's size the moment somebody picked only a
 * typeface -- a setting quietly breaking a setting nobody touched.
 */
export function markTextClass(t, prefix) {
  if (!t || !prefix) return ''
  const out = []
  if (t.text) out.push(`${prefix}-ink`)
  if (CARD_FONTS.some((f) => f.value === t.font && f.css)) out.push(`${prefix}-font`)
  if (markSize(t.size) !== null) out.push(`${prefix}-size`)
  if (WEIGHTS.some((w) => w.value === t.weight && w.css)) out.push(`${prefix}-weight`)
  return out.join(' ')
}

/** Has anybody made a decision about the text here? */
export function hasTypography(t) {
  return typographyClass(t) !== '' || Boolean(typographyVars(t))
}

/** The same question for one of a chart's two kinds of text. */
export function hasMarkText(t) {
  return Boolean(markTextVars(t, 'x'))
}

/** Everything back to inherited, without disturbing the fields around it. */
export function clearTypography(t) {
  const out = { ...(t || {}) }
  for (const key of TYPOGRAPHY_KEYS) out[key] = null
  return out
}
