// ---------------------------------------------------------------------
// A widget inside a widget
// ---------------------------------------------------------------------
// One chart of company totals, and behind it the same chart per region, per
// branch, per model. Laid side by side on one page that is thirty cards and
// no story; laid one level down it is a headline you can open.
//
// So a widget can own widgets. Opening one REPLACES the page with its own,
// the way opening a folder replaces the listing: the level you left is a
// breadcrumb, not something still on screen competing for the eye. This is
// the same shape the pipeline's sub-stages take (lib/pipelineNav.js), one
// storey up -- and deliberately so, because two different answers to "what
// happens when I click the thing that has things inside it" is one answer
// too many.
//
// A child is an ORDINARY widget. Not a special kind, not a reduced kind: the
// same object the page stores, so every editor, every control, every style
// and every widget type that exists works inside as it does outside, with
// nothing to keep in step.
//
// Pure: widgets and a path in, widgets and a path out. No rows, no React.

/**
 * How deep the nesting may go.
 *
 * Three, because a breadcrumb of four is a reader who has forgotten where
 * they came from, and because a page that needs a fourth level is a page
 * that wanted to be two pages.
 */
export const MAX_WIDGET_DEPTH = 3

export const childWidgets = (widget) => (widget?.widgets || []).filter(Boolean)
export const hasChildren = (widget) => childWidgets(widget).length > 0

/**
 * The widgets named by a path, as objects.
 *
 * Ids go stale: an admin deletes a widget while somebody is inside it, a
 * saved link names one that no longer exists. Resolving stops at the first
 * id it cannot find and returns the part that IS real, so a deleted widget
 * puts the reader back at its parent rather than in front of a blank page.
 */
export function widgetPath(widgets, path) {
  const chain = []
  let level = widgets || []
  for (const id of path || []) {
    const found = level.find((w) => w?.id === id)
    if (!found) break
    chain.push(found)
    level = childWidgets(found)
  }
  return chain
}

/** The widgets to draw for a path -- the page's own, or the last one's. */
export function widgetsAt(widgets, path) {
  const chain = widgetPath(widgets, path)
  return chain.length ? childWidgets(chain[chain.length - 1]) : widgets || []
}

/** The path as it actually resolved, for putting back into state. */
export function liveWidgetPath(widgets, path) {
  return widgetPath(widgets, path).map((w) => w.id)
}

/**
 * Opening a widget.
 *
 * An admin may open one that is still empty -- that is how the first child
 * gets added, since the way in has to exist before there is anything behind
 * it. A reader may not: an empty level is a blank page and a dead end.
 */
export function descendWidget(widgets, path, id, { allowEmpty = false } = {}) {
  const level = widgetsAt(widgets, path)
  const widget = level.find((w) => w?.id === id)
  if (!widget) return path
  if (!allowEmpty && !hasChildren(widget)) return path
  if ((path?.length || 0) + 1 > MAX_WIDGET_DEPTH) return path
  return [...(path || []), id]
}

/** Going back up. `-1` is the page itself, `0` the first crumb, and so on. */
export function ascendWidget(path, index) {
  return (path || []).slice(0, Math.max(0, index + 1))
}

/**
 * A whole tree with the list at `path` replaced.
 *
 * Every edit on the page -- adding, reordering, resizing, deleting, styling
 * -- writes ONE array back to Firestore: the page's widgets. Inside a
 * widget, the array being edited is several levels down, so it has to be
 * rebuilt on the way out. This is that rebuild, and it is the only place
 * that knows how, which is why nothing else has to.
 */
export function replaceAt(widgets, path, nextLevel) {
  const list = widgets || []
  if (!path || path.length === 0) return nextLevel

  const [head, ...rest] = path
  let touched = false
  const out = list.map((w) => {
    if (w?.id !== head) return w
    touched = true
    return { ...w, widgets: replaceAt(childWidgets(w), rest, nextLevel) }
  })

  // A path that names nothing writes nothing. Appending the level to the
  // top would silently move every child widget onto the page.
  return touched ? out : list
}

/**
 * The same, as a function of the level rather than a replacement for it.
 *
 * The shape every caller actually wants: "map over the widgets on screen and
 * give me the whole page back".
 */
export function editLevel(widgets, path, fn) {
  return replaceAt(widgets, path, fn(widgetsAt(widgets, path)) || [])
}

/** A widget anywhere in the tree, by id. */
export function findWidget(widgets, id) {
  for (const widget of widgets || []) {
    if (widget?.id === id) return widget
    const found = findWidget(childWidgets(widget), id)
    if (found) return found
  }
  return null
}

/**
 * What a widget's chip says.
 *
 * A count, because the reader is deciding whether opening it is worth
 * losing the page for, and "some" is not an answer to that. No plural to
 * get right -- "inside" is the same word either way.
 */
export function insideLabel(widget) {
  return `${childWidgets(widget).length} inside`
}
