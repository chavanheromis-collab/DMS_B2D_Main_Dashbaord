import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  MAX_WIDGET_DEPTH,
  ascendWidget,
  childWidgets,
  descendWidget,
  editLevel,
  findWidget,
  hasChildren,
  insideLabel,
  liveWidgetPath,
  replaceAt,
  widgetPath,
  widgetsAt,
} from './widgetNest.js'

const TREE = [
  { id: 'kpi', type: 'kpi', title: 'Total' },
  {
    id: 'sales',
    type: 'chart',
    title: 'Sales',
    widgets: [
      { id: 'west', type: 'chart', title: 'West' },
      {
        id: 'north',
        type: 'chart',
        title: 'North',
        widgets: [{ id: 'agra', type: 'chart', title: 'Agra' }],
      },
    ],
  },
]

// ---------------------------------------------------------------------
// Where you are
// ---------------------------------------------------------------------

test('a widget can own widgets, and most do not', () => {
  assert.equal(hasChildren(TREE[0]), false)
  assert.equal(hasChildren(TREE[1]), true)
  assert.deepEqual(childWidgets(TREE[1]).map((w) => w.id), ['west', 'north'])
  assert.deepEqual(childWidgets(undefined), [], 'and asking about nothing is not a crash')
})

test('an empty path is the page itself', () => {
  assert.deepEqual(widgetsAt(TREE, []).map((w) => w.id), ['kpi', 'sales'])
  assert.deepEqual(widgetPath(TREE, []), [])
})

test('a path names the widgets leading to a level', () => {
  assert.deepEqual(widgetsAt(TREE, ['sales']).map((w) => w.id), ['west', 'north'])
  assert.deepEqual(widgetsAt(TREE, ['sales', 'north']).map((w) => w.id), ['agra'])
  assert.deepEqual(widgetPath(TREE, ['sales', 'north']).map((w) => w.id), ['sales', 'north'])
})

test('a deleted widget puts the reader back at its parent', () => {
  // Rather than in front of a blank page. An admin can delete a widget
  // while somebody is inside it.
  assert.deepEqual(widgetsAt(TREE, ['sales', 'gone']).map((w) => w.id), ['west', 'north'])
  assert.deepEqual(liveWidgetPath(TREE, ['sales', 'gone', 'agra']), ['sales'])
  assert.deepEqual(liveWidgetPath(TREE, ['nope']), [])

  // And a broken link is not STEPPED OVER. Resolving past it would land on
  // whatever the next id happens to name, which is somewhere nobody asked
  // for rather than the last place they were.
  assert.deepEqual(liveWidgetPath(TREE, ['gone', 'sales']), [])
  assert.deepEqual(widgetsAt(TREE, ['gone', 'sales']).map((w) => w.id), ['kpi', 'sales'])
})

test('a reader cannot open an empty widget; an admin can', () => {
  // The way in has to exist before there is anything behind it -- that is
  // how the first child gets added. But for a reader an empty level is a
  // blank page and a dead end.
  assert.deepEqual(descendWidget(TREE, [], 'kpi'), [], 'nothing inside, nothing happens')
  assert.deepEqual(descendWidget(TREE, [], 'kpi', { allowEmpty: true }), ['kpi'])
  assert.deepEqual(descendWidget(TREE, [], 'sales'), ['sales'])
  assert.deepEqual(descendWidget(TREE, [], 'ghost', { allowEmpty: true }), [], 'and only a widget that exists')
})

test('opening works only on the level you are looking at', () => {
  assert.deepEqual(descendWidget(TREE, ['sales'], 'north'), ['sales', 'north'])
  assert.deepEqual(descendWidget(TREE, ['sales'], 'kpi', { allowEmpty: true }), ['sales'], 'kpi is not at this level')
})

test('the nesting has a floor', () => {
  const deep = { id: 'd0', widgets: [{ id: 'd1', widgets: [{ id: 'd2', widgets: [{ id: 'd3', widgets: [{ id: 'd4' }] }] }] }] }
  const at = ['d0', 'd1', 'd2']
  assert.equal(at.length, MAX_WIDGET_DEPTH)
  assert.deepEqual(widgetsAt([deep], at).map((w) => w.id), ['d3'], 'and d3 really is reachable and non-empty')
  assert.deepEqual(descendWidget([deep], at, 'd3'), at, 'past the cap, nothing happens')
  assert.deepEqual(descendWidget([deep], at.slice(0, -1), 'd2'), at, 'one shy of it still works')
})

test('climbing back: -1 is the page, 0 the first crumb', () => {
  assert.deepEqual(ascendWidget(['sales', 'north'], -1), [])
  assert.deepEqual(ascendWidget(['sales', 'north'], 0), ['sales'])
  assert.deepEqual(ascendWidget(['sales', 'north'], 1), ['sales', 'north'])
})

// ---------------------------------------------------------------------
// Writing back out
// ---------------------------------------------------------------------

test('an edit at the top level is the level', () => {
  assert.deepEqual(replaceAt(TREE, [], [{ id: 'only' }]), [{ id: 'only' }])
})

test('an edit inside is rebuilt on the way out', () => {
  // Every save writes ONE array: the page's widgets. A change several
  // levels down has to come back as a whole tree or it is not saved at all.
  const next = replaceAt(TREE, ['sales'], [{ id: 'west' }])
  assert.deepEqual(next.map((w) => w.id), ['kpi', 'sales'], 'the page keeps its own shape')
  assert.deepEqual(next[1].widgets.map((w) => w.id), ['west'])
  assert.deepEqual(TREE[1].widgets.map((w) => w.id), ['west', 'north'], 'and the original is untouched')
})

test('two levels down, both parents are rebuilt', () => {
  const next = replaceAt(TREE, ['sales', 'north'], [{ id: 'agra' }, { id: 'mathura' }])
  assert.deepEqual(next[1].widgets[1].widgets.map((w) => w.id), ['agra', 'mathura'])
  assert.deepEqual(next[1].widgets[0], TREE[1].widgets[0], 'a sibling is left alone')
})

test('a path that names nothing writes nothing', () => {
  // Appending the level to the top instead would silently move every child
  // widget onto the page.
  assert.deepEqual(replaceAt(TREE, ['ghost'], [{ id: 'x' }]), TREE)
  assert.deepEqual(replaceAt(TREE, ['sales', 'ghost'], [{ id: 'x' }])[1].widgets, TREE[1].widgets)
})

test('editLevel is "map over what is on screen, give me the page back"', () => {
  const next = editLevel(TREE, ['sales'], (list) => list.filter((w) => w.id !== 'west'))
  assert.deepEqual(next[1].widgets.map((w) => w.id), ['north'])
  assert.deepEqual(editLevel(TREE, [], (list) => [...list, { id: 'new' }]).map((w) => w.id), ['kpi', 'sales', 'new'])
})

test('a level edited to nothing is empty, not undefined', () => {
  const next = editLevel(TREE, ['sales'], () => undefined)
  assert.deepEqual(next[1].widgets, [])
})

// ---------------------------------------------------------------------
// Finding one anywhere
// ---------------------------------------------------------------------

test('a widget is found wherever it lives', () => {
  // The edit panel can outlive a descent, and a widget you are inside is
  // not on the page's own list.
  assert.equal(findWidget(TREE, 'kpi').title, 'Total')
  assert.equal(findWidget(TREE, 'agra').title, 'Agra')
  assert.equal(findWidget(TREE, 'nope'), null)
  assert.equal(findWidget(undefined, 'kpi'), null)
})

test('a chip says how many, because "some" is not an answer', () => {
  assert.equal(insideLabel(TREE[1]), '2 inside')
  assert.equal(insideLabel({ widgets: [{ id: 'a' }] }), '1 inside')
  assert.equal(insideLabel({}), '0 inside')
  assert.equal(insideLabel(undefined), '0 inside')
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

const dashboard = read('src/pages/Dashboard.jsx')

test('the page draws the level that is open, not its own list', () => {
  assert.ok(dashboard.includes('const [openWidgets, setOpenWidgets] = useState([])'))
  assert.ok(dashboard.includes('levelWidgets: widgetsAt(widgets, live)'))
  assert.ok(dashboard.includes('visibleWidgetsFor({ ...page, widgets: levelWidgets }, access, isAdmin)'))
})

test('EVERY edit goes through the level, or it saves to the wrong place', () => {
  // A missed site writes a child's change onto the page, silently.
  assert.ok(dashboard.includes('const atLevel = useCallback((fn) => editLevel(widgets, insidePath, fn)'))
  for (const call of [
    'atLevel((list) => list.map((w) => (w.id === widgetId ? { ...w, style } : w)))',
    'atLevel((list) => [...list, born])',
    'atLevel((list) => list.filter((w) => w.id !== id))',
    'atLevel((list) => list.map((w) => (w.id === id ? { ...w, title } : w)))',
    'atLevel((list) => list.map((w) => (w.id === widgetId ? { ...w, columns } : w)))',
  ]) {
    assert.ok(dashboard.includes(call), call)
  }
  // Nothing still reaches past it to the page's own array.
  assert.ok(!dashboard.includes('(page.widgets || []).map('), 'a mutation still on the top level')
  assert.ok(!dashboard.includes('(page.widgets || []).filter((w) => w.id'), 'a delete still on the top level')
})

test('the way in is a corner chip, not the card', () => {
  // The card is a working chart; a click on a bar should drill the bar.
  assert.ok(dashboard.includes('setOpenWidgets(descendWidget(widgets, insidePath, widget.id, { allowEmpty: isAdmin }))'))
  const at = dashboard.indexOf('setOpenWidgets(descendWidget(')
  assert.ok(dashboard.slice(at, at + 900).includes('absolute bottom-2 right-2 z-20'))
})

test('a reader is only offered a widget with something behind it', () => {
  assert.ok(dashboard.includes('{(hasChildren(widget) || (editing && isAdmin)) && insidePath.length < MAX_WIDGET_DEPTH && ('))
  assert.ok(dashboard.includes('allowEmpty: isAdmin'))
})

test('there is a trail back, and it only shows once there is a back', () => {
  assert.ok(dashboard.includes('{insideChain.length > 0 && ('))
  assert.ok(dashboard.includes('setOpenWidgets(ascendWidget(insidePath, i))'))
  assert.ok(dashboard.includes('onClick={() => setOpenWidgets([])}'), 'and one click home')
})

test('leaving the page leaves the widget', () => {
  // Otherwise the next page opens inside a widget that is not on it.
  const at = dashboard.indexOf('setOpenWidgets([]) }, [page?.id])')
  assert.ok(at > 0, 'the descent is reset when the page changes')
})
