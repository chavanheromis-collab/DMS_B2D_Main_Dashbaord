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
import { FILTER_COLUMN, FILTER_OPERATOR } from './namedFilters.js'

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
  return [...(ast.args || []), ...(ast.items || [])].some(usesWholeTable)
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
  const wasFilter = condition?.column === FILTER_COLUMN
  if (patch.operator === FORMULA_OPERATOR) {
    // A named filter's value is a widget's id, which is not a formula.
    return { ...patch, column: FORMULA_COLUMN, ...(wasFilter ? { value: '' } : {}) }
  }
  // A named filter carries its own sentinel -- see lib/namedFilters.js --
  // and starts unchosen: whatever the row held before is not a filter's id.
  if (patch.operator === FILTER_OPERATOR) return { ...patch, column: FILTER_COLUMN, value: '' }
  if (wasFilter) return { ...patch, column: '', value: '' }
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
const YES_NO_FUNCTIONS = new Set([
  'AND',
  'OR',
  'ISBLANK',
  'ISNUMBER',
  'CONTAINS',
  'NOTCONTAINS',
  'CONTAINSALL',
  'STARTSWITH',
  'ENDSWITH',
  'IN',
  'NOTIN',
  'WHEN',
  'BETWEEN',
  'ISFILLED',
  'LIKE',
  'ISTODAY',
  'INLASTDAYS',
  'INNEXTDAYS',
  'OLDERTHAN',
  'THISWEEK',
  'THISMONTH',
  'THISYEAR',
  'INFILTER',
  'IF',
  'IFS',
])

/** Is this formula shaped like a yes/no, rather than like a number? */
export function isYesNo(ast) {
  if (!ast) return false
  if (ast.kind === 'not') return true
  if (ast.kind === 'binary') return COMPARISONS.has(String(ast.op).toUpperCase())
  if (ast.kind === 'call') return YES_NO_FUNCTIONS.has(ast.name)
  if (ast.kind === 'literal') return typeof ast.value === 'boolean'
  return false
}

// ---------------------------------------------------------------------
// Guidance: the mistakes a spreadsheet habit makes
// ---------------------------------------------------------------------
// Most wrong formulas are not typos. They are something that is right in
// Excel, or right in English, written in a language that says it another
// way:
//
//   <>CONTAINS("x")        "does not contain" -- but <> compares two things,
//                          and there is nothing on its left
//   CONTAINS("x")          contains, in WHAT? The column is missing
//   NOTCONTAINS([A], "x")  no such function -- and its nearest spelling is
//                          CONTAINS, which is the exact opposite
//   IF(test, yes, [Col])   "otherwise show everything" -- but a column is a
//                          value, and a row where it is blank is hidden
//
// The parser's own complaint about each is true and no help: I don't
// understand "<>" here. So these are recognised by their shape, said in the
// terms the person was thinking in, and each comes with the corrected
// formula as one click.

/** Functions that look for text IN something, and so need both halves. */
const LOOKS_IN = new Set(['CONTAINS', 'NOTCONTAINS', 'CONTAINSALL', 'STARTSWITH', 'ENDSWITH'])

/** Functions that take "any of these" after their first argument. */
const LIST_TAKERS = new Set([...LOOKS_IN, 'IN', 'NOTIN'])

/** The one word a negative has, where it has one: CONTAINS → NOTCONTAINS. */
const NEGATIVE = { CONTAINS: 'NOTCONTAINS', IN: 'NOTIN' }

/**
 * Every closed function call in the text: its name, where the name starts,
 * its brackets, and the stretch of text each argument occupies.
 *
 * Read the way the parser reads, so a comma or a bracket inside "quotes" or
 * inside a [Column (ex GST)] does not split an argument.
 */
export function callsIn(text) {
  const src = String(text ?? '')
  const calls = []
  const stack = []
  let quote = ''

  for (let i = 0; i < src.length; i += 1) {
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
      if (end === -1) break
      i = end
      continue
    }
    if (c === '(') {
      const m = src.slice(0, i).match(/([A-Za-z_][A-Za-z0-9_.]*)\s*$/)
      stack.push({ typed: m ? m[1] : '', nameStart: m ? m.index : i, open: i, marks: [i] })
      continue
    }
    if (c === ',' && stack.length > 0) {
      stack[stack.length - 1].marks.push(i)
      continue
    }
    if (c === ')' && stack.length > 0) {
      const call = stack.pop()
      const marks = [...call.marks, i]
      const args = []
      for (let k = 0; k + 1 < marks.length; k += 1) args.push({ from: marks[k] + 1, to: marks[k + 1] })
      // "TODAY()" has no arguments, not one empty one.
      const none = args.length === 1 && src.slice(args[0].from, args[0].to).trim() === ''
      if (call.typed) {
        calls.push({
          name: call.typed.toUpperCase(),
          typed: call.typed,
          nameStart: call.nameStart,
          open: call.open,
          close: i,
          args: none ? [] : args,
        })
      }
    }
  }
  return calls
}

const clipText = (value, max = 32) => {
  const t = String(value ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/**
 * The text column a formula most likely meant to look in.
 *
 * One it does not already use, first: in IF([Source] = "Walk-in",
 * CONTAINS("follow")) the words are not being looked for in [Source] --
 * that was the other half of the sentence.
 */
function likelyTextColumn(columns, src) {
  const known = (columns || []).filter(Boolean)
  const unused = known.filter((c) => !String(src).includes(`[${c}]`))
  const pool = unused.length > 0 ? unused : known
  return pool.find((c) => TEXT.test(c)) || pool[0] || ''
}

/**
 * A whole corrected formula, as a fix.
 *
 * Remembers the text it was worked out on, so a fix clicked after the
 * text has changed does nothing rather than pasting back an old version.
 */
const rewrite = (source, from, label, prompt, text) => ({ kind: 'rewrite', from, to: '', label, prompt, source, text })

/**
 * The mistakes in a formula that does not parse, recognised by shape.
 *
 * Each is `{ message, fix }`, the fix absent when there is nothing honest
 * to offer -- a column name guessed with no list of columns to guess from
 * would be a condition that silently matches nothing.
 */
export function commonMistakes(text, error = '', columns = []) {
  const src = String(text ?? '')
  const found = []
  const calls = callsIn(src)

  // <>CONTAINS(...) -- "does not", written as a comparison with one side.
  for (const call of calls) {
    const m = src.slice(0, call.nameStart).match(/(^|[(,])(\s*)(<>|!=|!)\s*$/)
    if (!m) continue
    const opStart = m.index + m[1].length + m[2].length
    const why = m[3] === '!' ? '“!” is not part of this language.' : `“${m[3]}” compares two things, so it needs something on its left.`
    // The one-word negative where there is one -- NOTCONTAINS, NOTIN -- and
    // NOT( ) around it where there is not.
    const negative = NEGATIVE[call.name]
    found.push({
      message: negative
        ? `“Does not” has its own word: ${negative}(…). ${why}`
        : `“Does not” is written with NOT around the function: NOT(${call.name}(…)). ${why}`,
      fix: negative
        ? rewrite(src, `not@${opStart}`, `${negative}(…)`, `use ${negative}(…)`, `${src.slice(0, opStart)}${negative}${src.slice(call.open)}`)
        : rewrite(
            src,
            `not@${opStart}`,
            `NOT(${call.name}(…))`,
            `use NOT(${call.name}(…))`,
            `${src.slice(0, opStart)}NOT(${src.slice(call.nameStart, call.close + 1)})${src.slice(call.close + 1)}`
          ),
    })
  }

  // NOTCONTAINS([A], "x") -- the NOT run into the name. Its nearest spelling
  // is CONTAINS, and offering that would silently invert the condition.
  const unknown = String(error).match(/There is no function called ([A-Za-z_][A-Za-z0-9_.]*)\(\)/)
  const stem = unknown ? unknown[1].toUpperCase().match(/^(?:DOES_?NOT|IS_?NOT|NOT)_?([A-Z]+)$/) : null
  if (stem) {
    const rowFunctions = Object.keys(FUNCTIONS).filter((name) => !FUNCTIONS[name].agg)
    const real = FUNCTIONS[stem[1]] && !FUNCTIONS[stem[1]].agg ? stem[1] : nearest(stem[1], rowFunctions)
    const call = calls.find((c) => c.name === unknown[1].toUpperCase())
    if (real) {
      const negative = NEGATIVE[real]
      found.push({
        message: negative
          ? `There is no ${unknown[1]}() — the word for it is ${negative}(…).`
          : `There is no ${unknown[1]}() — “not” goes around the function instead: NOT(${real}(…)).`,
        fix: !call
          ? null
          : negative
            ? rewrite(src, `notfn@${call.nameStart}`, `${negative}(…)`, `use ${negative}(…)`, `${src.slice(0, call.nameStart)}${negative}${src.slice(call.open)}`)
            : rewrite(
                src,
                `notfn@${call.nameStart}`,
                `NOT(${real}(…))`,
                `use NOT(${real}(…))`,
                `${src.slice(0, call.nameStart)}NOT(${real}${src.slice(call.open, call.close + 1)})${src.slice(call.close + 1)}`
              ),
      })
    }
  }

  // CONTAINS("x") -- contains, in what?
  const column = likelyTextColumn(columns, src)
  for (const call of calls) {
    if (!LOOKS_IN.has(call.name) || call.args.length !== 1) continue
    const typed = src.slice(call.args[0].from, call.args[0].to).trim()
    // The text is there and the column is not -- or the other way round,
    // when there is nothing to insert, only something to say.
    if (/^["']/.test(typed)) {
      const example = `${call.name}([${column || 'Column'}], ${clipText(typed, 24)})`
      found.push({
        message: `${call.name} needs two things: the column to look in, then the text to find — ${example}.`,
        fix: column
          ? rewrite(
              src,
              `in@${call.open}`,
              example,
              `look in [${column}]`,
              `${src.slice(0, call.open + 1)}[${column}], ${src.slice(call.args[0].from).replace(/^\s+/, '')}`
            )
          : null,
      })
    } else {
      found.push({
        message: `${call.name} needs two things: the column to look in, then the text to find — ${call.name}(${clipText(typed, 24)}, "text").`,
      })
    }
  }

  // = "Lost" with nothing on the left of it.
  const bare = src.match(/(^|[(,])\s*(<>|!=|<=|>=|==|=|<|>)\s*(?=["'\d\[])/)
  if (bare && found.length === 0) {
    found.push({
      message: `“${bare[2]}” compares two things, so it needs one on each side — for example [${column || 'Status'}] ${bare[2]} "Lost".`,
    })
  }

  return found
}

/**
 * An IF used as the whole condition, whose parts are not all yes/no.
 *
 * In a calculated column IF(test, "Done", "Pending") is exactly right. As a
 * CONDITION it is a trap three ways: any text counts as yes, so every row
 * matches; a column as the last part hides the rows where that column is
 * blank; and no last part at all hides every row that fails the test. The
 * sentence people mean -- "for these rows check this, otherwise keep the
 * row" -- ends in TRUE.
 */
export function ifBranchProblem(ast, text) {
  if (ast?.kind !== 'call' || ast.name !== 'IF') return null
  const src = String(text ?? '')
  const top = callsIn(src).find(
    (c) => c.name === 'IF' && src.slice(0, c.nameStart).trim() === '' && src.slice(c.close + 1).trim() === ''
  )
  const [, then, otherwise] = ast.args

  if (!isYesNo(then)) {
    return {
      message:
        'The middle part of IF is what matching rows get, and any text or number there counts as yes — so those rows are always kept. Give it a yes/no instead, such as NOTCONTAINS([Column], "word"), or TRUE.',
    }
  }

  if (ast.args.length === 2) {
    return {
      message:
        'IF has no last part, so every row that fails the test gets nothing back and is hidden. WHEN(test, rule) is the same test and rule with every other row kept.',
      fix: top
        ? rewrite(src, 'if-last', 'WHEN(test, rule)', 'use WHEN — keeps every other row', `${src.slice(0, top.nameStart)}WHEN${src.slice(top.open)}`)
        : null,
    }
  }

  if (!isYesNo(otherwise)) {
    const range = top?.args?.[2]
    const typed = range ? src.slice(range.from, range.to).trim() : ''
    let fix = null
    if (range && typed) {
      // IF(test, rule, anything) → WHEN(test, rule): the same test and the
      // same rule, every other row kept, and one part fewer to get wrong.
      fix = rewrite(
        src,
        'if-else',
        'WHEN(test, rule)',
        'use WHEN — keeps every other row',
        `${src.slice(0, top.nameStart)}WHEN${src.slice(top.open, top.args[1].to)}${src.slice(top.close)}`
      )
    }
    return {
      message: `The last part of IF is what every other row gets. ${
        typed ? `${clipText(typed, 24)} is` : 'That is'
      } a value, not a yes/no, so a row where it is blank would be hidden. WHEN(test, rule) keeps every other row instead.`,
      fix,
    }
  }

  return null
}

/** An argument's text without the spaces around it, as [start, end). */
function trimmedRange(src, range) {
  const piece = src.slice(range.from, range.to)
  return {
    start: range.from + (piece.length - piece.replace(/^\s+/, '').length),
    end: range.to - (piece.length - piece.replace(/\s+$/, '').length),
  }
}

/** The call that IS this argument -- not one somewhere inside it. */
function callAt(calls, src, range, names) {
  const { start, end } = trimmedRange(src, range)
  return calls.find((c) => names.includes(c.name) && c.nameStart === start && c.close === end - 1) || null
}

const argText = (src, range) => src.slice(range.from, range.to).trim()
const LITERAL = /^("[^"]*"|'[^']*'|-?\d+(\.\d+)?)$/

/**
 * OR() or AND() where a list of values was meant.
 *
 * CONTAINS([Scheduled For], OR("2 FOLL", "3 FOLL")) reads like English and
 * does not do it: OR gives back TRUE, so it looks for the word "TRUE"
 * instead of the words. It PARSES, so nothing else would ever say so, and
 * the condition quietly lets every row through.
 */
export function listProblem(text) {
  const src = String(text ?? '')
  const calls = callsIn(src)

  for (const outer of calls) {
    if (!LIST_TAKERS.has(outer.name) || outer.args.length < 2) continue
    for (const range of outer.args.slice(1)) {
      const inner = callAt(calls, src, range, ['OR', 'AND'])
      if (!inner) continue
      const items = inner.args.map((r) => argText(src, r))
      // AND inside CONTAINS is "all of them", which has its own word.
      const target = inner.name === 'OR' ? outer.name : outer.name === 'CONTAINS' ? 'CONTAINSALL' : ''
      const name = target || outer.name
      const example = `${name}(${clipText(argText(src, outer.args[0]), 24)}, ${items.slice(0, 2).join(', ')}${
        items.length > 2 ? ', …' : ''
      })`
      return {
        message: `${inner.name}(…) gives back TRUE or FALSE, not a list — so this looks for the word “TRUE” instead of your words. Put them straight into ${name}: ${example}.`,
        fix:
          target && items.length > 0 && items.every((t) => LITERAL.test(t))
            ? rewrite(
                src,
                `list@${inner.nameStart}`,
                example,
                `use ${example}`,
                `${src.slice(0, outer.nameStart)}${target}${src.slice(outer.open, inner.nameStart)}${items.join(', ')}${src.slice(inner.close + 1)}`
              )
            : null,
      }
    }
  }

  // [Source] = OR("WALK-IN", "REFERRAL") -- the same, compared with "TRUE".
  const compared = src.match(/(\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s*(==|=|<>|!=)\s*(OR|AND)\s*\(/i)
  if (compared) {
    const orStart = compared.index + compared[0].search(/(OR|AND)\s*\($/i)
    const inner = calls.find((c) => c.nameStart === orStart)
    if (inner) {
      const items = inner.args.map((r) => argText(src, r))
      const negated = compared[2] === '<>' || compared[2] === '!='
      const fn = inner.name === 'OR' ? (negated ? 'NOTIN' : 'IN') : ''
      const example = `${fn || 'IN'}(${compared[1]}, ${items.slice(0, 2).join(', ')}${items.length > 2 ? ', …' : ''})`
      return {
        message: `${inner.name}(…) gives back TRUE or FALSE, not a list, so this compares ${clipText(compared[1], 24)} with the word “TRUE”. For ${
          negated ? 'none' : 'any'
        } of these, use ${example}.`,
        fix:
          fn && items.length > 0 && items.every((t) => LITERAL.test(t))
            ? rewrite(
                src,
                `listeq@${compared.index}`,
                example,
                `use ${example}`,
                `${src.slice(0, compared.index)}${fn}(${compared[1]}, ${items.join(', ')})${src.slice(inner.close + 1)}`
              )
            : null,
      }
    }
  }

  return null
}

const EQUALS = /^(\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s*(==|=|<>|!=)\s*("[^"]*"|'[^']*'|-?\d+(?:\.\d+)?)$/

/** Several of one function on one column, merged into one call. */
const MERGE = {
  OR: { CONTAINS: 'CONTAINS', STARTSWITH: 'STARTSWITH', ENDSWITH: 'ENDSWITH' },
  AND: { CONTAINS: 'CONTAINSALL', NOTCONTAINS: 'NOTCONTAINS' },
}

/**
 * The same formula, said shorter. One click each, offered and never
 * insisted on -- a formula that is right is right.
 *
 *   OR(CONTAINS([A], "x"), CONTAINS([A], "y"))   →  CONTAINS([A], "x", "y")
 *   AND(CONTAINS([A], "x"), CONTAINS([A], "y"))  →  CONTAINSALL([A], "x", "y")
 *   OR([A] = "x", [A] = "y")                     →  IN([A], "x", "y")
 *   AND([A] <> "x", [A] <> "y")                  →  NOTIN([A], "x", "y")
 *   NOT(CONTAINS(…)), NOT(IN(…))                 →  NOTCONTAINS(…), NOTIN(…)
 *   IF(test, rule, TRUE)                         →  WHEN(test, rule)
 */
export function shorterForms(ast, text) {
  const src = String(text ?? '')
  const calls = callsIn(src)
  const fixes = []

  for (const group of calls) {
    if (!MERGE[group.name] || group.args.length < 2) continue

    // The same search, on the same column, several times.
    const inner = group.args.map((r) => callAt(calls, src, r, Object.keys(MERGE[group.name])))
    if (inner.every(Boolean)) {
      const name = inner[0].name
      const firsts = inner.map((c) => (c.args[0] ? argText(src, c.args[0]).toLowerCase() : ''))
      if (inner.every((c) => c.name === name && c.args.length >= 2) && firsts.every((f) => f && f === firsts[0])) {
        const target = MERGE[group.name][name]
        const column = argText(src, inner[0].args[0])
        const parts = inner.flatMap((c) => c.args.slice(1).map((r) => argText(src, r)))
        fixes.push(
          rewrite(
            src,
            `short-any@${group.nameStart}`,
            `${target}(${column}, …)`,
            `shorter: ${target}(${clipText(column, 20)}, …)`,
            `${src.slice(0, group.nameStart)}${target}(${column}, ${parts.join(', ')})${src.slice(group.close + 1)}`
          )
        )
        continue
      }
    }

    // The same column compared with several values.
    const matches = group.args.map((r) => argText(src, r).match(EQUALS))
    if (matches.every(Boolean)) {
      const left = matches[0][1].toLowerCase()
      const ops = new Set(matches.map((m) => (m[2] === '==' ? '=' : m[2] === '!=' ? '<>' : m[2])))
      const fn =
        ops.size !== 1 ? '' : group.name === 'OR' && ops.has('=') ? 'IN' : group.name === 'AND' && ops.has('<>') ? 'NOTIN' : ''
      if (fn && matches.every((m) => m[1].toLowerCase() === left)) {
        fixes.push(
          rewrite(
            src,
            `short-in@${group.nameStart}`,
            `${fn}(${matches[0][1]}, …)`,
            `shorter: ${fn}(${clipText(matches[0][1], 20)}, …)`,
            `${src.slice(0, group.nameStart)}${fn}(${matches[0][1]}, ${matches.map((m) => m[3]).join(', ')})${src.slice(group.close + 1)}`
          )
        )
      }
    }
  }

  // NOT( ) around something that has its own negative.
  for (const not of calls) {
    if (not.name !== 'NOT' || not.args.length !== 1) continue
    const inner = callAt(calls, src, not.args[0], Object.keys(NEGATIVE))
    if (!inner) continue
    const negative = NEGATIVE[inner.name]
    fixes.push(
      rewrite(
        src,
        `short-not@${not.nameStart}`,
        `${negative}(…)`,
        `shorter: ${negative}(…)`,
        `${src.slice(0, not.nameStart)}${negative}${src.slice(inner.open, inner.close + 1)}${src.slice(not.close + 1)}`
      )
    )
  }

  // IF(test, rule, TRUE) is exactly what WHEN means.
  if (
    ast?.kind === 'call' &&
    ast.name === 'IF' &&
    ast.args.length === 3 &&
    ast.args[2].kind === 'literal' &&
    ast.args[2].value === true &&
    isYesNo(ast.args[1])
  ) {
    const top = calls.find(
      (c) => c.name === 'IF' && src.slice(0, c.nameStart).trim() === '' && src.slice(c.close + 1).trim() === ''
    )
    if (top && top.args.length === 3) {
      fixes.push(
        rewrite(
          src,
          'short-when',
          'WHEN(test, rule)',
          'shorter: WHEN(test, rule)',
          `${src.slice(0, top.nameStart)}WHEN${src.slice(top.open, top.args[1].to)}${src.slice(top.close)}`
        )
      )
    }
  }

  // NOT(ISBLANK(x)) is ISFILLED(x).
  for (const not of calls) {
    if (not.name !== 'NOT' || not.args.length !== 1) continue
    const inner = callAt(calls, src, not.args[0], ['ISBLANK'])
    if (!inner) continue
    fixes.push(
      rewrite(
        src,
        `short-filled@${not.nameStart}`,
        'ISFILLED(…)',
        'shorter: ISFILLED(…)',
        `${src.slice(0, not.nameStart)}ISFILLED${src.slice(inner.open, inner.close + 1)}${src.slice(not.close + 1)}`
      )
    )
  }

  // AND([A] >= low, [A] <= high) is BETWEEN([A], low, high).
  for (const group of calls) {
    if (group.name !== 'AND' || group.args.length !== 2) continue
    const sides = group.args.map((r) => argText(src, r).match(RANGE_SIDE))
    if (!sides.every(Boolean) || sides[0][1].toLowerCase() !== sides[1][1].toLowerCase()) continue
    const low = sides.find((m) => m[2] === '>=')
    const high = sides.find((m) => m[2] === '<=')
    if (!low || !high) continue
    fixes.push(
      rewrite(
        src,
        `short-between@${group.nameStart}`,
        `BETWEEN(${low[1]}, …)`,
        `shorter: BETWEEN(${clipText(low[1], 20)}, ${low[3]}, ${high[3]})`,
        `${src.slice(0, group.nameStart)}BETWEEN(${low[1]}, ${low[3]}, ${high[3]})${src.slice(group.close + 1)}`
      )
    )
  }

  // DAYSSINCE([Date]) > 30 is OLDERTHAN([Date], 30).
  const older = src.match(/DAYSSINCE\s*\(\s*(\[[^\]]+\])\s*\)\s*>\s*(\d+)(?![\d.])/i)
  if (older) {
    fixes.push(
      rewrite(
        src,
        `short-older@${older.index}`,
        `OLDERTHAN(${older[1]}, ${older[2]})`,
        `shorter: OLDERTHAN(${clipText(older[1], 20)}, ${older[2]})`,
        `${src.slice(0, older.index)}OLDERTHAN(${older[1]}, ${older[2]})${src.slice(older.index + older[0].length)}`
      )
    )
  }

  return fixes
}

const RANGE_SIDE = /^(\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=)\s*("[^"]*"|'[^']*'|-?\d+(?:\.\d+)?)$/

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
    // A spreadsheet habit, said in its own terms and mended in one click,
    // before the parser's more general complaint.
    const mistakes = commonMistakes(src, error, columns)
    if (mistakes.length > 0) {
      return {
        state: 'error',
        message: mistakes.map((m) => m.message).join(' '),
        fixes: mistakes.map((m) => m.fix).filter(Boolean),
        columnsUsed: [],
      }
    }
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

  const listed = listProblem(src)
  if (listed) {
    return { state: 'warning', message: listed.message, fixes: listed.fix ? [listed.fix] : [], columnsUsed: used }
  }

  const branch = ifBranchProblem(ast, src)
  if (branch) {
    return { state: 'warning', message: branch.message, fixes: branch.fix ? [branch.fix] : [], columnsUsed: used }
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

  // Right, but longer than it needs to be: offered, never insisted on.
  const shorter = shorterForms(ast, src)
  return {
    state: 'ok',
    message: `${used.length > 0 ? `Reads correctly · uses ${used.map((c) => `[${c}]`).join(', ')}` : 'Reads correctly'}${
      shorter.length > 0 ? ' · one click makes it shorter' : ''
    }`,
    fixes: shorter,
    columnsUsed: used,
  }
}

/** Apply one of `checkFormula`'s fixes to the text. */
export function applyFix(text, fix) {
  const src = String(text ?? '')
  if (!fix) return src
  // A mended shape -- NOT() around a call, a missing column, a last part
  // for IF -- is the whole corrected formula, worked out on this text.
  if (fix.kind === 'rewrite') return fix.source === src && typeof fix.text === 'string' ? fix.text : src
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
 * Words of the language that are not functions.
 *
 * The parser knows them, the function list does not, so until now nothing
 * offered them -- and they are exactly the two a condition needs most:
 * "does not contain" is NOT(CONTAINS(...)), and "otherwise keep the row" is
 * TRUE.
 */
const KEYWORDS = [
  {
    name: 'NOT',
    label: 'NOT()',
    insert: 'NOT(',
    call: true,
    hint: 'NOT(test) — the opposite of a yes/no. For words, NOTCONTAINS([Remarks], "x", "y") is shorter',
  },
  { name: 'TRUE', label: 'TRUE', insert: 'TRUE', hint: 'yes — as the last part of IF, keeps every other row' },
  { name: 'FALSE', label: 'FALSE', insert: 'FALSE', hint: 'no — as the last part of IF, hides every other row' },
]

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
  const keywords = KEYWORDS.filter((k) => k.name.startsWith(upper)).map((k) => ({
    kind: 'function',
    label: k.label,
    insert: k.insert,
    detail: k.hint,
  }))
  const functions = Object.keys(FUNCTIONS)
    .filter((name) => name.startsWith(upper) && !FUNCTIONS[name].agg)
    .map((name) => ({ kind: 'function', label: `${name}()`, insert: `${name}(`, detail: FUNCTIONS[name].hint }))

  return {
    items: [...keywords, ...functions, ...rankColumns(known, prefix).map(columnItem)].slice(0, MAX_SUGGESTIONS),
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
    const meta = FUNCTIONS[stack[k].name] || KEYWORDS.find((w) => w.call && w.name === stack[k].name)
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
const KIND = /source|channel|category|type|mode|branch/i

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
    label: 'One of several values',
    build: (c) => `IN([${guess(c, TEXT)}], "Booked", "Delivered")`,
  },
  {
    id: 'age',
    label: 'Older than 30 days',
    build: (c) => `OLDERTHAN([${guess(c, DATE)}], 30)`,
  },
  {
    id: 'contains',
    label: 'Contains any of these words',
    build: (c) => `CONTAINS([${guess(c, TEXT)}], "urgent", "asap")`,
  },
  {
    id: 'not-contains',
    label: 'Contains none of these words',
    build: (c) => `NOTCONTAINS([${guess(c, TEXT)}], "cancelled", "lost")`,
  },
  {
    // "If the source is walk-in, only the rows without a follow-up; every
    // other row stays." The shape people reach for IF to say, written so
    // the rows it is not about are kept rather than quietly hidden.
    id: 'only-when',
    label: 'Only for one value, keep the rest',
    build: (c) => `WHEN([${guess(c, KIND)}] = "Walk-in", NOTCONTAINS([${guess(c, TEXT)}], "2 FOLL", "3 FOLL"))`,
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
  {
    id: 'between',
    label: 'A number in a range',
    build: (c) => `BETWEEN([${guess(c, NUMBER)}], 10000, 50000)`,
  },
  {
    id: 'recent',
    label: 'In the last 7 days',
    build: (c) => `INLASTDAYS([${guess(c, DATE)}], 7)`,
  },
]
