import { Link2, Plus, X } from 'lucide-react'
import { AGGREGATIONS, aggNeedsColumn, uid } from '../../lib/config'
import {
  BLEND_MULTI,
  BLEND_TYPES,
  DEFAULT_BLEND,
  blendExtraColumns,
  blendIsReady,
  blendedColumnName,
  sidedColumn,
} from '../../lib/blend'
import { OperatorValue } from './ConditionBuilder.jsx'
import { Btn, Field, Select, TextInput, Toggle, useWorkspaceCtx } from './ui.jsx'

/**
 * Blends a SECOND tab into one widget, matched on a key column.
 *
 * This is the per-widget answer to "my quoted amount lives on Quotations but
 * my table is built on MASTER". The two tabs may come from completely
 * different spreadsheets -- the key column is the only thing that has to
 * line up.
 *
 * Deliberately scoped to this widget alone: nothing else on the page changes,
 * and the blended columns are simply extra columns on this widget's rows,
 * which is why every existing widget type can use them with no special
 * handling (sort a blended column, chart it, put it in a KPI).
 */
export default function BlendEditor({ widget, set }) {
  const { tabOptions, tabHeaders, labelFor } = useWorkspaceCtx()
  const blend = { ...DEFAULT_BLEND, ...(widget.blend || {}) }

  const leftCols = tabHeaders?.[widget.tab] || []
  const rightCols = tabHeaders?.[blend.ref] || []
  const ready = blendIsReady(blend)

  const setBlend = (patch) => set({ blend: { ...blend, ...patch } })

  // Never offer the widget's own tab as the right-hand side: joining a tab
  // to itself on the same key is a no-op that just doubles the columns.
  const rightOptions = tabOptions.filter((o) => o.value !== widget.tab)

  /**
   * Two columns whose names match exactly are almost always the intended
   * key pair, so pre-fill both sides when a tab is picked. Wrong guesses
   * cost one dropdown change; a blank pair costs two on every single blend.
   */
  function pickRef(ref) {
    const cols = tabHeaders?.[ref] || []
    const shared = leftCols.find((c) => cols.includes(c))
    setBlend({
      ref,
      leftKey: shared || '',
      rightKey: shared || '',
      columns: [],
      // Namespacing incoming columns by default stops "Status" from the
      // right tab from silently overwriting "Status" on the left one.
      prefix: blend.prefix || `${String(labelFor(ref)).split(' · ')[0]}.`,
    })
  }

  const rollups = blend.rollups || []
  const setRollups = (next) => setBlend({ rollups: next })
  const fallbacks = blend.fallbacks || []

  // Both pickers list every column the widget will have, from either tab.
  // Each option carries its side because the two tabs very often share a
  // column name -- "Status" on either would be indistinguishable once saved.
  const leftName = labelFor(widget.tab) || 'this tab'
  const rightName = labelFor(blend.ref) || 'blended tab'
  const extras = blendExtraColumns(blend)

  const leftOptions = leftCols.map((c) => ({ value: sidedColumn('left', c), label: `${leftName} · ${c}` }))
  const extraOptions = extras.map((c) => ({ value: sidedColumn('blend', c), label: `Blend · ${c}` }))

  // A rule WRITES to the merged row, so its target is named the way the
  // widget will see it -- the incoming columns under their prefix.
  const targetOptions = [
    { value: '', label: '— pick a column —' },
    ...rightCols.map((c) => ({
      value: sidedColumn('right', c),
      label: `${rightName} · ${blendedColumnName(blend, c)}`,
    })),
    ...leftOptions,
    ...extraOptions,
  ]

  // A rule READS its replacement, so the other tab's columns appear under
  // their own names -- they are looked up on the matched rows, not on the
  // merged row, and so are available whether or not they were brought across.
  const backupOptions = [
    { value: '', label: '— pick a backup column —' },
    ...leftOptions,
    ...rightCols.map((c) => ({ value: sidedColumn('right', c), label: `${rightName} · ${c}` })),
    ...extraOptions,
  ]

  return (
    <div className="mt-2 rounded-lg border border-teal-100 bg-teal-50/40 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="flex items-center gap-1 text-[11px] font-medium text-teal-700">
          <Link2 size={11} /> Blend a second tab into this widget
        </p>
        <Toggle
          checked={!!blend.enabled}
          onChange={(v) => setBlend({ enabled: v })}
          label="Enable"
        />
      </div>

      {!blend.enabled ? (
        <p className="text-[10px] text-slate-400">
          Off. Turn on to pull columns from another tab — even from a different spreadsheet — matched row by row on a
          key column, like a VLOOKUP that lives in the dashboard instead of the sheet.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Field label="Blend with tab">
              <Select
                value={blend.ref || ''}
                onChange={pickRef}
                options={rightOptions}
                placeholder="— pick a tab —"
              />
            </Field>
            <Field label={`Key on ${labelFor(widget.tab) || 'this tab'}`}>
              <Select
                value={blend.leftKey || ''}
                onChange={(v) => setBlend({ leftKey: v })}
                options={leftCols}
                placeholder="— key column —"
              />
            </Field>
            <Field label="Key on the other tab">
              <Select
                value={blend.rightKey || ''}
                onChange={(v) => setBlend({ rightKey: v })}
                options={rightCols}
                placeholder={blend.ref ? '— key column —' : 'Pick a tab first'}
                disabled={!blend.ref}
              />
            </Field>
            <Field label="Unmatched rows">
              <Select value={blend.type || 'left'} onChange={(v) => setBlend({ type: v })} options={BLEND_TYPES} />
            </Field>
          </div>

          <p className="text-[10px] text-slate-500">
            {BLEND_TYPES.find((t) => t.value === (blend.type || 'left'))?.hint}
          </p>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Field
              label="When several rows match"
              hint="Ignored when “one row per match” is selected."
            >
              <Select
                value={blend.multi || 'first'}
                onChange={(v) => setBlend({ multi: v })}
                options={BLEND_MULTI}
                disabled={blend.type === 'expand'}
              />
            </Field>
            <Field label="Prefix for incoming columns" hint="Keeps same-named columns apart.">
              <TextInput value={blend.prefix || ''} onChange={(v) => setBlend({ prefix: v })} placeholder="Quotations." />
            </Field>
            <div className="flex items-end pb-1.5">
              <p className="text-[10px] text-slate-400">
                Blended columns behave like any other column — sort them, chart them, filter on them.
              </p>
            </div>
          </div>

          {/* --- Which columns come across ------------------------------- */}
          {blend.ref && (
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-3">
                <span className="text-[11px] font-medium text-slate-500">
                  Columns to bring across ({blend.columns?.length ? blend.columns.length : rightCols.length} of{' '}
                  {rightCols.length})
                </span>
                <button className="text-[11px] text-indigo-600 underline" onClick={() => setBlend({ columns: [] })}>
                  All
                </button>
                <button
                  className="text-[11px] text-slate-400 underline"
                  onClick={() => setBlend({ columns: [blend.rightKey].filter(Boolean) })}
                >
                  Key only
                </button>
              </div>
              <div className="grid max-h-36 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-slate-100 bg-white p-2 md:grid-cols-3">
                {rightCols.map((col) => {
                  // An empty list means "everything", so render that as all
                  // ticked rather than as nothing ticked.
                  const on = blend.columns?.length ? blend.columns.includes(col) : true
                  return (
                    <label key={col} className="flex items-center gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          const current = blend.columns?.length ? blend.columns : rightCols
                          const next = current.includes(col)
                            ? current.filter((c) => c !== col)
                            : [...current, col]
                          setBlend({ columns: next.length === rightCols.length ? [] : next })
                        }}
                      />
                      <span className="truncate" title={col}>
                        {col}
                      </span>
                    </label>
                  )
                })}
                {rightCols.length === 0 && (
                  <p className="col-span-3 py-2 text-center text-[11px] text-slate-300">
                    No columns known for that tab yet — hit “Sync data” on its spreadsheet under Data Sources.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* --- Roll-ups ------------------------------------------------- */}
          {blend.ref && (
            <div className="rounded-lg border border-slate-100 bg-white p-2">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[11px] font-medium text-slate-500">
                  Roll-ups <span className="font-normal text-slate-400">(summarise the matched rows)</span>
                </p>
                <Btn
                  onClick={() =>
                    setRollups([
                      ...rollups,
                      { id: uid('ru'), column: '', aggregation: 'count', as: '' },
                    ])
                  }
                >
                  <Plus size={11} /> Add
                </Btn>
              </div>

              {rollups.length === 0 && (
                <p className="py-1 text-[10px] text-slate-400">
                  None. A roll-up turns many matched rows into one number — e.g. “sum of Amount” across every quotation
                  for an order. A “{blendedColumnName(blend, 'Match count')}” column is always added for free.
                </p>
              )}

              <div className="space-y-1.5">
                {rollups.map((rollup, ri) => {
                  const setRollup = (patch) =>
                    setRollups(rollups.map((r, i) => (i === ri ? { ...r, ...patch } : r)))
                  return (
                    <div key={rollup.id || ri} className="flex flex-wrap items-center gap-1.5">
                      <Select
                        value={rollup.aggregation}
                        onChange={(v) => setRollup({ aggregation: v })}
                        options={AGGREGATIONS}
                        className="w-52"
                      />
                      <Select
                        value={rollup.column || ''}
                        onChange={(v) => setRollup({ column: v })}
                        options={rightCols}
                        placeholder="— column —"
                        className="w-44"
                        disabled={!aggNeedsColumn(rollup.aggregation)}
                      />
                      <span className="text-[10px] text-slate-400">as</span>
                      <TextInput
                        value={rollup.as || ''}
                        onChange={(v) => setRollup({ as: v })}
                        placeholder="Total quoted"
                        className="w-40"
                      />
                      <button
                        onClick={() => setRollups(rollups.filter((_, i) => i !== ri))}
                        className="text-slate-300 hover:text-rose-500"
                        title="Remove roll-up"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* --- Fallbacks ------------------------------------------------ */}
          {blend.ref && (
            <div className="rounded-lg border border-slate-100 bg-white p-2">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[11px] font-medium text-slate-500">
                  Fill-in rules{' '}
                  <span className="font-normal text-slate-400">(when a value is missing or fails a check)</span>
                </p>
                <Btn
                  onClick={() =>
                    setBlend({
                      fallbacks: [
                        ...fallbacks,
                        {
                          id: uid('fb'),
                          column: rightCols[0] ? sidedColumn('right', rightCols[0]) : '',
                          operator: 'is_empty',
                          value: '',
                          value2: '',
                          from: '',
                          text: '',
                        },
                      ],
                    })
                  }
                >
                  <Plus size={11} /> Add
                </Btn>
              </div>

              {fallbacks.length === 0 && (
                <p className="py-1 text-[10px] text-slate-400">
                  None. A row with no match — or a match whose cell is empty — leaves the blended column blank, and a
                  chart grouped by it <strong>skips blanks</strong>, so those rows quietly vanish and the totals stop
                  adding up. A rule swaps in another column — from either tab — whenever a value is missing, or
                  whenever it fails any check you can put on a button.
                </p>
              )}

              <div className="space-y-1.5">
                {fallbacks.map((rule, fi) => {
                  const setRule = (patch) =>
                    setBlend({ fallbacks: fallbacks.map((r, i) => (i === fi ? { ...r, ...patch } : r)) })
                  return (
                    <div key={rule.id || fi} className="rounded-md border border-slate-100 bg-slate-50/70 p-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="w-8 shrink-0 text-[10px] font-semibold uppercase text-slate-400">if</span>
                        <Select
                          value={rule.column || ''}
                          onChange={(v) => setRule({ column: v })}
                          options={targetOptions}
                          className="w-52"
                        />
                        <OperatorValue
                          operator={rule.operator || 'is_empty'}
                          value={rule.value}
                          value2={rule.value2}
                          onChange={setRule}
                          className="w-44"
                        />
                        <button
                          onClick={() => setBlend({ fallbacks: fallbacks.filter((_, i) => i !== fi) })}
                          className="ml-auto text-slate-300 hover:text-rose-500"
                          title="Remove rule"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="w-8 shrink-0 text-[10px] font-semibold uppercase text-slate-400">show</span>
                        <Select
                          value={rule.from || ''}
                          onChange={(v) => setRule({ from: v })}
                          options={backupOptions}
                          className="w-52"
                        />
                        <span className="text-[10px] text-slate-400">or</span>
                        <TextInput
                          value={rule.text || ''}
                          onChange={(v) => setRule({ text: v })}
                          placeholder="Not allocated"
                          className="w-32"
                        />
                      </div>
                    </div>
                  )
                })}
              </div>

              {fallbacks.length > 0 && (
                <p className="mt-1 text-[10px] text-slate-400">
                  Tried in order: the backup column, then the text — and only where the check holds, so a value you
                  are happy with is never overwritten. Every rule reads the row as the blend left it, so the order you
                  add them in makes no difference. A <strong>{rightName}</strong> backup is empty for a row that
                  matched nothing, and falls through to the text.
                  {blend.type === 'inner' &&
                    ' “Only matching rows” drops unmatched rows before any of this runs — they never reach a rule.'}
                </p>
              )}
            </div>
          )}

          {ready ? (
            <p className="rounded-lg bg-teal-50 px-2 py-1.5 text-[10px] text-teal-800">
              ✓ Each <strong>{labelFor(widget.tab)}</strong> row will be matched to{' '}
              <strong>{labelFor(blend.ref)}</strong> where <code>{blend.leftKey}</code> equals{' '}
              <code>{blend.rightKey}</code>. Keys are matched ignoring case, spaces and number formatting, so
              “SO-1001” and “ so-1001 ” still match.
            </p>
          ) : (
            <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] text-amber-700">
              Pick a tab and both key columns to activate the blend.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
