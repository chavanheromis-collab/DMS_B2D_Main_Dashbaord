import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Expand,
  Filter,
  GitBranch,
  ArrowDownWideNarrow,
  Eye,
  EyeOff,
  ListTree,
  Maximize2,
  ScanEye,
  StickyNote,
  Percent,
  Redo2,
  RotateCcw,
  TrendingDown,
  Undo2,
  Minus,
  MoveHorizontal,
  MoveVertical,
  Plus,
  Shrink,
  X,
} from 'lucide-react'
import { formatNumber } from '../../lib/dataUtils.js'
import { canShowDetails } from '../../lib/flowDetails.js'
import {
  FULLSCREEN_EVENTS,
  exitFullscreen,
  fullscreenHost,
  requestFullscreen,
  stillFullscreen,
} from '../../lib/deviceFullscreen.js'
import { STAGE_PALETTE } from '../../lib/config.js'
import ExportButton from '../ExportButton.jsx'
import FlowDiagram from './FlowDiagram.jsx'
import FlowRowDetails from './FlowRowDetails.jsx'
import StickyNotes from '../StickyNotes.jsx'
import { useNotesLayer } from '../../context/NotesLayer.jsx'
import {
  DEFAULT_FLOW,
  buildFlowTrees,
  describeFlow,
  findFlowNode,
  flattenFlow,
  flowCrossFilter,
  flowNodeCanDrill,
  flowNodeIsDrilled,
} from '../../lib/flow.js'
import {
  canRedo,
  canUndo,
  commitHistory,
  emptyHistory,
  historyKeyAction,
  redoHistory,
  resetHistory,
  undoHistory,
} from '../../lib/history.js'
import {
  FLOW_VIEW_SORTS,
  SIGNIFICANCE_STEPS,
  flowStats,
  pruneBySignificance,
  sortFlowRoots,
} from '../../lib/flowView.js'

/**
 * A flowchart you read by opening it.
 *
 * The screen starts as one number and a handful of branches. Every click
 * adds a level, and every level is a subset of the one above it, so the
 * arithmetic reconciles all the way down -- which is what separates a drill
 * path from a wall of charts that each answer a different question.
 *
 * Three deliberate choices:
 *
 *  - Vertical, indented, not a left-to-right diagram. A flow that fans out
 *    eight ways at three levels cannot be drawn horizontally inside a
 *    dashboard card, and would not survive a phone at all. Indentation is
 *    the one layout that stays legible at any breadth.
 *  - The bar behind each row is its share of its PARENT, not of the whole.
 *    Reading down a branch you are always asking "how much of that survived
 *    to here", which is the funnel question, and it is answerable at a
 *    glance instead of by dividing two numbers.
 *  - Clicking the row opens it; clicking the funnel drills. Two intents,
 *    two targets -- an expand that also filtered the page would make the
 *    page unusable as a way to explore.
 */
export default function FlowWidget({
  widget,
  rowsByTab,
  rawRowsByTab,
  headersByTab,
  crossFilters,
  onCrossFilter,
  dateOrder,
  canExport = false,
  fillHeight = false,
}) {
  const flow = { ...DEFAULT_FLOW, ...(widget.flow || {}) }
  const source = widget.ignoreFilters ? rawRowsByTab : rowsByTab

  // Everything the reader has decided, in ONE value.
  //
  // It was eight useStates, which was fine until undo: stepping back through
  // an exploration means restoring the whole of it at once, and eight
  // separate stacks that could drift out of step with each other is not one
  // history, it is eight ways to end up somewhere that never existed.
  //
  // `view` and `orientation` start where the admin set them; everything else
  // starts empty. `fullscreen` is deliberately NOT in here -- it is where you
  // are looking from, not what you are looking at, and undoing your way out
  // of full screen would be baffling.
  const initialExplore = useMemo(
    () => ({
      expanded: new Set(),
      collapsed: new Set(),
      autoExpand: undefined,
      focusByTree: {},
      levelOverrides: {},
      // The admin picks which view a page opens on; the reader picks what
      // they want to look at. Neither answer is right for every flow -- a
      // two-level breakdown reads better as a list, a five-level process
      // reads better as a picture.
      view: flow.view === 'diagram' ? 'diagram' : 'tree',
      orientation: flow.orientation === 'horizontal' ? 'horizontal' : 'vertical',
      // Three questions the admin answered once and the reader keeps
      // re-asking: in what order, measured against what, and without the
      // noise. None of these change a single number -- they change which
      // numbers are in front of you, which is what reading a flow consists
      // of.
      sortOrder: 'natural',
      minShare: 0,
      percentBase: flow.percentBase === 'root' ? 'root' : 'parent',
    }),
    [flow.view, flow.orientation, flow.percentBase]
  )

  const [history, setHistory] = useState(() => emptyHistory(initialExplore))
  const explore = history.present
  const { expanded, collapsed, autoExpand, focusByTree, levelOverrides, view, orientation, sortOrder, minShare, percentBase } =
    explore

  /** Every change to the exploration goes through here, so all of it is undoable. */
  const commit = useCallback((patch) => {
    setHistory((h) => commitHistory(h, { ...h.present, ...(typeof patch === 'function' ? patch(h.present) : patch) }))
  }, [])

  const undo = useCallback(() => setHistory((h) => undoHistory(h)), [])
  const redo = useCallback(() => setHistory((h) => redoHistory(h)), [])
  const resetExplore = useCallback(
    () => setHistory((h) => resetHistory(h, initialExplore)),
    [initialExplore]
  )

  const [fullscreen, setFullscreen] = useState(false)
  // Which branch is being looked into, and the button it was opened from --
  // the window places itself against that rectangle.
  const [details, setDetails] = useState(null)
  // The reader's own notes, so full screen does not hide them. Null
  // everywhere but a dashboard -- the admin preview has no notes layer.
  const notesLayer = useNotesLayer()
  // The overlay element itself, so the browser can be asked to make THAT
  // the thing filling the screen.
  const screenRef = useRef(null)
  // Where it gets mounted. Worked out when the button is pressed, while the
  // card is still in its normal place in the page and can be asked what it
  // is inside -- a moment later it has moved and the answer is gone.
  const [host, setHost] = useState(null)
  // Whether the floating controls are faded out. Only ever true in full
  // screen -- there is nothing to get out of the way of on a card.
  const [bare, setBare] = useState(false)
  // The chrome only floats over the DIAGRAM: a table read from the top down
  // would have its first rows permanently behind the panel.
  const floating = fullscreen && view === 'diagram'

  const forest = useMemo(() => {
    const built = buildFlowTrees({
      widget,
      rowsByTab: source,
      headersByTab,
      dateOrder,
      expanded,
      collapsed,
      autoExpand,
      levelOverrides,
    })
    // Node paths are unique inside a tree, not between them. Stamping the
    // tree on every node is what lets one canvas, one set of open branches
    // and one click handler serve all of them.
    for (const one of built.trees) {
      for (const node of flattenFlow(one.root)) node.treeId = one.tree.id
    }
    return built
  }, [widget, source, headersByTab, dateOrder, expanded, collapsed, autoExpand, levelOverrides])

  const keyFor = useCallback(
    (node) => (forest.multi ? `${node.treeId}::${node.path}` : node.path),
    [forest.multi]
  )

  const toggle = useCallback(
    (node) => {
      const key = keyFor(node)
      const open = node.open
      commit((prev) => {
        const nextExpanded = new Set(prev.expanded)
        const nextCollapsed = new Set(prev.collapsed)
        if (open) {
          nextExpanded.delete(key)
          nextCollapsed.add(key)
        } else {
          nextExpanded.add(key)
          nextCollapsed.delete(key)
        }
        return { expanded: nextExpanded, collapsed: nextCollapsed }
      })
    },
    [keyFor, commit]
  )

  const focusNode = useCallback(
    (node) => commit((prev) => ({ focusByTree: { ...prev.focusByTree, [node.treeId]: node.path } })),
    [commit]
  )

  function expandAll() {
    commit({ collapsed: new Set(), autoExpand: forest.depth })
  }

  function collapseAll() {
    commit({ expanded: new Set(), collapsed: new Set(), autoExpand: 0 })
  }

  const drill = useCallback(
    (node) => {
      const cf = flowCrossFilter(widget, node)
      if (cf) onCrossFilter(cf)
    },
    [widget, onCrossFilter]
  )

  const isDrilled = useCallback(
    (node) => flowNodeIsDrilled(widget, node, crossFilters),
    [widget, crossFilters]
  )

  /**
   * Ctrl+Z, Ctrl+Y and Escape, while the pointer is over this widget.
   *
   * Scoped by hover rather than by focus, because reading a flow is a
   * pointing activity -- nobody tabs to a diagram first -- and scoped to
   * SOMETHING because a page can hold two flows and a browser-wide Ctrl+Z
   * would step back through whichever one it felt like.
   *
   * Escape resets the whole exploration, and the reset is itself undoable:
   * pressing Escape by accident should not be the one action you cannot
   * take back.
   */
  const [engaged, setEngaged] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!engaged && !fullscreen) return undefined
    const onKey = (e) => {
      // A keystroke aimed at a text box belongs to the text box.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      const action = historyKeyAction(e)
      if (action) {
        e.preventDefault()
        if (action === 'undo') undo()
        else redo()
        return
      }
      if (e.key === 'Escape' && !fullscreen) {
        e.preventDefault()
        resetExplore()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engaged, fullscreen, undo, redo, resetExplore])

  // Fullscreen is a property of the WIDGET, not of the canvas inside it: the
  // view switch, the breadcrumb and the breakdown pickers are part of
  // reading a flow, and a fullscreen picture without them would be a
  // picture you cannot steer.
  useEffect(() => {
    if (!fullscreen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    // The page behind must not scroll under the overlay.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [fullscreen])

  // The DEVICE screen, not the browser window.
  //
  // The overlay alone is only ever as big as the viewport -- which is the
  // window minus its tab strip, address bar and bookmarks, and on a phone
  // minus rather more than that. Asking the browser for real fullscreen is
  // what turns "as big as the page" into "as big as the screen".
  //
  // A refusal is fine and needs no branch: the overlay is drawn either way,
  // and this only decides how large the window it sits in is allowed to be.
  useEffect(() => {
    if (!fullscreen) {
      // Only if we are the ones holding it -- see lib/deviceFullscreen.js.
      exitFullscreen(document, screenRef.current)
      return undefined
    }

    const element = screenRef.current
    requestFullscreen(element)

    // Esc and F11 are the browser's own, and leaving that way tells us
    // nothing except through this event. Without it the widget stays in its
    // fullscreen layout inside a normal window, with the way out gone.
    const onChange = () => {
      if (!stillFullscreen(document, element)) setFullscreen(false)
    }
    // Fired once by our own request as well; harmless, because it only ever
    // turns fullscreen OFF and by then we are the fullscreen element.
    for (const name of FULLSCREEN_EVENTS) document.addEventListener(name, onChange)
    return () => {
      for (const name of FULLSCREEN_EVENTS) document.removeEventListener(name, onChange)
    }
  }, [fullscreen])

  const openDetails = useCallback((node, anchor) => setDetails({ node, anchor }), [])
  const closeDetails = useCallback(() => setDetails(null), [])

  const toggleFullscreen = useCallback(() => {
    setFullscreen((on) => {
      if (!on) setHost(fullscreenHost(rootRef.current))
      return !on
    })
  }, [])

  const openCount = forest.trees.reduce((sum, one) => sum + flattenFlow(one.root).filter((n) => n.open).length, 0)

  const exportRows = useCallback(
    () =>
      forest.trees.flatMap((one) =>
        flattenFlow(one.root).map((node) => ({
          Tree: one.tree.label || one.tree.tab,
          Level: node.level,
          Branch: node.label,
          Path: node.trail.join(' → '),
          Table: node.tab,
          Value: node.value,
          Rows: node.count,
          'Share of parent %': node.share === null ? '' : Math.round(node.share * 1000) / 10,
          'Share of total %': node.shareOfRoot === null ? '' : Math.round(node.shareOfRoot * 1000) / 10,
        }))
      ),
    [forest]
  )

  // A viewer-changeable split has to offer the columns of the tab in play at
  // ITS level, which a hop above it may have changed -- offering the root
  // tab's columns everywhere would silently produce an empty branch.
  const changeable = useMemo(() => {
    const out = []
    for (const one of forest.trees) {
      let tab = one.tree.tab
      one.levels.forEach((level) => {
        if (level.kind === 'split' && level.allowChange && level.id) out.push({ level, tab, tree: one.tree })
        if (level.kind === 'hop' && level.tab) tab = level.tab
      })
    }
    return out
  }, [forest])

  const columnsOf = (tab) => {
    const sample = (source?.[tab] || [])[0]
    return sample ? Object.keys(sample).filter((c) => c !== '_row') : []
  }

  // The trees as the READER has asked to see them: focused into, re-ordered,
  // and with the hairlines dropped. A stable array, so the diagram does not
  // re-lay itself out on every unrelated re-render of the page.
  //
  // Focus first (it decides which tree there even is), then sort, then
  // prune -- pruning before sorting would drop branches by a share and then
  // rearrange what is left, which is harder to reason about and gives the
  // same answer.
  const shaped = useMemo(() => {
    const focused = forest.trees.map((one) => findFlowNode(one.root, focusByTree[one.tree.id] || '') || one.root)
    return pruneBySignificance(sortFlowRoots(focused, sortOrder), minShare)
  }, [forest, focusByTree, sortOrder, minShare])

  const roots = shaped.roots
  const stats = useMemo(() => flowStats(roots), [roots])

  // The flow as the reader has it, so the diagram, the tree and the node
  // panel all measure their percentages against the same thing.
  const viewFlow = useMemo(() => ({ ...flow, percentBase }), [flow, percentBase])

  const card = (
    <div
      ref={rootRef}
      onPointerEnter={() => setEngaged(true)}
      onPointerLeave={() => setEngaged(false)}
      className={`card ${
        fullscreen ? 'relative flex h-full flex-col overflow-hidden rounded-none border-0 p-0' : ''
      }`}
    >
      {/* Full screen means the CANVAS gets the screen. The chrome stops
          being a band above the diagram and becomes a panel floating over
          it -- so the picture is the whole window rather than the window
          minus a header, which is the entire reason anybody presses the
          button. It is still every control it was, in the same order.
          
          Only over the DIAGRAM. A table under a floating panel would have
          its first rows permanently hidden behind it, and a table is read
          from the top down. */}
      <div
        className={
          floating
            ? `pointer-events-none absolute inset-x-0 top-0 z-20 p-2 transition-opacity duration-200 ${
                bare ? 'opacity-0 hover:opacity-100 focus-within:opacity-100' : ''
              }`
            : ''
        }
      >
      <div
        className={
          floating
            ? 'pointer-events-auto rounded-xl border border-slate-200/70 bg-white/85 p-2 shadow-lg backdrop-blur'
            : ''
        }
      >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="widget-title">🔀 {widget.title}</h2>
          <p className="truncate text-[11px] text-slate-400">
            {describeFlow(widget)}
            {forest.multi && ` · ${forest.trees.length} trees`}
            {widget.ignoreFilters && ' · unfiltered'}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <div className="flex overflow-hidden rounded-lg border border-slate-200">
            <button
              onClick={() => commit({ view: 'tree' })}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium ${
                view === 'tree' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-50'
              }`}
              title="Read it as a list"
            >
              <ListTree size={11} /> Tree
            </button>
            <button
              onClick={() => commit({ view: 'diagram' })}
              className={`flex items-center gap-1 border-l border-slate-200 px-2 py-1 text-[10px] font-medium ${
                view === 'diagram' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-50'
              }`}
              title="See its shape"
            >
              <GitBranch size={11} /> Diagram
            </button>
          </div>

          {view === 'diagram' && (
            <button
              onClick={() => commit((prev) => ({ orientation: prev.orientation === 'vertical' ? 'horizontal' : 'vertical' }))}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-50"
              title={orientation === 'vertical' ? 'Lay it out left to right' : 'Lay it out top to bottom'}
            >
              {orientation === 'vertical' ? <MoveVertical size={11} /> : <MoveHorizontal size={11} />}
            </button>
          )}

          {/* Undo and redo sit first, where the eye lands when something
              has just gone wrong. */}
          <div className="flex overflow-hidden rounded-lg border border-slate-200">
            <button
              onClick={undo}
              disabled={!canUndo(history)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-30"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={11} />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo(history)}
              className="flex items-center gap-1 border-l border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-30"
              title="Redo (Ctrl+Y)"
            >
              <Redo2 size={11} />
            </button>
            <button
              onClick={resetExplore}
              disabled={!canUndo(history)}
              className="flex items-center gap-1 border-l border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-30"
              title="Back to how this page opened (Esc) — itself undoable"
            >
              <RotateCcw size={11} />
            </button>
          </div>

          <button
            onClick={expandAll}
            className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-50"
            title="Open every branch"
          >
            <Plus size={11} /> Expand all
          </button>
          <button
            onClick={collapseAll}
            disabled={openCount === 0}
            className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-40"
            title="Close every branch"
          >
            <Minus size={11} /> Collapse
          </button>
          {canExport && (
            <ExportButton
              name={widget.title || 'flow'}
              // Only what is open: a flow's whole premise is that you choose
              // the depth, and an export that quietly walked past that
              // choice would not be the thing on screen.
              rows={exportRows}
              columns={() => [
                'Tree',
                'Level',
                'Branch',
                'Path',
                'Table',
                'Value',
                'Rows',
                'Share of parent %',
                'Share of total %',
              ]}
              count={exportRows().length}
            />
          )}
          {/* Out of the way altogether, for reading a wide flow. It comes
              back on hover or on a keyboard focus, so it is never lost --
              which is what makes hiding it safe to offer. */}
          {floating && (
            <button
              onClick={() => setBare((b) => !b)}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium ${
                bare
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
              title={bare ? 'Keep these controls on screen' : 'Fade these controls out until you need them'}
            >
              {bare ? <Eye size={11} /> : <EyeOff size={11} />}
            </button>
          )}
          {/* Only in full screen, where this layer is ours to draw. On a
              card the page's own notes are already on top of it, and a
              second switch for them here would be a second answer to one
              question. */}
          {fullscreen && notesLayer?.onHidden && (
            <button
              onClick={() => notesLayer.onHidden(!notesLayer.hidden)}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium ${
                notesLayer.hidden
                  ? 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  : 'border-amber-300 bg-amber-50 text-amber-600'
              }`}
              title={notesLayer.hidden ? 'Show my notes' : 'Hide my notes'}
            >
              <StickyNote size={11} />
              {notesLayer.notes.length > 0 && <span className="tabular-nums">{notesLayer.notes.length}</span>}
            </button>
          )}
          <button
            onClick={toggleFullscreen}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium ${
              fullscreen
                ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
                : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
            title={fullscreen ? 'Leave full screen (Esc)' : 'Full screen'}
          >
            {fullscreen ? <Shrink size={11} /> : <Expand size={11} />}
          </button>
        </div>
      </div>

      {/* A viewer-changeable breakdown: the single most useful control a
          drill tool can offer, because the interesting split is rarely the
          one anyone predicted when the page was built. */}
      {changeable.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {changeable.map(({ level, tab, tree }, i) => (
            <div key={level.id} className="flex items-center gap-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-400">
                {forest.multi ? `${tree.label || tree.tab} ·` : i === 0 ? 'break down by' : 'then by'}
              </span>
              <select
                value={levelOverrides[level.id]?.column ?? level.column}
                onChange={(e) =>
                  commit((prev) => ({
                    levelOverrides: {
                      ...prev.levelOverrides,
                      [level.id]: { ...prev.levelOverrides[level.id], column: e.target.value },
                    },
                  }))
                }
                className="rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-600"
              >
                {columnsOf(tab).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* --- how the reader wants to look at it ----------------------- */}
      {forest.depth > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-slate-100 py-1.5 text-[10px]">
          <label className="flex items-center gap-1" title="Re-orders the branches. No number changes.">
            <ArrowDownWideNarrow size={11} className="text-slate-400" />
            <select
              value={sortOrder}
              onChange={(e) => commit({ sortOrder: e.target.value })}
              className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-600"
              aria-label="Order the branches"
            >
              {FLOW_VIEW_SORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1" title="Hides branches under this share of their parent.">
            <EyeOff size={11} className="text-slate-400" />
            <select
              value={String(minShare)}
              onChange={(e) => commit({ minShare: Number(e.target.value) })}
              className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-600"
              aria-label="Hide small branches"
            >
              {SIGNIFICANCE_STEPS.map((v) => (
                <option key={v} value={v}>
                  {v === 0 ? 'Show every branch' : `Hide under ${Math.round(v * 100)}%`}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={() => commit((prev) => ({ percentBase: prev.percentBase === 'parent' ? 'root' : 'parent' }))}
            className="flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-slate-600 hover:bg-slate-50"
            title="What each percentage is measured against"
          >
            <Percent size={10} className="text-slate-400" />
            {percentBase === 'parent' ? '% of its parent' : '% of the total'}
          </button>

          {/* The thing you opened the diagram to find, found for you. On a
              canvas of two hundred nodes, hunting the worst drop-off by eye
              across four levels is exactly the work a computer should have
              done first. */}
          {stats.worstDrop && (
            <button
              onClick={() => focusNode(stats.worstDrop)}
              className="flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-700 hover:bg-amber-100"
              title={`${stats.worstDrop.trail.join(' → ')} loses ${Math.round(
                stats.worstDrop.dropOff * 100
              )}% of the branch above it — click to zoom in`}
            >
              <TrendingDown size={10} /> Worst drop: {stats.worstDrop.label} ▼
              {Math.round(stats.worstDrop.dropOff * 100)}%
            </button>
          )}

          <span className="ml-auto text-slate-400">
            {stats.nodes.toLocaleString('en-IN')} branches · {stats.depth} deep
            {shaped.hidden > 0 && (
              <span className="text-amber-600">
                {' '}
                · {shaped.hidden} hidden ({Math.round(shaped.hiddenValue).toLocaleString('en-IN')})
              </span>
            )}
          </span>
        </div>
      )}

      {/* The way back out of a branch you zoomed into -- in BOTH views. It
          used to live inside the tree, so zooming in on the diagram left the
          reader with no visible way back. */}
      {forest.trees.map((one) => (
        <FocusTrail
          key={one.tree.id}
          built={one}
          label={forest.multi ? one.tree.label || one.tree.tab : ''}
          focusPath={focusByTree[one.tree.id] || ''}
          onFocus={focusNode}
          onClear={() => commit((prev) => ({ focusByTree: { ...prev.focusByTree, [one.tree.id]: '' } }))}
        />
      ))}

      </div>
      </div>

      {forest.depth === 0 ? (
        <p className="empty-state">No levels configured yet</p>
      ) : view === 'diagram' ? (
        <div className={floating ? 'absolute inset-0' : fullscreen || fillHeight ? 'min-h-0 flex-1' : ''}>
          <FlowDiagram
            roots={roots}
            flow={viewFlow}
            orientation={orientation}
            height={fullscreen || fillHeight ? '100%' : Number(flow.diagramHeight) || 420}
            fullscreen={fullscreen}
            onToggleFullscreen={toggleFullscreen}
            isDrilled={isDrilled}
            onToggle={toggle}
            onDrill={drill}
            onFocus={focusNode}
          />
        </div>
      ) : (
        <div className={`-mx-1 space-y-3 px-1 ${fullscreen ? 'min-h-0 flex-1 overflow-auto' : 'overflow-x-auto'}`}>
          {forest.trees.map((one, i) => (
            <TreeSection
              key={one.tree.id}
              built={one}
              node={roots[i] || one.root}
              flow={viewFlow}
              widget={widget}
              showHeader={forest.multi}
              crossFilters={crossFilters}
              onToggle={toggle}
              onDrill={drill}
              onFocus={focusNode}
              onDetails={openDetails}
            />
          ))}
        </div>
      )}

      {/* The rows behind one branch. Rendered here rather than inside the
          row, so only one is ever open and closing it is one piece of
          state rather than one per row. */}
      {details && (
        <FlowRowDetails node={details.node} flow={viewFlow} anchor={details.anchor} onClose={closeDetails} />
      )}

      {forest.truncated && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
          Stopped after {flow.maxNodes} branches. Close a level, or focus into the branch you care about, to keep
          going deeper.
        </p>
      )}
    </div>
  )

  if (!fullscreen) return card

  // No padding and no maximum width: "full screen" that stops 100px short
  // of the edges on a wide monitor is the one thing it cannot be.
  //
  // Portalled to the body, and that is not tidiness. `position: fixed` is
  // relative to the viewport only while NO ancestor has a transform, a
  // filter or a backdrop-filter -- and the widget sits inside a `.card`,
  // which has `backdrop-filter: blur(10px)`, and inside a canvas that
  // translates a pinned widget as the page scrolls. Any one of those makes
  // itself the containing block, and `inset-0` then means "as big as the
  // card", which is exactly the bug this fixes. Out of the subtree, there
  // is nothing left to be contained by.
  return createPortal(
    <div ref={screenRef} className="fixed inset-0 z-[60] flex flex-col bg-white" style={{ height: '100dvh' }}>
      {card}
      {/* The same notes the page has, on top of the diagram -- not a copy:
          one list, one document, so moving a note here moves it there. The
          page's own layer is behind this overlay and invisible, which is
          the whole reason this exists. */}
      {notesLayer?.onNotes && (
        <StickyNotes
          notes={notesLayer.notes}
          onNotes={notesLayer.onNotes}
          canvasWidth={0}
          hidden={notesLayer.hidden}
        />
      )}
    </div>,
    host || document.body
  )
}

/**
 * The way back out of a branch somebody zoomed into.
 *
 * It used to live inside the tree view, which meant double-clicking a node
 * on the DIAGRAM zoomed you in and left you with nothing to click to get
 * back out -- the one thing a zoom-in gesture must always come with. It now
 * sits above whichever view is open, and belongs to neither.
 */
function FocusTrail({ built, label, focusPath, onFocus, onClear }) {
  const trail = useMemo(() => {
    if (!focusPath) return []
    const out = [built.root]
    let path = ''
    for (const part of focusPath.split('/').slice(1)) {
      path += `/${part}`
      const found = findFlowNode(built.root, path)
      if (!found) break
      out.push(found)
    }
    return out
  }, [built.root, focusPath])

  if (trail.length < 2) return null

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1 rounded-lg bg-indigo-50/70 px-2 py-1 text-[11px]">
      <span className="text-[10px] uppercase tracking-wide text-indigo-400">{label ? `${label} ·` : ''} focused</span>
      {trail.map((item, i) => (
        <span key={item.path} className="flex items-center gap-1">
          {i > 0 && <ChevronRight size={11} className="text-indigo-300" />}
          <button
            onClick={() => onFocus(item)}
            className={`max-w-[160px] truncate hover:underline ${
              i === trail.length - 1 ? 'font-semibold text-indigo-700' : 'text-indigo-500'
            }`}
          >
            {item.label}
          </button>
        </span>
      ))}
      <button
        onClick={onClear}
        className="ml-1 rounded p-0.5 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-600"
        title="Back to the whole tree"
      >
        <X size={12} />
      </button>
    </div>
  )
}

/**
 * One tree on the page.
 *
 * A canvas with several trees needs each to say what it is; a canvas with
 * one does not, and a heading above a single tree that already has a title
 * is noise.
 */
function TreeSection({ built, node, flow, widget, showHeader, crossFilters, onToggle, onDrill, onFocus, onDetails }) {
  return (
    <div>
      {showHeader && (
        <div className="mb-1 flex items-center gap-1.5 border-b border-slate-100 pb-1">
          <span className="text-[11px] font-semibold text-slate-600">
            {built.tree.icon} {built.tree.label || built.tree.tab}
          </span>
          <span className="rounded-full bg-slate-100 px-1.5 py-px text-[9px] uppercase tracking-wide text-slate-500">
            {built.tree.tab}
          </span>
          {built.blended && (
            <span
              className="rounded-full bg-teal-50 px-1.5 py-px text-[9px] uppercase tracking-wide text-teal-600"
              title={`Blended with ${built.tree.blend?.ref}`}
            >
              blended
            </span>
          )}
        </div>
      )}

      <FlowNode
        node={node}
        root={node}
        flow={flow}
        widget={widget}
        crossFilters={crossFilters}
        onToggle={onToggle}
        onDrill={onDrill}
        onFocus={onFocus}
        onDetails={onDetails}
        isRoot
      />
    </div>
  )
}

/**
 * One row, and its children underneath it.
 *
 * The guide line is a plain left border on the children's wrapper rather
 * than absolutely positioned SVG: it survives any row height, any font size
 * and any amount of wrapping, which hand-drawn connectors do not.
 */
function FlowNode({ node, root, flow, widget, crossFilters, onToggle, onDrill, onFocus, onDetails, isRoot }) {
  const drilled = flowNodeIsDrilled(widget, node, crossFilters)
  const color = node.color || STAGE_PALETTE[node.level % STAGE_PALETTE.length] || '#4F46E5'
  const share = flow.percentBase === 'root' ? node.shareOfRoot : node.share
  // `null` is not 0: it means this branch is not part of its parent and has
  // no share to show. Drawing a 0% bar would say something false.
  const hasShare = share !== null && share !== undefined
  const pct = Math.max(0, Math.min(1, share || 0))
  const canOpen = node.hasChildren
  const canDrill = flowNodeCanDrill(node)

  // A leaf has nothing to open, so the row itself is the drill -- otherwise
  // the deepest and most specific rows would be the only ones that did
  // nothing when clicked.
  const rowAction = () => (canOpen ? onToggle(node) : canDrill && onDrill(node))

  return (
    <div className="relative">
      <div
        className={`group relative flex items-center gap-1.5 overflow-hidden rounded-lg px-1.5 py-1 transition-colors ${
          drilled ? 'ring-1 ring-offset-1' : 'hover:bg-slate-50'
        }`}
        style={drilled ? { '--tw-ring-color': color, backgroundColor: `${color}0F` } : undefined}
      >
        {/* Share of parent, as the width of the row's own tint. */}
        {flow.showBars !== false && hasShare && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 rounded-lg transition-all duration-500"
            style={{ width: `${pct * 100}%`, backgroundColor: `${color}14` }}
          />
        )}
        <span aria-hidden className="absolute inset-y-1 left-0 w-[3px] rounded-full" style={{ backgroundColor: color }} />

        <button
          onClick={rowAction}
          className="relative flex min-w-0 flex-1 items-center gap-1.5 pl-2 text-left"
          title={canOpen ? (node.open ? 'Close this branch' : 'Open this branch') : 'Filter the page to these rows'}
        >
          <span className="w-3 shrink-0 text-slate-400">
            {canOpen ? (
              node.open ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )
            ) : (
              <CornerDownRight size={11} className="text-slate-300" />
            )}
          </span>

          {node.icon && <span className="shrink-0 text-sm leading-none">{node.icon}</span>}

          <span
            className={`truncate ${isRoot ? 'text-sm font-semibold text-slate-800' : 'text-[12px] text-slate-700'} ${
              node.kind === 'blank' || node.kind === 'other' || node.kind === 'else' ? 'italic text-slate-400' : ''
            }`}
          >
            {node.label}
          </span>

          {(node.kind === 'hop' || node.kind === 'table') && (
            <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-slate-500">
              {node.tab}
            </span>
          )}
          {node.independent && !isRoot && (
            <span
              className="shrink-0 rounded-full bg-slate-100 px-1.5 py-px text-[9px] text-slate-400"
              title="Not part of the branch above it, so it has no share of it"
            >
              own total
            </span>
          )}
        </button>

        <div className="relative flex shrink-0 items-center gap-2">
          {flow.showDropOff !== false && !isRoot && hasShare && node.dropOff > 0.001 && (
            <span className="hidden text-[10px] font-medium text-amber-600 sm:inline" title="Lost from the branch above">
              ▼{Math.round(node.dropOff * 100)}%
            </span>
          )}

          <span className="w-11 text-right text-[10px] font-semibold" style={{ color }}>
            {isRoot ? '100%' : hasShare ? `${(pct * 100).toFixed(pct < 0.1 ? 1 : 0)}%` : '—'}
          </span>

          <span
            className={`text-right tabular-nums ${isRoot ? 'text-base font-bold text-slate-800' : 'text-[12px] font-semibold text-slate-700'}`}
            title={node.measure?.column ? `${node.measure.aggregation} of ${node.measure.column}` : node.measure?.aggregation}
          >
            {formatNumber(node.value, node.measure?.format || 'comma', node.measure?.aggregation)}
          </span>

          <span className="flex items-center gap-0.5">
            {canOpen && !isRoot && (
              <button
                onClick={() => onFocus(node)}
                className="row-tool rounded p-1 text-slate-300 transition-opacity hover:bg-white hover:text-indigo-600"
                title={`Zoom into ${node.label}`}
              >
                <Maximize2 size={11} />
              </button>
            )}
            {onDetails && canShowDetails(flow, node) && (
              <button
                onClick={(e) => onDetails(node, e.currentTarget.getBoundingClientRect())}
                className="row-tool rounded p-1 text-slate-300 transition-opacity hover:bg-white hover:text-indigo-600"
                title={`Look at the rows behind ${node.label}`}
              >
                <ScanEye size={11} />
              </button>
            )}
            {canDrill && (
              <button
                onClick={() => onDrill(node)}
                className={`rounded p-1 transition-opacity hover:bg-white ${
                  drilled ? 'text-indigo-600' : 'row-tool text-slate-300'
                }`}
                title={drilled ? 'Remove this filter from the page' : 'Filter the whole page to these rows'}
              >
                <Filter size={11} />
              </button>
            )}
          </span>
        </div>
      </div>

      {/* Extra measures, shown only where they are being read -- on the
          branch that is open -- so the tree does not turn into a table. */}
      {node.metrics.length > 0 && (node.open || isRoot) && (
        <div className="flex flex-wrap gap-1 py-0.5 pl-8">
          {node.metrics.map((m) => (
            <span
              key={m.id || m.label}
              className="rounded-md bg-slate-100/80 px-1.5 py-px text-[10px] text-slate-500"
              title={m.label}
            >
              {m.label}{' '}
              <strong className="font-semibold text-slate-700">
                {formatNumber(m.value, m.format, m.aggregation)}
              </strong>
            </span>
          ))}
        </div>
      )}

      {node.open && node.children.length > 0 && (
        <div className="ml-[13px] mt-0.5 space-y-0.5 border-l border-slate-200/90 pl-2">
          {node.children.map((child) => (
            <FlowNode
              key={child.path}
              node={child}
              root={root}
              flow={flow}
              widget={widget}
              crossFilters={crossFilters}
              onToggle={onToggle}
              onDrill={onDrill}
              onFocus={onFocus}
              onDetails={onDetails}
            />
          ))}
        </div>
      )}

      {node.open && node.children.length === 0 && (
        <p className="py-1 pl-8 text-[10px] text-slate-300">Nothing under this branch</p>
      )}

      {node.truncated && (
        <p className="py-1 pl-8 text-[10px] text-amber-600">Not expanded — the flow hit its branch limit here.</p>
      )}
    </div>
  )
}
