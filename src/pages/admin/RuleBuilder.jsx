import { useId, useState } from 'react'
import { Plus, X } from 'lucide-react'

import {
  JOINS,
  RULE_TESTS,
  TEST_GROUPS,
  addValues,
  blankCheck,
  checkProblem,
  emptyRule,
  formulaToRule,
  ruleToFormula,
  splitValues,
  testOf,
  withTest,
} from '../../lib/ruleBuilder'

// ---------------------------------------------------------------------
// A condition, built with clicks
// ---------------------------------------------------------------------
// For anybody who should not have to learn where the brackets go. Every
// choice is a dropdown or a value picked from the column itself, and what
// they add up to is written as a formula underneath -- the same formula
// the dashboard runs. See lib/ruleBuilder.js.
//
// The rule is held HERE while it is being built, not re-read from the
// formula on every change: a check with no value yet writes nothing, and
// re-reading would make it vanish the moment it was added.

const SELECT =
  'rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-700 focus:border-violet-400 focus:outline-none'
const INPUT =
  'w-28 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-700 focus:border-violet-400 focus:outline-none'

export default function RuleBuilder({ value, onChange, columns = [], valuesOf = null }) {
  const [rule, setRule] = useState(() => formulaToRule(value) || emptyRule())

  function commit(next) {
    setRule(next)
    onChange(ruleToFormula(next))
  }

  const setGroup = (part, patch) => commit({ ...rule, [part]: { ...rule[part], ...patch } })
  const setCheck = (part, index, patch) =>
    setGroup(part, { checks: rule[part].checks.map((c, i) => (i === index ? { ...c, ...patch } : c)) })
  const addCheck = (part) => setGroup(part, { checks: [...rule[part].checks, blankCheck()] })
  const removeCheck = (part, index) => setGroup(part, { checks: rule[part].checks.filter((_, i) => i !== index) })

  const limited = rule.only.checks.length > 0
  const formula = ruleToFormula(rule)

  return (
    <div className="space-y-1.5 rounded-lg border border-violet-100 bg-violet-50/40 p-2">
      <label className="flex w-fit cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
        <input
          type="checkbox"
          checked={limited}
          onChange={(e) => setGroup('only', { checks: e.target.checked ? [blankCheck()] : [] })}
        />
        Only for some rows
        <span className="text-slate-400">— every other row is kept as it is</span>
      </label>

      {limited && (
        <Group
          title="For rows where"
          group={rule.only}
          columns={columns}
          valuesOf={valuesOf}
          removable
          onJoin={(join) => setGroup('only', { join })}
          onCheck={(i, patch) => setCheck('only', i, patch)}
          onAdd={() => addCheck('only')}
          onRemove={(i) => removeCheck('only', i)}
        />
      )}

      <Group
        title={limited ? 'keep only those where' : 'Keep rows where'}
        group={rule.keep}
        columns={columns}
        valuesOf={valuesOf}
        removable={false}
        onJoin={(join) => setGroup('keep', { join })}
        onCheck={(i, patch) => setCheck('keep', i, patch)}
        onAdd={() => addCheck('keep')}
        onRemove={(i) => removeCheck('keep', i)}
      />

      <p className="break-all font-mono text-[10px] text-slate-400" title="The formula these choices write">
        {formula ? `= ${formula}` : 'Finish a check to see the formula it writes'}
      </p>
    </div>
  )
}

/** A set of checks, and whether all of them or any of them must hold. */
function Group({ title, group, columns, valuesOf, removable, onJoin, onCheck, onAdd, onRemove }) {
  const several = group.checks.length > 1
  return (
    <div className="rounded-md border border-slate-200 bg-white p-1.5">
      <p className="mb-1 flex flex-wrap items-center gap-1 text-[11px] font-medium text-slate-600">
        {title}
        {several && (
          <>
            <select
              value={group.join}
              onChange={(e) => onJoin(e.target.value)}
              aria-label="All or any of these"
              className={SELECT}
            >
              {JOINS.map((j) => (
                <option key={j.value} value={j.value}>
                  {j.label}
                </option>
              ))}
            </select>
            of these
          </>
        )}
      </p>
      <div className="space-y-1">
        {group.checks.map((check, i) => (
          <CheckRow
            key={i}
            check={check}
            columns={columns}
            valuesOf={valuesOf}
            onChange={(patch) => onCheck(i, patch)}
            onRemove={removable || several ? () => onRemove(i) : null}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-medium text-indigo-600 hover:underline"
      >
        <Plus size={10} /> add another check
      </button>
    </div>
  )
}

/** Column, condition, values. */
function CheckRow({ check, columns, valuesOf, onChange, onRemove }) {
  const listId = useId()
  const test = testOf(check.test)
  const known = check.column && valuesOf ? valuesOf(check.column) : null
  const options = Array.isArray(known) ? known.map((v) => String(v)) : []
  const problem = checkProblem(check)
  // A column the tab no longer has stays selectable rather than silently
  // becoming a different column.
  const columnOptions = !check.column || columns.includes(check.column) ? columns : [check.column, ...columns]

  return (
    <div className="flex flex-wrap items-center gap-1">
      <select
        value={check.column}
        onChange={(e) => onChange({ column: e.target.value })}
        aria-label="Column"
        className={`${SELECT} max-w-[12rem]`}
      >
        <option value="">— column —</option>
        {columnOptions.map((column) => (
          <option key={column} value={column}>
            {column}
          </option>
        ))}
      </select>

      <select
        value={test.id}
        onChange={(e) => onChange(withTest(check, e.target.value))}
        aria-label="Condition"
        className={SELECT}
      >
        {TEST_GROUPS.map((group) => (
          <optgroup key={group} label={group}>
            {RULE_TESTS.filter((t) => t.group === group).map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <Values
        test={test}
        values={check.values || []}
        options={options}
        listId={listId}
        onChange={(values) => onChange({ values })}
      />

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Remove this check"
          aria-label="Remove this check"
          className="text-slate-300 hover:text-rose-500"
        >
          <X size={12} />
        </button>
      )}
      {problem && <span className="text-[10px] text-amber-600">{problem}</span>}
    </div>
  )
}

/** The value box a condition needs: several, one, a range, days, or none. */
function Values({ test, values, options, listId, onChange }) {
  if (test.takes === 'none') return null

  const suggestions =
    options.length > 0 ? (
      <datalist id={listId}>
        {options.slice(0, 300).map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    ) : null

  if (test.takes === 'many') {
    return (
      <Chips values={values} options={options} listId={listId} placeholder={test.placeholder} onChange={onChange} />
    )
  }

  if (test.takes === 'days') {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          type="number"
          min="0"
          step="1"
          value={values[0] ?? ''}
          onChange={(e) => onChange([e.target.value])}
          aria-label="Days"
          className={`${INPUT} w-16`}
        />
        <span className="text-[11px] text-slate-500">days</span>
      </span>
    )
  }

  if (test.takes === 'two') {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <input
          value={values[0] ?? ''}
          onChange={(e) => onChange([e.target.value, values[1] ?? ''])}
          list={suggestions ? listId : undefined}
          placeholder="from"
          aria-label="From"
          className={INPUT}
        />
        <span className="text-[11px] text-slate-500">and</span>
        <input
          value={values[1] ?? ''}
          onChange={(e) => onChange([values[0] ?? '', e.target.value])}
          list={suggestions ? listId : undefined}
          placeholder="to"
          aria-label="To"
          className={INPUT}
        />
        {suggestions}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        value={values[0] ?? ''}
        onChange={(e) => onChange([e.target.value])}
        list={suggestions ? listId : undefined}
        placeholder={test.placeholder || 'value'}
        aria-label="Value"
        className={INPUT}
      />
      {suggestions}
    </span>
  )
}

/**
 * Several values, as chips.
 *
 * Picked from the column's own values, or typed: Enter, a comma or leaving
 * the box adds what was typed, and pasting "2 FOLL, 3 FOLL" adds both.
 * Backspace in an empty box takes the last one back.
 */
function Chips({ values, options, listId, placeholder, onChange }) {
  const [draft, setDraft] = useState('')
  const unpicked = options.filter((v) => !values.some((x) => String(x).toLowerCase() === v.toLowerCase()))

  function add(raw) {
    const parts = splitValues(raw)
    setDraft('')
    if (parts.length > 0) onChange(addValues(values, parts))
  }

  return (
    <span className="flex min-w-[12rem] flex-1 flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-white px-1 py-0.5 focus-within:border-violet-400">
      {values.map((v, i) => (
        <span
          key={`${v}-${i}`}
          className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 text-[10px] font-medium text-violet-800"
        >
          {v}
          <button
            type="button"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
            aria-label={`Remove ${v}`}
            className="text-violet-400 hover:text-rose-600"
          >
            <X size={9} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        list={unpicked.length > 0 ? listId : undefined}
        onChange={(e) => {
          const next = e.target.value
          // Choosing from the list is a whole value, not the start of one;
          // a browser marks it as not being typing.
          const picked = !e.nativeEvent.inputType || e.nativeEvent.inputType === 'insertReplacementText'
          if ((picked && options.includes(next)) || /[,\n]/.test(next)) add(next)
          else setDraft(next)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add(draft)
          } else if (e.key === 'Backspace' && !draft && values.length > 0) {
            onChange(values.slice(0, -1))
          }
        }}
        onBlur={() => add(draft)}
        placeholder={values.length > 0 ? '' : placeholder || 'type or pick, then Enter'}
        aria-label="Values"
        className="min-w-[6rem] flex-1 bg-transparent px-1 py-0.5 text-[11px] outline-none"
      />
      {unpicked.length > 0 && (
        <datalist id={listId}>
          {unpicked.slice(0, 300).map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      )}
    </span>
  )
}
