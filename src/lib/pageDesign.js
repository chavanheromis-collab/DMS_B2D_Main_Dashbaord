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
// gaps between widgets, how wide the canvas may get, the text size, the card
// surface and the backdrop -- and every widget's own size, typed in pixels.
//
// Nothing here is a preset that cannot be left. A widget's width is a number
// of pixels the admin types; the canvas has no columns to round it up to
// (see lib/flowPack.js); the gaps are two separate numbers because vertical
// and horizontal rhythm are not the same decision. What the page looks like
// is entirely the admin's, and none of it is baked into the code.
//
// Pure: numbers and objects in, numbers and objects out, so all of it can be
// tested without a browser.

import {
  DEFAULT_MARK_TEXT,
  DEFAULT_TYPOGRAPHY,
  markTextClass,
  markTextVars,
  typographyClass,
  typographyVars,
} from './typography.js'
import { DEFAULT_CHART_VISUALS, chartVisualClass, chartVisualVars } from './chartVisuals.js'

export const GAP_MIN = 0
export const GAP_MAX = 64
export const SCALE_MIN = 0.75
export const SCALE_MAX = 1.4

export const DEFAULT_DESIGN = {
  // Text colour, font, tracking and alignment for the whole page -- the
  // widgets AND the controls, because a control bar in a different typeface
  // from the widgets under it is not a design, it is an oversight. A widget
  // that sets its own still wins, the same way it does for the surface.
  ...DEFAULT_TYPOGRAPHY,
  // And the same two for every chart on the page.
  chartText: { ...DEFAULT_MARK_TEXT },
  legendText: { ...DEFAULT_MARK_TEXT },
  // How every chart on the page is drawn. A widget that sets its own still
  // wins -- the widget's properties are emitted on a wrapper INSIDE this
  // one, so the cascade does the overriding without anything comparing the
  // two. See lib/chartVisuals.js.
  chartVisuals: { ...DEFAULT_CHART_VISUALS },
  // Two numbers, not one: the eye reads a row and a column differently, and
  // a dashboard that needs air between columns very often wants its rows
  // tighter than that, not looser.
  gapX: 12,
  gapY: 12,
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
  return {
    ...d,
    gapX: Math.round(clamp(d.gapX, GAP_MIN, GAP_MAX, DEFAULT_DESIGN.gapX)),
    gapY: Math.round(clamp(d.gapY, GAP_MIN, GAP_MAX, DEFAULT_DESIGN.gapY)),
    fontScale: Math.round(clamp(d.fontScale, SCALE_MIN, SCALE_MAX, 1) * 100) / 100,
    cardRadius: d.cardRadius === null || d.cardRadius === '' ? null : Math.round(clamp(d.cardRadius, 0, 48, 16)),
    cardPadding: d.cardPadding === null || d.cardPadding === '' ? null : Math.round(clamp(d.cardPadding, 0, 48, 16)),
    maxWidth: Math.round(clamp(d.maxWidth, 0, 4000, 0)),
  }
}

/**
 * The design, as CSS custom properties for the canvas wrapper.
 *
 * Custom properties rather than props threaded through every widget: the
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
  return {
    ...vars,
    ...(typographyVars(d) || {}),
    ...(markTextVars(d.chartText, 'chart') || {}),
    ...(markTextVars(d.legendText, 'legend') || {}),
    ...(chartVisualVars(d.chartVisuals) || {}),
  }
}

/**
 * The classes the page's typography needs switched on.
 *
 * Separate from the properties because the remapping rules have to be
 * ENABLED, not just supplied with a colour -- otherwise every card on every
 * page would start overriding its own greys with an empty variable.
 */
export function designClass(design) {
  const d = clampDesign(design)
  return [
    typographyClass(d),
    markTextClass(d.chartText, 'chart'),
    markTextClass(d.legendText, 'legend'),
    chartVisualClass(d.chartVisuals),
  ]
    .filter(Boolean)
    .join(' ')
}

/** Is this page still on the stock design? */
export function isDefaultDesign(design) {
  const d = clampDesign(design)
  return Object.keys(DEFAULT_DESIGN).every((key) => {
    const a = d[key]
    const b = DEFAULT_DESIGN[key]
    // A group of text fields is two different objects that say the same
    // nothing, so comparing them by identity would report every stock page
    // as restyled the moment one was loaded rather than constructed.
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      return Object.keys(b).every((inner) => (a[inner] ?? null) === (b[inner] ?? null))
    }
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
