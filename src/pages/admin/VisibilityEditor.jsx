import ConditionBuilder from './ConditionBuilder.jsx'
import { Field, Select, Toggle, useWorkspaceCtx } from './ui.jsx'
import {
  VISIBILITY_MODES,
  VISIBLE_WHEN,
  emptyVisibility,
  visibilityOf,
  visibilityProblem,
  visibilitySummary,
} from '../../lib/visibility'
import { emptyRowCondition } from '../../lib/rowConditions'

/**
 * "Only show this when..." -- one editor, for widgets and for controls.
 *
 * Written once and used from both panels because it is one sentence, not
 * two that resemble each other: a rule that meant something slightly
 * different on a button than on a widget would be the four-slightly-
 * different-dialects problem this codebase has had before.
 *
 * `owner` is the widget or the control; `set` patches it. `filters` and
 * `buttons` are the page's own, so a rule can name them -- and so a rule
 * naming one that has since been deleted can be reported rather than
 * silently never coming true.
 */
export default function VisibilityEditor({ owner, set, filters = [], buttons = [], tabs, tabHeaders }) {
  const { valuesFor } = useWorkspaceCtx()
  const rule = visibilityOf(owner)
  const problem = visibilityProblem(owner, { filters, buttons })

  const patch = (change) => set({ [VISIBLE_WHEN]: { ...emptyVisibility(), ...rule, ...change } })

  const toggleId = (key, id) => {
    const current = rule[key]
    patch({ [key]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id] })
  }

  // The values one filter is allowed to be set to. An empty list means
  // "set to anything", which is the common case and so the default.
  const wantedValues = (id) => (rule.values[id] || []).filter(Boolean)
  const toggleValue = (id, value) => {
    const current = wantedValues(id)
    patch({
      values: {
        ...rule.values,
        [id]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
      },
    })
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-snug text-slate-400">
        A page that shows everything at once shows most of it to nobody. The overdue table matters on
        the days there are overdue jobs; the branch comparison matters once somebody has picked a
        branch. Say when this is worth showing and the rest of the time the page is shorter.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Show this" className="w-56">
          <Select value={rule.mode} onChange={(v) => patch({ mode: v })} options={VISIBILITY_MODES} />
        </Field>
        {rule.mode !== 'always' && (
          <div className="pb-1.5">
            <Toggle
              checked={rule.invert}
              onChange={(v) => patch({ invert: v })}
              label="Turn it round — hide it when this is true"
            />
          </div>
        )}
      </div>

      {rule.mode === 'rows' && (
        <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[11px] font-medium text-slate-500">Show it while at least one row matches</span>
            <Select
              value={rule.match}
              onChange={(v) => patch({ match: v })}
              options={[
                { value: 'all', label: 'all of these' },
                { value: 'any', label: 'any of these' },
              ]}
              className="w-32"
            />
          </div>
          <ConditionBuilder
            conditions={rule.conditions}
            match={rule.match}
            tabs={tabs}
            tabHeaders={tabHeaders}
            onChange={(conditions) => patch({ conditions })}
            compact
          />
          {rule.conditions.length === 0 && (
            <button
              onClick={() => patch({ conditions: [emptyRowCondition(owner?.tab || '')] })}
              className="mt-1 text-[11px] text-indigo-600 underline"
            >
              + first condition
            </button>
          )}
          <p className="mt-1 text-[10px] text-slate-400">
            Asked of the rows this would have drawn, after the page filters — so something hidden
            because nothing is overdue comes back the moment somebody filters to a branch where
            something is.
          </p>
        </div>
      )}

      {rule.mode === 'control' && (
        <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/50 p-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-slate-500">Waits for</span>
            <Select
              value={rule.need}
              onChange={(v) => patch({ need: v })}
              options={[
                { value: 'any', label: 'any one of them' },
                { value: 'all', label: 'all of them' },
              ]}
              className="w-40"
            />
          </div>

          {filters.length === 0 && buttons.length === 0 && (
            <p className="text-[11px] text-amber-700">
              This page has no filters or buttons yet — add one under Controls &amp; buttons first.
            </p>
          )}

          {filters.map((filter) => {
            const on = rule.filterIds.includes(filter.id)
            const options = on ? valuesFor?.(filter.tab, filter.column) || [] : []
            const wanted = wantedValues(filter.id)
            return (
              <div key={filter.id} className="rounded-lg border border-slate-100 bg-white p-1.5">
                <label className="flex items-center gap-1.5 text-[11px]">
                  <input type="checkbox" checked={on} onChange={() => toggleId('filterIds', filter.id)} />
                  <span className="truncate font-medium text-slate-600">{filter.label || filter.column}</span>
                  <span className="text-[10px] text-slate-400">filter</span>
                </label>

                {/* Which values count. Nothing ticked means "set to
                    anything", which is what most rules want -- so it is the
                    default rather than an option to find. */}
                {on && options.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1 border-t border-slate-100 pt-1">
                    {options.slice(0, 40).map((value) => (
                      <button
                        key={value}
                        onClick={() => toggleValue(filter.id, value)}
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${
                          wanted.includes(value)
                            ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                    <span className="self-center text-[10px] text-slate-400">
                      {wanted.length === 0 ? 'any value counts' : `${wanted.length} picked`}
                    </span>
                  </div>
                )}
              </div>
            )
          })}

          {buttons.map((button) => (
            <label
              key={button.id}
              className="flex items-center gap-1.5 rounded-lg border border-slate-100 bg-white p-1.5 text-[11px]"
            >
              <input
                type="checkbox"
                checked={rule.buttonIds.includes(button.id)}
                onChange={() => toggleId('buttonIds', button.id)}
              />
              <span className="truncate font-medium text-slate-600">{button.label || 'Button'}</span>
              <span className="text-[10px] text-slate-400">button</span>
            </label>
          ))}
        </div>
      )}

      {problem ? (
        <p className="text-[11px] text-rose-600">{problem}</p>
      ) : (
        <p className="text-[11px] text-slate-400">{visibilitySummary(owner, { filters, buttons })}</p>
      )}
    </div>
  )
}
