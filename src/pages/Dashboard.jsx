import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { doc, setDoc } from 'firebase/firestore'
import { ArrowUpDown, ChevronLeft, ChevronRight, ChevronUp, Eye, EyeOff, Layers, Move, Palette, Printer, Redo2, RefreshCw, RotateCcw, StickyNote, Undo2 } from 'lucide-react'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext.jsx'
import { useSpace } from '../context/SpaceContext.jsx'
import { activeSpace, spaceForPage, spacesForUser, stampSpace } from '../lib/spaces'
import StickyNotes from '../components/StickyNotes.jsx'
import { NotesLayerProvider } from '../context/NotesLayer.jsx'
import { newNote } from '../lib/stickyNotes'
import { usePageData, useLocalState } from '../hooks/usePageData'
import { useWorkspace, useMyAccess } from '../hooks/useWorkspace'
import { useUserPrefs, usePagePrefs, orderWidgets } from '../hooks/useUserPrefs'
import { updateCell, SheetsAuthError } from '../lib/sheetsApi'
import { applyFilters, buildKeyBridge, filterIsActive, matchesConditions } from '../lib/filterEngine'
import { applyRowConditions } from '../lib/rowConditions'
import { mergeDraft } from '../lib/editMode'
import { canDrop, dragPages, orderPages, personalOrder } from '../lib/pageOrder'
import { valuesForRef } from '../lib/columnValues'
import { canRedo, canUndo, commitHistory, emptyHistory, historyKeyAction, redoHistory, undoHistory } from '../lib/history'
import { chromeClass } from '../lib/widgetChrome'
import { makeWidget, WIDGET_TYPES } from '../lib/newWidget'
import EditSplit from '../components/EditSplit.jsx'
import WidgetTypePreview from '../components/WidgetTypePreview.jsx'
import { hasVariants, variantHint, variantPatch, variantTitle, variantsFor } from '../lib/widgetVariants'
import { appliedFilters, printStamp } from '../lib/printView'
import { DEFAULT_FRACTION, DEFAULT_SIDE, previewHeight, previewKind, targetTitle } from '../lib/editLayout'
import { WorkspaceCtx } from './admin/ui.jsx'

/**
 * The three editor panels, fetched when an admin first opens one.
 *
 * They are the biggest thing in the app -- every widget editor, every
 * control editor, every condition builder -- and they were landing in the
 * bundle EVERY visitor downloads before seeing a number. Most visitors are
 * readers who cannot open an editor at all, and even an admin spends most
 * of their time reading rather than editing.
 *
 * `WorkspaceCtx` stays eager: it is a context object of a few lines, and
 * the provider wraps the page whether or not anything is being edited.
 */
const WidgetsPanel = lazy(() => import('./admin/WidgetsPanel.jsx'))
const ControlsPanel = lazy(() => import('./admin/ControlsPanel.jsx'))
const PageSettings = lazy(() => import('./admin/PagesPanel.jsx').then((m) => ({ default: m.PageSettings })))
import { widgetUsesPx, widgetWidthPx } from '../lib/config'
import { buildLabelMap, collectTabRefs, mapTabFields, parseRef } from '../lib/refs'
import { buildChoices } from '../lib/columnChoices'
import { matchTargets } from '../lib/spin360'
import {
  MAX_WIDGET_DEPTH,
  ascendWidget,
  childWidgets,
  descendWidget,
  editLevel,
  findWidget,
  hasChildren,
  insideLabel,
  liveWidgetPath,
  widgetPath,
  widgetsAt,
} from '../lib/widgetNest'
import { applyComputed, computedFor, computedHeaders } from '../lib/computed'
import { blendIsReady, blendRows, blendedHeaders, describeBlend } from '../lib/blend'
import { normalizeKey } from '../lib/dataUtils'
import { canViewPage, canvasFor, canvasLabelFor, emptyPage, newPageId, sidebarPages, visibleWidgetsFor } from '../lib/workspace'
import { styleClass, styleVars, withPageTheme } from '../lib/widgetStyle'
import { DEFAULT_DESIGN, clampDesign, designClass, designVars, moveItem } from '../lib/pageDesign'
import { mergeVisuals } from '../lib/chartVisuals'
import { backgroundLayers, sidebarSurface, usesLightText } from '../lib/pageBackground'
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
import {
  changedIn,
  clampRect,
  DESIGN_WIDTH,
  isPlaced,
  patchOf,
  placeAll,
  seedFrom,
} from '../lib/freeLayout'
import ArrangeBar from '../components/ArrangeBar.jsx'
import PageDesignPanel from '../components/PageDesignPanel.jsx'
import KpiWidget from '../components/widgets/KpiWidget.jsx'
import PipelineWidget from '../components/widgets/PipelineWidget.jsx'
import FlowWidget from '../components/widgets/FlowWidget.jsx'
import FilterPanelWidget from '../components/widgets/FilterPanelWidget.jsx'
import DumbbellWidget, { SunburstWidget } from '../components/widgets/RelationWidgets.jsx'
import ErrorBoundary from '../components/ErrorBoundary.jsx'
import { CanvasSkeleton } from '../components/Booting.jsx'
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
import StatGridWidget, { BulletWidget, MoversWidget, WaffleWidget } from '../components/widgets/MetricWidgets.jsx'
import CalendarHeatWidget, { CohortWidget, GanttWidget } from '../components/widgets/TimeWidgets.jsx'
import BoxPlotWidget, {
  ProfileWidget,
  SankeyWidget,
  WordCloudWidget,
} from '../components/widgets/DistributionWidgets.jsx'
import NoteWidget, { CountdownWidget, MediaWidget } from '../components/widgets/CanvasWidgets.jsx'
import Spin360Widget from '../components/widgets/Spin360Widget.jsx'
import RingStatsWidget, {
  ProcessWidget,
  PyramidWidget,
} from '../components/widgets/InfographicWidgets.jsx'

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
  // The canvas furniture is short by nature -- a heading given the same
  // 380px guess as a table would open a hole under it on first paint.
  if (type === 'note') return 90
  if (type === 'countdown') return 150
  if (type === 'media') return 220
  if (type === 'stat' || type === 'bullet') return 210
  // A row of rings and a band of chevrons are both short and wide; a
  // pyramid needs room for its layers to be worth tapering.
  if (type === 'rings') return 220
  if (type === 'process') return 170
  if (type === 'pyramid') return 300
  if (type === 'waffle') return 300
  if (type === 'calendar') return 200
  if (type === 'cohort' || type === 'movers') return 300
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
 * everything below it -- the filter engine, every widget type -- receives
 * the layout rewritten to short human labels, with the row maps keyed by the
 * same labels. That is what lets the entire widget layer stay untouched by
 * the move to many spreadsheets: it never learns that refs exist.
 */
export default function Dashboard() {
  const { pageId } = useParams()
  const navigate = useNavigate()
  const { user, userDoc, isAdmin, getIdToken } = useAuth()

  // Which of this account's dashboards is open. Each has its own pages,
  // its own sheet connections and its own entrance -- see lib/spaces.js.
  const { spaceId, chooseSpace, spaces } = useSpace()
  const { pages, allPages, sourcesById, sources, loading: wsLoading } = useWorkspace(spaceId)
  // Grants for EVERY page in the account, not just this dashboard's: which
  // dashboards this person may open is decided by the pages they can see in
  // each, so the answer needs all of them.
  const { accessByPage } = useMyAccess(user?.uid, allPages.map((p) => p.id))

  const allowedSpaces = useMemo(
    () => spacesForUser(spaces, allPages, accessByPage, isAdmin),
    [spaces, allPages, accessByPage, isAdmin]
  )

  // The dashboard the URL is asking for. A link to a page IS a link to the
  // dashboard that page is in, so an existing bookmark needs nothing added
  // to it -- and somebody with two dashboards, sent a link to a page in one
  // of them, does not open it wearing the other one's sidebar.
  const urlSpace = useMemo(() => spaceForPage(allPages, pageId), [allPages, pageId])

  // Which dashboard to be in. The link wins over what this browser
  // remembered -- a link is somebody being sent somewhere, and being sent
  // somewhere beats having been somewhere. A dashboard they cannot open,
  // whether asked for by link or remembered, falls back to one they can.
  //
  // Skipped while the grants are still arriving, or everybody would be
  // bounced to the first dashboard for a moment on every load.
  useEffect(() => {
    if (allowedSpaces.length === 0) return
    const asked = urlSpace && allowedSpaces.some((sp) => sp.id === urlSpace) ? urlSpace : spaceId
    const next = activeSpace(asked, allowedSpaces)
    if (next !== spaceId) chooseSpace(next)
  }, [spaceId, urlSpace, allowedSpaces, chooseSpace])

  const [filterValues, setFilterValues] = useState({})
  const [activeButtonIds, setActiveButtonIds] = useState([])
  const [crossFilters, setCrossFilters] = useState([])
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState(null)
  const [arranging, setArranging] = useState(false)
  // Free mode: drag widgets instead of typing their numbers. Not stored --
  // it is how somebody is working this minute, not a property of the page,
  // and a drag saves exactly what the boxes save either way.

  // --- editing the page, on the page -------------------------------------
  // A dashboard opens as a thing you LOOK at, for everybody including the
  // admin who built it. Edit is a switch, not a second screen.
  const [editing, setEditing] = useState(false)
  // The unsaved edit, merged over the saved widget everywhere on the page,
  // so the widget redraws as the form is typed into rather than after it is
  // saved. `{ id, patch }`.
  const [editDraft, setEditDraft] = useState(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const editTimer = useRef(null)
  // What the editor is pointed at: `{ kind: 'widget' | 'controls' | 'page' }`
  // plus the id where the kind needs one. One target, one panel, one place
  // the form appears -- rather than a different panel per kind of thing.
  const [editTarget, setEditTarget] = useState(null)
  // Whether the page header has scrolled out of sight, and whether the
  // reader has asked for it back. A dashboard is long; the filters that
  // decide what it says are at the top of it.
  // Every edit on the page is immediately real -- there is no Cancel,
  // because there was no dialog. That is the right trade only if the way
  // back is one keystroke. Snapshots of the widget list; see lib/history.js.
  const [past, setPast] = useState(() => emptyHistory(null))
  const pastRef = useRef(past)
  pastRef.current = past

  const [headerGone, setHeaderGone] = useState(false)
  const [headerOpen, setHeaderOpen] = useState(false)
  const headerMark = useRef(null)
  // The page's own settings, edited live the same way a widget's are.
  const [pageDraft, setPageDraft] = useState(null)
  // Which side the form sits on, and how much of the screen it takes. Per
  // browser, because it is a preference about this person's screen and not
  // a property of the dashboard.
  const [editSide, setEditSide] = useLocalState('dash.editSide', DEFAULT_SIDE)
  const [editFraction, setEditFraction] = useLocalState('dash.editFraction', DEFAULT_FRACTION)
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
          left: layout?.left,
          top: layout?.top,
          canvasWidth: layout?.canvasWidth,
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
  // The sidebar in THIS person's order: their own arrangement over the
  // workspace default. See lib/pageOrder.js -- same two-level rule the
  // widgets have had all along.
  const { pageOrder, setPageOrder } = usePagePrefs(user?.uid)
  const visiblePages = useMemo(
    () => orderPages(sidebarPages(allowedPages), pageOrder),
    [allowedPages, pageOrder]
  )

  const savedPage = pages.find((p) => p.id === pageId) || null
  // The page as it should be DRAWN: saved, with whatever the settings form
  // is holding merged over it. One line here rather than a `livePage` beside
  // `page` at a hundred call sites, and every one of them becomes live.
  const page = useMemo(
    () => (savedPage && pageDraft ? { ...savedPage, ...pageDraft } : savedPage),
    [savedPage, pageDraft]
  )
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
   * The rows this person is allowed to see on this page at all.
   *
   * Applied with the drills rather than with the controls, because it is
   * not a control: nothing on the page clears it, no saved view restores
   * past it, and Reset does not touch it. It is the extent of their data.
   *
   * Admins are not scoped -- somebody has to be able to see the whole sheet
   * to know whether a scope is doing what they meant.
   */
  const scope = useMemo(
    () =>
      isAdmin
        ? null
        : scopeFilter(access?.scope, { ...(userDoc || {}), uid: user?.uid }, `scope_${pageId}`),
    [isAdmin, access, userDoc, user, pageId]
  )

  // This user's own widget arrangement for this page.
  const { widgetOrder, setWidgetOrder, clearOrder, notes, setNotes } = useUserPrefs(user?.uid, pageId)
  // Per browser rather than saved with the notes: putting them away is
  // "get these out of my way for a minute", not a decision worth syncing
  // to a tablet somebody left in the office.
  const [notesHidden, setNotesHidden] = useLocalState('dash.notesHidden', false)

  // The tab strip: this page's sub-canvases, or its siblings if it is one.
  // Filtered to what this user may open, so a restricted sub-canvas simply
  // isn't offered rather than being offered and then refused.
  const canvas = useMemo(() => {
    const found = canvasFor(pages, page)
    if (!found) return null
    const tabs = found.tabs.filter((p) => canViewPage(accessByPage[p.id], isAdmin))
    return tabs.length > 1 ? { ...found, tabs } : null
  }, [pages, page, accessByPage, isAdmin])

  const widgets = useMemo(() => (page?.widgets || []), [page])

  // Which widget's insides are on screen, as the ids leading to it. Ids
  // rather than indexes: reordering the page while somebody is inside one
  // should not swap what they are looking at. See lib/widgetNest.js.
  const [openWidgets, setOpenWidgets] = useState([])
  const { insidePath, insideChain, levelWidgets } = useMemo(() => {
    const live = liveWidgetPath(widgets, openWidgets)
    return { insidePath: live, insideChain: widgetPath(widgets, live), levelWidgets: widgetsAt(widgets, live) }
  }, [widgets, openWidgets])

  /**
   * Every edit on the page writes ONE array back: the page's widgets. Inside
   * a widget the array being edited is several levels down, so it is rebuilt
   * on the way out -- which is the only reason anything below this line can
   * go on treating the level it can see as if it were the page.
   */
  const atLevel = useCallback((fn) => editLevel(widgets, insidePath, fn), [widgets, insidePath])

  /** Leaving a page cannot leave the reader inside one of its widgets. */
  useEffect(() => {
    setOpenWidgets([])
  }, [page?.id])

  // Which type's shapes the Add palette is showing, if any. "Chart" is one
  // button and twenty-one drawings -- see lib/widgetVariants.js.
  const [addFamily, setAddFamily] = useState(null)

  // One ordered list of controls, however the page happens to be stored.
  // The engine still wants them split, because a filter and a button
  // evaluate differently -- see lib/pageControls.js.
  const pageControls = useMemo(() => normalizeControls(page), [page])
  const { filters, buttons } = useMemo(() => splitControls(pageControls), [pageControls])

  // The page's own rules: controls the admin fixed, which are applied always
  // and shown nowhere. Forced over the user's state at the moment of
  // filtering rather than merged into it, so nothing -- a saved view, a value
  // left over from before the admin fixed the control -- can quietly
  // override what the page says it is.
  const fixed = useMemo(() => fixedValues(pageControls), [pageControls])
  const effectiveValues = useMemo(() => ({ ...filterValues, ...fixed.values }), [filterValues, fixed])
  const effectiveButtonIds = useMemo(
    () => Array.from(new Set([...activeButtonIds, ...fixed.buttons])),
    [activeButtonIds, fixed]
  )
  const views = useMemo(() => page?.views || [], [page])

  // Widget-level visibility is applied BEFORE anything is fetched, so a
  // hidden widget's tab is never even requested from Google on behalf of
  // someone who isn't allowed to see it.
  // Ordered by this user's own numbers, then the admin's order FOR THIS
  // USER, then the page default. See lib/widgetOrder.js for why in that
  // order.
  const allowedWidgets = useMemo(
    () =>
      orderWidgets(
        // The unsaved edit is merged in HERE, before anything reads the
        // widgets -- so the blend, the filters, the canvas and the widget
        // itself all see the change at once. Merging it further down would
        // make a chart redraw while its own caption did not.
        // The level that is open, not the page's own list -- and ordered
        // and hidden by the same rules at every depth, because a child is
        // an ordinary widget.
        mergeDraft(
          visibleWidgetsFor({ ...page, widgets: levelWidgets }, access, isAdmin),
          editDraft?.id,
          editDraft?.patch
        ),
        widgetOrder,
        access?.widgetOrder
      ),
    [page, levelWidgets, access, isAdmin, widgetOrder, editDraft]
  )

  // Controls that the admin gave a default value open already applied.
  //
  // Keyed on the CONTROLS themselves, not on `allowedWidgets` -- that array
  // is rebuilt whenever the widget order changes, and reseeding from it would
  // silently discard whatever the user had selected the moment they
  // rearranged their canvas.
  const controlsKey = useMemo(
    () => allowedWidgets.map((w) => `${w.id}:${(w.controls || []).map((c) => c.id).join(',')}`).join('|'),
    [allowedWidgets]
  )

  useEffect(() => {
    const seeded = {}
    for (const w of allowedWidgets) {
      const initial = initialControlValues(w.controls)
      if (Object.keys(initial).length) seeded[w.id] = initial
    }
    setControlValues(seeded)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, controlsKey])

  // A page can span sources whose spreadsheets disagree about 05/06/2024.
  // Whichever order the majority of this page's sources use wins; it only
  // ever matters for genuinely ambiguous dates.
  const dateOrder = useMemo(() => {
    const votes = {}
    for (const id of page?.sourceIds || []) {
      const order = sourcesById[id]?.dateOrder || 'DMY'
      votes[order] = (votes[order] || 0) + 1
    }
    return (votes.MDY || 0) > (votes.DMY || 0) ? 'MDY' : 'DMY'
  }, [page, sourcesById])

  // --- Which refs does this page actually need? --------------------------
  // Only the tabs something visible reads: the widgets themselves, whatever
  // a filter or button targets, and each blend's right-hand tab.
  const neededRefs = useMemo(() => {
    const set = collectTabRefs([allowedWidgets, filters, buttons])
    for (const w of allowedWidgets) {
      if (blendIsReady(w.blend)) set.add(w.blend.ref)
    }
    return Array.from(set).filter(Boolean)
  }, [allowedWidgets, filters, buttons])

  const { tabs: dataByRef, loading, error, reload, lastLoaded } = usePageData(
    getIdToken,
    pageId,
    neededRefs,
    canView && !!page
  )

  // --- Ref -> label, once, for the whole page ----------------------------
  const labelByRef = useMemo(() => buildLabelMap(neededRefs, sources), [neededRefs, sources])
  const refByLabel = useMemo(
    () => Object.fromEntries(Object.entries(labelByRef).map(([ref, label]) => [label, ref])),
    [labelByRef]
  )
  // A ref the label map hasn't seen (a widget pointing at a tab that has
  // since been removed from its source) falls back to its bare tab name, so
  // the widget shows "could not be read" rather than an empty caption.
  const labelFor = useCallback(
    (ref) => labelByRef[ref] || parseRef(ref).tab || ref,
    [labelByRef]
  )

  // Drill-downs are BORN in label space: a chart bar or pipeline stage that
  // was clicked reports the tab it came from, and the widget only ever knew
  // that tab by its label. Filtering happens in ref space, so translate them
  // back before they reach the engine -- otherwise a drill-down silently
  // matches nothing and clicking a bar appears to do nothing at all.
  const crossFiltersByRef = useMemo(
    () => mapTabFields(crossFilters, (label) => refByLabel[label] || label),
    [crossFilters, refByLabel]
  )

  // --- Filtering, in REF space ------------------------------------------
  // Per-ref filtered rows, computed once and shared by every widget reading
  // that tab. A filter/button only touches the refs it explicitly names, so
  // a MASTER filter never empties the GOOGLE REVIEW table sitting next to
  // it -- and now, never empties a different sheet's MASTER either.
  // --- Calculated columns, before anything else -------------------------
  // A column the sheet does not have -- margin, age in days, a status worked
  // out from three other fields -- defined once on the TAB and true from
  // here down. Everything below this line sees an ordinary column: the
  // filters, the controls, every widget type, the drill-downs, the
  // flow, and the blend, which is what lets a calculated column on a parent
  // table be used in a widget that blends it with another one.
  //
  // It has to happen first. A filter cannot mention a column that does not
  // exist yet, and a per-user row scope has to be able to hide rows BY one.
  const computedByRef = useMemo(() => {
    const out = {}
    for (const [ref, data] of Object.entries(dataByRef)) {
      const { sourceId, tab } = parseRef(ref)
      const defs = computedFor(sourcesById[sourceId], tab)
      if (defs.length === 0) {
        out[ref] = data
        continue
      }
      const headers = data.headers || []
      out[ref] = {
        ...data,
        headers: computedHeaders(headers, defs),
        rows: applyComputed(data.rows || [], defs, { headers, dateOrder }),
      }
    }
    return out
  }, [dataByRef, sourcesById, dateOrder])

  const tabColumns = useMemo(() => {
    const out = {}
    for (const [ref, data] of Object.entries(computedByRef)) out[ref] = data.headers || []
    return out
  }, [computedByRef])

  // The scope is applied HERE, at the source, and not alongside the drills.
  // A widget set to ignore filters reads the raw rows, a blend reads them,
  // and a control builds its dropdown from them -- so a scope that only
  // narrowed the filtered pass would be handing back through three doors
  // exactly what it closed at the front. Everything below this line sees a
  // sheet that has never contained the other rows.
  const scopedByRef = useMemo(() => {
    if (!scope) return computedByRef
    const out = {}
    for (const [ref, data] of Object.entries(computedByRef)) {
      out[ref] = { ...data, rows: applyFilters(data.rows || [], { tab: ref, crossFilters: [scope], dateOrder, tabColumns }) }
    }
    return out
  }, [computedByRef, scope, dateOrder, tabColumns])

  const filteredByRef = useMemo(() => {
    const first = {}
    for (const [ref, data] of Object.entries(scopedByRef)) {
      first[ref] = applyFilters(data.rows || [], {
        tab: ref,
        filters,
        values: effectiveValues,
        buttons,
        activeIds: effectiveButtonIds,
        crossFilters: crossFiltersByRef,
        search,
        dateOrder,
        tabColumns,
      })
    }

    // Second pass, for controls set to reach the whole page. A key bridge
    // asks "which keys are still standing on the source tab" -- which can
    // only be answered once the first pass has finished, and has to be
    // answered from the fully filtered rows so that every OTHER control on
    // the page narrows the bridged tabs too.
    const bridges = []
    for (const filter of filters) {
      if (filter.reach !== 'key') continue
      if (!filterIsActive(filter, effectiveValues[filter.id])) continue
      const bridge = buildKeyBridge({ filter, sourceRows: first[filter.tab] || [], tabColumns })
      if (bridge) bridges.push(bridge)
    }

    // A button reaches the same three ways a control does, so it bridges the
    // same way too -- from its own tab, after the first pass, so every other
    // control on the page has already narrowed the keys it carries.
    for (const button of buttons) {
      if (button.reach !== 'key') continue
      if (!effectiveButtonIds.includes(button.id)) continue
      const bridge = buildKeyBridge({ filter: button, sourceRows: first[button.tab] || [], tabColumns })
      if (bridge) bridges.push(bridge)
    }
    if (bridges.length === 0) return first

    const out = {}
    for (const [ref, rows] of Object.entries(first)) {
      out[ref] = applyFilters(rows, { tab: ref, crossFilters: bridges, dateOrder })
    }
    return out
  }, [
    scopedByRef,
    filters,
    effectiveValues,
    buttons,
    effectiveButtonIds,
    crossFiltersByRef,
    search,
    dateOrder,
    tabColumns,
  ])

  // --- Re-key everything by human label ---------------------------------
  const headersByLabel = useMemo(() => {
    const out = {}
    for (const [ref, data] of Object.entries(scopedByRef)) out[labelFor(ref)] = data.headers || []
    return out
  }, [scopedByRef, labelFor])

  const rowsByLabel = useMemo(() => {
    const out = {}
    for (const [ref, rows] of Object.entries(filteredByRef)) out[labelFor(ref)] = rows
    return out
  }, [filteredByRef, labelFor])

  const rawRowsByLabel = useMemo(() => {
    const out = {}
    for (const [ref, d] of Object.entries(scopedByRef)) out[labelFor(ref)] = d.rows || []
    return out
  }, [scopedByRef, labelFor])

  /**
   * Rows as everything else sees them, MINUS the filters a widget is itself
   * driving.
   *
   * A 360° viewer set to filter the page narrows its own tab along with
   * every other -- so the moment somebody pressed Next, the list it walks
   * collapsed to the one vehicle it had just selected and the Next button
   * vanished. It was filtering itself out of existence.
   *
   * Page filters and every OTHER drill still apply, because narrowing to
   * Nashik and then walking the bikes in Nashik is exactly what somebody
   * would expect. Only the pinned ones come out, and pinned means "a widget
   * is driving this" -- see lib/spin360.js.
   */
  const drivenBy = useMemo(() => crossFilters.filter((c) => c.pinned), [crossFilters])

  const undrivenRowsByLabel = useMemo(() => {
    if (drivenBy.length === 0) return rowsByLabel
    const out = {}
    for (const [ref, data] of Object.entries(scopedByRef)) {
      out[labelFor(ref)] = applyFilters(data.rows || [], {
        tab: ref,
        filters,
        values: effectiveValues,
        buttons,
        activeIds: effectiveButtonIds,
        crossFilters: crossFiltersByRef.filter((c) => !c.pinned),
        search,
        dateOrder,
        tabColumns,
      })
    }
    return out
  }, [
    drivenBy,
    rowsByLabel,
    scopedByRef,
    labelFor,
    filters,
    effectiveValues,
    buttons,
    effectiveButtonIds,
    crossFiltersByRef,
    search,
    dateOrder,
    tabColumns,
  ])

  // The label-keyed equivalent of `dataByRef`, for FilterBar (which reads a
  // filter's own tab to build its dropdown options) and for header lookups.
  const dataByLabel = useMemo(() => {
    const out = {}
    for (const [ref, d] of Object.entries(scopedByRef)) out[labelFor(ref)] = d
    return out
  }, [scopedByRef, labelFor])

  // The layout, rewritten so every `tab` / `secondaryTab` holds a label.
  // From here down, nothing knows refs exist.
  const view = useMemo(
    () => mapTabFields({ widgets: allowedWidgets, controls: pageControls }, labelFor),
    [allowedWidgets, pageControls, labelFor]
  )

  /**
   * The rows each control reads its OPTIONS from: the page as everything
   * ELSE has narrowed it.
   *
   * Without this a Region of "West" still lists every DSE in the sheet, and
   * every name that does not sell in the west is a trap -- pick one and the
   * dashboard empties with nothing to explain why. Computed in label space,
   * because that is the space the control bar and the filter panel work in.
   *
   * One pass per listing control over one tab, memoised on the filter state,
   * so it costs nothing until something actually changes.
   */
  // The controls in label space, on their own. Taken from `pageControls`
  // rather than from `view`, which also carries the widgets: a widget being
  // typed into changed `view`'s identity, and every keystroke re-filtered
  // every row of every tab to rebuild dropdowns that had not moved.
  const viewControls = useMemo(() => mapTabFields(pageControls, labelFor), [pageControls, labelFor])

  const optionRowsByControl = useMemo(() => {
    const { filters: viewFilters, buttons: viewButtons } = splitControls(viewControls)
    const listing = viewFilters.filter((c) => ['select', 'multi', 'chips'].includes(c.kind))
    const out = {}

    for (const control of listing) {
      out[control.id] = optionRows(control, {
        // A control's own rule narrows what it OFFERS. Narrowing what it
        // filters instead would mean a control that changes the page while
        // nothing is selected in it, which nobody could account for.
        rows: applyRowConditions(dataByLabel[control.tab]?.rows || [], control, control.tab, dateOrder),
        tab: control.tab,
        filters: viewFilters,
        values: effectiveValues,
        buttons: viewButtons,
        activeIds: effectiveButtonIds,
        crossFilters,
        search,
        dateOrder,
      })
    }
    return out
  }, [viewControls, dataByLabel, effectiveValues, effectiveButtonIds, crossFilters, search, dateOrder])

  // --- Blending ----------------------------------------------------------
  // Per widget, and only for widgets that asked for it. The join runs on
  // rows that are ALREADY filtered on both sides, so a filter on either tab
  // narrows the blended result exactly as someone would expect.
  const blendedByWidget = useMemo(() => {
    const out = {}
    for (const w of allowedWidgets) {
      if (!blendIsReady(w.blend)) continue
      // `rows` is always the filtered join and `unfiltered` always the raw
      // one; each widget then picks between them according to its own
      // `ignoreFilters` setting, exactly as it does for an unblended tab.
      const left = filteredByRef[w.tab] || []
      const right = filteredByRef[w.blend.ref] || []
      out[w.id] = {
        rows: blendRows(left, right, w.blend, scopedByRef[w.blend.ref]?.headers || [], dateOrder),
        headers: blendedHeaders(
          scopedByRef[w.tab]?.headers || [],
          scopedByRef[w.blend.ref]?.headers || [],
          w.blend
        ),
        // Scoped, not raw: `unfiltered` means "before the page's filters",
        // never "before this reader's row limit".
        unfiltered: blendRows(
          scopedByRef[w.tab]?.rows || [],
          scopedByRef[w.blend.ref]?.rows || [],
          w.blend,
          scopedByRef[w.blend.ref]?.headers || [],
          dateOrder
        ),
      }
    }
    return out
  }, [allowedWidgets, filteredByRef, scopedByRef, dateOrder])

  // --- Interaction -------------------------------------------------------
  /**
   * Turns a drill on a BLENDED column into one the whole page understands.
   *
   * A blended column exists only on the widget that blended it, so filtering
   * anything else by it directly matches nothing -- which is why clicking
   * such a chart used to empty the dashboard. What every tab CAN be filtered
   * by is the key the blend joined on, so the click is resolved here into
   * the set of key values it selected ("the VINs whose Yard.Location is Pune
   * Yard") and that set is what travels.
   *
   * Keys are collected from the UNFILTERED blend, so the set means "every
   * VIN in Pune Yard" rather than "the ones that happened to survive the
   * other filters". Those filters still apply on top; this way removing one
   * widens the result instead of leaving it stuck.
   */
  function crossFilterHandlerFor(widget, blended, nativeHeaders) {
    if (!blended) return toggleCrossFilter

    const blend = widget.blend
    const isBlendedColumn = (column) => column && !nativeHeaders.includes(column)

    return (cf) => {
      const touchesBlended =
        cf.kind === 'conditions'
          ? (cf.conditions || []).some((c) => isBlendedColumn(c.column))
          : isBlendedColumn(cf.column)

      if (!touchesBlended) return toggleCrossFilter(cf)

      const source = blended.unfiltered || []
      const matched =
        cf.kind === 'conditions'
          ? source.filter((row) => matchesConditions(row, cf.conditions, cf.match || 'all', dateOrder))
          : source.filter((row) => String(row[cf.column] ?? '').trim() === String(cf.value).trim())

      const keys = Array.from(
        new Set(matched.map((row) => normalizeKey(row[blend.leftKey])).filter((k) => k !== null))
      )

      toggleCrossFilter({
        id: cf.id,
        kind: 'keys',
        // Kept so clicking the same bar again still toggles the filter off.
        value: cf.value,
        keys,
        // The pairs the blend stated outright. Both tabs are named because
        // their key columns are usually called different things.
        keyColumns: [
          { tab: widget.tab, column: blend.leftKey },
          { tab: labelFor(blend.ref), column: blend.rightKey },
        ],
        // ...and any other tab carrying a column of the same name is assumed
        // to hold the same key, which is what reaches widgets nowhere near
        // the blend.
        keyNames: [blend.leftKey, blend.rightKey],
        icon: '🔗',
        label: cf.label,
      })
    }
  }

  /**
   * A cross-filter that is SET rather than toggled.
   *
   * `toggleCrossFilter` clears when the same id arrives with the same
   * value, which is right for a click -- pressing the bar that is already
   * on turns it off. It is wrong for something that follows a selection:
   * the 360° viewer re-announcing the vehicle it is already showing, after
   * a remount or a re-render, would silently clear the filter it had just
   * applied.
   *
   * `null` removes it, which is what leaving the page or switching the
   * option off has to do.
   */
  const setCrossFilter = useCallback((id, cf) => {
    setCrossFilters((current) => {
      const rest = current.filter((c) => c.id !== id)
      return cf ? [...rest, cf] : rest
    })
  }, [])

  function toggleCrossFilter(cf) {
    setCrossFilters((current) => {
      const existing = current.find((c) => c.id === cf.id)
      // Same id AND same selection means "clicking the thing that is already
      // on", which clears it. A different selection under the same id -- one
      // flow, a different branch -- replaces instead, so a tree drill moves
      // rather than stacking two contradictory filters on the page. Callers
      // that carry no `value` (a pipeline stage, a trend bucket) compare
      // undefined to undefined and toggle exactly as they always have.
      if (existing && existing.value === cf.value) {
        return current.filter((c) => c.id !== cf.id)
      }
      return [...current.filter((c) => c.id !== cf.id), cf]
    })
  }

  function toggleButton(button) {
    setActiveButtonIds((current) => {
      const on = current.includes(button.id)
      if (on) return current.filter((id) => id !== button.id)
      if (button.group) {
        const siblings = buttons.filter((b) => b.group === button.group).map((b) => b.id)
        return [...current.filter((id) => !siblings.includes(id)), button.id]
      }
      return [...current, button.id]
    })
  }

  function resetFilters() {
    // Back to the page's OWN starting state, not to blank -- a control the
    // admin gave a default is meant to be on, and "Reset" that turned it off
    // would leave the dashboard in a state the admin never designed.
    const { values, buttons: onByDefault } = initialValues(pageControls)
    setFilterValues(values)
    setActiveButtonIds(onByDefault)
    setSearch('')
    // Pinned ones stay. Reset puts the page back to how the admin designed
    // it, and a page whose viewer drives it was designed that way.
    setCrossFilters((c) => c.filter((x) => x.pinned))
  }

  /**
   * A saved view replaces the whole control state rather than merging into
   * it, so clicking one always lands you somewhere predictable instead of
   * somewhere that depends on what you had set before.
   */
  function applyView(view) {
    setFilterValues(view.values || {})
    setActiveButtonIds(view.buttons || [])
    setCrossFilters((c) => c.filter((x) => x.pinned))
  }

  // Page controls the admin gave a default open already applied. Keyed on
  // the control ids so re-rendering doesn't keep resetting what the user set.
  const pageControlsKey = useMemo(() => pageControls.map((c) => c.id).join('|'), [pageControls])
  useEffect(() => {
    const { values, buttons: onByDefault } = initialValues(pageControls)
    setFilterValues(values)
    setActiveButtonIds(onByDefault)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, pageControlsKey])

  /**
   * A widget's size, saved to the page.
   *
   * Order is a personal preference and lives in the reader's own document.
   * SIZE is a layout decision and lives in the page: a canvas where one
   * widget is 640px for one reader and 300px for another is not a canvas
   * anybody designed. Only an admin reaches this -- the arrange button is
   * theirs alone -- and the Firestore rules say so independently, so a
   * hand-made request cannot get round the missing button.
   *
   * Blank clears the pin rather than storing a zero, which would be a widget
   * one pixel tall.
   */
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
    const widgets = atLevel((list) => list.map((w) => (w.id === widgetId ? { ...w, style } : w)))
    setSavingLayout(true)
    try {
      await setDoc(doc(db, 'dashboards', page.id), stripUndefined({ widgets }), { merge: true })
    } finally {
      setSavingLayout(false)
    }
  }

  /**
   * A page control, sized and placed on the page.
   *
   * A control is part of the page's design in exactly the way a widget is,
   * and there is no reason it should be the one thing an admin has to leave
   * the page to adjust. Same rules: pixels, admin-only, written to the page.
   */
  async function saveControlEdit(controlId, patch) {
    if (!isAdmin || !page?.id) return

    const clean = {}
    if ('widthPx' in patch) {
      const n = Number(patch.widthPx)
      clean.widthPx = patch.widthPx === '' || !Number.isFinite(n) || n <= 0 ? null : Math.round(n)
    }
    if ('order' in patch) {
      const n = Number(patch.order)
      clean.order = patch.order === '' || !Number.isFinite(n) ? null : Math.round(n)
    }
    if ('advanced' in patch) clean.advanced = !!patch.advanced
    // A control's own look, the same shape a widget's is -- see
    // lib/widgetStyle.js. Whitelisted like the rest: this saver takes the
    // fields it knows, so an unlisted one would be dropped in silence.
    if ('style' in patch) clean.style = patch.style || null

    const controls = (page.controls || []).map((c) => (c.id === controlId ? { ...c, ...clean } : c))
    setSavingLayout(true)
    try {
      await setDoc(doc(db, 'dashboards', page.id), stripUndefined({ controls }), { merge: true })
    } finally {
      setSavingLayout(false)
    }
  }

  /** The page's widget list, rewritten. One writer for every action. */
  /** One field of the page document, written the way widgets are. */
  async function writePage(patch) {
    if (!isAdmin || !page?.id) return
    await setDoc(doc(db, 'dashboards', page.id), stripUndefined(patch), { merge: true })
  }

  /**
   * The widget list, written -- and remembered, so it can be taken back.
   *
   * The snapshot recorded is the list as it was BEFORE this write, and it
   * is recorded here rather than in every caller because every caller
   * eventually forgets. `fromHistory` is how undo itself writes without
   * being recorded as a step, which would make Ctrl+Z a toggle.
   */
  async function writeWidgets(next, fromHistory = false) {
    if (!isAdmin || !page?.id) return
    if (!fromHistory) {
      setPast((h) => commitHistory(h.present === null ? emptyHistory(page.widgets || []) : h, next))
    }
    setSavingLayout(true)
    try {
      await setDoc(doc(db, 'dashboards', page.id), stripUndefined({ widgets: next }), { merge: true })
    } finally {
      setSavingLayout(false)
    }
  }

  /**
   * A widget being edited on the page.
   *
   * The change lands in `editDraft` immediately -- which is what the canvas
   * draws from -- and is written to the page after a pause. Writing on every
   * keystroke would be a document write per character; drawing after the
   * write would mean watching a round trip before seeing a colour change.
   */
  function editWidgetDraft(next) {
    if (!next?.id) return
    setEditDraft({ id: next.id, patch: next })
    setSavingEdit(true)

    clearTimeout(editTimer.current)
    editTimer.current = setTimeout(async () => {
      await writeWidgets(atLevel((list) => list.map((w) => (w.id === next.id ? { ...w, ...next } : w))))
      setSavingEdit(false)
    }, 600)
  }

  /** Closing flushes: an edit still sitting in a timer is an edit lost. */
  async function closeWidgetEditor() {
    clearTimeout(editTimer.current)
    const pending = editDraft
    setEditTarget(null)
    if (pending?.patch?.id) {
      await writeWidgets(
        atLevel((list) => list.map((w) => (w.id === pending.patch.id ? { ...w, ...pending.patch } : w)))
      )
    }
    setSavingEdit(false)
    setEditDraft(null)
  }

  /** A new widget, added from the page, opened straight into its editor. */
  async function addWidgetHere(type, patch = null) {
    const tab = allowedWidgets[0]?.tab || Object.keys(tabColumns)[0]
    if (!tab) return
    const made = makeWidget({
      type,
      tab,
      name: labelFor(tab),
      cols: tabColumns[tab] || [],
      // The level's own count, so two KPIs added in two places are not
      // both called the same thing.
      kpiCount: levelWidgets.filter((w) => w.type === 'kpi').length,
    })
    if (!made) return
    // A variant is a type PLUS A PATCH -- picking "Donut" adds a chart
    // whose chartType is donut, which is exactly what picking Chart and
    // then changing the dropdown has always produced. Nothing new is
    // stored and no widget learns a second identity.
    const born = patch ? { ...made, ...patch } : made
    setAddFamily(null)
    // Added where you are standing: on the page, or inside whichever
    // widget is open. "Add" has always meant "add here".
    await writeWidgets(atLevel((list) => [...list, born]))
    // Straight into the thing you just made, rather than leaving it at the
    // bottom of the page for you to go and find.
    setEditTarget({ kind: 'widget', id: born.id })
  }

  /**
   * One step back, or forward again.
   *
   * The state that comes out of the history is written the same way any
   * other change is -- there is no second path into the document, so there
   * is nothing for the two paths to disagree about.
   */
  async function stepHistory(direction) {
    const at = pastRef.current
    const next = direction === 'undo' ? undoHistory(at) : redoHistory(at)
    if (next === at) return
    setPast(next)
    if (Array.isArray(next.present)) await writeWidgets(next.present, true)
  }

  const renameWidget = (id, title) =>
    writeWidgets(atLevel((list) => list.map((w) => (w.id === id ? { ...w, title } : w))))

  /**
   * A copy of a widget, right after it.
   *
   * The commonest thing anybody wants after building one chart is the same
   * chart broken down a different way, and rebuilding it from scratch in the
   * admin panel is the slowest possible route to that.
   */
  function duplicateWidget(id) {
    writeWidgets(
      atLevel((list) => {
        const at = list.findIndex((w) => w.id === id)
        if (at === -1) return list
        const copy = {
          ...list[at],
          id: `w_${Math.random().toString(36).slice(2, 9)}`,
          title: `${list[at].title || 'Widget'} copy`,
        }
        return [...list.slice(0, at + 1), copy, ...list.slice(at + 1)]
      })
    )
  }

  const deleteWidget = (id) => writeWidgets(atLevel((list) => list.filter((w) => w.id !== id)))

  // Every widget's rectangle, as the page currently has it -- what the
  // arrange boxes read, and what a typed change is applied to.
  const rects = useMemo(() => {
    return Object.fromEntries(placeAll(levelWidgets || []).map((rect) => [rect.id, rect]))
  }, [levelWidgets])

  /**
   * A rectangle, saved.
   *
   * Takes a list because it is the same path however the change was made --
   * one widget dragged, one widget typed into, or a whole page seeded on
   * its first load. One write and one undo entry for the whole gesture,
   * since one gesture is what it was.
   */
  async function saveLayout(changed) {
    if (!isAdmin || !page?.id || !(changed || []).length) return
    const patches = new Map(changed.map((rect) => [rect.id, patchOf(rect)]))
    await writeWidgets(
      atLevel((list) =>
        list.map((w) => {
          const patch = patches.get(w.id)
          return patch ? { ...w, ...patch } : w
        })
      )
    )
  }

  /**
   * A rectangle typed into the arrange boxes.
   *
   * Goes through the same clamping a drag does, so typing "x 400" and
   * dragging to 400 are the same act -- two ways of saying it, one layout.
   */
  function setRect(widgetId, part) {
    const rect = rects[widgetId]
    if (!rect) return
    const next = clampRect({ ...rect, ...part })
    return saveLayout(changedIn([rect], [next]))
  }

  /**
   * A widget that has no rectangle yet is given one. Nothing else moves.
   *
   * Two ways a widget arrives without one, and they need different answers:
   *
   *   A PAGE FROM THE ENGINE THIS REPLACED. Nothing on it has a rectangle,
   *   so all of them are seeded at once from what the old packer was
   *   actually drawing -- which is what stops every dashboard in the
   *   workspace rearranging itself overnight.
   *
   *   A WIDGET JUST ADDED to a page that is already arranged. Only it needs
   *   a rectangle, and the others must be left exactly as they are.
   *
   * The second case used to go through the first, and that is the bug this
   * is written the way it is to prevent: adding one widget re-seeded the
   * WHOLE page from measured pixels, and measured pixels do not survive the
   * round trip -- they are divided back by the canvas scale, rounded, and
   * clamped. Every widget shifted a little, and the shift was saved. Adding
   * a chart rearranged the page.
   */
  useEffect(() => {
    if (!isAdmin || !page?.id || !(levelWidgets || []).length) return
    const unplaced = (levelWidgets || []).filter((w) => !isPlaced(w))
    if (unplaced.length === 0) return

    if (unplaced.length < levelWidgets.length) {
      // `placeAll` keeps every rectangle it is given and invents one only
      // where there is none -- and only those are written back, so a widget
      // that already had one is not even part of the save.
      const wanted = new Set(unplaced.map((w) => w.id))
      // With the same first guess at a size the canvas itself uses, so a
      // new KPI lands KPI-shaped rather than at a generic default and has
      // to be dragged into shape before it can be read.
      const guessed = levelWidgets.map((w) => ({
        ...w,
        estimatedWidth: widgetUsesPx(w) ? widgetWidthPx(w) : null,
        estimatedHeight: Number(w.heightPx) > 0 ? Number(w.heightPx) : estimateWidgetHeight(w.type),
      }))
      saveLayout(placeAll(guessed).filter((rect) => wanted.has(rect.id)))
      return
    }

    const measured = (levelWidgets || [])
      .map((w) => [w.id, sizes[w.id]])
      .filter(([, box]) => box && Number.isFinite(box.left) && Number.isFinite(box.top))
    if (measured.length !== levelWidgets.length) return
    const canvas = measured.map(([, box]) => box.canvasWidth).find((n) => Number.isFinite(n) && n > 0)
    saveLayout(seedFrom(Object.fromEntries(measured), { canvasWidth: canvas || 1280 }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, page?.id, levelWidgets, sizes])

  // Saving a dragged column order writes back to this page's document  // Saving a dragged column order writes back to this page's document, so it
  // applies to every user rather than living in one browser session.
  async function saveColumnOrder(widgetId, columns) {
    if (!page) return
    await setDoc(
      doc(db, 'dashboards', page.id),
      // The whole widget list is rewritten, so any `undefined` sitting on an
      // unrelated widget would fail this save too -- see lib/firestoreSafe.js.
      stripUndefined({ widgets: atLevel((list) => list.map((w) => (w.id === widgetId ? { ...w, columns } : w))) }),
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
      await updateCell(idToken, page.id, ref, row._row, column, value)
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

  // Everything the admin forms need to name a tab and list its columns.
  // The page already knows all of it; the panels only ever asked the admin
  // screen for it because that is where they used to live.
  const adminCtx = useMemo(
    () => ({
      tabOptions: Object.keys(tabColumns).map((ref) => ({ value: ref, label: labelFor(ref) })),
      tabHeaders: tabColumns,
      sources: [],
      labelFor,
      // The same value pickers the admin panel has: every condition written
      // on the page gets the column's real values instead of a blank box.
      valuesFor: (ref, column) => valuesForRef(sourcesById, ref, column),
    }),
    [tabColumns, labelFor, sourcesById]
  )

  // Drawn on the page and again in the editor's preview, so it is a
  // variable rather than two copies: two copies drift, and the preview
  // stops being a preview of anything.
  const controlBar =
    canView && !error && allowedWidgets.length > 0 ? (
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
            editable={isAdmin && arranging}
            onControlEdit={saveControlEdit}
            />
    ) : null

  // An observer on a one-pixel sentinel rather than a scroll listener: the
  // browser answers "is this on screen" without waking React on every frame
  // of every scroll.
  useEffect(() => {
    const mark = headerMark.current
    if (!mark || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(([entry]) => setHeaderGone(!entry.isIntersecting), { threshold: 0 })
    io.observe(mark)
    return () => io.disconnect()
  }, [pageId])

  // Scrolling back up to the header answers the question, so the panel that
  // stood in for it should not still be sitting there.
  useEffect(() => {
    if (!headerGone && headerOpen) setHeaderOpen(false)
  }, [headerGone, headerOpen])

  // Ctrl+Z / Ctrl+Y, and Ctrl+Shift+Z for the half of the world that learnt
  // that one instead. Never while a field has focus: Ctrl+Z in a text box
  // means "undo my typing", and stealing it to undo a widget instead is the
  // kind of help nobody asks for twice.
  useEffect(() => {
    if (!isAdmin) return undefined
    const onKey = (e) => {
      const el = e.target
      const tag = String(el?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return

      const action = historyKeyAction(e)
      if (!action) return
      e.preventDefault()
      stepHistory(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, page?.id])

  /**
   * A note stuck to this page.
   *
   * Placed a little further down and to the right each time, so a second
   * note does not land exactly on the first -- which is what makes adding
   * three in a row look like adding one.
   */
  const addNote = () => {
    const step = (notes?.length || 0) % 6
    // Adding a note while they are put away would write into thin air, so
    // it brings them back first.
    setNotesHidden(false)
    setNotes([...(notes || []), newNote({ x: 24 + step * 26, y: 24 + step * 22 })])
  }

  const headerActions = (
    <>
      {/* Personal, and on every page rather than only while arranging: a
          reminder is worth writing exactly when you are reading, not when
          you are rearranging. */}
      <span className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white">
        <button
          onClick={addNote}
          title="Stick a note on this page — only you see it"
          className="p-2 text-slate-600 transition-colors hover:bg-amber-50 hover:text-amber-600"
        >
          <StickyNote size={15} />
        </button>
        {/* Only once there is something to put away. A show/hide for
            nothing is a control that has to be read before it can be
            ignored. Hidden is not deleted -- the notes are still saved and
            come back untouched, which is what makes putting them away
            something somebody will actually do. */}
        {notes.length > 0 && (
          <button
            onClick={() => setNotesHidden(!notesHidden)}
            title={
              notesHidden
                ? `Show your ${notes.length} note${notes.length === 1 ? '' : 's'} again`
                : `Put your ${notes.length} note${notes.length === 1 ? '' : 's'} away — they are kept`
            }
            className={`flex items-center gap-1 border-l border-slate-200 px-2 text-[11px] font-semibold tabular-nums transition-colors ${
              notesHidden ? 'bg-amber-50 text-amber-600' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            {notesHidden ? <EyeOff size={13} /> : <Eye size={13} />}
            {notes.length}
          </button>
        )}
      </span>
      {isAdmin && editing && (
        <>
          <button
            onClick={() => stepHistory('undo')}
            disabled={!canUndo(past)}
            title="Undo (Ctrl+Z)"
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-30"
          >
            <Undo2 size={15} />
          </button>
          <button
            onClick={() => stepHistory('redo')}
            disabled={!canRedo(past)}
            title="Redo (Ctrl+Y)"
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-30"
          >
            <Redo2 size={15} />
          </button>
        </>
      )}
      {isAdmin && (
        <button
          onClick={() => {
            const next = !editing
            setEditing(next)
            // Edit mode is arrange mode plus the rest of it: the pills are
            // how a widget is reached, so turning one on turns the other on.
            setArranging(next)
            if (!next) setEditTarget(null)
          }}
          className={`rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
            editing
              ? 'border-indigo-500 bg-indigo-600 text-white hover:bg-indigo-700'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
          title={editing ? 'Back to looking at the page' : 'Edit this page, here on the page'}
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      )}
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
      {/* The browser's own print dialogue, which is also its Save as PDF --
          so this is the export without a second implementation of the page
          to keep in step with the first. */}
      <button
        onClick={() => window.print()}
        className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
        title="Print, or save as PDF"
      >
        <Printer size={15} />
      </button>
    </>
  )

  const sourceNames = (page?.sourceIds || [])
    .map((id) => sourcesById[id]?.name)
    .filter(Boolean)

  /**
   * Every narrowing in force, for the header the paper gets.
   *
   * `effectiveValues` rather than the user's own, so a control the ADMIN
   * fixed appears too -- it is a rule of the page the reader never sees and
   * cannot turn off, which makes it exactly the thing a printout has to
   * disclose. See lib/printView.js.
   */
  const printFilters = useMemo(
    () => appliedFilters(pageControls, effectiveValues, effectiveButtonIds, crossFilters),
    [pageControls, effectiveValues, effectiveButtonIds, crossFilters]
  )

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
                // The widget's own rule, applied here rather than inside
                // fifteen components -- which is what makes it available to
                // all of them without any of them learning anything. Before
                // its own controls, because a rule is what the widget IS and
                // a control is somebody narrowing it.
                const preControl = applyRowConditions(
                  blended ? blended.rows : rowsByLabel[widget.tab] || [],
                  widget,
                  widget.tab,
                  dateOrder
                )
                const myControls = widget.controls || []
                const myValues = controlValues[widget.id]
                const rows = myControls.length
                  ? applyWidgetControls(preControl, myControls, myValues, dateOrder)
                  : preControl
                const unfilteredBase = applyRowConditions(
                  blended ? blended.unfiltered : rawRowsByLabel[widget.tab] || [],
                  widget,
                  widget.tab,
                  dateOrder
                )
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
                //
                // ANY widget on the canvas, not only one with a typed
                // height. That was true when the height was a number in a
                // form; since the layout became drag-to-resize it is the
                // BOX that says how big a widget is, and a chart that
                // ignored it stayed 260px tall inside a card the reader had
                // just dragged to twice that. The canvas draws every widget
                // at a definite height -- a phone stacks them at their own
                // proportions rather than letting them go auto -- so this
                // resolves everywhere it is drawn.
                const fillHeight = Number(widget.heightPx) > 0 || isPlaced(widget)

                // Almost all of a chart's appearance reaches it as CSS
                // custom properties on the wrapper below, which no widget
                // has to know about. Two settings cannot travel that way --
                // a bar's corner radius is baked into its path data and a
                // bar gap is a layout the chart computes -- so the resolved
                // visuals ride along as a prop for those, merged in the
                // same page-then-widget order the cascade would have used.
                const chartVisuals = mergeVisuals(design.chartVisuals, themed?.chartVisuals)

                const common = {
                  widget,
                  rows,
                  unfilteredRows: unfiltered,
                  tabError: tabData?.error,
                  fillHeight,
                  chartVisuals,
                }

                return {
                  id: widget.id,
                  width: widget.width,
                  // Its rectangle, carried through so the canvas can read it.
                  // Without these four the layout engine sees a page of
                  // unplaced widgets and invents one afresh every render.
                  boxX: widget.boxX,
                  boxY: widget.boxY,
                  boxW: widget.boxW,
                  boxH: widget.boxH,
                  // Whether it holds its place while the page scrolls. The
                  // canvas is what draws it, so the canvas has to be told.
                  pinned: widget.pinned,
                  // Only used until a widget has a rectangle of its own: a
                  // better first guess than a flat default, so a page being
                  // placed for the first time is roughly right immediately.
                  estimatedWidth: widgetUsesPx(widget) ? widgetWidthPx(widget) : null,
                  estimatedHeight: Number(widget.heightPx) > 0 ? Number(widget.heightPx) : estimateWidgetHeight(widget.type),
                  content: (
                    // The wrapper publishes this widget's appearance as CSS
                    // custom properties, which `.card` reads (see index.css).
                    // An unstyled widget emits none and looks exactly as it
                    // always did -- no widget component knows about theming.
                    <div
                      data-widget={widget.id}
                      // ...and, on the same element, which parts of its
                      // own chrome this widget has been told to leave out.
                      // One place rather than nineteen -- see
                      // lib/widgetChrome.js -- and it is inside `content`,
                      // so the edit preview shows the same trim the page
                      // will.
                      className={`rise-in group/widget relative widget-sized ${styleClass(themed)} ${chromeClass(
                        widget
                      )}`}
                      style={{
                        animationDelay: `${Math.min(index * 45, 360)}ms`,
                        ...(styleVars(themed) || {}),
                      }}
                    >
                      {/* In edit mode the widget IS the way in: it lights
                          up on hover and says Edit, so nobody has to be
                          told where the form lives.

                          The highlight is a sheet of GLASS -- it takes no
                          clicks. It used to be a button covering the whole
                          card, which meant the live preview could be looked
                          at and not used: no clicking a stage, no opening a
                          dropdown, no scrolling a long chart. A preview you
                          cannot work is a screenshot, and the point of
                          editing beside the real thing is watching the real
                          thing behave.

                          So the card stays live and the pill takes the
                          click. */}
                      {/* The way into a widget that has widgets in it.
                          A corner chip rather than the whole card, for the
                          same reason the Edit highlight is glass: the card
                          is a working chart, and a click on a bar should
                          drill the bar.

                          An admin sees it on every widget, because the way
                          in has to exist before there is anything behind it
                          -- that is how the first child gets added. A reader
                          sees it only where there IS something behind it: an
                          empty level is a blank page and a dead end. */}
                      {(hasChildren(widget) || (editing && isAdmin)) &&
                        insidePath.length < MAX_WIDGET_DEPTH && (
                        <button
                          onClick={() => setOpenWidgets(descendWidget(widgets, insidePath, widget.id, { allowEmpty: isAdmin }))}
                          title={
                            hasChildren(widget)
                              ? `Open the ${childWidgets(widget).length} widgets inside ${widget.title || 'this'}`
                              : `Nothing inside ${widget.title || 'this'} yet — open it to add`
                          }
                          className={`absolute bottom-2 right-2 z-20 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold shadow-sm backdrop-blur transition-colors ${
                            hasChildren(widget)
                              ? 'border-indigo-200 bg-white/90 text-indigo-600 hover:bg-indigo-50'
                              : 'border-slate-200 bg-white/70 text-slate-400 opacity-0 hover:bg-white hover:text-slate-600 group-hover/widget:opacity-100'
                          }`}
                        >
                          <Layers size={10} />
                          {hasChildren(widget) ? insideLabel(widget) : 'Inside'}
                        </button>
                      )}

                      {editing && isAdmin && (
                        <>
                          <span
                            aria-hidden
                            className={`pointer-events-none absolute inset-0 z-10 rounded-2xl transition-all ${
                              editTarget?.id === widget.id
                                ? 'bg-indigo-500/10 ring-2 ring-indigo-400'
                                : 'opacity-0 ring-2 ring-indigo-300 group-hover/widget:bg-indigo-500/10 group-hover/widget:opacity-100'
                            }`}
                          />
                          <button
                            onClick={() => {
                              setEditDraft(null)
                              setEditTarget({ kind: 'widget', id: widget.id })
                            }}
                            title={`Edit ${widget.title || 'this widget'}`}
                            className={`absolute right-2 top-2 z-20 rounded-lg bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow transition-opacity ${
                              editTarget?.id === widget.id
                                ? 'opacity-100'
                                : 'opacity-0 focus-visible:opacity-100 group-hover/widget:opacity-100'
                            }`}
                          >
                            Edit
                          </button>
                        </>
                      )}

                      {arranging && (
                        <ArrangeBar
                          index={index + 1}
                          order={widgetOrder[widget.id] ?? ''}
                          onOrder={(v) => setWidgetOrder(widget.id, v)}
                          widgetType={widget.type}
                          // The same four numbers a drag sets, for anybody
                          // who would rather type them. See lib/freeLayout.js.
                          rect={rects[widget.id]}
                          onRect={(part) => setRect(widget.id, part)}
                          pinned={widget.pinned === true}
                          onPinned={
                            isAdmin
                              ? (on) =>
                                  writeWidgets(
                                    atLevel((list) =>
                                      list.map((w) => (w.id === widget.id ? { ...w, pinned: on } : w))
                                    )
                                  )
                              : undefined
                          }
                          style={widget.style}
                          measured={sizes[widget.id]}
                          onStyle={isAdmin ? (next) => saveWidgetStyle(widget.id, next) : undefined}
                          onEdit={
                            isAdmin
                              ? () => {
                                  setEditDraft(null)
                                  setEditTarget({ kind: 'widget', id: widget.id })
                                }
                              : undefined
                          }
                          onRename={isAdmin ? (next) => renameWidget(widget.id, next) : undefined}
                          onDuplicate={isAdmin ? () => duplicateWidget(widget.id) : undefined}
                          onDelete={isAdmin ? () => deleteWidget(widget.id) : undefined}
                          title={widget.title}
                        />
                      )}

                      {/* One widget failing must not take the page with
                          it. A dashboard draws thirty-odd types over
                          whatever the sheet happens to contain that
                          morning, and React's answer to a render error is
                          to unmount the whole tree -- which turned any one
                          of them into a white screen with the other
                          twenty-nine gone too.

                          Outside the edit chrome on purpose: a widget that
                          cannot draw is exactly the one an admin needs to
                          open, so its Edit pill has to survive.

                          `resetKey` is the widget object itself. Every save
                          builds a new one, so fixing the config clears the
                          error in the same render -- without it the card
                          stays stuck on the error it threw a minute ago. */}
                      <ErrorBoundary label={widget.title || 'This widget'} resetKey={widget}>
                        {/* This widget's own controls, above its card. Living
                            here rather than inside each widget is what lets
                            every type has them. */}
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
                          <ComboWidget {...common} crossFilters={crossFilters} onCrossFilter={drill} dateOrder={dateOrder} />
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
                            // The REAL ref, not the display label the widget
                            // was handed. Remarks belong to the record, so
                            // two tables on the same tab must address the
                            // same note -- and labels are per page and can
                            // be disambiguated differently on the next one.
                            noteScope={refByLabel[widget.tab] || widget.tab}
                            // Built here because the options live in a
                            // DIFFERENT tab, and this is where every tab's
                            // rows are. The widget is handed the finished
                            // lists rather than the whole workspace.
                            columnChoices={buildChoices(widget, rowsByLabel)}
                          />
                        )}

                        {/* --- metrics ------------------------------------ */}
                        {widget.type === 'stat' && <StatGridWidget {...common} dateOrder={dateOrder} />}
                        {widget.type === 'bullet' && <BulletWidget {...common} dateOrder={dateOrder} />}
                        {widget.type === 'movers' && (
                          <MoversWidget {...common} dateOrder={dateOrder} onCrossFilter={drill} />
                        )}
                        {widget.type === 'waffle' && <WaffleWidget {...common} onCrossFilter={drill} />}

                        {/* --- infographic -------------------------------- */}
                        {widget.type === 'rings' && <RingStatsWidget {...common} onCrossFilter={drill} />}
                        {widget.type === 'process' && <ProcessWidget {...common} onCrossFilter={drill} />}
                        {widget.type === 'pyramid' && <PyramidWidget {...common} onCrossFilter={drill} />}

                        {/* --- time -------------------------------------- */}
                        {widget.type === 'calendar' && (
                          <CalendarHeatWidget {...common} dateOrder={dateOrder} onCrossFilter={drill} />
                        )}
                        {widget.type === 'gantt' && <GanttWidget {...common} dateOrder={dateOrder} />}
                        {widget.type === 'cohort' && (
                          <CohortWidget {...common} dateOrder={dateOrder} onCrossFilter={drill} />
                        )}

                        {/* --- relation --------------------------------- */}
                        {widget.type === 'dumbbell' && (
                          <DumbbellWidget {...common} crossFilters={crossFilters} onCrossFilter={drill} dateOrder={dateOrder} />
                        )}
                        {widget.type === 'sunburst' && (
                          <SunburstWidget {...common} crossFilters={crossFilters} onCrossFilter={drill} dateOrder={dateOrder} />
                        )}

                        {/* --- distribution ------------------------------ */}
                        {widget.type === 'boxplot' && <BoxPlotWidget {...common} onCrossFilter={drill} />}
                        {widget.type === 'sankey' && <SankeyWidget {...common} onCrossFilter={drill} />}
                        {widget.type === 'wordcloud' && <WordCloudWidget {...common} onCrossFilter={drill} />}
                        {widget.type === 'profile' && (
                          // The one widget whose subject is the SHEET rather
                          // than the business, so it is handed the headers as
                          // well as the rows.
                          <ProfileWidget {...common} tabHeaders={headers} dateOrder={dateOrder} />
                        )}

                        {/* --- canvas furniture, which reads no rows ----- */}
                        {widget.type === 'note' && <NoteWidget widget={widget} />}
                        {widget.type === 'media' && <MediaWidget widget={widget} />}
                        {widget.type === 'countdown' && <CountdownWidget widget={widget} />}
                        {widget.type === 'spin360' && (
                          <Spin360Widget
                            widget={widget}
                            // The list it walks, before its own selection
                            // narrows anything -- otherwise pressing Next
                            // filters the viewer down to the one vehicle it
                            // just picked, and the button disappears.
                            rows={undrivenRowsByLabel[widget.tab] || rows}
                            // The tab as the page knows it -- a label by the
                            // time a widget sees it, which is exactly what a
                            // cross-filter's conditions are matched against.
                            tab={widget.tab}
                            // Every OTHER widget that said which of its own
                            // columns hold the model and the colour. A
                            // conditions filter only touches tabs it names,
                            // so this is how the selection reaches a KPI
                            // card reading a different tab entirely.
                            targets={matchTargets(view.widgets, widget)}
                            onFilter={setCrossFilter}
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
                      </ErrorBoundary>
                    </div>
                  ),
                }
              })

  // The widget the editor is pointed at, and the canvas item that draws it
  // -- both taken from what the page is ALREADY rendering, so the preview
  // cannot be a different render from the page's own.
  // From the SAVED widgets, not from `view`: `view` is label space, with
  // every tab field rewritten to its human name for rendering. Editing one
  // of those would write labels where refs belong and leave the tab picker
  // matching nothing.
  const editedWidget = useMemo(
    // Anywhere in the tree: the edit panel can outlive a descent, and a
    // widget you are inside is not on the page's own list.
    () => (editTarget?.kind === 'widget' ? findWidget(page?.widgets || [], editTarget.id) : null),
    [editTarget, page?.widgets]
  )
  const editedItem = useMemo(
    () => (editTarget?.kind === 'widget' ? widgetItems.find((i) => i.id === editTarget.id) : null),
    [editTarget, widgetItems]
  )

  /** Closing flushes whatever is still in a timer, whatever kind it was. */
  async function closeEditor() {
    await closeWidgetEditor()
    setEditTarget(null)
    setPageDraft(null)
  }

  /**
   * One page picked up in the sidebar and dropped on another.
   *
   * Only the pages whose number actually changed are written -- dropping
   * something back where it started should not be sixteen writes -- and the
   * order is rewritten dense from zero so the next drag lands exactly where
   * it looks like it will. See lib/pageOrder.js.
   */
  async function movePage(movedId, targetId) {
    if (!canDrop(movedId, targetId)) return
    const { pages: ordered, updates } = dragPages(visiblePages, movedId, targetId)

    // An admin in EDIT mode is arranging the workspace: the order goes on
    // the pages themselves, and everybody gets it. Anyone else -- including
    // the same admin a moment later, just looking -- is arranging their own
    // sidebar, which is a preference about their own eyes and changes
    // nothing for anybody else.
    if (isAdmin && editing) {
      await Promise.all(
        updates.map((u) => setDoc(doc(db, 'dashboards', u.id), stripUndefined(u), { merge: true }))
      )
      return
    }

    await setPageOrder(personalOrder(ordered))
  }

  /**
   * A page, made from the sidebar and opened with its settings beside it.
   *
   * Created empty and navigated to straight away rather than after a form is
   * filled in: a page with no name is a page you can see and rename, and a
   * form in front of an empty canvas is a form about nothing.
   */
  async function addPageHere() {
    if (!isAdmin) return
    const id = newPageId()
    // Stamped with the dashboard it is being made in. Without this every
    // new page would land in the first one, whichever you were looking at.
    const made = stampSpace({ ...emptyPage(), id, name: 'New page' }, spaceId)
    await setDoc(doc(db, 'dashboards', id), stripUndefined(made), { merge: true })
    navigate(`/d/${id}`)
    setEditing(true)
    setArranging(true)
    setEditTarget({ kind: 'page' })
  }

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

      <AppShell
        // The sidebar takes the page's own colour, so a navy dashboard is
        // not a navy canvas beside a white panel -- see lib/pageBackground.js.
        surface={sidebarSurface(page?.background)}
        spaces={allowedSpaces}
        spaceId={spaceId}
        onSpace={chooseSpace}
        pages={visiblePages}
        activePageId={pageId}
        title={page?.name || 'Dashboard'}
        actions={headerActions}
        editing={editing && isAdmin}
        onAddPage={isAdmin ? addPageHere : undefined}
        onMovePage={movePage}
        // Whose order the drag is about to change. Two behaviours on one
        // gesture is only fair if the sidebar says which one is running.
        moveScope={isAdmin && editing ? 'everyone' : 'you'}
        onEditPage={
          isAdmin
            ? (id) => {
                if (id !== pageId) navigate(`/d/${id}`)
                setEditTarget({ kind: 'page' })
              }
            : undefined
        }
      >
      {/* Sits above the backdrop layers. The sidebar is z-30 and stays above
          both. */}
      {/* The notes, offered to whatever is inside as well as drawn here.
          A widget that fills the screen hides this layer, and full screen is
          exactly when somebody is reading closely enough to want it -- so it
          draws the same list itself. See context/NotesLayer.jsx. */}
      <NotesLayerProvider
        notes={notes}
        onNotes={setNotes}
        canvasWidth={design.maxWidth || 0}
        hidden={notesHidden}
        onHidden={setNotesHidden}
      >
      <div
        className={`page-canvas relative z-[1] min-h-screen space-y-3 p-3 md:p-4 ${
          lightText ? 'page-invert' : ''
        } ${designClass(design)}`}
        // The whole design, as custom properties. `.card` already reads
        // `--card-*` (see index.css), so a page-wide surface is one
        // declaration on this element and no widget learns anything new.
        style={{
          ...designVars(design),
          ...(design.maxWidth > 0 ? { maxWidth: design.maxWidth, marginInline: 'auto' } : null),
        }}
      >
        {/* This person's own notes, over the whole page rather than inside
            the canvas: a note is ABOUT the dashboard, not part of it, and
            belongs wherever its writer put it -- over a chart, in a margin,
            across two widgets at once. See lib/stickyNotes.js. */}
        <StickyNotes
          notes={notes}
          onNotes={setNotes}
          canvasWidth={design.maxWidth || 0}
          hidden={notesHidden}
        />

        {/* --- The header the paper gets, and the screen does not -------
            A printed chart reading 412 is not a fact, it is a fact ABOUT a
            filter. Print it without the filters and it is a number somebody
            quotes back at you in six weeks, wrongly. */}
        <div className="print-header">
          <p className="text-lg font-semibold text-slate-900">{page?.name || 'Dashboard'}</p>
          <p className="text-[11px] text-slate-500">
            {sourceNames.length > 0 && `${sourceNames.join(' · ')} — `}
            printed {printStamp()}
          </p>
          <p className="mt-1 text-[11px] text-slate-700">
            {printFilters.length === 0 ? (
              <span className="text-slate-500">No filters applied — the whole dataset.</span>
            ) : (
              printFilters.map((f, i) => (
                <span key={`${f.label}-${i}`}>
                  {i > 0 && <span className="text-slate-300"> · </span>}
                  <strong>{f.label}:</strong> {f.value}
                  {/* A fixed control is one the reader cannot see or clear,
                      and a drill is one they made by clicking -- both are
                      easy to forget and both change what the number means. */}
                  {f.fixed && <span className="text-slate-400"> (fixed)</span>}
                  {f.drilled && <span className="text-slate-400"> (drill)</span>}
                </span>
              ))
            )}
          </p>
        </div>

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
          <div className="no-print flex items-center gap-2">{headerActions}</div>
        </div>

        {/* --- Canvas tabs: this page's sub-canvases ---------------------- */}
        {canvas && (
          <div className="no-print page-chrome page-chrome-surface flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white/80 p-1 backdrop-blur">
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
          <div className="no-print flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-800">
            <ArrowUpDown size={13} />
            <span>
              <strong>Drag a widget</strong> to move it and <strong>drag a handle</strong> to resize it — it goes
              exactly where you put it and stays there. Pink lines show what it has lined up with; hold{' '}
              <strong>Alt</strong> to place it to the pixel instead. <strong>Shift-click</strong> to pick out
              several, or drag a box across the canvas to catch them, and they all move together — Escape lets
              go. The pill on each widget has the same four
              numbers if you would rather type them, and its <strong>🖌</strong> changes how that one widget
              looks. The page is designed at {DESIGN_WIDTH}px: a narrower screen draws the whole
              arrangement smaller, a wider one stretches the cards to fill it without inflating the text, and a
              phone stacks it one to a line. One arrangement, every screen. The <strong>palette</strong>{' '}
              button in the page header opens spacing, text size and the card surface.
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
                onClick={() => {
                  setArranging(false)
                }}
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
            {controlBar}

            {/* One pixel, at the bottom of the header. While it is on
                screen the header is; when it is not, it is not. */}
            <div ref={headerMark} aria-hidden className="h-px w-full" />

            {/* Pinned ones are left out entirely -- see `filterFor`.
                They are not something the reader chose, so offering them a
                cross to press would be offering to break the page. */}
            <CrossFilterChips
              crossFilters={crossFilters.filter((c) => !c.pinned)}
              onRemove={(id) => setCrossFilters((c) => c.filter((x) => x.id !== id || x.pinned))}
              onClear={() => setCrossFilters((c) => c.filter((x) => x.pinned))}
            />

            {editError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                {editError}
              </div>
            )}

            {editing && isAdmin && (
              <div className="no-print page-chrome page-chrome-surface flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-2.5 py-2">
                {/* Sixteen names tell you nothing about the difference
                    between a combo chart and a stacked one, and the way
                    anybody finds out is by adding both and deleting one. The
                    sketch answers it in the time it takes to move the mouse.

                    A type with shapes behind it OPENS rather than adds: the
                    palette becomes those shapes and every other type steps
                    aside, the same move the page makes when a widget has
                    widgets inside it. Twenty-one chart styles behind one
                    word is twenty-one things nobody can find. */}
                {addFamily ? (
                  <>
                    <button
                      onClick={() => setAddFamily(null)}
                      title="Back to every widget"
                      className="flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50"
                    >
                      <ChevronLeft size={12} /> All widgets
                    </button>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                      {variantTitle(addFamily)}
                    </span>

                    {variantsFor(addFamily).map((v) => (
                      <div key={v.value} className="group relative">
                        <button
                          onClick={() => addWidgetHere(addFamily, v.patch)}
                          className="rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[11px] font-medium text-indigo-700 hover:border-indigo-400 hover:bg-indigo-50"
                        >
                          {v.label}
                        </button>

                        <div className="pointer-events-none absolute left-0 top-full z-30 hidden pt-1.5 group-hover:block">
                          <div className="w-44 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                            <WidgetTypePreview type={v.preview} />
                            <p className="mt-1.5 text-[10px] font-medium leading-snug text-slate-600">{v.label}</p>
                          </div>
                        </div>
                      </div>
                    ))}

                    <p className="ml-auto max-w-xs text-[10px] leading-relaxed text-indigo-700/70">
                      {variantHint(addFamily)}
                    </p>
                  </>
                ) : (
                  <>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">Add</span>

                    {WIDGET_TYPES.map((t) => (
                      <div key={t.value} className="group relative">
                        <button
                          onClick={() => (hasVariants(t.value) ? setAddFamily(t.value) : addWidgetHere(t.value))}
                          className="flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[11px] font-medium text-indigo-700 hover:border-indigo-400 hover:bg-indigo-50"
                        >
                          <span aria-hidden>{t.icon}</span>
                          {t.label}
                          {/* A button that OPENS rather than adds says so,
                              or one click in the row does something other
                              than what every click beside it does. */}
                          {hasVariants(t.value) && (
                            <span className="rounded-full bg-indigo-50 px-1 text-[9px] font-semibold text-indigo-500">
                              {variantsFor(t.value).length}
                            </span>
                          )}
                        </button>

                        <div className="pointer-events-none absolute left-0 top-full z-30 hidden pt-1.5 group-hover:block">
                          <div className="w-44 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                            <WidgetTypePreview type={t.value} />
                            <p className="mt-1.5 text-[10px] leading-snug text-slate-500">{t.hint}</p>
                          </div>
                        </div>
                      </div>
                    ))}

                  <span className="mx-1 h-4 w-px bg-indigo-200" />

                  <button
                    onClick={() => setEditTarget({ kind: 'controls' })}
                    className="rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50"
                  >
                    Controls &amp; buttons
                  </button>
                  <button
                    onClick={() => setEditTarget({ kind: 'page' })}
                    className="rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50"
                  >
                    Page settings
                  </button>
                  {/* The backdrop, the card look and the text colour every
                      widget on the page inherits. It has always been one
                      click away behind the palette; in edit mode it belongs
                      with the other things you are here to change. */}
                  <button
                    onClick={() => {
                      setEditTarget(null)
                      setDesigning(true)
                    }}
                    className="rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50"
                  >
                    Background &amp; text
                  </button>

                  <p className="ml-auto max-w-md text-[10px] leading-relaxed text-indigo-700/70">
                    Everything opens as a split: the form on one side, what it changes on the other, live. Move the
                    form left, right or bottom from its header.
                  </p>
                  </>
                )}

              </div>
            )}

            {/* Where you are, and the way back. Only ever on screen once
                there IS somewhere to go back to. */}
            {insideChain.length > 0 && (
              <div className="page-chrome mb-3 flex flex-wrap items-center gap-1 rounded-xl border border-indigo-100 bg-white/80 px-2.5 py-1.5 text-[11px] shadow-sm backdrop-blur">
                <Layers size={12} className="shrink-0 text-indigo-400" />
                <button
                  onClick={() => setOpenWidgets([])}
                  className="rounded px-1.5 py-0.5 font-medium text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
                >
                  {page?.name || 'This page'}
                </button>
                {insideChain.map((crumb, i) => (
                  <span key={crumb.id} className="flex items-center gap-1">
                    <ChevronRight size={11} className="shrink-0 text-slate-300" />
                    <button
                      onClick={() => setOpenWidgets(ascendWidget(insidePath, i))}
                      className={`rounded px-1.5 py-0.5 font-semibold transition-colors hover:bg-indigo-50 ${
                        i === insideChain.length - 1 ? 'text-indigo-700' : 'text-slate-500'
                      }`}
                    >
                      {crumb.title || 'Untitled widget'}
                    </button>
                  </span>
                ))}
                <span className="ml-auto text-[10px] text-slate-400">
                  Inside a widget — the rest of the page is waiting where you left it
                </span>
              </div>
            )}

            <WidgetCanvas
              items={widgetItems}
              gapX={design.gapX}
              gapY={design.gapY}
              // Dragging IS how you arrange, so it is on for the whole of
              // arrange mode. There is nothing else it could be.
              free={isAdmin && arranging}
              onLayout={saveLayout}
              onMeasure={noteSize}
            />

            {/* An empty inside is an admin who has just opened one. Nobody
                else can get here: a reader is only offered widgets that
                have something behind them. */}
            {insideChain.length > 0 && view.widgets.length === 0 && !loading && (
              <p className="empty-state">
                Nothing inside {insideChain[insideChain.length - 1].title || 'this widget'} yet — add one below.
              </p>
            )}

            {/* The shape of what is coming, rather than the word
                "Loading". A dashboard's first fetch reads every tab of
                every sheet the page touches, which is long enough for a
                grey word centred on white to read as a page that has given
                up. */}
            {loading && view.widgets.length === 0 && (
              <CanvasSkeleton />
            )}
          </>
        )}
      </div>
      </NotesLayerProvider>

      {/* --- The header, from wherever you have scrolled to -------------
          A dashboard is long and the controls that decide what it says are
          at the top of it. Rather than scrolling back -- which loses the
          row you were reading -- the header comes to you. */}
      {headerGone && canView && !error && controlBar && (
        <button
          onClick={() => setHeaderOpen((v) => !v)}
          title={headerOpen ? 'Hide the filters' : 'Filters and buttons, without scrolling back up'}
          className="no-print page-chrome fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-[11px] font-medium text-slate-600 shadow-lg backdrop-blur transition-all hover:border-indigo-300 hover:text-indigo-600"
        >
          <ChevronUp size={13} className={headerOpen ? 'rotate-180' : ''} />
          {headerOpen ? 'Hide filters' : 'Filters'}
          {activeButtonIds.length > 0 && (
            <span className="rounded-full bg-indigo-100 px-1.5 text-[10px] font-semibold text-indigo-700">
              {activeButtonIds.length}
            </span>
          )}
        </button>
      )}

      {headerGone && headerOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setHeaderOpen(false)} />
          <div className="page-chrome fixed inset-x-2 bottom-16 z-40 max-h-[60vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white/97 p-2.5 shadow-2xl backdrop-blur md:inset-x-auto md:left-1/2 md:w-[44rem] md:-translate-x-1/2">
            {/* The real control bar, not a copy of it: a second one would
                drift, and the one that drifted would be this one. */}
            {controlBar}
          </div>
        </>
      )}

      {/* --- The editor ------------------------------------------------
          One split for every kind of thing: the form on one side, what it
          changes on the other, live. Wrapped in the workspace context the
          admin forms expect -- they ask for it to name a tab, and the page
          knows every tab it has. */}
      {editTarget && isAdmin && (
        <WorkspaceCtx.Provider value={adminCtx}>
          <EditSplit
            title={targetTitle(editTarget, editedWidget)}
            subtitle={
              editTarget.kind === 'widget'
                ? `${editedWidget?.type || ''} · ${labelFor(editedWidget?.tab || '')}`
                : page?.name
            }
            side={editSide}
            onSide={setEditSide}
            fraction={editFraction}
            onFraction={setEditFraction}
            saving={savingEdit || savingLayout}
            onClose={closeEditor}
            preview={
              previewKind(editTarget) === 'widget' ? (
                // A DEFINITE height, because the widget inside now fills
                // the space it is given: in the preview there is no canvas
                // to give it one, and a chart asked to be 100% of nothing
                // is a chart nobody can see. Its own drawn height, so what
                // the form is changing looks like what the page will draw.
                <div
                  className={`page-canvas ${designClass(design)}`}
                  style={{ ...designVars(design), height: previewHeight(editTarget, view.widgets) }}
                >
                  {editedItem?.content}
                </div>
              ) : (
                <div className={`page-canvas space-y-3 ${designClass(design)}`} style={designVars(design)}>
                  {controlBar}
                  <WidgetCanvas items={widgetItems} gapX={design.gapX} gapY={design.gapY} />
                </div>
              )
            }
          >
            <Suspense fallback={<p className="py-8 text-center text-xs text-slate-400">Opening the editor…</p>}>
            {editTarget.kind === 'widget' && editedWidget && (
              <WidgetsPanel
                compact
                tabs={adminCtx.tabOptions}
                tabHeaders={tabColumns}
                pageControls={pageControls}
                widgets={[editedWidget]}
                setWidgets={(next) => {
                  const only = Array.isArray(next) ? next[0] : null
                  if (!only) {
                    setEditTarget(null)
                    setEditDraft(null)
                    deleteWidget(editedWidget.id)
                  } else {
                    editWidgetDraft(only)
                  }
                }}
              />
            )}

            {editTarget.kind === 'controls' && (
              <ControlsPanel
                tabs={adminCtx.tabOptions}
                tabHeaders={tabColumns}
                controls={page.controls || []}
                setControls={(next) => writePage({ controls: next })}
                views={page.views || []}
                setViews={(next) => writePage({ views: next })}
                hideSearch={page.hideSearch}
                setHideSearch={(v) => writePage({ hideSearch: v })}
              />
            )}

            {editTarget.kind === 'page' && (
              <PageSettings
                key={page.id}
                page={savedPage}
                onDraft={setPageDraft}
                pages={pages}
                sources={sources}
                onSave={async (next) => {
                  setPageDraft(null)
                  await writePage(next)
                }}
              />
            )}
            </Suspense>
          </EditSplit>
        </WorkspaceCtx.Provider>
      )}

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
