import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  CALLS,
  RING_MS,
  answerFields,
  callProblem,
  callStatusText,
  candidatesKey,
  durationText,
  endFields,
  endedText,
  hasRelay,
  iceOf,
  iceServers,
  incomingFor,
  isOver,
  isRinging,
  mediaProblem,
  newCall,
  offerFields,
  otherName,
  roleOf,
  sdpOf,
  sharingKey,
  staleCalls,
  theirCandidates,
  theyShare,
} from './callSignal.js'
import { callListenerCount, onCallRequest, requestCall } from './callBus.js'

// ---------------------------------------------------------------------
// Talking, and showing your screen
// ---------------------------------------------------------------------
// The call is two browsers talking directly; this file is the handshake
// they talk through, and the ways a call goes wrong that are nobody's
// fault: a ring nobody answers, a network that wobbles, a tab that is
// closed mid-sentence.

const ME = 'u_me'
const THEM = 'u_them'
const NOW = new Date('2026-09-16T10:00:00.000Z').getTime()
const ago = (ms) => new Date(NOW - ms).toISOString()

const ring = (over = {}) => ({
  id: 'c1',
  ...newCall({ from: THEM, fromName: 'Ravi', to: ME, toName: 'Me' }),
  createdAt: ago(1000),
  ...over,
})

// --- what a call is ------------------------------------------------------

test('a new call names both people and rings', () => {
  const call = newCall({ from: ME, fromName: 'Me', to: THEM, toName: 'Ravi' })
  assert.equal(call.status, 'ringing')
  assert.equal(call.from, ME)
  assert.equal(call.to, THEM)
  assert.equal(call.round, 0)
  // Firestore refuses undefined, so every field a call will ever set is
  // present from the start.
  for (const key of ['offer', 'answer', 'callerSharing', 'calleeSharing', 'callerCandidates', 'calleeCandidates']) {
    assert.ok(key in call, key)
  }
  assert.equal(roleOf(call, ME), 'caller')
  assert.equal(roleOf(call, THEM), 'callee')
  assert.equal(roleOf(call, 'somebody else'), null)
  assert.equal(otherName(call, ME), 'Ravi')
  assert.equal(otherName(call, THEM), 'Me')
})

test('only what Firestore can store is stored', () => {
  // The browser hands over class instances with getters; they do not
  // survive being written, and what the other side needs is two fields.
  assert.deepEqual(sdpOf({ type: 'offer', sdp: 'v=0', extra: 'ignored' }), { type: 'offer', sdp: 'v=0' })
  assert.equal(sdpOf({ type: 'offer' }), null)
  assert.equal(sdpOf(null), null)

  assert.deepEqual(iceOf({ candidate: 'candidate:1 1 udp', sdpMid: '0', sdpMLineIndex: 0 }), {
    candidate: 'candidate:1 1 udp',
    sdpMid: '0',
    sdpMLineIndex: 0,
    usernameFragment: null,
  })
  // The end-of-candidates marker is not a candidate.
  assert.equal(iceOf({ candidate: '' }), null)
  assert.equal(iceOf(null), null)
})

test('a fresh offer clears the answer that belonged to the old one', () => {
  const fields = offerFields({ type: 'offer', sdp: 'v=1' }, 7)
  assert.equal(fields.round, 7)
  assert.equal(fields.answer, null, 'a stale answer would be applied to a new question')
  assert.equal(answerFields({ type: 'answer', sdp: 'v=1' }).status, 'live')
  assert.equal(endFields('declined').status, 'ended')
  assert.equal(endFields().endedReason, 'ended')
})

test('each side writes its own candidates and reads the other’s', () => {
  const call = { callerCandidates: [{ candidate: 'a' }], calleeCandidates: [{ candidate: 'b' }] }
  assert.equal(candidatesKey('caller'), 'callerCandidates')
  assert.equal(candidatesKey('callee'), 'calleeCandidates')
  assert.deepEqual(theirCandidates(call, 'caller'), [{ candidate: 'b' }])
  assert.deepEqual(theirCandidates(call, 'callee'), [{ candidate: 'a' }])
  assert.deepEqual(theirCandidates({}, 'caller'), [])

  assert.equal(sharingKey('callee'), 'calleeSharing')
  assert.equal(theyShare({ calleeSharing: true }, 'caller'), true)
  assert.equal(theyShare({ calleeSharing: true }, 'callee'), false)
})

// --- ringing, and giving up -----------------------------------------------

test('a ring nobody answers expires rather than ringing all day', () => {
  assert.equal(isRinging(ring(), NOW), true)
  assert.equal(isRinging(ring({ createdAt: ago(RING_MS + 1) }), NOW), false)
  assert.equal(isRinging(ring({ status: 'live' }), NOW), false)
  assert.equal(isRinging(null, NOW), false)
})

test('the call I hear about is the newest one for me, and never my own', () => {
  const mine = { ...ring({ id: 'out' }), from: ME, to: THEM }
  const older = ring({ id: 'old', createdAt: ago(20000) })
  const newer = ring({ id: 'new', createdAt: ago(500) })
  const done = ring({ id: 'done', status: 'ended' })
  assert.equal(incomingFor([mine, older, newer, done], ME, NOW)?.id, 'new')
  assert.equal(incomingFor([mine, done], ME, NOW), null)
  assert.equal(incomingFor([], ME, NOW), null)
})

test('finished and expired calls are swept, live ones are left alone', () => {
  const live = ring({ id: 'live', status: 'live' })
  const dead = ring({ id: 'dead', status: 'ended' })
  const missed = ring({ id: 'missed', createdAt: ago(RING_MS + 1) })
  const theirs = { ...ring({ id: 'theirs', status: 'ended' }), from: 'x', to: 'y' }
  assert.deepEqual(staleCalls([live, dead, missed, theirs], ME, NOW).map((c) => c.id), ['dead', 'missed'])
})

// --- what it says ----------------------------------------------------------

test('the words come from the connection, not from the document', () => {
  // The document says "live" the moment it is answered, seconds before any
  // sound arrives -- so "Connected" waits for the connection itself.
  const live = { ...ring(), status: 'live' }
  assert.equal(callStatusText(live, ME, 'connecting'), 'Connecting…')
  assert.equal(callStatusText(live, ME, 'connected'), 'Connected')
  assert.equal(callStatusText(live, ME, 'disconnected'), 'Reconnecting…')
  assert.equal(callStatusText(live, ME, 'failed'), 'Could not connect')
  assert.equal(callStatusText(ring(), ME, 'new'), 'Wants to talk')
  assert.equal(callStatusText({ ...ring(), from: ME, to: THEM }, ME, 'new'), 'Ringing…')
  assert.equal(callStatusText({ ...ring(), status: 'ended', endedReason: 'declined' }, ME, 'closed'), 'Call declined')
  assert.equal(callStatusText(null, ME, 'new'), '')

  assert.equal(endedText('missed'), 'No answer')
  assert.equal(endedText(), 'Call ended')
  assert.equal(isOver({ status: 'ended' }), true)
  assert.equal(isOver({ status: 'live' }), false)
})

test('a call reads its length as a clock', () => {
  assert.equal(durationText(0), '0:00')
  assert.equal(durationText(7000), '0:07')
  assert.equal(durationText(61000), '1:01')
  assert.equal(durationText(3 * 3600 * 1000 + 62000), '3:01:02')
  assert.equal(durationText(-5), '0:00')
})

test('what stops a call being started is said before it is tried', () => {
  assert.equal(callProblem({ supported: false, person: THEM, me: ME }), 'This browser cannot make calls')
  assert.equal(callProblem({ person: '', me: ME }), 'Pick who to call')
  assert.equal(callProblem({ person: ME, me: ME }), 'You cannot call yourself')
  assert.equal(callProblem({ person: THEM, me: ME }), '')
})

// --- how to be reached -------------------------------------------------------

test('STUN always, and a relay only when one has been paid for', () => {
  const plain = iceServers({})
  assert.equal(plain.length, 1)
  assert.ok(String(plain[0].urls).includes('stun:'))
  assert.equal(hasRelay({}), false)

  const relayed = iceServers({ VITE_TURN_URL: 'turn:relay.example:3478, turns:relay.example:5349', VITE_TURN_USER: 'u', VITE_TURN_PASS: 'p' })
  assert.equal(relayed.length, 2)
  assert.deepEqual(relayed[1].urls, ['turn:relay.example:3478', 'turns:relay.example:5349'])
  assert.equal(relayed[1].username, 'u')
  assert.equal(relayed[1].credential, 'p')
  assert.equal(hasRelay({ VITE_TURN_URL: 'turn:x' }), true)
})

// --- one verb, two places -------------------------------------------------------

test('the chat asks for a call and the call hears it, wherever each of them is', () => {
  const heard = []
  const stop = onCallRequest((id) => heard.push(id))
  assert.equal(requestCall(THEM), 1)
  assert.deepEqual(heard, [THEM])
  // Nothing is asked for nobody.
  assert.equal(requestCall(''), 0)
  assert.deepEqual(heard, [THEM])

  // One listener throwing does not silence the rest.
  const stopBad = onCallRequest(() => {
    throw new Error('no')
  })
  requestCall('u_third')
  assert.deepEqual(heard, [THEM, 'u_third'])

  stop()
  stopBad()
  assert.equal(callListenerCount(), 0)
  assert.equal(requestCall(THEM), 0)
})

// --- wiring ---------------------------------------------------------------------

const SRC = path.resolve(import.meta.dirname, '..')
const ROOT = path.resolve(SRC, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

test('a call survives changing pages, because it does not live on a page', () => {
  const app = read('App.jsx')
  assert.ok(app.includes('<CallCenter />'))
  assert.equal(read('components/AppShell.jsx').includes('CallCenter'), false)
})

test('sharing a screen swaps a track into a slot the call already has', () => {
  const session = read('hooks/useCallSession.js')
  // The slot, opened when the connection is built.
  assert.ok(session.includes("addTransceiver('video', { direction: 'sendrecv' }).sender"))
  // And the swap, which needs no new offer -- renegotiating a live call is
  // how calls drop, and sharing is when it would happen.
  assert.ok(session.includes('videoSender.current.replaceTrack(track)'))
  assert.ok(session.includes('videoSender.current?.replaceTrack(null)'))
})

test('a wobble is given a moment, and only the caller re-offers', () => {
  const session = read('hooks/useCallSession.js')
  assert.ok(session.includes("(state === 'disconnected' || state === 'failed') && mine === 'caller'"))
  assert.ok(session.includes('createOffer({ iceRestart: true })'))
  assert.ok(session.includes('RECONNECT_GRACE_MS'))
})

test('every way out of a call stops the microphone', () => {
  const session = read('hooks/useCallSession.js')
  assert.ok(session.includes('for (const track of stream?.getTracks() || []) track.stop()'))
  // On hanging up, on the other side ending it, and on unmount.
  assert.ok(session.includes('const teardown = useCallback('))
  assert.ok(session.includes('useEffect(() => () => teardown(), [teardown])'))
  // And a tab closed mid-call says so first.
  assert.ok(session.includes("window.addEventListener('beforeunload', warn)"))
})

test('the chat offers a call for one person only', () => {
  const chat = read('components/Conversations.jsx')
  assert.ok(chat.includes("kindOf(id) === 'direct' && supportsCalls() && ("))
  assert.ok(chat.includes('onClick={() => requestCall(id)}'))
})

test('a ringing call takes the screen, and being in one does not', () => {
  const centre = read('components/CallCenter.jsx')
  assert.ok(centre.includes('fixed inset-0 z-[10200]'), 'the ring covers the page')
  assert.ok(centre.includes('fixed bottom-4 right-4'), 'the call itself sits in the corner')
  // Their voice keeps playing whatever size the panel is.
  assert.ok(centre.includes('<audio ref={audio} autoPlay playsInline />'))
  assert.ok(centre.includes('setTitlePart({ calls:'))
})

test('only the two people in a call can read or write it', () => {
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8')
  const block = rules.slice(rules.indexOf('match /calls/'), rules.indexOf('match /access/'))
  assert.ok(block.length > 0, 'no rule for calls')
  assert.ok(block.includes('resource.data.from == request.auth.uid || resource.data.to == request.auth.uid'))
  // A call comes from its caller: nobody can make a phone ring with
  // somebody else's name on it.
  assert.ok(block.includes('request.resource.data.from == request.auth.uid'))
  assert.ok(block.includes("request.resource.data.status == 'ringing'"))
  // And neither side can change who is in it.
  assert.ok(block.includes('request.resource.data.to == resource.data.to'))
  assert.equal(CALLS, 'calls')
})

// --- when it will not start ----------------------------------------------

test('a call that will not start says which of the causes it was', () => {
  // The report this was written for: "call could not be started", on a
  // computer whose only audio device was an output. One sentence for five
  // different problems is a sentence that tells nobody anything.
  assert.match(mediaProblem({ name: 'NotFoundError' }), /No microphone was found/)
  assert.match(mediaProblem({ name: 'DevicesNotFoundError' }), /No microphone was found/)
  assert.match(mediaProblem({ name: 'NotAllowedError' }), /blocked for this site/)
  assert.match(mediaProblem({ name: 'NotReadableError' }), /another app/)
  assert.match(mediaProblem({ name: 'SecurityError' }), /secure connection/)
  // A refused write is not a media fault at all, and is an admin's job.
  assert.match(mediaProblem({ code: 'permission-denied' }), /deploy the Firestore rules/)
})

test('an unrecognised failure leaves the caller its own words', () => {
  // Better a plain sentence than a confident wrong diagnosis.
  assert.equal(mediaProblem({ name: 'SomethingNew' }), '')
  assert.equal(mediaProblem(undefined), '')
  assert.equal(mediaProblem(null), '')
})

test('both ends of a call name the cause, and log it for whoever is asked', () => {
  const session = read('hooks/useCallSession.js')
  assert.ok(session.includes("setError(mediaProblem(e) || 'That call could not be started')"))
  assert.ok(session.includes("setError(mediaProblem(e) || 'That call could not be answered')"))
  // Swallowed entirely, a failure leaves nothing to diagnose from.
  assert.ok(session.includes("console.error('[call] could not start', e)"))
})
