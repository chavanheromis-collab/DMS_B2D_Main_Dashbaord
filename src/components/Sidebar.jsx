import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  LayoutGrid,
  LogOut,
  Plus,
  Search,
  Settings,
  X,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useLocalState } from '../hooks/usePageData'
import { groupPages, navLabelFor } from '../lib/workspace'
import { PageIcon } from './PageIcon.jsx'

export const SIDEBAR_WIDTH = 248
export const SIDEBAR_RAIL = 64

/**
 * The app's navigation: every dashboard page this user may see, grouped and
 * collapsible.
 *
 * Three states, because one component has to serve a 320px phone and a
 * 2560px monitor:
 *
 *   mobile   an off-canvas drawer over a backdrop, closed by default
 *   rail     a 64px icon-only strip (collapsed), with tooltips
 *   full     a 248px list with labels and groups
 *
 * Collapsed / open-group state is per-user and per-browser (localStorage),
 * never Firestore -- one person collapsing their sidebar must not rearrange
 * anyone else's.
 */
export default function Sidebar({
  pages,
  activePageId,
  // The account's other dashboards, if this person can open more than one.
  // A whole dashboard -- its pages, its sheets, its entrance -- rather than
  // a folder of pages; see lib/spaces.js.
  spaces = [],
  spaceId,
  onSpace,
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
  onNavigate,
  query,
  onQuery,
  // Edit mode reaches the sidebar too: a page is created HERE, where pages
  // are, and its settings open beside it. Going to another screen to make a
  // page and coming back to look at it is the travel this whole mode exists
  // to remove.
  editing = false,
  onAddPage,
  onEditPage,
  // Pick a page up and drop it where it belongs. The sidebar is the only
  // place the order of pages is visible, so it is the only place worth
  // reordering them from.
  onMovePage,
  moveScope = 'you',
  // A transient hover-open, distinct from `collapsed`, which is the pinned
  // state a click set. Nothing the mouse does may undo a click.
  peeking = false,
  onPeekEnter,
  onPeekLeave,
}) {
  const { isAdmin, signOut, userDoc } = useAuth()
  const navigate = useNavigate()
  const [openGroups, setOpenGroups] = useLocalState('dash.openGroups', {})
  // What is in the hand, and what it is hovering over. Held in state rather
  // than only in the drag payload because the row being hovered has to draw
  // itself differently -- a drag with no visible target is a guess.
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)

  // Any signed-in person may arrange their own sidebar, so this is not
  // gated on edit mode. What edit mode changes is WHOSE order it writes --
  // see `moveScope`, and `movePage` in Dashboard.
  const canDrag = Boolean(onMovePage) && !collapsed

  const filtered = useMemo(() => {
    const q = (query || '').trim().toLowerCase()
    if (!q) return pages
    // Matches the nav label, the full page name and the group -- someone
    // searching for a page shouldn't have to know which of the two names
    // they're looking at.
    return pages.filter((p) =>
      [navLabelFor(p), p.name, p.group].some((field) => String(field || '').toLowerCase().includes(q))
    )
  }, [pages, query])

  const groups = useMemo(() => groupPages(filtered), [filtered])

  function go(pageId) {
    navigate(`/d/${pageId}`)
    onCloseMobile?.()
    // Picking a page collapses the sidebar to its icon rail, handing the
    // width back to the canvas -- you came here to read the dashboard, not
    // the navigation. Already-collapsed stays collapsed, and the chevron
    // re-opens it whenever you want to browse.
    onNavigate?.()
  }

  const isGroupOpen = (name) => openGroups[name] !== false // default open
  const toggleGroup = (name) => setOpenGroups((g) => ({ ...g, [name]: !isGroupOpen(name) }))

  // Rendered twice -- once for the desktop aside (which may be a rail) and
  // once for the mobile drawer (which never is, since a 64px icon strip
  // sliding over the page would be pointless).
  const renderBody = (collapsed) => (
    <div className="flex h-full flex-col">
      {/* --- Brand + collapse ------------------------------------------- */}
      <div className={`flex items-center gap-2 px-3 py-3 ${collapsed ? 'justify-center' : ''}`}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-sky-400 text-white shadow-sm">
          <LayoutGrid size={16} />
        </div>
        {!collapsed && (
          <>
            <span className="truncate text-sm font-semibold text-ink">
              {spaces.find((s) => s.id === spaceId)?.name || 'Dashboards'}
            </span>
            {/* While peeking, this button is how you make it STAY -- which
                is the whole reason it is still here. */}
            <button
              onClick={onToggleCollapsed}
              className="ml-auto hidden rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 lg:block"
              title={peeking ? 'Keep the sidebar open' : 'Collapse sidebar'}
            >
              <ChevronLeft size={15} className={peeking ? 'rotate-180' : ''} />
            </button>
            <button
              onClick={onCloseMobile}
              className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 lg:hidden"
              title="Close"
            >
              <X size={16} />
            </button>
          </>
        )}
      </div>

      {collapsed && (
        <button
          onClick={onToggleCollapsed}
          className="mx-auto mb-1 hidden rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 lg:block"
          title="Expand sidebar"
        >
          <ChevronRight size={15} />
        </button>
      )}

      {/* --- Which dashboard ---------------------------------------------
          Only when there IS a choice. One dashboard is the ordinary case
          and a picker offering a single option is furniture that has to be
          read before it can be ignored. */}
      {!collapsed && spaces.length > 1 && (
        <div className="px-3 pb-2">
          <select
            value={spaceId || ''}
            onChange={(e) => onSpace?.(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 shadow-sm"
            title="Switch dashboard — its pages, sheets and entrance are its own"
          >
            {spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.icon ? `${space.icon} ` : ''}
                {space.name || 'Untitled dashboard'}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* --- Page search ------------------------------------------------- */}
      {/* Only worth showing once there are enough pages to actually hunt
          through -- below that it is pure clutter. */}
      {!collapsed && pages.length > 7 && (
        <div className="relative px-3 pb-2">
          <Search size={13} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Find a page…"
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-7 pr-2 text-xs placeholder:text-slate-300"
          />
        </div>
      )}

      {/* --- Pages ------------------------------------------------------- */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {groups.map(({ group, pages: groupPagesList }) => (
          <div key={group || '__ungrouped__'} className="mb-1">
            {group && !collapsed && (
              <button
                onClick={() => toggleGroup(group)}
                className="flex w-full items-center gap-1 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600"
              >
                <ChevronDown
                  size={12}
                  className={`transition-transform ${isGroupOpen(group) ? '' : '-rotate-90'}`}
                />
                <span className="truncate">{group}</span>
                <span className="ml-auto font-normal normal-case text-slate-300">{groupPagesList.length}</span>
              </button>
            )}
            {/* A collapsed rail has no room for group headers, so it always
                shows every page -- hiding them there would make pages
                unreachable with no visible way to get them back. */}
            {(collapsed || !group || isGroupOpen(group)) &&
              groupPagesList.map((page) => {
                const active = page.id === activePageId
                const label = navLabelFor(page)
                return (
                  <button
                    key={page.id}
                    draggable={canDrag}
                    onDragStart={(e) => {
                      if (!canDrag) return
                      setDragId(page.id)
                      // Some browsers refuse to start a drag with no payload.
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', page.id)
                    }}
                    onDragOver={(e) => {
                      if (!canDrag || !dragId || dragId === page.id) return
                      // Without this the browser refuses the drop, and the
                      // whole thing silently does nothing.
                      e.preventDefault()
                      setOverId(page.id)
                    }}
                    onDragLeave={() => setOverId((id) => (id === page.id ? null : id))}
                    onDrop={(e) => {
                      if (!canDrag) return
                      e.preventDefault()
                      const moved = dragId || e.dataTransfer.getData('text/plain')
                      setDragId(null)
                      setOverId(null)
                      if (moved && moved !== page.id) onMovePage(moved, page.id)
                    }}
                    onDragEnd={() => {
                      setDragId(null)
                      setOverId(null)
                    }}
                    onClick={() => go(page.id)}
                    // The tooltip carries the FULL page name whenever it
                    // differs from the short nav label, so shortening a
                    // sidebar entry never hides what the page actually is.
                    title={
                      collapsed
                        ? page.name
                        : [label !== page.name ? page.name : null, page.description]
                            .filter(Boolean)
                            .join(' — ') || label
                    }
                    className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-all ${
                      active
                        ? 'bg-gradient-to-r from-indigo-500 to-sky-400 font-semibold text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-100'
                    } ${collapsed ? 'justify-center px-0' : ''} ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''} ${
                      dragId === page.id ? 'opacity-40' : ''
                    } ${overId === page.id ? 'ring-2 ring-indigo-400' : ''}`}
                  >
                    {canDrag && (
                      <GripVertical size={13} className={active ? 'text-white/70' : 'text-slate-300'} aria-hidden />
                    )}
                    <PageIcon page={page} size={17} />
                    {!collapsed && <span className="truncate">{label}</span>}
                    {editing && onEditPage && !collapsed && (
                      // A span rather than a nested button: a button inside a
                      // button is invalid HTML and browsers resolve it by
                      // dropping one of them, usually the one you wanted.
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation()
                          onEditPage(page.id)
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return
                          e.preventDefault()
                          e.stopPropagation()
                          onEditPage(page.id)
                        }}
                        title={`Settings for ${page.name}`}
                        className={`ml-auto shrink-0 rounded p-0.5 ${
                          active ? 'text-white/80 hover:text-white' : 'text-slate-300 hover:text-indigo-600'
                        }`}
                      >
                        <Settings size={13} />
                      </span>
                    )}
                  </button>
                )
              })}
          </div>
        ))}

        {/* Which order a drag is about to change. Two behaviours on one
            gesture is only fair if it says which one is running. */}
        {canDrag && dragId && (
          <p className="px-2 pb-1 text-[10px] font-medium text-indigo-600">
            {moveScope === 'everyone' ? 'Setting the order for everyone' : 'Setting your own order'}
          </p>
        )}

        {editing && onAddPage && (
          <button
            onClick={onAddPage}
            title="New page — it opens with its settings beside it"
            className={`mt-1 flex w-full items-center gap-2.5 rounded-lg border border-dashed border-indigo-300 px-2.5 py-2 text-left text-sm font-medium text-indigo-600 hover:bg-indigo-50 ${
              collapsed ? 'justify-center px-0' : ''
            }`}
          >
            <Plus size={16} />
            {!collapsed && <span>New page</span>}
          </button>
        )}

        {groups.length === 0 && (
          <p className={`px-2 py-6 text-center text-xs text-slate-400 ${collapsed ? 'hidden' : ''}`}>
            {pages.length === 0
              ? isAdmin
                ? 'No pages yet — turn on Edit and use “New page” below.'
                : 'No pages have been shared with you yet.'
              : 'No page matches that search.'}
          </p>
        )}
      </nav>

      {/* --- Footer ------------------------------------------------------ */}
      <div className={`border-t border-slate-200/70 p-2 ${collapsed ? 'space-y-1' : 'flex items-center gap-1'}`}>
        {isAdmin && (
          <Link
            to="/admin"
            onClick={onCloseMobile}
            title="Admin panel"
            className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-100 ${
              collapsed ? 'justify-center' : 'flex-1'
            }`}
          >
            <Settings size={15} />
            {!collapsed && <span>Admin</span>}
          </Link>
        )}
        <button
          onClick={signOut}
          title={userDoc?.email || 'Sign out'}
          className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-600 hover:bg-rose-50 hover:text-rose-600 ${
            collapsed ? 'w-full justify-center' : ''
          }`}
        >
          <LogOut size={15} />
          {!collapsed && !isAdmin && <span>Sign out</span>}
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* --- Desktop: in-flow, width animates between rail and full ------ */}
      <aside
        onPointerEnter={onPeekEnter}
        onPointerLeave={onPeekLeave}
        className={`no-print fixed inset-y-0 left-0 z-30 hidden border-r border-slate-200/70 bg-white/85 backdrop-blur-xl transition-[width] duration-200 lg:block ${
          peeking ? 'shadow-2xl' : ''
        }`}
        // A peek draws at full width without changing the content offset --
        // it sits OVER the canvas rather than pushing it.
        style={{ width: collapsed && !peeking ? SIDEBAR_RAIL : SIDEBAR_WIDTH }}
      >
        {renderBody(collapsed && !peeking)}
      </aside>

      {/* --- Mobile / tablet: off-canvas drawer -------------------------- */}
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Close navigation"
            onClick={onCloseMobile}
            className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm"
          />
          <aside
            className="absolute inset-y-0 left-0 border-r border-slate-200/70 bg-white shadow-2xl"
            style={{ width: SIDEBAR_WIDTH }}
          >
            {renderBody(false)}
          </aside>
        </div>
      )}
    </>
  )
}
