// ---------------------------------------------------------------------
// Turning a pasted image link into one a browser can actually render
// ---------------------------------------------------------------------
// The link Google Drive gives you when you press Share is a link to a
// VIEWER PAGE, not to the image:
//
//   https://drive.google.com/file/d/1DwTJ.../view?usp=drive_link
//
// Putting that in an <img src> loads an HTML page, so the image silently
// fails to appear. Since that is the link everyone actually has to hand,
// pasting it must work -- this module recognises every Drive URL shape and
// rewrites it to a direct-serving one.
//
// One thing this CANNOT fix: the file must be shared "Anyone with the link".
// A restricted file returns a sign-in page to an <img> tag no matter how the
// URL is written, so the admin panel says so plainly next to the field.

/** Every Drive URL shape, plus a bare file id. */
const DRIVE_PATTERNS = [
  /\/file\/d\/([\w-]{10,})/, //  /file/d/<id>/view
  /[?&]id=([\w-]{10,})/, //      open?id=<id>, uc?id=<id>
  /\/d\/([\w-]{10,})/, //        /d/<id>
  /googleusercontent\.com\/d\/([\w-]{10,})/,
]

/** The Drive file id in a URL, or '' if it isn't a Drive link. */
export function driveFileId(url) {
  const s = String(url || '').trim()
  if (!/drive\.google\.com|googleusercontent\.com/i.test(s)) {
    // A bare id pasted on its own is a common shortcut and unambiguous
    // enough to accept: Drive ids are long and have no dots or slashes.
    return /^[\w-]{25,}$/.test(s) ? s : ''
  }
  for (const pattern of DRIVE_PATTERNS) {
    const m = s.match(pattern)
    if (m) return m[1]
  }
  return ''
}

/**
 * Every URL worth trying for one Drive file, best first.
 *
 * No single Drive endpoint works for every file, which is why a single URL
 * kept failing:
 *
 *   1. `lh3.googleusercontent.com/d/<id>` is Google's own image CDN. It is
 *      the most reliable for embedding and the fastest, but is only
 *      populated once Drive has generated a preview.
 *   2. `drive.google.com/thumbnail` works for anything Drive can preview,
 *      including files the CDN hasn't picked up.
 *   3. `uc?export=view` is the old endpoint. It bounces large files through
 *      a virus-scan interstitial an <img> cannot follow, so it is last --
 *      but for small files it still works when the other two don't.
 *
 * The component walks this list on error (see PageIcon.jsx), so a file that
 * one endpoint refuses is still shown by another instead of falling straight
 * back to an emoji.
 */
export function driveImageCandidates(fileId, width = 400) {
  const w = Math.round(width)
  return [
    `https://lh3.googleusercontent.com/d/${fileId}=w${w}`,
    `https://drive.google.com/thumbnail?id=${fileId}&sz=w${w}`,
    `https://drive.google.com/uc?export=view&id=${fileId}`,
  ]
}

/** The single best URL for a Drive file -- for CSS, which cannot retry. */
export function driveImageUrl(fileId, width = 400) {
  return driveImageCandidates(fileId, width)[0]
}

/**
 * Normalises any pasted image link into something renderable.
 *
 * Drive links are rewritten; everything else passes through untouched.
 * `width` is the size actually needed on screen -- it is doubled here for
 * retina, because a 20px icon fetched at 20px looks soft on every modern
 * display.
 */
export function normalizeImageUrl(url, { width = 200 } = {}) {
  const raw = String(url || '').trim()
  if (!raw) return ''

  const fileId = driveFileId(raw)
  if (fileId) return driveImageUrl(fileId, width * 2)

  return raw
}

// Characters that could terminate a CSS `url(...)` token early and start a
// new declaration: quotes, brackets, backslashes and angle brackets, plus
// every control character and the space itself. Ordinary URL characters --
// hyphens, slashes, query strings, %-encoding -- are untouched.
const UNSAFE_URL_CHARS = /[\u0000-\u0020\u007f"'()\\<>]/

/**
 * An image URL that is safe to put in `src` or in a CSS `background-image`.
 *
 * Admin-entered text landing in a sensitive position gets an allow-list, not
 * escaping: anything that isn't plainly an image location is dropped. Drive
 * links are normalised FIRST, so the check runs against the URL that will
 * really be fetched rather than the one that was typed.
 */
export function safeImageUrl(url, options) {
  const normalized = normalizeImageUrl(url, options)
  if (!normalized) return ''
  if (UNSAFE_URL_CHARS.test(normalized)) return ''
  if (!/^(https?:\/\/|data:image\/)/i.test(normalized)) return ''
  return normalized
}

/**
 * The FOLDER id in a Drive link, or '' if there isn't one.
 *
 * A folder link is a different shape from a file link and none of the
 * patterns above match it:
 *
 *   https://drive.google.com/drive/folders/1-kcGrtx…
 *   https://drive.google.com/drive/u/0/folders/1-kcGrtx…
 *   https://drive.google.com/open?id=1-kcGrtx…
 *
 * Worth its own function rather than another pattern in `driveFileId`: a
 * folder id and a file id are not interchangeable, and a folder id that
 * quietly passed as a file id would produce an image URL that 404s.
 *
 * The `?usp=sharing` and `?usp=drive_link` a share button adds are dropped
 * with everything else after the id, because that is the link people
 * actually have to hand.
 */
export function driveFolderId(url) {
  const s = String(url || '').trim()
  if (!s) return ''

  const m = s.match(/\/folders\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/)
  if (m) return m[1]

  // A bare id pasted on its own. Long, and no dots or slashes -- the same
  // shortcut `driveFileId` accepts, and just as unambiguous.
  return /^[\w-]{25,}$/.test(s) ? s : ''
}

/** Does this look like a Drive link the admin should double-check sharing on? */
export function isDriveUrl(url) {
  return Boolean(driveFileId(url))
}

/**
 * Every URL an <img> should try for this source, best first.
 *
 * A non-Drive URL has exactly one candidate: itself. A Drive one has three,
 * because no single Drive endpoint serves every file.
 */
export function imageCandidates(url, { width = 200 } = {}) {
  const raw = String(url || '').trim()
  if (!raw) return []

  const fileId = driveFileId(raw)
  const list = fileId ? driveImageCandidates(fileId, width * 2) : [raw]

  return list.filter((candidate) => {
    if (UNSAFE_URL_CHARS.test(candidate)) return false
    return /^(https?:\/\/|data:image\/)/i.test(candidate)
  })
}
