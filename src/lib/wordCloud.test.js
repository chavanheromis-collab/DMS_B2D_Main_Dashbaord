import test from 'node:test'
import assert from 'node:assert/strict'

import { cloudOrder, sizedWords, stopwordSet, tokenize, wordCloudData, wordCounts } from './wordCloud.js'

const remarks = (list) => list.map((r, i) => ({ _row: i + 2, R: r }))

// --- tokenising ----------------------------------------------------------

test('a cell splits into words on anything that is not one', () => {
  assert.deepEqual(tokenize('waiting for finance-approval, again!'), [
    'waiting',
    'for',
    'finance-approval',
    'again',
  ])
})

test('case is folded unless the admin says it matters', () => {
  assert.deepEqual(tokenize('Finance FINANCE finance'), ['finance', 'finance', 'finance'])
  assert.deepEqual(tokenize('Finance finance', { caseSensitive: true }), ['Finance', 'finance'])
})

test('pairs are pairs, and a phrase is the whole cell', () => {
  assert.deepEqual(tokenize('waiting for finance', { mode: 'bigram' }), ['waiting for', 'for finance'])
  assert.deepEqual(tokenize('Waiting For Finance', { mode: 'phrase' }), ['waiting for finance'])
})

test('a blank cell yields nothing', () => {
  assert.deepEqual(tokenize(''), [])
  assert.deepEqual(tokenize(null), [])
})

test('the stop-word list is read from what the admin typed', () => {
  const set = stopwordSet('the, And ,\n for ')
  assert.ok(set.has('the') && set.has('and') && set.has('for'))
  assert.equal(set.has(''), false)
})

// --- counting ------------------------------------------------------------

test('a word counts once per row, however often that row repeats it', () => {
  // Otherwise a single ranting remark outvotes forty terse ones, and the
  // cloud describes one customer rather than the column.
  const counts = wordCounts(
    remarks(['delay delay delay delay', 'delay']),
    { column: 'R', useStopwords: false, minLength: 1 }
  )
  assert.equal(counts.find((w) => w.text === 'delay').count, 2)
})

test('stop-words and short words are dropped, and numbers are not themes', () => {
  const counts = wordCounts(remarks(['the car is 4471 delayed']), { column: 'R', minLength: 3 })
  const words = counts.map((w) => w.text)
  assert.ok(!words.includes('the'), 'a stop word')
  assert.ok(!words.includes('is'), 'too short')
  assert.ok(!words.includes('4471'), 'an order id, not a theme')
  assert.ok(words.includes('delayed'))
})

test('the stop-word list can be switched off entirely', () => {
  const counts = wordCounts(remarks(['the car']), { column: 'R', useStopwords: false, minLength: 1 })
  assert.ok(counts.some((w) => w.text === 'the'))
})

test('a minimum count cuts the long tail', () => {
  const counts = wordCounts(
    remarks(['delay stock', 'delay', 'delay']),
    { column: 'R', useStopwords: false, minCount: 2, minLength: 1 }
  )
  assert.deepEqual(counts.map((w) => w.text), ['delay'])
})

test('the rows behind a word are kept, so the cloud can be interrogated', () => {
  const counts = wordCounts(remarks(['delay here', 'delay there', 'fine']), { column: 'R', minLength: 3 })
  const delay = counts.find((w) => w.text === 'delay')
  assert.equal(delay.rows.length, 2)
  assert.equal(delay.rows[0]._row, 2)
})

test('counts come back biggest first, ties broken by name so the order is stable', () => {
  const counts = wordCounts(
    remarks(['beta alpha', 'beta alpha', 'gamma']),
    { column: 'R', useStopwords: false, minLength: 1 }
  )
  assert.deepEqual(counts.map((w) => w.text), ['alpha', 'beta', 'gamma'])
})

// --- sizing --------------------------------------------------------------

test('size is square-rooted, because type is read by area', () => {
  // A linear map squares the apparent difference: twice as common looks
  // four times as loud, and the top word swamps the card.
  const sized = sizedWords(
    [{ text: 'a', count: 100 }, { text: 'b', count: 25 }, { text: 'c', count: 1 }],
    { minSize: 10, maxSize: 50 }
  )
  assert.equal(sized[0].size, 50)
  assert.equal(sized[2].size, 10)
  // Linear would put 25/100 at 20px; the root puts it near the middle.
  assert.ok(sized[1].size > 20, `25 of 100 sized at ${sized[1].size}`)
})

test('every word the same count is every word the same size', () => {
  const sized = sizedWords([{ text: 'a', count: 5 }, { text: 'b', count: 5 }], { minSize: 12, maxSize: 40 })
  assert.equal(sized[0].size, sized[1].size)
  assert.ok(Number.isFinite(sized[0].size), 'no division by a zero spread')
})

test('one word is a valid cloud', () => {
  const sized = sizedWords([{ text: 'only', count: 3 }], { minSize: 12, maxSize: 40 })
  assert.equal(sized.length, 1)
  assert.ok(Number.isFinite(sized[0].size))
})

test('nothing in is nothing out', () => {
  assert.deepEqual(sizedWords([], {}), [])
})

// --- layout --------------------------------------------------------------

test('the layout is deterministic and puts the heaviest words in the middle', () => {
  // A cloud that reshuffles on every render makes the reader think the
  // data moved.
  const words = ['a', 'b', 'c', 'd', 'e'].map((text, i) => ({ text, count: 10 - i }))
  const first = cloudOrder(words)
  const second = cloudOrder(words)
  assert.deepEqual(first.map((w) => w.text), second.map((w) => w.text))

  const middle = Math.floor(first.length / 2)
  assert.equal(first[middle].text, 'a', 'the commonest word is central')
})

test('every word survives the layout', () => {
  const words = Array.from({ length: 9 }, (_, i) => ({ text: `w${i}`, count: 9 - i }))
  assert.equal(cloudOrder(words).length, 9)
  assert.equal(new Set(cloudOrder(words).map((w) => w.text)).size, 9)
})

// --- the widget ----------------------------------------------------------

test('no column means nothing to draw', () => {
  assert.equal(wordCloudData({ column: '' }, { rows: remarks(['x']) }).ready, false)
})

test('the widget reports what it cut, rather than pretending it is everything', () => {
  const list = remarks(Array.from({ length: 30 }, (_, i) => `word${i} shared`))
  const data = wordCloudData({ column: 'R', limit: 5, useStopwords: false, minLength: 1 }, { rows: list })

  assert.equal(data.words.length, 5)
  assert.equal(data.distinct, 31, 'thirty unique words plus the shared one')
  assert.equal(data.hidden, 26)
  assert.equal(data.filled, 30)
})

test('a ranked layout keeps the ranking, a flowing one rearranges it', () => {
  const list = remarks(['alpha beta gamma', 'alpha beta', 'alpha'])
  const ranked = wordCloudData({ column: 'R', layout: 'ranked', useStopwords: false, minLength: 1 }, { rows: list })
  const flowing = wordCloudData({ column: 'R', layout: 'flow', useStopwords: false, minLength: 1 }, { rows: list })

  assert.deepEqual(ranked.laidOut.map((w) => w.text), ['alpha', 'beta', 'gamma'])
  assert.notDeepEqual(flowing.laidOut.map((w) => w.text), ranked.laidOut.map((w) => w.text))
  assert.equal(flowing.laidOut.length, 3, 'rearranged, never reduced')
})
