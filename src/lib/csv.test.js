import test from 'node:test'
import assert from 'node:assert/strict'

import { columnsOfRows, csvField, csvFileName, toCsv } from './csv.js'

// --- one field at a time -------------------------------------------------

test('an ordinary value is not quoted', () => {
  assert.equal(csvField('SPLENDOR'), 'SPLENDOR')
  assert.equal(csvField(1284), '1284')
  assert.equal(csvField(0), '0', 'and zero is a value, not an absence')
})

test('nothing is nothing', () => {
  assert.equal(csvField(null), '')
  assert.equal(csvField(undefined), '')
  assert.equal(csvField(''), '')
})

test('a value that could break the file is quoted', () => {
  assert.equal(csvField('Pune, Maharashtra'), '"Pune, Maharashtra"')
  assert.equal(csvField('line one\nline two'), '"line one\nline two"')
  assert.equal(csvField('carriage\rreturn'), '"carriage\rreturn"')
})

test('a quote inside a value is doubled, not escaped with a backslash', () => {
  // The one rule everybody gets wrong, and the one that silently corrupts
  // every row after it when it is wrong.
  assert.equal(csvField('He said "no"'), '"He said ""no"""')
})

test('surrounding space is preserved by quoting it', () => {
  // Trimming here would be a data change. Quoting keeps the space AND stops
  // a reader from trimming it on the way back in.
  assert.equal(csvField(' leading'), '" leading"')
  assert.equal(csvField('trailing '), '"trailing "')
  assert.equal(csvField('inner space'), 'inner space', 'but a space in the middle is harmless')
})

test('the delimiter is what decides, so a semicolon file quotes semicolons', () => {
  assert.equal(csvField('a;b', ';'), '"a;b"')
  assert.equal(csvField('a,b', ';'), '"a,b"', 'and a comma still ends up quoted by the generic rule')
})

// --- a whole document ----------------------------------------------------

const ROWS = [
  { VIN: 'V1', Model: 'SPLENDOR +', Amount: 70000 },
  { VIN: 'V2', Model: 'HF, DELUXE', Amount: 60000 },
]

test('rows and columns become a document', () => {
  assert.equal(
    toCsv(ROWS, ['VIN', 'Model', 'Amount']),
    'VIN,Model,Amount\r\nV1,SPLENDOR +,70000\r\nV2,"HF, DELUXE",60000'
  )
})

test('lines end CRLF, because that is what a spreadsheet expects', () => {
  assert.equal(toCsv(ROWS, ['VIN']).includes('\r\n'), true)
  assert.equal(toCsv(ROWS, ['VIN']).split('\r\n').length, 3)
})

test('the columns asked for are the columns written, in that order', () => {
  assert.equal(toCsv(ROWS, ['Amount', 'VIN']), 'Amount,VIN\r\n70000,V1\r\n60000,V2')
})

test('a column no row has still gets its blank cell', () => {
  // The header and the row must line up whatever the data does, or every
  // column after the gap is off by one.
  assert.equal(toCsv([{ A: 1 }], ['A', 'Missing', 'B']), 'A,Missing,B\r\n1,,')
})

test('the header can be left off', () => {
  assert.equal(toCsv(ROWS, ['VIN'], { header: false }), 'V1\r\nV2')
})

test('no columns means no file, rather than a file of nothing', () => {
  assert.equal(toCsv(ROWS, []), '')
  assert.equal(toCsv(ROWS, null), '')
})

test('no rows still writes the header', () => {
  // An empty export is a legitimate answer -- "nothing matched" -- and it
  // should still say what it was looking for.
  assert.equal(toCsv([], ['VIN', 'Model']), 'VIN,Model')
})

// --- working out the columns --------------------------------------------

test('columns come from the rows, in the order they first appear', () => {
  assert.deepEqual(columnsOfRows([{ B: 1, A: 2 }, { C: 3 }]), ['B', 'A', 'C'])
})

test('the sheet row number is not data', () => {
  assert.deepEqual(columnsOfRows([{ _row: 4, VIN: 'V1' }]), ['VIN'])
})

test('ragged rows still contribute their own columns', () => {
  assert.deepEqual(columnsOfRows([{ A: 1 }, { A: 1, B: 2 }, {}]), ['A', 'B'])
  assert.deepEqual(columnsOfRows([]), [])
  assert.deepEqual(columnsOfRows(null), [])
})

// --- the name on the file ------------------------------------------------

const at = new Date(2026, 7, 24) // 24 Aug 2026, local time

test('a file is named after the widget and dated', () => {
  assert.equal(csvFileName('Stock ageing', at), 'Stock-ageing_2026-08-24.csv')
})

test('nothing that would upset a filesystem survives', () => {
  assert.equal(csvFileName('MASTER / Premia: Sales*', at), 'MASTER-Premia-Sales_2026-08-24.csv')
  assert.equal(csvFileName('  ', at), 'export_2026-08-24.csv')
  assert.equal(csvFileName(undefined, at), 'export_2026-08-24.csv')
})

test('a very long title is cut, not carried', () => {
  const name = csvFileName('x'.repeat(200), at)
  assert.ok(name.length < 80)
  assert.ok(name.endsWith('_2026-08-24.csv'))
})

test('the month and day are padded, so files sort by name', () => {
  assert.equal(csvFileName('a', new Date(2026, 0, 5)), 'a_2026-01-05.csv')
})
