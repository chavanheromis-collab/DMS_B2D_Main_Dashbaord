import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { packRowGroups, rowGaps, rowSlack } from '../lib/flowPack'

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
export default function WidgetCanvas({ items, gapX = 12, gapY = 12, showRows = false, className = '', onMeasure }) {
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
    () => packRowGroups(items, { canvasWidth: width, gapX, gapY, heights }),
    [items, width, gapX, gapY, heights]
  )

  const slack = useMemo(
    () => rowSlack(layout.rows, layout.positions, width, gapX),
    [layout, width, gapX]
  )

  // The empty space at the end of each row, and what would fit in it.
  const gaps = useMemo(
    () => (showRows && width > 0 ? rowGaps(layout.rows, layout.positions, width, gapX, undefined, gapY) : []),
    [showRows, layout, width, gapX, gapY]
  )

  // One observer per widget, so a table that grows a row pushes what is
  // below it down without anything else being recomputed.
  const key = items
    .map((i) => `${i.id}:${i.widthPx ?? ''}:${i.width ?? ''}:${i.row ?? ''}:${i.rowSpan ?? ''}`)
    .join('|')
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
        row: box.row,
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
      {/* Where each row begins and ends. Only while arranging: a reader
          does not need to be told that a dashboard has rows, and an admin
          deciding which row to put something in does. */}
      {showRows &&
        width > 0 &&
        layout.rows.map((r) => (
          <div
            key={r.row}
            aria-hidden
            className="pointer-events-none absolute -left-1 -right-1 rounded-lg border border-dashed border-indigo-200"
            style={{ top: r.top - 4, height: r.height + 8 }}
          >
            <span className="absolute -top-2 left-1 rounded bg-indigo-50 px-1 text-[9px] font-semibold text-indigo-500">
              Row {r.row}
            </span>
            {/* Space a widget from a row above is standing in. Without this
                the row looks like it has room going spare, and the number
                in the arrange bar looks like a lie. */}
            {(r.blocked || []).map((b) => (
              <span
                key={`held-${b.left}`}
                className="absolute top-0 bottom-0 rounded bg-indigo-50/40"
                style={{ left: b.left + 4, width: b.right - b.left }}
              />
            ))}
          </div>
        ))}

      {/* What would fit in the space left over. The number somebody
          actually needs while arranging is not "there is room" but "there is
          room for 340 by 94", and that is a rectangle, not a caption. */}
      {gaps.map((gap) => (
        <div
          key={`gap-${gap.row}-${gap.left}-${gap.top}`}
          aria-hidden
          className="pointer-events-none absolute flex items-center justify-center rounded-lg border-2 border-dashed border-slate-300/80 bg-slate-50/40"
          style={{ left: gap.left, top: gap.top, width: gap.width, height: gap.height }}
        >
          <span className="rounded bg-white/85 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500">
            {gap.width} × {Math.round(gap.height)}
          </span>
        </div>
      ))}

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
            // A widget told to cover several rows is as tall as they are
            // together -- otherwise "spans rows 2 to 4" would mean nothing
            // more than "starts at row 2", and the room it reserved below
            // itself would sit visibly empty underneath it.
            className={`absolute transition-[top,left,width] duration-300 ease-out ${
              box.spanned ? 'widget-span' : ''
            }`}
            style={{
              top: box.top,
              left: box.left,
              width: box.width,
              height: box.spanned ? box.height : undefined,
            }}
          >
            {item.content}
          </div>
        )
      })}
    </div>
  )
}
