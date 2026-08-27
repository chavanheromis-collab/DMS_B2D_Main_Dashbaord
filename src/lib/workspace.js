import { EMPTY_LAYOUT, uid } from './config.js'
import { qualifyLegacyRefs } from './refs.js'

// ---------------------------------------------------------------------
// The workspace model
// ---------------------------------------------------------------------
// v2 hardcoded two pages, each owning one spreadsheet. v3 replaces both
// halves of that with admin-managed collections:
//
//   dataSources/{sourceId}   one spreadsheet + the tabs this workspace may
//                            read from it
//   dashboards/{pageId}      one dashboard canvas: widgets, filters, buttons
//   access/{uid}_{pageId}    what one user may see and do on one page
//
// Nothing here is baked into the code any more -- an admin adds a fifth
// spreadsheet and a ninth page from the panel, and the sidebar, the widget
// pickers and the permission matrix all pick it up.

export const SOURCE_PREFIX = 'src'
export const PAGE_PREFIX = 'pg'

/** Ready-made icons for the sidebar; admins may type any emoji instead. */
export const PAGE_ICONS = [
  '📊', '📈', '🏷️', '🚗', '💰', '🎯', '🧾', '👥',
  '🏆', '🔧', '📦', '🛠️', '📅', '⭐', '🔍', '🏢',
]

export function newSourceId() {
  return uid(SOURCE_PREFIX)
}

export function newPageId() {
  return uid(PAGE_PREFIX)
}

/** A blank data source, ready for the admin to paste a sheet link into. */
export function emptySource(name = 'New spreadsheet') {
  return {
    id: newSourceId(),
    name,
    sheetId: '',
    tabs: [],
    tabHeaders: {},
    // { [tabName]: [ {id, name, formula} ] } -- columns this dashboard works
    // out that the spreadsheet does not have. See lib/computed.js.
    computed: {},
    dateOrder: 'DMY',
    color: '#4F46E5',
  }
}

/** A blank dashboard page. */
export function emptyPage(name = 'New page', order = 0) {
  return {
    id: newPageId(),
    name,
    // The sidebar entry, kept separate from `name` because navigation and a
    // page heading want different lengths: a sidebar has room for "Sales",
    // the heading above the widgets can afford "Sales Performance — FY25".
    // Blank means "use the page name", so it only needs filling in when the
    // two genuinely differ.
    navLabel: '',
    icon: '📊',
    // An image URL that replaces the emoji wherever the page's mark is
    // drawn. Kept alongside `icon` rather than replacing it so a broken or
    // slow image still has an emoji to fall back to.
    iconUrl: '',
    group: '',
    order,
    description: '',
    sourceIds: [],
    // Two independent decisions the admin makes about where a page appears:
    //   showInSidebar  does it get its own sidebar entry at all?
    //   parentId       is it a sub-canvas of another page, reached from
    //                  tabs inside that page rather than from the sidebar?
    // Kept separate on purpose -- a sub-canvas that ALSO deserves a sidebar
    // shortcut is a real case, and so is a page that is neither (reachable
    // only by direct link, e.g. one still being built).
    showInSidebar: true,
    parentId: '',
    // Which of the two names a canvas TAB shows. The sidebar and the tab
    // strip are both navigation, but they have very different amounts of
    // room, so they get to disagree: a tab strip across the top of a page
    // can often afford the full page title where a sidebar entry can't.
    tabUsesPageName: false,
    background: null,
    ...EMPTY_LAYOUT,
  }
}

// ---------------------------------------------------------------------
// Sorting + grouping for the sidebar
// ---------------------------------------------------------------------
/**
 * What to call this page in NAVIGATION -- the sidebar and canvas tab strips.
 *
 * Falls back to the page's own name, so a page that never sets a nav label
 * behaves exactly as it always did and nobody has to fill in two boxes to
 * create one page.
 */
export function navLabelFor(page) {
  const label = String(page?.navLabel || '').trim()
  return label || page?.name || ''
}

/**
 * A page's mark: an image when one is set and usable, otherwise the emoji.
 *
 * Returns `{ type: 'image', url }` or `{ type: 'emoji', char }`, so callers
 * render one or the other without each re-deciding what "has an icon" means.
 */
export function pageIcon(page, safeUrl) {
  const url = safeUrl ? safeUrl(page?.iconUrl) : String(page?.iconUrl || '').trim()
  if (url) return { type: 'image', url }
  return { type: 'emoji', char: page?.icon || '📊' }
}

/**
 * What to call this page in a CANVAS TAB STRIP.
 *
 * Defaults to the same short label the sidebar uses, but an admin can tick
 * "show the full page title in tabs" per page -- a tab strip runs across the
 * width of the content area and can usually afford the longer name.
 */
export function canvasLabelFor(page) {
  if (page?.tabUsesPageName) return page.name || navLabelFor(page)
  return navLabelFor(page)
}

/**
 * Orders pages by the admin's explicit `order`, then by name -- so a page
 * created before ordering was set still lands somewhere predictable rather
 * than wherever Firestore happened to return it.
 */
export function sortPages(pages) {
  return [...(pages || [])].sort((a, b) => {
    const ao = Number.isFinite(a.order) ? a.order : 9999
    const bo = Number.isFinite(b.order) ? b.order : 9999
    if (ao !== bo) return ao - bo
    return String(a.name || '').localeCompare(String(b.name || ''))
  })
}

/**
 * The pages that earn a SIDEBAR entry: the admin ticked "show in sidebar",
 * and they aren't a sub-canvas of another page (those are reached from tabs
 * inside their parent instead, so listing them twice would be noise).
 *
 * A sub-canvas whose parent has since been deleted is promoted back to the
 * sidebar rather than becoming unreachable.
 */
export function sidebarPages(pages) {
  const ids = new Set((pages || []).map((p) => p.id))
  return (pages || []).filter((p) => {
    if (p.showInSidebar === false) return false
    return !p.parentId || !ids.has(p.parentId)
  })
}

/** The sub-canvases of one page, in order. */
export function childPages(pages, parentId) {
  if (!parentId) return []
  return sortPages((pages || []).filter((p) => p.parentId === parentId))
}

/**
 * The page whose tab strip `page` belongs to, plus its siblings -- so a
 * sub-canvas renders the same tab strip as its parent does, with itself
 * highlighted. Returns `null` when the page isn't part of a canvas group.
 */
export function canvasFor(pages, page) {
  if (!page) return null
  const parentId = page.parentId || page.id
  const parent = (pages || []).find((p) => p.id === parentId)
  if (!parent) return null
  const children = childPages(pages, parentId)
  if (children.length === 0) return null
  return { parent, children, tabs: [parent, ...children] }
}

/**
 * Buckets pages into their sidebar groups, preserving page order within
 * each group and group order by the first page that mentions it.
 *
 * Returns `[{ group, pages }]`. Ungrouped pages come back under `group: ''`,
 * which the sidebar renders as a flat list above the collapsible groups.
 */
export function groupPages(pages) {
  // Grouping, and ONLY grouping. This used to sort by `page.order` first,
  // which quietly threw away whatever order the caller had already worked
  // out -- so a reader who dragged a page in the sidebar watched it move
  // and then snap straight back to the workspace order. The caller knows
  // whose order it is (see lib/pageOrder.js); this one does not, and
  // deciding it here was the whole bug.
  const groups = []
  const byName = new Map()

  for (const page of pages || []) {
    const key = page.group || ''
    let bucket = byName.get(key)
    if (!bucket) {
      bucket = { group: key, pages: [] }
      byName.set(key, bucket)
      groups.push(bucket)
    }
    bucket.pages.push(page)
  }
  // Ungrouped pages always sit at the top, whatever order they were created.
  return groups.sort((a, b) => (a.group === '' ? -1 : b.group === '' ? 1 : 0))
}

// ---------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------
export function accessId(uidValue, pageId) {
  return `${uidValue}_${pageId}`
}

/**
 * Can this user see this page at all? Admins always can, which is what stops
 * an admin from locking themselves out of a page they just built.
 */
export function canViewPage(access, isAdmin) {
  return Boolean(isAdmin || access?.canView)
}

/**
 * The widgets of `page` this user may see. Widget-level visibility is a
 * DENY list (`hiddenWidgets`) rather than an allow list, so a widget the
 * admin adds later is visible to everyone by default instead of silently
 * invisible until each user is re-granted.
 */
export function visibleWidgetsFor(page, access, isAdmin) {
  const widgets = page?.widgets || []
  if (isAdmin) return widgets
  const hidden = new Set(access?.hiddenWidgets || [])
  return widgets.filter((w) => !hidden.has(w.id))
}

// ---------------------------------------------------------------------
// Legacy migration
// ---------------------------------------------------------------------
/**
 * Converts the v2 world (`sheetConfigs/PREMIA` + `layouts/PREMIA`) into v3
 * documents, WITHOUT deleting anything: the old docs are left in place, so a
 * migration that goes wrong is undone by ignoring the new collections rather
 * than by restoring a backup.
 *
 * Each legacy page becomes one data source plus one dashboard page, and
 * every bare `tab: "MASTER"` in the layout is rewritten to the qualified
 * `tab: "<sourceId>::MASTER"` the v3 engine expects.
 *
 * Returns `{ sources, pages, accessPatches }` for the caller to write.
 */
export function migrateLegacy(legacyPages, configs, layouts, accessDocs = {}) {
  const sources = []
  const pages = []
  const accessPatches = []

  legacyPages.forEach((name, index) => {
    const config = configs[name]
    if (!config?.sheetId) return

    const source = {
      ...emptySource(name),
      sheetId: config.sheetId,
      tabs: config.tabs || [],
      tabHeaders: config.tabHeaders || {},
      dateOrder: config.dateOrder || 'DMY',
    }
    sources.push(source)

    const layout = layouts[name] || EMPTY_LAYOUT
    const page = {
      ...emptyPage(name, index),
      // The layout keeps its widget/filter/button ids, so any existing
      // `access.hiddenWidgets` entry still points at the right widget.
      ...qualifyLegacyRefs(
        {
          widgets: layout.widgets || [],
          filters: layout.filters || [],
          buttons: layout.buttons || [],
        },
        source.id
      ),
      sourceIds: [source.id],
    }
    pages.push(page)

    // Carry each user's old per-page grant onto the new page id, remapping
    // `editable: { MASTER: [...] }` to the qualified ref form.
    for (const [key, value] of Object.entries(accessDocs)) {
      if (!key.endsWith(`_${name}`)) continue
      const userId = key.slice(0, -(name.length + 1))
      accessPatches.push({
        id: accessId(userId, page.id),
        data: {
          canView: !!value.canView,
          hiddenWidgets: value.hiddenWidgets || [],
          editable: requalifyPerTab(value.editable, source.id),
          downloadable: requalifyPerTab(value.downloadable, source.id),
        },
      })
    }
  })

  return { sources, pages, accessPatches }
}

/** `{ MASTER: [...] }` -> `{ "src_a1::MASTER": [...] }` */
function requalifyPerTab(map, sourceId) {
  const out = {}
  for (const [tab, columns] of Object.entries(map || {})) {
    out[tab.includes('::') ? tab : `${sourceId}::${tab}`] = columns
  }
  return out
}
