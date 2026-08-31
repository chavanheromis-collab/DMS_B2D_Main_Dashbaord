// ---------------------------------------------------------------------
// Saying something to somebody who is looking at the dashboard
// ---------------------------------------------------------------------
// "The Nashik figures are wrong, don't quote them." "Stock take at 4, log
// your deliveries first." Things that are about the dashboard, need to
// reach the person reading it, and today go out on WhatsApp where they are
// read by everyone except the two people who needed them.
//
// So: a message with an audience, which shows up on the page it is about.
// A banner while it is unanswered, and a pop-up the first time it arrives.
//
// The two decisions that shape everything here:
//
//   AN AUDIENCE IS PEOPLE OR EVERYONE, and "everyone" is a flag rather than
//   a list of every uid. A list is a snapshot: send it on Monday and the
//   person who joins on Tuesday never sees it, which is not what anybody
//   means by "everyone".
//
//   DISMISSING IS PER PERSON. One recipient closing a banner cannot close
//   it for the other eleven, so the state is `dismissedBy: [uid]` on the
//   message rather than a `dismissed` boolean.
//
// Pure: messages and a uid in, messages out. No Firestore, no React.

export const AUDIENCES = [
  { value: 'people', label: 'Choose people' },
  { value: 'all', label: 'Everyone with an account' },
]

/**
 * What the sender is asking of the reader.
 *
 * Not "how loud" -- loudness is a decision about the sender's feelings.
 * This is a decision about the READER'S OBLIGATION, which is the thing they
 * actually need to know: may I carry on, do I have to look, do I have to
 * answer. Everything else here follows from that one field.
 *
 * `blocks` covers the page while it is on screen. `needsReply` means closing
 * is not enough. `nagAfter` is how long a minimised one stays out of the way
 * before it comes back -- null for the ones that never do.
 */
export const TONES = [
  {
    value: 'fyi',
    label: 'Can be ignored',
    hint: 'A banner at the top of the page. Nothing has to happen.',
    blocks: false,
    needsReply: false,
    nagAfter: null,
  },
  {
    value: 'seen',
    label: 'Should be seen',
    hint: 'Covers the page until they close it.',
    blocks: true,
    needsReply: false,
    nagAfter: null,
  },
  {
    value: 'ask',
    label: 'Should reply',
    hint: 'Covers the page until they answer. Minimising it buys 5 minutes.',
    blocks: true,
    needsReply: true,
    nagAfter: 5 * 60 * 1000,
  },
  {
    value: 'urgent',
    label: 'Urgent — reply now',
    hint: 'The same, but back in a minute rather than five.',
    blocks: true,
    needsReply: true,
    nagAfter: 60 * 1000,
  },
]

export const DEFAULT_TONE = 'fyi'

/** The tone's own rules, or the mildest ones. */
export function toneOf(message) {
  return TONES.find((t) => t.value === message?.tone) || TONES[0]
}

/** Does closing this leave the sender's question unanswered? */
export function needsReplyFrom(message, uid) {
  // Never from the person who asked it -- they cannot reply to themselves,
  // so for them closing is the only way out.
  return toneOf(message).needsReply && message?.from !== uid && !hasReplied(message, uid)
}

/** Nobody reads a wall of text in a banner, and nobody writes one twice. */
export const MAX_BODY = 600
export const MAX_REPLY = 400

/**
 * Is this message addressed to this person?
 *
 * The sender is included deliberately: they need to see their own message
 * to know it went, and to read the replies to it.
 */
export function addressedTo(message, uid) {
  if (!message || !uid) return false
  if (message.from === uid) return true
  if (message.audience === 'all') return true
  return Array.isArray(message.to) && message.to.includes(uid)
}

/** Has this person put this one away? */
export function isDismissed(message, uid) {
  return Array.isArray(message?.dismissedBy) && message.dismissedBy.includes(uid)
}

export function isRead(message, uid) {
  return Array.isArray(message?.readBy) && message.readBy.includes(uid)
}

/** Has this person answered it? */
export function hasReplied(message, uid) {
  return (message?.replies || []).some((r) => r?.from === uid)
}

/**
 * Whether the banner is still owed to this person.
 *
 * A `note` goes when they close it. An `ask` goes when they ANSWER it --
 * closing is not answering, and a question that can be dismissed with one
 * click is a question that gets dismissed with one click.
 *
 * The sender is exempt from that rule: they cannot reply to themselves, so
 * for them closing is the only way out.
 */
export function isOpenFor(message, uid) {
  if (!addressedTo(message, uid)) return false

  // The obligation is checked BEFORE dismissal, and that order is the whole
  // point of it: checking dismissal first would let a recipient close an
  // unanswered question, which is exactly what "should reply" exists to
  // stop. The banner hides its close button for these, but a model that
  // relies on the UI to enforce a rule enforces nothing.
  //
  // And ANSWERING closes it -- `!hasReplied` rather than `needsReplyFrom`,
  // which is only ever true while the answer is outstanding. Falling through
  // to the dismissal check instead would leave a banner up after the thing
  // it asked for had been done, which is the other way to make people
  // ignore banners.
  if (toneOf(message).needsReply && message.from !== uid) return !hasReplied(message, uid)

  return !isDismissed(message, uid)
}

/**
 * The messages this person should see a banner for, newest first.
 *
 * Newest first because a banner stack is read from the top and the thing
 * that just happened is the thing that matters. Sorted on the stored
 * timestamp rather than on arrival, so two people looking at the same
 * screen see the same order.
 */
export function openFor(messages, uid) {
  return (messages || [])
    .filter((m) => isOpenFor(m, uid))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
}

/**
 * The message currently covering the page, or null.
 *
 * ONE at a time. Three dialogues stacked on a dashboard is not urgency, it
 * is an obstacle -- and a person who has to dismiss three things before they
 * can read a number will dismiss the third without looking at it.
 *
 * `snoozed` is a map of id to the moment it was MINIMISED, which is the one
 * piece of state here that is not on the message. Deliberately: minimising
 * is "not right now", not a decision worth recording, and writing it to the
 * database would put a document write behind a gesture people make while
 * reaching for something else. It lives for the session, and a reload puts
 * the message back -- which is the right answer for something that still
 * has not been answered.
 */
export function blockingFor(messages, uid, snoozed = {}, now = Date.now()) {
  return (
    openFor(messages, uid).find((m) => {
      if (!toneOf(m).blocks) return false
      // The sender is not interrupted by their own message. They wrote it.
      if (m.from === uid) return false
      // Seen once is seen, for anything that only asked to be looked at.
      if (!needsReplyFrom(m, uid) && isRead(m, uid)) return false
      return !isSnoozed(m, snoozed[m.id], now)
    }) || null
  )
}

/**
 * Is this one still minimised?
 *
 * A message that asks for nothing back stays minimised for good: the reader
 * has seen it, and covering the page again would be nagging about something
 * already dealt with.
 *
 * One that asks for a reply comes back, because the reply has not arrived --
 * and a question you can put away for ever by pressing minimise is a
 * question you can ignore by pressing minimise.
 */
export function isSnoozed(message, snoozedAt, now = Date.now()) {
  if (!snoozedAt) return false
  const { nagAfter } = toneOf(message)
  if (!nagAfter) return true
  return now - snoozedAt < nagAfter
}

/** When a minimised one comes back, or null if it does not. */
export function nagsAt(message, snoozedAt) {
  const { nagAfter } = toneOf(message)
  if (!snoozedAt || !nagAfter) return null
  return snoozedAt + nagAfter
}

/**
 * How long until the next one comes back, for the timer that has to notice.
 *
 * Nothing to wait for is null rather than Infinity, so a caller can tell the
 * difference between "later" and "never" without a magic number.
 */
export function nextNagIn(messages, uid, snoozed = {}, now = Date.now()) {
  const times = openFor(messages, uid)
    .map((m) => nagsAt(m, snoozed[m.id]))
    .filter((t) => t !== null && t > now)
  return times.length ? Math.min(...times) - now : null
}

/** How many are waiting, for the bell. */
export function unreadCount(messages, uid) {
  return (messages || []).filter((m) => addressedTo(m, uid) && m.from !== uid && !isRead(m, uid)).length
}

/**
 * Everything this person can see, for the inbox.
 *
 * Dismissed ones included: putting a banner away is not deleting the
 * message, and "where did that go" is the first thing somebody asks after
 * closing one by accident.
 */
export function inboxFor(messages, uid) {
  return (messages || [])
    .filter((m) => addressedTo(m, uid))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
}

/**
 * Who a message went to, in words.
 *
 * Names rather than ids, and the count rather than eleven names -- a banner
 * has one line and "Ravi, Sunil, Asha, Priya, …" spends it all on the
 * address.
 */
export function audienceLabel(message, usersById = {}) {
  if (message?.audience === 'all') return 'Everyone'
  const ids = Array.isArray(message?.to) ? message.to : []
  if (ids.length === 0) return 'Nobody'
  const names = ids.map((id) => usersById[id]?.name || usersById[id]?.email || 'Someone')
  if (names.length <= 2) return names.join(' and ')
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`
}

/**
 * What is wrong with this draft, or ''.
 *
 * Checked here rather than in the form so the same answer is given wherever
 * a message is composed, and so a rule cannot be enforced in the UI and
 * forgotten on the way to the database.
 */
export function draftProblem(draft) {
  const body = String(draft?.body || '').trim()
  if (!body) return 'Write something first'
  if (body.length > MAX_BODY) return `Too long by ${body.length - MAX_BODY} characters`
  if (draft?.audience !== 'all' && (draft?.to || []).length === 0) return 'Pick who it goes to'
  return ''
}

/**
 * A draft, as the document that gets stored.
 *
 * `to` is emptied for an "everyone" message: a stale list of the people who
 * happened to have accounts on Tuesday is worse than no list, because it
 * looks like an answer.
 */
export function messageDoc(draft, sender) {
  const audience = draft?.audience === 'all' ? 'all' : 'people'
  return {
    from: sender?.uid || '',
    fromName: sender?.name || sender?.email || 'Someone',
    audience,
    to: audience === 'all' ? [] : [...new Set((draft?.to || []).filter(Boolean))],
    body: String(draft?.body || '').trim().slice(0, MAX_BODY),
    tone: TONES.some((t) => t.value === draft?.tone) ? draft.tone : DEFAULT_TONE,
    createdAt: new Date().toISOString(),
    readBy: [],
    dismissedBy: [],
    replies: [],
  }
}

/** One reply, as it gets appended. */
export function replyDoc(text, sender) {
  return {
    from: sender?.uid || '',
    name: sender?.name || sender?.email || 'Someone',
    text: String(text || '').trim().slice(0, MAX_REPLY),
    at: new Date().toISOString(),
  }
}

/**
 * Adding one id to a list without duplicating it.
 *
 * Used for `readBy` and `dismissedBy`, which are written by several people
 * at once -- and which the security rules require to only ever grow by the
 * writer's own id.
 */
export function withId(list, id) {
  const current = Array.isArray(list) ? list : []
  return current.includes(id) ? current : [...current, id]
}

/** When it was sent, in words a banner has room for. */
export function whenText(iso, now = new Date()) {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''

  const mins = Math.floor((now - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
