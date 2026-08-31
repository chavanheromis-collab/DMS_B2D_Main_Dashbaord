import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  ALL,
  clockOf,
  conversationIdOf,
  conversationsFor,
  dayKey,
  dayLabel,
  draftFor,
  entriesOf,
  kindOf,
  membersOf,
  otherPeople,
  previewOf,
  replyTarget,
  runsWith,
  titleOf,
} from './conversations.js'

const ME = 'u_me'
const RAVI = 'u_ravi'
const ASHA = 'u_asha'

const PEOPLE = {
  [ME]: { name: 'Me' },
  [RAVI]: { name: 'Ravi Kumar' },
  [ASHA]: { name: 'Asha Patil' },
}

const msg = (extra = {}) => ({
  id: 'm1',
  from: RAVI,
  fromName: 'Ravi Kumar',
  audience: 'people',
  to: [ME],
  body: 'Nashik figures are wrong',
  tone: 'fyi',
  createdAt: '2026-08-20T10:00:00.000Z',
  readBy: [],
  dismissedBy: [],
  replies: [],
  ...extra,
})

// ---------------------------------------------------------------------
// Which conversation something belongs to
// ---------------------------------------------------------------------

test('a chat is the same chat from both sides', () => {
  // The whole thing rests on this. If Ravi's id for the conversation is not
  // my id for it, we are typing into two different rooms.
  const mine = msg({ from: RAVI, to: [ME] })
  const his = msg({ from: ME, to: [RAVI] })
  assert.equal(conversationIdOf(mine, ME), RAVI, 'from my side it is Ravi')
  assert.equal(conversationIdOf(his, RAVI), ME, 'from his side it is me')
  // And both of my own messages land in the one conversation.
  assert.equal(conversationIdOf(mine, ME), conversationIdOf(his, ME))
})

test('a group is its members, in a fixed order', () => {
  // Otherwise ticking two names in the other order is a second conversation
  // with exactly the same people in it.
  const a = msg({ from: ME, to: [RAVI, ASHA] })
  const b = msg({ from: ME, to: [ASHA, RAVI] })
  assert.equal(conversationIdOf(a, ME), conversationIdOf(b, ME))
  assert.equal(conversationIdOf(a, ME), [ASHA, RAVI].sort().join('|'))
})

test('a group is the same group for everyone in it', () => {
  const sent = msg({ from: ME, to: [RAVI, ASHA] })
  // Ravi sees me and Asha; Asha sees me and Ravi; I see Ravi and Asha.
  assert.deepEqual(otherPeople(sent, RAVI), [ME, ASHA].sort())
  assert.deepEqual(otherPeople(sent, ASHA), [ME, RAVI].sort())
  assert.deepEqual(otherPeople(sent, ME), [ASHA, RAVI].sort())
})

test('everyone is one channel, not one chat per person', () => {
  assert.equal(conversationIdOf(msg({ audience: 'all', to: [] }), ME), ALL)
  assert.equal(conversationIdOf(msg({ audience: 'all', from: ME, to: [] }), ME), ALL)
})

test('a message with nobody else in it still lands somewhere', () => {
  // Losing it would be worse than a thread with one person in it.
  assert.equal(conversationIdOf(msg({ from: ME, to: [ME] }), ME), 'self')
  assert.equal(conversationIdOf(null, ME), null)
})

test('what kind of conversation an id describes', () => {
  assert.equal(kindOf(ALL), 'all')
  assert.equal(kindOf(RAVI), 'direct')
  assert.equal(kindOf(`${ASHA}|${RAVI}`), 'group')
  assert.equal(kindOf('self'), 'self')
  assert.deepEqual(membersOf(`${ASHA}|${RAVI}`), [ASHA, RAVI])
  assert.deepEqual(membersOf(ALL), [])
})

test('what it is called', () => {
  assert.equal(titleOf(ALL, PEOPLE), 'Everyone')
  assert.equal(titleOf(RAVI, PEOPLE), 'Ravi Kumar')
  assert.equal(titleOf(`${ASHA}|${RAVI}`, PEOPLE), 'Asha Patil and Ravi Kumar')
  assert.equal(titleOf('a|b|c|d', {}), 'Someone, Someone and 2 more')
  assert.equal(titleOf(RAVI, {}), 'Someone', 'somebody unknown is still somebody')
})

// ---------------------------------------------------------------------
// The bubbles
// ---------------------------------------------------------------------

test('a reply is the next message, not a footnote under one', () => {
  // The nesting stays in the database, where it carries the obligation. It
  // just stops being a shape anybody has to look at.
  const m = msg({
    replies: [
      { from: ME, name: 'Me', text: 'checking now', at: '2026-08-20T10:05:00.000Z' },
      { from: RAVI, name: 'Ravi Kumar', text: 'thanks', at: '2026-08-20T10:09:00.000Z' },
    ],
  })
  const out = entriesOf([m], ME, RAVI)
  assert.deepEqual(out.map((e) => e.text), ['Nashik figures are wrong', 'checking now', 'thanks'])
  assert.deepEqual(out.map((e) => e.from), [RAVI, ME, RAVI])
})

test('bubbles are in the order things were said, across messages', () => {
  // Two messages whose replies interleave in time must not come out in
  // message order with each message's replies bunched under it.
  const a = msg({ id: 'a', createdAt: '2026-08-20T10:00:00.000Z', body: 'first',
    replies: [{ from: ME, name: 'Me', text: 'third', at: '2026-08-20T12:00:00.000Z' }] })
  const b = msg({ id: 'b', createdAt: '2026-08-20T11:00:00.000Z', body: 'second' })
  assert.deepEqual(entriesOf([a, b], ME, RAVI).map((e) => e.text), ['first', 'second', 'third'])
})

test('only this conversation, and only what was addressed to you', () => {
  const mine = msg({ id: 'a', from: RAVI, to: [ME] })
  const other = msg({ id: 'b', from: ASHA, to: [ME] })
  // Ravi talking to himself: the conversation id is RAVI from my side too,
  // so ONLY the addressed-to check keeps it out. A message to somebody else
  // entirely lands in a different conversation and would be filtered either
  // way -- which is why it does not test this.
  const notMine = msg({ id: 'c', from: RAVI, to: [RAVI] })
  const out = entriesOf([mine, other, notMine], ME, RAVI)
  assert.deepEqual(out.map((e) => e.messageId), ['a'])
})

test('a bubble remembers the message it came from', () => {
  // Which is how answering an obligation from the chat still closes it.
  assert.equal(entriesOf([msg({ id: 'x' })], ME, RAVI)[0].messageId, 'x')
})

test('nothing at all is an empty chat, not a crash', () => {
  assert.deepEqual(entriesOf(null, ME, RAVI), [])
  assert.deepEqual(entriesOf([msg({ replies: 'nonsense' })], ME, RAVI).length, 1)
})

// ---------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------

test('what is at the top is what just happened', () => {
  const old = msg({ id: 'a', from: RAVI, to: [ME], createdAt: '2026-08-01T10:00:00.000Z' })
  const recent = msg({ id: 'b', from: ASHA, to: [ME], createdAt: '2026-08-20T10:00:00.000Z' })
  assert.deepEqual(conversationsFor([old, recent], ME, PEOPLE).map((c) => c.id), [ASHA, RAVI])
})

test('a reply counts as the last thing said', () => {
  // Ordered by when the conversation was last ALIVE, not when it started --
  // otherwise an answer this morning sinks below a message from last week.
  const chatty = msg({ id: 'a', from: RAVI, to: [ME], createdAt: '2026-08-01T10:00:00.000Z',
    replies: [{ from: ME, name: 'Me', text: 'on it', at: '2026-08-25T10:00:00.000Z' }] })
  const quiet = msg({ id: 'b', from: ASHA, to: [ME], createdAt: '2026-08-20T10:00:00.000Z' })
  const rows = conversationsFor([chatty, quiet], ME, PEOPLE)
  assert.deepEqual(rows.map((c) => c.id), [RAVI, ASHA])
  assert.equal(rows[0].lastText, 'on it')
  assert.equal(rows[0].lastMine, true)
})

test('unread counts what you have not opened, from other people', () => {
  const unread = msg({ id: 'a', from: RAVI, to: [ME] })
  const read = msg({ id: 'b', from: RAVI, to: [ME], readBy: [ME] })
  const mine = msg({ id: 'c', from: ME, to: [RAVI] })
  const [row] = conversationsFor([unread, read, mine], ME, PEOPLE)
  assert.equal(row.unread, 1)
})

test('owed is a different thing from unread', () => {
  // A question you have read and not answered is still owed; a message you
  // have not opened is not necessarily owed anything.
  const asked = msg({ from: RAVI, to: [ME], tone: 'ask', readBy: [ME] })
  const [row] = conversationsFor([asked], ME, PEOPLE)
  assert.equal(row.unread, 0)
  assert.equal(row.owed, true)
})

test('answering clears what was owed', () => {
  const answered = msg({ from: RAVI, to: [ME], tone: 'ask', readBy: [ME],
    replies: [{ from: ME, name: 'Me', text: 'done', at: '2026-08-20T11:00:00.000Z' }] })
  assert.equal(conversationsFor([answered], ME, PEOPLE)[0].owed, false)
})

test('your own question is not owed by you', () => {
  const asked = msg({ from: ME, to: [RAVI], tone: 'ask' })
  assert.equal(conversationsFor([asked], ME, PEOPLE)[0].owed, false)
})

test('the preview says who said it when it was you', () => {
  assert.equal(previewOf({ lastText: 'on it', lastMine: true }), 'You: on it')
  assert.equal(previewOf({ lastText: 'on it', lastMine: false }), 'on it')
  assert.equal(previewOf({}), 'No messages yet')
  assert.ok(!previewOf({ lastText: 'a\nb' }).includes('\n'), 'one line, whatever was typed')
  assert.ok(previewOf({ lastText: 'x'.repeat(200) }).length < 60)
})

// ---------------------------------------------------------------------
// Typing is answering
// ---------------------------------------------------------------------

test('typing answers the question that is waiting on you', () => {
  // In a chat nobody presses "Reply". If typing did not count, every answer
  // would leave its question open and the dialogue would come back.
  const asked = msg({ id: 'q', from: RAVI, to: [ME], tone: 'ask' })
  assert.equal(replyTarget([asked], ME, RAVI)?.id, 'q')
})

test('and only while it is still waiting', () => {
  const answered = msg({ id: 'q', from: RAVI, to: [ME], tone: 'ask',
    replies: [{ from: ME, name: 'Me', text: 'done', at: '2026-08-20T11:00:00.000Z' }] })
  assert.equal(replyTarget([answered], ME, RAVI), null)
})

test('a message that asked nothing is not answered by accident', () => {
  // Otherwise every new line would be filed as a reply to the last thing
  // said, and nothing would ever be its own message.
  const chat = msg({ from: RAVI, to: [ME], tone: 'fyi' })
  assert.equal(replyTarget([chat], ME, RAVI), null)
})

test('your own question is not yours to answer', () => {
  assert.equal(replyTarget([msg({ from: ME, to: [RAVI], tone: 'ask' })], ME, RAVI), null)
})

test('the newest unanswered question is the one being answered', () => {
  const older = msg({ id: 'a', from: RAVI, to: [ME], tone: 'ask', createdAt: '2026-08-20T10:00:00.000Z' })
  const newer = msg({ id: 'b', from: RAVI, to: [ME], tone: 'ask', createdAt: '2026-08-20T12:00:00.000Z' })
  assert.equal(replyTarget([older, newer], ME, RAVI)?.id, 'b')
})

test('a new line addresses the same people the conversation is between', () => {
  assert.deepEqual(draftFor(RAVI, 'fyi'), { audience: 'people', to: [RAVI], body: '', tone: 'fyi' })
  assert.deepEqual(draftFor(`${ASHA}|${RAVI}`, 'ask').to, [ASHA, RAVI])
  // Everyone is a FLAG, not a list: store the uids and the person who joins
  // tomorrow never sees it, which is not what anybody means by everyone.
  assert.equal(draftFor(ALL, 'fyi').audience, ALL)
  assert.notEqual(draftFor(ALL, 'fyi').audience, 'people')
  assert.deepEqual(draftFor(ALL, 'fyi').to, [])
})

// ---------------------------------------------------------------------
// Reading it
// ---------------------------------------------------------------------

test('a run from one person is one avatar, not three', () => {
  const a = { from: RAVI, at: '2026-08-20T10:00:00.000Z' }
  const b = { from: RAVI, at: '2026-08-20T10:01:00.000Z' }
  const late = { from: RAVI, at: '2026-08-20T11:00:00.000Z' }
  const other = { from: ASHA, at: '2026-08-20T10:01:00.000Z' }
  assert.equal(runsWith(a, b), true)
  assert.equal(runsWith(a, late), false, 'an hour later is a new thought')
  assert.equal(runsWith(a, other), false)
  assert.equal(runsWith(null, b), false)
})

test('days are marked, so a time is never ambiguous', () => {
  const now = new Date('2026-08-25T09:00:00.000Z')
  assert.equal(dayLabel('2026-08-25T08:00:00.000Z', now), 'Today')
  assert.equal(dayLabel('2026-08-24T08:00:00.000Z', now), 'Yesterday')
  assert.ok(dayLabel('2026-08-01T08:00:00.000Z', now).includes('2026'))
  assert.equal(dayLabel('nonsense'), '')
})

test('a day key groups by day, not by the hour it happened', () => {
  assert.equal(dayKey('2026-08-20T00:30:00.000Z'), dayKey('2026-08-20T23:30:00.000Z'))
  assert.notEqual(dayKey('2026-08-20T23:30:00.000Z'), dayKey('2026-08-21T00:30:00.000Z'))
  assert.equal(dayKey('nonsense'), '')
})

test('a broken time is blank, not "Invalid Date"', () => {
  assert.equal(clockOf('nonsense'), '')
  assert.ok(clockOf('2026-08-20T10:00:00.000Z').length > 2)
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const read = (p) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const chat = read('src/components/Conversations.jsx')
const centre = read('src/components/MessageCenter.jsx')

test('nothing is stored differently for this', () => {
  // A conversation is derived from who a message is between. Writing it down
  // as well would be a second source of truth about who is in it, and a way
  // for the two to disagree.
  const lib = read('src/lib/conversations.js')
  assert.ok(!lib.includes('collection('))
  assert.ok(!lib.includes('firebase'))
})

test('typing goes through one place that decides what it means', () => {
  assert.ok(centre.includes('const sendInChat = useCallback('))
  assert.ok(centre.includes('if (replyTo) return reply(replyTo, text)'))
  assert.ok(centre.includes('return send({ ...draftFor(conversationId, tone), body: text })'))
})

test('opening a chat is reading it', () => {
  // Marking on open rather than on a click is what stops the bell counting
  // what somebody is looking at.
  assert.ok(chat.includes('onRead(m)'))
})

test('the newest is at the bottom, and that is where it opens', () => {
  assert.ok(chat.includes("endRef.current?.scrollIntoView({ block: 'end' })"))
})

test('mine on the right, theirs on the left', () => {
  // The shape everybody already knows, so nobody has to learn which side is
  // which. Asserted WITH the condition: the class strings survive being
  // wired to a constant `false`, and then everything lands on one side.
  assert.ok(chat.includes("${mine ? 'flex-row-reverse' : ''}"))
  assert.ok(chat.includes("mine ? 'rounded-br-sm bg-indigo-600 text-white'"))
})

test('Enter sends, Shift+Enter is a new line', () => {
  assert.ok(chat.includes("if (e.key === 'Enter' && !e.shiftKey)"))
  assert.ok(chat.includes('e.preventDefault()'))
})

test('escape backs out one screen at a time', () => {
  // Closing the whole panel from inside a conversation loses your place for
  // no reason.
  assert.ok(chat.includes('if (starting) setStarting(false) else if (openId) setOpenId(null) else onClose()'))
})

test('the tone picker is on screen, not folded away', () => {
  // Folded away it was a setting nobody knew was there -- and what you are
  // asking of somebody is the one thing about a message that cannot be
  // inferred from its words.
  assert.ok(!chat.includes('showTones'), 'nothing to open, because nothing is shut')
  assert.ok(chat.includes('{TONES.map((t) => ('))
  assert.ok(chat.includes('onClick={() => setTone(t.value)}'))
  assert.ok(chat.includes('useState(DEFAULT_TONE)'), 'and it starts on the quiet one')
})

test('which tone is chosen is readable without clicking anything', () => {
  assert.ok(chat.includes('aria-pressed={tone === t.value}'))
  assert.ok(chat.includes("tone === t.value ? 'border-indigo-600 bg-indigo-600 text-white'"))
  assert.ok(chat.includes('{toneOf({ tone }).hint}'), 'and it says what it will do')
})

test('one avatar helper, not one per screen', () => {
  assert.ok(chat.includes("import { avatarSpec } from '../lib/avatar'"))
  assert.ok(!chat.includes('function initialsOf'))
  assert.ok(!chat.includes('AVATAR_TINTS'))
})

test('no media, only words', () => {
  // Asked for explicitly: chat, and nothing to attach.
  for (const word of ['type="file"', 'FileReader', 'Paperclip', 'accept="image']) {
    assert.ok(!chat.includes(word), word)
  }
})
