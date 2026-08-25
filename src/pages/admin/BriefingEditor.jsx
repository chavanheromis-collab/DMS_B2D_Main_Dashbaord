import { Plus, Target, Trash2 } from 'lucide-react'
import { AGGREGATIONS, aggNeedsColumn } from '../../lib/config'
import { DEFAULT_BRIEFING, SEVERITIES } from '../../lib/briefing'
import ConditionBuilder from './ConditionBuilder.jsx'
import { Btn, Field, Select, TextInput, Toggle } from './ui.jsx'

/**
 * What the briefing is allowed to talk about.
 *
 * Deliberately short. The checks themselves need no configuration -- the
 * point of the widget is that nobody has to know in advance which question
 * to ask -- so all this decides is which columns are worth being told about
 * and what "how much" means.
 *
 * The one thing worth spending screen on is WATCHES, because a statistical
 * check can find what is unusual and only a person can say what is
 * important. "Tell me when unallocated stock goes over fifty" is not a
 * pattern any general rule would ever have discovered, and it is usually
 * the line the MD actually cares about.
 */
const CHECKS = [
  { key: 'movement', label: 'What changed', hint: 'A rolling window against the window before it. Needs a date column.' },
  { key: 'aging', label: 'What is ageing', hint: 'The oldest pile with material volume behind it. Needs a date column.' },
  { key: 'concentration', label: 'Where it is piled up', hint: 'How few groups hold most of it.' },
  { key: 'outliers', label: 'What is out of line', hint: 'A group a long way from what its peers look like.' },
  { key: 'quality', label: 'What is missing', hint: 'Blanks in a column everything else is grouped by.' },
]

export default function BriefingEditor({ widget, tabs, tabHeaders, set }) {
  const config = { ...DEFAULT_BRIEFING, ...(widget.briefing || {}) }
  const columns = tabHeaders?.[widget.tab] || []
  const setConfig = (patch) => set({ briefing: { ...config, ...patch } })

  const dimensions = config.dimensions || []
  const toggleDimension = (column) =>
    setConfig({
      dimensions: dimensions.includes(column) ? dimensions.filter((c) => c !== column) : [...dimensions, column],
    })

  const watches = config.watches || []
  const setWatches = (next) => setConfig({ watches: next })
  const updateWatch = (id, patch) => setWatches(watches.map((w) => (w.id === id ? { ...w, ...patch } : w)))

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-slate-500">
        Reads this tab and writes what it finds, in sentences, ranked by how much is behind them — then every finding
        filters the page to the exact rows it counted. Nothing here decides <em>what</em> to look for; that is the
        point of it.
      </p>

      {/* --- what "how much" means -------------------------------------- */}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Measured by" className="w-44">
          <Select
            value={config.aggregation || 'count'}
            onChange={(v) => setConfig({ aggregation: v, valueColumn: aggNeedsColumn(v) ? config.valueColumn : null })}
            options={AGGREGATIONS}
          />
        </Field>
        {aggNeedsColumn(config.aggregation || 'count') && (
          <Field label="Of column" className="w-48">
            <Select
              value={config.valueColumn || ''}
              onChange={(v) => setConfig({ valueColumn: v })}
              options={columns}
              placeholder="— column —"
            />
          </Field>
        )}
        <Field label="Date column" hint="Ageing and “what changed” need one." className="w-48">
          <Select
            value={config.dateColumn || ''}
            onChange={(v) => setConfig({ dateColumn: v })}
            options={columns}
            placeholder="— none —"
          />
        </Field>
        <Field label="Compare the last" className="w-32">
          <TextInput
            type="number"
            value={config.windowDays ?? 30}
            onChange={(v) => setConfig({ windowDays: Number(v) || 30 })}
          />
        </Field>
        <Field label="Findings shown" className="w-28">
          <TextInput type="number" value={config.limit ?? 6} onChange={(v) => setConfig({ limit: Number(v) || 6 })} />
        </Field>
      </div>

      {/* --- what it may talk about ------------------------------------- */}
      <div>
        <p className="mb-1 text-[11px] font-medium text-slate-600">
          Columns worth being told about{' '}
          <span className="font-normal text-slate-400">— concentration, outliers and blanks are checked per column</span>
        </p>
        <div className="grid max-h-32 grid-cols-2 gap-x-3 gap-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-2 md:grid-cols-3">
          {columns.map((column) => (
            <label key={column} className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <input
                type="checkbox"
                checked={dimensions.includes(column)}
                onChange={() => toggleDimension(column)}
                className="h-3 w-3"
              />
              <span className="truncate" title={column}>
                {column}
              </span>
            </label>
          ))}
          {columns.length === 0 && (
            <p className="col-span-full py-1 text-center text-[11px] text-slate-400">
              No columns known for this tab yet — sync the source first.
            </p>
          )}
        </div>
      </div>

      {/* --- which checks ----------------------------------------------- */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {CHECKS.map((check) => (
          <span key={check.key} title={check.hint}>
            <Toggle
              checked={config.checks?.[check.key] !== false}
              onChange={(v) => setConfig({ checks: { ...config.checks, [check.key]: v } })}
              label={check.label}
            />
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field
          label="Ignore anything under"
          hint="A three-row anomaly in forty thousand is noise."
          className="w-40"
        >
          <Select
            value={String(config.minShare ?? 0.05)}
            onChange={(v) => setConfig({ minShare: Number(v) })}
            options={[
              { value: '0.01', label: '1% of the measure' },
              { value: '0.05', label: '5% of the measure' },
              { value: '0.1', label: '10% of the measure' },
              { value: '0.2', label: '20% of the measure' },
            ]}
          />
        </Field>
        <Field label="Ageing thresholds (days)" hint="Oldest first; the first with volume wins." className="w-52">
          <TextInput
            value={(config.ageDays || DEFAULT_BRIEFING.ageDays).join(', ')}
            onChange={(v) =>
              setConfig({
                ageDays: v
                  .split(',')
                  .map((n) => Number(n.trim()))
                  .filter((n) => Number.isFinite(n) && n > 0),
              })
            }
            placeholder="90, 60, 30"
          />
        </Field>
      </div>

      {/* --- watches ----------------------------------------------------- */}
      <div className="rounded-lg border border-indigo-100 bg-indigo-50/30 p-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1 text-[11px] font-medium text-indigo-800">
            <Target size={11} /> Watches
          </p>
          <Btn
            onClick={() =>
              setWatches([
                ...watches,
                {
                  id: `w_${Math.random().toString(36).slice(2, 8)}`,
                  label: 'Watch',
                  threshold: '',
                  severity: 'high',
                  match: 'all',
                  conditions: [{ tab: widget.tab, column: '', operator: 'is_not_empty', value: '' }],
                },
              ])
            }
          >
            <Plus size={11} /> Add a watch
          </Btn>
        </div>
        <p className="mb-1.5 text-[10px] text-indigo-700/70">
          A statistical check finds what is unusual; only a person can say what is important. A watch is always
          reported — first when it trips, and quietly as met when it doesn’t, because being told nothing can’t be
          told apart from not being checked.
        </p>

        {watches.length === 0 ? (
          <p className="py-1 text-center text-[11px] text-slate-400">None yet.</p>
        ) : (
          <div className="space-y-1.5">
            {watches.map((watch) => (
              <div key={watch.id} className="rounded-lg border border-slate-200 bg-white p-2">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <TextInput
                    value={watch.label}
                    onChange={(v) => updateWatch(watch.id, { label: v })}
                    placeholder="Unallocated stock"
                    className="w-44"
                  />
                  <span className="text-[10px] text-slate-400">warn over</span>
                  <TextInput
                    type="number"
                    value={watch.threshold ?? ''}
                    onChange={(v) => updateWatch(watch.id, { threshold: v })}
                    placeholder="50"
                    className="w-20"
                  />
                  <Select
                    value={watch.severity || 'high'}
                    onChange={(v) => updateWatch(watch.id, { severity: v })}
                    options={SEVERITIES.map((s) => ({ value: s, label: s }))}
                    className="w-24"
                  />
                  <Select
                    value={watch.match || 'all'}
                    onChange={(v) => updateWatch(watch.id, { match: v })}
                    options={[
                      { value: 'all', label: 'match all' },
                      { value: 'any', label: 'match any' },
                    ]}
                    className="w-28"
                  />
                  <button
                    onClick={() => setWatches(watches.filter((w) => w.id !== watch.id))}
                    className="ml-auto text-slate-300 hover:text-rose-500"
                    title="Remove"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <ConditionBuilder
                  compact
                  conditions={watch.conditions || []}
                  match={watch.match || 'all'}
                  tabs={[widget.tab, ...tabs.filter((t) => t !== widget.tab)]}
                  tabHeaders={tabHeaders}
                  onChange={(next) => updateWatch(watch.id, { conditions: next })}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
