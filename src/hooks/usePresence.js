import { useEffect, useState } from 'react'
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { useAuth } from '../context/AuthContext.jsx'
import {
  HEARTBEAT_MS,
  PRESENCE_CHANNEL,
  PRESENCE_COLLECTION,
  SIBLING_SETTLE_MS,
  beatFields,
  closeRequest,
  livingSiblings,
  shouldBeat,
} from '../lib/presence'

/**
 * Keeps this person's "dashboard open" stamp fresh while any tab is open.
 *
 * Mounted once, on App, for everybody whose account is active -- not in the
 * message centre, which renders nothing for somebody who cannot receive
 * messages. Being messageable and being here are different questions, and
 * showing somebody as away because an admin switched their inbox off would
 * be wrong. On App rather than the dashboard's shell because App never
 * unmounts on a route change: opening the admin panel is not, to
 * colleagues, leaving and coming back.
 *
 * What it writes, and when -- see lib/presence.js for why these numbers:
 *
 *   ON OPEN and EVERY MINUTE: "open", stamped by the SERVER's clock, so a
 *   laptop with a wrong clock cannot make its owner look online for a week.
 *   A minute's beat is skipped when another tab of this browser has just
 *   written one -- they tell each other on a BroadcastChannel.
 *
 *   ON COMING BACK: to the front, or out of the browser's back/forward
 *   cache, so a tab that sat frozen is green the moment it is looked at.
 *
 *   ON CLOSE: "closed" -- unless another tab of this browser is still open,
 *   in which case the person has not gone anywhere and saying so would turn
 *   them red for a minute. Sent twice, through the SDK and as a keepalive
 *   request, because a closing page often takes the SDK's connection with
 *   it before the write leaves.
 *
 * NOT on unmount. The only unmount is the account changing, and signing
 * out writes "closed" itself, BEFORE signing out (see AuthContext): after
 * it, the rules no longer let this browser write that person's presence.
 *
 * Every write may fail silently. A dot a minute late is the whole cost, and
 * it must never surface as an error on a dashboard somebody is using for
 * something else.
 */
export function usePresenceHeartbeat() {
  const { user, isActive } = useAuth()
  const uid = isActive ? user?.uid : undefined

  useEffect(() => {
    if (!uid) return undefined
    const ref = doc(db, PRESENCE_COLLECTION, uid)
    const tab = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    // When each other open tab of this browser last said anything.
    const heard = {}
    let lastBeat = 0
    let token = ''
    let settle = 0

    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(PRESENCE_CHANNEL)
    const tell = (type, extra) => channel?.postMessage({ type, tab, uid, ...extra })

    // Kept in hand for the keepalive close, which cannot wait for a
    // promise: by the time one resolved, the page would be gone. The SDK
    // hands back its cached token and refreshes it only near expiry, so
    // asking every minute costs nothing.
    const freshToken = () => {
      auth.currentUser
        ?.getIdToken()
        .then((t) => {
          token = t
        })
        .catch(() => {})
    }

    const write = (state) => {
      setDoc(ref, beatFields(state, serverTimestamp())).catch(() => {})
    }

    const beat = (reason) => {
      const now = Date.now()
      if (!shouldBeat(reason, { now, lastBeat })) return
      lastBeat = now
      write('open')
      tell('beat', { at: now })
    }

    const onMessage = (event) => {
      const note = event?.data
      if (!note || note.uid !== uid || note.tab === tab) return
      if (note.type === 'closing') {
        delete heard[note.tab]
        // A moment's grace, then "still here". The closing tab normally
        // knew about this one and wrote nothing; this is for when it did
        // not, and its "closed" has to land before this "open" does.
        window.clearTimeout(settle)
        settle = window.setTimeout(() => beat('sibling-left'), SIBLING_SETTLE_MS)
        return
      }
      heard[note.tab] = Date.now()
      // A newcomer is answered, so it knows it is not alone before it
      // ever has to decide whether closing means leaving.
      if (note.type === 'hello') tell('here')
      if (note.type === 'beat' && note.at > lastBeat) lastBeat = note.at
    }
    channel?.addEventListener('message', onMessage)

    tell('hello')
    freshToken()
    beat('open')
    const timer = window.setInterval(() => {
      tell('here')
      freshToken()
      beat('tick')
    }, HEARTBEAT_MS)

    const onFront = () => {
      if (document.visibilityState === 'visible') beat('front')
    }
    document.addEventListener('visibilitychange', onFront)
    window.addEventListener('focus', onFront)

    const onShow = (event) => {
      if (!event.persisted) return
      tell('hello')
      beat('return')
    }
    window.addEventListener('pageshow', onShow)

    // `pagehide` rather than `beforeunload`: it fires on every way a page
    // goes away, a phone discarding a background tab included, and it does
    // not stop the browser keeping the page for Back.
    const onLeave = () => {
      tell('closing')
      if (livingSiblings(heard, Date.now()) > 0) return
      write('closed')
      const request = closeRequest({ projectId: db.app.options.projectId, uid, token })
      if (request) fetch(request.url, request.init).catch(() => {})
    }
    window.addEventListener('pagehide', onLeave)

    return () => {
      window.clearInterval(timer)
      window.clearTimeout(settle)
      document.removeEventListener('visibilitychange', onFront)
      window.removeEventListener('focus', onFront)
      window.removeEventListener('pageshow', onShow)
      window.removeEventListener('pagehide', onLeave)
      channel?.removeEventListener('message', onMessage)
      channel?.close()
    }
  }, [uid])
}

/**
 * Everybody's last beat, while something on screen needs it.
 *
 * Called by the chat panel, which exists only while it is open -- so a
 * dashboard nobody is chatting on pays for no presence reads at all. One
 * listener on the collection, not one per contact.
 *
 * `estimate` so a beat still on its way to the server reads as now rather
 * than as nothing. A listener that fails -- the rules not deployed yet, or
 * offline -- leaves the beats empty, and everybody falls back to when they
 * last signed in: red, with a true "last seen", rather than an error in a
 * chat panel.
 */
export function usePresenceBeats() {
  const { user } = useAuth()
  const [beats, setBeats] = useState({})

  useEffect(() => {
    if (!user?.uid) return undefined
    return onSnapshot(
      collection(db, PRESENCE_COLLECTION),
      (snap) => {
        setBeats(Object.fromEntries(snap.docs.map((d) => [d.id, d.data({ serverTimestamps: 'estimate' })])))
      },
      () => setBeats({})
    )
  }, [user?.uid])

  return beats
}

/** The heartbeat as something to put in a tree. Renders nothing. */
export function PresenceHeartbeat() {
  usePresenceHeartbeat()
  return null
}
