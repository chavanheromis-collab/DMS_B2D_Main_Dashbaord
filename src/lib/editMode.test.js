import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { isEditing, mergeDraft } from './editMode.js'
import { WIDGET_TYPES, makeWidget } from './newWidget.js'
import {
  DEFAULT_FRACTION,
  DEFAULT_SIDE,
  MIN_PANEL,
  MIN_PREVIEW,
  clampFraction,
  fractionAt,
  previewKind,
  splitFor,
  targetTitle,
} from './editLayout.js'

const VP = { width: 1440, height: 900 }

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
const drawer = read('components/EditSplit.jsx')
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
  assert.ok(dashboard.includes('<WidgetsPanel compact'))
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
  assert.ok(dashboard.includes("setEditTarget({ kind: 'widget', id: made.id })"))
})

test('a PAGE can be added from the sidebar, and opens with its settings', () => {
  // Created empty and navigated to straight away rather than after a form is
  // filled in: a form in front of an empty canvas is a form about nothing.
  assert.ok(dashboard.includes('async function addPageHere()'))
  assert.ok(dashboard.includes("setEditTarget({ kind: 'page' })"))
  const sidebar = read('components/Sidebar.jsx')
  assert.ok(sidebar.includes('{editing && onAddPage && ('))
  assert.ok(sidebar.includes('{editing && onEditPage && !collapsed && ('))
  assert.ok(read('components/AppShell.jsx').includes('onAddPage={onAddPage}'))
})

test('the pill carries the way in', () => {
  assert.ok(bar.includes('onEdit,'))
  assert.ok(dashboard.includes("setEditTarget({ kind: 'widget', id: widget.id })"))
})

test('the preview is the page’s own render, not a second opinion', () => {
  // The same component the page draws, given the same unsaved draft, so
  // there is no second implementation to disagree with the first.
  assert.ok(dashboard.includes('{editedItem?.content}'))
  assert.ok(dashboard.includes('<WidgetCanvas items={widgetItems} gapX={design.gapX} gapY={design.gapY} />'))
  assert.ok(dashboard.includes('{controlBar}'))
})

test('the split is a portal, because a canvas is its own stacking context', () => {
  assert.ok(drawer.includes('createPortal('))
  assert.ok(drawer.includes('document.body'))
})

test('one panel serves every kind of thing', () => {
  // A different panel per kind is a different place to look per kind.
  assert.ok(dashboard.includes('<EditSplit'))
  for (const kind of ['widget', 'controls', 'page']) {
    assert.ok(dashboard.includes(`editTarget.kind === '${kind}'`), kind)
  }
  assert.ok(dashboard.includes('setControls={(next) => writePage({ controls: next })}'))
})

test('the admin forms are given the context they ask for', () => {
  // They only ever asked the admin screen for it because that is where they
  // used to live; the page knows every tab it has.
  assert.ok(dashboard.includes('const adminCtx = useMemo('))
  assert.ok(dashboard.includes('<WorkspaceCtx.Provider value={adminCtx}>'))
})

// ---------------------------------------------------------------------
// The editor on one side, the thing itself on the other
// ---------------------------------------------------------------------

const wide = { width: 1440, height: 900 }

test('the two panes tile the screen exactly', () => {
  // No gap, no overlap: a strip of the old page showing between them would
  // leave it ambiguous which half is which.
  for (const side of ['left', 'right', 'bottom']) {
    const s = splitFor(side, wide)
    const area = s.panel.width * s.panel.height + s.preview.width * s.preview.height
    assert.equal(area, wide.width * wide.height, side)

    const apart =
      s.panel.left + s.panel.width <= s.preview.left + 0.5 ||
      s.panel.left >= s.preview.left + s.preview.width - 0.5 ||
      s.panel.top + s.panel.height <= s.preview.top + 0.5 ||
      s.panel.top >= s.preview.top + s.preview.height - 0.5
    assert.ok(apart, `${side}: the panes overlap`)
  }
})

test('each side puts the panel where it says', () => {
  assert.equal(splitFor('left', wide).panel.left, 0)
  assert.equal(splitFor('right', wide).preview.left, 0)
  assert.equal(splitFor('bottom', wide).preview.top, 0)
  assert.ok(splitFor('bottom', wide).panel.top > 0)
})

test('a nonsense side is the default rather than a broken layout', () => {
  assert.equal(splitFor('sideways', wide).side, DEFAULT_SIDE)
  assert.equal(splitFor(undefined, wide).side, DEFAULT_SIDE)
})

test('the split is clamped from BOTH ends', () => {
  // A panel too narrow to read a form in is not a panel; a preview too
  // small to see the thing in is not a preview.
  assert.ok(splitFor('right', wide, 0.99).panelSize <= wide.width - MIN_PREVIEW)
  assert.ok(splitFor('right', wide, 0.01).panelSize >= MIN_PANEL)
})

test('a screen with no room for two columns stacks itself', () => {
  // A 320px form beside an 80px "preview" is not a preview, it is a strip
  // of colour.
  const phone = splitFor('right', { width: 400, height: 800 })
  assert.equal(phone.side, 'bottom')
  assert.equal(phone.asked, 'right', 'and it remembers what was asked for')
  assert.equal(phone.preview.width, 400)
})

test('when the screen cannot honour both, the FORM keeps its minimum', () => {
  // A form you cannot use makes the preview pointless as well.
  const tiny = splitFor('bottom', { width: 900, height: 400 })
  assert.equal(tiny.panelSize, MIN_PANEL)
  assert.equal(tiny.panelSize + tiny.previewSize, 400)
})

test('dragging the divider reads the pointer, not a delta', () => {
  // A delta-based resize drifts away from the hand moving it the first time
  // the drag outruns the pointer.
  assert.equal(fractionAt('right', { x: 1440 * 0.6 }, wide), 0.4)
  assert.equal(fractionAt('left', { x: 1440 * 0.6 }, wide), 0.6)
  assert.equal(fractionAt('bottom', { y: 900 * 0.7 }, wide), 0.3)
})

test('a drag is clamped to the same range the layout is', () => {
  assert.equal(fractionAt('right', { x: -5000 }, wide), 0.75)
  assert.equal(fractionAt('right', { x: 5000 }, wide), 0.2)
  assert.equal(clampFraction('nonsense'), clampFraction(DEFAULT_FRACTION))
})

test('a widget previews as itself; everything else previews as the page', () => {
  // You cannot see what a filter bar looks like by looking at the filter bar
  // alone.
  assert.equal(previewKind({ kind: 'widget' }), 'widget')
  for (const kind of ['controls', 'page', 'design', undefined]) {
    assert.equal(previewKind({ kind }), 'page', String(kind))
  }
})

test('the panel is named after what it is editing', () => {
  assert.equal(targetTitle({ kind: 'widget' }, { title: 'Sales by DSE' }), 'Sales by DSE')
  assert.equal(targetTitle({ kind: 'controls' }), 'Controls & buttons')
  assert.equal(targetTitle({ kind: 'page' }), 'Page settings')
  assert.equal(targetTitle(null), '')
})

// --- wiring --------------------------------------------------------------

const split = read('components/EditSplit.jsx')
const sidebar = read('components/Sidebar.jsx')

test('the side is a choice, and it is remembered', () => {
  assert.ok(split.includes('{EDIT_SIDES.map((s) => {'))
  assert.ok(dashboard.includes("useLocalState('dash.editSide', DEFAULT_SIDE)"))
  assert.ok(dashboard.includes("useLocalState('dash.editFraction', DEFAULT_FRACTION)"))
})

test('the divider drags', () => {
  assert.ok(split.includes('onPointerDown={() => setDragging(true)}'))
  assert.ok(split.includes('fractionAt(split.side, { x: e.clientX, y: e.clientY }, viewport)'))
})

test('the page settings form reports every keystroke', () => {
  // So a rename shows in the heading while the form is still open.
  const pages = read('pages/admin/PagesPanel.jsx')
  assert.ok(pages.includes('onDraft?.(next)'))
  assert.ok(dashboard.includes('onDraft={setPageDraft}'))
  assert.ok(dashboard.includes('savedPage && pageDraft ? { ...savedPage, ...pageDraft } : savedPage'))
})

test('the admin panel is not changed by the page being live', () => {
  // It passes no `onDraft`, so it saves on Save exactly as it did.
  const pages = read('pages/admin/PagesPanel.jsx')
  assert.ok(pages.includes('onDraft?.('), 'optional, with a guard')
  assert.ok(!pages.includes('onDraft(next)'), 'never called unguarded')
})

test('a page is created from the sidebar, not from another screen', () => {
  assert.ok(sidebar.includes('New page'))
  assert.ok(sidebar.includes('onClick={onAddPage}'))
  assert.ok(dashboard.includes('onAddPage={isAdmin ? addPageHere : undefined}'))
})

test('the sidebar’s edit affordance is not a button inside a button', () => {
  // Browsers resolve that by dropping one of them, usually the one you
  // wanted.
  // `data-role="button"` contains `role="button"`, so the space matters.
  assert.ok(sidebar.includes('<span role="button"'))
  assert.ok(sidebar.includes('e.stopPropagation()'))
})
