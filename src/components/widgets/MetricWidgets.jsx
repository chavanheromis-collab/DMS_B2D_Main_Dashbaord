import { useMemo } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus, Sparkle } from 'lucide-react'
import { dailyCounts, formatNumber } from '../../lib/dataUtils'
import { computeStats, statColumns } from '../../lib/statGrid'
import { bulletRows } from '../../lib/bullet'
import { moversData } from '../../lib/movers'
import { waffleData } from '../../lib/waffleData'
import { seriesColor } from '../../lib/seriesData'
import Sparkline from './Sparkline.jsx'

// =====================================================================
// Metric widgets
// =====================================================================
// Four widgets that all answer "how are we doing", each from an angle the
// existing KPI card cannot reach:
//
//   Stat Grid -- several numbers at once, each against its own baseline
//   Bullet    -- many targets on one shared axis, scannable in a glance
//   Movers    -- what CHANGED, rather than what is biggest
//   Waffle    -- a share counted in squares rather than judged as an angle

/** The rows a widget should read, honouring its own "ignore filters" flag. */
const sourceRows = (widget, rows, unfilteredRows) => (widget.ignoreFilters ? unfilteredRows : rows)

function Shell({ widget, icon, caption, tabError, children, className = '' }) {
  return (
    <div className={`card flex h-full flex-col ${className}`}>
      <div className="mb-2">
        <h2 className="widget-title">
          {icon} {widget.title}
        </h2>
        {caption && (
          <p className="text-[11px] text-slate-400">
            {caption}
            {widget.ignoreFilters && ' · unfiltered'}
          </p>
        )}
      </div>
      {tabError ? (
        <p className="py-10 text-center text-sm text-rose-500">Tab “{widget.tab}” could not be read</p>
      ) : (
        children
      )}
    </div>
  )
}

const TONE_COLORS = { good: '#059669', bad: '#DC2626', flat: '#64748B' }

/**
 * A change, said once and said properly.
 *
 * An arrow for the direction, the amount, and the percentage only where a
 * percentage is honest -- growing from nothing has no percentage, and
 * printing one there is the most common way a dashboard lies by accident.
 */
function Delta({ delta, percent, tone, formatted, compact = false }) {
  if (delta === null || delta === undefined) return null
  const color = TONE_COLORS[tone] || TONE_COLORS.flat
  const Icon = delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight

  return (
    <span
      className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${compact ? 'text-[10px]' : 'text-[11px]'}`}
      style={{ color }}
    >
      <Icon size={compact ? 11 : 12} />
      {percent === null || percent === undefined ? formatted : `${percent > 0 ? '+' : ''}${Math.round(percent)}%`}
    </span>
  )
}

// ---------------------------------------------------------------------
// Stat Grid
// ---------------------------------------------------------------------
/**
 * Several KPIs in one card.
 *
 * Six small numbers as six separate KPI cards is six borders, six titles
 * and six shadows for a group of figures that is read as a group. In one
 * card they share a heading, line up on a grid, and -- because each one
 * carries its own baseline -- every number arrives with the context that
 * makes it mean something.
 */
export default function StatGridWidget({ widget, rows, unfilteredRows, tabError, dateOrder }) {
  const source = sourceRows(widget, rows, unfilteredRows)

  const stats = useMemo(
    () => computeStats(widget, { rows: source, unfilteredRows, dateOrder }),
    [widget, source, unfilteredRows, dateOrder]
  )

  const columns = statColumns(widget)
  const layout = widget.layout || 'tiles'

  return (
    <Shell widget={widget} icon="🔢" caption={widget.tab} tabError={tabError}>
      {stats.length === 0 ? (
        <p className="empty-state">Add a stat in the editor</p>
      ) : (
        <div
          className={
            layout === 'rows'
              ? 'divide-y divide-slate-100'
              : layout === 'ruled'
                ? 'grid divide-x divide-slate-100'
                : 'grid gap-2.5'
          }
          style={layout === 'rows' ? undefined : { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {stats.map((stat) => (
            <StatCell key={stat.id} stat={stat} widget={widget} layout={layout} />
          ))}
        </div>
      )}
    </Shell>
  )
}

function StatCell({ stat, widget, layout }) {
  // Counting rows per day, not the metric per day: the line is showing
  // ACTIVITY, and a median summed over a Tuesday is a number with no
  // meaning attached to it.
  const spark = useMemo(
    () => (stat.sparkSource ? dailyCounts(stat.sparkSource, widget.dateColumn, stat.sparkDays, 'DMY') : null),
    [stat.sparkSource, widget.dateColumn, stat.sparkDays]
  )

  const tinted = layout === 'tiles'
  const inRow = layout === 'rows'

  return (
    <div
      className={
        inRow
          ? 'flex items-center justify-between gap-3 py-2'
          : tinted
            ? 'rounded-xl px-3 py-2.5'
            : 'px-3 py-1.5'
      }
      style={tinted ? { backgroundColor: `${stat.color}0D`, border: `1px solid ${stat.color}22` } : undefined}
    >
      <div className={inRow ? 'min-w-0 flex-1' : ''}>
        <p className="flex items-center gap-1 truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {stat.icon && <span className="text-xs leading-none">{stat.icon}</span>}
          {stat.label}
        </p>
        {!inRow && (
          <p className="mt-0.5 text-xl font-bold leading-tight tabular-nums" style={{ color: stat.color }}>
            {stat.formatted}
          </p>
        )}
      </div>

      <div className={inRow ? 'flex shrink-0 items-center gap-3' : 'mt-1 flex items-center justify-between gap-2'}>
        {inRow && (
          <span className="text-base font-bold tabular-nums" style={{ color: stat.color }}>
            {stat.formatted}
          </span>
        )}

        <div className="flex flex-col items-end gap-0.5">
          <Delta
            delta={stat.delta}
            percent={stat.percent}
            tone={stat.tone}
            formatted={stat.deltaFormatted}
            compact
          />
          {stat.baseline && (
            <span className="whitespace-nowrap text-[9px] text-slate-400">
              vs {formatNumber(stat.baseline.value, widget.format || 'comma')} {stat.baseline.label}
            </span>
          )}
        </div>

        {spark && !inRow && <Sparkline values={spark} color={stat.color} width={60} height={18} />}
      </div>

      {/* Progress is drawn ONLY against a target. A bar creeping across
          because last month was smaller says nothing anyone can act on. */}
      {stat.progress !== null && !inRow && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-200/70">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${stat.progress * 100}%`, backgroundColor: stat.color }}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Bullet chart
// ---------------------------------------------------------------------
const BAND_LABELS = { poor: 'Poor', fair: 'Fair', good: 'Good' }
const BAND_TEXT = { poor: '#B91C1C', fair: '#B45309', good: '#047857' }

/**
 * Eight targets on eight lines, sharing one axis.
 *
 * The bands behind each bar are what turn a percentage into a judgement:
 * 84% of target is a number, and "well into fair, nowhere near good" is
 * something a meeting can act on. The target tick is drawn as a hard rule
 * rather than a marker, because a promise is a line you are either past
 * or short of.
 */
export function BulletWidget({ widget, rows, unfilteredRows, tabError, dateOrder }) {
  const source = sourceRows(widget, rows, unfilteredRows)
  const lines = useMemo(() => bulletRows(widget, { rows: source, dateOrder }), [widget, source, dateOrder])

  const barHeight = Math.max(8, Math.min(48, Number(widget.barHeight) || 18))

  return (
    <Shell widget={widget} icon="📍" caption={widget.tab} tabError={tabError}>
      {lines.length === 0 ? (
        <p className="empty-state">Add a metric in the editor</p>
      ) : (
        <div className="space-y-3">
          {lines.map((line) => (
            <div key={line.id}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium text-slate-700">{line.label}</span>
                <span className="flex shrink-0 items-baseline gap-1.5 text-[11px]">
                  <span className="font-bold tabular-nums" style={{ color: line.color }}>
                    {line.formatted}
                  </span>
                  <span className="text-slate-400">/ {line.targetFormatted}</span>
                  {line.attainment !== null && (
                    <span className="font-semibold tabular-nums" style={{ color: BAND_TEXT[line.band] }}>
                      {Math.round(line.attainment)}%
                    </span>
                  )}
                </span>
              </div>

              <div
                className="relative w-full overflow-hidden rounded"
                style={{ height: barHeight }}
                title={`${line.label}: ${line.formatted} against ${line.targetFormatted} — ${BAND_LABELS[line.band]}`}
              >
                {/* The bands, tiled left to right so no hairline of card
                    shows between them. */}
                <div className="absolute inset-0 flex">
                  {line.bands.map((band) => (
                    <div
                      key={band.key}
                      style={{ width: `${Math.max(0, band.width) * 100}%`, backgroundColor: band.color }}
                    />
                  ))}
                </div>

                {/* The measure, drawn thinner than the bands and centred in
                    them -- that contrast is what makes the bar read as a
                    value ON a scale rather than as another band. */}
                <div
                  className="absolute rounded-sm transition-all duration-500"
                  style={{
                    left: 0,
                    top: '30%',
                    height: '40%',
                    width: `${line.valueFraction * 100}%`,
                    backgroundColor: line.color,
                  }}
                />

                {/* The promise. */}
                <div
                  className="absolute w-[2px] bg-slate-900"
                  style={{ left: `${line.targetFraction * 100}%`, top: '12%', height: '76%' }}
                />
              </div>
            </div>
          ))}

          <div className="flex items-center justify-end gap-3 pt-0.5 text-[9px] text-slate-400">
            {['poor', 'fair', 'good'].map((key, i) => (
              <span key={key} className="inline-flex items-center gap-1">
                <span
                  className="h-2 w-3 rounded-sm"
                  style={{ backgroundColor: lines[0]?.bands[i]?.color }}
                />
                {BAND_LABELS[key]}
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-[2px] bg-slate-900" /> Target
            </span>
          </div>
        </div>
      )}
    </Shell>
  )
}

// ---------------------------------------------------------------------
// Top movers
// ---------------------------------------------------------------------
/**
 * What changed, ranked by how much.
 *
 * Split into gains and falls by default rather than one merged list,
 * because a merged list ordered by size shows nothing but gains in a good
 * week -- and "nothing fell" is then a claim the widget never actually
 * checked. Two columns force it to look at both.
 */
export function MoversWidget({ widget, rows, unfilteredRows, tabError, dateOrder, onCrossFilter }) {
  const source = sourceRows(widget, rows, unfilteredRows)
  const data = useMemo(() => moversData(widget, { rows: source, dateOrder }), [widget, source, dateOrder])

  function drill(mover) {
    if (!onCrossFilter || !widget.groupBy) return
    onCrossFilter({
      id: `movers_${widget.id}`,
      label: `${widget.groupBy}: ${mover.name}`,
      match: 'all',
      conditions: [{ tab: widget.tab, column: widget.groupBy, operator: 'equals', value: mover.name }],
    })
  }

  const caption = data.ready
    ? `${widget.tab} · ${data.nowLabel} vs ${data.beforeLabel}`
    : widget.tab

  return (
    <Shell widget={widget} icon="↕️" caption={caption} tabError={tabError}>
      {!data.ready ? (
        <p className="empty-state">{data.reason}</p>
      ) : data.total === 0 ? (
        <p className="empty-state">Nothing changed between the two periods</p>
      ) : widget.splitDirections !== false ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <MoverColumn
            title="Risers"
            movers={data.gains}
            widget={widget}
            onDrill={onCrossFilter ? drill : undefined}
            empty="Nothing grew"
          />
          <MoverColumn
            title="Fallers"
            movers={data.falls}
            widget={widget}
            onDrill={onCrossFilter ? drill : undefined}
            empty="Nothing fell"
          />
        </div>
      ) : (
        <MoverColumn movers={data.movers} widget={widget} onDrill={onCrossFilter ? drill : undefined} empty="No movers" />
      )}

      {data.hidden > 0 && (
        <p className="mt-2 text-right text-[10px] text-slate-400">+{data.hidden} more not shown</p>
      )}
    </Shell>
  )
}

function MoverColumn({ title, movers, widget, onDrill, empty }) {
  return (
    <div>
      {title && (
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      )}
      {movers.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-slate-300">{empty}</p>
      ) : (
        <div className="space-y-1">
          {movers.map((mover) => {
            const color = mover.tone === 'good' ? widget.colorUp || '#059669' : widget.colorDown || '#DC2626'
            return (
              <button
                key={mover.name}
                onClick={onDrill ? () => onDrill(mover) : undefined}
                disabled={!onDrill}
                className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors ${
                  onDrill ? 'hover:bg-slate-50' : 'cursor-default'
                }`}
                title={`${mover.name}: ${mover.beforeFormatted} → ${mover.formatted}`}
              >
                <span className="min-w-0 flex-1 truncate text-xs text-slate-600">
                  {mover.name}
                  {mover.isNew && (
                    <span className="ml-1 rounded bg-emerald-50 px-1 text-[9px] font-semibold text-emerald-600">
                      new
                    </span>
                  )}
                  {mover.isGone && (
                    <span className="ml-1 rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-500">
                      gone
                    </span>
                  )}
                </span>

                {/* A bar as well as a number: the numbers alone make the
                    reader do the comparison the chart exists to do. */}
                <span className="hidden h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-slate-100 sm:block">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${Math.max(6, mover.magnitude * 100)}%`, backgroundColor: color }}
                  />
                </span>

                <span className="shrink-0 text-[11px] font-semibold tabular-nums" style={{ color }}>
                  {mover.changeFormatted}
                </span>
                <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-slate-400">
                  {mover.percent === null ? '—' : `${mover.percent > 0 ? '+' : ''}${Math.round(mover.percent)}%`}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Waffle
// ---------------------------------------------------------------------
const SHAPE_GLYPHS = { heart: '❤️', star: '⭐', person: '🧍', car: '🚗', rupee: '₹' }

/**
 * A share, in squares.
 *
 * The one chart that does not ask the reader to estimate anything: 38
 * squares out of 100 is a count, where 38% of a pie is a judgement about
 * an angle that most people get wrong by five points in either direction.
 */
export function WaffleWidget({ widget, rows, unfilteredRows, tabError, onCrossFilter }) {
  const source = sourceRows(widget, rows, unfilteredRows)
  const data = useMemo(() => waffleData(widget, { rows: source }), [widget, source])

  const colorFor = (slice) =>
    slice.isOther
      ? '#CBD5E1'
      : seriesColor(slice.name, slice.index, widget.seriesColors, widget.palette || 'default')

  function drill(slice) {
    if (!onCrossFilter || !widget.groupBy || slice.isOther) return
    onCrossFilter({
      id: `waffle_${widget.id}`,
      label: `${widget.groupBy}: ${slice.name}`,
      match: 'all',
      conditions: [{ tab: widget.tab, column: widget.groupBy, operator: 'equals', value: slice.name }],
    })
  }

  const glyph = SHAPE_GLYPHS[widget.shape]
  const gap = Math.max(0, Math.min(10, Number(widget.gap ?? 3)))

  return (
    <Shell widget={widget} icon="🧇" caption={`${widget.tab} · by ${widget.groupBy || '—'}`} tabError={tabError}>
      {!data.ready ? (
        <p className="empty-state">Pick a column to split by</p>
      ) : data.total === 0 ? (
        <p className="empty-state">Nothing to show</p>
      ) : (
        <>
          <div
            className="mx-auto grid w-full max-w-[280px]"
            style={{ gridTemplateColumns: `repeat(${data.columns}, minmax(0, 1fr))`, gap: `${gap}px` }}
          >
            {data.cells.map((cell) => {
              const color = cell.slice ? colorFor(cell.slice) : '#E2E8F0'
              if (glyph) {
                return (
                  <span
                    key={cell.position}
                    className="flex aspect-square items-center justify-center text-[min(3vw,14px)] leading-none"
                    style={{ filter: cell.slice ? 'none' : 'grayscale(1) opacity(0.3)' }}
                    title={cell.slice ? cell.slice.name : ''}
                  >
                    {glyph}
                  </span>
                )
              }
              return (
                <span
                  key={cell.position}
                  onClick={cell.slice ? () => drill(cell.slice) : undefined}
                  className={`aspect-square transition-transform ${
                    widget.shape === 'circle' ? 'rounded-full' : widget.shape === 'square' ? '' : 'rounded-[3px]'
                  } ${onCrossFilter && cell.slice && !cell.slice.isOther ? 'cursor-pointer hover:scale-125' : ''}`}
                  style={{ backgroundColor: color }}
                  title={cell.slice ? `${cell.slice.name} — ${Math.round(cell.slice.share)}%` : ''}
                />
              )
            })}
          </div>

          {widget.showLegend !== false && (
            <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1">
              {data.slices.map((slice) => (
                <button
                  key={slice.name}
                  onClick={() => drill(slice)}
                  disabled={!onCrossFilter || slice.isOther}
                  className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 disabled:cursor-default"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colorFor(slice) }} />
                  <span className="truncate">{slice.name}</span>
                  <span className="font-semibold tabular-nums">
                    {widget.showPercent !== false
                      ? `${Math.round(slice.share)}%`
                      : formatNumber(slice.value, widget.format, widget.aggregation)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* What one square is worth. Without it the grid is a proportion
              with the units filed off. */}
          <p className="mt-2 text-center text-[10px] text-slate-400">
            <Sparkle size={9} className="inline" /> one square ≈{' '}
            {formatNumber(data.perCell, widget.format, widget.aggregation)}
            {data.slices.some((s) => s.isOther) && ' · smallest values merged into Other'}
          </p>
        </>
      )}
    </Shell>
  )
}

