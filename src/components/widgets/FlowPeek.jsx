import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ChevronRight, Filter, Maximize2 } from 'lucide-react'
import { formatNumber } from '../../lib/dataUtils.js'
import { STAGE_PALETTE } from '../../lib/config.js'
import { flowNodeCanDrill } from '../../lib/flow.js'
import { PEEK_SIZE, peekPlacement, peekRows } from '../../lib/flowView.js'

/**
 * A magnified window over one branch.
 *
 * Zoomed out far enough to see the shape of a flow, the cards are too small
 * to read. Zoomed in far enough to read them, the shape is gone. That is the
 * permanent bind of any canvas, and panning between the two is what makes
 * people give up on one.
 *
 * So hovering a branch opens a fixed square over it -- at full size whatever
 * the canvas is scaled to, which is the whole point -- listing everything
 * directly underneath. It SCROLLS, so a branch with forty children is all
 * there rather than the six that fitted on the card. And clicking a row
 * moves the window down into that child, so a whole path can be walked
 * without touching the canvas, the zoom, or the open/closed state of
 * anything.
 *
 * Rendered through a portal at fixed position, for two reasons. Inside the
 * zoom transform it would be scaled along with everything else, which is the
 * exact problem it exists to solve. And each widget card has its own
 * entrance animation, which creates a stacking context that a z-index alone
 * cannot escape.
 */
export default function FlowPeek({ node, anchor, onClose, onStay, onLeave, onFocus, onDrill, isDrilled }) {
  // Where the window is looking. Starts at the hovered branch and moves as
  // rows are clicked, keeping a trail so it can walk back up.
  const [trail, setTrail] = useState([node])
  const ref = useRef(null)
  const [place, setPlace] = useState(null)

  // A new branch under the cursor is a new window, not a deeper one.
  useEffect(() => {
    setTrail([node])
  }, [node])

  useLayoutEffect(() => {
    if (!anchor) return
    setPlace(
      peekPlacement(
        anchor,
        { width: PEEK_SIZE, height: PEEK_SIZE },
        { width: window.innerWidth, height: window.innerHeight }
      )
    )
  }, [anchor])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const current = trail[trail.length - 1]
  const rows = useMemo(() => peekRows(current), [current])
  const total = current?.value || 0

  if (!current || !place) return null

  const color = nodeColor(current)
  const canDrill = flowNodeCanDrill(current)

  return createPortal(
    <div
      ref={ref}
      data-flow-peek
      // Pointer events stay live, and moving into the window counts as
      // staying on the branch: it is meant to be scrolled and clicked, which
      // is what separates it from a tooltip.
      onPointerEnter={onStay}
      onPointerLeave={onLeave}
      className="pop-in fixed z-[70] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/98 shadow-2xl backdrop-blur"
      style={{ left: place.x, top: place.y, width: PEEK_SIZE, height: PEEK_SIZE }}
    >
      {/* --- what you are looking at --------------------------------- */}
      <div className="flex items-start gap-1.5 px-2 py-1.5" style={{ backgroundColor: `${color}14` }}>
        {trail.length > 1 && (
          <button
            onClick={() => setTrail((t) => t.slice(0, -1))}
            className="mt-0.5 shrink-0 rounded p-0.5 text-slate-400 hover:bg-white hover:text-indigo-600"
            title={`Back to ${trail[trail.length - 2].label}`}
          >
            <ArrowLeft size={12} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-slate-800" title={current.label}>
            {current.icon} {current.label}
          </p>
          <p className="truncate text-[10px] text-slate-500" title={current.trail.join(' → ')}>
            {short(current.value)} · {current.count.toLocaleString('en-IN')} rows
            {current.share !== null && current.share !== undefined && ` · ${pctText(current.share)} of its parent`}
          </p>
        </div>
      </div>

      {/* --- everything under it, scrollable ------------------------- */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-1">
        {rows.length === 0 ? (
          <p className="px-1 py-3 text-center text-[10px] text-slate-400">
            Nothing below this branch{current.hasChildren ? ' is open' : ''}.
          </p>
        ) : (
          rows.map((row) => {
            const share = Math.max(0, Math.min(1, row.share ?? (total ? row.value / total : 0)))
            const rest = row.kind === 'rest'
            const faint = rest || row.kind === 'other' || row.kind === 'blank' || row.kind === 'else'
            const rowColor = row.node ? nodeColor(row.node) : '#94a3b8'

            return (
              <button
                key={row.key}
                disabled={rest}
                onClick={() => row.node && setTrail((t) => [...t, row.node])}
                className={`group relative flex w-full items-center gap-1.5 overflow-hidden rounded-lg px-1.5 py-1 text-left ${
                  rest ? 'cursor-default' : 'hover:bg-slate-50'
                }`}
                title={
                  rest
                    ? 'Rows in this branch that are in none of the ones listed'
                    : row.hasChildren
                      ? `Look inside ${row.label}`
                      : row.label
                }
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 left-0 rounded-lg"
                  style={{ width: `${share * 100}%`, backgroundColor: `${rowColor}1a` }}
                />
                <span className="relative h-3.5 w-1 shrink-0 rounded" style={{ backgroundColor: rowColor }} />
                <span
                  className={`relative min-w-0 flex-1 truncate text-[11px] ${
                    faint ? 'italic text-slate-400' : 'text-slate-700'
                  }`}
                >
                  {row.label}
                </span>
                <span className="relative shrink-0 text-[10px] font-semibold tabular-nums" style={{ color: rowColor }}>
                  {short(row.value)}
                </span>
                <span className="relative w-8 shrink-0 text-right text-[9px] tabular-nums text-slate-400">
                  {pctText(share)}
                </span>
                {row.hasChildren ? (
                  <ChevronRight size={11} className="relative shrink-0 text-slate-300 group-hover:text-indigo-500" />
                ) : (
                  <span className="relative w-[11px] shrink-0" />
                )}
              </button>
            )
          })
        )}
      </div>

      {/* --- and what to do with it ---------------------------------- */}
      <div className="flex items-center gap-1 border-t border-slate-100 px-1.5 py-1">
        {current.metrics?.length > 0 && (
          <span
            className="min-w-0 flex-1 truncate text-[9px] text-slate-500"
            title={current.metrics.map((m) => `${m.label}: ${formatNumber(m.value, m.format, m.aggregation)}`).join(' · ')}
          >
            {current.metrics.slice(0, 2).map((m) => (
              <span key={m.id || m.label} className="mr-1.5">
                {m.label}{' '}
                <strong className="font-semibold text-slate-700">
                  {formatNumber(m.value, m.format, m.aggregation)}
                </strong>
              </span>
            ))}
          </span>
        )}
        {!current.metrics?.length && <span className="min-w-0 flex-1" />}

        {current.hasChildren && current.level > 0 && (
          <button
            onClick={() => {
              onFocus(current)
              onClose()
            }}
            className="shrink-0 rounded border border-slate-200 p-1 text-slate-500 hover:bg-slate-50 hover:text-indigo-600"
            title={`Make ${current.label} the whole canvas`}
          >
            <Maximize2 size={11} />
          </button>
        )}
        {canDrill && (
          <button
            onClick={() => onDrill(current)}
            className={`shrink-0 rounded border p-1 ${
              isDrilled(current)
                ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
                : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-indigo-600'
            }`}
            title={isDrilled(current) ? 'Remove this filter from the page' : 'Filter the whole page to these rows'}
          >
            <Filter size={11} />
          </button>
        )}
        <button
          onClick={onClose}
          className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[9px] text-slate-400 hover:bg-slate-50"
          title="Close (Esc)"
        >
          esc
        </button>
      </div>
    </div>,
    document.body
  )
}

function nodeColor(node) {
  return node?.color || STAGE_PALETTE[(node?.level || 0) % STAGE_PALETTE.length] || '#4F46E5'
}

function short(n) {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1000)
    return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
  return String(Math.round(v * 10) / 10)
}

function pctText(share) {
  const n = Math.max(0, Math.min(1, Number(share) || 0)) * 100
  return `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10}%`
}
