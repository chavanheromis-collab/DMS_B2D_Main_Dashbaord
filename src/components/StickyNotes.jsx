import { useEffect, useRef, useState } from 'react'
import { useTypingBuffer } from '../hooks/useTypingBuffer'
import { X } from 'lucide-react'
import {
  colourOf,
  keepWritten,
  moveNote,
  NOTE_H,
  NOTE_W,
  removeNote,
  STICKY_COLOURS,
  STICKY_INK,
  tiltOf,
  updateNote,
} from '../lib/stickyNotes'

/** Below this, a press is a click on the note rather than a drag of it. */
const DRAG_THRESHOLD = 3

/**
 * One person's sticky notes, on the page they were stuck to.
 *
 * A layer over the canvas rather than a widget in it: a note is about the
 * dashboard, not part of it, and it belongs wherever its writer put it --
 * over a chart, in a margin, on top of two widgets at once. See
 * lib/stickyNotes.js for why they are personal.
 *
 * It is drawn as PAPER, not as a panel: a lean, a strip of tape, a shadow
 * that falls the way a stuck-on thing casts one. That is not decoration --
 * it is what makes a note read as somebody's writing ON the dashboard
 * rather than as another widget in it, which is the whole point of the
 * feature. The chrome stays out of the way until the pointer arrives, so
 * what is on screen at rest is the writing and nothing else.
 *
 * `onNotes` is handed the whole list, because every gesture here changes
 * one note and the document holds them together.
 */
/**
 * The writing on one note.
 *
 * Its own component with its own buffer, and that is the whole point: the
 * notes live in PAGE state, so a controlled textarea handed every keystroke
 * upward re-rendered every widget on the canvas -- twenty charts over
 * thousands of rows -- before the letter appeared. Typing quickly then drops
 * characters, because the next keystroke lands while the browser is still
 * drawing the last one.
 *
 * Now the note owns what is being typed and the page hears about it when
 * the typing pauses, or when the writer looks away. See
 * hooks/useTypingBuffer.js.
 */
function NoteText({ note, onText, onDone }) {
  const [text, onType, flush] = useTypingBuffer(note.text, onText)
  return (
    <textarea
      value={text}
      onChange={(e) => onType(e.target.value)}
      onBlur={() => {
        flush()
        onDone()
      }}
      placeholder="Write a note…"
      className="min-h-0 flex-1 resize-none bg-transparent px-3 pb-3 pt-1 text-[12.5px] leading-[1.45] tracking-[0.01em] outline-none placeholder:text-black/25"
      style={{ color: STICKY_INK }}
    />
  )
}

export default function StickyNotes({ notes, onNotes, canvasWidth = 0, hidden = false }) {
  // The drag lives in a ref and is mirrored into state: the pointer
  // handlers fire between renders and must see the move that just
  // happened, not the one React has drawn.
  const dragRef = useRef(null)
  const [drag, setDrag] = useState(null)

  // Read by the handlers, which are bound once and outlive any one note.
  const latest = useRef({ notes, canvasWidth })
  latest.current = { notes, canvasWidth }
  const commit = useRef(onNotes)
  commit.current = onNotes

  useEffect(() => {
    const move = (event) => {
      const d = dragRef.current
      if (!d) return
      const next = { ...d, dx: event.clientX - d.startX, dy: event.clientY - d.startY }
      dragRef.current = next
      setDrag(next)
    }

    const up = () => {
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d) return
      if (Math.abs(d.dx) < DRAG_THRESHOLD && Math.abs(d.dy) < DRAG_THRESHOLD) return
      const moved = moveNote(d.note, d.dx, d.dy, latest.current.canvasWidth)
      commit.current?.(updateNote(latest.current.notes, d.note.id, { x: moved.x, y: moved.y }))
    }

    // On the note alone, a hand that outruns it mid-drag would drop it there.
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])

  const startDrag = (event, note) => {
    if (event.button !== 0) return
    event.preventDefault()
    const d = { note, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0 }
    dragRef.current = d
    setDrag(d)
  }

  // Hidden is not deleted. The notes are still there, still saved, still on
  // the page the moment they are asked for again -- so putting them away is
  // a thing somebody will actually do, rather than a decision they have to
  // weigh against losing them.
  if (hidden || !notes?.length) return null

  return (
    // No pointer events on the layer itself, or it would swallow every
    // click meant for the dashboard underneath it.
    <div className="no-print pointer-events-none absolute inset-0 z-30">
      {notes.map((note) => {
        const skin = colourOf(note.colour)
        const held = drag?.note.id === note.id
        const dx = held ? drag.dx : 0
        const dy = held ? drag.dy : 0
        const tilt = tiltOf(note.id)
        return (
          <div
            key={note.id}
            className={`sticky-note pointer-events-auto group/note absolute flex flex-col ${
              held ? 'z-10' : ''
            }`}
            style={{
              left: note.x,
              top: note.y,
              width: NOTE_W,
              minHeight: NOTE_H,
              background: `linear-gradient(160deg, ${skin.bg} 0%, ${skin.bg} 62%, ${skin.edge}44 100%)`,
              color: STICKY_INK,
              // Picked up, it straightens and rises -- which is what a hand
              // lifting a piece of paper off a wall actually does.
              transform: held
                ? `translate(${dx}px, ${dy}px) rotate(0deg) scale(1.03)`
                : `rotate(${tilt}deg)`,
            }}
          >
            {/* A strip of tape. The one detail that makes the difference
                between paper stuck on and a pale rectangle. */}
            <span
              aria-hidden
              className="sticky-tape pointer-events-none absolute -top-2 left-1/2 h-4 w-12 -translate-x-1/2 -rotate-1 rounded-[1px]"
            />

            {/* The head is the handle. Dragging the writing instead would
                mean you could not select a word in it. */}
            <div
              onPointerDown={(event) => startDrag(event, note)}
              className={`flex items-center gap-1 px-2 pt-2 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/note:opacity-100 ${
                held ? 'cursor-grabbing opacity-100' : 'cursor-grab'
              }`}
            >
              {STICKY_COLOURS.map((c) => (
                <button
                  key={c.value}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => onNotes(updateNote(notes, note.id, { colour: c.value }))}
                  title={c.label}
                  aria-label={c.label}
                  className={`h-2.5 w-2.5 rounded-full ring-1 transition-transform hover:scale-150 ${
                    note.colour === c.value ? 'ring-black/40' : 'ring-black/10'
                  }`}
                  style={{ background: c.edge }}
                />
              ))}
              {/* Cancel. No confirmation: being asked "are you sure?" about
                  a scrap of paper is worse than losing one. */}
              <button
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onNotes(removeNote(notes, note.id))}
                title="Take this note down"
                className="ml-auto rounded-full p-0.5 text-black/30 transition-colors hover:bg-black/5 hover:text-rose-600"
              >
                <X size={12} />
              </button>
            </div>

            <NoteText
              note={note}
              // Through the refs the drag handlers already use, so a
              // note committed after a pause is merged into the list as it
              // is NOW -- not the one captured when this note was drawn.
              onText={(text) => commit.current(updateNote(latest.current.notes, note.id, { text }))}
              // A note nobody wrote on disappears when they look away,
              // rather than sitting there as a blank square.
              onDone={() => commit.current(keepWritten(latest.current.notes))}
            />

            {/* The corner lifting off the wall. Drawn with a gradient
                rather than an image, so it costs nothing and takes the
                note's own colour. */}
            <span aria-hidden className="sticky-curl pointer-events-none absolute bottom-0 right-0" />
          </div>
        )
      })}
    </div>
  )
}
