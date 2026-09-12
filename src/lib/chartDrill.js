// ---------------------------------------------------------------------
// Clicking the words on a chart
// ---------------------------------------------------------------------
// Clicking a BAR has always filtered the page. Clicking the name under
// the bar did nothing -- and so did clicking the name beside a funnel
// step, or the label on a pie slice. Which is a strange thing to defend:
// to the person reading the chart, "Nashik" under the bar and the bar
// above it are the same thing, and the one they aim at is whichever is
// bigger. On a chart of eleven thin bars, that is the word.
//
// The reason it did not work is worth writing down, because it is not
// laziness. Recharts computes what was clicked from the POINTER
// POSITION, and only inside the plotting rectangle:
//
//     if (!inRange(chartX, chartY)) return null      // generateCategoricalChart
//
// An axis label is drawn below or beside that rectangle, so every click
// on one resolved to nothing at all. The fix is not to widen the
// rectangle -- that would make the empty margin clickable too -- but to
// let the axis speak for itself.
//
// Which it can: recharts maps an axis's own event handlers onto each
// tick, with that tick's entry.
//
//     adaptEventsOfChild(this.props, entry, i)       // CartesianAxis, PolarAngleAxis
//
// So `<XAxis onClick={...}>` fires per tick, knowing which one. No
// custom tick renderer, which matters: a custom renderer would have to
// reproduce recharts' own rotation, anchoring and wrapping, and getting
// that subtly wrong on eight chart types is a worse outcome than the
// thing it was fixing.

/** What the axis marks a tick as, or '' -- the label is data, not decor. */
export function tickCategory(entry) {
  const value = entry?.value
  if (value === undefined || value === null) return ''
  return String(value)
}

/**
 * A piece of chart text, resolved back to a category that really exists.
 *
 * For the labels that are drawn by hand rather than by an axis -- a pie
 * slice's label, the name beside a funnel step -- where all that is to
 * hand at click time is what the text says.
 *
 * Matched against the data rather than trusted, and that is the whole
 * point of the function: a label is often shortened to fit ("Maharashtra
 * Reg…"), and filtering by what a truncated label happens to say would
 * filter to nothing while looking like it worked. An exact match filters;
 * anything else does nothing, which is the honest answer.
 */
export function matchCategory(text, data) {
  const wanted = String(text ?? '').trim()
  if (!wanted) return ''
  const hit = (data || []).find((d) => String(d?.name ?? '') === wanted)
  return hit ? String(hit.name) : ''
}

/**
 * The class that makes an axis's labels look clickable.
 *
 * On the axis rather than on each tick, because recharts merges a
 * className onto the axis layer and then owns the ticks inside it -- so
 * the stylesheet reaches them and nothing here has to re-render a label
 * to give it a cursor. See index.css.
 */
export const AXIS_CLICK_CLASS = 'chart-axis-click'

/**
 * Everything a category axis needs to become clickable, or nothing.
 *
 * Returned as a props object so the axes stay one-liners and cannot
 * disagree with each other about what a clickable axis is -- there are
 * six of them across the chart types, and six copies of two props is
 * five chances to leave one out.
 *
 * `onDrill` absent means the page has no cross-filtering on, and then an
 * axis must not offer a pointer for something that will not happen.
 */
export function axisClickProps(onDrill) {
  if (typeof onDrill !== 'function') return {}
  return {
    className: AXIS_CLICK_CLASS,
    onClick: (entry) => onDrill(tickCategory(entry)),
  }
}
