import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  INPUT_RULES,
  INPUT_TYPES,
  checkValue,
  describeRule,
  fromDateInputValue,
  htmlInputType,
  inputMode,
  inputRuleFor,
  inputRuleProblem,
  inputRulesOf,
  inputTypeFor,
  invalidChanges,
  invalidColumns,
  invalidNote,
  newInputRule,
  toDateInput,
  withoutInvalid,
} from './inputRules.js'

const widget = (rules) => ({ type: 'table', tab: 'MASTER', editable: true, [INPUT_RULES]: rules })

const AMOUNT = { id: 'i1', column: 'Amount', type: 'number', min: '0' }
const DUE = { id: 'i2', column: 'Due', type: 'date', noPast: true }
const PHONE = { id: 'i3', column: 'Mobile', type: 'phone', minDigits: '10', maxDigits: '12' }

// ---------------------------------------------------------------------
// What a column takes
// ---------------------------------------------------------------------

test('a column with no rule is a text box, as it always was', () => {
  assert.equal(inputTypeFor(widget([]), 'Remark'), 'text')
  assert.equal(inputTypeFor({}, 'Remark'), 'text')
  assert.equal(inputRuleFor(widget([AMOUNT]), 'Remark'), null)
})

test('a column with a rule takes what the rule says', () => {
  assert.equal(inputTypeFor(widget([AMOUNT, DUE]), 'Amount'), 'number')
  assert.equal(inputTypeFor(widget([AMOUNT, DUE]), 'Due'), 'date')
})

test('a type nobody has heard of is a text box, not a broken one', () => {
  assert.equal(inputTypeFor(widget([{ column: 'X', type: 'sausage' }]), 'X'), 'text')
})

test('a rule with no column yet is not a rule', () => {
  assert.deepEqual(inputRulesOf(widget([newInputRule('i9'), AMOUNT])), [AMOUNT])
})

test('the DOM type is its own list, and a phone is a tel', () => {
  assert.equal(htmlInputType('phone'), 'tel')
  assert.equal(htmlInputType('textarea'), 'text', 'the box is chosen by the component, not by this')
  assert.equal(htmlInputType('number'), 'number')
  assert.equal(htmlInputType(undefined), 'text')
  assert.equal(inputMode('number'), 'decimal')
  assert.equal(inputMode('phone'), 'tel')
  assert.equal(inputMode('text'), undefined)
})

// ---------------------------------------------------------------------
// Empty is never invalid
// ---------------------------------------------------------------------

test('a blank cell passes every rule there is', () => {
  // Whether a field may be blank is `requiredColumns`' question. Answering
  // it here too would mean a column with a condition on it could never be
  // cleared, and the two settings would contradict each other.
  for (const rule of [AMOUNT, DUE, PHONE, { column: 'X', type: 'email' }]) {
    assert.equal(checkValue(rule, ''), null, rule.type)
    assert.equal(checkValue(rule, '   '), null, rule.type)
    assert.equal(checkValue(rule, null), null, rule.type)
  }
})

test('no rule is no complaint', () => {
  assert.equal(checkValue(null, 'anything'), null)
})

// ---------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------

test('a number has to be one', () => {
  assert.equal(checkValue(AMOUNT, '1250000'), null)
  assert.equal(checkValue(AMOUNT, '12,50,000'), null, 'the way people really type an amount')
  assert.match(checkValue(AMOUNT, '12.5 lakh'), /must be a number/)
})

test('a number can be held between two ends', () => {
  const rule = { column: 'Discount', type: 'number', min: '0', max: '100' }
  assert.equal(checkValue(rule, '50'), null)
  assert.match(checkValue(rule, '-1'), /0 or more/)
  assert.match(checkValue(rule, '101'), /100 or less/)
})

test('zero is a number, and a valid minimum', () => {
  // The falsy trap, twice: `min: '0'` must bind, and the value 0 must pass.
  assert.equal(checkValue(AMOUNT, '0'), null)
  assert.match(checkValue(AMOUNT, '-5'), /0 or more/)
})

test('a whole number can be insisted on', () => {
  const rule = { column: 'Qty', type: 'number', integer: true }
  assert.equal(checkValue(rule, '3'), null)
  assert.match(checkValue(rule, '3.5'), /whole number/)
})

// ---------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------

test('a date has to be one, read in the page’s own order', () => {
  assert.equal(checkValue({ column: 'Due', type: 'date' }, '20/03/2026', 'DMY'), null)
  assert.match(checkValue({ column: 'Due', type: 'date' }, 'next tuesday'), /must be a date/)
})

test('a date can be told not to be in the past', () => {
  const tomorrow = new Date(Date.now() + 86400000)
  const yesterday = new Date(Date.now() - 86400000)
  const fmt = (d) =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  assert.equal(checkValue(DUE, fmt(tomorrow), 'DMY'), null)
  assert.match(checkValue(DUE, fmt(yesterday), 'DMY'), /cannot be in the past/)
})

test('today is neither past nor future', () => {
  const now = new Date()
  const fmt = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`
  assert.equal(checkValue(DUE, fmt, 'DMY'), null)
  assert.equal(checkValue({ column: 'Due', type: 'date', noFuture: true }, fmt, 'DMY'), null)
})

test('a date can be held between two ends', () => {
  const rule = { column: 'Due', type: 'date', min: '2026-01-01', max: '2026-12-31' }
  assert.equal(checkValue(rule, '20/03/2026', 'DMY'), null)
  assert.match(checkValue(rule, '20/03/2025', 'DMY'), /too early/)
  assert.match(checkValue(rule, '20/03/2027', 'DMY'), /too late/)
})

test('the page’s date order decides which day an ambiguous date is', () => {
  // 03/04/2026 is the third of April to a page set to DMY and the fourth
  // of March to one set to MDY. A validator that answered one of those
  // everywhere would refuse the wrong half of the workspace.
  const rule = { column: 'Due', type: 'date', min: '2026-04-01' }
  assert.equal(checkValue(rule, '03/04/2026', 'DMY'), null, 'the 3rd of April is after the 1st')
  assert.match(checkValue(rule, '03/04/2026', 'MDY'), /too early/, 'the 4th of March is before it')
})

// ---------------------------------------------------------------------
// The picker and the sheet
// ---------------------------------------------------------------------

test('a stored date reaches the picker as ISO', () => {
  assert.equal(toDateInput('20/03/2026', 'DMY'), '2026-03-20')
  assert.equal(toDateInput('03/20/2026', 'MDY'), '2026-03-20')
  assert.equal(toDateInput('', 'DMY'), '')
  assert.equal(toDateInput('not a date', 'DMY'), '')
})

test('and comes back in the format the sheet already uses', () => {
  // Writing the browser's ISO string straight through would leave one
  // column holding two formats -- the rows somebody edited and the rows
  // they did not -- and every date filter over it would then be right
  // about half of them.
  assert.equal(fromDateInputValue('2026-03-20', 'DMY'), '20/03/2026')
  assert.equal(fromDateInputValue('2026-03-20', 'MDY'), '03/20/2026')
  assert.equal(fromDateInputValue('2026-03-20', 'YMD'), '2026/03/20')
  assert.equal(fromDateInputValue('', 'DMY'), '', 'clearing a date is still clearing it')
  // ...including when the picker hands back nothing at all rather than an
  // empty string, which is what writes the word "null" into the cell.
  assert.equal(fromDateInputValue(null, 'DMY'), '')
  assert.equal(fromDateInputValue(undefined, 'DMY'), '')
})

test('the two directions are the inverse of each other', () => {
  for (const order of ['DMY', 'MDY', 'YMD']) {
    assert.equal(toDateInput(fromDateInputValue('2026-03-20', order), order), '2026-03-20', order)
  }
})

// ---------------------------------------------------------------------
// The rest of the types
// ---------------------------------------------------------------------

test('an email has to look like one', () => {
  const rule = { column: 'Email', type: 'email' }
  assert.equal(checkValue(rule, 'asha@example.co.in'), null)
  assert.match(checkValue(rule, 'asha@example'), /email address/)
  assert.match(checkValue(rule, 'asha at example.com'), /email address/)
})

test('a phone is counted in digits, however it is written', () => {
  assert.equal(checkValue(PHONE, '+91 98765 43210'), null, 'spaces and a country code are fine')
  assert.equal(checkValue(PHONE, '(022) 2345-6789'), null)
  assert.match(checkValue(PHONE, '98765'), /at least 10 digits/)
  assert.match(checkValue(PHONE, '9876543210987654'), /at most 12 digits/)
})

test('a phone with no rule of its own still has to be a phone', () => {
  assert.match(checkValue({ column: 'Mobile', type: 'phone' }, '12345'), /at least 7 digits/)
})

test('a link has to look like one', () => {
  const rule = { column: 'Link', type: 'url' }
  assert.equal(checkValue(rule, 'https://example.com/a'), null)
  assert.equal(checkValue(rule, 'example.com'), null)
  assert.match(checkValue(rule, 'not a link'), /must be a link/)
})

test('text can be held to a length, and to a pattern', () => {
  const rule = { column: 'Code', type: 'text', minLength: '4', maxLength: '6', pattern: '^[A-Z]+$' }
  assert.equal(checkValue(rule, 'ABCD'), null)
  assert.match(checkValue(rule, 'AB'), /at least 4 characters/)
  assert.match(checkValue(rule, 'ABCDEFG'), /at most 6 characters/)
  assert.match(checkValue(rule, 'abcd'), /right format/)
})

test('a pattern can say what it wants in its own words', () => {
  const rule = { column: 'Code', type: 'text', pattern: '^[A-Z]{2}$', patternNote: 'must be two capitals' }
  assert.equal(checkValue(rule, 'AB'), null)
  assert.equal(checkValue(rule, 'abc'), 'must be two capitals')
})

test('a pattern an admin typed wrong lets everything through, rather than nothing', () => {
  // It is reported in the editor instead. Refusing every value because the
  // rule will not compile would make the column unusable with no visible
  // cause.
  const rule = { column: 'Code', type: 'text', pattern: '([' }
  assert.equal(checkValue(rule, 'anything'), null)
  assert.match(inputRuleProblem(rule, ['Code']), /not valid/)
})

// ---------------------------------------------------------------------
// What is being written
// ---------------------------------------------------------------------

test('only the values being written are judged', () => {
  const w = widget([AMOUNT, PHONE])
  assert.deepEqual(invalidChanges(w, { Amount: '5000', Mobile: '9876543210' }), [])
  assert.deepEqual(invalidChanges(w, { Amount: 'lots' }), [{ column: 'Amount', problem: 'must be a number' }])
  assert.deepEqual(invalidColumns(w, { Amount: 'lots', Mobile: '1' }), ['Amount', 'Mobile'])
  assert.deepEqual(invalidChanges(w, {}), [])
})

test('a column with no rule is never a complaint', () => {
  assert.deepEqual(invalidChanges(widget([AMOUNT]), { Remark: 'anything at all' }), [])
})

test('the refused values are dropped, and the rest of the save goes through', () => {
  const changes = { Amount: 'lots', Remark: 'called' }
  const bad = invalidColumns(widget([AMOUNT]), changes)
  assert.deepEqual(withoutInvalid(changes, bad), { Remark: 'called' })
  assert.deepEqual(withoutInvalid(changes, []), changes)
})

test('the note names the column and what is wrong with it', () => {
  assert.equal(
    invalidNote([
      { column: 'Amount', problem: 'must be a number' },
      { column: 'Mobile', problem: 'must have at least 10 digits' },
    ]),
    'Amount must be a number, Mobile must have at least 10 digits'
  )
  assert.equal(invalidNote([]), '')
  assert.equal(invalidNote(null), '')
})

// ---------------------------------------------------------------------
// What the admin is told
// ---------------------------------------------------------------------

test('a finished rule has nothing wrong with it', () => {
  assert.equal(inputRuleProblem(AMOUNT, ['Amount']), null)
})

test('every way of leaving one unfinished is named', () => {
  assert.match(inputRuleProblem(newInputRule('x'), ['Amount']), /Pick a column/)
  assert.match(inputRuleProblem({ column: 'Gone', type: 'text' }, ['Amount']), /Gone/)
  assert.match(inputRuleProblem({ column: 'A', type: 'number', min: '9', max: '1' }, ['A']), /larger than/)
  assert.match(
    inputRuleProblem({ column: 'A', type: 'date', noPast: true, noFuture: true }, ['A']),
    /only today/
  )
})

test('with no headers loaded yet, the column is not called missing', () => {
  assert.equal(inputRuleProblem({ column: 'Amount', type: 'text' }, []), null)
})

test('the summary says what the field takes, and that empty is still allowed', () => {
  assert.match(describeRule(AMOUNT), /^Number, from 0\./)
  assert.match(describeRule(DUE), /not in the past/)
  assert.match(describeRule(PHONE), /at least 10 digits, at most 12 digits/)
  // Said every time, because the two settings are next door to each other
  // and it is the thing people assume.
  for (const rule of [AMOUNT, DUE, PHONE, newInputRule('x')]) {
    assert.match(describeRule(rule), /use Required to change that/)
  }
})

test('every type offered can be described and drawn', () => {
  for (const { value } of INPUT_TYPES) {
    assert.equal(typeof htmlInputType(value), 'string', value)
    assert.match(describeRule({ column: 'X', type: value }), /empty cell is always allowed/, value)
  }
})

// ---------------------------------------------------------------------
// Wiring: one refusal, and the same box in both places
// ---------------------------------------------------------------------

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const TABLE = read('src/components/widgets/TableWidget.jsx')
const PANEL = read('src/components/RowDetailPanel.jsx')
const ADMIN = read('src/pages/admin/WidgetsPanel.jsx')

test('a value that is not what the column takes is refused where every write is planned', () => {
  const start = TABLE.indexOf('function editPlan(row, changes)')
  const body = TABLE.slice(start, TABLE.indexOf('\n  }\n', start))
  assert.match(body, /const bad = invalidChanges\(widget, allowed, dateOrder\)/)
  assert.match(body, /const wanted = withoutInvalid\(allowed, bad\.map\(\(p\) => p\.column\)\)/)
  assert.match(body, /return \{ also, skipped, bad,/)
})

test('and never in silence', () => {
  const start = TABLE.indexOf('function say(row, also, skipped, kept, bad, lead)')
  const body = TABLE.slice(start, TABLE.indexOf('\n  }\n', start))
  assert.match(body, /if \(bad\.length > 0\) parts\.push\(`Not saved — \$\{invalidNote\(bad\)\}`\)/)
  assert.match(body, /bad\.length > 0,/, 'and it reads as a refusal')
})

test('a drag says the same complaint once, not four hundred times', () => {
  const start = TABLE.indexOf('async function commitFill(')
  const body = TABLE.slice(start, TABLE.indexOf('\n  }\n', start))
  assert.match(body, /for \(const problem of bad\) refused\.set\(problem\.column, problem\)/)
  assert.match(body, /const refused = new Map\(\)/)
})

test('the cell editor and the form offer the same box', () => {
  // Two ideas about what a column takes is how a date picker appears in one
  // place and a text box in the other, on the same column.
  assert.match(TABLE, /type=\{inputTypeFor\(widget, col\)\}/)
  assert.match(PANEL, /const type = canEdit \? inputTypeFor\(widget, col\) : 'text'/)
  assert.match(TABLE, /dateOrder=\{dateOrder\}/)
  // Worked out is not the same as handed over: the box has to be given it,
  // or the form quietly draws a text field on every column again.
  assert.match(
    PANEL,
    /<FormInput\n\s*value=\{value\}\n\s*onChange=\{\(next\) => commit\(col, next\)\}\n\s*placeholder="—"\n\s*type=\{type\}\n\s*dateOrder=\{dateOrder\}/
  )
})

test('a date is converted at the edge of the control, in both of them', () => {
  assert.match(TABLE, /value=\{toDateInput\(text, dateOrder\)\}/)
  assert.match(TABLE, /onCommit\(fromDateInputValue\(e\.target\.value, dateOrder\)\)/)
  assert.match(PANEL, /value=\{toDateInput\(value, dateOrder\)\}/)
  assert.match(PANEL, /onChange\(fromDateInputValue\(e\.target\.value, dateOrder\)\)/)
})

test('the form says what is wrong under the box it is wrong in', () => {
  assert.match(PANEL, /const bad = invalidChanges\(widget, changes, dateOrder\)/)
  assert.match(PANEL, /const badBy = Object\.fromEntries\(bad\.map\(\(p\) => \[p\.column, p\.problem\]\)\)/)
  assert.match(PANEL, /\{col\} \{wrong\}/)
})

test('an admin can reach it, and sees how many columns are configured', () => {
  assert.match(ADMIN, /key: 'fields'/)
  assert.match(ADMIN, /badge: inputRulesOf\(widget\)\.length/)
  assert.match(ADMIN, /part === 'fields' && <InputRulesEditor/)
})

test('changing the type drops the conditions that no longer mean anything', () => {
  // A minimum length left sitting on a date is a rule nobody can see and
  // nothing can satisfy.
  assert.match(
    ADMIN,
    /ops\.update\(rule\.id, \{ \.\.\.newInputRule\(rule\.id\), column: rule\.column, type: v \}\)/
  )
})

test('two rules on one column are reported rather than silently ignored', () => {
  assert.match(ADMIN, /named\.filter\(\(c\) => c === rule\.column\)\.length > 1/)
  assert.match(ADMIN, /only the first one runs/)
})
