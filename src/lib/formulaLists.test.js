import test from 'node:test'
import assert from 'node:assert/strict'

import { FUNCTIONS, evaluateFormula, formulaColumns, functionHelp, parseFormula } from './formula.js'

// ---------------------------------------------------------------------
// Saying "any of these" without saying it five times
// ---------------------------------------------------------------------
// A rule somebody needed:
//
//   if the source is walk-in, hide anything scheduled for a 2nd, 3rd, 4th
//   or 5th follow-up; keep every other row
//
// took IF, NOT, OR and four CONTAINS on the same column to write, and the
// version people actually typed -- CONTAINS([Scheduled For], OR(...)) --
// parsed and did nothing. These are the words that make it one line.

const run = (formula, row = {}) => {
  const { ast, error } = parseFormula(formula)
  assert.equal(error, undefined, `${formula}: ${error}`)
  return evaluateFormula(ast, row)
}

test('the rule that started it is one line, and does what it says', () => {
  const rule = 'WHEN([Source] = "WALK-IN", NOTCONTAINS([Scheduled For], "2 FOLL", "3 FOLL", "4 FOLL", "5 FOLL"))'
  assert.equal(run(rule, { Source: 'WALK-IN', 'Scheduled For': '3 FOLL' }), false)
  assert.equal(run(rule, { Source: 'walk-in', 'Scheduled For': '5 foll due' }), false, 'capitals do not matter')
  assert.equal(run(rule, { Source: 'WALK-IN', 'Scheduled For': '1st FOLL' }), true)
  assert.equal(run(rule, { Source: 'Referral', 'Scheduled For': '2 FOLL' }), true, 'other sources are kept')
  assert.equal(run(rule, { Source: '', 'Scheduled For': '2 FOLL' }), true, 'so is a blank source')
})

// --- the words -----------------------------------------------------------------

test('CONTAINS takes any number of words, and one is enough', () => {
  assert.equal(run('CONTAINS([R], "2 FOLL", "3 FOLL")', { R: 'called, 3 foll booked' }), true)
  assert.equal(run('CONTAINS([R], "2 FOLL", "3 FOLL")', { R: '1st FOLL' }), false)
  // What always worked still does.
  assert.equal(run('CONTAINS([Status], "deliver")', { Status: 'Delivered' }), true)
})

test('NOTCONTAINS is none of them, CONTAINSALL is every one', () => {
  assert.equal(run('NOTCONTAINS([R], "2 FOLL", "3 FOLL")', { R: '1st FOLL' }), true)
  assert.equal(run('NOTCONTAINS([R], "2 FOLL", "3 FOLL")', { R: '2 FOLL' }), false)
  assert.equal(run('CONTAINSALL([R], "tyre", "battery")', { R: 'Battery and TYRE' }), true)
  assert.equal(run('CONTAINSALL([R], "tyre", "battery")', { R: 'tyre only' }), false)
})

test('STARTSWITH and ENDSWITH take several too', () => {
  assert.equal(run('STARTSWITH([Reg], "KA", "MH")', { Reg: 'mh12ab' }), true)
  assert.equal(run('ENDSWITH([File], ".pdf", ".jpg")', { File: 'invoice.PDF' }), true)
  assert.equal(run('ENDSWITH([File], ".pdf", ".jpg")', { File: 'notes.txt' }), false)
})

test('IN and NOTIN compare the way = does: numbers as numbers, text without capitals', () => {
  assert.equal(run('IN([Source], "WALK-IN", "REFERRAL")', { Source: ' referral ' }), true)
  assert.equal(run('IN([Source], "WALK-IN", "REFERRAL")', { Source: 'Online' }), false)
  assert.equal(run('IN([Qty], 1, 2, 3)', { Qty: '2' }), true)
  assert.equal(run('NOTIN([Status], "Lost", "Cancelled")', { Status: 'Booked' }), true)
  assert.equal(run('NOTIN([Status], "Lost", "Cancelled")', { Status: 'lost' }), false)
})

test('WHEN holds the rule only where the test is true, and keeps every other row', () => {
  assert.equal(run('WHEN([A] = 1, [B] > 5)', { A: 1, B: 9 }), true)
  assert.equal(run('WHEN([A] = 1, [B] > 5)', { A: 1, B: 2 }), false)
  assert.equal(run('WHEN([A] = 1, [B] > 5)', { A: 2, B: 2 }), true)
  // A yes/no in a calculated column too, never the rule's raw value.
  assert.equal(run('WHEN([A] = 1, [B])', { A: 1, B: 'something' }), true)
})

// --- a list in brackets --------------------------------------------------------------

test('a list in brackets is any of its items, wherever one value goes', () => {
  assert.equal(parseFormula('("a", "b")').ast.kind, 'list')
  assert.equal(run('CONTAINS([R], ("2 FOLL", "3 FOLL"))', { R: '3 foll' }), true)
  assert.equal(run('IN([S], ("A", "B"), "C")', { S: 'c' }), true)
  assert.equal(run('[Source] = ("WALK-IN", "REFERRAL")', { Source: 'referral' }), true)
  // <> is none of them, which is what anybody reading it means.
  assert.equal(run('[Source] <> ("WALK-IN", "REFERRAL")', { Source: 'Direct' }), true)
  assert.equal(run('[Source] <> ("WALK-IN", "REFERRAL")', { Source: 'walk-in' }), false)
})

test('brackets around one thing are still just brackets', () => {
  assert.equal(parseFormula('(1 + 2) * 3').ast.kind, 'binary')
  assert.equal(run('(1 + 2) * 3'), 9)
})

test('a list anywhere else is harmless: joined as text, not a number, yes if any item is', () => {
  assert.equal(run('CONCAT(("a", "b"))'), 'a, b')
  assert.equal(run('[A] + ("1", "2")', { A: 1 }), null)
  assert.equal(run('IF(("", 0), "y", "n")'), 'n')
  assert.equal(run('IF(("", "x"), "y", "n")'), 'y')
})

test('columns inside a list are still columns the formula reads', () => {
  const used = formulaColumns(parseFormula('IN([A], ([B], "x"))').ast)
  assert.deepEqual([...used].sort(), ['A', 'B'])
})

// --- the language knows them -----------------------------------------------------------

test('a missing part is still said in words', () => {
  assert.match(parseFormula('CONTAINS("a")').error, /takes at least 2 arguments/)
  assert.match(parseFormula('WHEN([A] = 1)').error, /takes 2 arguments/)
  assert.match(parseFormula('("a", "b"').error, /Expected "\)"/)
})

test('every new word is in the help, with a hint that shows how to write it', () => {
  const listed = functionHelp().flatMap((g) => g.items.map((i) => i.name))
  for (const name of ['WHEN', 'IN', 'NOTIN', 'NOTCONTAINS', 'CONTAINSALL']) {
    assert.ok(listed.includes(name), name)
    assert.ok(FUNCTIONS[name].hint.startsWith(`${name}(`), name)
    assert.equal(FUNCTIONS[name].agg, undefined, `${name} is asked one row at a time`)
  }
})
