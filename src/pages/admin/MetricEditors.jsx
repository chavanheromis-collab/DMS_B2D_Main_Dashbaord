import { Plus } from 'lucide-react'
import { AGGREGATIONS, NUMBER_FORMATS, PALETTE, aggNeedsColumn, uid } from '../../lib/config'
import { SERIES_PALETTES } from '../../lib/seriesData'
import { COMPARE_MODES, DEFAULT_STAT, STAT_LAYOUTS } from '../../lib/statGrid'
import { BAND_MODES, DEFAULT_BULLET_ROW } from '../../lib/bullet'
import { MOVER_PERIODS, MOVER_RANKS } from '../../lib/movers'
import { WAFFLE_SHAPES } from '../../lib/waffleData'
import { looksLikeDateColumn } from '../../lib/dataUtils'
import { Btn, Field, RowControls, Select, TextInput, Toggle, listOps } from './ui.jsx'
import ConditionBuilder from './ConditionBuilder.jsx'
import { ValueColorEditor } from './WidgetEditors.jsx'

// =====================================================================
// Editors for the four metric widgets
// =====================================================================
// Each follows the same shape as the editors already here: the settings
// that decide WHAT is measured at the top, the ones that decide how it
// LOOKS underneath, and anything optional in a tinted panel of its own so
// a long form still reads as a short one.

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

const MATCH_OPTIONS = [
  { value: 'all', label: 'ALL (AND)' },
  { value: 'any', label: 'ANY (OR)' },
]

/**
 * "Only count rows where…", in the tinted panel every other editor uses
 * for the same thing.
 *
 * Extracted rather than repeated four times: the panel is the visual cue
 * that a set of conditions is OPTIONAL, and four hand-rolled copies of it
 * would be four slightly different shades of the same promise.
 */
function ConditionPanel({ title, conditions, match, tab, tabHeaders, onConditions, onMatch, tone = 'indigo' }) {
  const colors = {
    indigo: 'border-indigo-100 bg-indigo-50/40 text-indigo-700',
    emerald: 'border-emerald-100 bg-emerald-50/40 text-emerald-700',
    slate: 'border-slate-200 bg-slate-50/60 text-slate-600',
  }
  return (
    <div className={`rounded-lg border p-2 ${colors[tone] || colors.indigo}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium">{title}</p>
        <Select value={match || 'all'} onChange={onMatch} options={MATCH_OPTIONS} className="w-28" />
      </div>
      <ConditionBuilder
        conditions={conditions || []}
        match={match || 'all'}
        tabs={[tab]}
        tabHeaders={tabHeaders}
        onChange={onConditions}
        compact
      />
    </div>
  )
}

// =====================================================================
// Stat Grid
// =====================================================================
export function StatGridEditor({ widget, cols, tabHeaders, set }) {
  const stats = widget.stats || []
  const ops = listOps(stats, (next) => set({ stats: next }))
  const dateCols = cols.filter(looksLikeDateColumn)

  // "Previous period" and the sparkline both need a date column, and
  // saying so once at the top is kinder than disabling a control further
  // down with no explanation of why.
  const needsDate = widget.showSparkline !== false || stats.some((s) => s.compare === 'previous')

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Columns across">
          <Select
            value={String(widget.columns || 3)}
            onChange={(v) => set({ columns: Number(v) })}
            options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n} across` }))}
          />
        </Field>
        <Field label="Look">
          <Select value={widget.layout || 'tiles'} onChange={(v) => set({ layout: v })} options={STAT_LAYOUTS} />
        </Field>
        <Field
          label="Date column"
          hint={needsDate ? 'Needed for sparklines and “previous period”.' : 'Only used by sparklines.'}
        >
          <Select
            value={widget.dateColumn || ''}
            onChange={(v) => set({ dateColumn: v })}
            options={dateCols.length ? dateCols : cols}
            placeholder="— none —"
          />
        </Field>
        <Field label="Period length (days)" hint="What “previous period” compares against.">
          <TextInput
            type="number"
            value={widget.periodDays ?? 30}
            onChange={(v) => set({ periodDays: Number(v) || 30 })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Toggle
          checked={widget.showSparkline !== false}
          onChange={(v) => set({ showSparkline: v })}
          label="Show a sparkline under each stat"
        />
        <Field label="Sparkline days" className="w-28">
          <TextInput
            type="number"
            value={widget.sparkDays ?? 30}
            onChange={(v) => set({ sparkDays: Number(v) || 30 })}
          />
        </Field>
      </div>

      <div className="space-y-2">
        {stats.map((stat, i) => (
          <div key={stat.id} className="rounded-lg border border-slate-200 bg-white p-2">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <TextInput
                value={stat.label}
                onChange={(v) => ops.update(stat.id, { label: v })}
                placeholder="Enquiries"
                className="w-36"
              />
              <TextInput
                value={stat.icon}
                onChange={(v) => ops.update(stat.id, { icon: v })}
                placeholder="📈"
                className="w-16"
              />
              <div className="w-12">
                <ColorInput value={stat.color} onChange={(v) => ops.update(stat.id, { color: v })} />
              </div>
              <Select
                value={stat.aggregation || 'count'}
                onChange={(v) => ops.update(stat.id, { aggregation: v })}
                options={AGGREGATIONS}
                className="w-52"
              />
              <Select
                value={stat.column || ''}
                onChange={(v) => ops.update(stat.id, { column: v })}
                options={cols}
                placeholder="— column —"
                disabled={!aggNeedsColumn(stat.aggregation || 'count')}
                className="w-44"
              />
              <Select
                value={stat.format || 'comma'}
                onChange={(v) => ops.update(stat.id, { format: v })}
                options={NUMBER_FORMATS}
                className="w-44"
              />
              <RowControls
                onUp={() => ops.move(i, -1)}
                onDown={() => ops.move(i, 1)}
                onDelete={() => ops.remove(stat.id)}
                isFirst={i === 0}
                isLast={i === stats.length - 1}
              />
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <Field label="Compared to" className="w-72">
                <Select
                  value={stat.compare || 'none'}
                  onChange={(v) => ops.update(stat.id, { compare: v })}
                  options={COMPARE_MODES}
                />
              </Field>
              {stat.compare === 'target' && (
                <Field label="Target" className="w-28">
                  <TextInput
                    type="number"
                    value={stat.target ?? 100}
                    onChange={(v) => ops.update(stat.id, { target: Number(v) })}
                  />
                </Field>
              )}
              <div className="pb-1.5">
                <Toggle
                  checked={stat.lowerIsBetter}
                  onChange={(v) => ops.update(stat.id, { lowerIsBetter: v })}
                  label="Lower is better"
                />
              </div>
            </div>

            {stat.compare === 'previous' && !widget.dateColumn && (
              <p className="mt-1 text-[10px] text-amber-600">
                Pick a date column above, or this stat has nothing to compare against.
              </p>
            )}

            <div className="mt-1.5 space-y-1.5">
              <ConditionPanel
                title="Only count rows where — optional"
                conditions={stat.conditions}
                match={stat.match}
                tab={widget.tab}
                tabHeaders={tabHeaders}
                onConditions={(conditions) => ops.update(stat.id, { conditions })}
                onMatch={(v) => ops.update(stat.id, { match: v })}
              />
              {stat.compare === 'conditions' && (
                <ConditionPanel
                  tone="emerald"
                  title="Compare against rows where"
                  conditions={stat.compareConditions}
                  match={stat.compareMatch}
                  tab={widget.tab}
                  tabHeaders={tabHeaders}
                  onConditions={(compareConditions) => ops.update(stat.id, { compareConditions })}
                  onMatch={(v) => ops.update(stat.id, { compareMatch: v })}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      <Btn
        onClick={() =>
          ops.add({
            ...DEFAULT_STAT,
            id: uid('st'),
            label: `Stat ${stats.length + 1}`,
            color: PALETTE[stats.length % PALETTE.length],
          })
        }
      >
        <Plus size={12} /> Add stat
      </Btn>
    </div>
  )
}

// =====================================================================
// Bullet chart
// =====================================================================
export function BulletEditor({ widget, cols, tabHeaders, set }) {
  const lines = widget.rows || []
  const ops = listOps(lines, (next) => set({ rows: next }))
  const bandColors = widget.bandColors || ['#FEE2E2', '#FEF3C7', '#DCFCE7']
  const percentBands = (widget.bandMode || 'percent') === 'percent'

  const setBand = (index, color) => {
    const next = [...bandColors]
    next[index] = color
    set({ bandColors: next })
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Bands are">
          <Select value={widget.bandMode || 'percent'} onChange={(v) => set({ bandMode: v })} options={BAND_MODES} />
        </Field>
        <Field label={percentBands ? 'Poor below (%)' : 'Poor below'} hint="Everything under this is poor.">
          <TextInput type="number" value={widget.poorAt ?? 60} onChange={(v) => set({ poorAt: Number(v) })} />
        </Field>
        <Field label={percentBands ? 'Good above (%)' : 'Good above'} hint="Everything over this is good.">
          <TextInput type="number" value={widget.goodAt ?? 90} onChange={(v) => set({ goodAt: Number(v) })} />
        </Field>
        <Field label="Headroom (%)" hint="How far past the target the axis runs, so an overshoot shows.">
          <TextInput type="number" value={widget.headroom ?? 15} onChange={(v) => set({ headroom: Number(v) })} />
        </Field>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {['Poor', 'Fair', 'Good'].map((label, i) => (
          <Field key={label} label={`${label} band`} className="w-20">
            <ColorInput value={bandColors[i]} onChange={(v) => setBand(i, v)} />
          </Field>
        ))}
        <Field label="Bar height (px)" className="w-28">
          <TextInput type="number" value={widget.barHeight ?? 18} onChange={(v) => set({ barHeight: Number(v) || 18 })} />
        </Field>
      </div>

      <div className="space-y-2">
        {lines.map((line, i) => (
          <div key={line.id} className="rounded-lg border border-slate-200 bg-white p-2">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <TextInput
                value={line.label}
                onChange={(v) => ops.update(line.id, { label: v })}
                placeholder="Bookings"
                className="w-36"
              />
              <div className="w-12">
                <ColorInput value={line.color} onChange={(v) => ops.update(line.id, { color: v })} />
              </div>
              <Select
                value={line.aggregation || 'count'}
                onChange={(v) => ops.update(line.id, { aggregation: v })}
                options={AGGREGATIONS}
                className="w-52"
              />
              <Select
                value={line.column || ''}
                onChange={(v) => ops.update(line.id, { column: v })}
                options={cols}
                placeholder="— column —"
                disabled={!aggNeedsColumn(line.aggregation || 'count')}
                className="w-44"
              />
              <Select
                value={line.format || 'comma'}
                onChange={(v) => ops.update(line.id, { format: v })}
                options={NUMBER_FORMATS}
                className="w-44"
              />
              <RowControls
                onUp={() => ops.move(i, -1)}
                onDown={() => ops.move(i, 1)}
                onDelete={() => ops.remove(line.id)}
                isFirst={i === 0}
                isLast={i === lines.length - 1}
              />
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <Field label="The target is" className="w-56">
                <Select
                  value={line.targetMode || 'fixed'}
                  onChange={(v) => ops.update(line.id, { targetMode: v })}
                  options={[
                    { value: 'fixed', label: 'A number I type' },
                    { value: 'measured', label: 'Measured from the rows' },
                  ]}
                />
              </Field>
              {(line.targetMode || 'fixed') === 'fixed' ? (
                <Field label="Target" className="w-28">
                  <TextInput
                    type="number"
                    value={line.target ?? 100}
                    onChange={(v) => ops.update(line.id, { target: Number(v) })}
                  />
                </Field>
              ) : (
                <>
                  <Field label="Target calculation" className="w-52">
                    <Select
                      value={line.targetAggregation || 'count'}
                      onChange={(v) => ops.update(line.id, { targetAggregation: v })}
                      options={AGGREGATIONS}
                    />
                  </Field>
                  <Field label="Target column" className="w-44">
                    <Select
                      value={line.targetColumn || ''}
                      onChange={(v) => ops.update(line.id, { targetColumn: v })}
                      options={cols}
                      placeholder="— column —"
                      disabled={!aggNeedsColumn(line.targetAggregation || 'count')}
                    />
                  </Field>
                </>
              )}
              <div className="pb-1.5">
                <Toggle
                  checked={line.lowerIsBetter}
                  onChange={(v) => ops.update(line.id, { lowerIsBetter: v })}
                  label="Lower is better"
                />
              </div>
            </div>

            <div className="mt-1.5 space-y-1.5">
              <ConditionPanel
                title="Only measure rows where — optional"
                conditions={line.conditions}
                match={line.match}
                tab={widget.tab}
                tabHeaders={tabHeaders}
                onConditions={(conditions) => ops.update(line.id, { conditions })}
                onMatch={(v) => ops.update(line.id, { match: v })}
              />
              {line.targetMode === 'measured' && (
                <ConditionPanel
                  tone="emerald"
                  title="The target is measured over rows where"
                  conditions={line.targetConditions}
                  match={line.targetMatch}
                  tab={widget.tab}
                  tabHeaders={tabHeaders}
                  onConditions={(targetConditions) => ops.update(line.id, { targetConditions })}
                  onMatch={(v) => ops.update(line.id, { targetMatch: v })}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      <Btn
        onClick={() =>
          ops.add({
            ...DEFAULT_BULLET_ROW,
            id: uid('bl'),
            label: `Metric ${lines.length + 1}`,
            color: PALETTE[lines.length % PALETTE.length],
          })
        }
      >
        <Plus size={12} /> Add metric
      </Btn>
    </div>
  )
}

// =====================================================================
// Top movers
// =====================================================================
export function MoversEditor({ widget, cols, tabHeaders, set }) {
  const byDate = (widget.periodMode || 'date') === 'date'
  const dateCols = cols.filter(looksLikeDateColumn)

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Compare each value of">
          <Select value={widget.groupBy || ''} onChange={(v) => set({ groupBy: v })} options={cols} placeholder="— column —" />
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
        <Field label="Number format">
          <Select value={widget.format || 'comma'} onChange={(v) => set({ format: v })} options={NUMBER_FORMATS} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="“Before” means">
          <Select value={widget.periodMode || 'date'} onChange={(v) => set({ periodMode: v })} options={MOVER_PERIODS} />
        </Field>
        {byDate ? (
          <>
            <Field label="Date column">
              <Select
                value={widget.dateColumn || ''}
                onChange={(v) => set({ dateColumn: v })}
                options={dateCols.length ? dateCols : cols}
                placeholder="— pick a date column —"
              />
            </Field>
            <Field label="Window (days)" hint="The last N days against the N before them.">
              <TextInput
                type="number"
                value={widget.periodDays ?? 30}
                onChange={(v) => set({ periodDays: Number(v) || 30 })}
              />
            </Field>
          </>
        ) : null}
        <Field label="Rank by">
          <Select value={widget.rank || 'abs_change'} onChange={(v) => set({ rank: v })} options={MOVER_RANKS} />
        </Field>
      </div>

      {!byDate && (
        <div className="space-y-1.5">
          <ConditionPanel
            title="“Now” is the rows where"
            conditions={widget.conditionsNow}
            match={widget.matchNow}
            tab={widget.tab}
            tabHeaders={tabHeaders}
            onConditions={(conditionsNow) => set({ conditionsNow })}
            onMatch={(v) => set({ matchNow: v })}
          />
          <ConditionPanel
            tone="slate"
            title="“Before” is the rows where"
            conditions={widget.conditionsBefore}
            match={widget.matchBefore}
            tab={widget.tab}
            tabHeaders={tabHeaders}
            onConditions={(conditionsBefore) => set({ conditionsBefore })}
            onMatch={(v) => set({ matchBefore: v })}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="How many each way">
          <TextInput type="number" value={widget.limit ?? 8} onChange={(v) => set({ limit: Number(v) || 8 })} />
        </Field>
        <Field
          label="Ignore anything under"
          hint="Keeps “1 became 3” out of the top of the list."
        >
          <TextInput type="number" value={widget.minimum ?? 0} onChange={(v) => set({ minimum: Number(v) || 0 })} />
        </Field>
        <Field label="Rise colour">
          <ColorInput value={widget.colorUp} onChange={(v) => set({ colorUp: v })} fallback="#059669" />
        </Field>
        <Field label="Fall colour">
          <ColorInput value={widget.colorDown} onChange={(v) => set({ colorDown: v })} fallback="#DC2626" />
        </Field>
      </div>

      <div className="flex flex-wrap gap-3">
        <Toggle
          checked={widget.splitDirections !== false}
          onChange={(v) => set({ splitDirections: v })}
          label="Two columns — risers and fallers"
        />
        <Toggle checked={widget.showNew !== false} onChange={(v) => set({ showNew: v })} label="Include values that are new" />
        <Toggle
          checked={widget.showGone !== false}
          onChange={(v) => set({ showGone: v })}
          label="Include values that disappeared"
        />
        <Toggle
          checked={widget.lowerIsBetter}
          onChange={(v) => set({ lowerIsBetter: v })}
          label="Lower is better (a fall is good news)"
        />
      </div>
    </div>
  )
}

// =====================================================================
// Waffle
// =====================================================================
export function WaffleEditor({ widget, cols, set }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Split by">
          <Select value={widget.groupBy || ''} onChange={(v) => set({ groupBy: v })} options={cols} placeholder="— column —" />
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
        <Field label="Number format">
          <Select value={widget.format || 'comma'} onChange={(v) => set({ format: v })} options={NUMBER_FORMATS} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Squares" hint="100 needs no explaining. Fewer suits a narrow card.">
          <Select
            value={String(widget.cells || 100)}
            onChange={(v) => set({ cells: Number(v) })}
            options={[25, 50, 100, 144, 200].map((n) => ({ value: String(n), label: `${n} squares` }))}
          />
        </Field>
        <Field label="Per row">
          <TextInput type="number" value={widget.columns ?? 10} onChange={(v) => set({ columns: Number(v) || 10 })} />
        </Field>
        <Field label="Shape">
          <Select value={widget.shape || 'rounded'} onChange={(v) => set({ shape: v })} options={WAFFLE_SHAPES} />
        </Field>
        <Field label="Gap (px)">
          <TextInput type="number" value={widget.gap ?? 3} onChange={(v) => set({ gap: Number(v) })} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Most slices" hint="The rest merge into one, at full weight.">
          <TextInput type="number" value={widget.maxSlices ?? 5} onChange={(v) => set({ maxSlices: Number(v) || 5 })} />
        </Field>
        <Field label="Name for the merged slice">
          <TextInput value={widget.otherLabel ?? 'Other'} onChange={(v) => set({ otherLabel: v })} placeholder="Other" />
        </Field>
        <Field label="Palette">
          <Select value={widget.palette || 'default'} onChange={(v) => set({ palette: v })} options={SERIES_PALETTES} />
        </Field>
        <Field label="Fill">
          <Select
            value={widget.direction || 'row'}
            onChange={(v) => set({ direction: v })}
            options={[
              { value: 'row', label: 'Across, then down' },
              { value: 'column', label: 'Down, then across' },
            ]}
          />
        </Field>
      </div>

      <ValueColorEditor widget={widget} set={set} />

      <div className="flex flex-wrap gap-3">
        <Toggle checked={widget.showLegend !== false} onChange={(v) => set({ showLegend: v })} label="Show the key" />
        <Toggle
          checked={widget.showPercent !== false}
          onChange={(v) => set({ showPercent: v })}
          label="Key shows percentages rather than values"
        />
      </div>
    </div>
  )
}
