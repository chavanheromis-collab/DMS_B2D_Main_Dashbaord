import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, Megaphone, MessageSquarePlus, Search, Send, Trash2, Users, X } from 'lucide-react'
import {
  ALL,
  clockOf,
  conversationsFor,
  dayKey,
  firstUnreadKey,
  dayLabel,
  draftFor,
  entriesOf,
  previewOf,
  replyTarget,
  runsWith,
  titleOf,
} from '../lib/conversations'
import { DEFAULT_TONE, MAX_BODY, TONES, canReceiveMessages, toneOf, whenText } from '../lib/messages'
import { avatarSpec } from '../lib/avatar'

/**
 * The message centre, as a chat.
 *
 * Two screens in one panel: the list of conversations, and one conversation.
 * On a phone-width panel that is how chat apps work, and it is also what
 * stops a 380px drawer trying to be two columns.
 *
 * Everything here is a VIEW of the messages already loaded -- see
 * lib/conversations.js. No new collection, no second idea of who is talking
 * to whom.
 */
export default function Conversations({
  messages,
  uid,
  people,
  byId,
  maySend,
  onClose,
  onRead,
  onSend,
  onUnsend,
}) {
  const [openId, setOpenId] = useState(null)
  const [starting, setStarting] = useState(false)

  const rows = useMemo(() => conversationsFor(messages, uid, byId), [messages, uid, byId])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      // Back out one screen at a time. Closing the whole panel from inside a
      // conversation loses your place for no reason.
      if (starting) setStarting(false)
      else if (openId) setOpenId(null)
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, openId, starting])

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
        {starting ? (
          <StartNew
            people={people}
            me={uid}
            onBack={() => setStarting(false)}
            onPick={(id) => {
              setStarting(false)
              setOpenId(id)
            }}
          />
        ) : openId ? (
          <Chat
            id={openId}
            messages={messages}
            uid={uid}
            byId={byId}
            maySend={maySend}
            onBack={() => setOpenId(null)}
            onRead={onRead}
            onSend={onSend}
            onUnsend={onUnsend}
          />
        ) : (
          <List
            rows={rows}
            byId={byId}
            onOpen={setOpenId}
            onClose={onClose}
            onStart={maySend ? () => setStarting(true) : null}
          />
        )}
      </aside>
    </div>
  )
}

/** The round picture, from the one place that decides what it looks like. */
function Avatar({ name, person, size = 40, icon: Icon }) {
  const spec = avatarSpec(name, person)
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full font-bold"
      style={{
        width: size,
        height: size,
        backgroundColor: spec.bg,
        color: spec.fg,
        fontSize: Math.round(size * 0.36),
      }}
    >
      {Icon ? <Icon size={Math.round(size * 0.45)} /> : spec.initials}
    </span>
  )
}

// ---------------------------------------------------------------------
// Screen one: who you are talking to
// ---------------------------------------------------------------------

function List({ rows, byId, onOpen, onClose, onStart }) {
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => `${r.title} ${r.lastText}`.toLowerCase().includes(q))
  }, [rows, query])

  return (
    <>
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <p className="text-sm font-semibold text-slate-800">Chats</p>
        <div className="flex items-center gap-1.5">
          {onStart && (
            <button
              onClick={onStart}
              title="Start a new chat"
              className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
            >
              <MessageSquarePlus size={12} /> New
            </button>
          )}
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {rows.length > 4 && (
        <div className="border-b border-slate-100 px-3 py-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1">
            <Search size={12} className="shrink-0 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats…"
              className="min-w-0 flex-1 text-xs focus:outline-none"
            />
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 && (
          <p className="px-4 py-12 text-center text-xs text-slate-400">
            {rows.length === 0 ? 'No chats yet.' : 'Nothing matches that.'}
            {onStart && rows.length === 0 && (
              <>
                {' '}
                <button onClick={onStart} className="text-indigo-600 underline">
                  Start one.
                </button>
              </>
            )}
          </p>
        )}

        {shown.map((row) => (
          <button
            key={row.id}
            onClick={() => onOpen(row.id)}
            className={`flex w-full items-center gap-3 border-b border-slate-50 px-3 py-2.5 text-left hover:bg-slate-50 ${
              row.unread > 0 ? 'bg-indigo-50/40' : ''
            }`}
          >
            <Avatar
              name={row.title}
              person={row.id}
              icon={row.kind === 'all' ? Megaphone : row.kind === 'group' ? Users : undefined}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                {/* Unread is heavier and darker, and its timestamp takes the
                    accent colour -- the way every chat app says "this one"
                    without needing the badge to be read. */}
                <strong
                  className={`truncate text-[13px] ${
                    row.unread > 0 ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'
                  }`}
                >
                  {row.title}
                </strong>
                <span
                  className={`shrink-0 text-[10px] ${
                    row.unread > 0 ? 'font-semibold text-indigo-600' : 'text-slate-400'
                  }`}
                >
                  {whenText(row.lastAt)}
                </span>
              </span>
              <span className="flex items-center justify-between gap-2">
                <span
                  className={`truncate text-[11px] ${
                    row.unread > 0 ? 'font-medium text-slate-700' : 'text-slate-400'
                  }`}
                >
                  {previewOf(row)}
                </span>
                {/* Owed beats unread: a question you have not answered is a
                    different thing from a message you have not opened. */}
                {row.owed ? (
                  <span className="shrink-0 rounded-full bg-rose-500 px-1.5 text-[9px] font-bold text-white">
                    reply
                  </span>
                ) : row.unread > 0 ? (
                  <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-indigo-600 px-1 text-[9px] font-bold text-white">
                    {row.unread > 9 ? '9+' : row.unread}
                  </span>
                ) : null}
              </span>
            </span>
          </button>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------
// Screen two: the conversation
// ---------------------------------------------------------------------

function Chat({ id, messages, uid, byId, maySend, onBack, onRead, onSend, onUnsend }) {
  const [text, setText] = useState('')
  const [tone, setTone] = useState(DEFAULT_TONE)
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState('')
  const endRef = useRef(null)
  const boxRef = useRef(null)

  const entries = useMemo(() => entriesOf(messages, uid, id), [messages, uid, id])

  // Frozen when the conversation opens. Opening marks everything read, so
  // asked again a moment later this correctly says "nothing new" -- and the
  // line the reader was looking for would vanish as they looked at it.
  const unreadFrom = useRef(null)
  const openedAs = useRef(null)
  if (openedAs.current !== id) {
    openedAs.current = id
    unreadFrom.current = firstUnreadKey(messages, uid, id)
  }
  const owed = useMemo(() => replyTarget(messages, uid, id), [messages, uid, id])
  const title = titleOf(id, byId)

  // Opening a chat is reading it. Marking on open rather than on a click is
  // what stops the bell counting what somebody is looking at.
  useEffect(() => {
    const mine = (messages || []).filter(
      (m) => m.from !== uid && !((m.readBy || []).includes(uid))
    )
    for (const m of mine) {
      if (entries.some((e) => e.messageId === m.id)) onRead(m)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, entries.length])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [entries.length, id])

  useEffect(() => {
    boxRef.current?.focus()
  }, [id])

  async function submit() {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setFailed('')
    try {
      // Typing IS answering. In a chat nobody presses "Reply", so if the
      // newest thing here is a question somebody asked you, saying something
      // closes it -- otherwise every answer would leave the question open
      // and the dialogue would keep coming back.
      await onSend({ conversationId: id, text: body, tone, replyTo: owed })
      setText('')
      setTone(DEFAULT_TONE)
    } catch (e) {
      setFailed(e?.message || 'That could not be sent')
    } finally {
      setSending(false)
    }
  }

  let lastDay = ''
  let previous = null

  return (
    <>
      <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
        <button
          onClick={onBack}
          aria-label="Back to chats"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <ArrowLeft size={16} />
        </button>
        <Avatar
          name={title}
          person={id}
          size={32}
          icon={id === ALL ? Megaphone : id.includes('|') ? Users : undefined}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-slate-700">{title}</p>
          {id === ALL && <p className="text-[10px] text-slate-400">Everyone with an account</p>}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-slate-50/60 px-3 py-3">
        {entries.length === 0 && (
          <p className="py-12 text-center text-xs text-slate-400">No messages yet. Say something.</p>
        )}

        {entries.map((e) => {
          const day = dayKey(e.at)
          const newDay = day !== lastDay
          lastDay = day
          const run = !newDay && runsWith(previous, e)
          previous = e
          const mine = e.from === uid

          return (
            <div key={e.key}>
              {newDay && (
                <p className="my-3 text-center">
                  <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-400 shadow-sm">
                    {dayLabel(e.at)}
                  </span>
                </p>
              )}
              {/* Where you left off. One line, once -- it is the answer to
                  "which of these have I already seen", and a chat that
                  cannot answer that is one you re-read from the top. */}
              {e.key === unreadFrom.current && (
                <p className="my-2 flex items-center gap-2" role="separator">
                  <span className="h-px flex-1 bg-rose-200" />
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-500">
                    Unread
                  </span>
                  <span className="h-px flex-1 bg-rose-200" />
                </p>
              )}
              <Bubble
                entry={e}
                mine={mine}
                run={run}
                name={byId[e.from]?.name || e.name}
                onUnsend={mine && !e.isReply ? () => onUnsend({ id: e.messageId }) : null}
              />
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      {maySend ? (
        <div className="border-t border-slate-100 p-2">
          {/* What you are asking of them, always on screen. Folded away it
              was a setting nobody knew was there -- and the difference
              between "when you get a chance" and "answer me now" is the
              one thing about a message that cannot be inferred from its
              words. The chosen one is filled in, so the current answer is
              readable without opening anything. */}
          <div className="mb-1.5 flex flex-wrap items-center gap-1">
            {TONES.map((t) => (
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
          <p className="mb-1.5 text-[10px] leading-snug text-slate-400">{toneOf({ tone }).hint}</p>

          {owed && (
            <p className="mb-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] leading-snug text-amber-700">
              Answering “{String(owed.body).slice(0, 60)}
              {owed.body.length > 60 ? '…' : ''}”
            </p>
          )}

          <div className="flex items-end gap-1.5">
            <textarea
              ref={boxRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_BODY))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder="Message…"
              className="max-h-24 min-w-0 flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-[13px] focus:border-indigo-400 focus:outline-none"
            />
            <button
              onClick={submit}
              disabled={!text.trim() || sending}
              aria-label="Send"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              <Send size={14} />
            </button>
          </div>
          {failed && (
            <p className="mt-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] text-rose-600">
              {failed}
            </p>
          )}
        </div>
      ) : (
        <p className="border-t border-slate-100 px-3 py-3 text-center text-[11px] text-slate-400">
          You can read messages, but an admin has turned off sending for your account.
        </p>
      )}
    </>
  )
}

/**
 * One bubble.
 *
 * Mine on the right in indigo, theirs on the left in white -- the shape
 * everybody already knows, so nobody has to learn which side is which.
 */
function Bubble({ entry, mine, run, name, onUnsend }) {
  const tone = entry.tone ? toneOf(entry) : null
  const marked = tone && tone.value !== 'fyi'

  return (
    <div className={`group flex gap-2 ${mine ? 'flex-row-reverse' : ''} ${run ? 'mt-0.5' : 'mt-2'}`}>
      {/* One avatar per RUN, not per bubble -- three in a row is a list of
          index cards, not a conversation. */}
      <span className="w-7 shrink-0">
        {!run && !mine && <Avatar name={name} person={entry.from} size={28} />}
      </span>

      <div className={`min-w-0 max-w-[78%] ${mine ? 'items-end text-right' : ''}`}>
        {!run && !mine && (
          <p className="mb-0.5 text-[10px] font-medium text-slate-400">{name}</p>
        )}
        <div
          className={`inline-block rounded-2xl px-3 py-1.5 text-[13px] leading-snug ${
            mine
              ? 'rounded-br-sm bg-indigo-600 text-white'
              : 'rounded-bl-sm border border-slate-200 bg-white text-slate-700'
          }`}
        >
          {marked && (
            <span
              className={`mb-0.5 block text-[9px] font-semibold uppercase tracking-wide ${
                mine ? 'text-indigo-200' : 'text-amber-600'
              }`}
            >
              {tone.label}
            </span>
          )}
          <span className="whitespace-pre-wrap break-words">{entry.text}</span>
        </div>
        <p className={`mt-0.5 flex items-center gap-1 text-[9px] text-slate-300 ${mine ? 'justify-end' : ''}`}>
          <span title={entry.at}>{clockOf(entry.at)}</span>
          {onUnsend && (
            <button
              onClick={onUnsend}
              title="Unsend for everyone"
              aria-label="Unsend for everyone"
              className="opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"
            >
              <Trash2 size={10} />
            </button>
          )}
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Starting one
// ---------------------------------------------------------------------

function StartNew({ people, me, onBack, onPick }) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState([])

  const shown = useMemo(() => {
    // Not yourself, and nobody an admin has switched off. Listing somebody
    // whose message centre does not appear is offering to send into a hole:
    // it would go, it would be stored, and the sender would never learn it
    // was not delivered.
    const others = people.filter((p) => p.id !== me && canReceiveMessages(p))
    const q = query.trim().toLowerCase()
    if (!q) return others
    return others.filter((p) =>
      `${p.name || ''} ${p.email || ''} ${p.jobRole || ''}`.toLowerCase().includes(q)
    )
  }, [people, me, query])

  const go = () => {
    if (picked.length === 0) return
    onPick([...picked].sort().join('|'))
  }

  return (
    <>
      <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
        <button
          onClick={onBack}
          aria-label="Back to chats"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <ArrowLeft size={16} />
        </button>
        <p className="flex-1 text-[13px] font-semibold text-slate-700">New chat</p>
        {picked.length > 0 && (
          <button
            onClick={go}
            className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Start ({picked.length})
          </button>
        )}
      </header>

      <div className="border-b border-slate-100 px-3 py-2">
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <button
          onClick={() => onPick(ALL)}
          className="flex w-full items-center gap-3 border-b border-slate-50 px-3 py-2.5 text-left hover:bg-slate-50"
        >
          <Avatar name="Everyone" person={ALL} icon={Megaphone} />
          <span className="min-w-0 flex-1">
            <strong className="block text-[13px] font-semibold text-slate-700">Everyone</strong>
            <span className="text-[11px] text-slate-400">Everyone with an account</span>
          </span>
        </button>

        {shown.length === 0 && (
          <p className="px-4 py-10 text-center text-xs text-slate-400">Nobody matches that.</p>
        )}

        {shown.map((p) => {
          const on = picked.includes(p.id)
          return (
            <button
              key={p.id}
              onClick={() => setPicked((all) => (on ? all.filter((x) => x !== p.id) : [...all, p.id]))}
              onDoubleClick={() => onPick(p.id)}
              className="flex w-full items-center gap-3 border-b border-slate-50 px-3 py-2.5 text-left hover:bg-slate-50"
            >
              <Avatar name={p.name || p.email} person={p.id} />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[13px] font-medium text-slate-700">
                  {p.name || p.email || 'Someone'}
                </strong>
                <span className="truncate text-[11px] text-slate-400">{p.jobRole || p.email}</span>
              </span>
              {on && (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
                  <Check size={12} />
                </span>
              )}
            </button>
          )
        })}
      </div>

      <p className="border-t border-slate-100 px-3 py-2 text-center text-[10px] text-slate-400">
        Tick more than one for a group. Double-click a name to open it straight away.
      </p>
    </>
  )
}
