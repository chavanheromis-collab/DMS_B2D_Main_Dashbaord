// ---------------------------------------------------------------------
// Copying one page's permissions onto another
// ---------------------------------------------------------------------
// There is already a way to copy a whole PERSON -- every page at once,
// for onboarding somebody into an existing role. What there was no way to
// do is the commoner job: this one page is set up correctly, now make the
// other four match, or give the same page to the next six people.
//
// Doing that by hand is forty checkbox passes, and the one that ends up
// slightly wrong is the one nobody notices until somebody sees a column
// they should not have.
//
// Module state, the same lifetime the look clipboard uses and for the
// same reason: it survives closing one page's card and opening another's
// -- the whole point -- and it is gone on the next reload. A permission
// set on the clipboard is for the next few minutes of work, and
// persisting it would mean pasting Monday's idea of a role on Thursday.
//
// The hard part is not the copying. It is that half of a permission set
// is keyed by things that only exist on the page it came from.

import { collectTabRefs } from './refs.js'

/** What a page's access document is made of. */
export const ACCESS_FIELDS = [
  'canView',
  'editable',
  'downloadable',
  'rowOps',
  'hiddenWidgets',
  'widgetOrder',
  'scope',
]

/** Keyed by REF -- meaningful only where the page reads that tab. */
const BY_REF = ['editable', 'downloadable', 'rowOps']

/** Keyed by WIDGET ID -- meaningful only on the page those widgets are on. */
const BY_WIDGET = ['hiddenWidgets', 'widgetOrder']

let clipboard = null

/** A plain snapshot, so editing the page it came from cannot change it. */
export function accessOf(access) {
  const out = {}
  for (const key of ACCESS_FIELDS) {
    const value = access?.[key]
    if (value === undefined) continue
    out[key] = value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value
  }
  return out
}

/**
 * Put one on the clipboard, remembering where it came from.
 *
 * The origin is not decoration: pasting onto the SAME page can carry the
 * widget-keyed halves, and pasting onto a different one cannot. It is
 * also what lets the button say "Paste from Ravi · Sales" rather than
 * "Paste", which is the difference between a deliberate action and a
 * guess.
 */
export function copyAccess(access, from = {}) {
  clipboard = {
    access: accessOf(access),
    from: { pageId: from.pageId || '', pageName: from.pageName || '', userName: from.userName || '' },
  }
  return clipboard
}

export function copiedAccess() {
  return clipboard ? { access: accessOf(clipboard.access), from: { ...clipboard.from } } : null
}

export function hasCopiedAccess() {
  return clipboard !== null
}

export function clearCopiedAccess() {
  clipboard = null
}

/** "Ravi · Sales", for the button. */
export function copiedLabel() {
  const from = clipboard?.from
  if (!from) return ''
  return [from.userName, from.pageName].filter(Boolean).join(' · ')
}

// ---------------------------------------------------------------------
// Pasting
// ---------------------------------------------------------------------

/** Every ref a page can actually read, from its own widgets and controls. */
export function refsOfPage(page) {
  return Array.from(collectTabRefs([page?.widgets || [], page?.controls || []])).filter(Boolean)
}

export function widgetIdsOfPage(page) {
  return (page?.widgets || []).map((w) => w?.id).filter(Boolean)
}

/**
 * What of a copied set actually applies to this page, and what does not.
 *
 * Three kinds of thing, and they travel differently:
 *
 *   BY REF -- editable columns, downloads, row operations. Kept only for
 *   the tabs the target page reads. A grant for a tab that is not on this
 *   page is not dangerous (the server checks the page's own refs either
 *   way) but it is a lie in the admin screen: a tick against something
 *   this page cannot show.
 *
 *   BY WIDGET ID -- hidden widgets, and the reader's widget order. These
 *   travel ONLY to the same page. An id from another page names nothing
 *   here, so carrying it would hide nothing while looking like it hides
 *   something; and a widget on THIS page could never be reached by it.
 *
 *   NEITHER -- `canView` and the row scope. \`canView\` is a plain yes.
 *   The scope's conditions name tabs, so they are filtered the same way
 *   the ref-keyed maps are: a limit written against a tab this page does
 *   not read is a limit that silently does nothing.
 *
 * Returns what to save AND what was left behind, because a paste that
 * quietly dropped half of itself is a permission set somebody believes
 * they have applied.
 */
export function pasteInto(copied, page) {
  const source = copied?.access || {}
  const samePage = Boolean(copied?.from?.pageId) && copied.from.pageId === page?.id

  const refs = new Set(refsOfPage(page))
  const widgets = new Set(widgetIdsOfPage(page))

  const access = { canView: Boolean(source.canView) }
  const dropped = { refs: [], widgets: 0, scope: 0 }

  for (const key of BY_REF) {
    const from = source[key] || {}
    const kept = {}
    for (const [ref, value] of Object.entries(from)) {
      if (refs.has(ref)) kept[ref] = Array.isArray(value) ? [...value] : value
      else if (!dropped.refs.includes(ref)) dropped.refs.push(ref)
    }
    access[key] = kept
  }

  if (samePage) {
    access.hiddenWidgets = (source.hiddenWidgets || []).filter((id) => widgets.has(id))
    const order = {}
    for (const [id, position] of Object.entries(source.widgetOrder || {})) {
      if (widgets.has(id)) order[id] = position
    }
    access.widgetOrder = order
  } else {
    // Named nothing here, so nothing is written rather than something
    // that looks set and is not.
    access.hiddenWidgets = []
    access.widgetOrder = {}
    dropped.widgets =
      (source.hiddenWidgets || []).length + Object.keys(source.widgetOrder || {}).length
  }

  const conditions = (source.scope?.conditions || []).filter(Boolean)
  const keptConditions = conditions.filter((c) => !c?.tab || refs.has(c.tab))
  dropped.scope = conditions.length - keptConditions.length
  access.scope = { match: source.scope?.match || 'all', conditions: keptConditions }

  return { access, dropped }
}

/** What the paste left behind, in one line, or '' when it took everything. */
export function pasteNote({ refs = [], widgets = 0, scope = 0 } = {}, labelFor = (r) => r) {
  const parts = []
  if (refs.length > 0) {
    const names = refs.slice(0, 3).map(labelFor).join(', ')
    const rest = refs.length > 3 ? ` and ${refs.length - 3} more` : ''
    parts.push(`${refs.length === 1 ? 'a grant' : `${refs.length} grants`} for ${names}${rest}`)
  }
  if (widgets > 0) parts.push(`${widgets} widget setting${widgets === 1 ? '' : 's'} from the other page`)
  if (scope > 0) parts.push(`${scope} row limit${scope === 1 ? '' : 's'}`)
  if (parts.length === 0) return ''
  return `Pasted. Left behind: ${parts.join(', ')} — this page has no such tab.`
}
