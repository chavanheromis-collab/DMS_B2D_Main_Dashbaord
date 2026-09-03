import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { DEFAULT_SPACE, listSpaces } from '../lib/spaces'

const SpaceContext = createContext(null)

/** Where the last-opened dashboard is remembered, per browser. */
const REMEMBERED = 'md.space'

/**
 * Which dashboard is open, out of the several this account may hold.
 *
 * A space is a whole dashboard -- its own pages, its own sheet connections,
 * its own entrance. See lib/spaces.js for the model; this is only the
 * "which one am I in" part, kept here so the sidebar, the canvas and the
 * admin panel cannot disagree about the answer.
 *
 * Deliberately small: it subscribes to the `spaces` collection and nothing
 * else. Which dashboards a PERSON may open depends on their page grants,
 * and those are already loaded where the pages are -- fetching them twice
 * would be two subscriptions that can briefly disagree.
 *
 * The choice is remembered in localStorage rather than in Firestore. It is
 * "which of my dashboards am I looking at on this screen", not a preference
 * worth syncing -- and a second monitor showing a second dashboard is a
 * feature, not a state to be reconciled.
 */
export function SpaceProvider({ children }) {
  const [spaceDocs, setSpaceDocs] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [spaceId, setSpaceId] = useState(() => {
    try {
      return window.localStorage.getItem(REMEMBERED) || DEFAULT_SPACE
    } catch {
      // A browser with storage blocked still gets a dashboard.
      return DEFAULT_SPACE
    }
  })

  useEffect(
    () =>
      onSnapshot(
        collection(db, 'spaces'),
        (snap) => {
          setSpaceDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
          setLoaded(true)
        },
        // An account that has never made a second dashboard has no such
        // collection and no rule for it. That is not an error -- it is one
        // dashboard, which is what `listSpaces` answers with anyway.
        () => setLoaded(true)
      ),
    []
  )

  const chooseSpace = useCallback((id) => {
    const next = id || DEFAULT_SPACE
    setSpaceId(next)
    try {
      window.localStorage.setItem(REMEMBERED, next)
    } catch {
      // Not being able to remember it is not a reason to refuse to open it.
    }
  }, [])

  const spaces = useMemo(() => listSpaces(spaceDocs), [spaceDocs])

  const value = useMemo(
    () => ({ spaceId, chooseSpace, spaces, spacesLoading: !loaded }),
    [spaceId, chooseSpace, spaces, loaded]
  )

  return <SpaceContext.Provider value={value}>{children}</SpaceContext.Provider>
}

export function useSpace() {
  const value = useContext(SpaceContext)
  // A default rather than a throw: every screen in this app works when
  // there is exactly one dashboard, and that is what "no provider" means.
  return value || { spaceId: DEFAULT_SPACE, chooseSpace: () => {}, spaces: listSpaces([]), spacesLoading: false }
}
