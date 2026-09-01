// ---------------------------------------------------------------------
// Copying a look from one thing to another
// ---------------------------------------------------------------------
// Setting the same six fields on eleven widgets by hand is how one of them
// ends up slightly wrong, and it is the wrongness nobody spots until the
// dashboard is on a wall.
//
// Module state, which is exactly the lifetime this wants: it survives
// closing one widget's editor and opening another's -- the whole point --
// and it is gone on the next reload. A look on the clipboard is for the
// next few minutes of work, not for next week, and persisting it would mean
// a stale look pasted into a page somebody opened on Monday.
//
// The style itself is stored as a plain snapshot rather than a reference,
// so editing the widget it was copied from does not silently change what
// gets pasted.

/** Fields that describe a LOOK, and travel between anything that has one. */
const LOOK_FIELDS = [
  'theme',
  'bg',
  'borderColor',
  'borderWidth',
  'radius',
  'padding',
  'shadow',
  'accent',
  'invert',
  // Typography and chart marks are part of the look too -- a widget copied
  // for its palette and left with the old typeface is a copy that did not
  // work.
  'font',
  'weight',
  'tracking',
  'align',
  'text',
  'textMuted',
  'zoom',
  'chartText',
  'legendText',
  'chartVisuals',
]

let clipboard = null

/** Everything about a style worth carrying to something else. */
export function lookOf(style) {
  if (!style) return null
  const out = {}
  for (const key of LOOK_FIELDS) {
    const value = style[key]
    if (value === undefined) continue
    // A nested group is copied as its own object, or the two would share it
    // and editing one would edit the other.
    out[key] = value && typeof value === 'object' ? { ...value } : value
  }
  return out
}

/** Put one on the clipboard. */
export function copyLook(style) {
  clipboard = lookOf(style)
  return clipboard
}

/** What is on it, as a fresh object each time it is asked for. */
export function copiedLook() {
  return clipboard ? lookOf(clipboard) : null
}

export function hasCopiedLook() {
  return clipboard !== null
}

/** Mostly for tests, and for a "forget it" the editor may one day want. */
export function clearLook() {
  clipboard = null
}
