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
const paint = read('components/WidgetPaint.jsx')

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

test('a shrunk widget keeps its heading; only the body scrolls', () => {
  // The card is the scroll container, so the title, the count beside it and
  // the export button used to scroll away with the chart -- and a widget
  // whose name you have to scroll back up to read is one you cannot tell
  // apart from its neighbour. Shrinking a widget is exactly when the label
  // matters most, and exactly when it disappeared.
  const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')
  const at = css.indexOf('.widget-sized > .card > :is(.widget-title, *:has(.widget-title))')
  assert.ok(at > 0, 'the heading is found by what it contains, not by a marker class')

  const rule = css.slice(at, css.indexOf('}', at))
  assert.ok(rule.includes('position: sticky'))
  assert.ok(rule.includes('top: 0'))
  assert.ok(rule.includes('background-color: var(--card-bg'), 'or the body reads through it')
  assert.ok(rule.includes('backdrop-filter'), 'and a translucent card surface still hides it')

  // Pulled out to the card's edges and re-padded inside, so scrolling
  // content passes UNDER the heading rather than appearing beside it.
  assert.ok(rule.includes('margin-inline: calc(var(--card-padding, 1rem) * -1)'))
  assert.ok(rule.includes('margin-top: calc(var(--card-padding, 1rem) * -1)'))
  assert.ok(rule.includes('padding: var(--card-padding, 1rem)'))

  // And it only applies where the card actually scrolls -- a heading has
  // nothing to stick to unless the card is the scrollport.
  const cardAt = css.indexOf('.widget-sized > .card {')
  assert.ok(cardAt > 0)
  assert.ok(css.slice(cardAt, css.indexOf('}', cardAt)).includes('overflow: auto'))
})

test('the sticky heading sits above the widget’s own content', () => {
  const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')
  const at = css.indexOf('.widget-sized > .card > :is(.widget-title, *:has(.widget-title))')
  assert.ok(css.slice(at, css.indexOf('}', at)).includes('z-index: 3'))
})

test('the rule covers BOTH shapes a heading is written in', () => {
  // Most widgets wrap the title in a row with a count or an export button
  // beside it; the canvas furniture -- a note, an image, a countdown --
  // makes the heading the child itself. A rule that knew only the first
  // would leave three widgets scrolling their titles away.
  const dir = path.join(SRC, 'components', 'widgets')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsx'))
  const withTitle = files.filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('widget-title'))
  assert.ok(withTitle.length >= 12, `only ${withTitle.length} widgets have a title`)

  const canvas = fs.readFileSync(path.join(dir, 'CanvasWidgets.jsx'), 'utf8')
  const titles = (canvas.match(/widget-title/g) || []).length
  assert.ok(titles >= 3, 'the canvas furniture has headings')
  assert.equal(
    (canvas.match(/className="widget-title mb-/g) || []).length,
    titles,
    'and every one of them is the child itself, which is the shape the rule’s first branch matches'
  )

  const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')
  assert.ok(css.includes(':is(.widget-title, *:has(.widget-title))'), 'so both are matched')
})

test('free mode leaves a widget own controls working', () => {
  // A search box you cannot type in is not an arranged page, it is a
  // broken one.
  assert.ok(
    canvas.includes(
      'input, textarea, select, button, a, [contenteditable="true"]'
    )
  )
})

test('every widget can be restyled from the widget', () => {
  assert.ok(paint.includes('export default function WidgetPaint('))
  assert.ok(bar.includes('title="How this widget looks"'))
  // The fields live in the panel, which the bar opens. Two files now, and
  // that is the point: the CONTROLS open the same panel, so a filter and a
  // widget cannot drift into different sets of options.
  for (const field of ['theme: e.target.value', 'bg: v', 'accent: v', 'borderColor: v', 'radius: v', 'padding: v']) {
    assert.ok(paint.includes(field), field)
  }
})

test('a widget’s look is saved to the page, for everyone', () => {
  assert.ok(dashboard.includes('async function saveWidgetStyle(widgetId, style)'))
  assert.ok(dashboard.includes('onStyle={isAdmin ? (next) => saveWidgetStyle(widget.id, next) : undefined}'))
})

test('a widget can be put back to the page’s look', () => {
  assert.ok(paint.includes('onStyle({ ...DEFAULT_WIDGET_STYLE })'))
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
  assert.ok(dashboard.includes('[...list.slice(0, at + 1), copy, ...list.slice(at + 1)]'))
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
  assert.ok(dashboard.includes('async function writeWidgets(next, fromHistory = false) { if (!isAdmin || !page?.id) return'))
})

// --- each row sorts itself, and the header comes when it is called -------

test('the header can be reached from wherever you scrolled to', () => {
  // A dashboard is long and the controls that decide what it says are at
  // the top of it. Scrolling back loses the row you were reading.
  assert.ok(dashboard.includes('const [headerGone, setHeaderGone] = useState(false)'))
  assert.ok(dashboard.includes('ref={headerMark}'))
  assert.ok(dashboard.includes('new IntersectionObserver(([entry]) => setHeaderGone(!entry.isIntersecting)'))
  assert.ok(!dashboard.includes("addEventListener('scroll'"), 'no scroll listener')
})

test('the sheet holds the REAL control bar', () => {
  // A second one would drift, and the one that drifted would be this one.
  const sheet = dashboard.slice(dashboard.indexOf('{headerGone && headerOpen && ('))
  assert.ok(sheet.slice(0, 900).includes('{controlBar}'))
})

test('scrolling back to the header puts the stand-in away', () => {
  assert.ok(dashboard.includes('if (!headerGone && headerOpen) setHeaderOpen(false)'))
})

test('the backdrop and the page-wide text are reachable from edit mode', () => {
  assert.ok(dashboard.includes('Background &amp; text'))
  assert.ok(dashboard.includes('setDesigning(true)'))
})

test('the pill shows what is DRAWN, not what was typed', () => {
  // On a narrower screen the design and the drawing are different numbers,
  // and the one on the glass is the one somebody is looking at.
  assert.ok(bar.includes('const scale = Number(measured?.scale) > 0 ? Number(measured.scale) : 1'))
  assert.ok(bar.includes('Math.round( (rect?.w ?? 0) * scale )'))
})

test('a screen that is not the one this was arranged for says so', () => {
  // Rather than letting the numbers quietly look wrong.
  assert.ok(bar.includes('const shrunk = scale < 0.995 || measured?.stacked'))
  assert.ok(bar.includes('{Math.round(scale * 100)}%'))
  assert.ok(bar.includes('stacked'))
})

test('the canvas reports what it actually drew', () => {
  assert.ok(canvas.includes('measure.current(rect.id, rect.w, rect.h, {'))
  assert.ok(canvas.includes('canvasWidth: Math.round(width)'))
})

// ---------------------------------------------------------------------
// A control can be restyled, the same way a widget can
// ---------------------------------------------------------------------

test('the paint panel is one component, not one per thing it paints', () => {
  // A filter that cannot be restyled beside a widget that can is not a
  // decision anybody made -- and two panels would drift into two different
  // sets of options.
  assert.ok(paint.includes('export default function WidgetPaint('))
  assert.ok(bar.includes("import WidgetPaint from './WidgetPaint.jsx'"))
  assert.ok(controlBar.includes("import WidgetPaint from './WidgetPaint.jsx'"))
})

test('a control opens it from its own pill', () => {
  assert.ok(controlBar.includes('onClick={() => setPainting(true)}'))
  assert.ok(controlBar.includes('onStyle={(next) => onEdit({ style: next })}'))
  assert.ok(controlBar.includes('style={control.style}'))
})

test('and the look is applied to that control', () => {
  assert.ok(controlBar.includes('styleClass(control.style)'))
  assert.ok(controlBar.includes('...(styleVars(control.style) || {})'))
  // The pixel width still wins its own argument: it is set on the bar and
  // is not part of a look.
  assert.ok(controlBar.includes("...(px ? { width: px, flex: '0 0 auto' } : null)"))
})

test('the page actually saves it', () => {
  // This saver takes the fields it knows and drops the rest, so a style it
  // had never heard of would vanish without a word.
  assert.ok(dashboard.includes("if ('style' in patch) clean.style = patch.style || null"))
})

test('a control is not a card, so the card properties are pointed at its chrome', () => {
  const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')
  assert.ok(css.includes('.control-skin.card-ownbg :where(input, select, textarea, button, .control-face)'))
  assert.ok(css.includes('.control-skin.card-clear :where(input, select, textarea, button, .control-face)'))
  // Scoped to a control that was actually styled, so every unstyled bar on
  // every existing page is untouched.
  assert.ok(!css.includes('.control-skin :where(input'), 'nothing applies to an unstyled control')
})

test('a control look reaches its shape as well as its colours', () => {
  const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')
  for (const prop of ['border-radius: var(--card-radius)', 'color: var(--card-text)']) {
    assert.ok(css.includes(prop), prop)
  }
  // Matched on the PROPERTY being present, not on a class: a radius of 0 --
  // square corners, deliberately -- is a real answer, and a class keyed on
  // truthiness would drop it.
  assert.ok(css.includes(".control-skin[style*='--card-radius'] :where(input, select, textarea, button"))
  assert.ok(css.includes(".control-skin[style*='--card-padding'] :where(input, select, textarea, button"))
})

test('a card padding is halved on a control, which is not a card', () => {
  // 16px all round makes a filter the height of a KPI card, and the two are
  // not the same kind of object even carrying the same number.
  const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')
  assert.ok(css.includes('padding: calc(var(--card-padding) / 2) var(--card-padding)'))
})

test('a button own colour wins, and the look accent fills in', () => {
  // Two ways to set one colour would be a fork. A precedence is not -- and
  // it stops the accent picker being a control that does nothing.
  assert.ok(controlBar.includes("const own = control.color || ''"))
  assert.ok(controlBar.includes("const onColour = own || 'var(--card-accent, #4F46E5)'"))
  assert.ok(controlBar.includes('style={isOn ? { backgroundColor: onColour } : own ? { borderColor: `${own}66` } : undefined}'))
})

test('a button is a face the look can reach', () => {
  // The CSS names the elements it paints; a button that is not one of them
  // is a button the look does not touch.
  assert.ok(controlBar.includes('className={`control-face rounded-lg border'))
})
