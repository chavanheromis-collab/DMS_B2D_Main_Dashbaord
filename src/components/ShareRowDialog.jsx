import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Search, Send, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useMessageActions, useMessagePrefs, usePeople } from '../hooks/useMessages'
import { usePresenceBeats } from '../hooks/usePresence'
import { useNow } from '../hooks/useReminders'
import { TONE_CHOICES, audienceLabel, canReceiveMessages, canSendMessages, toneOf } from '../lib/messages'
import { MAX_SHARE_NOTE, shareBody, shareProblem } from '../lib/rowShare'
import { PRESENCE_TICK_MS, presenceFor } from '../lib/presence'
import { avatarSpec } from '../lib/avatar'
import SharedRowCard from './SharedRowCard.jsx'

/**
 * Sending one row to somebody.
 *
 * Everything the decision needs on one screen, top to bottom in the order
 * it is made: WHAT is going (the card exactly as they will see it), WHO it
 * goes to, what you are ASKING of them, and anything you want to SAY.
 *
 * The card is shown before anything else on purpose. The admin decided
 * which columns travel, and the sender should see that decision -- "why is
 * the customer's number not on it" is answered by looking, before sending,
 * rather than by the recipient asking.
 *
 * It goes as an ordinary message, through the same send as the chat, so it
 * lands in the conversation with that person, raises the same banner, and
 * can be answered and unsent like anything else said there.
 */
export default function ShareRowDialog({ snapshot, onClose }) {
  const { user, userDoc } = useAuth()
  const me = user?.uid
  const { people, byId } = usePeople()
  const { send } = useMessageActions()
  // Who is here: somebody with the dashboard open answers "can you check
  // this one" in a minute, and that is worth seeing while choosing.
  const beats = usePresenceBeats()
  const now = useNow(PRESENCE_TICK_MS)
  // A row goes out asking for whatever this person's messages usually ask
  // for -- the same setting the chat composer uses.
  const { defaultTone } = useMessagePrefs()

  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState([])
  const [note, setNote] = useState('')
  const [tone, setTone] = useState(defaultTone)
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState('')
  const [sentTo, setSentTo] = useState('')

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // The dialog can open before the preference has arrived.
  useEffect(() => {
    setTone(defaultTone)
  }, [defaultTone])

  // Sent is shown long enough to be read, then it gets out of the way.
  useEffect(() => {
    if (!sentTo) return undefined
    const timer = window.setTimeout(() => onClose(), 1600)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentTo])

  // Not yourself, and nobody an admin has switched off -- the same rule as
  // starting a chat, for the same reason: a message to somebody whose
  // message centre does not appear is a message into a hole.
  const shown = useMemo(() => {
    const others = people.filter((p) => p.id !== me && canReceiveMessages(p))
    const q = query.trim().toLowerCase()
    if (!q) return others
    return others.filter((p) => `${p.name || ''} ${p.email || ''} ${p.jobRole || ''}`.toLowerCase().includes(q))
  }, [people, me, query])

  const maySend = canSendMessages(userDoc)
  const problem = shareProblem({ to: picked, snapshot, note })

  async function submit() {
    if (problem || sending || !maySend) return
    setSending(true)
    setFailed('')
    try {
      await send({ audience: 'people', to: picked, body: shareBody(snapshot, note), tone, row: snapshot })
      setSentTo(audienceLabel({ audience: 'people', to: picked }, byId))
    } catch (e) {
      setFailed(e?.message || 'That could not be sent')
    } finally {
      setSending(false)
    }
  }

  const toggle = (id) => setPicked((all) => (all.includes(id) ? all.filter((x) => x !== id) : [...all, id]))

  return createPortal(
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Send this row in a message"
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        // A press inside must not close it -- selecting text in the note
        // and letting go over the backdrop would throw the note away.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          <Send size={14} className="text-indigo-500" />
          <p className="flex-1 text-sm font-semibold text-slate-800">Send this row</p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={16} />
          </button>
        </header>

        {sentTo ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <Check size={20} />
            </span>
            <p className="text-sm font-medium text-slate-700">Sent to {sentTo}</p>
            <p className="text-[11px] text-slate-400">It is in your chat with them, under Messages.</p>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <div>
                <SharedRowCard row={snapshot} />
                <p className="mt-1 text-[10px] leading-snug text-slate-400">
                  Only the columns an admin set to be shared are sent, as they are right now.
                </p>
              </div>

              <div>
                <p className="mb-1 text-[11px] font-medium text-slate-500">
                  To{picked.length > 0 && <span className="font-normal text-slate-400"> · {picked.length} chosen</span>}
                </p>
                {picked.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1">
                    {picked.map((id) => (
                      <button
                        key={id}
                        onClick={() => toggle(id)}
                        title="Remove"
                        className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
                      >
                        {byId[id]?.name || byId[id]?.email || 'Someone'} <X size={10} />
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1">
                  <Search size={12} className="shrink-0 text-slate-400" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search people…"
                    className="min-w-0 flex-1 text-xs focus:outline-none"
                  />
                </div>
                <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-slate-100">
                  {shown.length === 0 && (
                    <p className="px-3 py-6 text-center text-[11px] text-slate-400">
                      {people.length === 0 ? 'Loading people…' : 'Nobody matches that.'}
                    </p>
                  )}
                  {shown.map((p) => {
                    const on = picked.includes(p.id)
                    const spec = avatarSpec(p.name || p.email, p.id)
                    const seen = presenceFor(p.id, { people: byId, beats, now })
                    return (
                      <button
                        key={p.id}
                        onClick={() => toggle(p.id)}
                        aria-pressed={on}
                        className={`flex w-full items-center gap-2.5 border-b border-slate-50 px-2.5 py-1.5 text-left last:border-b-0 hover:bg-slate-50 ${
                          on ? 'bg-indigo-50/60' : ''
                        }`}
                      >
                        <span
                          aria-hidden
                          className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                          style={{ backgroundColor: spec.bg, color: spec.fg }}
                        >
                          {spec.initials}
                          <span
                            className={`absolute bottom-0 right-0 h-2 w-2 rounded-full ring-2 ring-white ${
                              seen.online ? 'bg-emerald-500' : 'bg-rose-500'
                            }`}
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate text-[12px] font-medium text-slate-700">
                            {p.name || p.email || 'Someone'}
                          </strong>
                          <span className="block truncate text-[10px] text-slate-400">
                            {p.jobRole || p.email}
                            {' · '}
                            <span className={seen.online ? 'font-medium text-emerald-600' : ''}>{seen.text}</span>
                          </span>
                        </span>
                        {on && (
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
                            <Check size={10} />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <p className="mb-1 text-[11px] font-medium text-slate-500">What you need from them</p>
                <div className="flex flex-wrap gap-1">
                  {TONE_CHOICES.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => setTone(t.value)}
                      title={t.hint}
                      aria-pressed={tone === t.value}
                      className={`rounded-lg border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                        tone === t.value
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[10px] leading-snug text-slate-400">{toneOf({ tone }).hint}</p>
              </div>

              <div>
                <p className="mb-1 text-[11px] font-medium text-slate-500">
                  Note <span className="font-normal text-slate-400">(optional)</span>
                </p>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, MAX_SHARE_NOTE))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit()
                  }}
                  placeholder="Can you check this one?"
                  className="w-full resize-none rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] focus:border-indigo-400 focus:outline-none"
                />
              </div>
            </div>

            <footer className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5">
              <p className={`min-w-0 truncate text-[11px] ${failed ? 'text-rose-600' : 'text-slate-400'}`}>
                {!maySend
                  ? 'An admin has turned off sending for your account.'
                  : failed || (problem && picked.length === 0 ? problem : '')}
              </p>
              <button
                onClick={submit}
                disabled={Boolean(problem) || sending || !maySend}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                <Send size={12} /> {sending ? 'Sending…' : 'Send'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>,
    // On the body, like the remarks popover it sits beside. It is opened
    // from inside a widget, and a widget's box can be transformed or
    // clipped by the layout -- which would pin a `fixed` dialog to that
    // one widget instead of the screen.
    document.body
  )
}
