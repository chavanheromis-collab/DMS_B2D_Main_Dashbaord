// ---------------------------------------------------------------------
// The sidebar that comes when called
// ---------------------------------------------------------------------
// A sidebar collapsed to its rail hands the width back to the dashboard,
// which is what you came for -- and then costs a click every time you want
// to go somewhere. Hovering the left edge opens it; moving away puts it
// back. The chevron stays, because a hover is a nice thing to have and a
// terrible thing to depend on: a trackpad user mid-drag, a touch screen with
// no hover at all, and anybody who simply wants it to stay open all need the
// button.
//
// Three rules stop it being the kind of hover menu people disable:
//
//   IT NEVER FIGHTS THE BUTTON. Pinned open is pinned open; the peek only
//   exists while the sidebar is collapsed. Nothing you did with a click is
//   ever undone by where you moved the mouse.
//
//   IT NEVER MOVES THE PAGE. A peek OVERLAYS the canvas rather than pushing
//   it, so the dashboard does not reflow every time the pointer crosses the
//   left edge. Reflowing a page of charts on mouse movement is how a feature
//   like this earns its reputation.
//
//   IT HAS TO BE MEANT. A short delay before it opens, so crossing the edge
//   on the way somewhere else does not; a longer grace before it closes, so
//   a diagonal path to the third page in the list does not lose it halfway.
//
// Pure: a pointer position and some state in, a decision out.

/** How close to the left edge arms the peek. */
export const EDGE = 14

/** Intent, in milliseconds, before it opens. */
export const OPEN_DELAY = 110

/**
 * Grace before it closes.
 *
 * Longer than the open delay on purpose: leaving by accident costs you the
 * thing you were reaching for, and arriving by accident costs a sidebar you
 * can ignore. The cheaper mistake gets the shorter fuse.
 */
export const CLOSE_DELAY = 280

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback)

/**
 * Is a peek possible at all right now?
 *
 * Not on a touch screen -- there is no hover there, so a hot zone is a strip
 * of the page that swallows taps. Not while the mobile drawer is the
 * navigation. Not while the sidebar is already open, because then there is
 * nothing to open.
 */
export function canPeek({ collapsed, hasHover = true, mobileOpen = false, wide = true } = {}) {
  return Boolean(collapsed) && Boolean(hasHover) && Boolean(wide) && !mobileOpen
}

/**
 * How wide the CONTENT should be offset by.
 *
 * Deliberately blind to the peek: a peek overlays, so the content offset is
 * whatever the pinned state says and the page never moves.
 */
export function contentOffset({ collapsed, rail, full }) {
  return collapsed ? num(rail) : num(full)
}
