import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  clampNote,
  colourOf,
  keepWritten,
  moveNote,
  newNote,
  NOTE_W,
  readNotes,
  removeNote,
  STICKY_COLOURS,
  STICKY_INK,
  tiltOf,
  updateNote,
} from './stickyNotes.js'

// ---------------------------------------------------------------------
// The colours
// ---------------------------------------------------------------------

test('there are a handful of colours, not a colour picker', () => {
  // The whole use of the colour is telling one pile from another at a
  // glance, which a hundred shades of yellow cannot do.
  assert.ok(STICKY_COLOURS.length >= 4 && STICKY_COLOURS.length <= 6)
})

test('every colour is a real one, named and drawable', () => {
  const seen = new Set()
  for (const c of STICKY_COLOURS) {
    assert.match(c.bg, /^#[0-9A-Fa-f]{6}$/, c.value)
    assert.match(c.edge, /^#[0-9A-Fa-f]{6}$/, c.value)
    assert.ok(c.label, c.value)
    assert.ok(!seen.has(c.value), `${c.value} twice`)
    seen.add(c.value)
  }
})

test('every colour is pale enough for the one ink they all share', () => {
  // Chosen once, so no note can ever be illegible -- which is what lets the
  // writing be a constant rather than a sixth decision per note.
  const light = (hex) => {
    const n = parseInt(hex.slice(1), 16)
    // Rec. 601 luma, the same rough measure the page backdrop uses.
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  }
  assert.ok(light(STICKY_INK) < 0.4, 'the ink is dark')
  for (const c of STICKY_COLOURS) assert.ok(light(c.bg) > 0.8, `${c.value} is too dark for it`)
})

test('an unknown colour falls back rather than drawing nothing', () => {
  assert.equal(colourOf('chartreuse').value, STICKY_COLOURS[0].value)
  assert.equal(colourOf(undefined).value, STICKY_COLOURS[0].value)
  assert.equal(colourOf('blue').value, 'blue')
})

// ---------------------------------------------------------------------
// The lean
// ---------------------------------------------------------------------

test('a note leans a little, because nobody sticks paper on straight', () => {
  // A wall of notes at exactly 0 degrees reads as a grid of boxes.
  const tilts = ['a', 'b', 'c', 'd', 'e', 'f', 'note_x1', 'note_x2'].map(tiltOf)
  assert.ok(new Set(tilts).size > 1, 'not all the same')
})

test('and never so far that it reads as a mistake rather than as paper', () => {
  for (const id of ['a', 'zzzz', 'note_9f3a2b1', '', 'ключ']) {
    const t = tiltOf(id)
    assert.ok(t >= -2 && t <= 2, `${id} leans ${t}`)
  }
})

test('the same note leans the same way every time it is drawn', () => {
  // Random would mean a note shuffling on every render, which is the one
  // thing more distracting than all of them being straight.
  assert.equal(tiltOf('note_abc'), tiltOf('note_abc'))
  assert.equal(tiltOf(undefined), tiltOf(undefined))
})

// ---------------------------------------------------------------------
// Making one
// ---------------------------------------------------------------------

test('a new note is blank, placed, and one of the colours', () => {
  const n = newNote({ x: 40, y: 80, colour: 'green' })
  assert.equal(n.text, '')
  assert.deepEqual([n.x, n.y], [40, 80])
  assert.equal(n.colour, 'green')
  assert.match(n.id, /^note_/)
})

test('two notes made at once are two notes', () => {
  assert.notEqual(newNote().id, newNote().id)
})

test('a note made with nonsense still lands somewhere real', () => {
  const n = newNote({ x: 'over there', y: null, colour: 'chartreuse' })
  assert.deepEqual([n.x, n.y], [0, 0])
  assert.equal(n.colour, STICKY_COLOURS[0].value)
})

// ---------------------------------------------------------------------
// Reading them back
// ---------------------------------------------------------------------

test('a note missing a field is repaired, not thrown away', () => {
  // Somebody's reminder is not something to discard over a missing number.
  const out = readNotes([{ id: 'a' }])
  assert.deepEqual(out, [{ id: 'a', text: '', x: 0, y: 0, colour: STICKY_COLOURS[0].value }])
})

test('and one with no id at all is not a note', () => {
  assert.deepEqual(readNotes([{ text: 'orphan' }, null, { id: 'a', text: 'keep' }]).map((n) => n.id), ['a'])
})

test('nothing stored is no notes, not a crash', () => {
  assert.deepEqual(readNotes(undefined), [])
  assert.deepEqual(readNotes(null), [])
  assert.deepEqual(readNotes('notes'), [])
})

test('the text is kept exactly as it was written', () => {
  const out = readNotes([{ id: 'a', text: '  chase the RTO  ' }])
  assert.equal(out[0].text, '  chase the RTO  ', 'spacing is the writer’s business')
})

// ---------------------------------------------------------------------
// Moving one
// ---------------------------------------------------------------------

const note = { id: 'a', text: 'x', x: 100, y: 100, colour: 'yellow' }

test('a note goes where it is dragged', () => {
  assert.deepEqual(
    [moveNote(note, 40, 60).x, moveNote(note, 40, 60).y],
    [140, 160]
  )
})

test('and never off the left or the top of the page', () => {
  const out = moveNote(note, -900, -900)
  assert.deepEqual([out.x, out.y], [0, 0])
})

test('nor so far right that only its edge shows', () => {
  // A note you cannot read is a note you cannot pick up again.
  const out = moveNote(note, 9999, 0, 1000)
  assert.equal(out.x, 1000 - NOTE_W)
})

test('but it may go as far down as it likes', () => {
  // A page scrolls, and a note at the bottom of a long one is a note about
  // the bottom of a long one.
  assert.equal(moveNote(note, 0, 9999).y, 10099)
})

test('an unmeasured page does not squash every note into the corner', () => {
  assert.equal(moveNote(note, 500, 0, 0).x, 600)
})

test('a page narrower than a note still leaves it on the page', () => {
  assert.equal(clampNote({ ...note, x: 500 }, 100).x, 0)
})

// ---------------------------------------------------------------------
// Changing and taking down
// ---------------------------------------------------------------------

const notes = [note, { id: 'b', text: 'y', x: 0, y: 0, colour: 'blue' }]

test('one note changes and the rest do not', () => {
  const out = updateNote(notes, 'b', { text: 'changed' })
  assert.equal(out[1].text, 'changed')
  assert.equal(out[0].text, 'x')
  assert.equal(out[1].colour, 'blue', 'and it keeps everything it was not asked about')
})

test('changing a note that is not there changes nothing', () => {
  assert.deepEqual(updateNote(notes, 'gone', { text: 'no' }), notes)
})

test('a note taken down is gone, with no ceremony', () => {
  // Being asked "are you sure?" about a scrap of paper is worse than losing
  // one.
  assert.deepEqual(removeNote(notes, 'a').map((n) => n.id), ['b'])
  assert.deepEqual(removeNote(notes, 'gone'), notes)
  assert.deepEqual(removeNote(undefined, 'a'), [])
})

test('a note nobody wrote on disappears by itself', () => {
  // What makes "cancel" honest: the note is gone because there was nothing
  // on it, rather than sitting there as an empty square nobody can place.
  const out = keepWritten([note, { id: 'b', text: '   ', x: 0, y: 0, colour: 'blue' }, { id: 'c', text: '' }])
  assert.deepEqual(out.map((n) => n.id), ['a'])
})

test('...and a note with only spaces counts as blank', () => {
  assert.deepEqual(keepWritten([{ id: 'a', text: ' \n\t ' }]), [])
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const read = (p) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

test('notes live with the rest of one person’s page settings', () => {
  // That document is already the one collection an ordinary user may write
  // to, and it is already scoped to their own uid -- so this needs no new
  // permission and works the moment it ships.
  const prefs = read('src/hooks/useUserPrefs.js')
  // The write itself, not just the name of the function that does it.
  assert.ok(
    prefs.includes(
      "await setDoc(doc(db, 'userPrefs', id), stripUndefined({ notes: readNotes(notes) }), { merge: true })"
    )
  )
  // ...and repaired on the way IN as well as out, so one note written by an
  // older version cannot take the page down with it.
  assert.ok(prefs.includes('notes: readNotes(prefs?.notes),'))
})

test('a note is dragged by its head, not by its writing', () => {
  // Dragging the textarea would mean you could not select a word in it.
  const notes = read('src/components/StickyNotes.jsx')
  assert.ok(notes.includes('onPointerDown={(event) => startDrag(event, note)}'))
  assert.ok(notes.includes('<textarea'))
})

test('the drag is finished on the window, not on the note', () => {
  const notes = read('src/components/StickyNotes.jsx')
  assert.ok(notes.includes("window.addEventListener('pointermove', move)"))
  assert.ok(notes.includes("window.addEventListener('pointerup', up)"))
  assert.ok(notes.includes("window.removeEventListener('pointerup', up)"))
})

test('cancel takes the note down there and then', () => {
  const notes = read('src/components/StickyNotes.jsx')
  assert.ok(notes.includes('onNotes(removeNote(notes, note.id))'))
})

test('and a note nobody wrote on is dropped on the way out', () => {
  const notes = read('src/components/StickyNotes.jsx')
  assert.ok(notes.includes('keepWritten('))
})

test('every colour offered is one a note can actually be', () => {
  const notes = read('src/components/StickyNotes.jsx')
  assert.ok(notes.includes('STICKY_COLOURS.map('))
  assert.ok(notes.includes('colourOf(note.colour)'))
})

test('the page offers a way to stick one on', () => {
  const dash = read('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('const addNote = () =>'))
  assert.ok(dash.includes('onClick={addNote}'))
  // On every page and not only while arranging: a reminder is worth
  // writing exactly when you are reading, not when you are rearranging.
  assert.ok(!/\{editing && [^}]*onClick=\{addNote\}/.test(dash))
})

test('a second note does not land exactly on the first', () => {
  // Otherwise adding three in a row looks like adding one.
  const dash = read('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('const step = (notes?.length || 0) % 6'))
  assert.ok(dash.includes('newNote({ x: 24 + step * 26, y: 24 + step * 22 })'))
})

test('the notes layer takes no clicks meant for the dashboard', () => {
  // A full-page overlay that swallowed clicks would make every widget
  // under it unusable.
  const notes = read('src/components/StickyNotes.jsx')
  assert.ok(notes.includes('pointer-events-none absolute inset-0'))
  assert.ok(notes.includes('sticky-note pointer-events-auto group/note absolute flex flex-col'))
})

test('a page with no notes draws no layer at all', () => {
  const notes = read('src/components/StickyNotes.jsx')
  assert.ok(notes.includes('if (hidden || !notes?.length) return null'))
})

test('putting the notes away keeps them', () => {
  // Hidden is not deleted: they are still saved and come back untouched,
  // which is what makes putting them away something somebody will do
  // rather than a decision weighed against losing them.
  const notes = read('src/components/StickyNotes.jsx')
  assert.ok(notes.includes('if (hidden || !notes?.length) return null'))
  assert.ok(!notes.includes('removeNote(notes)'), 'hiding removes nothing')
  const dash = read('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('hidden={notesHidden}'))
  assert.ok(dash.includes('onClick={() => setNotesHidden(!notesHidden)}'))
})

test('and writing a new one brings them back first', () => {
  // Adding a note while they are put away would write into thin air.
  const dash = read('src/pages/Dashboard.jsx')
  const at = dash.indexOf('const addNote = () =>')
  assert.ok(dash.slice(at, at + 320).includes('setNotesHidden(false)'))
})

test('the show/hide is only offered once there is something to put away', () => {
  // A control for nothing has to be read before it can be ignored.
  const dash = read('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('{notes.length > 0 && ('))
})

test('putting them away is a per-browser thing, not a saved decision', () => {
  // "Get these out of my way for a minute", not something to sync to a
  // tablet somebody left in the office.
  const dash = read('src/pages/Dashboard.jsx')
  assert.ok(dash.includes("useLocalState('dash.notesHidden', false)"))
})

test('a note is drawn as paper, which is what keeps it from reading as a widget', () => {
  const notes = read('src/components/StickyNotes.jsx')
  assert.ok(notes.includes('tiltOf(note.id)'), 'it leans')
  assert.ok(notes.includes('sticky-tape'), 'it is taped on')
  assert.ok(notes.includes('sticky-curl'), 'its corner lifts')
  const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
  // Two shadows, as everything else here has: a tight one for the contact
  // edge and a wide soft one for the height off the wall.
  const rule = css.slice(css.indexOf('.sticky-note {'), css.indexOf('.sticky-note:hover'))
  assert.equal(rule.split('rgb(15 23 42 /').length, 3)
})

test('picking a note up straightens it, the way a hand does', () => {
  const notes = read('src/components/StickyNotes.jsx')
  assert.ok(notes.includes('rotate(0deg) scale(1.03)'))
  assert.ok(notes.includes('rotate(${tilt}deg)'))
})

test('the chrome stays out of the way until the pointer arrives', () => {
  // What is on screen at rest is the writing and nothing else.
  const notes = read('src/components/StickyNotes.jsx')
  assert.ok(notes.includes('opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/note:opacity-100'))
})

test('somebody who asked for less movement gets less movement', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
  const flat = css.replace(/\s+/g, ' ')
  assert.ok(flat.includes('@media (prefers-reduced-motion: reduce) { .sticky-note { transition: none; } }'))
})

test('the colour dots and the close do not start a drag', () => {
  // They sit ON the handle, so without this every click on one would also
  // pick the note up.
  const notes = read('src/components/StickyNotes.jsx')
  assert.equal(notes.split('onPointerDown={(event) => event.stopPropagation()}').length, 3)
})
