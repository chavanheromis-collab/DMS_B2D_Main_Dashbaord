// ---------------------------------------------------------------------
// Calculated columns -- attaching them to a tab
// ---------------------------------------------------------------------
// The formula language lives in lib/formula.js. This is the part that says
// WHERE the answers go: a calculated column is defined on the TAB, in the
// data source, and from then on it is simply one of that tab's columns.
//
// That placement is the whole design. Defined on a widget, the same margin
// column would have to be defined again on the next widget, and again in
// the filter that narrows it, and it would not exist at all for the page
// that blends this tab with another one. Defined on the tab, it is computed
// once, before anything else in the pipeline runs, and every widget,
// filter, control, drill-down, flow and blend downstream sees an ordinary
// column -- including the blend, which is what makes a calculated column on
// the parent table usable in a blended widget without any further work.
//
// Order of operations, deliberately: calculate, then scope, then filter.
// A calculated column has to exist before a filter can mention it, and a
// per-user row scope has to be able to hide rows by it.

import { buildAggregates, aggregateKeys, evaluateFormula, formulaColumns, parseFormula } from './formula.js'

/** `{ [tabName]: [ {id, name, formula} ] }` on a data source. */
export function computedFor(source, tab) {
  return (source?.computed?.[tab] || []).filter((c) => c && c.name && c.formula)
}

export function newComputedId() {
  return `c_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Parses a set of definitions and puts them in an order that can actually
 * be evaluated.
 *
 * One calculated column may be built from another -- `Margin` from `Sale`
 * and `Cost`, then `Margin %` from `Margin` -- which is how a complicated
 * calculation stays readable instead of becoming one enormous formula. So
 * the definitions are sorted by what they depend on, and a pair that depend
 * on each other is reported rather than looping forever.
 *
 * Returns `{ columns, errors }`; `errors` is `[{ id, name, error }]` and is
 * what the editor shows. A broken definition is dropped, not guessed at.
 */
export function compileComputed(defs, headers = []) {
  const known = new Set(headers)
  const parsed = []
  const errors = []

  for (const def of defs || []) {
    if (!def?.name || !def?.formula) continue
    if (known.has(def.name)) {
      errors.push({ id: def.id, name: def.name, error: `The tab already has a column called “${def.name}”` })
      continue
    }
    const { ast, error } = parseFormula(def.formula)
    if (error) {
      errors.push({ id: def.id, name: def.name, error })
      continue
    }
    parsed.push({ ...def, ast, needs: formulaColumns(ast) })
  }

  // --- dependency order -------------------------------------------------
  const byName = new Map(parsed.map((p) => [p.name, p]))
  const ordered = []
  const state = new Map() // name -> 'busy' | 'done'

  function visit(node, trail) {
    const status = state.get(node.name)
    if (status === 'done') return true
    if (status === 'busy') {
      errors.push({
        id: node.id,
        name: node.name,
        error: `This refers back to itself, through ${trail.join(' → ')}`,
      })
      return false
    }

    state.set(node.name, 'busy')
    for (const need of node.needs) {
      const upstream = byName.get(need)
      if (upstream && upstream !== node) {
        if (!visit(upstream, [...trail, upstream.name])) {
          state.set(node.name, 'done')
          return false
        }
      }
    }
    state.set(node.name, 'done')
    ordered.push(node)
    return true
  }

  for (const node of parsed) visit(node, [node.name])

  // --- columns that do not exist ---------------------------------------
  const available = new Set(known)
  const columns = []
  for (const node of ordered) {
    const missing = [...node.needs].filter((c) => !available.has(c) && !byName.has(c))
    if (missing.length) {
      errors.push({
        id: node.id,
        name: node.name,
        error: `No column called ${missing.map((m) => `“${m}”`).join(' or ')} on this tab`,
      })
      continue
    }
    available.add(node.name)
    columns.push(node)
  }

  return { columns, errors }
}

/**
 * The tab's columns, with the calculated ones on the end.
 *
 * Appended rather than inserted so an existing layout's column order is
 * untouched, and so it is obvious in a picker which columns the sheet has
 * and which this dashboard worked out.
 */
export function computedHeaders(headers = [], defs = []) {
  const { columns } = compileComputed(defs, headers)
  return [...headers, ...columns.map((c) => c.name)]
}

/**
 * Every row, with the calculated columns filled in.
 *
 * Returns the ORIGINAL array when there is nothing to add, so a tab with no
 * calculated columns costs nothing at all -- not a copy of forty thousand
 * rows on every render.
 */
export function applyComputed(rows, defs, { headers = [], dateOrder = 'DMY', today } = {}) {
  const source = rows || []
  const { columns } = compileComputed(defs, headers)
  if (columns.length === 0) return source

  // Shallow copies: every widget downstream treats a row as read-only, and
  // mutating the fetched rows in place would leave a calculated column
  // behind after its definition was deleted.
  let out = source.map((row) => ({ ...row }))

  for (const column of columns) {
    // One column at a time, so its aggregates are measured over the rows as
    // they stand -- including any calculated column it was built from.
    const aggregates = buildAggregates(out, aggregateKeys(column.ast))
    const ctx = { dateOrder, today, aggregates }
    out = out.map((row) => ({ ...row, [column.name]: evaluateFormula(column.ast, row, ctx) ?? '' }))
  }

  return out
}

/**
 * The first few rows of a preview, for the editor.
 *
 * Same code path as the real thing -- a preview computed a different way
 * would eventually disagree with the dashboard, and the disagreement would
 * be discovered by somebody trusting the wrong one.
 */
export function previewComputed(rows, defs, { headers = [], dateOrder = 'DMY', limit = 5 } = {}) {
  const { columns, errors } = compileComputed(defs, headers)
  const sample = (rows || []).slice(0, limit)
  return { rows: applyComputed(rows, defs, { headers, dateOrder }).slice(0, limit), columns, errors, sample }
}
