import { useState } from 'react'
import { Menu } from 'lucide-react'
import Sidebar, { SIDEBAR_RAIL, SIDEBAR_WIDTH } from './Sidebar.jsx'
import { useLocalState } from '../hooks/usePageData'

/**
 * The frame every signed-in screen sits in: sidebar on the left, content on
 * the right, and a mobile top bar that opens the sidebar as a drawer.
 *
 * The content area is offset with a margin rather than a flex row so the
 * sidebar can be `position: fixed` -- a long dashboard scrolls under a
 * navigation that stays put, which is the behaviour people expect from an
 * app with this many pages.
 *
 * Everything below `lg` collapses to a single column with the drawer, so the
 * same canvas works on a phone without a second layout to maintain.
 */
export default function AppShell({ pages, activePageId, children, title, actions }) {
  const [collapsed, setCollapsed] = useLocalState('dash.sidebarCollapsed', false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [query, setQuery] = useState('')

  return (
    <div className="min-h-screen">
      <Sidebar
        pages={pages}
        activePageId={activePageId}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        // Opening a page collapses the sidebar to its rail, so the canvas
        // gets the width back. The collapsed state is remembered per
        // browser, so this is also what it will be next time.
        onNavigate={() => setCollapsed(true)}
        query={query}
        onQuery={setQuery}
      />

      {/* The content offset has to depend on BOTH the viewport (only inset at
          lg and up, where the sidebar is actually in the layout) and the
          collapsed state (rail vs full). A media query can't read React
          state and a Tailwind class can't hold a runtime value, so the width
          is published as a CSS custom property here and consumed by the
          `.app-content` rule in index.css, which owns the breakpoint. That
          keeps it declarative -- it re-evaluates on resize by itself, with
          no resize listener to get out of sync. */}
      <div style={{ '--sidebar-w': `${collapsed ? SIDEBAR_RAIL : SIDEBAR_WIDTH}px` }}>
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-slate-200/70 bg-white/85 px-3 py-2.5 backdrop-blur-xl lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600"
            aria-label="Open navigation"
          >
            <Menu size={16} />
          </button>
          <span className="truncate text-sm font-semibold text-ink">{title}</span>
          <div className="ml-auto flex items-center gap-1.5">{actions}</div>
        </div>

        <main className="app-content">{children}</main>
      </div>
    </div>
  )
}
