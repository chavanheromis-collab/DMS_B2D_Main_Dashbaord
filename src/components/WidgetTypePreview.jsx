/**
 * What a widget type actually looks like, before you add one.
 *
 * A list of sixteen names tells you nothing about the difference between a
 * combo chart and a stacked one, and the way anybody finds out is by adding
 * both and deleting one. A sketch answers it in the time it takes to move
 * the mouse.
 *
 * Deliberately a SKETCH and not a live render. A real one would need a tab,
 * columns, an aggregation and rows -- none of which exist before the widget
 * does -- so it would either be empty or be a lie about your data. Shapes
 * and proportions are the honest thing to promise: this one is bars, that
 * one is bars with a line through them.
 *
 * Plain divs rather than SVG: at this size a rounded rectangle IS the
 * drawing, and it inherits the theme without a single fill attribute.
 */

const BAR = 'rounded-sm bg-indigo-400/70'
const FAINT = 'rounded-sm bg-slate-200'

function Frame({ children, className = '' }) {
  return (
    <div className={`flex h-20 w-36 flex-col gap-1 rounded-lg border border-slate-200 bg-white p-2 ${className}`}>
      {children}
    </div>
  )
}

/** Bars of the given heights, as percentages of the frame. */
function Bars({ heights, className = BAR }) {
  return (
    <div className="flex h-full items-end gap-1">
      {heights.map((h, i) => (
        <div key={i} className={`flex-1 ${className}`} style={{ height: `${h}%` }} />
      ))}
    </div>
  )
}

function Rows({ count = 4, widths = [90, 70, 80, 60] }) {
  return (
    <div className="flex h-full flex-col justify-between py-0.5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`h-1.5 ${FAINT}`} style={{ width: `${widths[i % widths.length]}%` }} />
      ))}
    </div>
  )
}

const SKETCHES = {
  kpi: () => (
    <Frame className="items-start justify-center">
      <div className={`h-1.5 w-10 ${FAINT}`} />
      <div className="text-xl font-bold leading-none text-indigo-500">1,284</div>
      <div className={`h-1 w-14 ${FAINT}`} />
    </Frame>
  ),
  chart: () => (
    <Frame>
      <Bars heights={[40, 75, 55, 95, 30, 60]} />
    </Frame>
  ),
  table: () => (
    <Frame>
      <div className="flex gap-1">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-1.5 flex-1 rounded-sm bg-indigo-300" />
        ))}
      </div>
      <Rows count={4} />
    </Frame>
  ),
  trend: () => (
    <Frame>
      <svg viewBox="0 0 100 40" className="h-full w-full" preserveAspectRatio="none">
        <polyline points="0,32 20,20 40,26 60,10 80,16 100,4" fill="none" stroke="#818cf8" strokeWidth="3" />
      </svg>
    </Frame>
  ),
  leaderboard: () => (
    <Frame>
      {[95, 72, 55, 38].map((w, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className={`h-1.5 w-3 ${FAINT}`} />
          <div className={`h-2 ${BAR}`} style={{ width: `${w}%` }} />
        </div>
      ))}
    </Frame>
  ),
  pivot: () => (
    <Frame>
      <div className="grid h-full grid-cols-4 grid-rows-4 gap-0.5">
        {Array.from({ length: 16 }, (_, i) => (
          <div key={i} className={i % 5 === 0 ? 'rounded-sm bg-indigo-300' : FAINT} />
        ))}
      </div>
    </Frame>
  ),
  heatmap: () => (
    <Frame>
      <div className="grid h-full grid-cols-5 grid-rows-3 gap-0.5">
        {[20, 60, 90, 40, 10, 70, 30, 50, 95, 25, 15, 80, 45, 65, 35].map((v, i) => (
          <div key={i} className="rounded-sm" style={{ backgroundColor: `rgba(79,70,229,${v / 120})` }} />
        ))}
      </div>
    </Frame>
  ),
  stacked: () => (
    <Frame>
      <div className="flex h-full items-end gap-1">
        {[
          [30, 40],
          [50, 25],
          [20, 55],
          [45, 35],
        ].map((pair, i) => (
          <div key={i} className="flex flex-1 flex-col justify-end">
            <div className="rounded-t-sm bg-sky-300" style={{ height: `${pair[1]}%` }} />
            <div className="bg-indigo-400/70" style={{ height: `${pair[0]}%` }} />
          </div>
        ))}
      </div>
    </Frame>
  ),
  combo: () => (
    <Frame className="relative">
      <Bars heights={[40, 65, 50, 85, 45]} />
      <svg viewBox="0 0 100 40" className="pointer-events-none absolute inset-2 h-[calc(100%-1rem)] w-[calc(100%-1rem)]" preserveAspectRatio="none">
        <polyline points="0,26 25,12 50,20 75,6 100,18" fill="none" stroke="#f59e0b" strokeWidth="3" />
      </svg>
    </Frame>
  ),
  scatter: () => (
    <Frame>
      <div className="relative h-full w-full">
        {[
          [10, 70],
          [30, 40],
          [45, 55],
          [60, 20],
          [72, 45],
          [85, 15],
          [25, 80],
        ].map(([x, y], i) => (
          <span
            key={i}
            className="absolute h-2 w-2 rounded-full bg-indigo-400/70"
            style={{ left: `${x}%`, top: `${y}%` }}
          />
        ))}
      </div>
    </Frame>
  ),
  gauge: () => (
    <Frame className="items-center justify-center">
      <svg viewBox="0 0 100 55" className="h-full w-24">
        <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="#e2e8f0" strokeWidth="10" strokeLinecap="round" />
        <path d="M10 50 A40 40 0 0 1 72 19" fill="none" stroke="#4f46e5" strokeWidth="10" strokeLinecap="round" />
      </svg>
    </Frame>
  ),
  scorecard: () => (
    <Frame>
      <div className="flex h-full gap-1.5">
        {['bg-indigo-400/70', 'bg-slate-300'].map((c, i) => (
          <div key={i} className="flex flex-1 flex-col items-center justify-center gap-1 rounded-md bg-slate-50">
            <div className={`h-6 w-6 rounded-full ${c}`} />
            <div className={`h-1 w-8 ${FAINT}`} />
          </div>
        ))}
      </div>
    </Frame>
  ),
  activity: () => (
    <Frame>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
          <div className={`h-1.5 ${FAINT}`} style={{ width: `${80 - i * 12}%` }} />
        </div>
      ))}
    </Frame>
  ),
  pipeline: () => (
    <Frame className="justify-center">
      <div className="flex items-center gap-1">
        {[100, 78, 54, 32].map((h, i) => (
          <div key={i} className="flex-1 rounded-sm bg-indigo-400/70" style={{ height: `${h * 0.36}px` }} />
        ))}
      </div>
    </Frame>
  ),
  flow: () => (
    <Frame className="items-center justify-center">
      <div className="h-3 w-10 rounded-sm bg-indigo-400/70" />
      <div className="h-2 w-px bg-slate-300" />
      <div className="flex gap-1.5">
        <div className="h-3 w-7 rounded-sm bg-sky-300" />
        <div className="h-3 w-7 rounded-sm bg-sky-300" />
        <div className="h-3 w-7 rounded-sm bg-sky-300" />
      </div>
    </Frame>
  ),
  filters: () => (
    <Frame>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-1">
          <div className={`h-2.5 flex-1 rounded-md ${i === 0 ? 'bg-indigo-400/70' : 'border border-slate-200'}`} />
          <div className="h-2.5 flex-1 rounded-md border border-slate-200" />
        </div>
      ))}
    </Frame>
  ),
}

export default function WidgetTypePreview({ type }) {
  const Sketch = SKETCHES[type] || SKETCHES.chart
  return <Sketch />
}
