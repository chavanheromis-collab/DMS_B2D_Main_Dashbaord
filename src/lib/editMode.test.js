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
  assert.ok(dashboard.includes('mergeDraft( visibleWidgetsFor({ ...page, widgets: levelWidgets }, access, isAdmin), editDraft?.id, editDraft?.patch )'))
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
  assert.ok(dashboard.includes('async function addWidgetHere(type, patch = null)'))
  assert.ok(dashboard.includes('makeWidget({'))
  assert.ok(dashboard.includes("setEditTarget({ kind: 'widget', id: born.id })"))
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

// --- the four things that were wrong ------------------------------------

test('the form edits the widget as it is STORED, not as it is drawn', () => {
  // `view` is label space: every tab field rewritten to its human name for
  // rendering. Editing one of those writes labels where refs belong and
  // leaves the widget's own tab picker matching nothing.
  assert.ok(dashboard.includes('findWidget(page?.widgets || [], editTarget.id)'))
  assert.ok(!dashboard.includes('view.widgets.find((w) => w.id === editTarget.id)'))
})

test('the W box shows the width that is actually in force', () => {
  // A pixel width is ignored unless the widget is in pixel mode, and a
  // number that is being ignored has no business sitting in the box that
  // sets it -- that is "it shows one thing and does another".
  assert.ok(dashboard.includes("widthPx={widgetUsesPx(widget) ? widget.widthPx : ''}"))
})

test('in edit mode the widget itself is the way in', () => {
  // A pill somebody has to find first is a pill somebody has to be told
  // about; a card that lights up and says Edit is not.
  assert.ok(dashboard.includes('{editing && isAdmin && ('))
  assert.ok(dashboard.includes('group/widget relative'), 'the whole card is the hover target')
  assert.ok(dashboard.includes('group-hover/widget:opacity-100'))
  assert.ok(dashboard.includes("title={`Edit ${widget.title || 'this widget'}`}"))
})

test('the live preview is LIVE -- the highlight takes no clicks', () => {
  // It used to be a button covering the whole card, which meant the preview
  // could be looked at and not used: no clicking a stage, no opening a
  // dropdown, no scrolling a long chart. A preview you cannot work is a
  // screenshot.
  assert.ok(dashboard.includes('pointer-events-none absolute inset-0 z-10 rounded-2xl'))
  assert.ok(!dashboard.includes('absolute inset-0 z-10 flex items-start justify-end'), 'the blanket button is gone')

  // And the thing that DOES take the click is a corner pill, not the card.
  const at = dashboard.indexOf("title={`Edit ${widget.title || 'this widget'}`}")
  assert.ok(at > 0)
  assert.ok(dashboard.slice(at, at + 200).includes('absolute right-2 top-2 z-20'))
})

test('an invisible Edit pill is still reachable by keyboard', () => {
  // Tabbing to a button nobody can see is a trap.
  assert.ok(dashboard.includes('opacity-0 focus-visible:opacity-100 group-hover/widget:opacity-100'))
})

test('the highlight sits UNDER the arrange pill, and out of the Edit pill’s corner', () => {
  // Two pills on one card: the arrange one top-left, the Edit one
  // top-right, and glass between them that answers to neither.
  const bar = read('components/ArrangeBar.jsx')
  assert.ok(bar.includes('z-20 inline-flex'))
  assert.ok(bar.includes('-left-1 -top-1'), 'arrange is the LEFT corner')
  assert.ok(dashboard.includes('absolute right-2 top-2 z-20'), 'and Edit is the right one')
  assert.ok(dashboard.includes('pointer-events-none absolute inset-0 z-10'))
})

test('every widget type has a sketch of what it is', () => {
  const preview = read('components/WidgetTypePreview.jsx')
  for (const t of WIDGET_TYPES) {
    assert.ok(preview.includes(`${t.value}: () => (`), `${t.value} has no sketch`)
  }
})

test('the add bar shows the sketch and says what the type is for', () => {
  assert.ok(dashboard.includes('<WidgetTypePreview type={t.value} />'))
  assert.ok(dashboard.includes('{t.hint}'))
  assert.ok(dashboard.includes('group-hover:block'))
})

test('the sketch is a sketch, and does not pretend to be your data', () => {
  // A real render would need a tab, columns and rows -- none of which exist
  // before the widget does -- so it would be empty or a lie.
  const preview = read('components/WidgetTypePreview.jsx')
  // No data, no props but the type, no imports at all.
  assert.ok(!/^import /m.test(preview))
  assert.ok(preview.includes('export default function WidgetTypePreview({ type })'))
})

test('there is ONE list of what a widget can be', () => {
  // The icons and the one-line descriptions have always lived in config.
  const factory = fs.readFileSync(path.join(SRC, 'lib/newWidget.js'), 'utf8')
  assert.ok(factory.includes('export { WIDGET_TYPES }'))
  assert.ok(!/export const WIDGET_TYPES = \[/.test(factory))
  for (const t of WIDGET_TYPES) {
    assert.ok(t.icon, `${t.value} has no icon`)
    assert.ok(t.hint, `${t.value} has no hint`)
  }
})

// --- the panel is a container, so the forms fit it ----------------------

test('the forms measure the PANEL, not the window', () => {
  // A `md:` breakpoint asks the window, and the window is wide even when a
  // 340px panel is not -- so four-column grids and `w-64` fields stayed at
  // full size inside it and pushed each other off the edge.
  const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')
  assert.ok(css.includes('.edit-shell {\n  container-type: inline-size;\n}'))
  assert.ok(css.includes('@container (max-width: 560px)'))
  assert.ok(css.includes('@container (max-width: 380px)'))
})

test('the container is the PANEL, not the scrolling body', () => {
  // A container query only answers for descendants, and the header is a
  // sibling of the body -- so a container on the body could never size the
  // header.
  assert.ok(split.includes('className="edit-shell absolute flex flex-col'))
  assert.ok(split.includes('className="edit-panel min-h-0 flex-1 overflow-y-auto p-3"'))
  const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')
  assert.ok(css.includes('.edit-shell .edit-head-sub'), 'the header is inside the container')
  // And the containment is on the shell, not the body -- putting it on the
  // body is exactly the mistake this test is named after.
  assert.ok(!/\.edit-panel\s*\{[^}]*container-type/.test(css))
})

test('a narrow panel steps down twice rather than collapsing at once', () => {
  // A form is perfectly readable in two columns, and dropping straight to
  // one at the first sign of narrowness wastes half of a 520px panel.
  const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')
  const two = css.indexOf('@container (max-width: 560px)')
  const one = css.indexOf('@container (max-width: 380px)')
  assert.ok(two > 0 && one > two)
  assert.ok(css.slice(two, one).includes('repeat(2, minmax(0, 1fr))'))
  assert.ok(css.slice(one).slice(0, 200).includes('minmax(0, 1fr)'))
})

test('only the WIDE fixed widths are overridden', () => {
  // A colour swatch at `w-10` is that size for a reason.
  const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')
  const rule = css.slice(css.indexOf('.edit-shell .edit-panel :where(.w-72'))
  const listed = rule.slice(0, rule.indexOf(')')).match(/\.w-\d+/g) || []
  assert.ok(listed.length >= 8)
  for (const w of listed) assert.ok(Number(w.slice(3)) >= 32, `${w} is not a wide field`)
})

test('the panel header wraps rather than squeezing', () => {
  assert.ok(split.includes('edit-head flex flex-wrap items-center'))
  assert.ok(split.includes('flex-1 basis-40'), 'the title takes the room and gives it back')
})

// --- typing at the speed of the keyboard --------------------------------

const ui = read('pages/admin/ui.jsx')

test('a text field owns what is in it', () => {
  // It used to hand every keystroke straight up to whoever owned the value.
  // Fine while that was a form; not fine now the owner is a page that
  // redraws a canvas of charts, because every character waited for it.
  assert.ok(ui.includes('const [text, setText] = useState(incoming)'))
  assert.ok(ui.includes('value={text}'))
  // Scoped to TextInput's own body: a <select> fires once per choice, so
  // straight through is right there and always was.
  const field = ui.slice(ui.indexOf('export function TextInput('), ui.indexOf('export const TYPING_PAUSE'))
  assert.ok(!field.includes('onChange={(e) => onChange(e.target.value)}'), 'no longer straight through')
})

test('the page hears about it a beat later, not never', () => {
  assert.ok(ui.includes('timer.current = setTimeout(() => send(next), TYPING_PAUSE)'))
  const pause = Number((ui.match(/export const TYPING_PAUSE = (\d+)/) || [])[1])
  assert.ok(pause >= 80 && pause <= 250, 'a word is one update, and it still reads as live')
})

test('a value changed from OUTSIDE still wins', () => {
  // Switching to another widget must not leave the last one's title sitting
  // in the box.
  assert.ok(ui.includes('if (incoming === latest.current.sent) return'))
  assert.ok(ui.includes('setText(incoming)'))
})

test('leaving the field, and closing the panel, both flush', () => {
  // Nobody expects to lose the last thing they typed because they clicked
  // Save within the timeout, and closing the panel is how people finish.
  assert.ok(ui.includes('onBlur={() => send(latest.current.text)}'))
  const teardown = ui.slice(ui.indexOf('() => () => {'))
  assert.ok(teardown.slice(0, 400).includes('latest.current.onChange?.(latest.current.text)'))
})

test('a widget being typed into does not re-filter every tab', () => {
  // `view` carries the widgets as well as the controls, so a keystroke in a
  // widget changed its identity and every dropdown was rebuilt from a fresh
  // pass over every row.
  assert.ok(dashboard.includes('const viewControls = useMemo(() => mapTabFields(pageControls, labelFor), [pageControls, labelFor])'))
  assert.ok(dashboard.includes('splitControls(viewControls)'))
  assert.ok(!dashboard.includes('splitControls(view.controls)'))
})

// --- undo, and the thing after undo -------------------------------------

test('every widget write is remembered, in one place', () => {
  // Recorded in `writeWidgets` rather than in each caller, because every
  // caller eventually forgets.
  assert.ok(dashboard.includes('async function writeWidgets(next, fromHistory = false)'))
  assert.ok(dashboard.includes('if (!fromHistory) {'))
  assert.ok(dashboard.includes('commitHistory('))
})

test('undo writes the same way everything else does', () => {
  // No second path into the document, so there is nothing for two paths to
  // disagree about.
  assert.ok(dashboard.includes('await writeWidgets(next.present, true)'))
})

test('undoing is not itself an undoable step', () => {
  // Otherwise Ctrl+Z is a toggle between two states for ever.
  const step = dashboard.slice(dashboard.indexOf('async function stepHistory'))
  assert.ok(step.slice(0, 500).includes('writeWidgets(next.present, true)'))
})

test('Ctrl+Z in a text box still undoes your typing', () => {
  // Stealing that to undo a widget instead is the kind of help nobody asks
  // for twice.
  const handler = dashboard.slice(dashboard.indexOf('const onKey = (e) => {'))
  assert.ok(handler.slice(0, 400).includes("tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable"))
})

test('there are buttons as well as shortcuts, and they know when they are dead', () => {
  assert.ok(dashboard.includes("title=\"Undo (Ctrl+Z)\""))
  assert.ok(dashboard.includes("title=\"Redo (Ctrl+Y)\""))
  assert.ok(dashboard.includes('disabled={!canUndo(past)}'))
  assert.ok(dashboard.includes('disabled={!canRedo(past)}'))
})
