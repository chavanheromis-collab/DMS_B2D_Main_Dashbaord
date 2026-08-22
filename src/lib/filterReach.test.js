import test from 'node:test'
import assert from 'node:assert/strict'

import { applyFilters, buildKeyBridge, controlCoverage, filterTargets, keyBridgeTargets } from './filterEngine.js'

// One page, four tabs. MASTER and QUOTES both record who sold it; REVIEWS
// records only the vehicle; PARTS shares nothing at all.
const MASTER = [
  { VIN: 'V1', 'DSE Name': 'Ravi', Model: 'A' },
  { VIN: 'V2', 'DSE Name': 'Ravi', Model: 'B' },
  { VIN: 'V3', 'DSE Name': 'Sunil', Model: 'A' },
]
const QUOTES = [
  { 'Chassis No': 'V1', 'DSE Name': 'Ravi', Amount: '10' },
  { 'Chassis No': 'V3', 'DSE Name': 'Sunil', Amount: '30' },
  // A quote for a vehicle MASTER has never heard of.
  { 'Chassis No': 'V9', 'DSE Name': 'Ravi', Amount: '90' },
]
const REVIEWS = [
  { VIN: 'V1', Stars: '5' },
  { VIN: 'V3', Stars: '2' },
]
const PARTS = [{ Part: 'Brake pad' }, { Part: 'Chain' }]

const rowsByTab = { MASTER, QUOTES, REVIEWS, PARTS }
const tabColumns = {
  MASTER: ['VIN', 'DSE Name', 'Model'],
  QUOTES: ['Chassis No', 'DSE Name', 'Amount'],
  REVIEWS: ['VIN', 'Stars'],
  PARTS: ['Part'],
}

const dse = (extra) => ({
  id: 'f1',
  kind: 'select',
  tab: 'MASTER',
  column: 'DSE Name',
  label: 'DSE',
  ...extra,
})

/** The whole page, filtered the way the dashboard does it. */
function runPage(filter, value) {
  const values = { f1: value }
  const first = {}
  for (const [tab, rows] of Object.entries(rowsByTab)) {
    first[tab] = applyFilters(rows, { tab, filters: [filter], values, tabColumns })
  }
  const bridge = buildKeyBridge({ filter, sourceRows: first[filter.tab], tabColumns })
  if (!bridge) return first

  const out = {}
  for (const [tab, rows] of Object.entries(first)) {
    out[tab] = applyFilters(rows, { tab, crossFilters: [bridge] })
  }
  return out
}

const counts = (page) => Object.fromEntries(Object.entries(page).map(([tab, rows]) => [tab, rows.length]))

// --- the default: say what you mean --------------------------------------

test('by default a control touches only the tab it names', () => {
  assert.deepEqual(counts(runPage(dse(), 'Ravi')), { MASTER: 2, QUOTES: 3, REVIEWS: 2, PARTS: 2 })
})

test('a hand-bound tab is narrowed on the column the admin chose', () => {
  const filter = dse({ links: [{ tab: 'QUOTES', column: 'DSE Name' }] })
  assert.deepEqual(counts(runPage(filter, 'Ravi')), { MASTER: 2, QUOTES: 2, REVIEWS: 2, PARTS: 2 })
})

// --- auto: every tab that has the column ---------------------------------

test('“every tab with this column” needs no links at all', () => {
  assert.deepEqual(counts(runPage(dse({ reach: 'auto' }), 'Ravi')), {
    MASTER: 2,
    QUOTES: 2,
    // Neither of these has a DSE Name column, so neither can be narrowed
    // by one -- silence, not an empty table.
    REVIEWS: 2,
    PARTS: 2,
  })
})

test('an explicit binding still wins over the guess', () => {
  // QUOTES has its own "DSE Name", but the admin pointed the control at a
  // different column there on purpose.
  const filter = dse({ reach: 'auto', links: [{ tab: 'QUOTES', column: 'Amount' }] })
  const targets = filterTargets(filter, tabColumns)
  assert.deepEqual(targets.find((t) => t.tab === 'QUOTES'), { tab: 'QUOTES', column: 'Amount' })
  assert.equal(targets.filter((t) => t.tab === 'QUOTES').length, 1, 'and it is not bound twice')
})

test('without the page’s columns, auto behaves like named', () => {
  // Every caller that does not pass tabColumns -- and there are several --
  // must keep the old behaviour exactly.
  assert.deepEqual(filterTargets(dse({ reach: 'auto' })), [{ tab: 'MASTER', column: 'DSE Name' }])
})

// --- key: the whole page -------------------------------------------------

const bridged = dse({ reach: 'key', keyColumn: 'VIN', keyLinks: [{ tab: 'QUOTES', column: 'Chassis No' }] })

test('a key carries the filter to tabs that have no such column', () => {
  // REVIEWS has no DSE Name. It does have Ravi's two VINs -- one of which
  // has a review.
  assert.deepEqual(counts(runPage(bridged, 'Ravi')), { MASTER: 2, QUOTES: 2, REVIEWS: 1, PARTS: 2 })
})

test('a tab sharing nothing is still left alone', () => {
  // The rule the whole engine follows: a filter with nothing to say about a
  // tab says nothing, rather than emptying it.
  assert.equal(runPage(bridged, 'Sunil').PARTS.length, 2)
})

test('the bridge skips tabs the column already reached', () => {
  // QUOTES matches by its own DSE Name, so it keeps Ravi's quote for V9 --
  // a vehicle MASTER has never heard of. Intersecting it with MASTER's keys
  // would silently delete a row that genuinely belongs in the view.
  const page = runPage(bridged, 'Ravi')
  assert.deepEqual(page.QUOTES.map((r) => r['Chassis No']), ['V1', 'V9'])
  assert.deepEqual(keyBridgeTargets(bridged, tabColumns), [{ tab: 'REVIEWS', column: 'VIN' }])
})

test('a key column called something else on the other tab is mapped once', () => {
  // Here QUOTES has no DSE Name, so the bridge has to reach it -- by the
  // Chassis No the admin mapped.
  const quotesNoDse = { ...tabColumns, QUOTES: ['Chassis No', 'Amount'] }
  assert.deepEqual(keyBridgeTargets(bridged, quotesNoDse), [
    { tab: 'QUOTES', column: 'Chassis No' },
    { tab: 'REVIEWS', column: 'VIN' },
  ])
})

test('a filter that selects nothing empties what it reaches, and only that', () => {
  const page = runPage(bridged, 'Nobody')
  assert.equal(page.MASTER.length, 0)
  assert.equal(page.REVIEWS.length, 0, 'bridged, so it follows the source into empty')
  assert.equal(page.PARTS.length, 2, 'unreachable, so untouched')
})

test('the bridge reads the source AFTER every other control has run', () => {
  // Two controls: DSE = Ravi, and Model = B. Between them only V2 survives
  // on MASTER, so the review of V1 must go too -- otherwise a "page filter"
  // would show a review for a vehicle the page is no longer showing.
  const model = { id: 'f2', kind: 'select', tab: 'MASTER', column: 'Model' }
  const values = { f1: 'Ravi', f2: 'B' }
  const filters = [bridged, model]

  const first = {}
  for (const [tab, rows] of Object.entries(rowsByTab)) {
    first[tab] = applyFilters(rows, { tab, filters, values, tabColumns })
  }
  const bridge = buildKeyBridge({ filter: bridged, sourceRows: first.MASTER, tabColumns })
  assert.deepEqual(first.MASTER.map((r) => r.VIN), ['V2'])
  assert.equal(applyFilters(first.REVIEWS, { tab: 'REVIEWS', crossFilters: [bridge] }).length, 0)
})

test('keys are matched the same forgiving way everywhere else', () => {
  const messy = { ...rowsByTab, REVIEWS: [{ VIN: ' v1 ' }, { VIN: 'V3' }] }
  const first = applyFilters(messy.MASTER, { tab: 'MASTER', filters: [bridged], values: { f1: 'Ravi' }, tabColumns })
  const bridge = buildKeyBridge({ filter: bridged, sourceRows: first, tabColumns })
  assert.equal(applyFilters(messy.REVIEWS, { tab: 'REVIEWS', crossFilters: [bridge] }).length, 1)
})

test('no key column means no bridge, rather than a broken one', () => {
  assert.equal(buildKeyBridge({ filter: dse({ reach: 'key' }), sourceRows: MASTER, tabColumns }), null)
})

// --- what the admin is shown ---------------------------------------------

test('coverage names how every tab is reached', () => {
  assert.deepEqual(controlCoverage(bridged, tabColumns), [
    { tab: 'MASTER', via: 'own', column: 'DSE Name' },
    { tab: 'QUOTES', via: 'column', column: 'DSE Name' },
    { tab: 'REVIEWS', via: 'key', column: 'VIN' },
    { tab: 'PARTS', via: 'none', column: null },
  ])
})

test('coverage distinguishes a hand-bound tab from a guessed one', () => {
  const filter = dse({ links: [{ tab: 'QUOTES', column: 'Amount' }] })
  const byTab = Object.fromEntries(controlCoverage(filter, tabColumns).map((r) => [r.tab, r.via]))
  assert.equal(byTab.QUOTES, 'link')
  assert.equal(byTab.REVIEWS, 'none')
})

test('coverage agrees with what the page actually does', () => {
  // The report is only worth showing if it cannot drift from the engine.
  for (const filter of [dse(), dse({ reach: 'auto' }), bridged]) {
    const page = runPage(filter, 'Ravi')
    for (const row of controlCoverage(filter, tabColumns)) {
      const narrowed = page[row.tab].length < rowsByTab[row.tab].length
      if (row.via === 'none') assert.equal(narrowed, false, `${row.tab} was narrowed but reported as untouched`)
    }
  }
})
