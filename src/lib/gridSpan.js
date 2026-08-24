// ---------------------------------------------------------------------
// How wide a widget is, in canvas columns
// ---------------------------------------------------------------------
// The dashboard canvas is a 12-column masonry. Width is measured in COLUMNS
// rather than pixels because a fixed pixel width cannot stay right across a
// phone, a laptop with the sidebar open, and a 4K monitor at once.
//
// Pure, and in lib/ rather than beside the grid component, so it can be
// tested without a DOM -- Node cannot import a .jsx file.

export const COLUMNS = 12

/** The named presets, as units per breakpoint. */
export const SPAN_MAP = {
  quarter: { base: 12, md: 6, lg: 3 },
  third: { base: 12, md: 6, lg: 4 },
  half: { base: 12, md: 6, lg: 6 },
  twothird: { base: 12, md: 12, lg: 8 },
  full: { base: 12, md: 12, lg: 12 },
}

export const BREAKPOINTS = { md: 768, lg: 1024 } // Tailwind's defaults, which this project doesn't override

/**
 * How many of the 12 columns a widget takes at this breakpoint.
 *
 * `units` is an exact span the admin set (1-12) and beats the named preset.
 * It is honoured at `lg` and widened below: a 3-unit widget held at 3 units
 * on a 360px screen would be an unreadable sliver, so the same doubling the
 * presets use applies -- roughly double at `md`, full width at `base`.
 */
export function spanForWidth(width, breakpoint, units) {
  if (Number.isFinite(units) && units >= 1) {
    const exact = Math.min(COLUMNS, Math.round(units))
    if (breakpoint === 'lg') return exact
    if (breakpoint === 'md') return Math.min(COLUMNS, exact * 2)
    return COLUMNS
  }
  const m = SPAN_MAP[width] || SPAN_MAP.full
  return m[breakpoint] ?? m.base
}

/**
 * How many columns a PIXEL-sized widget occupies.
 *
 * The packer reasons in columns, so an exact pixel width still has to claim
 * whole ones. It rounds UP: a widget 1.2 columns wide that claimed only one
 * would have the next widget placed underneath it and overlapping.
 *
 * Returns `null` before the container has been measured, so the caller can
 * fall back to the standard span for that first frame instead of dividing
 * by zero.
 */
export const SPAN_TOLERANCE = 10

export function spanForPixels(widthPx, colWidth, gap = 12, columns = COLUMNS, tolerance = SPAN_TOLERANCE) {
  if (!(colWidth > 0) || !(widthPx > 0)) return null
  // Minus a small tolerance, because a widget that overhangs a column
  // boundary by three pixels used to claim a WHOLE further column -- a
  // hundred-pixel strip beside it that nothing can ever be placed in, for
  // three pixels nobody can see. Over the tolerance it is drawn a hair
  // narrower than asked (see drawnWidth) instead, which is the smaller lie
  // by far.
  const span = Math.ceil((widthPx + gap - tolerance) / (colWidth + gap))
  return Math.min(columns, Math.max(1, span))
}

/**
 * How much of the room a widget claimed it does not use.
 *
 * The grid reasons in whole columns, so a widget pinned to 260px on a canvas
 * whose columns are 95px claims three of them -- 305px -- and the 45px left
 * over is dead: too narrow for anything else, and nothing can be placed
 * there anyway. Surfacing the number is what lets an admin see WHY there is
 * a hole beside their KPI row and snap it shut in one click.
 */
export function widthSlack(widthPx, spanWidth) {
  if (!(widthPx > 0) || !(spanWidth > 0)) return 0
  return Math.max(0, Math.round(spanWidth - widthPx))
}

/**
 * The span an item takes, whichever way it was sized.
 *
 * One place decides, so the packer (which needs a span) and the renderer
 * (which needs a pixel width) can never disagree about how much room a
 * widget claims.
 */
/**
 * The height an admin pinned.
 *
 * The number is honoured as typed. An earlier version capped it against the
 * viewport, which meant every value past about 650px drew the same height --
 * the admin typed 700, then 800, then 900, and nothing moved. A control that
 * silently ignores its input is worse than one that is not there.
 *
 * So the number is published as a custom property and the STYLESHEET decides
 * what to do with it: honoured exactly on a real screen, and capped only on
 * a phone, where a widget taller than the device is a trap rather than a
 * layout. That is a media query's job, and a media query cannot live in an
 * inline style.
 *
 * Returns null for "no opinion", which is what most widgets should have:
 * the masonry already sizes them from their content.
 */
/**
 * Floors for a pinned size.
 *
 * A number is committed once, not per keystroke -- but somebody can still
 * type 4 and tab away, and a widget four pixels wide is indistinguishable
 * from a broken page. Low enough that a thin strip of a KPI is still
 * allowed; high enough that the result is always visibly a widget.
 */
export const MIN_WIDTH_PX = 80
export const MIN_HEIGHT_PX = 60

/**
 * The width a pixel-sized widget draws at.
 *
 * Its own number, but never past the right edge of the canvas: a widget
 * placed in column 7 that then drew 900px would spill off the page, and the
 * part that spilled would simply be unreachable. Falls back to the span the
 * packer reserved when no pixel width was pinned.
 */
export function drawnWidth(widthPx, { left = 0, containerWidth = 0, spanWidth = 0 }) {
  if (!(widthPx > 0)) return spanWidth
  // Never wider than the columns it claimed -- that room belongs to the
  // widget beside it -- and never past the right edge of the canvas, where
  // the overflow could not be reached at all.
  const limits = [widthPx]
  if (spanWidth > 0) limits.push(spanWidth)
  if (containerWidth > 0) limits.push(containerWidth - left)
  return Math.max(1, Math.min(...limits))
}

export function heightStyle(px, { min = MIN_HEIGHT_PX } = {}) {
  const n = Number(px)
  if (!Number.isFinite(n) || n <= 0) return null
  // A floor, because a widget forty pixels tall is a mistake rather than a
  // decision -- but a low one, since a thin strip of a KPI is legitimate.
  return { '--widget-h': `${Math.max(min, Math.round(n))}px` }
}

export function spanForItem(item, breakpoint, colWidth, gap = 12, columns = COLUMNS) {
  if (item?.widthPx > 0) {
    const fromPx = spanForPixels(item.widthPx, colWidth, gap, columns)
    if (fromPx !== null) return fromPx
  }
  return Math.min(columns, Math.max(1, spanForWidth(item?.width, breakpoint, item?.widthUnits)))
}

/**
 * Which breakpoint the GRID is at -- measured from the space the grid
 * actually has, not from the window.
 *
 * Those stopped being the same thing once a sidebar was added: on a 1200px
 * window with the sidebar expanded the grid only gets ~930px, and sizing
 * four "quarter" widgets as if it had 1200 crushes them.
 */
export function breakpointFor(width, fallbackWidth = 1280) {
  const w = width || fallbackWidth
  if (w >= BREAKPOINTS.lg) return 'lg'
  if (w >= BREAKPOINTS.md) return 'md'
  return 'base'
}
