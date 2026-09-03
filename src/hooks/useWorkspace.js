import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { sortPages } from '../lib/workspace'
import { DEFAULT_SPACE, entranceDocId, inSpace } from '../lib/spaces'

/**
 * Live view of the whole workspace: every data source and every dashboard
 * page an admin has created.
 *
 * Both are small config collections (tens of documents, not thousands), so
 * subscribing to them wholesale is cheaper and far simpler than fetching
 * per page -- and it means adding a page in the admin panel makes it appear
 * in everyone's sidebar without a reload.
 *
 * `spaceId` narrows both to one dashboard -- see lib/spaces.js. The
 * filtering is done here rather than in the query on purpose: everything
 * stored before dashboards existed carries no space at all, and a `where`
 * clause would return none of it. This subscription already has every
 * document in hand, so narrowing is free.
 *
 * Returns { sources, pages, sourcesById, pagesById, loading }.
 */
export function useWorkspace(spaceId = DEFAULT_SPACE) {
  const [sources, setSources] = useState([])
  const [pages, setPages] = useState([])
  const [loadedSources, setLoadedSources] = useState(false)
  const [loadedPages, setLoadedPages] = useState(false)

  useEffect(() => {
    const unsubSources = onSnapshot(
      collection(db, 'dataSources'),
      (snap) => {
        setSources(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setLoadedSources(true)
      },
      // A permission error (signed out mid-session) must leave the app in a
      // usable "nothing configured" state rather than hanging on a spinner.
      () => setLoadedSources(true)
    )

    const unsubPages = onSnapshot(
      collection(db, 'dashboards'),
      (snap) => {
        setPages(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setLoadedPages(true)
      },
      () => setLoadedPages(true)
    )

    return () => {
      unsubSources()
      unsubPages()
    }
  }, [])

  const mine = useMemo(() => inSpace(sources, spaceId), [sources, spaceId])
  const orderedPages = useMemo(() => sortPages(inSpace(pages, spaceId)), [pages, spaceId])

  const sourcesById = useMemo(() => Object.fromEntries(mine.map((s) => [s.id, s])), [mine])
  const pagesById = useMemo(() => Object.fromEntries(orderedPages.map((p) => [p.id, p])), [orderedPages])

  return {
    sources: mine,
    pages: orderedPages,
    // Every page in the ACCOUNT, not just this dashboard. Working out
    // which dashboards a person may open needs their grants across all of
    // them, and this subscription already holds every page -- asking for
    // them again would be a second subscription that can briefly disagree
    // with this one.
    allPages: pages,
    allSources: sources,
    sourcesById,
    pagesById,
    loading: !loadedSources || !loadedPages,
  }
}

/**
 * The admin-editable entrance content at `settings/entrance` -- brand name,
 * tagline and the campaign / achievement cards on the splash screen.
 *
 * Read on its own rather than through `useWorkspace` because it is needed
 * EARLIER: the splash renders while auth is still resolving, before pages
 * or sources matter. It returns `null` until the read lands, and the splash
 * falls back to the build-time brand until then, so a slow or failed read
 * degrades to "no announcements" rather than to a blank screen.
 */
export function useEntrance(spaceId = DEFAULT_SPACE) {
  const [entrance, setEntrance] = useState(null)

  useEffect(() => {
    // Each dashboard has its own entrance, and the first one keeps the
    // document that is already there -- see `entranceDocId`. Reset on the
    // way in, or switching dashboards would show the old one's brand until
    // the new read lands.
    setEntrance(null)
    return onSnapshot(
      doc(db, 'settings', entranceDocId(spaceId)),
      (snap) => setEntrance(snap.exists() ? snap.data() : null),
      () => setEntrance(null)
    )
  }, [spaceId])

  return entrance
}

/**
 * This user's `access/{uid}_{pageId}` grant for every page, keyed by page id.
 *
 * The sidebar needs all of them at once ("which pages may I even see?"),
 * before any page is open.
 *
 * Deliberately ONE SUBSCRIPTION PER PAGE rather than a single query over the
 * `access` collection. Firestore security rules are not filters: a list
 * query that would return another user's grant is rejected outright, not
 * silently narrowed, so `collection(db, 'access')` fails for every non-admin
 * under the rule in firestore.rules. Reading each document by its exact id
 * is the access pattern that rule actually permits -- and page counts are in
 * the tens, so the extra listeners cost nothing.
 */
export function useMyAccess(uid, pageIds) {
  const [byPage, setByPage] = useState({})
  const [loaded, setLoaded] = useState(false)

  // Subscriptions are rebuilt only when the SET of pages changes, not on
  // every render that happens to produce a new array instance.
  const key = [...new Set(pageIds || [])].sort().join('|')

  useEffect(() => {
    const ids = key ? key.split('|') : []
    if (!uid || ids.length === 0) {
      setByPage({})
      setLoaded(true)
      return undefined
    }

    setLoaded(false)
    let settled = 0
    const unsubs = ids.map((pageId) =>
      onSnapshot(
        doc(db, 'access', `${uid}_${pageId}`),
        (snap) => {
          setByPage((m) => ({ ...m, [pageId]: snap.exists() ? snap.data() : null }))
          settled += 1
          if (settled >= ids.length) setLoaded(true)
        },
        () => {
          setByPage((m) => ({ ...m, [pageId]: null }))
          settled += 1
          if (settled >= ids.length) setLoaded(true)
        }
      )
    )
    return () => unsubs.forEach((fn) => fn())
  }, [uid, key])

  return { accessByPage: byPage, accessLoaded: loaded }
}
