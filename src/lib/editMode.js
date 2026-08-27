// ---------------------------------------------------------------------
// Editing a page on the page
// ---------------------------------------------------------------------
// A dashboard is a thing you look at, so it opens as one: view mode, for
// everybody including the admin who built it. Edit mode is a switch, not a
// separate screen, because "go to the admin panel, change a number, save,
// come back, squint" is four steps of which three are travel.
//
// The hard part is not the editing. It is that an editor which covers the
// widget you are editing makes you change something, close the editor, look,
// reopen it -- the same four steps in a smaller box. So the editor covers
// the whole screen EXCEPT the widget, which stays lit and live and redraws
// as you type.
//
// Which side it docks to is decided from the widget's own rectangle: the
// biggest band of free screen around it, so a KPI in the top-left is edited
// from the right and a full-width table from underneath. When nothing is big
// enough -- a phone, or a widget that fills the canvas -- it becomes a
// bottom sheet and the page scrolls the widget into what is left.
//
// Pure: rectangles in, rectangles out. No DOM, no React.

/** Below this a docked panel is a column of squashed labels. */
export const MIN_PANEL = 340

/** How much of the screen a bottom sheet takes when nothing else fits. */
export const SHEET_FRACTION = 0.55

/** Air between the panel and the widget it is not allowed to cover. */
export const PANEL_GAP = 12

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback)

/**
 * Where to put the editor so it does not cover what is being edited.
 *
 * Right, then left, then bottom, then top -- in that order when two bands
 * are equally good. Right first because a form reads better beside the thing
 * it changes than under it, and because a page scrolls vertically: a panel
 * below the widget is a panel that moves when the page does.
 */
export function dockFor(rect, viewport, { min = MIN_PANEL, gap = PANEL_GAP } = {}) {
  const vw = Math.max(0, num(viewport?.width))
  const vh = Math.max(0, num(viewport?.height))
  const left = Math.max(0, num(rect?.left))
  const top = Math.max(0, num(rect?.top))
  const right = Math.max(left, num(rect?.right, left))
  const bottom = Math.max(top, num(rect?.bottom, top))

  const bands = [
    { side: 'right', size: vw - right - gap },
    { side: 'left', size: left - gap },
    { side: 'bottom', size: vh - bottom - gap },
    { side: 'top', size: top - gap },
  ]

  const best = bands.filter((b) => b.size >= min).sort((a, b) => b.size - a.size)[0]

  // Ties go to the earlier band in the list above, which `sort` does not
  // promise, so the winner is re-picked by order among the equally best.
  const winner = best ? bands.find((b) => b.size === best.size && b.size >= min) : null

  if (!winner) {
    const height = Math.max(min, Math.round(vh * SHEET_FRACTION))
    return {
      side: 'sheet',
      size: height,
      style: { left: 0, right: 0, bottom: 0, height, width: undefined, top: undefined },
    }
  }

  const size = Math.round(winner.size)
  if (winner.side === 'right') {
    return { side: 'right', size, style: { top: 0, bottom: 0, right: 0, width: size, left: undefined, height: undefined } }
  }
  if (winner.side === 'left') {
    return { side: 'left', size, style: { top: 0, bottom: 0, left: 0, width: size, right: undefined, height: undefined } }
  }
  if (winner.side === 'bottom') {
    return { side: 'bottom', size, style: { left: 0, right: 0, bottom: 0, height: size, top: undefined, width: undefined } }
  }
  return { side: 'top', size, style: { left: 0, right: 0, top: 0, height: size, bottom: undefined, width: undefined } }
}

/**
 * The box drawn around the widget that is staying visible.
 *
 * Padded, because a ring drawn exactly on a card's border reads as the card
 * having a different border rather than as the card being picked out.
 */
export function spotlight(rect, pad = 8) {
  if (!rect) return null
  const left = num(rect.left)
  const top = num(rect.top)
  return {
    left: Math.round(left - pad),
    top: Math.round(top - pad),
    width: Math.round(Math.max(0, num(rect.right, left) - left) + pad * 2),
    height: Math.round(Math.max(0, num(rect.bottom, top) - top) + pad * 2),
  }
}

/**
 * The whole screen, minus the widget: four bands that between them cover
 * everything the widget does not.
 *
 * Four rectangles rather than one dim layer with a hole in it, because a
 * hole means the widget has to be lifted above the layer -- and the canvas
 * it lives in is its own stacking context, so no z-index on the widget can
 * reach past a fixed overlay outside it. Nothing is ever drawn over the
 * widget here, so there is nothing for it to climb over.
 *
 * A band with no size is dropped rather than emitted at zero: a
 * zero-height element still takes a paint and still answers a click.
 */
export function scrimBands(rect, viewport) {
  const vw = Math.max(0, num(viewport?.width))
  const vh = Math.max(0, num(viewport?.height))
  if (!rect) return [{ key: 'all', left: 0, top: 0, width: vw, height: vh }]

  const left = Math.max(0, Math.min(vw, num(rect.left)))
  const top = Math.max(0, Math.min(vh, num(rect.top)))
  const right = Math.max(left, Math.min(vw, num(rect.right, left)))
  const bottom = Math.max(top, Math.min(vh, num(rect.bottom, top)))

  return [
    { key: 'top', left: 0, top: 0, width: vw, height: top },
    { key: 'bottom', left: 0, top: bottom, width: vw, height: vh - bottom },
    { key: 'left', left: 0, top, width: left, height: bottom - top },
    { key: 'right', left: right, top, width: vw - right, height: bottom - top },
  ].filter((b) => b.width > 0.5 && b.height > 0.5)
}

/**
 * The widget list as the page should DRAW it while something is being
 * edited: the saved widgets, with the unsaved edit merged over the top.
 *
 * This is what makes the change visible before it is written. The draft is
 * merged rather than replacing the widget, so a form that only knows about
 * three fields cannot drop the other forty.
 */
export function mergeDraft(widgets, id, patch) {
  if (!id || !patch) return widgets || []
  return (widgets || []).map((w) => (w.id === id ? { ...w, ...patch } : w))
}

/**
 * Is this widget the one being edited?
 *
 * A tiny function with a name, because `id && id === editing` reads as a
 * boolean expression and `isEditing(widget, editing)` reads as a question.
 */
export function isEditing(widget, editingId) {
  return Boolean(editingId) && widget?.id === editingId
}
