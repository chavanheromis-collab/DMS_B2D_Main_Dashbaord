// ---------------------------------------------------------------------
// What a widget shows above the thing it is showing
// ---------------------------------------------------------------------
// Every widget carries a title, an icon before it and a line of caption
// under it saying which tab and column it reads. That is right for a page
// somebody is exploring and wrong for several other real pages:
//
//   A ROW OF KPIs whose titles already say what they are. The emoji and
//   "MASTER · by Model" under each one is three lines of chrome around one
//   number.
//
//   A PRESENTED PAGE, where the widget is the picture and the caption is a
//   note to the person who built it.
//
//   A LABELLED GROUP, where a heading widget names five cards below it and
//   each card repeating a version of that heading is noise.
//
// So each of the three is a switch, and each is OFF by default -- meaning
// everything shows, exactly as it always has. Nothing about an existing
// page changes until somebody turns one off.
//
// Applied as CLASSES ON THE CARD rather than as a branch inside every
// widget. Nineteen widgets draw a header and every one of them draws it a
// little differently -- some with an export button beside it, some with a
// live count, one with a search box -- so a rule that hides a part of it is
// one rule, while a prop threaded into nineteen render functions is
// nineteen chances to miss one.

/** The switches, as the editor offers them. */
export const CHROME_TOGGLES = [
  {
    field: 'hideTitle',
    label: 'Hide the title',
    hint: 'For a card whose number speaks for itself, or one under a heading that already names it.',
  },
  {
    field: 'hideIcon',
    label: 'Hide the icon',
    hint: 'The emoji before the title.',
  },
  {
    field: 'hideCaption',
    label: 'Hide the sub-title',
    hint: 'The small line saying which tab and column this reads.',
  },
]

/**
 * The classes that hide what this widget has switched off.
 *
 * Empty for a widget nobody has touched, which is the overwhelming majority
 * of them -- so the class attribute on a normal card is exactly what it was.
 */
export function chromeClass(widget) {
  const out = []
  if (widget?.hideTitle) out.push('chrome-no-title')
  if (widget?.hideIcon) out.push('chrome-no-icon')
  if (widget?.hideCaption) out.push('chrome-no-caption')
  return out.join(' ')
}

/** Is anything hidden at all? Used to mark the editor's section. */
export function chromeIsTrimmed(widget) {
  return CHROME_TOGGLES.some((t) => Boolean(widget?.[t.field]))
}
