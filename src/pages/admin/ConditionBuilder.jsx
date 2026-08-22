import { X } from 'lucide-react'
import { OPERATORS, operatorMeta } from '../../lib/config'
import { Select, TextInput, optValue, toTabOptions, useWorkspaceCtx } from './ui.jsx'

/**
 * The operator and its value box(es) -- how many, and whether they are date
 * pickers, is the operator's own business (`arity`, `date`).
 *
 * Extracted because the blend editor asks the same question about a blended
 * column ("if it is blank / over 90 / contains TBD, show this instead"), and
 * two lists of operators that drift apart would be two dialects of the same
 * language.
 */
export function OperatorValue({ operator, value, value2, onChange, className = 'w-44' }) {
  const meta = operatorMeta(operator)
  return (
    <>
      <Select
        value={operator}
        onChange={(v) => onChange({ operator: v })}
        options={OPERATORS}
        className={className}
      />
      {meta.arity >= 1 && (
        <TextInput
          type={meta.date ? 'date' : 'text'}
          value={value}
          onChange={(v) => onChange({ value: v })}
          placeholder="value"
          className="w-28"
        />
      )}
      {meta.arity === 2 && (
        <>
          <span className="text-[10px] text-slate-400">and</span>
          <TextInput
            type={meta.date ? 'date' : 'text'}
            value={value2}
            onChange={(v) => onChange({ value2: v })}
            placeholder="value"
            className="w-28"
          />
        </>
      )}
    </>
  )
}

/**
 * The tab + column + operator + value editor, shared by condition buttons
 * and pipeline stages -- both are "a set of conditions", so they get the
 * exact same builder and the exact same evaluator at runtime.
 *
 * `tabs` may arrive either as ready-made { value, label } options (the whole
 * page's tabs) or as a bare array of refs (an editor pinning conditions to
 * one tab). Both are normalised here so a raw "src_a1::MASTER" never reaches
 * the screen.
 */
export default function ConditionBuilder({ conditions, match = 'all', tabs, tabHeaders, onChange, compact }) {
  const { labelFor } = useWorkspaceCtx()
  const options = toTabOptions(tabs, labelFor)
  const columnsOf = (tab) => tabHeaders?.[tab] || []

  const setCondition = (ci, patch) => onChange(conditions.map((c, i) => (i === ci ? { ...c, ...patch } : c)))
  const removeCondition = (ci) => onChange(conditions.filter((_, i) => i !== ci))
  const addCondition = () =>
    onChange([
      ...conditions,
      {
        tab: conditions[0]?.tab || optValue(tabs?.[0]) || '',
        column: '',
        operator: 'is_not_empty',
        value: '',
        value2: '',
      },
    ])

  return (
    <div>
      <div className="space-y-1.5">
        {conditions.map((cond, ci) => {
          return (
            <div key={ci} className="flex flex-wrap items-center gap-1.5">
              <span className="w-9 shrink-0 text-[10px] font-semibold uppercase text-slate-400">
                {ci === 0 ? 'where' : match === 'all' ? 'and' : 'or'}
              </span>
              <Select
                value={cond.tab}
                onChange={(v) => setCondition(ci, { tab: v, column: '' })}
                options={options}
                className={compact ? 'w-28' : 'w-36'}
              />
              <Select
                value={cond.column}
                onChange={(v) => setCondition(ci, { column: v })}
                options={columnsOf(cond.tab)}
                placeholder="— column —"
                className={compact ? 'w-44' : 'w-52'}
              />
              <OperatorValue
                operator={cond.operator}
                value={cond.value}
                value2={cond.value2}
                onChange={(patch) => setCondition(ci, patch)}
                className={compact ? 'w-40' : 'w-48'}
              />
              <button
                onClick={() => removeCondition(ci)}
                className="text-slate-300 hover:text-rose-500"
                title="Remove condition"
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
        {conditions.length === 0 && (
          <p className="py-1 text-[11px] text-slate-400">
            No conditions — this will match every row.
          </p>
        )}
      </div>

      <button onClick={addCondition} className="mt-1.5 text-[11px] text-indigo-600 underline">
        + add condition
      </button>
    </div>
  )
}
