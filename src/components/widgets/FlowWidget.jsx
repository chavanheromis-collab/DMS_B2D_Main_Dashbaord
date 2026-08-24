import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Expand,
  Filter,
  GitBranch,
  ListTree,
  Maximize2,
  Minus,
  MoveHorizontal,
  MoveVertical,
  Plus,
  Shrink,
  X,
} from 'lucide-react'
import { formatNumber } from '../../lib/dataUtils.js'
import { STAGE_PALETTE } from '../../lib/config.js'
import ExportButton from '../ExportButton.jsx'
import FlowDiagram from './FlowDiagram.jsx'
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

  const [expanded, setExpanded] = useState(() => new Set())
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [autoExpand, setAutoExpand] = useState(undefined)
  const [focusByTree, setFocusByTree] = useState({})
  const [levelOverrides, setLevelOverrides] = useState({})
  // The admin picks which view a page opens on; the reader picks what they
  // want to look at. Neither answer is right for every flow -- a two-level
  // breakdown reads better as a list, a five-level process reads better as
  // a picture.
  const [view, setView] = useState(flow.view === 'diagram' ? 'diagram' : 'tree')
  const [orientation, setOrientation] = useState(flow.orientation === 'horizontal' ? 'horizontal' : 'vertical')
  const [fullscreen, setFullscreen] = useState(false)

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
      setExpanded((current) => {
        const next = new Set(current)
        if (open) next.delete(key)
        else next.add(key)
        return next
      })
      setCollapsed((current) => {
        const next = new Set(current)
        if (open) next.add(key)
        else next.delete(key)
        return next
      })
    },
    [keyFor]
  )

  const focusNode = useCallback((node) => {
    setFocusByTree((all) => ({ ...all, [node.treeId]: node.path }))
  }, [])

  function expandAll() {
    setCollapsed(new Set())
    setAutoExpand(forest.depth)
  }

  function collapseAll() {
    setExpanded(new Set())
    setCollapsed(new Set())
    setAutoExpand(0)
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

  const rootFor = (one) => findFlowNode(one.root, focusByTree[one.tree.id] || '') || one.root

  // A stable array, so the diagram does not re-lay itself out on every
  // unrelated re-render of the page.
  const roots = useMemo(
    () => forest.trees.map((one) => findFlowNode(one.root, focusByTree[one.tree.id] || '') || one.root),
    [forest, focusByTree]
  )

  const card = (
    <div className={`card ${fullscreen ? 'flex h-full flex-col overflow-hidden' : ''}`}>
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
              onClick={() => setView('tree')}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium ${
                view === 'tree' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-50'
              }`}
              title="Read it as a list"
            >
              <ListTree size={11} /> Tree
            </button>
            <button
              onClick={() => setView('diagram')}
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
              onClick={() => setOrientation((o) => (o === 'vertical' ? 'horizontal' : 'vertical'))}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-50"
              title={orientation === 'vertical' ? 'Lay it out left to right' : 'Lay it out top to bottom'}
            >
              {orientation === 'vertical' ? <MoveVertical size={11} /> : <MoveHorizontal size={11} />}
            </button>
          )}

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
          <button
            onClick={() => setFullscreen((f) => !f)}
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
                  setLevelOverrides((all) => ({ ...all, [level.id]: { ...all[level.id], column: e.target.value } }))
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

      {forest.depth === 0 ? (
        <p className="empty-state">No levels configured yet</p>
      ) : view === 'diagram' ? (
        <div className={fullscreen || fillHeight ? 'min-h-0 flex-1' : ''}>
          <FlowDiagram
            roots={roots}
            flow={flow}
            orientation={orientation}
            height={fullscreen || fillHeight ? '100%' : Number(flow.diagramHeight) || 420}
            fullscreen={fullscreen}
            isDrilled={isDrilled}
            onToggle={toggle}
            onDrill={drill}
            onFocus={focusNode}
          />
        </div>
      ) : (
        <div className={`-mx-1 space-y-3 px-1 ${fullscreen ? 'min-h-0 flex-1 overflow-auto' : 'overflow-x-auto'}`}>
          {forest.trees.map((one) => (
            <TreeSection
              key={one.tree.id}
              built={one}
              node={rootFor(one)}
              flow={flow}
              widget={widget}
              showHeader={forest.multi}
              crossFilters={crossFilters}
              focusPath={focusByTree[one.tree.id] || ''}
              onClearFocus={() => setFocusByTree((all) => ({ ...all, [one.tree.id]: '' }))}
              onToggle={toggle}
              onDrill={drill}
              onFocus={focusNode}
            />
          ))}
        </div>
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

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 p-2 backdrop-blur-sm sm:p-4">
      <div className="mx-auto h-full max-w-[1800px]">{card}</div>
    </div>
  )
}

/**
 * One tree on the page, with the breadcrumb that walks back out of it.
 *
 * A canvas with several trees needs each to say what it is; a canvas with
 * one does not, and a heading above a single tree that already has a title
 * is noise.
 */
function TreeSection({
  built,
  node,
  flow,
  widget,
  showHeader,
  crossFilters,
  focusPath,
  onClearFocus,
  onToggle,
  onDrill,
  onFocus,
}) {
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

      {trail.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-1 rounded-lg bg-indigo-50/70 px-2 py-1 text-[11px]">
          <span className="text-[10px] uppercase tracking-wide text-indigo-400">focused</span>
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
            onClick={onClearFocus}
            className="ml-1 rounded p-0.5 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-600"
            title="Back to the whole tree"
          >
            <X size={12} />
          </button>
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
function FlowNode({ node, root, flow, widget, crossFilters, onToggle, onDrill, onFocus, isRoot }) {
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
                className="rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-white hover:text-indigo-600 focus:opacity-100 group-hover:opacity-100"
                title={`Zoom into ${node.label}`}
              >
                <Maximize2 size={11} />
              </button>
            )}
            {canDrill && (
              <button
                onClick={() => onDrill(node)}
                className={`rounded p-1 transition-opacity hover:bg-white ${
                  drilled
                    ? 'text-indigo-600 opacity-100'
                    : 'text-slate-300 opacity-0 focus:opacity-100 group-hover:opacity-100'
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
