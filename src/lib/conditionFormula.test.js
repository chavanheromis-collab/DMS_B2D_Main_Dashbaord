import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  FORMULA_COLUMN,
  FORMULA_OPERATOR,
  FORMULA_STARTERS,
  applyFix,
  applySuggestion,
  checkFormula,
  compileConditionFormula,
  conditionPatch,
  describeFormula,
  formulaHolds,
  isFormulaCondition,
  isYesNo,
  nearest,
  signatureAt,
  signatureParts,
  suggestionsAt,
} from './conditionFormula.js'
import { matchesConditions, testCondition } from './filterEngine.js'
import { OPERATORS, operatorMeta } from './config.js'
import { FUNCTIONS } from './formula.js'

// ---------------------------------------------------------------------
// A condition that is a formula
// ---------------------------------------------------------------------
// Two things are worth testing, and neither is "does the parser parse" --
// formula.test.js has that. One is that a formula condition actually
// REACHES every evaluator, rather than being saved and dropped by the
// nineteen tidy-up filters on the way. The other is the guidance: that
// what the box says back is right, because a help line that is wrong is
// worse than none.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const COLUMNS = ['Status', 'Amount', 'Invoice Date', 'Owner’s Name', 'Cost']

const daysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  const pad = (x) => String(x).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

// --- evaluating ----------------------------------------------------------

test('a formula condition is asked of the whole row', () => {
  const row = { Status: 'Delivered', Amount: '150', Cost: '90' }
  assert.equal(formulaHolds(row, '[Amount] > 100'), true)
  assert.equal(formulaHolds(row, '[Amount] > 200'), false)
  assert.equal(formulaHolds(row, 'AND([Status] = "Delivered", [Amount] > [Cost])'), true)
  assert.equal(formulaHolds(row, '[Status] = "Delivered" AND [Amount] < [Cost]'), false)
  assert.equal(formulaHolds(row, 'CONTAINS([Status], "liver")'), true)
})

test('equality does not care about capitals, as the help says', () => {
  assert.equal(formulaHolds({ Status: 'Delivered' }, '[Status] = "delivered"'), true)
})

test('dates are read the way the page reads them', () => {
  const row = { 'Invoice Date': daysAgo(40) }
  assert.equal(formulaHolds(row, 'DAYSSINCE([Invoice Date]) > 30', 'DMY'), true)
  assert.equal(formulaHolds(row, 'DAYSSINCE([Invoice Date]) > 60', 'DMY'), false)
})

test('true means what IF() means by true', () => {
  // One definition of truth for the language. `[Qty]` alone is "filled
  // and not zero" inside IF, so it is here too.
  assert.equal(formulaHolds({ Qty: '3' }, '[Qty]'), true)
  assert.equal(formulaHolds({ Qty: '0' }, '[Qty]'), false)
  assert.equal(formulaHolds({ Qty: '' }, '[Qty]'), false)
})

test('a formula nobody has typed is not a condition yet', () => {
  // An empty box must not blank the page while somebody is choosing the
  // operator.
  assert.equal(formulaHolds({ A: 1 }, ''), true)
  assert.equal(formulaHolds({ A: 1 }, '   '), true)
  assert.equal(formulaHolds({ A: 1 }, null), true)
})

test('a broken formula fails closed', () => {
  // A limit on what somebody may see must hide rows when it breaks, not
  // show all of them; a KPI dropping to zero is noticed.
  assert.equal(formulaHolds({ A: 1 }, '[A] >'), false)
  assert.equal(formulaHolds({ A: 1 }, 'NOSUCHFUNCTION([A])'), false)
  assert.equal(formulaHolds({ A: 1 }, '[A'), false)
})

test('a whole-table measure fails closed, because a row cannot answer it', () => {
  assert.equal(formulaHolds({ Amount: 5 }, '[Amount] > AVERAGE([Amount])'), false)
  assert.equal(compileConditionFormula('RANK([Amount]) = 1').wholeTable, true)
  assert.equal(compileConditionFormula('[Amount] > 1').wholeTable, false)
})

test('each formula is parsed once, not once per row', () => {
  // A tab is forty thousand rows.
  assert.equal(compileConditionFormula('[Amount] > 7'), compileConditionFormula('[Amount] > 7'))
})

// --- reaching every evaluator --------------------------------------------

test('the one evaluator every condition goes through answers it', () => {
  const cond = { tab: 'T', column: FORMULA_COLUMN, operator: FORMULA_OPERATOR, value: '[Amount] > 100' }
  assert.equal(testCondition({ Amount: 150 }, cond), true)
  assert.equal(testCondition({ Amount: 50 }, cond), false)
  // Even without the column it normally carries.
  assert.equal(testCondition({ Amount: 50 }, { operator: FORMULA_OPERATOR, value: '[Amount] > 100' }), false)
})

test('a set of conditions does not drop the formula ones', () => {
  // If the formula had been dropped, the list would be empty and an empty
  // list matches EVERYTHING -- so this passing proves it was evaluated.
  const onlyFormula = [{ operator: FORMULA_OPERATOR, value: '[Amount] > 100' }]
  assert.equal(matchesConditions({ Amount: 5 }, onlyFormula), false)
  assert.equal(matchesConditions({ Amount: 500 }, onlyFormula), true)
  // Mixed with an ordinary one.
  const mixed = [
    { column: 'Status', operator: 'equals', value: 'Lost' },
    { column: FORMULA_COLUMN, operator: FORMULA_OPERATOR, value: '[Amount] > 100' },
  ]
  assert.equal(matchesConditions({ Status: 'Lost', Amount: 500 }, mixed, 'all'), true)
  assert.equal(matchesConditions({ Status: 'Lost', Amount: 5 }, mixed, 'all'), false)
  assert.equal(matchesConditions({ Status: 'Won', Amount: 500 }, mixed, 'any'), true)
})

test('the column it carries is what keeps it alive through the tidy-up filters', () => {
  // Nineteen places tidy a condition list with `.filter((c) => c.column)`.
  const list = [{ column: FORMULA_COLUMN, operator: FORMULA_OPERATOR, value: '[A] > 1' }]
  assert.equal(list.filter((c) => c.column).length, 1)
  // And it is a name no sheet can have: Google reads a leading "=" as a
  // formula, so nobody can make a header that collides with it.
  assert.ok(FORMULA_COLUMN.startsWith('='))
})

test('a clearing rule and a blend fallback use the same evaluator, so they get it too', () => {
  const clearRules = read('lib/clearRules.js')
  const blend = read('lib/blend.js')
  assert.ok(clearRules.includes('testCondition(after, rule, dateOrder)'))
  assert.ok(blend.includes('testCondition( before,'))
})

test('the formula is answered before anything reads the column', () => {
  const engine = read('lib/filterEngine.js')
  const body = engine.slice(engine.indexOf('export function testCondition'))
  const formula = body.indexOf('formulaHolds(row, cond.value, dateOrder)')
  const column = body.indexOf('row[cond.column]')
  assert.ok(formula > 0 && column > 0)
  assert.ok(formula < column, 'the column is read before the formula is checked')
})

// --- choosing it ---------------------------------------------------------

test('it is an operator like any other, with a value', () => {
  const meta = operatorMeta(FORMULA_OPERATOR)
  assert.equal(meta.value, FORMULA_OPERATOR)
  assert.equal(meta.arity, 1, 'a formula is its value')
  assert.equal(meta.formula, true)
  assert.ok(OPERATORS.some((o) => o.value === FORMULA_OPERATOR))
  // The clearing-rule summary strips the bracketed part of a label; what
  // is left has to read as a sentence.
  assert.equal(meta.label.replace(/ \(.*\)$/, ''), 'matches formula')
})

test('choosing a formula gives the condition its column, and leaving it takes it back', () => {
  assert.deepEqual(conditionPatch({ column: 'Status' }, { operator: FORMULA_OPERATOR }), {
    operator: FORMULA_OPERATOR,
    column: FORMULA_COLUMN,
  })
  assert.deepEqual(conditionPatch({ column: FORMULA_COLUMN }, { operator: 'equals' }), {
    operator: 'equals',
    column: '',
  })
  // An ordinary operator change leaves an ordinary column alone.
  assert.deepEqual(conditionPatch({ column: 'Status' }, { operator: 'equals' }), { operator: 'equals' })
  // And a value edit is not an operator change at all.
  assert.deepEqual(conditionPatch({ column: FORMULA_COLUMN }, { value: '[A] > 1' }), { value: '[A] > 1' })
  assert.equal(isFormulaCondition({ operator: FORMULA_OPERATOR }), true)
  assert.equal(isFormulaCondition({ operator: 'equals' }), false)
  assert.equal(isFormulaCondition(null), false)
})

test('a summary shows the formula, not the column it carries', () => {
  assert.equal(describeFormula({ value: '[A]  >   1' }), 'formula [A] > 1')
  assert.equal(describeFormula({ value: '' }), 'formula (not written yet)')
  const long = describeFormula({ value: 'x'.repeat(200) }, 20)
  assert.equal(long.length, 'formula '.length + 20)
  assert.ok(long.endsWith('…'))
})

// --- guidance: is it right? ----------------------------------------------

test('an empty box says it is not in force yet', () => {
  assert.equal(checkFormula('').state, 'empty')
  assert.equal(checkFormula('  ').state, 'empty')
})

test('a parse error is said in the parser own words', () => {
  const check = checkFormula('[Amount] >', COLUMNS)
  assert.equal(check.state, 'error')
  assert.match(check.message, /ends too early/)
})

test('a misspelt function comes with the one that exists', () => {
  const check = checkFormula('dayssincee([Invoice Date]) > 30', COLUMNS)
  assert.equal(check.state, 'error')
  assert.match(check.message, /no function called DAYSSINCEE/)
  assert.deepEqual(check.fixes.map((f) => f.label), ['DAYSSINCE()'])
  // And the fix replaces it however it was typed.
  assert.equal(applyFix('dayssincee([Invoice Date]) > 30', check.fixes[0]), 'DAYSSINCE([Invoice Date]) > 30')
})

test('a misspelt column comes with the one that exists', () => {
  // A swapped pair of letters is the commonest typo there is.
  const check = checkFormula('[Stauts] = "Lost"', COLUMNS)
  assert.equal(check.state, 'error')
  assert.match(check.message, /no column called \[Stauts\]/)
  assert.deepEqual(check.fixes.map((f) => f.label), ['[Status]'])
  assert.equal(applyFix('[Stauts] = "Lost" AND [Stauts] <> ""', check.fixes[0]), '[Status] = "Lost" AND [Status] <> ""')
})

test('columns are not called wrong when the list is not known', () => {
  // An editor that has not loaded a tab's headers must not mark every
  // column in the formula as a mistake.
  assert.equal(checkFormula('[Anything] > 1', []).state, 'ok')
  assert.equal(checkFormula('[Anything] > 1').state, 'ok')
})

test('a whole-table measure is refused with where to put it instead', () => {
  const check = checkFormula('[Amount] > AVERAGE([Amount])', COLUMNS)
  assert.equal(check.state, 'error')
  assert.match(check.message, /calculated column/)
})

test('a formula that works out a number is flagged, not refused', () => {
  // It still works -- anything non-zero counts as yes -- but it is almost
  // never what was meant.
  const check = checkFormula('[Amount] * 2', COLUMNS)
  assert.equal(check.state, 'warning')
  assert.match(check.message, /yes\/no/)
})

test('a correct formula says so, and says what it reads', () => {
  const check = checkFormula('AND([Status] = "Delivered", [Amount] > 0)', COLUMNS)
  assert.equal(check.state, 'ok')
  assert.deepEqual(check.columnsUsed.sort(), ['Amount', 'Status'])
  assert.match(check.message, /Reads correctly · uses/)
})

test('what counts as a yes/no', () => {
  const shape = (text) => isYesNo(compileConditionFormula(text).ast)
  assert.equal(shape('[A] > 1'), true)
  assert.equal(shape('[A] = "x"'), true)
  assert.equal(shape('AND([A] > 1, [B] < 2)'), true)
  assert.equal(shape('CONTAINS([A], "x")'), true)
  assert.equal(shape('IF([A] > 1, TRUE, FALSE)'), true)
  assert.equal(shape('[A] + 1'), false)
  assert.equal(shape('ROUND([A], 1)'), false)
  assert.equal(isYesNo({ kind: 'not' }), true)
  assert.equal(isYesNo(null), false)
})

test('the nearest name is close, or nothing', () => {
  assert.equal(nearest('status', COLUMNS), 'Status', 'capitals first')
  assert.equal(nearest('Amoutn', COLUMNS), 'Amount')
  assert.equal(nearest('Completely different', COLUMNS), '')
  // Short names get one slip, not two: "Age" is not a typo of "Amt".
  assert.equal(nearest('Age', ['Amt']), '')
  assert.equal(nearest('Ag', ['Agg']), 'Agg')
  assert.equal(nearest('', COLUMNS), '')
})

// --- guidance: what could go here? ---------------------------------------

test('inside a "[" it offers columns, starting with the ones that begin so', () => {
  const text = '[Am'
  const s = suggestionsAt(text, text.length, COLUMNS)
  // "Amount" starts with it, so it comes first; "Owner's Name" only
  // contains it, so it follows rather than being left out.
  assert.deepEqual(s.items.map((i) => i.label), ['Amount', 'Owner’s Name'])
  assert.equal(s.items[0].insert, '[Amount]')
  assert.equal(s.replaceFrom, 0)
  // Anywhere in a name, not only at its start.
  assert.deepEqual(suggestionsAt('[date', 5, COLUMNS).items.map((i) => i.label), ['Invoice Date'])
})

test('accepting a column replaces the half-typed name and its bracket', () => {
  // Never "[Stat[Status]]".
  const text = 'AND([Stat] = "x")'
  const at = text.indexOf('Stat') + 4
  const s = suggestionsAt(text, at, COLUMNS)
  const r = applySuggestion(text, s.items[0], s)
  assert.equal(r.text, 'AND([Status] = "x")')
  assert.equal(r.cursor, 'AND([Status]'.length)
})

test('on a bare word it offers functions and columns both', () => {
  // People type "days" meaning DAYSSINCE and "amo" meaning [Amount].
  const days = suggestionsAt('days', 4, COLUMNS)
  assert.ok(days.items.some((i) => i.label === 'DAYSSINCE()'))
  assert.equal(days.items.find((i) => i.label === 'DAYSSINCE()').insert, 'DAYSSINCE(')
  const amo = suggestionsAt('amo', 3, COLUMNS)
  assert.ok(amo.items.some((i) => i.kind === 'column' && i.label === 'Amount'))
})

test('a whole-table function is never offered where it would be refused', () => {
  const all = Object.keys(FUNCTIONS).filter((name) => FUNCTIONS[name].agg)
  for (const name of all) {
    const prefix = name.slice(0, 3)
    const offered = suggestionsAt(prefix, prefix.length, []).items.map((i) => i.label)
    assert.equal(offered.includes(`${name}()`), false, `${name} offered`)
  }
})

test('nothing is offered inside quotes', () => {
  // "Delivered" is a value; a list of functions over it is noise.
  assert.deepEqual(suggestionsAt('[Status] = "del', 15, COLUMNS).items, [])
  // But a column name holding an apostrophe is not a quote.
  assert.ok(suggestionsAt('[Owner’s Name] = ', 18, COLUMNS).items.length === 0)
  assert.ok(suggestionsAt("[Owner's Name] = am", 19, COLUMNS).items.length > 0)
})

test('the signature follows the argument being written', () => {
  const text = 'IF([Amount] > 1, "yes", '
  assert.deepEqual(signatureAt(text, text.length), { name: 'IF', hint: FUNCTIONS.IF.hint, argIndex: 2 })
  assert.equal(signatureAt('IF(', 3).argIndex, 0)
  assert.equal(signatureAt('[A] > 1', 7), null)
})

test('commas that are not argument separators do not move it', () => {
  const quoted = 'CONTAINS([Note], "a, b")'
  assert.equal(signatureAt(quoted, quoted.length - 1).argIndex, 1)
  const bracketed = 'IF([Owner, Name]'
  assert.equal(signatureAt(bracketed, bracketed.length).argIndex, 0)
  // The innermost call is the one being written.
  const nested = 'IF(AND([A] > 1, '
  assert.equal(signatureAt(nested, nested.length).name, 'AND')
  assert.equal(signatureAt(nested, nested.length).argIndex, 1)
})

test('the signature is split so the current argument can be picked out', () => {
  const parts = signatureParts('IF(test, then, else)', 1)
  assert.deepEqual(parts.args, ['test', 'then', 'else'])
  assert.equal(parts.current, 1)
  // A variadic function's last argument repeats, so past the end it stays
  // on the last rather than picking out nothing.
  assert.equal(signatureParts('AND(a, b, …)', 9).current, 2)
  assert.equal(signatureParts('DAYSSINCE([Date]) — age in days', 0).note, 'age in days')
  assert.equal(signatureParts('TODAY()', 0).current, -1)
})

// --- starting points -----------------------------------------------------

test('every starter is a correct yes/no, written with the tab own columns', () => {
  for (const starter of FORMULA_STARTERS) {
    const text = starter.build(COLUMNS)
    const check = checkFormula(text, COLUMNS)
    assert.equal(check.state, 'ok', `${starter.id}: ${text} — ${check.message}`)
  }
  // With no columns known they still parse, with placeholder names.
  for (const starter of FORMULA_STARTERS) {
    assert.notEqual(checkFormula(starter.build([])).state, 'error', starter.id)
  }
})

// --- and how it is wired -------------------------------------------------

test('the value box becomes the guided editor for a formula', () => {
  const builder = read('pages/admin/ConditionBuilder.jsx')
  assert.ok(builder.includes('{meta.formula ? ('))
  assert.ok(builder.includes('<FormulaInput'))
  assert.ok(builder.includes('columns={columns || []}'))
})

test('the condition builder gives the condition its column, and says it is a formula', () => {
  const builder = read('pages/admin/ConditionBuilder.jsx')
  assert.ok(builder.includes('onChange={(patch) => setCondition(ci, conditionPatch(cond, patch))}'))
  assert.ok(builder.includes('columns={columnsOf(cond.tab)}'))
  assert.ok(builder.includes('<Sigma size={11} /> formula'))
})

test('the guided editor talks back, and does not lag the typing', () => {
  const input = read('pages/admin/FormulaInput.jsx')
  // The shared buffer, so a page editor does not re-render per letter.
  assert.ok(input.includes("useTypingBuffer(value || '', onChange)"))
  assert.ok(input.includes('suggestionsAt(text, cursor ?? text.length, columns)'))
  assert.ok(input.includes('checkFormula(text, columns)'))
  // mousedown, or the blur closes the list before the click lands.
  assert.ok(input.includes('onMouseDown={(e) => { e.preventDefault() accept(item) }}'))
  // The keyboard works the list.
  for (const key of ["'ArrowDown'", "'ArrowUp'", "'Enter'", "'Tab'", "'Escape'"]) {
    assert.ok(input.includes(key), key)
  }
  // The help does not list what the check would refuse.
  assert.ok(input.includes('!FUNCTIONS[item.name]?.agg'))
})

test('a user row limit written as a formula is described as one', () => {
  const scope = read('lib/userScope.js')
  assert.ok(scope.includes('isFormulaCondition(c)'))
  assert.ok(scope.includes('describeFormula(c)'))
})
