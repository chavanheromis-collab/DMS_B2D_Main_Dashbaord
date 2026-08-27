import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------
// Is the design mode still connected to anything?
// ---------------------------------------------------------------------
// pageDesign.test.js and flowPack.test.js prove the maths -- what a gap
// clamps to, where a widget lands, how a row wraps. This proves the controls
// still call it, which is the half a refactor breaks silently: the panel
// draws, the slider slides, and the page does not move.
//
// Comments are stripped before matching. An assertion that a name appears in
// a file has been satisfied by the comment explaining that name, in this very
// project, long after the code had gone.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const dashboard = read('pages/Dashboard.jsx')
const panel = read('components/PageDesignPanel.jsx')
const canvas = read('components/WidgetCanvas.jsx')
const bar = read('components/ArrangeBar.jsx')

// --- the page's own design ------------------------------------------------

test('the design reaches every card as custom properties on the canvas', () => {
  assert.ok(dashboard.includes('...designVars(design)'))
  assert.ok(dashboard.includes('page-canvas'))
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
  for (const field of ['gapX: v', 'gapY: v', 'fontScale: v / 100', 'cardRadius: v', 'cardPadding: v']) {
    assert.ok(panel.includes(field), field)
  }
  assert.ok(panel.includes('onChange={(e) => set({ cardBg: e.target.value })}'))
  assert.ok(panel.includes('onChange={(e) => onThemeChange(e.target.value)}'))
})

test('the panel can put the page back to stock', () => {
  assert.ok(panel.includes('onChange({ ...DEFAULT_DESIGN })'))
  assert.ok(panel.includes('disabled={isDefaultDesign(d)}'))
})

// --- the canvas has no columns -------------------------------------------

test('the page draws its widgets on the columnless canvas', () => {
  assert.ok(dashboard.includes('<WidgetCanvas'))
  assert.ok(dashboard.includes('gapX={design.gapX}'))
  assert.ok(dashboard.includes('gapY={design.gapY}'))
  assert.ok(!dashboard.includes('MasonryGrid'), 'and the column packer is gone')
})

test('the canvas packs into rows by the space each widget asked for', () => {
  assert.ok(canvas.includes('packRowGroups(items, { canvasWidth: width, gapX, gapY, heights, fit, stacked })'))
  assert.ok(canvas.includes('rowSlack(layout.rows, layout.positions, width, gapX)'))
})

test('a widget can be put in a row, and the rows are shown while arranging', () => {
  assert.ok(bar.includes('onCommit={(raw) => onRow(raw)}'))
  assert.ok(dashboard.includes("onRow={(v) => saveWidgetSize(widget.id, { row: v })}"))
  assert.ok(dashboard.includes("if (key === 'row') {"), 'a row takes no pixel floor')
  assert.ok(dashboard.includes('showRows={isAdmin && arranging}'))
  assert.ok(canvas.includes('layout.rows.map((r) => ('))
  assert.ok(canvas.includes('Row {r.row}'))
})

test('a widget can be told to cover several rows', () => {
  assert.ok(bar.includes('onCommit={(raw) => onRowSpan?.(raw)}'))
  assert.ok(dashboard.includes("onRowSpan={(v) => saveWidgetSize(widget.id, { rowSpan: v })}"))
  assert.ok(dashboard.includes("if (key === 'rowSpan') {"), 'a count takes no pixel floor either')
  assert.ok(dashboard.includes('rowSpan: widget.rowSpan'), 'and the canvas is told about it')
})

test('a spanning widget is drawn as tall as the rows it covers', () => {
  // Otherwise "covers rows 2 to 4" would mean no more than "starts at row
  // 2", and the room it reserved below itself would sit visibly empty.
  assert.ok(canvas.includes('height: box.spanned || box.fitted ? box.height : undefined'))
  assert.ok(canvas.includes("box.spanned || box.fitted ? 'widget-fit' : ''"))
  const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')
  assert.ok(css.includes('.widget-fit > * > .card'), 'and the card inside it fills that height')
})

test('the pill says which rows a widget covers, not just where it starts', () => {
  assert.ok(bar.includes('spans > 1 ?'))
})

test('space held by a span is shown as held while arranging', () => {
  assert.ok(canvas.includes('(r.blocked || []).map('))
})

test('the canvas asks how the arrangement meets the screen it got', () => {
  assert.ok(canvas.includes('const { fit, stacked } = useMemo(() => fitFor(items, width, gapX)'))
})

test('the pill shows what is DRAWN, not what was typed', () => {
  // "It says the same size on every layout" was exactly this: it was
  // reading the design back rather than the drawing.
  assert.ok(bar.includes('const w = measured?.width || widthPx'))
  assert.ok(bar.includes('const h = measured?.height || heightPx'))
  assert.ok(bar.includes('const scale = Number(measured?.scale) > 0'))
})

test('a screen that is not the one this was arranged for says so', () => {
  assert.ok(bar.includes('stacked</span>'))
  assert.ok(bar.includes('{Math.round(scale * 100)}%'))
  assert.ok(canvas.includes('scale: fit'))
  assert.ok(canvas.includes('stacked,'))
})

test('filling the row types a DESIGN width, not a screen one', () => {
  // The spare is measured on the glass; the W box is in design pixels, and
  // on a scaled canvas those are different numbers.
  assert.ok(bar.includes('spare / scale'))
})

test('nothing on the canvas is draggable', () => {
  // Sizes are typed, in pixels: exact, repeatable, and the same on every
  // screen, none of which is true of a mouse.
  for (const gone of ['onPointerDown', 'setPointerCapture', 'draggable', 'resizeBox']) {
    assert.ok(!canvas.includes(gone), `${gone} is still there`)
  }
})

test('the canvas reports what it drew, including the room left on the row', () => {
  assert.ok(canvas.includes('spare: slack[id] ?? 0'))
  assert.ok(bar.includes('measured?.spare'))
  assert.ok(bar.includes('const fillRow = ()'), 'and one click uses it up')
})

// --- one widget's own size and look --------------------------------------

test('a widget is sized by typing a number of pixels, not by dragging', () => {
  assert.ok(bar.includes('type="number"'))
  assert.ok(bar.includes('onCommit={(raw) => onSize({ widthPx: raw })}'))
  assert.ok(bar.includes('onCommit={(raw) => onSize({ heightPx: raw })}'))
  assert.ok(dashboard.includes('async function saveWidgetSize(widgetId, patch)'))
})

test('every widget can be restyled from the widget', () => {
  assert.ok(bar.includes('function WidgetPaint('))
  assert.ok(bar.includes('title="How this widget looks"'))
  for (const field of ['theme: e.target.value', 'bg: v', 'accent: v', 'borderColor: v', 'radius: v', 'padding: v']) {
    assert.ok(bar.includes(field), field)
  }
})

test('a widget’s look is saved to the page, for everyone', () => {
  assert.ok(dashboard.includes('async function saveWidgetStyle(widgetId, style)'))
  assert.ok(dashboard.includes('onStyle={isAdmin ? (next) => saveWidgetStyle(widget.id, next) : undefined}'))
})

test('a widget can be put back to the page’s look', () => {
  assert.ok(bar.includes('onStyle({ ...DEFAULT_WIDGET_STYLE })'))
})

// --- the panels float above every widget ---------------------------------

test('a widget panel escapes its card, or it is painted under the next one', () => {
  // Each card has its own entrance animation, and a CSS transform creates a
  // stacking context that no z-index can climb out of. Escaping to <body> is
  // the only fix that works from any position on the page.
  assert.ok(bar.includes('function Floating('))
  assert.ok(bar.includes('createPortal('))
  assert.ok(bar.includes('className="fixed z-[80]'))
  assert.ok(bar.includes('<Floating anchor={anchor}'))
})

test('a floating panel is anchored to the handle that opened it', () => {
  assert.ok(bar.includes('const anchorTo = (e) =>'))
  assert.ok(bar.includes('e.currentTarget.getBoundingClientRect()'))
  assert.ok(bar.includes('window.innerHeight'), 'and flips above when there is no room below')
  assert.ok(bar.includes('window.innerWidth'), 'and stays inside the window sideways')
})

test('clicking away or pressing Escape closes it', () => {
  assert.ok(bar.includes("if (e.key === 'Escape') onDismiss()"))
  assert.ok(bar.includes('if (ref.current && !ref.current.contains(e.target)) onDismiss()'))
})

// --- what fits in the space left over ------------------------------------

test('the empty space is drawn as a box with its size in it', () => {
  // "There is room" is not the question anybody has while arranging; "there
  // is room for 428 by 94" is.
  assert.ok(canvas.includes('rowGaps(layout.rows, layout.positions, width, gapX, undefined, gapY)'))
  assert.ok(canvas.includes('gaps.map((gap) => ('))
  assert.ok(canvas.includes('border-dashed'))
  // In the numbers the W box is in, which on a scaled canvas are not the
  // ones on the glass -- the point of the box is that it tells you what to
  // type, and a number you cannot type is worse than no number.
  assert.ok(canvas.includes('{Math.round(gap.width / fit)} × {Math.round(gap.height / fit)}'))
})

test('the gaps are only drawn while arranging', () => {
  assert.ok(canvas.includes('showRows && width > 0 ? rowGaps('))
})

test('the room under a short widget is offered too, not just the room beside it', () => {
  // A widget half the height of the one beside it leaves a rectangle, and a
  // rectangle that fits is not one anybody wants left empty -- as long as
  // the rectangle is one TYPED heights guarantee rather than one today's
  // data happens to leave.
  const pack = read('lib/flowPack.js')
  assert.ok(pack.includes('line.shelves.push('))
  assert.ok(pack.includes('stacked: true'))
  assert.ok(pack.includes('under: true'))
})

// --- controls are part of the page's design ------------------------------

const controlBar = read('components/ControlBar.jsx')

test('a page control is sized and placed on the page, like a widget', () => {
  assert.ok(controlBar.includes('function ControlPill('))
  assert.ok(controlBar.includes('onEdit({ widthPx: e.target.value })'))
  assert.ok(controlBar.includes('onEdit({ order: e.target.value })'))
  assert.ok(controlBar.includes('onEdit({ advanced: !control.advanced })'))
  assert.ok(dashboard.includes('async function saveControlEdit(controlId, patch)'))
  assert.ok(dashboard.includes('onControlEdit={saveControlEdit}'))
})

test('control editing is admin-only and writes to the page', () => {
  assert.ok(dashboard.includes('editable={isAdmin && arranging}'))
  assert.ok(dashboard.includes("stripUndefined({ controls })"))
})

// --- the actions an admin always wants next ------------------------------

test('a widget can be renamed, duplicated and removed from the page', () => {
  assert.ok(bar.includes('onRename('))
  assert.ok(bar.includes('onClick={onDuplicate}'))
  assert.ok(bar.includes('onDelete()'))
  assert.ok(dashboard.includes('const renameWidget = (id, title) =>'))
  assert.ok(dashboard.includes('function duplicateWidget(id)'))
  assert.ok(dashboard.includes('const deleteWidget = (id) =>'))
})

test('a duplicate lands right after the one it copied, with a new id', () => {
  // The commonest thing anybody wants after building a chart is the same
  // chart broken down another way.
  assert.ok(dashboard.includes('[...widgets.slice(0, at + 1), copy, ...widgets.slice(at + 1)]'))
  assert.ok(dashboard.includes("id: `w_${Math.random().toString(36).slice(2, 9)}`"))
})

test('removing a widget is confirmed first', () => {
  // It is the one action here that loses work somebody did in the admin
  // panel.
  assert.ok(bar.includes('window.confirm('))
})

test('every one of these is admin-only', () => {
  for (const action of ['onRename={isAdmin', 'onDuplicate={isAdmin', 'onDelete={isAdmin']) {
    assert.ok(dashboard.includes(action), action)
  }
  assert.ok(dashboard.includes('async function writeWidgets(next) { if (!isAdmin || !page?.id) return'))
})
