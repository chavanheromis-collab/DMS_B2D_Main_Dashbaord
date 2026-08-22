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
