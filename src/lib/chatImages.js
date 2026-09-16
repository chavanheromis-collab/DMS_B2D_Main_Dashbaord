// ---------------------------------------------------------------------
// Pictures in a chat
// ---------------------------------------------------------------------
// "Look at this" is half the messages anybody sends about a dashboard, and
// until now the answer was a screenshot pasted into WhatsApp. So: images in
// the chat -- pasted, picked, or dropped on it.
//
// Four decisions, and the first is the one that keeps the chat usable:
//
//   THE PICTURE IS NOT IN THE MESSAGE. The message carries a LINK. Every
//   message addressed to somebody is held in memory by their open tab and
//   re-read whenever any of them changes; a photo inlined there would be
//   downloaded again on every reply to it, for ever. So the bytes go to
//   Google Drive -- one folder, "CUS Chat Images" -- and the document keeps
//   a link.
//
//   IT IS SHRUNK IN THE BROWSER FIRST. A phone photo is three to six
//   megabytes of something nobody will ever look at full size in a chat
//   bubble. Sixteen hundred pixels on the long edge is more than a screen
//   shows and about a fiftieth of the bytes -- the difference between a
//   send that takes a moment and one somebody cancels.
//
//   ONLY PICTURES. Not "attachments": a chat that takes any file becomes a
//   filing cabinet nobody maintains, and this app already has a place for
//   documents -- the media columns on a table row.
//
//   A FEW AT A TIME. Four to a message. Past that it is an album, and an
//   album belongs somewhere it can be named and found again.
//
// Pure, except `shrinkImage`, which is marked and needs a browser.

/** How many pictures one message may carry. */
export const MAX_IMAGES = 4

/** Bigger than this is not a photo somebody meant to send. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024

/** The long edge after shrinking: more than any screen shows in a bubble. */
export const MAX_EDGE = 1600

/** Enough that a screenshot of a table stays readable. */
export const QUALITY = 0.82

/**
 * How long an upload may go without moving before it is given up on.
 *
 * A picture this size is one request over a second or two. When it cannot
 * be stored -- the folder never shared, the credentials wrong, the network
 * gone -- the request often does not fail, it STALLS. What that looks like
 * from the outside is a 400KB photo "uploading" for twenty minutes, which
 * is the report this was written for. Twenty seconds of silence is a dead
 * upload, and saying so beats waiting it out.
 */
export const STALL_MS = 20 * 1000

/**
 * What a failed upload actually means, in words that name the cause.
 *
 * The likely causes have different fixes and only one of them is anybody's
 * fault here, so "that picture could not be sent" is the least useful thing
 * the app could say.
 */
export function uploadProblem(failure) {
  if (failure?.stalled) {
    return 'That picture stopped uploading. Check the connection, or ask an admin to check the Drive folder is shared with the dashboard.'
  }
  if (failure?.offline) return 'That picture could not be sent — the connection dropped'

  const status = Number(failure?.status) || 0
  const said = String(failure?.message || '')

  if (status === 401) return 'You have been signed out — sign in again to send pictures'
  if (status === 413) return 'That picture is too big to send'
  // Drive's own quota failure, which means one specific misconfiguration
  // and is worth naming: the folder is not in a Shared Drive.
  if (status === 507) return 'The picture folder is out of space. It needs to be in a Shared Drive — see the README.'
  if (status === 403 || status === 404) {
    return `Pictures are not set up yet — an admin needs to share the Drive folder with the dashboard. (${said})`
  }
  return said || 'That picture could not be sent'
}

/**
 * A blob as base64, for the one hop to this app's own server.
 *
 * The browser holds no Drive access -- the service account does -- so the
 * bytes go through the API rather than straight to Google. JSON is what
 * that route speaks, and base64 is how bytes travel in it.
 */
export function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('That picture could not be read'))
    reader.onload = () => {
      const text = String(reader.result || '')
      // A data: URL is "data:<type>;base64,<payload>" and only the payload
      // is wanted.
      resolve(text.slice(text.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}

/**
 * The kinds of picture this takes.
 *
 * One list, used twice: to decide whether a dropped or pasted file is a
 * picture, and to tell the file picker what to offer. Written out rather
 * than as the usual wildcard so the two can never drift apart -- and so no
 * source file carries a slash-star, which the guards that read this project
 * as text mistake for the start of a comment and swallow the rest of a file
 * behind.
 */
export const IMAGE_TYPES = ['png', 'jpeg', 'jpg', 'gif', 'webp', 'avif', 'heic', 'heif', 'bmp']

/** For the file input's `accept`. */
export const ACCEPT = IMAGE_TYPES.map((kind) => `image/${kind}`).join(',')

const IMAGE_TYPE = new RegExp(`^image/(${IMAGE_TYPES.join('|')})$`, 'i')

export const isImageFile = (file) => IMAGE_TYPE.test(String(file?.type || ''))

/**
 * What stops this file being sent, or ''.
 *
 * Said before anything is uploaded, because "that did not work" after a
 * thirty-second wait is the worst possible moment to learn it.
 */
export function imageProblem(file) {
  if (!file) return 'No picture'
  if (!isImageFile(file)) return 'Only pictures can be sent in a chat'
  if (Number(file.size) > MAX_SOURCE_BYTES) return 'That picture is too big to send'
  return ''
}

/**
 * The pictures out of a drop, a paste or a file picker.
 *
 * Everything that is not an image is dropped silently: a paste carrying
 * both a screenshot and its file name is one picture and some text, and
 * refusing the lot would be refusing what the person meant.
 */
export function imagesFrom(list, { max = MAX_IMAGES } = {}) {
  const files = Array.from(list || [])
  return files.filter((file) => isImageFile(file) && !imageProblem(file)).slice(0, max)
}

/** How many more can be added to what is already there. */
export const roomFor = (already = [], max = MAX_IMAGES) => Math.max(0, max - (already?.length || 0))

/**
 * What one picture is called in the Drive folder.
 *
 * The sender's uid leads the name because that folder is a flat list an
 * admin will one day open, and "who sent this?" should be answerable there
 * rather than only by searching the chat. The stamp is what keeps two
 * screenshots both called Screenshot.png from being indistinguishable.
 */
export function driveNameFor(uid, name = '') {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const ext = /\.(png|jpe?g|gif|webp|avif|heic|heif|bmp)$/i.exec(String(name || ''))?.[1] || 'jpg'
  return `${uid || 'unknown'}-${stamp}.${ext.toLowerCase()}`
}

/**
 * The size a picture is drawn at, keeping its shape.
 *
 * Never enlarged: a small screenshot blown up to 1600px is the same
 * picture, blurred, in ten times the bytes.
 */
export function fitBox(width, height, maxEdge = MAX_EDGE) {
  const w = Math.max(0, Math.round(Number(width) || 0))
  const h = Math.max(0, Math.round(Number(height) || 0))
  if (!w || !h) return { width: 0, height: 0 }
  const longest = Math.max(w, h)
  if (longest <= maxEdge) return { width: w, height: h }
  const scale = maxEdge / longest
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

/**
 * One stored picture, as a message may carry it -- or null.
 *
 * Run on the way in AND on the way out. A message is a document somebody
 * could write by hand, and a bubble that trusted its shape would be a
 * bubble that renders an attacker's URL or crashes the chat.
 */
export function cleanImage(raw) {
  const url = String(raw?.url || '').trim()
  // https only, and no data: or javascript: dressed up as a picture.
  if (!/^https:\/\/\S+$/i.test(url)) return null
  const width = Math.max(0, Math.round(Number(raw?.width) || 0))
  const height = Math.max(0, Math.round(Number(raw?.height) || 0))
  return {
    url,
    width,
    height,
    // The path is kept so an unsend can take the picture with it.
    path: String(raw?.path || '').slice(0, 300),
  }
}

/** Every picture on a message, cleaned and capped. */
export function cleanImages(list) {
  const out = []
  for (const raw of Array.isArray(list) ? list : []) {
    if (out.length >= MAX_IMAGES) break
    const image = cleanImage(raw)
    if (image) out.push(image)
  }
  return out
}

export const imagesOf = (message) => cleanImages(message?.images)
export const hasImages = (message) => imagesOf(message).length > 0

/** "Photo", "3 photos" -- for a preview line that has no words to show. */
export function photoText(count) {
  const n = Number(count) || 0
  if (n <= 0) return ''
  return n === 1 ? 'Photo' : `${n} photos`
}

/**
 * The shape a bubble draws a picture at.
 *
 * A known size means the bubble is the right shape BEFORE the picture
 * arrives, so a chat does not jump as each one loads. Unknown falls back to
 * a square, which is wrong in the least distracting way.
 */
export function bubbleSize(image, max = 220) {
  const { width, height } = fitBox(image?.width, image?.height, max)
  return width && height ? { width, height } : { width: max, height: max }
}

// ---------------------------------------------------------------------
// The impure half
// ---------------------------------------------------------------------

/**
 * A picture, shrunk to something worth sending. IMPURE: needs a browser.
 *
 * Returns `{ blob, width, height }`, or the file itself if the browser
 * cannot draw it -- an unshrunk picture that arrives beats a clear message
 * about why it did not.
 *
 * `createImageBitmap` rather than an <img> and a load event: it decodes off
 * the main thread, so choosing four photos does not freeze the chat while
 * they are prepared.
 */
export async function shrinkImage(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
  const fallback = { blob: file, width: 0, height: 0 }
  try {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return fallback
    const bitmap = await createImageBitmap(file)
    const size = fitBox(bitmap.width, bitmap.height, maxEdge)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return fallback
    ctx.drawImage(bitmap, 0, 0, size.width, size.height)
    bitmap.close?.()

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) return fallback
    // A picture that was already small can come out BIGGER as a re-encoded
    // JPEG -- a flat screenshot as PNG, most often. Send whichever is less.
    if (blob.size >= file.size && Math.max(bitmap.width, bitmap.height) <= maxEdge) {
      return { blob: file, width: size.width, height: size.height }
    }
    return { blob, width: size.width, height: size.height }
  } catch {
    return fallback
  }
}
