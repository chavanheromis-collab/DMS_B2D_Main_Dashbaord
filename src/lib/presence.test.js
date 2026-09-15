import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  HEARTBEAT_MS,
  MIN_BEAT_GAP_MS,
  ONLINE_WINDOW_MS,
  PRESENCE_TICK_MS,
  SHARED_BEAT_MS,
  beatFields,
  closeRequest,
  groupPresence,
  groupPresenceText,
  lastSeenText,
  livingSiblings,
  presenceFor,
  presenceOf,
  shouldBeat,
  toMillis,
} from './presence.js'

// ---------------------------------------------------------------------
// Who has the dashboard open
// ---------------------------------------------------------------------
// A dot is only useful if it is right. Green for somebody who left an
// hour ago sends a message into silence; red for somebody sitting in a
// background tab sends a phone call nobody needed. What is tested is the
// edges of those two mistakes -- and the two ways a heartbeat quietly
// costs more than it should.

const SRC = path.resolve(import.meta.dirname, '..')
const ROOT = path.resolve(SRC, '..')
const strip = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')
const read = (p) => strip(fs.readFileSync(path.join(SRC, p), 'utf8'))

const NOW = new Date('2026-09-15T15:00:00').getTime()
const MIN = 60 * 1000
const ago = (ms) => NOW - ms

// --- the numbers, chosen together ---------------------------------------

test('the window outlasts a missed beat, and not two', () => {
  // A throttled background tab or a slow network must not flicker
  // somebody red and back; two beats missed in a row is somebody gone.
  assert.ok(ONLINE_WINDOW_MS > HEARTBEAT_MS * 2)
  assert.ok(ONLINE_WINDOW_MS < HEARTBEAT_MS * 3)
  // A browser runs a background tab's timers about once a minute, so the
  // beat must not be faster than that or only the front tab keeps it.
  assert.ok(HEARTBEAT_MS >= 60 * 1000)
  // Coming back is cheaper than a tick is shared, which is under a beat.
  assert.ok(MIN_BEAT_GAP_MS < SHARED_BEAT_MS)
  assert.ok(SHARED_BEAT_MS <= HEARTBEAT_MS / 2)
  // And an open panel notices a stale dot well inside the window.
  assert.ok(PRESENCE_TICK_MS < ONLINE_WINDOW_MS / 2)
})

// --- reading a stored time ----------------------------------------------

test('a stored time is read whatever shape it arrived in', () => {
  assert.equal(toMillis(NOW), NOW)
  assert.equal(toMillis(new Date(NOW)), NOW)
  assert.equal(toMillis({ toMillis: () => NOW }), NOW, 'a Firestore Timestamp')
  assert.equal(toMillis({ seconds: NOW / 1000, nanoseconds: 0 }), NOW, 'one after a JSON round trip')
  assert.equal(toMillis(new Date(NOW).toISOString()), NOW)
})

test('anything unreadable is never, not NaN', () => {
  // NaN compares false with everything, which would make somebody both
  // online and not at once.
  for (const bad of [null, undefined, '', 'yesterday-ish', NaN, new Date('nope'), {}]) {
    assert.equal(toMillis(bad), 0, String(bad))
  }
})

// --- green or red --------------------------------------------------------

test('a fresh beat is green', () => {
  assert.equal(presenceOf({ lastSeenAt: ago(10 * 1000), presenceState: 'open' }, NOW).online, true)
  assert.equal(presenceOf({ lastSeenAt: ago(HEARTBEAT_MS) }, NOW).online, true)
})

test('one missed beat is still green; two is red', () => {
  assert.equal(presenceOf({ lastSeenAt: ago(HEARTBEAT_MS * 2) }, NOW).online, true)
  assert.equal(presenceOf({ lastSeenAt: ago(ONLINE_WINDOW_MS + 1) }, NOW).online, false)
})

test('closing turns it red at once, not two minutes later', () => {
  assert.equal(presenceOf({ lastSeenAt: ago(5 * 1000), presenceState: 'closed' }, NOW).online, false)
})

test('...but a sign-in after the close is somebody who came back', () => {
  const back = presenceOf({ lastSeenAt: ago(60 * 1000), presenceState: 'closed', lastLogin: ago(10 * 1000) }, NOW)
  assert.equal(back.online, true)
  // And a close after the sign-in is still a close.
  const gone = presenceOf({ lastSeenAt: ago(10 * 1000), presenceState: 'closed', lastLogin: ago(60 * 1000) }, NOW)
  assert.equal(gone.online, false)
})

test('a beat slightly in the future is now, a long way in is a broken clock', () => {
  // The stamp is the server's clock and now is this machine's.
  assert.equal(presenceOf({ lastSeenAt: NOW + 30 * 1000 }, NOW).online, true)
  assert.equal(presenceOf({ lastSeenAt: NOW + 24 * 60 * MIN }, NOW).online, false)
})

test('somebody who has never had a heartbeat is red and not yet known', () => {
  const p = presenceOf({}, NOW)
  assert.equal(p.online, false)
  assert.equal(p.known, false)
  assert.equal(presenceOf(null, NOW).online, false)
})

test('the last sign-in counts as the last time the dashboard was opened', () => {
  // Nobody had a heartbeat before this shipped; "never" on every contact
  // the first morning would be false.
  const p = presenceOf({ lastLogin: ago(3 * 60 * MIN) }, NOW)
  assert.equal(p.known, true)
  assert.equal(p.lastSeen, ago(3 * 60 * MIN))
  // And the later of the two wins.
  assert.equal(presenceOf({ lastLogin: ago(60 * MIN), lastSeenAt: ago(5 * MIN) }, NOW).lastSeen, ago(5 * MIN))
})

// --- saying when ---------------------------------------------------------

test('online says active now', () => {
  assert.equal(lastSeenText({ online: true, lastSeen: NOW }, NOW), 'Active now')
})

test('recent is in minutes, because that is what someone deciding to wait needs', () => {
  assert.equal(lastSeenText({ online: false, lastSeen: ago(20 * 1000) }, NOW), 'Last seen just now')
  assert.equal(lastSeenText({ online: false, lastSeen: ago(12 * MIN) }, NOW), 'Last seen 12 min ago')
})

test('older is a clock, so nobody does arithmetic on "340 min ago"', () => {
  assert.match(lastSeenText({ online: false, lastSeen: ago(5 * 60 * MIN) }, NOW), /^Last seen today at /)
  assert.match(lastSeenText({ online: false, lastSeen: ago(20 * 60 * MIN) }, NOW), /^Last seen yesterday at /)
  assert.match(lastSeenText({ online: false, lastSeen: ago(3 * 24 * 60 * MIN) }, NOW), /^Last seen \S+ at /)
  // A week or more is a date.
  const old = lastSeenText({ online: false, lastSeen: ago(20 * 24 * 60 * MIN) }, NOW)
  assert.match(old, /^Last seen /)
  assert.equal(old.includes(' at '), false)
})

test('never is said as never', () => {
  assert.equal(lastSeenText({ online: false, lastSeen: 0 }, NOW), 'Never opened the dashboard')
  assert.equal(lastSeenText(null, NOW), 'Never opened the dashboard')
})

// --- one contact, from two sources ---------------------------------------

test('a contact reads the beat from presence and the sign-in from the directory', () => {
  const people = { u1: { lastLogin: ago(3 * 60 * MIN) }, u2: { lastLogin: ago(3 * 60 * MIN) } }
  const beats = { u1: { lastSeenAt: ago(30 * 1000), presenceState: 'open' } }
  const here = presenceFor('u1', { people, beats, now: NOW })
  assert.equal(here.online, true)
  assert.equal(here.text, 'Active now')
  // No beat -- rules not deployed, or never opened since -- is the sign-in.
  const away = presenceFor('u2', { people, beats, now: NOW })
  assert.equal(away.online, false)
  assert.match(away.text, /^Last seen today at /)
  // Somebody the directory has not loaded is not an error.
  assert.equal(presenceFor('nobody', { now: NOW }).text, 'Never opened the dashboard')
})

test('a group says how many are here, never a dot that means someone', () => {
  const seen = (id) => ({ online: id !== 'c' })
  assert.deepEqual(groupPresence(['a', 'b', 'c'], seen), { active: 2, total: 3 })
  assert.equal(groupPresenceText({ active: 2, total: 3 }), '2 of 3 active now')
  assert.equal(groupPresenceText({ active: 0, total: 3 }), 'Nobody here is active now')
  assert.equal(groupPresenceText({ active: 0, total: 0 }), '')
  assert.deepEqual(groupPresence(null, seen), { active: 0, total: 0 })
})

// --- what a beat writes --------------------------------------------------

test('a beat writes the two fields the rules allow, and nothing else', () => {
  const fields = beatFields('open', 'STAMP')
  assert.deepEqual(fields, { presenceState: 'open', lastSeenAt: 'STAMP' })
  assert.equal(beatFields('closed', 'S').presenceState, 'closed')
  assert.equal(beatFields('nonsense', 'S').presenceState, 'open')
})

// --- five tabs are one person ---------------------------------------------

test('a minute tick is skipped when a sibling tab has just written', () => {
  assert.equal(shouldBeat('tick', { now: NOW, lastBeat: ago(SHARED_BEAT_MS - 1) }), false)
  assert.equal(shouldBeat('tick', { now: NOW, lastBeat: ago(SHARED_BEAT_MS) }), true)
  assert.equal(shouldBeat('tick', { now: NOW, lastBeat: 0 }), true)
})

test('flicking between tabs is not a write per flick', () => {
  assert.equal(shouldBeat('front', { now: NOW, lastBeat: ago(5 * 1000) }), false)
  assert.equal(shouldBeat('front', { now: NOW, lastBeat: ago(MIN_BEAT_GAP_MS) }), true)
})

test('opening, coming back and a sibling leaving always write', () => {
  for (const reason of ['open', 'return', 'sibling-left']) {
    assert.equal(shouldBeat(reason, { now: NOW, lastBeat: NOW }), true, reason)
  }
})

test('a sibling that went silent is not counted as still open', () => {
  // A crashed tab never says goodbye. Counting it for ever would mean
  // closing the last real tab never reported its owner gone.
  assert.equal(livingSiblings({ a: ago(30 * 1000), b: ago(ONLINE_WINDOW_MS + 1) }, NOW), 1)
  assert.equal(livingSiblings({}, NOW), 0)
  assert.equal(livingSiblings(null, NOW), 0)
})

// --- closing, as a request that outlives the page -------------------------

test('the close request is the same write, as the same person, that survives the page', () => {
  const req = closeRequest({ projectId: 'proj', uid: 'u1', token: 'tok' })
  assert.equal(req.url, 'https://firestore.googleapis.com/v1/projects/proj/databases/(default)/documents:commit')
  assert.equal(req.init.method, 'POST')
  assert.equal(req.init.keepalive, true, 'without keepalive the browser cancels it with the page')
  assert.equal(req.init.headers.Authorization, 'Bearer tok')

  const [write] = JSON.parse(req.init.body).writes
  assert.equal(write.update.name, 'projects/proj/databases/(default)/documents/presence/u1')
  assert.deepEqual(write.update.fields, { presenceState: { stringValue: 'closed' } })
  assert.deepEqual(write.updateMask.fieldPaths, ['presenceState'])
  // The server's time, not this machine's -- which is also the only stamp
  // the rules accept.
  assert.deepEqual(write.updateTransforms, [{ fieldPath: 'lastSeenAt', setToServerValue: 'REQUEST_TIME' }])
})

test('nothing is sent when it would certainly be refused', () => {
  assert.equal(closeRequest({ projectId: 'p', uid: 'u' }), null)
  assert.equal(closeRequest({ projectId: 'p', token: 't' }), null)
  assert.equal(closeRequest({ uid: 'u', token: 't' }), null)
  assert.equal(closeRequest(), null)
})

// --- the heartbeat -------------------------------------------------------

const hook = read('hooks/usePresence.js')
const heartbeat = hook.slice(hook.indexOf('export function usePresenceHeartbeat'), hook.indexOf('export function usePresenceBeats'))
const cleanup = heartbeat.slice(heartbeat.indexOf('return () => {'))

test('beats go to their own collection, never the user profile', () => {
  // The profile is subscribed live by the auth context and the whole users
  // collection by every message centre: a beat there would re-render the
  // app every minute and be a paid read in every open tab.
  assert.ok(heartbeat.includes('const ref = doc(db, PRESENCE_COLLECTION, uid)'))
  assert.equal(hook.includes("'users'"), false)
})

test('the beat is stamped by the server clock, not this machine', () => {
  assert.ok(heartbeat.includes('setDoc(ref, beatFields(state, serverTimestamp())).catch(() => {})'))
  assert.equal(/beatFields\([^,()]+, (?!serverTimestamp\(\))/.test(hook), false, 'a client time is written')
})

test('it beats on open, every minute, and on coming back', () => {
  assert.ok(heartbeat.includes("beat('open')"))
  assert.ok(heartbeat.includes("beat('tick') }, HEARTBEAT_MS)"))
  assert.ok(heartbeat.includes('if (!shouldBeat(reason, { now, lastBeat })) return'))
  assert.ok(heartbeat.includes("document.addEventListener('visibilitychange', onFront)"))
  // Out of the back/forward cache, a page's timers were frozen.
  assert.ok(heartbeat.includes("window.addEventListener('pageshow', onShow)"))
})

test('tabs share one beat and know about each other', () => {
  assert.ok(heartbeat.includes("if (note.type === 'beat' && note.at > lastBeat) lastBeat = note.at"))
  assert.ok(heartbeat.includes("if (note.type === 'hello') tell('here')"))
  assert.ok(heartbeat.includes("if (!note || note.uid !== uid || note.tab === tab) return"))
  // A browser without a channel is one tab, not an error.
  assert.ok(heartbeat.includes("typeof BroadcastChannel === 'undefined' ? null"))
})

test('closing one of two tabs does not report its owner gone', () => {
  assert.ok(heartbeat.includes("window.addEventListener('pagehide', onLeave)"))
  assert.ok(heartbeat.includes("tell('closing') if (livingSiblings(heard, Date.now()) > 0) return write('closed')"))
  // And the tab left behind speaks up, in case the closing one did not know.
  assert.ok(heartbeat.includes("settle = window.setTimeout(() => beat('sibling-left'), SIBLING_SETTLE_MS)"))
})

test('the last tab closing is sent so it survives the page going', () => {
  assert.ok(heartbeat.includes('closeRequest({ projectId: db.app.options.projectId, uid, token })'))
  assert.ok(heartbeat.includes('if (request) fetch(request.url, request.init).catch(() => {})'))
})

test('unmounting is not closing', () => {
  // The only unmount is the account changing, and signing out writes its
  // own "closed" first -- after it, the rules refuse the write anyway.
  assert.ok(cleanup.length > 0)
  assert.equal(cleanup.includes('write('), false)
  assert.equal(cleanup.includes("tell('closing')"), false)
  assert.ok(cleanup.includes('window.clearTimeout(settle)'))
})

test('only an active account beats', () => {
  assert.ok(heartbeat.includes('const uid = isActive ? user?.uid : undefined'))
})

test('reading beats is one listener, and a failure is the sign-in fallback, not an error', () => {
  const beats = hook.slice(hook.indexOf('export function usePresenceBeats'))
  assert.ok(beats.includes('collection(db, PRESENCE_COLLECTION)'))
  assert.ok(beats.includes("serverTimestamps: 'estimate'"))
  assert.ok(beats.includes('() => setBeats({})'))
})

// --- where it runs ---------------------------------------------------------

test('it runs on App, which never unmounts on a route change', () => {
  // On the dashboard's shell, opening the admin panel would read to
  // colleagues as leaving and coming back.
  assert.ok(read('App.jsx').includes('<PresenceHeartbeat />'))
  assert.equal(read('components/AppShell.jsx').includes('PresenceHeartbeat'), false)
  // And not in the message centre, which renders nothing for somebody who
  // cannot receive messages.
  assert.equal(read('components/MessageCenter.jsx').includes('usePresence'), false)
})

test('signing out says so first, and does not hang doing it', () => {
  const authSource = read('context/AuthContext.jsx')
  assert.match(
    authSource,
    /const signOut = useCallback\(async \(\) => \{.*setDoc\(doc\(db, PRESENCE_COLLECTION, uid\), beatFields\('closed', serverTimestamp\(\)\)\).*await fbSignOut\(auth\)/
  )
  assert.ok(authSource.includes('new Promise((resolve) => setTimeout(resolve, SIGN_OUT_WAIT_MS))'))
})

// --- the chat panel ---------------------------------------------------------

const chat = read('components/Conversations.jsx')

test('beats are read only while the chat panel is open', () => {
  assert.ok(chat.includes('const beats = usePresenceBeats()'))
  assert.ok(chat.includes('presenceFor(id, { people: byId, beats, now })'))
  // A clock of its own: a colleague whose beats STOP is never announced by
  // a snapshot, so without it their dot would stay green.
  assert.ok(chat.includes('const now = useNow(PRESENCE_TICK_MS)'))
})

test('a dot on one person, words in the header, a count for a group', () => {
  assert.ok(chat.includes("presence={row.kind === 'direct' ? seen?.(row.id) : null}"))
  assert.ok(chat.includes("presence={kindOf(id) === 'direct' ? seen?.(id) : null}"))
  assert.ok(chat.includes("{kindOf(id) === 'direct' && seen && <PresenceText presence={seen(id)} />}"))
  assert.ok(chat.includes('groupPresenceText(groupPresence(membersOf(id), seen))'))
  // Picking somebody new is exactly when "are they here" matters.
  assert.ok(chat.includes('presence={seen?.(p.id)}'))
})

test('green is here and red is not, and a message bubble has no dot', () => {
  assert.ok(chat.includes("presence.online ? 'bg-emerald-500' : 'bg-rose-500'"))
  assert.ok(chat.includes('<Avatar name={name} person={entry.from} size={28} />'))
})

// --- the rule ----------------------------------------------------------------

test('you can only stamp yourself, only these two fields, only with the server time', () => {
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8')
  const block = strip(rules.slice(rules.indexOf('match /presence/'), rules.indexOf('match /access/')))
  assert.ok(block.length > 0, 'no presence rule')
  assert.ok(block.includes('allow read: if isSignedIn();'))
  assert.ok(block.includes('allow create, update: if isSelf(userId) &&'))
  assert.ok(block.includes("request.resource.data.keys().hasOnly(['presenceState', 'lastSeenAt'])"))
  assert.ok(block.includes("request.resource.data.presenceState in ['open', 'closed']"))
  // Without this, anybody with a console could look online for a year.
  assert.ok(block.includes('request.resource.data.lastSeenAt == request.time'))
})
