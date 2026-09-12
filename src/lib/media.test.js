import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  MEDIA_COLUMNS,
  MEDIA_KINDS,
  canShow,
  extensionOf,
  fileNameOf,
  hasMedia,
  isMediaColumn,
  kindOf,
  mediaColumnsOf,
  mediaLabel,
  mediaOf,
  mediaUrl,
  previewUrl,
  stepMedia,
  tileSize,
  viewerFor,
} from './media.js'

// ---------------------------------------------------------------------
// Files in a cell
// ---------------------------------------------------------------------
// A column of links is the commonest thing in a real sheet -- the damage
// photo, the signed delivery note, the invoice PDF -- and until now the
// only thing to do with one was download it and open something else.
//
// What is worth testing is not that an <img> renders. It is the three
// judgements underneath: which columns this applies to (the admin's, not
// a guess), what a link turns out to BE, and what can honestly be shown
// versus what can only be opened.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const DRIVE = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing'

// --- which columns -------------------------------------------------------

test('the admin says which columns hold files, and nothing else does', () => {
  // A dashboard that turned every column of URLs into thumbnails the day
  // this shipped would have redesigned itself -- and a long link in a
  // narrow column is sometimes exactly what somebody wants to read.
  assert.deepEqual(mediaColumnsOf({ [MEDIA_COLUMNS]: ['Photo', 'Invoice'] }), ['Photo', 'Invoice'])
  assert.deepEqual(mediaColumnsOf({}), [])
  assert.deepEqual(mediaColumnsOf(null), [])
  assert.equal(isMediaColumn({ [MEDIA_COLUMNS]: ['Photo'] }, 'Photo'), true)
  assert.equal(isMediaColumn({ [MEDIA_COLUMNS]: ['Photo'] }, 'Amount'), false)
})

// --- what a link is ------------------------------------------------------

test('the kind comes from the link, not from a second setting', () => {
  // One column very often holds both: the "Attachment" column always
  // does, and an admin who promised "these are all images" would be
  // wrong by Tuesday.
  assert.equal(kindOf('https://x.com/a/damage.JPG'), 'image')
  assert.equal(kindOf('https://x.com/a/invoice.pdf'), 'pdf')
  assert.equal(kindOf('https://x.com/a/walkaround.mp4'), 'video')
  assert.equal(kindOf('https://x.com/a/call.m4a'), 'audio')
  assert.equal(kindOf('https://x.com/page'), 'link')
  assert.equal(kindOf(''), '')
})

test('a query string is not a file type', () => {
  // Half the links in a real sheet keep an access token after the ?, and
  // a hash is a page number.
  assert.equal(extensionOf('https://x.com/a/photo.png?token=abc.def'), 'png')
  assert.equal(extensionOf('https://x.com/a/invoice.pdf#page=2'), 'pdf')
  assert.equal(extensionOf('https://x.com/folder.v2/file'), '')
  assert.equal(extensionOf(''), '')
})

test('a Drive link is its own kind, because it says nothing about itself', () => {
  // It never has an extension. Drive renders a thumbnail of whatever it
  // holds and previews every type it knows, so it needs none.
  assert.equal(kindOf(DRIVE), 'drive')
  assert.equal(kindOf('https://drive.google.com/open?id=1AbCdEfGhIjKlMn'), 'drive')
  // Even when it does have one, Drive's own viewer is the one that works.
  assert.equal(kindOf('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?name=x.pdf'), 'drive')
})

test('only what a browser will actually fetch gets through', () => {
  // A cell is data somebody typed into a spreadsheet, and it lands in an
  // `src` here.
  assert.equal(mediaUrl('https://x.com/a.png'), 'https://x.com/a.png')
  assert.equal(mediaUrl('  https://x.com/a.png  '), 'https://x.com/a.png')
  assert.equal(mediaUrl('javascript:alert(1)'), '')
  assert.equal(mediaUrl('file:///etc/passwd'), '')
  assert.equal(mediaUrl('data:text/html,<script>'), '')
  assert.equal(mediaUrl('data:image/png;base64,AAA'), 'data:image/png;base64,AAA')
  assert.equal(mediaUrl('just some text'), '')
})

// --- what is on a row ----------------------------------------------------

test('one cell can hold several files, which is what a sheet looks like', () => {
  // The moment somebody has two photos of the same damage.
  const row = { Photo: 'https://x.com/a.png,\nhttps://x.com/b.png', Invoice: 'https://x.com/i.pdf' }
  const found = mediaOf(row, ['Photo', 'Invoice'])
  assert.deepEqual(
    found.map((m) => [m.column, m.kind, m.name]),
    [
      ['Photo', 'image', 'a.png'],
      ['Photo', 'image', 'b.png'],
      ['Invoice', 'pdf', 'i.pdf'],
    ]
  )
})

test('an empty cell, or one holding rubbish, contributes nothing', () => {
  const row = { Photo: '   ', Invoice: 'not a link', Other: 'https://x.com/a.png' }
  assert.deepEqual(mediaOf(row, ['Photo', 'Invoice']), [])
  assert.equal(hasMedia(row, ['Photo', 'Invoice']), false)
  assert.equal(hasMedia(row, ['Other']), true)
  assert.deepEqual(mediaOf(null, ['Photo']), [])
  assert.deepEqual(mediaOf({}, []), [])
})

test('the file keeps its own name, for the label and the download', () => {
  assert.equal(fileNameOf('https://x.com/a/Damage%20front.jpg'), 'Damage front.jpg')
  assert.equal(fileNameOf('https://x.com/a/'), '')
  assert.equal(fileNameOf('https://x.com/a/', 'Photo'), 'Photo')
  // A name that is not valid percent-encoding is still a name.
  assert.equal(fileNameOf('https://x.com/100%.pdf'), '100%.pdf')
})

// --- what can be shown ---------------------------------------------------

test('a picture is previewed, and so is anything Drive holds', () => {
  // Drive renders the first page of a PDF, which is the single most
  // useful thing here: "is this the right invoice" is answered by
  // looking, not by downloading.
  assert.match(previewUrl({ url: DRIVE, kind: 'drive' }, 96), /drive\.google\.com\/thumbnail\?id=1AbCdEfGhIjKlMn/)
  assert.match(previewUrl({ url: 'https://x.com/a.png', kind: 'image' }), /a\.png/)
  // A PDF that is NOT on Drive cannot be drawn, and says so by returning
  // nothing rather than by rendering a broken image.
  assert.equal(previewUrl({ url: 'https://x.com/a.pdf', kind: 'pdf' }), '')
  assert.equal(previewUrl({ url: 'https://x.com/a.mp4', kind: 'video' }), '')
  assert.equal(previewUrl(null), '')
})

test('a Drive file opens in Drive own viewer, not at the file', () => {
  // The direct link to a Drive PDF does not render -- it downloads.
  const view = viewerFor({ url: DRIVE, kind: 'drive' })
  assert.equal(view.mode, 'frame')
  assert.equal(view.src, 'https://drive.google.com/file/d/1AbCdEfGhIjKlMn/preview')
})

test('everything else opens as what it is', () => {
  assert.deepEqual(viewerFor({ url: 'https://x.com/a.png', kind: 'image' }), {
    mode: 'image',
    src: 'https://x.com/a.png',
  })
  assert.equal(viewerFor({ url: 'https://x.com/a.pdf', kind: 'pdf' }).mode, 'frame')
  assert.equal(viewerFor({ url: 'https://x.com/a.mp4', kind: 'video' }).mode, 'video')
  assert.equal(viewerFor({ url: 'https://x.com/a.mp3', kind: 'audio' }).mode, 'audio')
  // A link this app cannot render is honest about it rather than showing
  // an empty frame.
  assert.equal(viewerFor({ url: 'https://x.com/page', kind: 'link' }).mode, 'none')
  assert.equal(canShow({ url: 'https://x.com/page', kind: 'link' }), false)
  assert.equal(canShow({ url: 'https://x.com/a.png', kind: 'image' }), true)
  assert.equal(viewerFor(null).mode, 'none')
})

test('every kind has a label and an icon of its own', () => {
  // A row of identical grey squares is a row that has to be clicked to
  // be read.
  const icons = new Set()
  for (const [kind, spec] of Object.entries(MEDIA_KINDS)) {
    assert.ok(spec.label, kind)
    assert.ok(spec.icon, kind)
    icons.add(spec.icon)
  }
  assert.equal(icons.size, Object.keys(MEDIA_KINDS).length, 'two kinds share an icon')
  assert.equal(mediaLabel({ column: 'Damage photo', kind: 'image' }), 'Damage photo · Image')
  assert.equal(mediaLabel({ kind: 'pdf' }), 'PDF')
  assert.equal(mediaLabel(null), 'File')
})

// --- moving between them -------------------------------------------------

test('paging through a row files wraps, rather than stopping at a wall', () => {
  // Three photos of the same damage are looked at in a loop.
  assert.equal(stepMedia(0, 3, 1), 1)
  assert.equal(stepMedia(2, 3, 1), 0)
  assert.equal(stepMedia(0, 3, -1), 2)
  // One file has nowhere to go, so the arrows can hide themselves.
  assert.equal(stepMedia(0, 1, 1), 0)
  assert.equal(stepMedia(0, 0, 1), 0)
})

test('a tile is sized by how many are beside it', () => {
  // One fixed size either wastes half a card on a single thumbnail or
  // shows six pictures too small to recognise.
  assert.ok(tileSize(1) > tileSize(3))
  assert.ok(tileSize(3) > tileSize(6))
  assert.ok(tileSize(0) > 0)
})

// --- and how it is wired -------------------------------------------------

const table = read('components/widgets/TableWidget.jsx')
const cards = read('components/widgets/CardGrid.jsx')
const viewer = read('components/MediaViewer.jsx')
const panel = read('pages/admin/WidgetsPanel.jsx')

test('the cell shows the file rather than its address', () => {
  // A 90-character Drive link tells nobody whether it is the right
  // invoice. The first page of it does.
  assert.ok(table.includes('mediaCols.includes(col) ? mediaOf(row, [col]) : []'))
  assert.ok(table.includes('<MediaStrip items={files} size={28}'))
})

test('opening one file opens the whole row, at that file', () => {
  // A record with three photos is looked at as three photos, not by
  // closing and reopening twice.
  assert.ok(table.includes('const all = mediaOf(row, mediaCols)'))
  assert.ok(table.includes('all.findIndex((m) => m.url === item.url && m.column === item.column)'))
  assert.ok(table.includes('<MediaViewer'))
  // The card view opens the SAME viewer, from the same state.
  assert.ok(table.includes('onViewMedia={(row, item) => {'))
})

test('the viewer pages, and says where it is', () => {
  assert.ok(viewer.includes('stepMedia(index, items.length, 1)'))
  assert.ok(viewer.includes("if (e.key === 'ArrowRight')"))
  assert.ok(viewer.includes("if (e.key === 'Escape') onClose()"))
  assert.ok(viewer.includes('{index + 1} / {items.length}'))
})

test('a file that cannot be shown is not shown as a broken frame', () => {
  // A link this app cannot render is still a link that works.
  assert.ok(viewer.includes('function Unshowable('))
  assert.ok(viewer.includes('This one cannot be shown here'))
  // ...and an image that fails on the way in falls back to the same card
  // rather than to a broken-image glyph.
  assert.ok(viewer.includes('onError={() => setFailed(true)}'))
})

test('what is drawn is drawn, and the rest says which kind it is', () => {
  assert.ok(viewer.includes('const thumb = previewUrl(item, size)'))
  assert.ok(viewer.includes('<MediaIcon kind={item.kind}'))
  // A PDF whose first page is drawn still has to say it is a PDF: a page
  // of text at 40px is a grey rectangle.
  assert.ok(viewer.includes("drawable && item.kind !== 'image' && ("))
  // Google refuses images carrying a referrer it does not know, which is
  // every deployment of this.
  assert.ok(viewer.includes('referrerPolicy="no-referrer"'))
})

test('the card draws them, and the zoom draws them bigger', () => {
  // A card is a thing you look at rather than read, and the photo IS the
  // record in a way its file name never is.
  assert.ok(cards.includes('const files = mediaOf(row, mediaCols)'))
  assert.ok(cards.includes('size={tileSize(files.length)}'))
  assert.ok(cards.includes('<MediaStrip items={files} size={96}'))
  // Above the fields IN THE ZOOM: somebody who opened a record to look
  // at the photo should not read past eleven rows of text to reach it.
  // Measured inside that component, since the card below has a field
  // list of its own further up the file.
  const zoom = cards.slice(cards.indexOf('function CardZoom('))
  assert.ok(zoom.indexOf('size={96}') < zoom.indexOf('{lines.map('))
})

test('the overflow is counted, not wrapped onto a second line', () => {
  // In a table cell a second line changes the height of every row; on a
  // card it pushes the fields off the bottom.
  assert.ok(viewer.includes('const shown = items.slice(0, max)'))
  assert.ok(viewer.includes('+{rest}'))
})

test('the admin marks them where the other link settings are', () => {
  // Showing a file and downloading one are two things to want from the
  // same link, so they are two lists rather than one switch.
  assert.ok(panel.includes('mediaColumnsOf(widget).includes(col)'))
  assert.ok(panel.includes('[MEDIA_COLUMNS]: on ? current.filter((c) => c !== col) : [...current, col]'))
  assert.ok(panel.includes('Show these columns as the file itself'))
  // The tab counts both, so a table with media but no downloads does not
  // read as "Files: off".
  assert.ok(panel.includes('badge: (widget.downloadButtons ? 1 : 0) + mediaColumnsOf(widget).length'))
})
