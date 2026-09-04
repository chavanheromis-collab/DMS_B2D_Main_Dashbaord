// ---------------------------------------------------------------------
// What the entrance looked like last time
// ---------------------------------------------------------------------
// The entrance paints before its settings arrive. Firestore takes a moment,
// and until it answers there is nothing to draw -- so the splash drew the
// defaults, and a workspace set to Sand opened on Midnight and then changed
// its mind in front of the reader. Not slow: WRONG, briefly, which is worse.
//
// The fix is that the browser has seen this before. The look of an entrance
// changes perhaps twice a year; the person opening it has almost certainly
// opened it already. Remembering it locally makes the first frame correct on
// every visit after the first, which is very nearly every visit.
//
// ONLY THE LOOK IS REMEMBERED. Not the announcements: a campaign has dates
// on it, and a cached one could flash up a week after it ended -- exactly
// the kind of small lie a dashboard must never tell. Announcements arrive
// with the live read and are staggered in afterwards, which is what the
// splash already does with them.
//
// Per dashboard, because each has its own entrance (see lib/spaces.js).

const KEY = 'md.entranceLook'

/**
 * What is NOT remembered -- everything else is.
 *
 * Listed this way round after the list of what IS went stale. It was seven
 * named fields, written before the logo could be resized; `logoSize` and
 * `logoGap` were added later and nobody added them here, so the entrance
 * opened at the stock 96px, held there while Firestore answered, and then
 * jumped to the size the admin had chosen. Exactly the flash this module
 * exists to prevent, reintroduced by a list that has to be maintained by
 * hand and silently keeps working when it is not.
 *
 * An exclusion list cannot go stale that way: a new look setting is
 * remembered the day it is added, and the only thing that must never be
 * cached is named here with its reason.
 */
const NOT_REMEMBERED = [
  // Announcements have dates on them. A cached campaign could flash up a
  // week after it ended, which is the kind of small lie a dashboard must
  // never tell.
  'items',
]

const read = () => {
  try {
    const raw = window.localStorage.getItem(KEY)
    const all = raw ? JSON.parse(raw) : null
    return all && typeof all === 'object' ? all : {}
  } catch {
    // Private mode, blocked site data, a corrupted entry. Any of these mean
    // "no memory", which is the first-visit path and already works.
    return {}
  }
}

/**
 * The look this browser last saw for this dashboard, or null.
 *
 * `null` is a real answer and not a failure: it is what a first visit
 * returns, and the caller waits for the live read rather than guessing.
 */
export function rememberedLook(spaceId) {
  const hit = read()[spaceId || 'main']
  if (!hit || typeof hit !== 'object') return null
  // Marked as what it is. It says what to PAINT, and it cannot say whether
  // the announcements have arrived -- which is a different question, and
  // the one that decides when to paint. See `entranceIsSettled`.
  return { ...hit, remembered: true }
}

/**
 * Keep the look, having just seen it.
 *
 * Silent on failure, deliberately: this is an optimisation on the next page
 * load, and nothing about the page in front of the reader depends on it.
 */
export function rememberLook(spaceId, entrance) {
  if (!entrance) return false
  const look = {}
  for (const [key, value] of Object.entries(entrance)) {
    if (NOT_REMEMBERED.includes(key) || value === undefined) continue
    look[key] = value
  }
  try {
    const all = read()
    all[spaceId || 'main'] = look
    window.localStorage.setItem(KEY, JSON.stringify(all))
    return true
  } catch {
    return false
  }
}

/**
 * Is this entrance one the splash can draw yet?
 *
 * Three states, and the middle one is the whole point of this module:
 *
 *   undefined  the read is still in flight and nothing is remembered.
 *              Nothing may be painted, because anything painted would be a
 *              guess, and a guess is what put Midnight on a Sand workspace.
 *   null       there is no entrance document. The defaults ARE the answer.
 *   an object  either remembered or live.
 */
export function entranceIsKnown(entrance) {
  return entrance !== undefined
}

/**
 * Is this the finished article, or the browser's memory of it?
 *
 * The two are a different question from "known", and conflating them is
 * what made the entrance arrive in pieces: it painted the moment the
 * memory answered, so the logo and the wordmark appeared, and then the
 * announcements landed a fraction of a second later and pushed both of them
 * up the screen as the column re-centred.
 *
 * The memory cannot know what the announcements are -- deliberately, since
 * a cached campaign could outlive the campaign. So the entrance waits for
 * the real read before showing anything, and the memory's job is to make
 * that first shown frame correct: the right ground, the right logo at the
 * right size, fetched at the right width. Capped, like every other wait
 * here, so a read that never lands still opens the entrance.
 */
export function entranceIsSettled(entrance) {
  return entrance !== undefined && !entrance?.remembered
}

/**
 * How long to wait for the live read before drawing the defaults anyway.
 *
 * A first visit, or a read that never lands, must not leave somebody looking
 * at nothing. Short enough that it reads as part of the load rather than as
 * a pause.
 */
export const ENTRANCE_WAIT_MS = 600
