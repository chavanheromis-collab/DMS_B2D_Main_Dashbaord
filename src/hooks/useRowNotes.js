import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext.jsx'
import { editedRemark, noteDoc, remarkDoc } from '../lib/rowNotes'

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

  /**
   * Changing the words of one of your own.
   *
   * A TRANSACTION, and the only one in this file. `arrayUnion` and
   * `arrayRemove` are transforms on the same field, and Firestore will not
   * apply two of them in one write -- so an edit has to send the whole list,
   * which means reading it first. Doing that with a plain get-then-set would
   * quietly discard any remark somebody else added in between; a transaction
   * re-reads and retries instead.
   *
   * The replacement keeps `by`, `byName` and `at` (see `editedRemark`), so
   * this cannot re-sign or re-date anything. The rules check that too --
   * see firestore.rules.
   */
  const editRemark = useCallback(
    async (id, remark, text) => {
      if (!id || !remark || !me.uid) return null
      const next = editedRemark(remark, text)
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'rowNotes', id)
        const snap = await tx.get(ref)
        if (!snap.exists()) throw new Error('That remark is no longer there')
        const list = Array.isArray(snap.data().remarks) ? snap.data().remarks : []
        // Matched on the whole remark, so an identical sentence written by
        // somebody else at a different moment is a different object and is
        // left alone.
        const at = list.findIndex(
          (r) => r.by === remark.by && r.at === remark.at && r.text === remark.text
        )
        if (at === -1) throw new Error('That remark is no longer there')
        const updated = [...list]
        updated[at] = next
        tx.update(ref, { remarks: updated })
      })
      return next
    },
    [me]
  )

  return { addRemark, editRemark, removeRemark, me }
}
