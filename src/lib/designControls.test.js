import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------
// Is the design mode still connected to anything?
// ---------------------------------------------------------------------
// pageDesign.test.js proves the maths -- what a gap clamps to, where a drop
// lands, how a span scales when the column count changes. This proves the
// controls still call it, which is the half a refactor breaks silently: the
// panel draws, the slider slides, and the page does not move.
//
// Comments are stripped before matching. An assertion that a name appears
// in a file has been satisfied by the comment explaining that name, in this
// very project, long after the code had gone.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const dashboard = read('pages/Dashboard.jsx')
const panel = read('components/PageDesignPanel.jsx')
const grid = read('components/MasonryGrid.jsx')
const bar = read('components/ArrangeBar.jsx')

// --- the page's own design ------------------------------------------------

test('the design reaches every card as custom properties on the canvas', () => {
  assert.ok(dashboard.includes('...designVars(design)'))
  assert.ok(dashboard.includes('page-canvas'))
})

test('both gaps and the column count reach the grid', () => {
  assert.ok(dashboard.includes('gap={design.gapX}'))
  assert.ok(dashboard.includes('gapY={design.gapY}'))
  assert.ok(dashboard.includes('columns={design.columns}'))
})

test('the grid uses them rather than the hard-coded twelve', () => {
  assert.ok(grid.includes('(containerWidth - gap * (columns - 1)) / columns'))
  assert.ok(grid.includes('assignColumns(items, breakpoint, columns, colWidth, gap, rowGap)'))
  assert.ok(grid.includes('packMasonry(items, slots, heights, rowGap, columns)'))
  assert.ok(!grid.includes('packMasonry(items, slots, heights, gap, COLUMNS)'), 'the old fixed call is gone')
})

test('a change is a draft until it is saved, but is on screen at once', () => {
  // A design being fiddled with is not a design the other forty people
  // looking at this page should be watching change under them.
  assert.ok(dashboard.includes('const [designDraft, setDesignDraft] = useState(null)'))
  assert.ok(dashboard.includes('clampDesign(designDraft ?? page?.design)'))
  assert.ok(dashboard.includes('onChange={setDesignDraft}'))
  assert.ok(dashboard.includes('onSave={savePageDesign}'))
})

test('saving the design is admin-only and writes to the page', () => {
  assert.ok(dashboard.includes('async function savePageDesign() { if (!isAdmin || !page?.id) return'))
  assert.ok(dashboard.includes("doc(db, 'dashboards', page.id)"))
})

test('closing the panel discards an unsaved design rather than leaving it hanging', () => {
  assert.ok(dashboard.includes('setDesignDraft(null)'))
  assert.ok(dashboard.includes('setThemeDraft(null)'))
})

test('every control on the panel is wired to the design', () => {
  for (const field of ['gapX: v', 'gapY: v', 'columns: c', 'fontScale: v / 100', 'cardRadius: v', 'cardPadding: v']) {
    assert.ok(panel.includes(field), field)
  }
  assert.ok(panel.includes('onChange={(e) => set({ cardBg: e.target.value })}'))
  assert.ok(panel.includes('onChange={(e) => onThemeChange(e.target.value)}'))
})

test('the panel can put the page back to stock', () => {
  assert.ok(panel.includes('onChange({ ...DEFAULT_DESIGN })'))
  assert.ok(panel.includes('disabled={isDefaultDesign(d)}'))
})

// --- moving a widget by dragging it --------------------------------------

test('a widget can be dragged, but only in design mode and only by the handle', () => {
  // A card is full of buttons; a whole-card drag would make every one of
  // them a coin toss between "I clicked that" and "I moved this".
  assert.ok(grid.includes('if (!draggable) return'))
  assert.ok(grid.includes('onPointerDown={(e) => startDrag(item.id, e)}'))
  assert.ok(dashboard.includes('draggable={isAdmin && arranging}'))
})

test('the drop shows where it would land, on the side the pointer is', () => {
  assert.ok(grid.includes('dropTargetAt(boxes, point, d.id)'))
  assert.ok(grid.includes("drag.over.after ? '-right-1.5' : '-left-1.5'"))
})

test('a press that never moved is a press, not a drop', () => {
  assert.ok(grid.includes('if (d && current?.moved && d.over && d.over.id !== d.id) onMove?.(d.id, d.over.id, d.over.after)'))
})

test('a drop reorders the page itself, not one admin’s preferences', () => {
  // Dragging a widget on the canvas is designing the page, which is the one
  // thing the per-user ordering deliberately is not.
  assert.ok(dashboard.includes('async function moveWidgetTo(dragId, overId, after)'))
  assert.ok(dashboard.includes('dropIndex(ids, dragId, overId, after)'))
  assert.ok(dashboard.includes('moveItem(widgets, from, to)'))
  assert.ok(dashboard.includes('onMove={moveWidgetTo}'))
})

// --- one widget's own look ------------------------------------------------

test('every widget can be restyled from the widget', () => {
  assert.ok(bar.includes('function WidgetPaint('))
  assert.ok(bar.includes("title=\"How this widget looks\""))
  for (const field of ['theme: e.target.value', 'bg: v', 'accent: v', 'borderColor: v', 'radius: v', 'padding: v']) {
    assert.ok(bar.includes(field), field)
  }
})

test('a widget can be sized in columns, with no pixels involved', () => {
  assert.ok(bar.includes('onChange={(e) => onSize({ widthUnits: Number(e.target.value) })}'))
  assert.ok(
    dashboard.includes("if (key === 'widthUnits') {"),
    'and a column span takes no pixel floor'
  )
  assert.ok(dashboard.includes('clean.widthPx = null'), 'choosing columns takes the pixel pin off')
})

test('a widget’s look is saved to the page, for everyone', () => {
  assert.ok(dashboard.includes('async function saveWidgetStyle(widgetId, style)'))
  assert.ok(dashboard.includes('onStyle={isAdmin ? (next) => saveWidgetStyle(widget.id, next) : undefined}'))
})

test('a widget can be put back to the page’s look', () => {
  assert.ok(bar.includes('onStyle({ ...DEFAULT_WIDGET_STYLE })'))
})
