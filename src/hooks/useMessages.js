import { useCallback, useEffect, useMemo, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext.jsx'
import { messageDoc, replyDoc, withId } from '../lib/messages'

/**
 * The messages this person can see, live.
 *
 * TWO queries, deliberately. Firestore evaluates a `list` rule against every
 * document a query would return and rejects the whole query if any of them
 * fails -- rules narrow nothing. So asking for "all messages" and letting
 * the rule sort it out fails for everybody who is not an admin.
 *
 * Instead the client asks two questions it is already allowed to ask:
 * addressed to me, and addressed to everyone. Both are constrained by a
 * `where` that guarantees every returned document passes the rule, and the
 * two results are merged here. See firestore.rules.
 *
 * A sent message comes back through the first query, because the sender's
 * own uid goes into `to` -- which is also what lets them see the replies.
 */
export function useMessages() {
  const { user } = useAuth()
  const uid = user?.uid

  const [mine, setMine] = useState([])
  const [everyone, setEveryone] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!uid) {
      setMine([])
      setEveryone([])
      setLoading(false)
      return undefined
    }

    setLoading(true)
    const rows = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    // A rejected query is a rule problem, not a network one, and it is
    // silent unless somebody says so.
    const fail = (e) => setError(e?.message || 'Messages could not be loaded')

    const stopMine = onSnapshot(
      query(collection(db, 'messages'), where('to', 'array-contains', uid)),
      (snap) => {
        setMine(rows(snap))
        setLoading(false)
      },
      fail
    )
    const stopAll = onSnapshot(
      query(collection(db, 'messages'), where('audience', '==', 'all')),
      (snap) => {
        setEveryone(rows(snap))
        setLoading(false)
      },
      fail
    )

    return () => {
      stopMine()
      stopAll()
    }
  }, [uid])

  // A message to everyone that also names you arrives down both listeners.
  const messages = useMemo(() => {
    const byId = new Map()
    for (const m of [...mine, ...everyone]) byId.set(m.id, m)
    return [...byId.values()]
  }, [mine, everyone])

  return { messages, loading, error }
}

/**
 * Sending, marking and replying.
 *
 * Separate from the reading hook so a component that only shows messages
 * does not re-render every time one of these functions is rebuilt.
 */
export function useMessageActions() {
  const { user, userDoc } = useAuth()

  const sender = useMemo(
    () => ({ uid: user?.uid, name: userDoc?.name || user?.displayName, email: user?.email }),
    [user, userDoc]
  )

  const send = useCallback(
    async (draft) => {
      if (!sender.uid) throw new Error('Not signed in')
      const document = messageDoc(draft, sender)
      // The sender is a recipient of their own message. Not vanity: it is
      // what puts it in their own list, and the rules only let somebody read
      // what they are addressed in -- without this they could not see the
      // replies to their own question.
      if (document.audience !== 'all') document.to = withId(document.to, sender.uid)
      return addDoc(collection(db, 'messages'), document)
    },
    [sender]
  )

  const markRead = useCallback(
    async (message) => {
      if (!sender.uid || !message?.id) return
      if ((message.readBy || []).includes(sender.uid)) return
      await updateDoc(doc(db, 'messages', message.id), { readBy: withId(message.readBy, sender.uid) })
    },
    [sender.uid]
  )

  const dismiss = useCallback(
    async (message) => {
      if (!sender.uid || !message?.id) return
      await updateDoc(doc(db, 'messages', message.id), {
        dismissedBy: withId(message.dismissedBy, sender.uid),
        readBy: withId(message.readBy, sender.uid),
      })
    },
    [sender.uid]
  )

  const reply = useCallback(
    async (message, text) => {
      if (!sender.uid || !message?.id || !String(text || '').trim()) return
      await updateDoc(doc(db, 'messages', message.id), {
        replies: [...(message.replies || []), replyDoc(text, sender)],
        readBy: withId(message.readBy, sender.uid),
      })
    },
    [sender]
  )

  const unsend = useCallback(
    async (message) => {
      if (!message?.id) return
      await deleteDoc(doc(db, 'messages', message.id))
    },
    []
  )

  return { send, markRead, dismiss, reply, unsend, sender }
}

/**
 * Everybody who could be sent something.
 *
 * The user list is readable by any signed-in user already -- the admin panel
 * has always listed it -- so this needs no new permission. Only ACTIVE
 * people: sending to somebody still waiting for approval is a message that
 * arrives at an account that cannot open the page it is about.
 */
export function usePeople() {
  const { user } = useAuth()
  const [people, setPeople] = useState([])

  useEffect(() => {
    if (!user?.uid) return undefined
    return onSnapshot(
      collection(db, 'users'),
      (snap) => {
        setPeople(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((u) => u.role === 'admin' || u.status === 'active')
            .sort((a, b) => String(a.name || a.email || '').localeCompare(String(b.name || b.email || '')))
        )
      },
      () => setPeople([])
    )
  }, [user?.uid])

  const byId = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people])
  return { people, byId }
}
