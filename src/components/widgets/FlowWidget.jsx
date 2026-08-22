import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, CornerDownRight, Filter, Maximize2, Minus, Plus, X } from 'lucide-react'
import { formatNumber } from '../../lib/dataUtils.js'
import { STAGE_PALETTE } from '../../lib/config.js'
import {
  DEFAULT_FLOW,
  buildFlow,
  describeFlow,
  findFlowNode,
  flattenFlow,
  flowCrossFilter,
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
export default function FlowWidget({ widget, rowsByTab, rawRowsByTab, crossFilters, onCrossFilter, dateOrder }) {
  const flow = { ...DEFAULT_FLOW, ...(widget.flow || {}) }
  const source = widget.ignoreFilters ? rawRowsByTab : rowsByTab

  const [expanded, setExpanded] = useState(() => new Set())
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [autoExpand, setAutoExpand] = useState(undefined)
  const [focusPath, setFocusPath] = useState('')
  const [levelOverrides, setLevelOverrides] = useState({})

  const built = useMemo(
    () => buildFlow({ widget, rowsByTab: source, dateOrder, expanded, collapsed, autoExpand, levelOverrides }),
    [widget, source, dateOrder, expanded, collapsed, autoExpand, levelOverrides]
  )

  // Focus makes any node the temporary root -- the same "zoom in" every
  // serious drill tool has. The tree is still built from the real root, so
  // the breadcrumb can walk back out without recomputing anything.
  const focused = (focusPath && findFlowNode(built.root, focusPath)) || built.root
  const trail = useMemo(() => {
    if (!focusPath) return []
    const out = []
    let node = built.root
    const parts = focusPath.split('/').slice(1)
    let path = ''
    out.push(built.root)
    for (const part of parts) {
      path += `/${part}`
      node = findFlowNode(built.root, path)
      if (!node) break
      out.push(node)
    }
    return out
  }, [built.root, focusPath])

  function toggle(node) {
    const open = node.open
    setExpanded((current) => {
      const next = new Set(current)
      if (open) next.delete(node.path)
      else next.add(node.path)
      return next
    })
    setCollapsed((current) => {
      const next = new Set(current)
      if (open) next.add(node.path)
      else next.delete(node.path)
      return next
    })
  }

  function expandAll() {
    setCollapsed(new Set())
    setAutoExpand(built.depth)
  }

  function collapseAll() {
    setExpanded(new Set())
    setCollapsed(new Set())
    setAutoExpand(0)
  }

  function drill(node) {
    const cf = flowCrossFilter(widget, node)
    if (cf) onCrossFilter(cf)
  }

  const openCount = flattenFlow(built.root).filter((n) => n.open).length

  // A viewer-changeable split has to offer the columns of the tab in play at
  // ITS level, which a hop above it may have changed -- offering the root
  // tab's columns everywhere would silently produce an empty branch.
  const changeable = useMemo(() => {
    let tab = widget.tab
    const out = []
    built.levels.forEach((level) => {
      if (level.kind === 'split' && level.allowChange && level.id) out.push({ level, tab })
      if (level.kind === 'hop' && level.tab) tab = level.tab
    })
    return out
  }, [built.levels, widget.tab])

  const columnsOf = (tab) => {
    const sample = (source?.[tab] || [])[0]
    return sample ? Object.keys(sample).filter((c) => c !== '_row') : []
  }

  return (
    <div className="card">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 font-semibold text-slate-800">🔀 {widget.title}</h2>
          <p className="truncate text-[11px] text-slate-400">
            {describeFlow(widget)}
            {widget.ignoreFilters && ' · unfiltered'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
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
        </div>
      </div>

      {/* A viewer-changeable breakdown: the single most useful control a
          drill tool can offer, because the interesting split is rarely the
          one anyone predicted when the page was built. */}
      {changeable.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {changeable.map(({ level, tab }, i) => (
            <div key={level.id} className="flex items-center gap-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-400">
                {i === 0 ? 'break down by' : 'then by'}
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

      {trail.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-1 rounded-lg bg-indigo-50/70 px-2 py-1 text-[11px]">
          <span className="text-[10px] uppercase tracking-wide text-indigo-400">focused</span>
          {trail.map((node, i) => (
            <span key={node.path} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={11} className="text-indigo-300" />}
              <button
                onClick={() => setFocusPath(node.path)}
                className={`max-w-[160px] truncate hover:underline ${
                  i === trail.length - 1 ? 'font-semibold text-indigo-700' : 'text-indigo-500'
                }`}
              >
                {node.label}
              </button>
            </span>
          ))}
          <button
            onClick={() => setFocusPath('')}
            className="ml-1 rounded p-0.5 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-600"
            title="Back to the whole flow"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {built.depth === 0 ? (
        <p className="py-8 text-center text-sm text-slate-300">No levels configured yet</p>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <FlowNode
            node={focused}
            root={focused}
            flow={flow}
            widget={widget}
            crossFilters={crossFilters}
            onToggle={toggle}
            onDrill={drill}
            onFocus={setFocusPath}
            isRoot
          />
        </div>
      )}

      {built.truncated && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
          Stopped after {flow.maxNodes} branches. Close a level, or focus into the branch you care about, to keep
          going deeper.
        </p>
      )}
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
  const pct = Math.max(0, Math.min(1, share || 0))
  const canOpen = node.hasChildren
  // Drilling the unfiltered root would put a chip on the page that selects
  // everything -- a filter that says nothing. Every other node narrows.
  const canDrill = !isRoot || node.conditions.length > 0

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
        {flow.showBars !== false && (
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

          {node.kind === 'hop' && (
            <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-slate-500">
              {node.tab}
            </span>
          )}
        </button>

        <div className="relative flex shrink-0 items-center gap-2">
          {flow.showDropOff !== false && !isRoot && node.dropOff > 0.001 && (
            <span className="hidden text-[10px] font-medium text-amber-600 sm:inline" title="Lost from the branch above">
              ▼{Math.round(node.dropOff * 100)}%
            </span>
          )}

          <span className="w-11 text-right text-[10px] font-semibold" style={{ color }}>
            {isRoot ? '100%' : `${(pct * 100).toFixed(pct < 0.1 ? 1 : 0)}%`}
          </span>

          <span
            className={`text-right tabular-nums ${isRoot ? 'text-base font-bold text-slate-800' : 'text-[12px] font-semibold text-slate-700'}`}
          >
            {formatNumber(node.value, flow.measure?.format || 'comma', flow.measure?.aggregation)}
          </span>

          <span className="flex items-center gap-0.5">
            {canOpen && !isRoot && (
              <button
                onClick={() => onFocus(node.path)}
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
