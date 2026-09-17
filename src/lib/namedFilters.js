// ---------------------------------------------------------------------
// Named filters: one widget's conditions, reused by name
// ---------------------------------------------------------------------
// "Walk-ins still waiting on a follow-up" gets written as conditions on one
// KPI, and then written again -- slightly differently -- on the chart next
// to it, on a stat, and inside a calculated column. Four copies of one rule
// agree until the day somebody fixes three of them.
//
// So a widget's conditions can be given a NAME, right where they are
// written, and anything else can then use them by picking that widget and
// that filter: another widget's conditions, a page button, a user's row
// limit, a calculated column. Change the conditions once; everything that
// uses them follows.
//
// Five decisions shape it:
//
//   IT LIVES ON THE WIDGET. There is no separate list of filters to keep
//   in step with the widgets. A name sits beside the conditions it names --
//   `conditions` / `conditionsName`, `rowConditions` / `rowConditionsName`
//   -- so a filter is found by walking the widgets, and a widget deleted is
//   a filter gone.
//
//   IT IS AN OPERATOR, like a formula. "Is in a named filter" is one more
//   case in the one function every condition in the app is tested by, so
//   it works in every place a condition is used at once.
//
//   A CONDITION POINTS AT IT BY ID, A FORMULA BY NAME. A condition is built
//   with clicks and keeps the widget's id, so renaming the filter changes
//   nothing. A formula is text, and text says a name -- INFILTER("Walk-ins")
//   -- exactly as it says a column name. Which is why names must be unique.
//
//   IT FAILS CLOSED. A filter that no longer exists, or one that ends up
//   asking about itself, matches nothing -- the same rule a broken formula
//   condition follows, for the same reason: a KPI that drops to zero gets
//   noticed, one that quietly counts everything does not.
//
//   IT IS READ FROM ONE PLACE. The screens that hold the pages install the
//   current set here, and the evaluators ask this module -- rather than
//   every call to `matchesConditions` in the app being handed a lookup it
//   would have to pass along.
//
// No imports that could come back round: the filter engine and the formula
// language both use this, so it uses neither. The engine lends its matcher
// through `registerFilterTester`.

import { childWidgets } from './widgetNest.js'

/** The operator a "use a named filter" condition carries. */
export const FILTER_OPERATOR = 'in_filter'

/**
 * The column it carries so the tidy-up filters keep it -- the same trick,
 * for the same reason, as a formula condition. See lib/conditionFormula.js.
 */
export const FILTER_COLUMN = '=filter'

export const isFilterCondition = (condition) => condition?.operator === FILTER_OPERATOR

/** Where a condition list's name is kept: `conditions` → `conditionsName`. */
export const nameFieldFor = (key) => `${key}Name`

const nameKey = (name) => String(name ?? '').trim().toLowerCase()

/**
 * Which field says ALL or ANY for a condition list.
 *
 * The app grew these one editor at a time and they are not spelled alike,
 * so the odd ones are listed and the regular ones worked out:
 * `conditionsA` is matched by `matchA`, `conditionsNow` by `matchNow`.
 */
const MATCH_FIELDS = {
  conditions: ['conditionsMatch', 'match'],
  secondaryConditions: ['secondaryConditionsMatch'],
  rowConditions: ['rowMatch'],
  compareConditions: ['compareMatch'],
  targetConditions: ['targetMatch'],
}

export function matchOf(holder, key) {
  const suffix = /^conditions(.+)$/.exec(key)?.[1]
  const fields = MATCH_FIELDS[key] || (suffix ? [`match${suffix}`] : [])
  for (const field of fields) {
    if (holder?.[field]) return holder[field] === 'any' ? 'any' : 'all'
  }
  return 'all'
}

/** A filter's id: the widget, and where inside it the conditions sit. */
export const filterRef = (widgetId, path) => `${widgetId}:${path}`

/** How deep inside a widget a named list is looked for -- stages in stages. */
const MAX_NESTING = 5

/**
 * Every named condition list inside ONE widget.
 *
 * Found by walking it rather than by a list of known fields, so a stat's
 * conditions, a line's target, and a pipeline stage three levels down are
 * all found the same way -- and so is whatever editor comes next, as long
 * as it keeps the name beside the list.
 */
export function namedFiltersOf(widget, page = null) {
  const out = []
  if (!widget?.id) return out
  const widgetTitle = String(widget.title || widget.label || widget.type || 'Untitled widget').trim()

  const visit = (holder, prefix, depth) => {
    if (!holder || typeof holder !== 'object' || depth > MAX_NESTING) return
    for (const [key, list] of Object.entries(holder)) {
      // Widgets inside this one are widgets in their own right, with their
      // own title -- they are listed separately, not as part of this one.
      if (!Array.isArray(list) || (depth === 0 && key === 'widgets')) continue
      const name = /conditions/i.test(key) ? String(holder[nameFieldFor(key)] ?? '').trim() : ''
      if (name) {
        out.push({
          ref: filterRef(widget.id, `${prefix}${key}`),
          name,
          conditions: list.filter((c) => c && typeof c === 'object'),
          match: matchOf(holder, key),
          tab: list.find((c) => c?.tab)?.tab || holder.tab || widget.tab || '',
          widgetId: widget.id,
          widgetTitle,
          pageId: page?.id || '',
          pageName: page?.name || '',
        })
        continue
      }
      // A list of things with ids -- stats, lines, stages -- may keep
      // conditions of its own. A list of conditions has no ids, so it is
      // never walked into.
      for (const item of list) {
        if (item && typeof item === 'object' && !Array.isArray(item) && item.id) {
          visit(item, `${prefix}${key}.${item.id}.`, depth + 1)
        }
      }
    }
  }

  visit(widget, '', 0)
  return out
}

/**
 * Every named filter on these pages, looked up both ways.
 *
 * `counts` is kept so a name used twice can be SAID to be used twice: the
 * lookup by name takes the first, and the editor tells the admin that a
 * formula cannot know which one they meant.
 */
export function buildNamedFilters(pages) {
  const list = []
  const walk = (widgets, page) => {
    for (const widget of widgets || []) {
      list.push(...namedFiltersOf(widget, page))
      walk(childWidgets(widget), page)
    }
  }
  for (const page of pages || []) walk(page?.widgets, page)

  const byRef = new Map()
  const byName = new Map()
  const counts = new Map()
  for (const filter of list) {
    byRef.set(filter.ref, filter)
    const key = nameKey(filter.name)
    counts.set(key, (counts.get(key) || 0) + 1)
    if (!byName.has(key)) byName.set(key, filter)
  }
  return { list, byRef, byName, counts }
}

export const EMPTY_FILTERS = buildNamedFilters([])

/**
 * Everything a filter's answer -- or its line in a picker -- depends on.
 *
 * Two sets with the same signature behave identically, which is what lets
 * a screen keep the one it has when the pages are delivered again
 * unchanged. See hooks/useNamedFilters.js.
 */
export function filtersSignature(registry) {
  return JSON.stringify(
    (registry || EMPTY_FILTERS).list.map((f) => [f.ref, f.name, f.match, f.tab, f.conditions, f.widgetTitle, f.pageName])
  )
}

// ---------------------------------------------------------------------
// The set in force
// ---------------------------------------------------------------------

let current = EMPTY_FILTERS
let tester = null
const evaluating = new Set()

/** Called by whatever holds the pages, as they change. */
export function installNamedFilters(registry) {
  current = registry || EMPTY_FILTERS
}

export const installedFilters = () => current

/** The filter engine's `matchesConditions`, lent to break the import loop. */
export function registerFilterTester(fn) {
  tester = typeof fn === 'function' ? fn : null
}

export const namedFilterByRef = (ref, registry = current) =>
  (registry || EMPTY_FILTERS).byRef.get(String(ref ?? '')) || null

export const namedFilterByName = (name, registry = current) =>
  (registry || EMPTY_FILTERS).byName.get(nameKey(name)) || null

/**
 * Is this row in that filter?
 *
 * A filter that is already being asked, further up this same question, is a
 * loop -- A uses B uses A -- and answers NO rather than asking forever.
 */
export function rowInNamedFilter(filter, row, dateOrder = 'DMY') {
  if (!filter || !tester || evaluating.has(filter.ref)) return false
  evaluating.add(filter.ref)
  try {
    return Boolean(tester(row, filter.conditions, filter.match, dateOrder))
  } catch {
    return false
  } finally {
    evaluating.delete(filter.ref)
  }
}

// ---------------------------------------------------------------------
// For the editors
// ---------------------------------------------------------------------

/** What is wrong with this name, or ''. */
export function filterNameProblem(name, registry = current) {
  const text = String(name ?? '').trim()
  if (!text) return ''
  if (text.includes('"')) return 'A filter name cannot contain a double quote — a formula puts the name in quotes.'
  if (((registry || EMPTY_FILTERS).counts.get(nameKey(text)) || 0) > 1) {
    return `Another filter is already called “${text}”. Names must be unique, so a formula knows which one it means.`
  }
  return ''
}

const onTab = (filter, tab) => !tab || filter.tab === tab

/**
 * The widgets that have a named filter, as picker options.
 *
 * `tab` narrows to filters written on that tab: a filter about another
 * tab's columns would be asked of rows that do not have them.
 */
export function filterWidgetOptions(registry = current, { tab = '' } = {}) {
  const seen = new Map()
  for (const filter of (registry || EMPTY_FILTERS).list) {
    if (!onTab(filter, tab) || seen.has(filter.widgetId)) continue
    seen.set(filter.widgetId, {
      value: filter.widgetId,
      label: filter.pageName ? `${filter.pageName} › ${filter.widgetTitle}` : filter.widgetTitle,
    })
  }
  return [...seen.values()]
}

/** One widget's named filters, as picker options. */
export function filterOptionsIn(registry = current, widgetId = '', { tab = '' } = {}) {
  return (registry || EMPTY_FILTERS).list
    .filter((filter) => filter.widgetId === widgetId && onTab(filter, tab))
    .map((filter) => ({ value: filter.ref, label: filter.name, name: filter.name }))
}

/** “Walk-ins pending”, for the summaries that list conditions. */
export function describeFilterRef(ref, registry = current) {
  const filter = namedFilterByRef(ref, registry)
  return filter ? `in filter “${filter.name}”` : 'in a named filter that no longer exists'
}
