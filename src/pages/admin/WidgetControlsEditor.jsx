import { useState } from 'react'
import { Plus, SlidersHorizontal, X } from 'lucide-react'
import { NUMBER_FORMATS, PALETTE, uid } from '../../lib/config'
import { DATE_BUCKETS } from '../../lib/dataUtils'
import { CONTROL_KINDS, controlMeta, controlNeedsColumn } from '../../lib/widgetControls'
import { Btn, Field, Select, TextInput, useWorkspaceCtx } from './ui.jsx'
import ConditionBuilder from './ConditionBuilder.jsx'

/**
 * The controls attached to ONE widget: dropdowns, chips, buttons and the
 * various sliders that narrow only that widget.
 *
 * This used to be table-only. Controls now render in the canvas wrapper
 * above whichever widget owns them, so a chart can have a "top N" slider and
 * a KPI an amount threshold, exactly as a table can have a status dropdown.
 */
export default function WidgetControlsEditor({ widget, cols, tabHeaders, set }) {
  const { labelFor } = useWorkspaceCtx()
  const [adding, setAdding] = useState('select')
  const controls = widget.controls || []

  const update = (id, patch) => set({ controls: controls.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
  const remove = (id) => set({ controls: controls.filter((c) => c.id !== id) })

  function add() {
    const meta = controlMeta(adding)
    const firstColumn = cols[0] || ''
    const base = {
      id: uid('wc'),
      kind: adding,
      label: meta.needsColumn ? firstColumn || meta.label : meta.label,
      column: meta.needsColumn ? firstColumn : '',
      format: 'comma',
    }

    if (adding === 'button') {
      Object.assign(base, {
        label: `Button ${controls.length + 1}`,
        icon: '',
        color: PALETTE[controls.length % PALETTE.length],
        match: 'all',
        conditions: [{ tab: widget.tab, column: '', operator: 'is_not_empty', value: '', value2: '' }],
      })
    } else if (adding === 'threshold') {
      Object.assign(base, { direction: 'gte' })
    } else if (adding === 'stepper') {
      Object.assign(base, { steps: '0, 25, 50, 75, 100' })
    } else if (adding === 'dateslider') {
      Object.assign(base, { maxDays: 365 })
    } else if (adding === 'topn') {
      Object.assign(base, { label: 'Show top', maxN: 50, column: '' })
    }

    set({ controls: [...controls, base] })
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50/40 p-2">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1 text-[11px] font-medium text-amber-700">
          <SlidersHorizontal size={11} /> Controls on this widget ({controls.length})
        </p>
        <Select
          value={adding}
          onChange={setAdding}
          options={CONTROL_KINDS.map((k) => ({ value: k.value, label: k.label }))}
          className="w-56"
        />
        <Btn onClick={add} className="!py-0.5">
          <Plus size={11} /> Add
        </Btn>
        <span className="ml-auto max-w-xs text-[10px] text-slate-500">{controlMeta(adding).hint}</span>
      </div>

      {controls.length === 0 && (
        <p className="py-1 text-[10px] text-slate-400">
          None. Controls narrow <strong>this widget only</strong> — the rest of the page is untouched, which is what
          makes them different from the page filter bar.
        </p>
      )}

      <div className="space-y-1.5">
        {controls.map((control) => {
          const meta = controlMeta(control.kind)
          const setControl = (patch) => update(control.id, patch)

          return (
            <div key={control.id} className="rounded-lg border border-slate-200 bg-white p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                  {meta.label.replace(/^Slider — /, '⇔ ')}
                </span>

                <TextInput
                  value={control.label}
                  onChange={(v) => setControl({ label: v })}
                  placeholder="Label"
                  className="w-36"
                />

                {controlNeedsColumn(control.kind) && (
                  <Select
                    value={control.column || ''}
                    onChange={(v) => setControl({ column: v, label: control.label || v })}
                    options={cols}
                    placeholder="— column —"
                    className="w-48"
                  />
                )}

                {['select', 'multi'].includes(control.kind) && (
                  <Select
                    value={control.bucket || ''}
                    onChange={(v) => setControl({ bucket: v })}
                    options={DATE_BUCKETS}
                    className="w-44"
                  />
                )}

                {control.kind === 'button' && (
                  <>
                    <TextInput
                      value={control.icon}
                      onChange={(v) => setControl({ icon: v })}
                      placeholder="⏳"
                      className="w-14"
                    />
                    <input
                      type="color"
                      value={control.color || PALETTE[0]}
                      onChange={(e) => setControl({ color: e.target.value })}
                      className="h-[30px] w-10 rounded-lg border border-slate-200"
                    />
                  </>
                )}

                {control.kind === 'threshold' && (
                  <Select
                    value={control.direction || 'gte'}
                    onChange={(v) => setControl({ direction: v })}
                    options={[
                      { value: 'gte', label: 'At least (≥)' },
                      { value: 'lte', label: 'At most (≤)' },
                    ]}
                    className="w-32"
                  />
                )}

                {control.kind === 'dateslider' && (
                  <TextInput
                    type="number"
                    value={control.maxDays ?? 365}
                    onChange={(v) => setControl({ maxDays: Number(v) || 365 })}
                    placeholder="365"
                    className="w-20"
                  />
                )}

                {control.kind === 'topn' && (
                  <TextInput
                    type="number"
                    value={control.maxN ?? 50}
                    onChange={(v) => setControl({ maxN: Number(v) || 50 })}
                    placeholder="50"
                    className="w-20"
                  />
                )}

                {control.kind === 'multi' && (
                  <TextInput
                    type="number"
                    value={control.maxChips ?? 8}
                    onChange={(v) => setControl({ maxChips: Number(v) || 8 })}
                    placeholder="chips"
                    className="w-20"
                  />
                )}

                {/* Same pixel convention as the page control bar. */}
                <span className="flex items-center gap-1">
                  <TextInput
                    type="number"
                    value={control.widthPx ?? ''}
                    onChange={(v) => setControl({ widthPx: v === '' ? null : Number(v) })}
                    placeholder="auto"
                    className="w-16 text-center"
                  />
                  <span className="text-[10px] text-slate-400">px</span>
                </span>

                <button
                  onClick={() => remove(control.id)}
                  className="ml-auto text-slate-300 hover:text-rose-500"
                  title="Remove control"
                >
                  <X size={14} />
                </button>
              </div>

              {/* --- Slider tuning ------------------------------------- */}
              {['range', 'threshold'].includes(control.kind) && (
                <div className="mt-1.5 grid grid-cols-2 gap-1.5 md:grid-cols-4">
                  <Field label="Min" hint="Blank reads it from the data.">
                    <TextInput
                      type="number"
                      value={control.min ?? ''}
                      onChange={(v) => setControl({ min: v === '' ? null : Number(v) })}
                      placeholder="auto"
                    />
                  </Field>
                  <Field label="Max" hint="Blank reads it from the data.">
                    <TextInput
                      type="number"
                      value={control.max ?? ''}
                      onChange={(v) => setControl({ max: v === '' ? null : Number(v) })}
                      placeholder="auto"
                    />
                  </Field>
                  <Field label="Step">
                    <TextInput
                      type="number"
                      value={control.step ?? ''}
                      onChange={(v) => setControl({ step: v === '' ? null : Number(v) })}
                      placeholder="auto"
                    />
                  </Field>
                  <Field label="Number format">
                    <Select
                      value={control.format || 'comma'}
                      onChange={(v) => setControl({ format: v })}
                      options={NUMBER_FORMATS}
                    />
                  </Field>
                </div>
              )}

              {control.kind === 'stepper' && (
                <div className="mt-1.5 grid grid-cols-1 gap-1.5 md:grid-cols-2">
                  <Field
                    label="Steps"
                    hint="Comma-separated. The slider snaps to these and labels them."
                  >
                    <TextInput
                      value={control.steps || ''}
                      onChange={(v) => setControl({ steps: v })}
                      placeholder="0, 100000, 500000, 1000000"
                    />
                  </Field>
                  <Field label="Number format">
                    <Select
                      value={control.format || 'comma'}
                      onChange={(v) => setControl({ format: v })}
                      options={NUMBER_FORMATS}
                    />
                  </Field>
                </div>
              )}

              {control.kind === 'button' && (
                <div className="mt-1.5">
                  <ConditionBuilder
                    conditions={control.conditions || []}
                    match={control.match || 'all'}
                    tabs={[widget.tab]}
                    tabHeaders={tabHeaders}
                    onChange={(conditions) => setControl({ conditions })}
                    compact
                  />
                </div>
              )}

              {control.kind === 'topn' && (
                <p className="mt-1 text-[10px] text-slate-400">
                  Applied last, whatever order the controls are in — “top 10” has to mean the top 10 of what survived
                  the other controls, not of the raw tab.
                </p>
              )}
            </div>
          )
        })}
      </div>

      {controls.length > 0 && (
        <p className="mt-1.5 text-[10px] text-slate-400">
          These sit above <strong>{widget.title || labelFor(widget.tab)}</strong> on the dashboard and narrow only it.
        </p>
      )}
    </div>
  )
}
