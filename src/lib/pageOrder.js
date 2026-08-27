// ---------------------------------------------------------------------
// Putting the pages in the order somebody wants them
// ---------------------------------------------------------------------
// The sidebar is the only place the order of pages is visible, so it is the
// only place worth reordering them from. Pick one up, drop it where it
// belongs, done -- rather than opening another screen and typing numbers
// into sixteen boxes that only mean something relative to each other.
//
// The order written back is DENSE and starts at zero. Pages arrive with
// whatever numbers history gave them -- gaps, ties, `undefined` on anything
// created before the field existed -- and a drag that preserved those would
// be a drag whose result depended on data nobody can see. Renumbering the
// list it touched makes every subsequent drag land exactly where it looks
// like it will.
//
// Only what actually MOVED is written. Dropping a page back where it started
// is a no-op, and a no-op should not be sixteen document writes.
//
// Pure: a list and two ids in, a list of {id, order} in need of saving out.

/** Where a page sits, for anything that has to compare two of them. */
export function orderOf(page) {
  return Number.isFinite(Number(page?.order)) ? Number(page.order) : null
}

/**
 * The list, with `movedId` put where `targetId` is.
 *
 * Dropping onto a page always means "take its place": the one being dropped
 * on, and everything after it, shuffles down. That is what a gap opening
 * under the cursor looks like, and matching the picture is worth more than
 * any cleverness about which side of the target the pointer was on.
 */
export function reorder(pages, movedId, targetId) {
  const list = [...(pages || [])]
  const from = list.findIndex((p) => p?.id === movedId)
  const to = list.findIndex((p) => p?.id === targetId)
  if (from === -1 || to === -1 || from === to) return list

  const [moved] = list.splice(from, 1)
  list.splice(to, 0, moved)
  return list
}

/**
 * What has to be written after a drag: the pages whose number changed.
 *
 * Dense from zero, and only the ones that moved -- see the header. A page
 * that was already numbered what it is about to be numbered is left alone,
 * which is what makes dropping something back where it came from free.
 */
export function orderUpdates(ordered) {
  const out = []
  ;(ordered || []).forEach((page, at) => {
    if (!page?.id) return
    if (orderOf(page) === at) return
    out.push({ id: page.id, order: at })
  })
  return out
}

/**
 * The whole answer for one drag: the new list, and what to save.
 *
 * Returned together because a caller that took only the updates would have
 * to re-derive the list to draw it, and a caller that took only the list
 * would have to work out the writes -- and the two derivations would be two
 * chances to disagree.
 */
export function dragPages(pages, movedId, targetId) {
  const ordered = reorder(pages, movedId, targetId)
  const updates = orderUpdates(ordered)

  // Dropped into another group's list, it joins that group. The list you
  // dropped it into IS the group -- leaving it out would send it straight
  // back where it came from the moment the sidebar redrew, which reads as
  // the drag having failed.
  const moved = ordered.find((p) => p?.id === movedId)
  const target = (pages || []).find((p) => p?.id === targetId)
  if (moved && target && (moved.group || '') !== (target.group || '')) {
    const group = target.group || ''
    const already = updates.find((u) => u.id === movedId)
    if (already) already.group = group
    else updates.push({ id: movedId, order: ordered.indexOf(moved), group })
  }

  return { pages: ordered, updates }
}

/**
 * Is this drop worth doing at all?
 *
 * A page dropped on itself, or dragged from nowhere, is a click that took a
 * scenic route.
 */
export function canDrop(movedId, targetId) {
  return Boolean(movedId) && Boolean(targetId) && movedId !== targetId
}

/**
 * Pages, in the order this person should see them.
 *
 * The same two-level rule widget order has already: a personal arrangement
 * beats the workspace default, and pages nobody has numbered keep their
 * relative places AFTER the numbered ones -- so moving one page moves that
 * one and leaves everything else where it was.
 *
 * The personal order is the whole point of "sorted for any user": a rep who
 * lives in two of nine dashboards can put those two at the top without
 * asking anybody, and without changing what anybody else sees.
 */
export function orderPages(pages, personal = {}) {
  return [...(pages || [])]
    .map((page, index) => {
      const mine = Number(personal?.[page?.id])
      const chosen = Number.isFinite(mine)
      return {
        page,
        index,
        chosen,
        rank: chosen ? mine : orderOf(page),
      }
    })
    .sort((a, b) => {
      if (a.rank === null && b.rank === null) return a.index - b.index
      if (a.rank === null) return 1
      if (b.rank === null) return -1
      if (a.rank !== b.rank) return a.rank - b.rank
      // Same number, and one of them was CHOSEN by this person while the
      // other merely inherited it. An explicit instruction beats a default,
      // which is what makes moving a single page move that page.
      if (a.chosen !== b.chosen) return a.chosen ? -1 : 1
      // A stable tie-break on the list order, so two pages sharing a number
      // never swap places between renders.
      return a.index - b.index
    })
    .map((entry) => entry.page)
}

/**
 * The personal order after one drag: a plain { pageId: position } map.
 *
 * Dense from zero and covering every page shown, because a personal order
 * that only named the pages somebody moved would leave the rest sorted by
 * the workspace default -- and the two orders interleaved is neither.
 */
export function personalOrder(ordered) {
  const out = {}
  ;(ordered || []).forEach((page, at) => {
    if (page?.id) out[page.id] = at
  })
  return out
}
