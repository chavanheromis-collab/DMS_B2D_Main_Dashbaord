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
  assert.ok(diagram.includes('onPointerEnter={() => onHover(key)}'))
  assert.ok(diagram.includes('lineagePaths(roots, hovered || selected)'))
  assert.ok(diagram.includes('opacity: dimmed ? 0.22 : 1'))
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

// ---------------------------------------------------------------------
// The flow MAP -- the same tree, drawn whole
// ---------------------------------------------------------------------
const map = read('components/widgets/FlowMapWidget.jsx')

test('all four plates are offered, and switching one resets the view', () => {
  assert.ok(map.includes('FLOW_MAP_PLATES.map((p) => ('))
  assert.ok(map.includes('setPlate(p.value)'))
  assert.ok(wiredNear(map, 'setPlate(p.value)', 'resetView()'), 'a magnifier held over the old shape is nonsense')
})

test('the plate is laid out to the MEASURED box, so it always fits', () => {
  // The whole promise of this widget: fitting is a property of the drawing,
  // not something the reader has to achieve with a zoom control.
  assert.ok(map.includes('new ResizeObserver(measure)'))
  assert.ok(map.includes('flowMapLayout(plate, roots, { width: box.width, height: box.height'))
})

test('every level is drawn without anybody clicking', () => {
  assert.ok(map.includes('autoExpand: 99'), 'a plate that only drew what was opened is the tree view with worse ergonomics')
})

test('the depth, colour, order and highlight controls are wired', () => {
  assert.ok(map.includes("setMaxDepth(e.target.value === 'all' ? null : Number(e.target.value))"))
  assert.ok(map.includes('onChange={(e) => setColorBy(e.target.value)}'))
  assert.ok(map.includes('onChange={(e) => setSortOrder(e.target.value)}'))
  assert.ok(map.includes('onChange={(e) => setQuery(e.target.value)}'))
})

test('zoom in, zoom out and reset are wired, and reset means fitted', () => {
  assert.ok(wiredNear(map, 'title="Zoom in"', 'onClick={() => zoomBy(1.25)}'))
  assert.ok(wiredNear(map, 'title="Zoom out"', 'onClick={() => zoomBy(1 / 1.25)}'))
  assert.ok(wiredNear(map, 'title="Back to fitted size"', 'onClick={resetView}'))
  assert.ok(map.includes('const resetView = () => setView({ zoom: 1, x: 0, y: 0 })'))
})

test('panning only happens once there is something to pan', () => {
  assert.ok(map.includes('if (view.zoom <= 1) return'))
})

test('the map has full screen, and Escape leaves it', () => {
  assert.ok(wiredNear(map, "title={fullscreen ? 'Leave full screen (Esc)' : 'Full screen'}", 'setFullscreen((f) => !f)'))
  assert.ok(map.includes("if (e.key === 'Escape') setFullscreen(false)"))
  assert.ok(map.includes("document.body.style.overflow = 'hidden'"))
})

test('the summary is on the plate, and its two findings are clickable', () => {
  assert.ok(map.includes('label="Worst drop-off"'))
  assert.ok(map.includes('label="Biggest branch"'))
  assert.ok(map.includes('onClick={stats.worstDrop ? () => setSelected(nodeKey(stats.worstDrop)) : undefined}'))
})

test('what went nowhere is drawn, not left to be worked out', () => {
  assert.ok(map.includes('layout.gaps.map((gap) => ('))
  assert.ok(map.includes('did not go on anywhere'))
  assert.ok(map.includes('url(#flowmap-lost)'), 'hatched, so it never reads as a branch')
})

test('hover explains, click selects, double-click zooms in', () => {
  assert.ok(map.includes('onPointerEnter: (e) => onHover(item.node, e)'))
  assert.ok(map.includes('onClick: () => onSelect(item.node)'))
  assert.ok(map.includes('onDoubleClick: () => (item.node.children || []).length > 0 && onFocus(item.node)'))
  assert.ok(map.includes('{tooltip && <Tooltip'))
})

test('a branch zoomed into can be got back out of', () => {
  assert.ok(map.includes('focused'))
  assert.ok(map.includes("setFocusByTree((all) => ({ ...all, [one.tree.id]: '' }))"))
})

test('the map drills the page the same way every other widget does', () => {
  assert.ok(map.includes('flowCrossFilter(widget, node)'))
  assert.ok(map.includes('flowNodeIsDrilled(widget, node, crossFilters)'))
})

test('the map exports what it draws, including what went nowhere', () => {
  assert.ok(map.includes("'Unaccounted for'"))
  assert.ok(map.includes('<ExportButton'))
})

test('the legend says what the colours mean, for each way of colouring', () => {
  assert.ok(map.includes('function Legend('))
  for (const mode of ["'drop'", "'level'"]) assert.ok(map.includes(`colorBy === ${mode}`), mode)
})
