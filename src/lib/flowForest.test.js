import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildFlowTrees,
  describeFlow,
  findFlowNode,
  flowCrossFilter,
  flowTreeColumns,
  flowTrees,
} from './flow.js'
import { layoutForest } from './flowLayout.js'
import { applyFilters } from './filterEngine.js'

const STOCK = [
  { _row: 2, VIN: 'V1', Model: 'A', Yard: 'Pune' },
  { _row: 3, VIN: 'V2', Model: 'A', Yard: 'Nashik' },
  { _row: 4, VIN: 'V3', Model: 'B', Yard: 'Pune' },
]
// Quotations know a thing STOCK does not: whether the deal is financed.
const QUOTES = [
  { _row: 2, 'Chassis No': 'V1', Finance: 'HDFC', Amount: '100' },
  { _row: 3, 'Chassis No': 'V3', Finance: '', Amount: '300' },
]
const SERVICE = [
  { _row: 2, 'Job No': 'J1', Kind: 'PDI' },
  { _row: 3, 'Job No': 'J2', Kind: 'Repair' },
  { _row: 4, 'Job No': 'J3', Kind: 'PDI' },
]
// A tab nowhere near the flow that happens to carry the same key.
const FEEDBACK = [{ VIN: 'V1', Stars: '5' }, { VIN: 'V2', Stars: '3' }]

const rowsByTab = { STOCK, QUOTES, SERVICE, FEEDBACK }
const headersByTab = {
  STOCK: ['VIN', 'Model', 'Yard'],
  QUOTES: ['Chassis No', 'Finance', 'Amount'],
  SERVICE: ['Job No', 'Kind'],
  FEEDBACK: ['VIN', 'Stars'],
}

const split = (id, column, extra = {}) => ({ id, kind: 'split', column, top: 9, ...extra })
const build = (flow, opts = {}) =>
  buildFlowTrees({ widget: { id: 'w1', tab: 'STOCK', flow }, rowsByTab, headersByTab, autoExpand: 9, ...opts })

// --- one widget, several trees -------------------------------------------

test('a flow written before trees existed reads as one tree', () => {
  const trees = flowTrees({ id: 'w1', tab: 'STOCK', flow: { levels: [split('l', 'Model')], label: 'Stock' } })
  assert.equal(trees.length, 1)
  assert.equal(trees[0].tab, 'STOCK')
  assert.equal(trees[0].label, 'Stock')
  assert.deepEqual(trees[0].levels.map((l) => l.column), ['Model'])
})

test('two trees build two independent pictures', () => {
  const built = build({
    trees: [
      { id: 'a', label: 'Vehicles', tab: 'STOCK', levels: [split('l1', 'Model')] },
      { id: 'b', label: 'Jobs', tab: 'SERVICE', levels: [split('l2', 'Kind')] },
    ],
  })

  assert.equal(built.multi, true)
  assert.deepEqual(built.trees.map((t) => t.root.label), ['Vehicles', 'Jobs'])
  assert.deepEqual(built.trees.map((t) => t.root.count), [3, 3])
  assert.deepEqual(built.trees[0].root.children.map((c) => c.label), ['A', 'B'])
  assert.deepEqual(built.trees[1].root.children.map((c) => c.label).sort(), ['PDI', 'Repair'])
})

test('each tree keeps its own measure', () => {
  const built = build({
    trees: [
      { id: 'a', tab: 'QUOTES', measure: { aggregation: 'sum', column: 'Amount', format: 'inr' }, levels: [] },
      { id: 'b', tab: 'STOCK', measure: { aggregation: 'count' }, levels: [] },
    ],
  })
  assert.equal(built.trees[0].root.value, 400)
  assert.equal(built.trees[0].root.measure.format, 'inr')
  assert.equal(built.trees[1].root.value, 3)
  assert.equal(built.trees[1].root.measure.aggregation, 'count')
})

test('opening a branch in one tree leaves the others alone', () => {
  // Paths repeat between trees -- both roots are '' -- so without a
  // namespace, opening one would open all of them.
  const flow = {
    trees: [
      { id: 'a', tab: 'STOCK', levels: [split('l1', 'Model')] },
      { id: 'b', tab: 'SERVICE', levels: [split('l2', 'Kind')] },
    ],
  }
  const built = build(flow, { autoExpand: 0, expanded: new Set(['a::']) })
  assert.equal(built.trees[0].root.open, true)
  assert.equal(built.trees[1].root.open, false)
  assert.equal(built.trees[1].root.children.length, 0)
})

test('every tab any tree touches is reported, so the page loads them', () => {
  const built = build({
    trees: [
      { id: 'a', tab: 'STOCK', levels: [] },
      { id: 'b', tab: 'SERVICE', levels: [] },
    ],
  })
  assert.deepEqual(built.tabs.sort(), ['SERVICE', 'STOCK'])
})

test('the summary names every tree', () => {
  const widget = {
    id: 'w1',
    tab: 'STOCK',
    flow: {
      trees: [
        { id: 'a', tab: 'STOCK', levels: [split('l1', 'Model')] },
        { id: 'b', tab: 'SERVICE', levels: [split('l2', 'Kind')] },
      ],
    },
  }
  assert.equal(describeFlow(widget), 'STOCK → Model  ·  SERVICE → Kind')
})

// --- a tree can join a second table before it starts ----------------------

const BLEND = {
  enabled: true,
  ref: 'QUOTES',
  leftKey: 'VIN',
  rightKey: 'Chassis No',
  type: 'left',
  multi: 'first',
  prefix: 'Q.',
  columns: ['Finance', 'Amount'],
}

const blendedFlow = {
  trees: [{ id: 'a', tab: 'STOCK', blend: BLEND, levels: [split('l1', 'Q.Finance', { includeBlanks: true })] }],
}

test('a tree can branch on a column its own table does not have', () => {
  // STOCK has no Finance column. Joined to QUOTES it does, and every level
  // below sees it as if it had always been there.
  const built = build(blendedFlow)
  const root = built.trees[0].root
  assert.equal(built.trees[0].blended, true)
  assert.equal(root.count, 3, 'a left join keeps every vehicle')
  assert.deepEqual(root.children.map((c) => c.label), ['HDFC', '(blank)'])
  assert.deepEqual(root.children.map((c) => c.count), [1, 2], 'V2 never quoted, V3 quoted but unfinanced')
})

test('the blended columns are what the editor offers', () => {
  const cols = flowTreeColumns({ tab: 'STOCK', blend: BLEND }, headersByTab)
  assert.ok(cols.includes('Model'), 'its own')
  assert.ok(cols.includes('Q.Finance'), 'and the joined ones, under the prefix')
  assert.ok(cols.includes('Q.Match count'))
})

test('a blended branch drills by the key, not by a column nothing has', () => {
  // The bug this avoids: filtering the page by "Q.Finance = HDFC" matches
  // nothing anywhere, because no tab has a column of that name.
  const built = build(blendedFlow)
  const hdfc = built.trees[0].root.children[0]
  const cf = flowCrossFilter({ id: 'w1' }, hdfc)

  assert.equal(cf.kind, 'keys')
  assert.deepEqual(cf.keyColumns, [
    { tab: 'STOCK', column: 'VIN' },
    { tab: 'QUOTES', column: 'Chassis No' },
  ])
  assert.deepEqual(applyFilters(STOCK, { tab: 'STOCK', crossFilters: [cf] }).map((r) => r.VIN), ['V1'])
  assert.deepEqual(applyFilters(QUOTES, { tab: 'QUOTES', crossFilters: [cf] }).map((r) => r._row), [2])
  // ...and it reaches a tab that knows nothing about either side.
  assert.deepEqual(applyFilters(FEEDBACK, { tab: 'FEEDBACK', crossFilters: [cf] }).map((r) => r.VIN), ['V1'])
})

test('a blended tree can still be narrowed by its own conditions first', () => {
  const built = build({
    trees: [
      {
        id: 'a',
        tab: 'STOCK',
        blend: BLEND,
        conditions: [{ column: 'Yard', operator: 'equals', value: 'Pune' }],
        levels: [split('l1', 'Q.Finance')],
      },
    ],
  })
  assert.equal(built.trees[0].root.count, 2)
})

test('an unblended tree is untouched by any of this', () => {
  const built = build({ trees: [{ id: 'a', tab: 'STOCK', levels: [split('l1', 'Model')] }] })
  assert.equal(built.trees[0].blended, false)
  const cf = flowCrossFilter({ id: 'w1' }, built.trees[0].root.children[0])
  assert.equal(cf.kind, 'conditions', 'still the readable kind when it can be')
})

// --- several trees on one canvas -----------------------------------------

test('trees are laid out side by side without overlapping', () => {
  const built = build({
    trees: [
      { id: 'a', tab: 'STOCK', levels: [split('l1', 'Model')] },
      { id: 'b', tab: 'SERVICE', levels: [split('l2', 'Kind')] },
    ],
  })
  const roots = built.trees.map((t) => t.root)
  const layout = layoutForest(roots, { orientation: 'vertical' })

  assert.equal(layout.bands.length, 2)
  const [first, second] = layout.bands
  assert.ok(second.x >= first.x + first.width, 'the second tree starts after the first ends')
  assert.equal(layout.nodes.length, 6, 'two roots and their four branches')
  assert.ok(layout.width >= first.width + second.width)
})

test('one tree lays out exactly as it did before there could be several', () => {
  const built = build({ trees: [{ id: 'a', tab: 'STOCK', levels: [split('l1', 'Model')] }] })
  const layout = layoutForest([built.trees[0].root], {})
  assert.equal(layout.bands, undefined, 'no plate is drawn around a lone tree')
  assert.equal(Math.min(...layout.nodes.map((n) => n.x)), 20, 'and it starts at the padding, not at an offset')
})

test('laying out nothing cannot throw', () => {
  assert.deepEqual(layoutForest([], {}).nodes, [])
  assert.deepEqual(layoutForest(null, {}).nodes, [])
})

test('a focused branch of one tree is the only thing that tree draws', () => {
  const built = build({
    trees: [
      { id: 'a', tab: 'STOCK', levels: [split('l1', 'Model'), split('l2', 'Yard')] },
      { id: 'b', tab: 'SERVICE', levels: [split('l2b', 'Kind')] },
    ],
  })
  const focused = findFlowNode(built.trees[0].root, '/A')
  const layout = layoutForest([focused, built.trees[1].root], {})
  const labels = layout.nodes.map((n) => n.node.label).sort()
  assert.deepEqual(labels, ['A', 'Nashik', 'PDI', 'Repair', 'SERVICE', 'Pune'].sort())
})
