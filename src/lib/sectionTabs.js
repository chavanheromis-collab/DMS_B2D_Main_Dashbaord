// ---------------------------------------------------------------------
// A long form as a row of buttons
// ---------------------------------------------------------------------
// A widget has a setup, its own controls, a blend, a look and a couple of
// behaviours. Stacked as five open sections that is a form nobody can see
// the end of, and finding the one you came for means scrolling past four
// you did not.
//
// The catch with hiding things behind buttons is that a setting nobody can
// see is a setting nobody remembers making. So a section holding something
// carries a MARK, and the row says what is CONFIGURED as well as what
// exists -- which the stack of open sections never did.
//
// Pure, so the two decisions worth arguing about can be argued about in a
// test rather than in a browser.

/** The dot or count on a section button, or null for "nothing to say". */
export function sectionMark(badge) {
  // `true` means "there is something here" without a number worth printing:
  // a blend is on or off, a look is custom or stock.
  if (badge === true) return '•'

  // A count of ZERO is a real answer and it is "none" -- marking it would
  // mean every widget on the page claimed to have controls it does not.
  const n = Number(badge)
  return Number.isFinite(n) && n > 0 ? String(n) : null
}

/**
 * The sections actually worth drawing buttons for.
 *
 * Falsy entries are dropped so a caller can write a section as
 * `condition && {...}` inline, and one section is not a choice -- a lone
 * button that cannot be turned off is a label pretending to be a control.
 */
export function visibleSections(sections) {
  const shown = (sections || []).filter(Boolean)
  return shown.length < 2 ? [] : shown
}

/**
 * The section to show, given what was picked.
 *
 * A pick that no longer exists falls back to the first rather than to a
 * blank panel -- a widget can change type, and the section it was open at
 * may not survive that.
 */
export function activeSection(sections, picked) {
  const shown = visibleSections(sections)
  if (shown.length === 0) return picked ?? null
  return shown.some((s) => s.key === picked) ? picked : shown[0].key
}
