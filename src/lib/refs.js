// ---------------------------------------------------------------------
// Tab references -- how a "master" dashboard addresses data
// ---------------------------------------------------------------------
// v2 had exactly two pages, each owning ONE spreadsheet, so a widget could
// say `tab: 'MASTER'` and that was unambiguous.
//
// v3 lets a page pull from ANY number of spreadsheets ("data sources"), and
// two different spreadsheets very often both have a tab called MASTER. So a
// bare tab name is no longer an address. Everything an admin configures now
// stores a REF instead:
//
//     "src_k3f9a2::MASTER"     =  sourceId :: tabName
//
// A ref is just a string, which is the whole point: every existing widget,
// filter, button and condition already treats `tab` as an opaque string key
// used for two things -- looking rows up in a map, and printing a caption.
// Storing a ref there means the filter engine, the aggregation helpers and
// all ten widget types keep working untouched.
//
// The one thing a raw ref is bad at is being READ by a human, so the render
// layer never shows one: Dashboard.jsx resolves refs to short, unique
// display labels (see `buildLabelMap`) and rewrites the layout it hands to
// the widgets, so a caption reads "MASTER" -- or "MASTER · Premia Sales"
// when two sources both have a MASTER -- and never "src_k3f9a2::MASTER".

export const REF_SEP = '::'

/** `("src_a1", "MASTER")` -> `"src_a1::MASTER"` */
export function makeRef(sourceId, tab) {
  if (!sourceId || !tab) return ''
  return `${sourceId}${REF_SEP}${tab}`
}

/** Is this string a qualified ref rather than a bare legacy tab name? */
export function isRef(value) {
  return typeof value === 'string' && value.includes(REF_SEP)
}

/**
 * `"src_a1::MASTER"` -> `{ sourceId: 'src_a1', tab: 'MASTER' }`.
 *
 * A bare legacy tab name comes back as `{ sourceId: '', tab: 'MASTER' }`
 * rather than throwing, so a half-migrated layout degrades to "unknown
 * source" instead of crashing the page.
 *
 * Only the FIRST separator splits, because a Google tab may legitimately be
 * called "Q1::Q2" and the source id never contains a colon.
 */
export function parseRef(ref) {
  const s = String(ref ?? '')
  const at = s.indexOf(REF_SEP)
  if (at === -1) return { sourceId: '', tab: s }
  return { sourceId: s.slice(0, at), tab: s.slice(at + REF_SEP.length) }
}

export function refSourceId(ref) {
  return parseRef(ref).sourceId
}

export function refTab(ref) {
  return parseRef(ref).tab
}

// ---------------------------------------------------------------------
// Display labels
// ---------------------------------------------------------------------
/** What sits between a sheet's name and its tab's: "FIFO NOW · Master". */
export const TAB_LABEL_SEP = ' · '

/**
 * How a tab is named everywhere a person reads it: the sheet, then the tab.
 *
 * Always both, and in that order. "Master" on its own does not say WHICH
 * master -- a dealership connects a FIFO sheet, a stock sheet and two DMS
 * exports, and half of them have one -- and reading the sheet first is how
 * the list of tabs sorts itself into sheets without anybody sorting it.
 *
 * A sheet with no name (deleted, or not loaded yet) leaves the tab alone
 * rather than printing "undefined · Master".
 */
export function tabLabel(sourceName, tab) {
  const name = String(sourceName ?? '').trim()
  return name ? `${name}${TAB_LABEL_SEP}${tab}` : String(tab ?? '')
}

/**
 * Builds `{ [ref]: label }` for a set of refs: "Sheet · Tab" for each.
 *
 * Labels double as the render-layer KEY for row maps (see Dashboard.jsx), so
 * they must be unique -- two sheets sharing BOTH a name and a tab name get
 * the source id's tail appended as a last resort, rather than one silently
 * overwriting the other's rows.
 */
export function buildLabelMap(refs, sources) {
  const byId = new Map((sources || []).map((s) => [s.id, s]))
  const unique = [...new Set((refs || []).filter(Boolean))]

  const out = {}
  const used = new Set()

  for (const ref of unique) {
    const { sourceId, tab } = parseRef(ref)
    let label = tabLabel(byId.get(sourceId)?.name, tab)
    if (used.has(label)) label = `${label} (${sourceId.slice(-4)})`

    used.add(label)
    out[ref] = label
  }
  return out
}

/** One ref -> its label, for captions outside a prepared label map. */
export function refLabel(ref, sources = []) {
  if (!ref) return ''
  const { sourceId, tab } = parseRef(ref)
  return tabLabel((sources || []).find((s) => s.id === sourceId)?.name, tab)
}

// ---------------------------------------------------------------------
// Rewriting a layout's refs
// ---------------------------------------------------------------------
// Every tab-bearing field in the config model is named either `tab` or
// `secondaryTab`, and they appear at many different depths:
//
//   widget.tab, widget.secondaryTab
//   widget.stages[].tab, widget.stages[].conditions[].tab
//   widget.conditions[].tab, widget.secondaryConditions[].tab
//   widget.conditionsA[].tab, widget.conditionsB[].tab
//   widget.controls[].conditions[].tab
//   filter.tab, filter.links[].tab
//   button.conditions[].tab
//
// Rather than enumerate that list (and silently miss whichever field gets
// added next), walk the structure and rewrite EVERY string-valued `tab` /
// `secondaryTab` key wherever it appears. New widget types that follow the
// same naming convention are handled automatically.

const TAB_KEYS = new Set(['tab', 'secondaryTab'])

/**
 * Deep-clones `value`, replacing every `tab` / `secondaryTab` string with
 * `mapFn(original)`. Returns a new structure; the input is never mutated,
 * so an admin draft can be rewritten for preview without disturbing it.
 */
export function mapTabFields(value, mapFn) {
  if (Array.isArray(value)) return value.map((item) => mapTabFields(item, mapFn))
  if (value === null || typeof value !== 'object') return value

  const out = {}
  for (const [key, val] of Object.entries(value)) {
    if (TAB_KEYS.has(key) && typeof val === 'string' && val !== '') {
      out[key] = mapFn(val)
    } else {
      out[key] = mapTabFields(val, mapFn)
    }
  }
  return out
}

/** Every distinct ref a widget / filter / button structure mentions. */
export function collectTabRefs(value, into = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectTabRefs(item, into))
    return into
  }
  if (value === null || typeof value !== 'object') return into

  for (const [key, val] of Object.entries(value)) {
    if (TAB_KEYS.has(key) && typeof val === 'string' && val !== '') into.add(val)
    else collectTabRefs(val, into)
  }
  return into
}

/**
 * Upgrades a v2 layout in place: every bare `tab: "MASTER"` becomes
 * `tab: "<sourceId>::MASTER"`.
 *
 * Used both by the one-time migration and defensively at read time, so a
 * page written before the upgrade still renders instead of showing ten
 * "tab could not be read" cards.
 */
export function qualifyLegacyRefs(value, sourceId) {
  if (!sourceId) return value
  return mapTabFields(value, (tab) => (isRef(tab) ? tab : makeRef(sourceId, tab)))
}
