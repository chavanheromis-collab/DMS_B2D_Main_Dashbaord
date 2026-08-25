import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Crosshair,
  Expand,
  Filter,
  Info,
  Map as MapIcon,
  Maximize2,
  Minus,
  Move,
  Plus,
  Scan,
  Search,
  Shrink,
  Tag,
  X,
} from 'lucide-react'
import { formatNumber } from '../../lib/dataUtils.js'
import { STAGE_PALETTE } from '../../lib/config.js'
import { flowNodeCanDrill } from '../../lib/flow.js'
import { fitToViewport, layoutForest } from '../../lib/flowLayout.js'
import FlowPeek from './FlowPeek.jsx'
import {
  ZOOM_STEP,
  centreOn,
  flowKeyAction,
  lineagePaths,
  minimapGeometry,
  minimapJump,
  searchFlow,
  stepMatch,
  zoomAbout,
} from '../../lib/flowView.js'

/**
 * The flow as a diagram you can actually analyse.
 *
 * Same trees, same numbers, same clicks as the indented view -- what changes
 * is what you can see at a glance: shape. Where a branch splits four ways
 * and three of them are hairlines, that is visible before you have read
 * anything, because the edge carries the volume.
 *
 * Four things turn a picture into an instrument, and all four are here:
 *
 *   FIND IT. A canvas of three hundred nodes is a haystack. Search matches
 *   a branch by its own name or by the path that led to it, counts the
 *   hits, and walks between them -- each one centred, not merely coloured.
 *
 *   FOLLOW IT. Hovering a node lights its whole lineage, up to the root and
 *   down through everything it became, and quiets the rest. Tracing one
 *   path through a wide fan is otherwise squinting.
 *
 *   KNOW WHERE YOU ARE. A minimap, because zoomed into the third level of a
 *   five-level tree you have no idea which part of it you are looking at,
 *   and scrolling around to find out loses your place.
 *
 *   ASK ABOUT ONE. Selecting a node opens a panel with its full path, its
 *   arithmetic and its metrics -- a 178px card cannot hold that, and
 *   shrinking the type until it does helps nobody.
 *
 * Nodes are HTML on top of an SVG edge layer rather than SVG throughout.
 * Text in SVG cannot wrap, truncate, or inherit the card's theme, and every
 * hover control would have to be hand-drawn; laying real elements over the
 * lines costs one absolutely positioned div per node and buys all of it.
 */
export default function FlowDiagram({
  roots,
  flow,
  orientation,
  height = 420,
  isDrilled,
  onToggle,
  onDrill,
  onFocus,
  fullscreen,
  onToggleFullscreen,
}) {
  const viewportRef = useRef(null)
  const searchRef = useRef(null)
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const drag = useRef(null)
  // Whether the reader has moved the view themselves. Auto-fitting is right
  // until they have -- after that, throwing away their pan every time they
  // open a branch is the single most annoying thing a canvas can do.
  const touched = useRef(false)

  const [query, setQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(-1)
  const [hovered, setHovered] = useState('')
  const [selected, setSelected] = useState('')
  const [showMap, setShowMap] = useState(true)
  const [showEdgeLabels, setShowEdgeLabels] = useState(true)

  // --- the peek ----------------------------------------------------------
  // Hovering a branch opens a magnified window over it. Deliberately on a
  // short delay: a window that appeared the instant the cursor crossed a
  // card would flash open and shut all the way across the canvas.
  const [peek, setPeek] = useState(null)
  const openTimer = useRef(null)
  const closeTimer = useRef(null)

  const openPeek = useCallback((node, element) => {
    clearTimeout(closeTimer.current)
    clearTimeout(openTimer.current)
    const rect = element?.getBoundingClientRect?.()
    if (!rect) return
    openTimer.current = setTimeout(
      () => setPeek({ node, anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } }),
      180
    )
  }, [])

  // Leaving is on a grace period, because the gap between the card and the
  // window is a place the cursor has to pass through.
  const leavePeek = useCallback(() => {
    clearTimeout(openTimer.current)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setPeek(null), 220)
  }, [])

  const stayPeek = useCallback(() => clearTimeout(closeTimer.current), [])

  const closePeek = useCallback(() => {
    clearTimeout(openTimer.current)
    clearTimeout(closeTimer.current)
    setPeek(null)
  }, [])

  useEffect(() => () => {
    clearTimeout(openTimer.current)
    clearTimeout(closeTimer.current)
  }, [])

  const layout = useMemo(() => layoutForest(roots, { orientation }), [roots, orientation])

  const boxes = useMemo(() => {
    const map = new Map()
    for (const box of layout.nodes) map.set(`${box.node.treeId || ''}${box.node.path}`, box)
    return map
  }, [layout])

  const viewportSize = () => {
    const el = viewportRef.current
    return { width: el?.clientWidth || 0, height: el?.clientHeight || 0 }
  }

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

  // A card that changes size mid-read -- including going fullscreen -- has
  // to re-frame regardless.
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
  }, [orientation, fullscreen])

  const zoomAt = useCallback(
    (factor, px, py) => {
      touched.current = true
      closePeek()
      setView((v) => zoomAbout(v, factor, px, py))
    },
    [closePeek]
  )

  const zoomBy = useCallback(
    (factor) => {
      const { width, height: h } = viewportSize()
      zoomAt(factor, width / 2, h / 2)
    },
    [zoomAt]
  )

  /** 100%: the size the diagram was drawn at, which fit may have shrunk. */
  const actualSize = useCallback(() => {
    touched.current = true
    setView((v) => {
      const { width, height: h } = viewportSize()
      const cx = (width / 2 - v.x) / v.zoom
      const cy = (h / 2 - v.y) / v.zoom
      return { zoom: 1, x: width / 2 - cx, y: h / 2 - cy }
    })
  }, [])

  /** Put one node in the middle, at a readable zoom. */
  const goTo = useCallback(
    (key, { zoom } = {}) => {
      const box = boxes.get(key)
      if (!box) return
      touched.current = true
      setView((v) => centreOn(box, viewportSize(), zoom ?? Math.max(v.zoom, 0.85)) || v)
    },
    [boxes]
  )

  // --- search ------------------------------------------------------------
  const matches = useMemo(() => searchFlow(roots, query), [roots, query])

  useEffect(() => {
    setMatchIndex(matches.length ? 0 : -1)
  }, [matches])

  // Centring on the current match rather than only tinting it: a hit you
  // cannot see is not a search result.
  useEffect(() => {
    if (matchIndex < 0 || !matches[matchIndex]) return
    goTo(matches[matchIndex].key)
  }, [matchIndex, matches, goTo])

  const matchKeys = useMemo(() => new Set(matches.map((m) => m.key)), [matches])
  const currentKey = matchIndex >= 0 ? matches[matchIndex]?.key : ''

  const stepTo = (delta) => setMatchIndex((i) => stepMatch(matches.length, i, delta))

  // --- what is lit -------------------------------------------------------
  const lineage = useMemo(() => lineagePaths(roots, hovered || selected), [roots, hovered, selected])
  const dimmed = (key) => (lineage ? !lineage.has(key) : false)

  const selectedNode = useMemo(() => {
    if (!selected) return null
    return layout.nodes.find((b) => `${b.node.treeId || ''}${b.node.path}` === selected)?.node || null
  }, [selected, layout])

  // Wheel zoom, but only when it cannot be mistaken for scrolling the page.
  // Hijacking a plain wheel inside a dashboard traps the reader in a widget
  // they were trying to scroll past; ctrl/⌘+wheel is the browser's own
  // zoom gesture, and in fullscreen there is nothing behind to scroll.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return undefined
    const onWheel = (e) => {
      if (!fullscreen && !e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt, fullscreen])

  function onKeyDown(e) {
    // Inside the search box the keyboard belongs to the search box.
    if (e.target instanceof HTMLInputElement) {
      if (e.key === 'Escape') {
        setQuery('')
        e.currentTarget.focus?.()
      }
      if (e.key === 'Enter') stepTo(e.shiftKey ? -1 : 1)
      return
    }

    const action = flowKeyAction(e.key, { ctrl: e.ctrlKey || e.metaKey })
    if (!action) return
    e.preventDefault()

    switch (action.type) {
      case 'zoom':
        zoomBy(action.factor)
        break
      case 'fit':
        fit()
        break
      case 'actual':
        actualSize()
        break
      case 'fullscreen':
        onToggleFullscreen?.()
        break
      case 'search':
        searchRef.current?.focus()
        break
      case 'clear':
        setSelected('')
        setQuery('')
        break
      case 'pan':
        touched.current = true
        setView((v) => ({ ...v, x: v.x + action.dx, y: v.y + action.dy }))
        break
      default:
        break
    }
  }

  function startPan(e) {
    // Only a drag on the canvas itself pans; a drag that starts on a card is
    // the browser's business (text selection, a click on a button).
    if (e.target.closest('[data-flow-node]') || e.target.closest('[data-flow-ui]')) return
    // The peek is anchored to a screen rectangle, which panning invalidates.
    closePeek()
    drag.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y, moved: false }
    touched.current = true
    setDragging(true)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  function movePan(e) {
    if (!drag.current) return
    drag.current.moved = true
    setView((v) => ({
      ...v,
      x: drag.current.ox + (e.clientX - drag.current.x),
      y: drag.current.oy + (e.clientY - drag.current.y),
    }))
  }

  function endPan() {
    // A click on empty canvas clears the selection; a drag does not.
    if (drag.current && !drag.current.moved) setSelected('')
    drag.current = null
    setDragging(false)
  }

  const minimap = useMemo(
    () => (showMap ? minimapGeometry(layout, view, viewportSize()) : null),
    // The viewport size is read imperatively, so this has to re-run whenever
    // anything that could have changed it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showMap, layout, view, fullscreen, height]
  )

  return (
    // h-full so a fullscreen parent can hand the canvas a percentage height;
    // with an auto-height parent it resolves to auto and changes nothing.
    <div className="relative h-full">
      <div
        ref={viewportRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className={`flow-canvas relative overflow-hidden rounded-xl border border-slate-200/70 outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
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
            {/* One plate per tree, so a canvas holding three of them reads as
                three things rather than one tangle. */}
            {(layout.bands || []).map((band, i) => (
              <rect
                key={i}
                x={band.x + 4}
                y={band.y + 4}
                width={Math.max(0, band.width - 8)}
                height={Math.max(0, band.height - 8)}
                rx={14}
                fill="rgba(99,102,241,0.03)"
                stroke="rgba(99,102,241,0.18)"
                strokeDasharray="4 4"
              />
            ))}

            {layout.edges.map((edge) => {
              const color = nodeColor(edge.node)
              const key = `${edge.node.treeId || ''}${edge.to}`
              const off = dimmed(key)
              return (
                <g key={`${edge.node.treeId || ''}${edge.id}`} opacity={off ? 0.12 : 1}>
                  <path
                    d={edge.d}
                    fill="none"
                    stroke={color}
                    strokeOpacity={lineage && !off ? 0.7 : 0.35}
                    strokeWidth={edge.width}
                    strokeLinecap="round"
                  />
                  {/* The count on the edge, the way a process map reads: how
                      many came THIS way, not just how many ended up here. */}
                  {showEdgeLabels && (
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
                  )}
                </g>
              )
            })}
          </svg>

          {layout.nodes.map(({ node, x, y, w, h }) => {
            const key = `${node.treeId || ''}${node.path}`
            return (
              <FlowCard
                key={key}
                node={node}
                style={{ left: x, top: y, width: w, height: h }}
                flow={flow}
                drilled={isDrilled(node)}
                dimmed={dimmed(key)}
                matched={matchKeys.has(key)}
                current={currentKey === key}
                selected={selected === key}
                onHover={setHovered}
                onPeek={openPeek}
                onPeekLeave={leavePeek}
                onSelect={setSelected}
                onToggle={onToggle}
                onDrill={onDrill}
                onFocus={onFocus}
              />
            )
          })}
        </div>

        {/* --- the instrument panel ------------------------------------- */}
        <div data-flow-ui className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 p-2">
          <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 px-1.5 py-1 shadow-sm backdrop-blur">
            <Search size={12} className="shrink-0 text-slate-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a branch…  /"
              className="w-32 bg-transparent text-[11px] outline-none placeholder:text-slate-300 sm:w-44"
              aria-label="Find a branch"
            />
            {query && (
              <>
                <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
                  {matches.length ? `${matchIndex + 1}/${matches.length}` : 'none'}
                </span>
                <button
                  onClick={() => stepTo(-1)}
                  disabled={!matches.length}
                  className="rounded p-0.5 text-slate-400 hover:text-indigo-600 disabled:opacity-30"
                  title="Previous match (shift+Enter)"
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  onClick={() => stepTo(1)}
                  disabled={!matches.length}
                  className="rounded p-0.5 text-slate-400 hover:text-indigo-600 disabled:opacity-30"
                  title="Next match (Enter)"
                >
                  <ChevronDown size={12} />
                </button>
                <button onClick={() => setQuery('')} className="rounded p-0.5 text-slate-300 hover:text-rose-500" title="Clear">
                  <X size={12} />
                </button>
              </>
            )}
          </div>

          <div className="pointer-events-auto ml-auto flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 px-1 py-1 shadow-sm backdrop-blur">
            <button
              onClick={() => setShowEdgeLabels((s) => !s)}
              className={`rounded p-1 ${showEdgeLabels ? 'text-indigo-600' : 'text-slate-300'} hover:bg-slate-50`}
              title={showEdgeLabels ? 'Hide the number on each line' : 'Show the number on each line'}
            >
              <Tag size={12} />
            </button>
            <button
              onClick={() => setShowMap((s) => !s)}
              className={`rounded p-1 ${showMap ? 'text-indigo-600' : 'text-slate-300'} hover:bg-slate-50`}
              title={showMap ? 'Hide the minimap' : 'Show the minimap'}
            >
              <MapIcon size={12} />
            </button>
            {onToggleFullscreen && (
              <button
                onClick={onToggleFullscreen}
                className="rounded p-1 text-slate-400 hover:bg-slate-50 hover:text-indigo-600"
                title={fullscreen ? 'Leave full screen (Esc)' : 'Full screen (F)'}
              >
                {fullscreen ? <Shrink size={12} /> : <Expand size={12} />}
              </button>
            )}
          </div>
        </div>

        {peek && (
          <FlowPeek
            node={peek.node}
            anchor={peek.anchor}
            onClose={closePeek}
            onStay={stayPeek}
            onLeave={leavePeek}
            onFocus={onFocus}
            onDrill={onDrill}
            isDrilled={isDrilled}
          />
        )}

        {/* --- the node panel ------------------------------------------- */}
        {selectedNode && (
          <NodePanel
            node={selectedNode}
            flow={flow}
            drilled={isDrilled(selectedNode)}
            onClose={() => setSelected('')}
            onToggle={onToggle}
            onDrill={onDrill}
            onFocus={onFocus}
            onCentre={() => goTo(selected, { zoom: 1 })}
          />
        )}

        <div data-flow-ui className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2">
          <div className="flex items-end gap-2">
            <span className="hidden items-center gap-1 rounded-lg bg-white/80 px-1.5 py-1 text-[9px] text-slate-400 backdrop-blur sm:flex">
              <Move size={10} /> drag to pan · {fullscreen ? 'scroll' : '⌘/ctrl + scroll'} to zoom · click a node for
              detail · double-click to zoom in
            </span>
            {minimap && (
              <div
                className="pointer-events-auto relative shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white/90 shadow-sm backdrop-blur"
                style={{ width: minimap.width, height: minimap.height }}
                onPointerDown={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  touched.current = true
                  setView(
                    minimapJump(layout, viewportSize(), view, {
                      x: e.clientX - rect.left,
                      y: e.clientY - rect.top,
                    })
                  )
                }}
                title="Click to jump there"
              >
                {layout.nodes.map(({ node, x, y, w, h }) => (
                  <span
                    key={`${node.treeId || ''}${node.path}`}
                    className="absolute rounded-[1px]"
                    style={{
                      left: x * minimap.scale,
                      top: y * minimap.scale,
                      width: Math.max(1, w * minimap.scale),
                      height: Math.max(1, h * minimap.scale),
                      backgroundColor: nodeColor(node),
                      opacity: dimmed(`${node.treeId || ''}${node.path}`) ? 0.15 : 0.55,
                    }}
                  />
                ))}
                <span
                  className="pointer-events-none absolute rounded-sm border-2 border-indigo-500/70 bg-indigo-500/10"
                  style={{
                    left: minimap.rect.x,
                    top: minimap.rect.y,
                    width: minimap.rect.width,
                    height: minimap.rect.height,
                  }}
                />
              </div>
            )}
          </div>

          <div className="pointer-events-auto flex flex-col items-end gap-1">
            <button
              onClick={actualSize}
              className="flow-tool w-auto px-1.5 text-[10px] font-semibold tabular-nums"
              title="Back to 100% (1)"
            >
              {Math.round(view.zoom * 100)}%
            </button>
            <button onClick={fit} className="flow-tool" title="Fit to view (0)">
              <Scan size={13} />
            </button>
            <button onClick={() => zoomBy(ZOOM_STEP)} className="flow-tool" title="Zoom in (+)">
              <Plus size={13} />
            </button>
            <button onClick={() => zoomBy(1 / ZOOM_STEP)} className="flow-tool" title="Zoom out (−)">
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
  if (Math.abs(v) >= 1000)
    return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
  return String(Math.round(v * 10) / 10)
}

/**
 * Everything about one branch, at a size you can read.
 *
 * A 178px card holds a name, a number and a percentage. The full path, the
 * arithmetic behind the share, the drop-off and four metrics do not fit,
 * and shrinking the type until they do helps nobody -- so selecting a node
 * opens this instead.
 */
function NodePanel({ node, flow, drilled, onClose, onToggle, onDrill, onFocus, onCentre }) {
  const color = nodeColor(node)
  const share = flow.percentBase === 'root' ? node.shareOfRoot : node.share
  const canDrill = flowNodeCanDrill(node)

  return (
    <div
      data-flow-ui
      className="pointer-events-auto absolute right-2 top-12 w-60 rounded-xl border border-slate-200 bg-white/97 p-2.5 shadow-lg backdrop-blur"
    >
      <div className="mb-1.5 flex items-start gap-1.5">
        <span className="mt-0.5 h-3 w-1 shrink-0 rounded" style={{ backgroundColor: color }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-slate-800" title={node.label}>
            {node.icon} {node.label}
          </p>
          <p className="truncate text-[10px] text-slate-400" title={node.trail.join(' → ')}>
            {node.trail.length ? node.trail.join(' → ') : 'the whole table'}
          </p>
        </div>
        <button onClick={onClose} className="shrink-0 text-slate-300 hover:text-rose-500" title="Close">
          <X size={12} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1 text-[10px]">
        <Stat label="Value" value={shortNumber(node.value)} strong color={color} />
        <Stat label="Rows" value={node.count.toLocaleString('en-IN')} />
        <Stat
          label={flow.percentBase === 'root' ? 'Of the total' : 'Of its parent'}
          value={share === null || share === undefined ? '—' : `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`}
        />
        <Stat
          label="Lost from above"
          value={node.level === 0 || !node.dropOff ? '—' : `${Math.round(node.dropOff * 100)}%`}
          warn={node.dropOff > 0.5}
        />
      </div>

      {node.tab && (
        <p className="mt-1.5 truncate rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500" title={node.tab}>
          {node.tab}
        </p>
      )}

      {node.metrics.length > 0 && (
        <div className="mt-1.5 space-y-0.5 border-t border-slate-100 pt-1.5">
          {node.metrics.map((m) => (
            <p key={m.id || m.label} className="flex items-baseline justify-between gap-2 text-[10px]">
              <span className="truncate text-slate-500">{m.label}</span>
              <strong className="shrink-0 font-semibold tabular-nums text-slate-700">
                {formatNumber(m.value, m.format, m.aggregation)}
              </strong>
            </p>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        {node.hasChildren && (
          <PanelButton onClick={() => onToggle(node)}>
            {node.open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            {node.open ? 'Close' : 'Open'}
          </PanelButton>
        )}
        {node.hasChildren && node.level > 0 && (
          <PanelButton onClick={() => onFocus(node)}>
            <Maximize2 size={10} /> Zoom in
          </PanelButton>
        )}
        <PanelButton onClick={onCentre}>
          <Crosshair size={10} /> Centre
        </PanelButton>
        {canDrill && (
          <PanelButton onClick={() => onDrill(node)} active={drilled}>
            <Filter size={10} /> {drilled ? 'Filtering' : 'Filter page'}
          </PanelButton>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, strong, warn, color }) {
  return (
    <div className="rounded bg-slate-50 px-1.5 py-1">
      <p className="truncate text-[9px] uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={`truncate font-semibold tabular-nums ${warn ? 'text-amber-600' : 'text-slate-700'} ${
          strong ? 'text-[13px]' : 'text-[11px]'
        }`}
        style={strong && color ? { color } : undefined}
      >
        {value}
      </p>
    </div>
  )
}

function PanelButton({ children, onClick, active }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[10px] font-medium ${
        active
          ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
          : 'border-slate-200 text-slate-500 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  )
}

function FlowCard({
  node,
  style,
  flow,
  drilled,
  dimmed,
  matched,
  current,
  selected,
  onHover,
  onPeek,
  onPeekLeave,
  onSelect,
  onToggle,
  onDrill,
  onFocus,
}) {
  const color = nodeColor(node)
  const share = flow.percentBase === 'root' ? node.shareOfRoot : node.share
  const hasShare = share !== null && share !== undefined
  const pct = Math.max(0, Math.min(1, share || 0))
  const isRoot = node.level === 0
  const canOpen = node.hasChildren
  const canDrill = flowNodeCanDrill(node)
  const key = `${node.treeId || ''}${node.path}`

  return (
    <div
      data-flow-node
      onPointerEnter={(e) => {
        onHover(key)
        onPeek(node, e.currentTarget)
      }}
      onPointerLeave={() => {
        onHover('')
        onPeekLeave()
      }}
      className={`group absolute overflow-hidden rounded-xl border bg-white/95 shadow-sm backdrop-blur transition-all hover:shadow-md ${
        drilled || selected || current ? 'border-transparent ring-2 ring-offset-1' : 'border-slate-200/80'
      } ${matched && !current ? 'ring-1 ring-amber-400' : ''}`}
      style={{
        ...style,
        opacity: dimmed ? 0.22 : 1,
        ...(drilled || selected || current
          ? { '--tw-ring-color': current ? '#f59e0b' : selected ? '#6366f1' : color }
          : {}),
      }}
      // Zooming into a branch is the deepest thing you can want from a node,
      // so it gets the gesture that costs nothing to discover.
      onDoubleClick={() => canOpen && !isRoot && onFocus(node)}
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
                {m.label}{' '}
                <strong className="font-semibold text-slate-700">
                  {formatNumber(m.value, m.format, m.aggregation)}
                </strong>
              </span>
            ))}
          </div>
        )}
      </button>

      <span className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <button
          onClick={() => onSelect(selected ? '' : key)}
          className={`rounded bg-white/90 p-1 shadow-sm hover:text-indigo-600 ${
            selected ? 'text-indigo-600' : 'text-slate-400'
          }`}
          title="What is this branch?"
        >
          <Info size={10} />
        </button>
        {canOpen && !isRoot && (
          <button
            onClick={() => onFocus(node)}
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
