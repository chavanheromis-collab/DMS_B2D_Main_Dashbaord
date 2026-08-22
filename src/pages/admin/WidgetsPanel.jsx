import { useState } from 'react'
import { ChevronRight, Copy, Plus, Search, X } from 'lucide-react'
import {
  KPI_PALETTE,
  AGGREGATIONS,
  CHART_TYPES,
  NUMBER_FORMATS,
  PALETTE,
  STAGE_PALETTE,
  WIDGET_TYPES,
  WIDTH_UNITS,
  aggNeedsColumn,
  uid,
  widthUnitsFor,
  widthUnitsLabel,
} from '../../lib/config'
import { looksLikeDateColumn } from '../../lib/dataUtils'
import { DEFAULT_BLEND, blendIsReady, blendedHeaders } from '../../lib/blend'
import { hasCustomStyle } from '../../lib/widgetStyle'
import { COLOR_MODES, DEFAULT_REFERENCE, REFERENCE_KINDS, chartCaps, unsupportedNote } from '../../lib/chartOptions'
import { isDriveUrl, safeImageUrl } from '../../lib/imageUrl'
import AppImage from '../../components/PageIcon.jsx'
import { Btn, Field, RowControls, Select, TextInput, Toggle, listOps, optValue, useWorkspaceCtx } from './ui.jsx'
import ConditionBuilder from './ConditionBuilder.jsx'
import BlendEditor from './BlendEditor.jsx'
import StyleEditor from './StyleEditor.jsx'
import WidgetControlsEditor from './WidgetControlsEditor.jsx'
import { ComboEditor, HeatmapEditor, ScatterEditor, StackedEditor } from './ComparisonEditors.jsx'
import {
  PipelineEditor,
  LeaderboardEditor,
  TrendEditor,
  PivotEditor,
  GaugeEditor,
  ColumnOrderEditor,
  ActivityFeedEditor,
  ScorecardEditor,
} from './WidgetEditors.jsx'

// Every widget that reads ONE tab can blend a second one into itself. The
// pipeline is the exception: each of its stages already picks its own tab,
// so "the widget's tab" isn't a single thing to join against.
const BLENDABLE = new Set([
  'kpi', 'table', 'chart', 'leaderboard', 'trend', 'pivot', 'gauge',
  'activity', 'scorecard', 'heatmap', 'stacked', 'combo', 'scatter',
])

/**
 * Builds the page's widgets. Every widget is pinned to a TAB -- now a tab of
 * any spreadsheet this page is connected to -- and all of them render
 * together on the one canvas.
 */
export default function WidgetsPanel({ tabs, tabHeaders, widgets, setWidgets }) {
  const { labelFor } = useWorkspaceCtx()
  const ops = listOps(widgets, setWidgets)
  const [addType, setAddType] = useState('table')
  const [addTab, setAddTab] = useState(optValue(tabs[0]) || '')
  const [openId, setOpenId] = useState(null)
  const [search, setSearch] = useState('')

  const columnsOf = (tab) => tabHeaders?.[tab] || []

  function addWidget() {
    const tab = addTab || optValue(tabs[0])
    if (!tab) return null
    const cols = columnsOf(tab)
    // The default title has to read like a title, so it uses the tab's
    // human label ("MASTER", "MASTER · Premia Sales") and never the internal
    // ref the widget actually stores.
    const name = labelFor(tab)
    const base = {
      id: uid('w'),
      type: addType,
      tab,
      blend: { ...DEFAULT_BLEND },
      title:
        addType === 'table'
          ? name
          : addType === 'kpi'
            ? `Total ${name}`
            : addType === 'activity'
              ? `Recent ${name}`
              : addType === 'scorecard'
                ? `${name} comparison`
                : `${name} breakdown`,
      width:
        addType === 'kpi' || addType === 'gauge'
          ? 'quarter'
          : addType === 'leaderboard' || addType === 'trend' || addType === 'scorecard' || addType === 'activity'
            ? 'twothird'
            : 'full',
      ignoreFilters: false,
    }

    if (addType === 'kpi') {
      Object.assign(base, {
        aggregation: 'count',
        column: null,
        secondaryTab: '',
        secondaryAggregation: 'count',
        secondaryColumn: null,
        color: PALETTE[widgets.filter((w) => w.type === 'kpi').length % PALETTE.length],
        format: 'comma',
        icon: '',
      })
    } else if (addType === 'table') {
      Object.assign(base, {
        columns: cols,
        pageSize: 25,
        editable: false,
        rowDetail: true,
        detailColumns: cols,
        detailTitleColumn: cols[0] || '',
        badgeColumns: [],
        downloadButtons: false,
        downloadColumns: [],
        sortBy: '',
        sortDir: 'asc',
      })
    } else if (addType === 'pipeline') {
      Object.assign(base, {
        title: 'Workflow Pipeline',
        percentBase: 'first',
        showSparkline: true,
        stages: [
          {
            id: uid('s'),
            label: 'Stage 1',
            icon: '',
            color: STAGE_PALETTE[0],
            tab,
            match: 'all',
            conditions: [{ tab, column: '', operator: 'is_not_empty', value: '', value2: '' }],
            dateColumn: '',
            kpis: [
              {
                id: uid('sk'),
                label: 'Rows in stage',
                icon: '',
                color: KPI_PALETTE[0],
                aggregation: 'count',
                column: null,
                format: 'comma',
                match: 'all',
                conditions: [],
              },
            ],
            pivot: {
              rowColumn: '',
              colColumn: '',
              column: null,
              aggregation: 'count',
              format: 'comma',
              display: 'matrix',
            },
            leaderboard: {
              groupBy: '',
              limit: 10,
              color: '#4F46E5',
              sortBy: null,
              metrics: [
                {
                  id: uid('sm'),
                  label: 'Count',
                  aggregation: 'count',
                  column: null,
                  format: 'comma',
                },
              ],
            },
          },
        ],
      })
    } else if (addType === 'leaderboard') {
      Object.assign(base, {
        title: 'Leaderboard',
        groupBy: cols[0] || '',
        limit: 10,
        color: PALETTE[0],
        metrics: [{ id: uid('m'), label: 'Count', aggregation: 'count', column: null, format: 'comma' }],
        sortBy: '',
      })
    } else if (addType === 'trend') {
      const dateCol = cols.find(looksLikeDateColumn) || ''
      Object.assign(base, {
        title: `${name} over time`,
        dateColumn: dateCol,
        grain: 'month',
        aggregation: 'count',
        column: null,
        chartType: 'area',
        color: PALETTE[0],
        format: 'comma',
        height: 240,
      })
    } else if (addType === 'pivot') {
      Object.assign(base, {
        title: `${name} pivot`,
        rowColumn: cols[0] || '',
        colColumn: cols[1] || '',
        aggregation: 'count',
        column: null,
        color: PALETTE[0],
        format: 'comma',
      })
    } else if (addType === 'gauge') {
      Object.assign(base, {
        title: `${name} target`,
        aggregation: 'count',
        column: null,
        target: 100,
        color: PALETTE[0],
        format: 'comma',
        icon: '',
        lowerIsBetter: false,
        conditions: [],
        conditionsMatch: 'all',
      })
    } else if (addType === 'heatmap') {
      Object.assign(base, {
        title: `${name} heat map`,
        rowColumn: cols[0] || '',
        colColumn: cols[1] || '',
        aggregation: 'count',
        column: null,
        scale: 'indigo',
        format: 'comma',
        maxRows: 15,
        maxCols: 12,
      })
    } else if (addType === 'stacked') {
      Object.assign(base, {
        title: `${name} breakdown`,
        groupBy: cols[0] || '',
        stackBy: cols[1] || '',
        aggregation: 'count',
        column: null,
        layout: 'stacked',
        limit: 12,
        maxSeries: 8,
        sort: 'value_desc',
        format: 'comma',
        height: 280,
        showLegend: true,
      })
    } else if (addType === 'combo') {
      Object.assign(base, {
        title: `${name} combo`,
        groupBy: cols[0] || '',
        aggregation: 'count',
        column: null,
        barLabel: 'Count',
        format: 'comma',
        color: PALETTE[0],
        lineAggregation: 'avg',
        lineColumn: null,
        lineLabel: 'Average',
        lineFormat: 'comma',
        lineColor: PALETTE[4],
        limit: 12,
        sort: 'value_desc',
        height: 280,
        showLegend: true,
      })
    } else if (addType === 'scatter') {
      Object.assign(base, {
        title: `${name} scatter`,
        xColumn: '',
        yColumn: '',
        sizeColumn: '',
        groupBy: '',
        limit: 400,
        format: 'comma',
        height: 280,
        showLegend: true,
      })
    } else if (addType === 'activity') {
      const dateCol = cols.find(looksLikeDateColumn) || ''
      Object.assign(base, {
        dateColumn: dateCol,
        titleColumn: cols[0] || '',
        subtitleColumns: cols.slice(1, 3),
        limit: 15,
        color: PALETTE[0],
        ignoreFilters: true, // "respect page filters" defaults OFF -- see editor
      })
    } else if (addType === 'scorecard') {
      Object.assign(base, {
        aggregation: 'count',
        column: null,
        format: 'comma',
        lowerIsBetter: false,
        labelA: 'A',
        labelB: 'B',
        colorA: PALETTE[0],
        colorB: '#94A3B8',
        matchA: 'all',
        matchB: 'all',
        conditionsA: [],
        conditionsB: [],
      })
    } else {
      Object.assign(base, {
        chartType: 'bar',
        groupBy: cols[0] || '',
        column: null,
        aggregation: 'count',
        limit: 12,
        sort: 'value_desc',
        color: PALETTE[0],
        format: 'comma',
        height: 260,
      })
    }
    ops.add(base)
    return base.id
  }

  if (tabs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
        This page has no tabs yet — connect a spreadsheet under “Data Sources”, then select it for this page under
        “Pages”.
      </p>
    )
  }

  // Only ONE widget is expanded at a time. With a dozen widgets on a page,
  // every card open at once made this panel thousands of pixels long and the
  // widget you wanted was always off-screen. Collapsed rows keep the whole
  // page in view; the search box narrows it further.
  const query = search.trim().toLowerCase()
  const matches = (widget) =>
    !query ||
    [widget.title, widget.type, labelFor(widget.tab)].some((f) =>
      String(f || '').toLowerCase().includes(query)
    )
  const shown = widgets.filter(matches)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <Field label="Widget type" className="w-52">
          <Select value={addType} onChange={setAddType} options={WIDGET_TYPES.map((t) => ({ value: t.value, label: `${t.icon} ${t.label}` }))} />
        </Field>
        <Field label="From tab" className="w-64">
          <Select value={addTab || optValue(tabs[0])} onChange={setAddTab} options={tabs} />
        </Field>
        <Btn
          variant="accent"
          onClick={() => {
            const added = addWidget()
            // Jump straight into the thing you just created rather than
            // leaving it collapsed at the bottom of the list.
            if (added) setOpenId(added)
          }}
        >
          <Plus size={13} /> Add to dashboard
        </Btn>
        <p className="ml-auto max-w-xs text-[11px] text-slate-400">
          {WIDGET_TYPES.find((t) => t.value === addType)?.hint}
        </p>
      </div>

      {widgets.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
          No widgets yet. Pick a type and a tab above, then click “Add to dashboard”.
        </p>
      )}

      {widgets.length > 3 && (
        <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-2.5 py-1.5 backdrop-blur">
          <div className="relative">
            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-300" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a widget…"
              className="w-48 rounded-lg border border-slate-200 py-1 pl-6 pr-2 text-xs placeholder:text-slate-300"
            />
          </div>
          <span className="text-[11px] text-slate-400">
            {shown.length} of {widgets.length}
          </span>
          {openId && (
            <button onClick={() => setOpenId(null)} className="text-[11px] text-indigo-600 underline">
              Collapse all
            </button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {shown.map((widget) => {
          // Position within the FULL list, not the filtered view -- the
          // up/down buttons and the "#3" placeholder must both refer to
          // where the widget really sits, or searching would silently
          // reorder the wrong things.
          const index = widgets.indexOf(widget)
          const open = openId === widget.id
          // A blended widget's editors must offer the BLENDED column list --
          // the point of a blend is to chart, sort and total the columns it
          // brings across, which is only possible if they're pickable here.
          const cols = blendedHeaders(
            columnsOf(widget.tab),
            columnsOf(widget.blend?.ref),
            widget.blend
          )
          const typeMeta = WIDGET_TYPES.find((t) => t.value === widget.type)
          const set = (patch) => ops.update(widget.id, patch)

          return (
            <div
              key={widget.id}
              className={`rounded-xl border bg-white transition-colors ${
                open ? 'border-indigo-300 p-3 shadow-sm' : 'border-slate-200 p-2'
              }`}
            >
              <div className={`flex flex-wrap items-center gap-2 ${open ? 'mb-3' : ''}`}>
                <button
                  onClick={() => setOpenId(open ? null : widget.id)}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  title={open ? 'Collapse' : 'Edit this widget'}
                >
                  <ChevronRight size={15} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
                </button>
                <span className="text-lg">{typeMeta?.icon}</span>

                {open ? (
                  <TextInput value={widget.title} onChange={(v) => set({ title: v })} className="max-w-[240px] flex-1" placeholder="Widget title" />
                ) : (
                  // Collapsed rows are a summary, not a form: the whole row
                  // is the button that opens it.
                  <button
                    onClick={() => setOpenId(widget.id)}
                    className="min-w-0 flex-1 text-left"
                    title="Edit this widget"
                  >
                    <p className="truncate text-sm font-medium text-ink">{widget.title || 'Untitled widget'}</p>
                    <p className="truncate text-[11px] text-slate-400">
                      {typeMeta?.label} · {labelFor(widget.tab)} · {widget.width}
                      {blendIsReady(widget.blend) && ' · 🔗 blended'}
                      {(widget.controls || []).length > 0 && ` · ${widget.controls.length} control(s)`}
                      {hasCustomStyle(widget.style) && ' · themed'}
                    </p>
                  </button>
                )}

                {open && (
                  <>
                    {widget.type !== 'pipeline' ? (
                      <Select
                        value={widget.tab}
                        onChange={(v) =>
                          // Switching tabs invalidates the blend too: its left
                          // key names a column of the tab we're leaving.
                          set({
                            tab: v,
                            column: null,
                            groupBy: '',
                            columns: columnsOf(v),
                            blend: { ...DEFAULT_BLEND },
                          })
                        }
                        options={tabs}
                        className="w-52"
                      />
                    ) : (
                      <span className="rounded-lg bg-slate-100 px-2 py-1.5 text-[11px] text-slate-500">
                        each stage picks its own tab
                      </span>
                    )}
                    {/* Width in COLUMNS of the 12-wide canvas. A slider
                        rather than five presets, because "a bit narrower
                        than a third" is a real thing to want and the grid
                        can express it exactly. */}
                    <span className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
                      <span className="whitespace-nowrap text-[10px] font-medium text-slate-500">Width</span>
                      <input
                        type="range"
                        min={1}
                        max={WIDTH_UNITS}
                        value={widthUnitsFor(widget)}
                        onChange={(e) => set({ widthUnits: Number(e.target.value), width: null })}
                        className="h-1 w-24 accent-indigo-500"
                        aria-label="Widget width in columns"
                      />
                      <span className="w-12 whitespace-nowrap text-right text-[10px] tabular-nums text-slate-600">
                        {widthUnitsLabel(widthUnitsFor(widget))}
                      </span>
                    </span>

                    {/* The DEFAULT position for everyone. A user can override
                        it from the dashboard's arrange mode, and an admin can
                        override it per user in Users & Access. */}
                    <TextInput
                      type="number"
                      value={widget.order ?? ''}
                      onChange={(v) => set({ order: v === '' ? null : Number(v) })}
                      placeholder={`#${index + 1}`}
                      className="w-16 text-center"
                    />
                  </>
                )}

                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => ops.add({ ...widget, id: uid('w'), title: `${widget.title} (copy)` })}
                    className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                    title="Duplicate"
                  >
                    <Copy size={14} />
                  </button>
                  <RowControls
                    onUp={() => ops.move(index, -1)}
                    onDown={() => ops.move(index, 1)}
                    onDelete={() => ops.remove(widget.id)}
                    isFirst={index === 0}
                    isLast={index === widgets.length - 1}
                  />
                </div>
              </div>

              {open && (
                <>
              {cols.length === 0 && (
                <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
                  No columns known for “{labelFor(widget.tab)}” yet — open a dashboard using that tab once (or hit
                  Refresh there) and the header row will sync automatically.
                </p>
              )}

              {widget.type === 'kpi' && (
                <KpiEditor widget={widget} cols={cols} tabs={tabs} tabHeaders={tabHeaders} set={set} />
              )}
              {widget.type === 'pipeline' && (
                <PipelineEditor widget={widget} tabs={tabs} tabHeaders={tabHeaders} set={set} />
              )}
              {widget.type === 'leaderboard' && <LeaderboardEditor widget={widget} cols={cols} set={set} />}
              {widget.type === 'chart' && <ChartEditor widget={widget} cols={cols} set={set} />}
              {widget.type === 'table' && <TableEditor widget={widget} cols={cols} set={set} />}
              {widget.type === 'trend' && <TrendEditor widget={widget} cols={cols} set={set} />}
              {widget.type === 'pivot' && <PivotEditor widget={widget} cols={cols} set={set} />}
              {widget.type === 'gauge' && <GaugeEditor widget={widget} cols={cols} tabs={tabs} tabHeaders={tabHeaders} set={set} />}
              {widget.type === 'activity' && <ActivityFeedEditor widget={widget} cols={cols} set={set} />}
              {widget.type === 'scorecard' && <ScorecardEditor widget={widget} tabs={tabs} tabHeaders={tabHeaders} set={set} />}
              {widget.type === 'heatmap' && <HeatmapEditor widget={widget} cols={cols} set={set} />}
              {widget.type === 'stacked' && <StackedEditor widget={widget} cols={cols} set={set} />}
              {widget.type === 'combo' && <ComboEditor widget={widget} cols={cols} set={set} />}
              {widget.type === 'scatter' && <ScatterEditor widget={widget} cols={cols} set={set} />}

              {/* Controls now serve every widget type, not just tables --
                  the rendering lives in the canvas wrapper, so a chart can
                  have its own slider exactly as a table can. */}
              <WidgetControlsEditor widget={widget} cols={cols} tabHeaders={tabHeaders} set={set} />

              {BLENDABLE.has(widget.type) && <BlendEditor widget={widget} set={set} />}
              <StyleEditor widget={widget} set={set} />

              <div className="mt-2 border-t border-slate-100 pt-2">
                <Toggle
                  checked={widget.ignoreFilters}
                  onChange={(v) => set({ ignoreFilters: v })}
                  label="Ignore page filters & buttons (always show the full, unfiltered figure)"
                />
              </div>
                </>
              )}
            </div>
          )
        })}

        {shown.length === 0 && widgets.length > 0 && (
          <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
            No widget matches “{search}”.
          </p>
        )}
      </div>
    </div>
  )
}

function KpiEditor({ widget, cols, tabs, tabHeaders, set }) {
  const { labelFor } = useWorkspaceCtx()
  const secondaryCols = widget.secondaryTab ? tabHeaders?.[widget.secondaryTab] || [] : []
  const isConversion = Boolean(widget.secondaryTab && widget.secondaryColumn)

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Field label="Calculation">
        <Select value={widget.aggregation} onChange={(v) => set({ aggregation: v })} options={AGGREGATIONS} />
      </Field>
      <Field label="Column">
        <Select
          value={widget.column || ''}
          onChange={(v) => set({ column: v })}
          options={cols}
          placeholder="— pick a column —"
          disabled={!aggNeedsColumn(widget.aggregation)}
        />
      </Field>
      <Field label="Number format">
        <Select value={widget.format || 'comma'} onChange={(v) => set({ format: v })} options={NUMBER_FORMATS} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Icon">
          <TextInput value={widget.icon} onChange={(v) => set({ icon: v })} placeholder="🚗" />
        </Field>
        <Field label="Colour">
          <input
            type="color"
            value={widget.color || PALETTE[0]}
            onChange={(e) => set({ color: e.target.value })}
            className="h-[30px] w-full rounded-lg border border-slate-200"
          />
        </Field>
      </div>

      <Field
        label="Icon image (optional)"
        className="col-span-2"
        hint={
          widget.iconUrl && !safeImageUrl(widget.iconUrl)
            ? '⚠️ Not a usable image link — the emoji will be used instead.'
            : isDriveUrl(widget.iconUrl)
              ? '✓ Google Drive link — make sure it’s shared “Anyone with the link”.'
              : 'Paste a Google Drive share link or any https:// image.'
        }
      >
        <div className="flex items-center gap-1.5">
          <TextInput
            value={widget.iconUrl || ''}
            onChange={(v) => set({ iconUrl: v })}
            placeholder="https://drive.google.com/file/d/…/view"
          />
          {/* The same component the card uses, so the preview can't lie. */}
          <span
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg p-1 ring-1"
            style={{ backgroundColor: `${widget.color || PALETTE[0]}14`, '--tw-ring-color': `${widget.color || PALETTE[0]}33` }}
          >
            <AppImage
              src={widget.iconUrl}
              fallback={widget.icon || '—'}
              size={22}
              rounded="rounded-md"
              ring={false}
              fit="contain"
            />
          </span>
        </div>
      </Field>

      {safeImageUrl(widget.iconUrl) && (
        <div className="col-span-2 grid grid-cols-2 gap-2 rounded-lg border border-slate-100 bg-slate-50/50 p-2 md:grid-cols-3">
          <Field
            label="Image placement"
            hint={
              widget.iconPlacement === 'side'
                ? 'A large mark on the left, number and label to its right.'
                : 'A small mark tucked into the top-right corner.'
            }
          >
            <Select
              value={widget.iconPlacement || 'corner'}
              onChange={(v) => set({ iconPlacement: v })}
              options={[
                { value: 'corner', label: 'Small, top-right corner' },
                { value: 'side', label: 'Large, beside the number' },
              ]}
            />
          </Field>
          {widget.iconPlacement === 'side' && (
            <Field label="Image size (px)">
              <TextInput
                type="number"
                value={widget.iconSize ?? 52}
                onChange={(v) => set({ iconSize: Number(v) || 52 })}
              />
            </Field>
          )}
          <p className="col-span-2 self-end pb-1 text-[10px] text-slate-400 md:col-span-1">
            The large placement shows the logo whole rather than cropping it — best when the image <em>is</em> what the
            number is about.
          </p>
        </div>
      )}

      <div className="col-span-2 grid grid-cols-2 gap-2">
        <Field label="Conversion from tab">
          <Select
            value={widget.secondaryTab || ''}
            onChange={(v) => set({ secondaryTab: v, secondaryColumn: null })}
            options={[
              { value: '', label: '— none —' },
              ...tabs.map((t) => (typeof t === 'string' ? { value: t, label: labelFor(t) } : t)),
            ]}
          />
        </Field>
        <Field label="Conversion aggregation">
          <Select
            value={widget.secondaryAggregation || 'count'}
            onChange={(v) => set({ secondaryAggregation: v })}
            options={AGGREGATIONS}
          />
        </Field>
      </div>
      <Field label="Conversion column">
        <Select
          value={widget.secondaryColumn || ''}
          onChange={(v) => set({ secondaryColumn: v })}
          options={secondaryCols}
          placeholder={widget.secondaryTab ? '— pick a column —' : 'Select a conversion tab first'}
          disabled={!widget.secondaryTab || !aggNeedsColumn(widget.secondaryAggregation || 'count')}
        />
      </Field>
      <div className="col-span-1">
        <p className="text-[10px] text-slate-400">
          Leave Conversion tab empty for a regular KPI. When both a conversion tab and column are selected, the KPI shows secondary ÷ primary as a percent.
        </p>
      </div>
      {isConversion && (
        <div className="col-span-2 rounded-lg border border-slate-100 bg-slate-50 p-2 text-[11px] text-slate-500">
          Converting {widget.secondaryAggregation || 'count'} of {labelFor(widget.secondaryTab)}{' '}
          {widget.secondaryColumn || ''} against {widget.aggregation} of {labelFor(widget.tab)} {widget.column || ''}.
        </div>
      )}

      <div className="col-span-2 rounded-lg border border-indigo-100 bg-indigo-50/40 p-2">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[11px] font-medium text-indigo-700">
            Only count rows where{isConversion ? ` (on ${labelFor(widget.tab)})` : ''} — optional
          </p>
          <Select
            value={widget.conditionsMatch || 'all'}
            onChange={(v) => set({ conditionsMatch: v })}
            options={[
              { value: 'all', label: 'ALL (AND)' },
              { value: 'any', label: 'ANY (OR)' },
            ]}
            className="w-28"
          />
        </div>
        <ConditionBuilder
          conditions={widget.conditions || []}
          match={widget.conditionsMatch || 'all'}
          tabs={[widget.tab]}
          tabHeaders={tabHeaders}
          onChange={(conditions) => set({ conditions })}
          compact
        />
        <p className="mt-1 text-[10px] text-slate-400">
          Narrows the number itself — e.g. only Bookings where Source is Referral — on top of whatever the page's own
          filters already do.
        </p>
      </div>

      {isConversion && (
        <div className="col-span-2 rounded-lg border border-indigo-100 bg-indigo-50/40 p-2">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[11px] font-medium text-indigo-700">
            Only count rows where (on {labelFor(widget.secondaryTab)}) — optional
          </p>
            <Select
              value={widget.secondaryConditionsMatch || 'all'}
              onChange={(v) => set({ secondaryConditionsMatch: v })}
              options={[
                { value: 'all', label: 'ALL (AND)' },
                { value: 'any', label: 'ANY (OR)' },
              ]}
              className="w-28"
            />
          </div>
          <ConditionBuilder
            conditions={widget.secondaryConditions || []}
            match={widget.secondaryConditionsMatch || 'all'}
            tabs={[widget.secondaryTab]}
            tabHeaders={tabHeaders}
            onChange={(conditions) => set({ secondaryConditions: conditions })}
            compact
          />
        </div>
      )}
    </div>
  )
}

/**
 * Colour rules, reference lines and axis scaling.
 *
 * Separated from the basic chart fields because they're the second pass: you
 * build the chart, then you make it say something.
 */
function ChartAdvanced({ widget, set }) {
  const mode = widget.colorMode || 'single'
  const rules = widget.colorRules || []
  const references = widget.references || []
  // Not every option means something on every style, so the ones that don't
  // are disabled and explained rather than silently ignored -- which is how
  // a setting comes to look broken.
  const caps = chartCaps(widget.chartType || 'bar')
  const ignored = unsupportedNote(widget.chartType || 'bar')

  const setRules = (next) => set({ colorRules: next })
  const setRefs = (next) => set({ references: next })

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
        <p className="text-[11px] font-medium text-slate-500">Advanced</p>
        {ignored && <p className="text-[10px] text-amber-600">{ignored}</p>}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field
          label="Colour by"
          hint={caps.perDatumColor ? COLOR_MODES.find((m) => m.value === mode)?.hint : 'This style uses one colour.'}
        >
          <Select
            value={mode}
            onChange={(v) => set({ colorMode: v })}
            options={COLOR_MODES}
            disabled={!caps.perDatumColor}
          />
        </Field>

        <Field
          label="Axis steps"
          hint={caps.axisStep ? 'Ticks every N — 50, 100… Blank lets the chart choose.' : 'No axis on this style.'}
        >
          <TextInput
            type="number"
            value={widget.axisStep ?? ''}
            onChange={(v) => set({ axisStep: v === '' ? null : Number(v) })}
            placeholder="auto"
            disabled={!caps.axisStep}
          />
        </Field>

        <div className="flex flex-col justify-end gap-1 pb-1.5">
          {caps.labels && (
            <Toggle checked={!!widget.showLabels} onChange={(v) => set({ showLabels: v })} label="Show values on the chart" />
          )}
          {caps.grid && (
            <Toggle checked={widget.showGrid !== false} onChange={(v) => set({ showGrid: v })} label="Grid lines" />
          )}
          <Toggle checked={!!widget.showLegend} onChange={(v) => set({ showLegend: v })} label="Legend" />
        </div>

        {mode === 'rank' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Best">
              <input
                type="color"
                value={widget.bestColor || '#059669'}
                onChange={(e) => set({ bestColor: e.target.value })}
                className="h-[30px] w-full rounded-lg border border-slate-200"
              />
            </Field>
            <Field label="Worst">
              <input
                type="color"
                value={widget.worstColor || '#DC2626'}
                onChange={(e) => set({ worstColor: e.target.value })}
                className="h-[30px] w-full rounded-lg border border-slate-200"
              />
            </Field>
          </div>
        )}
      </div>

      {/* --- Reference lines are the one thing worth explaining --------- */}
      {!caps.refLines && references.length > 0 && (
        <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
          This style has no axis to draw a reference line against, so the {references.length} line
          {references.length === 1 ? '' : 's'} below {references.length === 1 ? 'is' : 'are'} kept but not shown.
          They’ll come back if you switch to bars, a line or an area.
        </p>
      )}

      {/* --- Conditional colours ------------------------------------- */}
      {mode === 'rules' && caps.perDatumColor && (
        <div className="mt-2 rounded-lg border border-slate-100 bg-white p-2">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[11px] font-medium text-slate-500">
              Colour rules <span className="font-normal text-slate-400">(first match wins)</span>
            </p>
            <Btn
              className="!py-0.5"
              onClick={() => setRules([...rules, { id: uid('cr'), operator: 'gte', value: 0, color: PALETTE[rules.length % PALETTE.length] }])}
            >
              <Plus size={11} /> Add rule
            </Btn>
          </div>

          {rules.length === 0 && (
            <p className="py-1 text-[10px] text-slate-400">
              No rules yet — every bar uses the fallback colour.
            </p>
          )}

          <div className="space-y-1.5">
            {rules.map((rule, ri) => {
              const setRule = (patch) => setRules(rules.map((r, i) => (i === ri ? { ...r, ...patch } : r)))
              return (
                <div key={rule.id || ri} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-10 text-[10px] font-semibold uppercase text-slate-400">
                    {ri === 0 ? 'if' : 'else'}
                  </span>
                  <span className="text-[10px] text-slate-500">value</span>
                  <Select
                    value={rule.operator || 'gte'}
                    onChange={(v) => setRule({ operator: v })}
                    options={[
                      { value: 'gte', label: '≥' },
                      { value: 'gt', label: '>' },
                      { value: 'lte', label: '≤' },
                      { value: 'lt', label: '<' },
                      { value: 'eq', label: '=' },
                    ]}
                    className="w-20"
                  />
                  <TextInput
                    type="number"
                    value={rule.value ?? ''}
                    onChange={(v) => setRule({ value: Number(v) })}
                    className="w-28"
                  />
                  <input
                    type="color"
                    value={rule.color || PALETTE[0]}
                    onChange={(e) => setRule({ color: e.target.value })}
                    className="h-[30px] w-12 rounded-lg border border-slate-200"
                  />
                  <button
                    onClick={() => setRules(rules.filter((_, i) => i !== ri))}
                    className="text-slate-300 hover:text-rose-500"
                  >
                    <X size={13} />
                  </button>
                </div>
              )
            })}
          </div>

          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[10px] text-slate-500">otherwise</span>
            <input
              type="color"
              value={widget.fallbackColor || widget.color || PALETTE[0]}
              onChange={(e) => set({ fallbackColor: e.target.value })}
              className="h-[26px] w-12 rounded-lg border border-slate-200"
            />
          </div>
        </div>
      )}

      {/* --- Reference lines ------------------------------------------ */}
      <div className="mt-2 rounded-lg border border-slate-100 bg-white p-2">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[11px] font-medium text-slate-500">Reference lines</p>
          <Btn className="!py-0.5" onClick={() => setRefs([...references, { ...DEFAULT_REFERENCE, id: uid('rl') }])}>
            <Plus size={11} /> Add line
          </Btn>
        </div>

        {references.length === 0 && (
          <p className="py-1 text-[10px] text-slate-400">
            None. A line at the average or at a target is what turns “here are the numbers” into “here’s who’s behind”.
          </p>
        )}

        <div className="space-y-1.5">
          {references.map((reference, ri) => {
            const setRef = (patch) => setRefs(references.map((r, i) => (i === ri ? { ...r, ...patch } : r)))
            const meta = REFERENCE_KINDS.find((k) => k.value === reference.kind)
            return (
              <div key={reference.id || ri} className="flex flex-wrap items-center gap-1.5">
                <Select
                  value={reference.kind}
                  onChange={(v) => setRef({ kind: v })}
                  options={REFERENCE_KINDS}
                  className="w-44"
                />
                {meta?.needsValue && (
                  <TextInput
                    type="number"
                    value={reference.value ?? ''}
                    onChange={(v) => setRef({ value: Number(v) })}
                    placeholder="value"
                    className="w-28"
                  />
                )}
                <TextInput
                  value={reference.label || ''}
                  onChange={(v) => setRef({ label: v })}
                  placeholder={meta?.label || 'Label'}
                  className="w-36"
                />
                <input
                  type="color"
                  value={reference.color || '#EF4444'}
                  onChange={(e) => setRef({ color: e.target.value })}
                  className="h-[30px] w-12 rounded-lg border border-slate-200"
                />
                <Toggle checked={reference.dashed !== false} onChange={(v) => setRef({ dashed: v })} label="dashed" />
                <button
                  onClick={() => setRefs(references.filter((_, i) => i !== ri))}
                  className="text-slate-300 hover:text-rose-500"
                >
                  <X size={13} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ChartEditor({ widget, cols, set }) {
  const type = widget.chartType || 'bar'
  const caps = chartCaps(type)

  // A histogram bins ONE numeric column; it has no group-by and no
  // aggregation, so those fields are replaced rather than left to confuse.
  if (caps.binned) {
    return (
      <>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Field label="Chart type">
            <Select value={type} onChange={(v) => set({ chartType: v })} options={CHART_TYPES} />
          </Field>
          <Field label="Numeric column" hint="Rows without a number here are skipped.">
            <Select
              value={widget.column || ''}
              onChange={(v) => set({ column: v })}
              options={cols}
              placeholder="— pick a column —"
            />
          </Field>
          <Field label="Number of bins">
            <TextInput type="number" value={widget.bins ?? 12} onChange={(v) => set({ bins: Number(v) || 12 })} />
          </Field>
          <Field label="Height (px)">
            <TextInput type="number" value={widget.height || 260} onChange={(v) => set({ height: Number(v) || 260 })} />
          </Field>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Field label="Range from" hint="Blank reads it from the data.">
            <TextInput
              type="number"
              value={widget.binMin ?? ''}
              onChange={(v) => set({ binMin: v === '' ? null : Number(v) })}
              placeholder="auto"
            />
          </Field>
          <Field label="Range to" hint="Blank reads it from the data.">
            <TextInput
              type="number"
              value={widget.binMax ?? ''}
              onChange={(v) => set({ binMax: v === '' ? null : Number(v) })}
              placeholder="auto"
            />
          </Field>
          <Field label="Colour">
            <input
              type="color"
              value={widget.color || PALETTE[0]}
              onChange={(e) => set({ color: e.target.value })}
              className="h-[30px] w-full rounded-lg border border-slate-200"
            />
          </Field>
        </div>
        <p className="mt-1 text-[10px] text-slate-400">
          Clicking a bar filters the dashboard to that numeric <strong>range</strong> — “120–140” isn’t a value any row
          actually holds.
        </p>
        <ChartAdvanced widget={widget} set={set} />
      </>
    )
  }

  return (
    <>
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Field label="Chart type">
        <Select value={type} onChange={(v) => set({ chartType: v })} options={CHART_TYPES} />
      </Field>
      <Field label="Group rows by">
        <Select value={widget.groupBy || ''} onChange={(v) => set({ groupBy: v })} options={cols} placeholder="— pick a column —" />
      </Field>
      <Field label="Calculation">
        <Select value={widget.aggregation} onChange={(v) => set({ aggregation: v })} options={AGGREGATIONS} />
      </Field>
      <Field label="Value column">
        <Select
          value={widget.column || ''}
          onChange={(v) => set({ column: v })}
          options={cols}
          placeholder="— pick a column —"
          disabled={!aggNeedsColumn(widget.aggregation)}
        />
      </Field>
      <Field label="Max bars/slices">
        <TextInput type="number" value={widget.limit} onChange={(v) => set({ limit: Number(v) || 12 })} />
      </Field>
      <Field label="Sort by">
        <Select
          value={widget.sort || 'value_desc'}
          onChange={(v) => set({ sort: v })}
          options={[
            { value: 'value_desc', label: 'Value, highest first' },
            { value: 'value_asc', label: 'Value, lowest first' },
            { value: 'name_asc', label: 'Name, A→Z' },
            { value: 'name_desc', label: 'Name, Z→A' },
          ]}
        />
      </Field>
      <Field label="Height (px)">
        <TextInput type="number" value={widget.height || 260} onChange={(v) => set({ height: Number(v) || 260 })} />
      </Field>
      <Field label="Colour">
        <input
          type="color"
          value={widget.color || PALETTE[0]}
          onChange={(e) => set({ color: e.target.value })}
          className="h-[30px] w-full rounded-lg border border-slate-200"
        />
      </Field>
    </div>

    {/* --- Style-specific extras -------------------------------------- */}
    {type === 'waterfall' && (
      <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-slate-100 bg-slate-50/50 p-2 md:grid-cols-4">
        <Field label="Rises">
          <input
            type="color"
            value={widget.bestColor || '#059669'}
            onChange={(e) => set({ bestColor: e.target.value })}
            className="h-[30px] w-full rounded-lg border border-slate-200"
          />
        </Field>
        <Field label="Falls">
          <input
            type="color"
            value={widget.worstColor || '#DC2626'}
            onChange={(e) => set({ worstColor: e.target.value })}
            className="h-[30px] w-full rounded-lg border border-slate-200"
          />
        </Field>
        <Field label="Total bar">
          <input
            type="color"
            value={widget.totalColor || '#334155'}
            onChange={(e) => set({ totalColor: e.target.value })}
            className="h-[30px] w-full rounded-lg border border-slate-200"
          />
        </Field>
        <div className="flex items-end pb-1.5">
          <Toggle
            checked={widget.showTotalBar !== false}
            onChange={(v) => set({ showTotalBar: v })}
            label="Closing total column"
          />
        </div>
      </div>
    )}

    {type === 'pareto' && (
      <div className="mt-2 flex flex-wrap items-end gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-2">
        <Field label="Cumulative line" className="w-32">
          <input
            type="color"
            value={widget.lineColor || '#F59E0B'}
            onChange={(e) => set({ lineColor: e.target.value })}
            className="h-[30px] w-full rounded-lg border border-slate-200"
          />
        </Field>
        <div className="pb-1.5">
          <Toggle
            checked={widget.showPareto80 !== false}
            onChange={(v) => set({ showPareto80: v })}
            label="Mark the 80% line"
          />
        </div>
        <p className="max-w-sm pb-2 text-[10px] text-slate-400">
          Bars are always sorted highest-first here — a Pareto in any other order isn’t a Pareto.
        </p>
      </div>
    )}

    {['pie', 'donut', 'rose'].includes(type) && (
      <div className="mt-2 flex flex-wrap items-end gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-2">
        <Field label="Slice labels show" className="w-40">
          <Select
            value={widget.labelStyle || 'percent'}
            onChange={(v) => set({ labelStyle: v })}
            options={[
              { value: 'percent', label: 'Share (%)' },
              { value: 'value', label: 'The value' },
            ]}
          />
        </Field>
        <p className="pb-2 text-[10px] text-slate-400">
          Turn labels on under Advanced. A rose varies petal <strong>length</strong> instead of angle, which is easier
          to compare once there are more than a handful of slices.
        </p>
      </div>
    )}

    <ChartAdvanced widget={widget} set={set} />
    </>
  )
}

function TableEditor({ widget, cols, set }) {
  const selected = widget.columns?.length ? widget.columns : cols
  function toggle(col) {
    const next = selected.includes(col) ? selected.filter((c) => c !== col) : [...selected, col]
    set({ columns: next })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Rows per page" className="w-32">
          <TextInput type="number" value={widget.pageSize || 25} onChange={(v) => set({ pageSize: Number(v) || 25 })} />
        </Field>
        <Field
          label="Card height"
          className="w-44"
          hint={
            (widget.heightMode || 'fixed') === 'auto'
              ? 'Grows to fit the rows — no scrollbar inside the card.'
              : (widget.heightMode || 'fixed') === 'full'
                ? 'Fills the screen; the grid scrolls inside it.'
                : 'A set height; the grid scrolls inside it.'
          }
        >
          <Select
            value={widget.heightMode || 'fixed'}
            onChange={(v) => set({ heightMode: v })}
            options={[
              { value: 'fixed', label: 'Fixed height' },
              { value: 'auto', label: 'Fit the table' },
              { value: 'full', label: 'Full screen height' },
            ]}
          />
        </Field>
        {(widget.heightMode || 'fixed') === 'fixed' && (
          <Field label="Height (px)" className="w-28">
            <TextInput type="number" value={widget.height || 560} onChange={(v) => set({ height: Number(v) || 560 })} />
          </Field>
        )}
        <Field label="Sort by" className="w-32">
          <Select
            value={widget.sortBy || ''}
            onChange={(v) => set({ sortBy: v })}
            options={cols}
            placeholder="— none —"
          />
        </Field>
        <Field label="Direction" className="w-28">
          <Select
            value={widget.sortDir || 'asc'}
            onChange={(v) => set({ sortDir: v })}
            options={[
              { value: 'asc', label: 'Ascending' },
              { value: 'desc', label: 'Descending' },
            ]}
          />
        </Field>
        <div className="pb-1.5">
          <Toggle
            checked={widget.editable}
            onChange={(v) => set({ editable: v })}
            label="Allow inline editing (writes back to Google Sheets)"
          />
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center gap-3">
          <span className="text-[11px] font-medium text-slate-500">
            Visible columns ({selected.length} of {cols.length})
          </span>
          <button className="text-[11px] text-indigo-600 underline" onClick={() => set({ columns: cols })}>
            All
          </button>
          <button className="text-[11px] text-slate-400 underline" onClick={() => set({ columns: [] })}>
            None
          </button>
          <button
            className="text-[11px] text-slate-400 underline"
            onClick={() => set({ columns: cols.filter((c) => !looksLikeDateColumn(c)) })}
            title="Hide every column that looks like a date"
          >
            Hide dates
          </button>
        </div>
        <div className="grid max-h-52 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-slate-100 p-2 md:grid-cols-3">
          {cols.map((col) => (
            <label key={col} className="flex items-center gap-1.5 text-[11px]">
              <input type="checkbox" checked={selected.includes(col)} onChange={() => toggle(col)} />
              <span className="truncate" title={col}>
                {col}
              </span>
            </label>
          ))}
          {cols.length === 0 && <p className="col-span-3 py-2 text-center text-[11px] text-slate-300">No columns known yet</p>}
        </div>

        <ColumnOrderEditor columns={selected} allColumns={cols} onChange={(next) => set({ columns: next })} />
      </div>

      {widget.editable && (
        <p className="rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500">
          Editing still requires a per-user grant in the Users tab — this switch only makes the table editable in
          principle. Admins can always edit.
        </p>
      )}

      {/* --- Row detail panel ------------------------------------------ */}
      <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
        <Toggle
          checked={widget.rowDetail}
          onChange={(v) => set({ rowDetail: v })}
          label="Open a detail panel when a row is clicked"
        />

        {widget.rowDetail && (
          <div className="mt-2 space-y-2">
            <Field label="Panel heading uses this column" className="max-w-xs">
              <Select
                value={widget.detailTitleColumn || ''}
                onChange={(v) => set({ detailTitleColumn: v })}
                options={cols}
                placeholder="— first visible column —"
              />
            </Field>

            <div>
              <div className="mb-1 flex items-center gap-3">
                <span className="text-[11px] font-medium text-slate-500">
                  Fields shown in the panel ({(widget.detailColumns || cols).length} of {cols.length})
                </span>
                <button className="text-[11px] text-indigo-600 underline" onClick={() => set({ detailColumns: cols })}>
                  All
                </button>
                <button
                  className="text-[11px] text-slate-400 underline"
                  onClick={() => set({ detailColumns: widget.columns?.length ? widget.columns : cols })}
                >
                  Match table
                </button>
              </div>
              <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-slate-100 bg-white p-2 md:grid-cols-3">
                {cols.map((col) => {
                  const chosen = (widget.detailColumns || cols).includes(col)
                  return (
                    <label key={col} className="flex items-center gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={chosen}
                        onChange={() => {
                          const current = widget.detailColumns || cols
                          set({
                            detailColumns: chosen ? current.filter((c) => c !== col) : [...current, col],
                          })
                        }}
                      />
                      <span className="truncate" title={col}>
                        {col}
                      </span>
                    </label>
                  )
                })}
              </div>
              <p className="mt-1 text-[10px] text-slate-400">
                The panel can show more fields than the table itself — useful for keeping the grid narrow while still
                exposing everything on click.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* --- File download actions ------------------------------------- */}
      <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
        <Toggle
          checked={!!widget.downloadButtons}
          onChange={(v) => set({ downloadButtons: v, downloadColumns: v ? widget.downloadColumns || [] : [] })}
          label="Show row download button for file-link columns"
        />

        {widget.downloadButtons && (
          <div className="mt-2 space-y-2">
            <div className="mb-1 flex items-center gap-3">
              <span className="text-[11px] font-medium text-slate-500">Link columns for download buttons</span>
            </div>
            <div className="grid max-h-32 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-slate-100 bg-white p-2 md:grid-cols-3">
              {cols.map((col) => {
                const on = (widget.downloadColumns || []).includes(col)
                return (
                  <label key={col} className="flex items-center gap-1.5 text-[11px]">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const current = widget.downloadColumns || []
                        set({
                          downloadColumns: on ? current.filter((c) => c !== col) : [...current, col],
                        })
                      }}
                    />
                    <span className="truncate" title={col}>
                      {col}
                    </span>
                  </label>
                )
              })}
            </div>
            <p className="mt-1 text-[10px] text-slate-400">
              Each row gets a direct-download action. If multiple link columns are selected, the button opens a small
              submenu with one download per column.
            </p>
          </div>
        )}
      </div>

      {/* --- Coloured status pills ------------------------------------- */}
      <div>
        <p className="mb-1 text-[11px] font-medium text-slate-500">
          Show these columns as coloured pills{' '}
          <span className="font-normal text-slate-400">(good for Status, Stage, Priority…)</span>
        </p>
        <div className="grid max-h-32 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-slate-100 p-2 md:grid-cols-3">
          {cols.map((col) => {
            const on = (widget.badgeColumns || []).includes(col)
            return (
              <label key={col} className="flex items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => {
                    const current = widget.badgeColumns || []
                    set({ badgeColumns: on ? current.filter((c) => c !== col) : [...current, col] })
                  }}
                />
                <span className="truncate" title={col}>
                  {col}
                </span>
              </label>
            )
          })}
        </div>
        <p className="mt-1 text-[10px] text-slate-400">
          Each distinct value gets its own stable colour automatically — no colour picking per value.
        </p>
      </div>
    </div>
  )
}
