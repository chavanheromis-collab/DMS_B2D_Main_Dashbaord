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

export const DEFAULT_ENTRANCE = {
  enabled: true,
  brandName: '',
  tagline: '',
  // An admin-supplied logo replaces the generic mark on the entrance. Blank
  // keeps the built-in one, so a fresh install still looks finished.
  logoUrl: '',
  durationMs: 2600,
  items: [],
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
