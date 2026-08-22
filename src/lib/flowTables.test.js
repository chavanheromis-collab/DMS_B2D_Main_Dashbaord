import test from 'node:test'
import assert from 'node:assert/strict'

import { buildFlow, describeFlow, findFlowNode, flowCrossFilter, flowNodeCanDrill } from './flow.js'
import { applyFilters } from './filterEngine.js'

// Four tabs that know very little about each other. MODELS is a reference
// list -- a catalogue, not a transaction log.
const SALES = [
  { _row: 2, VIN: 'V1', Model: 'SPLENDOR', Amount: '70000', Finance: 'HDFC' },
  { _row: 3, VIN: 'V2', Model: 'SPLENDOR', Amount: '72000', Finance: '' },
  { _row: 4, VIN: 'V3', Model: 'HF DELUXE', Amount: '60000', Finance: 'ICICI' },
  { _row: 5, VIN: 'V4', Model: 'SCOOTER-X', Amount: '90000', Finance: '' },
]
const MODELS = [
  { Name: 'SPLENDOR' },
  { Name: 'HF DELUXE' },
  { Name: 'PASSION' }, // catalogued, sold none this month
  { Name: 'XPULSE' },
]
const SERVICE = [
  { _row: 2, 'Chassis No': 'V1', Job: 'PDI' },
  { _row: 3, 'Chassis No': 'V9', Job: 'Repair' },
]
const STAFF = [{ Name: 'Ravi' }, { Name: 'Sunil' }, { Name: 'Asha' }]

const rowsByTab = { SALES, MODELS, SERVICE, STAFF }
const widgetWith = (flow) => ({ id: 'w1', tab: 'SALES', flow })
const build = (flow, opts = {}) => buildFlow({ widget: widgetWith(flow), rowsByTab, autoExpand: 9, ...opts })
const labels = (node) => node.children.map((c) => c.label)

// --- the flow picks its own table ---------------------------------------

test('a flow can start on a tab that is not the widget’s', () => {
  const { root } = buildFlow({
    widget: { id: 'w1', tab: 'SALES', flow: { tab: 'STAFF' } },
    rowsByTab,
  })
  assert.equal(root.tab, 'STAFF')
  assert.equal(root.value, 3)
})

test('...and falls back to the widget’s tab when it does not', () => {
  assert.equal(buildFlow({ widget: widgetWith({}), rowsByTab }).root.tab, 'SALES')
})

// --- numbers, not a breakdown --------------------------------------------

const NUMBERS = {
  id: 'l_n',
  kind: 'measures',
  measures: [
    { id: 'm1', label: 'Deals', aggregation: 'count' },
    { id: 'm2', label: 'Value', aggregation: 'sum', column: 'Amount', format: 'compact' },
    {
      id: 'm3',
      label: 'Financed',
      aggregation: 'count',
      match: 'all',
      conditions: [{ column: 'Finance', operator: 'is_not_empty' }],
    },
  ],
}

test('a level can be numbers about the branch rather than a split of it', () => {
  const { root } = build({ levels: [NUMBERS] })
  assert.deepEqual(labels(root), ['Deals', 'Value', 'Financed'])
  assert.deepEqual(root.children.map((c) => c.value), [4, 292000, 2])
})

test('each number keeps its own formatting all the way to the screen', () => {
  const { root } = build({ levels: [NUMBERS] })
  assert.equal(root.children[1].measure.format, 'compact')
  assert.equal(root.children[1].measure.aggregation, 'sum')
  assert.equal(root.children[0].measure.aggregation, 'count', 'and they do not leak into each other')
})

test('a number measured differently reports its share by counting rows', () => {
  // "Value 292,000" is not 7,300,000% of "4 deals". Where the two numbers
  // are different kinds of number, the percentage counts rows instead.
  const { root } = build({ levels: [NUMBERS] })
  assert.equal(root.children[0].share, 1, 'count of the same rows: all of them')
  assert.equal(root.children[1].share, 1, 'the sum is over the same rows, so 100% of them')
  assert.equal(root.children[2].share, 0.5, 'two of the four rows are financed')
})

test('a number with conditions is still a real branch that can be opened', () => {
  const { root } = build({ levels: [NUMBERS, { id: 'l_m', kind: 'split', column: 'Model', top: 9 }] })
  const financed = findFlowNode(root, root.children[2].path)
  assert.deepEqual(labels(financed), ['SPLENDOR', 'HF DELUXE'])
  assert.deepEqual(financed.children.map((c) => c.count), [1, 1])
})

test('drilling a number filters to the rows behind it', () => {
  const { root } = build({ levels: [NUMBERS] })
  const cf = flowCrossFilter(widgetWith({}), root.children[2])
  assert.deepEqual(
    applyFilters(SALES, { tab: 'SALES', crossFilters: [cf] }).map((r) => r.VIN),
    ['V1', 'V3']
  )
})

// --- branches from a reference list ---------------------------------------

const CATALOGUE = {
  id: 'l_v',
  kind: 'values',
  tab: 'MODELS',
  column: 'Name',
  matchColumn: 'Model',
  sort: 'name_asc',
  top: 99,
}

test('a value with zero rows is still a branch', () => {
  // The whole reason this level kind exists: grouping the sales data can
  // never show PASSION, because there is nothing there to group.
  const { root } = build({ levels: [CATALOGUE] })
  assert.deepEqual(labels(root), ['HF DELUXE', 'PASSION', 'SPLENDOR', 'XPULSE', 'Not on the list'])
  const passion = root.children.find((c) => c.label === 'PASSION')
  assert.equal(passion.count, 0)
  assert.equal(passion.share, 0)
})

test('a plain breakdown of the same column cannot show it', () => {
  const { root } = build({ levels: [{ id: 'l', kind: 'split', column: 'Model', top: 99 }] })
  assert.equal(labels(root).includes('PASSION'), false)
})

test('rows whose value is not on the list are collected, not dropped', () => {
  const { root } = build({ levels: [CATALOGUE] })
  const unlisted = root.children.at(-1)
  assert.equal(unlisted.label, 'Not on the list')
  assert.deepEqual(unlisted.rows.map((r) => r.VIN), ['V4'], 'SCOOTER-X is not in the catalogue')

  const total = root.children.reduce((sum, c) => sum + c.count, 0)
  assert.equal(total, root.count, 'so the level still adds up')
})

test('empty branches can be hidden without losing the unmatched ones', () => {
  const { root } = build({ levels: [{ ...CATALOGUE, showZero: false }] })
  assert.deepEqual(labels(root), ['HF DELUXE', 'SPLENDOR', 'Not on the list'])
})

test('list values match as forgivingly as keys do', () => {
  const messy = { ...rowsByTab, MODELS: [{ Name: ' splendor ' }] }
  const { root } = buildFlow({
    widget: widgetWith({ levels: [{ ...CATALOGUE, unmatchedBucket: false }] }),
    rowsByTab: messy,
    autoExpand: 9,
  })
  assert.equal(root.children[0].count, 2, 'case and padding are not a different model')
})

test('a value branch drills to exactly its own rows', () => {
  const { root } = build({ levels: [CATALOGUE] })
  const splendor = root.children.find((c) => c.label === 'SPLENDOR')
  const cf = flowCrossFilter(widgetWith({}), splendor)
  assert.deepEqual(
    applyFilters(SALES, { tab: 'SALES', crossFilters: [cf] }).map((r) => r.VIN),
    ['V1', 'V2']
  )
})

// --- other tables, brought in whole ---------------------------------------

const OTHERS = {
  id: 'l_t',
  kind: 'tables',
  sources: [
    { id: 's1', tab: 'SERVICE', label: 'Service jobs' },
    { id: 's2', tab: 'STAFF', label: 'Team', conditions: [{ column: 'Name', operator: 'not_equals', value: 'Asha' }] },
  ],
}

test('a flow can bring in tables it is not related to at all', () => {
  const { root } = build({ levels: [OTHERS] })
  assert.deepEqual(labels(root), ['Service jobs', 'Team'])
  assert.deepEqual(root.children.map((c) => c.tab), ['SERVICE', 'STAFF'])
  assert.deepEqual(root.children.map((c) => c.count), [2, 2])
})

test('an independent branch claims no share of what it hangs from', () => {
  // 2 service jobs is not "50% of 4 sales". It is not a part of them at all,
  // and a percentage would be an invention.
  const { root } = build({ levels: [OTHERS] })
  assert.equal(root.children[0].share, null)
  assert.equal(root.children[0].shareOfRoot, null)
  assert.equal(root.children[0].dropOff, 0)
  assert.equal(root.children[0].independent, true)
})

test('a brought-in table opens into its own levels', () => {
  const { root } = build({ levels: [OTHERS, { id: 'l_j', kind: 'split', column: 'Job', top: 9 }] })
  const service = root.children[0]
  assert.deepEqual(labels(service).sort(), ['PDI', 'Repair'])
  // ...and those children ARE part of it, so they do have shares.
  assert.equal(service.children[0].share, 0.5)
})

test('an unconditioned table offers no drill, because it would filter to everything', () => {
  const { root } = build({ levels: [OTHERS] })
  assert.equal(flowNodeCanDrill(root.children[0]), false)
  assert.equal(flowCrossFilter(widgetWith({}), root.children[0]), null)
})

test('a conditioned table drills by its own conditions, on its own tab', () => {
  const { root } = build({ levels: [OTHERS] })
  const team = root.children[1]
  assert.equal(flowNodeCanDrill(team), true)
  const cf = flowCrossFilter(widgetWith({}), team)
  assert.equal(cf.kind, 'conditions')
  assert.deepEqual(applyFilters(STAFF, { tab: 'STAFF', crossFilters: [cf] }).map((r) => r.Name), ['Ravi', 'Sunil'])
  assert.equal(applyFilters(SALES, { tab: 'SALES', crossFilters: [cf] }).length, 4, 'and says nothing about sales')
})

// --- measuring a level differently ----------------------------------------

test('a level can report a different number than the one above it', () => {
  const { root } = build({
    levels: [{ id: 'l', kind: 'split', column: 'Model', top: 9, measure: { aggregation: 'sum', column: 'Amount' } }],
  })
  assert.equal(root.value, 4, 'the root still counts rows')
  assert.deepEqual(root.children.map((c) => c.value), [142000, 90000, 60000])
  assert.equal(root.children[0].measure.aggregation, 'sum')
})

test('...and its shares stay honest by counting rows', () => {
  const { root } = build({
    levels: [{ id: 'l', kind: 'split', column: 'Model', top: 9, measure: { aggregation: 'sum', column: 'Amount' } }],
  })
  // 142,000 of 4 is not a percentage. Two rows of four is.
  assert.equal(root.children[0].share, 0.5)
})

test('an override is inherited by the levels below it', () => {
  const { root } = build({
    levels: [
      { id: 'l1', kind: 'split', column: 'Model', top: 9, measure: { aggregation: 'sum', column: 'Amount' } },
      { id: 'l2', kind: 'split', column: 'Finance', top: 9 },
    ],
  })
  const splendor = root.children[0]
  assert.equal(splendor.children[0].measure.aggregation, 'sum')
  // Same measure on both sides now, so the share is the money's share.
  assert.equal(splendor.children[0].share.toFixed(3), (70000 / 142000).toFixed(3))
})

// --- the summary ----------------------------------------------------------

test('the path reads as a sentence whatever it is made of', () => {
  assert.equal(
    describeFlow(widgetWith({ levels: [NUMBERS, CATALOGUE, OTHERS] })),
    'SALES → 3 numbers → Model from MODELS → 🗂️ SERVICE + STAFF'
  )
})

test('every tab a flow touches is reported, so the page can load them', () => {
  const built = build({ levels: [CATALOGUE, OTHERS] })
  assert.deepEqual(built.tabs.sort(), ['MODELS', 'SALES', 'SERVICE', 'STAFF'])
})
