import { Filter, X } from 'lucide-react'

/**
 * Shows what the dashboard is currently drilled into.
 *
 * Without this, clicking a chart bar silently changes every other widget's
 * numbers with no obvious way back — so every cross-filter gets a visible,
 * individually removable chip.
 *
 * Handles both cross-filter shapes produced by the widgets:
 *   { kind: 'value',      tab, column, value, label }  — chart / leaderboard
 *   { kind: 'conditions', tab, conditions, match, label } — pipeline stage / KPI
 *     (conditions may span more than one tab, e.g. a conversion KPI)
 */
function tabsTouched(cf) {
  if (cf.kind === 'conditions' && cf.conditions?.length) {
    return [...new Set(cf.conditions.map((c) => c.tab).filter(Boolean))]
  }
  if (cf.kind === 'keys') {
    return [...new Set((cf.keyColumns || []).map((k) => k.tab).filter(Boolean))]
  }
  return cf.tab ? [cf.tab] : []
}

/**
 * What a chip's tooltip says about how it is narrowing things.
 *
 * A key filter deserves the explanation: it reached widgets the click was
 * nowhere near, and "matched on VIN · 34 values" is the difference between
 * that feeling clever and feeling broken.
 */
function describe(cf, tabs) {
  if (cf.kind !== 'keys') return tabs.length ? `on ${tabs.join(' + ')}` : ''
  const names = [...new Set(cf.keyNames || [])].filter(Boolean)
  const count = (cf.keys || []).length
  return `matched on ${names.join(' / ') || 'the join key'} · ${count.toLocaleString('en-IN')} value${
    count === 1 ? '' : 's'
  }`
}

export default function CrossFilterChips({ crossFilters = [], onRemove, onClear }) {
  if (!crossFilters.length) return null

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2">
      <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-500">
        <Filter size={12} /> Drilled into
      </span>

      {crossFilters.map((cf) => {
        const tabs = tabsTouched(cf)
        return (
          <span
            key={cf.id}
            title={describe(cf, tabs) || undefined}
            className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 shadow-sm"
          >
            {cf.icon && <span className="leading-none">{cf.icon}</span>}
            <span className="max-w-[240px] truncate">{cf.label || cf.value || tabs[0]}</span>
            {/* A key filter reached widgets the click wasn't near, so it says
                how many key values are behind it rather than leaving that a
                mystery. */}
            {cf.kind === 'keys' && (
              <span className="rounded-full bg-indigo-100 px-1.5 text-[10px] font-bold tabular-nums text-indigo-600">
                {(cf.keys || []).length.toLocaleString('en-IN')}
              </span>
            )}
            <button
              onClick={() => onRemove(cf.id)}
              className="text-indigo-300 transition-colors hover:text-rose-500"
              title="Remove this drill-down"
            >
              <X size={12} />
            </button>
          </span>
        )
      })}

      {crossFilters.length > 1 && (
        <button onClick={onClear} className="text-xs text-indigo-400 underline hover:text-indigo-600">
          clear all
        </button>
      )}
    </div>
  )
}
