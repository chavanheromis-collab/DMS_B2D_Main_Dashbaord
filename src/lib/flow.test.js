import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_FLOW,
  buildFlow,
  describeFlow,
  findFlowNode,
  flattenFlow,
  flowCrossFilter,
  flowNodeIsDrilled,
} from './flow.js'
import { applyFilters } from './filterEngine.js'

// A small dealership: vehicles on one tab, service jobs on another, and a
// third tab that knows nothing about the flow but shares the VIN column.
const STOCK = [
  { _row: 2, VIN: 'V1', Model: 'SPLENDOR +', Yard: 'Pune', Days: '120', Amount: '70000' },
  { _row: 3, VIN: 'V2', Model: 'SPLENDOR +', Yard: 'Pune', Days: '20', Amount: '72000' },
  { _row: 4, VIN: 'V3', Model: 'SPLENDOR +', Yard: 'Nashik', Days: '5', Amount: '71000' },
  { _row: 5, VIN: 'V4', Model: 'HF DELUXE', Yard: '', Days: '200', Amount: '60000' },
  { _row: 6, VIN: 'V5', Model: 'HF DELUXE', Yard: 'Pune', Days: '10', Amount: '61000' },
  { _row: 7, VIN: 'V6', Model: 'PASSION +', Yard: 'Nashik', Days: '95', Amount: '80000' },
  { _row: 8, VIN: 'V7', Model: 'XPULSE', Yard: 'Pune', Days: '3', Amount: '150000' },
]

const SERVICE = [
  { _row: 2, 'Chassis No': 'V1', Job: 'PDI' },
  { _row: 3, 'Chassis No': 'V1', Job: 'Repair' },
  { _row: 4, 'Chassis No': 'V2', Job: 'PDI' },
  { _row: 5, 'Chassis No': 'V9', Job: 'PDI' },
]

const FEEDBACK = [
  { VIN: 'V1', Stars: '5' },
  { VIN: 'V4', Stars: '2' },
]

const rowsByTab = { STOCK, SERVICE, FEEDBACK }

const widgetWith = (flow) => ({ id: 'w1', tab: 'STOCK', flow })
const build = (flow, opts = {}) => buildFlow({ widget: widgetWith(flow), rowsByTab, ...opts })
const labels = (node) => node.children.map((c) => c.label)
const openAll = { autoExpand: 9 }

const splitBy = (column, extra = {}) => ({ id: `l_${column}`, kind: 'split', column, ...extra })

// --- the shape ---------------------------------------------------------

test('a flow with no levels is just the number', () => {
  const { root, depth } = build({})
  assert.equal(depth, 0)
  assert.equal(root.value, 7)
  assert.equal(root.hasChildren, false)
})

test('one level opens into its values, biggest first', () => {
  const { root } = build({ levels: [splitBy('Model', { top: 10 })] })
  assert.deepEqual(labels(root), ['SPLENDOR +', 'HF DELUXE', 'PASSION +', 'XPULSE'])
  assert.deepEqual(root.children.map((c) => c.value), [3, 2, 1, 1])
})

test('a closed branch is not computed at all', () => {
  // Depth on demand is the whole interaction, not an optimisation: three
  // levels of eight would otherwise be built before anything is drawn.
  const { root } = build({ levels: [splitBy('Model'), splitBy('Yard')] })
  assert.equal(root.children.length, 4)
  assert.equal(root.children[0].hasChildren, true)
  assert.equal(root.children[0].children.length, 0, 'not opened, so not built')

  const opened = build({ levels: [splitBy('Model'), splitBy('Yard')] }, { expanded: new Set(['/SPLENDOR +']) })
  assert.deepEqual(labels(findFlowNode(opened.root, '/SPLENDOR +')), ['Pune', 'Nashik'])
})

test('every level adds up to the branch above it', () => {
  // The property that makes a drill path trustworthy: nothing is silently
  // dropped, however narrow the top-N is.
  const { root } = build({ levels: [splitBy('Model', { top: 2 })] })
  assert.deepEqual(labels(root), ['SPLENDOR +', 'HF DELUXE', 'Other (2)'])
  const summed = root.children.reduce((sum, c) => sum + c.value, 0)
  assert.equal(summed, root.value)
})

test('blanks get a branch instead of vanishing', () => {
  // A chart grouped by Yard would simply lose V4. Here it is the branch
  // most worth looking at.
  const { root } = build({ levels: [splitBy('Yard')] })
  assert.deepEqual(labels(root), ['Pune', 'Nashik', '(blank)'])
  assert.equal(root.children.at(-1).count, 1)

  const without = build({ levels: [splitBy('Yard', { includeBlanks: false })] })
  assert.deepEqual(labels(without.root), ['Pune', 'Nashik'])
})

test('a share is measured against the parent, and drop-off is its complement', () => {
  const { root } = build({ levels: [splitBy('Model', { top: 10 })] })
  const splendor = root.children[0]
  assert.equal(splendor.share.toFixed(3), (3 / 7).toFixed(3))
  assert.equal(splendor.dropOff.toFixed(3), (4 / 7).toFixed(3))
  assert.equal(root.share, 1)
})

test('a share of the root survives two levels down', () => {
  const { root } = build(
    { levels: [splitBy('Model', { top: 10 }), splitBy('Yard')] },
    { autoExpand: 9 }
  )
  const pune = findFlowNode(root, '/SPLENDOR +/Pune')
  assert.equal(pune.count, 2)
  assert.equal(pune.share.toFixed(3), (2 / 3).toFixed(3), 'two of the three SPLENDORs')
  assert.equal(pune.shareOfRoot.toFixed(3), (2 / 7).toFixed(3), 'two of the seven vehicles')
})

test('a non-additive measure falls back to counting for its share', () => {
  // The average of a branch is not a share of the average of its parent.
  // Showing "avg 42 = 130% of parent" would be worse than showing nothing.
  const { root } = build({
    measure: { aggregation: 'avg', column: 'Amount' },
    levels: [splitBy('Model', { top: 10 })],
  })
  assert.equal(root.additive, false)
  // Sorting still follows the measure, so the priciest model leads.
  assert.equal(root.children[0].label, 'XPULSE')
  assert.equal(Math.round(root.children[0].value), 150000, 'the measure itself is still the average')
  const splendor = root.children.find((c) => c.label === 'SPLENDOR +')
  assert.equal(splendor.share.toFixed(3), (3 / 7).toFixed(3), 'but the share counts rows')
})

// --- branching on conditions -------------------------------------------

const AGEING = {
  id: 'l_age',
  kind: 'rules',
  exclusive: true,
  elseBranch: true,
  elseLabel: 'Fresh',
  branches: [
    { id: 'b1', label: 'Over 90 days', match: 'all', conditions: [{ column: 'Days', operator: 'gt', value: '90' }] },
    { id: 'b2', label: 'Over 30 days', match: 'all', conditions: [{ column: 'Days', operator: 'gt', value: '30' }] },
  ],
}

test('an exclusive level puts every row in exactly one branch', () => {
  const { root } = build({ levels: [AGEING] })
  assert.deepEqual(labels(root), ['Over 90 days', 'Over 30 days', 'Fresh'])
  assert.deepEqual(root.children.map((c) => c.count), [3, 0, 4])
  assert.equal(
    root.children.reduce((sum, c) => sum + c.count, 0),
    root.count,
    'first match wins, so the level still reconciles'
  )
})

test('an overlapping level lets a row be in several branches', () => {
  const { root } = build({ levels: [{ ...AGEING, exclusive: false, elseBranch: false }] })
  // The same three rows are over 90 and over 30, so overlapping mode counts
  // them twice and the level no longer adds up to its parent -- which is
  // the trade the admin is making by turning exclusivity off.
  assert.deepEqual(root.children.map((c) => c.count), [3, 3])
  const inBoth = root.children.every((c) => c.rows.some((r) => r.VIN === 'V1'))
  assert.equal(inBoth, true, 'V1 is over 90 days AND over 30, and now appears in both')
})

test('“everything else” disappears when nothing is left over', () => {
  const { root } = build({
    levels: [
      {
        ...AGEING,
        branches: [{ id: 'b1', label: 'Anything', match: 'all', conditions: [{ column: 'VIN', operator: 'is_not_empty' }] }],
      },
    ],
  })
  assert.deepEqual(labels(root), ['Anything'])
})

test('a branch can stop the flow for itself alone', () => {
  const levels = [
    {
      ...AGEING,
      branches: [
        { ...AGEING.branches[0], stop: true },
        AGEING.branches[1],
      ],
    },
    splitBy('Yard'),
  ]
  const { root } = build({ levels }, openAll)
  assert.equal(root.children[0].hasChildren, false, 'aged stock is not broken down further')
  assert.equal(root.children.at(-1).hasChildren, true, 'the rest still is')
})

// --- crossing tabs ------------------------------------------------------

const HOP = { id: 'l_hop', kind: 'hop', tab: 'SERVICE', fromKey: 'VIN', toKey: 'Chassis No', label: 'Service jobs' }

test('a hop continues the flow on another tab', () => {
  const { root } = build({ levels: [splitBy('Model', { top: 10 }), HOP] }, openAll)
  const jobs = findFlowNode(root, '/SPLENDOR +/__hop:SERVICE')
  assert.equal(jobs.tab, 'SERVICE')
  // Three vehicles, three service jobs -- and V9's job belongs to no vehicle
  // in this branch, so it is correctly absent.
  assert.equal(jobs.count, 3)
  assert.equal(jobs.hopped, true)
})

test('a hop can fan out past its parent, which is the point of showing it', () => {
  const { root } = build({ levels: [HOP] }, openAll)
  const jobs = root.children[0]
  assert.equal(root.count, 7)
  assert.equal(jobs.count, 3, 'seven vehicles, three jobs between them')
  assert.ok(jobs.share < 1)
})

test('levels after a hop read the new tab', () => {
  const { root } = build({ levels: [HOP, splitBy('Job')] }, openAll)
  const jobs = findFlowNode(root, '/__hop:SERVICE')
  assert.deepEqual(labels(jobs).sort(), ['PDI', 'Repair'])
})

// --- what a click does to the page --------------------------------------

const runFilter = (rows, tab, cf) => applyFilters(rows, { tab, crossFilters: [cf] })

test('a drill reselects exactly the rows of the branch it came from', () => {
  // The strongest thing this can promise: the filter the tree emits and the
  // rows the tree counted are the same set. Anything less and the page
  // disagrees with the number that was clicked.
  const { root } = build({ levels: [splitBy('Model', { top: 10 }), splitBy('Yard')] }, openAll)

  for (const node of flattenFlow(root).filter((n) => n.level > 0)) {
    const cf = flowCrossFilter(widgetWith({}), node)
    const got = runFilter(STOCK, 'STOCK', cf)
    assert.deepEqual(
      got.map((r) => r.VIN).sort(),
      node.rows.map((r) => r.VIN).sort(),
      `${node.trail.join(' → ')} did not reselect its own rows`
    )
  }
})

test('the “Other” bucket reselects the tail, not the head', () => {
  const { root } = build({ levels: [splitBy('Model', { top: 2 })] })
  const other = root.children.at(-1)
  const cf = flowCrossFilter(widgetWith({}), other)
  assert.deepEqual(runFilter(STOCK, 'STOCK', cf).map((r) => r.VIN).sort(), ['V6', 'V7'])
})

test('a branch an AND list cannot describe falls back to row identity', () => {
  // "Over 30 days AND not over 90" has no flat form, so the node drills by
  // sheet row instead -- exact, and still only touching its own tab.
  const { root } = build({ levels: [{ ...AGEING, branches: [AGEING.branches[0], { ...AGEING.branches[1] }] }] })
  const second = root.children[1]
  assert.equal(second.mergeable, false)

  const cf = flowCrossFilter(widgetWith({}), second)
  assert.equal(cf.kind, 'keys')
  assert.deepEqual(cf.keyColumns, [{ tab: 'STOCK', column: '_row' }])
  assert.deepEqual(cf.keyNames, [], 'a row number means nothing on another tab')
  assert.equal(runFilter(FEEDBACK, 'FEEDBACK', cf).length, 2, 'so other tabs are left alone')
})

test('the first branch of an exclusive level is still a readable condition', () => {
  const { root } = build({ levels: [AGEING] })
  const cf = flowCrossFilter(widgetWith({}), root.children[0])
  assert.equal(cf.kind, 'conditions')
  assert.deepEqual(runFilter(STOCK, 'STOCK', cf).map((r) => r.VIN), ['V1', 'V4', 'V6'])
})

test('a drill from below a hop travels by key, across the whole page', () => {
  const { root } = build({ levels: [HOP, splitBy('Job')] }, openAll)
  const pdi = findFlowNode(root, '/__hop:SERVICE/PDI')
  const cf = flowCrossFilter(widgetWith({}), pdi)

  assert.equal(cf.kind, 'keys')
  // On its own tab the branch stays exact -- V1's other job is NOT selected,
  // because the conditions travel with the keys.
  assert.deepEqual(runFilter(SERVICE, 'SERVICE', cf).map((r) => r._row), [2, 4])
  // ...and the tabs that never appear in the flow follow it too, because
  // they carry the same key column. There the branch means "the vehicles
  // this is about", which is the only thing it can mean over there.
  assert.deepEqual(runFilter(STOCK, 'STOCK', cf).map((r) => r.VIN), ['V1', 'V2'])
  assert.deepEqual(runFilter(FEEDBACK, 'FEEDBACK', cf).map((r) => r.VIN), ['V1'])
})

test('two branches of one flow replace each other rather than stacking', () => {
  const { root } = build({ levels: [splitBy('Model', { top: 10 })] })
  const a = flowCrossFilter(widgetWith({}), root.children[0])
  const b = flowCrossFilter(widgetWith({}), root.children[1])
  assert.equal(a.id, b.id, 'one id per flow')
  assert.notEqual(a.value, b.value, 'but a different selection, so the page swaps them')
})

test('a node knows when it is the one driving the page', () => {
  const { root } = build({ levels: [splitBy('Model', { top: 10 })] })
  const node = root.children[0]
  const cf = flowCrossFilter(widgetWith({}), node)
  assert.equal(flowNodeIsDrilled(widgetWith({}), node, [cf]), true)
  assert.equal(flowNodeIsDrilled(widgetWith({}), root.children[1], [cf]), false)
})

// --- the guardrails ------------------------------------------------------

test('the root can be narrowed before anything else happens', () => {
  const { root } = build({
    conditions: [{ column: 'Model', operator: 'contains', value: 'SPLENDOR' }],
    levels: [splitBy('Yard')],
  })
  assert.equal(root.count, 3)
  assert.deepEqual(labels(root), ['Pune', 'Nashik'])
})

test('expand-all stops at the branch limit instead of locking the tab', () => {
  const { root, truncated } = build(
    { maxNodes: 3, levels: [splitBy('Model', { top: 10 }), splitBy('Yard')] },
    openAll
  )
  assert.equal(truncated, true)
  assert.ok(flattenFlow(root).length <= 8)
})

test('a level nobody finished configuring is not a branch', () => {
  const { root } = build({ levels: [splitBy('')] })
  assert.equal(root.hasChildren, false, 'no chevron on a node with nothing under it')
})

test('a collapse beats the levels that open by default', () => {
  const { root } = build({ autoExpand: 1, levels: [splitBy('Model')] }, { collapsed: new Set(['']) })
  assert.equal(root.open, false)
  assert.equal(root.children.length, 0)
})

test('viewers can repoint a split without touching the saved page', () => {
  const flow = { levels: [splitBy('Model', { allowChange: true })] }
  const { root } = build(flow, { levelOverrides: { l_Model: { column: 'Yard' } } })
  assert.deepEqual(labels(root), ['Pune', 'Nashik', '(blank)'])
  assert.equal(flow.levels[0].column, 'Model', 'the saved config is untouched')
})

test('the path is summarised without opening anything', () => {
  const summary = describeFlow(widgetWith({ levels: [splitBy('Model'), HOP, splitBy('Job')] }))
  assert.equal(summary, 'STOCK → Model → 🔗 SERVICE → Job')
})

test('a split level can bucket, and the branch drills to what the bucket means', () => {
  // The README has promised this for a while and it was not true. "May
  // 2024" is not a value in a date column, so a bucketed branch has to
  // drill by the range it stands for or the click filters to nothing.
  const rows = [
    { _row: 2, Sold: '03/05/2024' },
    { _row: 3, Sold: '19/05/2024' },
    { _row: 4, Sold: '07/06/2024' },
  ]
  const widget = {
    id: 'w1',
    tab: 'T',
    flow: {
      ...DEFAULT_FLOW,
      levels: [{ id: 'l1', kind: 'split', column: 'Sold', bucket: 'month', sort: 'name_asc', top: 12 }],
      autoExpand: 1,
    },
  }

  const built = buildFlow({ widget, rowsByTab: { T: rows }, headersByTab: {}, dateOrder: 'DMY', autoExpand: 1 })
  const labels = built.root.children.map((c) => c.label)
  assert.equal(labels.length, 2, 'two months, not three dates')

  const may = built.root.children.find((c) => c.count === 2)
  assert.ok(may, 'the month with two rows in it')

  // And the drill selects exactly those two rows.
  const cf = flowCrossFilter(widget, may)
  const drilled = applyFilters(rows, {
    tab: 'T',
    crossFilters: [{ ...cf, conditions: cf.conditions.map((c) => ({ ...c, tab: 'T' })) }],
  })
  assert.deepEqual(drilled.map((r) => r._row), [2, 3])
})

test('a value the bucket cannot read is blank, not a bucket called null', () => {
  const rows = [{ _row: 2, Sold: 'not a date' }, { _row: 3, Sold: '01/05/2024' }]
  const widget = {
    id: 'w1',
    tab: 'T',
    flow: {
      ...DEFAULT_FLOW,
      levels: [{ id: 'l1', kind: 'split', column: 'Sold', bucket: 'month', top: 12 }],
      autoExpand: 1,
    },
  }
  const built = buildFlow({ widget, rowsByTab: { T: rows }, headersByTab: {}, dateOrder: 'DMY', autoExpand: 1 })
  for (const child of built.root.children) {
    assert.ok(child.label && child.label !== 'null', `a branch called ${child.label}`)
  }
})
