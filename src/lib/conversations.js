// ---------------------------------------------------------------------
// Messages, arranged as conversations
// ---------------------------------------------------------------------
// The message centre began as an announcement board: one message went out,
// people read it, somebody replied underneath. That is the right shape for
// *"stock take at 4"* and the wrong shape for talking to one person, which
// is what people actually do all day -- so this is the same data read the
// way a chat app reads it.
//
// NOTHING IS STORED DIFFERENTLY. A conversation is DERIVED from who a
// message is between, not written down as its own document:
//
//   - a message to one person is a chat with that person
//   - a message to several is the group of those people
//   - a message to everyone is the one channel called Everyone
//
// Deriving it rather than storing it means no migration, no second source of
// truth about who is in a conversation, and no way for the two to disagree.
// The id is the sorted list of the OTHER people in it, so the conversation
// you see when you write to Ravi is the same one he sees when he writes
// back -- his id from your side, yours from his.
//
// A message and its replies are flattened into one run of bubbles, because
// in a chat a reply IS the next message. The nesting is still there in the
// database, where it carries the obligation ("should reply" is answered by
// the reply, not by any old later message); it just stops being a shape
// anybody has to look at.
//
// Pure: messages in, conversations out.

import { addressedTo, isRead, toneOf } from './messages.js'

/** The channel everybody is in. */
export const ALL = 'all'

/**
 * Everyone in a message except you, sorted.
 *
 * Sorted because it is half of an id, and an id that depends on the order
 * somebody happened to tick two names is two conversations with the same
 * two people in them.
 */
export function otherPeople(message, uid) {
  const ids = [message?.from, ...(Array.isArray(message?.to) ? message.to : [])]
  return [...new Set(ids.filter((id) => id && id !== uid))].sort()
}

/**
 * Which conversation a message belongs to, from your side.
 *
 * `self` is a real answer, not a bug: a message you sent to nobody but
 * yourself has to live somewhere, and losing it would be worse than a thread
 * with one person in it.
 */
export function conversationIdOf(message, uid) {
  if (!message) return null
  if (message.audience === ALL) return ALL
  const others = otherPeople(message, uid)
  return others.length ? others.join('|') : 'self'
}

/** `direct` (one person), `group` (several), or `all` (the whole workspace). */
export function kindOf(id) {
  if (id === ALL) return 'all'
  if (!id || id === 'self') return 'self'
  return id.includes('|') ? 'group' : 'direct'
}

/** The uids in a conversation id. */
export function membersOf(id) {
  if (!id || id === ALL || id === 'self') return []
  return id.split('|').filter(Boolean)
}

/** What a conversation is called. */
export function titleOf(id, usersById = {}) {
  if (id === ALL) return 'Everyone'
  if (id === 'self') return 'Just you'
  // Never empty: `all` and `self` are answered above, and every other id
  // has at least one uid in it -- with `Someone` standing in for anybody the
  // directory has not loaded.
  const names = membersOf(id).map((u) => usersById[u]?.name || usersById[u]?.email || 'Someone')
  if (names.length <= 2) return names.join(' and ')
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`
}

/**
 * Every bubble in a conversation, oldest first.
 *
 * A message and each of its replies become peers here. `at` orders them, and
 * `messageId` is kept so a bubble can still find the message it belongs to --
 * which is how answering an obligation from the chat still closes it.
 */
export function entriesOf(messages, uid, conversationId) {
  const out = []
  for (const m of messages || []) {
    if (!addressedTo(m, uid)) continue
    if (conversationIdOf(m, uid) !== conversationId) continue

    out.push({
      key: `${m.id}:m`,
      messageId: m.id,
      from: m.from,
      name: m.fromName || 'Someone',
      text: m.body || '',
      at: m.createdAt || '',
      tone: m.tone,
      isReply: false,
    })

    for (const [i, r] of (Array.isArray(m.replies) ? m.replies : []).entries()) {
      out.push({
        key: `${m.id}:r${i}`,
        messageId: m.id,
        from: r.from,
        name: r.name || 'Someone',
        text: r.text || '',
        at: r.at || '',
        tone: null,
        isReply: true,
      })
    }
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)))
}

/**
 * The conversation list, most recent first.
 *
 * Ordered by the last thing SAID in each, not by when the conversation
 * started -- which is the whole point of a list like this: what is at the
 * top is what just happened.
 */
export function conversationsFor(messages, uid, usersById = {}) {
  const byId = new Map()

  for (const m of messages || []) {
    if (!addressedTo(m, uid)) continue
    const id = conversationIdOf(m, uid)
    if (!id) continue

    const row = byId.get(id) || {
      id,
      kind: kindOf(id),
      members: membersOf(id),
      title: titleOf(id, usersById),
      lastAt: '',
      lastText: '',
      lastFrom: '',
      lastMine: false,
      unread: 0,
      owed: false,
    }

    // The last thing said, wherever it was said -- the message itself, or a
    // reply somebody left on it an hour later.
    const said = [
      { at: m.createdAt || '', text: m.body || '', from: m.from },
      ...(Array.isArray(m.replies) ? m.replies : []).map((r) => ({
        at: r.at || '',
        text: r.text || '',
        from: r.from,
      })),
    ]
    for (const one of said) {
      if (String(one.at) > String(row.lastAt)) {
        row.lastAt = one.at
        row.lastText = one.text
        row.lastFrom = one.from
        row.lastMine = one.from === uid
      }
    }

    if (m.from !== uid && !isRead(m, uid)) row.unread += 1
    // Something in here is still waiting on you.
    if (toneOf(m).needsReply && m.from !== uid && !hasMyReply(m, uid)) row.owed = true

    byId.set(id, row)
  }

  return [...byId.values()].sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)))
}

function hasMyReply(message, uid) {
  return (Array.isArray(message?.replies) ? message.replies : []).some((r) => r?.from === uid)
}

/**
 * The first bubble you have not seen, in one conversation.
 *
 * What a chat app puts an "unread messages" line above. Returned as the
 * entry's key so the renderer can mark exactly one place, and null when
 * there is nothing new.
 *
 * Read from the MESSAGE's `readBy`, because that is the only read state
 * there is -- a reply has none, so a reply on a message you have already
 * read does not start a new run. That is the right answer anyway: the
 * conversation you last looked at is the one you have seen.
 *
 * The caller must freeze this when the conversation opens. Opening marks
 * everything read, so asked again a moment later it correctly says null --
 * and the line the reader was looking for would vanish as they looked at it.
 */
export function firstUnreadKey(messages, uid, conversationId) {
  // Only messages from other people, and only ones not yet read. That is
  // also why the search below needs no `from` check of its own: nothing in
  // this set is yours, and a message's own entry always sorts before its
  // replies -- so the first entry belonging to an unread message is that
  // message, never a reply somebody left on it.
  const unread = new Set(
    (messages || [])
      .filter((m) => m.from !== uid && !isRead(m, uid))
      .map((m) => m.id)
  )
  const entry = entriesOf(messages, uid, conversationId).find((e) => unread.has(e.messageId))
  return entry ? entry.key : null
}

/**
 * The message a new line in this conversation should be attached to.
 *
 * If the newest thing here is a question somebody asked YOU, saying
 * something is answering it -- which is what closes it and stops it coming
 * back. Otherwise a new line is a new message.
 *
 * This is the whole reason the obligation survives the move to chat: in a
 * chat nobody presses "Reply", they just type -- so typing has to count.
 */
export function replyTarget(messages, uid, conversationId) {
  const mine = (messages || [])
    .filter((m) => addressedTo(m, uid) && conversationIdOf(m, uid) === conversationId)
    .filter((m) => m.from !== uid && toneOf(m).needsReply && !hasMyReply(m, uid))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  return mine[0] || null
}

/** How the composer addresses a new message in this conversation. */
export function draftFor(conversationId, tone) {
  if (conversationId === ALL) return { audience: ALL, to: [], body: '', tone }
  return { audience: 'people', to: membersOf(conversationId), body: '', tone }
}

/**
 * Whether two bubbles in a row are from the same person, close together.
 *
 * Runs like that get one avatar and one name rather than three, which is the
 * difference between a chat and a list of index cards.
 */
export function runsWith(previous, entry, withinMs = 5 * 60 * 1000) {
  if (!previous || !entry) return false
  if (previous.from !== entry.from) return false
  const gap = new Date(entry.at) - new Date(previous.at)
  return Number.isFinite(gap) && gap >= 0 && gap <= withinMs
}

/**
 * The day a bubble belongs under.
 *
 * Chats put a date between days, so "9:30" is never ambiguous about which
 * morning it was.
 */
export function dayKey(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

export function dayLabel(iso, now = new Date()) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days > 1 && days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** The clock time on a bubble. */
export function clockOf(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** One line of preview under a conversation's name. */
export function previewOf(row, limit = 48) {
  const text = String(row?.lastText || '').replace(/\s+/g, ' ').trim()
  if (!text) return 'No messages yet'
  const short = text.length > limit ? `${text.slice(0, limit - 1)}…` : text
  return row?.lastMine ? `You: ${short}` : short
}

/** People you can start a conversation with, and the one you already have. */
export function startableWith(person, conversations) {
  const existing = conversations.find((c) => c.kind === 'direct' && c.members[0] === person)
  return existing ? existing.id : person
}
