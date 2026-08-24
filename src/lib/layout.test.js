import test from 'node:test'
import assert from 'node:assert/strict'

import { orderWidgets } from './widgetOrder.js'
import { MIN_HEIGHT_PX, MIN_WIDTH_PX, drawnWidth, heightStyle } from './gridSpan.js'
import { groupStacked, groupSeries, scatterPoints } from './dataUtils.js'
import { resolveStyle, styleVars, styleClass } from './widgetStyle.js'
import { canvasFor, childPages, navLabelFor, sidebarPages } from './workspace.js'
import { filterIsActive } from './filterEngine.js'

// --- widget ordering ----------------------------------------------------

const widgets = [
  { id: 'a', title: 'A' },
  { id: 'b', title: 'B' },
  { id: 'c', title: 'C' },
]

test('unordered widgets keep the order the admin added them in', () => {
  assert.deepEqual(orderWidgets(widgets, {}).map((w) => w.id), ['a', 'b', 'c'])
})

test('a single personal position moves only that widget', () => {
  // Numbering just "C" as 1 must not reshuffle A and B relative to each
  // other -- that would make the first edit feel destructive.
  assert.deepEqual(orderWidgets(widgets, { c: 1 }).map((w) => w.id), ['c', 'a', 'b'])
})

test("a user's own order beats the admin's default", () => {
  const withAdminOrder = [
    { id: 'a', order: 1 },
    { id: 'b', order: 2 },
    { id: 'c', order: 3 },
  ]
  assert.deepEqual(orderWidgets(withAdminOrder, {}).map((w) => w.id), ['a', 'b', 'c'])
  assert.deepEqual(orderWidgets(withAdminOrder, { c: 0 }).map((w) => w.id), ['c', 'a', 'b'])
})

test('ties fall back to the admin list order, so ordering is never random', () => {
  assert.deepEqual(orderWidgets(widgets, { a: 5, b: 5, c: 5 }).map((w) => w.id), ['a', 'b', 'c'])
})

// --- stacked / grouped bars --------------------------------------------

const rows = [
  { Region: 'West', Status: 'Won', Amount: '10' },
  { Region: 'West', Status: 'Lost', Amount: '5' },
  { Region: 'West', Status: 'Won', Amount: '7' },
  { Region: 'East', Status: 'Won', Amount: '3' },
  { Region: 'East', Status: '', Amount: '1' },
]

test('groupStacked builds one entry per group with a field per segment', () => {
  const { data, series } = groupStacked(rows, {
    groupBy: 'Region',
    stackBy: 'Status',
    valueColumn: 'Amount',
    aggregation: 'sum',
  })

  assert.deepEqual(series.sort(), ['(blank)', 'Lost', 'Won'])
  const west = data.find((d) => d.name === 'West')
  assert.equal(west.Won, 17)
  assert.equal(west.Lost, 5)
  // Groups with no rows in a segment still carry a zero, so the chart has a
  // consistent shape and recharts doesn't drop the bar.
  assert.equal(west['(blank)'], 0)
})

test('groupStacked merges overflow segments into Other rather than dropping them', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ G: 'g', S: `s${i}`, V: '1' }))
  const { data, series } = groupStacked(many, {
    groupBy: 'G',
    stackBy: 'S',
    valueColumn: 'V',
    aggregation: 'sum',
    maxSeries: 3,
  })

  assert.ok(series.includes('Other'))
  assert.equal(series.length, 4)
  // Nothing is lost: the 12 rows still total 12 across the segments.
  const total = series.reduce((sum, key) => sum + data[0][key], 0)
  assert.equal(total, 12)
})

// --- combo --------------------------------------------------------------

test('groupSeries computes several aggregations per group', () => {
  const out = groupSeries(rows, {
    groupBy: 'Region',
    series: [
      { key: 'n', column: null, aggregation: 'count' },
      { key: 'total', column: 'Amount', aggregation: 'sum' },
    ],
  })
  const west = out.find((d) => d.name === 'West')
  assert.equal(west.n, 3)
  assert.equal(west.total, 22)
})

// --- scatter ------------------------------------------------------------

test('scatter skips rows that are not numeric on both axes', () => {
  const points = scatterPoints(
    [
      { x: '1', y: '2' },
      { x: 'n/a', y: '5' },
      { x: '3', y: '' },
      { x: '4', y: '8' },
    ],
    { xColumn: 'x', yColumn: 'y' }
  )
  // Two usable rows; the other two would have to be invented as zeroes.
  assert.equal(points[0].points.length, 2)
  assert.deepEqual(points[0].points.map((p) => p.x), [1, 4])
})

test('scatter splits into one series per group', () => {
  const points = scatterPoints(
    [
      { x: '1', y: '2', g: 'A' },
      { x: '2', y: '3', g: 'B' },
      { x: '3', y: '4', g: 'A' },
    ],
    { xColumn: 'x', yColumn: 'y', groupBy: 'g' }
  )
  assert.equal(points.length, 2)
  assert.equal(points.find((s) => s.name === 'A').points.length, 2)
})

// --- widget styling -----------------------------------------------------

test('an untouched widget emits no style at all', () => {
  assert.equal(resolveStyle(null), null)
  assert.equal(styleVars(null), undefined)
  assert.equal(styleVars({ theme: '' }), undefined)
  assert.equal(styleClass(null), '')
})

test('an explicit field overrides the theme it came from', () => {
  const vars = styleVars({ theme: 'elevated', borderColor: '#FF0000' })
  assert.equal(vars['--card-border-color'], '#FF0000')
  // ...while the rest of the theme still applies.
  assert.equal(vars['--card-radius'], '20px')
})

test('a zero border width survives instead of being treated as unset', () => {
  const vars = styleVars({ theme: '', borderWidth: 0 })
  assert.equal(vars['--card-border-width'], '0px')
})

test('the dark theme asks for text inversion', () => {
  assert.equal(styleClass({ theme: 'dark' }), 'card-invert')
  assert.equal(styleClass({ theme: 'plain' }), '')
})

// --- page placement -----------------------------------------------------

const pages = [
  { id: 'p1', name: 'Sales', order: 0 },
  { id: 'p2', name: 'Detail', parentId: 'p1', order: 1 },
  { id: 'p3', name: 'Hidden', showInSidebar: false, order: 2 },
  { id: 'p4', name: 'Orphan', parentId: 'gone', order: 3 },
]

test('the sidebar label falls back to the page title when unset', () => {
  // A page that never sets a nav label must behave exactly as before, so
  // creating one page never means filling in two name boxes.
  assert.equal(navLabelFor({ name: 'Sales Performance — FY25' }), 'Sales Performance — FY25')
  assert.equal(navLabelFor({ name: 'Sales Performance — FY25', navLabel: '' }), 'Sales Performance — FY25')
  // Whitespace is not a label.
  assert.equal(navLabelFor({ name: 'Sales', navLabel: '   ' }), 'Sales')
  assert.equal(navLabelFor({ name: 'Sales Performance — FY25', navLabel: 'Sales' }), 'Sales')
  assert.equal(navLabelFor(null), '')
})

test('the sidebar lists top-level, visible pages only', () => {
  assert.deepEqual(sidebarPages(pages).map((p) => p.id), ['p1', 'p4'])
})

test('a sub-canvas whose parent was deleted returns to the sidebar', () => {
  // Otherwise it would be unreachable with no way to get it back.
  assert.ok(sidebarPages(pages).some((p) => p.id === 'p4'))
})

test('a canvas exposes its parent and children as one tab strip', () => {
  assert.deepEqual(childPages(pages, 'p1').map((p) => p.id), ['p2'])

  const fromParent = canvasFor(pages, pages[0])
  const fromChild = canvasFor(pages, pages[1])
  // A child sees the same strip its parent does, so the tabs don't change
  // as you move between them.
  assert.deepEqual(fromParent.tabs.map((p) => p.id), ['p1', 'p2'])
  assert.deepEqual(fromChild.tabs.map((p) => p.id), ['p1', 'p2'])

  assert.equal(canvasFor(pages, pages[2]), null)
})

// --- new filter controls ------------------------------------------------

test('slider and chips reuse their siblings’ value shapes', () => {
  assert.equal(filterIsActive({ kind: 'slider' }, { from: '5', to: '10' }), true)
  assert.equal(filterIsActive({ kind: 'slider' }, {}), false)
  assert.equal(filterIsActive({ kind: 'chips' }, ['a']), true)
  assert.equal(filterIsActive({ kind: 'chips' }, []), false)
})

// --- a pinned height that a phone can still keep --------------------------

test('a pinned height is honoured as typed', () => {
  // An earlier version capped this against the viewport, so every value past
  // about 650px drew the same height: the admin typed 700, then 800, then
  // 900, and nothing moved. The stylesheet caps it on a phone instead.
  assert.deepEqual(heightStyle(640), { '--widget-h': '640px' })
  assert.deepEqual(heightStyle(1200), { '--widget-h': '1200px' })
  assert.notDeepEqual(heightStyle(700), heightStyle(900), 'a bigger number is a bigger widget')
})

test('no pin means no opinion, which is what most widgets want', () => {
  assert.equal(heightStyle(null), null)
  assert.equal(heightStyle(0), null)
  assert.equal(heightStyle(''), null)
  assert.equal(heightStyle('abc'), null)
  assert.equal(heightStyle(-10), null)
})

test('a height too small to be a decision is raised to a floor', () => {
  // Low, though: a thin strip of a KPI is a legitimate thing to want.
  assert.deepEqual(heightStyle(20), { '--widget-h': '60px' })
  assert.deepEqual(heightStyle(90), { '--widget-h': '90px' })
})

test('fractions are rounded rather than written into the stylesheet', () => {
  assert.deepEqual(heightStyle(300.6), { '--widget-h': '301px' })
})

// --- how wide a pinned widget actually draws -----------------------------

test('a pinned width draws at exactly its number', () => {
  assert.equal(drawnWidth(306, { left: 0, containerWidth: 1200, spanWidth: 360 }), 306)
})

test('a pinned width never spills off the right edge of the canvas', () => {
  // Measured from where the widget SITS. Clamping against the canvas width
  // alone let a widget in the seventh column draw halfway off the page,
  // where the part that overflowed simply could not be reached.
  assert.equal(drawnWidth(412, { left: 750, containerWidth: 900, spanWidth: 150 }), 150)
  assert.equal(drawnWidth(2000, { left: 0, containerWidth: 900, spanWidth: 900 }), 900)
})

test('no pinned width falls back to the span the packer reserved', () => {
  assert.equal(drawnWidth(0, { left: 0, containerWidth: 1200, spanWidth: 360 }), 360)
  assert.equal(drawnWidth(null, { left: 0, containerWidth: 1200, spanWidth: 360 }), 360)
})

test('before the canvas has been measured, the number is taken as given', () => {
  // The first frame: no ResizeObserver has reported yet, and clamping
  // against a width of zero would draw every pinned widget one pixel wide.
  assert.equal(drawnWidth(306, { left: 0, containerWidth: 0, spanWidth: 0 }), 306)
})

test('the floors are low enough to be useful and high enough to be visible', () => {
  assert.ok(MIN_WIDTH_PX >= 40 && MIN_WIDTH_PX <= 200)
  assert.equal(MIN_HEIGHT_PX, 60, 'the height floor heightStyle already used')
})
