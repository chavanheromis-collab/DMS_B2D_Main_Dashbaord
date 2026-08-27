// ---------------------------------------------------------------------
// Edit on one side, the thing itself on the other
// ---------------------------------------------------------------------
// The first version of this docked a panel around the widget's own
// rectangle. It worked, and it was wrong: where the panel went depended on
// where the widget happened to be sitting, so the same form appeared in a
// different place every time you opened it and you had to find it again.
//
// A SPLIT is the shape people already know from every editor they have used.
// The form is on one side. What you are editing is on the other. It is in
// the same place every time, it is as big as the screen allows, and the
// preview is a real render rather than a thumbnail -- the same component the
// page draws, given the same draft, so "preview" is not a second opinion
// about what it will look like.
//
// Which side is the admin's choice, remembered per browser. Left, right or
// bottom: right by default because a form reads better beside a chart than
// under it, bottom for a wide table where the preview needs the width.
//
// Pure: a side and a viewport in, two rectangles out.

export const EDIT_SIDES = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'bottom', label: 'Bottom' },
]

/** Where the panel goes when nobody has said. */
export const DEFAULT_SIDE = 'right'

/** Narrower than this a form is a column of squashed labels. */
export const MIN_PANEL = 320

/** Below this the preview stops being a preview and becomes a strip. */
export const MIN_PREVIEW = 280

/** How much of the screen the panel takes, before clamping. */
export const DEFAULT_FRACTION = 0.38

export const isSide = (side) => EDIT_SIDES.some((s) => s.value === side)

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback)

/**
 * The two panes: the editor, and what it is editing.
 *
 * They tile the viewport exactly -- no gap, no overlap -- so there is never
 * a strip of the old page showing through between them and no doubt about
 * which half is which.
 *
 * The split is clamped from BOTH ends. A panel too narrow to read a form in
 * is not a panel, and a preview too small to see the thing in is not a
 * preview; when the screen cannot honour both, the panel keeps its minimum
 * and the preview takes what is left, because a form you cannot use makes
 * the preview pointless as well.
 */
export function splitFor(side, viewport, fraction = DEFAULT_FRACTION) {
  const vw = Math.max(0, num(viewport?.width))
  const vh = Math.max(0, num(viewport?.height))
  const asked = isSide(side) ? side : DEFAULT_SIDE
  // A phone has no room for two columns. Side by side there means a 320px
  // form beside an 80px "preview", which is not a preview -- it is a strip
  // of colour. Stacked, both halves get the whole width.
  const where = asked !== 'bottom' && vw < MIN_PANEL + MIN_PREVIEW ? 'bottom' : asked
  const wanted = Number.isFinite(Number(fraction)) ? Number(fraction) : DEFAULT_FRACTION

  const along = where === 'bottom' ? vh : vw
  const minPanel = Math.min(MIN_PANEL, along)
  const minPreview = Math.min(MIN_PREVIEW, Math.max(0, along - minPanel))

  let panel = Math.round(along * Math.min(0.75, Math.max(0.2, wanted)))
  panel = Math.max(minPanel, Math.min(panel, along - minPreview))
  panel = Math.max(0, Math.min(along, panel))
  const preview = Math.max(0, along - panel)

  if (where === 'bottom') {
    return {
      side: where,
      asked,
      panelSize: panel,
      previewSize: preview,
      panel: { left: 0, top: preview, width: vw, height: panel },
      preview: { left: 0, top: 0, width: vw, height: preview },
    }
  }
  if (where === 'left') {
    return {
      side: where,
      asked,
      panelSize: panel,
      previewSize: preview,
      panel: { left: 0, top: 0, width: panel, height: vh },
      preview: { left: panel, top: 0, width: preview, height: vh },
    }
  }
  return {
    side: where,
    asked,
    panelSize: panel,
    previewSize: preview,
    panel: { left: vw - panel, top: 0, width: panel, height: vh },
    preview: { left: 0, top: 0, width: preview, height: vh },
  }
}

/**
 * The fraction a drag of the divider means.
 *
 * Taken from the pointer's position along the axis rather than from a delta,
 * so a drag that outruns the pointer -- which every delta-based resize does
 * eventually -- cannot drift away from the hand moving it.
 */
export function fractionAt(side, point, viewport) {
  const vw = Math.max(1, num(viewport?.width, 1))
  const vh = Math.max(1, num(viewport?.height, 1))
  if (side === 'bottom') return clampFraction(1 - num(point?.y) / vh)
  if (side === 'left') return clampFraction(num(point?.x) / vw)
  return clampFraction(1 - num(point?.x) / vw)
}

export function clampFraction(value) {
  const n = Number.isFinite(Number(value)) ? Number(value) : DEFAULT_FRACTION
  return Math.round(Math.min(0.75, Math.max(0.2, n)) * 1000) / 1000
}

/**
 * What the preview should show for a target.
 *
 * A widget previews as itself. Everything else -- a control, the page's own
 * settings, its design -- previews as the whole page, because that is what
 * those things change: you cannot see what a filter bar looks like by
 * looking at the filter bar alone.
 */
export function previewKind(target) {
  return target?.kind === 'widget' ? 'widget' : 'page'
}

/** What the panel is called, in the one place that has to name it. */
export function targetTitle(target, widget) {
  if (!target) return ''
  if (target.kind === 'widget') return widget?.title || 'Widget'
  if (target.kind === 'controls') return 'Controls & buttons'
  if (target.kind === 'page') return 'Page settings'
  if (target.kind === 'design') return 'Design'
  return 'Edit'
}
