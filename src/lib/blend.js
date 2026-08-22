import { aggregate, isBlank, normalizeKey, toNumber } from './dataUtils.js'

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
//     fallbacks:[{ id, column, from, text }],  // when a blended cell is blank
//                 from: 'left:Default Yard' | 'right:Alt Location'
//   }

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

/**
 * What to show when the other tab has nothing to give.
 *
 * Two ways a blended cell ends up empty, and they look identical on screen:
 * the key matched nothing at all, or it matched a row whose cell happens to
 * be blank. Either way the value is missing, and a missing value is worse
 * than it first appears -- a chart grouped by that column SKIPS blanks, so
 * the affected rows quietly disappear and the totals no longer add up.
 *
 * A fallback fills the gap from the widget's OWN tab: a column the admin
 * picks, or a literal like "Not allocated". Order is deliberate -- the real
 * value, then the main tab's own answer, then the caption of last resort.
 */
function fallbackIndex(blend) {
  const map = new Map()
  for (const rule of blend?.fallbacks || []) {
    if (rule?.column) map.set(rule.column, rule)
  }
  return map
}

/**
 * A backup column reference: `"left:Default Yard"` or `"right:Alt Location"`.
 *
 * The side is part of the value because the two tabs can easily both have a
 * column called `Status`, and a bare name would be ambiguous. A bare name is
 * still accepted and read as the main tab, so rules saved before backups
 * could come from either side keep working.
 */
export function parseBackupColumn(from) {
  const s = String(from || '').trim()
  if (!s) return null
  const at = s.indexOf(':')
  if (at === -1) return { side: 'left', column: s }
  const side = s.slice(0, at)
  if (side !== 'left' && side !== 'right') return { side: 'left', column: s }
  return { side, column: s.slice(at + 1) }
}

export function backupColumnValue(side, column) {
  return `${side}:${column}`
}

/**
 * Fills a blank blended cell from a backup column, then from a literal.
 *
 * The backup may be a column on EITHER tab -- the widget's own, or another
 * column of the tab being blended in. A right-side backup is collapsed with
 * the same multi-match strategy as the value it replaces, so "last match"
 * means the same thing for both.
 */
function withFallback(value, rule, leftRow, rightRows, multi) {
  if (!isBlank(value)) return value
  if (!rule) return value

  const backup = parseBackupColumn(rule.from)
  if (backup) {
    const replacement =
      backup.side === 'right'
        ? // No matched rows means no right-side value to borrow -- which is
          // exactly the unmatched case, so it falls through to the text.
          (rightRows?.length ? collapse(rightRows, backup.column, multi) : '')
        : leftRow?.[backup.column]
    if (!isBlank(replacement)) return replacement
  }

  if (!isBlank(rule.text)) return rule.text
  return value
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
  const rollups = (blend.rollups || []).map((r) => r.as || `${r.aggregation} of ${r.column}`).filter(Boolean)
  const count = blendedColumnName(blend, 'Match count')

  // De-duplicate in case a prefixed name collides with a real left column.
  return [...new Set([...base, ...brought, count, ...rollups])]
}

/**
 * Joins `rightRows` onto `leftRows` and returns the merged rows.
 *
 * `_row` is always the LEFT row's sheet row number and is never overwritten
 * by the right tab, so inline editing on a blended table still writes to the
 * correct cell of the correct spreadsheet.
 */
export function blendRows(leftRows, rightRows, blend, rightHeaders) {
  if (!blendIsReady(blend)) return leftRows || []

  const columns = incomingColumns(blend, rightHeaders)
  const rollups = (blend.rollups || []).filter((r) => r.column || r.aggregation === 'count')
  const index = indexByKey(rightRows, blend.rightKey)
  const fallbacks = fallbackIndex(blend)
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
      for (const col of columns) {
        blank[blendedColumnName(blend, col)] = withFallback('', fallbacks.get(col), leftRow, [], multi)
      }
      for (const r of rollups) blank[r.as || `${r.aggregation} of ${r.column}`] = 0
      out.push(blank)
      continue
    }

    if (type === 'expand') {
      // A true join: one output row per matched right row.
      for (const rightRow of matches) {
        const merged = { ...leftRow, [countName]: matches.length }
        for (const col of columns) {
          merged[blendedColumnName(blend, col)] = withFallback(
            rightRow[col] ?? '',
            fallbacks.get(col),
            leftRow,
            [rightRow],
            multi
          )
        }
        for (const r of rollups) {
          merged[r.as || `${r.aggregation} of ${r.column}`] = aggregate(matches, r.column, r.aggregation)
        }
        merged._row = leftRow._row
        out.push(merged)
      }
      continue
    }

    const merged = { ...leftRow, [countName]: matches.length }
    for (const col of columns) {
      merged[blendedColumnName(blend, col)] = withFallback(
        collapse(matches, col, multi),
        fallbacks.get(col),
        leftRow,
        matches,
        multi
      )
    }
    for (const r of rollups) {
      merged[r.as || `${r.aggregation} of ${r.column}`] = aggregate(matches, r.column, r.aggregation)
    }
    merged._row = leftRow._row
    out.push(merged)
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
