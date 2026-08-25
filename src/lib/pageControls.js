import { uid } from './config.js'
import { bucketedValues, shownValue } from './dataUtils.js'
import { applyFilters, filterIsActive } from './filterEngine.js'

// ---------------------------------------------------------------------
// Page controls — one list, every kind
// ---------------------------------------------------------------------
// Filters and buttons used to be two separate admin sections and two
// separate arrays, which forced an artificial split: a "Status" dropdown and
// a "Pending invoices" button do the same job for the person using the
// dashboard -- narrow what I'm looking at -- and being unable to sit them
// next to each other, or order them together, was a limitation of the model
// rather than a real distinction.
//
// They are now ONE ordered list. The engine still receives them split apart
// (see `splitControls`) because a filter and a button genuinely evaluate
// differently, but nothing above that layer has to care.

export const CONTROL_GROUPS = [
  {
    label: 'Pick a value',
    kinds: [
      { value: 'select', label: 'Dropdown', icon: '▾', needsColumn: true },
      { value: 'multi', label: 'Dropdown (multi-choice)', icon: '☰', needsColumn: true },
      { value: 'chips', label: 'Chips', icon: '◍', needsColumn: true },
    ],
  },
  {
    label: 'Type or search',
    kinds: [{ value: 'text', label: 'Text search box', icon: '⌕', needsColumn: true }],
  },
  {
    label: 'Sliders',
    kinds: [
      { value: 'slider', label: 'Number range (two handles)', icon: '⇔', needsColumn: true },
      { value: 'threshold', label: 'Single threshold (≥ / ≤)', icon: '→', needsColumn: true },
      { value: 'stepper', label: 'Stepped bands', icon: '⋯', needsColumn: true },
      { value: 'dateslider', label: 'Last N days', icon: '↺', needsColumn: true },
    ],
  },
  {
    label: 'Dates & numbers',
    kinds: [
      { value: 'date', label: 'Date range', icon: '📅', needsColumn: true },
      { value: 'number', label: 'Number range (min / max boxes)', icon: '#', needsColumn: true },
    ],
  },
  {
    label: 'Actions',
    kinds: [{ value: 'button', label: 'Condition button', icon: '⏻' }],
  },
]

/** Flat list of every control kind, for pickers and lookups. */
export const ALL_CONTROL_KINDS = CONTROL_GROUPS.flatMap((g) =>
  g.kinds.map((k) => ({ ...k, group: g.label }))
)

export function kindMeta(kind) {
  return ALL_CONTROL_KINDS.find((k) => k.value === kind) || ALL_CONTROL_KINDS[0]
}

export function kindNeedsColumn(kind) {
  return kindMeta(kind).needsColumn === true
}

export const isButton = (control) => control?.kind === 'button'

/**
 * The values a control offers.
 *
 * Both the bar and the filter panel ask this, so a control bucketed by year
 * cannot list months in one place and days in the other -- and neither has
 * to know what bucketing is.
 */
/**
 * Every column a control reads. One, unless the admin joined several.
 *
 * `column` stays the first of them, so nothing that only knows about a
 * single-column control -- the reach rules, the coverage report, a saved
 * page written last year -- has to learn a second shape.
 */
export function controlColumns(control) {
  const many = (control?.columns || []).filter(Boolean)
  const single = control?.column ? [control.column] : []
  if (!many.length) return single

  // Joining is a decision somebody makes, not one inferred from the fact
  // that a list has two things in it. `concat` is that decision -- so an
  // admin can pick the columns, look at the result, and turn it off again
  // without losing what they picked.
  //
  // A page saved before the switch existed said "join" by having a list at
  // all, so an absent flag means exactly what it used to -- including the
  // odd shapes, like a one-entry list naming a different column from
  // `column`. Only an explicit `false` collapses back to the single one.
  const on = control?.concat === undefined ? many.length > 0 : control.concat === true
  return on ? many : single
}

export const DEFAULT_JOIN = ' · '

export function controlOptions(control, rows, dateOrder = 'DMY', selected) {
  const columns = controlColumns(control)

  // A joined control lists the combinations that EXIST, not the product of
  // every value of every column -- three regions and forty names would
  // otherwise offer a hundred and twenty options, most of them empty.
  const options =
    columns.length > 1
      ? Array.from(new Set((rows || []).map((row) => shownValue(row, control, dateOrder))))
          .filter(Boolean)
          .sort(new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare)
      : bucketedValues(rows, columns[0], control, dateOrder)

  // A value that is CURRENTLY SELECTED always stays on the list, even after
  // the other filters have narrowed it out of existence. Without this rule,
  // picking two things that do not overlap makes one of them vanish while it
  // is still filtering the page -- the reader can see an empty dashboard and
  // no way to undo what emptied it.
  const kept = (Array.isArray(selected) ? selected : selected ? [selected] : [])
    .map((v) => String(v).trim())
    .filter((v) => v && !options.includes(v))

  return kept.length ? [...options, ...kept] : options
}

/**
 * The rows a control should read its OPTIONS from.
 *
 * Everything the page is filtered by, except this control itself. A Region
 * of "West" should leave the DSE list showing only DSEs who sell in the
 * west -- otherwise every other name on that list is a trap that empties
 * the dashboard. But it must not narrow ITS OWN list, or picking West would
 * leave "West" as the only region on offer and no way back.
 *
 * `independent` opts a control out: some lists are a reference (every branch
 * we have, whether or not it sold anything this month) and shrinking them
 * hides the zeroes that matter.
 */
export function optionRows(control, { rows, filters, ...rest }) {
  if (!control || control.independent) return rows
  return applyFilters(rows, { ...rest, filters: (filters || []).filter((f) => f.id !== control.id) })
}

/**
 * Which chips to draw, and how many are being held back.
 *
 * Every value, unless the admin capped it. A cap used to be the default and
 * the invisible kind -- twelve chips drawn out of ninety, with nothing on
 * screen saying so, which is the failure mode this codebase keeps finding
 * and removing. A capped list now says what it is holding back; an uncapped
 * one scrolls.
 */
export function visibleChips(options, maxChips) {
  const all = options || []
  const cap = Number(maxChips) > 0 ? Number(maxChips) : 0
  if (!cap || all.length <= cap) return { shown: all, hidden: 0 }
  return { shown: all.slice(0, cap), hidden: all.length - cap }
}

// ---------------------------------------------------------------------
// What a control IS to the person looking at the page
// ---------------------------------------------------------------------
// Three states, not two. "Hidden" used to mean parked -- switched off
// without being deleted -- which left no way to express the other thing an
// admin frequently wants: a filter that is always on, applies to the whole
// page, and that nobody can see or undo. "This page is the Pune branch."
// "This page never shows cancelled orders."
//
// That is not a default value on a visible control: a default can be changed
// and a Reset would put it back to something the admin never intended to
// offer. It is a property of the PAGE that happens to be expressed as a
// filter -- so it is applied like one, and shown like nothing.

export const CONTROL_MODES = [
  { value: 'live', label: 'On the page — anyone can change it' },
  { value: 'fixed', label: 'Fixed — always applied, never shown' },
  { value: 'off', label: 'Parked — not shown, not applied' },
]

/** `hidden` is the old spelling of "parked", and still readable. */
export function controlMode(control) {
  if (control?.mode === 'fixed' || control?.mode === 'off' || control?.mode === 'live') return control.mode
  return control?.hidden ? 'off' : 'live'
}

export const isFixed = (control) => controlMode(control) === 'fixed'

/**
 * The values a fixed control forces, whatever else is in play.
 *
 * Applied over the user's state at filter time rather than merged into it
 * once, so nothing downstream -- a saved view, a stale value from before the
 * admin fixed it, a future feature nobody has written yet -- can quietly
 * override a page's own rules.
 */
export function fixedValues(controls) {
  return initialValues((controls || []).filter(isFixed), { includeFixed: true })
}

// ---------------------------------------------------------------------
// Width
// ---------------------------------------------------------------------
// Controls are sized in exact pixels, set per control by the admin. A
// dashboard's control bar is a layout the admin is composing, and "medium"
// is not an answer to "will these four controls fit on one row above the
// chart" -- a number is.

/** What the old named sizes were, in px, so existing pages don't resize. */
const PRESET_WIDTHS = { sm: 144, md: 208, lg: 288 }

export const WIDTH_PRESETS = [
  { label: 'Fit', px: null },
  { label: '120', px: 120 },
  { label: '160', px: 160 },
  { label: '200', px: 200 },
  { label: '260', px: 260 },
  { label: '320', px: 320 },
  { label: '420', px: 420 },
]

/**
 * A control's width in pixels, or `null` to fit its contents.
 *
 * Reads `widthPx` first and falls back to the named size a page may have
 * been saved with, so upgrading changes nothing on screen until an admin
 * actually types a number.
 */
export function controlWidth(control) {
  const px = Number(control?.widthPx)
  if (Number.isFinite(px) && px > 0) return Math.min(1200, Math.max(60, px))
  return PRESET_WIDTHS[control?.width] ?? null
}

// ---------------------------------------------------------------------
// Reading a page
// ---------------------------------------------------------------------
/**
 * The page's controls as one ordered list.
 *
 * A page saved before the merge has `filters[]` and `buttons[]` instead, so
 * those are stitched together on read. Nothing rewrites the stored document
 * until an admin saves the Controls panel -- an upgrade must never silently
 * modify data just because someone opened a page.
 */
export function normalizeControls(page) {
  if (Array.isArray(page?.controls)) return page.controls

  return [
    ...(page?.filters || []).map((f) => ({ ...f, kind: f.kind || 'select' })),
    ...(page?.buttons || []).map((b) => ({ ...b, kind: 'button' })),
  ]
}

/**
 * Splits the unified list back into what the filter engine expects.
 *
 * The engine keeps its two-argument shape deliberately: a filter tests one
 * column against a value, a button tests a whole condition set, and merging
 * those evaluations would make both harder to follow for no gain. The
 * unification is a modelling and UI decision, not an evaluation one.
 */
export function splitControls(controls) {
  const list = controls || []
  return {
    filters: list.filter((c) => c.kind && c.kind !== 'button'),
    buttons: list.filter(isButton),
  }
}

/** Controls shown up front, vs. those behind "More filters". */
export function partitionByProminence(controls) {
  const visible = []
  const advanced = []
  for (const control of controls || []) {
    // A fixed control is not "behind More" -- it is not on the page at all.
    if (controlMode(control) !== 'live') continue
    ;(control.advanced ? advanced : visible).push(control)
  }
  return { visible, advanced }
}

/** Is this control currently narrowing anything? */
export function controlActive(control, values, activeButtonIds) {
  if (isButton(control)) return (activeButtonIds || []).includes(control.id)
  return filterIsActive(control, values?.[control.id])
}

/**
 * How many controls are doing something right now.
 *
 * Fixed ones are excluded deliberately: the count exists so a reader knows
 * how much of what they see is their own doing and can undo it. Counting a
 * rule they cannot see, cannot reach and cannot clear would send them
 * hunting for a control that does not exist.
 */
export function activeCount(controls, values, activeButtonIds) {
  return (controls || [])
    .filter((c) => controlMode(c) === 'live')
    .filter((c) => controlActive(c, values, activeButtonIds)).length
}

// ---------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------
// A view is a named snapshot of every control's value -- "This month's
// pending invoices" as one click rather than six. Admins define them; users
// apply them.
//
// Stored as { values, buttons } rather than as a list of conditions, so a
// view keeps working when an admin later re-tunes what a control does.

export function emptyView(label = 'New view') {
  return { id: uid('v'), label, icon: '', color: '#4F46E5', values: {}, buttons: [] }
}

/** Snapshots the current control state into a view definition. */
export function captureView(values, activeButtonIds, controls) {
  // Fixed controls are the page's own rules, not part of any view: a view
  // that carried them could be used to turn one off by saving it while it
  // was momentarily absent.
  const ids = new Set((controls || []).filter((c) => !isFixed(c)).map((c) => c.id))
  const kept = {}
  for (const [id, value] of Object.entries(values || {})) {
    // Only keep values belonging to controls that still exist, or a view
    // would quietly accumulate settings for controls long since deleted.
    if (ids.has(id)) kept[id] = value
  }
  return { values: kept, buttons: (activeButtonIds || []).filter((id) => ids.has(id)) }
}

/**
 * Is this view the state the dashboard is currently in? Used to light up the
 * button so a user can see which view they're looking at.
 */
export function viewIsActive(view, values, activeButtonIds, controls) {
  // A fixed control is always on, so it is in neither answer -- comparing it
  // would make every view look inactive forever.
  const fixed = new Set((controls || []).filter(isFixed).map((c) => c.id))

  const wantButtons = [...(view.buttons || [])].filter((id) => !fixed.has(id)).sort().join(',')
  const haveButtons = [...(activeButtonIds || [])].filter((id) => !fixed.has(id)).sort().join(',')
  if (wantButtons !== haveButtons) return false

  const wanted = view.values || {}
  const keys = new Set([...Object.keys(wanted), ...Object.keys(values || {})])
  for (const key of keys) {
    if (fixed.has(key)) continue
    // An absent value and an explicitly empty one mean the same thing to the
    // engine, so they have to compare equal here too.
    const a = JSON.stringify(wanted[key] ?? null)
    const b = JSON.stringify(values?.[key] ?? null)
    if (a !== b) return false
  }
  return true
}

/**
 * The values a page opens with: every control's admin-set default, plus
 * whatever the page fixes outright.
 *
 * This is also what Reset returns to, which is why a fixed control has to be
 * in it: "reset" means back to the page as the admin designed it, and the
 * page as designed includes its rules.
 */
export function initialValues(controls, { includeFixed = true } = {}) {
  const values = {}
  const buttons = []
  for (const control of controls || []) {
    const mode = controlMode(control)
    if (mode === 'off') continue
    if (mode === 'fixed' && !includeFixed) continue
    if (isButton(control)) {
      if (control.defaultOn) buttons.push(control.id)
      continue
    }
    if (control.defaultValue === undefined || control.defaultValue === null || control.defaultValue === '') continue
    if (control.kind === 'multi' || control.kind === 'chips') {
      values[control.id] = String(control.defaultValue)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    } else {
      values[control.id] = control.defaultValue
    }
  }
  return { values, buttons }
}
