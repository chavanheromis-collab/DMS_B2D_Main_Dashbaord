import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { peekPlacement } from '../../lib/flowView.js'
import { detailPairs, detailsFor } from '../../lib/flowDetails.js'

const WIDTH = 320
const HEIGHT = 300

/**
 * The rows behind one branch, in a small window over it.
 *
 * Deliberately not the detail panel the table has. That one is a full-height
 * drawer for ONE record, opened because you were already reading that
 * record. This is opened while reading a shape, to answer "which ones" --
 * so it is small, it sits by the row it belongs to, and it closes the
 * moment you look away. A drawer here would cover the flow you opened it
 * from, which is the one thing on screen you still need.
 *
 * Placed by the same function the magnifier uses, so both windows behave
 * identically at the edges of the screen: flipped rather than clipped, and
 * never off the bottom.
 *
 * Portalled and fixed, for the reasons the magnifier is: inside the diagram
 * it would be scaled by the zoom, and inside a card it would be trapped by
 * that card's own stacking context.
 */
export default function FlowRowDetails({ node, flow, anchor, onClose }) {
  const ref = useRef(null)
  const [place, setPlace] = useState(null)
  const data = detailsFor(node, flow)

  useLayoutEffect(() => {
    if (!anchor) return
    setPlace(
      peekPlacement(
        anchor,
        { width: WIDTH, height: HEIGHT },
        { width: window.innerWidth, height: window.innerHeight }
      )
    )
  }, [anchor])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    // A press anywhere else closes it. Captured on the way down, so a click
    // on another row's eye opens that one rather than being swallowed.
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [onClose])

  if (!place) return null

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[70] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
      style={{ left: place.x, top: place.y, width: WIDTH, maxHeight: HEIGHT }}
    >
      <div className="flex items-start gap-2 border-b border-slate-100 bg-slate-50/80 px-2.5 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold text-slate-700">{node.label}</p>
          <p className="text-[10px] text-slate-400">
            {data.total.toLocaleString('en-IN')} row{data.total === 1 ? '' : 's'}
            {node.tab ? ` · ${node.tab}` : ''}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-slate-300 hover:bg-white hover:text-slate-600"
          title="Close (Esc)"
        >
          <X size={12} />
        </button>
      </div>

      {data.mismatched ? (
        // A hop lands on another tab, where the chosen columns do not exist.
        // Saying so beats a window of blank rows.
        <p className="px-2.5 py-3 text-[11px] leading-relaxed text-slate-400">
          None of the chosen columns are on {node.tab || 'this tab'}.
        </p>
      ) : (
        <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
          {data.rows.map((row, i) => (
            <dl key={row._row ?? i} className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 px-2.5 py-1.5">
              {detailPairs(row, data.columns).map((pair) => (
                <div key={pair.column} className="contents">
                  <dt className="truncate text-[10px] uppercase tracking-wide text-slate-400">{pair.column}</dt>
                  <dd className="min-w-0 break-words text-[11px] text-slate-700">
                    {pair.value === '' ? <span className="text-slate-300">—</span> : pair.value}
                  </dd>
                </div>
              ))}
            </dl>
          ))}
        </div>
      )}

      {data.hidden > 0 && (
        <p className="border-t border-slate-100 bg-slate-50/80 px-2.5 py-1 text-[10px] text-slate-400">
          and {data.hidden.toLocaleString('en-IN')} more
        </p>
      )}
    </div>,
    document.body
  )
}
