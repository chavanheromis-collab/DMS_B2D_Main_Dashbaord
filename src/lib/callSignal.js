// ---------------------------------------------------------------------
// Talking, and showing what is on your screen
// ---------------------------------------------------------------------
// "Look at this row" is a sentence that takes four messages and a
// screenshot, and ends with somebody reading out a chassis number over the
// phone. So: a call, from the chat, with the screen in it.
//
// The call itself never touches this app's servers. Two browsers talk
// DIRECTLY to each other (WebRTC) -- voice and screen go peer to peer,
// which is why there is no media server here and no per-minute bill. The
// only thing Firestore carries is the handshake: each side's description
// of how to be reached, written into one document both of them can read.
//
// Four decisions shape everything:
//
//   ONE DOCUMENT PER CALL, holding the offer, the answer and both sides'
//   network candidates. It is deleted when the call ends. Candidates live
//   in ARRAYS on that document rather than in a sub-collection: a
//   sub-collection would need its own rule, and that rule would have to
//   read the parent document on every candidate to know who the two people
//   are -- a paid read per candidate, per call.
//
//   THE VIDEO SLOT IS OPENED AT THE START, empty. Sharing a screen then
//   swaps a track into a slot that already exists, instead of changing the
//   shape of the connection mid-call. Renegotiating a live call is the
//   commonest way a call drops, and the commonest moment for it is exactly
//   when somebody starts sharing.
//
//   THE CALLER LEADS. Both sides can end a call, mute and share, but only
//   the caller re-offers when the network wobbles. Two peers restarting at
//   once is "glare": two offers cross, both are refused, and the call that
//   was merely unsteady is now over.
//
//   IT FAILS LOUDLY AND CLEANS UP. A ring nobody answers expires, an ended
//   call deletes its document, and every path that leaves a call stops the
//   microphone. A dashboard that keeps a mic open after a call is a
//   dashboard nobody trusts twice.
//
// Pure: no React, no Firestore. What to write, not the writing.

export const CALLS = 'calls'

/** How long an unanswered call rings before it is treated as missed. */
export const RING_MS = 45 * 1000

/** How long "Declined" or "Call ended" stays on screen before it clears. */
export const END_LINGER_MS = 2500

/**
 * How long a wobbling connection is given before the caller re-offers.
 *
 * WebRTC says `disconnected` for any gap in the flow -- a lift, a Wi-Fi
 * handover, a laptop changing network. Most of them heal by themselves
 * within a few seconds, and restarting immediately would take a call that
 * was about to recover and rebuild it instead.
 */
export const RECONNECT_GRACE_MS = 6000

/** Can this browser make a call at all? */
export function supportsCalls() {
  if (typeof window === 'undefined') return false
  return typeof window.RTCPeerConnection === 'function' && Boolean(navigator?.mediaDevices?.getUserMedia)
}

/**
 * Can it share a screen?
 *
 * Separately asked, because phones cannot. Android Chrome and every
 * browser on iOS have no `getDisplayMedia` at all -- the call still works
 * there, and the button simply is not offered rather than failing when
 * pressed.
 */
export function supportsScreenShare() {
  return Boolean(typeof navigator !== 'undefined' && navigator.mediaDevices?.getDisplayMedia)
}

/**
 * Where to ask "how can I be reached".
 *
 * STUN alone is enough for most networks: it tells a browser its own
 * public address, and the two then talk directly. It is NOT enough behind
 * a strict corporate firewall or some mobile networks, where the only way
 * through is a relay (TURN) -- which is a paid service, so it is
 * configuration rather than a default. Without one, a small number of
 * calls will say "could not connect" rather than connecting badly.
 */
export function iceServers(env = {}) {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
  const urls = String(env.VITE_TURN_URL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (urls.length > 0) {
    servers.push({
      urls,
      username: String(env.VITE_TURN_USER || ''),
      credential: String(env.VITE_TURN_PASS || ''),
    })
  }
  return servers
}

/** Has a relay been configured, for the note the admin needs to see? */
export const hasRelay = (env = {}) => String(env.VITE_TURN_URL || '').trim() !== ''

// ---------------------------------------------------------------------
// What gets written
// ---------------------------------------------------------------------

/**
 * A session description as Firestore can store it.
 *
 * The browser's own object is a class with getters; Firestore refuses it.
 * Only these two fields mean anything to the other side.
 */
export const sdpOf = (description) =>
  description?.type && description?.sdp ? { type: description.type, sdp: description.sdp } : null

/** One network candidate, flattened, with no undefined for Firestore to refuse. */
export function iceOf(candidate) {
  const line = candidate?.candidate
  if (!line) return null
  return {
    candidate: line,
    sdpMid: candidate.sdpMid ?? null,
    sdpMLineIndex: candidate.sdpMLineIndex ?? null,
    usernameFragment: candidate.usernameFragment ?? null,
  }
}

export function newCall({ from, fromName, to, toName }) {
  return {
    from,
    to,
    fromName: fromName || 'Someone',
    toName: toName || 'Someone',
    status: 'ringing',
    createdAt: new Date().toISOString(),
    // Bumped by an ICE restart, so the other side can tell a fresh offer
    // from the one it has already answered.
    round: 0,
    offer: null,
    answer: null,
    callerSharing: false,
    calleeSharing: false,
    callerCandidates: [],
    calleeCandidates: [],
  }
}

export const offerFields = (offer, round = 0) => ({
  offer: sdpOf(offer),
  round: Number(round) || 0,
  // The old answer belongs to the old offer; leaving it would have the
  // caller apply a stale reply to a fresh question.
  answer: null,
})

export const answerFields = (answer) => ({
  status: 'live',
  answer: sdpOf(answer),
  answeredAt: new Date().toISOString(),
})

export const endFields = (reason) => ({
  status: 'ended',
  endedReason: reason || 'ended',
  endedAt: new Date().toISOString(),
})

// ---------------------------------------------------------------------
// Reading one back
// ---------------------------------------------------------------------

export function roleOf(call, uid) {
  if (!call || !uid) return null
  if (call.from === uid) return 'caller'
  if (call.to === uid) return 'callee'
  return null
}

export const otherId = (call, uid) => (roleOf(call, uid) === 'caller' ? call?.to : call?.from) || ''
export const otherName = (call, uid) =>
  (roleOf(call, uid) === 'caller' ? call?.toName : call?.fromName) || 'Someone'

export const candidatesKey = (role) => (role === 'caller' ? 'callerCandidates' : 'calleeCandidates')
export const theirCandidates = (call, role) =>
  (role === 'caller' ? call?.calleeCandidates : call?.callerCandidates) || []
export const sharingKey = (role) => (role === 'caller' ? 'callerSharing' : 'calleeSharing')
export const theyShare = (call, role) => Boolean(role === 'caller' ? call?.calleeSharing : call?.callerSharing)

export const isOver = (call) => !call || call.status === 'ended'

/** Still ringing, and not so old that nobody is waiting on it any more. */
export function isRinging(call, now = Date.now()) {
  if (call?.status !== 'ringing') return false
  const at = Date.parse(call.createdAt || '')
  return Number.isFinite(at) ? now - at < RING_MS : true
}

/**
 * The call I should be hearing about, out of everything addressed to me.
 *
 * The newest one: if two people ring within a minute, the one still
 * ringing is the one that just arrived. Everything ended, expired, or
 * mine-to-somebody-else is ignored here rather than filtered in a query,
 * because a compound query would need an index this app should not need.
 */
export function incomingFor(calls, uid, now = Date.now()) {
  return (
    (calls || [])
      .filter((call) => call?.to === uid && isRinging(call, now))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null
  )
}

/** Old rings and finished calls, for the sweep that keeps the collection small. */
export function staleCalls(calls, uid, now = Date.now()) {
  return (calls || []).filter((call) => {
    if (!call?.id || roleOf(call, uid) === null) return false
    if (call.status === 'ended') return true
    return call.status === 'ringing' && !isRinging(call, now)
  })
}

export function endedText(reason) {
  if (reason === 'declined') return 'Call declined'
  if (reason === 'missed') return 'No answer'
  if (reason === 'busy') return 'They are already on a call'
  if (reason === 'failed') return 'Could not connect'
  return 'Call ended'
}

/**
 * What the call is doing, in the fewest words that are true.
 *
 * `connection` is the browser's own word for the peer connection, which is
 * the only honest source for "are we actually through": the document says
 * `live` the moment the call is answered, several seconds before any sound
 * arrives.
 */
export function callStatusText(call, uid, connection) {
  if (!call) return ''
  if (call.status === 'ended') return endedText(call.endedReason)
  if (call.status === 'ringing') return roleOf(call, uid) === 'caller' ? 'Ringing…' : 'Wants to talk'
  if (connection === 'connected') return 'Connected'
  if (connection === 'failed') return 'Could not connect'
  if (connection === 'disconnected') return 'Reconnecting…'
  return 'Connecting…'
}

/** 0:07, 4:31, 1:02:09 -- a clock, because that is how long a call reads. */
export function durationText(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
  const seconds = String(total % 60).padStart(2, '0')
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

/** Why a call cannot be started, or ''. */
export function callProblem({ supported = true, person = null, me = '' } = {}) {
  if (!supported) return 'This browser cannot make calls'
  if (!person) return 'Pick who to call'
  if (person === me) return 'You cannot call yourself'
  return ''
}

/**
 * What actually went wrong when a call would not start, in words.
 *
 * Every failure used to arrive as the same sentence -- "that call could not
 * be started" -- which is true and useless. A microphone the site is
 * blocked from, a computer with no microphone at all, and a headset another
 * app is holding are three different problems with three different fixes,
 * and only one of them is anybody's fault here. The browser already tells
 * them apart by error name; this turns that into something a person can act
 * on without opening a console.
 *
 * Returns '' for anything unrecognised, so the caller keeps its own
 * sentence rather than this inventing a confident wrong one.
 */
export function mediaProblem(failure) {
  switch (String(failure?.name || '')) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'The microphone is blocked for this site. Allow it in the padlock menu, then try again.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found on this computer. Plug in a headset or microphone to make calls.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The microphone is being used by another app. Close that app, then try again.'
    case 'SecurityError':
      return 'Calls need a secure connection. Open the dashboard over https, or on localhost.'
    case 'OverconstrainedError':
      return 'That microphone could not be used. Pick a different one in the browser settings.'
    default:
      // A refused write looks nothing like a media error, and means the
      // rules that let two people share a call document never reached the
      // project -- an admin's job, not something to retry.
      if (String(failure?.code || '') === 'permission-denied') {
        return 'Calls are not set up yet — an admin needs to deploy the Firestore rules.'
      }
      return ''
  }
}
