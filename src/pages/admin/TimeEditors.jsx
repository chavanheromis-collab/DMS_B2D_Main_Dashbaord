import { AGGREGATIONS, HEAT_SCALES, NUMBER_FORMATS, PALETTE, aggNeedsColumn } from '../../lib/config'
import { SERIES_PALETTES } from '../../lib/seriesData'
import { CALENDAR_LAYOUTS, CALENDAR_SPANS, WEEK_STARTS } from '../../lib/calendarHeat'
import { GANTT_ENDS, GANTT_SORTS } from '../../lib/ganttData'
import { COHORT_GRAINS, COHORT_METRICS } from '../../lib/cohortData'
import { legendSwatches } from '../../lib/heatColor'
import { looksLikeDateColumn } from '../../lib/dataUtils'
import { Field, Select, TextInput, Toggle } from './ui.jsx'
import { ValueColorEditor } from './WidgetEditors.jsx'

// =====================================================================
// Editors for the three time widgets
// =====================================================================

function ColorInput({ value, onChange, fallback = PALETTE[0] }) {
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
 * A ramp picker that shows the ramp.
 *
 * Eighteen colour scales in a dropdown of NAMES is eighteen guesses --
 * "Magma" and "Sunset" mean nothing until you have seen both. The swatches
 * underneath are the actual colours the cells will take, so the choice is
 * made by looking rather than by trying each one and saving.
 */
function ScalePicker({ value, onChange, steps = 5, label = 'Colour scale' }) {
  const swatches = legendSwatches(steps, value)
  return (
    <Field label={label}>
      <Select value={value || 'indigo'} onChange={onChange} options={HEAT_SCALES} />
      <span className="mt-1 flex gap-[2px]">
        {swatches.map((color, i) => (
          <span key={i} className="h-3 flex-1 rounded-[2px]" style={{ backgroundColor: color }} />
        ))}
      </span>
    </Field>
  )
}

// =====================================================================
// Calendar heat map
// =====================================================================
export function CalendarEditor({ widget, cols, set }) {
  const dateCols = cols.filter(looksLikeDateColumn)
  const steps = Number(widget.steps) || 5

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Date column" hint="One cell per day of this column.">
          <Select
            value={widget.dateColumn || ''}
            onChange={(v) => set({ dateColumn: v })}
            options={dateCols.length ? dateCols : cols}
            placeholder="— pick a date column —"
          />
        </Field>
        <Field label="Each day shows">
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
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Layout">
          <Select value={widget.layout || 'strip'} onChange={(v) => set({ layout: v })} options={CALENDAR_LAYOUTS} />
        </Field>
        <Field label="How far back">
          <Select value={widget.span || '365'} onChange={(v) => set({ span: v })} options={CALENDAR_SPANS} />
        </Field>
        <Field label="Weeks start on">
          <Select value={widget.weekStart || 'mon'} onChange={(v) => set({ weekStart: v })} options={WEEK_STARTS} />
        </Field>
        <Field label="Cell size (px)">
          <TextInput type="number" value={widget.cellSize ?? 13} onChange={(v) => set({ cellSize: Number(v) || 13 })} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <ScalePicker value={widget.scale} onChange={(v) => set({ scale: v })} steps={steps} />
        <Field label="Shades" hint="Steps you can count beat a smooth ramp you cannot read.">
          <Select
            value={String(steps)}
            onChange={(v) => set({ steps: Number(v) })}
            options={[3, 4, 5, 6, 7, 9].map((n) => ({ value: String(n), label: `${n} shades` }))}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-3">
        <Toggle
          checked={widget.showMonthLabels !== false}
          onChange={(v) => set({ showMonthLabels: v })}
          label="Month labels"
        />
        <Toggle checked={widget.showDayLabels !== false} onChange={(v) => set({ showDayLabels: v })} label="Weekday labels" />
        <Toggle checked={widget.showLegend !== false} onChange={(v) => set({ showLegend: v })} label="Key and summary" />
      </div>
    </div>
  )
}

// =====================================================================
// Timeline / Gantt
// =====================================================================
export function GanttEditor({ widget, cols, set }) {
  const dateCols = cols.filter(looksLikeDateColumn)
  const endMode = widget.endMode || 'column'

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Starts on">
          <Select
            value={widget.startColumn || ''}
            onChange={(v) => set({ startColumn: v })}
            options={dateCols.length ? dateCols : cols}
            placeholder="— pick a date column —"
          />
        </Field>
        <Field label="Ends by">
          <Select value={endMode} onChange={(v) => set({ endMode: v })} options={GANTT_ENDS} />
        </Field>
        {endMode === 'column' && (
          <Field label="End column" hint="Blank cells become bars that run to today, marked still open.">
            <Select
              value={widget.endColumn || ''}
              onChange={(v) => set({ endColumn: v })}
              options={dateCols.length ? dateCols : cols}
              placeholder="— none: everything is open —"
            />
          </Field>
        )}
        {endMode === 'duration' && (
          <Field label="Days column">
            <Select
              value={widget.durationColumn || ''}
              onChange={(v) => set({ durationColumn: v })}
              options={cols}
              placeholder="— column —"
            />
          </Field>
        )}
        {endMode === 'fixed' && (
          <Field label="Days per bar">
            <TextInput type="number" value={widget.fixedDays ?? 7} onChange={(v) => set({ fixedDays: Number(v) || 7 })} />
          </Field>
        )}
        <Field label="Label each bar with">
          <Select value={widget.labelColumn || ''} onChange={(v) => set({ labelColumn: v })} options={cols} placeholder="— row number —" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Group into lanes by">
          <Select value={widget.groupBy || ''} onChange={(v) => set({ groupBy: v })} options={cols} placeholder="— no lanes —" />
        </Field>
        <Field label="Lanes">
          <Select
            value={widget.laneMode || 'flat'}
            onChange={(v) => set({ laneMode: v })}
            options={[
              { value: 'flat', label: 'One flat list' },
              { value: 'lanes', label: 'Stacked under headings' },
            ]}
            disabled={!widget.groupBy}
          />
        </Field>
        <Field label="Colour bars by" hint="Leave blank for one colour.">
          <Select value={widget.colorColumn || ''} onChange={(v) => set({ colorColumn: v })} options={cols} placeholder="— one colour —" />
        </Field>
        {widget.colorColumn ? (
          <Field label="Palette">
            <Select value={widget.palette || 'default'} onChange={(v) => set({ palette: v })} options={SERIES_PALETTES} />
          </Field>
        ) : (
          <Field label="Bar colour">
            <ColorInput value={widget.color} onChange={(v) => set({ color: v })} />
          </Field>
        )}
      </div>

      {widget.colorColumn && <ValueColorEditor widget={widget} set={set} />}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Sort by">
          <Select value={widget.sort || 'start_asc'} onChange={(v) => set({ sort: v })} options={GANTT_SORTS} />
        </Field>
        <Field label="Most bars" hint="The axis covers only the bars actually drawn.">
          <TextInput type="number" value={widget.limit ?? 40} onChange={(v) => set({ limit: Number(v) || 40 })} />
        </Field>
        <Field label="Bar height (px)">
          <TextInput type="number" value={widget.barHeight ?? 22} onChange={(v) => set({ barHeight: Number(v) || 22 })} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-3">
        <Toggle checked={widget.showToday !== false} onChange={(v) => set({ showToday: v })} label="Mark today" />
        <Toggle checked={widget.showGrid !== false} onChange={(v) => set({ showGrid: v })} label="Grid lines" />
      </div>
    </div>
  )
}

// =====================================================================
// Cohort / retention
// =====================================================================
export function CohortEditor({ widget, cols, set }) {
  const dateCols = cols.filter(looksLikeDateColumn)
  const metric = widget.metric || 'retention'

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field
          label="Who repeats"
          hint="A customer, a phone number, a chassis — whatever can appear more than once."
        >
          <Select
            value={widget.entityColumn || ''}
            onChange={(v) => set({ entityColumn: v })}
            options={cols}
            placeholder="— pick a column —"
          />
        </Field>
        <Field label="When it happened" hint="The earliest one decides which cohort they belong to.">
          <Select
            value={widget.dateColumn || ''}
            onChange={(v) => set({ dateColumn: v })}
            options={dateCols.length ? dateCols : cols}
            placeholder="— pick a date column —"
          />
        </Field>
        <Field label="Cohort size">
          <Select value={widget.grain || 'month'} onChange={(v) => set({ grain: v })} options={COHORT_GRAINS} />
        </Field>
        <Field label="Each cell shows">
          <Select value={metric} onChange={(v) => set({ metric: v })} options={COHORT_METRICS} />
        </Field>
      </div>

      {metric === 'value' && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Field label="Calculation">
            <Select
              value={widget.aggregation || 'sum'}
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
              disabled={!aggNeedsColumn(widget.aggregation || 'sum')}
            />
          </Field>
          <Field label="Number format">
            <Select value={widget.format || 'comma'} onChange={(v) => set({ format: v })} options={NUMBER_FORMATS} />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Periods across">
          <TextInput type="number" value={widget.periods ?? 8} onChange={(v) => set({ periods: Number(v) || 8 })} />
        </Field>
        <Field label="Cohorts down">
          <TextInput type="number" value={widget.maxCohorts ?? 12} onChange={(v) => set({ maxCohorts: Number(v) || 12 })} />
        </Field>
        <ScalePicker value={widget.scale} onChange={(v) => set({ scale: v })} />
      </div>

      <div className="flex flex-wrap gap-3">
        <Toggle checked={widget.showSize !== false} onChange={(v) => set({ showSize: v })} label="Show each cohort’s size" />
        <Toggle
          checked={widget.hideFirstPeriod}
          onChange={(v) => set({ hideFirstPeriod: v })}
          label="Hide the first period (it is always 100%)"
        />
      </div>

      <p className="rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500">
        Cells past the diagonal are left blank on purpose — a cohort from last month has not had six months to come
        back, and a 0% there would report a collapse that has not happened.
      </p>
    </div>
  )
}
