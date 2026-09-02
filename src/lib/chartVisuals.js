// ---------------------------------------------------------------------
// The drawing itself, not just the writing on it
// ---------------------------------------------------------------------
// lib/typography.js already lets an admin set a chart's two kinds of TEXT.
// This is the other half: the grid, the axes, the tooltip, how solid a bar
// is, how thick a line is, how round a corner is, and -- the one that was
// missing entirely -- the colour of a label drawn INSIDE a mark.
//
// That last one is worth stating plainly, because it was a real gap rather
// than a missing nicety. A value written on top of a bar was hard-coded
// white in five places and a pie's labels were hard-coded slate in a sixth,
// so an admin who set a dark card, or a pale palette, had no way to make
// their own chart readable. Now every one of them reads a property, and the
// DEFAULT for that property is not a colour at all -- it is "work it out
// from what the mark is filled with", which is the answer that is right on
// a dark bar and a pale one without anybody choosing twice.
//
// The mechanism is the one the rest of the app already uses, and index.css
// says why it works: Recharts sets `fill`, `stroke` and `font-size` as
// presentation ATTRIBUTES, which any CSS rule outranks. So almost all of
// this is custom properties on a wrapper plus a rule per decision, and no
// chart component has to learn that theming exists.
//
// The exceptions are the two things CSS genuinely cannot reach -- a bar's
// corner radius is baked into its path data, and the gap between bars is a
// layout the chart computes -- so those come back as PROPS instead.
//
// Pure: an object in, properties and props out. Every default is null,
// meaning "inherit", so a chart nobody has touched emits nothing at all and
// is pixel-identical to before.

import { inkOn } from './heatColor.js'

// ---------------------------------------------------------------------
// The choices
// ---------------------------------------------------------------------

export const GRID_LINES = [
  { value: '', label: 'Chart default' },
  { value: 'horizontal', label: 'Horizontal only', hint: 'The usual. Bars are read against height.' },
  { value: 'vertical', label: 'Vertical only', hint: 'For horizontal bars.' },
  { value: 'both', label: 'Both', hint: 'A full graticule. Busy, but precise.' },
  { value: 'none', label: 'None', hint: 'Nothing behind the marks.' },
]

export const GRID_STYLES = [
  { value: '', label: 'Chart default', dash: null },
  { value: 'solid', label: 'Solid', dash: 'none' },
  { value: 'dashed', label: 'Dashed', dash: '3 3' },
  { value: 'dotted', label: 'Dotted', dash: '1 4' },
  { value: 'wide', label: 'Widely dashed', dash: '8 6' },
]

/**
 * How a label sitting ON a mark is coloured.
 *
 * `auto` is the default and the reason this setting exists. A fixed white
 * is right on an indigo bar and invisible on a pale yellow one, and an
 * admin who picks a palette has not agreed to check the contrast of every
 * bar in it. Working the ink out from the fill gets it right on both
 * without anybody choosing twice -- and it keeps getting it right when the
 * palette changes later.
 */
export const FILL_LABEL_MODES = [
  { value: '', label: 'Automatic — dark or light, whichever reads', hint: 'Worked out per mark from its own fill.' },
  { value: 'fixed', label: 'One colour I choose', hint: 'Applied to every label, whatever it sits on.' },
]

export const CHART_VISUAL_KEYS = [
  'preset',
  'fillOpacity',
  'strokeWidth',
  'barRadius',
  'barGap',
  'pointSize',
  'gridLines',
  'gridColor',
  'gridStyle',
  'axisColor',
  'axisLines',
  'tickMarks',
  'fillLabelMode',
  'fillLabelColor',
  'fillLabelSize',
  'fillLabelWeight',
  'separatorColor',
  'separatorWidth',
  'tooltipBg',
  'tooltipText',
  'tooltipBorder',
  'tooltipRadius',
  'tooltipSize',
  'cursorColor',
]

export const DEFAULT_CHART_VISUALS = {
  preset: '',
  // --- the marks ---------------------------------------------------
  fillOpacity: null,
  strokeWidth: null,
  barRadius: null,
  barGap: null,
  pointSize: null,
  // --- the grid and the axes ---------------------------------------
  gridLines: '',
  gridColor: null,
  gridStyle: '',
  axisColor: null,
  axisLines: null,
  tickMarks: null,
  // --- writing on the marks ----------------------------------------
  fillLabelMode: '',
  fillLabelColor: null,
  fillLabelSize: null,
  fillLabelWeight: null,
  // --- what separates one mark from the next -----------------------
  separatorColor: null,
  separatorWidth: null,
  // --- the tooltip --------------------------------------------------
  tooltipBg: null,
  tooltipText: null,
  tooltipBorder: null,
  tooltipRadius: null,
  tooltipSize: null,
  cursorColor: null,
}

/**
 * Named looks, so nobody has to set twenty fields to get somewhere.
 *
 * Each is a complete opinion about how a chart should read, not a tint --
 * the same reasoning as the widget themes. An admin picks one and is
 * finished; the individual controls underneath are for the one thing they
 * then want different, which is a far smaller decision than twenty.
 */
export const CHART_VISUAL_PRESETS = [
  { value: '', label: 'Chart default', hint: 'Exactly as the app draws it.', preset: null },
  {
    value: 'clean',
    label: 'Clean',
    hint: 'Hairline horizontal rules, solid marks. The safe one.',
    preset: {
      fillOpacity: 100,
      strokeWidth: 2,
      barRadius: 4,
      gridLines: 'horizontal',
      gridStyle: 'solid',
      gridColor: '#F1F5F9',
      axisColor: '#E2E8F0',
      tickMarks: false,
      tooltipRadius: 10,
    },
  },
  {
    value: 'minimal',
    label: 'Minimal',
    hint: 'No grid, no axis lines. The data and nothing else.',
    preset: {
      fillOpacity: 92,
      strokeWidth: 2,
      barRadius: 6,
      gridLines: 'none',
      axisLines: false,
      tickMarks: false,
      separatorWidth: 0,
      tooltipRadius: 12,
    },
  },
  {
    value: 'bold',
    label: 'Bold',
    hint: 'Thick strokes, square corners, strong rules. For a wall screen.',
    preset: {
      fillOpacity: 100,
      strokeWidth: 4,
      barRadius: 0,
      barGap: 12,
      pointSize: 5,
      gridLines: 'horizontal',
      gridStyle: 'solid',
      gridColor: '#CBD5E1',
      axisColor: '#94A3B8',
      axisLines: true,
      tickMarks: true,
      fillLabelSize: 12,
      fillLabelWeight: 700,
      tooltipSize: 13,
      tooltipRadius: 8,
    },
  },
  {
    value: 'soft',
    label: 'Soft',
    hint: 'Translucent fills, round corners, a dotted grid.',
    preset: {
      fillOpacity: 72,
      strokeWidth: 2,
      barRadius: 10,
      barGap: 30,
      pointSize: 3,
      gridLines: 'horizontal',
      gridStyle: 'dotted',
      gridColor: '#E2E8F0',
      axisLines: false,
      tickMarks: false,
      separatorColor: '#FFFFFF',
      separatorWidth: 2,
      tooltipRadius: 14,
    },
  },
  {
    value: 'print',
    label: 'Print',
    hint: 'Near-black axes and hairline rules. Survives a photocopier.',
    preset: {
      fillOpacity: 100,
      strokeWidth: 2,
      barRadius: 0,
      gridLines: 'horizontal',
      gridStyle: 'solid',
      gridColor: '#D4D4D8',
      axisColor: '#18181B',
      axisLines: true,
      tickMarks: true,
      separatorColor: '#FFFFFF',
      separatorWidth: 1,
      tooltipBg: '#FFFFFF',
      tooltipText: '#18181B',
      tooltipBorder: '#18181B',
      tooltipRadius: 0,
    },
  },
  {
    value: 'grid',
    label: 'Graph paper',
    hint: 'A full graticule, for reading exact values off the chart.',
    preset: {
      fillOpacity: 88,
      strokeWidth: 2,
      barRadius: 2,
      gridLines: 'both',
      gridStyle: 'solid',
      gridColor: '#E8EDF3',
      axisColor: '#CBD5E1',
      axisLines: true,
      tickMarks: true,
    },
  },
  {
    value: 'onDark',
    label: 'On dark',
    hint: 'For a dark card: pale rules, bright marks, a dark tooltip.',
    preset: {
      fillOpacity: 90,
      strokeWidth: 3,
      barRadius: 4,
      gridLines: 'horizontal',
      gridStyle: 'solid',
      gridColor: 'rgba(148,163,184,0.22)',
      axisColor: 'rgba(148,163,184,0.45)',
      axisLines: false,
      tickMarks: false,
      separatorColor: '#0F172A',
      separatorWidth: 1,
      tooltipBg: '#0F172A',
      tooltipText: '#E2E8F0',
      tooltipBorder: '#334155',
      tooltipRadius: 10,
      cursorColor: 'rgba(148,163,184,0.14)',
    },
  },
]

// ---------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------
// Applied on READ as well as on write, so a value edited by hand -- or
// saved before a limit existed -- can never produce a chart that cannot be
// drawn. The same reasoning as clampDesign in lib/pageDesign.js.

export const LIMITS = {
  fillOpacity: [0, 100],
  strokeWidth: [0, 8],
  barRadius: [0, 24],
  barGap: [0, 60],
  pointSize: [0, 10],
  separatorWidth: [0, 6],
  tooltipRadius: [0, 24],
  tooltipSize: [8, 20],
  fillLabelSize: [6, 28],
}

function clamp(value, key) {
  const range = LIMITS[key]
  const n = Number(value)
  if (!range || !Number.isFinite(n)) return null
  return Math.round(Math.max(range[0], Math.min(range[1], n)))
}

const isSet = (value) => value !== null && value !== undefined && value !== ''

/**
 * A visual setting, with its preset folded in underneath.
 *
 * An explicitly set field always beats the preset it came from, exactly as
 * a widget's own colour beats its theme -- so an admin can pick "Soft" and
 * then square off the corners without losing the rest of it.
 */
export function resolveVisuals(visuals) {
  if (!visuals) return null

  const preset = CHART_VISUAL_PRESETS.find((p) => p.value === visuals.preset)?.preset
  const merged = { ...(preset || {}) }

  // Only the fields this module owns. A stored document accumulates keys
  // over time -- a renamed setting, something a different editor wrote --
  // and copying them wholesale would report a chart as restyled because of
  // a field that draws nothing, which is exactly the "is this chart
  // styled?" question this answers for the editor's reset button.
  for (const key of CHART_VISUAL_KEYS) {
    if (key === 'preset') continue
    const value = visuals[key]
    if (!isSet(value)) continue
    merged[key] = value
  }

  return Object.keys(merged).length ? merged : null
}

/** Has anybody made a decision about how this chart is drawn? */
export function hasChartVisuals(visuals) {
  return resolveVisuals(visuals) !== null
}

/**
 * The page's visuals with the widget's laid over the top, field by field.
 *
 * Field by field rather than all-or-nothing, and deliberately unlike the
 * way a widget's THEME beats a page's. A theme is one decision -- a whole
 * look -- so a widget that has one keeps it entire. These are twenty
 * separate decisions, and a page that sets a grid colour while a widget
 * sets a bar radius should end up with both.
 *
 * That is also what the CSS already does on its own: the page's properties
 * land on the canvas, the widget's on a wrapper inside it, and the cascade
 * resolves them per property. This exists so the handful of settings CSS
 * cannot reach -- a corner radius, a bar gap -- behave the same way as the
 * ones it can, rather than being the two that mysteriously ignore the page.
 */
export function mergeVisuals(pageVisuals, widgetVisuals) {
  const page = resolveVisuals(pageVisuals)
  const widget = resolveVisuals(widgetVisuals)
  if (!page && !widget) return null
  return { ...(page || {}), ...(widget || {}) }
}

/** Everything back to inherited, without disturbing anything around it. */
export function clearChartVisuals(visuals) {
  return { ...(visuals || {}), ...DEFAULT_CHART_VISUALS }
}

// ---------------------------------------------------------------------
// Out to the page
// ---------------------------------------------------------------------

/**
 * The custom properties for a chart's visuals.
 *
 * Only what was actually decided, so an untouched chart emits no style
 * attribute whatsoever and falls through to what it always drew rather
 * than to whatever the defaults happened to be the day this was written.
 */
export function chartVisualVars(visuals) {
  const v = resolveVisuals(visuals)
  if (!v) return undefined

  const vars = {}
  const put = (name, value) => {
    if (isSet(value)) vars[name] = value
  }

  // --- marks --------------------------------------------------------
  const opacity = clamp(v.fillOpacity, 'fillOpacity')
  if (opacity !== null) put('--chartv-fill-opacity', String(opacity / 100))

  const stroke = clamp(v.strokeWidth, 'strokeWidth')
  if (stroke !== null) put('--chartv-stroke-width', `${stroke}px`)

  const point = clamp(v.pointSize, 'pointSize')
  if (point !== null) put('--chartv-point-size', `${point}px`)

  // --- grid ---------------------------------------------------------
  put('--chartv-grid-color', v.gridColor)
  const dash = GRID_STYLES.find((g) => g.value === v.gridStyle)?.dash
  if (dash) put('--chartv-grid-dash', dash)

  // --- axes ---------------------------------------------------------
  put('--chartv-axis-color', v.axisColor)

  // --- writing on the marks ----------------------------------------
  // Only emitted for the FIXED mode. In automatic mode the colour is not
  // one value -- it is one per mark, worked out from that mark's own fill
  // -- so there is nothing a single property could usefully say.
  if (v.fillLabelMode === 'fixed') put('--chartv-fill-text', v.fillLabelColor || '#FFFFFF')

  const labelSize = clamp(v.fillLabelSize, 'fillLabelSize')
  if (labelSize !== null) put('--chartv-fill-text-size', `${labelSize}px`)
  put('--chartv-fill-text-weight', v.fillLabelWeight ? String(v.fillLabelWeight) : null)

  // --- separators ---------------------------------------------------
  put('--chartv-separator-color', v.separatorColor)
  const sep = clamp(v.separatorWidth, 'separatorWidth')
  if (sep !== null) put('--chartv-separator-width', `${sep}px`)

  // --- tooltip ------------------------------------------------------
  put('--chartv-tooltip-bg', v.tooltipBg)
  put('--chartv-tooltip-text', v.tooltipText)
  put('--chartv-tooltip-border', v.tooltipBorder)
  const radius = clamp(v.tooltipRadius, 'tooltipRadius')
  if (radius !== null) put('--chartv-tooltip-radius', `${radius}px`)
  const tipSize = clamp(v.tooltipSize, 'tooltipSize')
  if (tipSize !== null) put('--chartv-tooltip-size', `${tipSize}px`)
  put('--chartv-cursor-color', v.cursorColor)

  return Object.keys(vars).length ? vars : undefined
}

/**
 * The classes that switch each rule on.
 *
 * A class per DECISION, for the same reason lib/typography.js needs one:
 * `stroke: var(--chartv-grid-color, ...)` under a single class would reset
 * every rule the moment somebody set only the bar radius -- a setting
 * quietly breaking a setting nobody touched.
 */
export function chartVisualClass(visuals) {
  const v = resolveVisuals(visuals)
  if (!v) return ''

  const out = []
  if (clamp(v.fillOpacity, 'fillOpacity') !== null) out.push('cv-fill')
  if (clamp(v.strokeWidth, 'strokeWidth') !== null) out.push('cv-stroke')
  if (clamp(v.pointSize, 'pointSize') !== null) out.push('cv-point')

  if (v.gridColor) out.push('cv-grid-color')
  if (GRID_STYLES.find((g) => g.value === v.gridStyle)?.dash) out.push('cv-grid-dash')
  // Hiding a set of rules is a class of its own rather than a property,
  // because "none" is not a colour and `display` is not a variable.
  if (v.gridLines === 'none') out.push('cv-grid-off')
  if (v.gridLines === 'horizontal') out.push('cv-grid-h')
  if (v.gridLines === 'vertical') out.push('cv-grid-v')

  if (v.axisColor) out.push('cv-axis-color')
  if (v.axisLines === false) out.push('cv-axis-off')
  if (v.tickMarks === false) out.push('cv-ticks-off')

  if (v.fillLabelMode === 'fixed' && v.fillLabelColor) out.push('cv-fill-text')
  if (clamp(v.fillLabelSize, 'fillLabelSize') !== null) out.push('cv-fill-text-size')
  if (v.fillLabelWeight) out.push('cv-fill-text-weight')

  if (v.separatorColor) out.push('cv-sep-color')
  if (clamp(v.separatorWidth, 'separatorWidth') !== null) out.push('cv-sep-width')

  if (v.tooltipBg || v.tooltipText || v.tooltipBorder || clamp(v.tooltipRadius, 'tooltipRadius') !== null) {
    out.push('cv-tooltip')
  }
  if (clamp(v.tooltipSize, 'tooltipSize') !== null) out.push('cv-tooltip-size')
  if (v.cursorColor) out.push('cv-cursor')

  return out.join(' ')
}

/**
 * The tooltip's surface, before any of this is set.
 *
 * Recharts writes its own inline style on that element -- white, a grey
 * border -- so a default has to be given inline too, or the first thing an
 * admin sees is a tooltip that does not match anything else on the card.
 * The `.cv-tooltip` CSS overrides it once there IS a setting.
 *
 * Exported because three chart files were carrying the same literal, which
 * is two chances for the default to drift.
 */
export const TOOLTIP_SURFACE = { borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }

// ---------------------------------------------------------------------
// The two things CSS cannot reach
// ---------------------------------------------------------------------

/**
 * A bar's corner radius, as the prop Recharts wants.
 *
 * Not a custom property, because Recharts bakes the radius into the bar's
 * PATH DATA -- there is no `border-radius` on a `<path>` to override. The
 * shape of the array is Recharts' own: the four corners, and only the two
 * at the end the bar grows towards are rounded, or a bar appears to float
 * off its own axis.
 */
export function barRadius(visuals, { horizontal = false } = {}) {
  const v = resolveVisuals(visuals)
  const r = clamp(v?.barRadius, 'barRadius')
  if (r === null || r === 0) return undefined
  return horizontal ? [0, r, r, 0] : [r, r, 0, 0]
}

/**
 * How much air is left between the bars.
 *
 * Also a prop rather than a property: it is a layout the chart computes
 * from the width it has, and nothing in CSS can reach inside that.
 */
export function barGapProps(visuals) {
  const v = resolveVisuals(visuals)
  const gap = clamp(v?.barGap, 'barGap')
  if (gap === null) return undefined
  return { barCategoryGap: `${gap}%` }
}

/**
 * The colour for a label sitting ON a mark of this colour.
 *
 * The automatic mode is the default and the point of the whole setting: a
 * fixed white is right on an indigo bar and invisible on a pale one, and
 * `inkOn` picks whichever of dark and light actually survives on the fill
 * it is given -- by perceived lightness, not a channel average, so a
 * saturated blue is correctly treated as dark. See lib/heatColor.js.
 *
 * Returns null in fixed mode, which means "let the CSS rule do it" -- the
 * one colour is already on the wrapper as a property, and a per-mark
 * attribute would out-rank it for no reason.
 */
export function fillLabelColor(visuals, markColor) {
  const v = resolveVisuals(visuals)
  if (v?.fillLabelMode === 'fixed') return null
  if (!markColor) return null
  return inkOn(markColor, { dark: '#0F172A', light: '#FFFFFF' })
}

/**
 * Does this chart want its on-mark labels worked out per mark?
 *
 * Worth asking separately, because a component that is not in automatic
 * mode should not compute a colour at all -- it should emit no attribute
 * and let the stylesheet win.
 */
export function autoFillLabels(visuals) {
  const v = resolveVisuals(visuals)
  return !v || v.fillLabelMode !== 'fixed'
}

/**
 * Which sets of grid lines to draw, as the two booleans Recharts takes.
 *
 * Returned as props as well as being expressible in CSS, because hiding a
 * line with CSS still costs the chart the DOM node and the layout pass, and
 * `<CartesianGrid horizontal={false} />` is the honest way to say it.
 * `undefined` for either means "whatever the chart already did".
 */
export function gridProps(visuals) {
  const v = resolveVisuals(visuals)
  if (!v) return undefined

  const props = {}
  if (v.gridLines === 'none') return { hidden: true }
  if (v.gridLines === 'horizontal') Object.assign(props, { horizontal: true, vertical: false })
  if (v.gridLines === 'vertical') Object.assign(props, { horizontal: false, vertical: true })
  if (v.gridLines === 'both') Object.assign(props, { horizontal: true, vertical: true })

  const dash = GRID_STYLES.find((g) => g.value === v.gridStyle)?.dash
  if (dash) props.strokeDasharray = dash === 'none' ? '0' : dash
  if (v.gridColor) props.stroke = v.gridColor

  return Object.keys(props).length ? props : undefined
}
