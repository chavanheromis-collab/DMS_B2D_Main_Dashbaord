import test from 'node:test'
import assert from 'node:assert/strict'

import { cohortData, entityEvents, periodsBetween } from './cohortData.js'

const NOW = new Date(2026, 5, 15)
const config = { entityColumn: 'C', dateColumn: 'D', grain: 'month', periods: 6, maxCohorts: 12 }

const on = (y, m, d = 5) => `${d}/${m}/${y}`

// --- counting periods ----------------------------------------------------

test('periods are counted by stepping the calendar, not by dividing by 30', () => {
  // Months are not a fixed length. Dividing milliseconds puts the same pair
  // of months three periods apart in one year and two in another, and the
  // grid grows a diagonal smear nobody can explain.
  assert.equal(periodsBetween(new Date(2026, 0, 1), new Date(2026, 0, 31), 'month'), 0)
  assert.equal(periodsBetween(new Date(2026, 0, 1), new Date(2026, 1, 1), 'month'), 1)
  assert.equal(periodsBetween(new Date(2026, 0, 1), new Date(2026, 2, 15), 'month'), 2)
  // February is short and July is long; both are still one month.
  assert.equal(periodsBetween(new Date(2026, 1, 1), new Date(2026, 2, 1), 'month'), 1)
  assert.equal(periodsBetween(new Date(2026, 6, 1), new Date(2026, 7, 1), 'month'), 1)
})

test('a date before the cohort started is not a period', () => {
  assert.equal(periodsBetween(new Date(2026, 5, 1), new Date(2026, 0, 1), 'month'), -1)
})

test('weeks, quarters and years all step their own way', () => {
  assert.equal(periodsBetween(new Date(2026, 0, 5), new Date(2026, 0, 12), 'week'), 1)
  assert.equal(periodsBetween(new Date(2026, 0, 1), new Date(2026, 3, 1), 'quarter'), 1)
  assert.equal(periodsBetween(new Date(2024, 0, 1), new Date(2026, 0, 1), 'year'), 2)
})

// --- entities ------------------------------------------------------------

test('an entity is pinned to its EARLIEST date, whatever order the rows are in', () => {
  const entities = entityEvents(
    [
      { C: 'alice', D: on(2026, 3) },
      { C: 'alice', D: on(2026, 1) },
      { C: 'alice', D: on(2026, 5) },
    ],
    config
  )
  const alice = entities.get('alice')
  assert.equal(alice.first.getMonth(), 0, 'January, even though it arrived second')
  assert.equal(alice.events.length, 3)
})

test('a row with no usable date is dropped, not filed under unknown', () => {
  // A cohort whose start date is unknown cannot have a period-since, so
  // every one of its cells would be meaningless.
  const entities = entityEvents([{ C: 'a', D: 'sometime' }, { C: '', D: on(2026, 1) }, { C: 'b', D: on(2026, 1) }], config)
  assert.equal(entities.size, 1)
  assert.ok(entities.has('b'))
})

// --- the grid ------------------------------------------------------------

test('period zero is a hundred percent for every cohort, by construction', () => {
  const data = cohortData(config, {
    rows: [{ C: 'a', D: on(2026, 1) }, { C: 'b', D: on(2026, 1) }],
    dateOrder: 'DMY',
    today: NOW,
  })
  for (const cohort of data.cohorts) {
    assert.equal(Math.round(cohort.cells[0].value), 100)
  }
})

test('the future is left blank rather than reported as a collapse', () => {
  // A cohort from last month has not HAD six months to come back, and a 0%
  // there invents a failure that has not happened.
  const data = cohortData(config, {
    rows: [{ C: 'a', D: on(2026, 5, 1) }],
    dateOrder: 'DMY',
    today: NOW,
  })
  const cohort = data.cohorts[data.cohorts.length - 1]
  assert.equal(cohort.cells[0].future, false)
  assert.equal(cohort.cells[3].future, true, 'three months from now has not happened')
  assert.equal(cohort.cells[3].value, 0)
  assert.equal(cohort.cells[3].rows.length, 0)
})

test('an entity counts once per period however often it appeared in it', () => {
  // Retention is about people coming back, not about how much they bought
  // when they did.
  const data = cohortData(config, {
    rows: [
      { C: 'a', D: on(2026, 1, 1) },
      { C: 'a', D: on(2026, 2, 1) },
      { C: 'a', D: on(2026, 2, 9) },
      { C: 'a', D: on(2026, 2, 20) },
    ],
    dateOrder: 'DMY',
    today: NOW,
  })
  const cohort = data.cohorts[0]
  assert.equal(cohort.cells[1].active, 1, 'one person, three visits')
  assert.equal(cohort.cells[1].rows.length, 3, 'but all three rows are kept for the drill')
})

test('retention is of the cohort, not of whoever happened to be active', () => {
  const rows = [
    { C: 'a', D: on(2026, 1) },
    { C: 'b', D: on(2026, 1) },
    { C: 'c', D: on(2026, 1) },
    { C: 'd', D: on(2026, 1) },
    { C: 'a', D: on(2026, 2) },
  ]
  const data = cohortData(config, { rows, dateOrder: 'DMY', today: NOW })
  const cohort = data.cohorts[0]
  assert.equal(cohort.size, 4)
  assert.equal(Math.round(cohort.cells[1].value), 25, 'one of four, not one of one')
})

test('the colour scale ignores period zero', () => {
  // Otherwise every grid is one black column and a wash of nothing.
  const data = cohortData(config, {
    rows: [
      { C: 'a', D: on(2026, 1) },
      { C: 'b', D: on(2026, 1) },
      { C: 'a', D: on(2026, 2) },
    ],
    dateOrder: 'DMY',
    today: NOW,
  })
  assert.ok(data.max < 100, 'the 100% start column is not what the scale is normalised on')
  assert.equal(Math.round(data.max), 50)
})

test('cohorts read oldest at the top, so time runs downwards', () => {
  const data = cohortData(config, {
    rows: [{ C: 'a', D: on(2026, 1) }, { C: 'b', D: on(2026, 3) }, { C: 'c', D: on(2026, 5) }],
    dateOrder: 'DMY',
    today: NOW,
  })
  const starts = data.cohorts.map((c) => c.start.getTime())
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b))
})

test('only the newest cohorts are drawn, and the rest are counted', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ C: `e${i}`, D: on(2025, (i % 12) + 1) }))
  const data = cohortData({ ...config, maxCohorts: 4 }, { rows, dateOrder: 'DMY', today: NOW })
  assert.equal(data.cohorts.length, 4)
  assert.equal(data.hidden, 8)
})

test('the repeat rate counts entities that came back on a different day', () => {
  const data = cohortData(config, {
    rows: [
      { C: 'a', D: on(2026, 1) },
      { C: 'a', D: on(2026, 2) },
      { C: 'b', D: on(2026, 1) },
      { C: 'b', D: on(2026, 1) },
    ],
    dateOrder: 'DMY',
    today: NOW,
  })
  assert.equal(data.entityCount, 2)
  assert.equal(Math.round(data.repeatRate), 50, 'b bought twice on one day, which is one visit')
})

test('a widget missing either column says so instead of drawing an empty grid', () => {
  assert.equal(cohortData({ entityColumn: '', dateColumn: 'D' }, { rows: [] }).ready, false)
  assert.equal(cohortData({ entityColumn: 'C', dateColumn: '' }, { rows: [] }).ready, false)
})

test('the value metric aggregates the rows behind the cell', () => {
  const data = cohortData(
    { ...config, metric: 'value', aggregation: 'sum', column: 'A' },
    {
      rows: [
        { C: 'a', D: on(2026, 1), A: '100' },
        { C: 'a', D: on(2026, 2), A: '250' },
      ],
      dateOrder: 'DMY',
      today: NOW,
    }
  )
  const cohort = data.cohorts[0]
  assert.equal(cohort.cells[0].value, 100)
  assert.equal(cohort.cells[1].value, 250)
  assert.equal(Math.round(cohort.cells[1].retention), 100, 'retention still comes back alongside it')
})
