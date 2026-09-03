import { useEffect, useRef, useState } from 'react'
import { Menu } from 'lucide-react'
import Sidebar, { SIDEBAR_RAIL, SIDEBAR_WIDTH } from './Sidebar.jsx'
import { useLocalState } from '../hooks/usePageData'
import { CLOSE_DELAY, EDGE, OPEN_DELAY, canPeek, contentOffset } from '../lib/sidebarPeek'
import MessageCenter from './MessageCenter.jsx'

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
export default function AppShell({
  pages,
  activePageId,
  // Passed straight through to the sidebar, which is where the choice of
  // dashboard belongs -- see lib/spaces.js.
  spaces,
  spaceId,
  onSpace,
  children,
  title,
  actions,
  // Passed straight through: the shell has no opinion about editing,
  // it just owns the sidebar the buttons live in.
  editing = false,
  onAddPage,
  onEditPage,
  onMovePage,
  moveScope,
}) {
  const [collapsed, setCollapsed] = useLocalState('dash.sidebarCollapsed', false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [query, setQuery] = useState('')

  // --- the sidebar that comes when called --------------------------------
  // Hovering the left edge opens the collapsed rail; moving away puts it
  // back. See lib/sidebarPeek.js for the three rules that stop this being
  // the kind of hover menu people disable.
  const [peeking, setPeeking] = useState(false)
  const peekTimer = useRef(null)

  // No hover on a touch screen, and a hot zone there is a strip of the page
  // that swallows taps. Read once and kept, because a device does not grow
  // a mouse halfway through a session.
  const [hasHover] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(hover: hover) and (pointer: fine)').matches
  )

  const allowed = canPeek({ collapsed, hasHover, mobileOpen })

  // A peek is only ever a peek: pinning it open, or the drawer taking over,
  // ends it rather than leaving a second idea of "open" running underneath.
  useEffect(() => {
    if (!allowed && peeking) setPeeking(false)
  }, [allowed, peeking])

  useEffect(() => () => clearTimeout(peekTimer.current), [])

  const openLater = () => {
    clearTimeout(peekTimer.current)
    peekTimer.current = setTimeout(() => setPeeking(true), OPEN_DELAY)
  }
  const closeLater = () => {
    clearTimeout(peekTimer.current)
    peekTimer.current = setTimeout(() => setPeeking(false), CLOSE_DELAY)
  }
  const keepOpen = () => clearTimeout(peekTimer.current)

  return (
    <div className="min-h-screen">
      {/* The strip that arms it. A real element rather than a document
          listener: it only exists where a peek is possible, so there is no
          mousemove handler running on every frame of every dashboard. */}
      {allowed && (
        <div
          aria-hidden
          onPointerEnter={openLater}
          onPointerLeave={closeLater}
          className="fixed inset-y-0 left-0 z-40 hidden lg:block"
          style={{ width: EDGE }}
        />
      )}

      <Sidebar
        pages={pages}
        spaces={spaces}
        spaceId={spaceId}
        onSpace={onSpace}
        peeking={peeking && collapsed}
        onPeekEnter={allowed || peeking ? keepOpen : undefined}
        onPeekLeave={allowed || peeking ? closeLater : undefined}
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
        editing={editing}
        onAddPage={onAddPage}
        onEditPage={onEditPage}
        onMovePage={onMovePage}
        moveScope={moveScope}
      />

      {/* The content offset has to depend on BOTH the viewport (only inset at
          lg and up, where the sidebar is actually in the layout) and the
          collapsed state (rail vs full). A media query can't read React
          state and a Tailwind class can't hold a runtime value, so the width
          is published as a CSS custom property here and consumed by the
          `.app-content` rule in index.css, which owns the breakpoint. That
          keeps it declarative -- it re-evaluates on resize by itself, with
          no resize listener to get out of sync. */}
      {/* Blind to the peek on purpose: a peek OVERLAYS, so the content
          offset is whatever the pinned state says and the page never
          reflows as the pointer crosses the edge. */}
      <div
        style={{
          '--sidebar-w': `${contentOffset({ collapsed, rail: SIDEBAR_RAIL, full: SIDEBAR_WIDTH })}px`,
        }}
      >
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

        {/* Mounted on the SHELL rather than on a page: a message about the
            workspace should not vanish because somebody navigated to the
            admin panel, and the bell has to be reachable from everywhere. */}
        <main className="app-content">
          <MessageCenter />
          {children}
        </main>
      </div>
    </div>
  )
}
