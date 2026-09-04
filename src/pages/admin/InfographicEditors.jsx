import { Plus } from 'lucide-react'
import { AGGREGATIONS, NUMBER_FORMATS, aggNeedsColumn, uid } from '../../lib/config'
import { SERIES_PALETTES } from '../../lib/seriesData'
import { KPI_SHAPES } from '../../lib/kpiShapes'
import {
  BASE_ENDS,
  NUMBER_STYLES,
  PROCESS_SHAPES,
  PROCESS_SOURCES,
  PYRAMID_SHAPES,
  RING_BASES,
  RING_CENTRES,
  ringBasisIsMeaningful,
} from '../../lib/infographics'
import { Btn, Field, RowControls, Select, TextInput, Toggle, listOps } from './ui.jsx'
import { ValueColorEditor } from './WidgetEditors.jsx'

// =====================================================================
// Editors for the three infographic widgets
// =====================================================================
// Same shape as the editors already here: what is MEASURED at the top,
// how it LOOKS underneath. The one thing these three do that the others
// do not is say out loud when a setting has been left in a state that
// makes the picture meaningless -- a target-based ring with no target
// draws every category full, and looks like success.

/** The measurement row every one of the three opens with. */
function Source({ widget, cols, set, label = 'Split by' }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Field label={label}>
        <Select
          value={widget.groupBy || ''}
          onChange={(v) => set({ groupBy: v })}
          options={cols}
          placeholder="— column —"
        />
      </Field>
      <Field label="Calculation">
        <Select
          value={widget.aggregation || 'count'}
          onChange={(v) => set({ aggregation: v })}
          options={AGGREGATIONS}
        />
      </Field>
      <Field label="Value column">
        <Select
          value={widget.column || ''}
          onChange={(v) => set({ column: v })}
          options={cols}
          placeholder="— column —"
          disabled={!aggNeedsColumn(widget.aggregation || 'count')}
        />
      </Field>
      <Field label="Number format">
        <Select value={widget.format || 'comma'} onChange={(v) => set({ format: v })} options={NUMBER_FORMATS} />
      </Field>
    </div>
  )
}

/** A warning that reads as a sentence, not as a red box with a code in it. */
function Caveat({ children }) {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-700">
      {children}
    </p>
  )
}

// ---------------------------------------------------------------------

export function RingsEditor({ widget, cols, set }) {
  const basis = widget.basis || 'share'
  // The same three dial shapes the KPI card draws, so a ring here and a
  // ring there are the same thing. The solid badge and the flat layouts
  // are not dials and have nothing to fill.
  const shapes = KPI_SHAPES.filter((s) => ['ring', 'gauge', 'arc'].includes(s.value))

  return (
    <div className="space-y-2">
      <Source widget={widget} cols={cols} set={set} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Full means" hint={RING_BASES.find((b) => b.value === basis)?.hint}>
          <Select value={basis} onChange={(v) => set({ basis: v })} options={RING_BASES} />
        </Field>
        <Field label="Target" hint="Only used by “Against a target”.">
          <TextInput
            type="number"
            value={widget.target ?? ''}
            onChange={(v) => set({ target: v === '' ? null : Number(v) })}
            placeholder="e.g. 250"
            disabled={basis !== 'target'}
          />
        </Field>
        <Field label="In the middle">
          <Select value={widget.centre || 'percent'} onChange={(v) => set({ centre: v })} options={RING_CENTRES} />
        </Field>
        <Field label="Most rings" hint="The rest are counted under the card.">
          <TextInput type="number" value={widget.maxRings ?? 4} onChange={(v) => set({ maxRings: Number(v) || 4 })} />
        </Field>
      </div>

      {!ringBasisIsMeaningful(widget) && (
        <Caveat>
          Every ring will draw full until a target is typed — which reads as every category having hit its number.
        </Caveat>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Shape">
          <Select value={widget.shape || 'ring'} onChange={(v) => set({ shape: v })} options={shapes} />
        </Field>
        <Field label="Size (px)">
          <TextInput type="number" value={widget.size ?? 108} onChange={(v) => set({ size: Number(v) || 108 })} />
        </Field>
        <Field label="Thickness (px)">
          <TextInput type="number" value={widget.thickness ?? 12} onChange={(v) => set({ thickness: Number(v) || 12 })} />
        </Field>
        <Field label="Per row">
          <TextInput type="number" value={widget.perRow ?? 4} onChange={(v) => set({ perRow: Number(v) || 4 })} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Palette">
          <Select value={widget.palette || 'default'} onChange={(v) => set({ palette: v })} options={SERIES_PALETTES} />
        </Field>
        <Field label="Track colour" hint="The unfilled part of the circle.">
          <input
            type="color"
            value={widget.trackColor || '#E2E8F0'}
            onChange={(e) => set({ trackColor: e.target.value })}
            className="h-[30px] w-full rounded-lg border border-slate-200"
          />
        </Field>
      </div>

      <ValueColorEditor widget={widget} set={set} />

      <Toggle
        checked={widget.showValue !== false}
        onChange={(v) => set({ showValue: v })}
        label="Show the value under each ring"
      />
    </div>
  )
}

// ---------------------------------------------------------------------

export function ProcessEditor({ widget, cols, set }) {
  const source = widget.source || 'column'
  const steps = widget.steps || []
  const ops = listOps(steps, (next) => set({ steps: next }))

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Steps come from" hint={PROCESS_SOURCES.find((s) => s.value === source)?.hint}>
          <Select value={source} onChange={(v) => set({ source: v })} options={PROCESS_SOURCES} />
        </Field>
        <Field label="Shape" hint={PROCESS_SHAPES.find((s) => s.value === (widget.shape || 'chevron'))?.hint}>
          <Select value={widget.shape || 'chevron'} onChange={(v) => set({ shape: v })} options={PROCESS_SHAPES} />
        </Field>
        <Field label="Numbering">
          <Select
            value={widget.numberStyle || 'pad'}
            onChange={(v) => set({ numberStyle: v })}
            options={NUMBER_STYLES}
          />
        </Field>
        <Field label="Direction">
          <Select
            value={widget.direction || 'row'}
            onChange={(v) => set({ direction: v })}
            options={[
              { value: 'row', label: 'Across' },
              { value: 'column', label: 'Down' },
            ]}
          />
        </Field>
      </div>

      {source === 'column' ? (
        <>
          <Source widget={widget} cols={cols} set={set} label="A step per value of" />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Field label="Most steps">
              <TextInput
                type="number"
                value={widget.maxSteps ?? 5}
                onChange={(v) => set({ maxSteps: Number(v) || 5 })}
              />
            </Field>
            <Field label="Palette">
              <Select
                value={widget.palette || 'default'}
                onChange={(v) => set({ palette: v })}
                options={SERIES_PALETTES}
              />
            </Field>
          </div>
        </>
      ) : (
        <div className="space-y-1.5 rounded-lg border border-slate-100 bg-slate-50/60 p-2">
          {steps.length === 0 && (
            <p className="px-1 text-[11px] text-slate-400">
              No steps yet. A typed process keeps the order you give it, whatever the numbers do.
            </p>
          )}
          {steps.map((step, i) => (
            <div key={step.id} className="flex items-start gap-1.5">
              <span className="mt-2 w-5 text-right text-[11px] font-semibold text-slate-400">{i + 1}</span>
              <div className="grid flex-1 grid-cols-2 gap-1.5 md:grid-cols-5">
                <div className="md:col-span-2">
                  <TextInput
                    value={step.label || ''}
                    onChange={(v) => ops.update(step.id, { label: v })}
                    placeholder="Step name"
                  />
                </div>
                <div className="md:col-span-2">
                  <TextInput
                    value={step.caption || ''}
                    onChange={(v) => ops.update(step.id, { caption: v })}
                    placeholder="A short line under it"
                  />
                </div>
                <TextInput
                  type="number"
                  value={step.value ?? ''}
                  onChange={(v) => ops.update(step.id, { value: v === '' ? null : Number(v) })}
                  placeholder="Figure"
                />
              </div>
              <RowControls
                onUp={() => ops.move(i, -1)}
                onDown={() => ops.move(i, 1)}
                onDelete={() => ops.remove(step.id)}
                isFirst={i === 0}
                isLast={i === steps.length - 1}
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Btn onClick={() => ops.add({ id: uid('ps'), label: `Step ${steps.length + 1}`, caption: '', value: null })}>
              <Plus size={13} /> Add a step
            </Btn>
            <Select
              value={widget.palette || 'default'}
              onChange={(v) => set({ palette: v })}
              options={SERIES_PALETTES}
            />
          </div>
        </div>
      )}

      <ValueColorEditor widget={widget} set={set} />

      <div className="flex flex-wrap gap-3">
        <Toggle checked={widget.showValue !== false} onChange={(v) => set({ showValue: v })} label="Show the figures" />
        {source === 'column' && (
          <Toggle
            checked={Boolean(widget.showShare)}
            onChange={(v) => set({ showShare: v })}
            label="And their share of the total"
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------

export function PyramidEditor({ widget, cols, set }) {
  const shape = widget.shape || 'pyramid'

  return (
    <div className="space-y-2">
      <Source widget={widget} cols={cols} set={set} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Shape" hint={PYRAMID_SHAPES.find((s) => s.value === shape)?.hint}>
          <Select value={shape} onChange={(v) => set({ shape: v })} options={PYRAMID_SHAPES} />
        </Field>
        <Field label="Which end is wide" hint={BASE_ENDS.find((b) => b.value === (widget.baseAt || 'bottom'))?.hint}>
          <Select value={widget.baseAt || 'bottom'} onChange={(v) => set({ baseAt: v })} options={BASE_ENDS} />
        </Field>
        <Field label="Most layers" hint="The rest are counted under the card.">
          <TextInput type="number" value={widget.maxLayers ?? 5} onChange={(v) => set({ maxLayers: Number(v) || 5 })} />
        </Field>
        <Field label="Narrow end (%)" hint="How far the smallest layer pulls in.">
          <TextInput
            type="number"
            value={widget.minWidth ?? 34}
            onChange={(v) => set({ minWidth: Number(v) || 34 })}
            disabled={shape === 'steps'}
          />
        </Field>
      </div>

      {shape === 'pyramid' && (
        <Caveat>
          The layers step in evenly whatever they hold, so the widths are decoration — the numbers on them are what is
          being read. Pick <strong>Funnel</strong> if the taper should mean something.
        </Caveat>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Gap (px)">
          <TextInput type="number" value={widget.gap ?? 4} onChange={(v) => set({ gap: Number(v) })} />
        </Field>
        <Field label="Palette">
          <Select value={widget.palette || 'default'} onChange={(v) => set({ palette: v })} options={SERIES_PALETTES} />
        </Field>
      </div>

      <ValueColorEditor widget={widget} set={set} />

      <div className="flex flex-wrap gap-3">
        <Toggle checked={widget.showValue !== false} onChange={(v) => set({ showValue: v })} label="Show the values" />
        <Toggle
          checked={widget.showShare !== false}
          onChange={(v) => set({ showShare: v })}
          label="Show each layer’s share"
        />
      </div>
    </div>
  )
}
