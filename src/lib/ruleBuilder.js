// ---------------------------------------------------------------------
// A rule built with clicks
// ---------------------------------------------------------------------
// The formula language can say nearly anything, and that is exactly why
// most people cannot use it: a blank box that wants brackets, quotes,
// commas and the right function name in the right order is a box that
// gets left blank, or filled with something that parses and is wrong.
//
// Nearly every rule anybody needs is the same shape:
//
//     [only for rows where  <check>, <check> …]
//     keep rows where       <check>, <check> …   (all of them, or any)
//
// and a check is always three things: a COLUMN, a CONDITION said in words
// ("contains none of", "is in the last", "is between"), and the VALUES,
// picked from what the column really holds. So that is what the builder
// asks for, and it writes the formula.
//
// Three decisions shape it:
//
//   IT WRITES THE SAME LANGUAGE. Not a second rule format stored beside
//   formulas: the clicks produce a formula, the dashboard runs that
//   formula, and a formula typed by hand in these shapes opens as clicks.
//   There is one thing to be right, not two things to agree.
//
//   IT NEVER HALF-SHOWS A FORMULA. One it cannot read in full is left as a
//   formula. A builder showing four of five conditions invites somebody to
//   "fix" the fifth away without ever having seen it.
//
//   IT SAYS IT BACK IN WORDS. `explainFormula` reads any formula that
//   parses -- built with clicks or not -- as a sentence, which is the one
//   check everybody can make.
//
// Pure: model and text in, model and text out. No React.

import { parseFormula } from './formula.js'

export const JOINS = [
  { value: 'all', label: 'all' },
  { value: 'any', label: 'any' },
]

export const TEST_GROUPS = ['Text', 'Numbers and dates', 'Dates', 'Empty or not']

/**
 * Every condition a check can be.
 *
 * `takes` is what the value box looks like: several values, one, two ends
 * of a range, a number of days, or nothing. `fn` or `op` is what it writes.
 * The order is the order of the dropdown -- the commonest first.
 */
export const RULE_TESTS = [
  { id: 'is', label: 'is', group: 'Text', takes: 'many' },
  { id: 'is_not', label: 'is not', group: 'Text', takes: 'many' },
  { id: 'contains', label: 'contains', group: 'Text', takes: 'many', fn: 'CONTAINS' },
  { id: 'not_contains', label: 'does not contain', group: 'Text', takes: 'many', fn: 'NOTCONTAINS' },
  { id: 'contains_all', label: 'contains all of', group: 'Text', takes: 'many', fn: 'CONTAINSALL' },
  { id: 'starts', label: 'starts with', group: 'Text', takes: 'many', fn: 'STARTSWITH' },
  { id: 'ends', label: 'ends with', group: 'Text', takes: 'many', fn: 'ENDSWITH' },
  { id: 'like', label: 'matches a pattern (* ?)', group: 'Text', takes: 'many', fn: 'LIKE', placeholder: 'KA*' },
  { id: 'gt', label: 'is more than', group: 'Numbers and dates', takes: 'one', op: '>' },
  { id: 'gte', label: 'is at least', group: 'Numbers and dates', takes: 'one', op: '>=' },
  { id: 'lt', label: 'is less than', group: 'Numbers and dates', takes: 'one', op: '<' },
  { id: 'lte', label: 'is at most', group: 'Numbers and dates', takes: 'one', op: '<=' },
  { id: 'between', label: 'is between', group: 'Numbers and dates', takes: 'two', fn: 'BETWEEN' },
  { id: 'today', label: 'is today', group: 'Dates', takes: 'none', fn: 'ISTODAY' },
  { id: 'last_days', label: 'is in the last', group: 'Dates', takes: 'days', fn: 'INLASTDAYS' },
  { id: 'next_days', label: 'is in the next', group: 'Dates', takes: 'days', fn: 'INNEXTDAYS' },
  { id: 'older', label: 'is older than', group: 'Dates', takes: 'days', fn: 'OLDERTHAN' },
  { id: 'this_week', label: 'is this week', group: 'Dates', takes: 'none', fn: 'THISWEEK' },
  { id: 'this_month', label: 'is this month', group: 'Dates', takes: 'none', fn: 'THISMONTH' },
  { id: 'this_year', label: 'is this year', group: 'Dates', takes: 'none', fn: 'THISYEAR' },
  { id: 'filled', label: 'is filled in', group: 'Empty or not', takes: 'none', fn: 'ISFILLED' },
  { id: 'blank', label: 'is empty', group: 'Empty or not', takes: 'none', fn: 'ISBLANK' },
]

export const testOf = (id) => RULE_TESTS.find((t) => t.id === id) || RULE_TESTS[0]

export const blankCheck = () => ({ column: '', test: 'is', values: [] })

export const emptyRule = () => ({
  only: { join: 'all', checks: [] },
  keep: { join: 'all', checks: [blankCheck()] },
})

const trimmed = (values) =>
  (Array.isArray(values) ? values : []).map((v) => String(v ?? '').trim()).filter((v) => v !== '')

// ---------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------

/** Typed or pasted text as values: "2 FOLL, 3 FOLL" is two. */
export function splitValues(raw) {
  return String(raw ?? '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Values added once each, however they were capitalised. */
export function addValues(values, more) {
  const out = [...(values || [])]
  for (const v of more || []) {
    if (!out.some((x) => String(x).toLowerCase() === String(v).toLowerCase())) out.push(v)
  }
  return out
}

/**
 * A value, written so it cannot break the formula around it.
 *
 * Quoted as text unless it is a number AND the condition is about numbers:
 * "007" in a registration column is a code, and writing it as 7 would make
 * the formula say something the person did not.
 */
export function literal(value, { number = false } = {}) {
  const s = String(value ?? '').trim()
  if (number && /^-?\d+(\.\d+)?$/.test(s)) return s
  if (!s.includes('"')) return `"${s}"`
  if (!s.includes("'")) return `'${s}'`
  // The language has no escapes, and a value holding both kinds of quote
  // is vanishingly rare -- losing its double quotes beats a formula that
  // does not parse.
  return `"${s.replace(/"/g, '')}"`
}

// ---------------------------------------------------------------------
// Clicks → formula
// ---------------------------------------------------------------------

/** What one check still needs, or ''. */
export function checkProblem(check) {
  if (!check?.column) return 'Pick a column'
  if (/[[\]]/.test(check.column)) return 'This column’s name has a bracket in it — write this one as a formula'
  const test = testOf(check.test)
  const values = trimmed(check.values)
  if (test.takes === 'many' || test.takes === 'one') return values.length > 0 ? '' : 'Add a value'
  if (test.takes === 'two') {
    const [low, high] = (check.values || []).map((v) => String(v ?? '').trim())
    return low && high ? '' : 'Add both ends'
  }
  if (test.takes === 'days') return /^\d+$/.test(values[0] || '') ? '' : 'How many days?'
  return ''
}

/** One finished check as formula text, or '' while it is unfinished. */
export function checkToFormula(check) {
  if (checkProblem(check)) return ''
  const test = testOf(check.test)
  const col = `[${check.column}]`
  const values = trimmed(check.values)
  const listed = values.map((v) => literal(v)).join(', ')

  switch (test.takes) {
    case 'none':
      return `${test.fn}(${col})`
    case 'days':
      return `${test.fn}(${col}, ${Number(values[0])})`
    case 'two': {
      const [low, high] = check.values.map((v) => String(v ?? '').trim())
      return `${test.fn}(${col}, ${literal(low, { number: true })}, ${literal(high, { number: true })})`
    }
    case 'one':
      return `${col} ${test.op} ${literal(values[0], { number: true })}`
    default:
      // One value is the plain comparison anybody can read; several is IN.
      if (test.id === 'is') return values.length === 1 ? `${col} = ${listed}` : `IN(${col}, ${listed})`
      if (test.id === 'is_not') return values.length === 1 ? `${col} <> ${listed}` : `NOTIN(${col}, ${listed})`
      return `${test.fn}(${col}, ${listed})`
  }
}

function groupToFormula(group) {
  const parts = (group?.checks || []).map(checkToFormula).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${group.join === 'any' ? 'OR' : 'AND'}(${parts.join(', ')})`
}

/**
 * The whole rule as a formula, or '' until there is something to keep by.
 *
 * "Only for rows where Source is WALK-IN" with nothing after it is not a
 * rule yet -- it says which rows the rule is about and never says the rule.
 */
export function ruleToFormula(rule) {
  const keep = groupToFormula(rule?.keep)
  const only = groupToFormula(rule?.only)
  if (!keep) return ''
  return only ? `WHEN(${only}, ${keep})` : keep
}

/**
 * A check after its condition changes, keeping whatever still makes sense:
 * words stay words, a number stays a number, and nothing is carried into a
 * condition that takes no value.
 */
export function withTest(check, id) {
  const next = testOf(id)
  const values = Array.isArray(check?.values) ? check.values : []
  let kept
  if (next.takes === 'none') kept = []
  else if (next.takes === 'many') kept = trimmed(values)
  else if (next.takes === 'two') kept = [values[0] ?? '', values[1] ?? '']
  else if (next.takes === 'days') kept = /^\d+$/.test(String(values[0] ?? '').trim()) ? [String(values[0]).trim()] : []
  else kept = values.slice(0, 1)
  return { ...check, test: next.id, values: kept }
}

// ---------------------------------------------------------------------
// Formula → clicks
// ---------------------------------------------------------------------

/** Literal values -- lists opened up -- or null if anything is not one. */
function literalsOf(nodes) {
  const out = []
  for (const node of nodes || []) {
    if (node?.kind === 'list') {
      const inner = literalsOf(node.items)
      if (!inner) return null
      out.push(...inner)
    } else if (node?.kind === 'literal' && (typeof node.value === 'string' || typeof node.value === 'number')) {
      out.push(String(node.value))
    } else if (node?.kind === 'unary' && node.op === '-' && node.arg?.kind === 'literal' && typeof node.arg.value === 'number') {
      out.push(String(-node.arg.value))
    } else {
      return null
    }
  }
  return out
}

/** One tree node as a check, or null if it is not one of the shapes. */
export function readCheck(node) {
  if (!node) return null

  if (node.kind === 'binary' && node.left?.kind === 'column') {
    const values = literalsOf([node.right])
    if (!values || values.length === 0) return null
    const op = node.op === '==' ? '=' : node.op === '!=' ? '<>' : node.op
    if (op === '=') return { column: node.left.name, test: 'is', values }
    if (op === '<>') return { column: node.left.name, test: 'is_not', values }
    const test = RULE_TESTS.find((t) => t.op === op)
    return test && values.length === 1 ? { column: node.left.name, test: test.id, values } : null
  }

  if (node.kind !== 'call' || node.args?.[0]?.kind !== 'column') return null
  const column = node.args[0].name
  const rest = node.args.slice(1)

  if (node.name === 'IN' || node.name === 'NOTIN') {
    const values = literalsOf(rest)
    return values && values.length > 0 ? { column, test: node.name === 'IN' ? 'is' : 'is_not', values } : null
  }

  const test = RULE_TESTS.find((t) => t.fn === node.name)
  if (!test) return null
  if (test.takes === 'none') return rest.length === 0 ? { column, test: test.id, values: [] } : null
  const values = literalsOf(rest)
  if (!values) return null
  if (test.takes === 'days') return values.length === 1 && /^\d+$/.test(values[0]) ? { column, test: test.id, values } : null
  if (test.takes === 'two') return values.length === 2 ? { column, test: test.id, values } : null
  return values.length > 0 ? { column, test: test.id, values } : null
}

/** a AND b AND c, however it was bracketed, as [a, b, c]. */
function flatten(node, op) {
  if (node?.kind === 'binary' && node.op === op) return [...flatten(node.left, op), ...flatten(node.right, op)]
  return [node]
}

function groupOf(node) {
  let join = 'all'
  let parts = [node]
  if (node?.kind === 'call' && (node.name === 'AND' || node.name === 'OR')) {
    join = node.name === 'OR' ? 'any' : 'all'
    parts = node.args
  } else if (node?.kind === 'binary' && (node.op === 'AND' || node.op === 'OR')) {
    join = node.op === 'OR' ? 'any' : 'all'
    parts = flatten(node, node.op)
  }
  const checks = parts.map(readCheck)
  return checks.length > 0 && checks.every(Boolean) ? { join, checks } : null
}

/**
 * A formula as clicks, or null if clicks cannot show all of it.
 *
 * An empty formula is an empty rule -- somewhere to start, not a failure.
 */
export function formulaToRule(text) {
  const src = String(text ?? '').trim()
  if (!src) return emptyRule()
  const { ast, error } = parseFormula(src)
  if (error || !ast) return null

  if (ast.kind === 'call' && ast.name === 'WHEN' && ast.args.length === 2) {
    const only = groupOf(ast.args[0])
    const keep = groupOf(ast.args[1])
    return only && keep ? { only, keep } : null
  }
  const keep = groupOf(ast)
  return keep ? { only: { join: 'all', checks: [] }, keep } : null
}

// ---------------------------------------------------------------------
// Any formula, in words
// ---------------------------------------------------------------------

const quoteWord = (v) => `“${v}”`
const shown = (v) => (/^-?\d+(\.\d+)?$/.test(String(v)) ? String(v) : quoteWord(v))
const joined = (values, word) =>
  values.length <= 1
    ? shown(values[0] ?? '')
    : `${values.slice(0, -1).map(shown).join(', ')} ${word} ${shown(values[values.length - 1])}`
const days = (n) => `${n} day${String(n) === '1' ? '' : 's'}`

const OP_WORDS = {
  '=': 'is',
  '==': 'is',
  '<>': 'is not',
  '!=': 'is not',
  '>': 'is more than',
  '>=': 'is at least',
  '<': 'is less than',
  '<=': 'is at most',
}

function sayCheck({ column, test, values }) {
  const one = values[0]
  switch (test) {
    case 'is':
      return `${column} is ${joined(values, 'or')}`
    case 'is_not':
      return values.length > 1 ? `${column} is none of ${values.map(shown).join(', ')}` : `${column} is not ${shown(one)}`
    case 'contains':
      return `${column} contains ${joined(values, 'or')}`
    case 'not_contains':
      return values.length > 1
        ? `${column} contains none of ${values.map(shown).join(', ')}`
        : `${column} does not contain ${shown(one)}`
    case 'contains_all':
      return `${column} contains ${joined(values, 'and')}`
    case 'starts':
      return `${column} starts with ${joined(values, 'or')}`
    case 'ends':
      return `${column} ends with ${joined(values, 'or')}`
    case 'like':
      return `${column} looks like ${joined(values, 'or')}`
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return `${column} ${OP_WORDS[testOf(test).op]} ${shown(one)}`
    case 'between':
      return `${column} is between ${shown(values[0])} and ${shown(values[1])}`
    case 'today':
      return `${column} is today`
    case 'last_days':
      return `${column} is within the last ${days(one)}`
    case 'next_days':
      return `${column} is within the next ${days(one)}`
    case 'older':
      return `${column} is more than ${days(one)} ago`
    case 'this_week':
      return `${column} is this week`
    case 'this_month':
      return `${column} is this month`
    case 'this_year':
      return `${column} is this year`
    case 'filled':
      return `${column} is filled in`
    default:
      return `${column} is empty`
  }
}

const VALUE_WORDS = { DAYSSINCE: 'days since', LEN: 'the length of', YEAR: 'the year of', MONTH: 'the month of', DAY: 'the day of' }

function sayValue(node) {
  if (!node) return ''
  switch (node.kind) {
    case 'column':
      return node.name
    case 'literal':
      return typeof node.value === 'boolean' ? (node.value ? 'yes' : 'no') : shown(node.value)
    case 'unary':
      return `${node.op}${sayValue(node.arg)}`
    case 'list':
      return `any of ${node.items.map(sayValue).join(', ')}`
    case 'not':
      return `not (${sayValue(node.arg)})`
    case 'binary':
      return OP_WORDS[node.op] || node.op === 'AND' || node.op === 'OR'
        ? say(node, 1)
        : `${sayValue(node.left)} ${node.op} ${sayValue(node.right)}`
    case 'call':
      if (node.name === 'TODAY') return 'today'
      if (['UPPER', 'LOWER', 'TRIM', 'NUMBER'].includes(node.name) && node.args.length === 1) return sayValue(node.args[0])
      if (VALUE_WORDS[node.name] && node.args.length === 1) return `${VALUE_WORDS[node.name]} ${sayValue(node.args[0])}`
      return `${node.name}(${node.args.map(sayValue).join(', ')})`
    default:
      return ''
  }
}

function say(node, depth = 0) {
  if (!node) return ''
  const check = readCheck(node)
  if (check) return sayCheck(check)

  const wrap = (s) => (depth > 0 ? `(${s})` : s)
  if (node.kind === 'call' && (node.name === 'AND' || node.name === 'OR')) {
    return wrap(node.args.map((a) => say(a, depth + 1)).join(node.name === 'AND' ? ' and ' : ' or '))
  }
  if (node.kind === 'binary' && (node.op === 'AND' || node.op === 'OR')) {
    return wrap(flatten(node, node.op).map((a) => say(a, depth + 1)).join(node.op === 'AND' ? ' and ' : ' or '))
  }
  if (node.kind === 'not') return `not (${say(node.arg, depth + 1)})`
  if (node.kind === 'call' && node.name === 'WHEN' && node.args.length === 2) {
    return wrap(`${say(node.args[1], depth + 1)} wherever ${say(node.args[0], depth + 1)}, and every other row`)
  }
  if (node.kind === 'call' && node.name === 'IF') {
    const otherwise = node.args[2] ? `, otherwise ${say(node.args[2], depth + 1)}` : ''
    return wrap(`if ${say(node.args[0], depth + 1)} then ${say(node.args[1], depth + 1)}${otherwise}`)
  }
  if (node.kind === 'binary' && OP_WORDS[node.op]) {
    return `${sayValue(node.left)} ${OP_WORDS[node.op]} ${sayValue(node.right)}`
  }
  return sayValue(node)
}

/**
 * Any formula that parses, as a sentence; '' for one that does not.
 *
 * Read from the same parse the dashboard runs, so the sentence cannot say
 * one thing while the rows do another.
 */
export function explainFormula(text) {
  const src = String(text ?? '').trim()
  if (!src) return ''
  const { ast, error } = parseFormula(src)
  if (error || !ast) return ''

  const sentence =
    ast.kind === 'call' && ast.name === 'WHEN' && ast.args.length === 2
      ? `For rows where ${say(ast.args[0])}, keep only those where ${say(ast.args[1])}. Every other row is kept.`
      : `Keep rows where ${say(ast)}.`
  return sentence.replace(/\s+/g, ' ')
}
