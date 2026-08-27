import test from 'node:test'
import assert from 'node:assert/strict'

import {
  columnIssues,
  guessType,
  looksDateLike,
  looksNumeric,
  nearDuplicates,
  profileColumn,
  profileData,
} from './columnProfile.js'

// --- the two shape checks, which exist because the app's own parsers are
// --- deliberately forgiving ----------------------------------------------

test('a decorated amount is numeric; an order reference is not', () => {
  // `toNumber` is forgiving on purpose -- it has to turn "₹1,20,000" and
  // "(320)" into figures -- and it does that by discarding everything that
  // is not a digit, which reports "INV-4471" as the number 4471.
  for (const good of ['12', '-4.5', '₹1,20,000', '(320)', '45%', ' 12 ', '1.2e3', '.5']) {
    assert.ok(looksNumeric(good), good)
  }
  for (const bad of ['INV-4471', 'C7', 'n/a', 'Q1 2026', '', 'twelve', '12 units']) {
    assert.ok(!looksNumeric(bad), bad)
  }
})

test('a plain number is not a date, whatever Date.parse thinks', () => {
  // `new Date("109")` is a valid date -- the year 109 -- so every column of
  // small numbers profiles as a date column unless the shape is checked.
  assert.ok(!looksDateLike('109'))
  assert.ok(!looksDateLike('2026'))
  assert.ok(looksDateLike('04/03/2026'))
  assert.ok(looksDateLike('2026-03-04'))
  assert.ok(looksDateLike('12-May-2024'))
  assert.ok(!looksDateLike('hello'))
})

// --- typing --------------------------------------------------------------

test('a column of amounts is a number column', () => {
  assert.equal(guessType(['100', '250', '1,200', '₹90']), 'number')
})

test('a column of dates is a date column', () => {
  assert.equal(guessType(['01/03/2026', '02/03/2026', '2026-04-01']), 'date')
})

test('a handful of repeated values is a category, four hundred unique ones is text', () => {
  const category = Array.from({ length: 200 }, (_, i) => ['Won', 'Lost', 'Open'][i % 3])
  assert.equal(guessType(category), 'category')

  const free = Array.from({ length: 200 }, (_, i) => `remark number ${i}`)
  assert.equal(guessType(free), 'text')
})

test('an empty column is empty, not text', () => {
  assert.equal(guessType(['', '  ', null, undefined]), 'empty')
})

// --- the finding that no other widget can surface ------------------------

test('values differing only by case or spacing are found and grouped', () => {
  // The single most common defect in a hand-typed sheet, and invisible
  // everywhere else: three bars in every chart, one thing in reality.
  const groups = nearDuplicates(['Delivered', 'delivered', 'Delivered ', 'Pending'])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].variants.length, 3)
  assert.ok(groups[0].variants.includes('delivered'))
})

test('genuinely different values are not merged', () => {
  assert.equal(nearDuplicates(['Won', 'Lost', 'Open']).length, 0)
})

// --- one column ----------------------------------------------------------

test('a fill rate is what it says', () => {
  const rows = [{ A: 'x' }, { A: '' }, { A: 'y' }, { A: null }]
  const p = profileColumn(rows, 'A')
  assert.equal(p.total, 4)
  assert.equal(p.filled, 2)
  assert.equal(p.blanks, 2)
  assert.equal(p.fillRate, 50)
})

test('a numeric column reports the numbers, and the cells that are not numbers', () => {
  const rows = [{ V: '10' }, { V: '20' }, { V: '30' }, { V: 'n/a' }, { V: '40' }]
  const p = profileColumn(rows, 'V')
  assert.equal(p.type, 'number')
  assert.equal(p.min, 10)
  assert.equal(p.max, 40)
  assert.equal(p.unparsed, 1, '"n/a" is a data-quality finding, not the number zero')
})

test('a date column reports its span and how stale it is', () => {
  const old = new Date(Date.now() - 200 * 86400000)
  const rows = [
    { D: `01/01/2020` },
    { D: `${old.getDate()}/${old.getMonth() + 1}/${old.getFullYear()}` },
  ]
  const p = profileColumn(rows, 'D')
  assert.equal(p.type, 'date')
  assert.ok(p.staleDays > 150, 'a column that stopped being filled in is a column every number is wrong about')
  assert.equal(p.earliest.getFullYear(), 2020)
})

test('the commonest values are the commonest values', () => {
  const rows = [...Array(5).fill({ S: 'Won' }), ...Array(3).fill({ S: 'Lost' }), { S: 'Open' }]
  const p = profileColumn(rows, 'S', { topValues: 2 })
  assert.equal(p.top.length, 2)
  assert.equal(p.top[0].value, 'Won')
  assert.equal(p.top[0].count, 5)
  assert.equal(Math.round(p.top[0].share), 56, 'as a share of the filled rows')
})

// --- the findings --------------------------------------------------------

test('an issue is a sentence, not a percentage', () => {
  const sparse = columnIssues({ total: 100, filled: 30, fillRate: 30, distinct: 5 })
  assert.ok(sparse.some((i) => i.key === 'sparse' && i.severity === 'high'))

  const clean = columnIssues({ total: 100, filled: 100, fillRate: 100, distinct: 9 })
  assert.equal(clean.length, 0)
})

test('a completely empty column is one finding, not five', () => {
  const issues = columnIssues({ total: 10, filled: 0, fillRate: 0, distinct: 0 })
  assert.equal(issues.length, 1)
  assert.equal(issues[0].key, 'empty')
})

test('a column where every row says the same thing is worth mentioning', () => {
  const issues = columnIssues({ total: 10, filled: 10, fillRate: 100, distinct: 1 })
  assert.ok(issues.some((i) => i.key === 'constant'))
})

test('the warning threshold is the admin’s, not a constant', () => {
  const strict = columnIssues({ total: 100, filled: 95, fillRate: 95, distinct: 4 }, { fillWarning: 99 })
  assert.ok(strict.some((i) => i.key === 'gaps'))

  const relaxed = columnIssues({ total: 100, filled: 95, fillRate: 95, distinct: 4 }, { fillWarning: 90 })
  assert.equal(relaxed.length, 0)
})

// --- the widget ----------------------------------------------------------

const sheet = [
  { Name: 'A', Status: 'Won', Amount: '10', Note: '' },
  { Name: 'B', Status: 'won', Amount: '20', Note: '' },
  { Name: 'C', Status: 'Won', Amount: 'oops', Note: 'x' },
]
const headers = ['Name', 'Status', 'Amount', 'Note']

test('no columns picked means every column', () => {
  const data = profileData({ columns: [] }, { rows: sheet, headers })
  assert.equal(data.profiles.length, 4)
})

test('a column that is not on the tab is ignored rather than profiled as empty', () => {
  const data = profileData({ columns: ['Status', 'Ghost'] }, { rows: sheet, headers })
  assert.equal(data.profiles.length, 1)
  assert.equal(data.profiles[0].column, 'Status')
})

test('“problems only” hides the clean columns and says how many it hid', () => {
  const all = profileData({ problemsOnly: false }, { rows: sheet, headers })
  const only = profileData({ problemsOnly: true }, { rows: sheet, headers })

  assert.ok(only.profiles.length < all.profiles.length)
  assert.equal(only.hiddenClean, all.profiles.length - only.profiles.length)
  assert.ok(only.profiles.every((p) => p.issues.length > 0))
})

test('the header verdict counts the whole sheet, not just what is shown', () => {
  const data = profileData({ problemsOnly: true }, { rows: sheet, headers })
  assert.equal(data.columnCount, 4)
  assert.ok(data.problemColumns >= 2, 'Status has a casing clash, Note is mostly blank')
})

test('emptiest first puts the emptiest first', () => {
  const data = profileData({ sort: 'fill_asc' }, { rows: sheet, headers })
  const rates = data.profiles.map((p) => p.fillRate)
  assert.deepEqual(rates, [...rates].sort((a, b) => a - b))
})
