import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  Expand,
  Filter,
  Layers,
  Minus,
  Palette,
  Plus,
  Scan,
  Search,
  Shrink,
  TrendingDown,
  X,
} from 'lucide-react'
import { formatNumber } from '../../lib/dataUtils.js'
import { STAGE_PALETTE } from '../../lib/config.js'
import ExportButton from '../ExportButton.jsx'
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
import { FLOW_MAP_PLATES, depthOf, flowMapLayout, limitDepth, nodeKey, unaccounted } from '../../lib/flowMap.js'
import { FLOW_VIEW_SORTS, flowStats, lineagePaths, searchFlow, sortFlowRoots, zoomAbout } from '../../lib/flowView.js'

/**
 * The whole flow, on one plate.
 *
 * The Flow widget is a thing you OPEN: one number, a few branches, a click
 * for each level. That is the right shape for exploring and the wrong shape
 * for the other half of the job -- standing back and seeing the whole
 * process at once, where the volume goes and where it stops going.
 *
 * So this is the same trees, the same numbers and the same drill-throughs,
 * drawn all at once. Nothing to expand, nothing to hunt for, and it is
 * always exactly the size of the card it is in -- the layout is computed
 * from the measured box, so "fits on screen" is a property of the drawing
 * rather than something the reader has to achieve with a zoom control.
 *
 * Four plates, because which shape reads best genuinely depends on the data:
 * bands for following volume, icicle for a wide tree, treemap for comparing
 * leaves, sunburst for a deep one. All four are the same layout library
 * (lib/flowMap.js) and the same interactions, so switching is a change of
 * view and never a change of meaning.
 *
 * Everything a reader needs is on the plate: the picture, the summary that
 * says what it shows, the legend, the search, the breadcrumb and the panel
 * for one branch. Nowhere to go and nothing to open in order to understand
 * what is in front of you -- which is the whole brief.
 */
export default function FlowMapWidget({
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

  const [plate, setPlate] = useState(widget.plate || 'bands')
  const [maxDepth, setMaxDepth] = useState(null) // null = everything
  const [colorBy, setColorBy] = useState('branch')
  const [sortOrder, setSortOrder] = useState('natural')
  const [query, setQuery] = useState('')
  const [hovered, setHovered] = useState('')
  const [selected, setSelected] = useState('')
  const [focusByTree, setFocusByTree] = useState({})
  const [fullscreen, setFullscreen] = useState(false)
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })
  const [tooltip, setTooltip] = useState(null)

  const plateRef = useRef(null)
  const [box, setBox] = useState({ width: 720, height: 380 })

  // --- the trees ---------------------------------------------------------
  // Everything is opened: a plate that only drew what somebody had clicked
  // would be the tree view with worse ergonomics. `autoExpand` at the flow's
  // full depth is what "all at once" means.
  const forest = useMemo(() => {
    const built = buildFlowTrees({
      widget,
      rowsByTab: source,
      headersByTab,
      dateOrder,
      expanded: new Set(),
      collapsed: new Set(),
      autoExpand: 99,
    })
    for (const one of built.trees) {
      for (const node of flattenFlow(one.root)) node.treeId = one.tree.id
    }
    return built
  }, [widget, source, headersByTab, dateOrder])

  const fullDepth = useMemo(() => depthOf(forest.trees.map((t) => t.root)), [forest])

  const roots = useMemo(() => {
    const focused = forest.trees.map((one) => findFlowNode(one.root, focusByTree[one.tree.id] || '') || one.root)
    const sorted = sortFlowRoots(focused, sortOrder)
    return maxDepth === null ? sorted : limitDepth(sorted, maxDepth)
  }, [forest, focusByTree, sortOrder, maxDepth])

  const stats = useMemo(() => flowStats(roots), [roots])
  const matches = useMemo(() => searchFlow(roots, query), [roots, query])
  const matchKeys = useMemo(() => new Set(matches.map((m) => m.key)), [matches])
  const lineage = useMemo(() => lineagePaths(roots, hovered || selected), [roots, hovered, selected])

  // --- the plate ---------------------------------------------------------
  useLayoutEffect(() => {
    const el = plateRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const measure = () => setBox({ width: el.clientWidth || 720, height: el.clientHeight || 380 })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fullscreen])

  const layout = useMemo(
    () => flowMapLayout(plate, roots, { width: box.width, height: box.height, ...plateOptions(plate, box) }),
    [plate, roots, box]
  )

  // Colours are decided once for the whole plate, so the legend, the
  // summary and every shape agree without any of them being passed the
  // others' state.
  const palette = useMemo(() => buildPalette(roots, colorBy), [roots, colorBy])
  const colorOf = useCallback((node) => palette.get(nodeKey(node)) || '#94a3b8', [palette])

  const dimmed = useCallback(
    (key) => {
      if (query && matchKeys.size) return !matchKeys.has(key)
      return lineage ? !lineage.has(key) : false
    },
    [lineage, query, matchKeys]
  )

  const drill = useCallback(
    (node) => {
      const cf = flowCrossFilter(widget, node)
      if (cf) onCrossFilter(cf)
    },
    [widget, onCrossFilter]
  )

  const isDrilled = useCallback((node) => flowNodeIsDrilled(widget, node, crossFilters), [widget, crossFilters])

  const focusNode = useCallback((node) => {
    setFocusByTree((all) => ({ ...all, [node.treeId]: node.path }))
    setSelected('')
  }, [])

  const selectedNode = useMemo(() => {
    if (!selected) return null
    for (const root of roots) {
      const found = flattenFlow(root).find((n) => nodeKey(n) === selected)
      if (found) return found
    }
    return null
  }, [selected, roots])

  // --- full screen -------------------------------------------------------
  useEffect(() => {
    if (!fullscreen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [fullscreen])

  // --- the magnifier -----------------------------------------------------
  // The plate already fits, by construction. Zoom here is a magnifying
  // glass for a crowded corner, so it starts at 1 and Reset means 1 -- not
  // "fit", which would be a control that does nothing on a plate that is
  // already fitted.
  const zoomBy = (factor) =>
    setView((v) => zoomAbout(v, factor, box.width / 2, box.height / 2))
  const resetView = () => setView({ zoom: 1, x: 0, y: 0 })

  const drag = useRef(null)
  const startPan = (e) => {
    if (view.zoom <= 1) return
    drag.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const movePan = (e) => {
    if (!drag.current) return
    setView((v) => ({
      ...v,
      x: drag.current.ox + (e.clientX - drag.current.x),
      y: drag.current.oy + (e.clientY - drag.current.y),
    }))
  }
  const endPan = () => {
    drag.current = null
  }

  const exportRows = useCallback(
    () =>
      roots.flatMap((root) =>
        flattenFlow(root).map((node) => ({
          Level: node.level,
          Branch: node.label,
          Path: node.trail.join(' → '),
          Table: node.tab,
          Value: node.value,
          Rows: node.count,
          'Share of parent %': node.share === null ? '' : Math.round(node.share * 1000) / 10,
          'Share of total %': node.shareOfRoot === null ? '' : Math.round(node.shareOfRoot * 1000) / 10,
          'Unaccounted for': unaccounted(node),
        }))
      ),
    [roots]
  )

  const card = (
    <div className={`card ${fullscreen ? 'flex h-full flex-col overflow-hidden' : ''}`}>
      {/* --- header ---------------------------------------------------- */}
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="widget-title">🗺️ {widget.title}</h2>
          <p className="truncate text-[11px] text-slate-400">
            {describeFlow(widget)}
            {forest.multi && ` · ${forest.trees.length} trees`}
            {widget.ignoreFilters && ' · unfiltered'}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <div className="flex overflow-hidden rounded-lg border border-slate-200">
            {FLOW_MAP_PLATES.map((p) => (
              <button
                key={p.value}
                onClick={() => {
                  setPlate(p.value)
                  resetView()
                }}
                title={p.hint}
                className={`px-2 py-1 text-[10px] font-medium ${
                  plate === p.value ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {canExport && (
            <ExportButton
              name={widget.title || 'flow map'}
              rows={exportRows}
              columns={() => [
                'Level',
                'Branch',
                'Path',
                'Table',
                'Value',
                'Rows',
                'Share of parent %',
                'Share of total %',
                'Unaccounted for',
              ]}
              count={exportRows().length}
            />
          )}

          <button
            onClick={() => setFullscreen((f) => !f)}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium ${
              fullscreen ? 'border-indigo-300 bg-indigo-50 text-indigo-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
            title={fullscreen ? 'Leave full screen (Esc)' : 'Full screen'}
          >
            {fullscreen ? <Shrink size={11} /> : <Expand size={11} />}
          </button>
        </div>
      </div>

      {/* --- the summary, which is the point of "one plate" ------------- */}
      <div className="mb-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Summary label="In at the top" value={compact(roots.reduce((s, r) => s + (r.value || 0), 0))} />
        <Summary label="Branches" value={`${stats.nodes.toLocaleString('en-IN')} · ${stats.depth} deep`} />
        <Summary
          label="Biggest branch"
          value={stats.biggest ? `${stats.biggest.label} · ${compact(stats.biggest.value)}` : '—'}
          onClick={stats.biggest ? () => setSelected(nodeKey(stats.biggest)) : undefined}
        />
        <Summary
          label="Worst drop-off"
          warn
          value={stats.worstDrop ? `${stats.worstDrop.label} ▼${Math.round(stats.worstDrop.dropOff * 100)}%` : '—'}
          onClick={stats.worstDrop ? () => setSelected(nodeKey(stats.worstDrop)) : undefined}
        />
      </div>

      {/* --- controls --------------------------------------------------- */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-slate-100 py-1.5 text-[10px]">
        <label className="flex items-center gap-1" title="How many levels to draw">
          <Layers size={11} className="text-slate-400" />
          <select
            value={maxDepth === null ? 'all' : String(maxDepth)}
            onChange={(e) => setMaxDepth(e.target.value === 'all' ? null : Number(e.target.value))}
            className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-600"
            aria-label="Levels to show"
          >
            <option value="all">All {fullDepth} levels</option>
            {Array.from({ length: fullDepth }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                First {d} level{d === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1" title="What the colours mean">
          <Palette size={11} className="text-slate-400" />
          <select
            value={colorBy}
            onChange={(e) => setColorBy(e.target.value)}
            className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-600"
            aria-label="Colour by"
          >
            <option value="branch">Colour by top branch</option>
            <option value="level">Colour by level</option>
            <option value="drop">Colour by drop-off</option>
          </select>
        </label>

        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-600"
          aria-label="Order the branches"
        >
          {FLOW_VIEW_SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5">
          <Search size={11} className="text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Highlight…"
            className="w-24 bg-transparent text-[10px] outline-none placeholder:text-slate-300"
            aria-label="Highlight branches"
          />
          {query && (
            <>
              <span className="tabular-nums text-slate-400">{matches.length}</span>
              <button onClick={() => setQuery('')} className="text-slate-300 hover:text-rose-500" title="Clear">
                <X size={10} />
              </button>
            </>
          )}
        </label>

        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => zoomBy(1 / 1.25)} className="rounded border border-slate-200 p-0.5 text-slate-500 hover:bg-slate-50" title="Zoom out">
            <Minus size={11} />
          </button>
          <button onClick={resetView} className="rounded border border-slate-200 px-1.5 py-0.5 tabular-nums text-slate-500 hover:bg-slate-50" title="Back to fitted size">
            {Math.round(view.zoom * 100)}%
          </button>
          <button onClick={() => zoomBy(1.25)} className="rounded border border-slate-200 p-0.5 text-slate-500 hover:bg-slate-50" title="Zoom in">
            <Plus size={11} />
          </button>
          <button onClick={resetView} className="rounded border border-slate-200 p-0.5 text-slate-500 hover:bg-slate-50" title="Reset the view">
            <Scan size={11} />
          </button>
        </div>
      </div>

      {/* --- the way back out of a branch ------------------------------- */}
      {forest.trees.map((one) => {
        const path = focusByTree[one.tree.id] || ''
        if (!path) return null
        const trail = trailOf(one.root, path)
        return (
          <div key={one.tree.id} className="mb-2 flex flex-wrap items-center gap-1 rounded-lg bg-indigo-50/70 px-2 py-1 text-[11px]">
            <span className="text-[10px] uppercase tracking-wide text-indigo-400">focused</span>
            {trail.map((item, i) => (
              <span key={item.path} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={11} className="text-indigo-300" />}
                <button
                  onClick={() => focusNode(item)}
                  className={`max-w-[160px] truncate hover:underline ${
                    i === trail.length - 1 ? 'font-semibold text-indigo-700' : 'text-indigo-500'
                  }`}
                >
                  {item.label}
                </button>
              </span>
            ))}
            <button
              onClick={() => setFocusByTree((all) => ({ ...all, [one.tree.id]: '' }))}
              className="ml-1 rounded p-0.5 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-600"
              title="Back to the whole tree"
            >
              <X size={12} />
            </button>
          </div>
        )
      })}

      {/* --- the plate --------------------------------------------------- */}
      {forest.depth === 0 ? (
        <p className="empty-state">No levels configured yet</p>
      ) : (
        <div className={`relative ${fullscreen || fillHeight ? 'min-h-0 flex-1' : ''}`}>
          <div
            ref={plateRef}
            className="flow-canvas relative overflow-hidden rounded-xl border border-slate-200/70"
            style={{ height: fullscreen || fillHeight ? '100%' : Number(flow.diagramHeight) || 420 }}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onPointerLeave={() => {
              endPan()
              setHovered('')
              setTooltip(null)
            }}
          >
            <svg
              width={box.width}
              height={box.height}
              className="absolute left-0 top-0"
              style={{
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
                transformOrigin: '0 0',
                cursor: view.zoom > 1 ? 'grab' : 'default',
              }}
            >
              <Plate
                plate={plate}
                layout={layout}
                colorOf={colorOf}
                dimmed={dimmed}
                matched={(key) => matchKeys.has(key)}
                selected={selected}
                isDrilled={isDrilled}
                onHover={(node, event) => {
                  setHovered(node ? nodeKey(node) : '')
                  setTooltip(node ? { node, x: event.clientX, y: event.clientY } : null)
                }}
                onSelect={(node) => setSelected((s) => (s === nodeKey(node) ? '' : nodeKey(node)))}
                onFocus={focusNode}
              />
            </svg>

            {selectedNode && (
              <NodePanel
                node={selectedNode}
                color={colorOf(selectedNode)}
                drilled={isDrilled(selectedNode)}
                onClose={() => setSelected('')}
                onDrill={drill}
                onFocus={focusNode}
              />
            )}
          </div>

          {tooltip && <Tooltip node={tooltip.node} x={tooltip.x} y={tooltip.y} color={colorOf(tooltip.node)} />}
        </div>
      )}

      {/* --- legend ------------------------------------------------------ */}
      <Legend colorBy={colorBy} roots={roots} colorOf={colorOf} />
    </div>
  )

  if (!fullscreen) return card
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 p-2 backdrop-blur-sm sm:p-4">
      <div className="mx-auto h-full max-w-[1800px]">{card}</div>
    </div>
  )
}

// ---------------------------------------------------------------------
// The shapes
// ---------------------------------------------------------------------
function plateOptions(plate, box) {
  if (plate === 'sunburst') {
    const side = Math.min(box.width, box.height)
    return { width: side, height: side }
  }
  return {}
}

function Plate({ plate, layout, colorOf, dimmed, matched, selected, isDrilled, onHover, onSelect, onFocus }) {
  const common = (item) => ({
    onPointerEnter: (e) => onHover(item.node, e),
    onPointerMove: (e) => onHover(item.node, e),
    onClick: () => onSelect(item.node),
    onDoubleClick: () => (item.node.children || []).length > 0 && onFocus(item.node),
    style: { cursor: 'pointer' },
  })

  const strokeFor = (item) =>
    selected === item.key ? '#4f46e5' : isDrilled(item.node) ? '#4f46e5' : matched(item.key) ? '#f59e0b' : 'white'

  if (plate === 'sunburst') {
    return (
      <g>
        {layout.nodes.map((item) =>
          item.d ? (
            <path
              key={item.key}
              d={item.d}
              fill={colorOf(item.node)}
              fillOpacity={dimmed(item.key) ? 0.12 : 0.9}
              stroke={strokeFor(item)}
              strokeWidth={selected === item.key || matched(item.key) ? 2 : 0.6}
              {...common(item)}
            />
          ) : null
        )}
      </g>
    )
  }

  if (plate === 'bands') {
    return (
      <g>
        {/* The bands first, so the node bars sit on top of them. */}
        {layout.links.map((link) => (
          <path
            key={link.key}
            d={link.d}
            fill={colorOf(link.node)}
            fillOpacity={dimmed(nodeKey(link.node)) ? 0.05 : 0.28}
            onPointerEnter={(e) => onHover(link.node, e)}
            onPointerMove={(e) => onHover(link.node, e)}
            onClick={() => onSelect(link.node)}
            style={{ cursor: 'pointer' }}
          />
        ))}

        {/* What came in and went nowhere. Hatched, so it never reads as a
            branch -- it is the absence of one. */}
        <defs>
          <pattern id="flowmap-lost" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#fef2f2" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#fca5a5" strokeWidth="2" />
          </pattern>
        </defs>
        {layout.gaps.map((gap) => (
          <rect
            key={gap.key}
            x={gap.x}
            y={gap.y}
            width={gap.w}
            height={gap.h}
            fill="url(#flowmap-lost)"
            opacity={0.75}
          >
            <title>
              {`${gap.node.label}: ${Math.round(gap.value).toLocaleString('en-IN')} (${Math.round(
                gap.share * 100
              )}%) did not go on anywhere`}
            </title>
          </rect>
        ))}

        {layout.nodes.map((item) => (
          <g key={item.key}>
            <rect
              x={item.x}
              y={item.y}
              width={item.w}
              height={item.h}
              rx={2}
              fill={colorOf(item.node)}
              fillOpacity={dimmed(item.key) ? 0.15 : 1}
              stroke={strokeFor(item)}
              strokeWidth={selected === item.key || matched(item.key) ? 2 : 0}
              {...common(item)}
            />
            {item.h > 11 && (
              <text
                x={item.x + item.w + 4}
                y={item.y + item.h / 2 + 3.5}
                fontSize={9.5}
                fill="#475569"
                opacity={dimmed(item.key) ? 0.25 : 1}
                style={{ pointerEvents: 'none' }}
              >
                {clip(item.node.label, 22)} · {compact(item.value)}
              </text>
            )}
          </g>
        ))}
      </g>
    )
  }

  // icicle and treemap are both plain rectangles
  return (
    <g>
      {layout.nodes.map((item) => {
        const color = colorOf(item.node)
        return (
          <g key={item.key}>
            <rect
              x={item.x}
              y={item.y}
              width={Math.max(0, item.w)}
              height={Math.max(0, item.h)}
              rx={2}
              fill={color}
              fillOpacity={dimmed(item.key) ? 0.12 : 0.85}
              stroke={strokeFor(item)}
              strokeWidth={selected === item.key || matched(item.key) ? 2 : 0.75}
              {...common(item)}
            />
            {item.w > 34 && item.h > 12 && (
              <text
                x={item.x + 4}
                y={item.y + Math.min(item.h / 2 + 3.5, 11)}
                fontSize={9.5}
                fontWeight={600}
                fill={readableOn(color)}
                opacity={dimmed(item.key) ? 0.3 : 1}
                style={{ pointerEvents: 'none' }}
              >
                {clip(item.node.label, Math.floor(item.w / 6))}
              </text>
            )}
            {item.w > 34 && item.h > 26 && (
              <text
                x={item.x + 4}
                y={item.y + Math.min(item.h / 2 + 3.5, 11) + 11}
                fontSize={9}
                fill={readableOn(color)}
                opacity={dimmed(item.key) ? 0.3 : 0.8}
                style={{ pointerEvents: 'none' }}
              >
                {compact(item.value)}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

// ---------------------------------------------------------------------
// The furniture
// ---------------------------------------------------------------------
function Summary({ label, value, warn, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1 text-left ${
        onClick ? 'hover:border-indigo-300 hover:bg-indigo-50' : ''
      }`}
    >
      <p className="truncate text-[9px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`truncate text-[12px] font-semibold ${warn ? 'text-amber-600' : 'text-slate-700'}`}>{value}</p>
    </Tag>
  )
}

function Tooltip({ node, x, y, color }) {
  return (
    <div
      className="pointer-events-none fixed z-50 max-w-[260px] rounded-lg border border-slate-200 bg-white/97 px-2 py-1.5 text-[10px] shadow-lg backdrop-blur"
      style={{ left: Math.min(x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 280), top: y + 14 }}
    >
      <p className="truncate font-semibold text-slate-800" style={{ color }}>
        {node.label}
      </p>
      {node.trail.length > 0 && <p className="truncate text-slate-400">{node.trail.join(' → ')}</p>}
      <p className="mt-0.5 tabular-nums text-slate-600">
        {compact(node.value)} · {node.count.toLocaleString('en-IN')} rows
        {node.share !== null && node.share !== undefined && ` · ${Math.round(node.share * 100)}% of its parent`}
      </p>
      {node.dropOff > 0.001 && (
        <p className="text-amber-600">▼ {Math.round(node.dropOff * 100)}% lost from the branch above</p>
      )}
      {unaccounted(node) > 0 && (
        <p className="text-rose-500">{compact(unaccounted(node))} did not go on anywhere</p>
      )}
    </div>
  )
}

function NodePanel({ node, color, drilled, onClose, onDrill, onFocus }) {
  const lost = unaccounted(node)
  return (
    <div className="absolute right-2 top-2 w-56 rounded-xl border border-slate-200 bg-white/97 p-2.5 shadow-lg backdrop-blur">
      <div className="mb-1.5 flex items-start gap-1.5">
        <span className="mt-0.5 h-3 w-1 shrink-0 rounded" style={{ backgroundColor: color }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-slate-800">{node.label}</p>
          <p className="truncate text-[10px] text-slate-400" title={node.trail.join(' → ')}>
            {node.trail.length ? node.trail.join(' → ') : 'the whole table'}
          </p>
        </div>
        <button onClick={onClose} className="shrink-0 text-slate-300 hover:text-rose-500" title="Close">
          <X size={12} />
        </button>
      </div>

      <p className="text-lg font-bold tabular-nums" style={{ color }}>
        {compact(node.value)}
      </p>
      <p className="text-[10px] text-slate-500">
        {node.count.toLocaleString('en-IN')} rows
        {node.share !== null && node.share !== undefined && ` · ${Math.round(node.share * 100)}% of its parent`}
      </p>
      {node.dropOff > 0.001 && (
        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-600">
          <TrendingDown size={10} /> {Math.round(node.dropOff * 100)}% lost from above
        </p>
      )}
      {lost > 0 && (
        <p className="mt-0.5 text-[10px] text-rose-500">{compact(lost)} of this goes nowhere below</p>
      )}

      {node.metrics.length > 0 && (
        <div className="mt-1.5 space-y-0.5 border-t border-slate-100 pt-1.5">
          {node.metrics.map((m) => (
            <p key={m.id || m.label} className="flex items-baseline justify-between gap-2 text-[10px]">
              <span className="truncate text-slate-500">{m.label}</span>
              <strong className="shrink-0 tabular-nums text-slate-700">
                {formatNumber(m.value, m.format, m.aggregation)}
              </strong>
            </p>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        {(node.children || []).length > 0 && node.level > 0 && (
          <button
            onClick={() => onFocus(node)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-50"
          >
            <Expand size={10} /> Only this
          </button>
        )}
        {flowNodeCanDrill(node) && (
          <button
            onClick={() => onDrill(node)}
            className={`inline-flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[10px] font-medium ${
              drilled ? 'border-indigo-300 bg-indigo-50 text-indigo-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            <Filter size={10} /> {drilled ? 'Filtering' : 'Filter page'}
          </button>
        )}
      </div>
    </div>
  )
}

function Legend({ colorBy, roots, colorOf }) {
  const items = useMemo(() => {
    if (colorBy === 'drop') {
      return [
        { label: 'held on to it', color: DROP_SCALE[0] },
        { label: 'lost some', color: DROP_SCALE[2] },
        { label: 'lost most of it', color: DROP_SCALE[4] },
      ]
    }
    if (colorBy === 'level') {
      const deepest = Math.max(0, ...roots.flatMap((r) => flattenFlow(r).map((n) => n.level)))
      return Array.from({ length: deepest + 1 }, (_, i) => ({
        label: `Level ${i}`,
        color: STAGE_PALETTE[i % STAGE_PALETTE.length],
      }))
    }
    const top = roots.flatMap((r) => r.children || []).slice(0, 10)
    return top.map((n) => ({ label: n.label, color: colorOf(n) }))
  }, [colorBy, roots, colorOf])

  if (items.length === 0) return null

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-slate-500">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: item.color }} />
          <span className="max-w-[120px] truncate">{item.label}</span>
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------
// Red to green, worst to best. Drop-off is the one thing on this plate
// where a colour scale means something ordered.
const DROP_SCALE = ['#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444']

/**
 * One colour per node, decided once for the whole plate.
 *
 * "By top branch" is the default because it is the one that makes a flow
 * legible: every descendant of Pune is a shade of Pune's colour, so a path
 * can be followed across four levels without reading a single label.
 */
function buildPalette(roots, mode) {
  const out = new Map()
  const branchColor = new Map()
  let branchIndex = 0

  const walk = (node, inherited) => {
    let color
    if (mode === 'level') {
      color = STAGE_PALETTE[(node.level || 0) % STAGE_PALETTE.length]
    } else if (mode === 'drop') {
      const drop = Math.max(0, Math.min(1, node.dropOff || 0))
      color = DROP_SCALE[Math.min(DROP_SCALE.length - 1, Math.floor(drop * DROP_SCALE.length))]
    } else if (node.level === 0) {
      color = '#64748b'
    } else if (node.level === 1) {
      if (!branchColor.has(node.label)) {
        branchColor.set(node.label, STAGE_PALETTE[branchIndex % STAGE_PALETTE.length])
        branchIndex += 1
      }
      color = branchColor.get(node.label)
    } else {
      color = inherited
    }

    out.set(nodeKey(node), color)
    for (const child of node.children || []) walk(child, color)
  }

  for (const root of roots || []) walk(root, '#64748b')
  return out
}

/** Black or white, whichever can actually be read on this fill. */
function readableOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return '#0f172a'
  const n = parseInt(m[1], 16)
  // Rec. 601 luma, which is what everyone means by "is this dark".
  const luma = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return luma > 0.6 ? '#0f172a' : '#ffffff'
}

const clip = (text, max) => {
  const s = String(text ?? '')
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s
}

function compact(n) {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1000)
    return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
  return String(Math.round(v * 10) / 10)
}

function trailOf(root, path) {
  const out = [root]
  let walk = ''
  for (const part of path.split('/').slice(1)) {
    walk += `/${part}`
    const found = findFlowNode(root, walk)
    if (!found) break
    out.push(found)
  }
  return out
}
