import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { blendRows, blendedHeaders, normalizeKey } from './blend.js'
import { TAB_LABEL_SEP, buildLabelMap, mapTabFields, makeRef, parseRef, qualifyLegacyRefs, refLabel, tabLabel } from './refs.js'

const left = [
  { _row: 2, 'Order #': 'SO-1001', Customer: 'Acme' },
  { _row: 3, 'Order #': ' so-1002 ', Customer: 'Globex' },
  { _row: 4, 'Order #': 'SO-9999', Customer: 'Nobody' },
]

const right = [
  { _row: 2, 'Order No': 'SO-1001', Amount: '1,200', Status: 'Sent' },
  { _row: 3, 'Order No': 'SO-1001', Amount: '800', Status: 'Won' },
  { _row: 4, 'Order No': 'SO-1002', Amount: '500', Status: 'Draft' },
]

const rightHeaders = ['Order No', 'Amount', 'Status']

const base = {
  enabled: true,
  ref: 'src_b::Quotations',
  leftKey: 'Order #',
  rightKey: 'Order No',
  prefix: 'Q.',
}

test('left join keeps unmatched rows with blank blended columns', () => {
  const out = blendRows(left, right, { ...base, type: 'left' }, rightHeaders)

  assert.equal(out.length, 3)
  assert.equal(out[2].Customer, 'Nobody')
  assert.equal(out[2]['Q.Amount'], '')
  assert.equal(out[2]['Q.Match count'], 0)
})

test('inner join drops unmatched rows', () => {
  const out = blendRows(left, right, { ...base, type: 'inner' }, rightHeaders)
  assert.deepEqual(out.map((r) => r.Customer), ['Acme', 'Globex'])
})

test('expand emits one row per match and preserves the left sheet row number', () => {
  const out = blendRows(left, right, { ...base, type: 'expand' }, rightHeaders)

  assert.equal(out.length, 3) // Acme matches twice, Globex once, Nobody dropped
  const acme = out.filter((r) => r.Customer === 'Acme')
  assert.equal(acme.length, 2)
  // Editing a blended table must still write to the LEFT row, never the
  // right tab's row number.
  assert.ok(acme.every((r) => r._row === 2))
  assert.deepEqual(acme.map((r) => r['Q.Status']), ['Sent', 'Won'])
})

test('keys match despite case, padding and number formatting', () => {
  const out = blendRows(left, right, { ...base, type: 'inner' }, rightHeaders)
  // " so-1002 " on the left vs "SO-1002" on the right.
  assert.equal(out[1]['Q.Amount'], '500')

  assert.equal(normalizeKey('1,001'), normalizeKey('1001'))
  assert.equal(normalizeKey(' Ab '), normalizeKey('ab'))
  assert.equal(normalizeKey('  '), null)
})

test('multi strategies collapse several matches', () => {
  const sum = blendRows(left, right, { ...base, type: 'inner', multi: 'sum' }, rightHeaders)
  assert.equal(sum[0]['Q.Amount'], 2000)

  const concat = blendRows(left, right, { ...base, type: 'inner', multi: 'concat' }, rightHeaders)
  assert.equal(concat[0]['Q.Status'], 'Sent, Won')

  const last = blendRows(left, right, { ...base, type: 'inner', multi: 'last' }, rightHeaders)
  assert.equal(last[0]['Q.Status'], 'Won')
})

test('roll-ups summarise the matched rows under their own name', () => {
  const blend = {
    ...base,
    type: 'inner',
    rollups: [{ id: 'r1', column: 'Amount', aggregation: 'sum', as: 'Total quoted' }],
  }
  const out = blendRows(left, right, blend, rightHeaders)
  assert.equal(out[0]['Total quoted'], 2000)
})

test('a disabled or half-configured blend passes rows through untouched', () => {
  assert.equal(blendRows(left, right, { ...base, enabled: false }, rightHeaders), left)
  assert.equal(blendRows(left, right, { ...base, rightKey: '' }, rightHeaders), left)
})

test('blendedHeaders exposes the incoming columns for the admin pickers', () => {
  const headers = blendedHeaders(['Order #', 'Customer'], rightHeaders, base)
  assert.ok(headers.includes('Q.Amount'))
  assert.ok(headers.includes('Q.Match count'))
  assert.ok(headers.includes('Order #'))
})

// --- refs ---------------------------------------------------------------

test('refs round-trip, including tab names containing a colon', () => {
  assert.deepEqual(parseRef(makeRef('src_a', 'MASTER')), { sourceId: 'src_a', tab: 'MASTER' })
  assert.deepEqual(parseRef('src_a::Q1::Q2'), { sourceId: 'src_a', tab: 'Q1::Q2' })
  assert.deepEqual(parseRef('MASTER'), { sourceId: '', tab: 'MASTER' })
})

test('a tab is always named by its sheet first: "Sheet · Tab"', () => {
  const sources = [
    { id: 'src_a', name: 'Premia Sales' },
    { id: 'src_b', name: 'Hero CRM' },
    { id: 'src_f', name: 'FIFO' },
  ]
  const labels = buildLabelMap(['src_a::MASTER', 'src_a::Quotations', 'src_b::MASTER', 'src_f::Master'], sources)

  // Even when only one sheet has the tab: "Quotations" alone does not say
  // which sheet it came from.
  assert.equal(labels['src_a::Quotations'], 'Premia Sales · Quotations')
  assert.equal(labels['src_a::MASTER'], 'Premia Sales · MASTER')
  assert.equal(labels['src_b::MASTER'], 'Hero CRM · MASTER')
  assert.equal(labels['src_f::Master'], 'FIFO · Master')
  // Labels double as row-map keys, so they must be unique.
  assert.equal(new Set(Object.values(labels)).size, 4)
  assert.equal(TAB_LABEL_SEP, ' · ')
})

test('two sheets with the same name and tab still get two labels', () => {
  const sources = [
    { id: 'src_one1', name: 'FIFO' },
    { id: 'src_two2', name: 'FIFO' },
  ]
  const labels = buildLabelMap(['src_one1::Master', 'src_two2::Master'], sources)
  assert.equal(labels['src_one1::Master'], 'FIFO · Master')
  assert.equal(labels['src_two2::Master'], 'FIFO · Master (two2)')
})

test('a sheet with no name leaves the tab as it is, and one ref is named the same way', () => {
  assert.equal(tabLabel('', 'Master'), 'Master')
  assert.equal(tabLabel(undefined, 'Master'), 'Master')
  assert.equal(tabLabel('  FIFO  ', 'Master'), 'FIFO · Master')
  assert.equal(buildLabelMap(['src_gone::Master'], [])['src_gone::Master'], 'Master')
  assert.equal(refLabel('src_f::Master', [{ id: 'src_f', name: 'FIFO' }]), 'FIFO · Master')
  assert.equal(refLabel('src_f::Master'), 'Master')
  assert.equal(refLabel(''), '')
})

test('every screen falls back to the same "Sheet · Tab" name', () => {
  const read = (p) => fs.readFileSync(path.join(import.meta.dirname, '..', p), 'utf8').replace(/\s+/g, ' ')
  assert.ok(read('pages/Dashboard.jsx').includes('(ref) => labelByRef[ref] || refLabel(ref, sources) || ref'))
  assert.ok(read('pages/Admin.jsx').includes('() => (ref) => labelByRef[ref] || refLabel(ref, sources)'))
  // A blend's default prefix is the TAB, which a label no longer starts with.
  const blend = read('pages/admin/BlendEditor.jsx')
  assert.ok(blend.includes('prefix: blend.prefix || `${refTab(ref)}.`'))
  assert.ok(!blend.includes("split(' · ')"))
})

test('mapTabFields rewrites every nested tab field without mutating the input', () => {
  const layout = {
    widgets: [
      { id: 'w1', tab: 'MASTER', secondaryTab: 'Quotations', conditions: [{ tab: 'MASTER', column: 'X' }] },
      { id: 'w2', stages: [{ tab: 'Quotations', conditions: [{ tab: 'Quotations' }] }] },
    ],
  }
  const out = mapTabFields(layout, (t) => `src_a::${t}`)

  assert.equal(out.widgets[0].tab, 'src_a::MASTER')
  assert.equal(out.widgets[0].secondaryTab, 'src_a::Quotations')
  assert.equal(out.widgets[0].conditions[0].tab, 'src_a::MASTER')
  assert.equal(out.widgets[1].stages[0].conditions[0].tab, 'src_a::Quotations')
  assert.equal(layout.widgets[0].tab, 'MASTER', 'input must not be mutated')
})

test('qualifying legacy refs is idempotent', () => {
  const once = qualifyLegacyRefs({ tab: 'MASTER' }, 'src_a')
  const twice = qualifyLegacyRefs(once, 'src_a')
  assert.equal(twice.tab, 'src_a::MASTER')
})
