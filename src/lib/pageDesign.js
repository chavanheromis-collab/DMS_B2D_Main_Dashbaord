// ---------------------------------------------------------------------
// Designing a page from the page
// ---------------------------------------------------------------------
// The admin panel is where a page is BUILT -- which tabs, which widgets,
// which conditions. It is the wrong place to decide how a page LOOKS,
// because looking at it is the only way to tell, and a form in another
// screen means changing a number, saving, navigating back, squinting, and
// going round again.
//
// So the whole of a page's appearance is editable on the page itself: the
// gaps between widgets, how many columns the canvas is divided into, the
// text size, the card surface, the backdrop -- and the order of the widgets,
// by dragging them.
//
// Nothing here is a preset that cannot be left. A widget's width is columns
// OR exact pixels; the column count itself is a setting; the gaps are two
// separate numbers because vertical and horizontal rhythm are not the same
// decision. What the page looks like is entirely the admin's, and none of it
// is baked into the code.
//
// Pure: numbers and objects in, numbers and objects out, so all of it can be
// tested without a browser.

/** How many columns the canvas may be divided into. */
export const COLUMN_CHOICES = [6, 8, 12, 16, 24]

export const GAP_MIN = 0
export const GAP_MAX = 64
export const SCALE_MIN = 0.75
export const SCALE_MAX = 1.4

export const DEFAULT_DESIGN = {
  // Two numbers, not one: the eye reads a row and a column differently, and
  // a dashboard that needs air between columns very often wants its rows
  // tighter than that, not looser.
  gapX: 12,
  gapY: 12,
  columns: 12,
  // Everything on the page scales together. A dashboard on a wall-mounted
  // screen and the same dashboard on a laptop are the same design at two
  // sizes, not two designs.
  fontScale: 1,
  // The card surface, page-wide. A widget that sets its own still wins --
  // see widgetStyle.js -- so this is a default, not an override.
  cardRadius: null,
  cardPadding: null,
  cardBg: null,
  cardBorder: null,
  // How wide the canvas is allowed to get on a very large screen. 0 means
  // "all of it".
  maxWidth: 0,
}

const clamp = (value, min, max, fallback) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

/**
 * A saved design, with every number forced back into what can be drawn.
 *
 * Applied on read rather than only on write: a page saved before a limit
 * existed, or edited by hand, must not be able to produce a canvas with a
 * negative gap or three-hundred columns.
 */
export function clampDesign(design) {
  const d = { ...DEFAULT_DESIGN, ...(design || {}) }
  const columns = COLUMN_CHOICES.includes(Number(d.columns)) ? Number(d.columns) : DEFAULT_DESIGN.columns
  return {
    ...d,
    gapX: Math.round(clamp(d.gapX, GAP_MIN, GAP_MAX, DEFAULT_DESIGN.gapX)),
    gapY: Math.round(clamp(d.gapY, GAP_MIN, GAP_MAX, DEFAULT_DESIGN.gapY)),
    columns,
    fontScale: Math.round(clamp(d.fontScale, SCALE_MIN, SCALE_MAX, 1) * 100) / 100,
    cardRadius: d.cardRadius === null || d.cardRadius === '' ? null : Math.round(clamp(d.cardRadius, 0, 48, 16)),
    cardPadding: d.cardPadding === null || d.cardPadding === '' ? null : Math.round(clamp(d.cardPadding, 0, 48, 16)),
    maxWidth: Math.round(clamp(d.maxWidth, 0, 4000, 0)),
  }
}

/**
 * The design, as CSS custom properties for the canvas wrapper.
 *
 * Custom properties rather than props threaded through fifteen widgets: the
 * card already reads `--card-*` (see index.css), so a page-wide surface is
 * one declaration on an ancestor and no widget learns anything new. Only
 * the properties actually set are emitted, so an untouched page inherits
 * the stock look rather than re-specifying it.
 */
export function designVars(design) {
  const d = clampDesign(design)
  const vars = {
    '--page-gap-x': `${d.gapX}px`,
    '--page-gap-y': `${d.gapY}px`,
    '--font-scale': d.fontScale,
  }
  if (d.cardRadius !== null) vars['--card-radius'] = `${d.cardRadius}px`
  if (d.cardPadding !== null) vars['--card-padding'] = `${d.cardPadding}px`
  if (d.cardBg) vars['--card-bg'] = d.cardBg
  if (d.cardBorder) vars['--card-border-color'] = d.cardBorder
  return vars
}

/** Is this page still on the stock design? */
export function isDefaultDesign(design) {
  const d = clampDesign(design)
  return Object.keys(DEFAULT_DESIGN).every((key) => {
    const a = d[key]
    const b = DEFAULT_DESIGN[key]
    return a === b || (a === null && b === null)
  })
}

// ---------------------------------------------------------------------
// Moving widgets
// ---------------------------------------------------------------------
/**
 * One item taken out of a list and put back somewhere else.
 *
 * `to` is an index in the list AS IT WAS, which is how a drop reads from
 * the outside -- "put it where that one is" -- and the removal is done
 * first, so dragging something rightwards does not land it one place short
 * of where it was dropped.
 */
export function moveItem(list, from, to) {
  const items = [...(list || [])]
  if (from < 0 || from >= items.length) return items
  const target = Math.max(0, Math.min(items.length - 1, to))
  if (from === target) return items

  const [moved] = items.splice(from, 1)
  items.splice(target, 0, moved)
  return items
}

/**
 * Which slot a drop at this point lands in.
 *
 * The nearest widget by the distance to its centre, and then which SIDE of
 * that centre the pointer is on -- past it means after. Distance to the
 * centre rather than "is the pointer inside a box", because on a masonry
 * canvas there are real gaps between the boxes and a drop into one of them
 * has to mean something rather than nothing.
 *
 * Returns `null` when there is nothing to drop onto.
 */
export function dropTargetAt(boxes, point, exclude) {
  let best = null
  for (const box of boxes || []) {
    if (!box || box.id === exclude) continue
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    const distance = Math.hypot(point.x - cx, point.y - cy)
    if (!best || distance < best.distance) {
      best = { id: box.id, distance, after: point.x > cx, box }
    }
  }
  return best ? { id: best.id, after: best.after } : null
}

/**
 * The index `moveItem` should be given for a drop on `overId`.
 *
 * Dropping AFTER something you were already in front of means its index,
 * not one past it -- because removing yourself first has already shifted
 * everything down by one. Getting this wrong is the classic drag-and-drop
 * bug where an item refuses to move one place to the right.
 */
export function dropIndex(ids, dragId, overId, after) {
  const from = ids.indexOf(dragId)
  const over = ids.indexOf(overId)
  if (from === -1 || over === -1) return from

  let to = after ? over + 1 : over
  if (from < to) to -= 1
  return Math.max(0, Math.min(ids.length - 1, to))
}
