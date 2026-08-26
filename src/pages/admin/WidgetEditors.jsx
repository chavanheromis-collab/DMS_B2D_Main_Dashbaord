import { Plus, ChevronDown, ChevronUp, X, GripVertical } from 'lucide-react'
import { useState } from 'react'
import {
  AGGREGATIONS,
  KPI_PALETTE,
  NUMBER_FORMATS,
  PALETTE,
  STAGE_PALETTE,
  TABLE_CONTROL_KINDS,
  aggNeedsColumn,
  uid,
} from '../../lib/config'
import { DATE_BUCKETS, bucketNeeds, looksLikeDateColumn } from '../../lib/dataUtils'
import { Btn, Field, RowControls, SectionTabs, Select, TextInput, Toggle, listOps } from './ui.jsx'
import { ALL_TIME_GRAINS, BREAKDOWN_GRAINS, SERIES_MODES, SERIES_PALETTES, SERIES_SORTS } from '../../lib/seriesData'
import { clashingPins, nextPinColor } from '../../lib/valueColors'
import { defaultMeasureLabel, emptyMeasure } from '../../lib/pivotMeasures'
import ConditionBuilder from './ConditionBuilder.jsx'

/**
 * Pipeline stages. Each stage is a label + colour + a condition set, so
 * the funnel matches whatever your sheet actually records rather than a
 * process baked into the code.
 */
export function PipelineEditor({ widget, tabs, tabHeaders, set }) {
  const stages = widget.stages || []
  const ops = listOps(stages, (next) => set({ stages: next }))

  function addStage() {
    const tab = widget.tab || tabs[0]
    ops.add({
      id: uid('s'),
      label: `Stage ${stages.length + 1}`,
      icon: '',
      color: STAGE_PALETTE[stages.length % STAGE_PALETTE.length],
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
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Percentages measured against" className="w-56">
          <Select
            value={widget.percentBase || 'first'}
            onChange={(v) => set({ percentBase: v })}
            options={[
              { value: 'first', label: 'The first stage (funnel conversion)' },
              { value: 'total', label: "Each stage's own tab total" },
            ]}
          />
        </Field>
        <div className="pb-1.5">
          <Toggle
            checked={widget.showSparkline}
            onChange={(v) => set({ showSparkline: v })}
            label="Show 30-day trend line under each stage"
          />
        </div>
      </div>

      <div className="space-y-2">
        {stages.map((stage, i) => {
          const setStage = (patch) => ops.update(stage.id, patch)
          const dateCols = (tabHeaders?.[stage.tab] || []).filter(looksLikeDateColumn)

          return (
            <div key={stage.id} className="rounded-lg border border-slate-200 bg-slate-50/50 p-2">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="w-5 text-center text-[11px] font-bold text-slate-400">{i + 1}</span>
                <TextInput
                  value={stage.label}
                  onChange={(v) => setStage({ label: v })}
                  placeholder="Stage name"
                  className="w-40"
                />
                <TextInput value={stage.icon} onChange={(v) => setStage({ icon: v })} placeholder="🏍️" className="w-16" />
                <input
                  type="color"
                  value={stage.color}
                  onChange={(e) => setStage({ color: e.target.value })}
                  className="h-[30px] w-10 rounded-lg border border-slate-200"
                />
                <Select
                  value={stage.match || 'all'}
                  onChange={(v) => setStage({ match: v })}
                  options={[
                    { value: 'all', label: 'ALL (AND)' },
                    { value: 'any', label: 'ANY (OR)' },
                  ]}
                  className="w-28"
                />
                {widget.showSparkline && (
                  <Select
                    value={stage.dateColumn || ''}
                    onChange={(v) => setStage({ dateColumn: v })}
                    options={dateCols}
                    placeholder="— trend date column —"
                    className="w-52"
                  />
                )}
                <div className="ml-auto">
                  <RowControls
                    onUp={() => ops.move(i, -1)}
                    onDown={() => ops.move(i, 1)}
                    onDelete={() => ops.remove(stage.id)}
                    isFirst={i === 0}
                    isLast={i === stages.length - 1}
                  />
                </div>
              </div>

              <ConditionBuilder
                compact
                conditions={stage.conditions || []}
                match={stage.match || 'all'}
                tabs={tabs}
                tabHeaders={tabHeaders}
                onChange={(next) => setStage({ conditions: next, tab: next[0]?.tab || stage.tab })}
              />

              <StageKpiEditor stage={stage} tabs={tabs} tabHeaders={tabHeaders} setStage={setStage} />
            </div>
          )
        })}
      </div>

      <Btn onClick={addStage}>
        <Plus size={12} /> Add stage
      </Btn>

      <p className="text-[10px] text-slate-400">
        A stage counts every row matching its conditions — stages are independent, so a row can appear in several.
        Clicking a stage on the dashboard filters everything to those rows.
      </p>
    </div>
  )
}

/**
 * Leaderboard: rank any column by any set of metrics. This is the generic
 * form of the old "Top Performers · Model-wise" panel.
 */
export function LeaderboardEditor({ widget, cols, set }) {
  const metrics = widget.metrics || []
  const ops = listOps(metrics, (next) => set({ metrics: next }))

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <BucketPicker widget={widget} set={set} label="Bucket the ranked column" />
        <Field label="Rank by column">
          <Select value={widget.groupBy || ''} onChange={(v) => set({ groupBy: v })} options={cols} placeholder="— pick a column —" />
        </Field>
        <Field label="Show top">
          <TextInput type="number" value={widget.limit || 10} onChange={(v) => set({ limit: Number(v) || 10 })} />
        </Field>
        <Field label="Sort by metric">
          <Select
            value={widget.sortBy || metrics[0]?.id || ''}
            onChange={(v) => set({ sortBy: v })}
            options={metrics.map((m) => ({ value: m.id, label: m.label }))}
          />
        </Field>
        <Field label="Bar colour">
          <input
            type="color"
            value={widget.color || PALETTE[0]}
            onChange={(e) => set({ color: e.target.value })}
            className="h-[30px] w-full rounded-lg border border-slate-200"
          />
        </Field>
      </div>

      <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
        <p className="mb-1.5 text-[11px] font-medium text-slate-500">Columns shown for each rank</p>
        <div className="space-y-1.5">
          {metrics.map((m, i) => (
            <div key={m.id} className="flex flex-wrap items-center gap-1.5">
              <TextInput
                value={m.label}
                onChange={(v) => ops.update(m.id, { label: v })}
                placeholder="Bookings"
                className="w-32"
              />
              <Select
                value={m.aggregation}
                onChange={(v) => ops.update(m.id, { aggregation: v })}
                options={AGGREGATIONS}
                className="w-56"
              />
              <Select
                value={m.column || ''}
                onChange={(v) => ops.update(m.id, { column: v })}
                options={cols}
                placeholder="— column —"
                disabled={!aggNeedsColumn(m.aggregation)}
                className="w-48"
              />
              <Select
                value={m.format || 'comma'}
                onChange={(v) => ops.update(m.id, { format: v })}
                options={NUMBER_FORMATS}
                className="w-40"
              />
              <RowControls
                onUp={() => ops.move(i, -1)}
                onDown={() => ops.move(i, 1)}
                onDelete={() => ops.remove(m.id)}
                isFirst={i === 0}
                isLast={i === metrics.length - 1}
              />
            </div>
          ))}
        </div>
        <Btn
          className="mt-1.5"
          onClick={() =>
            ops.add({ id: uid('m'), label: 'Metric', aggregation: 'count', column: null, format: 'comma' })
          }
        >
          <Plus size={12} /> Add metric
        </Btn>
      </div>
    </div>
  )
}

// =====================================================================
// Stage KPIs (the pop-up)
// =====================================================================
/**
 * KPIs attached to one pipeline stage. They're measured against the rows in
 * that stage, and each can narrow further with its own conditions -- "of
 * the bookings, how many are financed" -- which is why every KPI carries an
 * optional condition set of its own on top of the stage's.
 */
export function StageKpiEditor({ stage, tabs, tabHeaders, setStage }) {
  const [open, setOpen] = useState(false)
  const kpis = stage.kpis || []
  const cols = tabHeaders?.[stage.tab] || []

  const update = (id, patch) => setStage({ kpis: kpis.map((k) => (k.id === id ? { ...k, ...patch } : k)) })
  const remove = (id) => setStage({ kpis: kpis.filter((k) => k.id !== id) })
  const pivotConfig = stage.pivot || {}
  const updatePivot = (patch) => setStage({ pivot: { ...pivotConfig, ...patch } })
  const leaderboardConfig = stage.leaderboard || {}
  const updateLeaderboard = (patch) => setStage({ leaderboard: { ...leaderboardConfig, ...patch } })
  const leaderboardMetrics = leaderboardConfig.metrics || []

  function add() {
    setStage({
      kpis: [
        ...kpis,
        {
          id: uid('sk'),
          label: `KPI ${kpis.length + 1}`,
          icon: '',
          color: KPI_PALETTE[kpis.length % KPI_PALETTE.length],
          aggregation: 'count',
          column: null,
          format: 'comma',
          match: 'all',
          conditions: [],
        },
      ],
    })
    setOpen(true)
  }

  return (
    <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/40 p-2">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[11px] font-semibold text-indigo-700">
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          Pop-up KPIs ({kpis.length})
        </button>
        <Btn onClick={add} className="!py-0.5">
          <Plus size={11} /> Add KPI
        </Btn>
        <span className="ml-auto text-[10px] text-slate-400">Shown when a user clicks this stage</span>
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {kpis.length === 0 && (
            <p className="py-2 text-center text-[11px] text-slate-400">
              No KPIs yet — without any, clicking this stage filters the dashboard directly.
            </p>
          )}

          {kpis.map((kpi) => (
            <div key={kpi.id} className="rounded-lg border border-slate-200 bg-white p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <TextInput value={kpi.label} onChange={(v) => update(kpi.id, { label: v })} placeholder="Label" className="w-36" />
                <TextInput value={kpi.icon} onChange={(v) => update(kpi.id, { icon: v })} placeholder="💰" className="w-14" />
                <input
                  type="color"
                  value={kpi.color}
                  onChange={(e) => update(kpi.id, { color: e.target.value })}
                  className="h-[30px] w-10 rounded-lg border border-slate-200"
                />
                <Select
                  value={kpi.aggregation}
                  onChange={(v) => update(kpi.id, { aggregation: v })}
                  options={AGGREGATIONS}
                  className="w-52"
                />
                <Select
                  value={kpi.column || ''}
                  onChange={(v) => update(kpi.id, { column: v })}
                  options={cols}
                  placeholder="— column —"
                  disabled={!aggNeedsColumn(kpi.aggregation)}
                  className="w-44"
                />
                <Select
                  value={kpi.format || 'comma'}
                  onChange={(v) => update(kpi.id, { format: v })}
                  options={NUMBER_FORMATS}
                  className="w-40"
                />
                <button onClick={() => remove(kpi.id)} className="ml-auto text-slate-300 hover:text-rose-500">
                  <X size={14} />
                </button>
              </div>

              <div className="mt-1.5">
                <p className="mb-1 text-[10px] font-medium text-slate-500">
                  Narrow further (optional) — leave empty to measure the whole stage
                </p>
                <ConditionBuilder
                  conditions={kpi.conditions || []}
                  match={kpi.match || 'all'}
                  tabs={[stage.tab]}
                  tabHeaders={tabHeaders}
                  onChange={(conditions) => update(kpi.id, { conditions })}
                  compact
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-800">Optional pivot table</p>
            <p className="text-[11px] text-slate-500">Show a pivot table for this stage in the popup.</p>
            <PivotBuckets
              columns={[pivotConfig.rowColumn, pivotConfig.colColumn]}
              widget={pivotConfig}
              set={(patch) => setStage({ pivot: { ...pivotConfig, ...patch } })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <Field label="Rows">
            <Select
              value={pivotConfig.rowColumn || ''}
              onChange={(v) => updatePivot({ rowColumn: v })}
              options={cols}
              placeholder="— row column —"
            />
          </Field>
          <Field label="Columns">
            <Select
              value={pivotConfig.colColumn || ''}
              onChange={(v) => updatePivot({ colColumn: v })}
              options={cols}
              placeholder="— column column —"
            />
          </Field>
          <Field label="Value column">
            <Select
              value={pivotConfig.column || ''}
              onChange={(v) => updatePivot({ column: v })}
              options={cols}
              placeholder="— value column —"
              disabled={!aggNeedsColumn(pivotConfig.aggregation)}
            />
          </Field>
          <Field label="Aggregation">
            <Select
              value={pivotConfig.aggregation || 'count'}
              onChange={(v) => updatePivot({ aggregation: v })}
              options={AGGREGATIONS}
            />
          </Field>
          <Field label="Number format" className="md:col-span-2">
            <Select
              value={pivotConfig.format || 'comma'}
              onChange={(v) => updatePivot({ format: v })}
              options={NUMBER_FORMATS}
            />
          </Field>
          <Field label="Display mode" className="md:col-span-2">
            <Select
              value={pivotConfig.display || 'matrix'}
              onChange={(v) => updatePivot({ display: v })}
              options={[
                { value: 'matrix', label: 'Full pivot matrix' },
                { value: 'totals', label: 'Totals only' },
              ]}
            />
          </Field>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-800">Optional leaderboard</p>
            <p className="text-[11px] text-slate-500">Show a ranked list for this stage in the popup.</p>
          </div>
          <Btn size="small" onClick={() => updateLeaderboard({ metrics: [...leaderboardMetrics, { id: uid('sm'), label: `Metric ${leaderboardMetrics.length + 1}`, aggregation: 'count', column: null, format: 'comma' }] })}>
            <Plus size={11} /> Add metric
          </Btn>
        </div>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <Field label="Group by">
            <Select
              value={leaderboardConfig.groupBy || ''}
              onChange={(v) => updateLeaderboard({ groupBy: v })}
              options={cols}
              placeholder="— group by column —"
            />
          </Field>
          <Field label="Top rows">
            <TextInput
              type="number"
              value={leaderboardConfig.limit || 10}
              onChange={(v) => updateLeaderboard({ limit: Number(v) || 10 })}
            />
          </Field>
          <Field label="Sort metric" className="md:col-span-2">
            <Select
              value={leaderboardConfig.sortBy || 'first'}
              onChange={(v) => updateLeaderboard({ sortBy: v === 'first' ? null : v })}
              options={[{ value: 'first', label: 'First metric' }, ...leaderboardMetrics.map((metric) => ({ value: metric.id, label: metric.label }))]}
            />
          </Field>
        </div>

        {leaderboardMetrics.length > 0 && (
          <div className="mt-3 space-y-2">
            {leaderboardMetrics.map((metric, index) => (
              <div key={metric.id} className="rounded-lg border border-slate-200 bg-white p-2">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                  <TextInput
                    value={metric.label}
                    onChange={(v) => updateLeaderboard({ metrics: leaderboardMetrics.map((m, i) => (i === index ? { ...m, label: v } : m)) })}
                    placeholder="Label"
                    className="w-full"
                  />
                  <Select
                    value={metric.aggregation}
                    onChange={(v) => updateLeaderboard({ metrics: leaderboardMetrics.map((m, i) => (i === index ? { ...m, aggregation: v } : m)) })}
                    options={AGGREGATIONS}
                    className="w-full"
                  />
                  <Select
                    value={metric.column || ''}
                    onChange={(v) => updateLeaderboard({ metrics: leaderboardMetrics.map((m, i) => (i === index ? { ...m, column: v } : m)) })}
                    options={cols}
                    placeholder="— column —"
                    disabled={!aggNeedsColumn(metric.aggregation)}
                    className="w-full"
                  />
                  <Select
                    value={metric.format || 'comma'}
                    onChange={(v) => updateLeaderboard({ metrics: leaderboardMetrics.map((m, i) => (i === index ? { ...m, format: v } : m)) })}
                    options={NUMBER_FORMATS}
                    className="w-full"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// =====================================================================
// Drag-to-reorder column list
// =====================================================================
/**
 * The saved column order for a table. Dragging here writes the order into
 * the layout, so it applies to every user -- unlike dragging headers on the
 * dashboard, which is that person's own temporary view until an admin saves it.
 */
export function ColumnOrderEditor({ columns, allColumns, onChange }) {
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)
  const list = columns?.length ? columns : allColumns

  function drop(target) {
    if (!dragId || dragId === target) return
    const next = list.filter((c) => c !== dragId)
    next.splice(next.indexOf(target), 0, dragId)
    onChange(next)
    setDragId(null)
    setOverId(null)
  }

  return (
    <div className="mt-1.5">
      <p className="mb-1 text-[10px] text-slate-400">Drag to set the order everyone sees</p>
      <div className="flex flex-wrap gap-1">
        {list.map((col) => (
          <div
            key={col}
            draggable
            onDragStart={() => setDragId(col)}
            onDragOver={(e) => {
              e.preventDefault()
              setOverId(col)
            }}
            onDrop={() => drop(col)}
            onDragEnd={() => {
              setDragId(null)
              setOverId(null)
            }}
            className={`flex cursor-grab items-center gap-1 rounded-lg border px-2 py-1 text-[11px] ${dragId === col
              ? 'border-indigo-400 bg-indigo-100 opacity-50'
              : overId === col
                ? 'border-indigo-400 bg-indigo-50'
                : 'border-slate-200 bg-white text-slate-600'
              }`}
          >
            <GripVertical size={11} className="text-slate-300" />
            <span className="max-w-[140px] truncate">{col}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// =====================================================================
// Trend / Pivot / Gauge editors
// =====================================================================
export function TrendEditor({ widget, cols, set }) {
  const breakdown = widget.breakdown || ''
  const [part, setPart] = useState('data')

  return (
    <div className="space-y-2">
      <SectionTabs
        active={part}
        onPick={setPart}
        sections={[
          { key: 'data', label: 'Data', hint: 'The date column, the bucket and the calculation' },
          {
            key: 'series',
            label: 'Series',
            badge: Boolean(breakdown),
            hint: 'Splitting the line into several, and their colours',
          },
          { key: 'size', label: 'Size', hint: 'How tall it is and how the legend scrolls' },
          {
            key: 'readings',
            label: 'Readings',
            badge: Boolean(widget.cumulative) || Boolean(widget.movingAverage),
            hint: 'Running totals and moving averages',
          },
        ]}
      />

      {part === 'data' && (
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Date column">
          <Select
            value={widget.dateColumn || ''}
            onChange={(v) => set({ dateColumn: v })}
            options={cols}
            placeholder="— pick a date column —"
          />
        </Field>
        <Field label="Bucket by">
          <Select value={widget.grain || 'month'} onChange={(v) => set({ grain: v })} options={ALL_TIME_GRAINS} />
        </Field>
        <Field label="Calculation">
          <Select
            value={widget.aggregation || 'count'}
            onChange={(v) => set({ aggregation: v })}
            options={AGGREGATIONS}
          />
        </Field>
        <Field label="Value column">
          <Select
            value={widget.column || ''}
            onChange={(v) => set({ column: v })}
            options={cols}
            placeholder="— column —"
            disabled={!aggNeedsColumn(widget.aggregation || 'count')}
          />
        </Field>
      </div>
      )}

      {/* --- the breakdown ------------------------------------------------ */}
      {part === 'series' && (
      <>
      <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Split into series by" className="w-52" hint="One line per value.">
            <Select
              value={breakdown}
              onChange={(v) => set({ breakdown: v })}
              options={cols}
              placeholder="— no breakdown —"
            />
          </Field>

          {breakdown && (
            <Field label="Bucket the breakdown by" className="w-48" hint="When that column holds dates.">
              <Select
                value={widget.breakdownGrain || ''}
                onChange={(v) => set({ breakdownGrain: v })}
                options={BREAKDOWN_GRAINS}
              />
            </Field>
          )}

          {breakdown ? (
            <>
              <Field label="Draw them as" className="w-48">
                <Select
                  value={widget.seriesMode || 'area'}
                  onChange={(v) => set({ seriesMode: v })}
                  options={SERIES_MODES}
                />
              </Field>
              <Field label="Series to draw" className="w-32" hint="Rest become Other.">
                <TextInput
                  type="number"
                  value={widget.maxSeries ?? 6}
                  onChange={(v) => set({ maxSeries: Number(v) || 0 })}
                />
              </Field>
              <Field label="Order the series" className="w-40">
                <Select
                  value={widget.seriesSort || 'total'}
                  onChange={(v) => set({ seriesSort: v })}
                  options={SERIES_SORTS}
                />
              </Field>
              <Field label="Palette" className="w-36" hint="For anything unassigned.">
                <Select
                  value={widget.palette || 'default'}
                  onChange={(v) => set({ palette: v })}
                  options={SERIES_PALETTES}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="Style" className="w-36">
                <Select
                  value={widget.chartType || 'area'}
                  onChange={(v) => set({ chartType: v })}
                  options={[
                    { value: 'area', label: 'Area' },
                    { value: 'line', label: 'Line' },
                    { value: 'bar', label: 'Bar' },
                  ]}
                />
              </Field>
              <Field label="Colour" className="w-24">
                <input
                  type="color"
                  value={widget.color || PALETTE[0]}
                  onChange={(e) => set({ color: e.target.value })}
                  className="h-[30px] w-full rounded-lg border border-slate-200"
                />
              </Field>
            </>
          )}
        </div>

        <p className="mt-1 text-[10px] text-slate-400">
          {breakdown
            ? SERIES_MODES.find((m) => m.value === (widget.seriesMode || 'area'))?.hint +
              ' Smaller series are grouped into “Other” rather than dropped, so the stack still adds up — and readers can switch any series off by clicking the legend.'
            : 'A flat total can hide one category collapsing while another takes its place. Splitting by a column is usually the next question anyone asks.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/50 p-2">
        <Btn
          onClick={() =>
            set({
              grain: 'monthOfYear',
              breakdown: widget.dateColumn,
              breakdownGrain: 'year',
              seriesMode: 'line',
              seriesSort: 'name_desc',
              cumulative: false,
              maxSeries: 6,
            })
          }
          disabled={!widget.dateColumn}
        >
          <Plus size={11} /> Set up a year-on-year comparison
        </Btn>
        <p className="max-w-lg text-[10px] text-slate-500">
          Folds every year onto one Jan–Dec axis and draws a line per year, newest first — the seasonal question
          ("how does this November compare with the last three") in one click. It is six settings; this is the
          combination that answers it.
        </p>
      </div>

      {breakdown && <ValueColorEditor widget={widget} set={set} />}
      </>
      )}

      {part === 'size' && <ScrollEditor widget={widget} set={set} hasLegend={Boolean(breakdown)} />}

      {/* --- readings ----------------------------------------------------- */}
      {part === 'readings' && (
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-2">
        <div className="pb-1.5">
          <Toggle
            checked={!!widget.cumulative}
            onChange={(v) => set({ cumulative: v })}
            label="Running total"
          />
        </div>
        <div className="pb-1.5">
          <Toggle
            checked={!!widget.movingAverage}
            onChange={(v) => set({ movingAverage: v })}
            label="Moving-average line"
          />
        </div>
        <div className="pb-1.5">
          <Toggle
            checked={!!widget.showValues}
            onChange={(v) => set({ showValues: v })}
            label="Print the value at each point"
          />
        </div>
        {widget.movingAverage && (
          <Field label="Over how many periods" className="w-40">
            <TextInput
              type="number"
              value={widget.maWindow ?? 3}
              onChange={(v) => set({ maWindow: Number(v) || 3 })}
            />
          </Field>
        )}
        <p className="max-w-md pb-1.5 text-[10px] text-slate-400">
          A running total answers "how are we doing against the year" without making anyone add up twelve bars.
          The average is <strong>trailing</strong>, so the newest period is always drawable, and it only appears
          once one series is showing — six smoothed lines on top of six real ones is not a chart.
        </p>
      </div>
      )}
    </div>
  )
}

/**
 * "Group these values first."
 *
 * The same control wherever a widget groups a column -- a chart's bars, a
 * leaderboard's rows, a pivot axis, a stacked chart's segments. One
 * component rather than five copies, because five copies of a picker is how
 * three of them end up missing the option somebody needs.
 *
 * `prefix` lets one widget carry two of these: a stacked chart buckets its
 * groups and its segments independently.
 */
export function BucketPicker({ widget, set, prefix = '', label = 'Bucket the values' }) {
  const key = (name) => (prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name)
  const grain = widget[key('bucket')] || ''
  const needs = bucketNeeds(grain)

  return (
    <>
      <Field label={label} className="w-52" hint="Optional — groups instead of listing.">
        <Select value={grain} onChange={(v) => set({ [key('bucket')]: v })} options={DATE_BUCKETS} />
      </Field>
      {needs === 'size' && (
        <Field label={grain === 'prefix' ? 'How many characters' : 'Band size'} className="w-32">
          <TextInput
            type="number"
            value={widget[key('bucketSize')] ?? ''}
            onChange={(v) => set({ [key('bucketSize')]: Number(v) || null })}
            placeholder={grain === 'prefix' ? '3' : '100'}
          />
        </Field>
      )}
      {needs === 'breaks' && (
        <Field label="Breakpoints" className="w-44" hint="Comma separated.">
          <TextInput
            value={widget[key('bucketBreaks')] ?? ''}
            onChange={(v) => set({ [key('bucketBreaks')]: v })}
            placeholder="0, 100, 250"
          />
        </Field>
      )}
    </>
  )
}

/**
 * What may scroll, and how much room a category gets.
 *
 * Both halves are the admin's call. Squashing forty bars into the height of
 * twelve is a bad default but a legitimate choice -- a wall display nobody
 * can walk up to would rather have the shape than the detail -- and a chart
 * of twelve categories only ever scrolls because somebody asked for wider
 * bars, which is the lever this exposes.
 */
export function ScrollEditor({ widget, set, horizontal = false, hasLegend = true }) {
  const chartOn = widget.scrollChart !== false
  const legendOn = widget.scrollLegend !== false

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
      <p className="mb-1 text-[11px] font-medium text-slate-500">
        Scrolling <span className="font-normal text-slate-400">(when there is more than fits)</span>
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="pb-1.5">
          <Toggle
            checked={chartOn}
            onChange={(v) => set({ scrollChart: v })}
            label={horizontal ? 'Chart scrolls down' : 'Chart scrolls across'}
          />
        </div>
        {chartOn && (
          <Field
            label={horizontal ? 'Height per bar' : 'Width per bar'}
            className="w-36"
            hint="Pixels. Blank uses the default."
          >
            <TextInput
              type="number"
              value={widget.categorySize ?? ''}
              onChange={(v) => set({ categorySize: Number(v) || null })}
            />
          </Field>
        )}
        {hasLegend && (
          <>
            <div className="pb-1.5">
              <Toggle checked={legendOn} onChange={(v) => set({ scrollLegend: v })} label="Legend scrolls" />
            </div>
            {legendOn && (
              <Field label="Legend height" className="w-32" hint="Pixels.">
                <TextInput
                  type="number"
                  value={widget.legendMax ?? ''}
                  onChange={(v) => set({ legendMax: Number(v) || null })}
                />
              </Field>
            )}
          </>
        )}
      </div>

      <p className="mt-1 text-[10px] text-slate-400">
        {chartOn ? (
          <>
            A chart only outgrows its card when its categories need more room than there is — so if it is not
            scrolling, either there are few enough to fit (raise <strong>{horizontal ? 'height' : 'width'} per bar
            </strong>) or the cap is hiding the rest (<strong>Max bars/slices</strong> above — set it to 0 for every
            category). Given the room, every bar is also labelled.
          </>
        ) : (
          <>Off: every category is squeezed into the card, however many there are.</>
        )}
      </p>
    </div>
  )
}

/**
 * Fixed colours for the values that have a meaning.
 *
 * Red for "Cancelled" is not decoration -- a reader who has learned the
 * colour reads the chart without the legend. That only works if the colour
 * belongs to the VALUE, so a pin here beats the chart's colour mode, holds
 * across every chart it is set on, and survives filtering.
 *
 * Anything unpinned takes a palette colour, and keeps it: see
 * lib/valueColors.js for what "keeps" means when the data is filtered.
 */
export function ValueColorEditor({ widget, set }) {
  const rules = widget.seriesColors || []
  const ops = listOps(rules, (next) => set({ seriesColors: next }))
  const clashes = clashingPins(rules)

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[11px] font-medium text-slate-500">
          Fixed colours <span className="font-normal text-slate-400">(by value — optional)</span>
        </p>
        <Btn onClick={() => ops.add({ id: uid('sc'), value: '', color: nextPinColor(rules, widget.palette) })}>
          <Plus size={11} /> Add
        </Btn>
      </div>

      {rules.length === 0 && (
        <p className="py-1 text-[10px] text-slate-400">
          None — every value takes the next palette colour. Pin one where the colour carries meaning: red for
          Cancelled, green for Delivered.
        </p>
      )}

      <div className="space-y-1.5">
        {rules.map((rule, i) => (
          <div key={rule.id || i} className="flex flex-wrap items-center gap-1.5">
            <TextInput
              value={rule.value}
              onChange={(v) => ops.update(rule.id, { value: v })}
              placeholder="The value, e.g. Cancelled"
              className="w-52"
            />
            <input
              type="color"
              value={rule.color || PALETTE[0]}
              onChange={(e) => ops.update(rule.id, { color: e.target.value })}
              className="h-[30px] w-10 rounded-lg border border-slate-200"
            />
            <div className="ml-auto">
              <RowControls
                onUp={() => ops.move(i, -1)}
                onDown={() => ops.move(i, 1)}
                onDelete={() => ops.remove(rule.id)}
                isFirst={i === 0}
                isLast={i === rules.length - 1}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Two values painted the same colour is not a crash -- it is worse: a
          chart that reads fine and means nothing. Which of the two should
          move is the admin's call, so this says it rather than renumbering. */}
      {clashes.map((names, i) => (
        <p key={i} className="mt-1 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
          {names.join(' and ')} are pinned to the same colour — on one chart they’ll be impossible to tell apart.
        </p>
      ))}

      <div className="mt-1.5 border-t border-slate-200 pt-1.5">
        <Toggle
          checked={widget.lockColors !== false}
          onChange={(v) => set({ lockColors: v })}
          label="Keep each value’s colour when filtered"
        />
        <p className="mt-1 text-[10px] text-slate-400">
          {widget.lockColors === false ? (
            <>
              Off: colours are handed out by position, so filtering the page shifts every colour up as categories
              drop out.
            </>
          ) : (
            <>
              Filtering narrows the chart without repainting it — a value keeps the colour it had before the filter,
              so two charts of the same column agree with each other. Pins above are matched on the value, ignoring
              case and surrounding spaces. “Other” is always grey, so a roll-up never looks like a category of its
              own.
            </>
          )}
        </p>
      </div>
    </div>
  )
}

/**
 * Picks any number of columns for one pivot axis, in order.
 *
 * Order matters and is therefore explicit: "Region then DSE" and "DSE then
 * Region" produce the same counts but read as completely different reports,
 * so chosen columns are listed in sequence with move controls rather than
 * left as an unordered set of ticks.
 */
function AxisColumns({ label, hint, chosen, cols, onChange }) {
  const list = chosen || []
  const available = cols.filter((c) => !list.includes(c))

  const move = (index, delta) => {
    const target = index + delta
    if (target < 0 || target >= list.length) return
    const next = [...list]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <div>
      <span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span>

      <div className="space-y-1">
        {list.map((column, i) => (
          <div key={column} className="flex items-center gap-1">
            <span className="w-4 text-center text-[10px] text-slate-400">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate rounded border border-slate-200 bg-white px-2 py-1 text-[11px]">
              {column}
            </span>
            <button
              onClick={() => move(i, -1)}
              disabled={i === 0}
              className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-25"
              title="Move up"
            >
              <ChevronUp size={12} />
            </button>
            <button
              onClick={() => move(i, 1)}
              disabled={i === list.length - 1}
              className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-25"
              title="Move down"
            >
              <ChevronDown size={12} />
            </button>
            <button
              onClick={() => onChange(list.filter((c) => c !== column))}
              className="text-slate-300 hover:text-rose-500"
              title="Remove"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      <Select
        value=""
        onChange={(v) => v && onChange([...list, v])}
        options={[{ value: '', label: list.length ? '+ add another…' : '— pick a column —' }, ...available]}
        className="mt-1"
      />
      {hint && <span className="mt-1 block text-[10px] text-slate-400">{hint}</span>}
    </div>
  )
}

export function PivotEditor({ widget, cols, set }) {
  // Back-compat: a pivot saved before multi-column support has the single
  // props, which are simply the one-element case.
  const rowColumns = widget.rowColumns?.length ? widget.rowColumns : [widget.rowColumn].filter(Boolean)
  const colColumns = widget.colColumns?.length ? widget.colColumns : [widget.colColumn].filter(Boolean)
  const totalsOnly = widget.display === 'totals'
  const [part, setPart] = useState('layout')

  return (
    <div className="space-y-2">
      <SectionTabs
        active={part}
        onPick={setPart}
        sections={[
          { key: 'layout', label: 'Layout', hint: 'What shape the table is, and what it counts' },
          {
            key: 'axes',
            label: 'Axes',
            badge: rowColumns.length + colColumns.length,
            hint: 'The columns down the side and across the top',
          },
          {
            key: 'values',
            label: 'Values',
            badge: totalsOnly ? (widget.measures || []).length : 0,
            hint: 'Several numbers beside each group',
          },
        ]}
      />

      {part === 'values' && <MeasuresEditor widget={widget} cols={cols} set={set} />}

      {part === 'layout' && (
      <>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <Field
          label="Show as"
          hint={
            totalsOnly
              ? 'One column per level, parent values merged down their children.'
              : 'The full rows × columns grid.'
          }
        >
          <Select
            value={widget.display || 'matrix'}
            onChange={(v) => set({ display: v })}
            options={[
              { value: 'matrix', label: 'Full matrix (rows × columns)' },
              { value: 'totals', label: 'Grouped list (no column axis)' },
            ]}
          />
        </Field>
        <Field label="Calculation">
          <Select value={widget.aggregation || 'count'} onChange={(v) => set({ aggregation: v })} options={AGGREGATIONS} />
        </Field>
        <Field label="Value column">
          <Select
            value={widget.column || ''}
            onChange={(v) => set({ column: v })}
            options={cols}
            placeholder="— column —"
            disabled={!aggNeedsColumn(widget.aggregation || 'count')}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Max rows">
            <TextInput type="number" value={widget.maxRows ?? 25} onChange={(v) => set({ maxRows: Number(v) || 25 })} />
          </Field>
          {totalsOnly ? (
            <Field label="Max groups" hint="Top-level only. 0 = all.">
              <TextInput
                type="number"
                value={widget.maxGroups ?? 0}
                onChange={(v) => set({ maxGroups: Number(v) || 0 })}
              />
            </Field>
          ) : (
            <Field label="Max cols">
              <TextInput type="number" value={widget.maxCols ?? 12} onChange={(v) => set({ maxCols: Number(v) || 12 })} />
            </Field>
          )}
        </div>
      </div>

      {totalsOnly && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-2">
          <Field label="Sort each level by" className="w-52" hint="Applied at every depth, not just the leaves.">
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
          <Field label="Heading for the value column" className="w-48">
            <TextInput value={widget.valueLabel || ''} onChange={(v) => set({ valueLabel: v })} placeholder="Total" />
          </Field>
          <div className="flex flex-col gap-1 pb-1.5">
            <Toggle
              checked={widget.showBars !== false}
              onChange={(v) => set({ showBars: v })}
              label="Proportional bar behind each number"
            />
            <Toggle
              checked={!!widget.showGroupTotals}
              onChange={(v) => set({ showGroupTotals: v })}
              label="Group subtotal under each merged cell"
            />
          </div>
        </div>
      )}

      </>
      )}

      {part === 'axes' && (
      <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <AxisColumns
          label="Rows (down the side)"
          hint="Several columns cross into one row each — “West › Ravi”."
          chosen={rowColumns}
          cols={cols}
          onChange={(next) => set({ rowColumns: next, rowColumn: next[0] || '' })}
        />
        {!totalsOnly && (
          <AxisColumns
            label="Columns (across the top)"
            hint="Leave empty, or switch to “Totals only”, for a ranked list."
            chosen={colColumns}
            cols={cols}
            onChange={(next) => set({ colColumns: next, colColumn: next[0] || '' })}
          />
        )}
      </div>

      <PivotBuckets columns={[...rowColumns, ...colColumns]} widget={widget} set={set} />
      </>
      )}
    </div>
  )
}

/**
 * Several value columns down one grouped list.
 *
 * A grouped pivot -- Region › DSE, and a number -- invites a question the
 * single number cannot answer: not "the same number again" but "how many,
 * worth how much, over how many days". Three DIFFERENT measurements of the
 * same groups, side by side.
 *
 * Only offered where there is no column axis. A matrix already spends its
 * width on the columns, and a second number in every cell of one is not a
 * table anybody can read.
 *
 * The list starts EMPTY, and empty means the single aggregation the widget
 * already had -- so a pivot nobody has touched renders exactly as it did,
 * through the same code path, with a list of one.
 */
function MeasuresEditor({ widget, cols, set }) {
  const measures = widget.measures || []
  const ops = listOps(measures, (next) => set({ measures: next }))

  // A matrix already spends its width on the column axis, and a second
  // number in every cell of one is not a table anybody can read. Saying so
  // -- and offering the switch -- beats hiding the button and leaving an
  // admin to work out why the feature they read about is not there.
  if (widget.display !== 'totals') {
    return (
      <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
        <p className="text-[11px] text-slate-500">
          Several value columns need the <strong>grouped list</strong>: a matrix already spends its width on the
          columns across the top, and a second number in every cell of one is not a table anybody can read.
        </p>
        <Btn className="mt-1.5" onClick={() => set({ display: 'totals' })}>
          Switch to the grouped list
        </Btn>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-slate-500">
          Value columns <span className="font-normal text-slate-400">(one per number you want beside the groups)</span>
        </p>
        <Btn onClick={() => ops.add(emptyMeasure(widget, measures.length))}>
          <Plus size={11} /> Add value column
        </Btn>
      </div>

      {measures.length === 0 && (
        <p className="py-1 text-[10px] text-slate-400">
          None — the list shows the one calculation set under <strong>Layout</strong>. Add columns here when the
          question is “how many, worth how much, over how many days” rather than one number three times.
        </p>
      )}

      <div className="space-y-1.5">
        {measures.map((measure, i) => {
          const setM = (patch) => ops.update(measure.id, patch)
          const needsColumn = aggNeedsColumn(measure.aggregation || 'count')
          return (
            <div key={measure.id || i} className="flex flex-wrap items-center gap-1.5">
              <Select
                value={measure.aggregation || 'count'}
                onChange={(v) => setM({ aggregation: v })}
                options={AGGREGATIONS}
                className="w-52"
              />
              <Select
                value={measure.column || ''}
                onChange={(v) => setM({ column: v })}
                options={cols}
                placeholder={needsColumn ? '— pick a column —' : 'not used'}
                disabled={!needsColumn}
                className="w-40"
              />
              <TextInput
                value={measure.label || ''}
                onChange={(v) => setM({ label: v })}
                placeholder={defaultMeasureLabel(measure)}
                className="w-40"
              />
              <Select
                value={measure.format || 'comma'}
                onChange={(v) => setM({ format: v })}
                options={NUMBER_FORMATS}
                className="w-40"
              />
              <div className="ml-auto">
                <RowControls
                  onUp={() => ops.move(i, -1)}
                  onDown={() => ops.move(i, 1)}
                  onDelete={() => ops.remove(measure.id)}
                  isFirst={i === 0}
                  isLast={i === measures.length - 1}
                />
              </div>
            </div>
          )
        })}
      </div>

      {measures.length > 0 && (
        <p className="mt-1 text-[10px] text-slate-400">
          The <strong>first</strong> one orders the rows and is what the bar behind the number is drawn from — a bar
          drawn from one scale under a number from another would be a lie about both. Blank labels take a sensible
          name (“Sum of Amount”). The footer re-works each total out over the rows shown rather than adding the
          column up, because a column of averages does not add up to an average.
        </p>
      )}
    </div>
  )
}

/**
 * A bucket per pivot column, rather than one for the axis.
 *
 * A "Region / Sold" axis wants the region as it is and the date by month --
 * one setting for the pair would force the wrong answer on one of them.
 */
export function PivotBuckets({ columns, widget, set }) {
  const buckets = widget.buckets || {}
  const used = columns.filter(Boolean)
  if (used.length === 0) return null

  const setFor = (column, patch) =>
    set({ buckets: { ...buckets, [column]: { ...(buckets[column] || {}), ...patch } } })

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
      <p className="mb-1 text-[11px] font-medium text-slate-500">
        Bucket a column <span className="font-normal text-slate-400">(optional, per column)</span>
      </p>
      <div className="space-y-1.5">
        {used.map((column) => {
          const spec = buckets[column] || {}
          const needs = bucketNeeds(spec.bucket)
          return (
            <div key={column} className="flex flex-wrap items-center gap-1.5">
              <span className="w-32 shrink-0 truncate text-[11px] text-slate-600">{column}</span>
              <Select
                value={spec.bucket || ''}
                onChange={(v) => setFor(column, { bucket: v })}
                options={DATE_BUCKETS}
                className="w-56"
              />
              {needs === 'size' && (
                <TextInput
                  type="number"
                  value={spec.bucketSize ?? ''}
                  onChange={(v) => setFor(column, { bucketSize: Number(v) || null })}
                  placeholder={spec.bucket === 'prefix' ? 'chars' : 'band'}
                  className="w-20"
                />
              )}
              {needs === 'breaks' && (
                <TextInput
                  value={spec.bucketBreaks ?? ''}
                  onChange={(v) => setFor(column, { bucketBreaks: v })}
                  placeholder="0, 100, 250"
                  className="w-36"
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function GaugeEditor({ widget, cols, tabs, tabHeaders, set }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Calculation">
          <Select value={widget.aggregation || 'count'} onChange={(v) => set({ aggregation: v })} options={AGGREGATIONS} />
        </Field>
        <Field label="Column">
          <Select
            value={widget.column || ''}
            onChange={(v) => set({ column: v })}
            options={cols}
            placeholder="— column —"
            disabled={!aggNeedsColumn(widget.aggregation || 'count')}
          />
        </Field>
        <Field label={widget.lowerIsBetter ? 'Ceiling' : 'Target'} hint={widget.lowerIsBetter ? 'Value should stay under this' : 'The number this should reach'}>
          <TextInput type="number" value={widget.target} onChange={(v) => set({ target: v })} placeholder="1000" />
        </Field>
        <Field label="Icon">
          <TextInput value={widget.icon} onChange={(v) => set({ icon: v })} placeholder="🎯" />
        </Field>
        <Field label="Colour">
          <input
            type="color"
            value={widget.color || PALETTE[0]}
            onChange={(e) => set({ color: e.target.value })}
            className="h-[30px] w-full rounded-lg border border-slate-200"
          />
        </Field>
        <div className="col-span-2 flex items-end pb-1.5">
          <Toggle
            checked={widget.lowerIsBetter}
            onChange={(v) => set({ lowerIsBetter: v })}
            label="Lower is better (e.g. pending count, avg. days to close)"
          />
        </div>
      </div>

      <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-2">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[11px] font-medium text-indigo-700">Only count rows where — optional</p>
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
      </div>
    </div>
  )
}

// =====================================================================
// Activity Feed editor
// =====================================================================
export function ActivityFeedEditor({ widget, cols, set }) {
  const subtitle = widget.subtitleColumns || []
  const toggleSubtitle = (col) => {
    const next = subtitle.includes(col) ? subtitle.filter((c) => c !== col) : [...subtitle, col]
    set({ subtitleColumns: next })
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Date column" hint="Newest first">
          <Select value={widget.dateColumn || ''} onChange={(v) => set({ dateColumn: v })} options={cols} placeholder="— pick a date column —" />
        </Field>
        <Field label="Title column" hint="Shown as the headline of each entry">
          <Select value={widget.titleColumn || ''} onChange={(v) => set({ titleColumn: v })} options={cols} placeholder="— column —" />
        </Field>
        <Field label="Show last">
          <TextInput type="number" value={widget.limit || 15} onChange={(v) => set({ limit: Number(v) || 15 })} />
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

      <div>
        <p className="mb-1 text-[11px] font-medium text-slate-500">Subtitle columns (shown under the title, optional)</p>
        <div className="grid max-h-32 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-slate-100 p-2 md:grid-cols-3">
          {cols.map((col) => (
            <label key={col} className="flex items-center gap-1.5 text-[11px]">
              <input type="checkbox" checked={subtitle.includes(col)} onChange={() => toggleSubtitle(col)} />
              <span className="truncate">{col}</span>
            </label>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-slate-400">
        By default this feed ignores page filters, so it always shows the latest activity even when something else on
        the dashboard is filtered. Untick "Ignore filters" below to make it follow the page instead.
      </p>
    </div>
  )
}

// =====================================================================
// Scorecard editor
// =====================================================================
export function ScorecardEditor({ widget, tabs, tabHeaders, set }) {
  const cols = tabHeaders?.[widget.tab] || []

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Calculation">
          <Select value={widget.aggregation || 'count'} onChange={(v) => set({ aggregation: v })} options={AGGREGATIONS} />
        </Field>
        <Field label="Value column">
          <Select
            value={widget.column || ''}
            onChange={(v) => set({ column: v })}
            options={cols}
            placeholder="— column —"
            disabled={!aggNeedsColumn(widget.aggregation || 'count')}
          />
        </Field>
        <Field label="Number format">
          <Select value={widget.format || 'comma'} onChange={(v) => set({ format: v })} options={NUMBER_FORMATS} />
        </Field>
        <div className="flex items-end pb-1.5">
          <Toggle checked={widget.lowerIsBetter} onChange={(v) => set({ lowerIsBetter: v })} label="Lower is better" />
        </div>
      </div>

      {['A', 'B'].map((side) => (
        <div key={side} className="rounded-lg border border-slate-200 bg-slate-50/50 p-2">
          <div className="mb-1.5 grid grid-cols-2 gap-2 md:grid-cols-3">
            <Field label={`Side ${side} label`}>
              <TextInput
                value={widget[`label${side}`]}
                onChange={(v) => set({ [`label${side}`]: v })}
                placeholder={side === 'A' ? 'This Month' : 'Last Month'}
              />
            </Field>
            <Field label="Colour">
              <input
                type="color"
                value={widget[`color${side}`] || (side === 'A' ? PALETTE[0] : '#94A3B8')}
                onChange={(e) => set({ [`color${side}`]: e.target.value })}
                className="h-[30px] w-full rounded-lg border border-slate-200"
              />
            </Field>
            <Field label="Match" className="w-28">
              <Select
                value={widget[`match${side}`] || 'all'}
                onChange={(v) => set({ [`match${side}`]: v })}
                options={[
                  { value: 'all', label: 'ALL (AND)' },
                  { value: 'any', label: 'ANY (OR)' },
                ]}
              />
            </Field>
          </div>
          <ConditionBuilder
            conditions={widget[`conditions${side}`] || []}
            match={widget[`match${side}`] || 'all'}
            tabs={[widget.tab]}
            tabHeaders={tabHeaders}
            onChange={(conditions) => set({ [`conditions${side}`]: conditions })}
            compact
          />
        </div>
      ))}
    </div>
  )
}
