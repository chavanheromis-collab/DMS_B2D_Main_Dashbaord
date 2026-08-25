import { AGGREGATIONS, HEAT_SCALES, NUMBER_FORMATS, PALETTE, aggNeedsColumn } from '../../lib/config'
import { SERIES_PALETTES } from '../../lib/seriesData'
import { BucketPicker, PivotBuckets, ScrollEditor, SeriesColorEditor } from './WidgetEditors.jsx'
import { Field, Select, TextInput, Toggle } from './ui.jsx'

const SORTS = [
  { value: 'value_desc', label: 'Value, highest first' },
  { value: 'value_asc', label: 'Value, lowest first' },
  { value: 'name_asc', label: 'Name, A→Z' },
  { value: 'name_desc', label: 'Name, Z→A' },
]

function ColorPicker({ value, onChange, fallback = PALETTE[0] }) {
  return (
    <input
      type="color"
      value={value || fallback}
      onChange={(e) => onChange(e.target.value)}
      className="h-[30px] w-full rounded-lg border border-slate-200"
    />
  )
}

/** Stacked / grouped bars: one column makes the bars, another splits them. */
export function StackedEditor({ widget, cols, set }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Bars for each value of">
          <Select value={widget.groupBy || ''} onChange={(v) => set({ groupBy: v })} options={cols} placeholder="— column —" />
        </Field>
        <Field label="Split each bar by">
          <Select value={widget.stackBy || ''} onChange={(v) => set({ stackBy: v })} options={cols} placeholder="— column —" />
        </Field>
        <BucketPicker widget={widget} set={set} label="Bucket the bars" />
        <BucketPicker widget={widget} set={set} prefix="stack" label="Bucket the segments" />
        <Field label="Calculation">
          <Select value={widget.aggregation || 'count'} onChange={(v) => set({ aggregation: v })} options={AGGREGATIONS} />
        </Field>
        <Field label="Value column">
          <Select
            value={widget.column || ''}
            onChange={(v) => set({ column: v })}
            options={cols}
            placeholder="— pick a column —"
            disabled={!aggNeedsColumn(widget.aggregation || 'count')}
          />
        </Field>
      </div>

      <SeriesColorEditor widget={widget} set={set} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Palette" hint="For anything unassigned.">
          <Select
            value={widget.palette || 'default'}
            onChange={(v) => set({ palette: v })}
            options={SERIES_PALETTES}
          />
        </Field>
        <Field label="Layout">
          <Select
            value={widget.layout || 'stacked'}
            onChange={(v) => set({ layout: v })}
            options={[
              { value: 'stacked', label: 'Stacked (one bar per group)' },
              { value: 'grouped', label: 'Grouped (bars side by side)' },
            ]}
          />
        </Field>
        <Field label="Max bars">
          <TextInput type="number" value={widget.limit ?? 12} onChange={(v) => set({ limit: Number(v) || 12 })} />
        </Field>
        <Field label="Max segments" hint="The rest merge into “Other”.">
          <TextInput type="number" value={widget.maxSeries ?? 8} onChange={(v) => set({ maxSeries: Number(v) || 8 })} />
        </Field>
        <Field label="Sort bars by">
          <Select value={widget.sort || 'value_desc'} onChange={(v) => set({ sort: v })} options={SORTS} />
        </Field>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Height (px)" className="w-32">
          <TextInput type="number" value={widget.height || 280} onChange={(v) => set({ height: Number(v) || 280 })} />
        </Field>
        <div className="pb-1.5">
          <Toggle checked={widget.showLegend !== false} onChange={(v) => set({ showLegend: v })} label="Show legend" />
        </div>
      </div>
      <ScrollEditor widget={widget} set={set} />

    </div>
  )
}

/**
 * Combo chart: two independent measures on their own axes. The editor is
 * deliberately symmetrical -- each series gets the same calculation, column,
 * label and colour -- because the whole point is comparing unlike things.
 */
export function ComboEditor({ widget, cols, set }) {
  return (
    <div className="space-y-2">
      <Field label="Group rows by" className="max-w-xs">
        <Select value={widget.groupBy || ''} onChange={(v) => set({ groupBy: v })} options={cols} placeholder="— column —" />
      </Field>

      <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
        <p className="mb-1.5 text-[11px] font-medium text-slate-500">📊 Bars — left axis</p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
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
          <Field label="Label">
            <TextInput value={widget.barLabel || ''} onChange={(v) => set({ barLabel: v })} placeholder="Orders" />
          </Field>
          <Field label="Format">
            <Select value={widget.format || 'comma'} onChange={(v) => set({ format: v })} options={NUMBER_FORMATS} />
          </Field>
          <Field label="Colour">
            <ColorPicker value={widget.color} onChange={(v) => set({ color: v })} />
          </Field>
        </div>
      </div>

      <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
        <p className="mb-1.5 text-[11px] font-medium text-slate-500">📈 Line — right axis</p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Field label="Calculation">
            <Select
              value={widget.lineAggregation || 'count'}
              onChange={(v) => set({ lineAggregation: v })}
              options={AGGREGATIONS}
            />
          </Field>
          <Field label="Column">
            <Select
              value={widget.lineColumn || ''}
              onChange={(v) => set({ lineColumn: v })}
              options={cols}
              placeholder="— column —"
              disabled={!aggNeedsColumn(widget.lineAggregation || 'count')}
            />
          </Field>
          <Field label="Label">
            <TextInput value={widget.lineLabel || ''} onChange={(v) => set({ lineLabel: v })} placeholder="Avg days" />
          </Field>
          <Field label="Format">
            <Select
              value={widget.lineFormat || 'comma'}
              onChange={(v) => set({ lineFormat: v })}
              options={NUMBER_FORMATS}
            />
          </Field>
          <Field label="Colour">
            <ColorPicker value={widget.lineColor} onChange={(v) => set({ lineColor: v })} fallback={PALETTE[4]} />
          </Field>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Max groups" className="w-28">
          <TextInput type="number" value={widget.limit ?? 12} onChange={(v) => set({ limit: Number(v) || 12 })} />
        </Field>
        <Field label="Sort by" className="w-48">
          <Select value={widget.sort || 'value_desc'} onChange={(v) => set({ sort: v })} options={SORTS} />
        </Field>
        <Field label="Height (px)" className="w-28">
          <TextInput type="number" value={widget.height || 280} onChange={(v) => set({ height: Number(v) || 280 })} />
        </Field>
        <div className="pb-1.5">
          <Toggle checked={widget.showLegend !== false} onChange={(v) => set({ showLegend: v })} label="Show legend" />
        </div>
      </div>
      <p className="text-[10px] text-slate-400">
        Sorting always follows the bars, since they’re what the chart is “about”.
      </p>
      <ScrollEditor widget={widget} set={set} />

    </div>
  )
}

/** Scatter / bubble: individual rows, not aggregates. */
export function ScatterEditor({ widget, cols, set }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="X axis (numeric)">
          <Select value={widget.xColumn || ''} onChange={(v) => set({ xColumn: v })} options={cols} placeholder="— column —" />
        </Field>
        <Field label="Y axis (numeric)">
          <Select value={widget.yColumn || ''} onChange={(v) => set({ yColumn: v })} options={cols} placeholder="— column —" />
        </Field>
        <Field label="Bubble size" hint="Optional — leave blank for equal dots.">
          <Select
            value={widget.sizeColumn || ''}
            onChange={(v) => set({ sizeColumn: v })}
            options={cols}
            placeholder="— none —"
          />
        </Field>
        <Field label="Colour by" hint="Optional — one colour per value.">
          <Select value={widget.groupBy || ''} onChange={(v) => set({ groupBy: v })} options={cols} placeholder="— none —" />
        </Field>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Max points" className="w-32" hint="Plotted in sheet order.">
          <TextInput type="number" value={widget.limit ?? 400} onChange={(v) => set({ limit: Number(v) || 400 })} />
        </Field>
        <Field label="Height (px)" className="w-28">
          <TextInput type="number" value={widget.height || 280} onChange={(v) => set({ height: Number(v) || 280 })} />
        </Field>
        <div className="pb-1.5">
          <Toggle checked={widget.showLegend !== false} onChange={(v) => set({ showLegend: v })} label="Show legend" />
        </div>
      </div>

      <p className="rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500">
        Rows without a number in <strong>both</strong> the X and Y columns are skipped — treating them as zero would
        invent a cluster at the origin that isn’t in your data.
      </p>
    </div>
  )
}

/** Heat map: the pivot's data, shown as colour intensity. */
export function HeatmapEditor({ widget, cols, set }) {
  const scale = HEAT_SCALES.find((s) => s.value === (widget.scale || 'indigo')) || HEAT_SCALES[0]

  return (
    <div className="space-y-2">
      <PivotBuckets columns={[widget.rowColumn, widget.colColumn]} widget={widget} set={set} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Rows">
          <Select value={widget.rowColumn || ''} onChange={(v) => set({ rowColumn: v })} options={cols} placeholder="— column —" />
        </Field>
        <Field label="Columns">
          <Select value={widget.colColumn || ''} onChange={(v) => set({ colColumn: v })} options={cols} placeholder="— column —" />
        </Field>
        <Field label="Calculation">
          <Select value={widget.aggregation || 'count'} onChange={(v) => set({ aggregation: v })} options={AGGREGATIONS} />
        </Field>
        <Field label="Value column">
          <Select
            value={widget.column || ''}
            onChange={(v) => set({ column: v })}
            options={cols}
            placeholder="— pick a column —"
            disabled={!aggNeedsColumn(widget.aggregation || 'count')}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Colour scale">
          <Select value={widget.scale || 'indigo'} onChange={(v) => set({ scale: v })} options={HEAT_SCALES} />
        </Field>
        <Field label="Max rows">
          <TextInput type="number" value={widget.maxRows ?? 15} onChange={(v) => set({ maxRows: Number(v) || 15 })} />
        </Field>
        <Field label="Max columns">
          <TextInput type="number" value={widget.maxCols ?? 12} onChange={(v) => set({ maxCols: Number(v) || 12 })} />
        </Field>
        <Field label="Number format">
          <Select value={widget.format || 'comma'} onChange={(v) => set({ format: v })} options={NUMBER_FORMATS} />
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-400">Scale</span>
        <div
          className="h-3 flex-1 rounded-full"
          style={{ background: `linear-gradient(90deg, ${scale.from}, ${scale.to})` }}
        />
        <span className="text-[10px] text-slate-400">low → high</span>
      </div>
      <p className="text-[10px] text-slate-400">
        Click any cell to filter the dashboard to that row × column combination. Empty cells stay uncoloured, so
        “nothing here” never looks like “a little here”.
      </p>
    </div>
  )
}
