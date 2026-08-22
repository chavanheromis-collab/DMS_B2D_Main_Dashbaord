import test from 'node:test'
import assert from 'node:assert/strict'

import { blendRows, fallbackTargetColumn, parseBackupColumn, parseFallbackTarget, sidedColumn } from './blend.js'
import { groupRows } from './dataUtils.js'

const STOCK = [
  { VIN: 'V1', Model: 'SPLENDOR +', 'Default Yard': 'Main Store' },
  { VIN: 'V2', Model: 'HF DELUXE', 'Default Yard': 'Main Store' },
  { VIN: 'V3', Model: 'PASSION +', 'Default Yard': '' },
]

const YARD = [
  { 'Chassis No': 'V1', Location: 'Pune Yard' },
  // V2 matched but its Location cell is empty -- looks identical on screen
  // to no match at all, and must be handled the same way.
  { 'Chassis No': 'V2', Location: '' },
  // V3 has no row here at all.
]

const base = {
  enabled: true,
  ref: 'yard',
  leftKey: 'VIN',
  rightKey: 'Chassis No',
  prefix: 'Yard.',
  columns: ['Location'],
}

const headers = ['Chassis No', 'Location']
const blend = (extra) => blendRows(STOCK, YARD, { ...base, ...extra }, headers)
const locations = (rows) => rows.map((r) => r['Yard.Location'])

test('without a fallback both kinds of gap stay blank', () => {
  assert.deepEqual(locations(blend()), ['Pune Yard', '', ''])
})

test('a fallback fills from a column on the widget’s own tab', () => {
  const out = blend({ fallbacks: [{ column: 'Location', from: 'Default Yard' }] })
  assert.deepEqual(locations(out), ['Pune Yard', 'Main Store', ''])
})

test('the literal catches what the column could not', () => {
  // V3's own Default Yard is empty too, so it falls through to the text.
  const out = blend({ fallbacks: [{ column: 'Location', from: 'Default Yard', text: 'Not allocated' }] })
  assert.deepEqual(locations(out), ['Pune Yard', 'Main Store', 'Not allocated'])
})

test('the literal works on its own, with no column chosen', () => {
  const out = blend({ fallbacks: [{ column: 'Location', text: 'Not allocated' }] })
  assert.deepEqual(locations(out), ['Pune Yard', 'Not allocated', 'Not allocated'])
})

test('a real value is never overwritten', () => {
  const out = blend({ fallbacks: [{ column: 'Location', from: 'Default Yard', text: 'Not allocated' }] })
  assert.equal(out[0]['Yard.Location'], 'Pune Yard')
})

test('a fallback names ONE column and leaves the others alone', () => {
  const withRule = blendRows(
    STOCK,
    [{ 'Chassis No': 'V1', Location: '', Days: '' }],
    { ...base, columns: ['Location', 'Days'], fallbacks: [{ column: 'Location', text: 'X' }] },
    ['Chassis No', 'Location', 'Days']
  )
  assert.equal(withRule[0]['Yard.Location'], 'X')
  assert.equal(withRule[0]['Yard.Days'], '', 'Days had no rule, so it stays blank')
})

test('the match count still tells the truth', () => {
  // A fallback fills the display, but it must not pretend a match happened.
  const out = blend({ fallbacks: [{ column: 'Location', text: 'Not allocated' }] })
  assert.equal(out.find((r) => r.VIN === 'V3')['Yard.Match count'], 0)
  assert.equal(out.find((r) => r.VIN === 'V1')['Yard.Match count'], 1)
})

test('fallbacks reach the expand join too', () => {
  const out = blendRows(
    STOCK,
    [{ 'Chassis No': 'V1', Location: '' }],
    { ...base, type: 'expand', fallbacks: [{ column: 'Location', from: 'Default Yard' }] },
    headers
  )
  assert.equal(out.length, 1)
  assert.equal(out[0]['Yard.Location'], 'Main Store')
})

test('an inner join drops unmatched rows before a fallback can reach them', () => {
  // Worth asserting because it is the one case where a fallback appears not
  // to work -- the row is already gone.
  const out = blendRows(STOCK, YARD, { ...base, type: 'inner', fallbacks: [{ column: 'Location', text: 'X' }] }, headers)
  assert.deepEqual(out.map((r) => r.VIN), ['V1', 'V2'])
  assert.equal(out.find((r) => r.VIN === 'V2')['Yard.Location'], 'X', 'a matched-but-blank cell still falls back')
})

// --- the reason this matters --------------------------------------------

test('without a fallback, a chart silently loses rows', () => {
  const chart = groupRows(blend(), { groupBy: 'Yard.Location', aggregation: 'count' })
  const plotted = chart.reduce((sum, d) => sum + d.value, 0)
  assert.equal(plotted, 1, 'two of three vehicles vanish -- grouping skips blanks')
})

test('with a fallback the chart adds up again', () => {
  const out = blend({ fallbacks: [{ column: 'Location', from: 'Default Yard', text: 'Not allocated' }] })
  const chart = groupRows(out, { groupBy: 'Yard.Location', aggregation: 'count' })
  const plotted = chart.reduce((sum, d) => sum + d.value, 0)
  assert.equal(plotted, STOCK.length)
  assert.deepEqual(
    chart.map((d) => d.name).sort(),
    ['Main Store', 'Not allocated', 'Pune Yard']
  )
})

// --- the backup column can come from either tab --------------------------

// Same three vehicles, but the yard tab carries a second column. A blank
// Location doesn't mean the yard tab knows nothing about the vehicle.
const YARD_WITH_ZONE = [
  { 'Chassis No': 'V1', Location: 'Pune Yard', Zone: 'Zone 1' },
  { 'Chassis No': 'V2', Location: '', Zone: 'Zone 3' },
]

const zoned = (extra) =>
  blendRows(STOCK, YARD_WITH_ZONE, { ...base, ...extra }, ['Chassis No', 'Location', 'Zone'])

test('a backup column can be another column of the blended tab', () => {
  const out = zoned({ fallbacks: [{ column: 'Location', from: sidedColumn('right', 'Zone') }] })
  assert.deepEqual(locations(out), ['Pune Yard', 'Zone 3', ''])
})

test('a right-side backup has nothing to give an unmatched row, so the text catches it', () => {
  // V3 has no row on the yard tab at all -- no cell of any column to borrow.
  const out = zoned({
    fallbacks: [{ column: 'Location', from: sidedColumn('right', 'Zone'), text: 'Not allocated' }],
  })
  assert.deepEqual(locations(out), ['Pune Yard', 'Zone 3', 'Not allocated'])
})

test('the side is what separates two columns sharing a name', () => {
  // Both tabs have a "Location". Without the prefix the rule would be a
  // coin toss; with it, each side picks out the one the admin meant.
  const stock = [{ VIN: 'V1', Location: 'Main Store' }]
  const yard = [{ 'Chassis No': 'V1', Location: '', Zone: 'Zone 7' }]
  const run = (from) =>
    blendRows(stock, yard, { ...base, columns: ['Location'], fallbacks: [{ column: 'Location', from }] }, [
      'Chassis No',
      'Location',
      'Zone',
    ])[0]['Yard.Location']

  assert.equal(run(sidedColumn('left', 'Location')), 'Main Store')
  assert.equal(run(sidedColumn('right', 'Zone')), 'Zone 7')
})

test('a right-side backup collapses several matches the same way the value would', () => {
  const yard = [
    { 'Chassis No': 'V1', Location: '', Zone: 'Zone 1' },
    { 'Chassis No': 'V1', Location: '', Zone: 'Zone 9' },
  ]
  const pick = (multi) =>
    blendRows(
      [{ VIN: 'V1' }],
      yard,
      { ...base, multi, fallbacks: [{ column: 'Location', from: sidedColumn('right', 'Zone') }] },
      ['Chassis No', 'Location', 'Zone']
    )[0]['Yard.Location']

  assert.equal(pick('first'), 'Zone 1')
  assert.equal(pick('last'), 'Zone 9', 'the backup follows the same rule as the column it stands in for')
})

test('a right-side backup reaches the expand join, row by row', () => {
  const out = blendRows(
    [{ VIN: 'V1' }],
    [
      { 'Chassis No': 'V1', Location: '', Zone: 'Zone 1' },
      { 'Chassis No': 'V1', Location: 'Pune Yard', Zone: 'Zone 9' },
    ],
    { ...base, type: 'expand', fallbacks: [{ column: 'Location', from: sidedColumn('right', 'Zone') }] },
    ['Chassis No', 'Location', 'Zone']
  )
  // Each emitted row falls back from its OWN matched row, not from the group.
  assert.deepEqual(locations(out), ['Zone 1', 'Pune Yard'])
})

test('a bare column name still means the main tab', () => {
  // Rules saved before the backup could come from either side.
  assert.deepEqual(parseBackupColumn('Default Yard'), { side: 'left', column: 'Default Yard' })
  assert.deepEqual(parseBackupColumn('left:Default Yard'), { side: 'left', column: 'Default Yard' })
  assert.deepEqual(parseBackupColumn('right:Zone'), { side: 'right', column: 'Zone' })
  assert.equal(parseBackupColumn(''), null)
  assert.equal(parseBackupColumn(undefined), null)
})

test('a column name containing a colon is not mistaken for a side', () => {
  assert.deepEqual(parseBackupColumn('Ref: Yard'), { side: 'left', column: 'Ref: Yard' })
  // ...and the round trip through the picker keeps it addressable.
  assert.deepEqual(parseBackupColumn(sidedColumn('right', 'Ref: Yard')), {
    side: 'right',
    column: 'Ref: Yard',
  })
})

// --- the trigger is a condition, not just "is it blank" ------------------

const LEAD = [
  { VIN: 'V1', Model: 'SPLENDOR +', 'Default Yard': 'Main Store' },
  { VIN: 'V2', Model: 'HF DELUXE', 'Default Yard': 'Overflow' },
  { VIN: 'V3', Model: 'PASSION +', 'Default Yard': 'Main Store' },
]

const AGEING = [
  { 'Chassis No': 'V1', Location: 'Pune Yard', Days: '12' },
  { 'Chassis No': 'V2', Location: 'TBD', Days: '140' },
  { 'Chassis No': 'V3', Location: 'Nashik Yard', Days: '0' },
]

const aged = (fallbacks, extra) =>
  blendRows(LEAD, AGEING, { ...base, columns: ['Location', 'Days'], fallbacks, ...extra }, [
    'Chassis No',
    'Location',
    'Days',
  ])

test('a rule can fire on a placeholder value, not only on a blank', () => {
  // "TBD" is the shape a missing value actually takes in most sheets.
  const out = aged([
    { column: sidedColumn('right', 'Location'), operator: 'equals', value: 'TBD', from: sidedColumn('left', 'Default Yard') },
  ])
  assert.deepEqual(locations(out), ['Pune Yard', 'Overflow', 'Nashik Yard'])
})

test('a numeric check replaces a value that is present but wrong', () => {
  const out = aged([
    { column: sidedColumn('right', 'Days'), operator: 'gt', value: '90', text: 'Over 90 days' },
  ])
  assert.deepEqual(out.map((r) => r['Yard.Days']), ['12', 'Over 90 days', '0'])
})

test('“is not empty” inverts the rule into an override', () => {
  const out = aged([
    { column: sidedColumn('right', 'Location'), operator: 'is_not_empty', text: 'Allocated' },
  ])
  assert.deepEqual(locations(out), ['Allocated', 'Allocated', 'Allocated'])
})

test('a rule that does not fire leaves the value exactly as it was', () => {
  const out = aged([
    { column: sidedColumn('right', 'Location'), operator: 'contains', value: 'zzz', text: 'X' },
  ])
  assert.deepEqual(locations(out), ['Pune Yard', 'TBD', 'Nashik Yard'])
})

test('the default operator is still “is empty”, so old rules behave the same', () => {
  const withOp = aged([{ column: 'Location', operator: 'is_empty', text: 'X' }])
  const without = aged([{ column: 'Location', text: 'X' }])
  assert.deepEqual(locations(withOp), locations(without))
})

test('a rule can target a column of the widget’s OWN tab', () => {
  // The gap is on the main tab and the blended tab is what fills it -- the
  // mirror image of the usual case, and just as common.
  const stock = [
    { VIN: 'V1', 'Default Yard': '' },
    { VIN: 'V2', 'Default Yard': 'Overflow' },
  ]
  const out = blendRows(
    stock,
    AGEING,
    {
      ...base,
      fallbacks: [
        { column: sidedColumn('left', 'Default Yard'), operator: 'is_empty', from: sidedColumn('right', 'Location') },
      ],
    },
    ['Chassis No', 'Location', 'Days']
  )
  assert.deepEqual(out.map((r) => r['Default Yard']), ['Pune Yard', 'Overflow'])
})

test('a backup can read a column that was never brought across', () => {
  // The backup is looked up on the MATCHED ROWS, not on the merged row, so
  // it does not first have to be added to "columns to bring across".
  const out = aged([
    { column: sidedColumn('right', 'Location'), operator: 'equals', value: 'TBD', from: sidedColumn('right', 'Days') },
  ], { columns: ['Location'] })
  assert.deepEqual(locations(out), ['Pune Yard', '140', 'Nashik Yard'])
  assert.equal('Yard.Days' in out[0], false, 'and reading it did not add it to the widget')
})

test('a blend-side backup reads the roll-up, not a half-finished row', () => {
  const out = blendRows(
    [{ VIN: 'V1', Note: '' }],
    [
      { 'Chassis No': 'V1', Location: '', Days: '10' },
      { 'Chassis No': 'V1', Location: '', Days: '30' },
    ],
    {
      ...base,
      rollups: [{ id: 'r1', column: 'Days', aggregation: 'sum', as: 'Total days' }],
      fallbacks: [
        { column: sidedColumn('left', 'Note'), operator: 'is_empty', from: sidedColumn('blend', 'Total days') },
      ],
    },
    ['Chassis No', 'Location', 'Days']
  )
  assert.equal(out[0].Note, 40)
})

test('rules never chain, so the order they were added in cannot matter', () => {
  const rules = [
    { column: sidedColumn('right', 'Location'), operator: 'is_empty', from: sidedColumn('left', 'Default Yard') },
    // Reads Location as the JOIN left it (blank), not as the rule above set it.
    { column: sidedColumn('left', 'Model'), operator: 'is_empty', from: sidedColumn('right', 'Location') },
  ]
  const rows = [{ VIN: 'V1', Model: '', 'Default Yard': 'Main Store' }]
  const right = [{ 'Chassis No': 'V1', Location: '' }]
  const run = (order) => blendRows(rows, right, { ...base, fallbacks: order }, ['Chassis No', 'Location'])[0]

  const a = run(rules)
  const b = run([...rules].reverse())
  assert.equal(a['Yard.Location'], 'Main Store')
  assert.equal(a.Model, '', 'the second rule saw the blank Location, not the filled one')
  assert.deepEqual(b, a)
})

test('a rule naming a column the blend no longer brings across is ignored', () => {
  const out = aged([{ column: sidedColumn('right', 'Deleted Column'), operator: 'is_empty', text: 'X' }])
  assert.deepEqual(locations(out), ['Pune Yard', 'TBD', 'Nashik Yard'])
  assert.equal('Yard.Deleted Column' in out[0], false, 'and it does not invent the column either')
})

test('a date rule is read in the page’s date order', () => {
  const rows = [{ VIN: 'V1' }]
  const right = [{ 'Chassis No': 'V1', Due: '03/12/2025' }]
  const rule = { column: sidedColumn('right', 'Due'), operator: 'date_after', value: '2025-06-01', text: 'Overdue' }
  const run = (order) => blendRows(rows, right, { ...base, columns: ['Due'], fallbacks: [rule] }, ['Chassis No', 'Due'], order)[0]

  assert.equal(run('DMY')['Yard.Due'], 'Overdue', '3 December is after June')
  assert.equal(run('MDY')['Yard.Due'], '03/12/2025', '12 March is not')
})

test('sides round-trip, and each field keeps its own default', () => {
  // The target defaults to the blended tab, the backup to the main one --
  // which is what a bare name meant in each field before sides existed.
  assert.deepEqual(parseFallbackTarget('Location'), { side: 'right', column: 'Location' })
  assert.deepEqual(parseBackupColumn('Default Yard'), { side: 'left', column: 'Default Yard' })
  assert.deepEqual(parseFallbackTarget(sidedColumn('blend', 'Total days')), { side: 'blend', column: 'Total days' })
})

test('a target resolves to the name the widget will actually see', () => {
  const b = { ...base, prefix: 'Yard.' }
  assert.equal(fallbackTargetColumn(b, { column: 'Location' }), 'Yard.Location')
  assert.equal(fallbackTargetColumn(b, { column: sidedColumn('right', 'Location') }), 'Yard.Location')
  assert.equal(fallbackTargetColumn(b, { column: sidedColumn('left', 'Location') }), 'Location')
  assert.equal(fallbackTargetColumn(b, { column: '' }), null)
})
