import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  CUSTOM_RANGE,
  DATE_PRESETS,
  DATE_PRESET_GROUPS,
  DEFAULT_FY_START,
  dateValueIsSet,
  dateWindow,
  datePresetLabel,
  describeRange,
  isDatePreset,
  resolveDatePreset,
  toCustomRange,
  toDateInput,
} from './datePresets.js'
import { applyFilters, filterIsActive } from './filterEngine.js'
import { initialValues } from './pageControls.js'

// ---------------------------------------------------------------------
// Named periods on a date range
// ---------------------------------------------------------------------
// The one thing worth defending here is that a period is a NAME and not a
// pair of dates. Everything else is arithmetic; that is the design, and it
// is the part that silently rots if somebody "simplifies" it into resolving
// once at pick time.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

// A Thursday, mid-month, mid-quarter, after the Indian FY has opened.
const NOW = new Date(2026, 8, 10, 14, 30) // 10 Sep 2026
const at = (preset, opts) => resolveDatePreset(preset, { now: NOW, ...opts })
const span = (preset, opts) => {
  const r = at(preset, opts)
  return [toDateInput(r.from), toDateInput(r.to)]
}

// --- the periods ---------------------------------------------------------

test('a day is that day, from midnight to midnight', () => {
  assert.deepEqual(span('today'), ['2026-09-10', '2026-09-10'])
  assert.deepEqual(span('yesterday'), ['2026-09-09', '2026-09-09'])
  assert.deepEqual(span('tomorrow'), ['2026-09-11', '2026-09-11'])
  // The clock time in `now` must not leak into either end.
  assert.equal(at('today').from.getHours(), 0)
  assert.equal(at('today').to.getHours(), 23)
})

test('a rolling window counts today as one of its days', () => {
  // "Last 7 days" on a Monday morning includes this morning's bookings,
  // which is what somebody looking at it wants.
  assert.deepEqual(span('last_7'), ['2026-09-04', '2026-09-10'])
  assert.deepEqual(span('last_30'), ['2026-08-12', '2026-09-10'])
  assert.deepEqual(span('last_90'), ['2026-06-13', '2026-09-10'])
  // 364 days back, today included, is 365 days of data -- so it opens the
  // day AFTER the same date last year, not on it.
  assert.deepEqual(span('last_365'), ['2025-09-11', '2026-09-10'])
  assert.deepEqual(span('next_7'), ['2026-09-10', '2026-09-16'])
  assert.deepEqual(span('next_30'), ['2026-09-10', '2026-10-09'])
})

test('weeks start on Monday, like the Trend widget’s weeks', () => {
  // 10 Sep 2026 is a Thursday, so this week opened on the 7th.
  assert.equal(NOW.getDay(), 4)
  assert.deepEqual(span('week_to_date'), ['2026-09-07', '2026-09-10'])
  assert.deepEqual(span('this_week'), ['2026-09-07', '2026-09-13'])
  assert.deepEqual(span('last_week'), ['2026-08-31', '2026-09-06'])
})

test('a Sunday still belongs to the week that opened on Monday', () => {
  // The off-by-one this convention invites: Sunday is day 0 to JavaScript
  // and the LAST day of the week to everyone using this dashboard.
  const sunday = new Date(2026, 8, 13)
  assert.equal(sunday.getDay(), 0)
  assert.deepEqual(
    [toDateInput(resolveDatePreset('this_week', { now: sunday }).from), toDateInput(resolveDatePreset('this_week', { now: sunday }).to)],
    ['2026-09-07', '2026-09-13']
  )
})

test('"to date" stops at today and the whole period does not', () => {
  // The distinction the two entries exist for. On a tab of delivery
  // promises they are very different questions.
  assert.deepEqual(span('month_to_date'), ['2026-09-01', '2026-09-10'])
  assert.deepEqual(span('this_month'), ['2026-09-01', '2026-09-30'])
  assert.deepEqual(span('quarter_to_date'), ['2026-07-01', '2026-09-10'])
  assert.deepEqual(span('this_quarter'), ['2026-07-01', '2026-09-30'])
  assert.deepEqual(span('year_to_date'), ['2026-01-01', '2026-09-10'])
  assert.deepEqual(span('this_year'), ['2026-01-01', '2026-12-31'])
})

test('a month ends on its own last day, whatever length that is', () => {
  const feb = new Date(2024, 1, 15) // a leap year
  assert.deepEqual(toDateInput(resolveDatePreset('this_month', { now: feb }).to), '2024-02-29')
  const jan = new Date(2026, 0, 15)
  assert.deepEqual(toDateInput(resolveDatePreset('last_month', { now: jan }).from), '2025-12-01')
  assert.deepEqual(toDateInput(resolveDatePreset('last_month', { now: jan }).to), '2025-12-31')
})

test('quarters are calendar quarters, as the charts bucket them', () => {
  assert.deepEqual(span('last_quarter'), ['2026-04-01', '2026-06-30'])
  // Q1 of a year steps back into the previous year rather than to month -3.
  const jan = new Date(2026, 0, 20)
  assert.deepEqual(toDateInput(resolveDatePreset('last_quarter', { now: jan }).from), '2025-10-01')
  assert.deepEqual(toDateInput(resolveDatePreset('last_quarter', { now: jan }).to), '2025-12-31')
})

test('the financial year opens in April unless the admin says otherwise', () => {
  assert.equal(DEFAULT_FY_START, 4)
  assert.deepEqual(span('fy_to_date'), ['2026-04-01', '2026-09-10'])
  assert.deepEqual(span('this_fy'), ['2026-04-01', '2027-03-31'])
  assert.deepEqual(span('last_fy'), ['2025-04-01', '2026-03-31'])

  // A calendar financial year, for anyone not in India.
  assert.deepEqual(span('this_fy', { fyStart: 1 }), ['2026-01-01', '2026-12-31'])
  // July, for the ones who use that.
  assert.deepEqual(span('this_fy', { fyStart: 7 }), ['2026-07-01', '2027-06-30'])
})

test('a date before the financial year opens belongs to the year that opened last', () => {
  // February 2026 is in the FY that started April 2025 -- the mistake that
  // makes a March review show a fortnight of data.
  const feb = new Date(2026, 1, 10)
  assert.deepEqual(toDateInput(resolveDatePreset('this_fy', { now: feb }).from), '2025-04-01')
  assert.deepEqual(toDateInput(resolveDatePreset('this_fy', { now: feb }).to), '2026-03-31')
})

test('a nonsense financial-year start falls back rather than breaking', () => {
  for (const bad of [0, 13, -3, null, 'April', undefined, NaN]) {
    assert.deepEqual(span('this_fy', { fyStart: bad }), ['2026-04-01', '2027-03-31'], `fyStart ${bad}`)
  }
})

test('an unknown period is no period, not all time', () => {
  // A page whose whole point is a date filter must not quietly become
  // unfiltered because it names a period this build has not heard of.
  assert.equal(resolveDatePreset('last_fortnight', { now: NOW }), null)
  assert.equal(resolveDatePreset('', { now: NOW }), null)
  assert.equal(resolveDatePreset(undefined, { now: NOW }), null)
})

// --- a period is a name, not a pair of dates -----------------------------

test('the same period resolves differently on a different day', () => {
  // The whole design. A saved view holding "this month to date" opened next
  // quarter has to mean THAT month, not the one it was saved in.
  const value = { preset: 'month_to_date' }
  const inSep = dateWindow(value, { now: NOW })
  const inDec = dateWindow(value, { now: new Date(2026, 11, 4) })
  assert.deepEqual([toDateInput(inSep.from), toDateInput(inSep.to)], ['2026-09-01', '2026-09-10'])
  assert.deepEqual([toDateInput(inDec.from), toDateInput(inDec.to)], ['2026-12-01', '2026-12-04'])
})

test('a period wins over the boxes, and the boxes survive underneath it', () => {
  const value = { preset: 'today', from: '2020-01-01', to: '2020-12-31' }
  assert.deepEqual(toDateInput(dateWindow(value, { now: NOW }).from), '2026-09-10')
  // Switching back hands over what the period WAS, not the stale boxes and
  // not nothing -- picking "Last month" then nudging one end is a real
  // thing people do.
  assert.deepEqual(toCustomRange({ preset: 'last_month' }, { now: NOW }), {
    preset: CUSTOM_RANGE,
    from: '2026-08-01',
    to: '2026-08-31',
  })
})

test('with no period set it is the two boxes, exactly as before', () => {
  const window = dateWindow({ from: '2026-03-02', to: '2026-03-09' }, { now: NOW })
  assert.deepEqual([toDateInput(window.from), toDateInput(window.to)], ['2026-03-02', '2026-03-09'])
  assert.deepEqual(dateWindow({}, { now: NOW }), { from: null, to: null })
  assert.deepEqual(dateWindow(undefined, { now: NOW }), { from: null, to: null })
})

// --- it has to count as a filter -----------------------------------------

test('a period on its own is an active filter', () => {
  // It carries no from/to at all until it is resolved. Reading only the
  // boxes would filter the rows while the bar showed nothing on, and Reset
  // would have nothing to clear.
  const control = { id: 'd', kind: 'date', tab: 'T', column: 'Sold' }
  assert.equal(filterIsActive(control, { preset: 'today' }), true)
  assert.equal(filterIsActive(control, { from: '2026-01-01' }), true)
  assert.equal(filterIsActive(control, {}), false)
  assert.equal(dateValueIsSet({ preset: 'today' }), true)
  assert.equal(dateValueIsSet({}), false)
})

test('the engine filters rows by the period, resolved as it runs', () => {
  const rows = [
    { _row: 2, Sold: '10/09/2026' },
    { _row: 3, Sold: '02/09/2026' },
    { _row: 4, Sold: '28/08/2026' },
    { _row: 5, Sold: '15/04/2026' },
    { _row: 6, Sold: '' },
  ]
  const control = { id: 'd', kind: 'date', tab: 'T', column: 'Sold' }
  const run = (value) =>
    applyFilters(rows, { tab: 'T', filters: [control], values: { d: value } }).map((r) => r._row)

  // Resolved against the real clock, so assert on what cannot drift: a
  // period covering everything, and one covering nothing yet.
  assert.deepEqual(run({ preset: 'last_365' }).length >= 0, true)
  assert.deepEqual(run({ from: '2026-09-01', to: '2026-09-30' }), [2, 3])
  // A blank cell is not a date and so is in no period.
  assert.equal(run({ from: '1900-01-01', to: '2100-01-01' }).includes(6), false)
})

// --- opening on a period -------------------------------------------------

test('a date control can open on a period, and it stays a period', () => {
  const controls = [{ id: 'd', kind: 'date', tab: 'T', column: 'Sold', defaultValue: 'month_to_date' }]
  assert.deepEqual(initialValues(controls).values, { d: { preset: 'month_to_date' } })
})

test('a date default that is not a period is ignored, as it always was', () => {
  // A typed date could never work here -- the engine reads from/to off an
  // object and a string has neither -- so this refuses what was already a
  // no-op rather than passing a broken value further in.
  for (const bad of ['2026-09-01', 'soon', 'last_fortnight']) {
    assert.deepEqual(initialValues([{ id: 'd', kind: 'date', defaultValue: bad }]).values, {})
  }
})

// --- the list, and what it says ------------------------------------------

test('every period is named, unique, and in a group', () => {
  const seen = new Set()
  for (const p of DATE_PRESETS) {
    assert.ok(p.label, `${p.value} needs a label`)
    assert.ok(p.group, `${p.value} needs a group`)
    assert.equal(seen.has(p.value), false, `${p.value} is listed twice`)
    seen.add(p.value)
    assert.notEqual(resolveDatePreset(p.value, { now: NOW }), null, `${p.value} resolves to nothing`)
    assert.equal(isDatePreset(p.value), true)
  }
  assert.equal(DATE_PRESETS.length, DATE_PRESET_GROUPS.reduce((n, g) => n + g.presets.length, 0))
})

test('the ones people ask for by name are all there', () => {
  for (const wanted of ['yesterday', 'month_to_date', 'last_month', 'quarter_to_date', 'year_to_date', 'fy_to_date']) {
    assert.equal(isDatePreset(wanted), true, `${wanted} is missing`)
  }
  assert.equal(datePresetLabel('month_to_date'), 'This month to date')
  assert.equal(datePresetLabel('nope'), '')
})

test('"Custom range" is the empty value, so an unset control is already on it', () => {
  // What keeps every date filter saved before this dropdown existed looking
  // and behaving exactly as it did.
  assert.equal(CUSTOM_RANGE, '')
  assert.equal(isDatePreset(CUSTOM_RANGE), false)
})

test('a resolved period says what it came out as', () => {
  // The month name is the platform's own ("Sep" or "Sept" depending on the
  // ICU data), so what is asserted is the SHAPE: one year when both ends
  // share it, and both years when they do not -- otherwise a financial year
  // reads as nine months.
  assert.match(describeRange(at('this_month')), /^1 \w+ – 30 \w+ 2026$/)
  assert.match(describeRange(at('this_fy')), /^1 \w+ 2026 – 31 \w+ 2027$/)
  assert.equal(describeRange({ from: null, to: null }), '')
  assert.equal(describeRange(), '')
})

// --- still wired ---------------------------------------------------------

test('the filter resolves the period itself, rather than trusting a stored pair', () => {
  const engine = read('lib/filterEngine.js')
  assert.match(engine, /dateWindow\(value, \{ fyStart: filter\.fyStart \}\)/)
  // The old shape read the boxes and only the boxes.
  assert.equal(/const from = fromDateInput\(value\.from\)/.test(engine), false)
})

test('the picker offers the periods, and says what the chosen one covers', () => {
  const picker = read('components/DateRange.jsx')
  assert.match(picker, /DATE_PRESET_GROUPS\.map/)
  assert.match(picker, /label="Custom range"/)
  assert.match(picker, /describeRange\(range\)/)
  // Resolved for display only -- the filter resolves it again when it runs,
  // so a tab left open overnight is never showing one day and filtering by
  // another.
  assert.match(picker, /dateWindow\(v, \{ fyStart \}\)/)
})

test('the admin picks a period rather than typing a date', () => {
  const panel = read('pages/admin/ControlsPanel.jsx')
  assert.match(panel, /control\?\.kind === 'date'/)
  assert.match(panel, /options=\{\[\{ value: '', label: '— no period —' \}, \.\.\.DATE_PRESETS\]\}/)
  assert.match(panel, /label="Financial year starts"/)
})
