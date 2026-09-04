// ---------------------------------------------------------------------
// The whole screen, not the whole card
// ---------------------------------------------------------------------
// "Full screen" on a widget has meant two different things, and only one of
// them is what anybody asks for:
//
//   A FIXED OVERLAY fills the browser's viewport. It is CSS, it always
//   works -- and it is only as big as the window, which on a laptop is the
//   window minus the tab strip, the address bar and the bookmarks.
//
//   THE FULLSCREEN API fills the DEVICE screen. The browser's own chrome
//   goes away. This is what "full screen" means to the person asking.
//
// So: ask for the real thing, and keep the overlay underneath it as the
// answer for when the browser says no -- an iPhone, an iframe without the
// permission, a policy. The overlay is not a lesser fallback that has to be
// detected; it is simply what is drawn, and the API makes the window it is
// drawn in as big as the hardware allows.
//
// A second reason the overlay alone was not enough: `position: fixed` is
// relative to the VIEWPORT only while no ancestor has a transform, a
// filter or a backdrop-filter on it. Any of those silently makes the
// nearest such ancestor the containing block, and a "fullscreen" overlay
// inside a card that has `backdrop-filter: blur()` fills the card. That is
// why the overlay is also portalled out of the widget -- see FlowWidget.
//
// Every function here is defensive to the point of paranoia because this
// is the one API in the app that differs per browser AND throws rather
// than returning false: Safari still prefixes all four names, an iPhone
// has the element methods and rejects the promise, and calling exit when
// nothing is fullscreen throws a TypeError.

/**
 * Where the overlay should be mounted.
 *
 * Out of the widget -- so no card, no transform and no filter can become
 * its containing block -- but no further than the PAGE, because the page is
 * where the design lives. Every `--card-*`, `--font-scale` and typography
 * property is declared on `.page-canvas`, and an overlay hung off `<body>`
 * inherits none of them: the fullscreen flow would come back in the stock
 * fonts and colours, on a page that had been styled.
 *
 * `<body>` remains the answer when there is no page canvas above -- the
 * admin preview, a test -- because anywhere out of the subtree beats
 * staying in it.
 */
export function fullscreenHost(node, doc = globalThis.document) {
  const page = node?.closest?.('.page-canvas')
  return page || doc?.body || null
}

/** The four names, in the order they should be tried. */
const REQUEST = ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen', 'msRequestFullscreen']
const EXIT = ['exitFullscreen', 'webkitExitFullscreen', 'webkitCancelFullScreen', 'msExitFullscreen']
const ELEMENT = ['fullscreenElement', 'webkitFullscreenElement', 'msFullscreenElement']
const ENABLED = ['fullscreenEnabled', 'webkitFullscreenEnabled', 'msFullscreenEnabled']

/** Both spellings, because Safari fires only its own. */
export const FULLSCREEN_EVENTS = ['fullscreenchange', 'webkitfullscreenchange', 'MSFullscreenChange']

const methodOn = (object, names) => {
  if (!object) return null
  for (const name of names) {
    if (typeof object[name] === 'function') return name
  }
  return null
}

/**
 * Can this browser give us the device screen at all?
 *
 * `fullscreenEnabled` is FALSE, not undefined, inside an iframe without the
 * `allow="fullscreen"` permission -- which is a real deployment, not a
 * theoretical one, and is the case where asking would throw.
 */
export function fullscreenSupported(doc = globalThis.document, element = null) {
  if (!doc) return false
  const flag = ENABLED.find((name) => name in doc)
  if (flag && doc[flag] === false) return false
  // Some old WebKit builds expose no enabled flag at all; the element
  // method is then the only evidence either way.
  const probe = element || doc.documentElement
  return Boolean(methodOn(probe, REQUEST))
}

/** Whatever is currently filling the screen, or null. */
export function fullscreenElement(doc = globalThis.document) {
  if (!doc) return null
  for (const name of ELEMENT) {
    if (doc[name]) return doc[name]
  }
  return null
}

/**
 * Ask for the screen.
 *
 * Never throws and never rejects: a refusal is an answer, and the overlay
 * underneath is already drawn either way. Resolves to whether it worked,
 * so a caller can say so rather than guess.
 */
export function requestFullscreen(element, doc = globalThis.document) {
  if (!element || !fullscreenSupported(doc, element)) return Promise.resolve(false)
  const name = methodOn(element, REQUEST)
  if (!name) return Promise.resolve(false)
  try {
    // The prefixed ones return undefined rather than a promise.
    return Promise.resolve(element[name]()).then(
      () => true,
      () => false
    )
  } catch {
    return Promise.resolve(false)
  }
}

/**
 * Give the screen back.
 *
 * Only when we are the thing holding it: exiting a fullscreen somebody
 * else asked for -- a video, a slide deck -- would be rude, and calling
 * exit when nothing is fullscreen throws.
 */
export function exitFullscreen(doc = globalThis.document, element = null) {
  if (!doc || !fullscreenElement(doc)) return Promise.resolve(false)
  if (element && fullscreenElement(doc) !== element) return Promise.resolve(false)
  const name = methodOn(doc, EXIT)
  if (!name) return Promise.resolve(false)
  try {
    return Promise.resolve(doc[name]()).then(
      () => true,
      () => false
    )
  } catch {
    return Promise.resolve(false)
  }
}

/**
 * Has the reader left fullscreen by a route we do not control?
 *
 * Esc and F11 are handled by the browser itself and tell us nothing except
 * through this event -- so without it the widget stays in its "fullscreen"
 * layout inside a normal window, which is a card with no way out.
 */
export function stillFullscreen(doc = globalThis.document, element = null) {
  const current = fullscreenElement(doc)
  if (!current) return false
  return element ? current === element || current.contains?.(element) : true
}
