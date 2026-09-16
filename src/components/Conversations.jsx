import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ImagePlus,
  Loader2,
  Megaphone,
  MessageSquarePlus,
  Phone,
  Pin,
  Search,
  Send,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import {
  ALL,
  clockOf,
  conversationsFor,
  dayKey,
  firstUnreadKey,
  dayLabel,
  draftFor,
  entriesOf,
  kindOf,
  membersOf,
  previewOf,
  replyTarget,
  runsWith,
  titleOf,
} from '../lib/conversations'
import { MAX_BODY, TONE_CHOICES, canReceiveMessages, toneOf, whenText } from '../lib/messages'
import { useMessagePrefs } from '../hooks/useMessages'
import { avatarSpec } from '../lib/avatar'
import { PRESENCE_TICK_MS, groupPresence, groupPresenceText, presenceFor } from '../lib/presence'
import { usePresenceBeats } from '../hooks/usePresence'
import { useNow } from '../hooks/useReminders'
import SharedRowCard from './SharedRowCard.jsx'
import { isDefaultShareBody } from '../lib/rowShare'
import { requestCall } from '../lib/callBus'
import { useChatImages } from '../hooks/useChatImages'
import { ACCEPT, MAX_IMAGES, bubbleSize, imagesFrom, roomFor } from '../lib/chatImages'
import { useImageFallback } from '../hooks/useImageFallback'
import { supportsCalls } from '../lib/callSignal'

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

  // What this person's messages start as -- theirs, not the app's. See
  // hooks/useMessages.js.
  const { defaultTone, setDefaultTone } = useMessagePrefs()

  const rows = useMemo(() => conversationsFor(messages, uid, byId), [messages, uid, byId])

  // Who has the dashboard open. Listened to HERE, while the panel is open,
  // rather than by the message centre that is always mounted: every open
  // tab beats once a minute, and a listener on every dashboard all day
  // would pay a read for each beat to draw dots nobody is looking at. The
  // clock ticks on its own because a colleague whose beats STOP is never
  // announced by a snapshot -- without it, their dot would stay green.
  const beats = usePresenceBeats()
  const now = useNow(PRESENCE_TICK_MS)
  const seen = (id) => presenceFor(id, { people: byId, beats, now })

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
            seen={seen}
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
            seen={seen}
            maySend={maySend}
            defaultTone={defaultTone}
            onDefaultTone={setDefaultTone}
            onBack={() => setOpenId(null)}
            onRead={onRead}
            onSend={onSend}
            onUnsend={onUnsend}
          />
        ) : (
          <List
            rows={rows}
            byId={byId}
            seen={seen}
            onOpen={setOpenId}
            onClose={onClose}
            onStart={maySend ? () => setStarting(true) : null}
          />
        )}
      </aside>
    </div>
  )
}

/**
 * The round picture, from the one place that decides what it looks like.
 *
 * `presence`, when given, is the dot in its corner: green while that person
 * has the dashboard open in a tab, red when they do not -- see
 * lib/presence.js. Without it there is no dot at all, which is what a
 * group, "Everyone" and a message bubble get: none of them is one person
 * who is or is not here.
 */
function Avatar({ name, person, size = 40, icon: Icon, presence }) {
  const spec = avatarSpec(name, person)
  // A quarter of the circle and never under 8px, ringed in white so it
  // reads against every avatar colour instead of merging into a green one.
  const dot = Math.max(8, Math.round(size * 0.26))
  return (
    <span
      aria-hidden
      className="relative flex shrink-0 items-center justify-center rounded-full font-bold"
      style={{
        width: size,
        height: size,
        backgroundColor: spec.bg,
        color: spec.fg,
        fontSize: Math.round(size * 0.36),
      }}
    >
      {Icon ? <Icon size={Math.round(size * 0.45)} /> : spec.initials}
      {presence && (
        <span
          title={presence.text}
          data-presence={presence.online ? 'online' : 'away'}
          className={`absolute bottom-0 right-0 rounded-full ring-2 ring-white ${
            presence.online ? 'bg-emerald-500' : 'bg-rose-500'
          }`}
          style={{ width: dot, height: dot }}
        />
      )}
    </span>
  )
}

/** "Active now" in green, or when they were last here, in grey. */
function PresenceText({ presence }) {
  return (
    <p className={`truncate text-[10px] ${presence.online ? 'font-medium text-emerald-600' : 'text-slate-400'}`}>
      {presence.text}
    </p>
  )
}

// ---------------------------------------------------------------------
// Screen one: who you are talking to
// ---------------------------------------------------------------------

function List({ rows, byId, seen, onOpen, onClose, onStart }) {
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
            title={row.kind === 'direct' ? seen?.(row.id).text : undefined}
            className={`flex w-full items-center gap-3 border-b border-slate-50 px-3 py-2.5 text-left hover:bg-slate-50 ${
              row.unread > 0 ? 'bg-indigo-50/40' : ''
            }`}
          >
            <Avatar
              name={row.title}
              person={row.id}
              icon={row.kind === 'all' ? Megaphone : row.kind === 'group' ? Users : undefined}
              // A dot only on a chat with ONE other person. On a group it
              // would have to mean "someone" or "everyone", and either
              // reading is wrong half the time -- the group's own header
              // says how many are here instead.
              presence={row.kind === 'direct' ? seen?.(row.id) : null}
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
                  {row.kind === 'direct' && seen && <span className="sr-only"> ({seen(row.id).text})</span>}
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

function Chat({ id, messages, uid, byId, seen, maySend, defaultTone, onDefaultTone, onBack, onRead, onSend, onUnsend }) {
  const [text, setText] = useState('')
  // Pictures wait here while the message is written, so pasting three
  // screenshots and then typing a line is one message rather than four.
  const pictures = useChatImages()
  const [zoomed, setZoomed] = useState(null)
  const [tone, setTone] = useState(defaultTone)
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

  // Every chat opens at what this person usually means, and so does the
  // moment their preference arrives from the database or changes.
  useEffect(() => {
    setTone(defaultTone)
  }, [id, defaultTone])

  async function submit() {
    const body = text.trim()
    // A picture on its own is a message; words on their own still are too.
    if ((!body && pictures.images.length === 0) || sending || pictures.busy > 0) return
    setSending(true)
    setFailed('')
    try {
      // Typing IS answering. In a chat nobody presses "Reply", so if the
      // newest thing here is a question somebody asked you, saying something
      // closes it -- otherwise every answer would leave the question open
      // and the dialogue would keep coming back.
      await onSend({ conversationId: id, text: body, tone, replyTo: owed, images: pictures.images })
      setText('')
      setTone(defaultTone)
      pictures.clear()
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
          presence={kindOf(id) === 'direct' ? seen?.(id) : null}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-slate-700">{title}</p>
          {id === ALL && <p className="text-[10px] text-slate-400">Everyone with an account</p>}
          {/* In words as well as the dot: "last seen yesterday at 18:40" is
              the answer to "will they see this today", and a colour cannot
              say that. */}
          {kindOf(id) === 'direct' && seen && <PresenceText presence={seen(id)} />}
          {kindOf(id) === 'group' && seen && (
            <p className="truncate text-[10px] text-slate-400">
              {groupPresenceText(groupPresence(membersOf(id), seen))}
            </p>
          )}
        </div>

        {/* One person only. A call here is two browsers talking directly to
            each other (see lib/callSignal.js), and three of them would need
            a server in the middle. The dot above says whether they are
            there to answer. */}
        {kindOf(id) === 'direct' && supportsCalls() && (
          <button
            onClick={() => requestCall(id)}
            title={`Call ${title} — talk and share screens`}
            aria-label={`Call ${title}`}
            className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 p-2 text-emerald-700 hover:bg-emerald-100"
          >
            <Phone size={14} />
          </button>
        )}
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
                onZoom={setZoomed}
                onUnsend={mine && !e.isReply ? () => onUnsend({ id: e.messageId }) : null}
              />
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      {zoomed && <Lightbox image={zoomed} onClose={() => setZoomed(null)} />}

      {maySend ? (
        <div className="border-t border-slate-100 p-2">
          {/* What you are asking of them, always on screen. Folded away it
              was a setting nobody knew was there -- and the difference
              between "when you get a chance" and "answer me now" is the
              one thing about a message that cannot be inferred from its
              words. The chosen one is filled in, so the current answer is
              readable without opening anything. */}
          <div className="mb-1.5 flex flex-wrap items-center gap-1">
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
            {/* Offered exactly when somebody has just made the same choice
                again: a person who always asks for an answer should say so
                once rather than four times a day. It disappears once it IS
                the default, which is how the setting says what it is. */}
            {tone !== defaultTone && onDefaultTone && (
              <button
                onClick={() => onDefaultTone(tone)}
                title={`Start every message as “${toneOf({ tone }).label}”`}
                className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 hover:border-indigo-300 hover:text-indigo-600"
              >
                <Pin size={9} /> make default
              </button>
            )}
          </div>
          <p className="mb-1.5 text-[10px] leading-snug text-slate-400">{toneOf({ tone }).hint}</p>

          {/* What is going with it, before it goes. Removing one here takes
              the uploaded picture with it -- see useChatImages. */}
          {(pictures.images.length > 0 || pictures.busy > 0) && (
            <div className="mb-1.5 flex flex-wrap items-center gap-1">
              {pictures.images.map((image) => (
                <span key={image.path} className="relative">
                  <ChatImage image={image} width={56} className="h-14 w-14 rounded-lg border border-slate-200 object-cover" />
                  <button
                    onClick={() => pictures.remove(image.path)}
                    aria-label="Remove this picture"
                    title="Remove"
                    className="absolute -right-1 -top-1 rounded-full bg-slate-700 p-0.5 text-white hover:bg-rose-600"
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
              {/* With a number on it. A spinner cannot tell the difference
                  between an upload that is slow and one that is dead, and
                  that difference is the whole complaint. */}
              {pictures.busy > 0 && (
                <span className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-slate-200 text-slate-400">
                  <Loader2 size={14} className="animate-spin" />
                  {pictures.percent > 0 && (
                    <span className="text-[9px] font-semibold tabular-nums">{pictures.percent}%</span>
                  )}
                </span>
              )}
            </div>
          )}

          {pictures.error && (
            <p className="mb-1.5 flex items-start gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] leading-snug text-rose-600">
              <span className="flex-1">{pictures.error}</span>
              <button onClick={pictures.clearError} aria-label="Close" className="shrink-0 text-rose-400">
                <X size={10} />
              </button>
            </p>
          )}

          {owed && (
            <p className="mb-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] leading-snug text-amber-700">
              Answering “{String(owed.body).slice(0, 60)}
              {owed.body.length > 60 ? '…' : ''}”
            </p>
          )}

          <div
            className="flex items-end gap-1.5"
            // Dropped anywhere on the box, which is where somebody drags a
            // screenshot to.
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const files = imagesFrom(e.dataTransfer?.files, { max: roomFor(pictures.images) })
              if (files.length === 0) return
              e.preventDefault()
              pictures.add(files)
            }}
          >
            <label
              title={`Send a picture (up to ${MAX_IMAGES})`}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-slate-200 text-slate-400 hover:border-indigo-300 hover:text-indigo-600"
            >
              <ImagePlus size={15} />
              <input
                type="file"
                accept={ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  pictures.add(imagesFrom(e.target.files, { max: roomFor(pictures.images) }))
                  // So choosing the same file twice in a row still counts.
                  e.target.value = ''
                }}
              />
              <span className="sr-only">Send a picture</span>
            </label>
            <textarea
              ref={boxRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_BODY))}
              // A screenshot pasted straight into the box: the fastest way
              // there is to say "look at this", and the reason this feature
              // exists at all.
              onPaste={(e) => {
                const files = imagesFrom(e.clipboardData?.files, { max: roomFor(pictures.images) })
                if (files.length === 0) return
                e.preventDefault()
                pictures.add(files)
              }}
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
              disabled={(!text.trim() && pictures.images.length === 0) || sending || pictures.busy > 0}
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
 * A picture in a chat, drawn wherever it is stored.
 *
 * Through the fallback hook, which matters now that they live in Google
 * Drive: no single Drive endpoint serves every file, so a link yields
 * several candidates and this walks them rather than giving up on the
 * first refusal. `referrerPolicy` is not decoration either -- Google
 * refuses an image request carrying a referrer from an origin it does not
 * know, which is every deployment of this, and a perfectly public file
 * 403s without it.
 *
 * A picture sent before this moved to Drive is an ordinary link and passes
 * through untouched, which is why those messages still work.
 */
function ChatImage({ image, width, className }) {
  const { url, exhausted, onError } = useImageFallback(image?.url, width)
  if (!url || exhausted) {
    return (
      <span className={`flex items-center justify-center bg-slate-100 text-[10px] text-slate-400 ${className}`}>
        Picture unavailable
      </span>
    )
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={onError}
      referrerPolicy="no-referrer"
      className={className}
    />
  )
}

/**
 * One picture, as big as the screen allows.
 *
 * Its own rather than the table's media viewer: that one is built around a
 * row's file columns -- names, kinds, downloads, paging through a record's
 * attachments -- and a chat picture is one picture with none of that.
 */
function Lightbox({ image, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[10100] flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Picture"
    >
      <ChatImage image={image} width={1600} className="max-h-full max-w-full rounded-lg shadow-2xl" />
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 rounded-full bg-slate-800/80 p-2 text-white hover:bg-slate-700"
      >
        <X size={16} />
      </button>
    </div>
  )
}

/**
 * One bubble.
 *
 * Mine on the right in indigo, theirs on the left in white -- the shape
 * everybody already knows, so nobody has to learn which side is which.
 */
function Bubble({ entry, mine, run, name, onZoom, onUnsend }) {
  const tone = entry.tone ? toneOf(entry) : null
  // The retired one carried no label, because it asked for nothing. Read
  // from the tone rather than from its name, so this says what it means
  // and does not have to be found again the next time the list changes.
  const marked = tone && !tone.retired

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
          {/* A row that came with it, drawn as the record rather than as
              text. The stand-in sentence under a card would only repeat its
              heading, so it is left out when the sender wrote nothing. */}
          {entry.row && <SharedRowCard row={entry.row} className="my-1 w-64 max-w-full" />}
          {/* Drawn at the shape it was sent at, so the chat does not jump
              as each picture arrives. */}
          {(entry.images || []).map((image) => {
            const box = bubbleSize(image)
            return (
              <button
                key={image.url}
                type="button"
                onClick={() => onZoom?.(image)}
                title="Open the picture"
                className="my-1 block overflow-hidden rounded-lg border border-white/30 bg-slate-100"
                style={{ width: box.width, maxWidth: '100%' }}
              >
                <ChatImage image={image} width={box.width} className="block h-auto w-full object-cover" />
              </button>
            )
          })}
          {!(entry.row && isDefaultShareBody({ row: entry.row, body: entry.text })) && (
            <span className="whitespace-pre-wrap break-words">{entry.text}</span>
          )}
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

function StartNew({ people, me, seen, onBack, onPick }) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState([])

  // For the Everyone row: a broadcast read by five people now and by forty
  // tomorrow morning is worth knowing about before it is sent.
  const activeNow = seen ? people.filter((p) => p.id !== me && seen(p.id).online).length : 0

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
            <span className="text-[11px] text-slate-400">
              Everyone with an account
              {activeNow > 0 && <span className="font-medium text-emerald-600"> · {activeNow} active now</span>}
            </span>
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
              <Avatar name={p.name || p.email} person={p.id} presence={seen?.(p.id)} />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[13px] font-medium text-slate-700">
                  {p.name || p.email || 'Someone'}
                </strong>
                <span className="block truncate text-[11px] text-slate-400">
                  {p.jobRole || p.email}
                  {seen && (
                    <>
                      {' · '}
                      <span className={seen(p.id).online ? 'font-medium text-emerald-600' : ''}>
                        {seen(p.id).text}
                      </span>
                    </>
                  )}
                </span>
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
