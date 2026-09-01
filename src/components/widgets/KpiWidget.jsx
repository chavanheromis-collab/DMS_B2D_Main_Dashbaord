import { useEffect, useMemo, useRef, useState } from 'react'
import { MousePointerClick } from 'lucide-react'
import { aggregate, formatNumber } from '../../lib/dataUtils'
import { aggNeedsColumn } from '../../lib/config'
import { matchesConditions } from '../../lib/filterEngine'
import AppImage from '../PageIcon.jsx'
import { safeImageUrl } from '../../lib/imageUrl'

/**
 * A KPI's mark.
 *
 * An image gets a tinted, rounded tile in the card's own colour rather than
 * floating bare on white: a logo with a white background would otherwise
 * dissolve into the card, and a dark one would sit there as an unexplained
 * black square. The tile is what makes an arbitrary uploaded image look like
 * part of the design.
 */
function WidgetIcon({ widget, size = 22, color }) {
  const hasImage = Boolean(safeImageUrl(widget.iconUrl))
  if (!hasImage && !widget.icon) return null

  if (!hasImage) return <span className="shrink-0 text-lg leading-none">{widget.icon}</span>

  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-lg p-1 ring-1"
      style={{ backgroundColor: `${color}14`, '--tw-ring-color': `${color}33` }}
    >
      <AppImage src={widget.iconUrl} fallback={widget.icon || ''} size={size} rounded="rounded-md" ring={false} />
    </span>
  )
}

/**
 * What does clicking this KPI mean?
 *
 * An admin can spell it out (widget.crossFilter.conditions), but for the
 * common aggregations the intent is unambiguous, so we derive it: clicking
 * "Delivered Vehicles" (count where DELIVERED is filled) drills into
 * exactly those rows. Aggregations with no meaningful row subset -- a plain
 * row count, a sum, an average -- return null and the card stays inert
 * rather than applying a filter that would surprise the user.
 */
function deriveCrossFilter(widget) {
  // Explicit "only count rows where..." conditions from the admin panel are
  // the clearest possible statement of what this KPI means, so they take
  // priority. Each condition already carries its own tab, so a conversion
  // KPI's primary + secondary conditions combine into one filter that
  // narrows both tabs on the dashboard at once.
  const own = [...(widget.conditions || []), ...(widget.secondaryConditions || [])].filter((c) => c.column)
  if (own.length > 0) {
    // Two independent AND/OR settings (primary vs secondary) don't collapse
    // into one flag cleanly, so once both sides have conditions the whole
    // set defaults to AND -- the common case ("this stage AND financed") --
    // rather than silently picking one side's setting for both.
    const singleSide = !widget.conditions?.length || !widget.secondaryConditions?.length
    const match = singleSide ? widget.conditionsMatch || widget.secondaryConditionsMatch || 'all' : 'all'
    return { match, conditions: own }
  }

  const custom = widget.crossFilter
  if (custom?.conditions?.length) {
    return { match: custom.match || 'all', conditions: custom.conditions }
  }
  if (!widget.column) return null

  const base = { tab: widget.tab, column: widget.column, value: '', value2: '' }
  switch (widget.aggregation) {
    case 'count_filled':
    case 'percent_filled':
      return { match: 'all', conditions: [{ ...base, operator: 'is_not_empty' }] }
    case 'count_empty':
      return { match: 'all', conditions: [{ ...base, operator: 'is_empty' }] }
    default:
      return null
  }
}

/**
 * Counts up to the value instead of snapping to it. Small touch, but it's
 * what makes the numbers feel live when a filter changes.
 */
function useCountUp(target, duration = 550) {
  const [display, setDisplay] = useState(target)
  const fromRef = useRef(target)
  const rafRef = useRef(null)

  useEffect(() => {
    const from = fromRef.current
    if (from === target) return undefined
    const start = performance.now()

    function tick(now) {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
      setDisplay(from + (target - from) * eased)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else fromRef.current = target
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])

  return display
}

/**
 * One number, computed from one tab + one column. Because the whole page's
 * tabs are already loaded, a KPI on "GOOGLE REVIEW" sits happily next to a
 * KPI on "MASTER" with no tab switching involved.
 *
 * When filters are active it also shows what the same figure was before
 * filtering, so a filtered number is never mistaken for the real total.
 */
export default function KpiWidget({ widget, rows, unfilteredRows, rowsByTab, rawRowsByTab, tabError, onCrossFilter, isDrilled }) {
  const isConversion = !!widget.secondaryTab

  const primaryValue = useMemo(() => {
    const source = widget.ignoreFilters ? unfilteredRows : rows
    const scoped = widget.conditions?.length
      ? source.filter((row) => matchesConditions(row, widget.conditions, widget.conditionsMatch || 'all'))
      : source
    return aggregate(scoped, widget.column, widget.aggregation)
  }, [widget.ignoreFilters, unfilteredRows, rows, widget.column, widget.aggregation, widget.conditions, widget.conditionsMatch])

  const secondaryValue = useMemo(() => {
    if (!isConversion) return 0
    const source = widget.ignoreFilters ? rawRowsByTab[widget.secondaryTab] || [] : rowsByTab[widget.secondaryTab] || []
    const scoped = widget.secondaryConditions?.length
      ? source.filter((row) => matchesConditions(row, widget.secondaryConditions, widget.secondaryConditionsMatch || 'all'))
      : source
    const agg = widget.secondaryAggregation || widget.aggregation
    if (aggNeedsColumn(agg) && !widget.secondaryColumn) return 0
    return aggregate(scoped, widget.secondaryColumn, agg)
  }, [
    isConversion,
    widget.ignoreFilters,
    rawRowsByTab,
    rowsByTab,
    widget.secondaryTab,
    widget.secondaryColumn,
    widget.secondaryAggregation,
    widget.aggregation,
    widget.secondaryConditions,
    widget.secondaryConditionsMatch,
  ])

  const value = useMemo(() => {
    if (!isConversion) return primaryValue
    return primaryValue ? (secondaryValue / primaryValue) * 100 : 0
  }, [isConversion, primaryValue, secondaryValue])

  const baseline = useMemo(() => {
    const scopedUnfiltered = widget.conditions?.length
      ? unfilteredRows.filter((row) => matchesConditions(row, widget.conditions, widget.conditionsMatch || 'all'))
      : unfilteredRows
    if (!isConversion) return aggregate(scopedUnfiltered, widget.column, widget.aggregation)

    const baselinePrimary = aggregate(scopedUnfiltered, widget.column, widget.aggregation)
    const rawSecondary = rawRowsByTab[widget.secondaryTab] || []
    const scopedSecondary = widget.secondaryConditions?.length
      ? rawSecondary.filter((row) => matchesConditions(row, widget.secondaryConditions, widget.secondaryConditionsMatch || 'all'))
      : rawSecondary
    const baselineSecondary = aggregate(scopedSecondary, widget.secondaryColumn, widget.secondaryAggregation || widget.aggregation)
    return baselinePrimary ? (baselineSecondary / baselinePrimary) * 100 : 0
  }, [
    isConversion,
    unfilteredRows,
    rawRowsByTab,
    widget.secondaryTab,
    widget.secondaryColumn,
    widget.secondaryAggregation,
    widget.column,
    widget.aggregation,
    widget.conditions,
    widget.conditionsMatch,
    widget.secondaryConditions,
    widget.secondaryConditionsMatch,
  ])

  const animated = useCountUp(value)
  const color = widget.color || '#4F46E5'

  // The side layout only makes sense when there is actually an image to put
  // there -- with an emoji it would be a large empty tile.
  const sideImage = widget.iconPlacement === 'side' && Boolean(safeImageUrl(widget.iconUrl))
  const imageSize = Number(widget.iconSize) || 52
  // The share bar and its "of N unfiltered · TAB" caption.
  //
  // OPT-IN. It used to appear by itself on every KPI the moment a page had
  // any filter on it -- nobody asked for it and there was no way to stop
  // it, so a card showing one number showed two lines of small print about
  // a number nobody had asked about. It is genuinely useful when somebody
  // wants it, which is why it is a switch rather than a deletion.
  const isFiltered =
    widget.showShare === true && !widget.ignoreFilters && Math.abs(baseline - value) > 0.001
  const share = baseline > 0 ? Math.min(100, (value / baseline) * 100) : 0

  const crossFilter = useMemo(() => deriveCrossFilter(widget), [widget])
  const clickable = !!crossFilter && !!onCrossFilter && !widget.ignoreFilters

  function handleClick() {
    if (!clickable) return
    onCrossFilter({
      id: `kpi_${widget.id}`,
      kind: 'conditions',
      tab: widget.tab,
      match: crossFilter.match,
      conditions: crossFilter.conditions,
      icon: widget.icon || '📊',
      label: widget.title,
    })
  }

  if (tabError) {
    return (
      <div className="card flex flex-col justify-center">
        <p className="text-xs font-semibold text-slate-400">{widget.title}</p>
        <p className="mt-1 text-xs text-rose-500">Tab “{widget.tab}” could not be read</p>
      </div>
    )
  }

  return (
    <div
      onClick={handleClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (clickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          handleClick()
        }
      }}
      // `card`, not a hand-rolled surface. This used to spell out its own
      // `rounded-2xl border bg-white p-4 shadow-…`, which meant the Look tab
      // did nothing to it: `.card` is the element that reads the custom
      // properties an admin's colours arrive as (see lib/widgetStyle.js), and
      // a hard-coded `bg-white` painted straight over them.
      //
      // Everything below is what this widget adds ON TOP of a card -- the
      // lift on hover, and the ring when it is the thing being drilled by.
      className={`card group relative overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lg ${
        clickable ? 'cursor-pointer' : ''
      } ${isDrilled ? 'ring-2 ring-offset-1' : ''}`}
      style={isDrilled ? { '--tw-ring-color': color } : undefined}
      title={
        clickable
          ? `Click to filter the dashboard by “${widget.title}”`
          : isConversion
            ? `${widget.tab} → ${widget.secondaryTab}`
            : `${widget.tab}${widget.column ? ` · ${widget.column}` : ''}`
      }
    >
      {/* wash of the KPI's colour, brightening on hover */}
      <span
        className="pointer-events-none absolute inset-0 opacity-[0.06] transition-opacity group-hover:opacity-[0.12]"
        style={{ background: `radial-gradient(120% 100% at 100% 0%, ${color} 0%, transparent 60%)` }}
      />
      <span className="absolute left-0 top-0 h-full w-1" style={{ backgroundColor: color }} />

      {/* --- Two layouts -------------------------------------------------
          "corner" is the original: a small mark tucked top-right.
          "side" puts the image on the left as a real visual block, with the
          number and label to its right -- the shape a KPI takes when the
          image IS the identity of the thing being measured (a brand mark, a
          model photo) rather than a decorative glyph. */}
      {sideImage ? (
        <div className="relative flex items-center gap-3">
          <span
            className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl ring-1"
            style={{
              width: imageSize,
              height: imageSize,
              backgroundColor: `${color}12`,
              '--tw-ring-color': `${color}2E`,
            }}
          >
            <AppImage
              src={widget.iconUrl}
              fallback={widget.icon || ''}
              size={imageSize - 10}
              rounded="rounded-lg"
              ring={false}
              // `contain` so a logo is shown whole rather than cropped --
              // the opposite of what a photo wants, which is why the two
              // placements differ here.
              fit="contain"
            />
          </span>

          {/* A hairline rule between mark and figures, as in the reference:
              it stops the number reading as a caption for the image. */}
          <span className="h-10 w-px shrink-0 bg-slate-200" />

          <div className="min-w-0 flex-1 text-right">
            <p className="truncate text-2xl font-bold leading-tight tabular-nums text-slate-800">
              {formatNumber(
                animated,
                isConversion ? 'percent' : widget.format,
                isConversion ? 'percent' : widget.aggregation
              )}
            </p>
            <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {widget.title}
            </p>
          </div>

          {clickable && (
            <MousePointerClick
              size={12}
              className={`absolute right-0 top-0 transition-opacity ${
                isDrilled ? 'opacity-70' : 'opacity-0 group-hover:opacity-50'
              }`}
              style={{ color }}
            />
          )}
        </div>
      ) : (
        <>
          <div className="relative flex items-start justify-between gap-2">
            <p className="text-[14px] font-semibold uppercase tracking-wide text-slate-800">{widget.title}</p>
            <span className="flex items-center gap-1">
              {clickable && (
                <MousePointerClick
                  size={12}
                  className={`transition-opacity ${isDrilled ? 'opacity-70' : 'opacity-0 group-hover:opacity-50'}`}
                  style={{ color }}
                />
              )}
              <WidgetIcon widget={widget} size={22} color={color} />
            </span>
          </div>

          <p className="relative mt-2 text-2xl font-bold leading-tight tabular-nums text-slate-800">
            {formatNumber(
              animated,
              isConversion ? 'percent' : widget.format,
              isConversion ? 'percent' : widget.aggregation
            )}
          </p>
        </>
      )}

      {isFiltered ? (
        <>
          <div className="relative mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${share}%`, backgroundColor: color }}
            />
          </div>
          <p className="relative mt-1 truncate text-[10px] text-slate-400">
            of{' '}
            {formatNumber(
              baseline,
              isConversion ? 'percent' : widget.format,
              isConversion ? 'percent' : widget.aggregation
            )}{' '}
            unfiltered · {isConversion ? `${widget.tab} → ${widget.secondaryTab}` : widget.tab}
          </p>
        </>
      ) : (
        widget.ignoreFilters && <p className="relative mt-1 truncate text-[10px] text-slate-400">unfiltered</p>
      )}
    </div>
  )
}
