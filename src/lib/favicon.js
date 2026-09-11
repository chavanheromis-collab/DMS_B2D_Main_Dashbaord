// ---------------------------------------------------------------------
// The icon on the browser tab
// ---------------------------------------------------------------------
// A dashboard lives in a tab that is one of fifteen, most of them
// narrowed to the favicon and three letters. That icon is how somebody
// finds their way back to this all day, so a default globe is not a
// cosmetic gap -- it is the one identifying mark, missing.
//
// Three sources, in this order, and the order is the point:
//
//   THE ICON THE ADMIN CHOSE. Its own setting, next to the logo in the
//   Entrance panel. It is a separate field rather than the logo reused
//   because the two are drawn at 96 pixels and at 16, and almost no logo
//   survives both: the entrance wants the whole lockup, the tab wants the
//   mark cut out of it, and at 16px a wordmark with a tagline under it is
//   a grey smudge.
//
//   A LOGO OFF THE ENTRANCE. When no icon has been chosen -- the main
//   one first, since that is the mark the business leads with. A branded
//   tab from an image the workspace already has beats a default globe,
//   and a workspace with one square logo never thinks about this at all.
//
//   THE FILE IN `public/`. What ships with the build, for a workspace
//   that has set neither and for the moment before the entrance document
//   has loaded. A tab must not sit blank while Firestore answers.
//
// Normalised through `safeImageUrl` for the same reason every other
// admin-supplied image is: the commonest link anybody has to hand is a
// Drive VIEWER page, which serves HTML to an <img> tag, and anything that
// is not plainly an image location is dropped rather than written into
// the document head.

import { LOGO_SLOTS } from './branding.js'
import { safeImageUrl } from './imageUrl.js'

/** What ships with the build. */
export const STATIC_FAVICON = '/favicon.png'

/**
 * The icon this dashboard should be wearing.
 *
 * 128px because a favicon is drawn at 16 or 32 and retina doubles it; ask
 * a photo host for the whole file and the tab pays for a 2MB logo it will
 * draw at the size of a full stop.
 */
export function faviconHref(entrance, fallback = STATIC_FAVICON) {
  const chosen = safeImageUrl(entrance?.faviconUrl, { width: 64 })
  if (chosen) return chosen
  // In slot order, which is the order they are drawn in: the main mark is
  // the one the business leads with, so it is the one a tab should wear
  // when nobody has said otherwise.
  for (const slot of LOGO_SLOTS) {
    const url = safeImageUrl(entrance?.[slot.url], { width: 64 })
    if (url) return url
  }
  return fallback
}

/**
 * WHICH of the three is in use: 'chosen', 'logo' or 'default'.
 *
 * For the admin panel, which has to say what the tab is wearing rather
 * than only what was typed. A link that is not a usable image reads as
 * 'logo' or 'default' here, which is exactly what the tab will show, so
 * "I pasted something and nothing happened" is answered on the screen
 * where it was pasted.
 */
export function faviconSource(entrance) {
  if (safeImageUrl(entrance?.faviconUrl)) return 'chosen'
  if (LOGO_SLOTS.some((slot) => safeImageUrl(entrance?.[slot.url]))) return 'logo'
  return 'default'
}

/**
 * Puts it on the page. The one impure function here.
 *
 * The <link> is REUSED rather than replaced. Appending a second icon link
 * leaves the browser choosing between them -- in practice the last one
 * wins in some browsers and the first in others, which is a tab icon that
 * changes depending on who is looking at it.
 */
export function applyFavicon(href, doc = typeof document === 'undefined' ? null : document) {
  if (!doc || !href) return null
  let link = doc.querySelector("link[rel~='icon']")
  if (!link) {
    link = doc.createElement('link')
    link.rel = 'icon'
    doc.head.appendChild(link)
  }
  // Setting the same href again makes some browsers re-fetch it and blink
  // the tab, which on a re-render is a flicker with no cause on screen.
  if (link.getAttribute('href') !== href) link.setAttribute('href', href)
  return link
}
