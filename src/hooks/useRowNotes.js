import { useCallback, useEffect, useMemo, useState } from 'react'
import { arrayRemove, arrayUnion, collection, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext.jsx'
import { noteDoc, remarkDoc } from '../lib/rowNotes'

/**
 * Every note on one tab, live.
 *
 * ONE listener per tab, not one per row. A table showing 25 rows would
 * otherwise open 25 subscriptions, tear them all down on the next page, and
 * open 25 more -- for a feature most rows do not use.
 *
 * The query is constrained by `scope` so it passes the `list` rule (which
 * Firestore evaluates per document, and which rejects the whole query if any
 * one document fails -- see firestore.rules). Rows are narrowed for a scoped
 * user in the browser, not on the server, so this reaches nothing the page
 * has not already fetched.
 *
 * `enabled` is false for every table that has not switched remarks on, which
 * is the normal case: no listener, no reads, no cost.
 */
export function useRowNotes(scope, enabled) {
  const { user } = useAuth()
  const [notes, setNotes] = useState({})
  const [error, setError] = useState('')

  useEffect(() => {
    if (!enabled || !scope || !user?.uid) {
      setNotes({})
      return undefined
    }
    setError('')
    return onSnapshot(
      query(collection(db, 'rowNotes'), where('scope', '==', scope)),
      (snap) => {
        const out = {}
        for (const d of snap.docs) out[d.id] = { id: d.id, ...d.data() }
        setNotes(out)
      },
      (e) => setError(e?.message || 'Remarks could not be loaded')
    )
  }, [scope, enabled, user?.uid])

  return { notes, error }
}

/**
 * Writing one.
 *
 * `setDoc(..., { merge: true })` rather than update-or-create: the note
 * document does not exist until somebody writes the first remark, and
 * checking first would be a read on every row anybody ever opened plus a
 * race between two people writing the first one at the same moment.
 *
 * `arrayUnion` for the same reason -- two people adding a remark within a
 * second of each other both keep theirs, where read-modify-write would have
 * the second one overwrite the first.
 */
export function useRowNoteActions() {
  const { user, userDoc } = useAuth()

  const me = useMemo(
    () => ({ uid: user?.uid || '', name: userDoc?.name || user?.displayName || user?.email || '' }),
    [user?.uid, user?.displayName, user?.email, userDoc?.name]
  )

  const addRemark = useCallback(
    async (id, { scope, key, text }) => {
      if (!id || !me.uid) return null
      const remark = remarkDoc(text, me)
      await setDoc(
        doc(db, 'rowNotes', id),
        { ...noteDoc(scope, key), remarks: arrayUnion(remark) },
        { merge: true }
      )
      return remark
    },
    [me]
  )

  /**
   * Taking one back.
   *
   * `arrayRemove` matches on the whole object, so the exact remark that was
   * read is the exact remark that goes -- an identical sentence written by
   * somebody else at a different moment is a different object and stays.
   */
  const removeRemark = useCallback(
    async (id, remark) => {
      if (!id || !remark) return
      await setDoc(doc(db, 'rowNotes', id), { remarks: arrayRemove(remark) }, { merge: true })
    },
    []
  )

  return { addRemark, removeRemark, me }
}
