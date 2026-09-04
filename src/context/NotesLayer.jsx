import { createContext, useContext, useMemo } from 'react'

const NotesLayerContext = createContext(null)

/**
 * The reader's own sticky notes, reachable from inside a widget.
 *
 * The notes belong to the PAGE and are drawn as one layer over the whole
 * canvas -- which works until a widget fills the screen, at which point the
 * layer is behind it and the notes are simply gone. That is exactly when
 * somebody is reading closely enough to want them.
 *
 * A widget that takes over the screen therefore draws the same layer inside
 * itself. Not a copy: the same list, the same writer, the same document, so
 * moving a note in full screen moves it on the page and nothing has to be
 * reconciled afterwards.
 *
 * A context rather than props because the alternative is threading four
 * values through every widget on the canvas to reach the one or two that
 * can go full screen -- and the next widget that can would have to be
 * threaded again.
 *
 * `null` outside a dashboard (the admin preview, a test) means "no notes
 * here", which every consumer must handle: it is the normal case for most
 * of the app.
 */
export function NotesLayerProvider({ notes, onNotes, canvasWidth = 0, hidden = false, onHidden, children }) {
  const value = useMemo(
    () => ({ notes: notes || [], onNotes, canvasWidth, hidden, onHidden }),
    [notes, onNotes, canvasWidth, hidden, onHidden]
  )
  return <NotesLayerContext.Provider value={value}>{children}</NotesLayerContext.Provider>
}

export function useNotesLayer() {
  return useContext(NotesLayerContext)
}
