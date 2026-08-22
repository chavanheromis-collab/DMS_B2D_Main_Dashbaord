import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Filter, Maximize2, Minus, Move, Plus, Scan } from 'lucide-react'
import { formatNumber } from '../../lib/dataUtils.js'
import { STAGE_PALETTE } from '../../lib/config.js'
import { flowNodeCanDrill } from '../../lib/flow.js'
import { fitToViewport, layoutFlow } from '../../lib/flowLayout.js'

/**
 * The flow as a diagram.
 *
 * Same tree, same numbers, same clicks as the indented view -- what changes
 * is what you can see at a glance: shape. Where a branch splits four ways
 * and three of them are hairlines, that is visible before you have read
 * anything, because the edge carries the volume.
 *
 * Nodes are HTML on top of an SVG edge layer rather than SVG throughout.
 * Text in SVG cannot wrap, truncate, or inherit the card's theme, and every
 * hover control would have to be hand-drawn; laying real elements over the
 * lines costs one absolutely positioned div per node and buys all of it.
 */
export default function FlowDiagram({ root, flow, orientation, height = 420, isDrilled, onToggle, onDrill, onFocus }) {
  const viewportRef = useRef(null)
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const drag = useRef(null)
  // Whether the reader has moved the view themselves. Auto-fitting is right
  // until they have -- after that, throwing away their pan every time they
  // open a branch is the single most annoying thing a canvas can do.
  const touched = useRef(false)

  const layout = useMemo(() => layoutFlow(root, { orientation }), [root, orientation])

  const fit = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    touched.current = false
    setView(fitToViewport(layout, { width: el.clientWidth, height: el.clientHeight }))
  }, [layout])

  // Fit whenever the shape changes -- opening a branch that lands off-screen
  // and leaves the reader hunting for it is the fastest way to make a
  // diagram feel broken. Unless they have taken the wheel, in which case
  // where they are looking is their decision, and Fit is one click away.
  useLayoutEffect(() => {
    if (!touched.current) fit()
  }, [fit])

  // A card that changes width mid-read has to re-fit regardless.
  useEffect(() => {
    const el = viewportRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => fit())
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])

  // A change of direction is a new picture, so it starts framed again.
  useEffect(() => {
    touched.current = false
  }, [orientation])

  function startPan(e) {
    // Only a drag on the canvas itself pans; a drag that starts on a card is
    // the browser's business (text selection, a click on a button).
    if (e.target.closest('[data-flow-node]')) return
    drag.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y }
    touched.current = true
    setDragging(true)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  function movePan(e) {
    if (!drag.current) return
    setView((v) => ({ ...v, x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) }))
  }

  function endPan() {
    drag.current = null
    setDragging(false)
  }

  const zoomBy = (factor) => {
    touched.current = true
    setView((v) => ({ ...v, zoom: Math.max(0.25, Math.min(2, Number((v.zoom * factor).toFixed(3)))) }))
  }

  return (
    <div className="relative">
      <div
        ref={viewportRef}
        className={`flow-canvas relative overflow-hidden rounded-xl border border-slate-200/70 ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        style={{ height }}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerLeave={endPan}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
            width: layout.width,
            height: layout.height,
          }}
        >
          <svg
            width={layout.width}
            height={layout.height}
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
          >
            {layout.edges.map((edge) => {
              const color = nodeColor(edge.node)
              return (
                <g key={edge.id}>
                  <path
                    d={edge.d}
                    fill="none"
                    stroke={color}
                    strokeOpacity={0.35}
                    strokeWidth={edge.width}
                    strokeLinecap="round"
                  />
                  {/* The count on the edge, the way a process map reads: how
                      many came THIS way, not just how many ended up here. */}
                  <g transform={`translate(${edge.mx}, ${edge.my})`}>
                    <rect x={-19} y={-8} width={38} height={16} rx={8} fill="white" fillOpacity={0.92} />
                    <text
                      x={0}
                      y={4}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={600}
                      fill={color}
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {shortNumber(edge.node.value)}
                    </text>
                  </g>
                </g>
              )
            })}
          </svg>

          {layout.nodes.map(({ node, x, y, w, h }) => (
            <FlowCard
              key={node.path}
              node={node}
              style={{ left: x, top: y, width: w, height: h }}
              flow={flow}
              drilled={isDrilled(node)}
              onToggle={onToggle}
              onDrill={onDrill}
              onFocus={onFocus}
            />
          ))}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-2">
          <span className="pointer-events-none flex items-center gap-1 rounded-lg bg-white/80 px-1.5 py-1 text-[9px] text-slate-400 backdrop-blur">
            <Move size={10} /> drag to pan
          </span>
          <div className="pointer-events-auto flex flex-col gap-1">
            <button onClick={fit} className="flow-tool" title="Fit to view">
              <Scan size={13} />
            </button>
            <button onClick={() => zoomBy(1.2)} className="flow-tool" title="Zoom in">
              <Plus size={13} />
            </button>
            <button onClick={() => zoomBy(1 / 1.2)} className="flow-tool" title="Zoom out">
              <Minus size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function nodeColor(node) {
  return node.color || STAGE_PALETTE[node.level % STAGE_PALETTE.length] || '#4F46E5'
}

/** 1,284 -> 1.3K, so an edge label never outgrows its pill. */
function shortNumber(n) {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1000) return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
  return String(Math.round(v * 10) / 10)
}

function FlowCard({ node, style, flow, drilled, onToggle, onDrill, onFocus }) {
  const color = nodeColor(node)
  const share = flow.percentBase === 'root' ? node.shareOfRoot : node.share
  const hasShare = share !== null && share !== undefined
  const pct = Math.max(0, Math.min(1, share || 0))
  const isRoot = node.level === 0
  const canOpen = node.hasChildren
  const canDrill = flowNodeCanDrill(node)

  return (
    <div
      data-flow-node
      className={`group absolute overflow-hidden rounded-xl border bg-white/95 shadow-sm backdrop-blur transition-all hover:shadow-md ${
        drilled ? 'border-transparent ring-2 ring-offset-1' : 'border-slate-200/80'
      }`}
      style={{ ...style, ...(drilled ? { '--tw-ring-color': color } : {}) }}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: color }} />
      {/* The share, as a wash across the card -- the same encoding the edge
          uses, so the two agree without a legend. */}
      {flow.showBars !== false && hasShare && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 transition-all duration-500"
          style={{ width: `${pct * 100}%`, backgroundColor: `${color}12` }}
        />
      )}

      <button
        onClick={() => (canOpen ? onToggle(node) : canDrill && onDrill(node))}
        className="relative flex h-full w-full flex-col justify-center gap-0.5 px-2 pl-3 text-left"
        title={canOpen ? (node.open ? 'Close this branch' : 'Open this branch') : 'Filter the page to these rows'}
      >
        <div className="flex items-center gap-1.5">
          <span
            className="flex h-5 shrink-0 items-center rounded-full px-1.5 text-[10px] font-bold tabular-nums text-white"
            style={{ backgroundColor: color }}
          >
            {shortNumber(node.value)}
          </span>
          {node.icon && <span className="shrink-0 text-xs leading-none">{node.icon}</span>}
          <span
            className={`truncate text-[11px] ${isRoot ? 'font-bold text-slate-800' : 'font-medium text-slate-700'} ${
              node.kind === 'blank' || node.kind === 'other' || node.kind === 'else' ? 'italic text-slate-400' : ''
            }`}
          >
            {node.label}
          </span>
          {canOpen && (
            <span className="ml-auto shrink-0 text-slate-300">
              {node.open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-[9px]">
          {node.kind === 'hop' || node.kind === 'table' ? (
            <span className="truncate rounded bg-slate-100 px-1 py-px font-medium uppercase tracking-wide text-slate-500">
              {node.tab}
            </span>
          ) : (
            <span className="font-semibold tabular-nums" style={{ color }}>
              {isRoot ? '100%' : hasShare ? `${(pct * 100).toFixed(pct < 0.1 ? 1 : 0)}%` : '—'}
            </span>
          )}
          {flow.showDropOff !== false && !isRoot && hasShare && node.dropOff > 0.001 && (
            <span className="text-amber-600" title="Lost from the branch above">
              ▼{Math.round(node.dropOff * 100)}%
            </span>
          )}
          <span className="truncate text-slate-400">{node.count.toLocaleString('en-IN')} rows</span>
        </div>

        {node.metrics.length > 0 && (
          <div className="flex gap-1 overflow-hidden">
            {node.metrics.slice(0, 3).map((m) => (
              <span
                key={m.id || m.label}
                className="truncate rounded bg-slate-100/90 px-1 py-px text-[9px] text-slate-500"
                title={`${m.label}: ${formatNumber(m.value, m.format, m.aggregation)}`}
              >
                {m.label} <strong className="font-semibold text-slate-700">{formatNumber(m.value, m.format, m.aggregation)}</strong>
              </span>
            ))}
          </div>
        )}
      </button>

      <span className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {canOpen && !isRoot && (
          <button
            onClick={() => onFocus(node.path)}
            className="rounded bg-white/90 p-1 text-slate-400 shadow-sm hover:text-indigo-600"
            title={`Zoom into ${node.label}`}
          >
            <Maximize2 size={10} />
          </button>
        )}
        {canDrill && (
          <button
            onClick={() => onDrill(node)}
            className={`rounded bg-white/90 p-1 shadow-sm hover:text-indigo-600 ${
              drilled ? 'text-indigo-600' : 'text-slate-400'
            }`}
            title={drilled ? 'Remove this filter from the page' : 'Filter the whole page to these rows'}
          >
            <Filter size={10} />
          </button>
        )}
      </span>
    </div>
  )
}
