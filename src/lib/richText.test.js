import test from 'node:test'
import assert from 'node:assert/strict'

import { parseBlocks, parseInline, plainText, safeLinkUrl } from './richText.js'

const types = (blocks) => blocks.map((b) => b.type)
const text = (spans) => spans.map((s) => s.text).join('')

// --- the reason this module exists at all --------------------------------

test('only a scheme on the list can become a link', () => {
  // The whole point of parsing to tokens instead of HTML. An admin who
  // pastes something they did not write must not be able to put script
  // into every other user's session.
  assert.equal(safeLinkUrl('https://example.com'), 'https://example.com')
  assert.equal(safeLinkUrl('http://example.com'), 'http://example.com')
  assert.equal(safeLinkUrl('mailto:a@b.com'), 'mailto:a@b.com')
  assert.equal(safeLinkUrl('/d/page1'), '/d/page1')

  assert.equal(safeLinkUrl('javascript:alert(1)'), null)
  assert.equal(safeLinkUrl('JaVaScRiPt:alert(1)'), null, 'an allow-list does not care about casing tricks')
  assert.equal(safeLinkUrl('data:text/html;base64,PHNjcmlwdD4='), null)
  assert.equal(safeLinkUrl('vbscript:msgbox'), null)
  assert.equal(safeLinkUrl(''), null)
})

test('a link somewhere disallowed keeps its words', () => {
  // Dropping the whole thing would silently delete a sentence; leaving the
  // raw markup would look like a bug the reader caused.
  const spans = parseInline('see [the report](javascript:alert(1)) for more')
  assert.ok(!spans.some((s) => s.type === 'link'))
  assert.ok(text(spans).includes('the report'))
  assert.ok(!text(spans).includes('javascript'))
})

test('markup is never markup', () => {
  const blocks = parseBlocks('<script>alert(1)</script> and <b>bold</b>')
  assert.equal(blocks.length, 1)
  assert.ok(text(blocks[0].spans).includes('<script>'), 'it is text, and it stays text')
})

// --- inline marks --------------------------------------------------------

test('the four marks are recognised', () => {
  const spans = parseInline('a **bold** b *italic* c ~~gone~~ d `code` e')
  const found = spans.filter((s) => s.type !== 'text').map((s) => [s.type, s.text])
  assert.deepEqual(found, [
    ['strong', 'bold'],
    ['em', 'italic'],
    ['strike', 'gone'],
    ['code', 'code'],
  ])
})

test('bold is tried before italic, or bold parses as two italics', () => {
  const spans = parseInline('**both**')
  assert.equal(spans.length, 1)
  assert.equal(spans[0].type, 'strong')
})

test('underscores work like asterisks', () => {
  assert.equal(parseInline('__b__')[0].type, 'strong')
  assert.equal(parseInline('_i_')[0].type, 'em')
})

test('a link keeps its label and its target apart', () => {
  const [span] = parseInline('[Ops sheet](https://example.com/x)').filter((s) => s.type === 'link')
  assert.equal(span.text, 'Ops sheet')
  assert.equal(span.href, 'https://example.com/x')
})

test('plain text stays plain', () => {
  const spans = parseInline('nothing special here')
  assert.equal(spans.length, 1)
  assert.equal(spans[0].type, 'text')
})

// --- blocks --------------------------------------------------------------

test('the block kinds are recognised', () => {
  const blocks = parseBlocks(['# H', 'para', '', '> quote', '---', '- one', '- two'].join('\n'))
  assert.deepEqual(types(blocks), ['heading', 'p', 'quote', 'rule', 'list'])
  assert.equal(blocks[0].level, 1)
})

test('consecutive bullets fuse into one list', () => {
  const blocks = parseBlocks('- a\n- b\n- c')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].items.length, 3)
  assert.equal(blocks[0].ordered, false)
})

test('a numbered list is its own list and remembers where it started', () => {
  const blocks = parseBlocks('- a\n1. one\n2. two')
  assert.deepEqual(types(blocks), ['list', 'list'])
  assert.equal(blocks[1].ordered, true)
  assert.equal(blocks[1].start, 1)

  assert.equal(parseBlocks('5. five\n6. six')[0].start, 5)
})

test('a checklist is a checklist and not three bullets with brackets in them', () => {
  const [list] = parseBlocks('- [ ] todo\n- [x] done')
  assert.equal(list.checklist, true)
  assert.equal(list.items[0].checked, false)
  assert.equal(list.items[1].checked, true)
  assert.equal(text(list.items[1].spans), 'done')
})

test('a blank line separates paragraphs, and a single break does not', () => {
  // The admin's own line breaks are about their textarea, not about the
  // page -- so the note reflows to whatever width it lands in.
  const blocks = parseBlocks('one\ntwo\n\nthree')
  assert.deepEqual(types(blocks), ['p', 'p'])
  assert.equal(text(blocks[0].spans), 'one two')
})

test('marks inside blocks are still marks', () => {
  const [list] = parseBlocks('- a **strong** point')
  assert.ok(list.items[0].spans.some((s) => s.type === 'strong'))

  const [heading] = parseBlocks('## A [link](https://x.com)')
  assert.ok(heading.spans.some((s) => s.type === 'link'))
})

test('all three rule spellings are a rule', () => {
  assert.deepEqual(types(parseBlocks('---')), ['rule'])
  assert.deepEqual(types(parseBlocks('___')), ['rule'])
  assert.deepEqual(types(parseBlocks('***')), ['rule'])
})

test('nothing in is nothing out', () => {
  assert.deepEqual(parseBlocks(''), [])
  assert.deepEqual(parseBlocks('   \n\n  '), [])
  assert.deepEqual(parseBlocks(null), [])
})

test('heading levels stop at four', () => {
  assert.equal(parseBlocks('#### four')[0].level, 4)
  assert.deepEqual(types(parseBlocks('##### five')), ['p'], 'past four it is just text')
})

// --- plain text ----------------------------------------------------------

test('plain text strips the marks and keeps the words', () => {
  assert.equal(plainText('# A **bold** [link](https://x.com)'), 'A bold link')
  assert.equal(plainText('> quoted   text'), 'quoted text')
  assert.equal(plainText(''), '')
})
