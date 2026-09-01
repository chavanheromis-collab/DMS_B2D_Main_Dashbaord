// ---------------------------------------------------------------------
// Reaching somebody who is not looking at the page
// ---------------------------------------------------------------------
// A banner is only a banner to somebody who can see it. The person the
// message is actually for is usually in another tab, or has the browser
// minimised behind the DMS, or is in a meeting with the laptop shut. For
// them the dashboard's own notification is a thing they find later, which
// is the same as not being told.
//
// So: the browser's own notifications, which arrive on the desktop whatever
// the tab is doing -- plus a count in the tab title, which costs no
// permission and is the thing people actually notice when they glance at a
// row of tabs.
//
// Three rules shape everything here:
//
//   ASK AT THE RIGHT MOMENT. A permission prompt on page load is the
//   anti-pattern that gets denied for ever, and a denial is permanent --
//   there is no second chance from JavaScript. So it is asked for by a
//   button, after a message has actually arrived, when the reason for it is
//   on screen.
//
//   ONLY WHEN THEY CANNOT SEE THE PAGE. Firing a desktop notification for a
//   banner somebody is already looking at is how an app teaches people to
//   turn its notifications off.
//
//   NEVER TWICE. A re-render, a reconnecting listener, or a reply arriving
//   on a message must not raise the same alert again.
//
// Pure: state in, decisions out. The one impure function is marked.

import { avatarSpec } from './avatar.js'
import { conversationIdOf, kindOf, titleOf } from './conversations.js'

/** The tab title, when nothing is waiting. */
export const BASE_TITLE = 'Dealer Dashboard'

/** Whether this browser has the API at all. */
export function notifySupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

/** `granted`, `denied`, `default`, or `unsupported`. */
export function permissionState() {
  if (!notifySupported()) return 'unsupported'
  return window.Notification.permission
}

/**
 * Should the app ask to turn notifications on?
 *
 * Whenever it still can. Messages here carry obligations -- somebody is
 * waiting on an answer -- and a message that only arrives if the right tab
 * happens to be open is a message that does not arrive. So it is asked on
 * every session until it is settled, rather than waiting for a first message
 * to justify it.
 *
 * `denied` is still not asked. The browser will not re-prompt, so a button
 * that appears to ask and silently does nothing is worse than no button --
 * the app says where the switch is instead.
 *
 * The prompt itself is still raised from a CLICK. Not politeness: Safari and
 * every browser on iOS refuse `requestPermission` without a user gesture, so
 * asking on load is how you get no prompt at all -- and a prompt somebody
 * chose to open is the one they say yes to.
 */
export function shouldOfferNotifications(state) {
  return state === 'default'
}

/** Has the person put the ask off for now? */
export function askIsDue(state, deferredAt, now = Date.now(), after = ASK_AGAIN_AFTER) {
  if (!shouldOfferNotifications(state)) return false
  if (!deferredAt) return true
  return now - deferredAt >= after
}

/**
 * How long "not now" lasts.
 *
 * Long enough not to be a nag inside one sitting, short enough that somebody
 * who put it off in the morning is asked again before the day is out.
 */
export const ASK_AGAIN_AFTER = 60 * 60 * 1000

/**
 * Everything that warrants a desktop notification right now.
 *
 * MESSAGES AND REPLIES BOTH. A reply is the whole second half of a
 * conversation -- somebody answering the question you asked is exactly what
 * you were waiting to hear about -- and for a long time only the opening
 * message ever buzzed. In a chat there is barely a difference between the
 * two, and there is none at all to the person waiting.
 *
 * Returns EVENTS rather than messages: `{ key, message, reply }`, where
 * `reply` is null for the message itself. The key is what `notified`
 * remembers, so a message and each of its replies are counted separately --
 * keyed by message id alone, one reply would have silenced every one after
 * it.
 *
 * `since` is when this session started. Without it, opening the dashboard
 * while the tab is in the background would fire a notification for every
 * unread thing in the database at once. A notification is for something
 * that JUST HAPPENED; the rest is what the bell is for.
 *
 * `notified` is a Set rather than a list because this is asked on every
 * snapshot and the answer must not get slower as the day goes on.
 */
export function pendingNotifications(
  messages,
  uid,
  { notified = new Set(), visible = true, since = 0 } = {}
) {
  // Somebody looking at the page has already been told, by the toast.
  if (visible) return []

  const fresh = (at) => !since || new Date(at).getTime() >= since
  const out = []

  for (const m of messages || []) {
    if (!m?.id || !isFor(m, uid)) continue

    // Not your own, and not one you have already read somewhere else -- a
    // second device, or before the tab went into the background.
    const unseen = m.from !== uid && !(m.readBy || []).includes(uid)
    if (unseen && !notified.has(m.id) && fresh(m.createdAt)) {
      out.push({ key: m.id, message: m, reply: null })
    }

    for (const [i, r] of (Array.isArray(m.replies) ? m.replies : []).entries()) {
      const key = `${m.id}:r${i}`
      if (r?.from === uid || notified.has(key) || !fresh(r?.at)) continue
      out.push({ key, message: m, reply: r })
    }
  }

  return out
}

function isFor(message, uid) {
  if (message.audience === 'all') return true
  return Array.isArray(message.to) && message.to.includes(uid)
}

/**
 * What one notification says.
 *
 * The sender's name is the title, because that is what a person scans for
 * in a stack of notifications -- "Ravi" tells them more than "New message".
 *
 * `tag` is the message id, so the same message replacing itself is one
 * notification rather than four. `requireInteraction` keeps the ones that
 * need an answer on screen until they are dealt with, which is the whole
 * difference between "should reply" and "can be ignored" carried out of the
 * app and onto the desktop.
 */
export function notificationFor(message, tone, { uid = '', usersById = {}, reply = null } = {}) {
  const conversation = conversationIdOf(message, uid)
  const kind = kindOf(conversation)
  // A reply is from whoever wrote the REPLY, which in a group is very often
  // not whoever started the thread.
  const name = (reply ? reply.name : message?.fromName) || 'New message'
  const body = reply ? reply.text : message?.body
  // Only where it ADDS something. In a one-to-one chat the conversation IS
  // the sender, so appending it gives "Ravi · Ravi" -- or, for somebody with
  // no name on their account, the nonsense "New message · Someone".
  const where = kind === 'all' || kind === 'group' ? titleOf(conversation, usersById) : ''

  return {
    // In a group or the whole-workspace channel, WHO said it is not enough
    // -- "Ravi" and "Ravi · Everyone" are two different things to be
    // interrupted by, and only one of them is worth turning to.
    title: where ? `${name} · ${where}` : name,
    options: {
      body: String(body || '').slice(0, 240),
      tag: conversation || message?.id,
      // An answer has arrived: it does not need answering back, so it does
      // not hold the screen the way the question did.
      requireInteraction: Boolean(tone?.needsReply) && !reply,
      // Renotify would buzz again for a message already showing. The only
      // thing that changes on a delivered message is its replies.
      renotify: false,
      silent: !tone?.blocks,
      // Grouped by conversation on the platforms that do that, so six
      // messages from one person are one stack rather than six alerts.
      data: { conversation, messageId: message?.id, isReply: Boolean(reply) },
      icon: avatarIcon(name, message?.from),
      badge: BADGE,
      // A phone buzzes for something that wants an answer, and stays still
      // for something that does not.
      vibrate: tone?.needsReply && !reply ? [120, 60, 120] : undefined,
    },
  }
}

/**
 * The sender's avatar, as a picture a notification can show.
 *
 * A desktop notification with no icon is a grey square with the browser's
 * logo on it -- indistinguishable from every other site that notifies. The
 * same coloured circle the app draws makes it recognisable before it is
 * read, which is most of what a notification is for.
 *
 * Drawn on a canvas rather than an SVG data URI because Chrome will not load
 * SVG into a notification icon. Returns undefined where there is no canvas
 * (a test, an old browser); the notification is then plain, not broken.
 */
export function avatarIcon(name, person, size = 192) {
  try {
    if (typeof document === 'undefined') return undefined
    const spec = avatarSpec(name, person)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    ctx.fillStyle = spec.bg
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = spec.fg
    ctx.font = `bold ${Math.round(size * 0.4)}px system-ui, -apple-system, Segoe UI, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // A hair below centre: text metrics put the baseline of capitals high,
    // and initials sitting slightly high in a circle read as a mistake.
    ctx.fillText(spec.initials, size / 2, size / 2 + size * 0.02)

    return canvas.toDataURL('image/png')
  } catch {
    return undefined
  }
}

/**
 * The small monochrome mark Android puts in the status bar.
 *
 * Inline so it costs no request and cannot 404 after a deploy.
 */
export const BADGE =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white">' +
      '<path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/></svg>'
  )

/**
 * The tab title, with a count.
 *
 * Costs no permission, survives a denied prompt, and is what somebody
 * actually sees when they glance along a row of tabs. Capped at 9 for the
 * same reason the bell is: past that the number stops being information and
 * starts being width.
 */
export function titleWithBadge(count, base = BASE_TITLE) {
  const n = Number(count) || 0
  if (n <= 0) return base
  return `(${n > 9 ? '9+' : n}) ${base}`
}

/**
 * Whether the page is being looked at.
 *
 * Both halves matter: a visible tab in an unfocused window is a dashboard on
 * a second monitor that nobody is reading, and treating it as seen is how a
 * message gets missed by exactly the person who left it open.
 */
export function pageIsVisible(doc = typeof document === 'undefined' ? null : document) {
  if (!doc) return true
  return doc.visibilityState === 'visible' && doc.hasFocus?.() !== false
}

/**
 * Raise one. The impure one.
 *
 * Wrapped in a try because `new Notification` throws rather than returning
 * null on the platforms that require a service worker for it -- Android
 * Chrome, notably -- and a dashboard must not break on a phone because it
 * tried to be helpful.
 */
export function raise(message, tone, onClick, context) {
  if (permissionState() !== 'granted') return null
  const { title, options } = notificationFor(message, tone, context)
  try {
    const note = new window.Notification(title, options)
    note.onclick = () => {
      window.focus()
      note.close()
      onClick?.(message)
    }
    return note
  } catch {
    // No notification, and no crash. The banner is still there.
    return null
  }
}

/** Ask, once, from a gesture. Resolves to the new state. */
export async function askPermission() {
  if (!notifySupported()) return 'unsupported'
  try {
    return await window.Notification.requestPermission()
  } catch {
    return permissionState()
  }
}
