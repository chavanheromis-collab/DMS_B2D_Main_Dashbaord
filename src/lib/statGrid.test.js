import test from 'node:test'
import assert from 'node:assert/strict'

import { baselineFor, computeStats, percentChange, splitPeriods, statColumns, toneFor } from './statGrid.js'

const DAY = 86400000
const daysAgo = (n) => {
  const d = new Date(Date.now() - n * DAY)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

const rows = (spec) => spec.map(([days, amount], i) => ({ _row: i + 2, Date: daysAgo(days), Amount: String(amount) }))

// --- the thing that makes a number mean something ------------------------

test('a percentage change from nothing is not a percentage', () => {
  // The most common way a dashboard lies by accident: 0 -> 5 rendered as
  // "+500%", or worse, "+Infinity%". Neither is a fact about the business.
  assert.equal(percentChange(5, 0), null)
  assert.equal(percentChange(0, 0), null)
  assert.equal(percentChange(12, 10), 20)
})

test('a percentage change from a negative baseline uses its magnitude', () => {
  // -100 -> -50 is an improvement of 50 on a base of 100, which is +50%.
  // Dividing by the signed baseline would report it as -50%.
  assert.equal(percentChange(-50, -100), 50)
})

test('which direction is good is the widget’s decision, not the sign’s', () => {
  assert.equal(toneFor(5, false), 'good')
  assert.equal(toneFor(5, true), 'bad', 'more days-to-deliver is not good news')
  assert.equal(toneFor(-5, true), 'good')
  assert.equal(toneFor(0, false), 'flat')
})

// --- the two windows -----------------------------------------------------

test('the two periods are the same length and never overlap', () => {
  const list = rows([[1, 10], [10, 10], [29, 10], [31, 10], [45, 10], [80, 10]])
  const { current, previous, span } = splitPeriods(list, 'Date', 30)

  assert.equal(span, 30)
  assert.equal(current.length, 3, 'days 1, 10 and 29 are inside the last 30')
  assert.equal(previous.length, 2, 'days 31 and 45 are the 30 before that')
  // Day 80 belongs to neither, and belongs to neither on purpose.
  assert.equal(current.length + previous.length, 5)
})

test('the windows are anchored on today, not on the newest row', () => {
  // A sheet that stopped being updated a fortnight ago must show a FALL,
  // not a flattering number measured against a window that slid back to
  // wherever the data happens to end.
  const stale = rows([[12, 10], [13, 10], [14, 10]])
  const { current, previous } = splitPeriods(stale, 'Date', 10)
  assert.equal(current.length, 0, 'nothing at all in the last 10 days')
  assert.equal(previous.length, 3, 'every row sits in the 10 days before that')
})

test('rows older than both windows are in neither', () => {
  const ancient = rows([[20, 10], [21, 10]])
  const { current, previous } = splitPeriods(ancient, 'Date', 10)
  assert.equal(current.length, 0)
  assert.equal(previous.length, 0, 'a window is a window, not everything before now')
})

test('a row dated in the future counts in neither window', () => {
  const list = [{ Date: daysAgo(-5) }, { Date: daysAgo(2) }]
  const { current, previous } = splitPeriods(list, 'Date', 30)
  assert.equal(current.length, 1)
  assert.equal(previous.length, 0)
})

// --- baselines -----------------------------------------------------------

test('no honest baseline returns null rather than a zero to be up from', () => {
  assert.equal(baselineFor({ compare: 'none' }, { rows: [], unfilteredRows: [] }), null)
  assert.equal(
    baselineFor({ compare: 'conditions', compareConditions: [] }, { rows: [], unfilteredRows: [] }),
    null,
    'a comparison rule with nothing in it is not a comparison'
  )
  assert.equal(
    baselineFor({ compare: 'previous' }, { rows: [], unfilteredRows: [], dateColumn: '' }),
    null,
    'no date column means no previous period'
  )
  assert.equal(baselineFor({ compare: 'target', target: 'abc' }, { rows: [] }), null)
})

test('“unfiltered” measures the same rule over the unfiltered rows', () => {
  const all = [{ S: 'Won' }, { S: 'Won' }, { S: 'Lost' }]
  const filtered = [{ S: 'Won' }]
  const stat = {
    aggregation: 'count',
    compare: 'unfiltered',
    match: 'all',
    conditions: [{ column: 'S', operator: 'equals', value: 'Won' }],
  }
  const baseline = baselineFor(stat, { rows: filtered, unfilteredRows: all })
  assert.equal(baseline.value, 2, 'the stat’s own rule still applies to the baseline')
})

// --- the grid ------------------------------------------------------------

test('only a “previous period” stat has its headline number windowed', () => {
  // A stat asking for no comparison must count everything the page shows.
  // Narrowing it to thirty days because a SIBLING wanted a trend would make
  // the same metric read differently depending on what sits next to it.
  const list = rows([[1, 1], [40, 1], [90, 1]])

  const plain = computeStats({ dateColumn: 'Date', stats: [{ id: 'a', aggregation: 'count' }] }, { rows: list })
  assert.equal(plain[0].value, 3)

  const windowed = computeStats(
    { dateColumn: 'Date', periodDays: 30, stats: [{ id: 'a', aggregation: 'count', compare: 'previous' }] },
    { rows: list }
  )
  assert.equal(windowed[0].value, 1, 'only the last 30 days')
  assert.equal(windowed[0].baseline.value, 1, 'against the 30 before')
})

test('progress is drawn against a target and against nothing else', () => {
  const list = rows([[1, 1], [2, 1], [3, 1]])

  const target = computeStats({ stats: [{ id: 'a', compare: 'target', target: 10 }] }, { rows: list })
  assert.equal(target[0].progress, 0.3)

  const previous = computeStats(
    { dateColumn: 'Date', stats: [{ id: 'a', compare: 'previous' }] },
    { rows: list }
  )
  assert.equal(previous[0].progress, null, 'a bar filling up against last month says nothing')
})

test('progress never runs past the end of its own bar', () => {
  const list = rows([[1, 1], [2, 1], [3, 1]])
  const over = computeStats({ stats: [{ id: 'a', compare: 'target', target: 2 }] }, { rows: list })
  assert.equal(over[0].progress, 1)
  assert.equal(over[0].delta, 1, 'the overshoot is still reported as a number')
})

test('an empty grid still draws one stat rather than an empty card', () => {
  const made = computeStats({ stats: [] }, { rows: rows([[1, 1], [2, 1]]) })
  assert.equal(made.length, 1)
  assert.equal(made[0].value, 2)
})

test('a stat’s own rule narrows it before anything else happens', () => {
  const list = [{ S: 'Won' }, { S: 'Won' }, { S: 'Lost' }]
  const [stat] = computeStats(
    {
      stats: [
        { id: 'a', aggregation: 'count', match: 'all', conditions: [{ column: 'S', operator: 'equals', value: 'Won' }] },
      ],
    },
    { rows: list }
  )
  assert.equal(stat.value, 2)
  assert.equal(stat.rowCount, 2)
})

test('columns are clamped to what a card can actually hold', () => {
  assert.equal(statColumns({ columns: 3 }), 3)
  assert.equal(statColumns({ columns: 99 }), 6)
  assert.equal(statColumns({ columns: 0 }), 1)
  assert.equal(statColumns({}), 3)
  assert.equal(statColumns({ columns: 'nonsense' }), 3)
})
