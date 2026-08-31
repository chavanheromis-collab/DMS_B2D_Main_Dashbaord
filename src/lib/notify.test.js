import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  ASK_AGAIN_AFTER,
  BADGE,
  BASE_TITLE,
  askIsDue,
  notificationFor,
  pageIsVisible,
  pendingNotifications,
  shouldOfferNotifications,
  titleWithBadge,
} from './notify.js'
import { toneOf } from './messages.js'

const ME = 'u_me'
const BOSS = 'u_boss'

const msg = (extra = {}) => ({
  id: 'm1',
  from: BOSS,
  fromName: 'Boss',
  audience: 'people',
  to: [ME, BOSS],
  body: 'Nashik figures are wrong',
  tone: 'fyi',
  readBy: [],
  dismissedBy: [],
  replies: [],
  ...extra,
})

// ---------------------------------------------------------------------
// When to raise one
// ---------------------------------------------------------------------

test('nothing is raised while the person is looking at the page', () => {
  // The banner has already told them. Firing a desktop notification for
  // something on screen is how an app teaches people to turn it off.
  assert.deepEqual(pendingNotifications([msg()], ME, { visible: true }), [])
  assert.equal(pendingNotifications([msg()], ME, { visible: false }).length, 1)
})

test('a hidden tab is not the only way to be away', () => {
  // A visible tab in an unfocused window is a dashboard on a second monitor
  // that nobody is reading.
  const hiddenTab = { visibilityState: 'hidden', hasFocus: () => true }
  const otherWindow = { visibilityState: 'visible', hasFocus: () => false }
  const watching = { visibilityState: 'visible', hasFocus: () => true }
  assert.equal(pageIsVisible(hiddenTab), false)
  assert.equal(pageIsVisible(otherWindow), false)
  assert.equal(pageIsVisible(watching), true)
})

test('a browser with no hasFocus is not assumed to be away', () => {
  // Old Safari and every test environment. Missing information is not
  // evidence of absence, and guessing "away" means notifying somebody who
  // is looking straight at it.
  assert.equal(pageIsVisible({ visibilityState: 'visible' }), true)
  assert.equal(pageIsVisible(null), true)
})

test('your own message does not notify you', () => {
  assert.deepEqual(pendingNotifications([msg({ from: ME })], ME, { visible: false }), [])
})

test('something already read does not notify', () => {
  // Read on a second device, or before this tab went into the background.
  assert.deepEqual(pendingNotifications([msg({ readBy: [ME] })], ME, { visible: false }), [])
})

test('a message addressed to somebody else does not notify', () => {
  assert.deepEqual(pendingNotifications([msg({ to: [BOSS] })], ME, { visible: false }), [])
  assert.equal(pendingNotifications([msg({ audience: 'all', to: [] })], ME, { visible: false }).length, 1)
})

test('never twice for the same message', () => {
  // A re-render, a reconnecting listener, or a reply arriving on it must not
  // raise the same alert again.
  const notified = new Set(['m1'])
  assert.deepEqual(pendingNotifications([msg()], ME, { visible: false, notified }), [])
})

test('a message with no id is not notifiable', () => {
  // It has not been written yet, and there would be nothing to remember it
  // by -- so it would raise again on every snapshot.
  assert.deepEqual(pendingNotifications([msg({ id: undefined })], ME, { visible: false }), [])
})

test('nothing at all is not an error', () => {
  assert.deepEqual(pendingNotifications(null, ME, { visible: false }), [])
  assert.deepEqual(pendingNotifications([msg()], '', { visible: false }), [])
})

// ---------------------------------------------------------------------
// What it says
// ---------------------------------------------------------------------

test('the sender is the title, because that is what people scan for', () => {
  // "Ravi" tells somebody more than "New message" does.
  const one = msg({ fromName: 'Ravi', to: [ME], from: BOSS })
  const { title, options } = notificationFor(one, toneOf(one), { uid: ME, usersById: { [BOSS]: { name: 'Ravi' } } })
  assert.equal(title, 'Ravi', 'a one-to-one chat is just the person')
  assert.equal(options.body, 'Nashik figures are wrong')
})

test('and where it came from, when that is not the same thing', () => {
  // "Ravi" and "Ravi · Everyone" are two different things to be interrupted
  // by, and only one of them is worth turning to.
  const all = msg({ fromName: 'Ravi', audience: 'all', to: [] })
  assert.equal(notificationFor(all, toneOf(all), { uid: ME }).title, 'Ravi · Everyone')

  const group = msg({ fromName: 'Ravi', from: BOSS, to: [ME, 'u_third'] })
  const people = { [BOSS]: { name: 'Ravi' }, u_third: { name: 'Asha' } }
  assert.ok(notificationFor(group, toneOf(group), { uid: ME, usersById: people }).title.includes('Asha'))
})

test('an unnamed sender still has a title', () => {
  assert.equal(notificationFor(msg({ fromName: '', to: [ME] }), toneOf(msg()), { uid: ME }).title, 'New message')
  assert.equal(notificationFor(null, null).title, 'New message')
})

test('six messages from one person are one stack, not six alerts', () => {
  // Tagged by CONVERSATION rather than by message: what somebody wants to
  // be told is "Ravi said something", once, not once per line he typed.
  const a = msg({ id: 'm1', from: BOSS, to: [ME] })
  const b = msg({ id: 'm2', from: BOSS, to: [ME] })
  const tag = (m) => notificationFor(m, toneOf(m), { uid: ME }).options.tag
  // Truthy first: with no tag at all both are `undefined`, which compares
  // equal while every message in fact arrives as its own separate alert.
  assert.ok(tag(a), 'a notification must carry a tag to be grouped by')
  assert.equal(tag(a), tag(b))
  assert.equal(notificationFor(a, toneOf(a), { uid: ME }).options.renotify, false)
})

test('a notification carries a face, not just words', () => {
  // A desktop notification with no icon is a grey square with the browser's
  // logo on it, indistinguishable from every other site that notifies.
  // There is no canvas in a test, so the icon is absent rather than broken.
  const { options } = notificationFor(msg(), toneOf(msg()), { uid: ME })
  // The KEY, not its value: there is no canvas in a test, so the icon is
  // `undefined` whether it was asked for or not.
  assert.ok('icon' in options, 'a notification must ask for a face')
  assert.equal(options.icon, undefined, 'and go plain rather than crash without one')
  assert.ok(String(options.badge).startsWith('data:image/svg+xml'), 'the badge needs no canvas')
  assert.ok(options.data.conversation)
})

test('a phone buzzes for what wants an answer and stays still otherwise', () => {
  const ask = msg({ tone: 'ask' })
  const fyi = msg({ tone: 'fyi' })
  assert.ok(Array.isArray(notificationFor(ask, toneOf(ask)).options.vibrate))
  assert.equal(notificationFor(fyi, toneOf(fyi)).options.vibrate, undefined)
})

test('the obligation follows the message onto the desktop', () => {
  // Which is the whole difference between "should reply" and "can be
  // ignored", carried out of the app.
  const ask = msg({ tone: 'ask' })
  const fyi = msg({ tone: 'fyi' })
  assert.equal(notificationFor(ask, toneOf(ask)).options.requireInteraction, true)
  assert.equal(notificationFor(fyi, toneOf(fyi)).options.requireInteraction, false)
  assert.equal(notificationFor(fyi, toneOf(fyi)).options.silent, true, 'and one that can be ignored makes no sound')
  assert.equal(notificationFor(ask, toneOf(ask)).options.silent, false)
})

test('a long message is cut to what a notification will show', () => {
  const long = msg({ body: 'x'.repeat(500) })
  assert.equal(notificationFor(long, toneOf(long)).options.body.length, 240)
})

// ---------------------------------------------------------------------
// The tab title
// ---------------------------------------------------------------------

test('the count goes in the tab title, where people actually see it', () => {
  // It costs no permission and survives a denied prompt.
  assert.equal(titleWithBadge(0), BASE_TITLE)
  assert.equal(titleWithBadge(3), `(3) ${BASE_TITLE}`)
  assert.equal(titleWithBadge(12), `(9+) ${BASE_TITLE}`)
})

test('nothing waiting leaves the title alone', () => {
  assert.equal(titleWithBadge(null), BASE_TITLE)
  assert.equal(titleWithBadge(-1), BASE_TITLE)
  assert.equal(titleWithBadge('x'), BASE_TITLE)
})

test('the title it falls back to is the one in the HTML', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  assert.ok(html.includes(`<title>${BASE_TITLE}</title>`), 'or the tab renames itself on first render')
})

// ---------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------

test('the ask appears whenever it can still be granted', () => {
  assert.equal(shouldOfferNotifications('default'), true)
  assert.equal(shouldOfferNotifications('granted'), false)
  assert.equal(shouldOfferNotifications('unsupported'), false)
})

test('a denied prompt is never offered again', () => {
  // The browser will not re-prompt, so a button that appears to ask and
  // silently does nothing is worse than no button.
  assert.equal(shouldOfferNotifications('denied'), false)
})

test('it is asked without waiting for a first message to justify it', () => {
  // Messages here carry obligations. One that only arrives if the right tab
  // happens to be open is a message that does not arrive -- so the ask does
  // not wait for somebody to miss one first.
  assert.equal(askIsDue('default', 0, 0), true)
})

test('"not now" means an hour, not for ever', () => {
  // A nag inside one sitting is how a prompt gets closed unread; a "no"
  // that lasts for ever is how the feature quietly stops working.
  const put_off = 1_000_000
  assert.equal(askIsDue('default', put_off, put_off + 60_000), false)
  assert.equal(askIsDue('default', put_off, put_off + ASK_AGAIN_AFTER), true)
  assert.ok(ASK_AGAIN_AFTER >= 15 * 60 * 1000 && ASK_AGAIN_AFTER <= 24 * 60 * 60 * 1000)
})

test('and putting it off cannot resurrect a settled answer', () => {
  assert.equal(askIsDue('granted', 0, Date.now()), false)
  assert.equal(askIsDue('denied', 0, Date.now()), false)
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

const centre = read('src/components/MessageCenter.jsx')
const lib = read('src/lib/notify.js')

test('permission is asked for by a button, never on load', () => {
  // Not politeness: Safari and everything on iOS refuse `requestPermission`
  // without a user gesture, so asking on load is how you get no prompt at
  // all -- and a prompt somebody chose to open is the one they say yes to.
  assert.ok(centre.includes('onAllow={async () => setPermission(await askPermission())}'))
  assert.ok(!centre.includes('useEffect(() => { askPermission'))
})

test('the ask covers the page rather than hiding in a corner', () => {
  // It is not a preference. It is the difference between a message arriving
  // and a message sitting in a tab nobody has open.
  const ask = centre.slice(centre.indexOf('function PermissionAsk('), centre.indexOf('function Toast('))
  assert.ok(ask.length > 0)
  assert.ok(ask.includes('fixed inset-0'))
  assert.ok(ask.includes('Turn on notifications'))
  assert.ok(ask.includes('Not now'), 'a prompt with no way out is answered by closing the tab')
})

test('"not now" is remembered per browser, and survives having no storage', () => {
  // Permission IS per browser, so putting it off on the office desktop must
  // not silence the ask on somebody's laptop.
  assert.ok(centre.includes('window.localStorage.setItem(ASK_KEY, String(now))'))
  assert.ok(centre.includes('window.localStorage.getItem(ASK_KEY)'))
  // A private window THROWS on access -- both ways. Unguarded, the read
  // takes the whole message centre down on the first render.
  assert.ok(centre.includes('try { return Number(window.localStorage.getItem(ASK_KEY)) || 0 } catch'))
  assert.ok(centre.includes('try { window.localStorage.setItem(ASK_KEY, String(now)) } catch'))
})

test('the page knows when it is being looked at, three ways', () => {
  // Switching tab, clicking another window, and coming back to either.
  // Each one asserted on its OWN listener: a bare search for the event name
  // is satisfied by the line that removes it, so dropping the one that
  // listens would pass.
  const on = [
    "document.addEventListener('visibilitychange', check)",
    "window.addEventListener('focus', check)",
    "window.addEventListener('blur', check)",
  ]
  for (const line of on) assert.ok(centre.includes(line), line)
})

test('and stops listening when the centre goes', () => {
  // Three listeners left on the document is three listeners calling
  // setState on something React has unmounted.
  const off = [
    "document.removeEventListener('visibilitychange', check)",
    "window.removeEventListener('focus', check)",
    "window.removeEventListener('blur', check)",
  ]
  for (const line of off) assert.ok(centre.includes(line), line)
})

test('an id is remembered BEFORE the notification is raised', () => {
  // `raise` can fail on a platform that wants a service worker, and
  // retrying on every snapshot would be a loop nobody can see.
  const at = centre.indexOf('notified.current.add(m.id)')
  const raised = centre.indexOf('raise(m, toneOf(m)')
  assert.ok(at > 0 && raised > at)
})

test('the remembered ids survive a re-render', () => {
  // State would reset the set on every render that touched it, and a ref is
  // what makes "never twice" mean never rather than usually.
  assert.ok(centre.includes('const notified = useRef(new Set())'))
})

test('a failed notification does not take the page with it', () => {
  // `new Notification` throws rather than returning null on Android Chrome.
  assert.ok(lib.includes('try {'))
  assert.ok(lib.includes('} catch { return null }') || lib.includes('catch {'))
})

test('clicking one brings the tab forward', () => {
  assert.ok(lib.includes('window.focus()'))
  assert.ok(
    centre.includes('raise(m, toneOf(m), () => setInboxOpen(true), { uid, usersById: byId })'),
    'and opens what was clicked, knowing who everyone is'
  )
})

test('the icon is drawn from the same place the app draws avatars', () => {
  // Two ideas of what Ravi looks like is one of them being wrong.
  assert.ok(lib.includes("import { avatarSpec } from './avatar.js'"))
  assert.ok(lib.includes('avatarSpec(name, person)'))
})

test('a browser with no canvas gets a plain notification, not a broken one', () => {
  assert.ok(lib.includes("if (typeof document === 'undefined') return undefined"))
  assert.ok(lib.includes('if (!ctx) return undefined'))
})

test('the badge cannot 404 after a deploy', () => {
  assert.ok(BADGE.startsWith('data:'))
})

test('nothing is raised without permission, checked at the moment', () => {
  // Permission can be revoked in browser settings while the tab is open.
  assert.ok(lib.includes("if (permissionState() !== 'granted') return null"))
})

test('the tab title is put back when the centre goes', () => {
  assert.ok(centre.includes('document.title = titleWithBadge(unread)'))
  assert.ok(centre.includes('document.title = titleWithBadge(0)'))
})
