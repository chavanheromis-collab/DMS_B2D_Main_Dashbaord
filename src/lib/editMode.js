// ---------------------------------------------------------------------
// Editing a page on the page
// ---------------------------------------------------------------------
// A dashboard is a thing you look at, so it opens as one: view mode, for
// everybody including the admin who built it. Edit mode is a switch, not a
// separate screen, because "go to the admin panel, change a number, save,
// come back, squint" is four steps of which three are travel.
//
// The hard part is not the editing. It is seeing what you changed: an
// editor that covers the thing it edits makes you change something, close
// it, look, and open it again. So the page and the editor are two panes of
// a split (lib/editLayout.js), and what this file owns is the other half of
// the answer -- the unsaved edit, merged over the saved widget everywhere
// the page reads one, so the preview is the page's own render rather than a
// second opinion about it.
//
// Pure: widgets in, widgets out. No DOM, no React.

/**
 * The widget list as the page should DRAW it while something is being
 * edited: the saved widgets, with the unsaved edit merged over the top.
 *
 * This is what makes the change visible before it is written. The draft is
 * merged rather than replacing the widget, so a form that only knows about
 * three fields cannot drop the other forty.
 */
export function mergeDraft(widgets, id, patch) {
  if (!id || !patch) return widgets || []
  return (widgets || []).map((w) => (w.id === id ? { ...w, ...patch } : w))
}

/**
 * Is this widget the one being edited?
 *
 * A tiny function with a name, because `id && id === editing` reads as a
 * boolean expression and `isEditing(widget, editing)` reads as a question.
 */
export function isEditing(widget, editingId) {
  return Boolean(editingId) && widget?.id === editingId
}
