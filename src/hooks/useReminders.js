import { useCallback, useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext.jsx'
import {
  answered,
  ended,
  firstOccurrence,
  newReminder,
  pruneReminders,
  readReminders,
  replaceReminder,
  snoozed,
  withoutReminder,
} from '../lib/reminders'

/**
 * One person's reminders, live, at `userPrefs/{uid}_reminders`.
 *
 * The same collection and the same rule as their widget order and their
 * sticky notes -- the id starts with the uid, so a user reads and writes
 * only their own. No new collection and no new rule: a reminder grants
 * nothing and is seen by nobody else, which is exactly the shape that
 * rule was written for.
 *
 * ONE document rather than one per reminder. They are read together,
 * written together, and there are at most a few dozen; a collection would
 * buy nothing and cost a `list` rule, which is the rule that is hard to
 * get right.
 */
export function useReminders() {
  const { user } = useAuth()
  const uid = user?.uid
  const id = uid ? `${uid}_reminders` : null

  const [stored, setStored] = useState([])

  useEffect(() => {
    if (!id) {
      setStored([])
      return undefined
    }
    return onSnapshot(
      doc(db, 'userPrefs', id),
      (snap) => setStored(readReminders(snap.exists() ? snap.data()?.reminders : [])),
      // Unreadable is empty, not broken. A reminder is a convenience and
      // must never be the reason a dashboard will not load.
      () => setStored([])
    )
  }, [id])

  /**
   * Write the list back, pruned.
   *
   * Pruning on every write rather than on a schedule: there is no server
   * here to run one, and the moment somebody ticks a reminder off is
   * exactly the moment the list is in hand and worth tidying.
   */
  const save = useCallback(
    async (next) => {
      if (!id) return
      await setDoc(doc(db, 'userPrefs', id), { reminders: pruneReminders(next) }, { merge: true })
    },
    [id]
  )

  const add = useCallback(
    async (text, at, options = {}) => {
      // A repeating one whose first time has gone starts at the NEXT
      // occurrence -- choosing "every day at nine" at ten past nine means
      // tomorrow, not a refusal and not an alarm a second later.
      const first = firstOccurrence({ at, ...options }, Date.now()) || at
      const reminder = newReminder(text, first, Date.now(), options)
      // Optimistic: the snapshot will confirm it a moment later, but the
      // chip appearing the instant it is set is what makes this feel like
      // an alarm clock rather than a form.
      setStored((list) => [...list, reminder])
      await save([...stored, reminder])
      return reminder
    },
    [save, stored]
  )

  const snooze = useCallback(
    async (reminder, minutes) => {
      const next = replaceReminder(stored, snoozed(reminder, minutes))
      setStored(next)
      await save(next)
    },
    [save, stored]
  )

  /**
   * Done.
   *
   * Which means two different things, and the model decides which: a
   * one-off is finished, a series moves to its next occurrence. A Done
   * that quietly cancelled a daily routine would be found out a week
   * later, by somebody wondering why it stopped.
   */
  const complete = useCallback(
    async (reminder) => {
      const next = replaceReminder(stored, answered(reminder))
      setStored(next)
      await save(next)
    },
    [save, stored]
  )

  /** Done, and never again -- the other half of Done, for a series. */
  const stop = useCallback(
    async (reminder) => {
      const next = replaceReminder(stored, ended(reminder))
      setStored(next)
      await save(next)
    },
    [save, stored]
  )

  const remove = useCallback(
    async (reminderId) => {
      const next = withoutReminder(stored, reminderId)
      setStored(next)
      await save(next)
    },
    [save, stored]
  )

  return useMemo(
    () => ({ reminders: stored, add, snooze, complete, stop, remove, ready: Boolean(id) }),
    [stored, add, snooze, complete, stop, remove, id]
  )
}

/**
 * The clock, as state.
 *
 * Everything about a reminder is "is it time yet", and nothing re-renders
 * React on its own when a minute passes. Ticking every fifteen seconds
 * rather than every second: the finest thing anybody can set is a minute,
 * so a second-by-second render is fifty-nine renders that change nothing,
 * and fifteen seconds is the most an alarm can be late by.
 */
export function useNow(everyMs = 15000) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = window.setInterval(tick, everyMs)
    // A laptop that was shut does not run intervals. Coming back to the
    // tab has to re-read the clock immediately, or a reminder that came
    // due during the lid being closed waits another fifteen seconds to
    // notice -- and, worse, the interval may have drifted by hours.
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
    }
  }, [everyMs])

  return now
}
