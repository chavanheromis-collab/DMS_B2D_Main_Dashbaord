import { ArrowDown, Layers, Plus } from 'lucide-react'
import { AGGREGATIONS, NUMBER_FORMATS, STAGE_PALETTE, aggNeedsColumn, uid } from '../../lib/config'
import {
  DEFAULT_FLOW,
  DEFAULT_FLOW_LEVEL,
  FLOW_LEVEL_KINDS,
  FLOW_PERCENT_BASES,
  FLOW_SORTS,
} from '../../lib/flow'
import ConditionBuilder from './ConditionBuilder.jsx'
import { Btn, Field, RowControls, Select, TextInput, Toggle, listOps, useWorkspaceCtx } from './ui.jsx'

/**
 * Authoring a flow.
 *
 * The one idea an admin has to hold onto: levels are a PATH, not a picture.
 * You describe how to get one level deeper, and the flow applies that at
 * every branch -- so three levels describe a tree of any width, and adding
 * depth is one row, not one row per branch.
 */
export default function FlowEditor({ widget, tabs, tabHeaders, set }) {
  const { labelFor } = useWorkspaceCtx()
  const flow = { ...DEFAULT_FLOW, ...(widget.flow || {}) }
  const setFlow = (patch) => set({ flow: { ...flow, ...patch } })

  const levels = flow.levels || []
  const ops = listOps(levels, (next) => setFlow({ levels: next }))
  const metrics = flow.metrics || []
  const metricOps = listOps(metrics, (next) => setFlow({ metrics: next }))

  const columnsOf = (tab) => tabHeaders?.[tab] || []
  const rootCols = columnsOf(widget.tab)

  // Which tab is in play at each level: the widget's own, until a hop
  // changes the subject. Every column picker below depends on this, and
  // getting it wrong is the one mistake that makes a flow silently empty.
  const tabAt = (index) => {
    let tab = widget.tab
    for (let i = 0; i < index; i += 1) {
      if (levels[i]?.kind === 'hop' && levels[i]?.tab) tab = levels[i].tab
    }
    return tab
  }

  function addLevel(kind) {
    const index = levels.length
    ops.add({
      ...DEFAULT_FLOW_LEVEL,
      id: uid('fl'),
      kind,
      column: kind === 'split' ? columnsOf(tabAt(index))[0] || '' : '',
      branches:
        kind === 'rules'
          ? [
              {
                id: uid('fb'),
                label: 'Branch 1',
                icon: '',
                color: STAGE_PALETTE[0],
                match: 'all',
                conditions: [{ tab: tabAt(index), column: '', operator: 'is_not_empty', value: '', value2: '' }],
                stop: false,
              },
            ]
          : [],
    })
  }

  return (
    <div className="space-y-3">
      {/* --- the starting number ----------------------------------------- */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2">
        <p className="mb-1.5 text-[11px] font-medium text-slate-500">
          Start from <span className="font-normal text-slate-400">— the number everything below is a share of</span>
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <Field label="Label" className="w-40">
            <TextInput
              value={flow.label || ''}
              onChange={(v) => setFlow({ label: v })}
              placeholder={labelFor(widget.tab) || 'All rows'}
            />
          </Field>
          <Field label="Measure" className="w-52">
            <Select
              value={flow.measure?.aggregation || 'count'}
              onChange={(v) => setFlow({ measure: { ...flow.measure, aggregation: v } })}
              options={AGGREGATIONS}
            />
          </Field>
          {aggNeedsColumn(flow.measure?.aggregation) && (
            <Field label="Of column" className="w-44">
              <Select
                value={flow.measure?.column || ''}
                onChange={(v) => setFlow({ measure: { ...flow.measure, column: v } })}
                options={rootCols}
                placeholder="— column —"
              />
            </Field>
          )}
          <Field label="Format" className="w-40">
            <Select
              value={flow.measure?.format || 'comma'}
              onChange={(v) => setFlow({ measure: { ...flow.measure, format: v } })}
              options={NUMBER_FORMATS}
            />
          </Field>
        </div>

        <p className="mb-1 mt-2 text-[10px] uppercase tracking-wide text-slate-400">
          Only these rows (optional)
        </p>
        <ConditionBuilder
          compact
          conditions={flow.conditions || []}
          match={flow.match || 'all'}
          tabs={[widget.tab]}
          tabHeaders={tabHeaders}
          onChange={(next) => setFlow({ conditions: next })}
        />
      </div>

      {/* --- the path ----------------------------------------------------- */}
      <div>
        <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-slate-500">
          <Layers size={11} /> Then, level by level
        </p>

        <div className="space-y-2">
          {levels.map((level, i) => {
            const setLevel = (patch) => ops.update(level.id, patch)
            const tab = tabAt(i)
            const cols = columnsOf(tab)

            return (
              <div key={level.id} className="rounded-lg border border-slate-200 bg-white p-2">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">
                    {i + 1}
                  </span>
                  <Select
                    value={level.kind || 'split'}
                    onChange={(v) => setLevel({ kind: v })}
                    options={FLOW_LEVEL_KINDS}
                    className="w-56"
                  />
                  <span className="rounded-full bg-slate-100 px-1.5 py-px text-[9px] uppercase tracking-wide text-slate-500">
                    on {labelFor(tab) || 'this tab'}
                  </span>
                  <div className="ml-auto">
                    <RowControls
                      onUp={() => ops.move(i, -1)}
                      onDown={() => ops.move(i, 1)}
                      onDelete={() => ops.remove(level.id)}
                      isFirst={i === 0}
                      isLast={i === levels.length - 1}
                    />
                  </div>
                </div>

                <p className="mb-1.5 text-[10px] text-slate-400">
                  {FLOW_LEVEL_KINDS.find((k) => k.value === (level.kind || 'split'))?.hint}
                </p>

                {(level.kind || 'split') === 'split' && (
                  <SplitLevel level={level} cols={cols} setLevel={setLevel} />
                )}
                {level.kind === 'rules' && (
                  <RulesLevel level={level} tab={tab} tabHeaders={tabHeaders} setLevel={setLevel} />
                )}
                {level.kind === 'hop' && (
                  <HopLevel
                    level={level}
                    fromTab={tab}
                    fromCols={cols}
                    tabs={tabs}
                    tabHeaders={tabHeaders}
                    setLevel={setLevel}
                    labelFor={labelFor}
                  />
                )}
              </div>
            )
          })}
        </div>

        {levels.length > 0 && (
          <div className="flex justify-center py-1">
            <ArrowDown size={12} className="text-slate-300" />
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {FLOW_LEVEL_KINDS.map((kind) => (
            <Btn key={kind.value} onClick={() => addLevel(kind.value)}>
              <Plus size={12} /> {kind.label}
            </Btn>
          ))}
        </div>
      </div>

      {/* --- extra numbers on every node ---------------------------------- */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[11px] font-medium text-slate-500">
            Extra numbers{' '}
            <span className="font-normal text-slate-400">(shown on a branch once it is open)</span>
          </p>
          <Btn
            onClick={() =>
              metricOps.add({
                id: uid('fm'),
                label: 'Value',
                aggregation: 'sum',
                column: rootCols[0] || '',
                format: 'compact',
              })
            }
          >
            <Plus size={11} /> Add
          </Btn>
        </div>

        {metrics.length === 0 && (
          <p className="py-1 text-[10px] text-slate-400">
            None. The flow shows one measure per branch; add a second here to answer "how many, and worth how much"
            without leaving the tree.
          </p>
        )}

        <div className="space-y-1.5">
          {metrics.map((m, i) => {
            const setMetric = (patch) => metricOps.update(m.id, patch)
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-1.5">
                <TextInput
                  value={m.label}
                  onChange={(v) => setMetric({ label: v })}
                  placeholder="Label"
                  className="w-32"
                />
                <Select
                  value={m.aggregation}
                  onChange={(v) => setMetric({ aggregation: v })}
                  options={AGGREGATIONS}
                  className="w-52"
                />
                {aggNeedsColumn(m.aggregation) && (
                  <Select
                    value={m.column || ''}
                    onChange={(v) => setMetric({ column: v })}
                    options={rootCols}
                    placeholder="— column —"
                    className="w-40"
                  />
                )}
                <Select
                  value={m.format || 'comma'}
                  onChange={(v) => setMetric({ format: v })}
                  options={NUMBER_FORMATS}
                  className="w-40"
                />
                <div className="ml-auto">
                  <RowControls
                    onUp={() => metricOps.move(i, -1)}
                    onDown={() => metricOps.move(i, 1)}
                    onDelete={() => metricOps.remove(m.id)}
                    isFirst={i === 0}
                    isLast={i === metrics.length - 1}
                  />
                </div>
              </div>
            )
          })}
        </div>

        <p className="mt-1 text-[10px] text-slate-400">
          Extra numbers are measured on the branch's own rows, so they stay consistent with the tree — and after a
          hop they are measured on the tab the flow has moved to.
        </p>
      </div>

      {/* --- how it reads -------------------------------------------------- */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-2">
        <Field label="Percentages measured against" className="w-64">
          <Select
            value={flow.percentBase || 'parent'}
            onChange={(v) => setFlow({ percentBase: v })}
            options={FLOW_PERCENT_BASES}
          />
        </Field>
        <Field label="Levels open on load" className="w-32" hint="0 shows just the total.">
          <TextInput
            type="number"
            value={flow.autoExpand ?? 1}
            onChange={(v) => setFlow({ autoExpand: Number(v) || 0 })}
          />
        </Field>
        <Field label="Branch limit" className="w-32" hint="Guards “expand all” on a deep flow.">
          <TextInput
            type="number"
            value={flow.maxNodes ?? 400}
            onChange={(v) => setFlow({ maxNodes: Number(v) || 400 })}
          />
        </Field>
        <div className="flex flex-col gap-1 pb-1.5">
          <Toggle
            checked={flow.showBars !== false}
            onChange={(v) => setFlow({ showBars: v })}
            label="Shade each row by its share"
          />
          <Toggle
            checked={flow.showDropOff !== false}
            onChange={(v) => setFlow({ showDropOff: v })}
            label="Show what was lost at each step"
          />
        </div>
      </div>

      <p className="text-[10px] text-slate-400">
        On the dashboard: clicking a branch opens it, the funnel icon filters the whole page to that branch, and the
        zoom icon makes it the temporary top of the tree. A branch that has hopped tabs filters by its key column, so
        the rest of the page follows it across spreadsheets.
      </p>
    </div>
  )
}

function SplitLevel({ level, cols, setLevel }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Break down by" className="w-44">
        <Select
          value={level.column || ''}
          onChange={(v) => setLevel({ column: v })}
          options={cols}
          placeholder="— column —"
        />
      </Field>
      <Field label="Order" className="w-36">
        <Select value={level.sort || 'value_desc'} onChange={(v) => setLevel({ sort: v })} options={FLOW_SORTS} />
      </Field>
      <Field label="Show top" className="w-24" hint="Rest roll up.">
        <TextInput type="number" value={level.top ?? 6} onChange={(v) => setLevel({ top: Number(v) || 0 })} />
      </Field>
      <div className="flex flex-col gap-1 pb-1.5">
        <Toggle
          checked={level.otherBucket !== false}
          onChange={(v) => setLevel({ otherBucket: v })}
          label="Roll the rest into “Other”"
        />
        <Toggle
          checked={level.includeBlanks !== false}
          onChange={(v) => setLevel({ includeBlanks: v })}
          label="Show blanks as their own branch"
        />
        <Toggle
          checked={!!level.allowChange}
          onChange={(v) => setLevel({ allowChange: v })}
          label="Let viewers change this column"
        />
      </div>
    </div>
  )
}

function RulesLevel({ level, tab, tabHeaders, setLevel }) {
  const branches = level.branches || []
  const ops = listOps(branches, (next) => setLevel({ branches: next }))

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <Toggle
          checked={level.exclusive !== false}
          onChange={(v) => setLevel({ exclusive: v })}
          label="First matching branch wins"
        />
        <Toggle
          checked={level.elseBranch !== false}
          onChange={(v) => setLevel({ elseBranch: v })}
          label="Add an “everything else” branch"
        />
        {level.elseBranch !== false && (
          <TextInput
            value={level.elseLabel || ''}
            onChange={(v) => setLevel({ elseLabel: v })}
            placeholder="Everything else"
            className="w-40"
          />
        )}
      </div>

      <p className="text-[10px] text-slate-400">
        {level.exclusive !== false
          ? 'Exclusive: every row lands in exactly one branch, so the level adds up to its parent.'
          : 'Overlapping: a row can appear in several branches, so the level can total more than its parent.'}
      </p>

      {branches.map((branch, i) => {
        const setBranch = (patch) => ops.update(branch.id, patch)
        return (
          <div key={branch.id} className="rounded-lg border border-slate-100 bg-slate-50/70 p-1.5">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <TextInput
                value={branch.label}
                onChange={(v) => setBranch({ label: v })}
                placeholder="Branch name"
                className="w-36"
              />
              <TextInput value={branch.icon} onChange={(v) => setBranch({ icon: v })} placeholder="🔥" className="w-14" />
              <input
                type="color"
                value={branch.color || STAGE_PALETTE[i % STAGE_PALETTE.length]}
                onChange={(e) => setBranch({ color: e.target.value })}
                className="h-[30px] w-9 rounded-lg border border-slate-200"
              />
              <Select
                value={branch.match || 'all'}
                onChange={(v) => setBranch({ match: v })}
                options={[
                  { value: 'all', label: 'ALL (AND)' },
                  { value: 'any', label: 'ANY (OR)' },
                ]}
                className="w-28"
              />
              <Toggle
                checked={!!branch.stop}
                onChange={(v) => setBranch({ stop: v })}
                label="Stop here"
              />
              <div className="ml-auto">
                <RowControls
                  onUp={() => ops.move(i, -1)}
                  onDown={() => ops.move(i, 1)}
                  onDelete={() => ops.remove(branch.id)}
                  isFirst={i === 0}
                  isLast={i === branches.length - 1}
                />
              </div>
            </div>

            <ConditionBuilder
              compact
              conditions={branch.conditions || []}
              match={branch.match || 'all'}
              tabs={[tab]}
              tabHeaders={tabHeaders}
              onChange={(next) => setBranch({ conditions: next })}
            />
          </div>
        )
      })}

      <Btn
        onClick={() =>
          ops.add({
            id: uid('fb'),
            label: `Branch ${branches.length + 1}`,
            icon: '',
            color: STAGE_PALETTE[branches.length % STAGE_PALETTE.length],
            match: 'all',
            conditions: [{ tab, column: '', operator: 'is_not_empty', value: '', value2: '' }],
            stop: false,
          })
        }
      >
        <Plus size={11} /> Add branch
      </Btn>

      <p className="text-[10px] text-slate-400">
        “Stop here” ends the flow for that branch only — which is how a flowchart gets its shape. Lost deals rarely
        need breaking down five more ways.
      </p>
    </div>
  )
}

function HopLevel({ level, fromTab, fromCols, tabs, tabHeaders, setLevel, labelFor }) {
  const toCols = tabHeaders?.[level.tab] || []

  /** Same guess the blend editor makes: an identical name is almost always the key. */
  function pickTab(tab) {
    const cols = tabHeaders?.[tab] || []
    const shared = fromCols.find((c) => cols.includes(c))
    setLevel({ tab, fromKey: shared || level.fromKey || '', toKey: shared || '' })
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Continue on" className="w-48">
          <Select
            value={level.tab || ''}
            onChange={pickTab}
            options={(tabs || []).filter((t) => (typeof t === 'string' ? t : t.value) !== fromTab)}
            placeholder="— pick a tab —"
          />
        </Field>
        <Field label={`Key on ${labelFor(fromTab) || 'this tab'}`} className="w-44">
          <Select
            value={level.fromKey || ''}
            onChange={(v) => setLevel({ fromKey: v })}
            options={fromCols}
            placeholder="— key column —"
          />
        </Field>
        <Field label="Key on the other tab" className="w-44">
          <Select
            value={level.toKey || ''}
            onChange={(v) => setLevel({ toKey: v })}
            options={toCols}
            placeholder={level.tab ? '— key column —' : 'Pick a tab first'}
            disabled={!level.tab}
          />
        </Field>
        <Field label="Label" className="w-36">
          <TextInput
            value={level.label || ''}
            onChange={(v) => setLevel({ label: v })}
            placeholder={labelFor(level.tab) || 'Other tab'}
          />
        </Field>
      </div>

      <p className="text-[10px] text-slate-400">
        The branch becomes the rows of that tab whose key appears in the rows above it — so “812 vehicles” can become
        “1,940 service jobs”, and every level after this one reads the new tab's columns. Filtering from below a hop
        travels by key, which is what carries it to every other widget on the page.
      </p>
    </div>
  )
}
