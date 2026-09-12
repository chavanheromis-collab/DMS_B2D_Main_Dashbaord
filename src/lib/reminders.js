// ---------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------
// "Call the Nashik dealer back at four." Things that are not about the
// data on the screen and not for anybody else -- they are for you, later,
// and the dashboard happens to be what you are looking at all day.
//
// Deliberately NOT a message to yourself, even though the plumbing would
// have allowed it. A message is a conversation: it comes from somebody, it
// can be replied to, it can be unsent, and it is read once and finished
// with. A reminder has no sender, cannot be answered, and is not finished
// with when you have seen it -- it is finished when the thing is done, or
// when you have pushed it ten minutes down the road for the third time.
// Sharing one inbox for the two would mean every message surface growing
// an "except when it is a reminder" branch, and a person glancing at the
// corner of the screen being unable to tell whether somebody needs them or
// their own past self does.
//
// So it looks nothing like the messages. Different corner, different
// colour, different icon, and when one comes due it takes the WHOLE screen
// rather than sitting in a card -- because the failure mode of a reminder
// is not being missed among other things, it is being dismissed with the
// same flick as everything else.
//
// Where they live: `userPrefs/{uid}_reminders`, the one collection an
// ordinary user may write to, under the rule that already exists (see
// firestore.rules -- its comment even says "leave themselves a reminder on
// it"). No new collection, no new rule, and personal by construction: the
// id starts with the uid, so nobody else can read them.

/** The longest a reminder can be. It is a note to self, not a document. */
export const MAX_TEXT = 200

/**
 * How many one person may keep.
 *
 * They all live in ONE document, so this is a real limit rather than a
 * policy: a Firestore document is capped at a megabyte, and a list that
 * grows for ever eventually stops saving with an error nobody can act on.
 * Fifty outstanding reminders is already somebody using this as a task
 * list, which it is not.
 */
export const MAX_REMINDERS = 50

/**
 * How late is too late to take the screen.
 *
 * A reminder due at three that the browser was closed for must still fire
 * when the laptop opens at half past four -- an alarm that silently
 * expires because nobody was watching is the one thing it must never do.
 *
 * But not for ever. Coming back from a week off to a full-screen takeover
 * about Tuesday's phone call is an ambush, and the answer to it is always
 * "well, that is gone now". Past this it is still in the list, still
 * marked as missed, and no longer allowed to interrupt.
 */
export const STALE_AFTER = 12 * 60 * 60 * 1000

/** What "later" means, in minutes, on the alarm itself. */
export const SNOOZE_MINUTES = [5, 10, 30, 60]

const MINUTE = 60 * 1000

// ---------------------------------------------------------------------
// Repeating
// ---------------------------------------------------------------------
// "Every day at nine" is not a reminder you set once. It is the one you
// set three hundred times, or -- what actually happens -- set once, miss
// on the fourth day, and stop trusting.
//
// Deliberately NOT an RRULE engine. The whole iCalendar grammar is a
// fortnight of work and a class of bugs nobody can reason about ("the
// last weekday of every other month"), for cases a dashboard does not
// have. What is here is the set somebody actually asks for, and each one
// is one function that can be read in ten seconds.
//
// Two rules run through all of it:
//
//   THE WALL CLOCK WINS. "Every day at nine" means nine o'clock, not
//   "twenty-four hours later" -- and on the two mornings a year those
//   differ, the person expects nine. So the steps move the DATE and leave
//   the time alone, rather than adding milliseconds.
//
//   A MISSED SERIES CATCHES UP, ONCE. A daily reminder nobody answered
//   for three days is not three alarms owed; it is one alarm, due next.
//   The step runs forward until it is in the future rather than firing
//   for every occurrence in between.

export const REPEATS = [
  { value: 'none', label: 'Once', short: '' },
  { value: 'hourly', label: 'Every hour', short: 'hourly' },
  { value: 'daily', label: 'Every day', short: 'daily' },
  { value: 'weekdays', label: 'Mon to Fri', short: 'Mon–Fri' },
  { value: 'weekly', label: 'Every week', short: 'weekly' },
  { value: 'monthly', label: 'Every month', short: 'monthly' },
  { value: 'yearly', label: 'Every year', short: 'yearly' },
  { value: 'interval', label: 'Every N days', short: '' },
]

export const REPEAT_VALUES = REPEATS.map((r) => r.value)

/** Sunday first, the way a calendar is drawn. */
export const WEEKDAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
]

/** How many days apart "every N days" may be. */
export const MAX_EVERY = 365

/** The rule on a reminder, or 'none' for anything unrecognised. */
export function repeatOf(reminder) {
  const value = String(reminder?.repeat || 'none')
  return REPEAT_VALUES.includes(value) ? value : 'none'
}

export const repeats = (reminder) => repeatOf(reminder) !== 'none'

/** The days a weekly rule fires on: what was chosen, else the day it was set. */
export function daysOf(reminder) {
  const chosen = (reminder?.days || []).map(Number).filter((d) => d >= 0 && d <= 6)
  if (chosen.length > 0) return [...new Set(chosen)].sort((a, b) => a - b)
  const at = Number(reminder?.at) || 0
  return at ? [new Date(at).getDay()] : []
}

const WEEKDAY_SET = [1, 2, 3, 4, 5]

/**
 * One step forward, keeping the time of day.
 *
 * Date setters rather than arithmetic on milliseconds: adding 24 hours
 * across the end of March gives ten o'clock, and the person who asked for
 * nine is not interested in why.
 *
 * Month is the one that bites. `setMonth` on the 31st overflows -- the
 * 31st of January plus a month is the 3rd of March in every JavaScript
 * engine there is -- so the day is clamped to what the target month
 * actually has. "The 31st of every month" means the 28th in February,
 * which is what a person means and what a spreadsheet does.
 */
export function stepOnce(at, reminder) {
  const rule = repeatOf(reminder)
  const d = new Date(at)

  switch (rule) {
    case 'hourly':
      d.setHours(d.getHours() + 1)
      return d.getTime()
    case 'daily':
      d.setDate(d.getDate() + 1)
      return d.getTime()
    case 'weekdays':
      do {
        d.setDate(d.getDate() + 1)
      } while (!WEEKDAY_SET.includes(d.getDay()))
      return d.getTime()
    case 'weekly': {
      const days = daysOf(reminder)
      if (days.length === 0) return 0
      // The next chosen weekday after this one, wrapping into next week.
      // Two days a week means two steps of unequal length, which is why
      // this walks rather than adding seven.
      for (let i = 1; i <= 7; i += 1) {
        const next = new Date(d)
        next.setDate(next.getDate() + i)
        if (days.includes(next.getDay())) return next.getTime()
      }
      return 0
    }
    case 'monthly': {
      // The day comes from where the series STARTED, not from where it
      // last landed. February clamps the 31st to the 28th; if March then
      // stepped from the 28th, one short month would silently move a
      // monthly reminder for good.
      const day = anchorDate(reminder, d).getDate()
      d.setDate(1)
      d.setMonth(d.getMonth() + 1)
      d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())))
      return d.getTime()
    }
    case 'yearly': {
      const start = anchorDate(reminder, d)
      const day = start.getDate()
      const month = start.getMonth()
      d.setDate(1)
      d.setFullYear(d.getFullYear() + 1)
      d.setMonth(month)
      // The 29th of February, every year, is the 28th in the three years
      // out of four that do not have one -- and the 29th again in the
      // fourth, because the anchor never moved.
      d.setDate(Math.min(day, daysInMonth(d.getFullYear(), month)))
      return d.getTime()
    }
    case 'interval': {
      const every = Math.min(MAX_EVERY, Math.max(1, Number(reminder?.every) || 1))
      d.setDate(d.getDate() + every)
      return d.getTime()
    }
    default:
      return 0
  }
}

const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate()

/** Where the series started, falling back to where it is now. */
function anchorDate(reminder, fallback) {
  const anchor = Number(reminder?.anchor) || 0
  return anchor ? new Date(anchor) : fallback
}

/**
 * The next time this fires after `from`, or 0 if the series is over.
 *
 * The guard is not defensiveness about the rules above -- it is about the
 * stored document, which can say `every: 0` or hold a time in 1970 after
 * somebody edited it by hand. A loop that cannot end is the one bug that
 * takes the whole tab with it.
 */
export function nextOccurrence(reminder, from = Date.now()) {
  if (!repeats(reminder)) return 0
  let at = Number(reminder?.at) || 0
  if (!at) return 0

  let guard = 0
  while (at <= from) {
    const next = stepOnce(at, reminder)
    if (!next || next <= at || (guard += 1) > 2000) return 0
    at = next
  }
  // An end date stops the series rather than the occurrence: past it,
  // there is no next one at all.
  const until = Number(reminder?.until) || 0
  if (until && at > until) return 0
  return at
}

/** Has this series run out of occurrences? */
export function seriesEnded(reminder, now = Date.now()) {
  if (!repeats(reminder)) return true
  const times = Number(reminder?.times) || 0
  if (times > 0 && (reminder?.fired || 0) + 1 >= times) return true
  return nextOccurrence(reminder, now) === 0
}

// ---------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------

/**
 * One reminder.
 *
 * `at` is epoch MILLISECONDS rather than the ISO string a message uses,
 * and the difference is not tidiness. This is compared against the clock
 * every few seconds for as long as the tab is open; a number is one
 * comparison, a string is a parse, and `Date.parse` of a non-standard
 * string is famously not the same answer in every browser. A reminder
 * that fires an hour out on one machine is worse than no reminder.
 */
export function newReminder(text, at, now = Date.now(), options = {}) {
  return {
    id: `r${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    text: String(text || '').trim().slice(0, MAX_TEXT),
    at: Number(at) || 0,
    createdAt: now,
    // What it was originally set for, kept through every snooze: "you
    // asked for this at 3, it is now 5" is the information that makes
    // somebody actually deal with it.
    setFor: Number(at) || 0,
    snoozes: 0,
    done: false,
    doneAt: 0,
    // How it repeats, and when it stops. All four are inert at their
    // defaults, so a one-off reminder is exactly what it always was.
    // Where the series started, and the only thing that never moves.
    // "The 31st of every month" has to survive February, and it can only
    // do that if February is not allowed to redefine what day it is on.
    anchor: Number(at) || 0,
    repeat: String(options.repeat || 'none'),
    days: Array.isArray(options.days) ? options.days : [],
    every: Number(options.every) || 1,
    until: Number(options.until) || 0,
    times: Number(options.times) || 0,
    fired: 0,
  }
}

/**
 * A stored list, repaired on the way in.
 *
 * The same treatment sticky notes get, and for the same reason: this is
 * somebody's reminder, and throwing it away over a missing field or a
 * string where a number should be is worse than showing it oddly. Anything
 * without an id or text is not a reminder at all and goes.
 */
export function readReminders(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const text = String(raw.text || '').trim().slice(0, MAX_TEXT)
    const id = String(raw.id || '')
    if (!id || !text) continue
    const at = Number(raw.at)
    out.push({
      id,
      text,
      at: Number.isFinite(at) ? at : 0,
      createdAt: Number(raw.createdAt) || 0,
      setFor: Number(raw.setFor) || (Number.isFinite(at) ? at : 0),
      snoozes: Math.max(0, Number(raw.snoozes) || 0),
      done: Boolean(raw.done),
      doneAt: Number(raw.doneAt) || 0,
      // Unrecognised is 'none': a rule this version has never heard of
      // must leave the reminder as a one-off rather than as something
      // that fires on a schedule nobody can see.
      anchor: Number(raw.anchor) || Number(raw.setFor) || (Number.isFinite(at) ? at : 0),
      repeat: REPEAT_VALUES.includes(String(raw.repeat)) ? String(raw.repeat) : 'none',
      days: Array.isArray(raw.days) ? raw.days.map(Number).filter((d) => d >= 0 && d <= 6) : [],
      every: Math.min(MAX_EVERY, Math.max(1, Number(raw.every) || 1)),
      until: Number(raw.until) || 0,
      times: Math.max(0, Number(raw.times) || 0),
      fired: Math.max(0, Number(raw.fired) || 0),
    })
  }
  return out
}

/** Soonest first. Done ones sink, most recently finished at the top of them. */
export function sortReminders(list) {
  return [...(list || [])].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    if (a.done) return (b.doneAt || 0) - (a.doneAt || 0)
    return (a.at || 0) - (b.at || 0)
  })
}

// ---------------------------------------------------------------------
// When one goes off
// ---------------------------------------------------------------------

export const isDue = (reminder, now = Date.now()) =>
  Boolean(reminder) && !reminder.done && (reminder.at || 0) <= now

/** Due, but so long ago that interrupting would be an ambush. */
export const isStale = (reminder, now = Date.now(), after = STALE_AFTER) =>
  isDue(reminder, now) && now - (reminder.at || 0) > after

/**
 * The one to ring, or null.
 *
 * ONE, not all of them. Three reminders that came due while the laptop was
 * shut are three separate things to deal with, and stacking three
 * full-screen takeovers means the third is dismissed by the momentum of
 * dismissing the first. The oldest goes first, the others wait their turn
 * -- and the alarm says how many are behind it, so nobody is surprised.
 */
export function ringing(list, now = Date.now()) {
  const due = (list || []).filter((r) => isDue(r, now) && !isStale(r, now))
  if (due.length === 0) return null
  return due.reduce((first, r) => ((r.at || 0) < (first.at || 0) ? r : first))
}

/** How many are waiting behind the one on screen. */
export function alarmCount(list, now = Date.now()) {
  return (list || []).filter((r) => isDue(r, now) && !isStale(r, now)).length
}

/** Still to come, soonest first. */
export function upcoming(list, now = Date.now()) {
  return sortReminders((list || []).filter((r) => !r.done && (r.at || 0) > now))
}

/**
 * Came and went without being dealt with.
 *
 * Shown in the panel rather than thrown away: a reminder nobody answered
 * is exactly the one worth seeing when you next look.
 */
export function missed(list, now = Date.now(), after = STALE_AFTER) {
  return sortReminders((list || []).filter((r) => isStale(r, now, after)))
}

export function finished(list) {
  return sortReminders((list || []).filter((r) => r.done))
}

/** The next one due, for the button in the corner. */
export function nextUp(list, now = Date.now()) {
  return upcoming(list, now)[0] || null
}

// ---------------------------------------------------------------------
// Acting on one
// ---------------------------------------------------------------------

/**
 * Later. Counted, because the count is worth seeing.
 *
 * Snoozing moves `at` rather than storing a separate "snoozed until": one
 * field decides whether a reminder is due, which is the only way the
 * answer cannot disagree with itself. `setFor` keeps the original, so the
 * alarm can say what it was for even at the fourth snooze.
 */
export function snoozed(reminder, minutes, now = Date.now()) {
  const by = Math.max(1, Number(minutes) || 0)
  return { ...reminder, at: now + by * MINUTE, snoozes: (reminder?.snoozes || 0) + 1 }
}

export function completed(reminder, now = Date.now()) {
  return { ...reminder, done: true, doneAt: now }
}

/**
 * Done, on a reminder that repeats.
 *
 * Not the same act at all, and this is the distinction the whole feature
 * turns on. Ticking off "call the dealer" finishes it. Ticking off "check
 * the stock sheet, every day at nine" finishes TODAY -- and a Done that
 * quietly cancelled the series would be the bug that loses somebody a
 * daily routine, discovered a week later when they notice it stopped.
 *
 * Each occurrence is its own alarm: the snooze count resets and `setFor`
 * becomes the new time, so tomorrow's does not arrive claiming to have
 * been snoozed four times yesterday.
 *
 * When the series runs out -- an end date passed, or the last of N -- it
 * completes for good, which is the one case where the two acts meet.
 */
export function advanced(reminder, now = Date.now()) {
  const fired = (reminder?.fired || 0) + 1
  const capped = Number(reminder?.times) > 0 && fired >= Number(reminder.times)
  const at = capped ? 0 : nextOccurrence(reminder, now)
  if (!at) return { ...reminder, fired, done: true, doneAt: now }
  return { ...reminder, fired, at, setFor: at, snoozes: 0 }
}

/** What Done does to this one -- the whole answer, for the caller. */
export const answered = (reminder, now = Date.now()) =>
  repeats(reminder) ? advanced(reminder, now) : completed(reminder, now)

/**
 * Stop a series without losing the record of it.
 *
 * The alarm needs this as well as Done: "yes, and never again" is a
 * different thing from "yes, see you tomorrow", and making somebody open
 * the panel and delete it is how a daily reminder survives the day it
 * stopped being wanted.
 */
export function ended(reminder, now = Date.now()) {
  return { ...reminder, repeat: 'none', done: true, doneAt: now }
}

/** Replaces one in the list, by id. */
export function replaceReminder(list, next) {
  return (list || []).map((r) => (r.id === next?.id ? next : r))
}

export function withoutReminder(list, id) {
  return (list || []).filter((r) => r.id !== id)
}

/**
 * What gets stored, once the dust has settled.
 *
 * Finished reminders are kept for a day and then dropped. Keeping them for
 * ever fills the one document they all live in; dropping them the instant
 * they are ticked takes away the only evidence that the thing was dealt
 * with -- and "did I already do that?" at four o'clock is exactly the
 * question this feature exists to answer.
 */
export function pruneReminders(list, now = Date.now(), keepDoneFor = 24 * 60 * 60 * 1000) {
  const kept = (list || []).filter((r) => !r.done || now - (r.doneAt || 0) <= keepDoneFor)
  // Oldest outstanding first if it still has to be cut: what is soonest is
  // what matters, and the tail of a list this long is somebody's task
  // manager rather than their alarm clock.
  return sortReminders(kept).slice(0, MAX_REMINDERS)
}

// ---------------------------------------------------------------------
// Setting one
// ---------------------------------------------------------------------

/**
 * The quick answers, which are what nearly every reminder actually is.
 *
 * A date picker is the right thing for "the 14th", and the wrong thing for
 * "in ten minutes" -- which is most of them. Both are offered; this is the
 * row of chips that means the common case is two clicks and no typing of
 * numbers at all.
 */
export function presets(now = Date.now()) {
  return [
    { key: '10m', label: '10 min', at: now + 10 * MINUTE },
    { key: '30m', label: '30 min', at: now + 30 * MINUTE },
    { key: '1h', label: '1 hour', at: now + 60 * MINUTE },
    { key: '3h', label: '3 hours', at: now + 180 * MINUTE },
    { key: 'tomorrow', label: 'Tomorrow 9am', at: tomorrowAt(9, 0, now) },
  ]
}

/** Nine in the morning, tomorrow, in the reader's own timezone. */
export function tomorrowAt(hour = 9, minute = 0, now = Date.now()) {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

/**
 * A `<input type="date">` and a `<input type="time">` into one instant.
 *
 * Built with the Date constructor rather than by parsing "2026-09-11T15:40"
 * as a string: that form is treated as UTC by some engines and as local by
 * others, which is a reminder that goes off five and a half hours out for
 * exactly the people this dashboard is for.
 */
export function atFromInputs(date, time, now = Date.now()) {
  const day = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const clock = String(time || '').match(/^(\d{1,2}):(\d{2})/)
  if (!day || !clock) return 0
  const at = new Date(
    Number(day[1]),
    Number(day[2]) - 1,
    Number(day[3]),
    Number(clock[1]),
    Number(clock[2]),
    0,
    0
  ).getTime()
  return Number.isFinite(at) ? at : 0
}

/** ...and back, to fill the boxes in. */
export function inputsFor(at) {
  const d = new Date(Number(at) || Date.now())
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  const pad = (n) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

/**
 * When a repeating reminder should first go off.
 *
 * Choosing "every day" at ten past nine means tomorrow at nine, not a
 * refusal. A one-off in the past is a mistake worth catching; a SERIES in
 * the past is just a series whose first occurrence has gone, and rolling
 * it forward is what every calendar does.
 */
export function firstOccurrence(draft, now = Date.now()) {
  const at = Number(draft?.at) || 0
  if (!at || at > now) return at
  if (!repeats(draft)) return at
  return nextOccurrence(draft, now)
}

/**
 * Why this cannot be set yet, or ''.
 *
 * A time in the past is refused rather than fired immediately. Somebody
 * typing 3:40 at half past four meant tomorrow, or mistyped, and neither
 * is served by the screen going amber the moment they press the button.
 */
export function draftProblem(draft, now = Date.now(), count = 0) {
  const text = String(draft?.text || '').trim()
  if (!text) return 'Say what the reminder is'
  if (text.length > MAX_TEXT) return `Too long by ${text.length - MAX_TEXT} characters`
  const at = Number(draft?.at) || 0
  if (!at) return 'Pick when'
  // A repeating one whose first time has gone rolls forward instead --
  // "every day at nine", chosen at ten past, means tomorrow.
  if (at <= now && !repeats(draft)) return 'That time has already gone'
  if (at <= now && !firstOccurrence(draft, now)) return 'That repeat never comes round'
  if (repeats(draft) && repeatOf(draft) === 'weekly' && (draft.days || []).length === 0 && !at) {
    return 'Pick which days'
  }
  if (count >= MAX_REMINDERS) return `That is ${MAX_REMINDERS} reminders — finish some first`
  return ''
}

// ---------------------------------------------------------------------
// Saying when
// ---------------------------------------------------------------------

const clockOf = (at) =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** Just the time, for the big face on the alarm. */
export const clockText = (at) => clockOf(Number(at) || 0)

/**
 * When it is for, in the fewest words that are unambiguous.
 *
 * Forward-looking, unlike the messages' version, because that is what a
 * reminder is. "12h ago" is the right thing to say about a message that
 * arrived and the wrong thing to say about an alarm that is going off --
 * there it is "12 hours late", which is a different fact.
 */
export function whenText(at, now = Date.now()) {
  const ms = Number(at) || 0
  if (!ms) return ''

  const away = ms - now
  const mins = Math.round(Math.abs(away) / MINUTE)

  if (away >= 0) {
    if (mins < 1) return 'now'
    if (mins < 60) return `in ${mins} min`
    if (isSameDay(ms, now)) return `at ${clockOf(ms)}`
    if (isSameDay(ms, now + 24 * 60 * MINUTE)) return `tomorrow at ${clockOf(ms)}`
    return `${new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} at ${clockOf(ms)}`
  }

  if (mins < 1) return 'now'
  if (mins < 60) return `${mins} min late`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h late`
  return `${Math.round(hours / 24)}d late`
}

function isSameDay(a, b) {
  const x = new Date(a)
  const y = new Date(b)
  return (
    x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
  )
}

/**
 * The rule, in words, wherever one is shown.
 *
 * Always names the TIME as well as the interval. "Every day" is not a
 * reminder, it is half of one, and the half that is missing is the half
 * somebody is checking when they read this back.
 */
export function repeatText(reminder) {
  const rule = repeatOf(reminder)
  if (rule === 'none') return ''

  const at = Number(reminder?.at) || 0
  const time = at ? clockOf(at) : ''
  const on = (suffix) => (time ? `${suffix} at ${time}` : suffix)

  let said
  switch (rule) {
    case 'hourly':
      said = 'Every hour'
      break
    case 'daily':
      said = on('Every day')
      break
    case 'weekdays':
      said = on('Mon to Fri')
      break
    case 'weekly': {
      const days = daysOf(reminder).map((d) => WEEKDAYS[d].label)
      said = on(days.length > 0 ? `Every ${days.join(', ')}` : 'Every week')
      break
    }
    case 'monthly':
      said = on(at ? `Every month on the ${ordinal(new Date(at).getDate())}` : 'Every month')
      break
    case 'yearly':
      said = on(
        at ? `Every year on ${new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}` : 'Every year'
      )
      break
    case 'interval': {
      const every = Math.max(1, Number(reminder?.every) || 1)
      said = on(every === 1 ? 'Every day' : `Every ${every} days`)
      break
    }
    default:
      return ''
  }

  const stop = endsText(reminder)
  return stop ? `${said} · ${stop}` : said
}

/** When the series stops, or '' for never. */
export function endsText(reminder) {
  const times = Number(reminder?.times) || 0
  if (times > 0) {
    const left = Math.max(0, times - (reminder?.fired || 0))
    return `${left} more ${left === 1 ? 'time' : 'times'}`
  }
  const until = Number(reminder?.until) || 0
  if (until) return `until ${new Date(until).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
  return ''
}

function ordinal(n) {
  const rest = n % 100
  if (rest >= 11 && rest <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`
}

/** "Set for 15:40 · snoozed twice", on the alarm. */
export function historyText(reminder) {
  if (!reminder) return ''
  const parts = []
  if (reminder.setFor && reminder.setFor !== reminder.at) parts.push(`Set for ${clockOf(reminder.setFor)}`)
  // "Once" and "twice" rather than "1 times" and "2 times". The count is
  // there to be slightly shaming, and a sentence that reads like a machine
  // wrote it is one nobody hears.
  const n = reminder.snoozes || 0
  if (n === 1) parts.push('snoozed once')
  else if (n === 2) parts.push('snoozed twice')
  else if (n > 2) parts.push(`snoozed ${n} times`)
  return parts.join(' · ')
}

/**
 * How big the reminder itself is drawn on the takeover.
 *
 * The whole screen is given over to one sentence, and one size cannot
 * serve both "hello" and two hundred characters: the short one looks
 * timid in type meant for the long one, and the long one overflows in
 * type meant for the short. So the size follows the length -- which is
 * what a poster designer does, and what nothing automatic ever does.
 *
 * Returned in rem at two breakpoints rather than as a class name, because
 * Tailwind cannot see a class that was assembled at runtime and would
 * purge it out of the build.
 */
export function alarmTextSize(text) {
  const n = String(text || '').length
  if (n <= 16) return { base: 3.25, wide: 5 }
  if (n <= 40) return { base: 2.5, wide: 3.75 }
  if (n <= 90) return { base: 2, wide: 2.75 }
  return { base: 1.5, wide: 2 }
}

// ---------------------------------------------------------------------
// Off the tab
// ---------------------------------------------------------------------

/**
 * What the desktop notification says.
 *
 * Shaped so it cannot be mistaken for a message at a glance, which is the
 * whole point of this being a separate feature: a message's title is a
 * PERSON, so a reminder's must not be. The clock face does more work than
 * the word does in a stack of six notifications.
 *
 * `requireInteraction` because an alarm that fades after four seconds
 * while somebody is in another window is an alarm that did not happen.
 */
export function reminderNotification(reminder, { badge } = {}) {
  return {
    title: `⏰ Reminder`,
    options: {
      body: String(reminder?.text || '').slice(0, 240),
      tag: `reminder:${reminder?.id || ''}`,
      requireInteraction: true,
      silent: false,
      renotify: false,
      badge,
      data: { reminderId: reminder?.id },
      // Longer and more insistent than a message's, because it is an
      // alarm: two short buzzes ask, this one tells.
      vibrate: [200, 80, 200, 80, 200],
    },
  }
}
