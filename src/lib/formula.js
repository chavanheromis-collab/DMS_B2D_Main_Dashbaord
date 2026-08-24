// ---------------------------------------------------------------------
// Calculated columns -- the formula language
// ---------------------------------------------------------------------
// A calculated column is a column the spreadsheet does not have: margin,
// age in days, a status worked out from three other fields. Adding it to
// the sheet means asking whoever owns the sheet, and adding it to one
// widget means adding it to the next eleven too.
//
// So it is defined ONCE, on the tab, and from that moment it is simply a
// column: it appears in every picker, filters like a column, groups like a
// column, charts like a column, and travels into a blend like a column.
// Nothing downstream needs to learn that it was calculated.
//
// The language is a small expression language, not JavaScript. `eval` on a
// string an admin typed, evaluated once per row over forty thousand rows,
// would be both a security hole and unusably slow; and a real parser is
// what makes it possible to say WHICH column name was misspelled instead of
// throwing "undefined is not a function" at a person building a dashboard.
//
// It is deliberately spreadsheet-shaped, because everyone using this has
// spent years in Excel:
//
//     [Sale Price] - [Cost]
//     ROUND(([Sale] - [Cost]) / [Sale] * 100, 1)
//     IF([Status] = "Delivered", "Done", "Pending")
//     DAYSSINCE([Invoice Date])
//     [Amount] / TOTAL([Amount]) * 100

import { isBlank, toDate, toNumber } from './dataUtils.js'

// ---------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------
const PUNCTUATION = ['<=', '>=', '<>', '!=', '==', '(', ')', ',', '+', '-', '*', '/', '%', '^', '&', '=', '<', '>']

export function tokenize(text) {
  const src = String(text ?? '')
  const out = []
  let i = 0

  while (i < src.length) {
    const c = src[i]

    if (/\s/.test(c)) {
      i += 1
      continue
    }

    // [Column Name] -- brackets are what let a column be called "Sale Price
    // (ex GST)" without the parser trying to read it as arithmetic.
    if (c === '[') {
      const end = src.indexOf(']', i)
      if (end === -1) return { error: 'A [column] is missing its closing bracket' }
      out.push({ type: 'column', value: src.slice(i + 1, end).trim(), at: i })
      i = end + 1
      continue
    }

    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1)
      if (end === -1) return { error: `A text value is missing its closing ${c}` }
      out.push({ type: 'text', value: src.slice(i + 1, end), at: i })
      i = end + 1
      continue
    }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = src.slice(i).match(/^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/)
      out.push({ type: 'number', value: Number(m[0]), at: i })
      i += m[0].length
      continue
    }

    if (/[A-Za-z_]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_.]*/)
      out.push({ type: 'name', value: m[0], at: i })
      i += m[0].length
      continue
    }

    const punct = PUNCTUATION.find((p) => src.startsWith(p, i))
    if (punct) {
      out.push({ type: 'op', value: punct, at: i })
      i += punct.length
      continue
    }

    return { error: `I don't understand "${c}" here` }
  }

  return { tokens: out }
}

// ---------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------
// Precedence climbing. Lowest binds loosest.
const BINARY = [
  ['OR'],
  ['AND'],
  ['=', '==', '<>', '!=', '<', '<=', '>', '>='],
  ['&'],
  ['+', '-'],
  ['*', '/', '%'],
  ['^'],
]

/**
 * Turns formula text into a tree, or into a sentence explaining what is
 * wrong with it. Never throws: a mistyped formula is an ordinary thing for
 * somebody to do, not an exception.
 */
export function parseFormula(text) {
  if (isBlank(text)) return { error: 'Empty formula' }

  const lexed = tokenize(text)
  if (lexed.error) return { error: lexed.error }
  const tokens = lexed.tokens
  if (tokens.length === 0) return { error: 'Empty formula' }

  let pos = 0
  const peek = () => tokens[pos]
  const done = () => pos >= tokens.length

  function fail(message) {
    throw new SyntaxError(message)
  }

  function expect(value) {
    const t = peek()
    if (!t || t.type !== 'op' || t.value !== value) fail(`Expected "${value}"`)
    pos += 1
  }

  function parsePrimary() {
    const t = peek()
    if (!t) fail('The formula ends too early')

    if (t.type === 'number' || t.type === 'text') {
      pos += 1
      return { kind: 'literal', value: t.value }
    }

    if (t.type === 'column') {
      pos += 1
      if (!t.value) fail('An empty [] is not a column')
      return { kind: 'column', name: t.value }
    }

    if (t.type === 'op' && (t.value === '-' || t.value === '+')) {
      pos += 1
      return { kind: 'unary', op: t.value, arg: parsePrimary() }
    }

    if (t.type === 'op' && t.value === '(') {
      pos += 1
      const inner = parseBinary(0)
      expect(')')
      return inner
    }

    if (t.type === 'name') {
      const upper = t.value.toUpperCase()
      pos += 1

      if (upper === 'NOT') return { kind: 'not', arg: parsePrimary() }
      if (upper === 'TRUE') return { kind: 'literal', value: true }
      if (upper === 'FALSE') return { kind: 'literal', value: false }

      const next = peek()
      if (next && next.type === 'op' && next.value === '(') {
        pos += 1
        const args = []
        if (peek() && peek().type === 'op' && peek().value === ')') {
          pos += 1
        } else {
          for (;;) {
            args.push(parseBinary(0))
            const sep = peek()
            if (sep && sep.type === 'op' && sep.value === ',') {
              pos += 1
              continue
            }
            expect(')')
            break
          }
        }
        if (!FUNCTIONS[upper]) fail(`There is no function called ${upper}()`)
        const arity = FUNCTIONS[upper].arity
        if (args.length < arity[0] || (arity[1] !== Infinity && args.length > arity[1])) {
          fail(`${upper}() takes ${describeArity(arity)}, not ${args.length}`)
        }
        return { kind: 'call', name: upper, args }
      }

      // A bare word is a column name. Brackets are the safe way to write
      // one, but "Amount" reading as [Amount] is what makes a simple
      // formula simple.
      return { kind: 'column', name: t.value }
    }

    fail(`I don't understand "${t.value}" here`)
    return null
  }

  function parseBinary(level) {
    if (level >= BINARY.length) return parsePrimary()

    let left = parseBinary(level + 1)
    for (;;) {
      const t = peek()
      if (!t) return left

      const value = t.type === 'name' ? t.value.toUpperCase() : t.value
      const isWord = t.type === 'name'
      if ((t.type !== 'op' && !isWord) || !BINARY[level].includes(value)) return left

      pos += 1
      const right = parseBinary(level + 1)
      left = { kind: 'binary', op: value, left, right }
    }
  }

  try {
    const ast = parseBinary(0)
    if (!done()) fail(`Unexpected "${peek().value}" after the end of the formula`)
    return { ast }
  } catch (e) {
    return { error: e.message }
  }
}

function describeArity([min, max]) {
  if (max === Infinity) return `at least ${min} argument${min === 1 ? '' : 's'}`
  if (min === max) return `${min} argument${min === 1 ? '' : 's'}`
  return `${min} to ${max} arguments`
}

// ---------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------
const num = (v) => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : toNumber(v))
const text = (v) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v))
const truthy = (v) => {
  if (typeof v === 'boolean') return v
  if (v === null || v === undefined || v === '') return false
  const n = toNumber(v)
  if (n !== null) return n !== 0
  return String(v).trim().toLowerCase() !== 'false'
}

const MS_PER_DAY = 86400000
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/**
 * Comparison, the way a person means it.
 *
 * Two numbers compare as numbers, two dates as dates, and anything else as
 * trimmed, case-insensitive text -- because `[Status] = "delivered"` failing
 * on "Delivered" is not a subtlety anybody wants to debug.
 */
function compare(a, b, dateOrder) {
  const na = num(a)
  const nb = num(b)
  if (na !== null && nb !== null) return na === nb ? 0 : na < nb ? -1 : 1

  const da = a instanceof Date ? a : toDate(a, dateOrder)
  const dbb = b instanceof Date ? b : toDate(b, dateOrder)
  if (da && dbb) return da.getTime() === dbb.getTime() ? 0 : da < dbb ? -1 : 1

  const sa = text(a).trim().toLowerCase()
  const sb = text(b).trim().toLowerCase()
  return sa === sb ? 0 : sa < sb ? -1 : 1
}

// ---------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------
// `arity` is [min, max]. `agg: true` marks a function measured over the
// WHOLE table rather than the row -- see aggregateKeys below.
export const FUNCTIONS = {
  // --- logic
  IF: { arity: [2, 3], group: 'Logic', hint: 'IF(test, then, else)' },
  IFS: { arity: [2, Infinity], group: 'Logic', hint: 'IFS(test1, value1, test2, value2, …, fallback)' },
  AND: { arity: [1, Infinity], group: 'Logic', hint: 'AND(a, b, …)' },
  OR: { arity: [1, Infinity], group: 'Logic', hint: 'OR(a, b, …)' },
  ISBLANK: { arity: [1, 1], group: 'Logic', hint: 'ISBLANK([Column])' },
  ISNUMBER: { arity: [1, 1], group: 'Logic', hint: 'ISNUMBER([Column])' },
  COALESCE: { arity: [1, Infinity], group: 'Logic', hint: 'COALESCE(a, b, …) — the first one that is filled' },

  // --- numbers
  ROUND: { arity: [1, 2], group: 'Numbers', hint: 'ROUND(value, decimals)' },
  FLOOR: { arity: [1, 1], group: 'Numbers', hint: 'FLOOR(value)' },
  CEILING: { arity: [1, 1], group: 'Numbers', hint: 'CEILING(value)' },
  ABS: { arity: [1, 1], group: 'Numbers', hint: 'ABS(value)' },
  MIN: { arity: [1, Infinity], group: 'Numbers', hint: 'MIN(a, b, …) — across this row' },
  MAX: { arity: [1, Infinity], group: 'Numbers', hint: 'MAX(a, b, …) — across this row' },
  NUMBER: { arity: [1, 1], group: 'Numbers', hint: 'NUMBER([Column]) — read text as a number' },
  DIVIDE: { arity: [2, 3], group: 'Numbers', hint: 'DIVIDE(a, b, ifZero) — never an error' },

  // --- text
  CONCAT: { arity: [1, Infinity], group: 'Text', hint: 'CONCAT(a, b, …)' },
  UPPER: { arity: [1, 1], group: 'Text', hint: 'UPPER(text)' },
  LOWER: { arity: [1, 1], group: 'Text', hint: 'LOWER(text)' },
  TRIM: { arity: [1, 1], group: 'Text', hint: 'TRIM(text)' },
  LEN: { arity: [1, 1], group: 'Text', hint: 'LEN(text)' },
  LEFT: { arity: [2, 2], group: 'Text', hint: 'LEFT(text, n)' },
  RIGHT: { arity: [2, 2], group: 'Text', hint: 'RIGHT(text, n)' },
  CONTAINS: { arity: [2, 2], group: 'Text', hint: 'CONTAINS(text, "part")' },
  STARTSWITH: { arity: [2, 2], group: 'Text', hint: 'STARTSWITH(text, "part")' },
  ENDSWITH: { arity: [2, 2], group: 'Text', hint: 'ENDSWITH(text, "part")' },
  REPLACE: { arity: [3, 3], group: 'Text', hint: 'REPLACE(text, find, with)' },
  SPLITPART: { arity: [3, 3], group: 'Text', hint: 'SPLITPART(text, "/", 2)' },

  // --- dates
  TODAY: { arity: [0, 0], group: 'Dates', hint: 'TODAY()' },
  DAYSSINCE: { arity: [1, 1], group: 'Dates', hint: 'DAYSSINCE([Date]) — age in days' },
  DAYSBETWEEN: { arity: [2, 2], group: 'Dates', hint: 'DAYSBETWEEN([From], [To])' },
  YEAR: { arity: [1, 1], group: 'Dates', hint: 'YEAR([Date])' },
  MONTH: { arity: [1, 1], group: 'Dates', hint: 'MONTH([Date]) — 1 to 12' },
  DAY: { arity: [1, 1], group: 'Dates', hint: 'DAY([Date])' },
  MONTHNAME: { arity: [1, 1], group: 'Dates', hint: 'MONTHNAME([Date])' },
  WEEKDAY: { arity: [1, 1], group: 'Dates', hint: 'WEEKDAY([Date]) — Monday first' },
  ADDDAYS: { arity: [2, 2], group: 'Dates', hint: 'ADDDAYS([Date], n)' },

  // --- the whole table
  TOTAL: { arity: [1, 1], agg: true, group: 'Whole table', hint: 'TOTAL([Column]) — summed over every row' },
  AVERAGE: { arity: [1, 1], agg: true, group: 'Whole table', hint: 'AVERAGE([Column])' },
  MAXOF: { arity: [1, 1], agg: true, group: 'Whole table', hint: 'MAXOF([Column])' },
  MINOF: { arity: [1, 1], agg: true, group: 'Whole table', hint: 'MINOF([Column])' },
  COUNTROWS: { arity: [0, 0], agg: true, group: 'Whole table', hint: 'COUNTROWS()' },
  PERCENTOF: { arity: [1, 1], agg: true, group: 'Whole table', hint: 'PERCENTOF([Column]) — this row’s share, 0-100' },
  RANK: { arity: [1, 1], agg: true, group: 'Whole table', hint: 'RANK([Column]) — 1 is the largest' },

  // --- within a group
  TOTALBY: { arity: [2, 2], agg: true, group: 'Within a group', hint: 'TOTALBY([Amount], [Branch])' },
  AVERAGEBY: { arity: [2, 2], agg: true, group: 'Within a group', hint: 'AVERAGEBY([Amount], [Branch])' },
  COUNTBY: { arity: [1, 1], agg: true, group: 'Within a group', hint: 'COUNTBY([Branch]) — rows sharing this value' },
  SHAREOF: { arity: [2, 2], agg: true, group: 'Within a group', hint: 'SHAREOF([Amount], [Branch]) — share of its group, 0-100' },
  RANKBY: { arity: [2, 2], agg: true, group: 'Within a group', hint: 'RANKBY([Amount], [Branch]) — rank inside its group' },
}

/** Every function, grouped, for the help panel. */
export function functionHelp() {
  const groups = new Map()
  for (const [name, meta] of Object.entries(FUNCTIONS)) {
    if (!groups.has(meta.group)) groups.set(meta.group, [])
    groups.get(meta.group).push({ name, hint: meta.hint })
  }
  return Array.from(groups, ([group, items]) => ({ group, items }))
}

// ---------------------------------------------------------------------
// Walking the tree
// ---------------------------------------------------------------------
/** Every column name a formula reads. */
export function formulaColumns(ast, into = new Set()) {
  if (!ast || typeof ast !== 'object') return into
  if (ast.kind === 'column') into.add(ast.name)
  for (const key of ['arg', 'left', 'right']) if (ast[key]) formulaColumns(ast[key], into)
  for (const arg of ast.args || []) formulaColumns(arg, into)
  return into
}

/**
 * The table-wide measurements a formula needs, as stable keys.
 *
 * An aggregate is the same number for every row, so it is worked out once
 * over the whole table before the row loop rather than forty thousand
 * times inside it. Its arguments must be plain column references for that
 * to be possible, which is also the only thing anybody writes.
 */
export function aggregateKeys(ast, into = []) {
  if (!ast || typeof ast !== 'object') return into
  if (ast.kind === 'call' && FUNCTIONS[ast.name]?.agg) {
    const args = ast.args.map((a) => (a.kind === 'column' ? a.name : null))
    if (args.every((a) => a !== null || ast.args.length === 0)) {
      into.push({ fn: ast.name, args, key: `${ast.name}(${args.join(',')})` })
    }
  }
  for (const key of ['arg', 'left', 'right']) if (ast[key]) aggregateKeys(ast[key], into)
  for (const arg of ast.args || []) aggregateKeys(arg, into)
  return into
}

// ---------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------
/**
 * One row's value for one formula.
 *
 * `ctx` is `{ dateOrder, today, aggregates, groups }` -- see buildContext.
 * Anything that cannot be worked out is blank rather than an error string:
 * a column of "#VALUE!" is worse than a column with gaps in it, and the
 * editor's preview is where a broken formula gets noticed.
 */
export function evaluateFormula(ast, row, ctx = {}) {
  const dateOrder = ctx.dateOrder || 'DMY'
  const today = ctx.today || startOfDay(new Date())

  const walk = (node) => {
    switch (node.kind) {
      case 'literal':
        return node.value

      case 'column': {
        const v = row?.[node.name]
        return v === undefined ? null : v
      }

      case 'unary': {
        const n = num(walk(node.arg))
        if (n === null) return null
        return node.op === '-' ? -n : n
      }

      case 'not':
        return !truthy(walk(node.arg))

      case 'binary':
        return binary(node)

      case 'call':
        return call(node)

      default:
        return null
    }
  }

  function binary(node) {
    const op = node.op

    if (op === 'AND') return truthy(walk(node.left)) && truthy(walk(node.right))
    if (op === 'OR') return truthy(walk(node.left)) || truthy(walk(node.right))

    const a = walk(node.left)
    const b = walk(node.right)

    if (op === '&') return text(a) + text(b)

    if (['=', '==', '<>', '!=', '<', '<=', '>', '>='].includes(op)) {
      const c = compare(a, b, dateOrder)
      switch (op) {
        case '=':
        case '==':
          return c === 0
        case '<>':
        case '!=':
          return c !== 0
        case '<':
          return c < 0
        case '<=':
          return c <= 0
        case '>':
          return c > 0
        default:
          return c >= 0
      }
    }

    const na = num(a)
    const nb = num(b)
    if (na === null || nb === null) return null

    switch (op) {
      case '+':
        return na + nb
      case '-':
        return na - nb
      case '*':
        return na * nb
      case '/':
        return nb === 0 ? null : na / nb
      case '%':
        return nb === 0 ? null : na % nb
      case '^':
        return na ** nb
      default:
        return null
    }
  }

  function agg(node) {
    const args = node.args.map((a) => (a.kind === 'column' ? a.name : null))
    return ctx.aggregates?.[`${node.name}(${args.join(',')})`]
  }

  function groupValue(node, which) {
    // Per-group aggregates are stored as a map from group value to number.
    const map = agg(node)
    if (!map) return null
    const key = text(row?.[node.args[which].name] ?? '').trim().toLowerCase()
    const found = map[key]
    return found === undefined ? null : found
  }

  function call(node) {
    const A = node.args
    const v = (i) => walk(A[i])
    const n = (i) => num(walk(A[i]))
    const s = (i) => text(walk(A[i]))
    const d = (i) => {
      const raw = walk(A[i])
      return raw instanceof Date ? raw : toDate(raw, dateOrder)
    }

    switch (node.name) {
      // --- logic
      case 'IF':
        return truthy(v(0)) ? v(1) : A.length > 2 ? v(2) : null
      case 'IFS': {
        for (let i = 0; i + 1 < A.length; i += 2) if (truthy(walk(A[i]))) return walk(A[i + 1])
        return A.length % 2 === 1 ? walk(A[A.length - 1]) : null
      }
      case 'AND':
        return A.every((a) => truthy(walk(a)))
      case 'OR':
        return A.some((a) => truthy(walk(a)))
      case 'ISBLANK':
        return isBlank(v(0))
      case 'ISNUMBER':
        return n(0) !== null
      case 'COALESCE': {
        for (const a of A) {
          const got = walk(a)
          if (!isBlank(got)) return got
        }
        return null
      }

      // --- numbers
      case 'ROUND': {
        const x = n(0)
        if (x === null) return null
        const places = A.length > 1 ? Math.trunc(n(1) ?? 0) : 0
        const f = 10 ** places
        return Math.round(x * f) / f
      }
      case 'FLOOR':
        return n(0) === null ? null : Math.floor(n(0))
      case 'CEILING':
        return n(0) === null ? null : Math.ceil(n(0))
      case 'ABS':
        return n(0) === null ? null : Math.abs(n(0))
      case 'MIN': {
        const list = A.map((a) => num(walk(a))).filter((x) => x !== null)
        return list.length ? Math.min(...list) : null
      }
      case 'MAX': {
        const list = A.map((a) => num(walk(a))).filter((x) => x !== null)
        return list.length ? Math.max(...list) : null
      }
      case 'NUMBER':
        return n(0)
      case 'DIVIDE': {
        const top = n(0)
        const bottom = n(1)
        if (top === null || bottom === null) return null
        if (bottom === 0) return A.length > 2 ? v(2) : null
        return top / bottom
      }

      // --- text
      case 'CONCAT':
        return A.map((a) => text(walk(a))).join('')
      case 'UPPER':
        return s(0).toUpperCase()
      case 'LOWER':
        return s(0).toLowerCase()
      case 'TRIM':
        return s(0).trim()
      case 'LEN':
        return s(0).length
      case 'LEFT':
        return s(0).slice(0, Math.max(0, Math.trunc(n(1) ?? 0)))
      case 'RIGHT': {
        const count = Math.max(0, Math.trunc(n(1) ?? 0))
        return count === 0 ? '' : s(0).slice(-count)
      }
      case 'CONTAINS':
        return s(0).toLowerCase().includes(s(1).toLowerCase())
      case 'STARTSWITH':
        return s(0).toLowerCase().startsWith(s(1).toLowerCase())
      case 'ENDSWITH':
        return s(0).toLowerCase().endsWith(s(1).toLowerCase())
      case 'REPLACE':
        return s(0).split(s(1)).join(s(2))
      case 'SPLITPART': {
        const parts = s(0).split(s(1))
        const index = Math.trunc(n(2) ?? 1)
        return parts[index - 1] ?? ''
      }

      // --- dates
      case 'TODAY':
        return today
      case 'DAYSSINCE': {
        const date = d(0)
        return date ? Math.round((today - startOfDay(date)) / MS_PER_DAY) : null
      }
      case 'DAYSBETWEEN': {
        const from = d(0)
        const to = d(1)
        return from && to ? Math.round((startOfDay(to) - startOfDay(from)) / MS_PER_DAY) : null
      }
      case 'YEAR':
        return d(0)?.getFullYear() ?? null
      case 'MONTH':
        return d(0) ? d(0).getMonth() + 1 : null
      case 'DAY':
        return d(0)?.getDate() ?? null
      case 'MONTHNAME':
        return d(0) ? d(0).toLocaleString('en-US', { month: 'short' }) : null
      case 'WEEKDAY':
        return d(0) ? ((d(0).getDay() + 6) % 7) + 1 : null
      case 'ADDDAYS': {
        const date = d(0)
        const days = n(1)
        return date && days !== null ? new Date(date.getTime() + days * MS_PER_DAY) : null
      }

      // --- the whole table
      case 'TOTAL':
      case 'AVERAGE':
      case 'MAXOF':
      case 'MINOF':
      case 'COUNTROWS':
        return agg(node) ?? null
      case 'PERCENTOF': {
        const total = agg(node)
        const mine = num(row?.[A[0].name])
        return total ? (mine === null ? null : (mine / total) * 100) : null
      }
      case 'RANK': {
        const ranks = agg(node)
        if (!ranks) return null
        const mine = num(row?.[A[0].name])
        return mine === null ? null : ranks[String(mine)] ?? null
      }

      // --- within a group
      case 'TOTALBY':
      case 'AVERAGEBY':
        return groupValue(node, 1)
      case 'COUNTBY':
        return groupValue(node, 0)
      case 'SHAREOF': {
        const total = groupValue(node, 1)
        const mine = num(row?.[A[0].name])
        return total ? (mine === null ? null : (mine / total) * 100) : null
      }
      case 'RANKBY': {
        const map = groupValue(node, 1)
        const mine = num(row?.[A[0].name])
        if (!map || mine === null) return null
        return map[String(mine)] ?? null
      }

      default:
        return null
    }
  }

  try {
    return walk(ast)
  } catch {
    // A formula cannot be allowed to take the page down with it.
    return null
  }
}

// ---------------------------------------------------------------------
// The table-wide numbers
// ---------------------------------------------------------------------
const groupKeyOf = (row, column) => text(row?.[column] ?? '').trim().toLowerCase()

/**
 * Works out every aggregate a set of formulas asks for, once, over all rows.
 *
 * Returns `{ [key]: value }` where a whole-table function maps to a number
 * and a per-group one maps to `{ [groupValue]: number }`.
 */
export function buildAggregates(rows, keys) {
  const out = {}
  const list = rows || []

  for (const { fn, args, key } of keys) {
    if (out[key] !== undefined) continue

    switch (fn) {
      case 'COUNTROWS':
        out[key] = list.length
        break

      case 'TOTAL':
      case 'PERCENTOF': {
        let sum = 0
        for (const row of list) sum += num(row[args[0]]) ?? 0
        out[key] = sum
        break
      }

      case 'AVERAGE': {
        let sum = 0
        let count = 0
        for (const row of list) {
          const n = num(row[args[0]])
          if (n !== null) {
            sum += n
            count += 1
          }
        }
        out[key] = count ? sum / count : null
        break
      }

      case 'MAXOF':
      case 'MINOF': {
        const values = list.map((row) => num(row[args[0]])).filter((n) => n !== null)
        out[key] = values.length ? (fn === 'MAXOF' ? Math.max(...values) : Math.min(...values)) : null
        break
      }

      case 'RANK': {
        // Dense ranking on distinct values, largest first -- two rows with
        // the same number are the same rank, and the next distinct number
        // is the one after it, so "rank 3 of 40" always means something.
        const distinct = [...new Set(list.map((row) => num(row[args[0]])).filter((n) => n !== null))]
        distinct.sort((a, b) => b - a)
        const ranks = {}
        distinct.forEach((value, i) => {
          ranks[String(value)] = i + 1
        })
        out[key] = ranks
        break
      }

      case 'COUNTBY': {
        const counts = {}
        for (const row of list) {
          const g = groupKeyOf(row, args[0])
          counts[g] = (counts[g] || 0) + 1
        }
        out[key] = counts
        break
      }

      case 'TOTALBY':
      case 'SHAREOF': {
        const sums = {}
        for (const row of list) {
          const g = groupKeyOf(row, args[1])
          sums[g] = (sums[g] || 0) + (num(row[args[0]]) ?? 0)
        }
        out[key] = sums
        break
      }

      case 'AVERAGEBY': {
        const sums = {}
        const counts = {}
        for (const row of list) {
          const n = num(row[args[0]])
          if (n === null) continue
          const g = groupKeyOf(row, args[1])
          sums[g] = (sums[g] || 0) + n
          counts[g] = (counts[g] || 0) + 1
        }
        out[key] = Object.fromEntries(Object.entries(sums).map(([g, sum]) => [g, sum / counts[g]]))
        break
      }

      case 'RANKBY': {
        const byGroup = {}
        for (const row of list) {
          const g = groupKeyOf(row, args[1])
          const n = num(row[args[0]])
          if (n === null) continue
          if (!byGroup[g]) byGroup[g] = new Set()
          byGroup[g].add(n)
        }
        out[key] = Object.fromEntries(
          Object.entries(byGroup).map(([g, values]) => {
            const sorted = [...values].sort((a, b) => b - a)
            const ranks = {}
            sorted.forEach((value, i) => {
              ranks[String(value)] = i + 1
            })
            return [g, ranks]
          })
        )
        break
      }

      default:
        out[key] = null
    }
  }

  return out
}
