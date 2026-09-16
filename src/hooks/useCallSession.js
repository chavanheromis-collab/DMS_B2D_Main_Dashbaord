import { useCallback, useEffect, useRef, useState } from 'react'
import { addDoc, arrayUnion, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext.jsx'
import {
  CALLS,
  RECONNECT_GRACE_MS,
  answerFields,
  candidatesKey,
  endFields,
  iceOf,
  iceServers,
  incomingFor,
  isOver,
  mediaProblem,
  newCall,
  offerFields,
  roleOf,
  sdpOf,
  sharingKey,
  staleCalls,
  supportsCalls,
  theirCandidates,
} from '../lib/callSignal'

/**
 * One call, from ringing to hanging up.
 *
 * The connection itself is held in refs rather than state: a
 * RTCPeerConnection is not a value to render, and putting one in state
 * would rebuild the call every time a button changed colour. State here is
 * only what the screen shows -- who, how far along, muted, sharing.
 *
 * Mounted ONCE, on App. Two of these would answer the same call twice.
 */
export function useCallSession() {
  const { user, userDoc } = useAuth()
  const uid = user?.uid
  const myName = userDoc?.name || user?.displayName || user?.email || 'Someone'

  const [incoming, setIncoming] = useState(null)
  const [call, setCall] = useState(null)
  const [connection, setConnection] = useState('new')
  const [muted, setMuted] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [remote, setRemote] = useState(null)
  const [error, setError] = useState('')

  const pc = useRef(null)
  const mic = useRef(null)
  const screen = useRef(null)
  const videoSender = useRef(null)
  const applied = useRef(new Set())
  const answeredRound = useRef(-1)
  const callId = useRef('')
  const role = useRef(null)
  const restart = useRef(null)
  const busy = useRef(false)

  const patch = useCallback((fields) => {
    if (!callId.current) return Promise.resolve()
    return updateDoc(doc(db, CALLS, callId.current), fields).catch(() => {})
  }, [])

  /**
   * Everything local, put down.
   *
   * Tracks first and always: a call that ends without stopping the
   * microphone leaves the browser's recording dot on, which is the one
   * bug in a feature like this that nobody ever forgives.
   */
  const teardown = useCallback(() => {
    window.clearTimeout(restart.current)
    for (const stream of [mic.current, screen.current]) {
      for (const track of stream?.getTracks() || []) track.stop()
    }
    mic.current = null
    screen.current = null
    videoSender.current = null
    try {
      pc.current?.close()
    } catch {
      // Already closed: nothing to do, and nothing worth saying.
    }
    pc.current = null
    applied.current = new Set()
    answeredRound.current = -1
    busy.current = false
    setConnection('new')
    setMuted(false)
    setSharing(false)
    setRemote(null)
  }, [])

  /** Leave the call, tell the other side, and forget the document. */
  const hangUp = useCallback(
    async (reason = 'ended') => {
      const id = callId.current
      callId.current = ''
      role.current = null
      teardown()
      setCall(null)
      if (!id) return
      await updateDoc(doc(db, CALLS, id), endFields(reason)).catch(() => {})
      // A moment for the other side to see WHY, then the document goes:
      // a call is a conversation, not a record.
      window.setTimeout(() => deleteDoc(doc(db, CALLS, id)).catch(() => {}), 4000)
    },
    [teardown]
  )

  /**
   * The connection, with its slots already open.
   *
   * One audio track (the microphone) and one empty video slot. The empty
   * slot is the whole trick: sharing a screen later swaps a track into it,
   * which both sides already agreed to carry, so nothing has to be
   * renegotiated while people are talking.
   */
  const build = useCallback(
    async (mine) => {
      const connectionOf = new RTCPeerConnection({ iceServers: iceServers(import.meta.env) })
      pc.current = connectionOf

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      })
      mic.current = stream
      for (const track of stream.getTracks()) connectionOf.addTrack(track, stream)
      videoSender.current = connectionOf.addTransceiver('video', { direction: 'sendrecv' }).sender

      const inbound = new MediaStream()
      connectionOf.ontrack = (event) => {
        for (const track of event.streams[0]?.getTracks() || [event.track]) inbound.addTrack(track)
        setRemote(inbound)
      }

      connectionOf.onicecandidate = (event) => {
        const candidate = iceOf(event.candidate)
        if (candidate) patch({ [candidatesKey(mine)]: arrayUnion(candidate) })
      }

      connectionOf.onconnectionstatechange = () => {
        const state = connectionOf.connectionState
        setConnection(state)
        window.clearTimeout(restart.current)
        // Only the caller re-offers, and only after a pause: most wobbles
        // heal on their own, and two peers restarting at once ends the
        // call they were both trying to save. See lib/callSignal.js.
        if ((state === 'disconnected' || state === 'failed') && mine === 'caller') {
          restart.current = window.setTimeout(async () => {
            if (!pc.current || pc.current.connectionState === 'connected') return
            const offer = await pc.current.createOffer({ iceRestart: true }).catch(() => null)
            if (!offer) return
            await pc.current.setLocalDescription(offer)
            answeredRound.current = -1
            patch(offerFields(offer, Date.now()))
          }, RECONNECT_GRACE_MS)
        }
      }

      return connectionOf
    },
    [patch]
  )

  // --- starting one -------------------------------------------------------

  const start = useCallback(
    async (peer, peerName) => {
      if (!uid || !peer || peer === uid || busy.current || callId.current) return
      if (!supportsCalls()) {
        setError('This browser cannot make calls')
        return
      }
      busy.current = true
      setError('')
      try {
        const created = await addDoc(
          collection(db, CALLS),
          newCall({ from: uid, fromName: myName, to: peer, toName: peerName })
        )
        callId.current = created.id
        role.current = 'caller'
        const connectionOf = await build('caller')
        const offer = await connectionOf.createOffer()
        await connectionOf.setLocalDescription(offer)
        await patch(offerFields(offer, 0))
      } catch (e) {
        // Logged as well as shown: the sentence is for the person, the error
        // is for whoever they end up asking about it.
        console.error('[call] could not start', e)
        setError(mediaProblem(e) || 'That call could not be started')
        await hangUp('failed')
      } finally {
        busy.current = false
      }
    },
    [uid, myName, build, patch, hangUp]
  )

  const accept = useCallback(async () => {
    const ringing = incoming
    if (!ringing || busy.current || callId.current) return
    busy.current = true
    setError('')
    try {
      callId.current = ringing.id
      role.current = 'callee'
      setCall(ringing)
      const connectionOf = await build('callee')
      await connectionOf.setRemoteDescription(new RTCSessionDescription(ringing.offer))
      const answer = await connectionOf.createAnswer()
      await connectionOf.setLocalDescription(answer)
      answeredRound.current = Number(ringing.round) || 0
      await patch(answerFields(answer))
    } catch (e) {
      console.error('[call] could not answer', e)
      setError(mediaProblem(e) || 'That call could not be answered')
      await hangUp('failed')
    } finally {
      busy.current = false
    }
  }, [incoming, build, patch, hangUp])

  const decline = useCallback(async () => {
    const ringing = incoming
    setIncoming(null)
    if (!ringing?.id) return
    await updateDoc(doc(db, CALLS, ringing.id), endFields('declined')).catch(() => {})
    window.setTimeout(() => deleteDoc(doc(db, CALLS, ringing.id)).catch(() => {}), 4000)
  }, [incoming])

  // --- during one ---------------------------------------------------------

  const toggleMute = useCallback(() => {
    const tracks = mic.current?.getAudioTracks() || []
    const next = !muted
    for (const track of tracks) track.enabled = !next
    setMuted(next)
  }, [muted])

  const stopSharing = useCallback(() => {
    for (const track of screen.current?.getTracks() || []) track.stop()
    screen.current = null
    // Back to an empty slot, which is what the connection was built with.
    videoSender.current?.replaceTrack(null)
    setSharing(false)
    patch({ [sharingKey(role.current)]: false })
  }, [patch])

  const shareScreen = useCallback(async () => {
    if (!pc.current || !videoSender.current) return
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false })
      screen.current = stream
      const track = stream.getVideoTracks()[0]
      // Swapped into the slot opened when the call was built: no new offer,
      // no answer, nothing for a live call to trip over.
      await videoSender.current.replaceTrack(track)
      setSharing(true)
      patch({ [sharingKey(role.current)]: true })
      // The browser's own "Stop sharing" bar is a button this app does not
      // own, and it has to mean the same thing as the one that does.
      track.onended = () => stopSharing()
    } catch (e) {
      if (e?.name !== 'NotAllowedError') setError('That screen could not be shared')
    }
  }, [patch, stopSharing])

  // --- the document -------------------------------------------------------

  // Everything addressed to me, so a call can arrive on any page. One
  // equality filter, so no index is needed -- see incomingFor.
  useEffect(() => {
    if (!uid) return undefined
    return onSnapshot(
      query(collection(db, CALLS), where('to', '==', uid)),
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        setIncoming(callId.current ? null : incomingFor(rows, uid))
        // Yesterday's rings, swept by whoever they were for.
        for (const old of staleCalls(rows, uid)) {
          if (old.id !== callId.current) deleteDoc(doc(db, CALLS, old.id)).catch(() => {})
        }
      },
      () => setIncoming(null)
    )
  }, [uid])

  // The call I am in, whichever end I am.
  useEffect(() => {
    if (!call?.id && !callId.current) return undefined
    const id = callId.current
    if (!id) return undefined
    return onSnapshot(
      doc(db, CALLS, id),
      (snap) => {
        if (!snap.exists()) {
          teardown()
          callId.current = ''
          role.current = null
          setCall(null)
          return
        }
        setCall({ id: snap.id, ...snap.data() })
      },
      () => {}
    )
  }, [call?.id, teardown])

  // Whatever has arrived on it: the answer, their candidates, a fresh
  // offer after a restart, or the end.
  useEffect(() => {
    const connectionOf = pc.current
    const mine = role.current
    if (!call || !connectionOf || !mine) return

    if (isOver(call)) {
      teardown()
      const id = callId.current
      callId.current = ''
      role.current = null
      window.setTimeout(() => setCall(null), 1200)
      if (id) window.setTimeout(() => deleteDoc(doc(db, CALLS, id)).catch(() => {}), 4000)
      return
    }

    const run = async () => {
      if (mine === 'caller' && call.answer && !connectionOf.currentRemoteDescription) {
        await connectionOf.setRemoteDescription(new RTCSessionDescription(call.answer)).catch(() => {})
      }
      // A round the caller started again: answer the new offer with a new
      // answer, or the restart never completes.
      if (mine === 'callee' && call.offer && Number(call.round) > answeredRound.current) {
        answeredRound.current = Number(call.round)
        await connectionOf.setRemoteDescription(new RTCSessionDescription(call.offer)).catch(() => {})
        const answer = await connectionOf.createAnswer().catch(() => null)
        if (answer) {
          await connectionOf.setLocalDescription(answer)
          patch(answerFields(answer))
        }
      }
      for (const candidate of theirCandidates(call, mine)) {
        const key = candidate?.candidate
        if (!key || applied.current.has(key)) continue
        applied.current.add(key)
        await connectionOf.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {})
      }
    }
    run()
  }, [call, patch, teardown])

  // A call is a person waiting: closing the tab should say so first, and
  // leaving for any reason should hang up rather than ring on in silence.
  useEffect(() => {
    if (!call || isOver(call)) return undefined
    const warn = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [call])

  useEffect(() => () => teardown(), [teardown])

  return {
    uid,
    incoming,
    call,
    connection,
    muted,
    sharing,
    remote,
    error,
    start,
    accept,
    decline,
    hangUp,
    toggleMute,
    shareScreen,
    stopSharing,
    clearError: () => setError(''),
  }
}
