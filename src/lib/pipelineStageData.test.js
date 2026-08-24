import test from 'node:test'
import assert from 'node:assert/strict'

import { applyFilters, testCondition } from './filterEngine.js'
import { getStageRows, getStagePopupRows, stageConditions } from './pipelineStageData.js'

const TAB = 'src_a1::MASTER'
const stage = {
  id: 's1',
  tab: TAB,
  label: 'Won',
  match: 'all',
  conditions: [{ tab: TAB, column: 'Status', operator: 'equals', value: 'Won' }],
}
const rows = [
  { _row: 2, Status: 'Won', Rep: 'Alpha' },
  { _row: 3, Status: 'Lost', Rep: 'Bravo' },
  { _row: 4, Status: 'Won', Rep: 'Charlie' },
]

// --- counting and drilling must agree ------------------------------------

test('a stage counts the rows matching its conditions', () => {
  const out = getStageRows({ stage, widget: {}, rowsByTab: { [TAB]: rows } })
  assert.equal(out.count, 2)
  assert.equal(out.total, 3)
})

test('a stage whose conditions never named a tab still FILTERS, not just counts', () => {
  // The bug this exists for. Counting only ever looked at `column`, but the
  // cross-filter engine also insists a condition names its tab -- so a stage
  // migrated from v2, or written before refs existed, showed a correct
  // number and then filtered nothing at all when you clicked it.
  const legacy = { ...stage, conditions: [{ column: 'Status', operator: 'equals', value: 'Won' }] }

  assert.equal(getStageRows({ stage: legacy, widget: {}, rowsByTab: { [TAB]: rows } }).count, 2)

  const cf = {
    id: 'stage_w1_s1',
    kind: 'conditions',
    tab: legacy.tab,
    conditions: stageConditions(legacy),
    match: 'all',
  }
  assert.deepEqual(applyFilters(rows, { tab: TAB, crossFilters: [cf] }).map((r) => r._row), [2, 4])
})

test('stageConditions drops a condition with no column and keeps an explicit tab', () => {
  const mixed = {
    tab: TAB,
    conditions: [
      { column: '', operator: 'is_not_empty' },
      { tab: 'other::TAB', column: 'X', operator: 'equals', value: '1' },
    ],
  }
  assert.deepEqual(stageConditions(mixed), [
    { tab: 'other::TAB', column: 'X', operator: 'equals', value: '1' },
  ])
})

// --- the pop-up describes the stage, not the whole tab -------------------

test('the pop-up shows the stage’s own rows', () => {
  // Everything in the pop-up -- KPIs, pivot, leaderboard -- has to describe
  // the card that opened it, or its numbers can never agree with what
  // clicking them filters the dashboard to.
  const popup = getStagePopupRows({ stage, widget: {}, rowsByTab: { [TAB]: rows } })
  assert.deepEqual(popup.map((r) => r._row), [2, 4])
  assert.equal(popup.some((r) => r.Rep === 'Bravo'), false)
})

test('a stage with no conditions is its whole tab', () => {
  const all = { ...stage, conditions: [] }
  assert.deepEqual(getStagePopupRows({ stage: all, widget: {}, rowsByTab: { [TAB]: rows } }), rows)
})

test('an unfiltered pipeline reads the raw rows on both paths', () => {
  const raw = [{ _row: 9, Status: 'Won', Rep: 'Delta' }]
  const args = { stage, widget: { ignoreFilters: true }, rowsByTab: { [TAB]: rows }, rawRowsByTab: { [TAB]: raw } }
  assert.equal(getStageRows(args).count, 1)
  assert.deepEqual(getStagePopupRows(args), raw)
})

// --- drilling inside the pop-up -----------------------------------------

test('a leaderboard drill is scoped to the stage, not the whole tab', () => {
  // Clicking "Charlie" in the Won leaderboard means Charlie's WON rows, not
  // everything Charlie has ever touched.
  const cf = {
    id: 'stageval_w1_s1',
    kind: 'conditions',
    tab: TAB,
    match: 'all',
    conditions: [...stageConditions(stage), { tab: TAB, column: 'Rep', operator: 'equals', value: 'Charlie' }],
  }
  assert.deepEqual(applyFilters(rows, { tab: TAB, crossFilters: [cf] }).map((r) => r._row), [4])
})

test('not this month matches dates outside the current month and blanks', () => {
  const now = new Date()
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 5)
  const otherMonth = new Date(now.getFullYear(), now.getMonth() === 0 ? 11 : now.getMonth() - 1, 10)

  assert.equal(testCondition({ Date: currentMonth.toISOString() }, { column: 'Date', operator: 'not_this_month' }), false)
  assert.equal(testCondition({ Date: otherMonth.toISOString() }, { column: 'Date', operator: 'not_this_month' }), true)
  assert.equal(testCondition({ Date: '' }, { column: 'Date', operator: 'not_this_month' }), true)
})

test('an ANY-match stage narrows correctly when the drill stacks on it', () => {
  // "(Booked or Won) and Charlie" cannot be written as one flat condition
  // set, so the widget sends the stage as its own cross-filter and stacks
  // the narrower one on top. This is what that pair has to produce.
  const anyStage = {
    id: 's2',
    tab: TAB,
    label: 'Open or won',
    match: 'any',
    conditions: [
      { tab: TAB, column: 'Status', operator: 'equals', value: 'Won' },
      { tab: TAB, column: 'Status', operator: 'equals', value: 'Lost' },
    ],
  }
  const mixed = [...rows, { _row: 5, Status: 'Draft', Rep: 'Charlie' }]

  const out = applyFilters(mixed, {
    tab: TAB,
    crossFilters: [
      { id: 'stagewithin_w1_s2', kind: 'conditions', tab: TAB, match: 'any', conditions: stageConditions(anyStage) },
      {
        id: 'stageval_w1_s2',
        kind: 'conditions',
        tab: TAB,
        match: 'all',
        conditions: [{ tab: TAB, column: 'Rep', operator: 'equals', value: 'Charlie' }],
      },
    ],
  })
  assert.deepEqual(out.map((r) => r._row), [4], 'Charlie’s Draft row is outside the stage')
})
