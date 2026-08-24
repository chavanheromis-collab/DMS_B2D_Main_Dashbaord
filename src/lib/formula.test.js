import test from 'node:test'
import assert from 'node:assert/strict'

import { aggregateKeys, buildAggregates, evaluateFormula, formulaColumns, parseFormula } from './formula.js'
import { applyComputed, compileComputed, computedHeaders, previewComputed } from './computed.js'

const HEADERS = ['Sale', 'Cost', 'Status', 'Branch', 'Invoice Date', 'Model']
const ROWS = [
  { Sale: '100000', Cost: '80000', Status: 'Delivered', Branch: 'Pune', 'Invoice Date': '01/05/2024', Model: 'X' },
  { Sale: '50,000', Cost: '45000', Status: 'Booked', Branch: 'Pune', 'Invoice Date': '', Model: 'Y' },
  { Sale: '200000', Cost: '150000', Status: 'delivered', Branch: 'Nashik', 'Invoice Date': '10/05/2024', Model: 'X' },
]

const run = (formula, row = ROWS[0], rows = ROWS) => {
  const { ast, error } = parseFormula(formula)
  assert.equal(error, undefined, `${formula} -> ${error}`)
  const aggregates = buildAggregates(rows, aggregateKeys(ast))
  return evaluateFormula(ast, row, { dateOrder: 'DMY', aggregates, today: new Date(2024, 4, 20) })
}

// --- the basics -----------------------------------------------------------

test('arithmetic on two columns', () => {
  assert.equal(run('[Sale] - [Cost]'), 20000)
  assert.equal(run('[Sale] * 2'), 200000)
  assert.equal(run('([Sale] - [Cost]) / [Sale] * 100'), 20)
})

test('a number written the way a sheet writes it still adds up', () => {
  // "50,000" is a string with a comma in it, which is what Sheets sends.
  assert.equal(run('[Sale] - [Cost]', ROWS[1]), 5000)
})

test('a bare word is a column, so the easy formula stays easy', () => {
  assert.equal(run('Sale - Cost'), 20000)
})

test('brackets are what allow a column with a space or a bracket in its name', () => {
  const row = { 'Sale Price (ex GST)': '90' }
  assert.equal(run('[Sale Price (ex GST)] + 10', row, [row]), 100)
})

test('dividing by zero is blank, not infinity', () => {
  assert.equal(run('[Sale] / 0'), null)
  assert.equal(run('DIVIDE([Sale], 0, "n/a")'), 'n/a')
})

test('arithmetic on something that is not a number is blank', () => {
  assert.equal(run('[Status] * 2'), null)
})

// --- logic ----------------------------------------------------------------

test('IF, and a comparison that does not care about case', () => {
  assert.equal(run('IF([Status] = "delivered", "Done", "Pending")'), 'Done')
  assert.equal(run('IF([Status] = "Delivered", "Done", "Pending")', ROWS[1]), 'Pending')
})

test('IFS reads as a list of rules with a fallback', () => {
  const f = 'IFS([Sale] > 150000, "Large", [Sale] > 75000, "Medium", "Small")'
  assert.equal(run(f, ROWS[0]), 'Medium')
  assert.equal(run(f, ROWS[1]), 'Small')
  assert.equal(run(f, ROWS[2]), 'Large')
})

test('AND, OR and NOT', () => {
  assert.equal(run('AND([Sale] > 1, [Cost] > 1)'), true)
  assert.equal(run('[Sale] > 1 AND [Cost] > 999999'), false)
  assert.equal(run('[Sale] > 999999 OR [Cost] > 1'), true)
  assert.equal(run('NOT(ISBLANK([Status]))'), true)
})

test('a blank cell is blank however it arrives', () => {
  assert.equal(run('ISBLANK([Invoice Date])', ROWS[1]), true)
  assert.equal(run('ISBLANK([Invoice Date])', ROWS[0]), false)
  assert.equal(run('COALESCE([Invoice Date], "not invoiced")', ROWS[1]), 'not invoiced')
})

// --- text and dates -------------------------------------------------------

test('text joins with & or CONCAT', () => {
  assert.equal(run('[Branch] & " · " & [Model]'), 'Pune · X')
  assert.equal(run('CONCAT([Branch], "-", [Model])'), 'Pune-X')
  assert.equal(run('UPPER([Branch])'), 'PUNE')
  assert.equal(run('LEFT([Branch], 2)'), 'Pu')
  assert.equal(run('CONTAINS([Status], "deliver")'), true)
})

test('age in days, from today', () => {
  assert.equal(run('DAYSSINCE([Invoice Date])'), 19)
  assert.equal(run('DAYSSINCE([Invoice Date])', ROWS[1]), null, 'no date, no age')
  assert.equal(run('DAYSBETWEEN([Invoice Date], "20/05/2024")'), 19)
})

test('the parts of a date', () => {
  assert.equal(run('YEAR([Invoice Date])'), 2024)
  assert.equal(run('MONTH([Invoice Date])'), 5)
  assert.equal(run('MONTHNAME([Invoice Date])'), 'May')
})

// --- the whole table ------------------------------------------------------

test('a whole-table total is the same number on every row', () => {
  assert.equal(run('TOTAL([Sale])'), 350000)
  assert.equal(run('TOTAL([Sale])', ROWS[2]), 350000)
  assert.equal(run('COUNTROWS()'), 3)
})

test('this row’s share of the table', () => {
  assert.equal(Math.round(run('PERCENTOF([Sale])')), 29)
  assert.equal(Math.round(run('PERCENTOF([Sale])', ROWS[2])), 57)
})

test('rank is dense and largest-first, so ties share a place', () => {
  assert.equal(run('RANK([Sale])', ROWS[2]), 1)
  assert.equal(run('RANK([Sale])', ROWS[0]), 2)
  assert.equal(run('RANK([Sale])', ROWS[1]), 3)

  const tied = [{ V: '10' }, { V: '10' }, { V: '5' }]
  assert.equal(run('RANK([V])', tied[0], tied), 1)
  assert.equal(run('RANK([V])', tied[1], tied), 1)
  assert.equal(run('RANK([V])', tied[2], tied), 2, 'the next distinct value is second, not third')
})

// --- within a group -------------------------------------------------------

test('a total within this row’s own group', () => {
  assert.equal(run('TOTALBY([Sale], [Branch])'), 150000, 'Pune')
  assert.equal(run('TOTALBY([Sale], [Branch])', ROWS[2]), 200000, 'Nashik')
  assert.equal(run('COUNTBY([Branch])'), 2)
})

test('share of, and rank within, the group', () => {
  assert.equal(Math.round(run('SHAREOF([Sale], [Branch])')), 67)
  assert.equal(run('RANKBY([Sale], [Branch])'), 1, 'the bigger of the two Pune rows')
  assert.equal(run('RANKBY([Sale], [Branch])', ROWS[1]), 2)
})

test('a group is matched the way a person means it', () => {
  const rows = [{ B: 'Pune', V: '1' }, { B: ' pune ', V: '2' }]
  assert.equal(run('COUNTBY([B])', rows[0], rows), 2, 'case and spaces are not different branches')
})

// --- what a broken formula does ------------------------------------------

test('a formula that cannot be read explains itself', () => {
  assert.match(parseFormula('[Sale] +').error, /ends too early/)
  assert.match(parseFormula('[Sale').error, /closing bracket/)
  assert.match(parseFormula('"abc').error, /closing "/)
  assert.match(parseFormula('NOSUCHFN([Sale])').error, /no function called NOSUCHFN/)
  assert.match(parseFormula('ROUND()').error, /takes 1 to 2 arguments/)
  assert.match(parseFormula('[Sale] [Cost]').error, /Unexpected/)
  assert.match(parseFormula('').error, /Empty/)
})

test('a formula never throws, whatever the row holds', () => {
  const nasty = { Sale: undefined, Cost: null, Status: {} }
  assert.doesNotThrow(() => run('[Sale] / [Cost] + LEN([Status])', nasty, [nasty]))
})

// --- what a formula depends on -------------------------------------------

test('the columns a formula reads can be listed', () => {
  const { ast } = parseFormula('IF([Status] = "x", [Sale] - [Cost], TOTAL([Sale]))')
  assert.deepEqual([...formulaColumns(ast)].sort(), ['Cost', 'Sale', 'Status'])
})

test('aggregates are collected once, not per row', () => {
  const { ast } = parseFormula('TOTAL([Sale]) + TOTAL([Cost])')
  assert.deepEqual(aggregateKeys(ast).map((a) => a.key), ['TOTAL(Sale)', 'TOTAL(Cost)'])
})

// --- attaching them to a tab ---------------------------------------------

test('a calculated column becomes an ordinary column of the tab', () => {
  const defs = [{ id: 'a', name: 'Margin', formula: '[Sale] - [Cost]' }]
  assert.deepEqual(computedHeaders(HEADERS, defs), [...HEADERS, 'Margin'])

  const rows = applyComputed(ROWS, defs, { headers: HEADERS })
  assert.deepEqual(rows.map((r) => r.Margin), [20000, 5000, 50000])
  assert.equal(ROWS[0].Margin, undefined, 'the fetched rows are left alone')
})

test('one calculated column can be built from another', () => {
  // Which is what keeps a complicated calculation readable instead of one
  // enormous formula.
  const defs = [
    { id: 'b', name: 'Margin %', formula: 'ROUND([Margin] / [Sale] * 100, 1)' },
    { id: 'a', name: 'Margin', formula: '[Sale] - [Cost]' },
  ]
  const rows = applyComputed(ROWS, defs, { headers: HEADERS })
  assert.deepEqual(rows.map((r) => r['Margin %']), [20, 10, 25])
})

test('two columns that need each other are reported, not looped over', () => {
  const defs = [
    { id: 'a', name: 'A', formula: '[B] + 1' },
    { id: 'b', name: 'B', formula: '[A] + 1' },
  ]
  const { columns, errors } = compileComputed(defs, HEADERS)
  assert.equal(columns.length, 0)
  assert.match(errors[0].error, /refers back to itself/)
})

test('a formula naming a column that does not exist says which one', () => {
  const { errors } = compileComputed([{ id: 'a', name: 'X', formula: '[Nope] + 1' }], HEADERS)
  assert.match(errors[0].error, /No column called “Nope”/)
})

test('a calculated column cannot quietly replace a real one', () => {
  const { columns, errors } = compileComputed([{ id: 'a', name: 'Sale', formula: '1' }], HEADERS)
  assert.equal(columns.length, 0)
  assert.match(errors[0].error, /already has a column/)
})

test('no calculated columns costs nothing at all', () => {
  // The same array back, not a copy of forty thousand rows.
  assert.equal(applyComputed(ROWS, [], { headers: HEADERS }), ROWS)
  assert.equal(applyComputed(ROWS, undefined, { headers: HEADERS }), ROWS)
})

test('an aggregate can be measured over a calculated column', () => {
  const defs = [
    { id: 'a', name: 'Margin', formula: '[Sale] - [Cost]' },
    { id: 'b', name: 'Margin share', formula: 'ROUND(PERCENTOF([Margin]), 0)' },
  ]
  const rows = applyComputed(ROWS, defs, { headers: HEADERS })
  // 20000 + 5000 + 50000 = 75000
  assert.deepEqual(rows.map((r) => r['Margin share']), [27, 7, 67])
})

test('the preview uses the same code the dashboard does', () => {
  // A second implementation would eventually disagree with the real one,
  // and the disagreement would be found by somebody trusting the wrong one.
  const defs = [{ id: 'a', name: 'Margin', formula: '[Sale] - [Cost]' }]
  const { rows, columns, errors } = previewComputed(ROWS, defs, { headers: HEADERS, limit: 2 })
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => r.Margin), [20000, 5000])
  assert.deepEqual(columns.map((c) => c.name), ['Margin'])
  assert.deepEqual(errors, [])
})

test('a broken formula is reported, and the good ones still work', () => {
  const defs = [
    { id: 'a', name: 'Good', formula: '[Sale] * 2' },
    { id: 'b', name: 'Bad', formula: '[Sale] +' },
  ]
  const rows = applyComputed(ROWS, defs, { headers: HEADERS })
  assert.equal(rows[0].Good, 200000)
  assert.equal(rows[0].Bad, undefined, 'a formula that cannot be read adds no column at all')
  assert.equal(compileComputed(defs, HEADERS).errors.length, 1)
})
