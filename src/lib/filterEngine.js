import {
  bucketedCell,
  isBlank,
  normalizeKey,
  toNumber,
  toDate,
  fromDateInput,
  startOfDay,
  endOfDay,
} from './dataUtils.js'

// ---------------------------------------------------------------------
// How filtering works across a multi-tab page
// ---------------------------------------------------------------------
// A page shows widgets sourced from SEVERAL tabs at once (MASTER,
// Quotations, GOOGLE REVIEW...). Those tabs have different columns, so a
// single filter can't blindly apply to all of them.
//
// The rule is: a filter or a button condition names the tab + column it
// targets. When we filter the rows of tab T, we only apply the parts that
// target T -- everything else passes through untouched. So a "DSE Name"
// dropdown built on MASTER narrows the MASTER widgets; if the admin also
// links it to Quotations."DSE Name", it narrows those too; tabs it never
// mentions (e.g. GOOGLE REVIEW) are left alone instead of being wiped to
// zero rows. That's what makes one page with many tabs behave sensibly.
//
// That default is the safe one, but it is not always the one you want. Often
// the whole point is "show me the page as it looks for Ravi" -- every table,
// every chart, every KPI. A control's REACH says how far it travels:
//
//   named  its own tab plus the tabs it explicitly lists. The default, and
//          what every control did before reach existed.
//   auto   ...plus every tab on the page carrying a column of that name. One
//          switch instead of one link per tab, and new tabs are covered the
//          day they are added.
//   key    ...plus the tabs that have no such column at all, narrowed by a
//          shared key instead. A GOOGLE REVIEW tab has no "DSE Name", but it
//          does have a VIN, and the VINs Ravi sold are knowable. This is the
//          only way a page filter can honestly claim to narrow everything.
//
// The first two are per-tab column matching and stay inside `filterTargets`.
// The third cannot: deciding which keys survive means looking at the SOURCE
// tab's filtered rows, which no single-tab pass can see. It is resolved one
// level up (see `buildKeyBridge`) and arrives back here as an ordinary key
// cross-filter, which is machinery that already exists.

/**
 * Every (tab, column) pair a filter targets.
 *
 * `tabColumns` -- a { tab: [columns] } map of the page -- is what makes the
 * automatic modes possible; without it a filter reaches exactly the tabs it
 * names, which is what every caller that does not care about reach wants.
 */
export function filterTargets(filter, tabColumns) {
  const list = [{ tab: filter.tab, column: filter.column }]
  for (const l of filter.links || []) {
    if (l && l.tab && l.column) list.push({ tab: l.tab, column: l.column })
  }

  const spreads = filter.reach === 'auto' || filter.reach === 'key'
  if (spreads && tabColumns && filter.column) {
    // A tab the admin bound by hand keeps that binding: they may have
    // pointed it at a differently-named column on purpose, and guessing
    // over an explicit instruction is never right.
    const named = new Set(list.map((t) => t.tab))
    for (const [tab, columns] of Object.entries(tabColumns)) {
      if (named.has(tab)) continue
      if ((columns || []).includes(filter.column)) list.push({ tab, column: filter.column })
    }
  }

  return list.filter((t) => t.tab && t.column)
}

/**
 * The tabs a key bridge has to cover: everything the column could not reach.
 *
 * Deliberately only those. A tab that already matches by column is filtered
 * by its own data; also intersecting it with the source tab's keys would
 * quietly drop its unmatched rows -- a quotation for a vehicle that is not
 * in MASTER would vanish from a "DSE = Ravi" view that it genuinely belongs
 * in.
 */
export function keyBridgeTargets(filter, tabColumns) {
  if (filter?.reach !== 'key' || !filter.keyColumn || !tabColumns) return []

  const covered = new Set(filterTargets(filter, tabColumns).map((t) => t.tab))
  const overrides = new Map(
    (filter.keyLinks || []).filter((k) => k && k.tab && k.column).map((k) => [k.tab, k.column])
  )

  const out = []
  for (const [tab, columns] of Object.entries(tabColumns)) {
    if (covered.has(tab)) continue
    // The key is usually called the same thing everywhere; where it is not
    // (VIN here, Chassis No there) the admin says so once.
    const column = overrides.get(tab) || ((columns || []).includes(filter.keyColumn) ? filter.keyColumn : null)
    if (column && (columns || []).includes(column)) out.push({ tab, column })
  }
  return out
}

/**
 * Turns an active key-reaching filter into the key cross-filter that carries
 * it to the tabs its column cannot reach.
 *
 * `sourceRows` must be the source tab AFTER the ordinary filters have run,
 * so the keys mean "the rows still on screen" rather than "the rows this one
 * control would have kept". Every other control on the page therefore
 * narrows the bridged tabs too, which is the behaviour anyone expects from
 * something described as a page filter.
 */
export function buildKeyBridge({ filter, sourceRows, tabColumns }) {
  const targets = keyBridgeTargets(filter, tabColumns)
  if (targets.length === 0) return null

  const keys = Array.from(
    new Set((sourceRows || []).map((row) => normalizeKey(row[filter.keyColumn])).filter((k) => k !== null))
  )

  return {
    id: `bridge_${filter.id}`,
    kind: 'keys',
    keys,
    // Named tabs only, and no `keyNames`: a bridge must reach exactly the
    // tabs it was calculated for, never every tab that happens to have a
    // column of the same name.
    keyColumns: targets,
    keyNames: [],
    label: filter.label || filter.column,
  }
}

/**
 * How a control reaches every tab on the page -- the admin's answer to "will
 * this actually narrow my other table?", which is otherwise only discoverable
 * by saving and looking.
 */
export function controlCoverage(filter, tabColumns) {
  const targets = new Map(filterTargets(filter, tabColumns).map((t) => [t.tab, t.column]))
  const explicit = new Set((filter?.links || []).filter((l) => l && l.tab).map((l) => l.tab))
  const bridged = new Map(keyBridgeTargets(filter, tabColumns).map((t) => [t.tab, t.column]))

  return Object.keys(tabColumns || {}).map((tab) => {
    if (tab === filter?.tab) return { tab, via: 'own', column: targets.get(tab) || filter?.column || '' }
    if (targets.has(tab)) return { tab, via: explicit.has(tab) ? 'link' : 'column', column: targets.get(tab) }
    if (bridged.has(tab)) return { tab, via: 'key', column: bridged.get(tab) }
    return { tab, via: 'none', column: null }
  })
}

/** Is this filter's current value actually narrowing anything? */
export function filterIsActive(filter, value) {
  if (value === undefined || value === null) return false
  switch (filter.kind) {
    // `chips` is a multi-select with a different control, and `slider` is a
    // number range with a different control -- both share their sibling's
    // value shape exactly, so the engine never needs to know they exist.
    case 'multi':
    case 'chips':
      return Array.isArray(value) && value.length > 0
    case 'date':
    case 'number':
    case 'slider':
    case 'stepper':
      return !!(value.from || value.to)
    // A single-handle slider carries a bare number, and "last N days" carries
    // a day count. Zero is a legitimate value for both, so this tests for a
    // finite number rather than for truthiness.
    case 'threshold':
    case 'dateslider':
      return value !== '' && Number.isFinite(Number(value))
    case 'text':
      return String(value).trim() !== ''
    case 'select':
    default:
      return value !== '' && value !== '__ALL__'
  }
}

function matchesFilterValue(row, column, filter, value, dateOrder) {
  const cell = row[column]
  // A bucketed control offers "2026", not four hundred dates -- so what it
  // compares against is the bucket the cell falls in, not the cell.
  const asShown = () => bucketedCell(cell, filter.bucket, dateOrder)

  switch (filter.kind) {
    case 'select':
      return asShown() === String(value).trim()

    case 'multi':
    case 'chips': {
      const wanted = new Set(value.map((v) => String(v).trim()))
      return wanted.has(asShown())
    }

    case 'text':
      return String(cell ?? '').toLowerCase().includes(String(value).toLowerCase().trim())

    case 'number':
    case 'slider':
    case 'stepper': {
      const n = toNumber(cell)
      if (n === null) return false
      const from = toNumber(value.from)
      const to = toNumber(value.to)
      if (from !== null && n < from) return false
      if (to !== null && n > to) return false
      return true
    }

    case 'threshold': {
      const n = toNumber(cell)
      const target = toNumber(value)
      if (n === null || target === null) return false
      return filter.direction === 'lte' ? n <= target : n >= target
    }

    case 'dateslider': {
      const d = toDate(cell, dateOrder)
      const days = toNumber(value)
      if (!d || days === null) return false
      const now = new Date()
      return d >= startOfDay(new Date(now.getTime() - days * 86400000)) && d <= endOfDay(now)
    }

    case 'date': {
      const d = toDate(cell, dateOrder)
      if (!d) return false
      const from = fromDateInput(value.from)
      const to = fromDateInput(value.to)
      if (from && d < startOfDay(from)) return false
      if (to && d > endOfDay(to)) return false
      return true
    }

    default:
      return true
  }
}

// ---------------------------------------------------------------------
// Button conditions
// ---------------------------------------------------------------------
export function testCondition(row, cond, dateOrder = 'DMY') {
  if (!cond || !cond.column) return true
  const cell = row[cond.column]
  const text = String(cell ?? '').trim()
  const lower = text.toLowerCase()
  const target = String(cond.value ?? '').trim()
  const targetLower = target.toLowerCase()

  switch (cond.operator) {
    case 'equals':
      return lower === targetLower
    case 'not_equals':
      return lower !== targetLower
    case 'contains':
      return lower.includes(targetLower)
    case 'not_contains':
      return !lower.includes(targetLower)
    case 'starts_with':
      return lower.startsWith(targetLower)
    case 'one_of':
    case 'none_of': {
      const listed = target
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .includes(lower)
      return cond.operator === 'one_of' ? listed : !listed
    }
    case 'is_empty':
      return isBlank(cell)
    case 'is_not_empty':
      return !isBlank(cell)

    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'between': {
      const n = toNumber(cell)
      if (n === null) return false
      const a = toNumber(cond.value)
      const b = toNumber(cond.value2)
      if (cond.operator === 'gt') return a !== null && n > a
      if (cond.operator === 'gte') return a !== null && n >= a
      if (cond.operator === 'lt') return a !== null && n < a
      if (cond.operator === 'lte') return a !== null && n <= a
      if (a !== null && n < a) return false
      if (b !== null && n > b) return false
      return true
    }

    case 'date_before':
    case 'date_after':
    case 'date_between': {
      const d = toDate(cell, dateOrder)
      if (!d) return false
      const a = fromDateInput(cond.value)
      const b = fromDateInput(cond.value2)
      if (cond.operator === 'date_before') return !!a && d < startOfDay(a)
      if (cond.operator === 'date_after') return !!a && d > endOfDay(a)
      if (a && d < startOfDay(a)) return false
      if (b && d > endOfDay(b)) return false
      return true
    }

    case 'last_n_days':
    case 'next_n_days':
    case 'greater_than_n_days': {
      const d = toDate(cell, dateOrder)
      if (!d) return false

      const n = toNumber(cond.value)
      if (n === null) return false

      const now = new Date()

      if (cond.operator === 'last_n_days') {
        const from = startOfDay(
          new Date(now.getTime() - n * 86400000)
        )
        return d >= from && d <= endOfDay(now)
      }

      if (cond.operator === 'next_n_days') {
        const to = endOfDay(
          new Date(now.getTime() + n * 86400000)
        )
        return d >= startOfDay(now) && d <= to
      }

      if (cond.operator === 'greater_than_n_days') {
        const cutoff = startOfDay(
          new Date(now.getTime() - n * 86400000)
        )
        return d < cutoff
      }

      return false
    }

    case 'this_month': {
      const d = toDate(cell, dateOrder)
      if (!d) return false
      const now = new Date()
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    }

    case 'not_this_month': {
      const d = toDate(cell, dateOrder)
      if (!d) return true
      const now = new Date()
      return !(d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth())
    }

    case 'today': {
      const d = toDate(cell, dateOrder)
      if (!d) return false
      const now = new Date()
      return d.toDateString() === now.toDateString()
    }

    default:
      return true
  }
}

/**
 * Does a row satisfy a whole set of conditions? Shared by buttons and by
 * pipeline stages, which are defined the exact same way.
 */
export function matchesConditions(row, conditions, match = 'all', dateOrder = 'DMY') {
  const conds = (conditions || []).filter((c) => c.column)
  if (conds.length === 0) return true
  return match === 'all'
    ? conds.every((c) => testCondition(row, c, dateOrder))
    : conds.some((c) => testCondition(row, c, dateOrder))
}

/**
 * Applies a button to ONE tab's rows. Only the conditions that name this
 * tab are considered; a button with nothing to say about this tab returns
 * the rows unchanged rather than emptying them.
 */
function applyButton(rows, button, tab, dateOrder) {
  const conds = (button.conditions || []).filter((c) => c.tab === tab && c.column)
  if (conds.length === 0) return rows
  return rows.filter((row) => matchesConditions(row, conds, button.match || 'all', dateOrder))
}

// ---------------------------------------------------------------------
// Cross-filtering
// ---------------------------------------------------------------------
// Clicking a chart bar, a pipeline stage or a leaderboard row pushes a
// cross-filter onto the page. Two shapes:
//   { kind: 'value',      tab, column, value }   -- from a chart / leaderboard
//   { kind: 'conditions', tab, conditions, match } -- from a pipeline stage
//   { kind: 'keys',       keys, keyColumns, keyNames, conditions? } -- from a
//       blended drill or a flow branch: a set of join-key values, which is
//       the one thing every tab can be filtered by at once.
// Same scoping rule as everything else: it only touches its own tab.
/**
 * Which column on THIS tab holds the key a key-filter is matching.
 *
 * Two ways to find it, most specific first:
 *
 *  1. `keyColumns` names the exact pairs the blend defined -- the left tab
 *     with its key column, the right tab with its own (differently named)
 *     one. Those are certain, because the admin stated them.
 *  2. Otherwise, any tab carrying a column of the SAME NAME is assumed to
 *     hold the same key. That is what carries a drill across to widgets
 *     nowhere near the blend: a SERVICE tab with a `VIN` column narrows too.
 *
 * A tab with neither is left completely alone, which is the same rule every
 * other filter here follows -- silence, not an empty table.
 */
function keyColumnFor(rows, cf, tab) {
  const pair = (cf.keyColumns || []).find((k) => k.tab === tab && k.column)
  if (pair) return pair.column

  const sample = rows[0]
  if (!sample) return null
  for (const name of cf.keyNames || []) {
    if (name && Object.prototype.hasOwnProperty.call(sample, name)) return name
  }
  return null
}

/**
 * Narrows rows to a set of key values -- the shape a drill on a BLENDED
 * column takes.
 *
 * A blended column ("Yard.Location") exists only on the widget that blended
 * it, so filtering other widgets by it directly is impossible. What every
 * tab CAN be filtered by is the key the blend joined on, so the click is
 * resolved to "the VINs whose location is Pune Yard" and that set travels
 * across the page instead.
 */
function applyKeyCrossFilter(rows, cf, tab) {
  const column = keyColumnFor(rows, cf, tab)
  if (!column) return rows

  // Built once per tab rather than per row: a key set can hold thousands of
  // VINs, and a linear scan inside the row loop would make it quadratic.
  const wanted = new Set(cf.keys || [])
  if (wanted.size === 0) return []

  return rows.filter((row) => wanted.has(normalizeKey(row[column])))
}

function applyCrossFilter(rows, cf, tab, dateOrder) {
  if (cf.kind === 'keys') {
    const narrowed = applyKeyCrossFilter(rows, cf, tab)
    // A key filter may ALSO carry conditions -- a flow branch below a tab
    // hop is "these vehicles' rows" AND "the ones that are a PDI". The keys
    // carry it to every tab; the conditions sharpen it on the tab they were
    // written against, and say nothing about the others.
    const conds = (cf.conditions || []).filter((c) => c.tab === tab && c.column)
    if (conds.length === 0) return narrowed
    return narrowed.filter((row) => matchesConditions(row, conds, cf.match || 'all', dateOrder))
  }

  if (cf.kind === 'conditions') {
    // Conditions each carry their own tab (exactly like buttons), so a
    // single cross-filter can legitimately span more than one tab -- e.g. a
    // conversion KPI drilling into both its primary and secondary tab at
    // once. A condition set with nothing to say about THIS tab leaves its
    // rows untouched rather than emptying them.
    const conds = (cf.conditions || []).filter((c) => c.tab === tab && c.column)
    if (conds.length === 0) return rows
    return rows.filter((row) => matchesConditions(row, conds, cf.match || 'all', dateOrder))
  }
  // The simpler "clicked this exact value" shape (charts, leaderboards) is
  // inherently single-tab, so it still gates on cf.tab directly.
  if (cf.tab !== tab || !cf.column) return rows
  return rows.filter((row) => String(row[cf.column] ?? '').trim() === String(cf.value).trim())
}

/** Free-text search across every cell of a row. */
function matchesSearch(row, query) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  for (const [k, v] of Object.entries(row)) {
    if (k === '_row') continue
    if (String(v ?? '').toLowerCase().includes(q)) return true
  }
  return false
}

/**
 * The single entry point every widget uses.
 *
 *   rows        raw rows of ONE tab
 *   tab         that tab's name
 *   filters     admin-defined filter definitions (whole page)
 *   values      current UI values, keyed by filter id
 *   buttons     admin-defined buttons (whole page)
 *   activeIds   ids of the buttons currently toggled on
 *   crossFilters  drill-downs from clicking a chart / stage / leaderboard row
 *   search      global search box text
 *   tabColumns  { tab: [columns] } for the whole page, which is what lets a
 *               control reach tabs it does not name. Optional: without it
 *               every control behaves as `named`.
 */
export function applyFilters(
  rows,
  {
    tab,
    filters = [],
    values = {},
    buttons = [],
    activeIds = [],
    crossFilters = [],
    search = '',
    dateOrder = 'DMY',
    tabColumns = null,
  }
) {
  let out = rows || []

  for (const filter of filters) {
    const value = values[filter.id]
    if (!filterIsActive(filter, value)) continue
    const target = filterTargets(filter, tabColumns).find((t) => t.tab === tab)
    if (!target) continue // this filter says nothing about this tab
    out = out.filter((row) => matchesFilterValue(row, target.column, filter, value, dateOrder))
  }

  for (const button of buttons) {
    if (!activeIds.includes(button.id)) continue
    out = applyButton(out, button, tab, dateOrder)
  }

  // Cross-filters come from clicking a chart segment, a pipeline stage, a
  // KPI card or a leaderboard row. They stack on top of everything else and
  // on each other.
  for (const cf of crossFilters) out = applyCrossFilter(out, cf, tab, dateOrder)

  if (search.trim()) out = out.filter((row) => matchesSearch(row, search))

  return out
}
