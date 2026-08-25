import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FLOW_MAP_PLATES,
  depthOf,
  flowMapLayout,
  icicleLayout,
  limitDepth,
  nodeKey,
  sankeyLayout,
  sunburstLayout,
  treemapLayout,
  unaccounted,
} from './flowMap.js'

const node = (path, label, value, children = []) => ({
  path,
  label,
  value,
  count: value,
  level: path.split('/').length - 1,
  children,
  kind: 'split',
  metrics: [],
  trail: [],
})

// 1000 in; 600 + 380 go on; 20 go nowhere. Pune then splits 400/200.
const TREE = node('', 'All', 1000, [
  node('/pune', 'Pune', 600, [node('/pune/fin', 'Financed', 400), node('/pune/cash', 'Cash', 200)]),
  node('/nashik', 'Nashik', 380),
])

const area = (n) => n.w * n.h
const sum = (list, f) => list.reduce((t, x) => t + f(x), 0)

// --- the tree itself ------------------------------------------------------

test('depth is the number of levels below the root', () => {
  assert.equal(depthOf([TREE]), 2)
  assert.equal(depthOf([node('', 'One', 1)]), 0)
  assert.equal(depthOf([]), 0)
})

test('a depth limit cuts the tree and says where it cut', () => {
  const cut = limitDepth([TREE], 1)
  assert.equal(depthOf(cut), 1)
  assert.equal(cut[0].children[0].children.length, 0)
  assert.equal(cut[0].children[0].cutOff, true, 'and it admits there was more')
  assert.equal(cut[0].children[1].cutOff, false, 'a real leaf was not cut off')
})

test('a depth limit never touches the numbers', () => {
  const cut = limitDepth([TREE], 1)
  assert.equal(cut[0].value, 1000)
  assert.equal(cut[0].children[0].value, 600)
})

test('what a parent has and its children do not account for', () => {
  // The whole point of a funnel: 1000 in, 980 on, 20 that went nowhere.
  assert.equal(unaccounted(TREE), 20)
  assert.equal(unaccounted(TREE.children[0]), 0, 'Pune adds up exactly')
  assert.equal(unaccounted(TREE.children[1]), 0, 'a leaf has nothing to lose')
})

// --- bands ----------------------------------------------------------------

test('bands put every level in its own column', () => {
  const map = sankeyLayout([TREE], { width: 900, height: 400 })
  const depths = new Map()
  for (const n of map.nodes) depths.set(n.depth, n.x)
  assert.equal(map.columns, 3)
  assert.ok(depths.get(0) < depths.get(1) && depths.get(1) < depths.get(2))
})

test('a band is as thick as the volume flowing along it', () => {
  const map = sankeyLayout([TREE], { width: 900, height: 400 })
  const find = (label) => map.nodes.find((n) => n.node.label === label)

  // 400 vs 200 is exactly two to one, whatever the plate is scaled to.
  assert.ok(Math.abs(find('Financed').h / find('Cash').h - 2) < 0.01)
  assert.ok(Math.abs(find('Pune').h / find('Nashik').h - 600 / 380) < 0.01)
})

test('what was lost is a real gap, not something to be subtracted', () => {
  const map = sankeyLayout([TREE], { width: 900, height: 400 })
  assert.equal(map.gaps.length, 1, 'only the root loses anything')
  assert.equal(map.gaps[0].value, 20)
  assert.ok(Math.abs(map.gaps[0].share - 0.02) < 0.001)
})

test('a band leaves its parent at the offset it occupies next door', () => {
  // Which is what stops bands crossing: following one path from the left
  // edge to a leaf is a straight read, not an untangling exercise.
  const map = sankeyLayout([TREE], { width: 900, height: 400 })
  const link = map.links.find((l) => l.node.label === 'Financed')
  const target = map.nodes.find((n) => n.node.label === 'Financed')
  assert.ok(Math.abs(link.y - target.y) < 0.001)
})

test('children stack inside their parent, never outside it', () => {
  const map = sankeyLayout([TREE], { width: 900, height: 400 })
  const parent = map.nodes.find((n) => n.node.label === 'Pune')
  for (const label of ['Financed', 'Cash']) {
    const child = map.nodes.find((n) => n.node.label === label)
    assert.ok(child.y >= parent.y - 0.001, label)
    assert.ok(child.y + child.h <= parent.y + parent.h + 0.001, label)
  }
})

test('one scale across every tree on the plate, so two can be compared', () => {
  const other = node('', 'Other', 500, [node('/a', 'A', 500)])
  const map = sankeyLayout([TREE, other], { width: 900, height: 400 })
  const a = map.nodes.find((n) => n.node.label === 'All')
  const b = map.nodes.find((n) => n.node.label === 'Other')
  assert.ok(Math.abs(a.h / b.h - 2) < 0.02, '1000 draws twice as tall as 500')
})

test('a plate with nothing on it is empty rather than broken', () => {
  const map = sankeyLayout([], {})
  assert.deepEqual(map.nodes, [])
  assert.deepEqual(map.links, [])
  assert.equal(map.columns, 0)
})

test('a tree whose total is zero does not divide by it', () => {
  const zero = node('', 'None', 0, [node('/a', 'A', 0)])
  assert.doesNotThrow(() => sankeyLayout([zero], { width: 100, height: 100 }))
  for (const n of sankeyLayout([zero], { width: 100, height: 100 }).nodes) {
    assert.ok(Number.isFinite(n.h) && Number.isFinite(n.y), n.node.label)
  }
})

// --- icicle ---------------------------------------------------------------

test('icicle gives each node an extent proportional to its value', () => {
  const map = icicleLayout([TREE], { width: 800, height: 400, gap: 0, padding: 0 })
  const find = (label) => map.nodes.find((n) => n.node.label === label)
  assert.ok(Math.abs(find('Financed').h / find('Cash').h - 2) < 0.01)
})

test('icicle children sit inside their parent’s run', () => {
  const map = icicleLayout([TREE], { width: 800, height: 400, gap: 0, padding: 0 })
  const parent = map.nodes.find((n) => n.node.label === 'Pune')
  const child = map.nodes.find((n) => n.node.label === 'Cash')
  assert.ok(child.y >= parent.y - 0.001)
  assert.ok(child.y + child.h <= parent.y + parent.h + 0.001)
})

test('icicle turns on its side without losing the proportions', () => {
  const flat = icicleLayout([TREE], { width: 800, height: 400, gap: 0, padding: 0, orientation: 'vertical' })
  const find = (label) => flat.nodes.find((n) => n.node.label === label)
  assert.ok(Math.abs(find('Financed').w / find('Cash').w - 2) < 0.01)
  assert.ok(find('Pune').y > find('All').y, 'depth runs downward')
})

test('the drop-off is the gap at the end of a parent’s run', () => {
  const map = icicleLayout([TREE], { width: 800, height: 400, gap: 0, padding: 0 })
  const root = map.nodes.find((n) => n.node.label === 'All')
  const kids = map.nodes.filter((n) => n.depth === 1)
  const covered = sum(kids, (k) => k.h)
  assert.ok(root.h - covered > 1, '2% of the height is left visibly empty')
})

// --- sunburst -------------------------------------------------------------

test('a sunburst fills the circle, and depth is distance from the middle', () => {
  const map = sunburstLayout([TREE], { width: 400, height: 400 })
  const root = map.nodes.find((n) => n.node.label === 'All')
  assert.ok(Math.abs(root.endAngle - root.startAngle - Math.PI * 2) < 0.001, 'the root is the whole circle')

  const child = map.nodes.find((n) => n.node.label === 'Pune')
  assert.ok(child.innerRadius >= root.outerRadius - 0.001, 'a level out is a ring out')
})

test('a sunburst arc is proportional to its value', () => {
  const map = sunburstLayout([TREE], { width: 400, height: 400 })
  const span = (label) => {
    const n = map.nodes.find((x) => x.node.label === label)
    return n.endAngle - n.startAngle
  }
  assert.ok(Math.abs(span('Financed') / span('Cash') - 2) < 0.01)
})

test('every sunburst arc is a drawable path', () => {
  const map = sunburstLayout([TREE], { width: 400, height: 400 })
  for (const n of map.nodes) {
    assert.ok(n.d.startsWith('M'), n.node.label)
    assert.ok(!/NaN|Infinity/.test(n.d), `${n.node.label} has a broken path`)
  }
})

test('a zero-value branch is skipped rather than drawn as a hairline of nothing', () => {
  const withZero = node('', 'All', 100, [node('/a', 'A', 100), node('/b', 'B', 0)])
  const map = sunburstLayout([withZero], { width: 400, height: 400 })
  assert.equal(map.nodes.find((n) => n.node.label === 'B').d, '')
})

// --- treemap --------------------------------------------------------------

test('treemap area is proportional to value', () => {
  const flat = node('', 'All', 300, [node('/a', 'A', 200), node('/b', 'B', 100)])
  const map = treemapLayout([flat.children[0], flat.children[1]], { width: 600, height: 400, headerHeight: 0 })
  const a = map.nodes.find((n) => n.node.label === 'A')
  const b = map.nodes.find((n) => n.node.label === 'B')
  assert.ok(Math.abs(area(a) / area(b) - 2) < 0.05, 'twice the value, twice the area')
})

test('treemap fills the rectangle it was given', () => {
  const items = [node('/a', 'A', 50), node('/b', 'B', 30), node('/c', 'C', 20)]
  const map = treemapLayout(items, { width: 600, height: 400, headerHeight: 0 })
  assert.ok(Math.abs(sum(map.nodes, area) - 600 * 400) / (600 * 400) < 0.02)
})

test('treemap rectangles do not overlap', () => {
  const items = [node('/a', 'A', 50), node('/b', 'B', 30), node('/c', 'C', 20), node('/d', 'D', 7)]
  const map = treemapLayout(items, { width: 600, height: 400, headerHeight: 0 })
  for (let i = 0; i < map.nodes.length; i += 1) {
    for (let j = i + 1; j < map.nodes.length; j += 1) {
      const a = map.nodes[i]
      const b = map.nodes[j]
      const apart =
        a.x + a.w <= b.x + 0.01 || b.x + b.w <= a.x + 0.01 || a.y + a.h <= b.y + 0.01 || b.y + b.h <= a.y + 0.01
      assert.ok(apart, `${a.node.label} overlaps ${b.node.label}`)
    }
  }
})

test('treemap keeps the hierarchy, nesting children inside their parent', () => {
  const map = treemapLayout([TREE], { width: 600, height: 400 })
  const parent = map.nodes.find((n) => n.node.label === 'Pune')
  const child = map.nodes.find((n) => n.node.label === 'Financed')
  assert.ok(child.x >= parent.x - 0.01 && child.y >= parent.y - 0.01)
  assert.ok(child.x + child.w <= parent.x + parent.w + 0.01)
  assert.ok(child.y + child.h <= parent.y + parent.h + 0.01)
})

test('a box too small to nest in is left alone rather than filled with slivers', () => {
  const lopsided = node('', 'All', 1000, [
    node('/big', 'Big', 999),
    node('/tiny', 'Tiny', 1, [node('/tiny/a', 'A', 1)]),
  ])
  const map = treemapLayout([lopsided], { width: 300, height: 200 })
  const drawn = map.nodes.filter((n) => n.node.label === 'A')
  for (const n of drawn) assert.ok(n.w >= 0 && n.h >= 0)
})

test('treemap survives an empty list and a zero total', () => {
  assert.deepEqual(treemapLayout([], {}).nodes, [])
  assert.deepEqual(treemapLayout([node('/a', 'A', 0)], { width: 100, height: 100 }).nodes, [])
})

// --- the dispatcher -------------------------------------------------------

test('every plate in the picker actually lays something out', () => {
  for (const { value } of FLOW_MAP_PLATES) {
    const map = flowMapLayout(value, [TREE], { width: 500, height: 300 })
    assert.ok(map.nodes.length > 0, value)
    for (const n of map.nodes) {
      const numbers = [n.x, n.y, n.w, n.h, n.startAngle, n.outerRadius].filter((v) => v !== undefined)
      for (const v of numbers) assert.ok(Number.isFinite(v), `${value}: ${n.node.label}`)
    }
  }
})

test('an unknown plate falls back to bands rather than drawing nothing', () => {
  assert.equal(flowMapLayout('nonsense', [TREE], {}).columns, 3)
})

test('every node carries the key the rest of the app addresses it by', () => {
  const map = flowMapLayout('icicle', [{ ...TREE, treeId: 't1' }], { width: 400, height: 300 })
  assert.equal(map.nodes[0].key, nodeKey(map.nodes[0].node))
  assert.ok(map.nodes[0].key.startsWith('t1'))
})

test('treemap stays exact with many boxes, not just three', () => {
  // The squarified algorithm rescales after every closed row; a mistake
  // there shows up as area that quietly goes missing, and three boxes is
  // not enough to catch it.
  const items = [90, 64, 51, 40, 33, 28, 21, 17, 12, 9, 6, 4, 3, 1].map((v, i) =>
    node(`/n${i}`, `N${i}`, v)
  )
  const map = treemapLayout(items, { width: 640, height: 400, headerHeight: 0 })

  assert.equal(map.nodes.length, items.length, 'every box is drawn')
  const drift = Math.abs(sum(map.nodes, area) - 640 * 400) / (640 * 400)
  assert.ok(drift < 0.005, `area drifted by ${(drift * 100).toFixed(2)}%`)

  // And the areas are still in proportion to the values.
  const total = sum(items, (i) => i.value)
  for (const n of map.nodes) {
    const expected = (n.value / total) * 640 * 400
    assert.ok(Math.abs(area(n) - expected) / expected < 0.02, n.node.label)
  }
})

test('treemap boxes stay inside the rectangle they were given', () => {
  const items = [50, 30, 12, 8].map((v, i) => node(`/n${i}`, `N${i}`, v))
  const map = treemapLayout(items, { width: 300, height: 220, headerHeight: 0 })
  for (const n of map.nodes) {
    assert.ok(n.x >= -0.01 && n.y >= -0.01, n.node.label)
    assert.ok(n.x + n.w <= 300.01 && n.y + n.h <= 220.01, n.node.label)
  }
})
