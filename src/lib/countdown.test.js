import test from 'node:test'
import assert from 'node:assert/strict'

import {
  countdownState,
  formatClock,
  formatDate,
  parseTarget,
  splitDuration,
  tickInterval,
  urgency,
  visibleUnits,
} from './countdown.js'

// --- parsing -------------------------------------------------------------

test('a bare date is local, not UTC', () => {
  // `new Date("2026-03-31")` is parsed as UTC by the browser, so everybody
  // east of Greenwich gets a deadline that expires the evening before.
  const d = parseTarget('2026-03-31')
  assert.equal(d.getFullYear(), 2026)
  assert.equal(d.getMonth(), 2)
  assert.equal(d.getDate(), 31)
})

test('a deadline of “the 31st” is met at five in the afternoon on the 31st', () => {
  const d = parseTarget('2026-03-31')
  assert.equal(d.getHours(), 23)
  assert.equal(d.getMinutes(), 59)
})

test('a date with a time keeps its time', () => {
  const d = parseTarget('2026-03-31T14:30')
  assert.equal(d.getHours(), 14)
  assert.equal(d.getMinutes(), 30)
})

test('nothing usable is null, not the epoch', () => {
  assert.equal(parseTarget(''), null)
  assert.equal(parseTarget('   '), null)
  assert.equal(parseTarget('not a date'), null)
})

// --- units ---------------------------------------------------------------

test('a duration splits into whole units that add back up', () => {
  const parts = splitDuration(2 * 86400000 + 3 * 3600000 + 4 * 60000 + 5000)
  assert.deepEqual([parts.days, parts.hours, parts.minutes, parts.seconds], [2, 3, 4, 5])
})

test('“whatever fits” drops the units that are noise at this distance', () => {
  // "182d 04h 17m 09s" is four numbers where one would do, and a seconds
  // counter six months out is a repaint per second for nothing.
  assert.deepEqual(visibleUnits(splitDuration(180 * 86400000), 'auto'), ['days'])
  assert.deepEqual(visibleUnits(splitDuration(3 * 86400000), 'auto'), ['days', 'hours', 'minutes'])
  assert.deepEqual(visibleUnits(splitDuration(5 * 3600000), 'auto'), ['hours', 'minutes', 'seconds'])
  assert.deepEqual(visibleUnits(splitDuration(90000), 'auto'), ['minutes', 'seconds'])
})

test('a pinned unit choice is honoured whatever the distance', () => {
  const far = splitDuration(400 * 86400000)
  assert.deepEqual(visibleUnits(far, 'days'), ['days'])
  assert.deepEqual(visibleUnits(far, 'dhms'), ['days', 'hours', 'minutes', 'seconds'])
})

// --- urgency -------------------------------------------------------------

test('urgency uses the admin’s own thresholds', () => {
  const config = { warnDays: 7, dangerDays: 2 }
  assert.equal(urgency(splitDuration(30 * 86400000), config), 'normal')
  assert.equal(urgency(splitDuration(5 * 86400000), config), 'warn')
  assert.equal(urgency(splitDuration(1 * 86400000), config), 'danger')
})

// --- the state -----------------------------------------------------------

test('counting down past zero is “over”, never a negative number', () => {
  const state = countdownState({ mode: 'until', target: '2020-01-01' }, new Date(2026, 5, 15))
  assert.equal(state.done, true)
  assert.ok(state.parts.days > 0, 'the magnitude is still positive')
})

test('counting up from a future date is “not yet”, not a negative number', () => {
  const state = countdownState({ mode: 'since', target: '2030-01-01' }, new Date(2026, 5, 15))
  assert.equal(state.pending, true)
  assert.ok(state.parts.days > 0)
})

test('the colour follows the urgency', () => {
  const config = { mode: 'until', warnDays: 7, dangerDays: 2, color: '#111111', warnColor: '#222222', dangerColor: '#333333' }
  const now = new Date(2026, 5, 15, 12)

  assert.equal(countdownState({ ...config, target: '2026-12-31' }, now).color, '#111111')
  assert.equal(countdownState({ ...config, target: '2026-06-19' }, now).color, '#222222')
  assert.equal(countdownState({ ...config, target: '2026-06-16' }, now).color, '#333333')
})

test('an elapsed countdown is not marked urgent', () => {
  const state = countdownState({ mode: 'until', target: '2020-01-01', dangerDays: 2 }, new Date(2026, 5, 15))
  assert.equal(state.urgency, 'normal', 'it is over; there is nothing left to be urgent about')
})

test('counting up never claims to be urgent', () => {
  const state = countdownState({ mode: 'since', target: '2026-06-14', dangerDays: 2 }, new Date(2026, 5, 15))
  assert.equal(state.urgency, 'normal')
})

test('no date means the widget says so', () => {
  assert.equal(countdownState({ mode: 'until', target: '' }).ready, false)
})

test('the clock needs no target at all', () => {
  const state = countdownState({ mode: 'clock' }, new Date(2026, 5, 15, 17, 4, 9))
  assert.equal(state.ready, true)
  assert.equal(state.clock, '17:04:09')
  assert.equal(state.weekday, 'Monday')
})

// --- formatting ----------------------------------------------------------

test('the clock is written in the convention that was asked for', () => {
  const at = new Date(2026, 5, 15, 17, 4, 9)
  assert.equal(formatClock(at, { clockFormat: '24' }), '17:04:09')
  assert.equal(formatClock(at, { clockFormat: '12' }), '5:04:09 PM')
  assert.equal(formatClock(at, { clockFormat: '24', showSeconds: false }), '17:04')
})

test('midnight and noon are not written as zero o’clock', () => {
  assert.equal(formatClock(new Date(2026, 5, 15, 0, 30), { clockFormat: '12', showSeconds: false }), '12:30 AM')
  assert.equal(formatClock(new Date(2026, 5, 15, 12, 30), { clockFormat: '12', showSeconds: false }), '12:30 PM')
})

test('a date reads as a date', () => {
  assert.equal(formatDate(new Date(2026, 2, 31)), '31 Mar 2026')
  assert.equal(formatDate(null), '')
})

// --- the repaint budget --------------------------------------------------

test('the redraw interval matches how fast a digit can actually change', () => {
  const far = countdownState({ mode: 'until', target: '2027-12-31' }, new Date(2026, 5, 15))
  assert.equal(tickInterval(far), 60000, 'a month out, one digit a day')

  const near = countdownState({ mode: 'until', target: '2026-06-15T23:59' }, new Date(2026, 5, 15, 23, 0))
  assert.equal(tickInterval(near), 1000)

  assert.equal(tickInterval(countdownState({ mode: 'clock' }, new Date())), 1000)
})
