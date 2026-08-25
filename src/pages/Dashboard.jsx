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
  const { widgetOrder, setWidgetOrder, clearOrder } = useUserPrefs(user?.uid, pageId)

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
    () => orderWidgets(visibleWidgetsFor(page, access, isAdmin), widgetOrder, access?.widgetOrder),
    [page, access, isAdmin, widgetOrder]
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
  // filters, the controls, all sixteen widget types, the drill-downs, the
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
  const optionRowsByControl = useMemo(() => {
    const { filters: viewFilters, buttons: viewButtons } = splitControls(view.controls)
    const listing = viewFilters.filter((c) => ['select', 'multi', 'chips'].includes(c.kind))
    const out = {}

    for (const control of listing) {
      out[control.id] = optionRows(control, {
        rows: dataByLabel[control.tab]?.rows || [],
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
  }, [view.controls, dataByLabel, effectiveValues, effectiveButtonIds, crossFilters, search, dateOrder])

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
    setCrossFilters([])
  }

  /**
   * A saved view replaces the whole control state rather than merging into
   * it, so clicking one always lands you somewhere predictable instead of
   * somewhere that depends on what you had set before.
   */
  function applyView(view) {
    setFilterValues(view.values || {})
    setActiveButtonIds(view.buttons || [])
    setCrossFilters([])
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
