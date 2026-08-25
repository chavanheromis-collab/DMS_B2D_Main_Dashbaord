import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { packFlow, rowSlack } from '../lib/flowPack'

/**
 * The page's widgets, laid out by the space each one needs.
 *
 * No columns. A widget asks for a width in pixels and gets exactly that;
 * they are placed in the admin's own order, left to right, each starting
 * where the one before it ended; and when the next one will not fit in what
 * is left of the row, it starts a new one. See lib/flowPack.js for why that
 * is the whole model.
 *
 * Nothing here is draggable. Sizes are typed, in pixels, in the arrange bar
 * -- which is exact, repeatable, and the same on every screen, none of which
 * is true of a mouse. This component only draws.
 *
 * `onMeasure` reports each widget's real size back, so the arrange bar can
 * show what a widget IS rather than an empty box, and say how much room is
 * going spare on its row.
 */
export default function WidgetCanvas({ items, gapX = 12, gapY = 12, className = '', onMeasure }) {
  const hostRef = useRef(null)
  const itemRefs = useRef(new Map())
  const [width, setWidth] = useState(0)
  const [heights, setHeights] = useState({})

  // Held in a ref so a caller passing a fresh arrow function every render
  // cannot re-create every observer on every render.
  const measure = useRef(onMeasure)
  measure.current = onMeasure

  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const read = () => setWidth(el.clientWidth || 0)
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const layout = useMemo(
    () => packFlow(items, { canvasWidth: width, gapX, gapY, heights }),
    [items, width, gapX, gapY, heights]
  )

  const slack = useMemo(
    () => rowSlack(layout.rows, layout.positions, width, gapX),
    [layout, width, gapX]
  )

  // One observer per widget, so a table that grows a row pushes what is
  // below it down without anything else being recomputed.
  const key = items.map((i) => `${i.id}:${i.widthPx ?? ''}:${i.width ?? ''}`).join('|')
  useEffect(() => {
    const observers = []
    itemRefs.current.forEach((node, id) => {
      if (!node) return
      const ro = new ResizeObserver((entries) => {
        const box = entries[0]?.contentRect
        const h = box?.height
        if (!h) return
        setHeights((prev) => (Math.abs((prev[id] || 0) - h) > 1 ? { ...prev, [id]: h } : prev))
      })
      ro.observe(node)
      observers.push(ro)
    })
    return () => observers.forEach((ro) => ro.disconnect())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Reported after layout, so the number an admin sees is the number that
  // was actually drawn -- including how much of the row is going spare,
  // which is what somebody needs in order to decide what to type.
  useEffect(() => {
    if (!measure.current || width <= 0) return
    for (const [id, box] of Object.entries(layout.positions)) {
      measure.current(id, box.width, Math.round(heights[id] ?? box.height), {
        left: box.left,
        top: box.top,
        spare: slack[id] ?? 0,
        canvasWidth: Math.round(width),
      })
    }
  }, [layout, slack, heights, width])

  return (
    <div
      ref={hostRef}
      className={`relative ${className}`}
      style={{ height: width > 0 ? layout.containerHeight : undefined }}
    >
      {items.map((item) => {
        const box = layout.positions[item.id]
        // Before the canvas has been measured, a plain stacked flow rather
        // than everything at zero width in the top-left corner.
        if (!box || width <= 0) {
          return (
            <div key={item.id} ref={(node) => itemRefs.current.set(item.id, node)} className="relative mb-3 w-full">
              {item.content}
            </div>
          )
        }
        return (
          <div
            key={item.id}
            ref={(node) => itemRefs.current.set(item.id, node)}
            className="absolute transition-[top,left,width] duration-300 ease-out"
            style={{ top: box.top, left: box.left, width: box.width }}
          >
            {item.content}
          </div>
        )
      })}
    </div>
  )
}
