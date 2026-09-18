// ---------------------------------------------------------------------
// Putting a menu where it can actually be read
// ---------------------------------------------------------------------
// A dropdown written as `absolute top-full` sits under its field and hopes.
// It is wrong in three ways the moment the screen is not a wide desktop:
//
//   IT IS CLIPPED. Half this app's pickers live inside something that
//   scrolls -- the on-page editor panel, a card with `overflow: auto` --
//   and an absolutely positioned child of a scroll container cannot leave
//   it. What the reader gets is the top centimetre of a menu.
//
//   IT HANGS OFF THE SIDE. A 288px menu under a 56px field near the right
//   edge of a phone is mostly off the screen, and there is nothing to
//   scroll sideways to reach it.
//
//   IT RUNS OFF THE BOTTOM. A field low on the page opens a menu whose
//   options are below the fold, on a page whose scroll the menu does not
//   move with.
//
// So a menu is measured, then placed: under its field when it fits, above
// when it does not, never off an edge, and never taller than the space it
// has. The maths is here rather than in the component because it is the
// same maths every time, and because a placement bug is invisible in a
// screenshot taken on the machine it was written on.
//
// Pure: three rectangles in, one placement out. No DOM, no React.

/** The gap kept between a menu and the edge of the screen. */
export const POPOVER_MARGIN = 8

/** A menu shorter than this is not worth opening; it scrolls instead. */
export const POPOVER_MIN_HEIGHT = 160

/**
 * Where to put a menu of `box` size, opened from `anchor`, in `viewport`.
 *
 * Returns `{ left, top, width, maxHeight, above }` in viewport coordinates,
 * for `position: fixed`. `maxHeight` is what the caller must actually
 * honour -- the menu scrolls inside it -- or the placement is a suggestion
 * the screen ignores.
 */
export function placePopover(anchor, box, viewport, { margin = POPOVER_MARGIN, gap = 6, minHeight = POPOVER_MIN_HEIGHT } = {}) {
  const screenW = Math.max(0, viewport?.width || 0)
  const screenH = Math.max(0, viewport?.height || 0)

  // Never wider than the screen it has to fit on.
  const width = Math.max(0, Math.min(box?.width || 0, screenW - margin * 2))
  const left = Math.round(Math.max(margin, Math.min(anchor?.left || 0, screenW - width - margin)))

  const roomBelow = screenH - (anchor?.bottom || 0) - gap - margin
  const roomAbove = (anchor?.top || 0) - gap - margin
  // Below by default -- that is where a dropdown belongs and where the eye
  // goes. Above only when it genuinely does not fit and there is more room
  // there, rather than whenever it is a little tight.
  const above = (box?.height || 0) > roomBelow && roomAbove > roomBelow

  const room = Math.max(minHeight, above ? roomAbove : roomBelow)
  const maxHeight = Math.max(minHeight, Math.min(room, screenH - margin * 2))
  const height = Math.min(box?.height || 0, maxHeight)

  const top = above
    ? Math.max(margin, (anchor?.top || 0) - gap - height)
    : Math.max(margin, Math.min((anchor?.bottom || 0) + gap, screenH - height - margin))

  return { left, top: Math.round(top), width, maxHeight: Math.round(maxHeight), above }
}
