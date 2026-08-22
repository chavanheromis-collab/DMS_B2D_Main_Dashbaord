import { aggregate, isBlank, normalizeKey, toNumber } from './dataUtils.js'
import { testCondition } from './filterEngine.js'

// Re-exported: the blend defines what a key match means, and callers have
// long imported it from here. Imported as well as re-exported, because
// `export { x } from` creates no local binding and this file uses it.
export { normalizeKey }
import { parseRef } from './refs.js'

// ---------------------------------------------------------------------
// Per-widget data blending
// ---------------------------------------------------------------------
// A widget reads ONE tab. Blending lets that widget pull a second tab
// alongside it, matched row-by-row on a key column -- so a MASTER table can
// show the quoted amount that lives in Quotations, without anyone adding a
// VLOOKUP column to the spreadsheet.
//
// Deliberately scoped to ONE WIDGET. The blend is not a page-level join and
// changes nothing for any other widget: the widget's own rows are enriched
// with extra columns, everything else on the page still sees the plain tab.
// That keeps the "a filter only touches the tab it names" rule intact --
// blended columns are just more columns on the left tab's rows.
//
// Shape of `widget.blend`:
//   {
//     enabled:  true,
//     ref:      'src_x::Quotations',   // the RIGHT-hand tab
//     leftKey:  'Order #',             // key column on the widget's own tab
//     rightKey: 'Order No',            // key column on the right tab
//     type:     'left' | 'inner' | 'expand',
//     multi:    'first' | 'last' | 'concat' | 'sum',
//     prefix:   'Quotations.',         // namespaces the incoming columns
//     columns:  ['Amount', 'Status'],  // [] = bring everything
//     rollups:  [{ id, column, aggregation, as }],
//     fallbacks:[{ id, column, operator, value, value2, from, text }],
//   }
//
// A fallback rule reads "if THIS column fails THIS check, show THAT instead".
// Both column slots are addressed by side, because the two tabs routinely
// share column names:
//     'left:Default Yard'       a column of the widget's own tab
//     'right:Alt Location'      a column of the tab being blended in
//     'blend:Yard.Match count'  something the blend itself produced
// A bare name means the blended tab for the rule's target and the main tab
// for its backup -- which is what those two fields meant before either could
// name a side.

export const BLEND_TYPES = [
  {
    value: 'left',
    label: 'Keep every row (left join)',
    hint: 'Unmatched rows stay, with the blended columns blank.',
  },
  {
    value: 'inner',
    label: 'Only matching rows (inner join)',
    hint: 'Rows with no match on the other tab are dropped.',
  },
  {
    value: 'expand',
    label: 'One row per match (expand)',
    hint: 'A row matching 3 rows becomes 3 rows. Changes the row count.',
  },
]

export const BLEND_MULTI = [
  { value: 'first', label: 'First match' },
  { value: 'last', label: 'Last match' },
  { value: 'concat', label: 'Join distinct values with ", "' },
  { value: 'sum', label: 'Sum (numeric)' },
]

export const DEFAULT_BLEND = {
  enabled: false,
  ref: '',
  leftKey: '',
  rightKey: '',
  type: 'left',
  multi: 'first',
  prefix: '',
  columns: [],
  rollups: [],
  fallbacks: [],
}

/** Is this blend fully specified enough to actually run? */
export function blendIsReady(blend) {
  return Boolean(blend?.enabled && blend.ref && blend.leftKey && blend.rightKey)
}

/** Groups the right-hand rows by their normalised key. */
function indexByKey(rows, keyColumn) {
  const index = new Map()
  for (const row of rows || []) {
    const key = normalizeKey(row[keyColumn])
    if (key === null) continue
    const bucket = index.get(key)
    if (bucket) bucket.push(row)
    else index.set(key, [row])
  }
  return index
}

/** Which right-hand columns this blend brings across. */
function incomingColumns(blend, rightHeaders) {
  const available = (rightHeaders || []).filter((c) => c !== '_row')
  const chosen = blend.columns?.length ? blend.columns : available
  // Ignore a column that was picked and later deleted from the sheet.
  return chosen.filter((c) => available.includes(c))
}

/** The final name a blended column takes on the merged row. */
export function blendedColumnName(blend, column) {
  return `${blend?.prefix || ''}${column}`
}

// ---------------------------------------------------------------------
// Fallbacks -- what to show where the blend leaves a hole
// ---------------------------------------------------------------------
// A blended cell ends up empty two ways, and they look identical on screen:
// the key matched nothing at all, or it matched a row whose cell happens to
// be blank. Either way the value is missing, and a missing value is worse
// than it first appears -- a chart grouped by that column SKIPS blanks, so
// the affected rows quietly disappear and the totals no longer add up.
//
// Empty is only the most common hole, though. A zero standing in for
// "unknown", a status of "TBD", a lead time past 90 days -- all are values
// the admin would rather replace with a better column. So the trigger is the
// same condition vocabulary the buttons use (`testCondition`), not a
// hard-wired blank test: one operator list, one evaluator, one set of
// semantics to learn.

const SIDES = ['left', 'right', 'blend']

/** Encodes a column together with the side it lives on. */
export function sidedColumn(side, column) {
  return `${side}:${column}`
}

/**
 * Reads `"right:Location"` back apart.
 *
 * The side is stored because both tabs having a `Status` is normal, and a
 * bare name would be a coin toss. A bare name still parses, as `defaultSide`
 * -- that is how these fields were saved before they could name a side --
 * and an unknown prefix (a column genuinely called `Ref: Yard`) is left
 * whole rather than being torn in two.
 */
function parseSided(value, defaultSide) {
  const s = String(value ?? '').trim()
  if (!s) return null
  const at = s.indexOf(':')
  if (at === -1) return { side: defaultSide, column: s }
  const side = s.slice(0, at)
  if (!SIDES.includes(side)) return { side: defaultSide, column: s }
  return { side, column: s.slice(at + 1) }
}

/** The column a rule reads FROM. Bare = the widget's own tab. */
export function parseBackupColumn(from) {
  return parseSided(from, 'left')
}

/** The column a rule tests and overwrites. Bare = the blended tab. */
export function parseFallbackTarget(column) {
  return parseSided(column, 'right')
}

/**
 * Which column of the merged row a rule acts on.
 *
 * `right:` names a column of the other tab, which lands under the blend's
 * prefix; `left:` and `blend:` are already merged-row names. Resolving to
 * the final name here means the rest of the engine never sees a side.
 */
export function fallbackTargetColumn(blend, rule) {
  const target = parseFallbackTarget(rule?.column)
  if (!target) return null
  return target.side === 'right' ? blendedColumnName(blend, target.column) : target.column
}

/** The name a roll-up takes on the merged row. */
function rollupName(r) {
  return r.as || `${r.aggregation} of ${r.column}`
}

/** Columns the blend ADDS beyond the incoming ones: the count and roll-ups. */
export function blendExtraColumns(blend) {
  if (!blend?.ref) return []
  const rollups = (blend.rollups || []).map(rollupName).filter(Boolean)
  return [...new Set([blendedColumnName(blend, 'Match count'), ...rollups])]
}

/** Where a rule takes its replacement from, or `undefined` for "leave it". */
function backupValue(rule, before, leftRow, rightRows, multi) {
  const backup = parseBackupColumn(rule.from)
  if (backup) {
    const value =
      backup.side === 'right'
        ? // No matched rows means no right-side cell to borrow -- which is
          // exactly the unmatched case, so it falls through to the text.
          rightRows?.length
          ? collapse(rightRows, backup.column, multi)
          : ''
        : backup.side === 'blend'
          ? before[backup.column]
          : leftRow?.[backup.column]
    if (!isBlank(value)) return value
  }
  if (!isBlank(rule.text)) return rule.text
  return undefined
}

/**
 * Runs every rule against one merged row.
 *
 * Each rule reads `before` -- the row exactly as the join left it -- so no
 * rule can chain off another and the order they were added in cannot change
 * the answer. Without that, "if Location is blank use Zone" followed by "if
 * Location contains Zone, use ..." would quietly depend on which one the
 * admin happened to add first.
 */
function applyFallbacks(merged, blend, rules, leftRow, rightRows, dateOrder) {
  if (!rules.length) return merged
  const before = { ...merged }
  const multi = blend.multi || 'first'

  for (const rule of rules) {
    const column = fallbackTargetColumn(blend, rule)
    // A rule naming a column this blend no longer produces is ignored, the
    // same way a deleted column drops out of `incomingColumns`.
    if (!column || !(column in before)) continue

    const holds = testCondition(
      before,
      { column, operator: rule.operator || 'is_empty', value: rule.value, value2: rule.value2 },
      dateOrder
    )
    if (!holds) continue

    const replacement = backupValue(rule, before, leftRow, rightRows, multi)
    if (replacement !== undefined) merged[column] = replacement
  }
  return merged
}

/**
 * Collapses several matched right rows into one value, per the blend's
 * `multi` strategy. `expand` never reaches here -- it emits a row each.
 */
function collapse(matches, column, multi) {
  if (matches.length === 0) return ''
  switch (multi) {
    case 'last':
      return matches[matches.length - 1][column] ?? ''
    case 'concat': {
      const seen = []
      for (const row of matches) {
        const v = row[column]
        if (isBlank(v)) continue
        const s = String(v).trim()
        if (!seen.includes(s)) seen.push(s)
      }
      return seen.join(', ')
    }
    case 'sum': {
      const nums = matches.map((r) => toNumber(r[column])).filter((n) => n !== null)
      return nums.length ? nums.reduce((a, b) => a + b, 0) : ''
    }
    case 'first':
    default:
      return matches[0][column] ?? ''
  }
}

/**
 * The columns a blended widget ends up with -- the left tab's own headers,
 * plus each incoming column under its prefixed name, plus the match count
 * and any rollups. Feeds the admin's column pickers so a blended table can
 * be configured exactly like a plain one.
 */
export function blendedHeaders(leftHeaders, rightHeaders, blend) {
  const base = leftHeaders || []
  if (!blendIsReady(blend)) return base

  const brought = incomingColumns(blend, rightHeaders).map((c) => blendedColumnName(blend, c))

  // De-duplicate in case a prefixed name collides with a real left column.
  return [...new Set([...base, ...brought, ...blendExtraColumns(blend)])]
}

/**
 * Joins `rightRows` onto `leftRows` and returns the merged rows.
 *
 * `_row` is always the LEFT row's sheet row number and is never overwritten
 * by the right tab, so inline editing on a blended table still writes to the
 * correct cell of the correct spreadsheet.
 */
export function blendRows(leftRows, rightRows, blend, rightHeaders, dateOrder = 'DMY') {
  if (!blendIsReady(blend)) return leftRows || []

  const columns = incomingColumns(blend, rightHeaders)
  const rollups = (blend.rollups || []).filter((r) => r.column || r.aggregation === 'count')
  const index = indexByKey(rightRows, blend.rightKey)
  const rules = (blend.fallbacks || []).filter((r) => r?.column)
  const countName = blendedColumnName(blend, 'Match count')
  const type = blend.type || 'left'
  const multi = blend.multi || 'first'

  const out = []

  for (const leftRow of leftRows || []) {
    const key = normalizeKey(leftRow[blend.leftKey])
    const matches = (key === null ? null : index.get(key)) || []

    if (matches.length === 0) {
      if (type === 'inner' || type === 'expand') continue
      // Left join: keep the row, blank out every incoming column so the
      // table still has a consistent shape and sorting doesn't break.
      const blank = { ...leftRow, [countName]: 0 }
      for (const col of columns) blank[blendedColumnName(blend, col)] = ''
      for (const r of rollups) blank[rollupName(r)] = 0
      out.push(applyFallbacks(blank, blend, rules, leftRow, [], dateOrder))
      continue
    }

    if (type === 'expand') {
      // A true join: one output row per matched right row.
      for (const rightRow of matches) {
        const merged = { ...leftRow, [countName]: matches.length }
        for (const col of columns) merged[blendedColumnName(blend, col)] = rightRow[col] ?? ''
        for (const r of rollups) merged[rollupName(r)] = aggregate(matches, r.column, r.aggregation)
        merged._row = leftRow._row
        // Each emitted row is judged on its OWN matched row, not the group.
        out.push(applyFallbacks(merged, blend, rules, leftRow, [rightRow], dateOrder))
      }
      continue
    }

    const merged = { ...leftRow, [countName]: matches.length }
    for (const col of columns) merged[blendedColumnName(blend, col)] = collapse(matches, col, multi)
    for (const r of rollups) merged[rollupName(r)] = aggregate(matches, r.column, r.aggregation)
    merged._row = leftRow._row
    out.push(applyFallbacks(merged, blend, rules, leftRow, matches, dateOrder))
  }

  return out
}

/**
 * A one-line, human summary of what a blend does -- shown on the widget card
 * in the admin panel and as a caption on the dashboard, so nobody has to
 * open the editor to find out where the extra columns came from.
 */
export function describeBlend(blend, labelFor) {
  if (!blendIsReady(blend)) return ''
  const rightLabel = labelFor ? labelFor(blend.ref) : parseRef(blend.ref).tab
  const verb =
    blend.type === 'inner' ? 'matching only' : blend.type === 'expand' ? 'expanded by' : 'enriched with'
  return `${verb} ${rightLabel} on ${blend.leftKey} = ${blend.rightKey}`
}
