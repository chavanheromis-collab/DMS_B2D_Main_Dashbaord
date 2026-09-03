// ---------------------------------------------------------------------
// Sticky notes on a dashboard
// ---------------------------------------------------------------------
// A note somebody puts on the glass: "check this against the invoice
// register", "Ravi is chasing the RTO on these". Not data, not a widget --
// a reminder, stuck to the page where the thing it is about is.
//
// PERSONAL, and stored with the rest of one person's page preferences at
// `userPrefs/{uid}_{pageId}`. Three reasons, and the third is the one that
// matters:
//
//   A NOTE IS A REMINDER, not a report. Somebody writing "ask Ravi" on the
//   sales page is talking to themselves, and putting it on everyone's
//   screen would make them stop writing them.
//
//   IT NEEDS NO NEW PERMISSION. That document is already the one collection
//   an ordinary user may write to, and it is already scoped to their own
//   uid -- so this works the moment it ships rather than after a rules
//   deployment.
//
//   AND IT FOLLOWS THEM. A note written on a desktop is there on the tablet,
//   which is what makes it worth writing rather than a scrap of paper.
//
// Pure: notes in, notes out. Nothing here touches Firestore.

/**
 * The five colours a note may be.
 *
 * Five, not a colour picker. A note is a scrap of paper, and the whole use
 * of the colour is telling one pile from another at a glance -- which a
 * hundred shades of yellow cannot do. Every one is pale enough to take the
 * same near-black writing, so no note is ever unreadable.
 */
export const STICKY_COLOURS = [
  { value: 'yellow', label: 'Yellow', bg: '#FEF3C7', edge: '#FCD34D' },
  { value: 'pink', label: 'Pink', bg: '#FCE7F3', edge: '#F9A8D4' },
  { value: 'blue', label: 'Blue', bg: '#DBEAFE', edge: '#93C5FD' },
  { value: 'green', label: 'Green', bg: '#DCFCE7', edge: '#86EFAC' },
  { value: 'purple', label: 'Purple', bg: '#EDE9FE', edge: '#C4B5FD' },
]

/** The writing on every one of them. Chosen once, so none can be illegible. */
export const STICKY_INK = '#1E293B'

/** How big a note is, before anybody stretches it. */
export const NOTE_W = 190
export const NOTE_H = 150

/**
 * How far a note leans, in degrees.
 *
 * Nobody sticks a piece of paper on perfectly straight, and a wall of
 * notes at exactly 0 degrees reads as a grid of boxes rather than as
 * paper. A degree or two each way is the whole difference.
 *
 * Worked out FROM THE ID rather than at random, so a note does not shuffle
 * every time React draws it -- which would be the one thing more distracting
 * than all of them being straight.
 */
export function tiltOf(id) {
  let hash = 0
  for (const ch of String(id || '')) hash = (hash * 31 + ch.charCodeAt(0)) % 1000
  // -2 to +2, in half degrees. Any more and it stops reading as paper and
  // starts reading as a mistake.
  return (hash % 9) / 2 - 2
}

/** The colour a note is, falling back rather than drawing an invisible one. */
export function colourOf(value) {
  return STICKY_COLOURS.find((c) => c.value === value) || STICKY_COLOURS[0]
}

const int = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

/** A blank note, ready to be written on. */
export function newNote({ x = 24, y = 24, colour = STICKY_COLOURS[0].value } = {}) {
  return {
    id: `note_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`,
    text: '',
    x: int(x),
    y: int(y),
    colour: colourOf(colour).value,
  }
}

/**
 * The notes on a page, as they can actually be drawn.
 *
 * A stored note missing a field -- written by an older version, or edited
 * by hand -- is repaired rather than dropped. Somebody's reminder is not
 * something to throw away over a missing number.
 */
export function readNotes(stored) {
  return (Array.isArray(stored) ? stored : [])
    .filter((n) => n && n.id)
    .map((n) => ({
      id: String(n.id),
      text: typeof n.text === 'string' ? n.text : '',
      x: int(n.x),
      y: int(n.y),
      colour: colourOf(n.colour).value,
    }))
}

/**
 * A note kept on the page.
 *
 * Never off the left or the top, and never so far right that only its edge
 * shows -- a note you cannot read is a note you cannot pick up again. The
 * bottom is deliberately unbounded: a page scrolls, and a note at the
 * bottom of a long one is a note about the bottom of a long one.
 */
export function clampNote(note, canvasWidth = 0) {
  const width = canvasWidth > 0 ? canvasWidth : null
  return {
    ...note,
    x: Math.max(0, width === null ? int(note.x) : Math.min(int(note.x), width - NOTE_W)),
    y: Math.max(0, int(note.y)),
  }
}

/** Where a note ends up after being dragged. */
export function moveNote(note, dx, dy, canvasWidth = 0) {
  return clampNote({ ...note, x: int(note.x) + int(dx), y: int(note.y) + int(dy) }, canvasWidth)
}

/** One note changed, the rest untouched. */
export function updateNote(notes, id, patch) {
  return (notes || []).map((n) => (n.id === id ? { ...n, ...patch } : n))
}

/**
 * A note taken down.
 *
 * There is no undo and there is deliberately no confirmation either: a
 * sticky note is a scrap of paper, and being asked "are you sure?" about a
 * scrap of paper is worse than losing one.
 */
export function removeNote(notes, id) {
  return (notes || []).filter((n) => n.id !== id)
}

/**
 * A blank note is not a note.
 *
 * Called on the way out, so a note somebody started and thought better of
 * disappears by itself rather than sitting on the page as an empty yellow
 * square nobody can identify. It is also what makes "cancel" honest: the
 * note is gone because there was nothing on it.
 */
export function keepWritten(notes) {
  return (notes || []).filter((n) => String(n.text || '').trim() !== '')
}
