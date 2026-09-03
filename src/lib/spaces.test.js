import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  activeSpace,
  DEFAULT_SPACE,
  DEFAULT_SPACE_NAME,
  emptySpace,
  entranceDocId,
  inSpace,
  listSpaces,
  newSpaceId,
  spaceContents,
  shareLink,
  spaceForPage,
  spaceOf,
  spacesForUser,
  stampSpace,
} from './spaces.js'

// ---------------------------------------------------------------------
// Which dashboard a document is in
// ---------------------------------------------------------------------

test('a document made before spaces existed is in the first dashboard', () => {
  // The whole migration, and it is this line: nothing already stored has
  // to be touched for it to keep working.
  assert.equal(spaceOf({ id: 'p1', name: 'Sales' }), DEFAULT_SPACE)
  assert.equal(spaceOf(undefined), DEFAULT_SPACE)
  assert.equal(spaceOf({}), DEFAULT_SPACE)
})

test('and so is one whose space is blank or nonsense', () => {
  // A half-written document must land somewhere real rather than in a
  // dashboard nobody can open.
  assert.equal(spaceOf({ space: '' }), DEFAULT_SPACE)
  assert.equal(spaceOf({ space: '   ' }), DEFAULT_SPACE)
  assert.equal(spaceOf({ space: 42 }), DEFAULT_SPACE)
  assert.equal(spaceOf({ space: null }), DEFAULT_SPACE)
})

test('a document that names its dashboard is in that one', () => {
  assert.equal(spaceOf({ space: 'sp_hero' }), 'sp_hero')
  assert.equal(spaceOf({ space: '  sp_hero  ' }), 'sp_hero', 'and stray spaces are not a different one')
})

const pages = [
  { id: 'a', name: 'Sales' },
  { id: 'b', name: 'Stock', space: 'sp_hero' },
  { id: 'c', name: 'Leads', space: 'sp_hero' },
  { id: 'd', name: 'Old', space: DEFAULT_SPACE },
]

test('a dashboard holds what names it, plus what predates the idea', () => {
  assert.deepEqual(inSpace(pages, DEFAULT_SPACE).map((p) => p.id), ['a', 'd'])
  assert.deepEqual(inSpace(pages, 'sp_hero').map((p) => p.id), ['b', 'c'])
})

test('asking for no dashboard means the first one', () => {
  assert.deepEqual(inSpace(pages, undefined).map((p) => p.id), ['a', 'd'])
})

test('a dashboard nobody has made holds nothing', () => {
  assert.deepEqual(inSpace(pages, 'sp_nothing'), [])
  assert.deepEqual(inSpace(undefined, 'sp_hero'), [])
})

test('a new document says which dashboard it is in, even the first', () => {
  // Blank means "made before spaces existed". A document that names its
  // dashboard can be moved to another by changing one field; one relying
  // on the fallback cannot.
  assert.deepEqual(stampSpace({ id: 'x' }, 'sp_hero'), { id: 'x', space: 'sp_hero' })
  assert.deepEqual(stampSpace({ id: 'x' }, undefined), { id: 'x', space: DEFAULT_SPACE })
  assert.deepEqual(stampSpace(null, 'sp_hero'), { space: 'sp_hero' })
})

test('stamping leaves the rest of the document alone', () => {
  assert.deepEqual(stampSpace({ id: 'x', name: 'Sales', widgets: [1] }, 'sp_hero'), {
    id: 'x',
    name: 'Sales',
    widgets: [1],
    space: 'sp_hero',
  })
})

// ---------------------------------------------------------------------
// The list of dashboards
// ---------------------------------------------------------------------

test('there is always a first dashboard, even before anybody makes one', () => {
  // It is not a stored document until somebody renames it. Without this an
  // account would report having no dashboards while plainly showing one.
  const out = listSpaces([])
  assert.equal(out.length, 1)
  assert.equal(out[0].id, DEFAULT_SPACE)
  assert.equal(out[0].name, DEFAULT_SPACE_NAME)
})

test('and once it has been named, the stored name is the one used', () => {
  const out = listSpaces([{ id: DEFAULT_SPACE, name: 'HERO', order: 0 }])
  assert.equal(out.length, 1, 'not two entries for the same dashboard')
  assert.equal(out[0].name, 'HERO')
})

test('dashboards come out in the order they were given', () => {
  const out = listSpaces([
    { id: 'sp_c', name: 'TATA', order: 2 },
    { id: 'sp_b', name: 'PREMIA', order: 1 },
  ])
  assert.deepEqual(out.map((s) => s.id), [DEFAULT_SPACE, 'sp_b', 'sp_c'])
})

test('the first one leads even when the others were ordered from zero', () => {
  // Its implicit order has to sort before a stored one, or adding a second
  // dashboard would silently push the existing one down the list.
  const out = listSpaces([{ id: 'sp_b', name: 'PREMIA', order: 0 }])
  assert.equal(out[0].id, DEFAULT_SPACE)
})

test('unordered dashboards fall back to their names', () => {
  const out = listSpaces([{ id: 'sp_z', name: 'Alpha' }, { id: 'sp_a', name: 'Zulu' }])
  assert.deepEqual(out.map((s) => s.name), [DEFAULT_SPACE_NAME, 'Alpha', 'Zulu'])
})

test('a half-written dashboard with no id is not a dashboard', () => {
  assert.deepEqual(listSpaces([{ name: 'Nameless' }, null]).map((s) => s.id), [DEFAULT_SPACE])
})

// ---------------------------------------------------------------------
// Who sees which
// ---------------------------------------------------------------------

const spaces = [
  { id: DEFAULT_SPACE, name: 'HERO', order: 0 },
  { id: 'sp_hero', name: 'PREMIA', order: 1 },
  { id: 'sp_empty', name: 'TATA', order: 2 },
]

test('an admin sees every dashboard, including the empty one', () => {
  // An empty dashboard is one an admin is still building.
  assert.deepEqual(spacesForUser(spaces, pages, {}, true).map((s) => s.id), [
    DEFAULT_SPACE,
    'sp_hero',
    'sp_empty',
  ])
})

test('a reader sees the dashboards holding a page they were granted', () => {
  // A space is discovered through its pages and never granted separately,
  // so there is one grant model rather than two that can disagree.
  const access = { b: { canView: true } }
  assert.deepEqual(spacesForUser(spaces, pages, access, false).map((s) => s.id), ['sp_hero'])
})

test('and both, when they have a page in each', () => {
  const access = { a: { canView: true }, c: { canView: true } }
  assert.deepEqual(spacesForUser(spaces, pages, access, false).map((s) => s.id), [
    DEFAULT_SPACE,
    'sp_hero',
  ])
})

test('a reader granted nothing sees no dashboard at all', () => {
  assert.deepEqual(spacesForUser(spaces, pages, {}, false), [])
})

test('a grant that is not a view is not a way in', () => {
  // `canView: false` is a row in the access collection, not permission.
  const access = { b: { canView: false, canExport: true } }
  assert.deepEqual(spacesForUser(spaces, pages, access, false), [])
})

test('a granted page in a dashboard nobody made still opens it', () => {
  // Pages are the source of truth; a space document is just its name.
  const orphan = [{ id: 'z', space: 'sp_ghost' }]
  const out = spacesForUser([{ id: 'sp_ghost', name: 'Ghost' }], orphan, { z: { canView: true } }, false)
  assert.deepEqual(out.map((s) => s.id), ['sp_ghost'])
})

// ---------------------------------------------------------------------
// Which one to open
// ---------------------------------------------------------------------

const allowed = [{ id: DEFAULT_SPACE }, { id: 'sp_hero' }]

test('the dashboard somebody was last in is the one they get back', () => {
  assert.equal(activeSpace('sp_hero', allowed), 'sp_hero')
})

test('one they can no longer open falls back to one they can', () => {
  // Access withdrawn, or the dashboard deleted. The alternative is an empty
  // screen that looks exactly like the data having gone.
  assert.equal(activeSpace('sp_gone', allowed), DEFAULT_SPACE)
  assert.equal(activeSpace(undefined, allowed), DEFAULT_SPACE)
})

test('and somebody allowed nothing still gets a real answer', () => {
  assert.equal(activeSpace('sp_hero', []), DEFAULT_SPACE)
})

// ---------------------------------------------------------------------
// Where a dashboard's own entrance lives
// ---------------------------------------------------------------------

test('the first dashboard keeps the entrance document that is already there', () => {
  // Anything else would mean the existing login screen quietly reverting to
  // the built-in one the day this shipped.
  assert.equal(entranceDocId(DEFAULT_SPACE), 'entrance')
  assert.equal(entranceDocId(undefined), 'entrance')
})

test('and every other dashboard gets one of its own', () => {
  assert.equal(entranceDocId('sp_hero'), 'entrance_sp_hero')
  assert.notEqual(entranceDocId('sp_hero'), entranceDocId('sp_other'))
})

// ---------------------------------------------------------------------
// Making and unmaking one
// ---------------------------------------------------------------------

test('a new dashboard has an id of its own shape', () => {
  const a = newSpaceId()
  assert.match(a, /^sp_[a-z0-9]+$/)
  assert.notEqual(a, newSpaceId())
})

test('a blank dashboard is ready to be named', () => {
  const s = emptySpace('PREMIA', 3)
  assert.equal(s.name, 'PREMIA')
  assert.equal(s.order, 3)
  assert.match(s.id, /^sp_/)
})

test('deleting one says what it would take with it', () => {
  // "Delete dashboard?" and "Delete 2 pages?" are different questions, and
  // only the second one is true.
  const sources = [{ id: 's1' }, { id: 's2', space: 'sp_hero' }]
  assert.deepEqual(spaceContents('sp_hero', pages, sources), { pages: 2, sources: 1 })
  assert.deepEqual(spaceContents(DEFAULT_SPACE, pages, sources), { pages: 2, sources: 1 })
  assert.deepEqual(spaceContents('sp_empty', pages, sources), { pages: 0, sources: 0 })
})

// ---------------------------------------------------------------------
// A link that lands in the right dashboard
// ---------------------------------------------------------------------

test('a link to a page is a link to the dashboard that page is in', () => {
  // Somebody with two dashboards, sent a link to a page in one of them,
  // must not open it with the other one's sidebar.
  assert.equal(spaceForPage(pages, 'b'), 'sp_hero')
  assert.equal(spaceForPage(pages, 'a'), DEFAULT_SPACE)
})

test('a link naming no page has no opinion about the dashboard', () => {
  // An opinion is the only thing worth overriding somebody's own last
  // choice with.
  assert.equal(spaceForPage(pages, undefined), null)
  assert.equal(spaceForPage(pages, ''), null)
})

test('nor does one naming a page this account does not have', () => {
  assert.equal(spaceForPage(pages, 'pg_deleted'), null)
  assert.equal(spaceForPage([], 'a'), null)
  assert.equal(spaceForPage(undefined, 'a'), null)
})

test('a dashboard has a link of its own, which no page can take with it', () => {
  // A page link dies when that page is renamed away or deleted; this one
  // names the dashboard and lands on whatever its first page is that day.
  assert.equal(shareLink('https://example.app', 'sp_hero'), 'https://example.app/s/sp_hero')
  assert.equal(shareLink('https://example.app', DEFAULT_SPACE), 'https://example.app/s/main')
})

test('and it survives an origin with a trailing slash', () => {
  assert.equal(shareLink('https://example.app/', 'sp_hero'), 'https://example.app/s/sp_hero')
  assert.equal(shareLink('https://example.app///', 'sp_hero'), 'https://example.app/s/sp_hero')
})

test('a link asked for with no dashboard is a link to the first', () => {
  assert.equal(shareLink('https://example.app', undefined), 'https://example.app/s/main')
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const src = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

test('the workspace narrows to one dashboard, without a query', () => {
  // Everything stored before dashboards existed carries no space at all,
  // and a `where` clause would return none of it.
  const hook = src('src/hooks/useWorkspace.js')
  assert.ok(hook.includes('inSpace(sources, spaceId)'))
  assert.ok(hook.includes('sortPages(inSpace(pages, spaceId))'))
  assert.ok(!hook.includes('where('), 'no query filter, which legacy documents would fail')
})

test('...and still hands back every page, for deciding which dashboards to offer', () => {
  const hook = src('src/hooks/useWorkspace.js')
  assert.ok(hook.includes('allPages: pages'))
  const dash = src('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('useMyAccess(user?.uid, allPages.map((p) => p.id))'))
  assert.ok(dash.includes('spacesForUser(spaces, allPages, accessByPage, isAdmin)'))
})

test('each dashboard reads its own entrance', () => {
  const hook = src('src/hooks/useWorkspace.js')
  assert.ok(hook.includes("doc(db, 'settings', entranceDocId(spaceId))"))
  const panel = src('src/pages/admin/EntrancePanel.jsx')
  assert.ok(panel.includes("doc(db, 'settings', entranceDocId(spaceId))"))
  assert.ok(panel.includes('[spaceId]'), 'and re-reads when the dashboard changes')
})

test('a new page or sheet belongs to the dashboard it was made in', () => {
  // Without this every new page lands in the first dashboard, whichever
  // one you were looking at.
  const dash = src('src/pages/Dashboard.jsx')
  assert.ok(dash.includes("stampSpace({ ...emptyPage(), id, name: 'New page' }, spaceId)"))
  const admin = src('src/pages/Admin.jsx')
  assert.ok(admin.includes('stampSpace(source, spaceId)'))
  assert.ok(admin.includes('stampSpace({ ...next, id }, spaceId)'))
})

test('the admin panel administers one dashboard at a time', () => {
  const admin = src('src/pages/Admin.jsx')
  assert.ok(admin.includes('inSpace(allSources, spaceId)'))
  assert.ok(admin.includes('inSpace(allPages, spaceId)'))
})

test('the switcher is only shown when there is a choice', () => {
  // A picker offering one option is furniture that has to be read before
  // it can be ignored.
  const bar = src('src/components/Sidebar.jsx')
  assert.ok(bar.includes('spaces.length > 1 && ('))
  const dash = src('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('spaces={allowedSpaces}'), 'and it lists only what this person may open')
})

test('a dashboard nobody can open is not the one they land in', () => {
  const dash = src('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('const next = activeSpace(asked, allowedSpaces)'))
  // Skipped while grants are still arriving, or everybody is bounced to
  // the first dashboard for a moment on every load.
  assert.ok(dash.includes('if (allowedSpaces.length === 0) return'))
})

test('the rules let a signed-in user read the names, and only an admin write them', () => {
  const rules = read('firestore.rules')
  const block = rules.slice(rules.indexOf('match /spaces/{spaceId}'))
  assert.ok(block.slice(0, 160).includes('allow read: if isSignedIn()'))
  assert.ok(block.slice(0, 160).includes('allow write: if isAdmin()'))
})

test('there is no second permission model for a dashboard', () => {
  // Which dashboards a person may open is decided by their page grants.
  // A separate grant would be two models for one question, and they would
  // come to disagree.
  const lib = read('src/lib/spaces.js')
  assert.ok(lib.includes('canViewPage(accessByPage?.[page.id], false)'))
  const rules = read('firestore.rules')
  assert.ok(!rules.includes('spaceAccess'), 'no parallel grant collection')
})

test('a page link opens the dashboard that page is in, over what was remembered', () => {
  // A link is somebody being SENT somewhere, and being sent somewhere beats
  // having been somewhere.
  const dash = src('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('const urlSpace = useMemo(() => spaceForPage(allPages, pageId), [allPages, pageId])'))
  assert.ok(
    dash.includes(
      'const asked = urlSpace && allowedSpaces.some((sp) => sp.id === urlSpace) ? urlSpace : spaceId'
    )
  )
})

test('...but a link to a dashboard they cannot open is not a way in', () => {
  // The link says which dashboard is being asked for, never who may see it.
  const dash = src('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('const next = activeSpace(asked, allowedSpaces)'))
  const app = src('src/App.jsx')
  assert.ok(app.includes('<ProtectedRoute> <SpaceLink /> </ProtectedRoute>'))
})

test('a dashboard has a route of its own', () => {
  const app = src('src/App.jsx')
  assert.ok(app.includes('path="/s/:space"'))
  assert.ok(app.includes('if (space) chooseSpace(space)'))
  // `/` already lands on the first page of whichever dashboard is open, so
  // the redirect needs to know nothing about pages or grants.
  assert.ok(app.includes('return <Navigate to="/" replace />'))
})

test('and the admin panel hands that link over', () => {
  const panel = src('src/pages/admin/SpacesPanel.jsx')
  assert.ok(panel.includes('shareLink(window.location.origin, space.id)'))
  // A browser that refuses the clipboard still has to give the link up.
  assert.ok(panel.includes("window.prompt('Copy this link', link)"))
})
