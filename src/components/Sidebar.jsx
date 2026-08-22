import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  LogOut,
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
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
  onNavigate,
  query,
  onQuery,
}) {
  const { isAdmin, signOut, userDoc } = useAuth()
  const navigate = useNavigate()
  const [openGroups, setOpenGroups] = useLocalState('dash.openGroups', {})

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
            <span className="truncate text-sm font-semibold text-ink">Dashboards</span>
            <button
              onClick={onToggleCollapsed}
              className="ml-auto hidden rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 lg:block"
              title="Collapse sidebar"
            >
              <ChevronLeft size={15} />
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
                    } ${collapsed ? 'justify-center px-0' : ''}`}
                  >
                    <PageIcon page={page} size={17} />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </button>
                )
              })}
          </div>
        ))}

        {groups.length === 0 && (
          <p className={`px-2 py-6 text-center text-xs text-slate-400 ${collapsed ? 'hidden' : ''}`}>
            {pages.length === 0
              ? isAdmin
                ? 'No pages yet — create one in the admin panel.'
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
        className="fixed inset-y-0 left-0 z-30 hidden border-r border-slate-200/70 bg-white/85 backdrop-blur-xl transition-[width] duration-200 lg:block"
        style={{ width: collapsed ? SIDEBAR_RAIL : SIDEBAR_WIDTH }}
      >
        {renderBody(collapsed)}
      </aside>

      {/* --- Mobile / tablet: off-canvas drawer -------------------------- */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
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
