// ---------------------------------------------------------------------
// The shape a KPI takes
// ---------------------------------------------------------------------
// A KPI card had one shape -- a title, and a big number under it -- plus a
// second that appeared only when an image was placed beside it. That is one
// answer to a question with several: a row of six counts wants to be small
// and identical; a single headline figure wants the whole card; a number
// that is a proportion of something wants to be drawn AS a proportion.
//
// So the shape is a choice, and it is the admin's. Every one of them shows
// the same number from the same data -- what changes is what the eye is
// meant to do with it.
//
// Pure: a widget in, a shape and some geometry out. Nothing here draws.

/**
 * Every shape, in the order the picker offers them.
 *
 * `classic` is first and is what every existing card already is, so a
 * dashboard nobody touches looks exactly as it did.
 */
export const KPI_SHAPES = [
  {
    value: 'classic',
    label: 'Classic',
    hint: 'The title above, the number below. What a KPI card has always been.',
  },
  {
    value: 'centred',
    label: 'Centred',
    hint: 'The number large in the middle, the title under it. For one figure that matters.',
  },
  {
    value: 'ring',
    label: 'Ring',
    hint: 'A circle that fills, with the number in the middle. For a figure that is a share of something.',
  },
  {
    value: 'badge',
    label: 'Badge',
    hint: 'A solid disc of the KPI’s colour, the number inside it. For a row of counts read at a glance.',
  },
  {
    value: 'gauge',
    label: 'Gauge',
    hint: 'Three quarters of a circle, open at the bottom. The dial shape.',
  },
  {
    value: 'arc',
    label: 'Arc',
    hint: 'A half circle over the number. Shorter than a ring, so it fits a low card.',
  },
  {
    value: 'side',
    label: 'Beside its mark',
    hint: 'The image on the left, the number and title to its right.',
  },
]

/**
 * Which shape this widget is.
 *
 * `side` used to be chosen by putting an image beside the KPI rather than
 * by naming a shape, and plenty of cards are stored that way. That still
 * means `side`, so nobody's dashboard changes -- but a shape named outright
 * wins, because it is the more deliberate of the two statements.
 */
export function shapeOf(widget, hasSideImage = false) {
  const named = KPI_SHAPES.find((s) => s.value === widget?.kpiShape)
  if (named) return named.value
  return hasSideImage ? 'side' : 'classic'
}

/** Do the numbers get their own line, or sit inside a shape? */
export function isRound(shape) {
  return shape === 'ring' || shape === 'badge' || shape === 'gauge' || shape === 'arc'
}

/** Which of the round ones are drawn as a track that fills. */
export function isDial(shape) {
  return shape === 'ring' || shape === 'gauge' || shape === 'arc'
}

/**
 * How much of the circle each shape actually draws.
 *
 * A full ring is the whole way round; a gauge leaves a quarter open at the
 * bottom, which is what makes it read as a dial rather than as a ring
 * somebody forgot to finish; an arc is the top half only, for a card too
 * short for a circle.
 */
export const SWEEPS = { ring: 1, gauge: 0.75, arc: 0.5 }

/**
 * Where each one STARTS, in degrees clockwise from three o'clock.
 *
 * An SVG circle begins at three o'clock, which is nobody's idea of the top.
 * A ring is turned back a quarter so it starts at twelve; a gauge starts at
 * half past seven so its opening is centred at the bottom; an arc starts at
 * nine so it sweeps over the top to three.
 */
export const STARTS = { ring: -90, gauge: 135, arc: 180 }

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * How full the ring is, from 0 to 1.
 *
 * Three answers, in order of how deliberate they are:
 *
 *   A TARGET the admin typed. "1,200 by March" is the thing a ring is for,
 *   and it is the only one of the three that somebody chose on purpose.
 *
 *   THE UNFILTERED TOTAL. With the page narrowed, the ring is the share the
 *   filters have left -- which is the same number the progress bar under a
 *   classic card already shows.
 *
 *   OTHERWISE FULL. Not zero: an empty ring reads as "none of it", and a
 *   KPI with nothing to be a proportion OF has not failed at anything.
 *
 * Never past full. A ring that has gone round twice is unreadable, and the
 * number in the middle is what says by how much it was beaten.
 */
export function ringFraction(value, { target, baseline } = {}) {
  const v = num(value) ?? 0
  const goal = num(target)
  if (goal !== null && goal > 0) return Math.max(0, Math.min(1, v / goal))
  const base = num(baseline)
  if (base !== null && base > 0) return Math.max(0, Math.min(1, v / base))
  return 1
}

/**
 * The circle a fraction draws, as the numbers an SVG wants.
 *
 * Kept here rather than in the component because it is arithmetic, and
 * arithmetic in a render is arithmetic nobody can test.
 */
export function ringGeometry(fraction, size = 96, stroke = 8, shape = 'ring') {
  const s = Math.max(2, stroke)
  const r = Math.max(1, (Math.max(8, size) - s) / 2)
  const circumference = 2 * Math.PI * r
  const filled = Math.max(0, Math.min(1, Number(fraction) || 0))
  const sweep = SWEEPS[shape] ?? 1
  // How much of the circle this shape shows at all. The rest is not drawn
  // faintly, it is not drawn: a gauge with a ghost of its missing quarter
  // is a ring with a smudge in it.
  const track = circumference * sweep
  return {
    r,
    stroke: s,
    centre: Math.max(8, size) / 2,
    circumference,
    track,
    sweep,
    rotation: STARTS[shape] ?? -90,
    // One visible run followed by a gap longer than the circle, so nothing
    // wraps round to start drawing a second time.
    dashArray: `${track} ${circumference}`,
    // What is LEFT undrawn of the TRACK. An SVG dash offset counts
    // backwards, which is the one thing about this that is easy to get the
    // wrong way round.
    offset: track * (1 - filled),
  }
}

/**
 * How tall a shape needs its box to be, as a fraction of its width.
 *
 * An arc uses the top half and a sliver below it for the stroke; giving it
 * a square box would leave a hole under the number the size of the number.
 */
export function boxRatio(shape) {
  return shape === 'arc' ? 0.62 : 1
}

/**
 * Whether a ring is worth drawing at all.
 *
 * A ring that is always full is a decoration, and this codebase has spent
 * enough of this week removing controls that do nothing. The picker says so
 * rather than quietly drawing a circle that means nothing.
 */
export function ringIsMeaningful({ target, baseline } = {}) {
  const goal = num(target)
  if (goal !== null && goal > 0) return true
  const base = num(baseline)
  return base !== null && base > 0
}
