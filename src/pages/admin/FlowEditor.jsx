import { useState } from 'react'
import { ArrowDown, ChevronRight, Layers, Plus } from 'lucide-react'
import { AGGREGATIONS, NUMBER_FORMATS, STAGE_PALETTE, aggNeedsColumn, uid } from '../../lib/config'
import {
  DEFAULT_FLOW,
  DEFAULT_FLOW_LEVEL,
  FLOW_LEVEL_KINDS,
  FLOW_PERCENT_BASES,
  FLOW_SORTS,
  defaultFlowTree,
  flowRootTab,
  flowTreeColumns,
  flowTrees,
} from '../../lib/flow'
import { blendIsReady } from '../../lib/blend'
import { FLOW_ORIENTATIONS } from '../../lib/flowLayout'
import BlendEditor from './BlendEditor.jsx'
import ConditionBuilder from './ConditionBuilder.jsx'
import { Btn, Field, RowControls, Select, TextInput, Toggle, listOps, optValue, useWorkspaceCtx } from './ui.jsx'
import { BucketPicker } from './WidgetEditors.jsx'
import EmojiPicker from './EmojiPicker.jsx'

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

  const metrics = flow.metrics || []
  const metricOps = listOps(metrics, (next) => setFlow({ metrics: next }))

  // Always edited as a list, even when there is one of them. The legacy
  // single-tree shape is read AS a list (see flowTrees), so the first edit
  // simply writes the list back and the two forms never have to coexist in
  // the editor's head.
  const trees = flowTrees(widget)
  const setTrees = (next) => setFlow({ trees: next, levels: [], conditions: [] })
  const treeOps = listOps(trees, setTrees)

  const columnsOf = (tab) => tabHeaders?.[tab] || []
  const rootCols = columnsOf(flowRootTab(widget))

  function addTree() {
    treeOps.add({
      ...defaultFlowTree(uid('tr'), optValue(tabs?.[0]) || flowRootTab(widget)),
      label: `Tree ${trees.length + 1}`,
      color: STAGE_PALETTE[trees.length % STAGE_PALETTE.length],
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
          <Layers size={11} /> {trees.length > 1 ? `${trees.length} trees on one canvas` : 'The tree'}
        </p>
        <Btn onClick={addTree}>
          <Plus size={11} /> Add another tree
        </Btn>
      </div>

      {trees.map((tree, i) => (
        <TreeEditor
          key={tree.id}
          tree={tree}
          index={i}
          count={trees.length}
          widget={widget}
          tabs={tabs}
          tabHeaders={tabHeaders}
          labelFor={labelFor}
          setTree={(patch) => treeOps.update(tree.id, patch)}
          onUp={() => treeOps.move(i, -1)}
          onDown={() => treeOps.move(i, 1)}
          onDelete={() => treeOps.remove(tree.id)}
        />
      ))}

      {trees.length > 1 && (
        <p className="text-[10px] text-slate-400">
          Trees share the canvas, the zoom and the set of open branches — and nothing else. Each has its own table,
          its own starting number and its own levels, so putting three related questions in one picture costs one
          widget rather than three.
        </p>
      )}

      {/* --- extra numbers on every node ---------------------------------- */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[11px] font-medium text-slate-500">
            Extra numbers <span className="font-normal text-slate-400">(shown on a branch once it is open)</span>
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
                <TextInput value={m.label} onChange={(v) => setMetric({ label: v })} placeholder="Label" className="w-32" />
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
        <Field label="Opens as" className="w-40" hint="Readers can switch.">
          <Select
            value={flow.view || 'tree'}
            onChange={(v) => setFlow({ view: v })}
            options={[
              { value: 'tree', label: 'Indented list' },
              { value: 'diagram', label: 'Diagram' },
            ]}
          />
        </Field>
        <Field label="Diagram direction" className="w-40">
          <Select
            value={flow.orientation || 'vertical'}
            onChange={(v) => setFlow({ orientation: v })}
            options={FLOW_ORIENTATIONS}
          />
        </Field>
        <Field label="Diagram height" className="w-28" hint="Pixels.">
          <TextInput
            type="number"
            value={flow.diagramHeight ?? 420}
            onChange={(v) => setFlow({ diagramHeight: Number(v) || 420 })}
          />
        </Field>
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
        zoom icon (or a double-click) makes it the temporary top of the tree. Full screen, fit, ⌘/ctrl + scroll to
        zoom and drag to pan are all on the diagram. A branch that has hopped tabs — or any branch of a blended tree
        — filters by its key column, so the rest of the page follows it across spreadsheets.
      </p>
    </div>
  )
}

/**
 * One tree: where it starts, what it joins, and how it goes deeper.
 *
 * Everything a tree needs is inside its own box, because a canvas with three
 * of them is otherwise impossible to edit -- you cannot tell which "break
 * down by" belongs to which picture.
 */
function TreeEditor({ tree, index, count, widget, tabs, tabHeaders, labelFor, setTree, onUp, onDown, onDelete }) {
  const [open, setOpen] = useState(index === 0)
  const levels = tree.levels || []
  const ops = listOps(levels, (next) => setTree({ levels: next }))

  const columnsOf = (tab) => tabHeaders?.[tab] || []
  // The tree's own rows may be a JOIN, so its columns are the joined ones.
  const rootCols = flowTreeColumns(tree, tabHeaders)

  // Which tab is in play at each level: the tree's own, until something
  // changes the subject. Every column picker below depends on this, and
  // getting it wrong is the one mistake that makes a tree silently empty.
  //
  // Only a hop moves the whole tree: it has one child, so everything below
  // it is on the new tab. A "bring in other tabs" level has several, each
  // starting its own sub-flow, so it cannot move the levels that follow.
  const tabAt = (i) => {
    let tab = tree.tab
    for (let n = 0; n < i; n += 1) {
      if (levels[n]?.kind === 'hop' && levels[n]?.tab) tab = levels[n].tab
    }
    return tab
  }
  const colsAt = (i) => (tabAt(i) === tree.tab ? rootCols : columnsOf(tabAt(i)))

  function addLevel(kind) {
    const i = levels.length
    const tab = tabAt(i)
    ops.add({
      ...DEFAULT_FLOW_LEVEL,
      id: uid('fl'),
      kind,
      column: kind === 'split' ? colsAt(i)[0] || '' : '',
      branches:
        kind === 'rules'
          ? [
              {
                id: uid('fb'),
                label: 'Branch 1',
                icon: '',
                color: STAGE_PALETTE[0],
                match: 'all',
                conditions: [{ tab, column: '', operator: 'is_not_empty', value: '', value2: '' }],
                stop: false,
              },
            ]
          : [],
      measures:
        kind === 'measures'
          ? [{ id: uid('fn'), label: 'Rows', aggregation: 'count', column: null, format: 'comma', conditions: [] }]
          : [],
      sources: kind === 'tables' ? [{ id: uid('ft'), tab: '', label: '', icon: '', conditions: [], match: 'all' }] : [],
    })
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setOpen(!open)}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <ChevronRight size={15} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
          style={{ backgroundColor: tree.color || STAGE_PALETTE[index % STAGE_PALETTE.length] }}
        >
          {index + 1}
        </span>
        <TextInput
          value={tree.label}
          onChange={(v) => setTree({ label: v })}
          placeholder={labelFor(tree.tab) || 'Tree name'}
          className="w-40"
        />
        <EmojiPicker value={tree.icon} onChange={(v) => setTree({ icon: v })} placeholder="🌳" className="w-14" />
        <Select
          value={tree.tab || ''}
          onChange={(v) => setTree({ tab: v, levels: [], conditions: [], measure: { ...tree.measure, column: null } })}
          options={tabs}
          placeholder="— table —"
          className="w-44"
        />
        <span className="text-[10px] text-slate-400">
          {levels.length} {levels.length === 1 ? 'level' : 'levels'}
          {blendIsReady(tree.blend) ? ` · blended with ${labelFor(tree.blend.ref)}` : ''}
        </span>
        {count > 1 && (
          <div className="ml-auto">
            <RowControls onUp={onUp} onDown={onDown} onDelete={onDelete} isFirst={index === 0} isLast={index === count - 1} />
          </div>
        )}
      </div>

      {open && (
        <div className="mt-2 space-y-3">
          {/* --- the starting number ------------------------------------- */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2">
            <p className="mb-1.5 text-[11px] font-medium text-slate-500">
              Start from{' '}
              <span className="font-normal text-slate-400">— the number everything below is a share of</span>
            </p>

            <div className="flex flex-wrap items-end gap-2">
              <Field label="Measure" className="w-52">
                <Select
                  value={tree.measure?.aggregation || 'count'}
                  onChange={(v) => setTree({ measure: { ...tree.measure, aggregation: v } })}
                  options={AGGREGATIONS}
                />
              </Field>
              {aggNeedsColumn(tree.measure?.aggregation) && (
                <Field label="Of column" className="w-44">
                  <Select
                    value={tree.measure?.column || ''}
                    onChange={(v) => setTree({ measure: { ...tree.measure, column: v } })}
                    options={rootCols}
                    placeholder="— column —"
                  />
                </Field>
              )}
              <Field label="Format" className="w-40">
                <Select
                  value={tree.measure?.format || 'comma'}
                  onChange={(v) => setTree({ measure: { ...tree.measure, format: v } })}
                  options={NUMBER_FORMATS}
                />
              </Field>
            </div>

            <p className="mb-1 mt-2 text-[10px] uppercase tracking-wide text-slate-400">Only these rows (optional)</p>
            <ConditionBuilder
              compact
              conditions={tree.conditions || []}
              match={tree.match || 'all'}
              tabs={[tree.tab]}
              tabHeaders={tabHeaders}
              onChange={(next) => setTree({ conditions: next })}
            />
          </div>

          {/* --- the join ------------------------------------------------- */}
          <BlendEditor
            widget={{ id: `${widget.id}_${tree.id}`, tab: tree.tab, blend: tree.blend, title: tree.label }}
            set={(patch) => setTree(patch)}
          />

          {/* --- the path ------------------------------------------------- */}
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-slate-500">
              <Layers size={11} /> Then, level by level
            </p>

            <div className="space-y-2">
              {levels.map((level, i) => {
                const setLevel = (patch) => ops.update(level.id, patch)
                const tab = tabAt(i)
                const cols = colsAt(i)

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

                    {(level.kind || 'split') === 'split' && <SplitLevel level={level} cols={cols} setLevel={setLevel} />}
                    {level.kind === 'rules' && (
                      <RulesLevel level={level} tab={tab} tabHeaders={tabHeaders} setLevel={setLevel} />
                    )}
                    {level.kind === 'measures' && (
                      <MeasuresLevel level={level} tab={tab} cols={cols} tabHeaders={tabHeaders} setLevel={setLevel} />
                    )}
                    {level.kind === 'values' && (
                      <ValuesLevel
                        level={level}
                        cols={cols}
                        tabs={tabs}
                        tabHeaders={tabHeaders}
                        setLevel={setLevel}
                        labelFor={labelFor}
                      />
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
                    {level.kind === 'tables' && (
                      <TablesLevel
                        level={level}
                        tabs={tabs}
                        tabHeaders={tabHeaders}
                        setLevel={setLevel}
                        labelFor={labelFor}
                      />
                    )}

                    {level.kind !== 'measures' && (
                      <MeasureOverride
                        level={level}
                        cols={level.kind === 'hop' ? columnsOf(level.tab || tab) : cols}
                        setLevel={setLevel}
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
        </div>
      )}
    </div>
  )
}

/**
 * A level may report a different number than the one above it -- rows at the
 * top, rupees underneath. Kept out of the way, because most flows measure
 * one thing all the way down and an extra always-visible row of controls
 * would make the common case look harder than it is.
 */
function MeasureOverride({ level, cols, setLevel }) {
  const on = Boolean(level.measure?.aggregation)
  const measure = level.measure || {}

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-1.5">
      <Toggle
        checked={on}
        onChange={(v) => setLevel({ measure: v ? { aggregation: 'sum', column: cols[0] || '', format: 'comma' } : null })}
        label="Measure this level differently"
      />
      {on && (
        <>
          <Select
            value={measure.aggregation || 'sum'}
            onChange={(v) => setLevel({ measure: { ...measure, aggregation: v } })}
            options={AGGREGATIONS}
            className="w-52"
          />
          {aggNeedsColumn(measure.aggregation) && (
            <Select
              value={measure.column || ''}
              onChange={(v) => setLevel({ measure: { ...measure, column: v } })}
              options={cols}
              placeholder="— column —"
              className="w-40"
            />
          )}
          <Select
            value={measure.format || 'comma'}
            onChange={(v) => setLevel({ measure: { ...measure, format: v } })}
            options={NUMBER_FORMATS}
            className="w-36"
          />
          <span className="text-[10px] text-slate-400">
            Percentages fall back to counting rows, since two different numbers cannot be a share of each other.
          </span>
        </>
      )}
    </div>
  )
}

/** Numbers about a branch, rather than a breakdown of it. */
function MeasuresLevel({ level, tab, cols, tabHeaders, setLevel }) {
  const measures = level.measures || []
  const ops = listOps(measures, (next) => setLevel({ measures: next }))
  const [openId, setOpenId] = useState(null)

  return (
    <div className="space-y-1.5">
      {measures.map((m, i) => {
        const setMeasure = (patch) => ops.update(m.id, patch)
        const open = openId === m.id
        const conditions = m.conditions || []

        return (
          <div key={m.id} className="rounded-lg border border-slate-100 bg-slate-50/70 p-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <TextInput
                value={m.label}
                onChange={(v) => setMeasure({ label: v })}
                placeholder="Label"
                className="w-32"
              />
              <EmojiPicker value={m.icon} onChange={(v) => setMeasure({ icon: v })} placeholder="💰" className="w-14" />
              <Select
                value={m.aggregation || 'count'}
                onChange={(v) => setMeasure({ aggregation: v })}
                options={AGGREGATIONS}
                className="w-52"
              />
              {aggNeedsColumn(m.aggregation) && (
                <Select
                  value={m.column || ''}
                  onChange={(v) => setMeasure({ column: v })}
                  options={cols}
                  placeholder="— column —"
                  className="w-40"
                />
              )}
              <Select
                value={m.format || 'comma'}
                onChange={(v) => setMeasure({ format: v })}
                options={NUMBER_FORMATS}
                className="w-36"
              />
              <button
                onClick={() => setOpenId(open ? null : m.id)}
                className="text-[10px] text-indigo-600 underline"
              >
                {conditions.length ? `${conditions.length} condition${conditions.length > 1 ? 's' : ''}` : '+ conditions'}
              </button>
              <div className="ml-auto">
                <RowControls
                  onUp={() => ops.move(i, -1)}
                  onDown={() => ops.move(i, 1)}
                  onDelete={() => ops.remove(m.id)}
                  isFirst={i === 0}
                  isLast={i === measures.length - 1}
                />
              </div>
            </div>

            {open && (
              <div className="mt-1.5">
                <ConditionBuilder
                  compact
                  conditions={conditions}
                  match={m.match || 'all'}
                  tabs={[tab]}
                  tabHeaders={tabHeaders}
                  onChange={(next) => setMeasure({ conditions: next })}
                />
              </div>
            )}
          </div>
        )
      })}

      <Btn
        onClick={() =>
          ops.add({
            id: uid('fn'),
            label: `Number ${measures.length + 1}`,
            aggregation: 'count',
            column: null,
            format: 'comma',
            conditions: [],
            match: 'all',
          })
        }
      >
        <Plus size={11} /> Add a number
      </Btn>

      <p className="text-[10px] text-slate-400">
        Each number keeps the branch's rows (narrowed by its own conditions, if it has any), so it can still be
        opened and drilled like anything else — it just reports something different.
      </p>
    </div>
  )
}

/** Branches read off a reference tab, so a zero is still a branch. */
function ValuesLevel({ level, cols, tabs, tabHeaders, setLevel, labelFor }) {
  const listCols = tabHeaders?.[level.tab] || []

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="List of values lives on" className="w-48">
          <Select
            value={level.tab || ''}
            onChange={(v) => setLevel({ tab: v, column: '' })}
            options={tabs}
            placeholder="— reference tab —"
          />
        </Field>
        <Field label="The column listing them" className="w-44">
          <Select
            value={level.column || ''}
            onChange={(v) => setLevel({ column: v })}
            options={listCols}
            placeholder={level.tab ? '— column —' : 'Pick a tab first'}
            disabled={!level.tab}
          />
        </Field>
        <Field label="Matched against" className="w-44" hint="On this branch's own rows.">
          <Select
            value={level.matchColumn || ''}
            onChange={(v) => setLevel({ matchColumn: v })}
            options={cols}
            placeholder="— column —"
          />
        </Field>
        <Field label="Order" className="w-32">
          <Select value={level.sort || 'value_desc'} onChange={(v) => setLevel({ sort: v })} options={FLOW_SORTS} />
        </Field>
        <Field label="Show top" className="w-24">
          <TextInput type="number" value={level.top ?? 6} onChange={(v) => setLevel({ top: Number(v) || 0 })} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-3">
        <Toggle
          checked={level.showZero !== false}
          onChange={(v) => setLevel({ showZero: v })}
          label="Keep values with no rows"
        />
        <Toggle
          checked={level.unmatchedBucket !== false}
          onChange={(v) => setLevel({ unmatchedBucket: v })}
          label="Add a “not on the list” branch"
        />
      </div>

      <p className="text-[10px] text-slate-400">
        The one way to see a value with <strong>zero</strong> rows: a model nobody sold this month does not exist in
        the sales data, so grouping that data can never reveal it. Reading the branches from{' '}
        <strong>{labelFor(level.tab) || 'a reference tab'}</strong> instead makes the gap visible.
      </p>
    </div>
  )
}

/** Other tabs, brought in whole and related to nothing. */
function TablesLevel({ level, tabs, tabHeaders, setLevel, labelFor }) {
  const sources = level.sources || []
  const ops = listOps(sources, (next) => setLevel({ sources: next }))
  const [openId, setOpenId] = useState(null)

  return (
    <div className="space-y-1.5">
      {sources.map((src, i) => {
        const setSource = (patch) => ops.update(src.id, patch)
        const open = openId === src.id
        const conditions = src.conditions || []

        return (
          <div key={src.id} className="rounded-lg border border-slate-100 bg-slate-50/70 p-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Select
                value={src.tab || ''}
                onChange={(v) => setSource({ tab: v, conditions: [] })}
                options={tabs}
                placeholder="— tab —"
                className="w-48"
              />
              <TextInput
                value={src.label}
                onChange={(v) => setSource({ label: v })}
                placeholder={labelFor(src.tab) || 'Label'}
                className="w-36"
              />
              <EmojiPicker value={src.icon} onChange={(v) => setSource({ icon: v })} placeholder="🗂️" className="w-14" />
              <button
                onClick={() => setOpenId(open ? null : src.id)}
                className="text-[10px] text-indigo-600 underline"
                disabled={!src.tab}
              >
                {conditions.length ? `${conditions.length} condition${conditions.length > 1 ? 's' : ''}` : '+ conditions'}
              </button>
              <div className="ml-auto">
                <RowControls
                  onUp={() => ops.move(i, -1)}
                  onDown={() => ops.move(i, 1)}
                  onDelete={() => ops.remove(src.id)}
                  isFirst={i === 0}
                  isLast={i === sources.length - 1}
                />
              </div>
            </div>

            {open && src.tab && (
              <div className="mt-1.5">
                <ConditionBuilder
                  compact
                  conditions={conditions}
                  match={src.match || 'all'}
                  tabs={[src.tab]}
                  tabHeaders={tabHeaders}
                  onChange={(next) => setSource({ conditions: next })}
                />
              </div>
            )}
          </div>
        )
      })}

      <Btn onClick={() => ops.add({ id: uid('ft'), tab: '', label: '', icon: '', conditions: [], match: 'all' })}>
        <Plus size={11} /> Add a tab
      </Btn>

      <p className="text-[10px] text-slate-400">
        These branches are <strong>not</strong> part of what they hang from, so they show no share and no drop-off —
        a percentage of something they are not inside would be an invention. Use this for a flow that is a map of
        several tables rather than the decomposition of one. Levels below still read the tab that was in play
        <em> above</em> this one; to keep going inside a brought-in tab, give it a flow of its own.
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
      {/* The same bucketing every other place that groups by a column has:
          four hundred dates read as four years. */}
      <BucketPicker widget={level} set={setLevel} label="Bucket the branches" />
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
              <EmojiPicker value={branch.icon} onChange={(v) => setBranch({ icon: v })} placeholder="🔥" className="w-14" />
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
