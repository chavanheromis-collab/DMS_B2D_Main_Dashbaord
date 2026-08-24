import { useMemo, useState } from 'react'
import { AlertCircle, BookOpen, Calculator, Check, Plus, Trash2 } from 'lucide-react'
import { compileComputed, newComputedId, previewComputed } from '../../lib/computed'
import { aggregateKeys, functionHelp, parseFormula } from '../../lib/formula'
import { Select, TextInput } from './ui.jsx'

/**
 * Calculated columns for one tab.
 *
 * The hard part of a formula box is not the formula -- it is finding out
 * that you typed the column name wrong, three days later, from a chart that
 * looks plausible. So this does the three things that turn a formula box
 * into something usable by somebody who is not a programmer:
 *
 *   RECIPES. Nine formulas out of ten are one of six shapes -- a
 *   difference, a percentage, an age in days, a banding, a join of two
 *   fields, a share of the total. Each is one click, pre-written with this
 *   tab's own column names, and then editable.
 *
 *   THE COLUMNS ARE THERE. Click a column to insert it, correctly bracketed,
 *   rather than typing a name from memory and mistyping the space in it.
 *
 *   IT SHOWS THE ANSWER. Against real rows from the sheet, as you type. A
 *   preview computed by the same code the dashboard uses -- a second
 *   implementation would eventually disagree, and the disagreement would be
 *   found by somebody trusting the wrong one.
 */

/** The shapes almost every calculated column turns out to be. */
const RECIPES = [
  {
    id: 'difference',
    label: 'A minus B',
    example: 'Margin',
    build: (cols) => `[${cols[0] || 'A'}] - [${cols[1] || 'B'}]`,
  },
  {
    id: 'percent',
    label: 'A as a % of B',
    example: 'Margin %',
    build: (cols) => `ROUND([${cols[0] || 'A'}] / [${cols[1] || 'B'}] * 100, 1)`,
  },
  {
    id: 'age',
    label: 'Days since a date',
    example: 'Age (days)',
    build: (cols) => `DAYSSINCE([${cols[0] || 'Date'}])`,
  },
  {
    id: 'band',
    label: 'Band it into groups',
    example: 'Size',
    build: (cols) => `IFS([${cols[0] || 'A'}] > 100000, "Large", [${cols[0] || 'A'}] > 25000, "Medium", "Small")`,
  },
  {
    id: 'join',
    label: 'Join two columns',
    example: 'Branch · Model',
    build: (cols) => `[${cols[0] || 'A'}] & " · " & [${cols[1] || 'B'}]`,
  },
  {
    id: 'share',
    label: 'Share of the whole table',
    example: 'Share %',
    build: (cols) => `ROUND(PERCENTOF([${cols[0] || 'A'}]), 1)`,
  },
  {
    id: 'groupshare',
    label: 'Share of its own group',
    example: 'Share of branch %',
    build: (cols) => `ROUND(SHAREOF([${cols[0] || 'A'}], [${cols[1] || 'B'}]), 1)`,
  },
  {
    id: 'flag',
    label: 'Yes / no from a rule',
    example: 'Overdue',
    build: (cols) => `IF(DAYSSINCE([${cols[0] || 'Date'}]) > 30, "Yes", "No")`,
  },
]

function cellText(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (value instanceof Date) return value.toLocaleDateString('en-IN')
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2)
  return String(value)
}

export default function ComputedColumns({ tabs, tabHeaders, computed, sampleRows, dateOrder, onChange }) {
  const [tab, setTab] = useState(tabs[0] || '')
  const [helpOpen, setHelpOpen] = useState(false)

  const headers = tabHeaders?.[tab] || []
  const defs = computed?.[tab] || []
  const rows = sampleRows?.[tab] || []

  const setDefs = (next) => onChange({ ...(computed || {}), [tab]: next })
  const update = (id, patch) => setDefs(defs.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  const remove = (id) => setDefs(defs.filter((d) => d.id !== id))

  const add = (recipe) => {
    const numericGuess = headers.filter((h) => /amount|price|value|cost|total|qty|sale/i.test(h))
    const dateGuess = headers.filter((h) => /date|day/i.test(h))
    const picks = recipe?.id === 'age' || recipe?.id === 'flag' ? [...dateGuess, ...headers] : [...numericGuess, ...headers]
    setDefs([
      ...defs,
      {
        id: newComputedId(),
        name: recipe ? uniqueName(recipe.example, headers, defs) : uniqueName('New column', headers, defs),
        formula: recipe ? recipe.build(picks) : '',
      },
    ])
  }

  const { errors } = useMemo(() => compileComputed(defs, headers), [defs, headers])
  const errorFor = (id) => errors.find((e) => e.id === id)?.error

  const preview = useMemo(
    () => previewComputed(rows, defs, { headers, dateOrder, limit: 5 }),
    [rows, defs, headers, dateOrder]
  )

  // A whole-table function measured over eight sample rows is not the number
  // the dashboard will show, and a preview that quietly implied otherwise
  // would be worse than no preview.
  const usesAggregate = useMemo(
    () =>
      defs.some((d) => {
        const { ast } = parseFormula(d.formula || '')
        return ast ? aggregateKeys(ast).length > 0 : false
      }),
    [defs]
  )

  if (tabs.length === 0) {
    return <p className="text-[11px] text-slate-400">Tick a tab above first — a calculated column belongs to a tab.</p>
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Calculator size={13} className="text-indigo-500" />
        <span className="text-xs font-medium text-slate-700">Calculated columns for</span>
        <Select value={tab} onChange={setTab} options={tabs} className="w-48" />
        <button onClick={() => setHelpOpen((h) => !h)} className="ml-auto inline-flex items-center gap-1 text-[11px] text-indigo-600 underline">
          <BookOpen size={11} /> {helpOpen ? 'hide' : 'what can I write?'}
        </button>
      </div>

      <p className="text-[11px] text-slate-400">
        A column your sheet doesn’t have — margin, age in days, a status worked out from three other fields. Defined
        here once, it behaves like any other column of <strong>{tab}</strong> everywhere: in every widget, filter,
        control, drill-down and blend, on every page that uses this tab.
      </p>

      {/* --- recipes ---------------------------------------------------- */}
      <div className="flex flex-wrap gap-1">
        {RECIPES.map((recipe) => (
          <button
            key={recipe.id}
            onClick={() => add(recipe)}
            className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
            title={`Adds a "${recipe.example}" column you can then edit`}
          >
            + {recipe.label}
          </button>
        ))}
        <button
          onClick={() => add(null)}
          className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50"
        >
          <Plus size={10} className="inline" /> empty
        </button>
      </div>

      {helpOpen && (
        <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/70 p-2">
          <p className="mb-1.5 text-[11px] text-slate-500">
            Write it like a spreadsheet. <code className="rounded bg-white px-1">[Column Name]</code> is a column,{' '}
            <code className="rounded bg-white px-1">&amp;</code> joins text, and{' '}
            <code className="rounded bg-white px-1">=</code> compares without caring about capitals.
          </p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {functionHelp().map(({ group, items }) => (
              <div key={group}>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{group}</p>
                {items.map((item) => (
                  <p key={item.name} className="truncate text-[10px] text-slate-600" title={item.hint}>
                    {item.hint}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- the columns ------------------------------------------------ */}
      {defs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 py-3 text-center text-[11px] text-slate-400">
          None yet — pick a recipe above and edit it.
        </p>
      ) : (
        <div className="space-y-1.5">
          {defs.map((def) => {
            const error = errorFor(def.id)
            return (
              <div
                key={def.id}
                className={`rounded-lg border p-2 ${error ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200 bg-white'}`}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <TextInput
                    value={def.name}
                    onChange={(v) => update(def.id, { name: v })}
                    placeholder="Column name"
                    className="w-44"
                  />
                  <span className="text-[10px] text-slate-400">=</span>
                  <TextInput
                    value={def.formula}
                    onChange={(v) => update(def.id, { formula: v })}
                    placeholder="[Sale] - [Cost]"
                    className="min-w-[220px] flex-1"
                  />
                  {!error && def.formula && <Check size={13} className="shrink-0 text-emerald-500" />}
                  <button onClick={() => remove(def.id)} className="shrink-0 text-slate-300 hover:text-rose-500" title="Remove">
                    <Trash2 size={13} />
                  </button>
                </div>

                {error && (
                  <p className="mt-1 flex items-start gap-1 text-[11px] text-rose-600">
                    <AlertCircle size={11} className="mt-0.5 shrink-0" /> {error}
                  </p>
                )}

                {/* Click a column to insert it, correctly bracketed. Typing
                    a name from memory is how a formula ends up referring to
                    a column that does not exist. */}
                <div className="mt-1 flex flex-wrap gap-1">
                  {headers.slice(0, 40).map((h) => (
                    <button
                      key={h}
                      onClick={() => update(def.id, { formula: `${def.formula || ''}[${h}]` })}
                      className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px] text-slate-500 hover:bg-indigo-50 hover:text-indigo-700"
                    >
                      {h}
                    </button>
                  ))}
                  {headers.length === 0 && (
                    <span className="text-[10px] text-slate-400">
                      No columns known for this tab yet — Sync data first.
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* --- the answer ------------------------------------------------- */}
      {defs.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Preview {rows.length > 0 ? `· ${Math.min(5, rows.length)} real rows` : ''}
          </p>
          {rows.length === 0 ? (
            <p className="text-[11px] text-slate-400">
              Hit <strong>Sync data</strong> above to pull a few real rows and see what these formulas produce.
            </p>
          ) : preview.columns.length === 0 ? (
            <p className="text-[11px] text-slate-400">Nothing to preview until a formula reads correctly.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-[11px]">
                <thead className="text-slate-500">
                  <tr>
                    {preview.columns.map((c) => (
                      <th key={c.id} className="whitespace-nowrap px-2 py-1 text-left font-semibold">
                        {c.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i} className="border-t border-slate-200">
                      {preview.columns.map((c) => (
                        <td key={c.id} className="whitespace-nowrap px-2 py-1 tabular-nums text-slate-700">
                          {cellText(row[c.name])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {usesAggregate && rows.length > 0 && (
            <p className="mt-1 text-[10px] text-amber-600">
              TOTAL, RANK, SHAREOF and the rest are measured over these {rows.length} sample rows here — on the
              dashboard they cover the whole tab, so these numbers will be different.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** "Margin", then "Margin 2" -- never a name the tab already uses. */
function uniqueName(base, headers, defs) {
  const taken = new Set([...headers, ...defs.map((d) => d.name)])
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base} ${n}`)) n += 1
  return `${base} ${n}`
}
