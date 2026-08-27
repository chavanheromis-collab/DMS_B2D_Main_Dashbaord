// ---------------------------------------------------------------------
// Countdown / clock
// ---------------------------------------------------------------------
// A month-end target is a different thing on the 3rd and on the 28th, and
// a dashboard that shows the number without the time left is showing half
// the picture. "68% of target" is comfortable with three weeks to go and
// an emergency with two days.
//
// Three modes, because the same widget answers three versions of the same
// need:
//
//   until -- time remaining to a date. The pressure gauge.
//   since -- time elapsed since one. "Days without a safety incident",
//            "days since the last delivery".
//   clock -- what time it is. Only interesting on a screen on a wall,
//            where it is genuinely useful and there is no other clock.
//
// The arithmetic is pure and takes `now` as an argument, so every one of
// these can be tested at a fixed instant rather than by waiting.

export const COUNTDOWN_MODES = [
  { value: 'until', label: 'Counting down to a date' },
  { value: 'since', label: 'Counting up from a date' },
  { value: 'clock', label: 'The time right now' },
]

export const COUNTDOWN_UNITS = [
  { value: 'auto', label: 'Whatever fits — days, then hours, then minutes' },
  { value: 'dhms', label: 'Days, hours, minutes, seconds' },
  { value: 'dhm', label: 'Days, hours, minutes' },
  { value: 'days', label: 'Days only' },
]

export const DEFAULT_COUNTDOWN = {
  mode: 'until',
  // An ISO date, which is what `<input type="date">` and
  // `<input type="datetime-local">` both hand back.
  target: '',
  label: '',
  doneLabel: 'Time’s up',
  units: 'auto',
  color: '#4F46E5',
  // Deadlines are the one place a colour change is information rather than
  // decoration, so a warning threshold is offered in days.
  warnDays: 7,
  dangerDays: 2,
  warnColor: '#D97706',
  dangerColor: '#DC2626',
  showSeconds: true,
  size: 'large',
  showDate: true,
  clockFormat: '24',
  showWeekday: true,
}

const DAY = 86400000
const HOUR = 3600000
const MINUTE = 60000

/**
 * An ISO date or datetime as a Date, or null.
 *
 * A bare `2026-03-31` is read as LOCAL midnight rather than UTC. Left to
 * `new Date('2026-03-31')` the browser parses it as UTC, and everybody
 * east of Greenwich gets a deadline that expires the evening before.
 */
export function parseTarget(value) {
  const s = String(value || '').trim()
  if (!s) return null

  const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnly) {
    // End of the day, not the start of it: a deadline of "the 31st" is
    // met by something done at five in the afternoon on the 31st.
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 23, 59, 59, 999)
  }

  const withTime = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (withTime) {
    return new Date(
      Number(withTime[1]),
      Number(withTime[2]) - 1,
      Number(withTime[3]),
      Number(withTime[4]),
      Number(withTime[5]),
      Number(withTime[6] || 0)
    )
  }

  const parsed = new Date(s)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** A gap in milliseconds, split into whole units. */
export function splitDuration(ms) {
  const abs = Math.max(0, Math.floor(ms))
  return {
    days: Math.floor(abs / DAY),
    hours: Math.floor((abs % DAY) / HOUR),
    minutes: Math.floor((abs % HOUR) / MINUTE),
    seconds: Math.floor((abs % MINUTE) / 1000),
    totalDays: abs / DAY,
    totalHours: abs / HOUR,
  }
}

/**
 * Which units to actually SHOW.
 *
 * `auto` drops the ones that are noise at this distance: a deadline six
 * months out does not need a seconds counter ticking beside it, and a
 * countdown of "182d 04h 17m 09s" is four numbers where one would do. Past
 * a fortnight it says days; inside a day it starts counting seconds.
 */
export function visibleUnits(parts, mode) {
  if (mode === 'days') return ['days']
  if (mode === 'dhm') return ['days', 'hours', 'minutes']
  if (mode === 'dhms') return ['days', 'hours', 'minutes', 'seconds']

  if (parts.days >= 14) return ['days']
  if (parts.days >= 1) return ['days', 'hours', 'minutes']
  if (parts.hours >= 1) return ['hours', 'minutes', 'seconds']
  return ['minutes', 'seconds']
}

/** How urgent this is, by the admin's own thresholds. */
export function urgency(parts, config) {
  const danger = Number(config.dangerDays)
  const warn = Number(config.warnDays)
  if (Number.isFinite(danger) && parts.totalDays <= danger) return 'danger'
  if (Number.isFinite(warn) && parts.totalDays <= warn) return 'warn'
  return 'normal'
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `31 Mar 2026`. */
export function formatDate(date) {
  if (!date) return ''
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

/** The clock face, in whichever of the two conventions was asked for. */
export function formatClock(date, { clockFormat = '24', showSeconds = true } = {}) {
  const pad = (n) => String(n).padStart(2, '0')
  const h24 = date.getHours()
  const hours = clockFormat === '12' ? h24 % 12 || 12 : h24
  const core = `${clockFormat === '12' ? hours : pad(hours)}:${pad(date.getMinutes())}${
    showSeconds ? `:${pad(date.getSeconds())}` : ''
  }`
  return clockFormat === '12' ? `${core} ${h24 < 12 ? 'AM' : 'PM'}` : core
}

/** Everything the widget draws, at one instant. */
export function countdownState(widget, now = new Date()) {
  const config = { ...DEFAULT_COUNTDOWN, ...(widget || {}) }

  if (config.mode === 'clock') {
    return {
      ready: true,
      mode: 'clock',
      clock: formatClock(now, config),
      weekday: WEEKDAYS[now.getDay()],
      date: formatDate(now),
      color: config.color,
    }
  }

  const target = parseTarget(config.target)
  if (!target) return { ready: false, mode: config.mode, reason: 'Pick a date' }

  const diff = config.mode === 'since' ? now.getTime() - target.getTime() : target.getTime() - now.getTime()
  // Counting UP from a date in the future, or DOWN to one in the past, are
  // both "not yet / no longer" rather than a negative number. A minus sign
  // on a countdown reads as a bug.
  const elapsed = diff <= 0
  const parts = splitDuration(Math.abs(diff))
  const level = config.mode === 'until' && !elapsed ? urgency(parts, config) : 'normal'

  return {
    ready: true,
    mode: config.mode,
    target,
    targetLabel: formatDate(target),
    targetWeekday: WEEKDAYS[target.getDay()],
    parts,
    units: visibleUnits(parts, config.units),
    done: config.mode === 'until' && elapsed,
    pending: config.mode === 'since' && elapsed,
    urgency: level,
    color:
      level === 'danger'
        ? config.dangerColor
        : level === 'warn'
          ? config.warnColor
          : config.color,
  }
}

/**
 * How often the widget has to redraw itself.
 *
 * A deadline three months out changes once a day; one three minutes out
 * changes every second. Ticking every second either way would repaint a
 * card 86,400 times to change one digit, on every open tab.
 */
export function tickInterval(state) {
  if (!state?.ready) return 60000
  if (state.mode === 'clock') return 1000
  if (state.units?.includes('seconds')) return 1000
  if (state.units?.includes('minutes')) return 30000
  return 60000
}
