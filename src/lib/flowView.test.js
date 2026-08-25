import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FLOW_VIEW_SORTS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  centreOn,
  clampZoom,
  flowKeyAction,
  flowStats,
  lineagePaths,
  minimapGeometry,
  minimapJump,
  peekPlacement,
  peekRows,
  pruneBySignificance,
  searchFlow,
  sortFlowRoots,
  stepMatch,
  zoomAbout,
} from './flowView.js'
import { fitToViewport, layoutForest } from './flowLayout.js'

// A small tree with the shapes that matter: a fat branch, a thin one, a
// roll-up bucket, and a level below.
const node = (path, label, value, extra = {}) => ({
  path,
  label,
  value,
  count: value,
  level: path.split('/').length - 1,
  share: extra.share ?? null,
  shareOfRoot: extra.shareOfRoot ?? null,
  dropOff: extra.dropOff ?? 0,
  kind: extra.kind || 'split',
  open: extra.open ?? true,
  hasChildren: (extra.children || []).length > 0,
  trail: extra.trail || [],
  metrics: [],
  children: extra.children || [],
  treeId: extra.treeId,
})

const TREE = node('', 'All', 1000, {
  children: [
    node('/pune', 'Pune', 600, {
      share: 0.6,
      trail: ['Pune'],
      children: [
        node('/pune/fin', 'Financed', 400, { share: 0.667, dropOff: 0.333, trail: ['Pune', 'Financed'] }),
        node('/pune/cash', 'Cash', 200, { share: 0.333, dropOff: 0.667, trail: ['Pune', 'Cash'] }),
      ],
    }),
    node('/nashik', 'Nashik', 380, { share: 0.38, trail: ['Nashik'] }),
    node('/tiny', 'Kolhapur', 15, { share: 0.015, trail: ['Kolhapur'] }),
    node('/other', 'Other (4)', 5, { share: 0.005, kind: 'other', trail: ['Other (4)'] }),
  ],
})

// --- zoom -----------------------------------------------------------------

test('zoom in and out never leaves the sane range', () => {
  assert.equal(clampZoom(1 * ZOOM_STEP), 1.25)
  assert.equal(clampZoom(99), ZOOM_MAX, 'a hundred clicks of + stops somewhere')
  assert.equal(clampZoom(0.0001), ZOOM_MIN)
  assert.equal(clampZoom('nonsense'), 1, 'never NaN, which would blank the canvas')
})

test('zooming keeps the point under the cursor under the cursor', () => {
  // The whole reason to zoom about a point: you aim at a branch, zoom, and
  // it is still there rather than off the edge.
  const view = { zoom: 1, x: 0, y: 0 }
  const px = 300
  const py = 150

  const worldBefore = { x: (px - view.x) / view.zoom, y: (py - view.y) / view.zoom }
  const after = zoomAbout(view, ZOOM_STEP, px, py)
  const screenAfter = { x: worldBefore.x * after.zoom + after.x, y: worldBefore.y * after.zoom + after.y }

  assert.ok(Math.abs(screenAfter.x - px) < 0.001)
  assert.ok(Math.abs(screenAfter.y - py) < 0.001)
})

test('zoom out then in returns to where it started', () => {
  const start = { zoom: 1, x: 40, y: 20 }
  const out = zoomAbout(start, 1 / ZOOM_STEP, 200, 100)
  const back = zoomAbout(out, ZOOM_STEP, 200, 100)
  assert.ok(Math.abs(back.zoom - 1) < 0.001)
  assert.ok(Math.abs(back.x - 40) < 0.01)
  assert.ok(Math.abs(back.y - 20) < 0.01)
})

test('the fit button frames the whole diagram inside the viewport', () => {
  const layout = layoutForest([TREE], { orientation: 'vertical' })
  const viewport = { width: 600, height: 300 }
  const view = fitToViewport(layout, viewport)

  assert.ok(layout.width * view.zoom <= viewport.width + 1, 'nothing sticks out sideways')
  assert.ok(layout.height * view.zoom <= viewport.height + 1, 'nothing sticks out below')
  assert.ok(view.zoom > 0)
})

test('fit does not blow a two-node flow up to fill the card', () => {
  const tiny = node('', 'All', 10, { children: [node('/a', 'A', 10, { share: 1 })] })
  const layout = layoutForest([tiny], {})
  assert.ok(fitToViewport(layout, { width: 2000, height: 1400 }).zoom <= 1)
})

test('centring puts a node in the middle of the viewport', () => {
  const box = { x: 100, y: 40, w: 180, h: 60 }
  const view = centreOn(box, { width: 800, height: 400 }, 1)
  assert.equal(box.x + box.w / 2 + view.x, 400)
  assert.equal(box.y + box.h / 2 + view.y, 200)
})

test('centring at a zoom still centres', () => {
  const box = { x: 100, y: 40, w: 180, h: 60 }
  const view = centreOn(box, { width: 800, height: 400 }, 2)
  assert.equal((box.x + box.w / 2) * view.zoom + view.x, 400)
  assert.equal(centreOn(null, { width: 8, height: 4 }, 1), null)
})

// --- the keyboard ---------------------------------------------------------

test('every shortcut the toolbar has a button for', () => {
  assert.deepEqual(flowKeyAction('+'), { type: 'zoom', factor: ZOOM_STEP })
  assert.deepEqual(flowKeyAction('='), { type: 'zoom', factor: ZOOM_STEP })
  assert.equal(flowKeyAction('-').factor, 1 / ZOOM_STEP)
  assert.deepEqual(flowKeyAction('0'), { type: 'fit' })
  assert.deepEqual(flowKeyAction('1'), { type: 'actual' })
  assert.deepEqual(flowKeyAction('f'), { type: 'fullscreen' })
  assert.deepEqual(flowKeyAction('/'), { type: 'search' })
  assert.deepEqual(flowKeyAction('Escape'), { type: 'clear' })
})

test('arrow keys pan, and the direction is the one a person expects', () => {
  // Pressing → moves the view right, which means the CONTENT moves left.
  assert.ok(flowKeyAction('ArrowRight').dx < 0)
  assert.ok(flowKeyAction('ArrowLeft').dx > 0)
  assert.ok(flowKeyAction('ArrowDown').dy < 0)
  assert.ok(flowKeyAction('ArrowUp').dy > 0)
})

test('a browser shortcut is left to the browser', () => {
  assert.equal(flowKeyAction('f', { ctrl: true }), null, 'ctrl+F is Find, not fullscreen')
  assert.equal(flowKeyAction('q'), null)
})

// --- search ---------------------------------------------------------------

test('search finds a branch by its own name', () => {
  const hits = searchFlow([TREE], 'pune')
  assert.equal(hits[0].node.label, 'Pune')
})

test('search finds a branch by the path that led to it', () => {
  // "Financed" under Pune should be findable by searching Pune, because on
  // a drill tree where a node sits is most of what it means.
  const hits = searchFlow([TREE], 'pune').map((h) => h.node.label)
  assert.ok(hits.includes('Financed'))
  assert.ok(hits.includes('Cash'))
})

test('a hit on the name beats a hit on the ancestry, then the bigger branch', () => {
  const hits = searchFlow([TREE], 'pune')
  assert.equal(hits[0].node.label, 'Pune', 'the node actually called Pune is first')
  assert.deepEqual(hits.slice(1).map((h) => h.node.label), ['Financed', 'Cash'], 'then by size')
})

test('search does not care about case, and an empty query finds nothing', () => {
  assert.equal(searchFlow([TREE], 'NASHIK').length, 1)
  assert.deepEqual(searchFlow([TREE], '   '), [])
  assert.deepEqual(searchFlow([TREE], ''), [])
  assert.deepEqual(searchFlow(null, 'x'), [])
})

test('stepping through matches wraps at both ends', () => {
  assert.equal(stepMatch(3, 0, 1), 1)
  assert.equal(stepMatch(3, 2, 1), 0, 'past the last goes to the first')
  assert.equal(stepMatch(3, 0, -1), 2, 'before the first goes to the last')
  assert.equal(stepMatch(0, 0, 1), -1, 'no matches, no selection')
})

// --- lineage --------------------------------------------------------------

test('hovering a node lights its ancestors and its descendants', () => {
  const keys = lineagePaths([TREE], '/pune')
  assert.ok(keys.has('/pune'))
  assert.ok(keys.has('/pune/fin'), 'and where it went')
  assert.ok(keys.has('/pune/cash'))
  assert.ok(!keys.has('/nashik'), 'a sibling is not on the path')
})

test('a deep node lights the whole chain back to the root', () => {
  const keys = lineagePaths([TREE], '/pune/fin')
  assert.ok(keys.has('/pune'), 'its parent')
  assert.ok(keys.has('/pune/fin'))
  assert.ok(!keys.has('/pune/cash'), 'its sibling is not')
})

test('lineage works across several trees on one canvas', () => {
  const a = { ...TREE, treeId: 't1' }
  const b = { ...TREE, treeId: 't2' }
  const stamp = (root, id) => {
    const walk = (n) => ({ ...n, treeId: id, children: (n.children || []).map(walk) })
    return walk(root)
  }
  const keys = lineagePaths([stamp(a, 't1'), stamp(b, 't2')], 't2/pune')
  assert.ok(keys.has('t2/pune'))
  assert.ok(!keys.has('t1/pune'), 'the same path in the other tree is a different node')
})

test('no hover, no highlight', () => {
  assert.equal(lineagePaths([TREE], ''), null)
  assert.equal(lineagePaths([TREE], '/nope'), null)
})

// --- hiding hairlines -----------------------------------------------------

test('hiding hairlines drops the slivers and keeps the rest', () => {
  const { roots, hidden } = pruneBySignificance([TREE], 0.02)
  assert.deepEqual(roots[0].children.map((c) => c.label), ['Pune', 'Nashik'])
  assert.equal(hidden, 2, 'Kolhapur and the Other bucket')
})

test('nothing is hidden without being counted', () => {
  // A diagram that silently loses rows is a diagram that lies.
  const { hidden, hiddenValue } = pruneBySignificance([TREE], 0.02)
  assert.equal(hiddenValue, 20, '15 + 5')
  assert.ok(hidden > 0)
})

test('hiding counts a dropped branch’s children too', () => {
  const deep = node('', 'All', 100, {
    children: [node('/a', 'A', 1, { share: 0.01, children: [node('/a/b', 'B', 1, { share: 1 })] })],
  })
  assert.equal(pruneBySignificance([deep], 0.05).hidden, 2, 'the branch and what was under it')
})

test('off means untouched, and the same array back', () => {
  const roots = [TREE]
  assert.equal(pruneBySignificance(roots, 0).roots, roots)
  assert.equal(pruneBySignificance(roots, 0).hidden, 0)
})

test('a root is never hidden, whatever its share', () => {
  const lonely = node('', 'All', 1, { share: 0.001 })
  assert.equal(pruneBySignificance([lonely], 0.5).roots.length, 1)
})

// --- ordering -------------------------------------------------------------

test('a reader can re-order the branches without changing the numbers', () => {
  const sorted = sortFlowRoots([TREE], 'value_asc')
  assert.deepEqual(sorted[0].children.map((c) => c.label), ['Kolhapur', 'Nashik', 'Pune', 'Other (4)'])
  assert.equal(sorted[0].children[2].value, 600, 'the numbers are untouched')
})

test('a roll-up bucket stays last however it is sorted', () => {
  // "Other" at the top of a list reads as the answer, and it is a footnote.
  for (const order of ['value_desc', 'value_asc', 'name_asc', 'drop_desc']) {
    const sorted = sortFlowRoots([TREE], order)
    assert.equal(sorted[0].children.at(-1).kind, 'other', order)
  }
})

test('worst drop-off first is the order you want when hunting a leak', () => {
  const sorted = sortFlowRoots([TREE], 'drop_desc')
  assert.deepEqual(sorted[0].children[0].children?.map((c) => c.label) ?? [], ['Cash', 'Financed'])
})

test('as built is the original order, and the original object', () => {
  const roots = [TREE]
  assert.equal(sortFlowRoots(roots, 'natural'), roots)
  assert.deepEqual(sortFlowRoots(roots, 'value_desc')[0].children.map((c) => c.label), [
    'Pune',
    'Nashik',
    'Kolhapur',
    'Other (4)',
  ])
})

test('every sort in the picker is one the sorter understands', () => {
  for (const { value } of FLOW_VIEW_SORTS) {
    assert.doesNotThrow(() => sortFlowRoots([TREE], value), value)
  }
})

// --- what the diagram says ------------------------------------------------

test('the summary finds the worst drop-off without anybody reading the tree', () => {
  const stats = flowStats([TREE])
  assert.equal(stats.worstDrop.label, 'Cash', '67% lost is worse than 33%')
  assert.equal(stats.biggest.label, 'Pune')
  assert.equal(stats.depth, 2)
  assert.equal(stats.nodes, 7)
  assert.equal(stats.leaves, 5)
})

test('the summary survives an empty canvas', () => {
  const stats = flowStats([])
  assert.equal(stats.nodes, 0)
  assert.equal(stats.worstDrop, null)
  assert.equal(stats.biggest, null)
})

// --- the minimap ----------------------------------------------------------

test('the minimap shrinks the whole canvas into its box', () => {
  const layout = { width: 1200, height: 600 }
  const geo = minimapGeometry(layout, { zoom: 1, x: 0, y: 0 }, { width: 400, height: 300 })
  assert.ok(geo.width <= 132.001 && geo.height <= 96.001)
  assert.ok(Math.abs(geo.width / geo.height - 2) < 0.001, 'the aspect ratio is kept')
})

test('the minimap rectangle says which part is on screen', () => {
  const layout = { width: 1000, height: 500 }
  const viewport = { width: 500, height: 250 }
  // Panned so the viewport sits over the middle of the canvas.
  const view = { zoom: 1, x: -250, y: -125 }
  const geo = minimapGeometry(layout, view, viewport)

  assert.ok(Math.abs(geo.rect.x - 250 * geo.scale) < 0.001)
  assert.ok(Math.abs(geo.rect.width - 500 * geo.scale) < 0.001)
})

test('zooming in makes the minimap rectangle smaller', () => {
  const layout = { width: 1000, height: 500 }
  const viewport = { width: 500, height: 250 }
  const wide = minimapGeometry(layout, { zoom: 1, x: 0, y: 0 }, viewport)
  const close = minimapGeometry(layout, { zoom: 2, x: 0, y: 0 }, viewport)
  assert.ok(close.rect.width < wide.rect.width, 'you are looking at less of it')
})

test('clicking the minimap centres the viewport there', () => {
  const layout = { width: 1000, height: 500 }
  const viewport = { width: 500, height: 250 }
  const view = { zoom: 1, x: 0, y: 0 }
  const geo = minimapGeometry(layout, view, viewport)

  // Click the middle of the minimap.
  const next = minimapJump(layout, viewport, view, { x: geo.width / 2, y: geo.height / 2 })
  // The middle of the canvas should now be the middle of the screen.
  assert.ok(Math.abs(500 * next.zoom + next.x - viewport.width / 2) < 0.001)
  assert.ok(Math.abs(250 * next.zoom + next.y - viewport.height / 2) < 0.001)
})

test('a canvas with no size has no minimap rather than a divide by zero', () => {
  assert.equal(minimapGeometry({ width: 0, height: 0 }, { zoom: 1 }, { width: 10, height: 10 }), null)
  const view = { zoom: 1, x: 1, y: 2 }
  assert.equal(minimapJump({ width: 0, height: 0 }, { width: 10, height: 10 }, view, { x: 0, y: 0 }), view)
})

// --- the peek -------------------------------------------------------------

const anchorAt = (left, top, width = 178, height = 58) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
})

test('the peek opens beside the branch, not over the level below it', () => {
  const place = peekPlacement(anchorAt(300, 200), { width: 272, height: 272 }, { width: 1200, height: 700 })
  assert.equal(place.side, 'right')
  assert.equal(place.x, 300 + 178 + 10)
})

test('it flips to the other side when there is no room', () => {
  const place = peekPlacement(anchorAt(900, 200), { width: 272, height: 272 }, { width: 1200, height: 700 })
  assert.equal(place.side, 'left')
  assert.equal(place.x, 900 - 272 - 10)
})

test('with room on neither side it overlaps rather than running off screen', () => {
  const place = peekPlacement(anchorAt(120, 100), { width: 272, height: 272 }, { width: 380, height: 700 })
  assert.equal(place.side, 'over')
  assert.ok(place.x >= 8 && place.x + 272 <= 380 - 8 + 0.001)
})

test('it is centred on the branch, then pushed back inside the screen', () => {
  const middle = peekPlacement(anchorAt(100, 300), { width: 272, height: 272 }, { width: 1200, height: 700 })
  assert.equal(middle.y, 300 + 29 - 136)

  const high = peekPlacement(anchorAt(100, 0), { width: 272, height: 272 }, { width: 1200, height: 700 })
  assert.equal(high.y, 8, 'never above the top of the window')

  const low = peekPlacement(anchorAt(100, 690), { width: 272, height: 272 }, { width: 1200, height: 700 })
  assert.equal(low.y, 700 - 272 - 8, 'never below the bottom')
})

test('the peek lists everything directly under the branch', () => {
  const rows = peekRows(TREE)
  assert.deepEqual(rows.map((r) => r.label), ['Pune', 'Nashik', 'Kolhapur', 'Other (4)'])
  assert.equal(rows[0].hasChildren, true, 'and says which of them go deeper')
  assert.equal(rows[1].hasChildren, false)
})

test('when the children do not add up, the peek says what is missing', () => {
  // A split capped at the top six leaves rows in the parent that are in none
  // of its children. A list that quietly omitted them would have the reader
  // adding up six numbers, getting the wrong total, and trusting the list.
  const capped = node('', 'All', 1000, {
    children: [node('/a', 'A', 600, { share: 0.6 }), node('/b', 'B', 300, { share: 0.3 })],
  })
  const rows = peekRows(capped)
  const rest = rows.at(-1)
  assert.equal(rest.kind, 'rest')
  assert.equal(rest.value, 100)
  assert.ok(Math.abs(rest.share - 0.1) < 0.001)
})

test('children that add up exactly get no missing row', () => {
  const exact = node('', 'All', 100, {
    children: [node('/a', 'A', 60, { share: 0.6 }), node('/b', 'B', 40, { share: 0.4 })],
  })
  assert.equal(peekRows(exact).length, 2)
})

test('a leaf peeks as an empty list rather than crashing', () => {
  assert.deepEqual(peekRows(node('/leaf', 'Leaf', 5)), [])
  assert.deepEqual(peekRows(null), [])
})
