import { Plus, ChevronDown, ChevronUp, X, GripVertical } from 'lucide-react'
import { useState } from 'react'
import {
  AGGREGATIONS,
  KPI_PALETTE,
  NUMBER_FORMATS,
  PALETTE,
  STAGE_PALETTE,
  TABLE_CONTROL_KINDS,
  TIME_GRAINS,
  aggNeedsColumn,
  uid,
} from '../../lib/config'
import { looksLikeDateColumn } from '../../lib/dataUtils'
import { Btn, Field, RowControls, Select, TextInput, Toggle, listOps } from './ui.jsx'
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
  return (
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
        <Select value={widget.grain || 'month'} onChange={(v) => set({ grain: v })} options={TIME_GRAINS} />
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
      <Field label="Style">
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
      <Field label="Colour">
        <input
          type="color"
          value={widget.color || PALETTE[0]}
          onChange={(e) => set({ color: e.target.value })}
          className="h-[30px] w-full rounded-lg border border-slate-200"
        />
      </Field>
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

  return (
    <div className="space-y-2">
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
