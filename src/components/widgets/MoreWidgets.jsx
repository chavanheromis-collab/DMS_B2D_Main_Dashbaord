import { useMemo } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { recentRows, relativeTime, aggregate, formatNumber } from '../../lib/dataUtils'
import { matchesConditions } from '../../lib/filterEngine'

// =====================================================================
// Activity Feed
// =====================================================================
/**
 * The newest rows on a tab, newest first, as a compact chronological feed
 * rather than a table -- good for "what just happened" at a glance
 * (recent bookings, recent reviews) without paging through a full table.
 *
 * Deliberately reads from the UNFILTERED tab by default (toggle-able):
 * a feed that silently empties because someone filtered by DSE elsewhere
 * on the page is more confusing than useful, so "what's new" stays global
 * unless the admin explicitly wants it to respect page filters.
 */
export default function ActivityFeedWidget({ widget, rows, unfilteredRows, tabError, dateOrder }) {
  const source = widget.ignoreFilters ? unfilteredRows : rows

  const feed = useMemo(
    () => recentRows(source, widget.dateColumn, widget.limit || 15, dateOrder),
    [source, widget.dateColumn, widget.limit, dateOrder]
  )

  const titleCol = widget.titleColumn
  const subtitleCols = widget.subtitleColumns || []

  return (
    <div className="card">
      <div className="mb-2">
        <h2 className="widget-title"><span className="widget-icon">🕒</span> {widget.title}</h2>
        <p className="widget-caption text-[11px] text-slate-400">
          {widget.tab} · newest {widget.dateColumn ? `by ${widget.dateColumn}` : ''}
        </p>
      </div>

      {tabError ? (
        <p className="py-8 text-center text-sm text-rose-500">Tab "{widget.tab}" could not be read</p>
      ) : !widget.dateColumn ? (
        <p className="empty-state">Pick a date column in the admin panel</p>
      ) : feed.length === 0 ? (
        <p className="empty-state">Nothing to show yet</p>
      ) : (
        <div className="max-h-[420px] space-y-0.5 overflow-y-auto pr-1">
          {feed.map(({ row, date }, i) => (
            <div
              key={row._row ?? i}
              className="group flex items-start gap-2.5 rounded-lg px-1.5 py-2 transition-colors hover:bg-slate-50"
            >
              {/* timeline rail */}
              <div className="mt-0.5 flex flex-col items-center self-stretch">
                <span
                  className="h-2 w-2 shrink-0 rounded-full ring-4 ring-white"
                  style={{ backgroundColor: widget.color || '#4F46E5' }}
                />
                {i < feed.length - 1 && <span className="mt-0.5 w-px flex-1 bg-slate-100" />}
              </div>

              <div className="min-w-0 flex-1 pb-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-medium text-slate-700">
                    {titleCol ? String(row[titleCol] ?? '—') : `Row ${row._row}`}
                  </p>
                  <span className="shrink-0 whitespace-nowrap text-[10px] text-slate-400" title={date?.toLocaleString()}>
                    {relativeTime(date)}
                  </span>
                </div>
                {subtitleCols.length > 0 && (
                  <p className="truncate text-[11px] text-slate-400">
                    {subtitleCols.map((c) => row[c]).filter(Boolean).join(' · ') || '—'}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// =====================================================================
// Scorecard (A vs B comparison)
// =====================================================================
/**
 * One metric, measured twice under two different condition sets, shown
 * side by side with a delta -- "This Month vs Last Month", "Branch A vs
 * Branch B", "Referral vs Walk-in". Reuses the same condition-builder
 * machinery as KPI cards and buttons, just applied twice to the same tab.
 */
export function ScorecardWidget({ widget, rows, unfilteredRows, tabError, dateOrder }) {
  const source = widget.ignoreFilters ? unfilteredRows : rows

  const valueA = useMemo(() => {
    const scoped = source.filter((row) => matchesConditions(row, widget.conditionsA, widget.matchA || 'all', dateOrder))
    return aggregate(scoped, widget.column, widget.aggregation || 'count')
  }, [source, widget.conditionsA, widget.matchA, widget.column, widget.aggregation, dateOrder])

  const valueB = useMemo(() => {
    const scoped = source.filter((row) => matchesConditions(row, widget.conditionsB, widget.matchB || 'all', dateOrder))
    return aggregate(scoped, widget.column, widget.aggregation || 'count')
  }, [source, widget.conditionsB, widget.matchB, widget.column, widget.aggregation, dateOrder])

  const delta = valueA - valueB
  const pctDelta = valueB !== 0 ? (delta / Math.abs(valueB)) * 100 : valueA !== 0 ? 100 : 0
  const better = widget.lowerIsBetter ? delta < 0 : delta > 0
  const worse = widget.lowerIsBetter ? delta > 0 : delta < 0
  const deltaColor = delta === 0 ? '#64748B' : better ? '#059669' : worse ? '#DC2626' : '#64748B'
  const maxVal = Math.max(Math.abs(valueA), Math.abs(valueB), 1)

  const fmt = (v) => formatNumber(v, widget.format, widget.aggregation)

  return (
    <div className="card">
      <div className="mb-3">
        <h2 className="widget-title"><span className="widget-icon">⚖️</span> {widget.title}</h2>
        <p className="widget-caption text-[11px] text-slate-400">{widget.tab}</p>
      </div>

      {tabError ? (
        <p className="py-8 text-center text-sm text-rose-500">Tab "{widget.tab}" could not be read</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: widget.labelA || 'A', value: valueA, color: widget.colorA || '#4F46E5' },
              { label: widget.labelB || 'B', value: valueB, color: widget.colorB || '#94A3B8' },
            ].map((side) => (
              <div key={side.label} className="rounded-xl p-3" style={{ backgroundColor: `${side.color}0F`, border: `1px solid ${side.color}30` }}>
                <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">{side.label}</p>
                <p className="mt-1 text-xl font-bold tabular-nums" style={{ color: side.color }}>
                  {fmt(side.value)}
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/60">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${(Math.abs(side.value) / maxVal) * 100}%`, backgroundColor: side.color }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-center gap-1.5 rounded-lg py-2" style={{ backgroundColor: `${deltaColor}12` }}>
            {delta === 0 ? <Minus size={13} style={{ color: deltaColor }} /> : better ? (
              <ArrowUpRight size={13} style={{ color: deltaColor }} />
            ) : (
              <ArrowDownRight size={13} style={{ color: deltaColor }} />
            )}
            <span className="text-sm font-bold" style={{ color: deltaColor }}>
              {delta === 0 ? 'No change' : `${delta > 0 ? '+' : ''}${fmt(delta)} (${pctDelta > 0 ? '+' : ''}${Math.round(pctDelta)}%)`}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
