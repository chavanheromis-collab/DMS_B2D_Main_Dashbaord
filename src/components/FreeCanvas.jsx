import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import {
  HANDLES,
  alignBox,
  canvasHeight,
  defaultFrame,
  frameToPx,
  pxToFrame,
  resizeBox,
  snapBox,
} from '../lib/freeLayout'

/**
 * A canvas with no columns.
 *
 * Every widget is where it says it is and the size it says it is. Nothing is
 * rounded to a grid, because there is no grid: a widget 260px wide is 260px
 * wide, and the widget beside it starts wherever the admin put it rather
 * than at the next column boundary. That is the whole reason this exists --
 * the strip of dead space beside a pinned widget was never a bug in the
 * packer, it was the packer's premise.
 *
 * Frames are fractions across and pixels down (see lib/freeLayout.js), so a
 * layout made on a laptop still reads on a 4K monitor without anybody
 * re-doing it.
 *
 * Read-only for everybody except an admin in arrange mode: the handles, the
 * guides and the drag simply are not rendered otherwise, so a reader cannot
 * nudge a page by accident and there is nothing to be tempted by.
 */
export default function FreeCanvas({ items, frames, editable = false, snap = 8, onChange, className = '' }) {
  const hostRef = useRef(null)
  const [width, setWidth] = useState(0)
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null)

  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const measure = () => setWidth(el.clientWidth || 0)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // A widget with no frame yet -- one just added to a page that is already
  // free -- is placed rather than dropped at 0,0 underneath another.
  const resolved = useMemo(() => {
    const out = {}
    items.forEach((item, i) => {
      out[item.id] = frames?.[item.id] || defaultFrame(i)
    })
    return out
  }, [items, frames])

  const boxes = useMemo(() => {
    const out = {}
    for (const [id, frame] of Object.entries(resolved)) out[id] = frameToPx(frame, width)
    return out
  }, [resolved, width])

  const height = useMemo(() => canvasHeight(resolved, 8), [resolved])

  // --- moving and resizing ------------------------------------------------
  const begin = useCallback(
    (id, handle, e) => {
      if (!editable) return
      e.preventDefault()
      e.stopPropagation()
      const box = boxes[id]
      if (!box) return
      dragRef.current = { id, handle, startX: e.clientX, startY: e.clientY, box, moved: false }
      setDrag({ id, handle, box, guides: [] })
      e.currentTarget.setPointerCapture?.(e.pointerId)
    },
    [editable, boxes]
  )

  const move = useCallback(
    (e) => {
      const d = dragRef.current
      if (!d) return
      d.moved = true

      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY

      let next =
        d.handle === 'move'
          ? { ...d.box, left: d.box.left + dx, top: Math.max(0, d.box.top + dy) }
          : resizeBox(d.box, d.handle, dx, dy)

      next = snapBox(next, snap)
      // Neighbours' edges come last, so a deliberate line-up beats the grid.
      const others = Object.entries(boxes)
        .filter(([id]) => id !== d.id)
        .map(([, box]) => box)
      const aligned = alignBox(next, others, { canvasWidth: width })

      setDrag((current) => (current ? { ...current, box: aligned.box, guides: aligned.guides } : current))
    },
    [boxes, snap, width]
  )

  const end = useCallback(() => {
    const d = dragRef.current
    dragRef.current = null
    setDrag((current) => {
      if (current && d?.moved && width > 0) onChange?.(d.id, pxToFrame(current.box, width))
      return null
    })
  }, [onChange, width])

  useEffect(() => {
    if (!editable) {
      dragRef.current = null
      setDrag(null)
    }
  }, [editable])

  return (
    <div ref={hostRef} className={`relative ${className}`} style={{ height: width > 0 ? height : undefined }}>
      {/* The lines the thing being dragged is currently level with. Drawn
          across the whole canvas, because a guide you cannot follow to the
          widget it refers to is just a tick. */}
      {drag?.guides.map((g, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute z-50 bg-indigo-500/70"
          style={
            g.axis === 'x'
              ? { left: g.at, top: 0, width: 1, height: '100%' }
              : { top: g.at, left: 0, height: 1, width: '100%' }
          }
        />
      ))}

      {items.map((item) => {
        const live = drag?.id === item.id ? drag.box : boxes[item.id]
        if (!live || width <= 0) {
          return (
            <div key={item.id} className="relative mb-3 w-full">
              {item.content}
            </div>
          )
        }

        const active = drag?.id === item.id
        return (
          <div
            key={item.id}
            className={`absolute ${active ? 'z-40' : ''} ${
              active ? '' : 'transition-[top,left,width,height] duration-200 ease-out'
            }`}
            style={{ left: live.left, top: live.top, width: live.width, height: live.height }}
          >
            <div className="h-full w-full overflow-hidden">{item.content}</div>

            {editable && (
              <>
                <button
                  onPointerDown={(e) => begin(item.id, 'move', e)}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                  className={`absolute -top-1 right-6 z-20 rounded-lg border px-1 py-0.5 shadow-sm backdrop-blur ${
                    active && drag.handle === 'move'
                      ? 'cursor-grabbing border-indigo-400 bg-indigo-50 text-indigo-600'
                      : 'cursor-grab border-slate-200 bg-white/90 text-slate-400 hover:text-indigo-600'
                  }`}
                  title="Drag to move"
                  aria-label={`Move ${item.id}`}
                >
                  <GripVertical size={12} />
                </button>

                {/* Eight handles, because a layout you can only resize from
                    the bottom-right is a layout you reposition twice for
                    every size you change. */}
                {HANDLES.map((handle) => (
                  <span
                    key={handle}
                    onPointerDown={(e) => begin(item.id, handle, e)}
                    onPointerMove={move}
                    onPointerUp={end}
                    onPointerCancel={end}
                    role="presentation"
                    className={`absolute z-30 rounded-sm border border-indigo-400 bg-white opacity-0 transition-opacity hover:opacity-100 ${
                      active ? 'opacity-100' : ''
                    } ${HANDLE_CLASS[handle]}`}
                    style={{ cursor: `${handle}-resize` }}
                  />
                ))}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Corners are squares; edges are bars, so an edge is easy to hit without
// being easy to hit by accident.
const HANDLE_CLASS = {
  nw: '-left-1 -top-1 h-2.5 w-2.5',
  n: 'left-1/2 -top-1 h-2 w-6 -translate-x-1/2',
  ne: '-right-1 -top-1 h-2.5 w-2.5',
  e: '-right-1 top-1/2 h-6 w-2 -translate-y-1/2',
  se: '-bottom-1 -right-1 h-2.5 w-2.5',
  s: 'left-1/2 -bottom-1 h-2 w-6 -translate-x-1/2',
  sw: '-bottom-1 -left-1 h-2.5 w-2.5',
  w: '-left-1 top-1/2 h-6 w-2 -translate-y-1/2',
}
