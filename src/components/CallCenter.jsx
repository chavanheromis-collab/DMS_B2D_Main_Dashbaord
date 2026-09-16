import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Minimize2, Monitor, MonitorOff, Phone, PhoneOff, X } from 'lucide-react'

import { useCallSession } from '../hooks/useCallSession'
import { usePeople } from '../hooks/useMessages'
import { onCallRequest } from '../lib/callBus'
import {
  callStatusText,
  durationText,
  isOver,
  otherName,
  supportsScreenShare,
  theyShare,
  roleOf,
} from '../lib/callSignal'
import { avatarSpec } from '../lib/avatar'
import { pageIsVisible, permissionState, raiseNote, setTitlePart } from '../lib/notify'

// =====================================================================
// Calls
// =====================================================================
// The chat says "look at this row"; a call is where they look at it
// together. Voice and screen go browser to browser -- see
// lib/callSignal.js -- and this is the part people see:
//
//   RINGING is the whole screen, because a call is the one thing here
//   that expires. A card in the corner is something you notice after they
//   have hung up.
//
//   IN A CALL is a corner panel, and can be made smaller still. The point
//   of sharing a dashboard is that both people keep using it, so the call
//   must never be the thing in the way.
//
//   A SHARED SCREEN is big, because it is the reason the call exists.

export default function CallCenter() {
  const session = useCallSession()
  const { byId } = usePeople()
  const { call, incoming, uid } = session

  const [minimised, setMinimised] = useState(false)
  const nameOf = (id) => byId?.[id]?.name || byId?.[id]?.email || 'Someone'

  // The chat panel asks; this answers, wherever either of them is.
  useEffect(() => onCallRequest((peer) => session.start(peer, nameOf(peer))), [session, byId])

  const ringing = Boolean(incoming) && !call
  useRingtone(ringing)

  // Off the tab, a call is the one thing worth interrupting for.
  const announced = useRef('')
  useEffect(() => {
    if (!incoming || pageIsVisible() || permissionState() !== 'granted') return
    if (announced.current === incoming.id) return
    announced.current = incoming.id
    raiseNote({
      title: `${incoming.fromName || 'Someone'} is calling`,
      options: { body: 'Voice and screen share', tag: incoming.id, requireInteraction: true },
    })
  }, [incoming])

  useEffect(() => {
    setTitlePart({ calls: ringing || (call && !isOver(call)) ? 1 : 0 })
    return () => setTitlePart({ calls: 0 })
  }, [ringing, call])

  if (ringing) {
    return <Ringing call={incoming} onAccept={session.accept} onDecline={session.decline} />
  }
  if (!call) return session.error ? <Trouble text={session.error} onClose={session.clearError} /> : null

  return (
    <InCall
      session={session}
      uid={uid}
      minimised={minimised}
      onMinimise={() => setMinimised((m) => !m)}
    />
  )
}

// ---------------------------------------------------------------------
// Ringing
// ---------------------------------------------------------------------

function Ringing({ call, onAccept, onDecline }) {
  const spec = avatarSpec(call.fromName, call.from)
  return (
    <div className="no-print fixed inset-0 z-[10200] flex flex-col items-center justify-center gap-6 bg-slate-900/95 p-6 text-center backdrop-blur">
      <span
        className="flex h-28 w-28 animate-pulse items-center justify-center rounded-full text-3xl font-bold"
        style={{ backgroundColor: spec.bg, color: spec.fg }}
      >
        {spec.initials}
      </span>
      <div>
        <p className="text-2xl font-semibold text-white">{call.fromName || 'Someone'}</p>
        <p className="mt-1 text-sm text-slate-300">is calling · voice and screen</p>
      </div>
      <div className="flex items-center gap-4">
        <button
          onClick={onDecline}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg hover:bg-rose-700"
          aria-label="Decline"
          title="Decline"
        >
          <PhoneOff size={22} />
        </button>
        <button
          onClick={onAccept}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg hover:bg-emerald-700"
          aria-label="Answer"
          title="Answer"
        >
          <Phone size={22} />
        </button>
      </div>
      <p className="text-[11px] text-slate-400">Answering turns on your microphone.</p>
    </div>
  )
}

// ---------------------------------------------------------------------
// In a call
// ---------------------------------------------------------------------

function InCall({ session, uid, minimised, onMinimise }) {
  const { call, connection, muted, sharing, remote } = session
  const audio = useRef(null)
  const video = useRef(null)
  const mine = roleOf(call, uid)
  const watching = theyShare(call, mine)
  const status = callStatusText(call, uid, connection)
  const since = call.answeredAt ? Date.parse(call.answeredAt) : 0
  const elapsed = useElapsed(connection === 'connected' && since ? since : 0)

  // Their voice, always, whatever size the panel is. The element stays
  // mounted for exactly that reason -- a minimised call is still a call.
  useEffect(() => {
    if (audio.current && remote) audio.current.srcObject = remote
    if (video.current && remote) video.current.srcObject = remote
  }, [remote, watching, minimised])

  const ended = isOver(call)

  return (
    <>
      <audio ref={audio} autoPlay playsInline />

      {watching && !minimised && !ended && (
        <div className="no-print fixed inset-x-4 top-4 bottom-24 z-[10150] flex items-center justify-center">
          <video
            ref={video}
            autoPlay
            playsInline
            muted
            className="max-h-full max-w-full rounded-xl border border-slate-700 bg-black shadow-2xl"
          />
        </div>
      )}

      <div
        className={`no-print fixed bottom-4 right-4 z-[10200] flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/95 px-3 py-2 text-white shadow-2xl backdrop-blur ${
          minimised ? '' : 'min-w-[16rem]'
        }`}
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              ended ? 'bg-slate-500' : connection === 'connected' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
            }`}
          />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold">{otherName(call, uid)}</p>
          <p className="truncate text-[10px] text-slate-300">
            {status}
            {elapsed ? ` · ${durationText(elapsed)}` : ''}
          </p>
        </div>

        {!ended && (
          <>
            <button
              onClick={session.toggleMute}
              title={muted ? 'Unmute' : 'Mute'}
              aria-label={muted ? 'Unmute' : 'Mute'}
              className={`rounded-full p-2 ${muted ? 'bg-rose-600 hover:bg-rose-700' : 'bg-slate-700 hover:bg-slate-600'}`}
            >
              {muted ? <MicOff size={14} /> : <Mic size={14} />}
            </button>

            {supportsScreenShare() && (
              <button
                onClick={sharing ? session.stopSharing : session.shareScreen}
                title={sharing ? 'Stop sharing' : 'Share your screen'}
                aria-label={sharing ? 'Stop sharing' : 'Share your screen'}
                className={`rounded-full p-2 ${sharing ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-700 hover:bg-slate-600'}`}
              >
                {sharing ? <MonitorOff size={14} /> : <Monitor size={14} />}
              </button>
            )}

            <button
              onClick={onMinimise}
              title={minimised ? 'Show the call' : 'Make it small'}
              aria-label={minimised ? 'Show the call' : 'Make it small'}
              className="rounded-full bg-slate-700 p-2 hover:bg-slate-600"
            >
              <Minimize2 size={14} />
            </button>

            <button
              onClick={() => session.hangUp('ended')}
              title="Hang up"
              aria-label="Hang up"
              className="rounded-full bg-rose-600 p-2 hover:bg-rose-700"
            >
              <PhoneOff size={14} />
            </button>
          </>
        )}
      </div>

      {session.error && <Trouble text={session.error} onClose={session.clearError} />}
    </>
  )
}

/** Something went wrong with a call, said where a call would have been. */
function Trouble({ text, onClose }) {
  return (
    <div className="no-print fixed bottom-4 right-4 z-[10200] flex max-w-xs items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-snug text-rose-700 shadow-lg">
      <span className="flex-1">{text}</span>
      <button onClick={onClose} aria-label="Close" className="shrink-0 text-rose-400 hover:text-rose-700">
        <X size={12} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------
// The two small clocks
// ---------------------------------------------------------------------

/** How long the call has been connected, ticking once a second. */
function useElapsed(since) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!since) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [since])
  return since ? now - since : 0
}

/**
 * The ring, made rather than downloaded.
 *
 * Two short tones every few seconds, built with the audio the browser
 * already has: an asset would be one more file to deploy and one more
 * thing to 404 after a cache purge. A browser that refuses to make sound
 * before the page is clicked simply stays quiet -- the screen has already
 * gone dark and said who is calling.
 */
function useRingtone(active) {
  useEffect(() => {
    if (!active) return undefined
    const Context = window.AudioContext || window.webkitAudioContext
    if (!Context) return undefined
    let context = null
    try {
      context = new Context()
    } catch {
      return undefined
    }
    context.resume?.().catch(() => {})

    const beep = () => {
      if (!context || context.state !== 'running') return
      for (const [index, frequency] of [440, 554].entries()) {
        const tone = context.createOscillator()
        const level = context.createGain()
        tone.frequency.value = frequency
        tone.connect(level)
        level.connect(context.destination)
        const at = context.currentTime + index * 0.35
        level.gain.setValueAtTime(0.0001, at)
        level.gain.exponentialRampToValueAtTime(0.12, at + 0.05)
        level.gain.exponentialRampToValueAtTime(0.0001, at + 0.3)
        tone.start(at)
        tone.stop(at + 0.32)
      }
    }

    beep()
    const timer = window.setInterval(beep, 3000)
    return () => {
      window.clearInterval(timer)
      context?.close?.().catch(() => {})
    }
  }, [active])
}

