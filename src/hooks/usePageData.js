import { useCallback, useEffect, useRef, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { fetchPageData } from '../lib/sheetsApi'

/**
 * Loads every tab a page needs -- across every spreadsheet it draws on -- in
 * ONE request, and keeps them in a single map keyed by ref.
 *
 * Nothing here picks an "active" tab or an active spreadsheet. All the refs
 * a page's widgets mention are fetched together and each widget just reaches
 * into `tabs[itsOwnRef]`, so a KPI reading Quotations from the sales sheet
 * and a table reading MASTER from the service sheet render side by side, at
 * the same time, on the same canvas. The server batches per spreadsheet, so
 * three sources cost three Google round-trips, not one per tab.
 *
 * Returns { tabs, loading, error, reload, lastLoaded }
 *   tabs = { [ref]: { headers, rows, error? } }
 */
export function usePageData(getIdToken, pageId, refs, canView) {
  const [tabs, setTabs] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastLoaded, setLastLoaded] = useState(null)

  const key = [...new Set(refs || [])].sort().join('|')
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    if (!pageId || !canView || !key) {
      // Counted as a request, and one nothing can answer. Without the bump,
      // a read already in flight for the PREVIOUS page still matches the
      // request id when it lands, and paints that page's rows -- which is
      // the case where `canView` has just gone false.
      requestRef.current += 1
      setTabs({})
      setLoading(false)
      return
    }
    const requestId = ++requestRef.current
    setLoading(true)
    setError(null)
    try {
      const idToken = await getIdToken()
      const result = await fetchPageData(idToken, pageId, key.split('|'))
      // Ignore a slow response that lost the race to a newer one (e.g. the
      // user clicked a different page in the sidebar while this was still
      // in flight).
      if (requestId !== requestRef.current) return
      setTabs(result.tabs || {})
      setLastLoaded(new Date())
    } catch (e) {
      if (requestId !== requestRef.current) return
      setError(e)
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [getIdToken, pageId, key, canView])

  useEffect(() => {
    load()
  }, [load])

  return { tabs, loading, error, reload: load, lastLoaded }
}

/** Subscribes to one Firestore document. `undefined` while loading. */
export function useDocument(path, id) {
  const [data, setData] = useState(undefined)

  useEffect(() => {
    if (!id) {
      setData(null)
      return undefined
    }
    setData(undefined)
    return onSnapshot(
      doc(db, path, id),
      (snap) => setData(snap.exists() ? snap.data() : null),
      () => setData(null)
    )
  }, [path, id])

  return data
}

/**
 * Remembers a value in localStorage under `key`, falling back to `initial`.
 *
 * Used for the per-user, per-browser bits of UI state that must NOT be
 * shared -- sidebar collapsed, which sidebar groups are open. One person
 * collapsing their sidebar shouldn't change anyone else's, so this
 * deliberately never touches Firestore.
 */
export function useLocalState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw === null ? initial : JSON.parse(raw)
    } catch {
      // Private mode, blocked site data, a corrupted entry -- any of these
      // should give the default, never a blank screen.
      return initial
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* nothing we can do, and nothing that should break the page */
    }
  }, [key, value])

  return [value, setValue]
}
