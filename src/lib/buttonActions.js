// ---------------------------------------------------------------------
// A button that does something other than filter
// ---------------------------------------------------------------------
// A button on a dashboard used to mean exactly one thing: a set of
// conditions, on or off. That is a genuinely useful thing and it is not
// what most people mean when they ask for a button. They mean the row of
// things you want within reach of the numbers -- open last month's
// register, jump to the booking page, print this, refresh it, take me to
// the sheet. Every one of those was a link somebody kept in a browser tab
// instead, which is exactly the round trip a dashboard exists to remove.
//
// So a button has an ACTION, and filtering is one of them. The whole
// design rests on one distinction:
//
//   A FILTER BUTTON IS A TOGGLE. It goes on, it stays on, it narrows the
//   page, it counts as an active control, a saved view remembers it and
//   Reset clears it.
//
//   EVERY OTHER ACTION IS A ONE-SHOT. It fires and nothing stays behind.
//   It is never "on", never counted, never saved into a view, never
//   cleared by Reset -- and, most importantly, never handed to the filter
//   engine, which would otherwise be asked to evaluate a set of conditions
//   that does not exist.
//
// Getting that wrong is not cosmetic. A one-shot in the engine's button
// list is a control the page thinks is narrowing it; a one-shot counted as
// active is a "3 filters on" badge that sends somebody hunting for a
// filter they cannot find.

/** What a button does. `filter` is the original and stays the default. */
export const BUTTON_ACTIONS = [
  {
    value: 'filter',
    label: 'Filter the page',
    hint: 'A set of conditions, on or off — the original kind of button.',
    toggle: true,
  },
  {
    value: 'link',
    label: 'Open a link',
    hint: 'Any URL. A price list, a form, a WhatsApp chat, a phone number.',
    needs: 'url',
  },
  {
    value: 'page',
    label: 'Go to another page',
    hint: 'Another page of this dashboard.',
    needs: 'pageId',
  },
  {
    value: 'space',
    label: 'Switch dashboard',
    hint: 'Another dashboard this person can open.',
    needs: 'spaceId',
  },
  {
    value: 'view',
    label: 'Apply a saved view',
    hint: 'Set every control at once, the way a saved view does.',
    needs: 'viewId',
  },
  {
    value: 'widget',
    label: 'Jump to a widget',
    hint: 'Scroll the page to one card. For a long report.',
    needs: 'widgetId',
  },
  { value: 'reset', label: 'Clear every filter', hint: 'The same as the Reset button on the bar.' },
  { value: 'refresh', label: 'Refresh the data', hint: 'Re-read every tab from Google.' },
  { value: 'print', label: 'Print / save as PDF', hint: 'Opens the print view of this page.' },
  {
    value: 'fullscreen',
    label: 'Presentation mode',
    hint: 'Fills the screen. For a wall display or a meeting.',
  },
  {
    value: 'sheet',
    label: 'Open the spreadsheet',
    hint: 'The Google Sheet behind a tab, in a new tab of the browser.',
    needs: 'sheetRef',
  },
  {
    value: 'none',
    label: 'A switch that filters nothing',
    hint: 'On or off, and it narrows no data. Widgets can be shown or hidden by it under their own Visibility.',
    toggle: true,
  },
]

export const ACTION_VALUES = BUTTON_ACTIONS.map((a) => a.value)

export function actionMeta(action) {
  return BUTTON_ACTIONS.find((a) => a.value === action) || BUTTON_ACTIONS[0]
}

/**
 * What this button does.
 *
 * `filter` unless somebody said otherwise, so every button that existed
 * before actions did behaves exactly as it did -- including the ones
 * saved with no `action` field at all.
 */
export function buttonAction(control) {
  const asked = control?.action
  return ACTION_VALUES.includes(asked) ? asked : 'filter'
}

/**
 * Is this button a toggle that narrows the page?
 *
 * The one question everything else turns on. Only a filter button is: the
 * rest fire and leave nothing behind.
 */
export function isFilterButton(control) {
  return control?.kind === 'button' && buttonAction(control) === 'filter'
}

/** ...and the other way round, which reads better at several call sites. */
export function isActionButton(control) {
  return control?.kind === 'button' && buttonAction(control) !== 'filter'
}

/**
 * A switch that narrows nothing.
 *
 * It goes on and off like a filter button and no row is affected by
 * either state. That sounds like a button with nothing behind it, and it
 * is the opposite: what reads it is WIDGET VISIBILITY, which already asks
 * "which buttons are on" (see `rule.buttonIds` in lib/visibility.js). So
 * this is how a page gets "show the finance section" -- one switch, and
 * the widgets that belong to it appear -- without inventing a filter that
 * matches every row just to have something to point at.
 *
 * Useful with no rule pointing at it, too: a place on the bar to mark
 * that this batch has been checked, which the next person can see.
 */
export function isPlainSwitch(control) {
  return control?.kind === 'button' && buttonAction(control) === 'none'
}

/**
 * Does this button REMEMBER being pressed?
 *
 * A filter button and a plain switch do; every other action is a one-shot
 * that fires and leaves nothing behind. This is the line that decides
 * which buttons can start on, count as set, be remembered by a saved view
 * and be cleared by Reset -- all of which are questions about state, and
 * none of which a one-shot has an answer to.
 *
 * It is NOT the line that decides what reaches the filter engine. Only a
 * filter button does, because only a filter button has conditions.
 */
export function holdsState(control) {
  return isFilterButton(control) || isPlainSwitch(control)
}

/** Which field this action needs filled in, or '' when it needs none. */
export function actionNeeds(control) {
  return actionMeta(buttonAction(control)).needs || ''
}

/**
 * Why this button will not do anything yet, or '' when it is ready.
 *
 * Said in the editor, at the moment it is set up. A button whose target
 * was never chosen is discovered by whoever presses it, which is a week
 * later and somebody else.
 */
export function actionProblem(control) {
  const action = buttonAction(control)
  const needs = actionNeeds(control)
  if (!needs) return ''
  const value = String(control?.[needs] ?? '').trim()
  if (!value) {
    switch (action) {
      case 'link':
        return 'Paste the address this should open.'
      case 'page':
        return 'Pick the page it goes to.'
      case 'space':
        return 'Pick the dashboard it switches to.'
      case 'view':
        return 'Pick the saved view it applies.'
      case 'widget':
        return 'Pick the widget it scrolls to.'
      case 'sheet':
        return 'Pick which tab’s spreadsheet to open.'
      default:
        return 'This action needs a target.'
    }
  }
  if (action === 'link' && !linkHref(value)) {
    return 'That does not look like an address. Start it with https:// (or tel: / mailto: / whatsapp:).'
  }
  return ''
}

export const actionIsReady = (control) => actionProblem(control) === ''

// ---------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------

/** The schemes a button may open. */
const SCHEMES = ['http:', 'https:', 'mailto:', 'tel:', 'sms:', 'whatsapp:']

/**
 * The address to open, or '' if it is not one we will open.
 *
 * An allow-list rather than a block-list, and it exists for one reason:
 * `javascript:` in an href is a script running with the page's own
 * privileges, written by whoever could edit the dashboard. Admins are
 * trusted, but "the admin panel is a place to put script into everybody
 * else's browser" is not a property worth having.
 *
 * A bare `example.com` is read as https, because that is what somebody
 * pasting a domain means and refusing it teaches nothing.
 */
export function linkHref(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return ''

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  try {
    const url = new URL(withScheme)
    return SCHEMES.includes(url.protocol.toLowerCase()) ? url.href : ''
  } catch {
    return ''
  }
}

/**
 * Does this open somewhere else, or take over the page?
 *
 * A new tab by default: a dashboard on a showroom screen that navigates
 * away to a price list is a dashboard somebody has to find their way back
 * to. `tel:` and the like are the exception -- those hand off to another
 * application and a blank tab left behind is litter.
 */
export function opensNewTab(control) {
  const url = linkHref(control?.url)
  if (!url) return false
  if (/^(tel|sms|mailto|whatsapp):/i.test(url)) return false
  return control?.sameTab !== true
}
