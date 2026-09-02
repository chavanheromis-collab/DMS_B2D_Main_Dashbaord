import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  boundsOf,
  canvasHeight,
  changedIn,
  DESIGN_WIDTH,
  drawnWidth,
  HANDLES,
  marquee,
  MIN_H,
  MIN_W,
  moveMany,
  placeAll,
  resizeBy,
  scaleFor,
  STACK_BELOW,
  stacked,
  toggle,
  toPixels,
  within,
} from '../lib/freeLayout'

/** Below this, a press is a click on the widget rather than a drag of it. */
const DRAG_THRESHOLD = 4

/** Where each handle sits on the widget, and which way it points. */
const HANDLE_STYLE = {
  nw: { top: -5, left: -5, cursor: 'nwse-resize' },
  n: { top: -5, left: '50%', marginLeft: -5, cursor: 'ns-resize' },
  ne: { top: -5, right: -5, cursor: 'nesw-resize' },
  e: { top: '50%', right: -5, marginTop: -5, cursor: 'ew-resize' },
  se: { bottom: -5, right: -5, cursor: 'nwse-resize' },
  s: { bottom: -5, left: '50%', marginLeft: -5, cursor: 'ns-resize' },
  sw: { bottom: -5, left: -5, cursor: 'nesw-resize' },
  w: { top: '50%', left: -5, marginTop: -5, cursor: 'ew-resize' },
}

/**
 * The page's widgets, each exactly where it was put.
 *
 * One layout model, and the simplest one that can say anything: a widget is
 * a rectangle on a canvas of a fixed design width. See lib/freeLayout.js.
 * Nothing flows, nothing wraps, nothing is pushed aside, and nothing floats
 * up to close a hole. Where you put it is where it stays.
 *
 * A narrower screen draws the same arrangement proportionally smaller. A
 * wider one STRETCHES it: the cards grow to use the room, and the text
 * inside them does not, because a big monitor is a reason for more content
 * and not for bigger letters. A phone gives up on the arrangement
 * altogether and stacks, since a 400px card drawn at a third of its size is
 * a card nobody can read.
 *
 * Several can be chosen at once -- shift-click, or drag a band across the
 * canvas -- and then they move together as one.
 *
 * `onLayout(changed)` is handed the rectangles a gesture actually altered.
 */
export default function WidgetCanvas({
  items,
  gapX = 12,
  gapY = 12,
  className = '',
  onMeasure,
  // Arranging: drag to move, drag a handle to resize.
  free = false,
  onLayout,
}) {
  // Two elements, and the difference matters. The HOST is measured and is
  // always the full width it is given; the STAGE is what the widgets are
  // drawn on, and is narrower when the screen is wider than the canvas
  // stretches. Measuring the stage instead would be a feedback loop --
  // setting its width changes what the observer reads, which changes its
  // width -- and on an ultra-wide monitor the page would flicker for ever.
  const hostRef = useRef(null)
  const stageRef = useRef(null)
  const [width, setWidth] = useState(0)

  // Held in refs so a caller passing a fresh arrow function every render
  // cannot re-create the observer or rebind the pointer handlers.
  const measure = useRef(onMeasure)
  measure.current = onMeasure
  const commit = useRef(onLayout)
  commit.current = onLayout

  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const read = () => setWidth(el.clientWidth || 0)
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---------------------------------------------------------------------
  // The layout
  // ---------------------------------------------------------------------

  // Every widget's rectangle, in design pixels -- including one invented
  // for anything nobody has placed yet, because "not placed" must not mean
  // "invisible".
  const stored = useMemo(() => placeAll(items, { gap: gapY }), [items, gapY])

  const phone = width > 0 && width < STACK_BELOW
  // Two numbers, one per direction -- see lib/freeLayout.js. A stacked
  // phone is already drawn at the width it has, so it needs no scaling.
  const scale = phone ? { x: 1, y: 1 } : scaleFor(width)
  // Past MAX_CANVAS the extra room becomes margin rather than more stretch.
  const drawn = phone ? width : drawnWidth(width)

  // On a phone the arrangement is the wrong question and everything goes
  // full width in reading order. Everywhere else it IS the arrangement,
  // drawn proportionally to fit the glass.
  const shown = useMemo(
    () => (phone ? stacked(stored, width, { gap: gapY }) : stored),
    [phone, stored, width, gapY]
  )

  // ---------------------------------------------------------------------
  // Dragging
  // ---------------------------------------------------------------------

  // The drag lives in a ref and is MIRRORED into state. The ref is what the
  // pointer handlers read -- they fire between renders and must see the
  // move that just happened, not the one React has drawn -- and the state
  // is only so that the widget follows the hand.
  const dragRef = useRef(null)
  const [drag, setDrag] = useState(null)

  // Which widgets a gesture will apply to. Not stored on the page: it is
  // who is holding the mouse this minute, not anything about the dashboard.
  const [selection, setSelection] = useState(() => new Set())

  // Nothing can be chosen that is not there any more -- a deleted widget
  // left in the set would be dragged by every gesture and saved by none.
  useEffect(() => {
    setSelection((prev) => {
      const live = new Set(items.map((item) => item.id))
      if ([...prev].every((id) => live.has(id))) return prev
      return new Set([...prev].filter((id) => live.has(id)))
    })
  }, [items])

  const far = drag && (Math.abs(drag.dx) >= DRAG_THRESHOLD || Math.abs(drag.dy) >= DRAG_THRESHOLD)

  // The band, in design pixels, while one is being drawn.
  const band = useMemo(() => {
    if (!drag || drag.mode !== 'band' || !far) return null
    return marquee(drag.from, {
      x: drag.from.x + drag.dx / scale.x,
      y: drag.from.y + drag.dy / scale.y,
    })
  }, [drag, far, scale])

  // Who the band is currently over. Shown while it is being drawn, so it is
  // obvious what letting go will choose.
  const banding = useMemo(() => (band ? new Set(within(shown, band)) : null), [band, shown])

  // What the drag has reached: the moved rectangles, and the lines they
  // lined up with on the way.
  const preview = useMemo(() => {
    if (!drag || !free || drag.mode === 'band' || !far) return null
    const chosen = shown.filter((item) => drag.ids.includes(item.id))
    if (chosen.length === 0) return null
    // In design pixels, not in the pixels under the hand: on a scaled
    // canvas those differ, and the design is what gets saved.
    const dx = drag.dx / scale.x
    const dy = drag.dy / scale.y
    const others = shown.filter((item) => !drag.ids.includes(item.id))
    if (drag.handle) {
      const out = resizeBy(chosen[0], drag.handle, dx, dy, others, { loose: drag.loose })
      return { rects: [out.rect], guides: out.guides }
    }
    return moveMany(chosen, dx, dy, others, { loose: drag.loose })
  }, [drag, free, far, shown, scale])

  const boxes = useMemo(() => {
    const out = {}
    for (const rect of shown) out[rect.id] = toPixels(rect, scale)
    for (const rect of preview?.rects || []) out[rect.id] = toPixels(rect, scale)
    return out
  }, [shown, scale, preview])

  // The result has to reach the handler that saves it, and that handler was
  // bound once. Written down here rather than recomputed there, so what is
  // saved is exactly what was on the screen when the hand let go.
  if (dragRef.current) {
    dragRef.current.result = preview?.rects ?? null
    dragRef.current.chose = banding
    dragRef.current.base = shown
  }

  // One pointerdown starts it; the window finishes it. On the element
  // alone, a hand that outruns the widget mid-drag would drop it there.
  useEffect(() => {
    if (!free) return undefined

    const move = (event) => {
      const d = dragRef.current
      if (!d) return
      const next = {
        ...d,
        dx: event.clientX - d.startX,
        dy: event.clientY - d.startY,
        // Read every time: somebody who presses Alt half way through a drag
        // means it from that moment, not from the moment they started.
        loose: event.altKey,
      }
      dragRef.current = next
      setDrag(next)
    }

    const up = () => {
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d) return

      if (d.mode === 'band') {
        // A band that was never really drawn is a click on the background,
        // and a click on the background means "nothing".
        setSelection(d.chose ? new Set(d.chose) : new Set())
        return
      }

      if (!d.result) return
      const changed = changedIn(d.base, d.result)
      if (changed.length > 0) commit.current?.(changed)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [free])

  // Arranging turned off mid-drag -- the effect above has gone, so nothing
  // is left to finish this one.
  useEffect(() => {
    if (free) return
    dragRef.current = null
    setDrag(null)
  }, [free])

  const begin = (event, extra) => {
    const d = {
      handle: null,
      ids: [],
      startX: event.clientX,
      startY: event.clientY,
      dx: 0,
      dy: 0,
      loose: event.altKey,
      result: null,
      base: shown,
      ...extra,
    }
    dragRef.current = d
    setDrag(d)
  }

  const startDrag = (event, id, handle = null) => {
    if (!free || event.button !== 0) return
    // A widget's own controls keep working while the page is being
    // arranged: a search box you cannot type in is not an arranged page,
    // it is a broken one.
    if (!handle && event.target?.closest?.('input, textarea, select, button, a, [contenteditable="true"]')) {
      return
    }
    event.stopPropagation()

    // A handle resizes the one widget it is on, whatever else is chosen:
    // "make these five the same size" is a different feature, and guessing
    // at it here would make one careless drag rewrite five widgets.
    if (handle) {
      begin(event, { handle, ids: [id] })
      return
    }

    const additive = event.shiftKey || event.ctrlKey || event.metaKey
    if (additive) {
      // Adding to a selection is not the start of a drag. Somebody
      // shift-clicking a fourth card is choosing, not moving.
      setSelection((prev) => toggle(prev, id, true))
      return
    }

    // Grabbing something already in the selection drags the whole of it;
    // grabbing anything else chooses that one and drags it alone.
    const chosen = selection.has(id) ? [...selection] : [id]
    if (!selection.has(id)) setSelection(new Set([id]))
    begin(event, { ids: chosen })
  }

  /** A press on the canvas itself: the start of a rubber band. */
  const startBand = (event) => {
    if (!free || phone || event.button !== 0) return
    if (event.target !== stageRef.current) return
    const host = stageRef.current.getBoundingClientRect()
    begin(event, {
      mode: 'band',
      from: {
        x: (event.clientX - host.left) / scale.x,
        y: (event.clientY - host.top) / scale.y,
      },
    })
  }

  // Escape lets go of everything -- the way out of a selection that is
  // about to be dragged by accident.
  useEffect(() => {
    if (!free) return undefined
    const key = (event) => {
      if (event.key === 'Escape') setSelection(new Set())
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [free])

  // Nothing stays chosen once the page is no longer being arranged.
  useEffect(() => {
    if (!free) setSelection(new Set())
  }, [free])

  // ---------------------------------------------------------------------
  // Measuring back
  // ---------------------------------------------------------------------

  // Reported after layout, so the number an admin sees in the arrange boxes
  // is the number that was actually drawn.
  useEffect(() => {
    if (!measure.current || width <= 0) return
    for (const rect of shown) {
      measure.current(rect.id, rect.w, rect.h, {
        left: rect.x,
        top: rect.y,
        scale,
        stacked: phone,
        canvasWidth: Math.round(width),
        designWidth: DESIGN_WIDTH,
      })
    }
  }, [shown, scale, phone, width])

  return (
    <div ref={hostRef} className={className}>
    <div
      ref={stageRef}
      onPointerDown={free ? startBand : undefined}
      className={`relative ${drag ? 'select-none' : ''}`}
      style={{
        height: width > 0 ? canvasHeight(shown, scale) : undefined,
        // Centred once the screen is wider than the canvas will stretch.
        // The alternative is a page whose right-hand third is empty on an
        // ultra-wide monitor.
        width: drawn > 0 ? drawn : undefined,
        marginInline: 'auto',
        // Room to put something below everything, so "down here" is a place
        // the hand can actually reach.
        paddingBottom: free ? 96 : undefined,
      }}
    >
      {/* The rubber band, and how many it has got. The count is the part
          that matters: a band is drawn over widgets, so what it has caught
          is otherwise something you have to squint at. */}
      {band && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-40 rounded border border-indigo-500 bg-indigo-500/10"
          style={toPixels(band, scale)}
        >
          {banding?.size > 0 && (
            <span className="absolute -top-2 left-1 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">
              {banding.size}
            </span>
          )}
        </div>
      )}

      {/* What is chosen, drawn round the outside of it. Without this a
          selection is invisible until something moves. */}
      {selection.size > 1 && !band && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-10 rounded-lg border border-dashed border-indigo-400"
          style={(() => {
            const box = boundsOf((preview?.rects || shown).filter((rect) => selection.has(rect.id)))
            if (!box) return { display: 'none' }
            const px = toPixels(box, scale)
            return { left: px.left - 4, top: px.top - 4, width: px.width + 8, height: px.height + 8 }
          })()}
        />
      )}

      {/* The lines the drag has lined up with. A snap you cannot see is a
          widget that appears to move on its own. */}
      {preview?.guides.map((guide) =>
        guide.axis === 'x' ? (
          <span
            key={`x${guide.at}`}
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 z-40 w-px bg-fuchsia-500"
            style={{ left: Math.round(guide.at * scale.x) }}
          />
        ) : (
          <span
            key={`y${guide.at}`}
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 z-40 h-px bg-fuchsia-500"
            style={{ top: Math.round(guide.at * scale.y) }}
          />
        )
      )}

      {items.map((item) => {
        const box = boxes[item.id]
        // Before the canvas has been measured, a plain stacked flow rather
        // than everything at zero size in the top-left corner.
        if (!box || width <= 0) {
          return (
            <div key={item.id} className="relative mb-3 w-full">
              {item.content}
            </div>
          )
        }
        const dragging = preview && drag?.ids.includes(item.id)
        const chosen = selection.has(item.id) || banding?.has(item.id)
        return (
          <div
            key={item.id}
            onPointerDown={free && !phone ? (event) => startDrag(event, item.id) : undefined}
            className={`absolute widget-fit ${
              dragging
                ? 'z-30 opacity-90 shadow-2xl'
                : 'transition-[top,left,width,height] duration-150 ease-out'
            } ${free && !phone ? 'group/free cursor-grab' : ''} ${
              dragging && !drag.handle ? 'cursor-grabbing' : ''
            } ${chosen ? 'widget-chosen' : ''}`}
            style={{ ...box, minWidth: MIN_W * scale.x, minHeight: MIN_H * scale.y }}
          >
            {item.content}

            {/* Eight handles, ON the widget rather than inside it, so no
                widget has to know they exist. Not on a phone, where the
                arrangement is not what is being drawn. */}
            {free && !phone && selection.size <= 1 && (
              <>
                {HANDLES.map((handle) => (
                  <span
                    key={handle}
                    onPointerDown={(event) => startDrag(event, item.id, handle)}
                    title="Drag to resize — hold Alt to place it exactly"
                    className="absolute z-20 h-2.5 w-2.5 rounded-sm border border-indigo-500 bg-white opacity-0 transition-opacity group-hover/free:opacity-100"
                    style={HANDLE_STYLE[handle]}
                  />
                ))}
                {dragging && drag.ids[0] === item.id && (
                  <span className="pointer-events-none absolute -top-2 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white shadow">
                    {drag.handle
                      ? `${Math.round(preview.rects[0].w)} × ${Math.round(preview.rects[0].h)}`
                      : `${Math.round(preview.rects[0].x)}, ${Math.round(preview.rects[0].y)}${
                          drag.ids.length > 1 ? ` · ${drag.ids.length} widgets` : ''
                        }`}
                  </span>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
    </div>
  )
}
