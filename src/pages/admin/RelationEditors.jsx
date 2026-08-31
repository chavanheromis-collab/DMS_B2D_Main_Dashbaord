import { AGGREGATIONS, NUMBER_FORMATS, PALETTE, aggNeedsColumn } from '../../lib/config'
import { SERIES_PALETTES } from '../../lib/seriesData'
import { SPAN_SORTS } from '../../lib/spanData'
import { MAX_RINGS } from '../../lib/sunburstData'
import { SortFields, ValueColorEditor } from './WidgetEditors.jsx'
import { Field, Select, TextInput, Toggle } from './ui.jsx'

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

/**
 * Two measures per category, and the gap between them.
 *
 * The two are asked for as a matched pair -- a measurement and the column
 * it reads -- rather than as four loose boxes, because "count of rows"
 * needs no column and "sum of Amount" needs one, and a form that lets you
 * pick a column for a count is a form that has to explain itself.
 */
export function DumbbellEditor({ widget, cols, set }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="One row per">
          <Select value={widget.groupBy || ''} onChange={(v) => set({ groupBy: v })} options={cols} placeholder="— column —" />
        </Field>
        <Field label="Max rows" hint="0 shows every one; the list scrolls.">
          <TextInput type="number" value={widget.limit ?? 12} onChange={(v) => set({ limit: Math.max(0, Number(v) || 0) })} />
        </Field>
        <Field label="Order by" className="md:col-span-2" hint="The widest gap is what the chart is for.">
          <Select value={widget.spanSort || 'gap_desc'} onChange={(v) => set({ spanSort: v })} options={SPAN_SORTS} />
        </Field>
      </div>

      {/* --- the two ends -------------------------------------------- */}
      {[
        {
          key: 'from',
          title: 'First value — where the line starts',
          agg: widget.aggregation || 'count',
          setAgg: (v) => set({ aggregation: v }),
          col: widget.column,
          setCol: (v) => set({ column: v }),
          label: widget.fromLabel,
          setLabel: (v) => set({ fromLabel: v }),
          color: widget.color,
          setColor: (v) => set({ color: v }),
          fallback: PALETTE[0],
        },
        {
          key: 'to',
          title: 'Second value — where it ends',
          agg: widget.secondaryAggregation || 'count',
          setAgg: (v) => set({ secondaryAggregation: v }),
          col: widget.secondaryColumn,
          setCol: (v) => set({ secondaryColumn: v }),
          label: widget.toLabel,
          setLabel: (v) => set({ toLabel: v }),
          color: widget.lineColor,
          setColor: (v) => set({ lineColor: v }),
          fallback: PALETTE[4],
        },
      ].map((end) => (
        <div key={end.key} className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
          <p className="mb-1.5 text-[11px] font-medium text-slate-500">{end.title}</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Field label="Measure" className="md:col-span-2">
              <Select value={end.agg} onChange={end.setAgg} options={AGGREGATIONS} />
            </Field>
            <Field label="Of column">
              <Select
                value={end.col || ''}
                onChange={end.setCol}
                options={cols}
                placeholder="— column —"
                disabled={!aggNeedsColumn(end.agg)}
              />
            </Field>
            <Field label="Called" hint="Shown in the legend.">
              <TextInput value={end.label || ''} onChange={end.setLabel} placeholder={end.key === 'from' ? 'First' : 'Second'} />
            </Field>
          </div>
          <div className="mt-1.5 w-24">
            <Field label="Dot colour">
              <ColorPicker value={end.color} onChange={end.setColor} fallback={end.fallback} />
            </Field>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Number format" className="w-44">
          <Select value={widget.format || 'comma'} onChange={(v) => set({ format: v })} options={NUMBER_FORMATS} />
        </Field>
      </div>

      <p className="text-[10px] text-slate-400">
        The axis spans both ends of every row and is <strong>not</strong> anchored at zero — the chart is about the
        distance between two numbers, and forcing zero in squashes every gap into the same short line.
      </p>
    </div>
  )
}

/**
 * A hierarchy as rings.
 *
 * The levels are asked for in order, and a blank one ends the list: three
 * dropdowns where the second is empty and the third is full would be a
 * hierarchy with a hole in it, which is not a thing.
 */
export function SunburstEditor({ widget, cols, set }) {
  const levels = [widget.groupBy, widget.groupBy2, widget.groupBy3, widget.groupBy4]
  const depth = levels.filter(Boolean).length

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {['groupBy', 'groupBy2', 'groupBy3', 'groupBy4'].slice(0, MAX_RINGS).map((key, i) => (
          <Field
            key={key}
            label={i === 0 ? 'Inner ring' : `Ring ${i + 1}`}
            hint={i === 0 ? 'The widest level.' : undefined}
          >
            <Select
              value={widget[key] || ''}
              // Clearing a ring clears everything outside it: a hierarchy
              // with a hole in the middle is not a hierarchy.
              onChange={(v) =>
                set(
                  v
                    ? { [key]: v }
                    : Object.fromEntries(
                        ['groupBy', 'groupBy2', 'groupBy3', 'groupBy4'].slice(i).map((k) => [k, ''])
                      )
                )
              }
              options={cols}
              placeholder="— none —"
              // Only offered once the ring inside it has a column: picking
              // ring three before ring two is choosing a level that cannot
              // be drawn.
              disabled={i > 0 && !levels[i - 1]}
            />
          </Field>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Measure" className="md:col-span-2">
          <Select value={widget.aggregation || 'count'} onChange={(v) => set({ aggregation: v })} options={AGGREGATIONS} />
        </Field>
        <Field label="Of column">
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
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <SortFields widget={widget} cols={cols} set={set} className="w-48" label="Order each ring by" />
        <Field label="Palette" className="w-44" hint="One colour per inner-ring value; outer rings shade from it.">
          <Select value={widget.palette || 'default'} onChange={(v) => set({ palette: v })} options={SERIES_PALETTES} />
        </Field>
        <div className="pb-1.5">
          <Toggle
            checked={widget.showLabels !== false}
            onChange={(v) => set({ showLabels: v })}
            label="Write names on the wedges"
          />
        </div>
      </div>

      <ValueColorEditor widget={widget} set={set} />

      <p className="text-[10px] text-slate-400">
        {depth === 0
          ? 'Pick an inner ring to start.'
          : `${depth} ring${depth > 1 ? 's' : ''}. A wedge is always exactly as wide as its children add up to, and one
             too thin to see is left out and counted underneath rather than drawn as a hairline.`}
      </p>
    </div>
  )
}
