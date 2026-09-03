import { useCallback, useEffect, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { stripUndefined } from '../lib/firestoreSafe'
import { readNotes } from '../lib/stickyNotes'

/**
 * One user's personal settings for one page, at `userPrefs/{uid}_{pageId}`.
 *
 * Two things: widget ORDER -- each user can type a position number against
 * any widget and see the canvas in the arrangement that suits their job --
 * and their own STICKY NOTES on that page. Both are the same kind of thing:
 * one person's view of a dashboard everybody shares.
 *
 * Firestore rather than localStorage on purpose -- a rep who arranges their
 * dashboard on a desktop should find the same arrangement on a tablet. The
 * security rule lets a user write only their own document, so this is the
 * one collection ordinary users may write to.
 *
 * Returns { prefs, setWidgetOrder, clearOrder, loading }.
 */
export function useUserPrefs(uid, pageId) {
  const [prefs, setPrefs] = useState(null)
  const [loading, setLoading] = useState(true)

  const id = uid && pageId ? `${uid}_${pageId}` : null

  useEffect(() => {
    if (!id) {
      setPrefs(null)
      setLoading(false)
      return undefined
    }
    setLoading(true)
    return onSnapshot(
      doc(db, 'userPrefs', id),
      (snap) => {
        setPrefs(snap.exists() ? snap.data() : null)
        setLoading(false)
      },
      // Personal preferences are a convenience, never a gate: if they can't
      // be read the page must still render in its admin-defined order.
      () => {
        setPrefs(null)
        setLoading(false)
      }
    )
  }, [id])

  const setWidgetOrder = useCallback(
    async (widgetId, position) => {
      if (!id) return
      const next = { ...(prefs?.widgetOrder || {}) }
      // An empty box means "no opinion", which must REMOVE the override
      // rather than store a zero -- otherwise clearing a number would pin
      // the widget to the very front.
      if (position === '' || position === null || position === undefined) delete next[widgetId]
      else next[widgetId] = Number(position)
      await setDoc(doc(db, 'userPrefs', id), stripUndefined({ widgetOrder: next }), { merge: true })
    },
    [id, prefs]
  )

  const clearOrder = useCallback(async () => {
    if (!id) return
    await setDoc(doc(db, 'userPrefs', id), { widgetOrder: {} }, { merge: true })
  }, [id])

  const setNotes = useCallback(
    async (notes) => {
      if (!id) return
      await setDoc(doc(db, 'userPrefs', id), stripUndefined({ notes: readNotes(notes) }), { merge: true })
    },
    [id]
  )

  return {
    prefs,
    widgetOrder: prefs?.widgetOrder || {},
    setWidgetOrder,
    clearOrder,
    // Repaired on the way IN as well as out: a note written by an older
    // version, or edited by hand, is somebody's reminder and not something
    // to throw away over a missing number.
    notes: readNotes(prefs?.notes),
    setNotes,
    loading,
  }
}

/**
 * One user's own order for the SIDEBAR, at `userPrefs/{uid}_pages`.
 *
 * The same collection and the same rule as the per-page settings above --
 * the id still starts with the uid, so a user still writes only their own
 * document -- but keyed on the workspace rather than on a page, because the
 * order of the pages is not a property of any one of them.
 *
 * A rep who lives in two of nine dashboards can put those two at the top
 * without asking anybody, and without changing what anybody else sees.
 */
export function usePagePrefs(uid) {
  const [order, setOrder] = useState(null)
  const id = uid ? `${uid}_pages` : null

  useEffect(() => {
    if (!id) {
      setOrder(null)
      return undefined
    }
    return onSnapshot(
      doc(db, 'userPrefs', id),
      (snap) => setOrder(snap.exists() ? snap.data()?.pageOrder || null : null),
      // A preference is a convenience, never a gate: unreadable means the
      // sidebar shows the workspace order, not an error.
      () => setOrder(null)
    )
  }, [id])

  const setPageOrder = useCallback(
    async (next) => {
      if (!id) return
      await setDoc(doc(db, 'userPrefs', id), stripUndefined({ pageOrder: next || {} }), { merge: true })
    },
    [id]
  )

  const clearPageOrder = useCallback(async () => {
    if (!id) return
    await setDoc(doc(db, 'userPrefs', id), { pageOrder: {} }, { merge: true })
  }, [id])

  return { pageOrder: order || {}, setPageOrder, clearPageOrder }
}

// Re-exported so callers can pull the hook and the ordering it feeds from
// one place, while the ordering itself stays pure and testable in lib/.
export { orderWidgets } from '../lib/widgetOrder'
