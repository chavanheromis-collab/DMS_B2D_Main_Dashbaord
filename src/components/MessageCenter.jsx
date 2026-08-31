import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Bell, Check, CornerUpLeft, Eye, Megaphone, Minus, Send, Trash2, X } from 'lucide-react'
import {
  AUDIENCES,
  MAX_BODY,
  MAX_REPLY,
  TONES,
  audienceLabel,
  blockingFor,
  draftProblem,
  inboxFor,
  needsReplyFrom,
  nextNagIn,
  openFor,
  toneOf,
  unreadCount,
  whenText,
} from '../lib/messages'
import { useMessageActions, useMessages, usePeople } from '../hooks/useMessages'

// =====================================================================
// Messages
// =====================================================================
// "The Nashik figures are wrong, don't quote them." Things that are about
// the dashboard, need to reach the person reading it, and otherwise go out
// on WhatsApp where they are read by everyone except the two people who
// needed them.
//
// Three surfaces, and the difference between them is how much they
// interrupt:
//
//   BANNER   at the top of the page, until it is closed or answered.
//   POP-UP   over the page, for `urgent` only, once.
//   INBOX    behind the bell, for everything including what was closed.
//
// The composer is open to everyone, deliberately. A dashboard where only
// admins can say "these numbers are wrong" is a dashboard where nobody says
// it -- and the security rules already stop anybody sending AS somebody
// else, which is the thing that actually matters.

const TONE_STYLE = {
  fyi: { bar: 'bg-slate-300', chip: 'bg-slate-50 text-slate-600 border-slate-200', Icon: Megaphone },
  seen: { bar: 'bg-sky-400', chip: 'bg-sky-50 text-sky-700 border-sky-200', Icon: Eye },
  ask: { bar: 'bg-amber-400', chip: 'bg-amber-50 text-amber-700 border-amber-200', Icon: CornerUpLeft },
  urgent: { bar: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 border-rose-200', Icon: AlertTriangle },
}
const styleFor = (tone) => TONE_STYLE[tone] || TONE_STYLE.fyi

/**
 * The banners, the pop-up and the bell, mounted once.
 *
 * On the shell rather than on the dashboard: a message about the workspace
 * should not vanish because somebody navigated to the admin panel.
 */
export default function MessageCenter() {
  const { messages, error } = useMessages()
  const { markRead, dismiss, reply, unsend, sender } = useMessageActions()
  const { people, byId } = usePeople()

  const [composing, setComposing] = useState(false)
  const [inboxOpen, setInboxOpen] = useState(false)

  /**
   * When each message was minimised.
   *
   * Component state rather than the database, deliberately. Minimising is
   * "not right now" -- not a decision worth recording -- and writing it out
   * would put a document write behind a gesture people make while reaching
   * for something else. A reload puts an unanswered one back, which is the
   * right answer for something still unanswered.
   */
  const [snoozed, setSnoozed] = useState({})
  const [now, setNow] = useState(() => Date.now())

  const uid = sender.uid
  const open = useMemo(() => openFor(messages, uid), [messages, uid])
  const blocking = useMemo(() => blockingFor(messages, uid, snoozed, now), [messages, uid, snoozed, now])
  const unread = useMemo(() => unreadCount(messages, uid), [messages, uid])

  /**
   * A timer that fires when the next minimised message is due back.
   *
   * Set to the exact moment rather than polled every second: nothing else
   * on this screen changes with the clock, so a ticking interval would be a
   * re-render a second forever to catch an event that happens twice a day.
   */
  const dueIn = useMemo(() => nextNagIn(messages, uid, snoozed, now), [messages, uid, snoozed, now])
  useEffect(() => {
    if (dueIn === null) return undefined
    // A hair past the moment, so the comparison that woke us is already true.
    const timer = setTimeout(() => setNow(Date.now()), Math.max(250, dueIn + 50))
    return () => clearTimeout(timer)
  }, [dueIn])

  if (!uid) return null

  return (
    <>
      {/* --- the bell, always reachable ----------------------------- */}
      <button
        onClick={() => setInboxOpen(true)}
        title={unread > 0 ? `${unread} unread` : 'Messages'}
        aria-label={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
        className="no-print fixed bottom-4 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-600 shadow-lg backdrop-blur transition-colors hover:border-indigo-300 hover:text-indigo-600"
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {error && (
        <p className="no-print fixed bottom-16 right-4 z-40 max-w-xs rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] text-rose-600">
          {error}
        </p>
      )}

      {/* --- banners, at the top of whatever page you are on --------- */}
      {open.length > 0 && (
        <div className="no-print mb-3 space-y-2">
          {open.map((m) => (
            <Banner
              key={m.id}
              message={m}
              uid={uid}
              people={byId}
              onRead={() => markRead(m)}
              onDismiss={() => dismiss(m)}
              onReply={(text) => reply(m, text)}
              onUnsend={() => unsend(m)}
            />
          ))}
        </div>
      )}

      {blocking && (
        <Blocking
          message={blocking}
          uid={uid}
          people={byId}
          onMinimise={() => {
            // Marked read on the way out: they have looked at it. What they
            // have not done is answer it, which is what brings it back.
            markRead(blocking)
            setSnoozed((all) => ({ ...all, [blocking.id]: Date.now() }))
          }}
          onDismiss={() => dismiss(blocking)}
          onReply={(text) => reply(blocking, text)}
        />
      )}

      {inboxOpen && (
        <Inbox
          messages={inboxFor(messages, uid)}
          uid={uid}
          people={byId}
          onClose={() => setInboxOpen(false)}
          onCompose={() => {
            setInboxOpen(false)
            setComposing(true)
          }}
          onRead={markRead}
          onReply={reply}
          onUnsend={unsend}
        />
      )}

      {composing && <Composer people={people} me={uid} onClose={() => setComposing(false)} />}
    </>
  )
}

/**
 * A message, in the flow of the page.
 *
 * Stays until it is closed -- or, when it asked for one, until it is
 * answered. Closing an `ask` is not answering it, because a question that
 * can be dismissed in one click is a question that gets dismissed in one
 * click.
 */
function Banner({ message, uid, people, onRead, onDismiss, onReply, onUnsend }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const { bar, chip, Icon } = styleFor(message.tone)
  const mine = message.from === uid
  // Through the model, not a second copy of the rule here. The copy said
  // `tone === 'ask'`, which was already wrong for `urgent` -- it also wants
  // an answer -- and would have gone on being wrong for the next tone
  // somebody adds.
  const needsReply = needsReplyFrom(message, uid)

  // Seen is seen. Marking on mount rather than on a click is what stops the
  // bell counting something the person is currently reading.
  useEffect(() => {
    onRead()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id])

  async function submit() {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      await onReply(text)
      setText('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-chrome page-chrome-surface relative overflow-hidden rounded-xl border border-slate-200 bg-white/90 shadow-sm backdrop-blur">
      <span className={`absolute left-0 top-0 h-full w-1 ${bar}`} />
      <div className="flex flex-wrap items-start gap-2 py-2 pl-3 pr-2">
        <Icon size={15} className="mt-0.5 shrink-0 text-slate-400" />

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
            <strong className="text-slate-600">{mine ? 'You' : message.fromName || 'Someone'}</strong>
            <span>to {audienceLabel(message, people)}</span>
            <span>· {whenText(message.createdAt)}</span>
            {message.tone !== 'note' && (
              <span className={`rounded-full border px-1.5 text-[9px] font-semibold ${chip}`}>
                {TONES.find((t) => t.value === message.tone)?.label}
              </span>
            )}
          </p>
          <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-slate-700">{message.body}</p>

          {(message.replies || []).length > 0 && (
            <div className="mt-1.5 space-y-1 border-l-2 border-slate-100 pl-2">
              {message.replies.map((r, i) => (
                <p key={i} className="text-[11px] leading-snug text-slate-500">
                  <strong className="text-slate-600">{r.from === uid ? 'You' : r.name}</strong> {r.text}
                  <span className="ml-1 text-[9px] text-slate-300">{whenText(r.at)}</span>
                </p>
              ))}
            </div>
          )}

          {needsReply && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <input
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, MAX_REPLY))}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="Reply to close this…"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none"
              />
              <button
                onClick={submit}
                disabled={!text.trim() || busy}
                className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                <Send size={11} /> {busy ? 'Sending…' : 'Reply'}
              </button>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {mine && (
            <button
              onClick={onUnsend}
              title="Unsend for everyone"
              aria-label="Unsend for everyone"
              className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
            >
              <Trash2 size={13} />
            </button>
          )}
          {/* An `ask` has no close button for its recipients: answering IS
              closing it, and offering both makes the answer optional. */}
          {!needsReply && (
            <button
              onClick={onDismiss}
              title="Close"
              aria-label="Close this message"
              className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The one that covers the page.
 *
 * It genuinely covers it: the backdrop takes the clicks, so nothing behind
 * can be read or pressed while it is up. That is the point -- a notification
 * that can be scrolled past is a notification that gets scrolled past.
 *
 * But it can be MINIMISED, and minimising gives the dashboard straight back.
 * Somebody who needs the number in order to answer the question must be able
 * to get at the number, and a message that makes its own answer impossible
 * is a message that will not be answered.
 *
 * There is no Escape and no click-away. Those are the two ways a dialogue
 * gets dismissed by reflex, and every button here is a decision worth making
 * on purpose: minimise it, close it, or answer it.
 */
function Blocking({ message, uid, people, onMinimise, onDismiss, onReply }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const { chip, Icon } = styleFor(message.tone)
  const tone = toneOf(message)
  const mustReply = needsReplyFrom(message, uid)

  async function answer() {
    if (busy) return
    setBusy(true)
    try {
      if (mustReply) {
        if (!text.trim()) return
        await onReply(text)
      } else {
        await onDismiss()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-label={`Message from ${message.fromName || 'someone'}`}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
        <div className="mb-2 flex items-start gap-2">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${chip}`}>
            <Icon size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800">{message.fromName || 'Someone'}</p>
            <p className="text-[10px] text-slate-400">
              to {audienceLabel(message, people)} · {whenText(message.createdAt)}
            </p>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${chip}`}>
            {tone.label}
          </span>
        </div>

        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{message.body}</p>

        {(message.replies || []).length > 0 && (
          <div className="mt-2 space-y-1 border-l-2 border-slate-100 pl-2">
            {message.replies.map((r, i) => (
              <p key={i} className="text-[11px] leading-snug text-slate-500">
                <strong className="text-slate-600">{r.from === uid ? 'You' : r.name}</strong> {r.text}
              </p>
            ))}
          </div>
        )}

        {mustReply && (
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_REPLY))}
            onKeyDown={(e) => e.key === 'Enter' && answer()}
            placeholder="Your reply…"
            className="mt-3 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
          />
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            onClick={onMinimise}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Minus size={12} /> Minimise
          </button>

          <button
            onClick={answer}
            disabled={busy || (mustReply && !text.trim())}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            <Check size={12} /> {busy ? 'Sending…' : mustReply ? 'Reply and close' : 'Got it'}
          </button>
        </div>

        {/* What minimising actually costs, said before it is pressed rather
            than discovered five minutes later. */}
        <p className="mt-1.5 text-center text-[10px] text-slate-400">
          {tone.nagAfter
            ? `Minimising gives you the dashboard back. This returns in ${Math.round(tone.nagAfter / 60000)} minute${
                tone.nagAfter > 60000 ? 's' : ''
              } unless you reply.`
            : 'Minimising gives you the dashboard back. It stays in the banner.'}
        </p>
      </div>
    </div>
  )
}

/** Everything addressed to you, including what you have already put away. */
function Inbox({ messages, uid, people, onClose, onCompose, onRead, onReply, onUnsend }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-semibold text-slate-800">Messages</p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onCompose}
              className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
            >
              <Send size={11} /> New
            </button>
            <button
              onClick={onClose}
              title="Close"
              aria-label="Close"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {messages.length === 0 && (
            <p className="py-10 text-center text-xs text-slate-400">
              Nothing yet. <button onClick={onCompose} className="text-indigo-600 underline">Send the first one.</button>
            </p>
          )}
          {messages.map((m) => (
            <Banner
              key={m.id}
              message={m}
              uid={uid}
              people={people}
              onRead={() => onRead(m)}
              onDismiss={() => {}}
              onReply={(text) => onReply(m, text)}
              onUnsend={() => onUnsend(m)}
            />
          ))}
        </div>
      </aside>
    </div>
  )
}

/**
 * Writing one.
 *
 * The audience comes first, because it is the decision that changes what
 * you write -- "everyone" and "Ravi" are not the same message.
 */
function Composer({ people, me, onClose }) {
  const { send } = useMessageActions()
  const [draft, setDraft] = useState({ audience: 'people', to: [], body: '', tone: 'note' })
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')
  const [query, setQuery] = useState('')
  const bodyRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const problem = draftProblem(draft)

  // Everybody but you: a message to yourself is a note, and there is nowhere
  // for it to usefully go.
  const shown = useMemo(() => {
    const others = people.filter((p) => p.id !== me)
    const q = query.trim().toLowerCase()
    if (!q) return others
    return others.filter((p) => `${p.name || ''} ${p.email || ''} ${p.jobRole || ''}`.toLowerCase().includes(q))
  }, [people, me, query])

  const toggle = (id) =>
    set({ to: draft.to.includes(id) ? draft.to.filter((x) => x !== id) : [...draft.to, id] })

  async function submit() {
    if (problem || busy) return
    setBusy(true)
    setFailed('')
    try {
      await send(draft)
      onClose()
    } catch (e) {
      // A rejected write is almost always a rule, and silence here means
      // somebody believes they sent something they did not.
      setFailed(e?.message || 'That could not be sent')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-semibold text-slate-800">New message</p>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div className="flex flex-wrap gap-1.5">
            {AUDIENCES.map((a) => (
              <button
                key={a.value}
                onClick={() => set({ audience: a.value })}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                  draft.audience === a.value
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>

          {draft.audience === 'people' && (
            <div className="rounded-xl border border-slate-200 p-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search people…"
                className="mb-1.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none"
              />
              <div className="max-h-44 space-y-0.5 overflow-y-auto">
                {shown.length === 0 && <p className="py-4 text-center text-[11px] text-slate-400">Nobody matches</p>}
                {shown.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-50"
                  >
                    <input type="checkbox" checked={draft.to.includes(p.id)} onChange={() => toggle(p.id)} />
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
                      {p.name || p.email}
                      {p.jobRole && <span className="ml-1 text-[10px] text-slate-400">· {p.jobRole}</span>}
                    </span>
                    {p.role === 'admin' && (
                      <span className="rounded-full bg-slate-100 px-1.5 text-[9px] font-semibold text-slate-500">
                        admin
                      </span>
                    )}
                  </label>
                ))}
              </div>
              {draft.to.length > 0 && (
                <p className="mt-1 text-[10px] text-slate-400">{draft.to.length} selected</p>
              )}
            </div>
          )}

          <div>
            <textarea
              ref={bodyRef}
              autoFocus
              value={draft.body}
              onChange={(e) => set({ body: e.target.value.slice(0, MAX_BODY) })}
              rows={4}
              placeholder="What do they need to know?"
              className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            />
            <p className="mt-0.5 text-right text-[10px] text-slate-400">
              {draft.body.length}/{MAX_BODY}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {TONES.map((t) => (
              <button
                key={t.value}
                onClick={() => set({ tone: t.value })}
                title={t.hint}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                  draft.tone === t.value
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] leading-snug text-slate-400">
            {TONES.find((t) => t.value === draft.tone)?.hint}
          </p>

          {failed && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-600">{failed}</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
          <p className="text-[11px] text-slate-400">{problem}</p>
          <button
            onClick={submit}
            disabled={!!problem || busy}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            <Send size={12} /> {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
