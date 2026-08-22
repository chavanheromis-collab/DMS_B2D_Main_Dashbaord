/**
 * Orders widgets, most specific instruction winning:
 *
 *   1. the user's OWN arrangement          (dashboard "arrange" mode)
 *   2. the admin's order FOR THAT USER     (Users & Access)
 *   3. the admin's default for everyone    (Widgets panel)
 *   4. the order the widgets were added in
 *
 * The precedence is deliberate. An admin deciding a salesperson should see
 * the pipeline first is a legitimate instruction, so it beats the page
 * default -- but a person rearranging their own screen is not overriding
 * policy, it's a preference about their own eyes, so it still comes first.
 * (Nothing here decides what a user may SEE; that is `hiddenWidgets`, which
 * is enforced separately and cannot be undone from the dashboard.)
 *
 * Widgets nobody has numbered keep their relative positions and sit AFTER
 * numbered ones, so numbering one widget moves just that one and leaves
 * everything else exactly as it was.
 *
 * Lives in lib/ rather than beside the hook that uses it because it is pure:
 * no React, no Firestore, and therefore testable without standing up either.
 */
export function orderWidgets(widgets, widgetOrder = {}, assignedOrder = {}) {
  return [...(widgets || [])]
    .map((widget, index) => {
      const personal = widgetOrder?.[widget.id]
      const assigned = assignedOrder?.[widget.id]
      const adminOrder = Number.isFinite(widget.order) ? widget.order : null

      const rank = Number.isFinite(personal)
        ? personal
        : Number.isFinite(assigned)
          ? assigned
          : adminOrder
      return { widget, index, rank }
    })
    .sort((a, b) => {
      if (a.rank === null && b.rank === null) return a.index - b.index
      if (a.rank === null) return 1
      if (b.rank === null) return -1
      if (a.rank !== b.rank) return a.rank - b.rank
      // A stable tie-break on the admin's own list order, so two widgets
      // sharing a number never swap places between renders.
      return a.index - b.index
    })
    .map((entry) => entry.widget)
}
