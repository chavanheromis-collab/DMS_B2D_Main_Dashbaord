import test from 'node:test'
import assert from 'node:assert/strict'

import { FUNCTIONS, evaluateFormula, parseFormula } from './formula.js'
import { applyFix, checkFormula } from './conditionFormula.js'

// ---------------------------------------------------------------------
// Words for the questions people actually ask
// ---------------------------------------------------------------------
// "In the last week", "between ten and fifty thousand", "filled in",
// "registration starting KA". Each was arithmetic on DAYSSINCE, a pair of
// comparisons, a NOT around ISBLANK, or not sayable at all. Now each is a
// word -- and a word anybody can pick from a list.

const TODAY = new Date(2026, 8, 15) // Tuesday 15 September 2026

const run = (formula, row = {}) => {
  const { ast, error } = parseFormula(formula)
  assert.equal(error, undefined, `${formula}: ${error}`)
  return evaluateFormula(ast, row, { today: TODAY, dateOrder: 'DMY' })
}

// --- dates, relative to today -------------------------------------------------

test('today, and the last or next few days, counted in whole days', () => {
  const on = (formula, date) => run(formula, { D: date })
  assert.equal(on('ISTODAY([D])', '15/09/2026'), true)
  assert.equal(on('ISTODAY([D])', '14/09/2026'), false)

  assert.equal(on('INLASTDAYS([D], 7)', '15/09/2026'), true, 'today counts')
  assert.equal(on('INLASTDAYS([D], 7)', '08/09/2026'), true)
  assert.equal(on('INLASTDAYS([D], 7)', '07/09/2026'), false)
  assert.equal(on('INLASTDAYS([D], 7)', '16/09/2026'), false, 'tomorrow is not in the last week')

  assert.equal(on('INNEXTDAYS([D], 7)', '22/09/2026'), true)
  assert.equal(on('INNEXTDAYS([D], 7)', '23/09/2026'), false)
  assert.equal(on('INNEXTDAYS([D], 7)', '14/09/2026'), false, 'yesterday is not coming up')

  assert.equal(on('OLDERTHAN([D], 30)', '15/08/2026'), true)
  assert.equal(on('OLDERTHAN([D], 30)', '16/08/2026'), false, 'exactly 30 days is not MORE than 30')
})

test('this week runs Monday to Sunday; this month and year are the calendar ones', () => {
  const on = (formula, date) => run(formula, { D: date })
  assert.equal(on('THISWEEK([D])', '14/09/2026'), true, 'Monday')
  assert.equal(on('THISWEEK([D])', '20/09/2026'), true, 'Sunday')
  assert.equal(on('THISWEEK([D])', '13/09/2026'), false)
  assert.equal(on('THISWEEK([D])', '21/09/2026'), false)
  assert.equal(on('THISMONTH([D])', '01/09/2026'), true)
  assert.equal(on('THISMONTH([D])', '31/08/2026'), false)
  assert.equal(on('THISYEAR([D])', '01/01/2026'), true)
  assert.equal(on('THISYEAR([D])', '31/12/2025'), false)
})

test('a blank date is never “in the next seven days”', () => {
  for (const blank of ['', null, undefined]) {
    for (const formula of ['ISTODAY([D])', 'INLASTDAYS([D], 7)', 'INNEXTDAYS([D], 7)', 'OLDERTHAN([D], 30)', 'THISWEEK([D])', 'THISMONTH([D])', 'THISYEAR([D])']) {
      assert.equal(run(formula, { D: blank }), false, `${formula} on ${blank}`)
    }
  }
})

// --- ranges, blanks, patterns -----------------------------------------------------

test('BETWEEN includes both ends, takes them either way round, and works on dates', () => {
  assert.equal(run('BETWEEN([A], 1, 10)', { A: '10' }), true)
  assert.equal(run('BETWEEN([A], 1, 10)', { A: 1 }), true)
  assert.equal(run('BETWEEN([A], 1, 10)', { A: 11 }), false)
  assert.equal(run('BETWEEN([A], 10, 1)', { A: 5 }), true)
  assert.equal(run('BETWEEN([A], 1, 10)', { A: '' }), false, 'blank is not in any range')
  assert.equal(run('BETWEEN([D], "01/09/2026", "30/09/2026")', { D: '10/09/2026' }), true)
  assert.equal(run('BETWEEN([D], "01/09/2026", "30/09/2026")', { D: '01/10/2026' }), false)
})

test('ISFILLED is the opposite of ISBLANK, for one column or several', () => {
  assert.equal(run('ISFILLED([A])', { A: 'x' }), true)
  assert.equal(run('ISFILLED([A])', { A: '   ' }), false)
  assert.equal(run('ISFILLED([A], [B])', { A: 'x', B: 'y' }), true)
  assert.equal(run('ISFILLED([A], [B])', { A: 'x', B: '' }), false)
})

test('LIKE matches the whole value, with * and ? and nothing else special', () => {
  assert.equal(run('LIKE([R], "KA*")', { R: 'KA01AB1234' }), true)
  assert.equal(run('LIKE([R], "KA*")', { R: 'MH12AB' }), false)
  assert.equal(run('LIKE([R], "ka??")', { R: 'KA01' }), true, 'capitals do not matter')
  assert.equal(run('LIKE([R], "KA")', { R: 'KA01' }), false, 'the whole value, not a part of it')
  assert.equal(run('LIKE([R], "a.b")', { R: 'axb' }), false, 'a dot is a dot')
  assert.equal(run('LIKE([R], "a.b")', { R: 'a.b' }), true)
  assert.equal(run('LIKE([R], "KA*", "MH*")', { R: 'MH12' }), true, 'any of several patterns')
})

// --- dates compared as dates ----------------------------------------------------------

test('a slashed date compares as a date, not as the number its digits make', () => {
  // 02/10/2025 is 2102025 as digits and 01/09/2026 is 1092026 -- which is
  // how an October 2025 date used to come out LATER than September 2026.
  assert.equal(run('[D] > "01/09/2026"', { D: '02/10/2025' }), false)
  assert.equal(run('[D] > "01/09/2026"', { D: '15/09/2026' }), true)
  assert.equal(run('[D] = "15/09/2026"', { D: '2026-09-15' }), true, 'two ways of writing one day')
  // Numbers are still numbers.
  assert.equal(run('[A] > 3', { A: '12.5' }), true)
  assert.equal(run('[A] = 1200', { A: '₹1,200' }), true)
})

// --- the language knows them -------------------------------------------------------------

test('every new word is a row-at-a-time yes/no with a hint that shows how to write it', () => {
  for (const name of ['BETWEEN', 'ISFILLED', 'LIKE', 'ISTODAY', 'INLASTDAYS', 'INNEXTDAYS', 'OLDERTHAN', 'THISWEEK', 'THISMONTH', 'THISYEAR']) {
    assert.ok(FUNCTIONS[name], name)
    assert.ok(FUNCTIONS[name].hint.startsWith(`${name}(`), name)
    assert.equal(FUNCTIONS[name].agg, undefined, name)
    // The hint itself, as a formula: "…" means "and more like it", which
    // is a note to the reader rather than something to type.
    const sample = FUNCTIONS[name].hint.split(' — ')[0].replace(/,\s*…/g, '')
    const check = checkFormula(sample, [])
    assert.equal(check.state, 'ok', `${sample}: ${check.message}`)
  }
})

test('the long ways of saying these are offered shorter', () => {
  const COLS = ['Amount', 'Date', 'Remarks']
  const shorten = (text, prefix) => {
    const check = checkFormula(text, COLS)
    const fix = check.fixes.find((f) => String(f.from).startsWith(prefix))
    assert.ok(fix, `no ${prefix} for ${text}: ${check.message}`)
    return applyFix(text, fix)
  }
  assert.equal(shorten('NOT(ISBLANK([Remarks]))', 'short-filled@'), 'ISFILLED([Remarks])')
  assert.equal(shorten('AND([Amount] >= 10000, [Amount] <= 50000)', 'short-between@'), 'BETWEEN([Amount], 10000, 50000)')
  assert.equal(shorten('DAYSSINCE([Date]) > 30', 'short-older@'), 'OLDERTHAN([Date], 30)')
  // Not a range: two different columns, or both ends the same way.
  assert.deepEqual(checkFormula('AND([Amount] >= 10, [Date] <= 50)', COLS).fixes, [])
  assert.deepEqual(checkFormula('AND([Amount] >= 10, [Amount] >= 50)', COLS).fixes, [])
  // And the new words are never "shortened" into something longer.
  assert.deepEqual(checkFormula('OLDERTHAN([Date], 30)', COLS).fixes, [])
})
