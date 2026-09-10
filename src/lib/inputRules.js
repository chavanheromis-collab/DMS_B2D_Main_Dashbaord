// ---------------------------------------------------------------------
// What a column takes, and what counts as a sensible answer
// ---------------------------------------------------------------------
// Every editable cell in this app has been a text box. That is right for a
// remark and wrong for everything else: a phone keypad never appears on a
// phone number, a date is typed by hand in whichever order the typist
// happens to think in, and "12,50,000" and "1250000" and "12.5 lakh" all
// end up in the same amount column -- where the chart summing them quietly
// counts one of the three.
//
// So a column can be told what it takes. Two halves, and they are different
// questions:
//
//   THE TYPE is what the field IS. A number gets a numeric keypad and
//   right-aligns; a date gets the browser's own picker; a remark gets a box
//   with room in it. This is worth having on its own, before any rule is
//   written, because most of the damage is typing into the wrong kind of
//   box rather than typing the wrong thing.
//
//   THE CONDITION is what counts as a sensible answer -- a minimum, a
//   maximum, a length, a date that cannot be in the past. Checked before
//   anything is written, on every path a write can take.
//
// Two rules keep it from being a cage:
//
//   EMPTY IS NEVER INVALID. Whether a field may be blank is a different
//   admin decision with its own switch (see lib/requiredColumns.js). A
//   validator that also refused blanks would mean any column with a
//   condition on it could never be cleared, and the two settings would
//   contradict each other on the same field.
//
//   IT JUDGES WHAT IS BEING WRITTEN, NOT WHAT IS THERE. A record that
//   already holds a malformed phone number is not a record somebody is
//   forbidden to fix the remark on. Required blocks on what the row is
//   missing, because that is a promise about the record; this blocks on
//   what you are typing, because that is a promise about the value.

import { isBlank, toDate, toNumber } from './dataUtils.js'

/** Where the list lives on the widget. */
export const INPUT_RULES = 'inputRules'

export const INPUT_TYPES = [
  { value: 'text', label: 'Text', hint: 'A single line — the default' },
  { value: 'textarea', label: 'Long text', hint: 'A box with room in it, for remarks' },
  { value: 'number', label: 'Number', hint: 'A numeric keypad, and a value that adds up' },
  { value: 'date', label: 'Date', hint: 'The browser’s own picker, written back in the page’s date order' },
  { value: 'time', label: 'Time', hint: 'A clock picker' },
  { value: 'email', label: 'Email', hint: 'Checked for an address' },
  { value: 'phone', label: 'Phone', hint: 'A phone keypad, and a digit count' },
  { value: 'url', label: 'Link', hint: 'Checked for a web address' },
]

const TYPE_VALUES = INPUT_TYPES.map((t) => t.value)

/** The DOM `type` for one of ours. Not the same list, deliberately. */
export function htmlInputType(type) {
  switch (type) {
    case 'number':
      return 'number'
    case 'date':
      return 'date'
    case 'time':
      return 'time'
    case 'email':
      return 'email'
    case 'phone':
      return 'tel'
    case 'url':
      return 'url'
    default:
      return 'text'
  }
}

/**
 * The keypad a phone should raise, without the browser validating as it
 * types -- `type="tel"` alone gives no keypad hint on some Androids, and
 * `inputMode` gives no validation on any of them, so both are set.
 */
export function inputMode(type) {
  if (type === 'number') return 'decimal'
  if (type === 'phone') return 'tel'
  if (type === 'email') return 'email'
  if (type === 'url') return 'url'
  return undefined
}

export function newInputRule(id) {
  return { id, column: '', type: 'text' }
}

/** The rules a widget carries, ignoring the ones with no column yet. */
export function inputRulesOf(widget) {
  return (widget?.[INPUT_RULES] || []).filter((r) => r?.column)
}

/** The rule for one column, or null. */
export function inputRuleFor(widget, column) {
  return inputRulesOf(widget).find((r) => r.column === column) || null
}

/** What kind of box this column gets. Text unless somebody said otherwise. */
export function inputTypeFor(widget, column) {
  const type = inputRuleFor(widget, column)?.type
  return TYPE_VALUES.includes(type) ? type : 'text'
}

// ---------------------------------------------------------------------
// Dates, in and out
// ---------------------------------------------------------------------
// The sheet holds "20/03/2026", the browser's picker speaks "2026-03-20",
// and the page has its own idea of which of day and month comes first. All
// three have to agree or a date typed on Monday reads as a different day on
// Tuesday, so the conversion lives here rather than in the two components
// that need it.

const pad = (n) => String(n).padStart(2, '0')

/** A stored cell, as the browser's date input wants it. */
export function toDateInput(value, dateOrder = 'DMY') {
  const d = toDate(value, dateOrder)
  if (!d) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * What the picker gave back, in the format the SHEET already uses.
 *
 * Writing the browser's ISO string straight through would leave one column
 * holding two formats -- the rows somebody edited and the rows they did
 * not -- and every date filter over that column would then be right about
 * half of it.
 */
export function fromDateInputValue(value, dateOrder = 'DMY') {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return String(value ?? '')
  const [, y, mo, d] = m
  if (dateOrder === 'MDY') return `${mo}/${d}/${y}`
  if (dateOrder === 'YMD') return `${y}/${mo}/${d}`
  return `${d}/${mo}/${y}`
}

// ---------------------------------------------------------------------
// Is this a sensible answer?
// ---------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const URL = /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/
// Deliberately loose: +91, brackets, spaces and dashes are all how people
// really write a number down. What is counted is the digits.
const PHONE_DIGITS = /\d/g

/**
 * A number somebody TYPED, as opposed to a number read off a sheet.
 *
 * `toNumber` is deliberately forgiving, because it reads cells that people
 * formatted: "₹12,50,000" is a number and has to be summed as one. That
 * same forgiveness makes it the wrong judge of an answer being given -- it
 * strips every character it does not recognise, so "12.5 lakh" reads as
 * 12.5 and the amount column ends up holding a value that means one thing
 * to the person who typed it and another to every chart that adds it up.
 *
 * So the punctuation a number may legitimately carry is removed, and what
 * is left has to be a number and nothing else.
 */
const NUMERIC = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/

function typedNumber(text) {
  const bare = String(text ?? '').replace(/[\s,₹$€£]/g, '')
  if (!NUMERIC.test(bare)) return null
  const n = Number(bare)
  return Number.isFinite(n) ? n : null
}

function startOfToday() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/**
 * What is wrong with this value -- or null.
 *
 * Blank is always fine here. Whether a field may be blank is
 * `requiredColumns`' question, and answering it in two places would mean a
 * column with a condition on it could never be cleared.
 */
export function checkValue(rule, value, dateOrder = 'DMY') {
  if (!rule || isBlank(value)) return null
  const text = String(value).trim()
  const type = TYPE_VALUES.includes(rule.type) ? rule.type : 'text'

  if (type === 'number') {
    const n = typedNumber(text)
    if (n === null) return 'must be a number'
    if (rule.integer && !Number.isInteger(n)) return 'must be a whole number'
    const min = toNumber(rule.min)
    const max = toNumber(rule.max)
    if (min !== null && n < min) return `must be ${min.toLocaleString('en-IN')} or more`
    if (max !== null && n > max) return `must be ${max.toLocaleString('en-IN')} or less`
    return null
  }

  if (type === 'date') {
    const d = toDate(text, dateOrder)
    if (!d) return 'must be a date'
    const today = startOfToday()
    if (rule.noPast && d < today) return 'cannot be in the past'
    if (rule.noFuture && d > today) return 'cannot be in the future'
    const min = toDate(rule.min, dateOrder)
    const max = toDate(rule.max, dateOrder)
    if (min && d < min) return 'is too early'
    if (max && d > max) return 'is too late'
    return null
  }

  if (type === 'time') {
    if (!/^\d{1,2}:\d{2}(:\d{2})?(\s?[apAP][mM])?$/.test(text)) return 'must be a time'
    return null
  }

  if (type === 'email' && !EMAIL.test(text)) return 'must be an email address'
  if (type === 'url' && !URL.test(text)) return 'must be a link'

  if (type === 'phone') {
    const digits = (text.match(PHONE_DIGITS) || []).length
    const least = toNumber(rule.minDigits) ?? 7
    if (digits < least) return `must have at least ${least} digits`
    const most = toNumber(rule.maxDigits)
    if (most !== null && digits > most) return `must have at most ${most} digits`
    return null
  }

  // Text and long text, and the length limits every type could carry but
  // only these two normally do.
  const min = toNumber(rule.minLength)
  const max = toNumber(rule.maxLength)
  if (min !== null && text.length < min) return `must be at least ${min} characters`
  if (max !== null && text.length > max) return `must be at most ${max} characters`

  if (rule.pattern) {
    // A pattern an admin typed wrong must not take the table down with it,
    // and must not silently pass everything either -- so a broken one is
    // reported as a problem with the RULE, in the editor, and ignored here.
    try {
      if (!new RegExp(rule.pattern).test(text)) return rule.patternNote || 'is not in the right format'
    } catch {
      return null
    }
  }
  return null
}

/** What is wrong with the values being written -- [{ column, problem }]. */
export function invalidChanges(widget, changes, dateOrder = 'DMY') {
  const out = []
  for (const [column, value] of Object.entries(changes || {})) {
    const problem = checkValue(inputRuleFor(widget, column), value, dateOrder)
    if (problem) out.push({ column, problem })
  }
  return out
}

/** Just the column names, for the paths that only need to drop them. */
export function invalidColumns(widget, changes, dateOrder = 'DMY') {
  return invalidChanges(widget, changes, dateOrder).map((p) => p.column)
}

/** The changes with the ones that will not do taken back out. */
export function withoutInvalid(changes, invalid) {
  if (!invalid?.length) return changes
  const out = {}
  for (const [column, value] of Object.entries(changes || {})) {
    if (invalid.includes(column)) continue
    out[column] = value
  }
  return out
}

/** Said when a save is being held back, or a write refused. */
export function invalidNote(problems) {
  const list = (problems || []).filter((p) => p?.column && p?.problem)
  if (list.length === 0) return ''
  return list.map((p) => `${p.column} ${p.problem}`).join(', ')
}

// ---------------------------------------------------------------------
// What the admin is told
// ---------------------------------------------------------------------

/** Why this rule will not do what it looks like -- or null. */
export function inputRuleProblem(rule, cols = []) {
  if (!rule?.column) return 'Pick a column.'
  if (cols.length > 0 && !cols.includes(rule.column)) {
    return `“${rule.column}” is not a column on this tab.`
  }
  if (rule.pattern) {
    try {
      new RegExp(rule.pattern)
    } catch {
      return 'That pattern is not valid, so it is ignored.'
    }
  }
  const min = toNumber(rule.type === 'number' ? rule.min : rule.minLength)
  const max = toNumber(rule.type === 'number' ? rule.max : rule.maxLength)
  if (min !== null && max !== null && min > max) return 'The smallest is larger than the largest.'
  if (rule.noPast && rule.noFuture) return 'Not in the past and not in the future leaves only today.'
  return null
}

/** Plain English, for the line under the editor. */
export function describeRule(rule) {
  const type = INPUT_TYPES.find((t) => t.value === rule?.type) || INPUT_TYPES[0]
  const bits = []
  if (rule?.type === 'number') {
    if (rule.integer) bits.push('whole numbers')
    if (!isBlank(rule.min)) bits.push(`from ${rule.min}`)
    if (!isBlank(rule.max)) bits.push(`up to ${rule.max}`)
  } else if (rule?.type === 'date') {
    if (rule.noPast) bits.push('not in the past')
    if (rule.noFuture) bits.push('not in the future')
    if (!isBlank(rule.min)) bits.push(`from ${rule.min}`)
    if (!isBlank(rule.max)) bits.push(`up to ${rule.max}`)
  } else if (rule?.type === 'phone') {
    if (!isBlank(rule.minDigits)) bits.push(`at least ${rule.minDigits} digits`)
    if (!isBlank(rule.maxDigits)) bits.push(`at most ${rule.maxDigits} digits`)
  } else {
    if (!isBlank(rule?.minLength)) bits.push(`at least ${rule.minLength} characters`)
    if (!isBlank(rule?.maxLength)) bits.push(`at most ${rule.maxLength} characters`)
    if (rule?.pattern) bits.push('matching a pattern')
  }
  const tail = bits.length > 0 ? `, ${bits.join(', ')}` : ''
  return `${type.label}${tail}. An empty cell is always allowed — use Required to change that.`
}
