import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  AUDIENCES,
  MAX_BODY,
  TONES,
  addressedTo,
  audienceLabel,
  draftProblem,
  hasReplied,
  inboxFor,
  isDismissed,
  isOpenFor,
  blockingFor,
  isRead,
  isSnoozed,
  messageDoc,
  nagsAt,
  needsReplyFrom,
  nextNagIn,
  openFor,
  replyDoc,
  toneOf,
  unreadCount,
  whenText,
  withId,
} from './messages.js'

const ME = 'u_me'
const YOU = 'u_you'
const BOSS = 'u_boss'

const msg = (extra = {}) => ({
  id: 'm1',
  from: BOSS,
  fromName: 'Boss',
  audience: 'people',
  to: [ME, BOSS],
  body: 'Nashik figures are wrong',
  tone: 'fyi',
  createdAt: '2026-08-31T10:00:00.000Z',
  readBy: [],
  dismissedBy: [],
  replies: [],
  ...extra,
})

// ---------------------------------------------------------------------
// Who it is for
// ---------------------------------------------------------------------

test('a message reaches the people it names', () => {
  assert.equal(addressedTo(msg(), ME), true)
  assert.equal(addressedTo(msg(), YOU), false)
})

test('"everyone" is a flag, not a list of who happened to exist', () => {
  // Sent on Monday, the person who joins on Tuesday still sees it -- which
  // is what anybody means by "everyone". A stored list is a snapshot.
  const all = msg({ audience: 'all', to: [] })
  assert.equal(addressedTo(all, YOU), true)
  assert.equal(addressedTo(all, 'somebody-who-joined-later'), true)
  assert.deepEqual(messageDoc({ audience: 'all', to: [YOU], body: 'hi' }, { uid: ME }).to, [])
})

test('the sender sees their own message', () => {
  // They need to know it went, and to read the replies to it.
  assert.equal(addressedTo(msg({ from: ME, to: [YOU] }), ME), true)
})

test('nobody is addressed by nothing', () => {
  assert.equal(addressedTo(null, ME), false)
  assert.equal(addressedTo(msg(), ''), false)
  assert.equal(addressedTo(msg({ to: null }), YOU), false)
})

// ---------------------------------------------------------------------
// How long the banner stays
// ---------------------------------------------------------------------

test('a note goes when it is closed', () => {
  assert.equal(isOpenFor(msg(), ME), true)
  assert.equal(isOpenFor(msg({ dismissedBy: [ME] }), ME), false)
})

test('closing is per person', () => {
  // One recipient closing a banner cannot close it for the other eleven.
  const seen = msg({ to: [ME, YOU, BOSS], dismissedBy: [ME] })
  assert.equal(isOpenFor(seen, ME), false)
  assert.equal(isOpenFor(seen, YOU), true)
  assert.equal(isDismissed(seen, ME), true)
  assert.equal(isDismissed(seen, YOU), false)
})

test('a question stays until it is ANSWERED, not until it is closed', () => {
  // A question that can be dismissed in one click is a question that gets
  // dismissed in one click.
  const ask = msg({ tone: 'ask' })
  assert.equal(isOpenFor(ask, ME), true)
  assert.equal(isOpenFor(msg({ tone: 'ask', dismissedBy: [ME] }), ME), true, 'closing does not answer it')

  const answered = msg({ tone: 'ask', replies: [{ from: ME, text: 'ok', at: 'x' }] })
  assert.equal(hasReplied(answered, ME), true)
  assert.equal(isOpenFor(answered, ME), false)
})

test('the sender of a question can still put it away', () => {
  // They cannot reply to themselves, so closing is their only way out.
  const mine = msg({ from: ME, tone: 'ask', to: [ME, YOU], dismissedBy: [ME] })
  assert.equal(isOpenFor(mine, ME), false)
})

test('an answer from somebody else does not close it for you', () => {
  const ask = msg({ tone: 'ask', to: [ME, YOU, BOSS], replies: [{ from: YOU, text: 'done', at: 'x' }] })
  assert.equal(isOpenFor(ask, ME), true)
  assert.equal(isOpenFor(ask, YOU), false)
})

test('banners are newest first, because that is how a stack is read', () => {
  const older = msg({ id: 'a', createdAt: '2026-08-30T09:00:00.000Z' })
  const newer = msg({ id: 'b', createdAt: '2026-08-31T09:00:00.000Z' })
  assert.deepEqual(openFor([older, newer], ME).map((m) => m.id), ['b', 'a'])
})

// ---------------------------------------------------------------------
// What interrupts
// ---------------------------------------------------------------------

test('a tone is an obligation, not a volume', () => {
  // What the reader has to DO is the thing they need to know: may I carry
  // on, do I have to look, do I have to answer.
  assert.deepEqual(TONES.map((t) => t.value), ['fyi', 'seen', 'ask', 'urgent'])
  assert.equal(toneOf(msg({ tone: 'fyi' })).blocks, false, 'the one that can be ignored covers nothing')
  assert.equal(toneOf(msg({ tone: 'seen' })).blocks, true)
  assert.equal(toneOf(msg({ tone: 'ask' })).needsReply, true)
  assert.equal(toneOf(msg({ tone: 'urgent' })).needsReply, true)
  assert.equal(toneOf(msg({ tone: 'nonsense' })).value, 'fyi', 'and anything unknown asks the least')
})

test('only the ones that ask for an answer need one', () => {
  assert.equal(needsReplyFrom(msg({ tone: 'fyi' }), ME), false)
  assert.equal(needsReplyFrom(msg({ tone: 'seen' }), ME), false)
  assert.equal(needsReplyFrom(msg({ tone: 'ask' }), ME), true)
  assert.equal(needsReplyFrom(msg({ tone: 'urgent' }), ME), true)
  assert.equal(needsReplyFrom(msg({ tone: 'ask', from: ME }), ME), false, 'never from the person who asked')
})

test('a message that can be ignored never covers the page', () => {
  assert.equal(blockingFor([msg({ tone: 'fyi' })], ME), null)
  assert.equal(blockingFor([msg({ tone: 'seen' })], ME).id, 'm1')
  assert.equal(blockingFor([msg({ tone: 'ask' })], ME).id, 'm1')
})

test('the sender is not interrupted by their own message', () => {
  // They wrote it.
  assert.equal(blockingFor([msg({ tone: 'urgent', from: ME, to: [ME, YOU] })], ME), null)
})

test('seen once is seen, for anything that only asked to be looked at', () => {
  assert.equal(blockingFor([msg({ tone: 'seen', readBy: [ME] })], ME), null)
  // But a question is not answered by being looked at.
  assert.equal(blockingFor([msg({ tone: 'ask', readBy: [ME] })], ME).id, 'm1')
})

test('never two at a time', () => {
  // Three dialogues stacked on a dashboard is not urgency, it is an
  // obstacle -- and the third gets dismissed without being read.
  const one = msg({ id: 'a', tone: 'seen', createdAt: '2026-08-31T09:00:00.000Z' })
  const two = msg({ id: 'b', tone: 'seen', createdAt: '2026-08-31T10:00:00.000Z' })
  assert.equal(blockingFor([one, two], ME).id, 'b', 'and it is the newest')
})

// ---------------------------------------------------------------------
// Minimising, and coming back
// ---------------------------------------------------------------------

const T = 1_700_000_000_000
const MIN = 60_000

test('minimising gives the dashboard back', () => {
  // Somebody who needs the number in order to answer the question must be
  // able to get at the number.
  assert.equal(blockingFor([msg({ tone: 'ask' })], ME, { m1: T }, T), null)
})

test('a question comes back five minutes later', () => {
  // A question you can put away for ever by pressing minimise is a question
  // you can ignore by pressing minimise.
  const ask = msg({ tone: 'ask' })
  assert.equal(blockingFor([ask], ME, { m1: T }, T + 4 * MIN), null, 'still minimised at four')
  assert.equal(blockingFor([ask], ME, { m1: T }, T + 6 * MIN).id, 'm1', 'back at six')
  assert.equal(toneOf(ask).nagAfter, 5 * MIN)
})

test('an urgent one comes back sooner', () => {
  const urgent = msg({ tone: 'urgent' })
  assert.equal(toneOf(urgent).nagAfter, MIN)
  assert.equal(blockingFor([urgent], ME, { m1: T }, T + 30_000), null)
  assert.equal(blockingFor([urgent], ME, { m1: T }, T + 2 * MIN).id, 'm1')
})

test('one that asks for nothing back stays minimised', () => {
  // The reader has seen it. Covering the page again would be nagging about
  // something already dealt with.
  const seen = msg({ tone: 'seen' })
  assert.equal(toneOf(seen).nagAfter, null)
  assert.equal(isSnoozed(seen, T, T + 99 * MIN), true)
  assert.equal(blockingFor([seen], ME, { m1: T }, T + 99 * MIN), null)
})

test('answering it stops it coming back at all', () => {
  const answered = msg({ tone: 'ask', replies: [{ from: ME, text: 'ok', at: 'x' }] })
  assert.equal(blockingFor([answered], ME, { m1: T }, T + 99 * MIN), null)
})

test('nothing minimised is nothing snoozed', () => {
  assert.equal(isSnoozed(msg({ tone: 'ask' }), undefined, T), false)
  assert.equal(nagsAt(msg({ tone: 'ask' }), undefined), null)
  assert.equal(nagsAt(msg({ tone: 'seen' }), T), null, 'and one that never returns has no time')
  assert.equal(nagsAt(msg({ tone: 'ask' }), T), T + 5 * MIN)
})

test('the timer is told when to wake, not asked every second', () => {
  // Nothing else on the screen changes with the clock, so polling would be a
  // re-render a second to catch an event that happens twice a day.
  assert.equal(nextNagIn([msg({ tone: 'ask' })], ME, { m1: T }, T), 5 * MIN)
  assert.equal(nextNagIn([msg({ tone: 'ask' })], ME, { m1: T }, T + 2 * MIN), 3 * MIN)
  assert.equal(nextNagIn([msg({ tone: 'ask' })], ME, {}, T), null, 'nothing minimised, nothing to wait for')
  assert.equal(nextNagIn([msg({ tone: 'seen' })], ME, { m1: T }, T), null, 'and never is not later')
})

test('the soonest one wins the timer', () => {
  const slow = msg({ id: 'a', tone: 'ask' })
  const fast = msg({ id: 'b', tone: 'urgent' })
  assert.equal(nextNagIn([slow, fast], ME, { a: T, b: T }, T), MIN)
})

test('the bell counts what is unread and not yours', () => {
  assert.equal(unreadCount([msg()], ME), 1)
  assert.equal(unreadCount([msg({ readBy: [ME] })], ME), 0)
  assert.equal(unreadCount([msg({ from: ME })], ME), 0, 'your own is not news to you')
  assert.equal(unreadCount([msg({ to: [YOU] })], ME), 0)
})

test('a dismissed message is still unread until it is read', () => {
  // Reading and putting away are different acts, and the code that dismisses
  // marks both -- but the model must not confuse them.
  assert.equal(isRead(msg({ dismissedBy: [ME] }), ME), false)
  assert.equal(isRead(msg({ readBy: [ME] }), ME), true)
})

test('the inbox keeps what the banner let go', () => {
  // "Where did that go" is the first thing somebody asks after closing one
  // by accident.
  const gone = msg({ dismissedBy: [ME] })
  assert.deepEqual(openFor([gone], ME), [])
  assert.equal(inboxFor([gone], ME).length, 1)
})

// ---------------------------------------------------------------------
// Writing one
// ---------------------------------------------------------------------

test('a draft with nothing in it is not sendable', () => {
  assert.equal(draftProblem({ audience: 'all', body: '' }), 'Write something first')
  assert.equal(draftProblem({ audience: 'all', body: '   ' }), 'Write something first')
})

test('a draft addressed to nobody is not sendable', () => {
  assert.equal(draftProblem({ audience: 'people', to: [], body: 'hi' }), 'Pick who it goes to')
  assert.equal(draftProblem({ audience: 'people', to: [YOU], body: 'hi' }), '')
  assert.equal(draftProblem({ audience: 'all', to: [], body: 'hi' }), '', 'everyone needs no list')
})

test('a wall of text is refused before it is sent, and said in characters', () => {
  const long = 'x'.repeat(MAX_BODY + 12)
  assert.equal(draftProblem({ audience: 'all', body: long }), 'Too long by 12 characters')
})

test('a stored message is trimmed, deduped and stamped', () => {
  const out = messageDoc({ audience: 'people', to: [YOU, YOU, ''], body: '  hello  ', tone: 'ask' }, { uid: ME, name: 'Me' })
  assert.deepEqual(out.to, [YOU])
  assert.equal(out.body, 'hello')
  assert.equal(out.from, ME)
  assert.equal(out.fromName, 'Me')
  assert.equal(out.tone, 'ask')
  assert.ok(!Number.isNaN(Date.parse(out.createdAt)))
  assert.deepEqual([out.readBy, out.dismissedBy, out.replies], [[], [], []])
})

test('an unknown tone asks the least, rather than the most', () => {
  // A message stored with a tone nobody recognises must not end up covering
  // everybody's screen because the fallback happened to be the loud one.
  assert.equal(messageDoc({ body: 'x', audience: 'all', tone: 'siren' }, {}).tone, 'fyi')
  assert.equal(messageDoc({ body: 'x', audience: 'all' }, {}).tone, 'fyi')
})

test('a reply carries who said it and when', () => {
  const r = replyDoc('  on it  ', { uid: ME, name: 'Me' })
  assert.equal(r.text, 'on it')
  assert.equal(r.from, ME)
  assert.equal(r.name, 'Me')
  assert.ok(!Number.isNaN(Date.parse(r.at)))
})

test('an id is added once, however many times it is added', () => {
  assert.deepEqual(withId([], ME), [ME])
  assert.deepEqual(withId([ME], ME), [ME])
  assert.deepEqual(withId([YOU], ME), [YOU, ME])
  assert.deepEqual(withId(null, ME), [ME])
})

// ---------------------------------------------------------------------
// Saying who and when
// ---------------------------------------------------------------------

test('an address is names, and a count once there are too many', () => {
  const people = { [ME]: { name: 'Ravi' }, [YOU]: { name: 'Sunil' }, [BOSS]: { name: 'Asha' } }
  assert.equal(audienceLabel({ audience: 'all' }, people), 'Everyone')
  assert.equal(audienceLabel({ to: [ME] }, people), 'Ravi')
  assert.equal(audienceLabel({ to: [ME, YOU] }, people), 'Ravi and Sunil')
  assert.equal(audienceLabel({ to: [ME, YOU, BOSS] }, people), 'Ravi, Sunil and 1 more')
  assert.equal(audienceLabel({ to: [] }, people), 'Nobody')
})

test('somebody with no name is still somebody', () => {
  assert.equal(audienceLabel({ to: ['ghost'] }, {}), 'Someone')
  assert.equal(audienceLabel({ to: [ME] }, { [ME]: { email: 'r@x.com' } }), 'r@x.com')
})

test('when it was sent, in words a banner has room for', () => {
  const now = new Date('2026-08-31T12:00:00.000Z')
  assert.equal(whenText('2026-08-31T11:59:40.000Z', now), 'just now')
  assert.equal(whenText('2026-08-31T11:30:00.000Z', now), '30m ago')
  assert.equal(whenText('2026-08-31T09:00:00.000Z', now), '3h ago')
  assert.equal(whenText('2026-08-29T12:00:00.000Z', now), '2d ago')
  assert.ok(whenText('2026-07-01T12:00:00.000Z', now).includes('Jul'))
  assert.equal(whenText('not a date', now), '')
})

// ---------------------------------------------------------------------
// The rules are the real boundary
// ---------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8')
const read = (p) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const hook = read('src/hooks/useMessages.js')
const shell = read('src/components/AppShell.jsx')
const centre = read('src/components/MessageCenter.jsx')

const messageRule = rules.slice(rules.indexOf('match /messages/'), rules.indexOf('match /dataSources/'))

test('you can only read what was sent to you', () => {
  assert.ok(messageRule.includes('allow get, list: if isAdmin() || forMe()'))
  assert.ok(messageRule.includes("resource.data.audience == 'all'"))
  assert.ok(messageRule.includes('request.auth.uid in resource.data.to'))
})

test('the client asks two questions it is allowed to ask', () => {
  // A `list` rule is evaluated per document and rejects the whole query if
  // any would fail -- rules narrow nothing. One unfiltered query fails for
  // everybody who is not an admin.
  assert.ok(hook.includes("where('to', 'array-contains', uid)"))
  assert.ok(hook.includes("where('audience', '==', 'all')"))
  assert.ok(hook.includes('const byId = new Map()'), 'and merges them')
})

test('you cannot send as somebody else', () => {
  assert.ok(messageRule.includes('request.resource.data.from == request.auth.uid'))
})

test('a new message arrives with nobody having read or closed it', () => {
  // Otherwise a sender could post one pre-dismissed for everybody, or
  // pre-answered.
  assert.ok(messageRule.includes('request.resource.data.readBy.size() == 0'))
  assert.ok(messageRule.includes('request.resource.data.dismissedBy.size() == 0'))
  assert.ok(messageRule.includes('request.resource.data.replies.size() == 0'))
})

test('a recipient may mark and reply, and nothing else', () => {
  // The body of something already delivered cannot be edited under it.
  assert.ok(
    messageRule.includes("hasOnly(['readBy', 'dismissedBy', 'replies'])")
  )
})

test('and only on their own behalf', () => {
  // Without this, one recipient could dismiss a message for everybody else.
  assert.ok(messageRule.includes("onlyAddsSelf('readBy')"))
  assert.ok(messageRule.includes("onlyAddsSelf('dismissedBy')"))
  assert.ok(messageRule.includes('concat([request.auth.uid])'))
})

test('a reply can be added but the ones already there cannot be removed', () => {
  assert.ok(messageRule.includes('request.resource.data.replies.size() >= resource.data.replies.size()'))
})

test('unsending is the sender’s business', () => {
  assert.ok(messageRule.includes('allow delete: if isAdmin() || (isSignedIn() && resource.data.from == request.auth.uid)'))
})

test('the body is bounded in the rules as well as in the form', () => {
  // A rule enforced only in the UI is a rule enforced nowhere.
  assert.ok(messageRule.includes('request.resource.data.body.size() <= 600'))
  assert.equal(MAX_BODY, 600, 'and the two agree')
})

// ---------------------------------------------------------------------
// Where it appears
// ---------------------------------------------------------------------

test('it is mounted on the shell, not on a page', () => {
  // A message about the workspace should not vanish because somebody
  // navigated to the admin panel.
  assert.ok(shell.includes('<MessageCenter />'))
})

test('the sender is a recipient of their own message', () => {
  // The rules only let somebody read what they are addressed in, so without
  // this they could not see the replies to their own question.
  assert.ok(hook.includes("if (document.audience !== 'all') document.to = withId(document.to, sender.uid)"))
})

test('a question offers no close button to the people it asks', () => {
  // Offering both makes answering optional.
  assert.ok(centre.includes('{!needsReply && ('))
})

test('the covering dialogue cannot be dismissed by reflex', () => {
  // No Escape, no click-away: those are the two ways a dialogue gets
  // dismissed without being read, and every button here is a decision worth
  // making on purpose.
  const at = centre.indexOf('function Blocking(')
  const body = centre.slice(at, centre.indexOf('function Inbox('))
  assert.ok(at > 0)
  assert.ok(!body.includes("e.key === 'Escape' && on"))
  assert.ok(!body.includes('onClick={onClose}'))
  assert.ok(body.includes('aria-modal="true"'), 'and it says it is modal')
})

test('but it can be minimised, and minimising gives the dashboard back', () => {
  const at = centre.indexOf('function Blocking(')
  const body = centre.slice(at, centre.indexOf('function Inbox('))
  assert.ok(body.includes('onClick={onMinimise}'))
  assert.ok(body.includes('<Minus size={12} /> Minimise'), 'and the button says what it does')
  // What it costs, said before it is pressed rather than discovered five
  // minutes later.
  assert.ok(body.includes('This returns in'))
})

test('minimising is remembered for the session, not written to the database', () => {
  // It is "not right now", not a decision worth recording -- and a document
  // write behind a gesture people make while reaching for something else is
  // a write nobody asked for.
  assert.ok(centre.includes('const [snoozed, setSnoozed] = useState({})'))
  assert.ok(centre.includes('setSnoozed((all) => ({ ...all, [blocking.id]: Date.now() }))'))
})

test('the clock is set for the moment it is due, not polled', () => {
  // Nothing else on this screen changes with the clock.
  assert.ok(centre.includes('const timer = setTimeout(() => setNow(Date.now())'))
  assert.ok(!centre.includes('setInterval'))
})

test('a failed send says so', () => {
  // A rejected write is almost always a rule, and silence means somebody
  // believes they sent something they did not.
  assert.ok(centre.includes("setFailed(e?.message || 'That could not be sent')"))
  assert.ok(hook.includes("setError(e?.message || 'Messages could not be loaded')"))
})

test('every tone the picker offers is one the renderer can draw', () => {
  for (const a of AUDIENCES) assert.ok(['people', 'all'].includes(a.value), a.value)
  for (const t of TONES) {
    assert.ok(t.label && t.hint, t.value)
    // A tone with no style falls back to the quiet one, which would draw an
    // urgent message in grey.
    assert.ok(centre.includes(`${t.value}: { bar:`), `no style for ${t.value}`)
  }
})

test('the rules of a tone live in one place', () => {
  // The banner had its own copy -- `tone === 'ask'` -- which was already
  // wrong for `urgent` and would have gone on being wrong for the next tone
  // somebody added.
  assert.ok(centre.includes('const needsReply = needsReplyFrom(message, uid)'))
  assert.ok(!centre.includes("message.tone === 'ask'"))
})
