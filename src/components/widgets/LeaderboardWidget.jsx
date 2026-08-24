import { useMemo } from 'react'
import ExportButton from '../ExportButton.jsx'
import { aggregate, formatNumber } from '../../lib/dataUtils'

const MEDALS = ['🥇', '🥈', '🥉']

/**
 * Ranks one column by whatever metrics the admin defines -- bookings,
 * conversion %, average turnaround, revenue, anything. This is the generic
 * replacement for the old hardcoded "Top Performers · Model-wise" panel:
 * point it at Model, DSE Name, Source, Branch, whatever you want ranked.
 *
 * Clicking a row cross-filters the dashboard to that value.
 */
export default function LeaderboardWidget({
  widget,
  rows,
  unfilteredRows,
  tabError,
  crossFilters,
  onCrossFilter,
  canExport = false,
}) {
  const metrics = widget.metrics || []

  const ranked = useMemo(() => {
    const source = widget.ignoreFilters ? unfilteredRows : rows
    if (!widget.groupBy) return []

    const buckets = new Map()
    for (const row of source) {
      const key = String(row[widget.groupBy] ?? '').trim()
      if (!key) continue
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push(row)
    }

    const out = Array.from(buckets.entries()).map(([name, groupRows]) => ({
      name,
      values: metrics.map((m) => aggregate(groupRows, m.column, m.aggregation)),
    }))

    const sortIdx = Math.max(0, metrics.findIndex((m) => m.id === widget.sortBy))
    out.sort((a, b) => (b.values[sortIdx] ?? 0) - (a.values[sortIdx] ?? 0))
    return out.slice(0, widget.limit || 10)
  }, [rows, unfilteredRows, widget, metrics])

  const maxFirst = Math.max(1, ...ranked.map((r) => r.values[0] ?? 0))

  function isActive(name) {
    return crossFilters.some((cf) => cf.id === `lb_${widget.id}` && cf.value === name)
  }

  return (
    <div className="card flex h-[480px] flex-col overflow-hidden">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="widget-title">🏆 {widget.title}</h2>
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-slate-400">
            {widget.tab} · by {widget.groupBy || '—'}
            {widget.ignoreFilters && ' · unfiltered'}
          </p>
          {canExport && (
            <ExportButton
              name={widget.title || widget.tab}
              rows={() =>
                ranked.map((r) => {
                  const out = { [widget.groupBy || 'Group']: r.name }
                  metrics.forEach((m, i) => {
                    out[m.label || m.aggregation] = r.values[i]
                  })
                  return out
                })
              }
              columns={() => [widget.groupBy || 'Group', ...metrics.map((m) => m.label || m.aggregation)]}
              count={ranked.length}
            />
          )}
        </div>
      </div>

      {tabError ? (
        <p className="py-8 text-center text-sm text-rose-500">Tab “{widget.tab}” could not be read</p>
      ) : ranked.length === 0 ? (
        <p className="empty-state">Nothing to rank yet</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="w-10 py-1.5 font-medium">Rank</th>
                <th className="py-1.5 font-medium">{widget.groupBy}</th>
                {metrics.map((m) => (
                  <th key={m.id} className="py-1.5 text-right font-medium">
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranked.map((row, i) => {
                const active = isActive(row.name)
                return (
                  <tr
                    key={row.name}
                    onClick={() =>
                      onCrossFilter({
                        id: `lb_${widget.id}`,
                        kind: 'value',
                        tab: widget.tab,
                        column: widget.groupBy,
                        value: row.name,
                        label: `${widget.groupBy}: ${row.name}`,
                      })
                    }
                    title="Click to filter the dashboard by this row"
                    className={`cursor-pointer border-b border-slate-50 transition-colors ${
                      active ? 'bg-indigo-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-1.5 text-sm">{MEDALS[i] || <span className="text-slate-400">#{i + 1}</span>}</td>
                    <td className="relative py-1.5 pr-3">
                      {/* subtle proportional bar behind the label */}
                      <span
                        className="absolute inset-y-1 left-0 -z-10 rounded"
                        style={{
                          width: `${((row.values[0] ?? 0) / maxFirst) * 100}%`,
                          backgroundColor: `${widget.color || '#4F46E5'}14`,
                        }}
                      />
                      <span className="relative font-medium text-slate-700">{row.name}</span>
                    </td>
                    {metrics.map((m, mi) => (
                      <td key={m.id} className="py-1.5 text-right tabular-nums text-slate-600">
                        {formatNumber(row.values[mi], m.format, m.aggregation)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
