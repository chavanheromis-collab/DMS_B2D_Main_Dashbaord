// ---------------------------------------------------------------------
// A KPI that fits the box it was dragged to
// ---------------------------------------------------------------------
// Every size on a KPI card used to be a constant: `text-2xl` for the
// number, eleven pixels for the label, a hundred and four for the ring.
// Which is right for exactly one card size -- the one they were chosen
// against. Drag the card to twice the height and you get the same small
// number floating in the middle of a lot of white; drag it down to a
// strip and the number is cut off by a label that would not shrink.
//
// So the sizes come from the BOX. Three rules decide them, and the
// second is the one that is easy to get wrong:
//
//   THE SMALLER SIDE LEADS. A number sized off the width overflows the
//   moment somebody drags a card wide and short, which is the commonest
//   shape on a dashboard -- a row of six across the top.
//
//   LONGER TEXT GETS SMALLER TYPE, NOT A SMALLER BOX. "8" and
//   "₹1,24,85,000" are the same measurement in the same card, and the
//   second one has to fit without the first one looking timid. The
//   length is part of the sum rather than something clipped afterwards.
//
//   NOTHING GROWS FOR EVER. A KPI on a wall display should be big; at
//   some point past that it is a poster of a number, and the label under
//   it has become a headline. Both ends are clamped.
//
// Pure: a box in, pixel sizes out. Nothing here measures anything -- see
// hooks/useElementSize.js for the half that does.

// Below this there is no room to be clever; above it, no reason.
//
// The floors are low on purpose. A floor is a promise that something
// will be drawn no smaller than this -- which, in a card too small to
// hold it, is a promise to OVERFLOW. The card has no scrollbar (see
// `.kpi-card` in index.css), so overflow is content simply cut off, and
// a number cut in half is worse than a small one.
const NUMBER = { min: 10, max: 84 }
const LABEL = { min: 7, max: 20 }
const CAPTION = { min: 7, max: 14 }
const CIRCLE = { min: 24, max: 260 }

const clamp = (value, { min, max }) => Math.round(Math.max(min, Math.min(max, value)))

/**
 * A box worth measuring against, or nothing.
 *
 * WIDTH is the test, not height. A card's width comes from the grid it
 * sits in and never from what is drawn inside it, so sizing off it is
 * stable. Height is only sometimes like that -- see `heightOf`.
 */
const usable = (box) => Number(box?.width) > 0

/**
 * The height to size against, which is not always the one measured.
 *
 * A widget on the canvas is given a definite height, and measuring it
 * is exactly right. A widget that is NOT -- in the admin's live
 * preview, or anywhere `--widget-h` is unset -- has a card whose height
 * is whatever its contents come to. Sizing the contents off that is a
 * loop: bigger type makes a taller card, which asks for bigger type.
 * It settles, but it settles somewhere arbitrary, and it does it
 * visibly over several frames.
 *
 * So an untrusted height is not measured at all. It is assumed, from
 * the width, which nothing inside the card can move.
 */
function heightOf(box, trust) {
  const measured = Number(box?.height)
  if (trust && measured > 0) return measured
  // The proportion of a KPI card somebody would actually drag out.
  return Number(box?.width) * 0.62
}

/** The shapes whose number sits inside a circle. */
const ROUND = new Set(['ring', 'badge', 'gauge', 'arc', 'segment', 'needle'])

/**
 * How much room there is, as one number.
 *
 * The geometric mean of the two sides rather than the smaller of them.
 * `min` alone throws away everything a card gains by being wide: a strip
 * 600 by 90 and a square 90 by 90 would get identical type, and the
 * strip plainly has room for more. The mean leans on the short side --
 * which is what stops a wide card overflowing -- while still counting
 * the long one.
 */
export function boxScale(box) {
  if (!usable(box)) return 0
  return Math.sqrt(Number(box.width) * Number(box.height))
}

/**
 * How much the length of the number itself costs.
 *
 * Four characters is the reference -- a count, a short currency figure --
 * and every character past it takes a slice off. Floored at a little
 * over a third, because a very long figure in a small card is going to
 * be tight whatever happens and shrinking it to nothing helps nobody.
 */
export function lengthFactor(length) {
  const n = Math.max(1, Number(length) || 1)
  if (n <= 4) return 1
  return Math.max(0.38, 1 - (n - 4) * 0.075)
}

/**
 * Every size on the card, for one box.
 *
 * `fixed` is the admin's circle size where they typed one, and it is a
 * CEILING rather than a fixed number. Somebody who typed 120 meant "no
 * bigger than 120"; taking it as "always 120" is what made a card
 * dragged down to a strip draw a dial larger than itself and get cut
 * off. The card is the harder constraint of the two and always wins.
 *
 * A box of nothing returns nothing, and the component keeps the sizes
 * it always had. That matters more than it looks: a ResizeObserver has
 * not fired on the first paint, and a card that rendered at 10px for
 * one frame and then jumped would flicker on every page load.
 */
export function kpiScale(box, { shape = 'classic', textLength = 4, fixed = null, sized = true } = {}) {
  if (!usable(box)) return null

  const width = Number(box.width)
  const height = heightOf(box, sized)
  const room = boxScale({ width, height })
  const long = lengthFactor(textLength)
  // Round shapes spend their height on the circle, so the number inside
  // one is sized against the circle rather than against the card.
  const round = ROUND.has(shape)
  // One line means one line: the title and the figure share the width,
  // so neither can have the height to itself.
  const dense = shape === 'inline'

  const label = clamp(room * (dense ? 0.055 : 0.05), LABEL)

  // What is left for the circle once the name under it has had its
  // line. Sizing a dial against the whole height is what put a circle
  // and a label into a box that only had room for the circle -- and
  // with no scrollbar to hide behind, the label was simply gone.
  const spare = Math.max(16, height - label * LINE)
  // The 0.94 is air against the BOX, not against the admin's number: a
  // ceiling of 120 on a card with room for it means 120, not 113.
  const circle = clamp(Math.min(Math.min(width, spare) * 0.94, ceiling(fixed)), CIRCLE)

  return {
    circle,
    number: clamp((round ? circle * 0.34 : room * (dense ? 0.14 : 0.22)) * long, NUMBER),
    label,
    caption: clamp(room * 0.038, CAPTION),
    // What a ring is drawn WITH, so a big dial does not keep a hairline
    // stroke and a small one is not all stroke.
    stroke: Math.max(2, Math.round(circle / 13)),
  }
}

/** A label's line, including the air above and below it. */
const LINE = 1.9

/** The admin's ceiling, or none at all. */
function ceiling(fixed) {
  const n = Number(fixed)
  return Number.isFinite(n) && n > 0 ? n : Infinity
}

/**
 * The size to draw at, deferring to an admin who has stated one.
 *
 * An inline `font-size` beats a stylesheet rule, so a card that wrote
 * its measured size straight into `style` would silently override the
 * Values setting in the Look tab -- a control that saves and does
 * nothing, which is the exact bug the typography system exists to
 * prevent.
 *
 * Written as `var(--wvalue-size, 34px)` instead: the measured size is
 * the FALLBACK, so it applies until somebody states a size and steps
 * aside the moment they do.
 */
export function scaledFont(variable, px, fallback) {
  return `var(${variable}, ${px ? `${px}px` : fallback})`
}

/**
 * A style object, or undefined.
 *
 * `undefined` rather than `{}` on purpose: React treats an empty style
 * object as a change on every render, and this is handed to an element
 * that re-renders on every tick of the count-up animation.
 */
export function sizeStyle(px) {
  return px ? { fontSize: `${px}px` } : undefined
}
