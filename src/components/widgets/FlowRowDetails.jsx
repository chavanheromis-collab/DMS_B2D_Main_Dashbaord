import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { peekPlacement } from '../../lib/flowView.js'
import { topLayerHost } from '../../lib/deviceFullscreen.js'
import { detailPairs, detailSize, detailsFor } from '../../lib/flowDetails.js'
import { flowNodeColor } from '../../lib/flow.js'
import { mixColor } from '../../lib/heatColor.js'

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
 * It wears the BRANCH'S OWN COLOUR, from the same `flowNodeColor` the row
 * is drawn with. A white box floating over a coloured tree is a different
 * object that happened to appear; tinted, it reads as that row, opened.
 * The tint is the hue mixed most of the way into white -- pale enough that
 * ordinary dark text sits on it without anybody thinking about contrast,
 * which is the only way a colour per branch can be safe when the branch
 * colour is whatever an admin picked.
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

  // Sized by what it is about to hold rather than fixed at 320 by 300.
  // Each listed row is a stack of label/value lines, so the columns make
  // it tall and the rows make it long -- see `detailSize`. Capped to the
  // viewport as well, because a branch with eleven columns and eight rows
  // would otherwise be taller than a laptop screen.
  const { width, height } = detailSize({ columns: data.columns.length, rows: data.rows.length })
  const box = {
    width: Math.min(width, typeof window === 'undefined' ? width : window.innerWidth - 24),
    height,
  }

  /**
   * The branch's colour, in the four strengths this window needs.
   *
   * Mixed into white rather than used at full strength anywhere but the
   * rail: a saturated ground would fight every value printed on it, and
   * the values are the reason the window is open.
   */
  const skin = useMemo(() => {
    const hue = flowNodeColor(node)
    return {
      rail: hue,
      ground: mixColor('#FFFFFF', hue, 0.06),
      chrome: mixColor('#FFFFFF', hue, 0.14),
      edge: mixColor('#FFFFFF', hue, 0.3),
      ink: mixColor(hue, '#0F172A', 0.35),
    }
  }, [node])

  // Two columns once a record would otherwise be a long scroll. Below that
  // one column reads better -- a label and its value side by side, down the
  // page, is how a record is read.
  const columns = data.columns.length > 8 && box.width >= 400 ? 2 : 1

  useLayoutEffect(() => {
    if (!anchor) return
    setPlace(
      peekPlacement(
        anchor,
        box,
        { width: window.innerWidth, height: window.innerHeight }
      )
    )
    // Placed once, when it opens. `box` is deliberately not a dependency:
    // a reload that changes the row count would otherwise re-place the
    // window under somebody's cursor while they are reading it, and where
    // a window sits is a decision about where it was OPENED, not about
    // what it currently holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    // A press anywhere else closes it. `pointerdown` rather than
    // `mousedown`, so a finger on a tablet shuts it too -- this is read on
    // a showroom screen as often as on a desk.
    //
    // Captured on the way down, so a press on another row's eye opens that
    // one rather than being swallowed by this one closing.
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
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
      className="fixed z-[70] flex flex-col overflow-hidden rounded-xl border shadow-2xl"
      style={{
        left: place.x,
        top: place.y,
        width: box.width,
        maxHeight: box.height,
        backgroundColor: skin.ground,
        borderColor: skin.edge,
      }}
    >
      {/* The rail is the one place the hue is used at full strength: a
          stripe is read as an edge rather than as a background, so it can
          be as strong as the branch it names. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: skin.rail }} />

      <div
        className="flex shrink-0 items-start gap-2 border-b py-2 pl-3.5 pr-2"
        style={{ backgroundColor: skin.chrome, borderColor: skin.edge }}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold leading-tight" style={{ color: skin.ink }} title={node.label}>
            {node.label}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            {data.total.toLocaleString('en-IN')} row{data.total === 1 ? '' : 's'}
            {node.tab ? ` · ${node.tab}` : ''}
          </p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded p-1 text-slate-400 hover:bg-white/70 hover:text-slate-700"
          title="Close (Esc)"
        >
          <X size={13} />
        </button>
      </div>

      {data.mismatched ? (
        // A hop lands on another tab, where the chosen columns do not exist.
        // Saying so beats a window of blank rows.
        <p className="px-3.5 py-3 text-[11px] leading-relaxed text-slate-500">
          None of the chosen columns are on {node.tab || 'this tab'}.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5 pl-2.5">
          {data.rows.map((row, i) => (
            // Each record on its own white ground. Twenty label/value lines
            // running together were one grey wall with no telling where one
            // record ended and the next began; a card each is the shape the
            // eye already reads them in.
            <dl
              key={row._row ?? i}
              className="mb-1.5 grid gap-x-4 rounded-lg border bg-white/75 px-2.5 py-2 last:mb-0"
              style={{
                borderColor: skin.edge,
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              }}
            >
              {detailPairs(row, data.columns).map((pair) => (
                <div key={pair.column} className="flex min-w-0 items-baseline gap-2 py-[3px]">
                  <dt
                    className="w-[42%] shrink-0 truncate text-[9px] font-medium uppercase tracking-wider text-slate-400"
                    title={pair.column}
                  >
                    {pair.column}
                  </dt>
                  <dd className="min-w-0 flex-1 break-words text-[11.5px] font-medium leading-snug text-slate-800">
                    {pair.value === '' ? <span className="font-normal text-slate-300">—</span> : pair.value}
                  </dd>
                </div>
              ))}
            </dl>
          ))}
        </div>
      )}

      {data.hidden > 0 && (
        <p
          className="shrink-0 border-t py-1 pl-3.5 pr-2 text-[10px] font-medium"
          style={{ backgroundColor: skin.chrome, borderColor: skin.edge, color: skin.ink }}
        >
          and {data.hidden.toLocaleString('en-IN')} more
        </p>
      )}
    </div>,
    // Not `document.body`: while the flow is fullscreen the browser draws
    // that element's subtree in the top layer and everything else beneath
    // it, so a window portalled to the body would be invisible for exactly
    // as long as somebody was using the diagram full-screen.
    topLayerHost()
  )
}
