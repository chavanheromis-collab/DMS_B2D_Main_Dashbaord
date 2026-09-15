// ---------------------------------------------------------------------
// Who has the dashboard open
// ---------------------------------------------------------------------
// A message to somebody who is looking at the dashboard right now gets an
// answer in a minute. The same message to somebody who closed it on
// Friday gets one on Monday. The sender cannot tell which from a name in
// a list, so they send it anyway and then wonder -- or ring, which is the
// thing messaging here exists to avoid.
//
// So every contact carries a dot: green while they have the dashboard
// open in a tab -- the one in front or one in the background -- red when
// they do not, and in words, when they were last here.
//
// Firestore has no "is this person connected" of its own -- that is the
// Realtime Database's onDisconnect, which this project does not use. So
// presence is a HEARTBEAT: an open tab stamps `presence/{uid}` every
// minute, and anybody stamped recently is green. Four decisions make that
// feel right rather than approximately right:
//
//   THE BEAT is a minute. A browser runs a background tab's timers at most
//   about once a minute, so beating faster would only be honoured by the
//   tab in front -- and a dashboard left open behind a spreadsheet, the
//   commonest way it is "open", must stay green.
//
//   THE WINDOW is two and a half beats. One missed beat, a slow network or
//   a throttled timer must not flick somebody red and back; two missed in a
//   row is somebody who has genuinely gone.
//
//   CLOSING says so at once, so a person turns red when they leave rather
//   than two minutes later. It is best-effort -- a closing page gets very
//   little time -- and the window catches the times it does not arrive.
//
//   TABS OF ONE BROWSER TALK. Five open tabs are one person, not five
//   heartbeats: they share one beat between them, and closing one of them
//   does not report its owner as gone while four are still open.
//
// Its own collection, NOT a field on the user document, and that is not
// tidiness. The signed-in user's own profile is subscribed live by the
// auth context, so a beat there would re-render the entire app every
// minute; and the message centre listens to the whole users collection on
// every open dashboard, so every beat by anybody would be a paid read in
// every tab. Here, only the chat panel listens, and only while it is open.

export const HEARTBEAT_MS = 60 * 1000
export const ONLINE_WINDOW_MS = 150 * 1000

/** A tab coming back to the front says so, but not more often than this. */
export const MIN_BEAT_GAP_MS = 20 * 1000

/**
 * A minute's beat is skipped if a sibling tab wrote within this.
 *
 * Half a beat, not a whole one: timers drift, and two tabs each waiting for
 * a FULL minute of the other's silence could both wait long enough to let
 * the window expire between them.
 */
export const SHARED_BEAT_MS = 30 * 1000

/** How long a tab waits, after a sibling closes, before speaking up. */
export const SIBLING_SETTLE_MS = 3 * 1000

/** How often an open chat panel re-reads the clock, so stale dots go red. */
export const PRESENCE_TICK_MS = 30 * 1000

/** How long signing out waits to say so before signing out anyway. */
export const SIGN_OUT_WAIT_MS = 1500

export const PRESENCE_COLLECTION = 'presence'

/** How open tabs of the same browser tell each other what they are doing. */
export const PRESENCE_CHANNEL = 'dms-presence'

/**
 * A stored time, whatever shape it arrived in.
 *
 * A Firestore Timestamp in the app, `{ seconds }` after a JSON round
 * trip, a Date, a number, or an ISO string from a hand-edited document.
 * Anything unreadable is 0 -- "never" -- rather than NaN, which compares
 * false with everything and would make somebody both online and not.
 */
export function toMillis(value) {
  if (!value) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0
  if (typeof value.toMillis === 'function') {
    const ms = value.toMillis()
    return Number.isFinite(ms) ? ms : 0
  }
  if (typeof value.seconds === 'number') return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6)
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Is this person here, and when were they last?
 *
 * `lastSeen` is the later of the heartbeat and the last sign-in. Before
 * this shipped nobody had a heartbeat, and "never" on every contact on the
 * first morning would be false: signing in IS opening the dashboard, and
 * that time was already being kept. It is also what everybody still shows
 * if the presence rules have not been deployed yet.
 *
 * "Closed" is believed only while it is the latest thing known. A sign-in
 * AFTER the tab was closed is somebody who came back.
 *
 * A time slightly in the FUTURE counts as now. The stamp is the server's
 * clock and "now" is this machine's, and a laptop running a minute slow
 * would otherwise see everybody's fresh beat as not having happened yet.
 * A long way into the future is a broken clock, not a fresh beat.
 */
export function presenceOf(person, now = Date.now()) {
  const beat = toMillis(person?.lastSeenAt)
  const login = toMillis(person?.lastLogin)
  const lastSeen = Math.max(beat, login)
  const age = now - lastSeen
  const fresh = lastSeen > 0 && age <= ONLINE_WINDOW_MS && age >= -ONLINE_WINDOW_MS
  const closed = person?.presenceState === 'closed' && beat >= login
  return { online: fresh && !closed, lastSeen, known: lastSeen > 0 }
}

const clockOf = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

function sameDay(a, b) {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

/**
 * "Active now", or when they were last here, in the fewest words that are
 * unambiguous.
 *
 * Minutes while it is recent, because "12 min ago" is what somebody deciding
 * whether to wait needs. A clock once it is not, because "340 min ago"
 * makes the reader do arithmetic -- "today at 09:40" does not.
 */
export function lastSeenText(presence, now = Date.now()) {
  if (presence?.online) return 'Active now'
  const ms = presence?.lastSeen || 0
  if (!ms) return 'Never opened the dashboard'

  const mins = Math.floor(Math.max(0, now - ms) / 60000)
  if (mins < 1) return 'Last seen just now'
  if (mins < 60) return `Last seen ${mins} min ago`
  if (sameDay(ms, now)) return `Last seen today at ${clockOf(ms)}`
  if (sameDay(ms, now - 24 * 60 * 60 * 1000)) return `Last seen yesterday at ${clockOf(ms)}`

  const days = Math.floor((now - ms) / (24 * 60 * 60 * 1000))
  const d = new Date(ms)
  if (days < 7) {
    return `Last seen ${d.toLocaleDateString(undefined, { weekday: 'long' })} at ${clockOf(ms)}`
  }
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return `Last seen ${d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })}`
}

/**
 * One contact's dot and words, from the directory and the beats.
 *
 * The directory supplies the sign-in time and the beats the heartbeat, and
 * either may be missing: somebody not yet loaded, or rules not deployed.
 */
export function presenceFor(id, { people, beats, now = Date.now() } = {}) {
  const person = people?.[id]
  const beat = beats?.[id]
  const presence = presenceOf(
    { lastLogin: person?.lastLogin, lastSeenAt: beat?.lastSeenAt, presenceState: beat?.presenceState },
    now
  )
  return { ...presence, text: lastSeenText(presence, now) }
}

/** How many of a group are here. `seen` is presenceFor, already bound. */
export function groupPresence(ids, seen) {
  const list = Array.isArray(ids) ? ids : []
  return { active: list.filter((id) => seen?.(id)?.online).length, total: list.length }
}

export function groupPresenceText({ active = 0, total = 0 } = {}) {
  if (!total) return ''
  if (!active) return 'Nobody here is active now'
  return `${active} of ${total} active now`
}

/** The two fields a beat writes -- and all the rules let it write. */
export function beatFields(state, stamp) {
  return { presenceState: state === 'closed' ? 'closed' : 'open', lastSeenAt: stamp }
}

/**
 * Whether a tab should write now.
 *
 *   'tick'  the minute's beat -- skipped if any tab of this browser wrote
 *           in the last half minute, which is what makes five tabs one
 *           write instead of five.
 *   'front' coming back to the tab -- skipped if it is too soon after the
 *           last, so flicking between tabs is not a write per flick.
 *   anything else ('open', 'return', 'sibling-left') always writes: each
 *           is a moment the stored state may be wrong.
 */
export function shouldBeat(reason, { now = Date.now(), lastBeat = 0 } = {}) {
  if (reason === 'tick') return now - lastBeat >= SHARED_BEAT_MS
  if (reason === 'front') return now - lastBeat >= MIN_BEAT_GAP_MS
  return true
}

/**
 * How many OTHER tabs of this browser are still open.
 *
 * `heard` is when each last said anything. A tab that crashed never says
 * goodbye, so one silent for longer than the window is not counted -- or
 * closing the last real tab would never report its owner gone.
 */
export function livingSiblings(heard, now = Date.now()) {
  return Object.values(heard || {}).filter((ms) => now - ms <= ONLINE_WINDOW_MS).length
}

/**
 * "Closed", as a request that survives the page closing.
 *
 * The Firestore SDK writes over a connection the browser tears down with
 * the page, so a write started as a tab closes often never leaves. A
 * `keepalive` fetch is the one kind of request a browser promises to finish
 * after the page has gone, so the same write is sent that way too, to
 * Firestore's REST endpoint, as the same person. Same rules, same fields:
 * the stamp is the server's REQUEST_TIME, exactly what `serverTimestamp()`
 * is, so the rule that insists on it cannot tell the two apart.
 *
 * Null when anything it needs is missing -- best-effort means doing
 * nothing rather than sending a request that is certain to be refused.
 */
export function closeRequest({ projectId, uid, token } = {}) {
  if (!projectId || !uid || !token) return null
  const root = `projects/${projectId}/databases/(default)/documents`
  return {
    url: `https://firestore.googleapis.com/v1/${root}:commit`,
    init: {
      method: 'POST',
      keepalive: true,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: `${root}/${PRESENCE_COLLECTION}/${uid}`,
              fields: { presenceState: { stringValue: 'closed' } },
            },
            updateMask: { fieldPaths: ['presenceState'] },
            updateTransforms: [{ fieldPath: 'lastSeenAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
      }),
    },
  }
}
