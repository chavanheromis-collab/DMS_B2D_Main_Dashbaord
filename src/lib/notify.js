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
 * Should the app offer to turn notifications on?
 *
 * Only when it can still be granted, and only once there is something to
 * justify it. Asking a person who has never received a message to allow
 * notifications is asking them to trust a promise about a thing they have
 * not seen.
 *
 * `denied` is deliberately not offered. The browser will not re-prompt, so a
 * button that appears to ask and silently does nothing is worse than no
 * button -- the app says where the switch is instead.
 */
export function shouldOfferNotifications(state, everReceived) {
  return state === 'default' && everReceived
}

/**
 * The messages that warrant a desktop notification right now.
 *
 * `notified` is the set of ids already raised this session -- a Set rather
 * than a list because this is asked on every snapshot and the answer must
 * not get slower as the day goes on.
 */
export function pendingNotifications(messages, uid, { notified = new Set(), visible = true } = {}) {
  // Somebody looking at the page has already been told, by the banner.
  if (visible) return []

  return (messages || []).filter((m) => {
    if (!m?.id || notified.has(m.id)) return false
    // Not your own, and not one you have already read somewhere else -- a
    // second device, or before the tab went into the background.
    if (m.from === uid) return false
    if ((m.readBy || []).includes(uid)) return false
    return isFor(m, uid)
  })
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
export function notificationFor(message, tone) {
  return {
    title: message?.fromName || 'New message',
    options: {
      body: String(message?.body || '').slice(0, 240),
      tag: message?.id,
      requireInteraction: Boolean(tone?.needsReply),
      // Renotify would buzz again for a message already showing. The only
      // thing that changes on a delivered message is its replies.
      renotify: false,
      silent: !tone?.blocks,
    },
  }
}

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
export function raise(message, tone, onClick) {
  if (permissionState() !== 'granted') return null
  const { title, options } = notificationFor(message, tone)
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
