import test from 'node:test'
import assert from 'node:assert/strict'

import { describeScope, resolveScope, resolveValue, rowInScope, scopeFilter, scopeIsActive } from './userScope.js'
import { applyFilters } from './filterEngine.js'

const SALES = [
  { _row: 2, Region: 'West', DSE: 'ravi@x.com', Amount: '100' },
  { _row: 3, Region: 'East', DSE: 'asha@x.com', Amount: '200' },
  { _row: 4, Region: 'West', DSE: 'asha@x.com', Amount: '300' },
]
const REVIEWS = [{ Stars: '5' }, { Stars: '2' }]

const ravi = { email: 'ravi@x.com', name: 'Ravi', jobRole: 'Sales Executive', uid: 'u1' }
const west = { match: 'all', conditions: [{ tab: 'SALES', column: 'Region', operator: 'equals', value: 'West' }] }
const mine = { match: 'all', conditions: [{ tab: 'SALES', column: 'DSE', operator: 'equals', value: '{{email}}' }] }

const run = (scope, user, rows = SALES, tab = 'SALES') =>
  applyFilters(rows, { tab, crossFilters: [scopeFilter(scope, user)].filter(Boolean) })

// --- the plain case -------------------------------------------------------

test('a scope narrows the page to the rows it names', () => {
  assert.deepEqual(run(west, ravi).map((r) => r._row), [2, 4])
})

test('a tab the scope says nothing about is left alone', () => {
  // The rule the whole engine follows: silence, not an empty table.
  assert.equal(run(west, ravi, REVIEWS, 'REVIEWS').length, 2)
})

test('no scope is no filter', () => {
  assert.equal(scopeFilter({ conditions: [] }, ravi), null)
  assert.equal(scopeFilter(null, ravi), null)
  assert.equal(scopeIsActive({ conditions: [{ column: 'A' }] }), false, 'a condition with no tab is not a scope')
})

test('several conditions can be ALL or ANY', () => {
  const both = {
    match: 'all',
    conditions: [
      { tab: 'SALES', column: 'Region', operator: 'equals', value: 'West' },
      { tab: 'SALES', column: 'DSE', operator: 'equals', value: 'asha@x.com' },
    ],
  }
  assert.deepEqual(run(both, ravi).map((r) => r._row), [4])
  assert.deepEqual(run({ ...both, match: 'any' }, ravi).map((r) => r._row), [2, 3, 4])
})

test('it stacks with the page’s own filters rather than replacing them', () => {
  const out = applyFilters(SALES, {
    tab: 'SALES',
    crossFilters: [scopeFilter(west, ravi)],
    filters: [{ id: 'f', kind: 'select', tab: 'SALES', column: 'DSE' }],
    values: { f: 'asha@x.com' },
  })
  assert.deepEqual(out.map((r) => r._row), [4])
})

// --- one rule for everybody ----------------------------------------------

test('a token stands for whoever is signed in', () => {
  // The point: one rule on the page, forty reps each seeing their own rows.
  assert.deepEqual(run(mine, ravi).map((r) => r._row), [2])
  assert.deepEqual(run(mine, { ...ravi, email: 'asha@x.com' }).map((r) => r._row), [3, 4])
})

test('every token resolves from the signed-in user', () => {
  assert.equal(resolveValue('{{email}}', ravi), 'ravi@x.com')
  assert.equal(resolveValue('{{name}}', ravi), 'Ravi')
  assert.equal(resolveValue('{{jobRole}}', ravi), 'Sales Executive')
  assert.equal(resolveValue('{{uid}}', ravi), 'u1')
  assert.equal(resolveValue('  {{ email }}  ', ravi), '  ravi@x.com  ', 'spaces inside the braces are fine')
})

test('a token can sit inside other text', () => {
  assert.equal(resolveValue('branch-{{jobRole}}', ravi), 'branch-Sales Executive')
})

test('a plain value is left exactly alone', () => {
  assert.equal(resolveValue('West', ravi), 'West')
  assert.equal(resolveValue('', ravi), '')
  assert.equal(resolveValue(undefined, ravi), '')
})

// --- failing closed -------------------------------------------------------

test('a token with nothing to stand for shows NOTHING, not everything', () => {
  // The rule this exists for. Row-level security that degrades into "all
  // rows" on a missing field is how a leak happens quietly.
  const noRole = { ...ravi, jobRole: '' }
  const byRole = {
    match: 'all',
    conditions: [{ tab: 'SALES', column: 'Region', operator: 'equals', value: '{{jobRole}}' }],
  }
  assert.equal(resolveValue('{{jobRole}}', noRole), null)
  assert.equal(resolveScope(byRole, noRole).blocked, true)
  assert.equal(run(byRole, noRole).length, 0)
})

test('a blocked scope empties only the tabs it named', () => {
  const noRole = { ...ravi, jobRole: '' }
  const byRole = {
    match: 'all',
    conditions: [{ tab: 'SALES', column: 'Region', operator: 'equals', value: '{{jobRole}}' }],
  }
  assert.equal(run(byRole, noRole, REVIEWS, 'REVIEWS').length, 2, 'a tab it never mentioned is still untouched')
})

test('no signed-in user at all is also nothing', () => {
  assert.equal(run(mine, null).length, 0)
  assert.equal(run(mine, {}).length, 0)
})

// --- the odds and ends ----------------------------------------------------

test('a two-value operator resolves both sides', () => {
  const scope = {
    match: 'all',
    conditions: [{ tab: 'SALES', column: 'Amount', operator: 'between', value: '150', value2: '400' }],
  }
  assert.deepEqual(run(scope, ravi).map((r) => r._row), [3, 4])
})

test('rowInScope answers for one row at a time', () => {
  assert.equal(rowInScope(SALES[0], west, ravi, 'SALES'), true)
  assert.equal(rowInScope(SALES[1], west, ravi, 'SALES'), false)
  assert.equal(rowInScope(REVIEWS[0], west, ravi, 'REVIEWS'), true, 'a tab it says nothing about')
})

test('the summary reads as a sentence', () => {
  assert.equal(describeScope(west), 'SALES · Region equals West')
  assert.equal(
    describeScope({
      match: 'any',
      conditions: [
        { tab: 'SALES', column: 'Region', operator: 'equals', value: 'West' },
        { tab: 'SALES', column: 'Region', operator: 'equals', value: 'East' },
      ],
    }),
    'SALES · Region equals West or SALES · Region equals East'
  )
  assert.equal(describeScope({ conditions: [] }), '')
})

test('a scope carries a marker, so nothing mistakes it for a drill', () => {
  // It must never appear as a removable chip: it is the extent of somebody's
  // data, not a filter they applied.
  assert.equal(scopeFilter(west, ravi).scope, true)
})
