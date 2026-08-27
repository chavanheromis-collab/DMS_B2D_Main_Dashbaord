// ---------------------------------------------------------------------
// Column profile -- is this sheet actually fit to report on?
// ---------------------------------------------------------------------
// Every dashboard in this app is downstream of a Google Sheet that people
// type into by hand. That means the interesting failure is never a bug in
// a chart; it is a column that is 40% blank, a date column with eleven
// values that are not dates, and a Status column with both "Delivered" and
// "delivered " in it.
//
// None of those are visible from a chart -- a bar chart of a column with a
// trailing space just quietly grows a second bar, and a KPI over a column
// that stopped being filled in last March simply gets smaller. The only
// way to see them is to look at the column itself, which is what this does
// for every column at once.
//
// It is a diagnostic, so it is blunt on purpose: fill rate, how many
// distinct values, what type the column looks like, what the commonest
// values are, and -- the one that finds the most real problems -- how many
// values differ from another value only by case or whitespace.

import { isBlank, toDate, toNumber } from './dataUtils.js'

export const PROFILE_SORTS = [
  { value: 'sheet', label: 'Sheet order' },
  { value: 'fill_asc', label: 'Emptiest first' },
  { value: 'fill_desc', label: 'Fullest first' },
  { value: 'distinct_desc', label: 'Most distinct values first' },
  { value: 'name_asc', label: 'Name, A→Z' },
]

export const DEFAULT_PROFILE = {
  columns: [],
  sort: 'sheet',
  topValues: 5,
  showSamples: true,
  // A column that is 100% filled and consistent is not what anybody opened
  // this widget for. Hiding the clean ones turns a wall of green into a
  // short list of things to fix.
  problemsOnly: false,
  fillWarning: 90,
}

/**
 * Does this cell LOOK like a number, rather than merely survive `toNumber`?
 *
 * The app's own `toNumber` is deliberately forgiving -- it has to be, since
 * it is what turns "₹1,20,000" and "(320)" into figures, and it does that
 * by throwing away everything that is not a digit. That is exactly right
 * for reading a value and exactly wrong for guessing a TYPE: it reports the
 * order number "INV-4471" as the number 4471, and a column of invoice
 * references as a column of amounts.
 *
 * So the shape is checked first. Decoration is allowed off the ends;
 * letters in the middle are not.
 */
export function looksNumeric(value) {
  const s = String(value ?? '').trim()
  if (!s) return false
  const bare = s
    .replace(/^\((.*)\)$/, '-$1')
    .replace(/[₹$€£¥]/g, '')
    .replace(/%$/, '')
    .replace(/,/g, '')
    .replace(/\s/g, '')
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(bare)
}

/**
 * Does this cell LOOK like a date?
 *
 * Same problem from the other side. `toDate` ends by handing anything left
 * over to `new Date(...)`, which cheerfully reads the string "109" as the
 * year 109 -- so every column of small numbers profiles as a date column.
 * Requiring a recognisable date SHAPE first (separators, or a month name)
 * is what tells an amount from an anniversary.
 */
export function looksDateLike(value, dateOrder = 'DMY') {
  const s = String(value ?? '').trim()
  if (!s) return false
  const shaped =
    /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s) ||
    /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(s) ||
    /^\d{1,2}[-\s][A-Za-z]{3,}[-\s]\d{2,4}/.test(s) ||
    /^[A-Za-z]{3,}\s+\d{1,2},?\s+\d{2,4}/.test(s)
  return shaped && toDate(s, dateOrder) !== null
}

/** What a column looks like it holds, decided by what most of it parses as. */
export function guessType(values, dateOrder = 'DMY') {
  const filled = values.filter((v) => !isBlank(v))
  if (filled.length === 0) return 'empty'

  const numeric = filled.filter(looksNumeric).length
  const dated = filled.filter((v) => looksDateLike(v, dateOrder)).length

  // Dates are tested before numbers because a date typed as 20260314 parses
  // as both, and calling it a number would hide a real date column behind
  // a set of statistics nobody wants (the mean of a date is not a thing).
  if (dated / filled.length >= 0.8) return 'date'
  if (numeric / filled.length >= 0.8) return 'number'

  const distinct = new Set(filled.map((v) => String(v).trim().toLowerCase())).size
  // A handful of repeated values is a category; four hundred unique ones is
  // free text, and the two want completely different widgets.
  if (distinct <= Math.max(20, filled.length * 0.05)) return 'category'
  return 'text'
}

/**
 * Values that are the same value with different clothes on.
 *
 * The single most common real defect in a hand-typed sheet, and completely
 * invisible everywhere else in the app: "Delivered", "delivered" and
 * "Delivered " are three bars in every chart and one thing in reality.
 * Reported as GROUPS rather than as a count, because the fix needs to know
 * which spellings to merge.
 */
export function nearDuplicates(values, cap = 6) {
  const byNormal = new Map()
  for (const v of values) {
    if (isBlank(v)) continue
    const raw = String(v)
    const key = raw.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!key) continue
    const bucket = byNormal.get(key)
    if (bucket) bucket.add(raw)
    else byNormal.set(key, new Set([raw]))
  }

  const groups = []
  for (const [key, variants] of byNormal) {
    if (variants.size > 1) groups.push({ key, variants: [...variants] })
    if (groups.length >= cap) break
  }
  return groups
}

/** One column, profiled. */
export function profileColumn(rows, column, { dateOrder = 'DMY', topValues = 5 } = {}) {
  const values = (rows || []).map((r) => r[column])
  const total = values.length
  const filled = values.filter((v) => !isBlank(v))
  const blanks = total - filled.length

  const counts = new Map()
  for (const v of filled) {
    const key = String(v).trim()
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, Math.max(1, Math.min(20, Math.round(topValues) || 5)))
    .map(([value, count]) => ({ value, count, share: filled.length ? (count / filled.length) * 100 : 0 }))

  const type = guessType(values, dateOrder)
  const profile = {
    column,
    total,
    filled: filled.length,
    blanks,
    fillRate: total ? (filled.length / total) * 100 : 0,
    distinct: counts.size,
    // A column where almost every row is different is a key or free text,
    // and grouping by it is what produces a chart of four hundred bars.
    uniqueness: filled.length ? (counts.size / filled.length) * 100 : 0,
    type,
    top,
    nearDuplicates: nearDuplicates(filled),
    samples: filled.slice(0, 3).map((v) => String(v)),
  }

  if (type === 'number') {
    // Counted with the STRICT check, not the forgiving one: the whole
    // point of the finding is "eleven cells in this column of amounts are
    // not amounts", and the forgiving parser would have quietly turned
    // each of them into a number and reported nothing wrong.
    const usable = filled.filter(looksNumeric)
    const nums = usable.map(toNumber).filter((n) => n !== null)
    profile.unparsed = filled.length - usable.length
    if (nums.length) {
      const sorted = [...nums].sort((a, b) => a - b)
      profile.min = sorted[0]
      profile.max = sorted[sorted.length - 1]
      profile.mean = nums.reduce((a, b) => a + b, 0) / nums.length
      profile.median = sorted[Math.floor(sorted.length / 2)]
      profile.negatives = nums.filter((n) => n < 0).length
      profile.zeroes = nums.filter((n) => n === 0).length
    }
  }

  if (type === 'date') {
    const usable = filled.filter((v) => looksDateLike(v, dateOrder))
    const dates = usable.map((v) => toDate(v, dateOrder)).filter(Boolean)
    profile.unparsed = filled.length - usable.length
    if (dates.length) {
      const ms = dates.map((d) => d.getTime()).sort((a, b) => a - b)
      profile.earliest = new Date(ms[0])
      profile.latest = new Date(ms[ms.length - 1])
      // A date column whose newest value is months old is a column that
      // stopped being filled in, which every number derived from it is
      // silently wrong about.
      profile.staleDays = Math.round((Date.now() - ms[ms.length - 1]) / 86400000)
      profile.future = ms.filter((t) => t > Date.now()).length
    }
  }

  profile.issues = columnIssues(profile)
  return profile
}

/**
 * What is actually wrong with a column, in words.
 *
 * A percentage is a fact and "40% blank" is a finding; the widget exists to
 * produce the second. Each issue carries a severity so the list can be
 * ordered by what to fix first rather than by column order.
 */
export function columnIssues(profile, { fillWarning = 90 } = {}) {
  const issues = []
  const pct = (n) => Math.round(n)

  if (profile.total === 0) return issues

  if (profile.filled === 0) {
    issues.push({ key: 'empty', severity: 'high', text: 'Completely empty' })
    return issues
  }
  if (profile.fillRate < 50) {
    issues.push({ key: 'sparse', severity: 'high', text: `Only ${pct(profile.fillRate)}% filled` })
  } else if (profile.fillRate < fillWarning) {
    issues.push({ key: 'gaps', severity: 'medium', text: `${pct(100 - profile.fillRate)}% blank` })
  }

  if (profile.nearDuplicates?.length) {
    issues.push({
      key: 'casing',
      severity: 'medium',
      text: `${profile.nearDuplicates.length} value${profile.nearDuplicates.length === 1 ? '' : 's'} differ only by case or spacing`,
    })
  }

  if (profile.unparsed > 0) {
    issues.push({
      key: 'unparsed',
      severity: 'high',
      text: `${profile.unparsed} value${profile.unparsed === 1 ? '' : 's'} are not a valid ${profile.type}`,
    })
  }

  if (profile.type === 'date' && profile.staleDays > 30) {
    issues.push({ key: 'stale', severity: 'medium', text: `Nothing newer than ${profile.staleDays} days ago` })
  }
  if (profile.type === 'date' && profile.future > 0) {
    issues.push({ key: 'future', severity: 'low', text: `${profile.future} date${profile.future === 1 ? '' : 's'} in the future` })
  }

  if (profile.distinct === 1) {
    issues.push({ key: 'constant', severity: 'low', text: 'Every filled row has the same value' })
  }

  return issues
}

const SORTERS = {
  fill_asc: (a, b) => a.fillRate - b.fillRate,
  fill_desc: (a, b) => b.fillRate - a.fillRate,
  distinct_desc: (a, b) => b.distinct - a.distinct,
  name_asc: (a, b) => String(a.column).localeCompare(String(b.column)),
}

/** Every column the widget was pointed at. */
export function profileData(widget, { rows = [], headers = [], dateOrder = 'DMY' } = {}) {
  const config = { ...DEFAULT_PROFILE, ...(widget || {}) }
  const chosen = (config.columns || []).filter((c) => headers.includes(c))
  const columns = chosen.length ? chosen : headers

  const profiles = columns.map((column) =>
    profileColumn(rows, column, { dateOrder, topValues: config.topValues })
  )

  // Recomputed with the admin's own threshold. `profileColumn` uses the
  // default so it stays useful on its own, and this is the one place that
  // knows what THIS widget calls acceptable.
  for (const p of profiles) p.issues = columnIssues(p, { fillWarning: config.fillWarning })

  const sorted = SORTERS[config.sort] ? [...profiles].sort(SORTERS[config.sort]) : profiles
  const shown = config.problemsOnly ? sorted.filter((p) => p.issues.length > 0) : sorted

  return {
    ready: columns.length > 0,
    profiles: shown,
    all: profiles,
    rowCount: (rows || []).length,
    columnCount: columns.length,
    // A one-line verdict for the card header, so the widget says something
    // even when it is collapsed to its title.
    problemColumns: profiles.filter((p) => p.issues.length > 0).length,
    highSeverity: profiles.filter((p) => p.issues.some((i) => i.severity === 'high')).length,
    hiddenClean: config.problemsOnly ? sorted.length - shown.length : 0,
  }
}
