import { uid } from './config.js'

// ---------------------------------------------------------------------
// The entrance: brand + admin-editable announcements
// ---------------------------------------------------------------------
// Beyond the wordmark, the splash can carry a short list of things the
// business wants everyone to see on their way in: a running campaign, a
// milestone hit, a notice. All of it lives in ONE Firestore document
// (`settings/entrance`) that only admins may write.
//
// Each item can carry a date window, which is the feature that stops this
// becoming stale furniture: a campaign that ended last month disappears on
// its own instead of greeting people for another year because nobody
// remembered to take it down.

export const ENTRANCE_DOC = 'entrance'

export const ITEM_KINDS = [
  { value: 'campaign', label: 'Campaign', icon: '🎯', color: '#4F46E5' },
  { value: 'achievement', label: 'Achievement', icon: '🏆', color: '#D97706' },
  { value: 'notice', label: 'Notice', icon: '📢', color: '#0EA5E9' },
  { value: 'milestone', label: 'Milestone', icon: '🚀', color: '#059669' },
]

export function kindMeta(kind) {
  return ITEM_KINDS.find((k) => k.value === kind) || ITEM_KINDS[0]
}

/**
 * How big the logo may be drawn.
 *
 * The floor is not politeness: below about forty pixels a wordmark is a
 * smudge, and an admin who has dragged the slider to nothing has made a
 * mistake rather than a choice. The ceiling is the entrance itself -- a
 * logo taller than 320px starts pushing the brand name and the
 * announcements off a laptop screen.
 */
export const LOGO_MIN = 40
export const LOGO_MAX = 320
export const LOGO_DEFAULT = 96

/**
 * The space under the logo, and why it goes NEGATIVE.
 *
 * A logo file is very often mostly nothing: the ink sits in the middle of a
 * square canvas with a third of the height transparent above and below it.
 * The browser cannot see that -- transparent pixels are pixels -- so the
 * element is drawn at its full height and the wordmark underneath is pushed
 * down by empty space nobody put there on purpose. It looks like a huge
 * margin and no margin is responsible for it.
 *
 * Cropping the image is not ours to do, and asking every admin to re-export
 * their logo is not an answer either. Letting the gap go negative is: it
 * pulls the wordmark back up through the emptiness, and the amount needed
 * is a property of that one file, which is exactly the kind of thing a
 * person can see and a program cannot.
 */
export const GAP_MIN = -80
export const GAP_MAX = 80
export const GAP_DEFAULT = 24

export const DEFAULT_ENTRANCE = {
  enabled: true,
  brandName: '',
  tagline: '',
  // An admin-supplied logo replaces the generic mark on the entrance. Blank
  // keeps the built-in one, so a fresh install still looks finished.
  logoUrl: '',
  // Named rather than left blank: `themeOf` and `backdropOf` both fall back
  // to the first entry anyway, but a stored document that says what it is
  // beats one whose look depends on which entry happens to be first.
  theme: 'midnight',
  logoBackdrop: 'glow',
  // How tall the logo is drawn, in pixels. 96 is what it always was, so a
  // workspace that never touches this looks exactly as it did.
  logoSize: LOGO_DEFAULT,
  logoGap: GAP_DEFAULT,
  durationMs: 2600,
  items: [],
}

/**
 * The box the logo is drawn in, and the width to ask the image host for.
 *
 * Three numbers rather than one, because they are not the same number and
 * getting that wrong is what makes a logo either blurry or wrong-shaped:
 *
 *   `height`  what the admin chose.
 *   `maxWidth`  proportional to it. A wide wordmark and a square mark are
 *               both logos; capping the width at a fixed 260px would let a
 *               short one grow and squash a long one.
 *   `request`  what to fetch. Twice the drawn width, because the entrance is
 *              the one place in this app where a soft image is not
 *              acceptable and every screen worth impressing is a retina one.
 */
/** `null` and `''` mean "not set", and `Number(null)` is 0 -- which is not. */
const raw2 = (value) => (value === null || value === undefined || value === '' ? NaN : Number(value))

export function logoBox(entrance) {
  // `null` and `''` are "not set", not zero. `Number(null)` is 0, which is
  // perfectly finite and would clamp every logo on a workspace that had
  // once cleared the field down to the smallest it can be.
  const asked = raw2(entrance?.logoSize)
  const height = Math.round(
    Number.isFinite(asked) ? Math.max(LOGO_MIN, Math.min(LOGO_MAX, asked)) : LOGO_DEFAULT
  )
  // 2.7:1, which is the proportion the fixed 96px/260px box always had.
  const maxWidth = Math.round(height * 2.7)
  const askedGap = raw2(entrance?.logoGap)
  const gap = Math.round(
    Number.isFinite(askedGap) ? Math.max(GAP_MIN, Math.min(GAP_MAX, askedGap)) : GAP_DEFAULT
  )
  return { height, maxWidth, gap, request: Math.min(1600, maxWidth * 2) }
}

export function emptyEntranceItem(kind = 'campaign') {
  const meta = kindMeta(kind)
  return {
    id: uid('en'),
    kind,
    icon: meta.icon,
    title: '',
    subtitle: '',
    color: meta.color,
    active: true,
    startDate: '',
    endDate: '',
  }
}

/** Parses a yyyy-mm-dd box into a Date, or null. */
function parseDay(value, endOfDay = false) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return endOfDay
    ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999)
    : new Date(+m[1], +m[2] - 1, +m[3])
}

/**
 * Is this item live right now?
 *
 * Both dates are optional and independent: a start with no end runs forever
 * from that date, an end with no start runs until then. The end date is
 * inclusive to the last moment of the day, because "ends 31 March" plainly
 * means people should still see it on 31 March.
 */
export function itemIsLive(item, now = new Date()) {
  if (!item?.active) return false
  if (!String(item.title || '').trim()) return false

  const start = parseDay(item.startDate)
  if (start && now < start) return false

  const end = parseDay(item.endDate, true)
  if (end && now > end) return false

  return true
}

/** The items to actually show, in order, capped so the splash stays a splash. */
export function liveEntranceItems(entrance, now = new Date(), max = 4) {
  if (!entrance?.enabled) return []
  return (entrance.items || []).filter((item) => itemIsLive(item, now)).slice(0, max)
}

/**
 * The brand name and tagline to display.
 *
 * A value saved by an admin wins over the build-time env var, so branding
 * can be changed without a redeploy; the env var remains the fallback so a
 * fresh install still says something sensible before anyone has opened the
 * admin panel.
 */
export function resolveBrand(entrance, envName, envTagline) {
  return {
    name: String(entrance?.brandName || '').trim() || envName,
    tagline: String(entrance?.tagline || '').trim() || envTagline,
  }
}

/**
 * How long the splash should hold.
 *
 * Announcements need reading time, so each one buys a little more -- but
 * within hard limits, because an admin who types 60000 into the box should
 * not be able to lock every user out of the dashboard for a minute.
 */
export function entranceDuration(entrance, itemCount = 0) {
  const base = Math.min(6000, Math.max(1200, Number(entrance?.durationMs) || 2600))
  return Math.min(9000, base + itemCount * 700)
}
