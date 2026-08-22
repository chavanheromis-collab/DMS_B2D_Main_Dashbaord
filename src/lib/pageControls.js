import { uid } from './config.js'
import { filterIsActive } from './filterEngine.js'

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
    if (control.hidden) continue
    ;(control.advanced ? advanced : visible).push(control)
  }
  return { visible, advanced }
}

/** Is this control currently narrowing anything? */
export function controlActive(control, values, activeButtonIds) {
  if (isButton(control)) return (activeButtonIds || []).includes(control.id)
  return filterIsActive(control, values?.[control.id])
}

/** How many controls are doing something right now. */
export function activeCount(controls, values, activeButtonIds) {
  return (controls || []).filter((c) => controlActive(c, values, activeButtonIds)).length
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
  const ids = new Set((controls || []).map((c) => c.id))
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
export function viewIsActive(view, values, activeButtonIds) {
  const wantButtons = [...(view.buttons || [])].sort().join(',')
  const haveButtons = [...(activeButtonIds || [])].sort().join(',')
  if (wantButtons !== haveButtons) return false

  const wanted = view.values || {}
  const keys = new Set([...Object.keys(wanted), ...Object.keys(values || {})])
  for (const key of keys) {
    // An absent value and an explicitly empty one mean the same thing to the
    // engine, so they have to compare equal here too.
    const a = JSON.stringify(wanted[key] ?? null)
    const b = JSON.stringify(values?.[key] ?? null)
    if (a !== b) return false
  }
  return true
}

/** The values a page opens with: every control's admin-set default. */
export function initialValues(controls) {
  const values = {}
  const buttons = []
  for (const control of controls || []) {
    if (control.hidden) continue
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
