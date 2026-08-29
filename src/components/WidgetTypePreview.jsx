/**
 * What a widget type actually looks like, before you add one.
 *
 * A list of thirty names tells you nothing about the difference between a
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
 *
 * A `type` of `family:shape` is one of a type's VARIANTS -- "chart:donut",
 * "stacked:grouped" -- which is how the palette draws the twenty-one things
 * hiding behind the word Chart. See lib/widgetVariants.js.
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

  // -------------------------------------------------------------------
  // The later additions. Same rule as the sketches above: shapes and
  // proportions only. A stat grid is "four small numbers in a grid" and a
  // bullet chart is "a bar with a tick on it", and those two sentences are
  // the entire difference somebody needs before they pick one.
  // -------------------------------------------------------------------
  stat: () => (
    <Frame>
      <div className="grid h-full grid-cols-3 grid-rows-2 gap-1">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex flex-col justify-center gap-0.5 rounded bg-slate-50 px-1">
            <div className={`h-1 w-4 ${FAINT}`} />
            <div className="text-[8px] font-bold leading-none text-indigo-500">
              {['482', '91%', '1.2K', '38', '7.4', '12'][i]}
            </div>
          </div>
        ))}
      </div>
    </Frame>
  ),
  bullet: () => (
    <Frame className="justify-center gap-2">
      {[68, 92, 45].map((v, i) => (
        <div key={i} className="relative h-2.5 w-full overflow-hidden rounded-sm">
          <div className="absolute inset-0 flex">
            <div className="w-[55%] bg-rose-100" />
            <div className="w-[30%] bg-amber-100" />
            <div className="flex-1 bg-emerald-100" />
          </div>
          <div className="absolute inset-y-[30%] left-0 rounded-sm bg-indigo-500" style={{ width: `${v}%` }} />
          <div className="absolute inset-y-0 w-[1.5px] bg-slate-800" style={{ left: '78%' }} />
        </div>
      ))}
    </Frame>
  ),
  movers: () => (
    <Frame>
      <div className="flex h-full gap-1.5">
        {[
          { color: 'bg-emerald-400', widths: [80, 55, 34] },
          { color: 'bg-rose-400', widths: [70, 44, 26] },
        ].map((side, i) => (
          <div key={i} className="flex flex-1 flex-col justify-center gap-1">
            {side.widths.map((w, j) => (
              <div key={j} className="flex items-center gap-1">
                <div className={`h-1 flex-1 ${FAINT}`} />
                <div className={`h-1.5 rounded-sm ${side.color}`} style={{ width: `${w * 0.3}%` }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Frame>
  ),
  waffle: () => (
    <Frame className="items-center justify-center">
      <div className="grid grid-cols-10 gap-[2px]">
        {Array.from({ length: 50 }, (_, i) => (
          <span
            key={i}
            className="h-[5px] w-[5px] rounded-[1px]"
            style={{
              backgroundColor: i < 19 ? '#6366f1' : i < 33 ? '#38bdf8' : i < 42 ? '#34d399' : '#e2e8f0',
            }}
          />
        ))}
      </div>
    </Frame>
  ),
  calendar: () => (
    <Frame className="justify-center">
      <div className="flex gap-[2px]">
        {Array.from({ length: 17 }, (_, w) => (
          <div key={w} className="flex flex-col gap-[2px]">
            {Array.from({ length: 7 }, (_, d) => {
              // A fixed pseudo-random pattern -- deliberately not random,
              // so the sketch is the same picture every time it is opened.
              const v = ((w * 7 + d) * 37) % 11
              return (
                <span
                  key={d}
                  className="h-[5px] w-[5px] rounded-[1px]"
                  style={{ backgroundColor: v < 3 ? '#eef2ff' : v < 6 ? '#c7d2fe' : v < 9 ? '#818cf8' : '#4338ca' }}
                />
              )
            })}
          </div>
        ))}
      </div>
    </Frame>
  ),
  gantt: () => (
    <Frame className="justify-center">
      {[
        [0, 45],
        [20, 40],
        [15, 70],
        [55, 40],
      ].map(([left, width], i) => (
        <div key={i} className="relative h-2">
          <div
            className="absolute h-full rounded-sm bg-indigo-400/70"
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        </div>
      ))}
    </Frame>
  ),
  cohort: () => (
    <Frame>
      <div className="grid h-full grid-cols-5 grid-rows-4 gap-[2px]">
        {Array.from({ length: 20 }, (_, i) => {
          const row = Math.floor(i / 5)
          const col = i % 5
          // The empty triangle IS the sketch -- it is what tells a cohort
          // grid apart from a heat map at a glance.
          if (col > 4 - row) return <span key={i} className="rounded-[1px] border border-dashed border-slate-200" />
          const strength = Math.max(0.12, 1 - col * 0.24)
          return <span key={i} className="rounded-[1px]" style={{ backgroundColor: `rgba(79,70,229,${strength})` }} />
        })}
      </div>
    </Frame>
  ),
  boxplot: () => (
    <Frame>
      <div className="flex h-full items-stretch gap-2 px-1">
        {[
          [25, 45, 60],
          [40, 55, 75],
          [15, 30, 50],
          [50, 70, 85],
        ].map(([q1, med, q3], i) => (
          <div key={i} className="relative flex-1">
            <span className="absolute left-1/2 w-px -translate-x-1/2 bg-slate-400" style={{ bottom: `${q1 - 15}%`, height: `${q3 - q1 + 30}%` }} />
            <span
              className="absolute left-1/2 w-full -translate-x-1/2 rounded-sm border border-indigo-500 bg-indigo-400/30"
              style={{ bottom: `${q1}%`, height: `${q3 - q1}%` }}
            />
            <span className="absolute left-1/2 h-[2px] w-full -translate-x-1/2 bg-indigo-600" style={{ bottom: `${med}%` }} />
          </div>
        ))}
      </div>
    </Frame>
  ),
  sankey: () => (
    <Frame className="justify-center">
      <svg viewBox="0 0 100 50" className="h-full w-full" preserveAspectRatio="none">
        <path d="M6,4 C50,4 50,6 94,6 L94,22 C50,22 50,26 6,26 Z" fill="#818cf8" opacity="0.55" />
        <path d="M6,28 C50,28 50,26 94,26 L94,36 C50,36 50,42 6,42 Z" fill="#38bdf8" opacity="0.55" />
        <path d="M6,44 C50,44 50,40 94,40 L94,48 C50,48 50,48 6,48 Z" fill="#34d399" opacity="0.55" />
        <rect x="0" y="2" width="6" height="26" fill="#6366f1" rx="1" />
        <rect x="0" y="30" width="6" height="18" fill="#0ea5e9" rx="1" />
        <rect x="94" y="4" width="6" height="34" fill="#6366f1" rx="1" />
        <rect x="94" y="40" width="6" height="8" fill="#10b981" rx="1" />
      </svg>
    </Frame>
  ),
  wordcloud: () => (
    <Frame className="items-center justify-center">
      <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 leading-none">
        {[
          ['delay', 9],
          ['finance', 14],
          ['approval', 8],
          ['colour', 11],
          ['stock', 7],
          ['delivery', 10],
        ].map(([word, size]) => (
          <span key={word} style={{ fontSize: size, color: '#6366f1', opacity: 0.4 + size / 24 }}>
            {word}
          </span>
        ))}
      </div>
    </Frame>
  ),
  profile: () => (
    <Frame>
      {[
        [96, 'bg-emerald-400'],
        [72, 'bg-amber-400'],
        [41, 'bg-rose-400'],
        [88, 'bg-emerald-400'],
      ].map(([w, color], i) => (
        <div key={i} className="flex items-center gap-1">
          <div className={`h-1.5 w-6 ${FAINT}`} />
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
          </div>
        </div>
      ))}
    </Frame>
  ),
  note: () => (
    <Frame className="justify-center">
      <div className="flex items-center gap-1">
        <div className="h-1.5 w-8 rounded-sm bg-indigo-400/70" />
        <div className="h-px flex-1 bg-slate-200" />
      </div>
      <div className={`h-1 w-full ${FAINT}`} />
      <div className={`h-1 w-4/5 ${FAINT}`} />
      <div className={`h-1 w-3/5 ${FAINT}`} />
    </Frame>
  ),
  media: () => (
    <Frame className="items-center justify-center">
      <div className="flex h-full w-full items-center justify-center rounded-md bg-slate-100">
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-slate-300" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="8.5" cy="9.5" r="1.5" />
          <path d="M21 16l-5-5-4 4-2-2-5 5" />
        </svg>
      </div>
    </Frame>
  ),
  countdown: () => (
    <Frame className="items-center justify-center">
      <div className={`h-1 w-10 ${FAINT}`} />
      <div className="flex items-end gap-1.5">
        {['12', '04', '38'].map((n, i) => (
          <div key={i} className="flex flex-col items-center">
            <span className="text-sm font-bold leading-none text-indigo-500">{n}</span>
            <span className={`mt-0.5 h-[3px] w-3 ${FAINT}`} />
          </div>
        ))}
      </div>
    </Frame>
  ),
}

// ---------------------------------------------------------------------
// The shapes behind one name
// ---------------------------------------------------------------------
// Twenty-one chart styles, drawn rather than listed. Several share a
// drawing: a bar and a cylinder bar differ by a rounded top, which is not a
// difference worth two sketches -- see lib/widgetVariants.js, which decides
// which shapes share which.

/** Horizontal bars of the given widths. */
function HBars({ widths }) {
  return (
    <div className="flex h-full flex-col justify-between py-0.5">
      {widths.map((w, i) => (
        <div key={i} className={`h-2 ${BAR}`} style={{ width: `${w}%` }} />
      ))}
    </div>
  )
}

/** A polyline across the frame, as a fraction of its height. */
function Line({ points, area = false }) {
  const path = points.map((y, i) => `${(i / (points.length - 1)) * 100},${100 - y}`).join(' ')
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
      {area && <polygon points={`0,100 ${path} 100,100`} className="fill-indigo-400/25" />}
      <polyline
        points={path}
        fill="none"
        className="stroke-indigo-400"
        strokeWidth="6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

const VARIANTS = {
  // --- vertical bars ------------------------------------------------
  'chart:bar': () => (
    <Frame>
      <Bars heights={[45, 80, 60, 95, 35]} />
    </Frame>
  ),
  'chart:histogram': () => (
    <Frame>
      <div className="flex h-full items-end">
        {[20, 45, 80, 95, 70, 40, 18].map((h, i) => (
          <div key={i} className="flex-1 bg-indigo-400/70" style={{ height: `${h}%` }} />
        ))}
      </div>
    </Frame>
  ),
  'chart:lollipop': () => (
    <Frame>
      <div className="flex h-full items-end gap-1">
        {[45, 80, 60, 95, 35].map((h, i) => (
          <div key={i} className="flex flex-1 flex-col items-center justify-end" style={{ height: '100%' }}>
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
            <span className="w-[2px] flex-none bg-indigo-300" style={{ height: `${h}%` }} />
          </div>
        ))}
      </div>
    </Frame>
  ),
  'chart:waterfall': () => (
    <Frame>
      <div className="flex h-full items-end gap-1">
        {[
          { h: 40, b: 0 },
          { h: 22, b: 40 },
          { h: 18, b: 44 },
          { h: 26, b: 26 },
          { h: 62, b: 0 },
        ].map((s, i) => (
          <div key={i} className="relative h-full flex-1">
            <div className={`absolute w-full ${BAR}`} style={{ height: `${s.h}%`, bottom: `${s.b}%` }} />
          </div>
        ))}
      </div>
    </Frame>
  ),
  'chart:pareto': () => (
    <Frame className="relative">
      <Bars heights={[90, 65, 45, 28, 15]} />
      <div className="pointer-events-none absolute inset-2">
        <Line points={[35, 58, 74, 86, 95]} />
      </div>
    </Frame>
  ),

  // --- horizontal bars ----------------------------------------------
  'chart:hbar': () => (
    <Frame>
      <HBars widths={[90, 70, 55, 35]} />
    </Frame>
  ),
  'chart:funnel': () => (
    <Frame className="items-center">
      {[95, 74, 52, 30].map((w, i) => (
        <div key={i} className={`h-3 ${BAR}`} style={{ width: `${w}%` }} />
      ))}
    </Frame>
  ),

  // --- lines --------------------------------------------------------
  'chart:line': () => (
    <Frame>
      <Line points={[30, 55, 40, 78, 62, 90]} />
    </Frame>
  ),
  'chart:area': () => (
    <Frame>
      <Line points={[30, 55, 40, 78, 62, 90]} area />
    </Frame>
  ),

  // --- round --------------------------------------------------------
  'chart:pie': () => (
    <Frame className="items-center justify-center">
      <div
        className="h-12 w-12 rounded-full"
        style={{ background: 'conic-gradient(rgb(99 102 241 / .8) 0 45%, rgb(129 140 248 / .6) 45% 72%, rgb(199 210 254) 72% 100%)' }}
      />
    </Frame>
  ),
  'chart:donut': () => (
    <Frame className="items-center justify-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: 'conic-gradient(rgb(99 102 241 / .8) 0 45%, rgb(129 140 248 / .6) 45% 72%, rgb(199 210 254) 72% 100%)' }}
      >
        <span className="h-6 w-6 rounded-full bg-white" />
      </div>
    </Frame>
  ),
  'chart:radial': () => (
    <Frame className="items-center justify-center">
      <div className="relative h-12 w-12">
        {[
          { s: 48, c: 'border-indigo-500' },
          { s: 34, c: 'border-indigo-400' },
          { s: 20, c: 'border-indigo-300' },
        ].map((r, i) => (
          <span
            key={i}
            className={`absolute rounded-full border-[3px] border-r-transparent border-t-transparent ${r.c}`}
            style={{ width: r.s, height: r.s, left: (48 - r.s) / 2, top: (48 - r.s) / 2 }}
          />
        ))}
      </div>
    </Frame>
  ),
  'chart:circles': () => (
    <Frame className="items-center justify-center">
      <div className="relative h-12 w-12">
        <span className="absolute inset-0 rounded-full bg-indigo-200" />
        <span className="absolute inset-[18%] rounded-full bg-indigo-300" />
        <span className="absolute inset-[36%] rounded-full bg-indigo-500" />
      </div>
    </Frame>
  ),
  'chart:radar': () => (
    <Frame className="items-center justify-center">
      <svg viewBox="0 0 100 100" className="h-12 w-12">
        <polygon points="50,6 94,38 77,90 23,90 6,38" className="fill-none stroke-slate-200" strokeWidth="4" />
        <polygon points="50,24 78,42 66,76 32,72 24,44" className="fill-indigo-400/40 stroke-indigo-400" strokeWidth="4" />
      </svg>
    </Frame>
  ),

  // --- areas of a rectangle -----------------------------------------
  'chart:treemap': () => (
    <Frame>
      <div className="grid h-full grid-cols-3 grid-rows-2 gap-0.5">
        <div className="col-span-2 row-span-2 rounded-sm bg-indigo-400/70" />
        <div className="rounded-sm bg-indigo-300/70" />
        <div className="rounded-sm bg-indigo-200" />
      </div>
    </Frame>
  ),

  // --- the bar families ---------------------------------------------
  'stacked:stacked': () => (
    <Frame>
      <div className="flex h-full items-end gap-1.5">
        {[[45, 25], [60, 30], [35, 20], [70, 15]].map((seg, i) => (
          <div key={i} className="flex h-full flex-1 flex-col justify-end">
            <div className="w-full rounded-t-sm bg-indigo-300" style={{ height: `${seg[1]}%` }} />
            <div className="w-full bg-indigo-500/70" style={{ height: `${seg[0]}%` }} />
          </div>
        ))}
      </div>
    </Frame>
  ),
  'stacked:percent': () => (
    <Frame>
      <div className="flex h-full items-end gap-1.5">
        {[65, 45, 80, 30].map((h, i) => (
          <div key={i} className="flex h-full flex-1 flex-col justify-end">
            <div className="w-full rounded-t-sm bg-indigo-300" style={{ height: `${100 - h}%` }} />
            <div className="w-full bg-indigo-500/70" style={{ height: `${h}%` }} />
          </div>
        ))}
      </div>
    </Frame>
  ),
  'stacked:grouped': () => (
    <Frame>
      <div className="flex h-full items-end gap-1.5">
        {[[70, 45], [50, 80], [90, 35]].map((pair, i) => (
          <div key={i} className="flex h-full flex-1 items-end gap-0.5">
            <div className="flex-1 rounded-sm bg-indigo-500/70" style={{ height: `${pair[0]}%` }} />
            <div className="flex-1 rounded-sm bg-indigo-300" style={{ height: `${pair[1]}%` }} />
          </div>
        ))}
      </div>
    </Frame>
  ),
}

export default function WidgetTypePreview({ type }) {
  // A variant falls back to its family's own sketch rather than to a chart:
  // a shape nobody has drawn yet should look like what it IS, not like a
  // bar chart.
  const Sketch =
    VARIANTS[type] || SKETCHES[type] || SKETCHES[String(type).split(':')[0]] || SKETCHES.chart
  return <Sketch />
}
