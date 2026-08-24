// ---------------------------------------------------------------------
// What one person is allowed to see, row by row
// ---------------------------------------------------------------------
// Page access is all-or-nothing: you can open the Sales page or you cannot.
// That is the wrong shape for the commonest request there is -- "Ravi should
// see the Sales page, but only the west" -- which has until now meant
// building a second page with a filter baked in, then a third, then keeping
// all of them in step for ever.
//
// A SCOPE is a filter attached to one user's access to one page. It runs
// before anything the reader can touch, cannot be cleared from the page, and
// is invisible: it is not a control they forgot to reset, it is the extent
// of their data.
//
// Two rules it must never break:
//
//   It fails CLOSED. A scope whose value cannot be worked out shows nothing,
//   not everything. Row-level security that degrades into "all rows" on a
//   missing field is how a leak happens quietly.
//
//   It is not a control. Nothing on the page removes it, no saved view
//   restores past it, and Reset does not touch it -- see how it reaches the
//   engine in Dashboard.jsx.

import { matchesConditions } from './filterEngine.js'

export const DEFAULT_SCOPE = { match: 'all', conditions: [] }

/**
 * Values that stand for whoever is signed in.
 *
 * The point of these is that one rule serves everybody: `DSE Email` equals
 * `{{email}}` on the page, and forty reps each see their own rows without
 * forty separate settings to write and keep current. A per-user scope is
 * still there for the cases that are genuinely per-user.
 */
export const SCOPE_TOKENS = [
  { token: '{{email}}', label: 'their email', field: 'email' },
  { token: '{{name}}', label: 'their name', field: 'name' },
  { token: '{{jobRole}}', label: 'their work role', field: 'jobRole' },
  { token: '{{uid}}', label: 'their account id', field: 'uid' },
]

const TOKEN_PATTERN = /\{\{\s*(email|name|jobRole|uid)\s*\}\}/g

export function hasToken(value) {
  TOKEN_PATTERN.lastIndex = 0
  return TOKEN_PATTERN.test(String(value ?? ''))
}

/**
 * Fills the tokens in one value.
 *
 * Returns null when a token has nothing to stand for -- a user with no work
 * role, a rule written before that field existed. Null travels upward and
 * turns the whole scope into "nothing", because the alternative is matching
 * the literal text "{{jobRole}}" against every row, finding nothing, and
 * looking identical to a working rule right up until somebody's data leaks
 * through a rule that quietly matched everything instead.
 */
export function resolveValue(value, user) {
  const text = String(value ?? '')
  if (!hasToken(text)) return text

  let missing = false
  const out = text.replace(TOKEN_PATTERN, (_, field) => {
    const found = String(user?.[field] ?? '').trim()
    if (!found) missing = true
    return found
  })
  return missing ? null : out
}

/** Is there anything here to enforce? */
export function scopeIsActive(scope) {
  return (scope?.conditions || []).some((c) => c && c.column && c.tab)
}

/**
 * The scope's conditions with every token filled in.
 *
 * `{ blocked: true }` means a condition could not be resolved, which shows
 * the reader nothing at all rather than everything.
 */
export function resolveScope(scope, user) {
  if (!scopeIsActive(scope)) return { conditions: [], blocked: false }

  const conditions = []
  for (const condition of scope.conditions) {
    if (!condition?.column || !condition?.tab) continue

    const value = resolveValue(condition.value, user)
    const value2 = resolveValue(condition.value2, user)
    if (value === null || value2 === null) return { conditions: [], blocked: true }

    conditions.push({ ...condition, value, value2 })
  }
  return { conditions, blocked: false }
}

/**
 * The scope as something the filter engine already understands.
 *
 * A conditions cross-filter, which is exactly the right shape: each
 * condition names its own tab, a tab it says nothing about is left alone,
 * and it stacks with everything else rather than replacing it. It never
 * reaches the chips the reader can dismiss -- the Dashboard passes it
 * straight to the engine.
 */
export function scopeFilter(scope, user, id = 'scope') {
  const { conditions, blocked } = resolveScope(scope, user)

  if (blocked) {
    // Nothing resolvable, so nothing at all. `keys: []` empties every tab
    // the scope named rather than leaving them open.
    const tabs = (scope?.conditions || []).filter((c) => c?.tab).map((c) => ({ tab: c.tab, column: '_row' }))
    if (tabs.length === 0) return null
    return { id, kind: 'keys', keys: [], keyColumns: tabs, keyNames: [], scope: true }
  }

  if (conditions.length === 0) return null
  return { id, kind: 'conditions', match: scope.match || 'all', conditions, scope: true }
}

/** Does this row survive the scope? Used by tests and by anything non-tabular. */
export function rowInScope(row, scope, user, tab, dateOrder = 'DMY') {
  const { conditions, blocked } = resolveScope(scope, user)
  if (blocked) return false
  const mine = conditions.filter((c) => c.tab === tab)
  if (mine.length === 0) return true
  return matchesConditions(row, mine, scope.match || 'all', dateOrder)
}

/** A one-line summary for the admin list: "MASTER · Region is West". */
export function describeScope(scope, labelFor = (t) => t) {
  const conditions = (scope?.conditions || []).filter((c) => c?.column && c?.tab)
  if (conditions.length === 0) return ''

  const joiner = scope?.match === 'any' ? ' or ' : ' and '
  return conditions
    .map((c) => `${labelFor(c.tab)} · ${c.column} ${c.operator || 'equals'} ${c.value ?? ''}`.trim())
    .join(joiner)
}
