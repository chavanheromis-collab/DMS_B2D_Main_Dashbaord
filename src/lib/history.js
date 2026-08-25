// ---------------------------------------------------------------------
// Undo and redo
// ---------------------------------------------------------------------
// Exploring a flow is a sequence of small, cheap decisions -- open that,
// break it down by this instead, zoom into there, hide the hairlines. Cheap
// to make and, until now, expensive to take back: there was no way to
// return to the tree you were looking at four clicks ago except to
// reconstruct it from memory, and the reason people stop exploring a drill
// tool is that every click feels like it might cost them their place.
//
// So the whole exploration is one value, and every change pushes the
// previous one onto a stack. Ctrl+Z walks back up it, Ctrl+Y walks forward.
//
// Pure: a past, a present and a future, in and out. The widget holds it in
// state and the reducer is testable without one.

export const HISTORY_LIMIT = 60

export const emptyHistory = (present) => ({ past: [], present, future: [] })

/**
 * A new present, with the old one remembered.
 *
 * A change that changes nothing is not remembered -- otherwise re-selecting
 * the sort you already had costs an undo, and the reader presses Ctrl+Z
 * expecting to move and nothing happens.
 *
 * Doing something new discards the future, which is what everybody expects
 * from undo everywhere else: you cannot redo a branch you have stepped off.
 */
export function commitHistory(history, next, isEqual = Object.is) {
  if (isEqual(history.present, next)) return history
  const past = [...history.past, history.present]
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    present: next,
    future: [],
  }
}

export function canUndo(history) {
  return history.past.length > 0
}

export function canRedo(history) {
  return history.future.length > 0
}

export function undoHistory(history) {
  if (!canUndo(history)) return history
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
  }
}

export function redoHistory(history) {
  if (!canRedo(history)) return history
  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1),
  }
}

/** Back to where this started, keeping the way back to where you were. */
export function resetHistory(history, initial) {
  return commitHistory(history, initial)
}

/**
 * What a key press means.
 *
 * Ctrl+Y and Ctrl+Shift+Z are both redo, because Windows learnt one and the
 * Mac learnt the other and no reader should have to know which application
 * they are in.
 */
export function historyKeyAction(e) {
  if (!(e.ctrlKey || e.metaKey)) return null
  const key = String(e.key || '').toLowerCase()
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (key === 'y') return 'redo'
  return null
}
