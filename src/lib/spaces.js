// ---------------------------------------------------------------------
// Several whole dashboards in one account
// ---------------------------------------------------------------------
// Everything in this workspace was flat and global: one set of pages, one
// set of sheet connections, one entrance. That is right for one business
// and wrong the moment a second one arrives -- HERO's pages beside PREMIA's
// in the same sidebar, with one login screen trying to belong to both.
//
// A SPACE is a whole dashboard: its own pages, its own sheet connections,
// its own entrance, its own look. This adds that dimension without moving a
// single document that already exists.
//
//   A DOCUMENT WITHOUT A SPACE IS IN THE DEFAULT ONE. So everything already
//   stored belongs to the dashboard that already exists, and nothing has to
//   be migrated, re-indexed or re-permissioned to keep working.
//
//   THE FILTERING IS DONE HERE, not in the query. `useWorkspace` already
//   subscribes to these collections whole -- they are tens of documents,
//   not thousands -- so a space is a filter over what is already in hand.
//   A `where` clause would instead need every legacy document stamped
//   first, and would return nothing at all until that had happened.
//
//   ACCESS IS STILL PER PAGE. A space is not a new thing to be granted: a
//   user who can see a page can see the space it is in, and one who can see
//   no page in a space never learns it exists. That reuses the grant model
//   whole rather than adding a second one beside it that could disagree.
//
// Pure: documents in, documents out. Nothing here touches Firestore.

import { canViewPage } from './workspace.js'

/**
 * The space every existing document belongs to.
 *
 * Not a magic value that has to be written anywhere: it is what `spaceOf`
 * answers when a document says nothing, which is what every document said
 * before this existed.
 */
export const DEFAULT_SPACE = 'main'

/** What the first dashboard is called before anybody renames it. */
export const DEFAULT_SPACE_NAME = 'Main dashboard'

const PREFIX = 'sp_'

/** A new space id, in the same shape as page and source ids. */
export function newSpaceId() {
  return `${PREFIX}${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

/** Which dashboard this page, source or setting belongs to. */
export function spaceOf(doc) {
  const id = doc?.space
  return typeof id === 'string' && id.trim() ? id.trim() : DEFAULT_SPACE
}

/** Everything in one dashboard. */
export function inSpace(docs, spaceId) {
  const want = spaceId || DEFAULT_SPACE
  return (docs || []).filter((doc) => spaceOf(doc) === want)
}

/**
 * A document stamped with the dashboard it is being created in.
 *
 * The default space is stamped too, rather than left blank. Blank means
 * "made before spaces existed", and a document that says which dashboard it
 * is in can be moved to another one by changing one field -- which a
 * document relying on the fallback cannot.
 */
export function stampSpace(doc, spaceId) {
  return { ...(doc || {}), space: spaceId || DEFAULT_SPACE }
}

/**
 * Every dashboard there is, in order, with the default one always present.
 *
 * The default is not a stored document until somebody renames it, so it is
 * added here. Otherwise an account that has never opened this panel would
 * report having no dashboards while plainly showing one.
 */
export function listSpaces(spaceDocs) {
  const stored = [...(spaceDocs || [])].filter((s) => s && s.id)
  const hasDefault = stored.some((s) => s.id === DEFAULT_SPACE)
  const all = hasDefault ? stored : [{ id: DEFAULT_SPACE, name: DEFAULT_SPACE_NAME, order: -1 }, ...stored]
  return all.sort((a, b) => {
    const ao = Number.isFinite(a.order) ? a.order : 9999
    const bo = Number.isFinite(b.order) ? b.order : 9999
    if (ao !== bo) return ao - bo
    return String(a.name || '').localeCompare(String(b.name || ''))
  })
}

/**
 * The dashboards this person may open.
 *
 * An admin sees all of them. Anybody else sees the ones holding at least
 * one page they have been granted -- so a space is discovered through the
 * pages in it and never has to be granted separately.
 *
 * A space with no pages at all is admin-only by that rule, which is right:
 * an empty dashboard is one an admin is still building.
 */
export function spacesForUser(spaces, pages, accessByPage, isAdmin) {
  const all = listSpaces(spaces)
  if (isAdmin) return all
  const open = new Set()
  for (const page of pages || []) {
    if (canViewPage(accessByPage?.[page.id], false)) open.add(spaceOf(page))
  }
  return all.filter((space) => open.has(space.id))
}

/**
 * Which dashboard to show, given what this person asked for last time.
 *
 * A remembered choice they can no longer open -- access withdrawn, the
 * dashboard deleted -- falls back to the first they can, rather than to an
 * empty screen that looks like the data has gone.
 */
export function activeSpace(remembered, allowed) {
  const list = allowed || []
  if (list.some((s) => s.id === remembered)) return remembered
  return list[0]?.id || DEFAULT_SPACE
}

/**
 * The dashboard a page link is asking for.
 *
 * A link to a page is a link to the dashboard that page is in -- the page
 * id names it unambiguously, so nothing has to be added to the URL for an
 * existing bookmark to land in the right place. Without this, somebody with
 * two dashboards who is sent a link to a page in one of them opens it with
 * the OTHER one's sidebar, which reads as the link being broken.
 *
 * Null when the URL names no page, or names one this account does not have:
 * both mean "no opinion", and an opinion is the only thing worth overriding
 * the person's own last choice with.
 */
export function spaceForPage(pages, pageId) {
  if (!pageId) return null
  const page = (pages || []).find((p) => p && p.id === pageId)
  return page ? spaceOf(page) : null
}

/**
 * The link that opens one dashboard.
 *
 * A page link is enough to land in the right dashboard, but it is a link to
 * a PAGE -- rename or delete that page and the link dies. This one names
 * the dashboard itself and lands on whatever its first page is that day.
 */
export function shareLink(origin, spaceId) {
  const base = String(origin || '').replace(/\/+$/, '')
  return `${base}/s/${spaceId || DEFAULT_SPACE}`
}

/**
 * Where a space's entrance is stored.
 *
 * The default space keeps `settings/entrance`, the document that is already
 * there. Anything else would mean the existing login screen quietly
 * reverting to the built-in one the day this shipped.
 */
export function entranceDocId(spaceId) {
  const id = spaceId || DEFAULT_SPACE
  return id === DEFAULT_SPACE ? 'entrance' : `entrance_${id}`
}

/** A new dashboard, ready to be named. */
export function emptySpace(name = 'New dashboard', order = 0) {
  return {
    id: newSpaceId(),
    name,
    icon: '',
    order,
  }
}

/**
 * What deleting a dashboard would take with it.
 *
 * Reported rather than done: a dashboard holds pages, and pages hold
 * widgets somebody built. The admin panel says the count out loud before
 * asking, because "Delete dashboard?" and "Delete 14 pages?" are different
 * questions and only the second one is true.
 */
export function spaceContents(spaceId, pages, sources) {
  return {
    pages: inSpace(pages, spaceId).length,
    sources: inSpace(sources, spaceId).length,
  }
}
