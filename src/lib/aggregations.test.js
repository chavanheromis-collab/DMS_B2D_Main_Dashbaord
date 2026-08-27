import test from 'node:test'
import assert from 'node:assert/strict'

import { aggregate, formatBytes, formatDuration, formatNumber, percentile } from './dataUtils.js'
import { AGGREGATIONS, DISTRIBUTION_AGGS, NUMBER_FORMATS, aggNeedsColumn } from './config.js'

const rows = (values, key = 'V') => values.map((v, i) => ({ _row: i + 2, [key]: v === null ? '' : String(v) }))

// --- the distribution measures ------------------------------------------

test('a percentile interpolates rather than jumping between observations', () => {
  // Nearest-rank makes a p90 leap as one row is added, which reads as noise
  // on a dashboard. Interpolation moves smoothly.
  assert.equal(percentile([1, 2, 3, 4], 50), 2.5)
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3)
  assert.equal(percentile([10, 20], 25), 12.5)
  assert.equal(percentile([7], 90), 7, 'one value is every percentile')
  assert.equal(percentile([], 50), 0)
})

test('the median is the middle row, and survives one enormous deal', () => {
  // The whole reason this exists. One fleet order drags the average
  // somewhere no invoice has ever been; the median does not move.
  const ordinary = rows([10, 20, 30, 40, 50])
  const withOutlier = rows([10, 20, 30, 40, 5000])

  assert.equal(aggregate(ordinary, 'V', 'median'), 30)
  assert.equal(aggregate(withOutlier, 'V', 'median'), 30, 'unchanged')
  assert.equal(aggregate(withOutlier, 'V', 'avg'), 1020, 'where the average has gone')
})

test('the quartiles and the tail', () => {
  const list = rows(Array.from({ length: 100 }, (_, i) => i + 1))
  assert.equal(aggregate(list, 'V', 'p25'), 25.75)
  assert.equal(aggregate(list, 'V', 'p75'), 75.25)
  assert.equal(aggregate(list, 'V', 'p90').toFixed(1), '90.1', 'interpolated between the 90th and 91st values')
  assert.equal(aggregate(list, 'V', 'p99').toFixed(2), '99.01')
  assert.equal(aggregate(list, 'V', 'iqr').toFixed(1), '49.5')
  assert.equal(aggregate(list, 'V', 'range'), 99)
})

test('the spread measures agree with each other', () => {
  const list = rows([2, 4, 4, 4, 5, 5, 7, 9])
  assert.equal(aggregate(list, 'V', 'stddev'), 2, 'the textbook population example')
  assert.equal(aggregate(list, 'V', 'variance'), 4)
  assert.equal(
    Math.sqrt(aggregate(list, 'V', 'variance')).toFixed(6),
    aggregate(list, 'V', 'stddev').toFixed(6)
  )
})

test('first and last are the first and last in the rows as given', () => {
  const list = rows([30, 10, 20])
  assert.equal(aggregate(list, 'V', 'first'), 30)
  assert.equal(aggregate(list, 'V', 'last'), 20)
})

test('the most common value is the most common NUMBER', () => {
  // Every aggregation here has to return a number, because that is what a
  // KPI, a bar and a gauge all consume. A column of names therefore reports
  // the same nothing that sum and avg already report for it, rather than a
  // plausible-looking zero that secretly means "West".
  assert.equal(aggregate(rows([5, 5, 9, 5, 9]), 'V', 'mode'), 5)
  assert.equal(aggregate(rows(['West', 'West', 'East']), 'V', 'mode'), 0)
  assert.equal(aggregate(rows(['West', 'West', 'East']), 'V', 'sum'), 0, 'and sum says the same')
})

test('an empty column is zero, never NaN', () => {
  for (const agg of DISTRIBUTION_AGGS) {
    const value = aggregate(rows([null, null]), 'V', agg)
    assert.ok(Number.isFinite(value), `${agg} on an empty column`)
    assert.equal(value, 0, agg)
  }
})

test('percent empty is the mirror of percent filled', () => {
  const list = rows([1, null, 3, null])
  assert.equal(aggregate(list, 'V', 'percent_filled'), 50)
  assert.equal(aggregate(list, 'V', 'percent_empty'), 50)
})

test('every aggregation offered is one the engine can actually compute', () => {
  const list = rows([1, 2, 3, 4, 5])
  for (const agg of AGGREGATIONS) {
    const value = aggregate(list, agg.needsColumn ? 'V' : null, agg.value)
    assert.ok(Number.isFinite(value), `${agg.value} returned ${value}`)
  }
})

test('the distribution list names only aggregations that exist', () => {
  const known = new Set(AGGREGATIONS.map((a) => a.value))
  for (const agg of DISTRIBUTION_AGGS) assert.ok(known.has(agg), agg)
})

test('every distribution measure needs a column', () => {
  for (const agg of DISTRIBUTION_AGGS) assert.equal(aggNeedsColumn(agg), true, agg)
})

// --- formatting ----------------------------------------------------------

test('money is grouped the way its own currency groups it', () => {
  // A dollar figure written 12,34,567 is a typo to everyone who reads
  // dollars, and lakhs are equally wrong in euros.
  assert.equal(formatNumber(1234567, 'inr'), '₹12,34,567')
  assert.equal(formatNumber(1234567, 'usd'), '$1,234,567')
  assert.equal(formatNumber(1234567, 'eur'), '€1,234,567')
  assert.equal(formatNumber(1234567, 'gbp'), '£1,234,567')
})

test('Indian scales are the ones people say out loud', () => {
  assert.equal(formatNumber(12500000, 'inr_crore'), '₹1.25 Cr')
  assert.equal(formatNumber(1250000, 'inr_lakh'), '₹12.5 L')
})

test('a delta is always signed, because +12 and 12 are a puzzle', () => {
  assert.equal(formatNumber(12, 'signed'), '+12')
  assert.equal(formatNumber(-12, 'signed'), '-12')
  assert.equal(formatNumber(0, 'signed'), '0')
  assert.equal(formatNumber(12.5, 'signed_percent'), '+13%')
  assert.equal(formatNumber(-4.25, 'signed_percent'), '-4.3%')
})

test('accounting puts negatives in brackets, with no minus sign to miss', () => {
  assert.equal(formatNumber(-320, 'accounting'), '(320)')
  assert.equal(formatNumber(320, 'accounting'), '320')
})

test('ordinals get the teens right', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map((n) => formatNumber(n, 'ordinal')),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th']
  )
})

test('a duration is two units, never three', () => {
  // "2h 14m" is a duration somebody can hold in their head; "2h 14m 09s" is
  // a stopwatch reading, and the seconds cost the minutes their legibility.
  assert.equal(formatDuration(8100), '2h 15m')
  assert.equal(formatDuration(200000), '2d 7h')
  assert.equal(formatDuration(150), '2m 30s')
  assert.equal(formatDuration(45), '45s')
  assert.equal(formatDuration(-90), '-1m 30s')
  assert.equal(formatDuration('nonsense'), '—')
})

test('durations can be fed in whichever unit the sheet holds', () => {
  assert.equal(formatNumber(135, 'duration_min'), '2h 15m')
  assert.equal(formatNumber(30, 'duration_hr'), '1d 6h')
  assert.equal(formatNumber(8100, 'duration_sec'), '2h 15m')
})

test('a file size lands at whichever scale keeps it under four digits', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(1536000), '1.5 MB')
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(-2048), '-2.0 KB')
})

test('days are pluralised', () => {
  assert.equal(formatNumber(1, 'days'), '1 day')
  assert.equal(formatNumber(14, 'days'), '14 days')
  assert.equal(formatNumber(0, 'days'), '0 days')
})

test('every format offered renders something, and never NaN', () => {
  for (const format of NUMBER_FORMATS) {
    for (const value of [0, 1, -1, 1234.567, -98765, 1e9]) {
      const out = formatNumber(value, format.value)
      assert.equal(typeof out, 'string', format.value)
      assert.ok(out.length > 0, format.value)
      assert.ok(!out.includes('NaN'), `${format.value} on ${value} gave ${out}`)
      assert.ok(!out.includes('Infinity'), `${format.value} on ${value} gave ${out}`)
    }
  }
})

test('nothing is an em dash in every format', () => {
  for (const format of NUMBER_FORMATS) {
    assert.equal(formatNumber(null, format.value), '—', format.value)
    assert.equal(formatNumber(NaN, format.value), '—', format.value)
  }
})

test('the formats that were always here are unchanged', () => {
  // The whole point of adding to a list is that nothing already on it moves.
  assert.equal(formatNumber(1234, 'comma'), '1,234')
  assert.equal(formatNumber(1234, 'plain'), '1234')
  assert.equal(formatNumber(12.34, 'percent'), '12%', 'ten and over has always been whole')
  assert.equal(formatNumber(1.234, 'percent'), '1.2%')
  assert.equal(formatNumber(1234567, 'compact'), '12.3L')
})
