// ---------------------------------------------------------------------
// The infographic widgets
// ---------------------------------------------------------------------
// Three shapes a printed data-visualisation template is built from, and
// that nothing already on this canvas draws:
//
//   RINGS    one filled circle per category, the figure in the middle
//   PROCESS  numbered steps flowing into one another
//   PYRAMID  stacked layers, widest at the base
//
// They are new widgets rather than options on the old ones, deliberately:
// every one of them answers a question the existing chart types answer
// differently, and bolting a "draw it as a pyramid" switch onto the bar
// chart would change a widget that saved pages already use.
//
// All three read their data the same way -- one column grouped, one
// aggregation, ranked -- through `groupRows`, which is where grouping and
// bucketing already live. Nothing here re-implements it.
//
// The rule these three share, and the reason that ranking is not just a
// `slice(0, n)`: a share must be a share of EVERYTHING, never of what
// survived the cut. Keeping the top six of twenty and printing percentages
// of those six is a chart that is wrong rather than merely incomplete --
// the same trap lib/pieData.js exists to avoid on a pie.

import { groupRows } from './dataUtils.js'
import { ringFraction } from './kpiShapes.js'

const clampInt = (value, lo, hi, fallback) => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, n))
}

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * The categories, ranked, with the total of ALL of them.
 *
 * `limit: 0` on purpose: the cut happens here, after the total is taken,
 * so `share` stays a share of the whole column however few are drawn. The
 * ones that did not fit are counted rather than forgotten, so the card can
 * say so instead of quietly pretending they were never there.
 */
export function rank(rows, config, { dateOrder = 'DMY', limit = 6 } = {}) {
  if (!config?.groupBy) return { ready: false, items: [], total: 0, hidden: 0, hiddenValue: 0, max: 0 }

  const all = groupRows(rows || [], {
    groupBy: config.groupBy,
    valueColumn: config.column,
    aggregation: config.aggregation || 'count',
    sort: config.sort || 'value_desc',
    limit: 0,
    bucket: config.bucket,
    dateOrder,
  })

  const total = all.reduce((sum, item) => sum + (num(item.value) ?? 0), 0)
  const kept = limit > 0 ? all.slice(0, limit) : all
  const rest = all.slice(kept.length)

  return {
    ready: true,
    total,
    hidden: rest.length,
    hiddenValue: rest.reduce((sum, item) => sum + (num(item.value) ?? 0), 0),
    // The biggest of the WHOLE column, not of the drawn ones -- so a widget
    // measuring against "the largest" does not change its own yardstick
    // when somebody shows one fewer.
    max: all.reduce((best, item) => Math.max(best, num(item.value) ?? 0), 0),
    items: kept.map((item, index) => ({
      name: item.name,
      value: num(item.value) ?? 0,
      count: item.count,
      index,
      share: total > 0 ? ((num(item.value) ?? 0) / total) * 100 : 0,
    })),
  }
}

// ---------------------------------------------------------------------
// Rings -- a circle per category
// ---------------------------------------------------------------------
// The template shape: three or four thick circles in a row, each filled to
// some proportion with the number in the middle. It reads as a set of
// gauges rather than as a chart, which is exactly what it is for -- a
// handful of headline figures, each with a sense of how full it is.

/** What the circle is full OF. The one setting that decides what it means. */
export const RING_BASES = [
  {
    value: 'share',
    label: 'Share of the total',
    hint: 'Full = the whole column. The rings add up to one hundred percent.',
  },
  {
    value: 'max',
    label: 'Against the biggest',
    hint: 'The largest category is full and the rest are drawn relative to it.',
  },
  {
    value: 'target',
    label: 'Against a target',
    hint: 'One number you type. Full = the target met.',
  },
]

/** What sits inside the circle. */
export const RING_CENTRES = [
  { value: 'percent', label: 'The percentage' },
  { value: 'value', label: 'The value' },
  { value: 'both', label: 'The value, percentage under it' },
  { value: 'none', label: 'Nothing - label only' },
]

export const DEFAULT_RINGS = {
  groupBy: '',
  aggregation: 'count',
  column: null,
  format: 'comma',
  sort: 'value_desc',
  maxRings: 4,
  basis: 'share',
  target: null,
  centre: 'percent',
  // 'ring' is the whole circle, 'gauge' three quarters, 'arc' the top half.
  // The same three the KPI card draws, from the same geometry.
  shape: 'ring',
  size: 108,
  thickness: 12,
  perRow: 4,
  trackColor: '#E2E8F0',
  showValue: true,
  palette: 'default',
}

/**
 * One ring per category, each with how full it is.
 *
 * `fraction` is worked out by the same function the KPI card's ring uses,
 * so a ring here and a ring there can never disagree about what "80% of
 * target" looks like.
 */
export function ringStats(widget, { rows = [], dateOrder = 'DMY' } = {}) {
  const config = { ...DEFAULT_RINGS, ...(widget || {}) }
  const ranked = rank(rows, config, { dateOrder, limit: clampInt(config.maxRings, 1, 12, 4) })
  if (!ranked.ready) return { ...ranked, rings: [] }

  const target = num(config.target)
  const rings = ranked.items.map((item) => {
    let fraction
    if (config.basis === 'target') fraction = ringFraction(item.value, { target })
    else if (config.basis === 'max') fraction = ringFraction(item.value, { baseline: ranked.max })
    else fraction = ringFraction(item.value, { baseline: ranked.total })
    return { ...item, fraction, percent: fraction * 100 }
  })

  return { ...ranked, rings }
}

/**
 * Is the basis this widget is set to one it can actually measure?
 *
 * "Against a target" with no target typed draws every ring full, which
 * looks like every category having succeeded. The editor says so rather
 * than the card lying quietly.
 */
export function ringBasisIsMeaningful(widget) {
  const config = { ...DEFAULT_RINGS, ...(widget || {}) }
  if (config.basis !== 'target') return true
  const target = num(config.target)
  return target !== null && target > 0
}

// ---------------------------------------------------------------------
// Process -- numbered steps
// ---------------------------------------------------------------------
// Chevrons, arrows or numbered discs, flowing one into the next. What it
// says that a bar chart does not is ORDER: these things happen in this
// sequence. That is also why the steps can be typed by hand -- a process
// is very often a thing somebody knows and no column records.

export const PROCESS_SHAPES = [
  { value: 'chevron', label: 'Chevrons', hint: 'Arrow-headed blocks, each notched into the last.' },
  { value: 'arrow', label: 'Arrows', hint: 'Separate blocks with an arrow between them.' },
  { value: 'circle', label: 'Numbered circles', hint: 'Discs on a connecting line. The lightest of the three.' },
  { value: 'card', label: 'Cards', hint: 'A panel per step, with room for a sentence.' },
]

export const PROCESS_SOURCES = [
  { value: 'column', label: 'From a column', hint: 'Each value becomes a step, with its own figure.' },
  { value: 'manual', label: 'Steps I type', hint: 'For a process no column records.' },
]

export const NUMBER_STYLES = [
  { value: 'pad', label: '01, 02, 03' },
  { value: 'plain', label: '1, 2, 3' },
  { value: 'roman', label: 'I, II, III' },
  { value: 'none', label: 'No numbers' },
]

export const DEFAULT_PROCESS = {
  source: 'column',
  groupBy: '',
  aggregation: 'count',
  column: null,
  format: 'comma',
  sort: 'value_desc',
  maxSteps: 5,
  steps: [],
  shape: 'chevron',
  numberStyle: 'pad',
  direction: 'row',
  showValue: true,
  showShare: false,
  palette: 'default',
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']

/** The badge on a step. Not the index: people count processes from one. */
export function stepNumber(index, style = 'pad') {
  if (style === 'none') return ''
  const n = index + 1
  if (style === 'roman') return ROMAN[index] || String(n)
  if (style === 'plain') return String(n)
  return n < 10 ? `0${n}` : String(n)
}

/**
 * The steps, from a column or from the list somebody typed.
 *
 * A typed step keeps its own order -- which is the whole point of typing
 * it -- while a column's steps are ranked like everything else here. A
 * typed step with no figure carries none rather than carrying a zero,
 * because "no number" and "the number is nought" look identical on a
 * chevron and mean opposite things.
 */
export function processSteps(widget, { rows = [], dateOrder = 'DMY' } = {}) {
  const config = { ...DEFAULT_PROCESS, ...(widget || {}) }
  const limit = clampInt(config.maxSteps, 1, 12, 5)

  if (config.source === 'manual') {
    const typed = (config.steps || []).filter((step) => step && (step.label || step.caption))
    const steps = typed.slice(0, limit).map((step, index) => ({
      key: step.id || `step_${index}`,
      name: step.label || '',
      caption: step.caption || '',
      value: num(step.value),
      index,
      share: null,
      number: stepNumber(index, config.numberStyle),
    }))
    return { ready: steps.length > 0, steps, total: 0, hidden: Math.max(0, typed.length - steps.length) }
  }

  const ranked = rank(rows, config, { dateOrder, limit })
  if (!ranked.ready) return { ...ranked, steps: [] }

  return {
    ...ranked,
    steps: ranked.items.map((item) => ({
      key: item.name,
      name: item.name,
      caption: '',
      value: item.value,
      index: item.index,
      share: item.share,
      number: stepNumber(item.index, config.numberStyle),
    })),
  }
}

// ---------------------------------------------------------------------
// Pyramid -- stacked layers
// ---------------------------------------------------------------------
// Two shapes that look alike and mean entirely different things, which is
// why they are one widget with a switch rather than two widgets that get
// confused with each other:
//
//   A PYRAMID's widths are decoration. Every layer steps in by the same
//   amount whatever it holds, and the numbers are read off the labels.
//
//   A FUNNEL's widths are the data. A layer half as wide holds half as
//   much, and the taper IS the drop-off between stages.
//
// Getting that backwards -- a proportional-looking triangle whose widths
// mean nothing -- is the single most common way this shape lies, so which
// one is being drawn is a setting with its own hint, not a guess.

export const PYRAMID_SHAPES = [
  { value: 'pyramid', label: 'Pyramid', hint: 'Even steps. The widths are decoration; read the numbers.' },
  { value: 'funnel', label: 'Funnel', hint: 'Width follows the value, so the taper is the drop-off.' },
  { value: 'steps', label: 'Stacked bands', hint: 'Full-width bands. Nothing to misread at all.' },
]

export const BASE_ENDS = [
  { value: 'bottom', label: 'Widest at the bottom', hint: 'A pyramid. The biggest layer holds the rest up.' },
  { value: 'top', label: 'Widest at the top', hint: 'A funnel. Stages falling away as they go down.' },
]

export const DEFAULT_PYRAMID = {
  groupBy: '',
  aggregation: 'count',
  column: null,
  format: 'comma',
  // Not a setting. This shape IS a ranking -- a triangle whose layers are
  // in alphabetical order is a sawtooth, not a pyramid -- so the order is
  // fixed here and the editor does not offer to change it.
  sort: 'value_desc',
  maxLayers: 5,
  shape: 'pyramid',
  baseAt: 'bottom',
  minWidth: 34,
  gap: 4,
  showValue: true,
  showShare: true,
  palette: 'default',
}

/**
 * The layers, top to bottom, each with the width it should be drawn at.
 *
 * Width is a percentage of the card, and where it MEANS something -- the
 * funnel -- it is measured against the largest layer, so the widest band is
 * full width and every other one is honestly proportional to it.
 */
export function pyramidLayers(widget, { rows = [], dateOrder = 'DMY' } = {}) {
  const config = { ...DEFAULT_PYRAMID, ...(widget || {}) }
  const ranked = rank(rows, config, { dateOrder, limit: clampInt(config.maxLayers, 2, 12, 5) })
  if (!ranked.ready) return { ...ranked, layers: [] }

  // Ranked biggest-first, so drawing them in that order puts the widest at
  // the top; a pyramid wants the opposite and is the default.
  const items = config.baseAt === 'top' ? ranked.items : [...ranked.items].reverse()
  const count = items.length
  const floor = clampInt(config.minWidth, 5, 90, 34)
  const widest = items.reduce((best, item) => Math.max(best, item.value), 0)

  const layers = items.map((item, position) => {
    let width
    if (config.shape === 'steps') width = 100
    else if (config.shape === 'funnel') width = widest > 0 ? floor + ((100 - floor) * item.value) / widest : 100
    else {
      // An even taper: the wide end at 100, the narrow end at `floor`, one
      // layer on its own simply full width rather than a division by zero.
      //
      // Off the RANK, not off the position, so turning the pyramid over
      // turns the drawing over and not the meaning -- the widest layer is
      // the biggest one whichever end it is drawn at. The steps stay even
      // whatever the values are, which is exactly what makes this shape
      // decoration and why the funnel beside it exists.
      width = count > 1 ? floor + (100 - floor) * (1 - item.index / (count - 1)) : 100
    }
    return { ...item, position, width: Math.round(width * 10) / 10 }
  })

  return { ...ranked, layers, meaningful: config.shape !== 'pyramid' }
}
