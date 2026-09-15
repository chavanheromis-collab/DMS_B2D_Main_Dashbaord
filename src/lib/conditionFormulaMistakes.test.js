import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  FORMULA_STARTERS,
  applyFix,
  callsIn,
  checkFormula,
  formulaHolds,
  signatureAt,
  suggestionsAt,
} from './conditionFormula.js'

// ---------------------------------------------------------------------
// The mistakes a spreadsheet habit makes, and the long way round
// ---------------------------------------------------------------------
// Written against formulas somebody actually typed:
//
//   IF([Source]="WALK-IN",<>CONTAINS("1st FOLL"),[Source])
//   IF([Source]="WALK-IN",NOT(CONTAINS([Scheduled For],OR("2 FOLL","3 FOLL","4 FOLL","5 FOLL"))),TRUE)
//
// Each meant "for walk-ins, hide these; keep every other row". The first
// did not parse and the parser said only: I don't understand "<>" here. The
// second parsed and let every row through. Both should end, a click at a
// time, at the one line that was meant.

const LEADS = ['Source', 'Remarks', 'Status', 'Name', 'Scheduled For']
const fixFor = (check, prefix) => check.fixes.find((f) => String(f.from).startsWith(prefix))

/** Apply the fix whose id starts with `prefix`, insisting it is offered. */
function click(text, prefix) {
  const check = checkFormula(text, LEADS)
  const fix = fixFor(check, prefix)
  assert.ok(fix, `no "${prefix}" fix for ${text} — got: ${check.message}`)
  return applyFix(text, fix)
}

// --- the two formulas that started it -------------------------------------------

test('CONTAINS(…, OR(…)) is caught, and mended down to one line', () => {
  const typed = 'IF([Source]="WALK-IN",NOT(CONTAINS([Scheduled For],OR("2 FOLL","3 FOLL","4 FOLL","5 FOLL"))),TRUE)'
  // It parses, and it is wrong: OR gives back TRUE, so a walk-in row
  // scheduled for 2 FOLL sails through.
  assert.equal(formulaHolds({ Source: 'WALK-IN', 'Scheduled For': '2 FOLL' }, typed), true)

  const first = checkFormula(typed, LEADS)
  assert.equal(first.state, 'warning')
  assert.match(first.message, /looks for the word “TRUE”/)

  const listed = click(typed, 'list@')
  assert.equal(listed, 'IF([Source]="WALK-IN",NOT(CONTAINS([Scheduled For],"2 FOLL", "3 FOLL", "4 FOLL", "5 FOLL")),TRUE)')
  // Right now -- and offered shorter, never forced.
  const right = checkFormula(listed, LEADS)
  assert.equal(right.state, 'ok')
  assert.match(right.message, /one click makes it shorter/)

  const negative = click(listed, 'short-not@')
  assert.equal(negative, 'IF([Source]="WALK-IN",NOTCONTAINS([Scheduled For],"2 FOLL", "3 FOLL", "4 FOLL", "5 FOLL"),TRUE)')
  const meant = click(negative, 'short-when')
  assert.equal(meant, 'WHEN([Source]="WALK-IN",NOTCONTAINS([Scheduled For],"2 FOLL", "3 FOLL", "4 FOLL", "5 FOLL"))')

  const done = checkFormula(meant, LEADS)
  assert.equal(done.state, 'ok')
  assert.deepEqual(done.fixes, [], 'nothing left to shorten')

  const holds = (row) => formulaHolds(row, meant)
  assert.equal(holds({ Source: 'WALK-IN', 'Scheduled For': '2 FOLL' }), false)
  assert.equal(holds({ Source: 'walk-in', 'Scheduled For': '4 foll' }), false)
  assert.equal(holds({ Source: 'WALK-IN', 'Scheduled For': '1st FOLL' }), true)
  assert.equal(holds({ Source: 'Referral', 'Scheduled For': '2 FOLL' }), true)
  assert.equal(holds({ Source: '', 'Scheduled For': '2 FOLL' }), true)
})

test('the first formula is mended, one click at a time, into the one that was meant', () => {
  const typed = 'IF([Source]="WALK-IN",<>CONTAINS("1st FOLL"),[Source])'
  const first = checkFormula(typed, LEADS)
  assert.equal(first.state, 'error')
  assert.match(first.message, /NOTCONTAINS/)
  assert.match(first.message, /column to look in/)
  // Both mistakes the parser can see are named at once, not one per attempt.
  assert.equal(first.fixes.length, 2)

  const negated = click(typed, 'not@')
  assert.equal(negated, 'IF([Source]="WALK-IN",NOTCONTAINS("1st FOLL"),[Source])')
  const lookedIn = click(negated, 'in@')
  // Not in [Source] -- that was the other half of the sentence.
  assert.equal(lookedIn, 'IF([Source]="WALK-IN",NOTCONTAINS([Remarks], "1st FOLL"),[Source])')

  const third = checkFormula(lookedIn, LEADS)
  assert.equal(third.state, 'warning')
  assert.match(third.message, /last part of IF/)
  const meant = click(lookedIn, 'if-else')
  assert.equal(meant, 'WHEN([Source]="WALK-IN",NOTCONTAINS([Remarks], "1st FOLL"))')
  assert.equal(checkFormula(meant, LEADS).state, 'ok')

  const holds = (row) => formulaHolds(row, meant)
  assert.equal(holds({ Source: 'WALK-IN', Remarks: '1st FOLL pending' }), false)
  assert.equal(holds({ Source: 'Walk-in', Remarks: '1st foll' }), false, 'case does not matter, either side')
  assert.equal(holds({ Source: 'WALK-IN', Remarks: 'Booked' }), true)
  assert.equal(holds({ Source: 'Referral', Remarks: '1st FOLL' }), true)
  assert.equal(holds({ Source: '', Remarks: '1st FOLL' }), true, 'a blank source is one of the other rows too')
})

test('the last part as a column really did hide rows -- which is why it is flagged', () => {
  const asTyped = 'IF([Source]="WALK-IN",NOTCONTAINS([Remarks], "1st FOLL"),[Source])'
  assert.equal(formulaHolds({ Source: '', Remarks: 'anything' }, asTyped), false)
})

// --- the long way round, made short ---------------------------------------------------

test('several CONTAINS on one column become one', () => {
  const long = 'NOT(OR(CONTAINS([Remarks], "2 FOLL"), CONTAINS([Remarks], "3 FOLL")))'
  const merged = click(long, 'short-any@')
  assert.equal(merged, 'NOT(CONTAINS([Remarks], "2 FOLL", "3 FOLL"))')
  assert.equal(click(merged, 'short-not@'), 'NOTCONTAINS([Remarks], "2 FOLL", "3 FOLL")')

  assert.equal(
    click('AND(CONTAINS([Remarks], "tyre"), CONTAINS([Remarks], "battery"))', 'short-any@'),
    'CONTAINSALL([Remarks], "tyre", "battery")'
  )
  // Different columns are different questions, and are left alone.
  assert.deepEqual(checkFormula('OR(CONTAINS([Remarks], "x"), CONTAINS([Name], "y"))', LEADS).fixes, [])
})

test('one column compared with several values becomes IN or NOTIN', () => {
  assert.equal(click('OR([Status] = "Booked", [Status] = "Delivered")', 'short-in@'), 'IN([Status], "Booked", "Delivered")')
  assert.equal(click('AND([Status] <> "Lost", [Status] != "Cancelled")', 'short-in@'), 'NOTIN([Status], "Lost", "Cancelled")')
  // OR of <> means something else entirely, and is not touched.
  assert.deepEqual(checkFormula('OR([Status] <> "Lost", [Status] <> "Cancelled")', LEADS).fixes, [])
})

test('OR or AND where a list was meant is caught everywhere a list goes', () => {
  assert.equal(click('[Source] = OR("WALK-IN", "REFERRAL")', 'listeq@'), 'IN([Source], "WALK-IN", "REFERRAL")')
  assert.equal(click('[Source] <> OR("WALK-IN", "REFERRAL")', 'listeq@'), 'NOTIN([Source], "WALK-IN", "REFERRAL")')
  assert.equal(click('CONTAINS([Remarks], AND("tyre", "battery"))', 'list@'), 'CONTAINSALL([Remarks], "tyre", "battery")')
  // Named even when there is nothing safe to rewrite it to.
  const odd = checkFormula('IN([Source], OR([Status] = "x", [Name] = "y"))', LEADS)
  assert.equal(odd.state, 'warning')
  assert.equal(odd.fixes.length, 0)
})

// --- the habits that don't translate ---------------------------------------------------

test('“does not” written as <>, != or ! before a function becomes its negative', () => {
  for (const [typed, meant] of [
    ['<>CONTAINS([Remarks], "lost")', 'NOTCONTAINS([Remarks], "lost")'],
    ['!CONTAINS([Remarks], "x")', 'NOTCONTAINS([Remarks], "x")'],
    // No one-word negative for STARTSWITH, so NOT goes around it.
    ['AND([Status] = "Open", != STARTSWITH([Name], "Test"))', 'AND([Status] = "Open", NOT(STARTSWITH([Name], "Test")))'],
  ]) {
    const fixed = click(typed, 'not@')
    assert.equal(fixed, meant)
    assert.notEqual(checkFormula(fixed, LEADS).state, 'error', fixed)
  }
})

test('a real comparison is left alone', () => {
  assert.equal(checkFormula('[Status] <> "Lost"', LEADS).state, 'ok')
  assert.deepEqual(checkFormula('[Status] <> "Lost"', LEADS).fixes, [])
  assert.equal(checkFormula('AND([Status] <> "Lost", CONTAINS([Remarks], "x"))', LEADS).state, 'ok')
})

test('a NOT run into a name is turned into the word that exists, never into its opposite', () => {
  // NOTCONTAINS is a real word now.
  assert.equal(checkFormula('NOTCONTAINS([Remarks], "lost")', LEADS).state, 'ok')

  const doesNot = checkFormula('DOESNOTCONTAIN([Remarks], "x")', LEADS)
  assert.equal(doesNot.fixes.some((f) => f.label === 'CONTAINS()'), false, 'offering CONTAINS() inverts the condition')
  assert.equal(click('DOESNOTCONTAIN([Remarks], "x")', 'notfn@'), 'NOTCONTAINS([Remarks], "x")')
  assert.equal(click('NOTBLANK([Remarks])', 'notfn@'), 'NOT(ISBLANK([Remarks]))')

  // An ordinary misspelling still gets the ordinary suggestion.
  assert.deepEqual(checkFormula('CONTIANS([Remarks], "x")', LEADS).fixes.map((f) => f.label), ['CONTAINS()'])
})

test('CONTAINS with nothing to look in says so, and only guesses a column it can see', () => {
  const known = checkFormula('CONTAINS("1st FOLL")', LEADS)
  assert.match(known.message, /CONTAINS\(\[Remarks\], "1st FOLL"\)/)
  assert.equal(applyFix('CONTAINS("1st FOLL")', fixFor(known, 'in@')), 'CONTAINS([Remarks], "1st FOLL")')

  // With no list of columns, a made-up name would match nothing, silently.
  const unknown = checkFormula('CONTAINS("1st FOLL")', [])
  assert.equal(unknown.state, 'error')
  assert.equal(unknown.fixes.length, 0)

  // The text was forgotten rather than the column: nothing to insert.
  const noText = checkFormula('CONTAINS([Remarks])', LEADS)
  assert.match(noText.message, /the text to find/)
  assert.equal(noText.fixes.length, 0)
})

test('an IF used as a condition is turned into WHEN, which keeps every other row', () => {
  const two = 'IF([Source] = "Walk-in", NOTCONTAINS([Remarks], "x"))'
  const missing = checkFormula(two, LEADS)
  assert.equal(missing.state, 'warning')
  assert.match(missing.message, /no last part/)
  assert.equal(click(two, 'if-last'), 'WHEN([Source] = "Walk-in", NOTCONTAINS([Remarks], "x"))')

  const words = 'IF([Status] = "Open", "Yes", "No")'
  const texty = checkFormula(words, LEADS)
  assert.equal(texty.state, 'warning')
  assert.match(texty.message, /middle part of IF/)
  // Not a style point: "No" is text, and text counts as yes.
  assert.equal(formulaHolds({ Status: 'Closed' }, words), true)

  // A deliberate FALSE is a decision, not a mistake, and not "shorter".
  const hides = checkFormula('IF([Status] = "Open", [Remarks] <> "", FALSE)', LEADS)
  assert.equal(hides.state, 'ok')
  assert.deepEqual(hides.fixes, [])
})

test('a comparison with nothing on its left says what it needs', () => {
  const check = checkFormula('AND(<> "Lost")', LEADS)
  assert.equal(check.state, 'error')
  assert.match(check.message, /needs one on each side/)
})

test('a fix worked out on other text does nothing', () => {
  const check = checkFormula('<>CONTAINS([Remarks], "x")', LEADS)
  assert.equal(applyFix('something else', fixFor(check, 'not@')), 'something else')
})

// --- help while typing --------------------------------------------------------------------

test('NOT, TRUE, FALSE and the new words are offered while typing', () => {
  const no = suggestionsAt('no', 2, LEADS).items.map((i) => i.label)
  assert.equal(no[0], 'NOT()')
  assert.ok(no.includes('NOTCONTAINS()'))
  assert.ok(no.includes('NOTIN()'))
  assert.match(suggestionsAt('no', 2, LEADS).items[0].detail, /NOTCONTAINS/)

  assert.ok(suggestionsAt('whe', 3, LEADS).items.some((i) => i.label === 'WHEN()'))
  const text = 'IF([Source] = "x", NOTCONTAINS([Remarks], "y"), tr'
  assert.ok(suggestionsAt(text, text.length, LEADS).items.some((i) => i.label === 'TRUE'))
  assert.equal(signatureAt('NOT(', 4).name, 'NOT')
  // And the signature keeps up past the second word.
  const many = 'NOTCONTAINS([Remarks], "a", "b", '
  assert.equal(signatureAt(many, many.length).name, 'NOTCONTAINS')
})

test('the starting points are the short forms', () => {
  const build = (id) => FORMULA_STARTERS.find((s) => s.id === id).build(LEADS)
  assert.equal(build('only-when'), 'WHEN([Source] = "Walk-in", NOTCONTAINS([Remarks], "2 FOLL", "3 FOLL"))')
  assert.equal(build('not-contains'), 'NOTCONTAINS([Status], "cancelled", "lost")'.replace('[Status]', `[${'Remarks'}]`))
  assert.match(build('either'), /^IN\(/)
  for (const starter of FORMULA_STARTERS) {
    const check = checkFormula(starter.build(LEADS), LEADS)
    assert.equal(check.state, 'ok', `${starter.id}: ${check.message}`)
    assert.deepEqual(check.fixes, [], `${starter.id} is offered shorter than itself`)
  }
})

test('calls are read the way the parser reads them', () => {
  const text = 'IF(CONTAINS([Note (a, b)], "x, (y)"), TRUE, FALSE)'
  const calls = callsIn(text)
  const top = calls.find((c) => c.name === 'IF')
  assert.equal(top.args.length, 3)
  assert.equal(text.slice(top.args[0].from, top.args[0].to), 'CONTAINS([Note (a, b)], "x, (y)")')
  assert.equal(calls.find((c) => c.name === 'CONTAINS').args.length, 2)
  // A bracketed list is not a call, and its commas belong to it.
  assert.equal(callsIn('IN([A], ("x", "y"))').find((c) => c.name === 'IN').args.length, 2)
  assert.deepEqual(callsIn('TODAY()')[0].args, [])
  assert.deepEqual(callsIn(''), [])
})

test('a mended shape is offered in words, not as “did you mean”', () => {
  const input = fs.readFileSync(path.resolve(import.meta.dirname, '../pages/admin/FormulaInput.jsx'), 'utf8')
  assert.ok(input.includes('{fix.prompt ? fix.prompt : <>did you mean {fix.label}?</>}'))
})
