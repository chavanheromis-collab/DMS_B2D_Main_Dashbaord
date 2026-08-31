import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pivotTree } from './dataUtils.js'
import { WIDGET_TYPES } from './config.js'
import { makeWidget } from './newWidget.js'
import {
  DEFAULT_RINGS,
  MAX_RINGS,
  MIN_SLICE,
  arcMid,
  arcPath,
  fitsLabel,
  polar,
  ringBand,
  sumOf,
  sunburstArcs,
} from './sunburstData.js'

const ROWS = [
  { R: 'West', B: 'Pune' },
  { R: 'West', B: 'Pune' },
  { R: 'West', B: 'Nashik' },
  { R: 'North', B: 'Agra' },
]
const treeOf = (columns = ['R', 'B']) => pivotTree(ROWS, { rowColumns: columns, aggregation: 'count' }).tree

// ---------------------------------------------------------------------
// The hierarchy is the pivot's
// ---------------------------------------------------------------------

test('the nesting comes from pivotTree, already sorted at every level', () => {
  // Rebuilding it here would be a second hierarchy to disagree with the
  // first -- the one the pivot table draws.
  const tree = treeOf()
  assert.deepEqual(tree.map((n) => n.label), ['West', 'North'], 'biggest first, as the pivot ordered it')
  assert.deepEqual(tree[0].children.map((n) => n.label), ['Pune', 'Nashik'])
})

test('the rows behind each group are NOT carried into the drawing', () => {
  // A renderer handed every row behind a group will walk it on every frame.
  const walk = (nodes) => {
    for (const n of nodes || []) {
      assert.equal('source' in n, false, n.label)
      walk(n.children)
    }
  }
  walk(treeOf())
})

test('keeping the tree changed nothing the pivot table reads', () => {
  const out = pivotTree(ROWS, { rowColumns: ['R', 'B'], aggregation: 'count' })
  assert.equal(out.rows.length, 3)
  assert.equal(out.grandTotal, 4)
  assert.deepEqual(out.columns, ['R', 'B'])
})

// ---------------------------------------------------------------------
// Angles
// ---------------------------------------------------------------------

test('a child can never be wider than its parent, and the ring closes', () => {
  const { arcs, total } = sunburstArcs(treeOf(), { rings: 2 })
  assert.equal(total, 4)

  const west = arcs.find((a) => a.key === 'West')
  const pune = arcs.find((a) => a.key === 'West › Pune')
  const nashik = arcs.find((a) => a.key === 'West › Nashik')

  assert.deepEqual([west.startAngle, west.endAngle], [0, 270])
  assert.ok(pune.startAngle >= west.startAngle && nashik.endAngle <= west.endAngle)
  assert.equal(nashik.endAngle - pune.startAngle, west.endAngle - west.startAngle, 'the children fill the parent exactly')
})

test('the top level fills the whole circle', () => {
  const { arcs } = sunburstArcs(treeOf(), { rings: 1 })
  const top = arcs.filter((a) => a.depth === 0)
  const swept = top.reduce((s, a) => s + (a.endAngle - a.startAngle), 0)
  assert.ok(Math.abs(swept - 360) < 1e-9)
})

test('a wedge knows its share of EVERYTHING, not just of its parent', () => {
  // "4% of everything" is the number somebody quotes; the parent share is
  // recoverable from the wedge in front of them.
  const { arcs } = sunburstArcs(treeOf(), { rings: 2 })
  const pune = arcs.find((a) => a.key === 'West › Pune')
  assert.equal(pune.share, 0.5)
  assert.ok(Math.abs(pune.parentShare - 2 / 3) < 1e-9)
})

test('a wedge carries its whole path, because a label is ambiguous', () => {
  // "Pune" on its own stops meaning one thing the moment two regions have a
  // branch of that name.
  const { arcs } = sunburstArcs(treeOf(), { rings: 2 })
  assert.deepEqual(arcs.find((a) => a.key === 'West › Pune').path, ['West', 'Pune'])
})

test('rings stop where the admin said, not where the data ends', () => {
  assert.equal(sunburstArcs(treeOf(), { rings: 1 }).arcs.every((a) => a.depth === 0), true)
  assert.ok(sunburstArcs(treeOf(), { rings: 2 }).arcs.some((a) => a.depth === 1))
  assert.equal(sunburstArcs(treeOf(), { rings: 99 }).rings, MAX_RINGS, 'and never deeper than a reader can follow')
  assert.equal(sunburstArcs(treeOf(), {}).rings, DEFAULT_RINGS)
})

test('a negative value is skipped, not flipped -- and not counted as tiny', () => {
  // An average of a column with credits in it has no sweep to give, and a
  // returned car is not "minus one car" of the circle. Nor is it a wedge
  // that was too small to draw: the caption says "N too small", and a
  // negative counted there would be a lie about why it is missing.
  const tree = [{ label: 'good', value: 10, children: null }, { label: 'bad', value: -4, children: null }]
  const { arcs, total, hidden } = sunburstArcs(tree, { rings: 1 })
  assert.equal(total, 10)
  assert.deepEqual(arcs.map((a) => a.label), ['good'])
  assert.equal(arcs[0].endAngle, 360)
  assert.equal(hidden, 0, 'it is impossible to draw, not too small to see')
})

test('nothing to draw is nothing, not a divide by zero', () => {
  assert.deepEqual(sunburstArcs([], { rings: 2 }).arcs, [])
  assert.deepEqual(sunburstArcs(null).arcs, [])
  assert.equal(sunburstArcs([{ label: 'x', value: 0 }]).total, 0)
})

test('a wedge too thin to see is left out, and counted', () => {
  // Below about a third of a degree it is a hairline that cannot be
  // hovered, labelled or told from the stroke beside it. Leaving it out and
  // SAYING SO is the honest version.
  const tree = [
    { label: 'big', value: 10000, children: null },
    { label: 'speck', value: 1, children: null },
  ]
  const { arcs, hidden } = sunburstArcs(tree, { rings: 1 })
  assert.deepEqual(arcs.map((a) => a.label), ['big'])
  assert.equal(hidden, 1)
  assert.ok(MIN_SLICE > 0)
})

test('a hidden wedge still takes its room, so the ring does not shift', () => {
  const tree = [
    { label: 'speck', value: 1, children: null },
    { label: 'big', value: 10000, children: null },
  ]
  const { arcs } = sunburstArcs(tree, { rings: 1 })
  assert.ok(arcs[0].startAngle > 0, 'the big wedge starts after the gap the speck left')
})

// ---------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------

test('twelve o’clock is the top, and the sweep goes clockwise', () => {
  const top = polar(0, 100)
  assert.equal(top.x, 0)
  assert.equal(top.y, -100, 'SVG y grows downwards')
  const right = polar(90, 100)
  assert.equal(right.x, 100)
  assert.ok(Math.abs(right.y) < 1e-6)
})

test('every ring is inside the one outside it, and none reach the centre', () => {
  // The middle is where the total goes, and an inner disc has angles that
  // are unreadable at the point where they all meet.
  const a = ringBand(0, 3)
  const b = ringBand(1, 3)
  const c = ringBand(2, 3)
  assert.ok(a.inner > 0, 'there is a hole')
  assert.ok(a.outer < b.inner && b.outer < c.inner, 'and a gap between rings')
  assert.ok(c.outer <= 1)
})

test('a full circle is drawn as two arcs, because one cannot close', () => {
  // The start and end points are the same and the renderer has no way to
  // tell which way round to go.
  const path = arcPath({ depth: 0, startAngle: 0, endAngle: 360 }, { rings: 1 })
  assert.equal((path.match(/A /g) || []).length, 4, 'two for the outside, two for the hole')
  const wedge = arcPath({ depth: 0, startAngle: 0, endAngle: 90 }, { rings: 1 })
  assert.equal((wedge.match(/A /g) || []).length, 2)
})

test('a wedge over half the circle takes the long way round', () => {
  const big = arcPath({ depth: 0, startAngle: 0, endAngle: 270 }, { rings: 1 })
  assert.ok(big.includes(' 0 1 1 '), 'the large-arc flag is set')
  const small = arcPath({ depth: 0, startAngle: 0, endAngle: 90 }, { rings: 1 })
  assert.ok(small.includes(' 0 0 1 '))
})

test('a label is only written where it fits', () => {
  // A label that does not fit is a word lying across three other wedges.
  assert.equal(fitsLabel({ startAngle: 0, endAngle: 40 }), true)
  assert.equal(fitsLabel({ startAngle: 0, endAngle: 3 }), false)
})

test('a label sits in the middle of its wedge and its ring', () => {
  const mid = arcMid({ depth: 0, startAngle: 0, endAngle: 180 }, { rings: 1, radius: 100 })
  assert.ok(mid.x > 0, 'the middle of 0–180 is due east')
  assert.ok(Math.abs(mid.y) < 1e-6)
})

test('summing ignores what it cannot use', () => {
  assert.equal(sumOf([{ value: 3 }, { value: -1 }, { value: 'x' }, {}]), 3)
  assert.equal(sumOf(null), 0)
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const read = (p) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const widget = read('src/components/widgets/RelationWidgets.jsx')
const dashboard = read('src/pages/Dashboard.jsx')
const panel = read('src/pages/admin/WidgetsPanel.jsx')
const editor = read('src/pages/admin/RelationEditors.jsx')
const preview = read('src/components/WidgetTypePreview.jsx')

test('the type is in the catalogue, and can be added', () => {
  const entry = WIDGET_TYPES.find((t) => t.value === 'sunburst')
  assert.ok(entry, 'no palette entry')
  assert.ok(entry.icon && entry.hint)
  const made = makeWidget({ type: 'sunburst', tab: 't', name: 'Sales', cols: ['Region', 'Branch'] })
  assert.equal(made.groupBy, 'Region')
  assert.equal(made.groupBy2, 'Branch', 'two rings, or it is a pie chart')
})

test('the rings are the PIVOT’s hierarchy, not a second one', () => {
  assert.ok(widget.includes('}).tree'))
  assert.ok(widget.includes('rowColumns: levels,'))
  assert.ok(!widget.includes('groupRows('), 'nothing regroups the rows here')
})

test('clicking a wedge filters by every level above it', () => {
  // Otherwise clicking "Pune" inside "West" filters to every Pune in the
  // sheet.
  const at = widget.indexOf('conditions: arc.path.map(')
  assert.ok(at > 0)
  assert.ok(widget.slice(at, at + 200).includes('column: levels[i]'))
})

test('colour comes from the top-level ancestor, in shades outward', () => {
  // A palette colour per wedge would make a region and one of its branches
  // look unrelated, which is the one thing a ring chart is drawn to show.
  assert.ok(widget.includes('const root = arc.path[0]'))
  assert.ok(widget.includes('opacity: 1 - arc.depth * 0.22'))
  assert.ok(widget.includes('seriesColor(root, index, widget.valueColors, palette)'), 'and by NAME, so a filter cannot reshuffle it')
})

test('the middle holds the total, or whatever is under the pointer', () => {
  // A ring chart with nothing in the middle has a hole where its own
  // headline should be.
  assert.ok(widget.includes('{fmt(shown ? shown.value : total)}'))
  assert.ok(widget.includes("{shown ? shown.label : widget.valueLabel || 'Total'}"))
})

test('the editor will not let a hierarchy have a hole in it', () => {
  // Ring three without ring two is a level that cannot be drawn.
  assert.ok(editor.includes('disabled={i > 0 && !levels[i - 1]}'))
  assert.ok(editor.includes(".slice(i).map((k) => [k, ''])"), 'and clearing one clears everything outside it')
})

test('it has an editor, a place on the page, and a sketch', () => {
  assert.ok(editor.includes('export function SunburstEditor('))
  assert.ok(panel.includes("{widget.type === 'sunburst' && <SunburstEditor"))
  assert.ok(dashboard.includes('<SunburstWidget {...common}'))
  assert.ok(preview.includes('sunburst: () => ('))
})
