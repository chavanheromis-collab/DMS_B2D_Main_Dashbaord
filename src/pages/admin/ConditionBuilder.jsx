import { Sigma, X } from 'lucide-react'
import { OPERATORS, operatorMeta } from '../../lib/config'
import { conditionPatch, isFormulaCondition } from '../../lib/conditionFormula'
import { Select, TextInput, optValue, toTabOptions, useWorkspaceCtx } from './ui.jsx'
import FormulaInput from './FormulaInput.jsx'
import { useId } from 'react'

/**
 * The operator and its value box(es) -- how many, and whether they are date
 * pickers, is the operator's own business (`arity`, `date`).
 *
 * Extracted because the blend editor asks the same question about a blended
 * column ("if it is blank / over 90 / contains TBD, show this instead"), and
 * two lists of operators that drift apart would be two dialects of the same
 * language.
 */
/**
 * The operator, and the value(s) it needs.
 *
 * `choices` turns the value box into one you can either type in or pick
 * from -- a `datalist`, not a `select`, because a condition may legitimately
 * name a value that is not in the column today ("Cancelled", on a sheet
 * where nothing has been cancelled yet) and a select would make that
 * impossible to express.
 *
 * The list is EVERY value in the column, never narrowed by what the page is
 * currently showing: somebody writing a rule is describing what the data
 * CAN say, not what it happens to be saying while they write.
 *
 * `columns` is the tab's own column list, for the formula operator: it is
 * what the guided editor suggests and checks names against. Absent, the
 * editor still guides the functions and simply does not check the names --
 * it must not call every column wrong because it was not told them.
 */
export function OperatorValue({ operator, value, value2, onChange, className = 'w-44', choices = null, columns = null }) {
  const meta = operatorMeta(operator)
  const listId = useId()
  const list = Array.isArray(choices) && choices.length > 0 ? choices : null
  return (
    <>
      <Select
        value={operator}
        onChange={(v) => onChange({ operator: v })}
        options={OPERATORS}
        className={className}
      />
      {meta.formula ? (
        /* A formula is a sentence, not a value -- it gets the full width of
           the row and an editor that helps write it. See FormulaInput. */
        <FormulaInput
          value={value}
          onChange={(v) => onChange({ value: v })}
          columns={columns || []}
          className="basis-full"
        />
      ) : (
        meta.arity >= 1 && (
          <>
            <TextInput
              type={meta.date ? 'date' : 'text'}
              value={value}
              onChange={(v) => onChange({ value: v })}
              placeholder={list ? `value (${list.length})` : 'value'}
              className="w-28"
              list={list ? listId : undefined}
            />
            {list && (
              <datalist id={listId}>
                {list.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            )}
          </>
        )
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
  const { labelFor, valuesFor } = useWorkspaceCtx()
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
          const formula = isFormulaCondition(cond)
          return (
            <div key={ci} className="flex flex-wrap items-center gap-1.5">
              <span className="w-9 shrink-0 text-[10px] font-semibold uppercase text-slate-400">
                {ci === 0 ? 'where' : match === 'all' ? 'and' : 'or'}
              </span>
              <Select
                value={cond.tab}
                onChange={(v) => setCondition(ci, { tab: v, ...(formula ? {} : { column: '' }) })}
                options={options}
                className={compact ? 'w-28' : 'w-36'}
              />
              {/* A formula names its columns inside itself, so the column
                  picker gives way to a marker saying what this row is. */}
              {formula ? (
                <span
                  className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700"
                  title="This condition is a formula over the whole row"
                >
                  <Sigma size={11} /> formula
                </span>
              ) : (
                <Select
                  value={cond.column}
                  onChange={(v) => setCondition(ci, { column: v })}
                  options={columnsOf(cond.tab)}
                  placeholder="— column —"
                  className={compact ? 'w-44' : 'w-52'}
                />
              )}
              <OperatorValue
                operator={cond.operator}
                value={cond.value}
                value2={cond.value2}
                // Choosing "formula" gives the condition the column the
                // tidy-up filters keep it by; leaving it takes that away.
                // See conditionPatch.
                onChange={(patch) => setCondition(ci, conditionPatch(cond, patch))}
                className={compact ? 'w-40' : 'w-48'}
                // Everything that is in that column, as of the last sync. A
                // formula row ignores it -- the formula editor takes the
                // tab's columns instead, below.
                choices={valuesFor?.(cond.tab, cond.column)}
                columns={columnsOf(cond.tab)}
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
