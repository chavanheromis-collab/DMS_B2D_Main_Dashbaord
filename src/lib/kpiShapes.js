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
  {
    value: 'inline',
    label: 'One line',
    hint: 'The title on the left, the number on the right. For a tall stack of small metrics.',
  },
  {
    value: 'stat',
    label: 'Stat, with change',
    hint: 'The number, and beside it how far above or below its target it is. The reporting shape.',
  },
  {
    value: 'bar',
    label: 'Bar to target',
    hint: 'The number over a bar that fills towards the target, with the target marked on it.',
  },
  {
    value: 'segment',
    label: 'Segments',
    hint: 'The ring drawn as ten blocks. Easier to read a rough share off than a smooth circle.',
  },
  {
    value: 'needle',
    label: 'Dial with a needle',
    hint: 'A speedometer: the pointer says where the figure sits between nothing and the target.',
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

const ROUND = new Set(['ring', 'badge', 'gauge', 'arc', 'segment', 'needle'])
const DIALS = new Set(['ring', 'gauge', 'arc', 'segment', 'needle'])

/** Do the numbers get their own line, or sit inside a shape? */
export function isRound(shape) {
  return ROUND.has(shape)
}

/** Which of the round ones are drawn as a track that fills. */
export function isDial(shape) {
  return DIALS.has(shape)
}

/** Which is drawn in blocks rather than as one continuous run. */
export const isSegmented = (shape) => shape === 'segment'

/** Which draws a pointer instead of filling its track. */
export const isNeedle = (shape) => shape === 'needle'

/**
 * The shapes a target actually changes, and the ones with a circle to size.
 *
 * The picker asks for each setting on exactly these. Anywhere else it is
 * a box that changes nothing on screen, which this codebase has spent
 * enough time removing.
 */
export const WANTS_TARGET = ['ring', 'gauge', 'arc', 'segment', 'needle', 'bar', 'stat']
export const WANTS_SIZE = ['ring', 'gauge', 'arc', 'badge', 'segment', 'needle']

/**
 * How much of the circle each shape actually draws.
 *
 * A full ring is the whole way round; a gauge leaves a quarter open at the
 * bottom, which is what makes it read as a dial rather than as a ring
 * somebody forgot to finish; an arc is the top half only, for a card too
 * short for a circle.
 */
export const SWEEPS = { ring: 1, gauge: 0.75, arc: 0.5, segment: 1, needle: 0.75 }

/**
 * Where each one STARTS, in degrees clockwise from three o'clock.
 *
 * An SVG circle begins at three o'clock, which is nobody's idea of the top.
 * A ring is turned back a quarter so it starts at twelve; a gauge starts at
 * half past seven so its opening is centred at the bottom; an arc starts at
 * nine so it sweeps over the top to three.
 */
export const STARTS = { ring: -90, gauge: 135, arc: 180, segment: -90, needle: 135 }

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
 * The blocks a segmented ring is drawn in.
 *
 * Each block is its own run of the same circle: a dash long enough to be
 * the block, a gap longer than the circle so nothing repeats, and an
 * offset that walks it round. Ten separate runs rather than one cleverly
 * dashed one, because a single dash pattern cannot both cut the blocks
 * AND stop at the fraction -- and a segmented ring whose last block is
 * half-lit is a ring, not segments.
 *
 * A block lights once the value has REACHED it, rounding down: at 94% of
 * ten blocks, nine are lit and the tenth is not. Rounding up would show
 * a full set of blocks for a target that was missed, which is the one
 * thing this shape must never do.
 */
export function segmentBlocks(fraction, geometry, count = 10) {
  const blocks = Math.max(2, Math.min(24, Math.round(Number(count) || 10)))
  const filled = Math.max(0, Math.min(1, Number(fraction) || 0))
  const lit = Math.floor(filled * blocks + 1e-9)
  const step = (geometry?.track || 0) / blocks
  // A hair of air between blocks, proportional so it holds at any size.
  const gap = Math.min(step * 0.34, Math.max(2, (geometry?.stroke || 8) * 0.7))
  const length = Math.max(1, step - gap)

  return Array.from({ length: blocks }, (_, i) => ({
    key: i,
    length,
    // Dash offsets count backwards, which is the one thing here that is
    // easy to get the wrong way round. `|| 0` because negating zero
    // gives -0, which is the same number and reads as a typo in the
    // markup.
    offset: -(i * step) || 0,
    on: i < lit,
  }))
}

/**
 * Where a needle points, and the line to draw for it.
 *
 * Degrees from three o'clock like everything else here, so the pointer
 * and the track it sits in cannot disagree about where "empty" is.
 */
export function needleGeometry(fraction, size = 96, shape = 'needle') {
  const filled = Math.max(0, Math.min(1, Number(fraction) || 0))
  const centre = Math.max(8, size) / 2
  const sweep = SWEEPS[shape] ?? 0.75
  const start = STARTS[shape] ?? 135
  const angle = start + filled * sweep * 360
  const radians = (angle * Math.PI) / 180
  const length = centre * 0.66
  return {
    angle,
    centre,
    x: centre + length * Math.cos(radians),
    y: centre + length * Math.sin(radians),
    // The hub. It is what makes a needle look mounted rather than
    // floating on the card.
    hub: Math.max(3, Math.round(size / 22)),
  }
}

/**
 * How far off its mark this figure is, for the shapes that say so.
 *
 * Against the TARGET where there is one and the unfiltered total
 * otherwise -- the same order of preference the ring fills by, because a
 * card showing both a ring and a change must not measure them against
 * different things.
 *
 * `null` when there is nothing to compare with. Not zero: "on target"
 * and "no target" are different states, and a card showing a calm 0% for
 * the second is claiming to have been measured.
 */
export function deltaOf(value, { target, baseline } = {}) {
  const v = num(value)
  const goal = num(target)
  const against = goal !== null && goal !== 0 ? goal : num(baseline)
  if (v === null || against === null || against === 0) return null
  const change = (v - against) / Math.abs(against)
  return {
    change,
    percent: change * 100,
    // A hair either side of zero is "level". Two readings that differ in
    // the fourth decimal place are the same reading.
    dir: change > 0.0005 ? 'up' : change < -0.0005 ? 'down' : 'level',
    against,
    basis: goal !== null && goal !== 0 ? 'target' : 'unfiltered',
  }
}

/** "+12.4% vs target", in one line. */
export function deltaText(delta, { digits = 1 } = {}) {
  if (!delta) return ''
  const sign = delta.dir === 'up' ? '+' : delta.dir === 'down' ? '−' : ''
  const size = Math.abs(delta.percent)
  // Under a twentieth of a percent is noise dressed as a measurement.
  const shown = size < 0.05 ? '0' : size.toFixed(size >= 100 ? 0 : digits)
  return `${sign}${shown}% vs ${delta.basis}`
}

/**
 * How tall a shape needs its box to be, as a fraction of its width.
 *
 * An arc uses the top half and a sliver below it for the stroke; giving it
 * a square box would leave a hole under the number the size of the number.
 */
export function boxRatio(shape) {
  // A needle's dial leaves its bottom quarter open, so the box can lose a
  // little of it without cutting anything off.
  if (shape === 'arc') return 0.62
  if (shape === 'needle') return 0.86
  return 1
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
