import { useMemo, useState } from 'react'
import { Bookmark, ChevronRight, Copy, Link as LinkIcon, Lock, Plus, X } from 'lucide-react'
import { NUMBER_FORMATS, PALETTE, SLIDER_FILTER_KINDS, uid } from '../../lib/config'
import { DATE_BUCKETS, looksLikeDateColumn } from '../../lib/dataUtils'
import { controlCoverage } from '../../lib/filterEngine'
import {
  CONTROL_GROUPS,
  CONTROL_MODES,
  WIDTH_PRESETS,
  controlMode,
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

const VIA = {
  own: { label: 'its own tab', cls: 'bg-indigo-50 text-indigo-600 ring-indigo-200' },
  column: { label: 'same column', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  link: { label: 'bound column', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  key: { label: 'by key', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  none: { label: 'not narrowed', cls: 'bg-slate-100 text-slate-400 ring-slate-200' },
}

/**
 * What this control actually does to each tab on the page.
 *
 * Reach is the one setting whose effect is invisible until you save, open
 * the dashboard and notice a table that did not move. Showing the answer
 * where the decision is made turns a guess into a fact -- and the
 * calculation is the engine's own, so it cannot drift from what will happen.
 */
function Coverage({ control, tabColumns, labelFor }) {
  const rows = controlCoverage(control, tabColumns)
  if (rows.length === 0) return null
  const missed = rows.filter((r) => r.via === 'none').length

  return (
    <div className="rounded-lg border border-slate-100 bg-white p-1.5">
      <div className="flex flex-wrap gap-1">
        {rows.map((row) => {
          const via = VIA[row.via] || VIA.none
          return (
            <span
              key={row.tab}
              className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] ring-1 ${via.cls}`}
              title={row.column ? `${labelFor(row.tab)} · ${row.column}` : 'This control says nothing about this tab'}
            >
              <strong className="font-semibold">{labelFor(row.tab)}</strong>
              <span className="opacity-70">{via.label}</span>
            </span>
          )
        })}
      </div>
      {missed > 0 && (
        <p className="mt-1 text-[10px] text-slate-400">
          {missed} {missed === 1 ? 'tab is' : 'tabs are'} left alone. Give the control a key column, or bind one
          below, to reach {missed === 1 ? 'it' : 'them'}.
        </p>
      )}
    </div>
  )
}

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

  // The page's own tabs, as the engine sees them -- so the coverage strip
  // below answers with the same rules the dashboard will actually apply.
  const tabColumns = useMemo(() => {
    const out = {}
    for (const tab of tabs || []) {
      const ref = optValue(tab)
      if (ref) out[ref] = columnsOf(ref)
    }
    return out
  }, [tabs, tabHeaders])

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
      mode: 'live',
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
        // The cautious reach by default: a new control cannot empty a table
        // its author has not thought about yet.
        reach: 'named',
        keyColumn: '',
        keyLinks: [],
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
          const mode = controlMode(control)
          const fixedButDoesNothing =
            mode === 'fixed' &&
            (isButton(control)
              ? !control.defaultOn
              : control.defaultValue === undefined || control.defaultValue === null || control.defaultValue === '')

          return (
            <div
              key={control.id}
              className={`rounded-xl border bg-white transition-colors ${
                open ? 'border-indigo-300 p-3 shadow-sm' : 'border-slate-200 p-2'
              } ${mode === 'off' ? 'opacity-50' : ''} ${mode === 'fixed' ? 'ring-1 ring-indigo-200' : ''}`}
            >
              <div className={`flex flex-wrap items-center gap-2 ${open ? 'mb-2' : ''}`}>
                <button
                  onClick={() => setOpenId(open ? null : control.id)}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <ChevronRight size={15} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
                </button>
                <span className="w-5 text-center text-sm text-slate-400">{meta.icon}</span>

                {mode === 'fixed' && (
                  <span
                    className="flex shrink-0 items-center gap-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-indigo-600"
                    title="Always applied, never shown on the page"
                  >
                    <Lock size={9} /> fixed
                  </span>
                )}

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
                    {['select', 'multi', 'chips'].includes(control.kind) && (
                      <div className="pb-1.5">
                        <Toggle
                          checked={!control.independent}
                          onChange={(v) => set({ independent: !v })}
                          label="Narrow its values to what the page shows"
                        />
                      </div>
                    )}
                    {control.kind === 'chips' && (
                      <Field label="Max chips" hint="0 shows every value.">
                        <TextInput
                          type="number"
                          value={control.maxChips ?? 0}
                          onChange={(v) => set({ maxChips: Math.max(0, Number(v) || 0) })}
                        />
                      </Field>
                    )}
                    {['select', 'multi', 'chips'].includes(control.kind) && (
                      <Field
                        label="Bucket by"
                        hint="A date column, grouped."
                      >
                        <Select
                          value={control.bucket || ''}
                          onChange={(v) => set({ bucket: v })}
                          options={DATE_BUCKETS}
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

                  {/* --- Reach ------------------------------------------- */}
                  {!isButton(control) && (
                    <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
                      <div className="mb-1.5 flex flex-wrap items-end gap-2">
                        <Field label="How far this reaches" className="w-72">
                          <Select
                            value={control.reach || 'named'}
                            onChange={(v) => set({ reach: v })}
                            options={[
                              { value: 'named', label: 'Only its own tab and the ones listed below' },
                              { value: 'auto', label: 'Every tab with a column of this name' },
                              { value: 'key', label: 'The whole page — by column, else by key' },
                            ]}
                          />
                        </Field>
                        {control.reach === 'key' && (
                          <Field label="Key column" className="w-48" hint="Shared id, e.g. VIN.">
                            <Select
                              value={control.keyColumn || ''}
                              onChange={(v) => set({ keyColumn: v })}
                              options={columnsOf(control.tab)}
                              placeholder="— key column —"
                            />
                          </Field>
                        )}
                      </div>

                      <p className="mb-1.5 text-[10px] text-slate-400">
                        {control.reach === 'key'
                          ? 'Tabs without that column are narrowed to the keys still standing on this control’s own tab — so a review table with no “DSE Name” still follows a DSE filter, by VIN.'
                          : control.reach === 'auto'
                            ? 'New tabs are covered the day they are added, as long as the column is named the same.'
                            : 'Tabs not listed are untouched, so a MASTER filter can’t accidentally empty your GOOGLE REVIEW table.'}
                      </p>

                      <Coverage control={control} tabColumns={tabColumns} labelFor={labelFor} />

                      <p className="mb-1 mt-2 flex items-center gap-1 text-[11px] font-medium text-slate-500">
                        <LinkIcon size={11} /> Bind a specific tab to a differently-named column
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
                      {control.reach === 'key' && (
                        <div className="mt-2 border-t border-slate-100 pt-2">
                          <p className="mb-1 text-[11px] font-medium text-slate-500">
                            Key column on other tabs{' '}
                            <span className="font-normal text-slate-400">
                              (only where it isn’t also called “{control.keyColumn || '—'}”)
                            </span>
                          </p>
                          <div className="space-y-1.5">
                            {(control.keyLinks || []).map((link, li) => (
                              <div key={li} className="flex items-center gap-2">
                                <Select
                                  value={link.tab}
                                  onChange={(v) => {
                                    const next = [...(control.keyLinks || [])]
                                    next[li] = { tab: v, column: '' }
                                    set({ keyLinks: next })
                                  }}
                                  options={tabs.filter((t) => optValue(t) !== control.tab)}
                                  placeholder="— tab —"
                                  className="w-48"
                                />
                                <Select
                                  value={link.column}
                                  onChange={(v) => {
                                    const next = [...(control.keyLinks || [])]
                                    next[li] = { ...next[li], column: v }
                                    set({ keyLinks: next })
                                  }}
                                  options={columnsOf(link.tab)}
                                  placeholder="— its key column —"
                                  className="w-56"
                                />
                                <button
                                  onClick={() => set({ keyLinks: (control.keyLinks || []).filter((_, i) => i !== li) })}
                                  className="text-slate-300 hover:text-rose-500"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                          <button
                            onClick={() => set({ keyLinks: [...(control.keyLinks || []), { tab: '', column: '' }] })}
                            className="mt-1.5 text-[11px] text-indigo-600 underline"
                          >
                            + map a tab’s key column
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* --- Placement --------------------------------------- */}
                  <div className="flex flex-wrap items-end gap-4 border-t border-slate-100 pt-2">
                    <Field label="On the page" className="w-72">
                      <Select
                        value={mode}
                        onChange={(v) => set({ mode: v, hidden: v === 'off' })}
                        options={CONTROL_MODES}
                      />
                    </Field>
                    {mode === 'live' && (
                      <div className="pb-1.5">
                        <Toggle
                          checked={!!control.advanced}
                          onChange={(v) => set({ advanced: v })}
                          label="Tuck behind “More”"
                        />
                      </div>
                    )}
                    {isButton(control) ? (
                      <div className="pb-1.5">
                        <Toggle
                          checked={!!control.defaultOn}
                          onChange={(v) => set({ defaultOn: v })}
                          label={mode === 'fixed' ? 'Applied (leave on)' : 'On by default'}
                        />
                      </div>
                    ) : (
                      <Field
                        label={mode === 'fixed' ? 'Fixed value' : 'Default value'}
                        className="w-48"
                        hint={mode === 'fixed' ? 'What the page always shows.' : 'Blank opens unfiltered.'}
                      >
                        <TextInput
                          value={control.defaultValue ?? ''}
                          onChange={(v) => set({ defaultValue: v })}
                          placeholder="—"
                        />
                      </Field>
                    )}
                  </div>

                  {mode === 'fixed' && (
                    <p
                      className={`rounded-lg px-2 py-1 text-[10px] ${
                        fixedButDoesNothing
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-indigo-50/70 text-indigo-600'
                      }`}
                    >
                      {fixedButDoesNothing
                        ? isButton(control)
                          ? 'Switch this on above, or the page rule does nothing.'
                          : 'Give it a fixed value, or the page rule does nothing.'
                        : 'A rule of the page, not a control on it: always applied, never shown, and untouched by Reset or a saved view. Only an admin can change it.'}
                    </p>
                  )}
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
