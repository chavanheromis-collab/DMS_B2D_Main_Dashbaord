import { useEffect, useMemo, useRef, useState } from 'react'
import { AlarmClock, Ban, Check, Clock, Plus, Repeat, Trash2, X } from 'lucide-react'

import {
  MAX_EVERY,
  MAX_TEXT,
  REPEATS,
  SNOOZE_MINUTES,
  WEEKDAYS,
  alarmCount,
  alarmTextSize,
  atFromInputs,
  clockText,
  draftProblem,
  finished,
  firstOccurrence,
  historyText,
  inputsFor,
  missed,
  nextOccurrence,
  nextUp,
  presets,
  reminderNotification,
  repeatText,
  repeats,
  ringing,
  upcoming,
  whenText,
} from '../lib/reminders'
import { useNow, useReminders } from '../hooks/useReminders'
import {
  ALARM_BADGE,
  askPermission,
  pageIsVisible,
  permissionState,
  raiseNote,
  setTitlePart,
} from '../lib/notify'

// =====================================================================
// Reminders
// =====================================================================
// "Call the Nashik dealer back at four." Yours, from you, about something
// off the screen -- and the dashboard is simply what is in front of you
// when four o'clock comes.
//
// Everything here is built to be UNLIKE the messages, because the two
// arrive in the same place and the only thing worse than missing one is
// dealing with it as though it were the other:
//
//   MESSAGES              REMINDERS
//   bell, bottom right    clock, above it
//   indigo and rose       amber
//   a card over the page  the whole screen
//   a count badge         the time it goes off
//   sits still            keeps pulsing until answered
//   "(3) Dashboard"       "⏰ Dashboard"
//
// The last row is why the tab title is composed in notify.js rather than
// assigned here: two effects writing one string means whichever rendered
// last wins.

const AMBER_BUTTON =
  'border-amber-300 bg-amber-50 text-amber-700 hover:border-amber-400 hover:bg-amber-100'

/**
 * The clock button, the panel behind it, and the takeover.
 *
 * Mounted on the shell beside the messages, for the same reason: a
 * reminder set on one page must go off on whichever page you are on when
 * its time comes, including the admin panel.
 */
export default function ReminderCenter() {
  const { reminders, add, snooze, complete, stop, remove, ready } = useReminders()
  const now = useNow()

  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(() => pageIsVisible())
  // Whether anything can reach them off the tab. Held as state rather
  // than read at render, because granting it changes nothing React
  // watches -- the panel would go on saying "off" until something else
  // re-rendered it.
  const [reach, setReach] = useState(() => permissionState())

  // Which alarms this session has already buzzed about. Module-free and
  // per-mount, like the messages' set: a notification is for something
  // that JUST happened, and re-announcing on every tick would be a loop
  // nobody can see.
  const notified = useRef(new Set())

  const alarm = useMemo(() => ringing(reminders, now), [reminders, now])
  const waiting = useMemo(() => alarmCount(reminders, now), [reminders, now])
  const next = useMemo(() => nextUp(reminders, now), [reminders, now])

  useEffect(() => {
    const check = () => setVisible(pageIsVisible())
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    window.addEventListener('blur', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
      window.removeEventListener('blur', check)
    }
  }, [])

  // --- off the tab: the desktop notification ---------------------------
  // Only when they are NOT here. On the tab, the screen has just turned
  // amber and a second alert about it is noise.
  useEffect(() => {
    if (!alarm || visible || permissionState() !== 'granted') return
    if (notified.current.has(alarm.id)) return
    // Recorded before raising, not after: `raiseNote` can fail on a
    // platform that wants a service worker, and retrying every tick for
    // the rest of the session would be a loop nobody can see.
    notified.current.add(alarm.id)
    raiseNote(reminderNotification(alarm, { badge: ALARM_BADGE }), () => setOpen(false))
  }, [alarm, visible])

  // A snooze means it will be due again. What has been said once should be
  // sayable again when it comes back.
  useEffect(() => {
    if (!alarm) notified.current.clear()
  }, [alarm])

  // --- the tab itself ---------------------------------------------------
  useEffect(() => {
    setTitlePart({ alarms: waiting })
    return () => setTitlePart({ alarms: 0 })
  }, [waiting])

  if (!ready) return null

  return (
    <>
      {alarm && (
        <Alarm
          reminder={alarm}
          behind={waiting - 1}
          now={now}
          onSnooze={(mins) => snooze(alarm, mins)}
          onDone={() => complete(alarm)}
          onStop={() => stop(alarm)}
        />
      )}

      {/* Above the message bell, never in place of it -- two round buttons
          in one corner is a choice somebody makes in half a second, and
          they can only make it if both are always in the same place. */}
      <button
        onClick={() => setOpen(true)}
        title={next ? `Next reminder ${whenText(next.at, now)}` : 'Reminders'}
        aria-label={next ? `Reminders, next ${whenText(next.at, now)}` : 'Reminders'}
        className={`no-print fixed bottom-[4.25rem] right-4 z-40 flex h-11 items-center gap-1.5 rounded-full border px-3 shadow-lg backdrop-blur transition-colors ${
          next ? AMBER_BUTTON : 'border-slate-200 bg-white/95 text-slate-600 hover:border-amber-300 hover:text-amber-700'
        }`}
      >
        <AlarmClock size={17} />
        {/* The TIME, not a count. A number in a circle is what the bell
            does, and two of those side by side are one thing with two
            numbers on it. */}
        {next && <span className="text-[11px] font-semibold tabular-nums">{clockText(next.at)}</span>}
      </button>

      {open && (
        <Panel
          reminders={reminders}
          onReach={setReach}
          reach={reach}
          now={now}
          onAdd={add}
          onDone={complete}
          onStop={stop}
          onRemove={remove}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------
// The takeover
// ---------------------------------------------------------------------

/**
 * The whole screen, amber, until it is dealt with.
 *
 * Not a dialog over the page: a dialog is what the messages use, and the
 * point of a reminder is that it is the thing you now have to look at.
 * There is no backdrop to see the dashboard through, no close cross, and
 * no clicking outside -- the only ways out are Done and a snooze, both of
 * which are decisions.
 *
 * Escape snoozes rather than closing. Something has to answer the key or
 * the overlay is a trap for anybody driving by keyboard; and of the two
 * real answers, five more minutes is the one that cannot lose the
 * reminder.
 */
function Alarm({ reminder, behind, now, onSnooze, onDone, onStop }) {
  const history = historyText(reminder)
  const rule = repeatText(reminder)
  const size = alarmTextSize(reminder.text)
  const again = repeats(reminder) ? nextOccurrence(reminder, now) : 0

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onSnooze(SNOOZE_MINUTES[0])
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onSnooze])

  return (
    <div
      className="no-print alarm-in fixed inset-0 z-[10050] flex flex-col items-center justify-center overflow-y-auto bg-gradient-to-br from-amber-400 via-orange-400 to-amber-500 px-6 py-10 text-center"
      role="alertdialog"
      aria-modal="true"
      aria-label={`Reminder: ${reminder.text}`}
    >
      {/* Small, and above everything. The icon says WHAT this screen is in
          the quarter-second before anything is read; it does not need to
          be the size of the thing it is labelling. */}
      <span className="alarm-pulse mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/25 text-white shadow-lg ring-2 ring-white/30">
        <AlarmClock size={24} className="alarm-sweep" />
      </span>

      <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/75">Reminder</p>

      {/* THE MESSAGE. Not the clock -- the clock was the loudest thing on
          this screen and it is the one thing the reader already knows:
          they can see the time in the corner of their own machine. What
          they cannot see is what they wanted at this hour, and reading
          "hello" in small type under a vast 11:43 is being told the
          answer to a question nobody asked.
          Sized by its length, so a short one fills the screen and two
          hundred characters still fit on it. See alarmTextSize. */}
      <p
        className="mx-auto mt-3 max-w-4xl font-bold leading-tight text-white drop-shadow-md"
        style={{ fontSize: `clamp(${size.base}rem, ${size.base + 1.5}vw + 1rem, ${size.wide}rem)` }}
      >
        {reminder.text}
      </p>

      {/* The time, under it, as a fact about the message rather than as
          the headline. Still legible, still tabular, no longer shouting. */}
      <p className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[13px] font-medium text-white/90">
        <span className="rounded-full bg-white/20 px-2.5 py-0.5 tabular-nums">
          {clockText(reminder.setFor || reminder.at)}
        </span>
        <span>{whenText(reminder.at, now)}</span>
        {history && <span className="text-white/70">· {history}</span>}
      </p>

      {rule && (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-white/75">
          <Repeat size={11} /> {rule}
        </p>
      )}

      <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
        {/* On a series this is "done for now", and it says so -- a Done that
            looked like it ended a daily routine is the one people press
            once and then stop trusting. */}
        <button
          onClick={onDone}
          className="flex items-center gap-1.5 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-amber-700 shadow-lg transition-transform hover:scale-[1.03]"
        >
          <Check size={16} />
          {again ? `Done · again ${whenText(again, now)}` : 'Done'}
        </button>
        {SNOOZE_MINUTES.map((mins) => (
          <button
            key={mins}
            onClick={() => onSnooze(mins)}
            className="rounded-xl border border-white/50 bg-white/15 px-3.5 py-2.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/25"
          >
            +{mins < 60 ? `${mins} min` : '1 hour'}
          </button>
        ))}
      </div>

      {/* The other half of Done, and only where there is a series to
          end. Making somebody open a panel to stop a daily reminder is
          how one survives the day it stopped being wanted. */}
      {again > 0 && (
        <button
          onClick={onStop}
          className="mt-4 flex items-center gap-1.5 rounded-lg px-3 py-1 text-[11px] font-semibold text-white/80 underline-offset-2 hover:bg-white/15 hover:text-white"
        >
          <Ban size={11} /> Stop repeating
        </button>
      )}

      <p className="mt-3 text-[11px] text-white/70">Esc snoozes {SNOOZE_MINUTES[0]} minutes</p>

      {/* Said, rather than stacked. Three takeovers at once means the third
          is dismissed by the momentum of dismissing the first. */}
      {behind > 0 && (
        <p className="mt-4 rounded-full bg-white/20 px-3 py-1 text-[11px] font-semibold text-white">
          {behind} more {behind === 1 ? 'reminder' : 'reminders'} after this
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Setting them
// ---------------------------------------------------------------------

function Panel({ reminders, now, onAdd, onDone, onStop, onRemove, onClose, reach, onReach }) {
  const [text, setText] = useState('')
  const [at, setAt] = useState(0)
  const [exact, setExact] = useState(false)
  // The repeat, and where it stops. All four are inert at their
  // defaults, so somebody who wants a one-off never meets any of them.
  const [repeat, setRepeat] = useState('none')
  const [days, setDays] = useState([])
  const [every, setEvery] = useState(2)
  const [ends, setEnds] = useState('never')
  const [until, setUntil] = useState('')
  const [times, setTimes] = useState(5)
  const [more, setMore] = useState(false)

  const boxes = inputsFor(at || now + 60 * 60 * 1000)

  const rule = useMemo(
    () => ({
      repeat,
      days,
      every,
      until: ends === 'until' ? atFromInputs(until, '23:59', now) : 0,
      times: ends === 'times' ? Math.max(1, Number(times) || 1) : 0,
    }),
    [repeat, days, every, ends, until, times, now]
  )

  const chips = useMemo(() => presets(now), [now])
  const draft = { text, at, ...rule }
  const problem = draftProblem(draft, now, reminders.filter((r) => !r.done).length)
  // What it will ACTUALLY be set to: a repeating one whose first time
  // has gone rolls forward rather than being refused.
  const starts = firstOccurrence(draft, now) || at

  const soon = upcoming(reminders, now)
  const late = missed(reminders, now)
  const done = finished(reminders)

  async function save() {
    if (problem) return
    await onAdd(text, at, rule)
    setText('')
    setAt(0)
    setExact(false)
    setRepeat('none')
    setDays([])
    setEnds('never')
    setMore(false)
  }

  return (
    <div
      className="no-print fixed inset-0 z-[70] flex items-end justify-end bg-slate-900/20 p-4 backdrop-blur-sm sm:items-end"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Amber all the way down, so the panel is recognisable as the
            reminder one before a word of it is read. */}
        <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-3 py-2.5">
          <AlarmClock size={16} className="text-amber-600" />
          <h2 className="text-[13px] font-semibold text-amber-900">Reminders</h2>
          <button
            onClick={onClose}
            className="ml-auto rounded-lg p-1 text-amber-500 hover:bg-amber-100"
            aria-label="Close reminders"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {/* --- the composer ---------------------------------------- */}
          <input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))}
            placeholder="Remind me to…"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !problem) save()
            }}
          />

          {/* Two clicks and no typing of numbers, which is what nearly
              every reminder actually is. The date boxes are for "the
              14th" and are folded away until somebody wants them. */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <button
                key={chip.key}
                onClick={() => {
                  setAt(chip.at)
                  setExact(false)
                }}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  at === chip.at && !exact
                    ? 'border-amber-500 bg-amber-500 text-white'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {chip.label}
              </button>
            ))}
            <button
              onClick={() => setExact((v) => !v)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                exact ? 'border-amber-500 bg-amber-500 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Clock size={10} className="mr-1 inline" />
              Pick a time
            </button>
          </div>

          {exact && (
            <div className="mt-2 flex items-center gap-1.5">
              <input
                type="date"
                value={boxes.date}
                onChange={(e) => setAt(atFromInputs(e.target.value, boxes.time, now))}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
              />
              <input
                type="time"
                value={boxes.time}
                onChange={(e) => setAt(atFromInputs(boxes.date, e.target.value, now))}
                className="w-24 shrink-0 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
              />
            </div>
          )}

          {/* --- how often ------------------------------------------- */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              <Repeat size={10} /> Repeat
            </span>
            <select
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-1 text-[11px]"
            >
              {REPEATS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>

            {repeat === 'interval' && (
              <span className="flex items-center gap-1 text-[11px] text-slate-500">
                every
                <input
                  type="number"
                  min={1}
                  max={MAX_EVERY}
                  value={every}
                  onChange={(e) => setEvery(Math.max(1, Math.min(MAX_EVERY, Number(e.target.value) || 1)))}
                  className="w-14 rounded-lg border border-slate-200 px-1.5 py-1 text-center text-[11px]"
                />
                days
              </span>
            )}

            {repeat !== 'none' && (
              <button
                onClick={() => setMore((v) => !v)}
                className={`rounded-lg border px-2 py-1 text-[11px] font-medium ${
                  more || ends !== 'never'
                    ? 'border-amber-400 bg-amber-50 text-amber-700'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                Ends…
              </button>
            )}
          </div>

          {/* Which days, only for the rule that has days. Sunday first,
              the way a calendar is drawn; blank means the day the time
              itself falls on, so choosing nothing is still valid. */}
          {repeat === 'weekly' && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {WEEKDAYS.map((d) => {
                const on = days.includes(d.value)
                return (
                  <button
                    key={d.value}
                    onClick={() =>
                      setDays((list) =>
                        list.includes(d.value) ? list.filter((x) => x !== d.value) : [...list, d.value]
                      )
                    }
                    aria-pressed={on}
                    className={`h-7 w-9 rounded-lg border text-[10px] font-semibold transition-colors ${
                      on
                        ? 'border-amber-500 bg-amber-500 text-white'
                        : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
          )}

          {/* When it stops. Folded away because "never" is the honest
              default for a routine, and a form that asks four questions
              to set one alarm is a form nobody uses twice. */}
          {repeat !== 'none' && more && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-50 px-2 py-1.5">
              {[
                { value: 'never', label: 'Never ends' },
                { value: 'times', label: 'After' },
                { value: 'until', label: 'On' },
              ].map((choice) => (
                <button
                  key={choice.value}
                  onClick={() => setEnds(choice.value)}
                  className={`rounded-lg border px-2 py-1 text-[11px] font-medium ${
                    ends === choice.value
                      ? 'border-amber-500 bg-amber-500 text-white'
                      : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {choice.label}
                </button>
              ))}
              {ends === 'times' && (
                <span className="flex items-center gap-1 text-[11px] text-slate-500">
                  <input
                    type="number"
                    min={1}
                    value={times}
                    onChange={(e) => setTimes(Math.max(1, Number(e.target.value) || 1))}
                    className="w-14 rounded-lg border border-slate-200 px-1.5 py-1 text-center text-[11px]"
                  />
                  times
                </span>
              )}
              {ends === 'until' && (
                <input
                  type="date"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-[11px]"
                />
              )}
            </div>
          )}

          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={save}
              disabled={Boolean(problem)}
              className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus size={13} /> Set reminder
            </button>
            {/* The refusal, where the decision is, rather than after the
                button has been pressed and nothing happened. */}
            {/* What is about to be set, in the words it will be read
                back in -- including the roll-forward, so "every day at
                nine" chosen at ten past does not look like it is about to
                go off immediately. */}
            <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">
              {problem ||
                (starts
                  ? `Goes off ${whenText(starts, now)}${
                      repeat === 'none' ? '' : ` · ${repeatText({ ...rule, at: starts })}`
                    }`
                  : '')}
            </span>
          </div>

          {/* --- what is set ----------------------------------------- */}
          <Group title="Next up" rows={soon} now={now} onDone={onDone} onStop={onStop} onRemove={onRemove} />
          <Group title="Missed" rows={late} now={now} onDone={onDone} onStop={onStop} onRemove={onRemove} tone="rose" />
          <Group title="Done" rows={done} now={now} onDone={onDone} onStop={onStop} onRemove={onRemove} tone="muted" />

          {soon.length === 0 && late.length === 0 && done.length === 0 && (
            <p className="mt-6 text-center text-[11px] text-slate-400">
              Nothing set. A reminder takes over the whole screen when its time comes.
            </p>
          )}

          {/* What this can and cannot promise, said where reminders are
              set rather than discovered at four o'clock. The screen going
              amber needs no permission and always happens; reaching
              somebody who is in another tab does, and it is the half
              people are relying on. */}
          <Reach state={reach} onGranted={onReach} />
        </div>
      </div>
    </div>
  )
}

/**
 * Whether a reminder can leave this tab, and the one button that fixes it.
 *
 * Deliberately NOT a second permission prompt of its own. The browser has
 * one switch for the whole site, the messages already ask for it with
 * their own reasoning, and two panels asking the same question in
 * different words is how somebody ends up believing they are two
 * separate settings. This states the consequence for reminders and asks
 * the same question, from a click, which is the only way Safari and every
 * browser on iOS will show the prompt at all.
 */
function Reach({ state, onGranted }) {
  if (state === 'granted') return null

  if (state === 'denied' || state === 'unsupported') {
    return (
      <p className="mt-3 rounded-xl bg-slate-50 px-2.5 py-2 text-[11px] leading-snug text-slate-500">
        Notifications are {state === 'denied' ? 'blocked for this site' : 'not available in this browser'}, so a
        reminder can only take the screen while this tab is open. It will still be waiting when you come back.
      </p>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2">
      <p className="text-[11px] leading-snug text-amber-800">
        Reminders can only reach you in this tab. Turn notifications on and one will find you in another tab or
        another window.
      </p>
      <button
        onClick={async () => onGranted?.(await askPermission())}
        className="mt-1.5 rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-600"
      >
        Turn on notifications
      </button>
    </div>
  )
}

function Group({ title, rows, now, onDone, onStop, onRemove, tone = 'amber' }) {
  if (rows.length === 0) return null
  const ink = { amber: 'text-amber-700', rose: 'text-rose-600', muted: 'text-slate-400' }[tone]

  return (
    <div className="mt-3">
      <p className={`mb-1 text-[10px] font-semibold uppercase tracking-wide ${ink}`}>{title}</p>
      <div className="space-y-1">
        {rows.map((r) => (
          <div
            key={r.id}
            className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 ${
              tone === 'muted' ? 'border-slate-100 bg-slate-50/60' : 'border-slate-200 bg-white'
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[12px] ${tone === 'muted' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                {r.text}
              </span>
              <span className="block text-[10px] tabular-nums text-slate-400">
                {clockText(r.at)} · {whenText(r.at, now)}
              </span>
              {/* A routine looks like a routine in the list, or the
                  only place it is visible is the moment it goes off. */}
              {repeats(r) && (
                <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-px text-[9px] font-medium text-amber-700">
                  <Repeat size={8} /> {repeatText(r)}
                </span>
              )}
            </span>
            {repeats(r) && !r.done && (
              <button
                onClick={() => onStop(r)}
                className="rounded-lg p-1 text-slate-300 hover:bg-amber-50 hover:text-amber-600"
                aria-label={`Stop repeating "${r.text}"`}
                title="Stop repeating"
              >
                <Ban size={13} />
              </button>
            )}
            {!r.done && (
              <button
                onClick={() => onDone(r)}
                className="rounded-lg p-1 text-slate-300 hover:bg-emerald-50 hover:text-emerald-600"
                aria-label={`Mark "${r.text}" done`}
                title="Done"
              >
                <Check size={13} />
              </button>
            )}
            <button
              onClick={() => onRemove(r.id)}
              className="rounded-lg p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
              aria-label={`Delete "${r.text}"`}
              title="Delete"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
