import { CheckCheck, FilterX } from 'lucide-react'

import { controlMode, controlOptions, isButton, visibleChips } from '../../lib/pageControls'

/**
 * The page's filters, as a panel of buttons on the canvas.
 *
 * The control bar along the top is right for two or three controls and wrong
 * for eight: it wraps into a hedge, and every value is hidden behind a
 * dropdown you have to open before you can see what is even available. A
 * report with a dozen dimensions wants the other arrangement -- a column of
 * labelled groups, every value visible as a button, the selected ones lit.
 *
 * This is a second SURFACE for controls that already exist, not a second
 * filtering system. It reads and writes the same values the bar does, so the
 * same control can appear in both, a saved view still restores it, and Reset
 * still clears it. Nothing here knows how filtering works.
 */
export default function FilterPanelWidget({
  widget,
  controls,
  values,
  onChange,
  tabsData,
  onReset,
  dateOrder = 'DMY',
}) {
  const chosen = widget.controlIds?.length ? widget.controlIds : null

  const panelControls = (controls || [])
    // Live only: a parked control is switched off, and a fixed one is a rule
    // of the page rather than something anyone is meant to press.
    .filter((c) => controlMode(c) === 'live')
    .filter((c) => !isButton(c))
    .filter((c) => (chosen ? chosen.includes(c.id) : true))
    // Only the kinds whose values are a list of things to press. A date
    // range or a slider in a grid of buttons is a worse date range.
    .filter((c) => ['select', 'multi', 'chips'].includes(c.kind))

  const activeCount = panelControls.filter((c) => {
    const value = values?.[c.id]
    return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== '' && value !== null
  }).length

  return (
    <div className="card flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="widget-title text-[13px]">{widget.title || 'Filters'}</h2>
        {activeCount > 0 && (
          <button
            onClick={() => {
              for (const control of panelControls) onChange(control.id, control.kind === 'select' ? '' : [])
              onReset?.()
            }}
            className="flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 hover:bg-rose-100"
            title="Clear every filter in this panel"
          >
            <FilterX size={11} /> Clear {activeCount}
          </button>
        )}
      </div>

      {panelControls.length === 0 ? (
        <p className="empty-state">
          No filters chosen. Pick dropdown, multi-choice or chip controls for this panel in the admin panel.
        </p>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
          {panelControls.map((control) => (
            <FilterGroup
              key={control.id}
              control={control}
              value={values?.[control.id]}
              rows={tabsData?.[control.tab]?.rows || []}
              columns={Number(widget.buttonColumns) > 0 ? Number(widget.buttonColumns) : 0}
              showSelectAll={widget.showSelectAll !== false}
              dateOrder={dateOrder}
              onChange={(next) => onChange(control.id, next)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One dimension: its name, its values as buttons, and the two actions a
 * report panel always needs next to them.
 *
 * A single-choice control still renders as buttons -- pressing one replaces
 * the selection, pressing it again clears it. The affordance is the same
 * whichever it is, and that consistency is worth more than signalling the
 * difference.
 */
function FilterGroup({ control, value, rows, columns, showSelectAll, onChange, dateOrder }) {
  const multi = control.kind !== 'select'
  // The panel scrolls as a whole, so a group with ninety values costs the
  // reader a scroll rather than eighty missing options.
  const { shown: options, hidden } = visibleChips(controlOptions(control, rows, dateOrder), control.maxChips)
  const selected = multi ? value || [] : value ? [value] : []
  const all = selected.length > 0 && multi && selected.length >= options.length

  function toggle(option) {
    if (!multi) {
      onChange(value === option ? '' : option)
      return
    }
    onChange(selected.includes(option) ? selected.filter((v) => v !== option) : [...selected, option])
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-1 border-b border-slate-100 pb-0.5">
        <span className="truncate text-[11px] font-semibold text-slate-600">{control.label || control.column}</span>
        <span className="flex shrink-0 items-center gap-0.5">
          {multi && showSelectAll && (
            <button
              onClick={() => onChange(all ? [] : options)}
              className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-indigo-600"
              title={all ? 'Select none' : 'Select all'}
            >
              <CheckCheck size={12} />
            </button>
          )}
          <button
            onClick={() => onChange(multi ? [] : '')}
            disabled={selected.length === 0}
            className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-rose-500 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-300"
            title="Clear this filter"
          >
            <FilterX size={12} />
          </button>
        </span>
      </div>

      {options.length === 0 ? (
        <p className="py-1 text-[10px] text-slate-300">No values yet</p>
      ) : (
        <div
          className={columns ? 'grid gap-1' : 'flex flex-wrap gap-1'}
          style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
        >
          {options.map((option) => {
            const on = selected.includes(option)
            return (
              <button
                key={option}
                onClick={() => toggle(option)}
                className={`truncate rounded-md border px-1.5 py-1 text-[10px] font-medium transition-colors ${
                  on
                    ? 'border-transparent bg-[var(--card-accent,#4F46E5)] text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                }`}
                title={option}
              >
                {option}
              </button>
            )
          })}
        </div>
      )}

      {hidden > 0 && <p className="mt-0.5 text-[10px] text-slate-400">+{hidden} more not shown</p>}
    </div>
  )
}
