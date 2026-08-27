import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { MIN_PANEL, dockFor, isEditing, mergeDraft, scrimBands, spotlight } from './editMode.js'
import { WIDGET_TYPES, makeWidget } from './newWidget.js'

const VP = { width: 1440, height: 900 }

// ---------------------------------------------------------------------
// The editor goes beside the widget, never over it
// ---------------------------------------------------------------------

test('a widget in a corner is edited from the biggest side', () => {
  // A KPI top-left leaves the whole rest of the screen; a form beside the
  // thing it changes beats a form under it.
  const dock = dockFor({ left: 20, top: 80, right: 300, bottom: 220 }, VP)
  assert.equal(dock.side, 'right')
  assert.ok(dock.size > 1000)
})

test('a full-width widget is edited from underneath', () => {
  // There is no band beside it, so there is no argument about the side.
  const dock = dockFor({ left: 20, top: 80, right: 1420, bottom: 400 }, VP)
  assert.equal(dock.side, 'bottom')
})

test('a widget with nothing big enough around it gets a sheet', () => {
  // A phone, or a widget that fills the canvas. Pretending 90 pixels is a
  // panel is worse than covering the widget honestly.
  const dock = dockFor({ left: 0, top: 0, right: 1440, bottom: 900 }, VP)
  assert.equal(dock.side, 'sheet')
  assert.ok(dock.size >= MIN_PANEL)
})

test('a panel is never narrower than a form can be read in', () => {
  for (const rect of [
    { left: 0, top: 0, right: 1200, bottom: 500 },
    { left: 300, top: 40, right: 1400, bottom: 860 },
    { left: 10, top: 10, right: 20, bottom: 20 },
  ]) {
    const dock = dockFor(rect, VP)
    assert.ok(dock.size >= MIN_PANEL, JSON.stringify(rect))
  }
})

test('the panel’s box never overlaps the widget’s', () => {
  // The whole promise. Swept over a grid of widget rectangles.
  for (let left = 0; left < 1200; left += 137) {
    for (let top = 0; top < 800; top += 91) {
      const rect = { left, top, right: Math.min(1440, left + 400), bottom: Math.min(900, top + 260) }
      const dock = dockFor(rect, VP)
      if (dock.side === 'sheet') continue

      const p = dock.style
      const pLeft = p.left ?? VP.width - p.width
      const pRight = p.width === undefined ? VP.width : pLeft + p.width
      const pTop = p.top ?? (p.height === undefined ? 0 : VP.height - p.height)
      const pBottom = p.height === undefined ? VP.height : pTop + p.height

      const apart =
        pRight <= rect.left + 0.5 ||
        pLeft >= rect.right - 0.5 ||
        pBottom <= rect.top + 0.5 ||
        pTop >= rect.bottom - 0.5
      assert.ok(apart, `${dock.side} panel covers the widget at ${left},${top}`)
    }
  }
})

test('an unmeasured widget still gets an editor', () => {
  // A widget added from the edit bar has never been drawn, so it has no
  // rectangle yet. A crash there would be the first thing anybody saw.
  const dock = dockFor(null, VP)
  assert.ok(dock.side)
  assert.ok(dock.size >= MIN_PANEL)
})

// --- the screen, minus the widget ---------------------------------------

test('the four bands cover everything the widget does not', () => {
  const rect = { left: 200, top: 100, right: 600, bottom: 400 }
  const bands = scrimBands(rect, { width: 1000, height: 800 })
  const area = bands.reduce((sum, b) => sum + b.width * b.height, 0)
  assert.equal(area, 1000 * 800 - 400 * 300)
})

test('no band ever lands on the widget', () => {
  const rect = { left: 200, top: 100, right: 600, bottom: 400 }
  for (const b of scrimBands(rect, { width: 1000, height: 800 })) {
    const apart =
      b.left + b.width <= rect.left + 0.5 ||
      b.left >= rect.right - 0.5 ||
      b.top + b.height <= rect.top + 0.5 ||
      b.top >= rect.bottom - 0.5
    assert.ok(apart, `${b.key} covers the widget`)
  }
})

test('a band with no size is not drawn at all', () => {
  // A zero-height element still takes a paint and still answers a click.
  const bands = scrimBands({ left: 0, top: 0, right: 1000, bottom: 800 }, { width: 1000, height: 800 })
  assert.deepEqual(bands, [])
  for (const b of scrimBands({ left: 0, top: 100, right: 1000, bottom: 400 }, { width: 1000, height: 800 })) {
    assert.ok(b.width > 0 && b.height > 0)
  }
})

test('no widget to spare means dim the lot', () => {
  const bands = scrimBands(null, { width: 800, height: 600 })
  assert.deepEqual(bands, [{ key: 'all', left: 0, top: 0, width: 800, height: 600 }])
})

test('the ring sits outside the card, not on its border', () => {
  const ring = spotlight({ left: 10, top: 10, right: 110, bottom: 60 }, 8)
  assert.deepEqual(ring, { left: 2, top: 2, width: 116, height: 66 })
  assert.equal(spotlight(null), null)
})

// --- what the page draws while you type ---------------------------------

test('the unsaved edit is merged over the saved widget', () => {
  const widgets = [{ id: 'a', title: 'A', color: '#111' }, { id: 'b', title: 'B' }]
  const out = mergeDraft(widgets, 'b', { title: 'B2', limit: 5 })
  assert.deepEqual(out[1], { id: 'b', title: 'B2', limit: 5 })
  assert.equal(out[0], widgets[0], 'and nothing else is touched')
})

test('a draft merges rather than replaces', () => {
  // A form that knows about three fields must not drop the other forty.
  const out = mergeDraft([{ id: 'a', title: 'A', tab: 'T', color: '#111' }], 'a', { color: '#222' })
  assert.deepEqual(out[0], { id: 'a', title: 'A', tab: 'T', color: '#222' })
})

test('no draft is the widgets exactly as they were', () => {
  const widgets = [{ id: 'a' }]
  assert.equal(mergeDraft(widgets, null, { x: 1 }), widgets)
  assert.equal(mergeDraft(widgets, 'a', null), widgets)
})

test('isEditing is a question, not an expression', () => {
  assert.equal(isEditing({ id: 'a' }, 'a'), true)
  assert.equal(isEditing({ id: 'a' }, 'b'), false)
  assert.equal(isEditing({ id: 'a' }, null), false)
  assert.equal(isEditing(null, 'a'), false)
})

// ---------------------------------------------------------------------
// A new widget, from anywhere
// ---------------------------------------------------------------------

test('a new widget draws the moment it lands', () => {
  // A widget that renders as an empty box until three more fields are
  // picked is a widget nobody finishes.
  for (const t of WIDGET_TYPES) {
    const made = makeWidget({ type: t.value, tab: 'src::MASTER', name: 'MASTER', cols: ['A', 'B', 'C'] })
    assert.ok(made, t.value)
    assert.equal(made.type, t.value)
    assert.equal(made.tab, 'src::MASTER')
    // Some types are named after themselves ("Leaderboard", "Filters")
    // rather than after their tab, which reads better than either would.
    const title = String(made.title || '')
    assert.ok(title.trim().length > 0, `${t.value} has no title`)
    assert.ok(!title.includes('src::'), `${t.value} shows the ref it stores`)
    assert.ok(made.id)
  }
})

test('two widgets are never the same widget', () => {
  const a = makeWidget({ type: 'kpi', tab: 't', name: 'N', cols: ['A'] })
  const b = makeWidget({ type: 'kpi', tab: 't', name: 'N', cols: ['A'] })
  assert.notEqual(a.id, b.id)
})

test('the title reads like a title, never like the ref it stores', () => {
  const made = makeWidget({ type: 'table', tab: 'abc123::MASTER', name: 'MASTER · Premia', cols: ['A'] })
  assert.equal(made.title, 'MASTER · Premia')
  assert.ok(!made.title.includes('abc123'))
})

test('no tab means no widget, rather than a broken one', () => {
  assert.equal(makeWidget({ type: 'kpi' }), null)
  assert.equal(makeWidget({}), null)
})

test('a page of KPIs is not a page of one colour', () => {
  const first = makeWidget({ type: 'kpi', tab: 't', name: 'N', cols: ['A'], kpiCount: 0 })
  const second = makeWidget({ type: 'kpi', tab: 't', name: 'N', cols: ['A'], kpiCount: 1 })
  assert.notEqual(first.color, second.color)
})

test('the factory needs no component, no context and no store', () => {
  // Which is what lets the page add a widget without the admin panel.
  const src = fs.readFileSync(path.join(path.resolve(import.meta.dirname), 'newWidget.js'), 'utf8')
  assert.ok(!/from '\.\.\/(pages|components)/.test(src))
  assert.ok(!src.includes('useState'))
  assert.ok(!src.includes('labelFor('))
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const dashboard = read('pages/Dashboard.jsx')
const drawer = read('components/WidgetEditDrawer.jsx')
const panel = read('pages/admin/WidgetsPanel.jsx')
const bar = read('components/ArrangeBar.jsx')

test('a page opens as a thing you look at', () => {
  // View mode, for everybody including the admin who built it.
  assert.ok(dashboard.includes('const [editing, setEditing] = useState(false)'))
})

test('the switch is a switch, and it brings the pills with it', () => {
  assert.ok(dashboard.includes('setEditing(next)'))
  assert.ok(dashboard.includes('setArranging(next)'))
  assert.ok(dashboard.includes("{editing ? 'Done' : 'Edit'}"))
})

test('the edit form is the SAME one the admin panel shows', () => {
  // Not a copy and not a cut-down version: two implementations of a widget
  // form would disagree about one field within a month.
  assert.ok(drawer.includes("import WidgetsPanel from '../pages/admin/WidgetsPanel.jsx'"))
  assert.ok(drawer.includes('<WidgetsPanel compact'))
  assert.ok(panel.includes('compact = false,'))
  assert.ok(panel.includes('const open = compact || openId === widget.id'), 'and the one widget is open')
})

test('compact folds away everything that belongs to the LIST', () => {
  for (const gate of ['{!compact && (', '{!compact && widgets.length === 0 && (', '{!compact && widgets.length > 3 && (']) {
    assert.ok(panel.includes(gate), gate)
  }
})

test('the widget redraws as the form is typed into', () => {
  // The draft is merged before anything reads the widgets, so the blend,
  // the filters, the canvas and the widget all see it at once.
  assert.ok(dashboard.includes('mergeDraft(visibleWidgetsFor(page, access, isAdmin), editDraft?.id, editDraft?.patch)'))
  assert.ok(dashboard.includes('setEditDraft({ id: next.id, patch: next })'))
})

test('the write is debounced, and closing flushes it', () => {
  // A document write per keystroke is not a save strategy, and an edit
  // still sitting in a timer when the panel closes is an edit lost.
  assert.ok(dashboard.includes('editTimer.current = setTimeout('))
  assert.ok(dashboard.includes('async function closeWidgetEditor()'))
  assert.ok(dashboard.includes('clearTimeout(editTimer.current) const pending = editDraft'))
})

test('a widget can be added from the page, and opens straight into itself', () => {
  assert.ok(dashboard.includes('async function addWidgetHere(type)'))
  assert.ok(dashboard.includes('makeWidget({'))
  assert.ok(dashboard.includes('setEditWidget({ id: made.id, rect: null })'))
})

test('the pill carries the way in, and hands over the rectangle', () => {
  assert.ok(bar.includes('onEdit,'))
  assert.ok(bar.includes("e.currentTarget.closest('[data-widget]')?.getBoundingClientRect()"))
  assert.ok(dashboard.includes('data-widget={widget.id}'), 'and the wrapper can be found')
  assert.ok(dashboard.includes('setEditWidget({ id: widget.id, rect })'))
})

test('nothing is ever drawn over the widget being edited', () => {
  assert.ok(drawer.includes('{bands.map((b) => ('))
  assert.ok(!drawer.includes('fixed inset-0 z-[60]'), 'no full-screen scrim over the widget')
})

test('the drawer is a portal, because a canvas is its own stacking context', () => {
  assert.ok(drawer.includes('createPortal('))
  assert.ok(drawer.includes('document.body'))
})

test('the page’s own controls are reachable from the page too', () => {
  assert.ok(dashboard.includes("{editPart === 'controls' && isAdmin && ("))
  assert.ok(dashboard.includes('<ControlsPanel'))
  assert.ok(dashboard.includes('setControls={(next) => writePage({ controls: next })}'))
})

test('the admin forms are given the context they ask for', () => {
  // They only ever asked the admin screen for it because that is where they
  // used to live; the page knows every tab it has.
  assert.ok(dashboard.includes('const adminCtx = useMemo('))
  assert.ok(dashboard.includes('<WorkspaceCtx.Provider value={adminCtx}>'))
})
