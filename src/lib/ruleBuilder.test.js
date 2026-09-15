import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  RULE_TESTS,
  addValues,
  checkProblem,
  emptyRule,
  explainFormula,
  formulaToRule,
  literal,
  ruleToFormula,
  splitValues,
  testOf,
  withTest,
} from './ruleBuilder.js'
import { checkFormula, formulaHolds } from './conditionFormula.js'
import { parseFormula } from './formula.js'

// ---------------------------------------------------------------------
// A rule built with clicks
// ---------------------------------------------------------------------
// The promise is three-sided: the clicks write a formula the dashboard
// runs; a formula in those shapes opens as the same clicks; and any formula
// at all is read back in words. Each side is tested against the others, so
// none of them can quietly drift.

const COLS = ['Source', 'Scheduled For', 'Status', 'Amount', 'Invoice Date', 'Remarks', 'Reg No']
const rule = (keep, only = [], joins = {}) => ({
  only: { join: joins.only || 'all', checks: only },
  keep: { join: joins.keep || 'all', checks: keep },
})
const c = (column, id, ...values) => ({ column, test: id, values })

test('the rule that started all this is built with clicks, runs, and reads back in words', () => {
  const built = rule(
    [c('Scheduled For', 'not_contains', '2 FOLL', '3 FOLL', '4 FOLL', '5 FOLL')],
    [c('Source', 'is', 'WALK-IN')]
  )
  const formula = ruleToFormula(built)
  assert.equal(formula, 'WHEN([Source] = "WALK-IN", NOTCONTAINS([Scheduled For], "2 FOLL", "3 FOLL", "4 FOLL", "5 FOLL"))')

  const check = checkFormula(formula, COLS)
  assert.equal(check.state, 'ok')
  assert.deepEqual(check.fixes, [], 'what the clicks write is already the short form')

  assert.equal(
    explainFormula(formula),
    'For rows where Source is “WALK-IN”, keep only those where Scheduled For contains none of “2 FOLL”, “3 FOLL”, “4 FOLL”, “5 FOLL”. Every other row is kept.'
  )

  assert.equal(formulaHolds({ Source: 'WALK-IN', 'Scheduled For': '3 FOLL' }, formula), false)
  assert.equal(formulaHolds({ Source: 'WALK-IN', 'Scheduled For': '1st FOLL' }, formula), true)
  assert.equal(formulaHolds({ Source: 'Referral', 'Scheduled For': '3 FOLL' }, formula), true)

  // Opened again, it is the same clicks.
  assert.deepEqual(formulaToRule(formula), built)
})

test('every condition in the list writes a formula that parses, passes, and reads back as the same clicks', () => {
  const sample = { many: ['KA', 'MH'], one: ['500'], two: ['10', '20'], days: ['7'], none: [] }
  for (const t of RULE_TESTS) {
    const built = rule([c('Reg No', t.id, ...sample[t.takes])])
    const formula = ruleToFormula(built)
    assert.ok(formula, t.id)
    assert.equal(parseFormula(formula).error, undefined, `${t.id}: ${formula}`)
    assert.equal(checkFormula(formula, COLS).state, 'ok', `${t.id}: ${formula}`)
    assert.deepEqual(formulaToRule(formula), built, `${t.id}: ${formula}`)
    assert.match(explainFormula(formula), /^Keep rows where Reg No /, `${t.id}: ${explainFormula(formula)}`)
  }
})

test('one value is a plain comparison, several are IN -- and both open as “is”', () => {
  assert.equal(ruleToFormula(rule([c('Status', 'is', 'Lost')])), '[Status] = "Lost"')
  assert.equal(ruleToFormula(rule([c('Status', 'is_not', 'Lost', 'Cancelled')])), 'NOTIN([Status], "Lost", "Cancelled")')
  assert.deepEqual(formulaToRule('[Status] <> "Lost"').keep.checks, [c('Status', 'is_not', 'Lost')])
  // Written by hand in the short forms, it still opens as clicks.
  assert.deepEqual(formulaToRule('[Source] = ("WALK-IN", "REFERRAL")').keep.checks, [c('Source', 'is', 'WALK-IN', 'REFERRAL')])
})

test('all or any, written either way, opens as the same group', () => {
  const any = rule([c('Status', 'is', 'Lost'), c('Invoice Date', 'older', '30')], [], { keep: 'any' })
  assert.equal(ruleToFormula(any), 'OR([Status] = "Lost", OLDERTHAN([Invoice Date], 30))')
  assert.deepEqual(formulaToRule(ruleToFormula(any)), any)
  assert.deepEqual(formulaToRule('[Status] = "Lost" OR [Amount] > 5000').keep, {
    join: 'any',
    checks: [c('Status', 'is', 'Lost'), c('Amount', 'gt', '5000')],
  })
})

test('a formula the clicks cannot show is left as a formula, never half-shown', () => {
  for (const text of [
    'ROUND([Amount], 1) > 5',
    'IF([Status] = "Open", TRUE, FALSE)',
    'AND([Status] = "Open", ROUND([Amount]) > 2)',
    'NOT([Status] = "Open")',
    '[Amount] = [Status]',
    'WHEN([Status] = "Open")',
    '[Amount] >',
  ]) {
    assert.equal(formulaToRule(text), null, text)
  }
  // Nothing written yet is somewhere to start, not a failure.
  assert.deepEqual(formulaToRule(''), emptyRule())
})

test('an unfinished check says what it needs, and stays out of the formula until it has it', () => {
  assert.equal(checkProblem(c('', 'is', 'x')), 'Pick a column')
  assert.equal(checkProblem(c('Status', 'is')), 'Add a value')
  assert.equal(checkProblem(c('Amount', 'between', '10', '')), 'Add both ends')
  assert.equal(checkProblem(c('Invoice Date', 'last_days', 'seven')), 'How many days?')
  assert.equal(checkProblem(c('Status', 'filled')), '')
  assert.equal(ruleToFormula(rule([c('Status', 'is', 'Lost'), c('Amount', 'gt')])), '[Status] = "Lost"')
  // "For these rows" with no rule for them is not a rule yet.
  assert.equal(ruleToFormula(rule([c('Status', 'is')], [c('Source', 'is', 'WALK-IN')])), '')
})

test('values are written so they cannot break the formula around them', () => {
  assert.equal(literal('Delivered'), '"Delivered"')
  assert.equal(literal('He said "no"'), `'He said "no"'`)
  assert.equal(literal(`it's "both"`), `"it's both"`)
  assert.equal(literal('500', { number: true }), '500')
  // A code with a leading zero stays text where it is text.
  assert.equal(ruleToFormula(rule([c('Reg No', 'is', '007')])), '[Reg No] = "007"')
  assert.equal(formulaHolds({ Note: 'He said "no"' }, ruleToFormula(rule([c('Note', 'is', 'He said "no"')]))), true)
})

test('typing or pasting several values adds each once', () => {
  assert.deepEqual(splitValues('2 FOLL, 3 FOLL\n4 FOLL,,'), ['2 FOLL', '3 FOLL', '4 FOLL'])
  assert.deepEqual(addValues(['Lost'], ['lost', 'Won']), ['Lost', 'Won'])
})

test('changing the condition keeps what still makes sense', () => {
  assert.deepEqual(withTest(c('A', 'is', 'x', 'y'), 'contains').values, ['x', 'y'])
  assert.deepEqual(withTest(c('A', 'is', 'x', 'y'), 'gt').values, ['x'])
  assert.deepEqual(withTest(c('A', 'is', 'x'), 'filled').values, [])
  assert.deepEqual(withTest(c('A', 'gt', '30'), 'older').values, ['30'])
  assert.deepEqual(withTest(c('A', 'is', 'x'), 'older').values, [])
  assert.equal(testOf('nonsense').id, 'is')
})

test('any formula that parses is read back in words, not only the ones clicks build', () => {
  assert.equal(explainFormula('DAYSSINCE([Invoice Date]) > 30'), 'Keep rows where days since Invoice Date is more than 30.')
  assert.equal(
    explainFormula('AND([Status] = "Open", OR([Amount] > 5000, ISBLANK([Remarks])))'),
    'Keep rows where Status is “Open” and (Amount is more than 5000 or Remarks is empty).'
  )
  assert.equal(explainFormula('NOT(CONTAINS([Remarks], "test"))'), 'Keep rows where not (Remarks contains “test”).')
  assert.equal(explainFormula('INLASTDAYS([Invoice Date], 1)'), 'Keep rows where Invoice Date is within the last 1 day.')
  // Nothing to say about something that does not parse -- the check line
  // already says what is wrong with it.
  assert.equal(explainFormula('[Amount] >'), '')
  assert.equal(explainFormula(''), '')
})

// --- wiring ----------------------------------------------------------------------------

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

test('the formula box opens as clicks, and every condition row feeds it real values', () => {
  const input = read('pages/admin/FormulaInput.jsx')
  assert.ok(input.includes("const [preferred, setPreferred] = useLocalState('dash.formulaMode', 'build')"))
  assert.ok(input.includes('<RuleBuilder value={text} onChange={onType} columns={columns} valuesOf={valuesOf} />'))
  // Never half-shown: clicks only for a formula the clicks can read.
  assert.ok(input.includes('const readable = useMemo(() => formulaToRule(text) !== null, [text])'))
  assert.ok(input.includes('explainFormula(text)'))

  const builder = read('pages/admin/RuleBuilder.jsx')
  assert.ok(builder.includes('onChange(ruleToFormula(next))'))
  assert.ok(builder.includes('valuesOf(check.column)'))

  const conditions = read('pages/admin/ConditionBuilder.jsx')
  assert.ok(conditions.includes('valuesOf={(column) => valuesFor?.(cond.tab, column)}'))
  assert.ok(conditions.includes('valuesOf={valuesOf}'))
  assert.ok(read('pages/admin/WidgetsPanel.jsx').includes('valuesOf={(column) => valuesFor?.(widget.tab, column)}'))
})
