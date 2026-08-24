// ---------------------------------------------------------------------
// Charts that scroll instead of squashing
// ---------------------------------------------------------------------
// A chart of forty categories has two honest options and one dishonest one.
//
//   Honest: show the top N and say so. Honest: give every category the room
//   it needs and let the reader scroll to the end.
//
//   Dishonest: fit forty bars into the height of twelve. The bars become
//   hairlines, the axis silently drops four labels in five, and the reader
//   cannot tell whether the chart is showing everything or not -- which is
//   the part that matters, because they will assume it is.
//
// So a category gets a fixed amount of room, always. If they all fit, the
// chart looks exactly as it did. If they do not, the chart grows past its
// frame and the frame scrolls. Nothing is dropped and nothing is squashed,
// and the scrollbar is itself the signal that there is more.

export const CHART_SCROLL = {
  // Enough for a readable label and a bar that still reads as a bar.
  rowHeight: 30,
  // A vertical bar needs less, because its label runs along the axis rather
  // than beside it.
  colWidth: 48,
  // Below this a chart is a stub rather than a small chart.
  minSize: 120,
}

/**
 * How big a categorical chart wants to be, and whether that means scrolling.
 *
 * `frame` is the height the widget was given. A horizontal chart grows DOWN
 * past it (and the frame scrolls vertically); a vertical chart grows ACROSS
 * (and the frame scrolls horizontally), which is why only one of the two
 * numbers can ever exceed the frame.
 */
export function chartExtent({ count, horizontal = false, frame = 260, options = {} } = {}) {
  const o = { ...CHART_SCROLL, ...options }
  const n = Math.max(0, Number(count) || 0)
  const box = Math.max(o.minSize, Number(frame) || CHART_SCROLL.minSize)

  if (horizontal) {
    const wanted = n * o.rowHeight
    const height = Math.max(box, wanted)
    return { height, minWidth: 0, scrolls: height > box, axis: 'y' }
  }

  // Across, the frame is the card's width, which is not known here -- so the
  // answer is a MINIMUM width rather than an absolute one. A chart with room
  // to spare still fills its card; one without pushes past it and scrolls.
  //
  // `scrolls` is therefore false: whether it actually does is the browser's
  // business, and claiming to know would be worse than admitting we cannot.
  const minWidth = n * o.colWidth
  return { height: box, minWidth, scrolls: false, axis: 'x' }
}

/**
 * Whether every category should be labelled.
 *
 * Recharts thins axis labels out when they collide, which is right inside a
 * fixed frame and wrong once the chart has been given room for all of them --
 * there, a dropped label is a category the reader cannot name.
 */
export function labelEveryCategory(count, { horizontal = false, frame = 260, options = {} } = {}) {
  return chartExtent({ count, horizontal, frame, options }).scrolls
}

/**
 * The height a scrolling legend gets before it starts scrolling itself.
 *
 * Capped because a legend is a key, not the chart: forty series would push
 * the plot off the bottom of the card long before the reader ran out of
 * patience with the list.
 */
export function legendHeight(count, { rowHeight = 18, max = 84, min = 18 } = {}) {
  const n = Math.max(0, Number(count) || 0)
  if (n === 0) return min
  return Math.max(min, Math.min(max, n * rowHeight))
}
