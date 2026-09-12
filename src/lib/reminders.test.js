import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  MAX_EVERY,
  MAX_REMINDERS,
  MAX_TEXT,
  SNOOZE_MINUTES,
  STALE_AFTER,
  alarmCount,
  alarmTextSize,
  answered,
  atFromInputs,
  clockText,
  completed,
  daysOf,
  draftProblem,
  ended,
  endsText,
  finished,
  firstOccurrence,
  historyText,
  inputsFor,
  isDue,
  isStale,
  missed,
  newReminder,
  nextOccurrence,
  nextUp,
  presets,
  pruneReminders,
  readReminders,
  reminderNotification,
  repeatText,
  repeats,
  replaceReminder,
  ringing,
  seriesEnded,
  snoozed,
  sortReminders,
  stepOnce,
  tomorrowAt,
  upcoming,
  whenText,
  withoutReminder,
} from './reminders.js'
import { tabTitle } from './notify.js'

// ---------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------
// An alarm has one job and two ways to fail it: not going off, and going
// off about something that stopped mattering three days ago. Nearly
// everything below is about those two.
//
// The other half is that it must not be mistakable for a message. That is
// a claim about the UI, so it is checked the way this project checks UI
// claims -- against the source of the two components, side by side.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const NOW = new Date('2026-09-11T15:00:00').getTime()
const MIN = 60 * 1000
const at = (mins) => NOW + mins * MIN

const some = (extra = {}) => ({ ...newReminder('Call Nashik', at(30), NOW), ...extra })

// --- the shape -----------------------------------------------------------

test('a reminder holds when it is for, as a number', () => {
  // Compared against the clock every few seconds. A string is a parse
  // each time, and Date.parse of a non-standard string is not the same
  // answer in every browser -- an alarm an hour out is worse than none.
  const r = newReminder('  Call Nashik  ', at(30), NOW)
  assert.equal(r.text, 'Call Nashik')
  assert.equal(typeof r.at, 'number')
  assert.equal(r.at, at(30))
  assert.equal(r.setFor, at(30))
  assert.equal(r.done, false)
  assert.equal(r.snoozes, 0)
  assert.ok(r.id)
})

test('two set in the same millisecond are still two', () => {
  assert.notEqual(newReminder('a', at(1), NOW).id, newReminder('a', at(1), NOW).id)
})

test('a stored list is repaired rather than thrown away', () => {
  // Somebody's reminder. Losing it over a missing field is worse than
  // showing it oddly.
  const list = readReminders([
    { id: 'r1', text: 'Call', at: '123' },
    { id: 'r2', text: 'No time' },
    { id: '', text: 'No id' },
    { id: 'r3', text: '   ' },
    null,
    'nonsense',
  ])
  assert.deepEqual(
    list.map((r) => r.id),
    ['r1', 'r2']
  )
  assert.equal(list[0].at, 123)
  assert.equal(list[1].at, 0)
  // A missing `setFor` falls back to when it is for, so the alarm can
  // still say what it was originally set for.
  assert.equal(list[0].setFor, 123)
  assert.deepEqual(readReminders(null), [])
  assert.deepEqual(readReminders('nope'), [])
})

test('text is cut to a length a note to self can be', () => {
  const long = 'x'.repeat(MAX_TEXT + 50)
  assert.equal(newReminder(long, at(1), NOW).text.length, MAX_TEXT)
  assert.equal(readReminders([{ id: 'r1', text: long }])[0].text.length, MAX_TEXT)
})

// --- when one goes off ---------------------------------------------------

test('due is a time that has come, and not one already answered', () => {
  assert.equal(isDue(some({ at: at(-1) }), NOW), true)
  assert.equal(isDue(some({ at: at(1) }), NOW), false)
  assert.equal(isDue(some({ at: at(-1), done: true }), NOW), false)
  assert.equal(isDue(null, NOW), false)
})

test('one due while the laptop was shut still goes off when it opens', () => {
  // An alarm that silently expires because nobody was watching is the one
  // thing it must never do.
  const r = some({ at: at(-90) })
  assert.equal(isDue(r, NOW), true)
  assert.equal(isStale(r, NOW), false)
  assert.equal(ringing([r], NOW)?.id, r.id)
})

test('...but one from last week does not ambush anybody', () => {
  // Coming back from a week off to a full-screen takeover about Tuesday's
  // phone call is an ambush, and the answer is always "well, that's gone".
  const old = some({ at: NOW - STALE_AFTER - MIN })
  assert.equal(isDue(old, NOW), true)
  assert.equal(isStale(old, NOW), true)
  assert.equal(ringing([old], NOW), null)
  // Still there to see, marked as missed.
  assert.deepEqual(missed([old], NOW).map((r) => r.id), [old.id])
})

test('one at a time, oldest first, and the rest wait their turn', () => {
  // Three takeovers at once means the third is dismissed by the momentum
  // of dismissing the first.
  const a = some({ id: 'a', at: at(-30) })
  const b = some({ id: 'b', at: at(-10) })
  const c = some({ id: 'c', at: at(5) })
  assert.equal(ringing([c, b, a], NOW).id, 'a')
  assert.equal(alarmCount([c, b, a], NOW), 2)
  assert.equal(alarmCount([c], NOW), 0)
  assert.equal(ringing([], NOW), null)
  assert.equal(ringing(null, NOW), null)
})

test('the lists are the three states, and nothing is in two of them', () => {
  const soon = some({ id: 'soon', at: at(20) })
  const late = some({ id: 'late', at: NOW - STALE_AFTER - MIN })
  const ticked = some({ id: 'done', at: at(-5), done: true, doneAt: at(-4) })
  const all = [soon, late, ticked]

  assert.deepEqual(upcoming(all, NOW).map((r) => r.id), ['soon'])
  assert.deepEqual(missed(all, NOW).map((r) => r.id), ['late'])
  assert.deepEqual(finished(all).map((r) => r.id), ['done'])
  assert.equal(nextUp(all, NOW).id, 'soon')
  assert.equal(nextUp([late, ticked], NOW), null)
})

test('the soonest is first, and what is finished sinks', () => {
  const list = [
    some({ id: 'later', at: at(60) }),
    some({ id: 'done-old', done: true, doneAt: at(-50) }),
    some({ id: 'sooner', at: at(5) }),
    some({ id: 'done-new', done: true, doneAt: at(-1) }),
  ]
  assert.deepEqual(
    sortReminders(list).map((r) => r.id),
    ['sooner', 'later', 'done-new', 'done-old']
  )
})

// --- acting on one -------------------------------------------------------

test('a snooze moves the one field that decides whether it is due', () => {
  // Two fields -- "at" and "snoozed until" -- is two answers to one
  // question, and they can disagree.
  const r = some({ at: at(-5) })
  const later = snoozed(r, 10, NOW)
  assert.equal(later.at, at(10))
  assert.equal(isDue(later, NOW), false)
  assert.equal(later.snoozes, 1)
  // ...and it still knows what it was for, at the fourth snooze.
  assert.equal(later.setFor, r.setFor)
  assert.equal(snoozed(later, 10, NOW).snoozes, 2)
  // A nonsense number is a minute, not an instant re-fire.
  assert.equal(snoozed(r, 0, NOW).at, NOW + MIN)
})

test('done is done, and dated', () => {
  const r = completed(some(), NOW)
  assert.equal(r.done, true)
  assert.equal(r.doneAt, NOW)
  assert.equal(isDue({ ...r, at: at(-1) }, NOW), false)
})

test('a change replaces one, by id, and leaves the others alone', () => {
  const a = some({ id: 'a' })
  const b = some({ id: 'b' })
  const next = replaceReminder([a, b], completed(b, NOW))
  assert.equal(next[0], a)
  assert.equal(next[1].done, true)
  assert.deepEqual(withoutReminder([a, b], 'a').map((r) => r.id), ['b'])
})

// --- keeping the document small -----------------------------------------

test('finished ones are kept for a day, then let go', () => {
  // Long enough to answer "did I already do that?" at four o'clock, short
  // enough that the one document they all live in does not fill up.
  const day = 24 * 60 * MIN
  const fresh = some({ id: 'fresh', done: true, doneAt: NOW - 60 * MIN })
  const old = some({ id: 'old', done: true, doneAt: NOW - day - MIN })
  const live = some({ id: 'live', at: at(10) })
  assert.deepEqual(
    pruneReminders([fresh, old, live], NOW).map((r) => r.id),
    ['live', 'fresh']
  )
})

test('and there is a ceiling, because they share one document', () => {
  const many = Array.from({ length: MAX_REMINDERS + 10 }, (_, i) =>
    some({ id: `r${i}`, at: at(i + 1) })
  )
  const kept = pruneReminders(many, NOW)
  assert.equal(kept.length, MAX_REMINDERS)
  // The soonest survive: what is next is what matters.
  assert.equal(kept[0].id, 'r0')
})

// --- setting one ---------------------------------------------------------

test('the quick answers are what a reminder usually is', () => {
  const chips = presets(NOW)
  assert.deepEqual(chips.map((c) => c.key), ['10m', '30m', '1h', '3h', 'tomorrow'])
  assert.equal(chips[0].at, at(10))
  assert.equal(chips[2].at, at(60))
  // Nine tomorrow, in the reader's own timezone rather than UTC.
  const nine = new Date(tomorrowAt(9, 0, NOW))
  assert.equal(nine.getHours(), 9)
  assert.equal(nine.getMinutes(), 0)
  assert.equal(nine.getDate(), new Date(NOW).getDate() + 1)
})

test('a date box and a time box make one local instant', () => {
  // Parsing "2026-09-11T15:40" as a string is UTC in some engines and
  // local in others -- five and a half hours out for exactly the people
  // this dashboard is for.
  const ms = atFromInputs('2026-09-11', '15:40')
  const d = new Date(ms)
  assert.equal(d.getFullYear(), 2026)
  assert.equal(d.getMonth(), 8)
  assert.equal(d.getDate(), 11)
  assert.equal(d.getHours(), 15)
  assert.equal(d.getMinutes(), 40)
  assert.equal(atFromInputs('', '15:40'), 0)
  assert.equal(atFromInputs('2026-09-11', ''), 0)
  assert.equal(atFromInputs('nonsense', 'nonsense'), 0)
})

test('...and back again, to fill the boxes in', () => {
  const boxes = inputsFor(atFromInputs('2026-09-11', '07:05'))
  assert.deepEqual(boxes, { date: '2026-09-11', time: '07:05' })
})

test('a time that has gone is refused, not fired immediately', () => {
  // Somebody typing 3:40 at half past four meant tomorrow, or mistyped,
  // and neither is served by the screen going amber as they press it.
  assert.equal(draftProblem({ text: 'Call', at: at(-1) }, NOW), 'That time has already gone')
  assert.equal(draftProblem({ text: '', at: at(10) }, NOW), 'Say what the reminder is')
  assert.equal(draftProblem({ text: 'Call', at: 0 }, NOW), 'Pick when')
  assert.match(draftProblem({ text: 'x'.repeat(MAX_TEXT + 3), at: at(10) }, NOW), /Too long by 3/)
  assert.match(draftProblem({ text: 'Call', at: at(10) }, NOW, MAX_REMINDERS), /finish some first/)
  assert.equal(draftProblem({ text: 'Call', at: at(10) }, NOW), '')
})

// --- saying when ---------------------------------------------------------

test('when it is for reads forwards, because that is what a reminder is', () => {
  // "12h ago" is right about a message that arrived and wrong about an
  // alarm going off, where the fact is "12 hours late".
  assert.equal(whenText(at(20), NOW), 'in 20 min')
  assert.equal(whenText(at(0), NOW), 'now')
  assert.equal(whenText(at(-20), NOW), '20 min late')
  assert.equal(whenText(at(-120), NOW), '2h late')
  assert.equal(whenText(at(-60 * 48), NOW), '2d late')
  assert.equal(whenText(0, NOW), '')
})

test('a time today is a clock, tomorrow says so, and further off is dated', () => {
  assert.match(whenText(at(180), NOW), /^at /)
  assert.match(whenText(tomorrowAt(9, 0, NOW), NOW), /^tomorrow at /)
  assert.match(whenText(NOW + 3 * 24 * 60 * MIN, NOW), / at /)
  // The clock face is the same one the alarm shows.
  assert.equal(clockText(at(40)), new Date(at(40)).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))
})

test('a snoozed alarm says what it was originally for', () => {
  // "You asked for this at 3, it is now 5" is what makes somebody deal
  // with it rather than push it again.
  const r = snoozed(snoozed(some({ at: at(-5) }), 10, NOW), 10, NOW + 10 * MIN)
  const said = historyText(r)
  assert.match(said, /^Set for /)
  assert.match(said, /snoozed twice/)
  assert.match(historyText(snoozed(some({ at: at(-5) }), 5, NOW)), /snoozed once/)
  // Never snoozed and never moved: nothing to say.
  assert.equal(historyText(some()), '')
  assert.equal(historyText(null), '')
})

// --- off the tab ---------------------------------------------------------

test('the notification cannot be mistaken for a message', () => {
  // A message's title is a PERSON. This one must not be, or a stack of
  // six notifications is unreadable.
  const note = reminderNotification(some({ id: 'r9', text: 'Call Nashik' }), { badge: 'b' })
  assert.match(note.title, /Reminder/)
  assert.match(note.title, /⏰/)
  assert.equal(note.options.body, 'Call Nashik')
  assert.equal(note.options.tag, 'reminder:r9')
  // An alarm that fades after four seconds while somebody is in another
  // window is an alarm that did not happen.
  assert.equal(note.options.requireInteraction, true)
  assert.equal(note.options.silent, false)
  assert.ok(Array.isArray(note.options.vibrate))
  assert.equal(note.options.badge, 'b')
})

test('the tab title carries both, and neither erases the other', () => {
  // Two effects each assigning document.title means whichever rendered
  // last wins, at random.
  assert.match(tabTitle({ alarms: 1, unread: 3 }), /^⏰ \(3\) /)
  assert.match(tabTitle({ alarms: 2 }), /^⏰2 /)
  assert.match(tabTitle({ unread: 12 }), /^\(9\+\) /)
  assert.equal(tabTitle({}), tabTitle({ alarms: 0, unread: 0 }))
  // The clock goes first: it is the leftmost character that survives a
  // tab narrowed to nothing.
  assert.ok(tabTitle({ alarms: 1, unread: 1 }).indexOf('⏰') < tabTitle({ alarms: 1, unread: 1 }).indexOf('('))
})

// --- and it is not the messages -----------------------------------------

const centre = read('components/ReminderCenter.jsx')
const messages = read('components/MessageCenter.jsx')

test('the two live in different corners', () => {
  // Two round buttons in one place is a choice made in half a second, and
  // only if both are always where they were.
  assert.ok(messages.includes('fixed bottom-4 right-4'))
  assert.ok(centre.includes('fixed bottom-[4.25rem] right-4'))
})

test('the alarm takes the screen, where a message takes a card', () => {
  // The failure of a reminder is not being missed among other things --
  // it is being dismissed with the same flick as everything else.
  assert.ok(centre.includes('fixed inset-0 z-[10050]'))
  assert.ok(centre.includes('from-amber-400 via-orange-400 to-amber-500'))
  // No card, no backdrop to see the page through, no cross to close it.
  assert.equal(centre.includes('max-w-md rounded-2xl border border-slate-200 bg-white'), false)
  assert.ok(messages.includes('bg-slate-900/50 p-4 backdrop-blur-sm'))
})

test('the only ways out of an alarm are decisions', () => {
  // Done, or a snooze. Clicking the background is not an answer to an
  // alarm, and neither is a cross.
  assert.ok(centre.includes('onClick={onDone}'))
  assert.ok(centre.includes('onClick={() => onSnooze(mins)}'))
  // Escape answers, because an overlay with no keyboard exit is a trap --
  // and of the two real answers, five more minutes cannot lose it.
  assert.ok(centre.includes("if (e.key === 'Escape') onSnooze(SNOOZE_MINUTES[0])"))
  assert.equal(SNOOZE_MINUTES[0], 5)
})

test('it keeps moving until it is answered, and the messages do not', () => {
  // A message announces itself and sits still, because it can wait.
  const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')
  assert.match(css, /\.alarm-pulse \{ animation: alarmPulse 2s ease-in-out infinite; \}/)
  assert.ok(centre.includes('alarm-pulse'))
  // ...and somebody who asked for less movement gets none of it.
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.ok(reduced.includes('.alarm-pulse'))
})

test('the notification only fires when they are not here', () => {
  // On the tab the screen has just turned amber; a second alert about it
  // is noise.
  assert.ok(centre.includes('if (!alarm || visible || permissionState()'))
  // Recorded before raising: raiseNote can fail on a platform that wants
  // a service worker, and retrying every tick is a loop nobody can see.
  const at_ = centre.indexOf('notified.current.add(alarm.id)')
  assert.ok(at_ > 0 && at_ < centre.indexOf('raiseNote('))
})

test('the reminders are the user own, in the one place a user may write', () => {
  // No new collection and no new rule: the id starts with the uid, so
  // nobody else can read them.
  const hook = read('hooks/useReminders.js')
  assert.ok(hook.includes('`${uid}_reminders`'))
  assert.ok(hook.includes("doc(db, 'userPrefs', id)"))
  // Pruned on the way out, because there is no server here to do it.
  assert.ok(hook.includes('reminders: pruneReminders(next)'))
})

test('the clock ticks, and re-reads when the lid opens', () => {
  // A laptop that was shut does not run intervals, and the one that was
  // running may have drifted by hours.
  const hook = read('hooks/useReminders.js')
  assert.ok(hook.includes("document.addEventListener('visibilitychange', tick)"))
  assert.ok(hook.includes("window.addEventListener('focus', tick)"))
  assert.ok(hook.includes('useNow(everyMs = 15000)'))
})

test('it is mounted on the shell, so it goes off wherever you are', () => {
  const shell = read('components/AppShell.jsx')
  assert.ok(shell.includes('<ReminderCenter />'))
  assert.ok(shell.includes('<MessageCenter />'))
})

test('the panel does not promise what the browser has not granted', () => {
  // "It will reach you in another tab" is false until somebody says yes,
  // and finding that out at four o'clock is finding it out too late.
  assert.ok(centre.includes('<Reach state={reach} onGranted={onReach} />'))
  assert.ok(centre.includes("if (state === 'granted') return null"))
  assert.ok(centre.includes("state === 'denied' ? 'blocked for this site'"))
  // Blocked is not a dead end: the screen still takes over, and it says so.
  assert.ok(centre.includes('It will still be waiting when you come back.'))
})

test('there is one notification switch, asked for from a click', () => {
  // Two panels asking the same question in different words is how
  // somebody comes to believe they are two separate settings -- and
  // Safari and every browser on iOS refuse the prompt without a gesture.
  assert.ok(centre.includes('onClick={async () => onGranted?.(await askPermission())}'))
  assert.equal((centre.match(/askPermission\(\)/g) || []).length, 1)
})

test('granting it changes the panel, rather than the panel changing later', () => {
  // Permission is not something React watches: read at render, the panel
  // goes on saying "off" until something unrelated re-renders it.
  assert.ok(centre.includes('const [reach, setReach] = useState(() => permissionState())'))
  assert.ok(centre.includes('onReach={setReach}'))
})

// ---------------------------------------------------------------------
// Repeating
// ---------------------------------------------------------------------
// "Every day at nine" is the reminder somebody sets once and stops
// trusting on the fourth day. Two things break it, and both are here:
// a step that drifts off the wall clock, and a Done that quietly ends
// the series.

const every = (repeat, extra = {}) => ({ ...some({ at: at(-1) }), repeat, ...extra })
const day = (ms) => new Date(ms).toDateString()
const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5)

test('a one-off is still a one-off, and nothing else changed', () => {
  const r = newReminder('Call', at(30), NOW)
  assert.equal(r.repeat, 'none')
  assert.equal(repeats(r), false)
  assert.equal(nextOccurrence(r, NOW), 0)
  assert.equal(repeatText(r), '')
  // Done finishes it, as it always did.
  assert.equal(answered(r, NOW).done, true)
})

test('every rule steps by the calendar, keeping the time of day', () => {
  // "Every day at nine" means nine o'clock, not twenty-four hours later.
  // On the two mornings a year those differ, the person expects nine.
  const nine = new Date('2026-09-11T09:00:00').getTime()
  for (const rule of ['daily', 'weekly', 'weekdays', 'monthly', 'yearly', 'interval']) {
    const next = stepOnce(nine, { repeat: rule, every: 3, at: nine, anchor: nine })
    assert.ok(next > nine, rule)
    assert.equal(hhmm(next), '09:00', rule)
  }
  assert.equal(hhmm(stepOnce(nine, { repeat: 'hourly' })), '10:00')
})

test('Mon to Fri skips the weekend rather than counting days', () => {
  const friday = new Date('2026-09-11T09:00:00').getTime()
  assert.equal(new Date(friday).getDay(), 5)
  const next = stepOnce(friday, { repeat: 'weekdays' })
  assert.equal(new Date(next).getDay(), 1, 'landed on a weekend')
  assert.equal(day(next), 'Mon Sep 14 2026')
})

test('a weekly rule walks to its next chosen day, not seven ahead', () => {
  // Two days a week are two steps of unequal length. Adding seven would
  // turn "Monday and Thursday" into Monday only.
  const monday = new Date('2026-09-14T09:00:00').getTime()
  const rule = { repeat: 'weekly', days: [1, 4] }
  const thursday = stepOnce(monday, rule)
  assert.equal(day(thursday), 'Thu Sep 17 2026')
  assert.equal(day(stepOnce(thursday, rule)), 'Mon Sep 21 2026')
  // Nothing chosen means the day it was set on.
  assert.deepEqual(daysOf({ at: monday }), [1])
  assert.deepEqual(daysOf({ at: monday, days: [4, 1, 4] }), [1, 4])
})

test('the 31st of every month survives February', () => {
  // setMonth on the 31st of January is the 3rd of March in every engine
  // there is -- and clamping without an anchor moves the series for good.
  const jan31 = new Date('2026-01-31T09:00:00').getTime()
  const rule = { repeat: 'monthly', anchor: jan31 }
  const seen = []
  let cursor = jan31
  for (let i = 0; i < 4; i += 1) {
    cursor = stepOnce(cursor, rule)
    seen.push(day(cursor))
  }
  assert.deepEqual(seen, ['Sat Feb 28 2026', 'Tue Mar 31 2026', 'Thu Apr 30 2026', 'Sun May 31 2026'])
})

test('...and the 29th of February comes back in the leap year', () => {
  const leap = new Date('2028-02-29T09:00:00').getTime()
  const rule = { repeat: 'yearly', anchor: leap }
  let cursor = leap
  const seen = []
  for (let i = 0; i < 4; i += 1) {
    cursor = stepOnce(cursor, rule)
    seen.push(day(cursor))
  }
  assert.deepEqual(seen, ['Wed Feb 28 2029', 'Thu Feb 28 2030', 'Fri Feb 28 2031', 'Sun Feb 29 2032'])
})

test('a series missed for three days owes one alarm, not three', () => {
  // It is not three alarms in the bank. It is one, due next.
  const threeDaysAgo = { ...every('daily'), at: NOW - 3 * 24 * 60 * MIN }
  const next = nextOccurrence(threeDaysAgo, NOW)
  assert.ok(next > NOW)
  assert.ok(next - NOW <= 24 * 60 * MIN)
})

test('a document that cannot step does not hang the tab', () => {
  // `every: 0`, a rule this version has never heard of, a time in 1970.
  // Nonsense days fall back to the weekday it was set on, which is
  // what an empty list means too -- a corrupt field must not silently
  // stop a routine.
  assert.ok(nextOccurrence({ repeat: 'weekly', at: NOW, days: [9] }, NOW) > NOW)
  assert.equal(nextOccurrence({ repeat: 'nonsense', at: NOW }, NOW), 0)
  assert.equal(nextOccurrence({ repeat: 'daily', at: 0 }, NOW), 0)
  assert.equal(stepOnce(NOW, { repeat: 'none' }), 0)
  // An interval of zero is a day, not an infinite loop.
  assert.ok(nextOccurrence({ repeat: 'interval', every: 0, at: NOW - MIN }, NOW) > NOW)
})

// --- Done means something different -------------------------------------

test('Done on a series moves it on, and never quietly ends it', () => {
  // The bug this exists to prevent is somebody losing a daily routine and
  // finding out a week later.
  const daily = every('daily')
  const next = answered(daily, NOW)
  assert.equal(next.done, false)
  assert.ok(next.at > NOW)
  assert.equal(next.fired, 1)
  // Each occurrence is its own alarm: tomorrow's does not arrive saying
  // it was snoozed four times yesterday.
  assert.equal(next.snoozes, 0)
  assert.equal(next.setFor, next.at)
})

test('...until the series runs out, which is the one case they meet', () => {
  const last = { ...every('daily'), times: 2, fired: 1 }
  const after = answered(last, NOW)
  assert.equal(after.done, true)
  assert.equal(after.fired, 2)
  // An end date does the same.
  const expired = { ...every('daily'), until: NOW - MIN }
  assert.equal(answered(expired, NOW).done, true)
})

test('and there is a way to stop one without deleting it', () => {
  // "Yes, and never again" is a different answer from "yes, see you
  // tomorrow", and making somebody open a panel to give it is how a
  // daily reminder survives the day it stopped being wanted.
  const stopped = ended(every('daily'), NOW)
  assert.equal(stopped.done, true)
  assert.equal(repeats(stopped), false)
  assert.equal(stopped.text, 'Call Nashik')
})

test('a series that has ended is reported as ended', () => {
  assert.equal(seriesEnded(every('daily'), NOW), false)
  assert.equal(seriesEnded({ ...every('daily'), times: 3, fired: 2 }, NOW), true)
  assert.equal(seriesEnded({ ...every('daily'), until: NOW - MIN }, NOW), true)
  assert.equal(seriesEnded(some(), NOW), true, 'a one-off has no series to end')
})

// --- setting one ---------------------------------------------------------

test('a repeat whose first time has gone rolls forward instead of refusing', () => {
  // Choosing "every day at nine" at ten past nine means tomorrow. A
  // one-off in the past is a mistake; a series in the past is a series.
  const draft = { text: 'Stock sheet', at: at(-10), repeat: 'daily' }
  assert.equal(draftProblem(draft, NOW), '')
  const first = firstOccurrence(draft, NOW)
  assert.ok(first > NOW)
  assert.equal(hhmm(first), hhmm(at(-10)))
  // ...and a one-off still is not allowed to.
  assert.equal(draftProblem({ text: 'x', at: at(-10) }, NOW), 'That time has already gone')
})

test('the rule reads back in words, with the time in it', () => {
  // "Every day" is half a reminder, and the missing half is the half
  // somebody is checking.
  const nine = new Date('2026-09-14T09:00:00').getTime()
  assert.match(repeatText({ repeat: 'daily', at: nine }), /^Every day at /)
  assert.match(repeatText({ repeat: 'weekdays', at: nine }), /^Mon to Fri at /)
  assert.match(repeatText({ repeat: 'weekly', at: nine, days: [1, 4] }), /^Every Mon, Thu at /)
  assert.match(repeatText({ repeat: 'monthly', at: nine }), /^Every month on the 14th at /)
  assert.match(repeatText({ repeat: 'yearly', at: nine }), /^Every year on /)
  assert.match(repeatText({ repeat: 'interval', every: 3, at: nine }), /^Every 3 days at /)
  assert.equal(repeatText({ repeat: 'hourly', at: nine }), 'Every hour')
  assert.equal(repeatText({ repeat: 'none', at: nine }), '')
  // The ordinal is the English one, including the teens nobody tests.
  assert.match(repeatText({ repeat: 'monthly', at: new Date('2026-09-11T09:00:00').getTime() }), /the 11th/)
  assert.match(repeatText({ repeat: 'monthly', at: new Date('2026-09-01T09:00:00').getTime() }), /the 1st/)
  assert.match(repeatText({ repeat: 'monthly', at: new Date('2026-09-22T09:00:00').getTime() }), /the 22nd/)
  assert.match(repeatText({ repeat: 'monthly', at: new Date('2026-09-23T09:00:00').getTime() }), /the 23rd/)
})

test('and says where it stops, when it does', () => {
  assert.equal(endsText({ times: 5, fired: 2 }), '3 more times')
  assert.equal(endsText({ times: 5, fired: 4 }), '1 more time')
  assert.match(endsText({ until: new Date('2026-10-14T09:00:00').getTime() }), /^until /)
  assert.equal(endsText({}), '')
  assert.match(repeatText({ repeat: 'daily', at: NOW, times: 3 }), / · 3 more times$/)
})

test('an unrecognised rule is a one-off, not a schedule nobody can see', () => {
  const stored = readReminders([{ id: 'r1', text: 'x', at: NOW, repeat: 'fortnightly' }])
  assert.equal(stored[0].repeat, 'none')
  // ...and the fields it does understand are clamped on the way in.
  const wild = readReminders([
    { id: 'r2', text: 'x', at: NOW, repeat: 'weekly', days: [1, 9, -2, 4], every: 9999, times: -3 },
  ])[0]
  assert.deepEqual(wild.days, [1, 4])
  assert.equal(wild.every, MAX_EVERY)
  assert.equal(wild.times, 0)
})

// --- the message is the point -------------------------------------------

test('the reminder itself is sized by how much of it there is', () => {
  // One size cannot serve "hello" and two hundred characters: the short
  // one looks timid in type meant for the long one, and the long one
  // overflows in type meant for the short.
  const short = alarmTextSize('hello')
  const long = alarmTextSize('x'.repeat(150))
  assert.ok(short.base > long.base)
  assert.ok(short.wide > long.wide)
  assert.ok(alarmTextSize('').base > 0)
  // Every size is bigger on a wide screen than on a narrow one.
  for (const n of [5, 30, 60, 200]) {
    const size = alarmTextSize('x'.repeat(n))
    assert.ok(size.wide >= size.base, n)
  }
})

test('the alarm leads with the message, not with the clock', () => {
  // The reader can see the time in the corner of their own machine. What
  // they cannot see is what they wanted at this hour -- and "hello" in
  // small type under a vast 11:43 answers a question nobody asked.
  const alarm = centre.slice(centre.indexOf('function Alarm('), centre.indexOf('function Panel('))
  const message = alarm.indexOf('{reminder.text}')
  const clock = alarm.indexOf('{clockText(reminder.setFor || reminder.at)}')
  assert.ok(message > 0 && clock > 0)
  assert.ok(message < clock, 'the clock is still above the message')
  // The message is the thing that scales; the clock is a chip.
  assert.ok(alarm.includes('style={{ fontSize: `clamp('))
  assert.ok(alarm.includes('rounded-full bg-white/20 px-2.5 py-0.5 tabular-nums'))
  // The icon no longer competes with it.
  assert.ok(alarm.includes('<AlarmClock size={24}'))
})

test('the alarm says what Done will do to a series', () => {
  const alarm = centre.slice(centre.indexOf('function Alarm('), centre.indexOf('function Panel('))
  assert.ok(alarm.includes('{again ? `Done · again ${whenText(again, now)}` : \'Done\'}'))
  assert.ok(alarm.includes('Stop repeating'))
  assert.ok(alarm.includes('{rule}'))
})

test('the panel offers every rule, and the days that go with one', () => {
  assert.ok(centre.includes('{REPEATS.map((r) => ('))
  assert.ok(centre.includes('{WEEKDAYS.map((d) => {'))
  assert.ok(centre.includes("repeat === 'weekly' && ("))
  assert.ok(centre.includes("repeat === 'interval' && ("))
  // Where it ends is folded away, because "never" is the honest default
  // and a form that asks four questions to set one alarm is used once.
  assert.ok(centre.includes("setEnds('never')"))
  assert.ok(centre.includes('{repeat !== \'none\' && more && ('))
})

test('what will happen is said before the button is pressed', () => {
  assert.ok(centre.includes('const starts = firstOccurrence(draft, now) || at'))
  assert.ok(centre.includes('repeatText({ ...rule, at: starts })'))
})

test('a routine is visible in the list, not only when it goes off', () => {
  assert.ok(centre.includes('<Repeat size={8} /> {repeatText(r)}'))
  assert.ok(centre.includes('aria-label={`Stop repeating "${r.text}"`}'))
})

test('Done goes through the model, which decides which Done it is', () => {
  const hook = read('hooks/useReminders.js')
  assert.ok(hook.includes('answered(reminder)'))
  assert.ok(hook.includes('ended(reminder)'))
  // ...and a repeat that starts in the past rolls forward on the way in.
  assert.ok(hook.includes('firstOccurrence({ at, ...options }, Date.now()) || at'))
})
