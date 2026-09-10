import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  CARD_FIELDS_MAX,
  CARD_PALETTE,
  CARD_SIZES,
  VIEW_MODES,
  cardLines,
  cardMinHeight,
  cardMinWidth,
  cardSpec,
  cardTitleColumn,
  cardTone,
  cardViewEnabled,
  moreNote,
  viewModeOf,
  zoomLines,
} from './cardView.js'

// ---------------------------------------------------------------------
// The same rows, as cards
// ---------------------------------------------------------------------
// A grid compares forty records on one number; a card reads one record
// whole. What is worth testing is that it really is the SAME rows in a
// different arrangement -- the admin's columns, in the admin's order, with
// nothing quietly dropped -- and that the colour means something.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const COLUMNS = ['Quotation No', 'Customer', 'Model', 'Status', 'Amount']

// --- which arrangement ---------------------------------------------------

test('cards are offered only where an admin turned them on', () => {
  // A forty-column register turned into cards is forty postage stamps
  // saying "and 32 more", so it is a decision about a particular table
  // rather than something every table grows.
  assert.equal(cardViewEnabled({}), false)
  assert.equal(cardViewEnabled({ cardView: true }), true)
  assert.equal(cardViewEnabled(null), false)
})

test('a table opens as a table unless cards are on AND the default', () => {
  // Reading the default without the switch is how a table nobody enabled
  // cards for opens as cards after somebody experiments in the panel and
  // turns the switch back off.
  assert.equal(viewModeOf({ viewMode: 'cards' }), 'table', 'the switch is off')
  assert.equal(viewModeOf({ cardView: true, viewMode: 'cards' }), 'cards')
  assert.equal(viewModeOf({ cardView: true }), 'table')
  assert.equal(viewModeOf({ cardView: true, viewMode: 'nonsense' }), 'table')
  assert.equal(viewModeOf(null), 'table')
  assert.deepEqual(VIEW_MODES.map((v) => v.value), ['table', 'cards'])
})

// --- what a card shows ---------------------------------------------------

test('the heading is the admin’s column, or the first one they chose', () => {
  // Which is nearly always the identifier, because that is where people
  // put it.
  assert.equal(cardTitleColumn({}, COLUMNS), 'Quotation No')
  assert.equal(cardTitleColumn({ cardTitle: 'Customer' }, COLUMNS), 'Customer')
  // A heading naming a column the table no longer shows falls back rather
  // than leaving every card blank.
  assert.equal(cardTitleColumn({ cardTitle: 'Deleted' }, COLUMNS), 'Quotation No')
  assert.equal(cardTitleColumn({}, []), '')
})

test('neither the heading nor the second line is repeated in the body', () => {
  // A card whose first lines are its own name twice looks like a
  // rendering fault.
  const spec = cardSpec({ cardTitle: 'Customer' }, COLUMNS)
  assert.equal(spec.title, 'Customer')
  assert.equal(spec.subtitle, 'Quotation No', 'the next column along')
  assert.deepEqual(spec.fields, ['Model', 'Status', 'Amount'])
})

test('the second line says WHO, under the what', () => {
  // An identifier alone names a record without saying anything about it.
  assert.equal(cardSpec({}, COLUMNS).subtitle, 'Customer')
  assert.equal(cardSpec({ cardSubtitle: 'Model' }, COLUMNS).subtitle, 'Model')
  // Explicitly emptied, and it goes -- some tables have nothing worth
  // putting there.
  assert.equal(cardSpec({ cardSubtitle: '' }, COLUMNS).subtitle, '')
  // Naming a column the table no longer shows drops it rather than
  // leaving a blank line on every card.
  assert.equal(cardSpec({ cardSubtitle: 'Gone' }, COLUMNS).subtitle, '')
})

test('the fields are the admin’s columns, in the admin’s order', () => {
  // A card showing fields the table does not is a second configuration to
  // keep in step.
  const spec = cardSpec({ cardSubtitle: '' }, ['C', 'A', 'B'])
  assert.deepEqual(spec.fields, ['A', 'B'])
})

test('a card is a summary, and says what it is holding back', () => {
  // Silently stopping at six of fourteen is the failure this codebase
  // keeps finding and removing.
  const many = Array.from({ length: 14 }, (_, i) => `C${i}`)
  const spec = cardSpec({ cardSubtitle: '' }, many)
  assert.equal(spec.fields.length, CARD_FIELDS_MAX)
  assert.equal(spec.hidden, 13 - CARD_FIELDS_MAX)
  assert.equal(moreNote(spec.hidden), `and ${13 - CARD_FIELDS_MAX} more fields`)
  assert.equal(moreNote(0), '')
  assert.equal(moreNote(1), 'and 1 more field')
  // ...and the zoom still has every one of them, the second line included.
  assert.equal(spec.all.length, 13)
})

test('a blank field is dropped from the card and kept in the zoom', () => {
  // On a card it is noise -- eight labels with nothing after them, pushing
  // the fields that DO have values off the bottom. In the zoom it is the
  // answer to "was this ever filled in?".
  const row = { 'Quotation No': 'Q-1', Customer: '', Model: 'SPLENDOR', Status: null }
  const fields = ['Quotation No', 'Customer', 'Model', 'Status']

  assert.deepEqual(cardLines(row, fields), [
    { column: 'Quotation No', value: 'Q-1' },
    { column: 'Model', value: 'SPLENDOR' },
  ])
  assert.deepEqual(zoomLines(row, fields).map((l) => l.column), fields)
  assert.equal(zoomLines(row, fields)[1].value, '')
})

// --- the colour ----------------------------------------------------------

test('no card is the colour of the card beside it', () => {
  // The one property a decorative colour has to have. A value-hashed
  // colour could not promise it -- three "Pending" quotations in a row
  // were three identical blocks.
  for (let i = 0; i < 60; i += 1) {
    assert.notEqual(cardTone(i).bg, cardTone(i + 1).bg, `${i} clashes with ${i + 1}`)
  }
})

test('...nor of the card under it', () => {
  // A grid is read down as well as across, and it is four or five wide
  // depending on the screen. Twelve colours clear every realistic width.
  for (const across of [2, 3, 4, 5, 6, 7, 8]) {
    for (let i = 0; i < 40; i += 1) {
      assert.notEqual(cardTone(i).bg, cardTone(i + across).bg, `${across} across: ${i} clashes`)
    }
  }
})

test('the colour needs no configuring and reads nothing off the row', () => {
  // `cardTone` takes a position and nothing else: no column to nominate,
  // no value to hash, no admin decision to keep in step. Handing it a row
  // changes nothing, because it never looks at one.
  assert.deepEqual(cardTone(0), CARD_PALETTE[0])
  assert.deepEqual(cardTone(CARD_PALETTE.length), CARD_PALETTE[0], 'it cycles')
  assert.deepEqual(cardTone(3, { Status: 'Pending' }), cardTone(3, { Status: 'Delivered' }))
})

test('an odd index still lands on a colour', () => {
  // A card drawn grey because of an arithmetic accident would look like a
  // state nobody can explain.
  for (const odd of [-1, -13, 1.7, NaN, undefined, null]) {
    const tone = cardTone(odd)
    assert.ok(CARD_PALETTE.includes(tone), `${odd} fell off the palette`)
  }
})

test('a card tone is a whole hue, not a colour and a stripe', () => {
  // Ground, edge, ink and rail, all of one hue: a card has to read as one
  // object rather than as a coloured rectangle with an unrelated bar.
  for (const row of CARD_PALETTE) {
    for (const part of ['bg', 'border', 'fg', 'accent']) {
      assert.match(row[part], /^#[0-9A-F]{6}$/i, `${part} must be a colour`)
    }
  }
})

test('the palette is big enough, and has no duplicates', () => {
  assert.ok(CARD_PALETTE.length >= 12)
  assert.equal(new Set(CARD_PALETTE.map((p) => p.bg)).size, CARD_PALETTE.length)
  assert.equal(new Set(CARD_PALETTE.map((p) => p.accent)).size, CARD_PALETTE.length)
})

// --- size ----------------------------------------------------------------

test('a card has a least width and a least height', () => {
  // The height is a FLOOR rather than a fixed size: a card with two filled
  // fields and one with six should not be two shapes in the same row, and
  // a grid of ragged blocks reads as broken rather than as varied.
  assert.equal(cardMinWidth({}), 260)
  assert.equal(cardMinWidth({ cardSize: 'sm' }), 200)
  assert.equal(cardMinWidth({ cardSize: 'lg' }), 330)
  assert.equal(cardMinWidth({ cardSize: 'nonsense' }), 260)

  assert.equal(cardMinHeight({}), 190)
  assert.equal(cardMinHeight({ cardSize: 'sm' }), 150)
  assert.equal(cardMinHeight({ cardSize: 'lg' }), 240)

  assert.equal(CARD_SIZES.length, 3)
  for (const size of CARD_SIZES) {
    assert.ok(size.min > 0 && size.minHeight > 0, `${size.value} needs both`)
  }
})

// --- still wired ---------------------------------------------------------

const table = read('components/widgets/TableWidget.jsx')
const grid = read('components/widgets/CardGrid.jsx')

test('both views draw the same rows', () => {
  // Already filtered, searched, sorted and paged. A card view that fetched
  // or filtered differently would be a second widget wearing this one's
  // settings.
  assert.match(table, /<CardGrid widget=\{widget\} rows=\{pageRows\} columns=\{columns\}/)
})

test('the reader can switch, and the admin sets which it opens in', () => {
  assert.match(table, /useState\(\(\) => viewModeOf\(widget\)\)/)
  assert.match(table, /onClick=\{\(\) => setView\('cards'\)\}/)
  assert.match(table, /onClick=\{\(\) => setView\('table'\)\}/)
})

test('selection and row operations survive the switch', () => {
  // The actions bar sits above both arrangements, so a selection made on
  // cards is a selection the Copy, Move and Delete buttons act on.
  assert.match(table, /selectable=\{selectable\} selection=\{selection\} onTick=\{tickRow\}/)
  assert.match(grid, /onChange=\{\(e\) => onTick\?\.\(row, e\.nativeEvent\.shiftKey\)\}/)
  // Ticking a card must not also open its zoom.
  assert.match(grid, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/)
})

test('the zoom is a popup, and it scrolls', () => {
  // A card that grew in place would reflow the grid under the cursor:
  // everything below it jumps and the thing somebody was about to click
  // has moved.
  assert.match(grid, /onClick=\{\(\) => setZoomed\(row\)\}/)
  assert.match(grid, /max-h-\[85vh\]/)
  // The body scrolls and the heading does not, so a thirty-field record
  // never scrolls its own name away.
  assert.match(grid, /min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto/)
  assert.match(grid, /flex shrink-0 items-start gap-2 px-4 py-3/)
  assert.match(grid, /e\.key === 'Escape'/)
})

test('the card is tinted, not just striped', () => {
  // The colour is a wash plus an edge of the same hue and one saturated
  // rail -- enough to tell two records apart at a glance, not so much that
  // it competes with the values printed on it.
  assert.match(grid, /backgroundColor: tone\.bg/)
  assert.match(grid, /borderColor: ticked \? tone\.accent : tone\.border/)
  assert.match(grid, /minHeight: cardMinHeight\(widget\)/)
  // ...and the zoom wears the same colour, so it is visibly the object
  // that was clicked rather than a white panel from nowhere.
  assert.match(grid, /style=\{\{ backgroundColor: tone\.bg \}\}/)
  assert.match(grid, /cardTone\(rows\.findIndex\(\(r\) => r\._row === zoomRow\._row\)\)/)
})

test('the colour is drawn from the position, with nothing configured', () => {
  assert.match(grid, /const tone = cardTone\(index\)/)
  // No column to nominate, so the panel offers none.
  const panel = read('pages/admin/WidgetsPanel.jsx')
  assert.equal(/cardColorBy/.test(panel), false)
  assert.equal(/cardColorBy/.test(grid), false)
})

test('the switch only exists where cards are offered', () => {
  assert.match(table, /\{cardViewEnabled\(widget\) && \(/)
})

test('the zoomed record follows the sheet', () => {
  // Held by row number and re-read from the live rows, or a save would
  // leave the popup showing what the record used to say.
  assert.match(grid, /liveRow\(rows, zoomed\)/)
})
