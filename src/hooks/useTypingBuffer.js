import { useEffect, useRef, useState } from 'react'

/**
 * How long after the last keystroke the rest of the app hears about it.
 *
 * Long enough that a word is one update rather than five; short enough that
 * a live preview still reads as live.
 */
export const TYPING_PAUSE = 140

/**
 * A text field that types at the speed of the keyboard, not the speed of
 * the page.
 *
 * The problem this exists for: a controlled input hands every keystroke to
 * whoever owns the value, and on this dashboard that owner is very often
 * something enormous. A sticky note lives in page state, so a letter typed
 * on it re-rendered every widget on the canvas -- twenty charts, over
 * thousands of rows -- before the letter appeared. A cell being edited
 * lives in the table's state, so a letter re-drew four hundred rows. Fast
 * typing then drops characters, because the keystroke arrives while the
 * browser is still busy with the one before it.
 *
 * So the field owns what is being typed, and the owner is told when the
 * typing pauses. Three things make that safe rather than merely fast:
 *
 *   IT FLUSHES ON THE WAY OUT. Blurring, closing a panel, unmounting --
 *   people finish by leaving, and a buffer that only committed on a timer
 *   would lose the last word every time.
 *
 *   IT YIELDS TO SOMEBODY ELSE'S CHANGE. An undo, a reset, a different
 *   widget opened in the same form: if the incoming value is not the one
 *   this field last sent, what is on screen is theirs and the buffer takes
 *   it. Without that check the field would fight its own echo.
 *
 *   IT NEVER SENDS WHAT IT ALREADY SENT. Which is what stops the flush on
 *   unmount from re-committing a value the timer already delivered.
 *
 * Returns `[text, onType, flush]`: the value to render, a handler for the
 * input's `onChange`, and the commit to hang on `onBlur`.
 */
export function useTypingBuffer(value, onChange, { pause = TYPING_PAUSE } = {}) {
  const incoming = value ?? ''
  const [text, setText] = useState(incoming)
  const timer = useRef(null)
  // The latest of each, so a flush on the way out never fires a stale
  // handler or re-delivers a value that already went.
  const latest = useRef({ text: incoming, onChange, sent: incoming })
  latest.current.onChange = onChange

  useEffect(() => {
    if (incoming === latest.current.sent) return
    latest.current.sent = incoming
    latest.current.text = incoming
    setText(incoming)
  }, [incoming])

  const send = (next) => {
    clearTimeout(timer.current)
    if (next === latest.current.sent) return
    latest.current.sent = next
    latest.current.onChange?.(next)
  }

  useEffect(
    () => () => {
      clearTimeout(timer.current)
      if (latest.current.text !== latest.current.sent) {
        latest.current.sent = latest.current.text
        latest.current.onChange?.(latest.current.text)
      }
    },
    []
  )

  const onType = (next) => {
    setText(next)
    latest.current.text = next
    clearTimeout(timer.current)
    timer.current = setTimeout(() => send(next), pause)
  }

  return [text, onType, () => send(latest.current.text)]
}
