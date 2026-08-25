import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { doc, setDoc } from 'firebase/firestore'
import { ArrowUpDown, Palette, RefreshCw, RotateCcw } from 'lucide-react'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext.jsx'
import { usePageData } from '../hooks/usePageData'
import { useWorkspace, useMyAccess } from '../hooks/useWorkspace'
import { useUserPrefs, orderWidgets } from '../hooks/useUserPrefs'
import { updateCell, SheetsAuthError } from '../lib/sheetsApi'
import { applyFilters, buildKeyBridge, filterIsActive, matchesConditions } from '../lib/filterEngine'
import { widgetUsesPx, widgetWidthPx } from '../lib/config'
import { MIN_HEIGHT_PX, MIN_WIDTH_PX, heightStyle } from '../lib/gridSpan'
import { buildLabelMap, collectTabRefs, mapTabFields, parseRef } from '../lib/refs'
import { applyComputed, computedFor, computedHeaders } from '../lib/computed'
import { blendIsReady, blendRows, blendedHeaders, describeBlend } from '../lib/blend'
import { normalizeKey } from '../lib/dataUtils'
import { canViewPage, canvasFor, canvasLabelFor, sidebarPages, visibleWidgetsFor } from '../lib/workspace'
import { styleClass, styleVars, withPageTheme } from '../lib/widgetStyle'
import { DEFAULT_DESIGN, clampDesign, designVars, moveItem } from '../lib/pageDesign'
import { backgroundLayers, usesLightText } from '../lib/pageBackground'
import { applyWidgetControls, initialControlValues } from '../lib/widgetControls'
import { fixedValues, initialValues, normalizeControls, optionRows, splitControls } from '../lib/pageControls'
import { scopeFilter } from '../lib/userScope'
import { stripUndefined } from '../lib/firestoreSafe'
import WidgetControls from '../components/WidgetControls.jsx'
import ControlBar from '../components/ControlBar.jsx'
import { PageIcon } from '../components/PageIcon.jsx'
import AppShell from '../components/AppShell.jsx'
import CrossFilterChips from '../components/CrossFilterChips.jsx'
import WidgetCanvas from '../components/WidgetCanvas.jsx'
import ArrangeBar from '../components/ArrangeBar.jsx'
import PageDesignPanel from '../components/PageDesignPanel.jsx'
import KpiWidget from '../components/widgets/KpiWidget.jsx'
import PipelineWidget from '../components/widgets/PipelineWidget.jsx'
import FlowWidget from '../components/widgets/FlowWidget.jsx'
import FilterPanelWidget from '../components/widgets/FilterPanelWidget.jsx'
import LeaderboardWidget from '../components/widgets/LeaderboardWidget.jsx'
import TableWidget from '../components/widgets/TableWidget.jsx'
import ChartWidget from '../components/widgets/ChartWidget.jsx'
import { TrendWidget, PivotWidget, GaugeWidget } from '../components/widgets/AnalyticsWidgets.jsx'
import ActivityFeedWidget, { ScorecardWidget } from '../components/widgets/MoreWidgets.jsx'
import {
  ComboWidget,
  HeatmapWidget,
  ScatterWidget,
  StackedWidget,
} from '../components/widgets/ComparisonWidgets.jsx'

// A rough, type-based height guess, used only to decide which MASONRY
// COLUMN a widget belongs to on first layout (see MasonryGrid.jsx) --
// never to size anything on screen.
function estimateWidgetHeight(type) {
  if (type === 'kpi' || type === 'gauge') return 150
  if (type === 'scorecard') return 190
  if (type === 'pipeline') return 260
  if (type === 'flow') return 300
  if (type === 'filters') return 340
  if (type === 'heatmap') return 320
  return 380
}

/**
 * ONE dashboard canvas, composed entirely by an admin.
 *
 * A page may pull from ANY number of connected spreadsheets. Internally
 * every tab is addressed by a qualified ref ("<sourceId>::MASTER", see
 * lib/refs.js) so two sheets that both have a MASTER can sit on one canvas.
 *
 * Refs are an internal address, never something a person should read, so
 * this component does the translation exactly once, at the boundary:
 * everything below it -- the filter engine, all fifteen widget types -- receives
 * the layout rewritten to short human labels, with the row maps keyed by the
 * same labels. That is what lets the entire widget layer stay untouched by
 * the move to many spreadsheets: it never learns that refs exist.
 */
export default function Dashboard() {
  const { pageId } = useParams()
  const navigate = useNavigate()
  const { user, userDoc, isAdmin, getIdToken } = useAuth()

  const { pages, sourcesById, sources, loading: wsLoading } = useWorkspace()
  const { accessByPage } = useMyAccess(user?.uid, pages.map((p) => p.id))

  const [filterValues, setFilterValues] = useState({})
  const [activeButtonIds, setActiveButtonIds] = useState([])
  const [crossFilters, setCrossFilters] = useState([])
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState(null)
  const [arranging, setArranging] = useState(false)
  const [savingLayout, setSavingLayout] = useState(false)

  // --- designing the page, from the page --------------------------------
  // Held as a draft rather than written on every slider tick: a design being
  // fiddled with is not a design the other forty people looking at this page
  // should be watching change under them. It is applied to THIS screen
  // immediately, though -- looking at it is the only way to judge it.
  const [designDraft, setDesignDraft] = useState(null)
  const [themeDraft, setThemeDraft] = useState(null)
  const [designing, setDesigning] = useState(false)

  // What each widget currently measures, so the size boxes can show the
  // number a widget IS rather than an empty box.
  //
  // Collected always, not only while arranging: a ResizeObserver reports
  // once when it starts observing and then only on CHANGE, and those
  // observers are created long before anybody opens the arrange bar. Wiring
  // this up at that moment meant the first -- and for a still page, only --
  // measurement had already been thrown away.
  const [sizes, setSizes] = useState({})

  const noteSize = useCallback((id, width, height, layout) => {
    setSizes((prev) => {
      const was = prev[id]
      if (
        was &&
        Math.abs(was.width - width) <= 1 &&
        Math.abs(was.height - height) <= 1 &&
        was.spanWidth === layout?.spanWidth
      ) {
        return prev
      }
      // The box as well as the size: switching to a free canvas has to
      // reproduce exactly what is on screen, and it cannot do that without
      // knowing where everything currently sits.
      return {
        ...prev,
        [id]: {
          width,
          height,
          span: layout?.span,
          spanWidth: layout?.spanWidth,
          left: layout?.box?.left,
          top: layout?.box?.top,
        },
      }
    })
  }, [])
  // Per-widget control values, keyed by widget id then control id. Held here
  // rather than inside each widget so the rows a widget receives are already
  // narrowed and no widget type needs to know controls exist.
  const [controlValues, setControlValues] = useState({})

  // Pages this user may open -- the sidebar must never advertise a page that
  // would immediately refuse them.
  const allowedPages = useMemo(
    () => pages.filter((p) => canViewPage(accessByPage[p.id], isAdmin)),
    [pages, accessByPage, isAdmin]
  )

  // ...of those, the ones the admin actually wants in the sidebar. A
  // sub-canvas is reached from its parent's tab strip instead.
  const visiblePages = useMemo(() => sidebarPages(allowedPages), [allowedPages])

  const page = pages.find((p) => p.id === pageId) || null
  const access = accessByPage[pageId]
  const canView = canViewPage(access, isAdmin)

  // What is on screen: the draft while an admin is designing, the saved
  // design the rest of the time.
  const design = useMemo(
    () => clampDesign(designDraft ?? page?.design),
    [designDraft, page?.design]
  )
  const pageTheme = themeDraft ?? page?.theme ?? ''
  const designDirty = designDraft !== null || themeDraft !== null

  /**
   * The page's own appearance, written for everybody.
   *
   * Admin-only, and the Firestore rules say so independently -- the missing
   * button is a convenience, not the security.
   */
  async function savePageDesign() {
    if (!isAdmin || !page?.id) return
    setSavingLayout(true)
    try {
      await setDoc(
        doc(db, 'dashboards', page.id),
        stripUndefined({ design, ...(themeDraft === null ? {} : { theme: themeDraft }) }),
        { merge: true }
      )
      setDesignDraft(null)
      setThemeDraft(null)
    } finally {
      setSavingLayout(false)
    }
  }

  /**
   * How one widget looks, written for everybody.
   *
   * Same rule as its size: appearance is a property of the PAGE, not of the
   * reader. A canvas where one widget is olive for one person and indigo
   * for another is not a canvas anybody designed.
   */
  async function saveWidgetStyle(widgetId, style) {
    if (!isAdmin || !page?.id) return
    const widgets = (page.widgets || []).map((w) => (w.id === widgetId ? { ...w, style } : w))
    setSavingLayout(true)
    try {
      await setDoc(doc(db, 'dashboards', page.id), stripUndefined({ widgets }), { merge: true })
    } finally {
      setSavingLayout(false)
    }
  }

  async function saveWidgetSize(widgetId, patch) {
    if (!isAdmin || !page?.id) return

    const floors = { widthPx: MIN_WIDTH_PX, heightPx: MIN_HEIGHT_PX }
    const clean = {}
    for (const [key, value] of Object.entries(patch)) {
      const n = Number(value)
      clean[key] =
        value === '' || value === null || !Number.isFinite(n) || n <= 0
          ? null
          : Math.max(floors[key] || 1, Math.round(n))
    }

    const current = (page.widgets || []).find((w) => w.id === widgetId)
    // Nothing to write. The handle commits on blur as well as on a pause, so
    // tabbing out of a box nobody edited used to cost a whole page write.
    if (current && Object.entries(clean).every(([k, v]) => (current[k] ?? null) === v)) return

    const widgets = (page.widgets || []).map((w) =>
      w.id === widgetId
        ? {
            ...w,
            ...clean,
            // A pinned width is only honoured in pixel mode, and typing one
            // here is how somebody says that is what they want.
            ...(clean.widthPx ? { widthMode: 'px' } : null),
          }
        : w
    )

    setSavingLayout(true)
    try {
      await setDoc(doc(db, 'dashboards', page.id), stripUndefined({ widgets }), { merge: true })
    } finally {
      setSavingLayout(false)
    }
  }

  // Saving a dragged column order writes back to this page's document, so it
  // applies to every user rather than living in one browser session.
  async function saveColumnOrder(widgetId, columns) {
    if (!page) return
    await setDoc(
      doc(db, 'dashboards', page.id),
      // The whole widget list is rewritten, so any `undefined` sitting on an
      // unrelated widget would fail this save too -- see lib/firestoreSafe.js.
      stripUndefined({ widgets: (page.widgets || []).map((w) => (w.id === widgetId ? { ...w, columns } : w)) }),
      { merge: true }
    )
  }

  // Edit / download rights are stored per REF, but widgets ask by label.
  //
  // The SHEET's own headers, deliberately, not the calculated ones: an
  // inline edit is written back to Google by column name, and a calculated
  // column has no cell there to write to. It is read-only by construction.
  const grantFor = useCallback(
    (kind, label) => {
      const ref = refByLabel[label]
      if (isAdmin) return dataByRef[ref]?.headers || []
      return access?.[kind]?.[ref] || []
    },
    [isAdmin, access, dataByRef, refByLabel]
  )

  async function handleEditCell(label, row, column, value) {
    const ref = refByLabel[label]
    if (!ref) return
    setSaving(true)
    setEditError(null)
    try {
      const idToken = await getIdToken()
      await updateCell(idToken, page.id, ref, row._row, dataByRef[ref]?.headers || [], column, value)
      await reload()
    } catch (e) {
      setEditError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // No page id in the URL, or one that no longer exists (deleted, or never
  // shared with this user) -- land on their first available page instead of
  // an error they can't act on. Done as an effect, never during render:
  // navigating mid-render triggers a React state-update warning and can
  // re-enter this component before it has finished committing.
  useEffect(() => {
    if (wsLoading || page || visiblePages.length === 0) return
    navigate(`/d/${visiblePages[0].id}`, { replace: true })
  }, [wsLoading, page, visiblePages, navigate])

  const totalLabel = useMemo(() => {
    const primary = view.widgets.find((w) => w.type === 'table')
    if (!primary) return null
    const shown = rowsByLabel[primary.tab]?.length ?? 0
    const total = rawRowsByLabel[primary.tab]?.length ?? 0
    return shown === total
      ? `${total.toLocaleString('en-IN')} rows`
      : `${shown.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} rows`
  }, [view, rowsByLabel, rawRowsByLabel])

  const headerActions = (
    <>
      {isAdmin && (
        <button
          onClick={() => {
            setDesigning((v) => !v)
            // Designing and arranging are the same mode seen from two ends:
            // opening one turns on the handles the other needs.
            if (!designing) setArranging(true)
          }}
          className={`rounded-lg border p-2 transition-colors ${
            designing
              ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
          title="Design this page — spacing, text size, card look"
        >
          <Palette size={15} />
        </button>
      )}
      {isAdmin && allowedWidgets.length > 1 && (
        <button
          onClick={() => setArranging((a) => !a)}
          className={`rounded-lg border p-2 transition-colors ${
            arranging
              ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
          title="Arrange widgets — order, width and height"
        >
          <ArrowUpDown size={15} />
        </button>
      )}
      <button
        onClick={reload}
        className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
        title="Refresh from Google Sheets"
      >
        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
      </button>
    </>
  )

  const sourceNames = (page?.sourceIds || [])
    .map((id) => sourcesById[id]?.name)
    .filter(Boolean)

  const bgLayers = backgroundLayers(page?.background)
  // Chrome that sits directly on the backdrop -- the heading, the tab strip,
  // the arrange bar -- inverts with it. Widget cards keep their own light
  // surface and are deliberately unaffected.
  const lightText = usesLightText(page?.background)

  // The widgets themselves, built once and handed to whichever layout
  // is drawing them -- so switching between the two cannot possibly
  // change what is on the page, only where it sits.
  const widgetItems = view.widgets.map((widget, index) => {
                const blended = blendedByWidget[widget.id]
                const tabData = dataByLabel[widget.tab]
                const headers = blended ? blended.headers : tabData?.headers || []

                // The widget's own controls run LAST, on top of the page
                // filters and any blend -- so "top 10" means the top 10 of
                // what the page is currently showing.
                const preControl = blended ? blended.rows : rowsByLabel[widget.tab] || []
                const myControls = widget.controls || []
                const myValues = controlValues[widget.id]
                const rows = myControls.length
                  ? applyWidgetControls(preControl, myControls, myValues, dateOrder)
                  : preControl
                const unfilteredBase = blended ? blended.unfiltered : rawRowsByLabel[widget.tab] || []
                const unfiltered = myControls.length
                  ? applyWidgetControls(unfilteredBase, myControls, myValues, dateOrder)
                  : unfilteredBase

                // A blended widget's drills go through a translator that
                // resolves a blended column back to the join key, so the
                // click narrows the whole page instead of nothing.
                const drill = crossFilterHandlerFor(widget, blended, tabData?.headers || [])

                // Exporting is on unless an admin turned it off -- and an
                // admin can always take the data they administer.
                const canExport = isAdmin || widget.allowExport !== false
                // The page's look, unless this widget states its own.
                const themed = withPageTheme(widget.style, pageTheme)

                // A widget the admin sized has to fill that size, not sit
                // in the top of it: growing the card and leaving a 260px
                // chart inside it just moves the empty space around.
                const fillHeight = Number(widget.heightPx) > 0

                const common = { widget, rows, unfilteredRows: unfiltered, tabError: tabData?.error, fillHeight }

                return {
                  id: widget.id,
                  width: widget.width,
                  // An exact 1-12 span, which overrides the named preset.
                  widthUnits: widget.widthUnits,
                  // ...unless the admin chose pixels, which overrides both.
                  widthPx: widgetUsesPx(widget) ? widgetWidthPx(widget) : null,
                  // A pinned height is a better guess than the type's, and
                  // using it here means the column packing is right on the
                  // first frame rather than after the widget measures.
                  estimatedHeight: Number(widget.heightPx) > 0 ? Number(widget.heightPx) : estimateWidgetHeight(widget.type),
                  content: (
                    // The wrapper publishes this widget's appearance as CSS
                    // custom properties, which `.card` reads (see index.css).
                    // An unstyled widget emits none and looks exactly as it
                    // always did -- no widget component knows about theming.
                    <div
                      className={`rise-in relative ${styleClass(themed)} ${
                        Number(widget.heightPx) > 0 ? 'widget-sized' : ''
                      }`}
                      style={{
                        animationDelay: `${Math.min(index * 45, 360)}ms`,
                        ...(styleVars(themed) || {}),
                        // A pinned height, expressed so a phone can still
                        // keep the promise -- see lib/gridSpan.js.
                        ...(heightStyle(widget.heightPx) || {}),
                      }}
                    >
                      {arranging && (
                        <ArrangeBar
                          index={index + 1}
                          order={widgetOrder[widget.id] ?? ''}
                          onOrder={(v) => setWidgetOrder(widget.id, v)}
                          widthPx={widget.widthPx ?? ''}
                          heightPx={widget.heightPx ?? ''}
                          style={widget.style}
                          measured={sizes[widget.id]}
                          onSize={(patch) => saveWidgetSize(widget.id, patch)}
                          onStyle={isAdmin ? (next) => saveWidgetStyle(widget.id, next) : undefined}
                          title={widget.title}
                        />
                      )}

                      {/* This widget's own controls, above its card. Living
                          here rather than inside each widget is what lets
                          all sixteen types have them. */}
                      <WidgetControls
                        controls={myControls}
                        values={myValues}
                        rows={preControl}
                        dateOrder={dateOrder}
                        onChange={(controlId, value) =>
                          setControlValues((all) => ({
                            ...all,
                            [widget.id]: { ...(all[widget.id] || {}), [controlId]: value },
                          }))
                        }
                        onReset={() =>
                          setControlValues((all) => ({ ...all, [widget.id]: initialControlValues(myControls) }))
                        }
                      />

                      {widget.type === 'kpi' && (
                        <KpiWidget
                          {...common}
                          rowsByTab={rowsByLabel}
                          rawRowsByTab={rawRowsByLabel}
                          onCrossFilter={drill}
                          isDrilled={crossFilters.some((c) => c.id === `kpi_${widget.id}`)}
                        />
                      )}
                      {widget.type === 'chart' && (
                        <ChartWidget
                          {...common}
                          crossFilters={crossFilters}
                          onCrossFilter={drill}
                          canExport={canExport}
                          dateOrder={dateOrder}
                        />
                      )}
                      {widget.type === 'trend' && (
                        <TrendWidget
                          {...common}
                          dateOrder={dateOrder}
                          crossFilters={crossFilters}
                          onCrossFilter={drill}
                          canExport={canExport}
                        />
                      )}
                      {widget.type === 'gauge' && (
                        <GaugeWidget
                          {...common}
                          onCrossFilter={drill}
                          isDrilled={crossFilters.some((c) => c.id === `gauge_${widget.id}`)}
                        />
                      )}
                      {widget.type === 'pivot' && (
                        <PivotWidget {...common} onCrossFilter={drill} canExport={canExport} dateOrder={dateOrder} />
                      )}
                      {widget.type === 'heatmap' && (
                        <HeatmapWidget {...common} onCrossFilter={drill} dateOrder={dateOrder} />
                      )}
                      {widget.type === 'stacked' && (
                        <StackedWidget
                          {...common}
                          crossFilters={crossFilters}
                          onCrossFilter={drill}
                          dateOrder={dateOrder}
                        />
                      )}
                      {widget.type === 'combo' && (
                        <ComboWidget {...common} crossFilters={crossFilters} onCrossFilter={drill} />
                      )}
                      {widget.type === 'scatter' && <ScatterWidget {...common} />}
                      {widget.type === 'activity' && <ActivityFeedWidget {...common} dateOrder={dateOrder} />}
                      {widget.type === 'scorecard' && <ScorecardWidget {...common} dateOrder={dateOrder} />}
                      {widget.type === 'pipeline' && (
                        <PipelineWidget
                          widget={widget}
                          rowsByTab={rowsByLabel}
                          rawRowsByTab={rawRowsByLabel}
                          crossFilters={crossFilters}
                          onCrossFilter={drill}
                          dateOrder={dateOrder}
                        />
                      )}
                      {widget.type === 'flow' && (
                        <FlowWidget
                          widget={widget}
                          rowsByTab={rowsByLabel}
                          rawRowsByTab={rawRowsByLabel}
                          headersByTab={headersByLabel}
                          crossFilters={crossFilters}
                          onCrossFilter={toggleCrossFilter}
                          dateOrder={dateOrder}
                          canExport={canExport}
                          fillHeight={fillHeight}
                        />
                      )}
                      {widget.type === 'filters' && (
                        <FilterPanelWidget
                          widget={widget}
                          controls={view.controls}
                          values={filterValues}
                          onChange={(id, value) => setFilterValues((v) => ({ ...v, [id]: value }))}
                          tabsData={dataByLabel}
                          optionRows={optionRowsByControl}
                          dateOrder={dateOrder}
                        />
                      )}
                      {widget.type === 'leaderboard' && (
                        <LeaderboardWidget
                          {...common}
                          crossFilters={crossFilters}
                          onCrossFilter={drill}
                          canExport={canExport}
                          dateOrder={dateOrder}
                        />
                      )}
                      {widget.type === 'table' && (
                        <TableWidget
                          {...common}
                          tabHeaders={headers}
                          // Only the LEFT tab's own columns are ever
                          // editable: a blended column is a copy of a cell
                          // that lives in a different spreadsheet, and
                          // writing it back here would silently edit the
                          // wrong sheet (or several rows at once).
                          editableColumns={
                            widget.editable
                              ? grantFor('editable', widget.tab).filter((c) =>
                                  (tabData?.headers || []).includes(c)
                                )
                              : []
                          }
                          downloadableColumns={
                            widget.downloadButtons ? grantFor('downloadable', widget.tab) : []
                          }
                          onEditCell={handleEditCell}
                          saving={saving}
                          dateOrder={dateOrder}
                          canExport={canExport}
                          canPersistLayout={isAdmin}
                          onSaveColumnOrder={(cols) => saveColumnOrder(widget.id, cols)}
                        />
                      )}

                      {/* Where the extra columns on a blended widget came
                          from, stated on the card itself so nobody has to
                          open the admin panel to find out. */}
                      {blendIsReady(widget.blend) && (
                        <p className="mt-1 px-1 text-[10px] text-slate-400">
                          🔗 {describeBlend(widget.blend, labelFor)}
                        </p>
                      )}
                    </div>
                  ),
                }
              })

  return (
    <>
      {/* This page's own backdrop, on its own fixed layers BEHIND everything.
          Painting it here rather than as a background on the content
          container is what lets opacity and blur apply to the backdrop
          alone -- on the container they would fade and smear the widgets
          sitting inside it. */}
      {bgLayers && (
        <>
          <div
            aria-hidden
            className="pointer-events-none fixed inset-0"
            style={{ ...bgLayers.base, zIndex: 0 }}
          />
          {bgLayers.overlay && (
            <div
              aria-hidden
              className="pointer-events-none fixed inset-0"
              style={{ ...bgLayers.overlay, zIndex: 0 }}
            />
          )}
        </>
      )}

      <AppShell pages={visiblePages} activePageId={pageId} title={page?.name || 'Dashboard'} actions={headerActions}>
      {/* Sits above the backdrop layers. The sidebar is z-30 and stays above
          both. */}
      <div
        className={`page-canvas relative z-[1] min-h-screen space-y-3 p-3 md:p-4 ${lightText ? 'page-invert' : ''}`}
        // The whole design, as custom properties. `.card` already reads
        // `--card-*` (see index.css), so a page-wide surface is one
        // declaration on this element and no widget learns anything new.
        style={{
          ...designVars(design),
          ...(design.maxWidth > 0 ? { maxWidth: design.maxWidth, marginInline: 'auto' } : null),
        }}
      >
        {/* --- Page header (desktop; mobile gets AppShell's top bar) ----- */}
        <div className="page-chrome hidden flex-wrap items-center justify-between gap-3 lg:flex">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 truncate text-xl font-semibold text-ink">
              <PageIcon page={page} size={22} />
              {page?.name || 'Dashboard'}
            </h1>
            <p className="truncate text-xs text-slate-400">
              {page?.description ||
                (sourceNames.length ? `${sourceNames.length} source${sourceNames.length > 1 ? 's' : ''} · ${sourceNames.join(' · ')}` : 'No data sources connected')}
              {lastLoaded && ` · updated ${lastLoaded.toLocaleTimeString()}`}
            </p>
          </div>
          <div className="flex items-center gap-2">{headerActions}</div>
        </div>

        {/* --- Canvas tabs: this page's sub-canvases ---------------------- */}
        {canvas && (
          <div className="page-chrome page-chrome-surface flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white/80 p-1 backdrop-blur">
            {canvas.tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => navigate(`/d/${tab.id}`)}
                title={tab.name}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                  tab.id === pageId
                    ? 'bg-gradient-to-r from-indigo-500 to-sky-400 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <PageIcon page={tab} size={15} />
                {/* Which name a tab shows is the page's own choice -- a tab
                    strip has more room than a sidebar entry, so it may opt
                    into the full page title. */}
                {canvasLabelFor(tab)}
              </button>
            ))}
          </div>
        )}

        {/* --- Arrange mode banner ---------------------------------------- */}
        {arranging && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-800">
            <ArrowUpDown size={13} />
            <span>
              <strong>Drag the ⣿ handle</strong> to move a widget — that reorders the page for everyone. Every
              widget also wears a pill showing its position and real size; click it to edit, or use its 🖌 to
              change how that one widget looks. <strong>#</strong> is the position: lower first, blank leaves it
              where it is, and it is yours alone. <strong>W</strong> and <strong>H</strong> are pixels and belong to
              the page — or set a width in <em>columns</em> instead and no pixels are involved at all. They save
              when you leave the box, press Enter, or pause; Escape puts back what was saved. An amber{' '}
              <strong>+n</strong> means that widget claims n pixels of the canvas it doesn’t use, and the ⤢ inside
              widens it to close the gap. The <strong>palette</strong> button in the page header opens spacing,
              columns, text size and the card surface.
            </span>
            {savingLayout && <span className="text-[10px] font-medium text-indigo-500">saving…</span>}
            <div className="ml-auto flex gap-2">
              <button
                onClick={clearOrder}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[11px] hover:bg-indigo-50"
              >
                <RotateCcw size={11} /> Reset to default
              </button>
              <button
                onClick={() => setArranging(false)}
                className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-700"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {wsLoading && <div className="card py-10 text-center text-slate-400">Loading workspace…</div>}

        {!wsLoading && pages.length === 0 && (
          <div className="card py-10 text-center text-slate-400">
            🧭 No dashboard pages exist yet.
            {isAdmin ? ' Create one in the admin panel.' : ' Ask an admin to build one.'}
          </div>
        )}

        {!wsLoading && page && !canView && (
          <div className="card py-10 text-center text-slate-400">
            🔒 You don’t have access to <strong>{page.name}</strong> yet. Ask an admin to grant it.
          </div>
        )}

        {canView && page && (page.sourceIds || []).length === 0 && (
          <div className="card py-10 text-center text-slate-400">
            🔌 No spreadsheet is connected to <strong>{page.name}</strong> yet.
            {isAdmin && ' Connect one in the admin panel.'}
          </div>
        )}

        {canView && page && allowedWidgets.length === 0 && (page.sourceIds || []).length > 0 && (
          <div className="card py-10 text-center text-slate-400">
            🧱 This page has no widgets you can see.
            {isAdmin ? ' Add tables, KPIs and charts in the admin panel.' : ''}
          </div>
        )}

        {canView && error && (
          <div className="card space-y-3 py-8 text-center">
            <p className="text-sm text-rose-500">{error.message}</p>
            {error instanceof SheetsAuthError ? (
              <p className="text-xs text-slate-400">Try signing out and back in.</p>
            ) : (
              <button onClick={reload} className="rounded-lg bg-ink px-4 py-2 text-sm text-white">
                Retry
              </button>
            )}
          </div>
        )}

        {canView && !error && allowedWidgets.length > 0 && (
          <>
            <ControlBar
              controls={view.controls}
              values={filterValues}
              onChange={(id, value) => setFilterValues((v) => ({ ...v, [id]: value }))}
              activeButtonIds={activeButtonIds}
              onToggleButton={toggleButton}
              onClearButtons={() => setActiveButtonIds([])}
              onReset={resetFilters}
              search={search}
              onSearch={setSearch}
              showSearch={!page?.hideSearch}
              views={views}
              onApplyView={applyView}
              tabsData={dataByLabel}
              optionRows={optionRowsByControl}
              totalLabel={totalLabel}
              dateOrder={dateOrder}
            />

            <CrossFilterChips
              crossFilters={crossFilters}
              onRemove={(id) => setCrossFilters((c) => c.filter((x) => x.id !== id))}
              onClear={() => setCrossFilters([])}
            />

            {editError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                {editError}
              </div>
            )}

            <WidgetCanvas
              items={widgetItems}
              gapX={design.gapX}
              gapY={design.gapY}
              onMeasure={noteSize}
            />

            {loading && view.widgets.length === 0 && (
              <div className="card py-10 text-center text-slate-400">Loading…</div>
            )}
          </>
        )}
      </div>

      {designing && isAdmin && (
        <PageDesignPanel
          design={design}
          theme={pageTheme}
          dirty={designDirty}
          saving={savingLayout}
          onChange={setDesignDraft}
          onThemeChange={setThemeDraft}
          onSave={savePageDesign}
          onClose={() => {
            setDesigning(false)
            // An unsaved design is discarded on close rather than left
            // hanging: a draft nobody can see the panel for is a page that
            // looks wrong for no visible reason.
            setDesignDraft(null)
            setThemeDraft(null)
          }}
        />
      )}
      </AppShell>
    </>
  )
}
