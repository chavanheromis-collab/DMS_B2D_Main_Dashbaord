import { useCallback, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  Clock,
  Eye,
  Info,
  PieChart,
  Target,
} from 'lucide-react'
import { formatNumber } from '../../lib/dataUtils.js'
import { matchesConditions } from '../../lib/filterEngine.js'
import { DEFAULT_BRIEFING, buildBriefing, pct, short } from '../../lib/briefing.js'
import ExportButton from '../ExportButton.jsx'

/**
 * What somebody who runs the business needs to be told.
 *
 * Every other widget on this dashboard answers a question you already knew
 * to ask. A chart shows stock by model *once you have decided* that stock by
 * model is the thing to look at -- and deciding that is the analyst's job,
 * not the job of the person the dashboard is usually open in front of.
 *
 * So this one reads the table and writes the answers: a short list of
 * findings, in sentences, ranked by how much is behind them. What changed,
 * what is ageing, where it is piled up, what is out of line, what is
 * missing, and whatever somebody asked to be watched by name.
 *
 * Every finding is a button. Clicking it filters the whole page to exactly
 * the rows the sentence counted -- which is the difference between a
 * dashboard that tells you things and one you can trust, because you can
 * always go and look.
 */

const KIND_ICON = {
  watch: Target,
  movement: ArrowUpRight,
  aging: Clock,
  concentration: PieChart,
  outlier: CircleAlert,
  quality: Info,
}

const SEVERITY_STYLE = {
  high: { dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700', text: 'text-rose-600' },
  medium: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700', text: 'text-amber-600' },
  low: { dot: 'bg-slate-300', chip: 'bg-slate-100 text-slate-600', text: 'text-slate-500' },
  ok: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700', text: 'text-emerald-600' },
}

export default function BriefingWidget({
  widget,
  rows,
  unfilteredRows,
  tabError,
  crossFilters = [],
  onCrossFilter,
  dateOrder = 'DMY',
  canExport = false,
}) {
  const config = { ...DEFAULT_BRIEFING, ...(widget.briefing || {}) }
  const source = widget.ignoreFilters ? unfilteredRows : rows
  const [showAll, setShowAll] = useState(false)

  const briefing = useMemo(
    () =>
      buildBriefing(
        source,
        { ...config, limit: showAll ? 99 : config.limit },
        { matchesConditions, dateOrder }
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, widget.briefing, dateOrder, showAll]
  )

  const drillId = (finding) => `brief_${widget.id}_${finding.id}`

  const drill = useCallback(
    (finding) => {
      if (!onCrossFilter) return
      onCrossFilter({
        id: drillId(finding),
        kind: 'conditions',
        tab: widget.tab,
        match: finding.match || 'all',
        conditions: finding.conditions.map((c) => ({ ...c, tab: widget.tab })),
        icon: '🔎',
        label: finding.headline,
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onCrossFilter, widget.tab, widget.id]
  )

  const isDrilled = (finding) => crossFilters.some((cf) => cf.id === drillId(finding))

  const exportRows = useCallback(
    () =>
      briefing.findings.map((f) => ({
        Priority: f.severity,
        Finding: f.headline,
        Detail: f.detail,
        Column: f.column,
        Value: f.value,
        Rows: f.rows,
        'Share %': Math.round((f.share || 0) * 1000) / 10,
      })),
    [briefing]
  )

  if (tabError) return <div className="card"><p className="empty-state">{tabError}</p></div>

  return (
    <div className="card">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="widget-title">🧭 {widget.title}</h2>
          <p className="truncate text-[11px] text-slate-400">
            {(source || []).length.toLocaleString('en-IN')} rows
            {config.valueColumn ? ` · ${config.aggregation} of ${config.valueColumn}` : ''}
            {config.dateColumn ? ` · by ${config.dateColumn}` : ''}
            {widget.ignoreFilters && ' · unfiltered'}
          </p>
        </div>
        {canExport && (
          <ExportButton
            name={widget.title || 'briefing'}
            rows={exportRows}
            columns={() => ['Priority', 'Finding', 'Detail', 'Column', 'Value', 'Rows', 'Share %']}
            count={briefing.findings.length}
          />
        )}
      </div>

      {briefing.quiet ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-4">
          <Check size={16} className="shrink-0 text-emerald-600" />
          <div>
            <p className="text-sm font-semibold text-emerald-800">Nothing to report</p>
            <p className="text-[11px] text-emerald-700/80">
              No concentration, ageing, movement or data problem passed the threshold on{' '}
              {(source || []).length.toLocaleString('en-IN')} rows.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {briefing.findings.map((finding) => (
            <Finding
              key={finding.id}
              finding={finding}
              config={config}
              drilled={isDrilled(finding)}
              onDrill={onCrossFilter ? () => drill(finding) : undefined}
            />
          ))}
        </div>
      )}

      {(briefing.more > 0 || showAll) && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="mt-1.5 text-[11px] text-indigo-600 underline hover:text-indigo-700"
        >
          {showAll ? 'Show only what matters most' : `${briefing.more} more below the fold`}
        </button>
      )}

      {/* A missing section looks identical to a business where nothing
          happened, and those are extremely different situations. */}
      {briefing.skipped.length > 0 && (
        <div className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Not checked</p>
          {briefing.skipped.map((s) => (
            <p key={s} className="text-[10px] text-slate-500">
              {s}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function Finding({ finding, config, drilled, onDrill }) {
  const style = SEVERITY_STYLE[finding.severity] || SEVERITY_STYLE.low
  let Icon = KIND_ICON[finding.kind] || Info
  if (finding.kind === 'movement' && finding.direction === 'down') Icon = ArrowDownRight
  if (finding.kind === 'watch') Icon = finding.tripped ? AlertTriangle : Check

  const share = Math.max(0, Math.min(1, finding.share || 0))

  return (
    <div
      className={`relative overflow-hidden rounded-xl border px-2.5 py-2 transition-colors ${
        drilled ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      {/* The share, as a wash behind the sentence -- the same encoding the
          rest of this dashboard uses, so no legend is needed. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 bg-slate-50"
        style={{ width: `${share * 100}%` }}
      />

      <div className="relative flex items-start gap-2">
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
        <Icon size={13} className={`mt-0.5 shrink-0 ${style.text}`} />

        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-snug text-slate-800">{finding.headline}</p>
          <p className="truncate text-[11px] text-slate-500" title={finding.detail}>
            {finding.detail}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[13px] font-bold tabular-nums text-slate-800">
            {config.valueColumn ? formatNumber(finding.value, config.format, config.aggregation) : short(finding.value)}
          </p>
          <p className="text-[10px] tabular-nums text-slate-400">
            {finding.rows.toLocaleString('en-IN')} rows{finding.share ? ` · ${pct(finding.share)}` : ''}
          </p>
        </div>

        {onDrill && (
          <button
            onClick={onDrill}
            className={`mt-0.5 shrink-0 rounded-lg border px-1.5 py-1 text-[10px] font-medium ${
              drilled
                ? 'border-indigo-300 bg-white text-indigo-600'
                : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-indigo-600'
            }`}
            title={drilled ? 'Remove this filter from the page' : 'Filter the whole page to these rows'}
          >
            <Eye size={11} className="inline" /> {drilled ? 'Showing' : 'Show me'}
          </button>
        )}
      </div>
    </div>
  )
}
