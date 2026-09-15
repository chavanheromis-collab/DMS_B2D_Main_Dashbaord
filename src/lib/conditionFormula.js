// ---------------------------------------------------------------------
// A condition that is a formula
// ---------------------------------------------------------------------
// Every condition on the dashboard -- a KPI's "only count rows where", a
// condition button, a row limit on a user, a clearing rule, a pipeline
// stage, a blend fallback -- is one column, one operator, one value. That
// covers "Status is Delivered". It cannot say "delivered AND more than 30
// days old AND the amount is over the average margin", which is the
// sentence people actually need a week later.
//
// So a condition can now BE a formula, in the language calculated columns
// already speak (lib/formula.js). Not a second language: somebody who has
// written `DAYSSINCE([Invoice Date]) > 30` for a column can write the same
// words as a condition, and the same parser says what is wrong with them.
//
// Three decisions shape it:
//
//   IT IS AN OPERATOR, NOT A NEW KIND OF CONDITION. Every condition in the
//   app is evaluated by one function (`testCondition`), so one new case
//   there reaches every place a condition is used, at once. A separate
//   "formula rule" type would have had to be taught to fifteen evaluators,
//   and the sixteenth would have been forgotten.
//
//   IT CARRIES A COLUMN IT DOES NOT USE. Nineteen places in this code tidy
//   a condition list with `.filter((c) => c.column)` -- a reasonable way to
//   drop half-written rows. A formula names its columns inside itself, so
//   an honest empty `column` would be silently dropped by every one of
//   them: saved, and evaluated nowhere. The sentinel keeps it alive
//   without touching nineteen files, and a header beginning with "=" is
//   one Google Sheets will not let anybody create.
//
//   IT FAILS CLOSED. A formula that does not parse, or asks for something
//   a single row cannot answer, matches NOTHING. A broken limit on what a
//   user may see must hide rows rather than show them all, and a KPI that
//   drops to zero is noticed where one that quietly counts everything is
//   not. The one exception is a formula nobody has typed yet: that is not
//   a condition at all, and an empty box must not blank the page.

import { FUNCTIONS, evaluateFormula, formulaColumns, parseFormula, truthy } from './formula.js'

export const FORMULA_OPERATOR = 'formula'

/** The column a formula condition carries so the tidy-up filters keep it. */
export const FORMULA_COLUMN = '=formula'

export const isFormulaCondition = (condition) => condition?.operator === FORMULA_OPERATOR

// ---------------------------------------------------------------------
// Compiling, once
// ---------------------------------------------------------------------

/**
 * Parsed once per distinct formula, not once per row.
 *
 * A condition runs for every row of a tab, and a tab is forty thousand
 * rows. Parsing the same text forty thousand times would make a formula
 * condition the slowest thing on the page by two orders of magnitude.
 */
const compiled = new Map()
const CACHE_LIMIT = 500

export function compileConditionFormula(text) {
  const src = String(text ?? '')
  const hit = compiled.get(src)
  if (hit) return hit

  const { ast, error } = parseFormula(src)
  const result = error
    ? { ast: null, error, wholeTable: false }
    : { ast, error: '', wholeTable: usesWholeTable(ast) }

  // A plain ceiling rather than an LRU: formulas are written by admins, a
  // page has a few dozen, and the only way past five hundred is somebody
  // typing -- where every keystroke is a new string worth forgetting.
  if (compiled.size >= CACHE_LIMIT) compiled.clear()
  compiled.set(src, result)
  return result
}

/** Does this formula ask about the whole table rather than one row? */
function usesWholeTable(ast) {
  if (!ast || typeof ast !== 'object') return false
  if (ast.kind === 'call' && FUNCTIONS[ast.name]?.agg) return true
  for (const key of ['arg', 'left', 'right']) if (usesWholeTable(ast[key])) return true
  return (ast.args || []).some(usesWholeTable)
}

// ---------------------------------------------------------------------
// Evaluating
// ---------------------------------------------------------------------

/**
 * Does one row pass this formula?
 *
 * TRUE is whatever the formula language already calls true -- the same
 * `truthy` an IF() uses -- so `[Qty]` on its own means "Qty is not blank
 * and not zero" here exactly as it does inside IF([Qty], ...).
 *
 * TOTAL, RANK and the rest measure the whole table, and a condition is
 * asked one row at a time with no table to measure. Those fail closed;
 * the editor says why, and says to use a calculated column instead, which
 * is where a whole-table measure belongs.
 */
export function formulaHolds(row, text, dateOrder = 'DMY') {
  const src = String(text ?? '')
  if (src.trim() === '') return true
  const { ast, error, wholeTable } = compileConditionFormula(src)
  if (error || wholeTable) return false
  try {
    return truthy(evaluateFormula(ast, row || {}, { dateOrder }))
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------

/**
 * What choosing an operator does to the rest of the condition.
 *
 * Choosing "formula" gives the condition its sentinel column -- see the
 * header. Leaving it clears that column rather than keeping it, or the
 * condition would come back as a column called "=formula" with an operator
 * that reads it and finds nothing.
 */
export function conditionPatch(condition, patch) {
  if (!patch || !('operator' in patch)) return patch
  if (patch.operator === FORMULA_OPERATOR) return { ...patch, column: FORMULA_COLUMN }
  if (condition?.column === FORMULA_COLUMN) return { ...patch, column: '' }
  return patch
}

/** "formula DAYSSINCE([Date]) > 30", for the summaries that list conditions. */
export function describeFormula(condition, max = 60) {
  const text = String(condition?.value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return 'formula (not written yet)'
  return `formula ${text.length > max ? `${text.slice(0, max - 1)}…` : text}`
}

// ---------------------------------------------------------------------
// Guidance: is it right?
// ---------------------------------------------------------------------

const COMPARISONS = new Set(['=', '==', '<>', '!=', '<', '<=', '>', '>=', 'AND', 'OR'])
const YES_NO_FUNCTIONS = new Set(['AND', 'OR', 'ISBLANK', 'ISNUMBER', 'CONTAINS', 'STARTSWITH', 'ENDSWITH', 'IF', 'IFS'])

/** Is this formula shaped like a yes/no, rather than like a number? */
export function isYesNo(ast) {
  if (!ast) return false
  if (ast.kind === 'not') return true
  if (ast.kind === 'binary') return COMPARISONS.has(String(ast.op).toUpperCase())
  if (ast.kind === 'call') return YES_NO_FUNCTIONS.has(ast.name)
  if (ast.kind === 'literal') return typeof ast.value === 'boolean'
  return false
}

/**
 * Everything worth saying about a formula while it is being written.
 *
 * `state` is one of:
 *   'empty'   nothing typed -- the condition is not in force yet
 *   'error'   it will match nothing, and `message` says why
 *   'warning' it works, but probably not the way it was meant
 *   'ok'      it reads correctly
 *
 * `fixes` are one-click corrections -- a misspelt column or function
 * replaced with the nearest one that exists. Saying "there is no column
 * [Stauts]" is half the help; offering [Status] is the other half.
 *
 * Columns are only checked when the list is KNOWN. An editor that has not
 * loaded a tab's headers must not call every column in the formula wrong.
 */
export function checkFormula(text, columns = []) {
  const src = String(text ?? '')
  if (src.trim() === '') {
    return { state: 'empty', message: 'Not in force until a formula is written.', fixes: [], columnsUsed: [] }
  }

  const { ast, error, wholeTable } = compileConditionFormula(src)
  if (error) {
    const fixes = []
    const unknownFn = error.match(/There is no function called ([A-Za-z_][A-Za-z0-9_.]*)\(\)/)
    if (unknownFn) {
      const near = nearest(unknownFn[1], Object.keys(FUNCTIONS))
      if (near) fixes.push({ kind: 'function', from: unknownFn[1], to: near, label: `${near}()` })
    }
    return { state: 'error', message: error, fixes, columnsUsed: [] }
  }

  const used = Array.from(formulaColumns(ast))

  if (wholeTable) {
    return {
      state: 'error',
      message:
        'TOTAL, RANK, SHAREOF and the other whole-table functions cannot be used in a condition — a condition is asked one row at a time. Make a calculated column with that measure, then compare against the column here.',
      fixes: [],
      columnsUsed: used,
    }
  }

  const known = (columns || []).filter(Boolean)
  if (known.length > 0) {
    const missing = used.filter((c) => !known.includes(c))
    if (missing.length > 0) {
      const fixes = missing
        .map((name) => ({ name, near: nearest(name, known) }))
        .filter((x) => x.near)
        .map((x) => ({ kind: 'column', from: x.name, to: x.near, label: `[${x.near}]` }))
      return {
        state: 'error',
        message:
          missing.length === 1
            ? `There is no column called [${missing[0]}] on this tab.`
            : `These are not columns on this tab: ${missing.map((m) => `[${m}]`).join(', ')}.`,
        fixes,
        columnsUsed: used,
      }
    }
  }

  if (!isYesNo(ast)) {
    return {
      state: 'warning',
      message:
        'This works out a value rather than a yes/no, so anything other than blank, 0 or FALSE counts as yes. To be exact, compare it with something — for example add “> 0”.',
      fixes: [],
      columnsUsed: used,
    }
  }

  return {
    state: 'ok',
    message: used.length > 0 ? `Reads correctly · uses ${used.map((c) => `[${c}]`).join(', ')}` : 'Reads correctly',
    fixes: [],
    columnsUsed: used,
  }
}

/** Apply one of `checkFormula`'s fixes to the text. */
export function applyFix(text, fix) {
  const src = String(text ?? '')
  if (!fix) return src
  if (fix.kind === 'column') return src.split(`[${fix.from}]`).join(`[${fix.to}]`)
  // A function is matched as a whole word followed by "(", case-blind,
  // because that is how it was typed and how the parser read it.
  const pattern = new RegExp(`\\b${escapeRegExp(fix.from)}(?=\\s*\\()`, 'gi')
  return src.replace(pattern, fix.to)
}

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The closest name in a list, or '' if nothing is close enough.
 *
 * Case first -- [status] for [Status] is the commonest mistake there is --
 * then edit distance, with a limit that grows with the length of the name:
 * one slip in a four-letter name is a different word, two in a twenty-
 * letter one is a typo.
 */
export function nearest(name, list) {
  const wanted = String(name ?? '')
  if (!wanted) return ''
  const lower = wanted.toLowerCase()
  const exact = (list || []).find((c) => String(c).toLowerCase() === lower)
  if (exact) return exact

  let best = ''
  let bestScore = Infinity
  for (const candidate of list || []) {
    const score = distance(lower, String(candidate).toLowerCase())
    if (score < bestScore) {
      best = candidate
      bestScore = score
    }
  }
  // A swapped pair of letters -- [Stauts] -- is two edits, and it is the
  // single commonest typo there is, so anything past three letters is
  // allowed at least two. Three letters or fewer get one: at that length
  // two edits is a different word, and "did you mean [Amt]?" for [Age]
  // is a suggestion that makes the help look stupid.
  const limit = wanted.length <= 3 ? 1 : Math.max(2, Math.floor(wanted.length / 3))
  return bestScore <= limit ? best : ''
}

function distance(a, b) {
  if (a === b) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const above = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return prev[b.length]
}

// ---------------------------------------------------------------------
// Guidance: what could go here?
// ---------------------------------------------------------------------

const MAX_SUGGESTIONS = 8

/**
 * What to offer at the cursor, and the stretch of text accepting it
 * replaces.
 *
 * Two places a suggestion makes sense, and they want different lists:
 *
 *   INSIDE AN OPEN "[" -- a column name is being typed, so offer columns,
 *   and replace from the bracket to the end of that name so accepting one
 *   never leaves "[Stat[Status]]" behind.
 *
 *   ON A BARE WORD -- a function OR a column: people type "days" meaning
 *   DAYSSINCE and "amo" meaning [Amount], and making them know which kind
 *   of thing they want before they can be helped is the wrong way round.
 *
 * Nothing is offered inside quotes: "Delivered" is a value, and a list of
 * functions popping up over it is noise.
 *
 * `signature` is the function the cursor is inside, and which of its
 * arguments is being written -- the thing that stops IF(test, then, else)
 * being typed with the else in the wrong place.
 */
export function suggestionsAt(text, cursor, columns = []) {
  const src = String(text ?? '')
  const at = Math.max(0, Math.min(src.length, Number.isFinite(cursor) ? cursor : src.length))
  const before = src.slice(0, at)
  const known = Array.from(new Set((columns || []).filter(Boolean)))
  const signature = signatureAt(src, at)

  const none = { items: [], replaceFrom: at, replaceTo: at, signature }
  if (insideQuotes(before)) return none

  const open = before.lastIndexOf('[')
  if (open > before.lastIndexOf(']')) {
    const prefix = before.slice(open + 1)
    const rest = src.slice(at).match(/^[^[\]]*\]/)
    return {
      items: rankColumns(known, prefix).map(columnItem),
      replaceFrom: open,
      replaceTo: rest ? at + rest[0].length : at,
      signature,
    }
  }

  const word = before.match(/[A-Za-z_][A-Za-z0-9_]*$/)
  if (!word) return none
  const prefix = word[0]
  const tail = src.slice(at).match(/^[A-Za-z0-9_]*/)[0]

  const upper = prefix.toUpperCase()
  // Whole-table functions are left out: offering TOTAL() and then calling
  // it an error the moment it is chosen is the help contradicting itself.
  const functions = Object.keys(FUNCTIONS)
    .filter((name) => name.startsWith(upper) && !FUNCTIONS[name].agg)
    .map((name) => ({ kind: 'function', label: `${name}()`, insert: `${name}(`, detail: FUNCTIONS[name].hint }))

  return {
    items: [...functions, ...rankColumns(known, prefix).map(columnItem)].slice(0, MAX_SUGGESTIONS),
    replaceFrom: at - prefix.length,
    replaceTo: at + tail.length,
    signature,
  }
}

const columnItem = (name) => ({ kind: 'column', label: name, insert: `[${name}]`, detail: 'column' })

/** Columns that start with what was typed first, then ones that contain it. */
function rankColumns(columns, prefix) {
  const wanted = String(prefix ?? '').trim().toLowerCase()
  if (!wanted) return columns.slice(0, MAX_SUGGESTIONS)
  const starts = columns.filter((c) => c.toLowerCase().startsWith(wanted))
  const contains = columns.filter((c) => !c.toLowerCase().startsWith(wanted) && c.toLowerCase().includes(wanted))
  return [...starts, ...contains].slice(0, MAX_SUGGESTIONS)
}

/** Is the end of this text inside an unfinished "..." or '...'? */
function insideQuotes(text) {
  let quote = ''
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (quote) {
      if (c === quote) quote = ''
      continue
    }
    // A column name may hold an apostrophe -- [Owner's Name] -- and must
    // not be read as opening a string.
    if (c === '[') {
      const end = text.indexOf(']', i)
      if (end === -1) return false
      i = end
      continue
    }
    if (c === '"' || c === "'") quote = c
  }
  return quote !== ''
}

/**
 * The innermost function call the cursor is inside, and which argument.
 *
 * Commas inside quotes, inside [brackets] and inside a nested call do not
 * move the argument count -- IF(CONTAINS([Note], "a, b"), ...) is still on
 * its first argument until the comma after the closing bracket.
 */
export function signatureAt(text, cursor) {
  const src = String(text ?? '')
  const at = Math.max(0, Math.min(src.length, Number.isFinite(cursor) ? cursor : src.length))
  const stack = []
  let quote = ''

  for (let i = 0; i < at; i += 1) {
    const c = src[i]
    if (quote) {
      if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c === '[') {
      const end = src.indexOf(']', i)
      if (end === -1 || end >= at) break
      i = end
      continue
    }
    if (c === '(') {
      const name = src.slice(0, i).match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/)
      stack.push({ name: name ? name[1].toUpperCase() : '', commas: 0 })
      continue
    }
    if (c === ')') {
      stack.pop()
      continue
    }
    if (c === ',' && stack.length > 0) stack[stack.length - 1].commas += 1
  }

  for (let k = stack.length - 1; k >= 0; k -= 1) {
    const meta = FUNCTIONS[stack[k].name]
    if (meta) return { name: stack[k].name, hint: meta.hint, argIndex: stack[k].commas }
  }
  return null
}

/**
 * A function's hint, split so the argument being written can be bolded.
 *
 * "IFS(test1, value1, …, fallback) — note" gives the name, the arguments
 * and the note. A variadic function's last argument repeats, so an index
 * past the end stays on the last one rather than bolding nothing.
 */
export function signatureParts(hint, argIndex = 0) {
  const m = String(hint ?? '').match(/^([A-Za-z_][A-Za-z0-9_]*)\((.*?)\)(.*)$/)
  if (!m) return { name: '', args: [], note: String(hint ?? ''), current: -1 }
  const args = m[2] ? m[2].split(/\s*,\s*/) : []
  const current = args.length === 0 ? -1 : Math.min(Math.max(0, argIndex), args.length - 1)
  return { name: m[1], args, note: m[3].replace(/^\s*—\s*/, '').trim(), current }
}

/** Put an accepted suggestion into the text, and say where the cursor goes. */
export function applySuggestion(text, item, { replaceFrom, replaceTo } = {}) {
  const src = String(text ?? '')
  const from = Number.isFinite(replaceFrom) ? replaceFrom : src.length
  const to = Number.isFinite(replaceTo) ? replaceTo : from
  const next = src.slice(0, from) + item.insert + src.slice(to)
  return { text: next, cursor: from + item.insert.length }
}

// ---------------------------------------------------------------------
// Starting points
// ---------------------------------------------------------------------

const guess = (columns, pattern, index = 0, fallback = 'Column') => {
  const list = (columns || []).filter(Boolean)
  const matched = list.filter((c) => pattern.test(c))
  return matched[index] || list[index] || fallback
}

const DATE = /date|day|dt\b/i
const NUMBER = /amount|price|value|cost|total|qty|quantity|sale|margin|count/i
const TEXT = /status|stage|remark|note|name|type|branch/i

/**
 * The shapes a formula condition usually turns out to be, pre-written with
 * this tab's own column names.
 *
 * A blank formula box is a blank page. Nine conditions out of ten are one
 * of these, and editing a working one is much easier than starting cold.
 */
export const FORMULA_STARTERS = [
  {
    id: 'both',
    label: 'Two things at once',
    build: (c) => `AND([${guess(c, TEXT)}] = "Delivered", [${guess(c, NUMBER)}] > 0)`,
  },
  {
    id: 'either',
    label: 'Either of two values',
    build: (c) => `OR([${guess(c, TEXT)}] = "Booked", [${guess(c, TEXT)}] = "Delivered")`,
  },
  {
    id: 'age',
    label: 'Older than 30 days',
    build: (c) => `DAYSSINCE([${guess(c, DATE)}]) > 30`,
  },
  {
    id: 'contains',
    label: 'Text contains a word',
    build: (c) => `CONTAINS([${guess(c, TEXT)}], "urgent")`,
  },
  {
    id: 'filled',
    label: 'Is filled in',
    build: (c) => `LEN(TRIM([${guess(c, TEXT)}])) > 0`,
  },
  {
    id: 'compare',
    label: 'One column above another',
    build: (c) => `[${guess(c, NUMBER, 0)}] > [${guess(c, NUMBER, 1)}]`,
  },
]
