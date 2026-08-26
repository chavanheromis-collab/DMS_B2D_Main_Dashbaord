import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyFilters,
  buildKeyBridge,
  buttonConditionsFor,
  controlCoverage,
  filterTargets,
  keyBridgeTargets,
} from './filterEngine.js'

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

// ---------------------------------------------------------------------
// A button reaches the same three ways
// ---------------------------------------------------------------------
// It says what it wants in CONDITIONS rather than in one column, which is
// how one has always been able to narrow several tabs. What it could not do
// is reach a tab nobody wrote a condition for.

const BUTTON = {
  id: 'b1',
  kind: 'button',
  tab: 'MASTER',
  label: 'Ravi',
  match: 'all',
  conditions: [{ tab: 'MASTER', column: 'DSE Name', operator: 'equals', value: 'Ravi' }],
}

const pageWith = (button) => {
  const out = {}
  for (const [tab, rows] of Object.entries(rowsByTab)) {
    out[tab] = applyFilters(rows, { tab, buttons: [button], activeIds: ['b1'], tabColumns })
  }
  return out
}

test('a button still touches only the tabs its conditions name', () => {
  // The default, and what every button did before it had a choice.
  const page = pageWith(BUTTON)
  assert.equal(page.MASTER.length, 2)
  assert.equal(page.QUOTES.length, QUOTES.length, 'untouched')
  assert.equal(page.REVIEWS.length, REVIEWS.length, 'untouched')
})

test('a button can reach every tab with a column of that name', () => {
  const page = pageWith({ ...BUTTON, reach: 'auto' })
  assert.equal(page.MASTER.length, 2)
  assert.equal(page.QUOTES.length, 2, 'QUOTES has its own DSE Name')
  assert.equal(page.REVIEWS.length, REVIEWS.length, 'REVIEWS has no such column, so it is left alone')
  assert.equal(page.PARTS.length, PARTS.length)
})

test('a button can be bound by hand to a differently-named column', () => {
  const bound = { ...BUTTON, links: [{ tab: 'QUOTES', column: 'DSE Name' }] }
  assert.deepEqual(filterTargets(bound, tabColumns), [
    { tab: 'MASTER', column: 'DSE Name' },
    { tab: 'QUOTES', column: 'DSE Name' },
  ])
  assert.equal(pageWith(bound).QUOTES.length, 2)
})

test('a hand-bound tab keeps its binding when the reach spreads', () => {
  // Guessing over an explicit instruction is never right: an admin who
  // pointed a tab at a differently-named column meant it.
  const bound = {
    ...BUTTON,
    reach: 'auto',
    links: [{ tab: 'QUOTES', column: 'Amount' }],
  }
  const targets = filterTargets(bound, tabColumns).filter((t) => t.tab === 'QUOTES')
  assert.deepEqual(targets, [{ tab: 'QUOTES', column: 'Amount' }])
})

test('a link with no column of its own applies to every condition', () => {
  // Which is what a one-column button wants, and what its editor writes.
  const two = {
    ...BUTTON,
    conditions: [
      { tab: 'MASTER', column: 'DSE Name', operator: 'equals', value: 'Ravi' },
      { tab: 'MASTER', column: 'Model', operator: 'equals', value: 'A' },
    ],
    links: [{ tab: 'QUOTES', column: 'DSE Name' }],
  }
  const conds = buttonConditionsFor(two, 'QUOTES', tabColumns)
  assert.equal(conds.length, 2)
  for (const c of conds) assert.equal(c.column, 'DSE Name')
})

test('a link that names a column stands in for that one only', () => {
  const two = {
    ...BUTTON,
    conditions: [
      { tab: 'MASTER', column: 'DSE Name', operator: 'equals', value: 'Ravi' },
      { tab: 'MASTER', column: 'Model', operator: 'equals', value: 'A' },
    ],
    links: [{ tab: 'QUOTES', from: 'DSE Name', column: 'DSE Name' }],
  }
  const conds = buttonConditionsFor(two, 'QUOTES', tabColumns)
  assert.equal(conds.length, 1)
  assert.equal(conds[0].column, 'DSE Name')
})

test('a button carries to the tabs it could not reach, by key', () => {
  // REVIEWS has no DSE Name, but it has a VIN, and the VINs Ravi sold are
  // knowable -- which is the whole of "show me the page as it is for Ravi".
  const key = { ...BUTTON, reach: 'key', keyColumn: 'VIN' }
  assert.deepEqual(keyBridgeTargets(key, tabColumns), [{ tab: 'REVIEWS', column: 'VIN' }])

  const first = pageWith(key)
  const bridge = buildKeyBridge({ filter: key, sourceRows: first.MASTER, tabColumns })
  const reviews = applyFilters(first.REVIEWS, { tab: 'REVIEWS', crossFilters: [bridge] })
  assert.deepEqual(reviews.map((r) => r.VIN), ['V1'])
})

test('a tab a button already matched by column is not ALSO cut by the keys', () => {
  // A quote for a vehicle MASTER has never heard of still belongs in a
  // "DSE = Ravi" view, and would silently vanish otherwise.
  const key = { ...BUTTON, reach: 'key', keyColumn: 'VIN' }
  assert.ok(!keyBridgeTargets(key, tabColumns).some((t) => t.tab === 'QUOTES'))
})

test('a tab sharing neither the column nor the key is left completely alone', () => {
  // That rule never bends, however far a button is told to reach.
  const key = { ...BUTTON, reach: 'key', keyColumn: 'VIN' }
  const page = pageWith(key)
  assert.equal(page.PARTS.length, PARTS.length)
  assert.ok(!keyBridgeTargets(key, tabColumns).some((t) => t.tab === 'PARTS'))
})

test('the coverage strip answers for a button too', () => {
  // "Will this actually narrow my other table?" is otherwise only
  // discoverable by saving and looking.
  const key = { ...BUTTON, reach: 'key', keyColumn: 'VIN', links: [{ tab: 'QUOTES', column: 'DSE Name' }] }
  const by = Object.fromEntries(controlCoverage(key, tabColumns).map((r) => [r.tab, r.via]))
  assert.equal(by.MASTER, 'own')
  assert.equal(by.QUOTES, 'link')
  assert.equal(by.REVIEWS, 'key')
  assert.equal(by.PARTS, 'none')
})

test('what the coverage strip promises is what the page does — for buttons', () => {
  for (const reach of ['named', 'auto', 'key']) {
    const button = { ...BUTTON, reach, keyColumn: 'VIN' }
    const first = pageWith(button)
    const bridge = reach === 'key' ? buildKeyBridge({ filter: button, sourceRows: first.MASTER, tabColumns }) : null

    for (const row of controlCoverage(button, tabColumns)) {
      const rows = bridge
        ? applyFilters(first[row.tab], { tab: row.tab, crossFilters: [bridge] })
        : first[row.tab]
      const narrowed = rows.length < rowsByTab[row.tab].length
      if (row.via === 'none') assert.equal(narrowed, false, `${reach}: ${row.tab} was narrowed but reported untouched`)
    }
  }
})

test('a button with nothing to say about a tab says nothing', () => {
  // Silence, not an empty table -- whatever its reach is set to.
  for (const reach of ['named', 'auto', 'key']) {
    const conds = buttonConditionsFor({ ...BUTTON, reach, keyColumn: 'VIN' }, 'PARTS', tabColumns)
    assert.deepEqual(conds, [], reach)
  }
})

// --- wiring ---------------------------------------------------------------

import fs from 'node:fs'
import path from 'node:path'

const read = (p) =>
  fs
    .readFileSync(path.join(path.resolve(import.meta.dirname, '..'), p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

test('the page builds a button’s key bridge the same way it builds a control’s', () => {
  // From its own tab, after the first pass, so every other control on the
  // page has already narrowed the keys it carries.
  const dashboard = read('pages/Dashboard.jsx')
  assert.ok(dashboard.includes("if (button.reach !== 'key') continue"))
  assert.ok(dashboard.includes('buildKeyBridge({ filter: button, sourceRows: first[button.tab] || [], tabColumns })'))
})

test('the reach editor is no longer for filters only', () => {
  const panel = read('pages/admin/ControlsPanel.jsx')
  // The block used to be hidden from buttons entirely.
  // The reach block itself is no longer behind an isButton gate. Checked by
  // looking at what comes immediately BEFORE it rather than at the file as a
  // whole -- other blocks are legitimately for filters only.
  const at = panel.indexOf('<Field label="How far this reaches"')
  assert.ok(at > 0)
  assert.ok(!panel.slice(Math.max(0, at - 300), at).includes('isButton'))
  assert.ok(panel.includes("'Only the tabs its conditions name'"), 'and it reads as a button would say it')
  assert.ok(panel.includes('function conditionColumns(control)'))
  assert.ok(
    panel.includes('isButton(control) && conditionColumns(control).length > 1'),
    'a one-column button is not asked which column a link stands in for'
  )
})
