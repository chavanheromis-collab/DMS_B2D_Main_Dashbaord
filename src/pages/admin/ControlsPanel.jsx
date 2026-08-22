import { useState } from 'react'
import { Bookmark, ChevronRight, Copy, Link as LinkIcon, Plus, X } from 'lucide-react'
import { NUMBER_FORMATS, PALETTE, SLIDER_FILTER_KINDS, uid } from '../../lib/config'
import { looksLikeDateColumn } from '../../lib/dataUtils'
import {
  CONTROL_GROUPS,
  WIDTH_PRESETS,
  controlWidth,
  emptyView,
  isButton,
  kindMeta,
  kindNeedsColumn,
} from '../../lib/pageControls'
import {
  Btn,
  Field,
  RowControls,
  Select,
  TextInput,
  Toggle,
  listOps,
  optValue,
  useWorkspaceCtx,
} from './ui.jsx'
import ConditionBuilder from './ConditionBuilder.jsx'

const KIND_OPTIONS = CONTROL_GROUPS.flatMap((group) =>
  group.kinds.map((kind) => ({ value: kind.value, label: `${group.label} · ${kind.label}` }))
)

/**
 * Every page-level control in one place: dropdowns, chips, sliders, date
 * ranges and condition buttons, in one ordered list.
 *
 * They were two panels ("Filters" and "Buttons") writing two arrays, which
 * forced a split that meant nothing to the person using the dashboard -- a
 * Status dropdown and a "Pending invoices" button both just narrow what
 * you're looking at, and they could never sit next to each other. Order in
 * this list is order on the dashboard.
 */
export default function ControlsPanel({ tabs, tabHeaders, controls, setControls, views, setViews, hideSearch, setHideSearch }) {
  const { labelFor } = useWorkspaceCtx()
  const ops = listOps(controls, setControls)
  const [adding, setAdding] = useState('select')
  const [openId, setOpenId] = useState(null)

  const columnsOf = (tab) => tabHeaders?.[tab] || []

  function add() {
    const tab = optValue(tabs[0])
    if (!tab) return
    const cols = columnsOf(tab)
    const meta = kindMeta(adding)

    const base = {
      id: uid('c'),
      kind: adding,
      label: meta.label,
      tab,
      width: 'auto',
      advanced: false,
      hidden: false,
    }

    if (adding === 'button') {
      Object.assign(base, {
        label: `Button ${controls.filter(isButton).length + 1}`,
        icon: '',
        color: PALETTE[controls.length % PALETTE.length],
        match: 'all',
        group: '',
        defaultOn: false,
        conditions: [{ tab, column: '', operator: 'is_not_empty', value: '', value2: '' }],
      })
    } else {
      // Point a new control at a column that suits its kind, so it does
      // something sensible the moment it's added rather than needing two
      // more clicks before it will even render.
      const dateCol = cols.find(looksLikeDateColumn)
      const column = ['date', 'dateslider'].includes(adding) ? dateCol || cols[0] || '' : cols[0] || ''
      Object.assign(base, {
        column,
        label: column || meta.label,
        links: [],
        format: 'comma',
        ...(adding === 'threshold' ? { direction: 'gte' } : null),
        ...(adding === 'stepper' ? { steps: '0, 25, 50, 75, 100' } : null),
        ...(adding === 'dateslider' ? { maxDays: 365 } : null),
      })
    }

    ops.add(base)
    setOpenId(base.id)
  }

  if (tabs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
        This page has no tabs yet — connect a spreadsheet under “Data Sources”, then select it for this page under
        “Pages”.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <Field label="Add a control" className="w-72">
          <Select value={adding} onChange={setAdding} options={KIND_OPTIONS} />
        </Field>
        <Btn variant="accent" onClick={add}>
          <Plus size={13} /> Add
        </Btn>
        <div className="ml-auto flex items-center gap-3">
          <Toggle
            checked={!hideSearch}
            onChange={(v) => setHideSearch(!v)}
            label="Show the global search box"
          />
        </div>
      </div>

      {controls.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
          No controls yet. Add a dropdown, a slider or a condition button above — they’ll appear on the dashboard in
          the order you list them here.
        </p>
      )}

      {/* --- The controls -------------------------------------------- */}
      <div className="space-y-2">
        {controls.map((control, index) => {
          const open = openId === control.id
          const meta = kindMeta(control.kind)
          const set = (patch) => ops.update(control.id, patch)
          const cols = columnsOf(control.tab)

          return (
            <div
              key={control.id}
              className={`rounded-xl border bg-white transition-colors ${
                open ? 'border-indigo-300 p-3 shadow-sm' : 'border-slate-200 p-2'
              } ${control.hidden ? 'opacity-50' : ''}`}
            >
              <div className={`flex flex-wrap items-center gap-2 ${open ? 'mb-2' : ''}`}>
                <button
                  onClick={() => setOpenId(open ? null : control.id)}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <ChevronRight size={15} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
                </button>
                <span className="w-5 text-center text-sm text-slate-400">{meta.icon}</span>

                {open ? (
                  <TextInput value={control.label} onChange={(v) => set({ label: v })} className="w-48" placeholder="Label" />
                ) : (
                  <button onClick={() => setOpenId(control.id)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm font-medium text-ink">{control.label || 'Untitled control'}</p>
                    <p className="truncate text-[11px] text-slate-400">
                      {meta.label}
                      {control.column && ` · ${control.column}`}
                      {control.tab && ` · ${labelFor(control.tab)}`}
                      {controlWidth(control) && ` · ${controlWidth(control)}px`}
                      {control.advanced && ' · behind “More”'}
                      {control.hidden && ' · hidden'}
                      {isButton(control) && control.group && ` · group “${control.group}”`}
                    </p>
                  </button>
                )}

                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => ops.add({ ...control, id: uid('c'), label: `${control.label} (copy)` })}
                    className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                    title="Duplicate"
                  >
                    <Copy size={14} />
                  </button>
                  <RowControls
                    onUp={() => ops.move(index, -1)}
                    onDown={() => ops.move(index, 1)}
                    onDelete={() => ops.remove(control.id)}
                    isFirst={index === 0}
                    isLast={index === controls.length - 1}
                  />
                </div>
              </div>

              {open && (
                <div className="space-y-2 border-t border-slate-100 pt-2">
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <Field label="Kind">
                      <Select value={control.kind} onChange={(v) => set({ kind: v })} options={KIND_OPTIONS} />
                    </Field>
                    <Field label="Tab">
                      <Select value={control.tab} onChange={(v) => set({ tab: v, column: '' })} options={tabs} />
                    </Field>
                    {kindNeedsColumn(control.kind) && (
                      <Field label="Column">
                        <Select
                          value={control.column || ''}
                          onChange={(v) => set({ column: v, label: control.label || v })}
                          options={cols}
                          placeholder="— pick a column —"
                        />
                      </Field>
                    )}
                    <Field
                      label="Width (px)"
                      hint={
                        controlWidth(control)
                          ? `Exactly ${controlWidth(control)}px on the dashboard.`
                          : 'Blank fits the contents.'
                      }
                    >
                      <div className="flex items-center gap-1">
                        <TextInput
                          type="number"
                          value={control.widthPx ?? ''}
                          onChange={(v) =>
                            // Clearing the box removes the pin AND any named
                            // size the page was saved with, so "blank" really
                            // does mean "fit contents". Cleared is `null`,
                            // never `undefined` -- Firestore rejects the
                            // latter and takes the whole document with it.
                            set({ widthPx: v === '' ? null : Number(v), width: null })
                          }
                          placeholder="auto"
                          className="w-20"
                        />
                        <div className="flex flex-wrap gap-0.5">
                          {WIDTH_PRESETS.map((preset) => (
                            <button
                              key={preset.label}
                              onClick={() => set({ widthPx: preset.px, width: null })}
                              className={`rounded border px-1 py-0.5 text-[10px] transition-colors ${
                                controlWidth(control) === preset.px
                                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                              }`}
                              title={preset.px ? `${preset.px}px` : 'Fit contents'}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </Field>
                  </div>

                  {/* --- Button specifics -------------------------------- */}
                  {isButton(control) && (
                    <>
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                        <Field label="Icon">
                          <TextInput value={control.icon} onChange={(v) => set({ icon: v })} placeholder="⏳" />
                        </Field>
                        <Field label="Colour">
                          <input
                            type="color"
                            value={control.color || PALETTE[0]}
                            onChange={(e) => set({ color: e.target.value })}
                            className="h-[30px] w-full rounded-lg border border-slate-200"
                          />
                        </Field>
                        <Field label="Match" hint="How its conditions combine.">
                          <Select
                            value={control.match || 'all'}
                            onChange={(v) => set({ match: v })}
                            options={[
                              { value: 'all', label: 'ALL conditions (AND)' },
                              { value: 'any', label: 'ANY condition (OR)' },
                            ]}
                          />
                        </Field>
                        <Field
                          label="Group"
                          hint="Buttons sharing a group act like radio buttons — only one on at a time."
                        >
                          <TextInput value={control.group} onChange={(v) => set({ group: v })} placeholder="e.g. stage" />
                        </Field>
                      </div>

                      <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
                        <p className="mb-1.5 text-[11px] font-medium text-slate-500">Conditions</p>
                        <ConditionBuilder
                          conditions={control.conditions || []}
                          match={control.match || 'all'}
                          tabs={tabs}
                          tabHeaders={tabHeaders}
                          onChange={(conditions) => set({ conditions })}
                        />
                        <p className="mt-1 text-[10px] text-slate-400">
                          A condition names its own tab, so one button can narrow several — and widgets on tabs it
                          never mentions are left alone.
                        </p>
                      </div>
                    </>
                  )}

                  {/* --- Slider tuning ----------------------------------- */}
                  {SLIDER_FILTER_KINDS.includes(control.kind) && (
                    <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-100 bg-slate-50/50 p-2 md:grid-cols-4">
                      {control.kind === 'dateslider' ? (
                        <Field label="Longest span (days)" hint="At the far end it reads “all”.">
                          <TextInput
                            type="number"
                            value={control.maxDays ?? 365}
                            onChange={(v) => set({ maxDays: Number(v) || 365 })}
                          />
                        </Field>
                      ) : control.kind === 'stepper' ? (
                        <Field label="Steps" className="md:col-span-2" hint="Comma-separated; the slider snaps to these.">
                          <TextInput
                            value={control.steps || ''}
                            onChange={(v) => set({ steps: v })}
                            placeholder="0, 100000, 500000"
                          />
                        </Field>
                      ) : (
                        <>
                          <Field label="Min" hint="Blank reads it from the data.">
                            <TextInput
                              type="number"
                              value={control.min ?? ''}
                              onChange={(v) => set({ min: v === '' ? null : Number(v) })}
                              placeholder="auto"
                            />
                          </Field>
                          <Field label="Max" hint="Blank reads it from the data.">
                            <TextInput
                              type="number"
                              value={control.max ?? ''}
                              onChange={(v) => set({ max: v === '' ? null : Number(v) })}
                              placeholder="auto"
                            />
                          </Field>
                          <Field label="Step">
                            <TextInput
                              type="number"
                              value={control.step ?? ''}
                              onChange={(v) => set({ step: v === '' ? null : Number(v) })}
                              placeholder="auto"
                            />
                          </Field>
                        </>
                      )}

                      {control.kind === 'threshold' && (
                        <Field label="Direction">
                          <Select
                            value={control.direction || 'gte'}
                            onChange={(v) => set({ direction: v })}
                            options={[
                              { value: 'gte', label: 'At least (≥)' },
                              { value: 'lte', label: 'At most (≤)' },
                            ]}
                          />
                        </Field>
                      )}

                      {control.kind !== 'dateslider' && (
                        <Field label="Number format">
                          <Select
                            value={control.format || 'comma'}
                            onChange={(v) => set({ format: v })}
                            options={NUMBER_FORMATS}
                          />
                        </Field>
                      )}
                    </div>
                  )}

                  {/* --- Linked tabs ------------------------------------- */}
                  {!isButton(control) && (
                    <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
                      <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-slate-500">
                        <LinkIcon size={11} /> Also narrow these tabs with the same value
                        <span className="font-normal text-slate-400">(optional)</span>
                      </p>

                      <div className="space-y-1.5">
                        {(control.links || []).map((link, li) => (
                          <div key={li} className="flex items-center gap-2">
                            <Select
                              value={link.tab}
                              onChange={(v) => {
                                const next = [...control.links]
                                next[li] = { tab: v, column: '' }
                                set({ links: next })
                              }}
                              options={tabs.filter((t) => optValue(t) !== control.tab)}
                              placeholder="— tab —"
                              className="w-48"
                            />
                            <Select
                              value={link.column}
                              onChange={(v) => {
                                const next = [...control.links]
                                next[li] = { ...next[li], column: v }
                                set({ links: next })
                              }}
                              options={columnsOf(link.tab)}
                              placeholder="— column —"
                              className="w-56"
                            />
                            <button
                              onClick={() => set({ links: control.links.filter((_, i) => i !== li) })}
                              className="text-slate-300 hover:text-rose-500"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>

                      <button
                        onClick={() => set({ links: [...(control.links || []), { tab: '', column: '' }] })}
                        className="mt-1.5 text-[11px] text-indigo-600 underline disabled:opacity-40"
                        disabled={tabs.length < 2}
                      >
                        + link another tab
                      </button>
                      <p className="mt-1 text-[10px] text-slate-400">
                        Tabs not listed here are untouched, so a MASTER filter can’t accidentally empty your GOOGLE
                        REVIEW table.
                      </p>
                    </div>
                  )}

                  {/* --- Placement --------------------------------------- */}
                  <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 pt-2">
                    <Toggle
                      checked={!!control.advanced}
                      onChange={(v) => set({ advanced: v })}
                      label="Tuck behind “More”"
                    />
                    <Toggle checked={!control.hidden} onChange={(v) => set({ hidden: !v })} label="Visible" />
                    {isButton(control) ? (
                      <Toggle
                        checked={!!control.defaultOn}
                        onChange={(v) => set({ defaultOn: v })}
                        label="On by default"
                      />
                    ) : (
                      <Field label="Default value" className="w-48" hint="Blank opens unfiltered.">
                        <TextInput
                          value={control.defaultValue ?? ''}
                          onChange={(v) => set({ defaultValue: v })}
                          placeholder="—"
                        />
                      </Field>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <ViewsEditor views={views} setViews={setViews} controls={controls} />
    </div>
  )
}

/**
 * Saved views: a named snapshot of every control's value.
 *
 * "This month's pending invoices" becomes one click rather than six, and
 * because a view stores control VALUES rather than raw conditions, it keeps
 * working when an admin later re-tunes what a control does.
 */
function ViewsEditor({ views, setViews, controls }) {
  const ops = listOps(views, setViews)

  return (
    <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1 text-[11px] font-medium text-emerald-700">
          <Bookmark size={11} /> Saved views ({views.length})
        </p>
        <Btn onClick={() => ops.add(emptyView(`View ${views.length + 1}`))} className="!py-0.5">
          <Plus size={11} /> Add view
        </Btn>
        <p className="ml-auto max-w-md text-[10px] text-slate-500">
          A view is a one-click preset of the controls above. Set the values here by control; users see them as
          buttons at the top of the bar.
        </p>
      </div>

      {views.length === 0 && (
        <p className="py-1 text-[10px] text-slate-400">
          None. Views are worth adding once people are setting the same three controls every morning.
        </p>
      )}

      <div className="space-y-2">
        {views.map((view, index) => {
          const set = (patch) => ops.update(view.id, patch)
          return (
            <div key={view.id} className="rounded-lg border border-slate-200 bg-white p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <TextInput value={view.label} onChange={(v) => set({ label: v })} placeholder="View name" className="w-44" />
                <TextInput value={view.icon} onChange={(v) => set({ icon: v })} placeholder="⭐" className="w-14" />
                <input
                  type="color"
                  value={view.color || PALETTE[0]}
                  onChange={(e) => set({ color: e.target.value })}
                  className="h-[30px] w-10 rounded-lg border border-slate-200"
                />
                <div className="ml-auto">
                  <RowControls
                    onUp={() => ops.move(index, -1)}
                    onDown={() => ops.move(index, 1)}
                    onDelete={() => ops.remove(view.id)}
                    isFirst={index === 0}
                    isLast={index === views.length - 1}
                  />
                </div>
              </div>

              <div className="mt-1.5 grid grid-cols-1 gap-1 md:grid-cols-2">
                {controls.map((control) =>
                  isButton(control) ? (
                    <label key={control.id} className="flex items-center gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={(view.buttons || []).includes(control.id)}
                        onChange={() => {
                          const on = (view.buttons || []).includes(control.id)
                          set({
                            buttons: on
                              ? view.buttons.filter((b) => b !== control.id)
                              : [...(view.buttons || []), control.id],
                          })
                        }}
                      />
                      <span className="truncate text-slate-600">{control.label}</span>
                    </label>
                  ) : (
                    <div key={control.id} className="flex items-center gap-1.5">
                      <span className="w-28 shrink-0 truncate text-[11px] text-slate-500" title={control.label}>
                        {control.label}
                      </span>
                      <TextInput
                        value={
                          typeof view.values?.[control.id] === 'object'
                            ? JSON.stringify(view.values[control.id])
                            : view.values?.[control.id] ?? ''
                        }
                        onChange={(v) => {
                          const next = { ...(view.values || {}) }
                          // A range control's value is an object; accepting
                          // JSON here means one text box can express every
                          // control kind without a bespoke editor each.
                          if (v === '') delete next[control.id]
                          else if (v.trim().startsWith('{')) {
                            try {
                              next[control.id] = JSON.parse(v)
                            } catch {
                              next[control.id] = v
                            }
                          } else next[control.id] = v
                          set({ values: next })
                        }}
                        placeholder="— any —"
                      />
                    </div>
                  )
                )}
                {controls.length === 0 && (
                  <p className="text-[10px] text-slate-400">Add some controls first.</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
