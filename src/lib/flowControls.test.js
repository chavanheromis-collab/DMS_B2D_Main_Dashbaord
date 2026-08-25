import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------
// Are the buttons still connected to anything?
// ---------------------------------------------------------------------
// flowView.test.js proves the zoom maths, the fit maths, the search and the
// minimap geometry are right. That is most of the behaviour -- but it says
// nothing about whether the + button still calls zoom, which is exactly the
// kind of thing a refactor breaks silently: the page renders, the button
// draws, and clicking it does nothing at all.
//
// This project has no DOM in its test runner (Node cannot import .jsx, and
// adding jsdom and a renderer is a dependency decision, not a test), so
// this reads the components as text and checks each advertised control is
// still wired to the function that does the work.
//
// Deliberately shallow: it can prove a handler is attached, not that the
// pixel moved. It is a wiring check, and it is named like one.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8').replace(/\s+/g, ' ')

const diagram = read('components/widgets/FlowDiagram.jsx')
const widget = read('components/widgets/FlowWidget.jsx')

/** `onClick={handler}` somewhere inside the element that carries `marker`. */
function wiredNear(source, marker, handler) {
  const at = source.indexOf(marker)
  if (at === -1) return false
  // Buttons here are small; the handler is always within the same element.
  const window = source.slice(Math.max(0, at - 400), at + 400)
  return window.includes(handler)
}

// --- zoom -----------------------------------------------------------------

test('the zoom in button calls zoom in', () => {
  assert.ok(wiredNear(diagram, 'title="Zoom in (+)"', 'onClick={() => zoomBy(ZOOM_STEP)}'))
})

test('the zoom out button calls zoom out', () => {
  assert.ok(wiredNear(diagram, 'title="Zoom out (−)"', 'onClick={() => zoomBy(1 / ZOOM_STEP)}'))
})

test('the fit button calls fit', () => {
  assert.ok(wiredNear(diagram, 'title="Fit to view (0)"', 'onClick={fit}'))
})

test('the zoom readout is a button back to 100%', () => {
  // It used to be a second Fit button, which meant there was no way at all
  // to get back to actual size once fit had shrunk the diagram.
  assert.ok(wiredNear(diagram, 'title="Back to 100% (1)"', 'onClick={actualSize}'))
  assert.ok(diagram.includes('{Math.round(view.zoom * 100)}%'), 'and it says what the zoom is')
})

test('zoom is applied as a transform, so the layout is never recomputed', () => {
  assert.ok(diagram.includes('scale(${view.zoom})'))
  assert.ok(diagram.includes('translate(${view.x}px, ${view.y}px)'))
})

// --- full screen ----------------------------------------------------------

test('the widget has a full screen button that toggles full screen', () => {
  assert.ok(wiredNear(widget, "title={fullscreen ? 'Leave full screen (Esc)' : 'Full screen'}", 'setFullscreen((f) => !f)'))
})

test('the canvas has its own full screen button, wired to the widget’s', () => {
  // The canvas is where somebody runs out of room, so the control has to be
  // there too -- but fullscreen belongs to the WIDGET, since a picture
  // without its breadcrumb and breakdown pickers cannot be steered.
  assert.ok(diagram.includes('onToggleFullscreen'))
  assert.ok(wiredNear(diagram, "'Full screen (F)'", 'onClick={onToggleFullscreen}'))
  assert.ok(widget.includes('onToggleFullscreen={() => setFullscreen((f) => !f)}'))
})

test('Escape leaves full screen, and the page behind cannot scroll under it', () => {
  assert.ok(widget.includes("if (e.key === 'Escape') setFullscreen(false)"))
  assert.ok(widget.includes("document.body.style.overflow = 'hidden'"))
  assert.ok(widget.includes('document.body.style.overflow = previous'), 'and it is put back')
})

test('full screen re-frames the diagram rather than leaving it framed for the old box', () => {
  assert.ok(diagram.includes('}, [orientation, fullscreen])'))
  assert.ok(diagram.includes('new ResizeObserver(() => fit())'))
})

// --- search ---------------------------------------------------------------

test('the search box is wired, counts its hits and steps between them', () => {
  assert.ok(diagram.includes('onChange={(e) => setQuery(e.target.value)}'))
  assert.ok(diagram.includes('{matches.length ? `${matchIndex + 1}/${matches.length}` : \'none\'}'))
  assert.ok(wiredNear(diagram, 'title="Next match (Enter)"', 'onClick={() => stepTo(1)}'))
  assert.ok(wiredNear(diagram, 'title="Previous match (shift+Enter)"', 'onClick={() => stepTo(-1)}'))
})

test('a match is centred, not merely tinted', () => {
  assert.ok(diagram.includes('goTo(matches[matchIndex].key)'))
})

// --- the rest of the instrument panel ------------------------------------

test('the minimap is drawn and can be jumped to', () => {
  assert.ok(diagram.includes('minimapGeometry(layout, view, viewportSize())'))
  assert.ok(diagram.includes('minimapJump(layout, viewportSize(), view,'))
  assert.ok(wiredNear(diagram, "'Hide the minimap'", 'onClick={() => setShowMap((s) => !s)}'))
})

test('edge labels can be turned off', () => {
  assert.ok(wiredNear(diagram, "'Hide the number on each line'", 'onClick={() => setShowEdgeLabels((s) => !s)}'))
  assert.ok(diagram.includes('{showEdgeLabels && ('))
})

test('hovering a node lights its lineage and quiets the rest', () => {
  assert.ok(diagram.includes('onHover(key)'))
  assert.ok(diagram.includes('lineagePaths(roots, hovered || selected)'))
  assert.ok(diagram.includes('opacity: dimmed ? 0.22 : 1'))
})

// --- the peek -------------------------------------------------------------

const peek = read('components/widgets/FlowPeek.jsx')

test('hovering a branch opens the magnified window over it', () => {
  assert.ok(diagram.includes('onPeek(node, e.currentTarget)'), 'the card reports its own screen box')
  assert.ok(diagram.includes('{peek && ('))
  assert.ok(diagram.includes('<FlowPeek'))
})

test('the window opens on a delay and closes on a grace period', () => {
  // Instant would flash open and shut all the way across the canvas; no
  // grace period would make the gap between card and window a trapdoor.
  assert.ok(diagram.includes('openTimer.current = setTimeout('))
  assert.ok(diagram.includes('closeTimer.current = setTimeout(() => setPeek(null), 220)'))
  assert.ok(diagram.includes('const stayPeek = useCallback(() => clearTimeout(closeTimer.current), [])'))
  assert.ok(peek.includes('onPointerEnter={onStay}'), 'moving into the window counts as staying')
  assert.ok(peek.includes('onPointerLeave={onLeave}'))
})

test('the window scrolls, and lists everything under the branch', () => {
  assert.ok(peek.includes('overflow-y-auto overscroll-contain'), 'a branch with forty children is all there')
  assert.ok(peek.includes('peekRows(current)'))
})

test('clicking a row moves the window into that branch, with a way back', () => {
  assert.ok(peek.includes('onClick={() => row.node && setTrail((t) => [...t, row.node])}'))
  assert.ok(peek.includes('onClick={() => setTrail((t) => t.slice(0, -1))}'))
  assert.ok(peek.includes('{trail.length > 1 && ('), 'the back arrow only exists once there is a way back')
})

test('the window is drawn at full size whatever the canvas is zoomed to', () => {
  // Inside the zoom transform it would be scaled with everything else,
  // which is the exact problem it exists to solve.
  assert.ok(peek.includes('createPortal('))
  assert.ok(peek.includes('className="pop-in fixed z-[70]'))
  assert.ok(peek.includes('width: PEEK_SIZE, height: PEEK_SIZE'))
})

test('panning or zooming closes it, because its anchor is a screen box', () => {
  assert.ok(diagram.includes('closePeek()'))
  assert.ok(wiredNear(diagram, 'function startPan(e) {', 'closePeek()'))
})

test('the window can filter the page and open a branch on the canvas', () => {
  assert.ok(peek.includes('onClick={() => onDrill(current)}'))
  assert.ok(peek.includes('onFocus(current)'))
})

test('Escape closes it', () => {
  assert.ok(peek.includes("if (e.key === 'Escape') onClose()"))
})

test('selecting a node opens the detail panel, and it can be closed', () => {
  assert.ok(diagram.includes('{selectedNode && ('))
  assert.ok(wiredNear(diagram, 'title="What is this branch?"', "onClick={() => onSelect(selected ? '' : key)}"))
  assert.ok(diagram.includes("onClose={() => setSelected('')}"))
})

test('clicking empty canvas clears the selection but dragging does not', () => {
  assert.ok(diagram.includes("if (drag.current && !drag.current.moved) setSelected('')"))
})

test('a drag that starts on a card or a control does not pan the canvas', () => {
  assert.ok(diagram.includes("e.target.closest('[data-flow-node]')"))
  assert.ok(diagram.includes("e.target.closest('[data-flow-ui]')"))
})

// --- the reader's controls on the widget ---------------------------------

test('the reader can re-order, hide hairlines and change the percentage base', () => {
  assert.ok(widget.includes('onChange={(e) => setSortOrder(e.target.value)}'))
  assert.ok(widget.includes('onChange={(e) => setMinShare(Number(e.target.value))}'))
  assert.ok(widget.includes("setPercentBase((b) => (b === 'parent' ? 'root' : 'parent'))"))
})

test('what was hidden is counted on screen, never silently dropped', () => {
  assert.ok(widget.includes('{shaped.hidden > 0 && ('))
  assert.ok(widget.includes('shaped.hiddenValue'))
})

test('the worst drop-off is found for the reader and is clickable', () => {
  assert.ok(wiredNear(widget, 'Worst drop:', 'onClick={() => focusNode(stats.worstDrop)}'))
})

test('the breadcrumb out of a zoomed-in branch shows in BOTH views', () => {
  // It used to live inside the tree, so double-clicking a node on the
  // diagram zoomed you in and left no visible way back out.
  const before = widget.indexOf('<FocusTrail')
  const treeView = widget.indexOf('<TreeSection')
  const diagramView = widget.indexOf('<FlowDiagram')
  assert.ok(before !== -1, 'the breadcrumb is rendered')
  assert.ok(before < treeView && before < diagramView, 'above both views, so it belongs to neither')
})

// --- the keyboard ---------------------------------------------------------

test('the canvas takes focus and reads the keyboard through flowKeyAction', () => {
  assert.ok(diagram.includes('tabIndex={0}'))
  assert.ok(diagram.includes('onKeyDown={onKeyDown}'))
  assert.ok(diagram.includes('flowKeyAction(e.key, { ctrl: e.ctrlKey || e.metaKey })'))
  for (const action of ['zoom', 'fit', 'actual', 'fullscreen', 'search', 'clear', 'pan']) {
    assert.ok(diagram.includes(`case '${action}':`), `the ${action} key does something`)
  }
})

test('typing in the search box does not zoom the canvas', () => {
  assert.ok(diagram.includes('if (e.target instanceof HTMLInputElement)'))
})
