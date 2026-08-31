// ---------------------------------------------------------------------
// A person, as a coloured circle
// ---------------------------------------------------------------------
// Initials on a tint, the same tint for the same person every time. It is
// what makes a list of names skimmable without reading a single one, and it
// is now wanted in three places -- a remark's thread, a conversation list,
// and the icon on a desktop notification.
//
// So it lives in ONE place. Three copies of "which colour is Ravi" is three
// answers to that question, and the day two of them disagree is the day the
// picture stops meaning anything.

/**
 * A 32-bit FNV-1a.
 *
 * Used both to pick a tint and to build a stable document id (see
 * rowNotes.js), which is why it is here rather than in either of them.
 */
export function hash32(text) {
  let h = 0x811c9dc5
  const s = String(text)
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/**
 * Up to two initials.
 *
 * Split on whitespace so "Ravi Kumar" is RK; an email falls back to its
 * first letter, which is still better than a grey circle.
 */
export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * The palette.
 *
 * Every pair is a light ground with a dark ink on it, so the initials are
 * readable on all of them -- a tint that looks pretty and cannot be read is
 * a tint that has stopped being a label.
 */
export const AVATAR_TINTS = [
  { bg: '#EEF2FF', fg: '#4338CA' },
  { bg: '#ECFDF5', fg: '#047857' },
  { bg: '#FFF7ED', fg: '#C2410C' },
  { bg: '#FDF2F8', fg: '#BE185D' },
  { bg: '#F0F9FF', fg: '#0369A1' },
  { bg: '#FEFCE8', fg: '#A16207' },
  { bg: '#F5F3FF', fg: '#6D28D9' },
  { bg: '#F0FDFA', fg: '#0F766E' },
]

/**
 * A stable colour per person.
 *
 * Hashed rather than assigned in order, so somebody's colour does not change
 * because a different person wrote first.
 */
export function tintFor(person) {
  const key = String(person || '')
  if (!key) return AVATAR_TINTS[0]
  return AVATAR_TINTS[parseInt(hash32(key), 36) % AVATAR_TINTS.length]
}

/**
 * Everything needed to DRAW one, without knowing how it will be drawn.
 *
 * The same numbers serve a `<span>` in the panel and a canvas for a desktop
 * notification icon, and keeping the decision here is what stops the
 * notification's avatar drifting away from the one in the app.
 */
export function avatarSpec(name, key) {
  const tint = tintFor(key || name)
  return { initials: initialsOf(name), bg: tint.bg, fg: tint.fg }
}
