import test from 'node:test'
import assert from 'node:assert/strict'

import { buildFlow } from './flow.js'
import { FLOW_LAYOUT_DEFAULTS, edgeWidth, fitToViewport, layoutFlow } from './flowLayout.js'

const ROWS = [
  { _row: 2, Model: 'A', Yard: 'P' },
  { _row: 3, Model: 'A', Yard: 'P' },
  { _row: 4, Model: 'A', Yard: 'Q' },
  { _row: 5, Model: 'B', Yard: 'Q' },
  { _row: 6, Model: 'C', Yard: 'P' },
]

const widget = {
  id: 'w1',
  tab: 'T',
  flow: {
    levels: [
      { id: 'l1', kind: 'split', column: 'Model', top: 10 },
      { id: 'l2', kind: 'split', column: 'Yard', top: 10 },
    ],
  },
}

const tree = (autoExpand) => buildFlow({ widget, rowsByTab: { T: ROWS }, autoExpand }).root
const byLabel = (layout, label) => layout.nodes.find((n) => n.node.label === label)
const centre = (box, axis) => (axis === 'x' ? box.x + box.w / 2 : box.y + box.h / 2)

test('a closed root is a single box', () => {
  const layout = layoutFlow(tree(0))
  assert.equal(layout.nodes.length, 1)
  assert.equal(layout.edges.length, 0)
  assert.ok(layout.width > 0 && layout.height > 0)
})

test('only what is open is drawn', () => {
  assert.equal(layoutFlow(tree(1)).nodes.length, 4, 'root + three models')
  assert.equal(layoutFlow(tree(9)).nodes.length, 8, '...plus each model’s yards')
})

test('a parent sits centred over its children', () => {
  // The one convention every org chart shares -- without it the eye cannot
  // tell which branch a node belongs to.
  const layout = layoutFlow(tree(9))
  const a = byLabel(layout, 'A')
  const kids = layout.edges.filter((e) => e.from === a.node.path).map((e) => byLabel(layout, e.node.label))
  const span = (Math.min(...kids.map((k) => centre(k, 'x'))) + Math.max(...kids.map((k) => centre(k, 'x')))) / 2
  assert.equal(centre(a, 'x').toFixed(2), span.toFixed(2))
})

test('siblings never overlap', () => {
  const layout = layoutFlow(tree(9))
  const rows = new Map()
  for (const box of layout.nodes) {
    const list = rows.get(box.y) || []
    list.push(box)
    rows.set(box.y, list)
  }
  for (const list of rows.values()) {
    list.sort((p, q) => p.x - q.x)
    for (let i = 1; i < list.length; i += 1) {
      assert.ok(list[i].x >= list[i - 1].x + list[i - 1].w, 'two cards would sit on top of each other')
    }
  }
})

test('each level is one step further down', () => {
  const layout = layoutFlow(tree(9))
  const depths = [...new Set(layout.nodes.map((n) => n.y))].sort((a, b) => a - b)
  assert.equal(depths.length, 3)
  assert.equal(depths[1] - depths[0], layout.nodeH + FLOW_LAYOUT_DEFAULTS.gapY)
  assert.equal(depths[2] - depths[1], layout.nodeH + FLOW_LAYOUT_DEFAULTS.gapY)
})

test('left-to-right is the same layout with the axes swapped', () => {
  const down = layoutFlow(tree(9))
  const across = layoutFlow(tree(9), { orientation: 'horizontal' })

  assert.equal(across.orientation, 'horizontal')
  assert.equal(across.nodes.length, down.nodes.length)
  // Depth now runs along x, so the levels are columns rather than rows.
  assert.equal(new Set(across.nodes.map((n) => n.x)).size, 3)
  assert.ok(across.width > across.height ? true : across.height > 0)

  const a = byLabel(across, 'A')
  const kids = across.edges.filter((e) => e.from === a.node.path).map((e) => byLabel(across, e.node.label))
  const span = (Math.min(...kids.map((k) => centre(k, 'y'))) + Math.max(...kids.map((k) => centre(k, 'y')))) / 2
  assert.equal(centre(a, 'y').toFixed(2), span.toFixed(2), 'and the centring rule follows the axis')
})

test('an edge is as heavy as the share flowing along it', () => {
  assert.ok(edgeWidth(1) > edgeWidth(0.5))
  assert.ok(edgeWidth(0.5) > edgeWidth(0))
  assert.equal(edgeWidth(-5), edgeWidth(0), 'clamped, so a bad share cannot invert a line')
  assert.equal(edgeWidth(9), edgeWidth(1))
  assert.equal(edgeWidth(NaN), edgeWidth(0))
})

test('every edge is drawable and labelled inside the picture', () => {
  const layout = layoutFlow(tree(9))
  assert.equal(layout.edges.length, layout.nodes.length - 1, 'a tree: one edge per node but the root')
  for (const edge of layout.edges) {
    assert.match(edge.d, /^M [\d.-]+ [\d.-]+ C /)
    assert.ok(edge.mx >= 0 && edge.mx <= layout.width, 'label sits off the canvas')
    assert.ok(edge.my >= 0 && edge.my <= layout.height)
  }
})

test('cards grow to hold their extra numbers', () => {
  const plain = layoutFlow(tree(1))
  const withMetrics = layoutFlow(
    buildFlow({
      widget: { ...widget, flow: { ...widget.flow, metrics: [{ id: 'm', label: 'Rows', aggregation: 'count' }] } },
      rowsByTab: { T: ROWS },
      autoExpand: 1,
    }).root
  )
  assert.equal(withMetrics.nodeH, plain.nodeH + FLOW_LAYOUT_DEFAULTS.metricsH)
})

test('fitting shrinks what is too big and centres what is not', () => {
  const layout = layoutFlow(tree(9))
  const tight = fitToViewport(layout, { width: 300, height: 200 })
  assert.ok(tight.zoom < 1)
  assert.ok(layout.width * tight.zoom <= 300)

  // Never magnified: a two-node flow blown up to fill the card looks broken.
  const roomy = fitToViewport(layoutFlow(tree(0)), { width: 1200, height: 800 })
  assert.equal(roomy.zoom, 1)
  assert.ok(roomy.x > 0, 'and it is centred rather than pinned to the corner')
})

test('an empty layout cannot divide by zero', () => {
  const empty = layoutFlow(null)
  assert.deepEqual(empty.nodes, [])
  assert.deepEqual(fitToViewport(empty, { width: 100, height: 100 }).zoom, 1)
})
