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

test('the canvas packs by the space each widget asked for', () => {
  assert.ok(canvas.includes('packFlow(items, { canvasWidth: width, gapX, gapY, heights })'))
  assert.ok(canvas.includes('rowSlack(layout.rows, layout.positions, width, gapX)'))
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
