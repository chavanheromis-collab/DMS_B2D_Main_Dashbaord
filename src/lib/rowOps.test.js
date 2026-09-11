import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  MAX_ROWS_PER_OP,
  ROW_LIMIT,
  ROW_LIMIT_CEILING,
  ROW_OPS,
  ROW_OP_SWITCHES,
  offersRowOps,
  rowLimitOf,
  availableActions,
  clearNote,
  clearPlan,
  canAdd,
  canDelete,
  canMove,
  confirmLabel,
  copyTargetsOf,
  creatableColumns,
  grantsFor,
  hasRowActions,
  limitNote,
  sendsRows,
  blankPair,
  copyRoutesOf,
  mapColumns,
  mapRow,
  mappingNote,
  normalizeRoute,
  resolvePairs,
  routeFor,
  routeNote,
  rowCount,
  scrubRow,
  targetIsUsable,
  tooMany,
} from './rowOps.js'
import { FP, fingerprintValues, staleRows } from './rowFingerprint.js'
import { META_COLUMNS, dataColumns, dataValues, isMetaColumn } from './rowMeta.js'

// ---------------------------------------------------------------------
// Whole rows
// ---------------------------------------------------------------------
// Editing has always meant editing a cell. Deleting rows and sending them
// to another tab are a different kind of write, and what is worth testing
// is the part that makes them safe rather than the part that makes them
// work: a delete that cannot be reached by anybody who was only granted a
// copy, a copy whose permission is checked on the tab the rows LAND on, and
// a row that cannot carry a column its sender could not then correct.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const API = path.resolve(SRC, '..', 'api')
const readApi = (p) =>
  fs
    .readFileSync(path.join(API, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

// --- the two grants ------------------------------------------------------

test('there are two grants, and both operations decompose into them', () => {
  // A copy is an add on the target; a move is that plus a delete here.
  // Modelling them as the writes they perform rather than as the buttons
  // they sit behind is what stops "may move" being a right nobody thought
  // to review.
  assert.deepEqual(ROW_OPS, ['add', 'delete'])
  for (const action of ROW_OP_SWITCHES) {
    for (const need of action.needs) assert.ok(ROW_OPS.includes(need), `${action.key} needs an unknown grant`)
  }
})

test('nothing creates a row from nothing', () => {
  // A record is entered where records are entered. The only way a row
  // arrives on a tab is by being sent there from another one -- and
  // clearing, which is the nearest thing to a blank row, makes one out of
  // a row that already exists rather than adding a row to hold it.
  assert.deepEqual(
    ROW_OP_SWITCHES.map((a) => a.key),
    ['canDeleteRows', 'canClearRows', 'canCopyRows', 'canMoveRows']
  )
})

test('clearing is not a grant, and deliberately not one', () => {
  // Emptying a cell is writing '' into it, which the column grants
  // already govern. A "may clear" right would let an admin grant the
  // blanking of a column its holder cannot write, which is not a thing
  // anybody means.
  const clear = ROW_OP_SWITCHES.find((a) => a.key === 'canClearRows')
  assert.deepEqual(clear.needs, [])
  assert.equal(clear.columns, true)
  assert.equal(ROW_OPS.includes('clear'), false)
})

test('copy and move are switched on separately', () => {
  // One switch covering both meant an admin who wanted either got both. A
  // table feeding a register wants Copy and must never offer Move; a table
  // that is a queue wants the opposite.
  assert.equal(sendsRows({ canCopyRows: true }), true)
  assert.equal(sendsRows({ canMoveRows: true }), true)
  assert.equal(sendsRows({ canDeleteRows: true }), false)
  assert.equal(sendsRows({}), false)

  // Move carries the delete grant as a requirement, because that is the
  // half it performs.
  const moveSwitch = ROW_OP_SWITCHES.find((a) => a.key === 'canMoveRows')
  assert.deepEqual(moveSwitch.needs, ['delete'])
})

test('a grant is per tab, and absent means none', () => {
  // Not "the same as editing". An account that existed before row
  // operations did has exactly the rights today that it had yesterday.
  const access = { rowOps: { 'a::MASTER': ['add'] } }
  assert.deepEqual(grantsFor(access, 'a::MASTER'), ['add'])
  assert.deepEqual(grantsFor(access, 'a::Quotations'), [])
  assert.deepEqual(grantsFor({}, 'a::MASTER'), [])
  assert.deepEqual(grantsFor(null, 'a::MASTER'), [])
  assert.equal(canAdd(access, 'a::MASTER'), true)
  assert.equal(canDelete(access, 'a::MASTER'), false)
})

test('an admin holds both, everywhere', () => {
  // The alternative is an admin who cannot fix a page they can see.
  assert.deepEqual(grantsFor({}, 'anything', true), ['add', 'delete'])
  assert.equal(canDelete(null, 'anything', true), true)
})

test('an unknown grant on the document is not a grant', () => {
  const access = { rowOps: { T: ['add', 'drop-table', 'delete '] } }
  assert.deepEqual(grantsFor(access, 'T'), ['add'])
})

// --- what a table actually shows -----------------------------------------

const widget = {
  tab: 'T',
  canDeleteRows: true,
  canCopyRows: true,
  copyTargets: ['b::Bookings'],
}

const ctx = (rowOps, extra = {}) => ({
  access: { rowOps: { T: rowOps } },
  ref: 'T',
  targets: ['Bookings'],
  ...extra,
})

test('three people have to agree before a button exists', () => {
  // The admin switched it on, this reader holds whatever it needs here,
  // and -- for a copy -- there is somewhere left to send rows to.
  assert.deepEqual(availableActions(widget, ctx(['delete'])), ['canDeleteRows', 'canCopyRows'])

  // Switched off on the table: nothing, however much is granted.
  assert.deepEqual(availableActions({ tab: 'T' }, ctx(['add', 'delete'])), [])
})

test('a copy is not gated on a grant over the tab the rows LEAVE', () => {
  // Its permission lives on the target, which is where the rows land and
  // what the server checks. Requiring an add grant here as well would hide
  // a copy somebody is perfectly entitled to make out of a tab they may
  // only read.
  assert.deepEqual(availableActions(widget, ctx([])), ['canCopyRows'])
  assert.equal(hasRowActions(widget, ctx([])), true)
})

test('...it is gated on there being a destination left', () => {
  // The destination list arrives already narrowed to the tabs this person
  // may write to, so an empty one IS the refusal. A button that appears and
  // then fails is worse than one that was never there.
  assert.deepEqual(availableActions(widget, ctx(['delete'], { targets: [] })), ['canDeleteRows'])
  assert.equal(hasRowActions(widget, ctx([], { targets: [] })), false)
})

test('deleting needs the delete grant, and nothing else grants it', () => {
  assert.deepEqual(availableActions(widget, ctx(['add'])), ['canCopyRows'])
})

test('moving needs its own switch AND the delete grant here', () => {
  // The switch, because copy and move are different decisions. The grant,
  // because otherwise the second half is refused after the first half has
  // landed -- rows duplicated onto the target and still sitting here, which
  // the person who pressed the button cannot see.
  assert.equal(canMove(widget, ctx(['add', 'delete'])), false, 'the switch is off on this widget')

  const mover = { ...widget, canMoveRows: true }
  assert.equal(canMove(mover, ctx(['add'])), false, 'no delete grant')
  assert.equal(canMove(mover, ctx(['add', 'delete'])), true)
  assert.equal(canMove({ tab: 'T' }, ctx(['add', 'delete'])), false)
})

test('copy targets are what the admin listed, blanks dropped', () => {
  assert.deepEqual(copyTargetsOf({ copyTargets: ['a', '', null, 'b'] }), ['a', 'b'])
  assert.deepEqual(copyTargetsOf({}), [])
})

// --- what a new row may contain ------------------------------------------

test('a row may only carry columns this person could edit where it lands', () => {
  // Otherwise a copy is a way round the column grants: put it there wrong,
  // and be unable to correct it.
  assert.deepEqual(creatableColumns(['A', 'B', 'C'], ['B']), ['B'])
  assert.deepEqual(creatableColumns(['A', 'B', 'C'], ['B'], true), ['A', 'B', 'C'])
  assert.deepEqual(creatableColumns(['A', 'B'], []), [])
})

test('a copied row cannot land a value its sender could not write there', () => {
  const row = { _row: 9, [FP]: 'abc', Model: 'SPLENDOR', Amount: '50000' }
  assert.deepEqual(scrubRow(row, ['Model']), { Model: 'SPLENDOR' })
})

test('a copied row never carries the address of the row it came from', () => {
  // `_row` is the one field on a row that must not be inherited: it is
  // where a write lands.
  const row = { _row: 9, [FP]: 'abc', Model: 'X' }
  assert.deepEqual(scrubRow(row, ['Model', '_row', '_fp']), { Model: 'X' })
  assert.deepEqual(dataValues(row), { Model: 'X' })
})

// --- sending rows to another tab -----------------------------------------

test('columns land by name, and the dialog says what will not', () => {
  // Position would map Chassis onto Customer and write it -- every value in
  // the right shape and the wrong place.
  const m = mapColumns(['Model', 'Amount', 'Remark'], ['Model', 'Amount', 'Branch'])
  assert.deepEqual(m.matched, ['Model', 'Amount'])
  assert.deepEqual(m.dropped, ['Remark'])
  assert.deepEqual(m.blank, ['Branch'])
  assert.match(mappingNote(m), /Remark/)
})

test('the note says what is LOST, because that is the figure that changes a mind', () => {
  assert.match(mappingNote(mapColumns(['A', 'B'], ['A', 'B'])), /All 2 columns carry across/)
  assert.match(mappingNote(mapColumns(['A'], ['B'])), /nothing would carry/i)
})

test('what carries is measured against the TAB, not the table', () => {
  // The server copies what the ROW holds; the table may be showing four of
  // its twenty columns. Measuring the mapping against the visible ones
  // understates what carries -- and on a narrowed table can claim nothing
  // carries at all and disable a copy that would have worked.
  const bar = read('components/RowActionsBar.jsx')
  assert.match(bar, /resolvePairs\(chosen\?\.pairs \|\| \[\], sourceHeaders, targetHeaders\)/)
  // ...while the PREVIEW still uses what is on screen, which is how a
  // reader recognises a record.
  assert.match(bar, /<RowPreview rows=\{rows\} columns=\{columns\} \/>/)

  const table = read('components/widgets/TableWidget.jsx')
  assert.match(table, /sourceHeaders=\{tabHeaders \|\| \[\]\}/)
})

test('not knowing the destination’s columns never refuses the transfer', () => {
  // A destination is usually a tab this page does not read, so its column
  // list often is not here. The server maps at the moment it writes and
  // needs no opinion from this page -- so an unknown list is reported and
  // the button stays live. Refusing over it would block a copy that works.
  assert.match(routeNote({ pairs: [], unusable: [] }, { known: false }), /not known here yet/)
  assert.match(mappingNote(null), /not known here yet/)

  const bar = read('components/RowActionsBar.jsx')
  // Disabled ONLY when the columns are known AND none of them line up.
  assert.match(bar, /const nothingCarries = known && resolved\.pairs\.length === 0/)
})

test('the reader is shown the mapping and cannot change it', () => {
  // Where a value lands is a decision about the SHEET, not about today's
  // batch. Once anyone sending rows can re-point a column, "what is in the
  // Booking Ref column" stops having one answer.
  const bar = read('components/RowActionsBar.jsx')
  assert.match(bar, /set by an admin/)
  // Nothing in the dialog edits a pair any more.
  assert.equal(/setPair|addPair|dropPair|blankPair/.test(bar), false)
  assert.equal(/onChange=\{\(v\) => setPair/.test(bar), false)
})

test('the server reads the route from the page, not from the request', () => {
  // Which is what makes it the admin's decision rather than a suggestion:
  // a crafted request cannot name its own pairs any more than it can name
  // its own destination.
  assert.match(api, /const route = transferRoute\(page, body, ref, target, move\)/)
  assert.match(api, /resolvePairs\(route\.pairs, sheet\.headers, targetSheet\.headers\)/)
  // The browser contributes an id, not a decision.
  assert.match(api, /const widgetId = String\(body\.widget \|\| ''\)/)
  assert.equal(/body\.pairs/.test(api), false)
  // ...and the widget it names must really be the table it claims.
  assert.match(api, /widget\.type !== 'table' \|\| widget\.tab !== ref/)
  assert.match(api, /widget\[move \? 'canMoveRows' : 'canCopyRows'\]/)
})

test('a destination is picked and added, one at a time', () => {
  // Rather than a checklist of every tab the page could reach: a route is
  // a thing you set up, not a box you tick, and the column mapping that
  // follows only makes sense against one destination at a time.
  const panel = read('pages/admin/WidgetsPanel.jsx')
  assert.match(panel, /function addTarget\(\)/)
  assert.match(panel, /write\(\[\.\.\.routes, \{ ref: picking, pairs: \[\] \}\]\)/)
  // ...and it opens straight onto its columns, because adding a
  // destination and mapping it is one job.
  assert.match(panel, /setOpen\(picking\)/)
  // A tab already used is not offered again -- two routes to one place
  // would leave which mapping applies to array order.
  assert.match(panel, /choices\.filter\(\(ref\) => !routes\.some\(\(r\) => r\.ref === ref\)\)/)
})

test('the mapping reads destination-first, in both places', () => {
  // "Booking Ref is filled from Quotation No" is the direction the question
  // is actually asked in: somebody setting this up works down the target's
  // columns deciding what goes in each. Showing it one way to the admin and
  // the other to the reader is how a mapping gets read backwards by whoever
  // is checking it.
  const panel = read('pages/admin/WidgetsPanel.jsx')
  const at = panel.indexOf('function PairsEditor')
  const editor = panel.slice(at, panel.indexOf('function PairColumn'))

  // The LEFT dropdown is the target's columns, the RIGHT one the source's.
  const left = editor.indexOf('options={targetHeaders}')
  const right = editor.indexOf('options={sourceHeaders}')
  assert.ok(left > -1 && right > -1 && left < right, 'target column must come first')
  assert.match(editor, /column to fill/)
  assert.match(editor, /value taken from/)

  // The reader's panel is the same way round.
  const bar = read('components/RowActionsBar.jsx')
  const pair = bar.slice(bar.indexOf('resolved.pairs.map'))
  assert.ok(pair.indexOf('title={to}') < pair.indexOf('title={from}'), 'destination must come first')
})

test('flipping the form did not flip the stored shape', () => {
  // The model is about where a value travels; the form is about what fills
  // a field. `from` is still the source and `to` still the target, or every
  // route already saved would quietly reverse itself.
  assert.deepEqual(mapRow({ A: '1' }, [{ from: 'A', to: 'B' }]), { B: '1' })
  assert.deepEqual(resolvePairs([], ['Shared'], ['Shared']).pairs, [{ from: 'Shared', to: 'Shared' }])
})

test('the destination list is built from refs, not from Select options', () => {
  // `tabOptions` is [{ value, label }]. Read as refs it put
  // "[object Object]" in every row and made none of them tickable.
  const panel = read('pages/admin/WidgetsPanel.jsx')
  assert.match(panel, /typeof option === 'string' \? option : option\?\.value/)
  assert.equal(/\(tabOptions \|\| \[\]\)\.filter\(\(ref\) => ref !== widget\.tab\)/.test(panel), false)
})

test('a copy destination is named even though the page never reads it', () => {
  // The bug this replaced: the label map was built from the refs some
  // widget READS, so a destination with no widget of its own had no label,
  // no way back through refByLabel, and was silently dropped from the list
  // -- which is every destination worth having.
  const dash = read('pages/Dashboard.jsx')
  assert.match(dash, /for \(const ref of copyTargetsOf\(widget\)\) set\.add\(ref\)/)
  assert.match(dash, /buildLabelMap\(namedRefs, sources\)/)
  // ...but still not FETCHED: naming a tab must not pull a spreadsheet on
  // every page load.
  assert.match(dash, /usePageData\( getIdToken, pageId, neededRefs,/)
})

test('a destination carries its ref and the admin’s mapping', () => {
  const dash = read('pages/Dashboard.jsx')
  assert.match(dash, /\{ ref: route\.ref, label: labelFor\(route\.ref\), pairs: route\.pairs \}/)
  // The old round trip through label space is gone -- it could only lose,
  // because a destination has no label space to be found in.
  assert.equal(/const target = refByLabel\[targetLabel\]/.test(dash), false)
})

test('a destination’s columns come from its source when the page has none', () => {
  // Which is what makes a destination not need to be on the page at all.
  const dash = read('pages/Dashboard.jsx')
  assert.match(dash, /sourcesById\[sourceId\]\?\.tabHeaders\?\.\[tab\] \|\| \[\]/)
  assert.match(dash, /headersFor=\{headersForRef\}/)
})

test('a target sharing no column name is not a usable target', () => {
  assert.equal(targetIsUsable(['A', 'B'], ['C']), false)
  assert.equal(targetIsUsable(['A', 'B'], ['B', 'C']), true)
})

test('more than three dropped columns are summarised, not listed forever', () => {
  const note = mappingNote(mapColumns(['A', 'B', 'C', 'D', 'E', 'F'], ['A']))
  assert.match(note, /and 2 more/)
})

// --- saying what is about to happen --------------------------------------

test('every confirmation carries the count', () => {
  // The failure this guards against is acting on a selection that is not
  // the one you think you have. "Delete" is a button you press without
  // reading; "Delete 43 rows" is not.
  assert.equal(confirmLabel('delete', 43), 'Delete 43 rows')
  assert.equal(confirmLabel('delete', 1), 'Delete 1 row')
  assert.equal(confirmLabel('move', 2, 'Bookings'), 'Move 2 rows to Bookings')
  assert.equal(confirmLabel('copy', 1, 'Bookings'), 'Copy 1 row to Bookings')
  assert.equal(rowCount(1), '1 row')
  // An operation that no longer exists has no wording waiting for it.
  assert.equal(confirmLabel('duplicate', 3), '')
})

test('a gesture has a size, past which it is not a gesture', () => {
  assert.equal(tooMany(MAX_ROWS_PER_OP), false)
  assert.equal(tooMany(MAX_ROWS_PER_OP + 1), true)
  assert.match(limitNote(500), /200 at a time/)
  assert.equal(limitNote(5), '')
})

// --- ...and the size is the admin's -------------------------------------
// Because the right number is not the same twice. A master register wants
// ten, so a slip with select-all cannot take the month out; a staging tab
// emptied every Friday wants five hundred, where two hundred just means
// doing it three times and losing count.

test('a table with no number set behaves exactly as it always did', () => {
  assert.equal(rowLimitOf({}), MAX_ROWS_PER_OP)
  assert.equal(rowLimitOf(null), MAX_ROWS_PER_OP)
  assert.equal(rowLimitOf({ [ROW_LIMIT]: null }), MAX_ROWS_PER_OP)
})

test('the admin can lower it, which is the point of it being per table', () => {
  assert.equal(rowLimitOf({ [ROW_LIMIT]: 10 }), 10)
  assert.equal(rowLimitOf({ [ROW_LIMIT]: 1 }), 1)
  assert.equal(rowLimitOf({ [ROW_LIMIT]: '25' }), 25)
})

test('...and raise it, as far as the ceiling and not one row past', () => {
  // The ceiling is not a preference. Above it the request itself is the
  // risk: a move is two reads, an append and a delete, and one that runs
  // out of time half way through has landed rows on the other tab and
  // taken none off this one.
  assert.equal(rowLimitOf({ [ROW_LIMIT]: ROW_LIMIT_CEILING }), ROW_LIMIT_CEILING)
  assert.equal(rowLimitOf({ [ROW_LIMIT]: 50_000 }), ROW_LIMIT_CEILING)
  assert.ok(ROW_LIMIT_CEILING > MAX_ROWS_PER_OP)
})

test('a document that says something impossible gets the default', () => {
  // Clamped rather than validated, and clamped in the MODEL, so the page
  // and the server are the same function of the same field rather than
  // two readings that can drift.
  assert.equal(rowLimitOf({ [ROW_LIMIT]: 0 }), MAX_ROWS_PER_OP)
  assert.equal(rowLimitOf({ [ROW_LIMIT]: -5 }), MAX_ROWS_PER_OP)
  assert.equal(rowLimitOf({ [ROW_LIMIT]: 'lots' }), MAX_ROWS_PER_OP)
  assert.equal(rowLimitOf({ [ROW_LIMIT]: 12.9 }), 12)
})

test('the warning quotes whatever this table allows', () => {
  assert.equal(tooMany(11, 10), true)
  assert.equal(tooMany(10, 10), false)
  assert.match(limitNote(40, 10), /10 at a time is the most this table will do/)
  assert.equal(limitNote(40, 500), '')
})

test('the cap is offered only where there is something to cap', () => {
  assert.equal(offersRowOps({}), false)
  assert.equal(offersRowOps({ canClearRows: true }), true)
  assert.equal(offersRowOps({ canDeleteRows: true }), true)
  assert.equal(offersRowOps({ editable: true }), false)
})

test('the reader is warned with the number that will refuse them', () => {
  const bar = read('components/RowActionsBar.jsx')
  assert.ok(bar.includes('const over = tooMany(n, limit)'))
  assert.ok(bar.includes('{limitNote(n, limit)}'))
  const table = read('components/widgets/TableWidget.jsx')
  assert.ok(table.includes('limit={rowLimitOf(widget)}'))
})

test('every operation is held to the table it was launched from', () => {
  // Including the delete, which used to have no reason to look the
  // widget up and so was the one row operation not checked against its
  // table's own switch.
  assert.match(api, /requireSome\(wanted, rowLimitOf\(widget\)\)/)
  assert.match(api, /requireSome\(wanted, rowLimitOf\(tableWidget\(page, body, ref\)\)\)/)
  assert.match(api, /if \(!widget\.canDeleteRows\) throw forbid/)
  assert.equal(/requireSome\(wanted\)/.test(api), false)

  // The number itself comes off the stored widget, never out of the body.
  assert.equal(/rowLimitOf\(body/.test(api), false)
})

test('the sheets layer backstops at the ceiling, not at the default', () => {
  // Anything reaching it that got past a per-table cap is a bug or a
  // crafted request, and either way it is the last thing between that and
  // the spreadsheet.
  assert.match(sheets, /const MAX_BATCH_ROWS = ROW_LIMIT_CEILING/)
})

test('the admin sets it where the switches are, and sees what was clamped', () => {
  const panel = read('pages/admin/WidgetsPanel.jsx')
  assert.ok(panel.includes('{offersRowOps(widget) && ('))
  assert.ok(panel.includes('label="Most rows in one action"'))
  assert.ok(panel.includes('set({ [ROW_LIMIT]: v === \'\' ? null : Number(v) })'))
  // A number that was saved and is not the number being applied has to
  // say so, or the ceiling is a silent disagreement with the form.
  assert.ok(panel.includes('Saved as {widget[ROW_LIMIT]}, applied as {rowLimitOf(widget)}'))
})

// --- the meta keys -------------------------------------------------------

test('the keys that are not columns are listed once', () => {
  // Five separate `!== '_row'` checks worked for exactly as long as there
  // was one such key. A sixth place that had never heard of the second
  // would put a hash in a CSV column.
  assert.deepEqual(META_COLUMNS, ['_row', '_fp'])
  assert.equal(isMetaColumn('_row'), true)
  assert.equal(isMetaColumn('_fp'), true)
  assert.equal(isMetaColumn('Model'), false)
  assert.deepEqual(dataColumns(['_row', 'A', '_fp', 'B']), ['A', 'B'])
})

test('nothing offers a fingerprint as a column any more', () => {
  for (const [file, needle] of [
    ['lib/csv.js', /skip = META_COLUMNS/],
    ['lib/filterEngine.js', /isMetaColumn\(k\)/],
    ['lib/flowDetails.js', /dataColumns\(Object\.keys\(row \|\| \{\}\)\)/],
    ['lib/blend.js', /dataColumns\(rightHeaders\)/],
    ['components/widgets/FlowWidget.jsx', /dataColumns\(Object\.keys\(sample\)\)/],
  ]) {
    assert.match(read(file), needle, `${file} still skips by literal`)
  }
})

// --- the fingerprint -----------------------------------------------------

test('a row that changes stops matching', () => {
  const a = fingerprintValues(['SPLENDOR', '50000', 'Open'])
  assert.equal(fingerprintValues(['SPLENDOR', '50000', 'Open']), a)
  assert.notEqual(fingerprintValues(['SPLENDOR', '50000', 'Closed']), a)
  assert.notEqual(fingerprintValues(['SPLENDOR', '50001', 'Open']), a)
})

test('two cells cannot be spelled as one', () => {
  // The classic way a checksum stops distinguishing the two things it
  // exists to distinguish.
  assert.notEqual(fingerprintValues(['a', 'b']), fingerprintValues(['a b']))
  assert.notEqual(fingerprintValues(['ab', '']), fingerprintValues(['a', 'b']))
})

test('trailing blanks are the same row however Google spelled it', () => {
  // The Sheets API drops trailing empty cells, so the same row comes back
  // shorter or longer depending on what is in the rows around it.
  const a = fingerprintValues(['x', 'y'])
  assert.equal(fingerprintValues(['x', 'y', '']), a)
  assert.equal(fingerprintValues(['x', 'y', '', '', '']), a)
  // A blank in the MIDDLE is not trailing and does change it.
  assert.notEqual(fingerprintValues(['x', '', 'y']), a)
})

test('a blank row and no row are not the same thing', () => {
  assert.equal(fingerprintValues([]), fingerprintValues(['', '']))
  assert.notEqual(fingerprintValues(['0']), fingerprintValues([]))
})

test('null and undefined cells read as empty rather than as words', () => {
  assert.equal(fingerprintValues([null, undefined, 'a']), fingerprintValues(['', '', 'a']))
})

test('it is a fixed-width hex string', () => {
  for (const row of [[], ['a'], ['a'.repeat(500)], ['ü', '漢']]) {
    assert.match(fingerprintValues(row), /^[0-9a-f]{16}$/)
  }
})

// --- what a delete refuses -----------------------------------------------

const sheet = [
  { _row: 2, [FP]: 'aaa' },
  { _row: 3, [FP]: 'bbb' },
  { _row: 4, [FP]: 'ccc' },
]

test('rows that still match are not stale', () => {
  assert.deepEqual(staleRows([{ row: 2, fp: 'aaa' }, { row: 4, fp: 'ccc' }], sheet), [])
})

test('a row somebody has edited since is stale, and is named', () => {
  // The difference between "refresh and look again" and a message nobody
  // can act on.
  assert.deepEqual(staleRows([{ row: 2, fp: 'aaa' }, { row: 3, fp: 'OLD' }], sheet), [3])
})

test('a row that has gone is stale', () => {
  assert.deepEqual(staleRows([{ row: 9, fp: 'zzz' }], sheet), [9])
})

test('sending no fingerprint is not a pass', () => {
  // A caller that omits it is either out of date or hand-made, and either
  // way has not proved anything.
  assert.deepEqual(staleRows([{ row: 2 }], sheet), [2])
  assert.deepEqual(staleRows([{ row: 2, fp: '' }], sheet), [2])
})

// --- the server ----------------------------------------------------------

const api = readApi('sheets.js')
const sheets = readApi('_lib/googleSheets.js')

test('every row operation is authorised on the server', () => {
  // The browser's idea of what it may do decides which buttons it draws and
  // nothing else.
  assert.match(api, /if \(!canDelete\(access, ref, access\.isAdmin\)\) throw forbid/)
  // A copy is authorised against the TARGET, which is where the rows land.
  assert.match(api, /if \(!canAdd\(access, target, access\.isAdmin\)\) throw forbid/)
  // ...and a move needs delete on the source as well, before either half runs.
  assert.match(api, /if \(move && !canDelete\(access, ref, access\.isAdmin\)\)/)
})

test('there is no route that creates a row out of a request body', () => {
  // Rows only ever arrive by being sent from another tab, where the values
  // are read off the source sheet rather than supplied by the browser.
  assert.equal(/op === 'add'/.test(api), false)
  assert.equal(/op === 'duplicate'/.test(api), false)
  assert.equal(/body\.values/.test(api), false)
})

test('a row operation may only touch a ref the page is configured for', () => {
  assert.match(api, /if \(!allowed\.has\(ref\)\)/)
  assert.match(api, /rowOpContext\(uid, pageId, refs/)
})

test('nothing destructive runs against a cached read', () => {
  // Fifteen seconds is long enough for somebody to insert a row in Google,
  // and a delete verified against a cached read is verified against exactly
  // the state that would hide the problem it is checking for.
  assert.match(api, /fetchSheetRows\(sheetId, tab, \{ fresh: true \}\)/)
  // ...and the append reads the target's header row fresh for the same
  // reason: a column added in Google since would put every value one place
  // to the left of where it belongs.
  assert.match(sheets, /await fetchSheetRows\(sheetId, tabName, \{ fresh: true \}\)/)
  // The option exists at all, and defaults to off so ordinary reads keep
  // collapsing a burst of dashboard loads into one Google call.
  assert.match(sheets, /fetchSheetRows\(sheetId, tabName, \{ fresh = false \} = \{\}\)/)
})

test('a delete is verified, and refuses the whole set', () => {
  // Skipping the rows that moved and deleting the rest is the outcome
  // hardest to notice afterwards.
  assert.match(api, /const stale = staleRows\(wanted, sheet\.rows\)/)
  assert.match(api, /err\.statusCode = 409/)
  assert.match(api, /await verifyRows\(/)
})

test('a move re-verifies before it deletes', () => {
  // The append is a round trip, and the rows about to be deleted have to be
  // the rows that were just read.
  const at = api.indexOf('async function copyOp')
  const body = api.slice(at, api.indexOf('function splitList', at))
  assert.equal((body.match(/await verifyRows\(/g) || []).length, 2)
})

test('a copy reads its values from the sheet, not from the request', () => {
  // Or it is an ordinary create wearing a name that stops anybody reviewing
  // it -- and a way to land values on the target nobody could have typed.
  const at = api.indexOf('async function copyOp')
  const body = api.slice(at, api.indexOf('function splitList', at))
  assert.match(body, /byNumber\.get\(row\)/)
})

test('a pair may only aim at a column the reader can write there', () => {
  // The mapping comes from the request, because the reader may adjust the
  // admin's route. That is safe for exactly one reason: a pair can only
  // land on a column they would be allowed to type into on the TARGET, so
  // an adjusted mapping is never more power than they already had.
  assert.match(api, /const allowed = new Set\(writableColumns\(access, target, targetSheet\.headers\)\)/)
  assert.match(api, /const permitted = pairs\.filter\(\(p\) => allowed\.has\(p\.to\)\)/)
  assert.match(api, /mapRow\(byNumber\.get\(row\), permitted\)/)
  assert.match(api, /creatableColumns\(headers, access\.editable\?\.\[ref\] \|\| \[\], access\.isAdmin\)/)
  // ...and a mapping that lands nothing is a refusal rather than an append
  // of empty rows.
  assert.match(api, /None of those columns can be written on that tab/)
})

// --- the mapping itself --------------------------------------------------

test('a destination configured before routes existed still works', () => {
  // It was a bare ref, and it meant "match by name". It still does.
  assert.deepEqual(normalizeRoute('a::Bookings'), { ref: 'a::Bookings', pairs: [] })
  assert.deepEqual(copyRoutesOf({ copyTargets: ['a::B', { ref: 'a::C', pairs: [] }] }), [
    { ref: 'a::B', pairs: [] },
    { ref: 'a::C', pairs: [] },
  ])
})

test('a half-written pair survives being read back', () => {
  // This is what makes "Add column" work at all. The button appends a
  // blank pair and saves it; a normalizer that dropped anything with an
  // empty side deleted the new row before it could be drawn, so the button
  // appeared to do nothing.
  assert.deepEqual(normalizeRoute({ ref: 'x', pairs: [blankPair()] }).pairs, [{ from: '', to: '' }])
  assert.deepEqual(normalizeRoute({ ref: 'x', pairs: [{ from: 'A' }, { to: 'B' }] }).pairs, [
    { from: 'A', to: '' },
    { from: '', to: 'B' },
  ])
  // Junk in the array is still junk.
  assert.deepEqual(normalizeRoute({ ref: 'x', pairs: [null, 'nope', { from: 'A', to: 'B' }] }).pairs, [
    { from: 'A', to: 'B' },
  ])
  assert.deepEqual(blankPair(), { from: '', to: '' })
  assert.deepEqual(routeFor({}, 'x'), { ref: 'x', pairs: [] })
})

test('a row somebody is halfway through typing is not a mapping', () => {
  // Judged on the COMPLETE pairs, not on how long the list is. A route
  // holding one unfinished row has not been mapped yet, and should still
  // match by name rather than silently carrying nothing.
  assert.deepEqual(resolvePairs([blankPair()], ['Shared'], ['Shared']).pairs, [
    { from: 'Shared', to: 'Shared' },
  ])
  // ...and once there IS a real pair, the unfinished one is simply ignored.
  assert.deepEqual(
    resolvePairs([{ from: 'A', to: 'X' }, blankPair()], ['A', 'Shared'], ['X', 'Shared']).pairs,
    [{ from: 'A', to: 'X' }]
  )
})

test('no pairs means match by name, exactly as before', () => {
  const { pairs } = resolvePairs([], ['Model', 'Amount', 'Remark'], ['Model', 'Amount', 'Branch'])
  assert.deepEqual(pairs, [
    { from: 'Model', to: 'Model' },
    { from: 'Amount', to: 'Amount' },
  ])
})

test('pairs, once there, are the WHOLE answer', () => {
  // Not overrides laid over name-matching: that would mean a column
  // carrying because of a rule nobody wrote down, and the only way to stop
  // it would be to invent a pair pointing at nothing.
  const { pairs } = resolvePairs(
    [{ from: 'Quotation No', to: 'Booking Ref' }],
    ['Quotation No', 'Model'],
    ['Booking Ref', 'Model']
  )
  assert.deepEqual(pairs, [{ from: 'Quotation No', to: 'Booking Ref' }])
})

test('a pair naming a column that has gone is dropped and counted', () => {
  // Rather than writing into nowhere, or failing the whole transfer over a
  // field nobody was thinking about.
  const out = resolvePairs(
    [
      { from: 'Model', to: 'Model' },
      { from: 'Deleted', to: 'Model2' },
    ],
    ['Model'],
    ['Model']
  )
  assert.deepEqual(out.pairs, [{ from: 'Model', to: 'Model' }])
  assert.equal(out.unusable.length, 1)
  assert.match(routeNote(out), /1 pair no longer fits/)
})

test('two sources cannot aim at one destination column', () => {
  // Which one wins would be iteration order, and that is not an answer.
  const out = resolvePairs(
    [
      { from: 'A', to: 'X' },
      { from: 'B', to: 'X' },
    ],
    ['A', 'B'],
    ['X']
  )
  assert.deepEqual(out.pairs, [{ from: 'A', to: 'X' }])
  assert.equal(out.unusable.length, 1)
})

test('an unknown header list does not invalidate a pair', () => {
  // A destination that has never been synced is not evidence that the
  // admin's route is wrong.
  const { pairs } = resolvePairs([{ from: 'A', to: 'Whatever' }], ['A'], [])
  assert.deepEqual(pairs, [{ from: 'A', to: 'Whatever' }])
})

test('a row arrives keyed by the TARGET’s column names', () => {
  const row = { _row: 9, [FP]: 'abc', 'Quotation No': 'Q-1', Model: 'SPLENDOR', Amount: '50000' }
  assert.deepEqual(
    mapRow(row, [
      { from: 'Quotation No', to: 'Booking Ref' },
      { from: 'Model', to: 'Model' },
    ]),
    { 'Booking Ref': 'Q-1', Model: 'SPLENDOR' }
  )
  // A source column with no pair is simply absent -- never carried, and
  // never carried as the row's address either.
  assert.deepEqual(mapRow(row, []), {})
  assert.deepEqual(mapRow(row, [{ from: '_row', to: 'Old row' }]), { 'Old row': '' })
})

test('an empty source cell lands as empty rather than as nothing', () => {
  assert.deepEqual(mapRow({ A: undefined }, [{ from: 'A', to: 'B' }]), { B: '' })
})

test('what a route carries is said before it runs', () => {
  assert.match(routeNote({ pairs: [{ from: 'A', to: 'B' }], unusable: [] }), /1 column carries/)
  assert.match(routeNote({ pairs: [], unusable: [] }), /Nothing is mapped/)
})

test('copy and move are two actions, not one with a checkbox on it', () => {
  // Different sentences, one of them takes rows away, and a checkbox is the
  // control people press without reading.
  const bar = read('components/RowActionsBar.jsx')
  assert.match(bar, /label="Copy to…"/)
  assert.match(bar, /label="Move to…"/)
  assert.match(bar, /asking === 'copy' \|\| asking === 'move'/)
  assert.equal(/checked=\{move\} onChange/.test(bar), false)
})

test('the source tab is shown, never chosen', () => {
  // The rows were ticked in one table, so there is exactly one answer and a
  // picker offering it would be a question with no second option -- but a
  // route with only one end named is one nobody can check.
  const bar = read('components/RowActionsBar.jsx')
  assert.match(bar, /sourceLabel \|\| 'this tab'/)
  const table = read('components/widgets/TableWidget.jsx')
  assert.match(table, /sourceLabel=\{widget\.tab\}/)
})

test('a refusal reaches the browser as its own sentence', () => {
  // `return handlePost(...)` inside a try finishes the try block
  // SYNCHRONOUSLY: the promise is handed back and its later rejection lands
  // on whoever called the handler, not in the catch. Every refusal raised
  // deeper in -- the 403s on row operations, the 409 that says the rows
  // have moved, a bad request from Google -- then reaches the browser as an
  // unhandled crash, and the client reports the API as being down.
  //
  // Everything below the handler signals by THROWING, so this one word is
  // what makes any of those messages visible.
  assert.match(api, /if \(req\.method === 'GET'\) return await handleGet/)
  assert.match(api, /if \(req\.method === 'POST'\) return await handlePost/)
  assert.equal(/return handleGet\(req/.test(api), false)
  assert.equal(/return handlePost\(req/.test(api), false)
})

test('the catch turns a statusCode into that status', () => {
  // Or a 403 arrives as a 500 and the browser cannot tell "you may not do
  // this" from "something broke".
  assert.match(api, /const status = e\.statusCode \|\| 500/)
})

test('deletions go downwards, so the indices stay valid', () => {
  // Deleting row 5 moves row 9 to row 8. Ascending, a delete of 5 then 9
  // takes out what used to be row 10.
  assert.match(sheets, /sort\(\(a, b\) => b - a\)/)
  assert.match(sheets, /deleteDimension/)
})

test('the header row cannot be deleted', () => {
  assert.match(sheets, /if \(!Number\.isInteger\(row\) \|\| row < 2\) throw badRequest\('That row cannot be deleted'\)/)
})

// ---------------------------------------------------------------------
// Emptying rows in place
// ---------------------------------------------------------------------
// The operation that is not a smaller Delete. Nothing moves and nothing
// is removed, so the interesting question is not what it does but what it
// refuses to touch: columns this person may not write, and columns a
// record is not allowed to be without.

const clearable = { tab: 'T', editable: true, canClearRows: true }

test('a clear empties what this person may write, and nothing else', () => {
  const plan = clearPlan(clearable, ['Job', 'Status', 'Remarks'], { editable: ['Status', 'Remarks'] })
  assert.deepEqual(plan.clear, ['Status', 'Remarks'])
  assert.deepEqual(plan.locked, ['Job'])
  assert.deepEqual(plan.kept, [])
})

test('an admin may empty every column, exactly as they may write every column', () => {
  const plan = clearPlan(clearable, ['Job', 'Status'], { editable: [], isAdmin: true })
  assert.deepEqual(plan.clear, ['Job', 'Status'])
  assert.deepEqual(plan.locked, [])
})

test('a field a record must always have survives a clear', () => {
  // The whole difference between clearing and deleting. A cleared row is
  // still a row, and one that has lost the field identifying it is worse
  // than one that is gone -- it still looks like a record. The detail
  // form refuses to empty these one at a time; two hundred at once cannot
  // be the way round it.
  const widget = { ...clearable, requiredColumns: ['Job'] }
  const plan = clearPlan(widget, ['Job', 'Status'], { editable: ['Job', 'Status'] })
  assert.deepEqual(plan.clear, ['Status'])
  assert.deepEqual(plan.kept, ['Job'])
})

test('...and it binds an admin too, because it is a rule about the record', () => {
  const widget = { ...clearable, requiredColumns: ['Job'] }
  assert.deepEqual(clearPlan(widget, ['Job', 'Status'], { isAdmin: true }).kept, ['Job'])
})

test('granted nothing here, there is nothing to empty', () => {
  assert.deepEqual(clearPlan(clearable, ['A'], {}).clear, [])
  assert.deepEqual(clearPlan(clearable, [], { editable: ['A'] }).clear, [])
  // A grant for a column the tab no longer has is not a column.
  assert.deepEqual(clearPlan(clearable, ['A'], { editable: ['A', 'Gone'] }).clear, ['A'])
})

test('the button does not appear when it would empty nothing', () => {
  // One that appeared and then emptied nothing would be read as the
  // operation having failed silently.
  const widget = { tab: 'T', editable: true, canClearRows: true }
  const context = (editable, columns = ['Job', 'Status']) => ({
    access: { rowOps: { T: [] }, editable: { T: editable } },
    ref: 'T',
    columns,
  })
  assert.deepEqual(availableActions(widget, context(['Status'])), ['canClearRows'])
  assert.deepEqual(availableActions(widget, context([])), [])
  assert.deepEqual(availableActions(widget, context(['Status'], [])), [])
  assert.deepEqual(availableActions(widget, { ...context([]), isAdmin: true }), ['canClearRows'])
})

test('a clear needs no row grant and no destination', () => {
  // It touches one tab and adds nothing, so neither of the two grants has
  // anything to say about it.
  const widget = { tab: 'T', editable: true, canClearRows: true }
  const held = { access: { rowOps: { T: [] }, editable: { T: ['A'] } }, ref: 'T', columns: ['A'], targets: [] }
  assert.deepEqual(availableActions(widget, held), ['canClearRows'])
  assert.equal(hasRowActions(widget, held), true)
})

test('the dialog says which columns, not how many', () => {
  // "Empties 3 columns" is read as "empties the row" by anybody who has
  // not counted the columns, and a row somebody believes is blank and is
  // not is the failure this has to avoid.
  const note = clearNote({ clear: ['Status', 'Remarks'], kept: [], locked: [] })
  assert.ok(note.startsWith('Empties 2 columns'), note)
  assert.ok(note.includes('Status, Remarks'), note)
  assert.ok(clearNote({ clear: ['Status'] }).startsWith('Empties one column: Status.'))
})

test('...and says what it is leaving behind, and why', () => {
  const note = clearNote({ clear: ['Remarks'], kept: ['Job'], locked: ['Amount', 'Cost'] })
  assert.ok(note.includes('Job stays'), note)
  assert.ok(note.includes('it cannot be left empty'), note)
  assert.ok(note.includes('2 columns are not yours to edit'), note)

  const many = clearNote({ clear: ['A'], kept: ['Job', 'Branch'], locked: ['X'] })
  assert.ok(many.includes('Job and Branch stay'), many)
  assert.ok(many.includes('they cannot be left empty'), many)
  assert.ok(many.includes('1 column is not yours to edit'), many)
})

test('a long list is counted rather than recited', () => {
  assert.ok(clearNote({ clear: ['A', 'B', 'C', 'D', 'E', 'F'] }).includes('A, B, C, D and 2 more'))
})

test('nothing to empty is said as such, not as a clear that did nothing', () => {
  assert.equal(clearNote({ clear: [] }), 'There is nothing here that you can empty.')
  assert.equal(clearNote(), 'There is nothing here that you can empty.')
})

test('the confirm button carries the count, like every other one', () => {
  assert.equal(confirmLabel('clear', 43), 'Clear 43 rows')
  assert.equal(confirmLabel('clear', 1), 'Clear 1 row')
})

// --- and how it is wired -------------------------------------------------

test('the bar asks before it empties anything', () => {
  const bar = read('components/RowActionsBar.jsx')
  assert.ok(bar.includes("setAsking('clear')"))
  assert.ok(bar.includes('function ConfirmClear('))
  assert.ok(bar.includes('{clearNote(clearing)}'))
  assert.ok(bar.includes('run(onClearRows)'))
  // The X on the right clears the SELECTION, and is a different handler
  // however alike the two are named.
  assert.ok(bar.includes('aria-label="Clear the selection"'))
  assert.ok(bar.includes('onClick={onClear} '))
})

test('the table works the columns out from the same model the server uses', () => {
  const table = read('components/widgets/TableWidget.jsx')
  assert.ok(table.includes('clearPlan(widget, tabHeaders || [], { editable: editableColumns, isAdmin })'))
  assert.ok(table.includes('onClearRows(widget.tab, rowRefs(chosenRows), { widget: widget.id })'))
})

test('the browser says which rows, and nothing about which columns', () => {
  // Sending the column list would make the grant a suggestion.
  const client = read('lib/sheetsApi.js')
  assert.match(client, /op: 'clear', page: pageId, ref, rows, widget/)
})

// --- the server ----------------------------------------------------------

const clearOp = () => api.slice(api.indexOf('async function clearOp'), api.indexOf('async function copyOp'))

test('a clear is refused unless the stored table offers it', () => {
  // Read off the saved widget, like a transfer's route, so a crafted
  // request cannot switch an operation on for a table whose admin left it
  // off.
  const body = clearOp()
  assert.match(body, /const widget = tableWidget\(page, body, ref\)/)
  assert.match(body, /if \(!widget\.canClearRows\) throw forbid/)
  assert.match(body, /if \(!widget\.editable\) throw forbid/)
})

test('a clear derives its columns from the grants, never from the request', () => {
  const body = clearOp()
  assert.match(body, /clearPlan\(widget, sheet\.headers, \{/)
  assert.match(body, /editable: access\.editable\?\.\[ref\] \|\| \[\]/)
  assert.match(body, /if \(clear\.length === 0\) throw forbid/)
  // Only the rows come out of the body.
  assert.match(body, /wanted\.map\(\(w\) => w\.row\)/)
})

test('a clear proves the rows are still the rows, exactly as a delete does', () => {
  // Clearing the wrong rows is as bad as deleting the right number of
  // wrong ones, and it cannot be undone either.
  const body = clearOp()
  assert.match(body, /await verifyRows\(sheetId, tab, wanted\)/)
  assert.match(body, /requireSome\(wanted, rowLimitOf\(widget\)\)/)
})

test('the sheet is cleared, not overwritten with empty strings', () => {
  // They look the same in the cell and are not the same thing: a written
  // '' is a value, and it turns "is this blank" -- in a formula, in a
  // filter, in the next COUNTA somebody writes -- into a question with
  // the wrong answer.
  const at = sheets.indexOf('export async function clearRows')
  const body = sheets.slice(at, sheets.indexOf('export function ascendingRuns', at))
  assert.match(body, /values:batchClear/)
  assert.equal(/valueInputOption/.test(body), false)
  // Columns are found in the sheet's own header row, never by an index
  // from the caller.
  assert.match(body, /sheet\.headers\.indexOf\(name\)/)
  assert.match(body, /row < 2\) throw badRequest\('That row cannot be cleared'\)/)
  // Rows and columns each collapse into runs, and the ranges are the
  // rectangles they make.
  assert.match(body, /for \(const \[rowStart, rowEnd\] of ascendingRuns\(wanted\)\)/)
  assert.match(body, /for \(const \[colStart, colEnd\] of ascendingRuns\(indexes\)\)/)
})

test('a clear moves nothing, so its runs read the way a range does', () => {
  // `mergeRuns` goes downwards because a delete shifts what is below it.
  // Nothing shifts here, so these are ascending -- and the two must not
  // be confused, which is why they are separate functions rather than one
  // with a flag.
  const at = sheets.indexOf('export function ascendingRuns')
  const body = sheets.slice(at, sheets.indexOf('export function mergeRuns', at))
  assert.match(body, /sort\(\(a, b\) => a - b\)/)
  assert.match(body, /last\[1\] === n - 1/)
})
