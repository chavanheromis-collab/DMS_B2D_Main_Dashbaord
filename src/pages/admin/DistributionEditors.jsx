import { Plus, X } from 'lucide-react'
import { NUMBER_FORMATS, PALETTE } from '../../lib/config'
import { SERIES_PALETTES } from '../../lib/seriesData'
import { BOX_ORIENTATIONS, BOX_SORTS } from '../../lib/boxplot'
import { SANKEY_AGGS } from '../../lib/sankeyData'
import { DEFAULT_STOPWORDS, WORD_LAYOUTS, WORD_MODES } from '../../lib/wordCloud'
import { PROFILE_SORTS } from '../../lib/columnProfile'
import { Btn, Field, Select, TextInput, Toggle } from './ui.jsx'
import { ValueColorEditor } from './WidgetEditors.jsx'

// =====================================================================
// Editors for the four distribution widgets
// =====================================================================

function ColorInput({ value, onChange, fallback = PALETTE[0] }) {
  return (
    <input
      type="color"
      value={value || fallback}
      onChange={(e) => onChange(e.target.value)}
      className="h-[30px] w-full rounded-lg border border-slate-200"
    />
  )
}

// =====================================================================
// Box plot
// =====================================================================
export function BoxPlotEditor({ widget, cols, set }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Numeric column" hint="The spread of this is what gets drawn.">
          <Select value={widget.column || ''} onChange={(v) => set({ column: v })} options={cols} placeholder="— column —" />
        </Field>
        <Field label="One box per value of">
          <Select value={widget.groupBy || ''} onChange={(v) => set({ groupBy: v })} options={cols} placeholder="— one box for everything —" />
        </Field>
        <Field label="Orientation">
          <Select value={widget.orientation || 'vertical'} onChange={(v) => set({ orientation: v })} options={BOX_ORIENTATIONS} />
        </Field>
        <Field label="Number format">
          <Select value={widget.format || 'comma'} onChange={(v) => set({ format: v })} options={NUMBER_FORMATS} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Sort boxes by">
          <Select value={widget.sort || 'median_desc'} onChange={(v) => set({ sort: v })} options={BOX_SORTS} />
        </Field>
        <Field label="Most boxes">
          <TextInput type="number" value={widget.limit ?? 10} onChange={(v) => set({ limit: Number(v) || 10 })} />
        </Field>
        <Field
          label="Fewest rows per box"
          hint="Under this, a group is listed rather than drawn — three numbers have no quartiles."
        >
          <TextInput type="number" value={widget.minRows ?? 4} onChange={(v) => set({ minRows: Number(v) || 4 })} />
        </Field>
        <Field label="Height (px)">
          <TextInput type="number" value={widget.height ?? 300} onChange={(v) => set({ height: Number(v) || 300 })} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {widget.groupBy ? (
          <Field label="Palette">
            <Select value={widget.palette || 'default'} onChange={(v) => set({ palette: v })} options={SERIES_PALETTES} />
          </Field>
        ) : (
          <Field label="Colour">
            <ColorInput value={widget.color} onChange={(v) => set({ color: v })} />
          </Field>
        )}
      </div>

      {widget.groupBy && <ValueColorEditor widget={widget} set={set} />}

      <div className="flex flex-wrap gap-3">
        <Toggle
          checked={widget.showOutliers !== false}
          onChange={(v) => set({ showOutliers: v })}
          label="Draw the outliers"
        />
        <Toggle checked={widget.showMean !== false} onChange={(v) => set({ showMean: v })} label="Mark the mean" />
      </div>

      <p className="rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500">
        Whiskers stop at the furthest row still within 1.5× the middle half — not at 1.5× itself, which would point
        at a number nothing reached. Anything beyond gets its own dot.
      </p>
    </div>
  )
}

// =====================================================================
// Sankey
// =====================================================================
export function SankeyEditor({ widget, cols, set }) {
  const stages = widget.stages || []

  const setStage = (index, value) => {
    const next = [...stages]
    next[index] = value
    set({ stages: next })
  }
  const removeStage = (index) => set({ stages: stages.filter((_, i) => i !== index) })

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[11px] font-medium text-slate-500">
            The columns, in order <span className="font-normal text-slate-400">(at least two)</span>
          </p>
          <Btn onClick={() => set({ stages: [...stages, ''] })}>
            <Plus size={11} /> Add stage
          </Btn>
        </div>

        {stages.length === 0 && (
          <p className="py-1 text-[10px] text-slate-400">
            None yet. Two columns draws one set of ribbons; three draws the whole journey — source, then status, then
            outcome.
          </p>
        )}

        <div className="space-y-1.5">
          {stages.map((stage, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-4 shrink-0 text-[10px] text-slate-400">{i + 1}</span>
              <Select
                value={stage || ''}
                onChange={(v) => setStage(i, v)}
                options={cols}
                placeholder="— column —"
                className="max-w-xs"
              />
              <button
                onClick={() => removeStage(i)}
                className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                title="Remove"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Ribbon thickness is" hint="Only measures that add up — a node is the sum of what enters it.">
          <Select value={widget.aggregation || 'count'} onChange={(v) => set({ aggregation: v })} options={SANKEY_AGGS} />
        </Field>
        <Field label="Value column">
          <Select
            value={widget.column || ''}
            onChange={(v) => set({ column: v })}
            options={cols}
            placeholder="— column —"
            disabled={!SANKEY_AGGS.find((a) => a.value === (widget.aggregation || 'count'))?.needsColumn}
          />
        </Field>
        <Field label="Number format">
          <Select value={widget.format || 'comma'} onChange={(v) => set({ format: v })} options={NUMBER_FORMATS} />
        </Field>
        <Field label="Palette">
          <Select value={widget.palette || 'default'} onChange={(v) => set({ palette: v })} options={SERIES_PALETTES} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Most nodes per stage" hint="The rest merge into one block, at full weight.">
          <TextInput type="number" value={widget.maxNodes ?? 8} onChange={(v) => set({ maxNodes: Number(v) || 8 })} />
        </Field>
        <Field label="Name for the merged block">
          <TextInput value={widget.otherLabel ?? 'Other'} onChange={(v) => set({ otherLabel: v })} placeholder="Other" />
        </Field>
        <Field label="Drop anything under (%)" hint="0 keeps everything.">
          <TextInput type="number" value={widget.minShare ?? 0} onChange={(v) => set({ minShare: Number(v) || 0 })} />
        </Field>
        <Field label="Height (px)">
          <TextInput type="number" value={widget.height ?? 360} onChange={(v) => set({ height: Number(v) || 360 })} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Node width (px)">
          <TextInput type="number" value={widget.nodeWidth ?? 14} onChange={(v) => set({ nodeWidth: Number(v) || 14 })} />
        </Field>
        <Field label="Gap between nodes (%)">
          <TextInput type="number" value={widget.nodeGap ?? 6} onChange={(v) => set({ nodeGap: Number(v) })} />
        </Field>
        <Field label="Ribbon opacity (0–1)">
          <TextInput
            type="number"
            value={widget.linkOpacity ?? 0.42}
            onChange={(v) => set({ linkOpacity: Number(v) })}
          />
        </Field>
        <Field label="Blank cells shown as">
          <TextInput value={widget.blankLabel ?? '(blank)'} onChange={(v) => set({ blankLabel: v })} />
        </Field>
      </div>

      <ValueColorEditor widget={widget} set={set} />

      <div className="flex flex-wrap gap-3">
        <Toggle checked={widget.showValues !== false} onChange={(v) => set({ showValues: v })} label="Numbers beside the labels" />
        <Toggle
          checked={widget.includeBlank !== false}
          onChange={(v) => set({ includeBlank: v })}
          label="Include rows with a blank at some stage"
        />
      </div>
    </div>
  )
}

// =====================================================================
// Word cloud
// =====================================================================
export function WordCloudEditor({ widget, cols, set }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Text column" hint="Remarks, feedback, reason for loss — the one nothing else can chart.">
          <Select value={widget.column || ''} onChange={(v) => set({ column: v })} options={cols} placeholder="— column —" />
        </Field>
        <Field label="Count">
          <Select value={widget.mode || 'word'} onChange={(v) => set({ mode: v })} options={WORD_MODES} />
        </Field>
        <Field label="Layout">
          <Select value={widget.layout || 'flow'} onChange={(v) => set({ layout: v })} options={WORD_LAYOUTS} />
        </Field>
        <Field label="Most words">
          <TextInput type="number" value={widget.limit ?? 40} onChange={(v) => set({ limit: Number(v) || 40 })} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Ignore words shorter than">
          <TextInput type="number" value={widget.minLength ?? 3} onChange={(v) => set({ minLength: Number(v) || 3 })} />
        </Field>
        <Field label="Ignore words seen fewer than">
          <TextInput type="number" value={widget.minCount ?? 1} onChange={(v) => set({ minCount: Number(v) || 1 })} />
        </Field>
        <Field label="Smallest size (px)">
          <TextInput type="number" value={widget.minSize ?? 12} onChange={(v) => set({ minSize: Number(v) || 12 })} />
        </Field>
        <Field label="Largest size (px)">
          <TextInput type="number" value={widget.maxSize ?? 40} onChange={(v) => set({ maxSize: Number(v) || 40 })} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Colour">
          <Select
            value={widget.colorMode || 'rank'}
            onChange={(v) => set({ colorMode: v })}
            options={[
              { value: 'rank', label: 'One colour, faded by frequency' },
              { value: 'palette', label: 'A colour per word' },
            ]}
          />
        </Field>
        {widget.colorMode === 'palette' ? (
          <Field label="Palette">
            <Select value={widget.palette || 'default'} onChange={(v) => set({ palette: v })} options={SERIES_PALETTES} />
          </Field>
        ) : (
          <Field label="Word colour">
            <ColorInput value={widget.color} onChange={(v) => set({ color: v })} />
          </Field>
        )}
        <div className="flex items-end pb-1.5">
          <Toggle
            checked={widget.caseSensitive}
            onChange={(v) => set({ caseSensitive: v })}
            label="Case matters"
          />
        </div>
      </div>

      <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <Toggle
            checked={widget.useStopwords !== false}
            onChange={(v) => set({ useStopwords: v })}
            label="Ignore these words"
          />
          <Btn onClick={() => set({ stopwords: DEFAULT_STOPWORDS.join(', ') })}>Reset to the standard list</Btn>
        </div>
        <textarea
          value={widget.stopwords ?? DEFAULT_STOPWORDS.join(', ')}
          onChange={(e) => set({ stopwords: e.target.value })}
          disabled={widget.useStopwords === false}
          rows={3}
          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 font-mono text-[11px] disabled:bg-slate-50 disabled:text-slate-400"
          placeholder="the, and, for…"
        />
        <p className="mt-1 text-[10px] text-slate-400">
          Comma separated. Visible and editable on purpose — every business has its own noise words, and a hidden
          list would be a hidden edit to the finding.
        </p>
      </div>
    </div>
  )
}

// =====================================================================
// Column profile
// =====================================================================
export function ProfileEditor({ widget, cols, set }) {
  const chosen = widget.columns || []
  const toggle = (col) =>
    set({ columns: chosen.includes(col) ? chosen.filter((c) => c !== col) : [...chosen, col] })

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Order by">
          <Select value={widget.sort || 'sheet'} onChange={(v) => set({ sort: v })} options={PROFILE_SORTS} />
        </Field>
        <Field label="Commonest values to list">
          <TextInput type="number" value={widget.topValues ?? 5} onChange={(v) => set({ topValues: Number(v) || 5 })} />
        </Field>
        <Field label="Warn under (% filled)">
          <TextInput
            type="number"
            value={widget.fillWarning ?? 90}
            onChange={(v) => set({ fillWarning: Number(v) || 90 })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-3">
        <Toggle
          checked={widget.problemsOnly}
          onChange={(v) => set({ problemsOnly: v })}
          label="Only columns with something to flag"
        />
        <Toggle
          checked={widget.showSamples !== false}
          onChange={(v) => set({ showSamples: v })}
          label="Show the commonest values"
        />
      </div>

      <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[11px] font-medium text-slate-500">
            Columns to profile{' '}
            <span className="font-normal text-slate-400">
              {chosen.length === 0 ? '(none picked — every column)' : `(${chosen.length} picked)`}
            </span>
          </p>
          {chosen.length > 0 && <Btn onClick={() => set({ columns: [] })}>Clear</Btn>}
        </div>
        <div className="flex flex-wrap gap-1">
          {cols.map((col) => (
            <button
              key={col}
              onClick={() => toggle(col)}
              className={`rounded-lg border px-2 py-0.5 text-[11px] transition-colors ${
                chosen.includes(col)
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              {col}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
