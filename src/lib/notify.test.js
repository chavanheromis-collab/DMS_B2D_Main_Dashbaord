import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  BASE_TITLE,
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
  const { title, options } = notificationFor(msg({ fromName: 'Ravi' }), toneOf(msg()))
  assert.equal(title, 'Ravi')
  assert.equal(options.body, 'Nashik figures are wrong')
})

test('an unnamed sender still has a title', () => {
  assert.equal(notificationFor(msg({ fromName: '' }), toneOf(msg())).title, 'New message')
  assert.equal(notificationFor(null, null).title, 'New message')
})

test('the same message replacing itself is one notification, not four', () => {
  assert.equal(notificationFor(msg(), toneOf(msg())).options.tag, 'm1')
  assert.equal(notificationFor(msg(), toneOf(msg())).options.renotify, false)
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

test('the offer appears only when it can still be granted', () => {
  assert.equal(shouldOfferNotifications('default', true), true)
  assert.equal(shouldOfferNotifications('granted', true), false)
  assert.equal(shouldOfferNotifications('unsupported', true), false)
})

test('a denied prompt is never offered again', () => {
  // The browser will not re-prompt, so a button that appears to ask and
  // silently does nothing is worse than no button.
  assert.equal(shouldOfferNotifications('denied', true), false)
})

test('and never before there is a reason for it', () => {
  // Asking somebody who has never received a message is asking them to
  // trust a promise about a thing they have not seen.
  assert.equal(shouldOfferNotifications('default', false), false)
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
  assert.ok(centre.includes('onClick={async () => setPermission(await askPermission())}'))
  assert.ok(!centre.includes('useEffect(() => { askPermission'))
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
  assert.ok(centre.includes('raise(m, toneOf(m), () => setInboxOpen(true))'), 'and opens what was clicked')
})

test('nothing is raised without permission, checked at the moment', () => {
  // Permission can be revoked in browser settings while the tab is open.
  assert.ok(lib.includes("if (permissionState() !== 'granted') return null"))
})

test('the tab title is put back when the centre goes', () => {
  assert.ok(centre.includes('document.title = titleWithBadge(unread)'))
  assert.ok(centre.includes('document.title = titleWithBadge(0)'))
})
