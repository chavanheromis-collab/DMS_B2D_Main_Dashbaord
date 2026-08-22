import { useEffect, useMemo, useRef, useState } from 'react'

// Mirrors WIDTHS in lib/config.js -- keep these two in sync if that ever
// changes. This is the same quarter/third/half/twothird/full system used
// everywhere else on the dashboard, just expressed as a unit count (out of
// 12) per breakpoint so the packing algorithm can reason about it in JS.
const SPAN_MAP = {
  quarter: { base: 12, md: 6, lg: 3 },
  third: { base: 12, md: 6, lg: 4 },
  half: { base: 12, md: 6, lg: 6 },
  twothird: { base: 12, md: 12, lg: 8 },
  full: { base: 12, md: 12, lg: 12 },
}

const BREAKPOINTS = { md: 768, lg: 1024 } // matches Tailwind's defaults, which this project doesn't override

/**
 * Which breakpoint the GRID is at -- measured from the space the grid
 * actually has, not from the window.
 *
 * Those stopped being the same thing once a sidebar was added: on a 1200px
 * window with the sidebar expanded the grid only gets ~930px, and sizing
 * four "quarter" widgets as if it had 1200 crushes them. Falling back to the
 * window width keeps the very first frame (before the container has been
 * measured) sensible.
 */
function breakpointFor(width) {
  const w = width || (typeof window === 'undefined' ? 1280 : window.innerWidth)
  if (w >= BREAKPOINTS.lg) return 'lg'
  if (w >= BREAKPOINTS.md) return 'md'
  return 'base'
}

export function spanForWidth(width, breakpoint) {
  const m = SPAN_MAP[width] || SPAN_MAP.full
  return m[breakpoint] ?? m.base
}

const COLUMNS = 12
const FALLBACK_HEIGHT = 220 // used only when an item has no estimatedHeight and hasn't been measured yet

/**
 * PASS 1 -- decide which column each widget belongs to. This is the part
 * that must be STABLE: it uses each widget's ESTIMATED height (a rough,
 * type-based guess supplied by the caller -- KPIs and gauges are short,
 * tables and charts are tall) rather than its live measured height, and is
 * only ever recomputed when the admin's widget list itself changes (added,
 * removed, reordered, resized, or a responsive breakpoint crossed).
 *
 * Filtering the dashboard changes a table's row count or a KPI's matched
 * value -- its REAL height -- constantly, but never its estimated height
 * bucket, so this never re-runs from that and a widget can never end up in
 * a different column just because someone applied a filter. A gauge, KPI,
 * KPI stack the admin built to sit in one column stays in that column
 * forever, exactly in that order.
 */
export function assignColumns(items, breakpoint, columns = COLUMNS) {
  const colHeights = new Array(columns).fill(0)
  const slots = {}
  for (const item of items) {
    const span = Math.min(columns, Math.max(1, spanForWidth(item.width, breakpoint)))
    let best = { col: 0, y: Infinity }
    for (let c = 0; c <= columns - span; c++) {
      const y = Math.max(...colHeights.slice(c, c + span))
      if (y < best.y) best = { col: c, y }
    }
    slots[item.id] = { col: best.col, span }
    const landed = best.y + (item.estimatedHeight ?? FALLBACK_HEIGHT) + 1
    for (let c = best.col; c < best.col + span; c++) colHeights[c] = landed
  }
  return slots
}

/**
 * PASS 2 -- given the FIXED columns from assignColumns, compute each
 * widget's actual pixel position using its REAL measured height (falling
 * back to the estimate before it's been measured for the first time).
 *
 * This is the part that's live and reactive: if a gauge's content shrinks
 * after a filter, the KPI stacked below it in the SAME column moves up to
 * sit right underneath -- normal masonry behaviour -- but a widget's `col`
 * never changes here, only its `top`. Nothing ever moves sideways.
 */
export function packMasonry(items, slots, heights, gap = 12, columns = COLUMNS) {
  const colHeights = new Array(columns).fill(0)
  const pos = {}
  for (const item of items) {
    const slot = slots[item.id]
    if (!slot) continue
    const { col, span } = slot
    const y = Math.max(...colHeights.slice(col, col + span))
    const h = heights[item.id] ?? item.estimatedHeight ?? FALLBACK_HEIGHT
    pos[item.id] = { col, span, top: y }
    const landed = y + h + gap
    for (let c = col; c < col + span; c++) colHeights[c] = landed
  }
  return { positions: pos, containerHeight: Math.max(0, ...colHeights) - (items.length ? gap : 0) }
}

/**
 * A real masonry layout, not a CSS Grid approximation.
 *
 * CSS Grid gives every item sharing a row the SAME row height -- a short
 * KPI card next to a tall leaderboard still reserves that leaderboard's
 * full height for itself, and nothing can ever be placed in the blank
 * space left below it, no matter what grid-auto-flow setting is used. That
 * requires knowing each widget's real rendered height and choosing where
 * to place the next one accordingly, which CSS alone cannot do.
 *
 * Column assignment (assignColumns) and vertical stacking (packMasonry)
 * are deliberately split into two passes -- see their doc comments -- so
 * that a widget's horizontal position is decided once from the admin's own
 * order and each widget's rough size, and only its vertical position ever
 * reacts to live data changes like filtering.
 *
 * `items`: [{ id, width, estimatedHeight?, content }] where `width` is one
 * of the existing quarter/third/half/twothird/full values.
 */
export default function MasonryGrid({ items, gap = 12, className = '' }) {
  const containerRef = useRef(null)
  const itemRefs = useRef(new Map())
  const [heights, setHeights] = useState({}) // id -> px, filled in as each widget reports its real size
  const [containerWidth, setContainerWidth] = useState(0)
  const breakpoint = breakpointFor(containerWidth)

  // Column assignment only depends on WHICH widgets exist, in what order,
  // at what width -- not on anything about their live content -- so this
  // key deliberately excludes `heights`.
  const slotKey = items.map((i) => `${i.id}:${i.width}`).join('|')

  // Exact column pixel width, and the breakpoint that follows from it.
  //
  // The container's ResizeObserver is now the ONLY input: it fires for a
  // window resize AND for the sidebar collapsing, and the breakpoint is
  // derived from the width it reports. A separate window listener would be
  // a second source of truth that disagrees with this one whenever the
  // sidebar changes width without the window doing so.
  useEffect(() => {
    if (!containerRef.current) return undefined
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width
      if (w) setContainerWidth(w)
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // One ResizeObserver per widget, so every real height change -- first
  // paint, a data reload, a cross-filter changing a table's row count --
  // updates ITS vertical position and whatever sits below it in the same
  // column, without touching anyone's column assignment.
  useEffect(() => {
    const observers = []
    itemRefs.current.forEach((node, id) => {
      if (!node) return
      const ro = new ResizeObserver((entries) => {
        const h = entries[0]?.contentRect?.height
        if (!h) return
        setHeights((prev) => (Math.abs((prev[id] || 0) - h) > 1 ? { ...prev, [id]: h } : prev))
      })
      ro.observe(node)
      observers.push(ro)
    })
    return () => observers.forEach((ro) => ro.disconnect())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey])

  const colWidth = containerWidth > 0 ? (containerWidth - gap * (COLUMNS - 1)) / COLUMNS : 0

  // PASS 1 -- stable. Only recomputed when the widget list or breakpoint
  // actually changes, never when live data (and therefore `heights`)
  // changes.
  const slots = useMemo(() => assignColumns(items, breakpoint, COLUMNS), [slotKey, breakpoint])

  // PASS 2 -- live. Recomputed whenever a widget's real height changes,
  // using the columns already fixed by PASS 1.
  const { positions, containerHeight } = useMemo(
    () => packMasonry(items, slots, heights, gap, COLUMNS),
    [items, slots, heights, gap]
  )

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      style={{ height: containerWidth > 0 ? containerHeight : undefined }}
    >
      {items.map((item) => {
        const p = positions[item.id]
        // Before the container's real width is known (the very first
        // frame), fall back to a plain stacked flow rather than positioning
        // everything at zero width in the top-left corner.
        if (!p || colWidth <= 0) {
          return (
            <div key={item.id} ref={(node) => itemRefs.current.set(item.id, node)} className="relative mb-3 w-full">
              {item.content}
            </div>
          )
        }
        const left = p.col * (colWidth + gap)
        const width = p.span * colWidth + (p.span - 1) * gap
        return (
          <div
            key={item.id}
            ref={(node) => itemRefs.current.set(item.id, node)}
            className="absolute transition-[top,left,width] duration-300 ease-out"
            style={{ top: p.top, left, width }}
          >
            {item.content}
          </div>
        )
      })}
    </div>
  )
}
