import { useEffect, useMemo, useRef, useState } from 'react'
import { Minus, MousePointerClick, TrendingDown, TrendingUp } from 'lucide-react'
import { aggregate, formatNumber } from '../../lib/dataUtils'
import { aggNeedsColumn } from '../../lib/config'
import { matchesConditions } from '../../lib/filterEngine'
import AppImage from '../PageIcon.jsx'
import { safeImageUrl } from '../../lib/imageUrl'
import {
  boxRatio,
  deltaOf,
  deltaText,
  isDial,
  isNeedle,
  isRound,
  isSegmented,
  needleGeometry,
  segmentBlocks,
  ringFraction,
  ringGeometry,
  ringIsMeaningful,
  shapeOf,
} from '../../lib/kpiShapes'
import { deltaChip, drawColour, kpiSurface, markColor, themeOf } from '../../lib/kpiThemes'
import { kpiScale, sizeStyle } from '../../lib/kpiScale'
import { useElementSize } from '../../hooks/useElementSize'

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
export default function KpiWidget({
  widget,
  rows,
  unfilteredRows,
  rowsByTab,
  rawRowsByTab,
  tabError,
  onCrossFilter,
  isDrilled,
  // Whether the card was GIVEN a height, rather than taking one from
  // its own contents. See heightOf in lib/kpiScale.js: measuring a
  // height that the text itself decides is a loop.
  fillHeight = false,
}) {
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
  // What marks are drawn in. "No colour" is slate rather than nothing:
  // a ring still has to be visible, and colourless means "not a
  // statement", not "invisible". What actually disappears is the rail
  // and the wash -- see kpiSurface.
  const color = drawColour(widget.color)

  // The card's real size, measured. Every size on a KPI used to be a
  // constant, which is right for exactly one card size -- the one it
  // was chosen against. See lib/kpiScale.js.
  const { ref: boxRef, width: boxW, height: boxH } = useElementSize()

  // What the card is MADE of, as against what shape it takes. Expressed
  // in the same custom properties the Look tab uses, and applied before
  // the widget's own style so a colour somebody typed still wins -- a
  // theme is a preset, not a decision. See lib/kpiThemes.js.
  const surface = kpiSurface(themeOf(widget), widget.color)

  // How far along, and how far off. Worked out ONCE here and handed to
  // whichever shape is drawn: a card showing both a bar and a change
  // measured against different things would be two answers to one
  // question. See ringFraction and deltaOf for which of target and
  // unfiltered total wins, and why.
  const shown = formatNumber(
    animated,
    isConversion ? 'percent' : widget.format,
    isConversion ? 'percent' : widget.aggregation
  )
  const fraction = ringFraction(value, { target: widget.kpiTarget, baseline })
  const delta = useMemo(
    () => deltaOf(value, { target: widget.kpiTarget, baseline }),
    [value, widget.kpiTarget, baseline]
  )

  // The side layout only makes sense when there is actually an image to put
  // there -- with an emoji it would be a large empty tile.
  const sideImage = widget.iconPlacement === 'side' && Boolean(safeImageUrl(widget.iconUrl))
  // Which shape this card takes. Every shape shows the same number from the
  // same data -- what changes is what the eye is meant to do with it. See
  // lib/kpiShapes.js.
  const shape = shapeOf(widget, sideImage)

  // Sized against the box AND against the figure: "8" and "1,24,85,000"
  // are the same measurement in the same card, and the long one has to
  // fit without the short one looking timid. Below `shape`, which it
  // reads -- a round card sizes its number against the circle rather
  // than against the card.
  const scale = kpiScale(
    { width: boxW, height: boxH },
    { shape, textLength: shown.length, fixed: widget.kpiRingSize, sized: fillHeight }
  )

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
      ref={boxRef}
      // `kpi-card` is what stops the card scrolling. A KPI has no body
      // to scroll: it is one figure that is supposed to fit, and a
      // scrollbar on it is the card saying it failed. See index.css --
      // the utility alone loses to `.widget-sized > .card`.
      className={`card kpi-card group relative overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lg ${
        surface.className
      } ${clickable ? 'cursor-pointer' : ''} ${isDrilled ? 'ring-2 ring-offset-1' : ''}`}
      style={{ ...surface.vars, ...(isDrilled ? { '--tw-ring-color': color } : null) }}
      title={
        clickable
          ? `Click to filter the dashboard by “${widget.title}”`
          : isConversion
            ? `${widget.tab} → ${widget.secondaryTab}`
            : `${widget.tab}${widget.column ? ` · ${widget.column}` : ''}`
      }
    >
      {/* The wash of the card's colour, and nothing else.
          There used to be a hard rail of it down the left edge as well.
          It is gone: a stripe is a second statement of the same thing
          the wash and the marks already make, and on a row of cards it
          reads as a table of contents nobody asked for. The colour now
          reaches the eye through what it actually measures -- the ring,
          the bar, the needle -- rather than through a bookmark. */}
      {!surface.onFill && (
        <span
          className="pointer-events-none absolute inset-0 opacity-[0.06] transition-opacity group-hover:opacity-[0.12]"
          style={{ background: `radial-gradient(120% 100% at 100% 0%, ${color} 0%, transparent 60%)` }}
        />
      )}

      {/* --- Two layouts -------------------------------------------------
          "corner" is the original: a small mark tucked top-right.
          "side" puts the image on the left as a real visual block, with the
          number and label to its right -- the shape a KPI takes when the
          image IS the identity of the thing being measured (a brand mark, a
          model photo) rather than a decorative glyph. */}
      {isRound(shape) ? (
        <RoundKpi
          widget={widget}
          shape={shape}
          animated={animated}
          value={value}
          baseline={baseline}
          color={color}
          surface={surface}
          fraction={fraction}
          scale={scale}
          shown={shown}
          isConversion={isConversion}
          clickable={clickable}
          isDrilled={isDrilled}
        />
      ) : shape === 'centred' ? (
        <div className="relative flex flex-1 flex-col items-center justify-center py-1 text-center">
          <p
            className="widget-value font-bold leading-none tabular-nums text-slate-800"
            style={{ fontSize: `var(--wvalue-size, ${scale?.number ? scale.number + 'px' : '2.25rem'})`, color: surface.ink || undefined }}
          >
            {shown}
          </p>
          <p
            className="widget-label mt-2 truncate font-semibold uppercase tracking-wide text-slate-500"
            style={{ fontSize: `var(--wlabel-size, ${scale?.label ? scale.label + 'px' : '11px'})`, color: surface.muted || undefined }}
          >
            {widget.icon ? `${widget.icon} ` : ''}
            {widget.title}
          </p>
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
      ) : shape === 'inline' ? (
        /* One line: the name on the left, the figure on the right. The
           shape for a stack of eight small metrics, where every card
           being a block of its own wastes most of the column on air. */
        <div className="relative flex items-center gap-2">
          <span
            className="widget-label min-w-0 flex-1 truncate font-semibold"
            style={{ fontSize: `var(--wlabel-size, ${scale?.label ? scale.label + 'px' : '12px'})`, color: surface.muted || undefined }}
          >
            {widget.icon ? `${widget.icon} ` : ''}
            {widget.title}
          </span>
          <span
            className="widget-value shrink-0 font-bold leading-none tabular-nums"
            style={{ fontSize: `var(--wvalue-size, ${scale?.number ? scale.number + 'px' : '1.25rem'})`, color: surface.ink || undefined }}
          >
            {shown}
          </span>
        </div>
      ) : shape === 'stat' ? (
        /* The reporting shape: the figure, and beside it how far off its
           mark it is. The number alone answers "how many"; this one
           answers "and is that good", which is the question that gets
           asked next in every meeting. */
        <div className="relative">
          <p
            className="widget-label truncate font-semibold uppercase tracking-wide"
            style={{ fontSize: `var(--wlabel-size, ${scale?.label ? scale.label + 'px' : '11px'})`, color: surface.muted || undefined }}
          >
            {widget.icon ? `${widget.icon} ` : ''}
            {widget.title}
          </p>
          <div className="mt-1.5 flex items-end gap-2">
            <p
              className="widget-value font-bold leading-none tabular-nums"
              style={{ fontSize: `var(--wvalue-size, ${scale?.number ? scale.number + 'px' : '1.875rem'})`, color: surface.ink || undefined }}
            >
              {shown}
            </p>
            {delta && (
              <span
                className="mb-0.5 flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                style={deltaChip(delta, surface)}
                title={deltaText(delta)}
              >
                {delta.dir === 'up' ? <TrendingUp size={10} /> : delta.dir === 'down' ? <TrendingDown size={10} /> : <Minus size={10} />}
                {Math.abs(delta.percent) < 0.05 ? '0%' : `${Math.abs(delta.percent).toFixed(Math.abs(delta.percent) >= 100 ? 0 : 1)}%`}
              </span>
            )}
          </div>
          {/* What it was measured against, said in full. A chip reading
              "+12%" with nothing to compare it to is a number wearing the
              clothes of a judgement. */}
          <p className="mt-1 truncate text-[10px]" style={{ color: surface.muted || undefined }}>
            {delta
              ? `vs ${delta.basis === 'target' ? 'target' : 'unfiltered'} ${formatNumber(
                  delta.against,
                  isConversion ? 'percent' : widget.format,
                  isConversion ? 'percent' : widget.aggregation
                )}`
              : 'set a target to show the change'}
          </p>
        </div>
      ) : shape === 'bar' ? (
        /* The figure over a bar that fills towards its target, with the
           target itself marked on the track. A ring says roughly how
           close; a marked bar says which side of the line it is on,
           which is the whole of what a target is for. */
        <div className="relative">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className="widget-label min-w-0 truncate font-semibold uppercase tracking-wide"
              style={{ fontSize: `var(--wlabel-size, ${scale?.label ? scale.label + 'px' : '11px'})`, color: surface.muted || undefined }}
            >
              {widget.icon ? `${widget.icon} ` : ''}
              {widget.title}
            </span>
            <span className="shrink-0 text-[10px] font-semibold tabular-nums" style={{ color: surface.muted || undefined }}>
              {Math.round(fraction * 100)}%
            </span>
          </div>

          <p
            className="widget-value mt-1 font-bold leading-none tabular-nums"
            style={{ fontSize: `var(--wvalue-size, ${scale?.number ? scale.number + 'px' : '1.5rem'})`, color: surface.ink || undefined }}
          >
            {shown}
          </p>

          <div className="relative mt-2 h-2.5 overflow-hidden rounded-full" style={{ backgroundColor: surface.track }}>
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{ width: `${Math.round(fraction * 100)}%`, backgroundColor: markColor(surface, color) }}
            />
          </div>
          {/* The target, marked ON the track rather than written beside
              it. Where a target exists the bar fills towards it, so full
              IS the target -- the tick sits at the end and the eye reads
              "short of it" or "past it" without doing any arithmetic. */}
          <p className="mt-1 truncate text-[10px]" style={{ color: surface.muted || undefined }}>
            {ringIsMeaningful({ target: widget.kpiTarget, baseline })
              ? `of ${formatNumber(
                  Number(widget.kpiTarget) > 0 ? Number(widget.kpiTarget) : baseline,
                  isConversion ? 'percent' : widget.format,
                  isConversion ? 'percent' : widget.aggregation
                )}${Number(widget.kpiTarget) > 0 ? ' target' : ' unfiltered'}`
              : 'set a target to fill this bar'}
          </p>
        </div>
      ) : sideImage ? (
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
            <p
              className="widget-value truncate font-bold leading-tight tabular-nums text-slate-800"
              style={{ fontSize: `var(--wvalue-size, ${scale?.number ? scale.number + 'px' : '1.5rem'})`, color: surface.ink || undefined }}
            >
              {shown}
            </p>
            <p
              className="widget-label truncate font-semibold uppercase tracking-wide text-slate-500"
              style={{ fontSize: `var(--wlabel-size, ${scale?.label ? scale.label + 'px' : '11px'})`, color: surface.muted || undefined }}
            >
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
            <p
              className="widget-label font-semibold uppercase tracking-wide text-slate-800"
              style={{ fontSize: `var(--wlabel-size, ${scale?.label ? scale.label + 'px' : '14px'})`, color: surface.ink || undefined }}
            >
              {widget.title}
            </p>
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

          <p
            className="widget-value relative mt-2 font-bold leading-tight tabular-nums text-slate-800"
            style={{ fontSize: `var(--wvalue-size, ${scale?.number ? scale.number + 'px' : '1.5rem'})`, color: surface.ink || undefined }}
          >
            {shown}
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

/**
 * A KPI drawn as a circle, with the number inside it.
 *
 * Two of them, because they answer different questions. A RING is a
 * proportion -- how much of a target, or of the unfiltered total, this
 * figure is -- and the circle itself carries that meaning. A BADGE is not a
 * proportion at all: it is a count made unmissable, for a row of them read
 * at a glance.
 *
 * Both put the number in the middle, which is the whole point: the eye
 * lands on the figure rather than reading a label first and finding it.
 */
function RoundKpi({
  widget,
  shape,
  animated,
  value,
  baseline,
  color,
  surface,
  fraction,
  scale,
  shown,
  isConversion,
  clickable,
  isDrilled,
}) {
  // The measured circle where there is one, and what it always was
  // before there was anything to measure -- so the first frame, and any
  // browser without a ResizeObserver, draws exactly what it used to.
  const size = scale?.circle || Math.max(72, Math.min(160, Number(widget.kpiRingSize) || 104))
  // On a card that IS the accent, a ring drawn in the accent is invisible.
  const mark = markColor(surface, color)
  // A ring with nothing to be a share of is always full, which is a
  // decoration wearing the clothes of a measurement. It says so rather than
  // drawing a circle that means nothing.
  const meaningful = ringIsMeaningful({ target: widget.kpiTarget, baseline })
  const ring = ringGeometry(fraction, size, scale?.stroke || Math.max(6, Math.round(size / 13)), shape)
  const needle = needleGeometry(fraction, size, shape)
  // An arc uses the top half, so a square box would leave a hole under the
  // number the size of the number.
  const boxH = Math.round(size * boxRatio(shape))
  const text = shown

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-2 py-1">
      <div className="relative" style={{ width: size, height: boxH }}>
        {isDial(shape) ? (
          <svg
            width={size}
            height={size}
            aria-hidden
            // Turned so the track STARTS where the eye expects it to --
            // twelve for a ring, half past seven for a gauge, nine for an
            // arc. An SVG circle begins at three o'clock.
            style={{ transform: `rotate(${ring.rotation}deg)`, display: 'block' }}
          >
            {isSegmented(shape) ? (
              /* Blocks, each its own run of the same circle. Ten of them
                 rather than a smooth ring because a rough share is what
                 gets read off a card in passing -- "seven of ten" lands
                 without measuring, where 68% of a circle does not.

                 ONE COLOUR, at two strengths -- exactly what every other
                 dial here does, and this one did not. Lighting a block
                 in the accent and leaving the rest in a grey meant that
                 a cross-filter, which moves the value and so moves the
                 boundary, visibly changed the card's COLOUR rather than
                 its reading. Same hue throughout, and the eye reads the
                 count instead of a palette. */
              segmentBlocks(fraction, ring, widget.kpiSegments).map((block) => (
                <circle
                  key={block.key}
                  cx={ring.centre}
                  cy={ring.centre}
                  r={ring.r}
                  fill="none"
                  stroke={mark}
                  // 0.16 is the track every other dial draws, so a
                  // segmented one sits in the same family as a ring.
                  strokeOpacity={block.on ? 1 : 0.16}
                  strokeWidth={ring.stroke}
                  strokeLinecap="butt"
                  strokeDasharray={`${block.length} ${ring.circumference}`}
                  strokeDashoffset={block.offset}
                  // Opacity, not colour. A hue cross-fading over half a
                  // second is what made a filter look like a restyle;
                  // the other dials animate their LENGTH for the same
                  // reason -- the shape changes, the palette does not.
                  className="transition-opacity duration-300"
                />
              ))
            ) : (
              <>
                {/* The track first, so the fill draws over it. */}
                <circle
                  cx={ring.centre}
                  cy={ring.centre}
                  r={ring.r}
                  fill="none"
                  stroke={mark}
                  strokeOpacity={0.16}
                  strokeWidth={ring.stroke}
                  strokeLinecap="round"
                  // The track is only as long as this shape draws. A gauge
                  // with a faint ghost of its missing quarter is a ring
                  // with a smudge in it.
                  strokeDasharray={ring.dashArray}
                />
                {/* A needle's track stays empty: the pointer is what says
                    where the figure sits, and a filled arc behind it says
                    the same thing twice in two different languages. */}
                {!isNeedle(shape) && (
                  <circle
                    cx={ring.centre}
                    cy={ring.centre}
                    r={ring.r}
                    fill="none"
                    stroke={mark}
                    strokeWidth={ring.stroke}
                    strokeLinecap="round"
                    strokeDasharray={ring.dashArray}
                    strokeDashoffset={ring.offset}
                    className="transition-[stroke-dashoffset] duration-700 ease-out"
                  />
                )}
              </>
            )}
          </svg>
        ) : (
          <span
            className="block h-full w-full rounded-full"
            data-kpi="badge"
            style={{
              background: `radial-gradient(120% 120% at 30% 20%, ${color} 0%, ${color}D9 60%, ${color}B3 100%)`,
              boxShadow: `0 10px 22px -10px ${color}`,
            }}
          />
        )}

        {/* The pointer, in its own un-rotated layer.
            `needleGeometry` already works in absolute degrees from three
            o'clock -- the same frame the track's rotation is expressed in
            -- so putting it inside the rotated svg would turn it twice
            and point it at the wrong number. */}
        {isNeedle(shape) && (
          <svg
            width={size}
            height={size}
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ display: 'block' }}
          >
            <line
              x1={needle.centre}
              y1={needle.centre}
              x2={needle.x}
              y2={needle.y}
              stroke={mark}
              strokeWidth={Math.max(2, Math.round(size / 40))}
              strokeLinecap="round"
              className="transition-all duration-700 ease-out"
            />
            {/* The hub. Without it the needle is a line that happens to
                start near the middle. */}
            <circle cx={needle.centre} cy={needle.centre} r={needle.hub} fill={mark} />
            <circle cx={needle.centre} cy={needle.centre} r={needle.hub / 2.4} fill="#fff" fillOpacity={0.85} />
          </svg>
        )}

        {/* The number, centred over whichever circle was drawn. A badge is
            a solid disc of the KPI's own colour, so its writing is white --
            every other shape keeps the card's ink. */}
        <span
          className="absolute inset-x-0 top-0 flex flex-col items-center justify-center px-2 text-center"
          // Centred on the DRAWN part: an arc's circle is taller than its
          // box, so centring on the box would sit the number low.
          style={{ height: boxH }}
        >
          <span
            className={`font-bold leading-none tabular-nums ${
              shape === 'badge' ? 'text-white' : surface.ink ? '' : 'text-slate-800'
            }`}
            style={{
              fontSize: scale?.number || Math.max(15, Math.round(size / (text.length > 5 ? 5.2 : 3.6))),
              // A themed card states its own ink; an unthemed one keeps
              // the slate it always had, so nothing existing shifts.
              color: shape === 'badge' ? undefined : surface.ink || undefined,
            }}
          >
            {text}
          </span>
          {/* Only a ring can be a proportion, so only a ring says what of. */}
          {shape === 'ring' && meaningful && (
            <span className="mt-0.5 text-[10px] font-semibold tabular-nums text-slate-400">
              {Math.round(fraction * 100)}%
            </span>
          )}
        </span>
      </div>

      <p
        className="widget-label max-w-full truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500"
        style={{ ...sizeStyle(scale?.label), color: surface.muted || undefined }}
      >
        {widget.icon ? `${widget.icon} ` : ''}
        {widget.title}
      </p>

      {/* Said out loud, because a full circle looks like an achievement and
          this one is only a shape. */}
      {shape === 'ring' && !meaningful && (
        <p className="text-[9px] text-slate-400">set a target to fill this ring</p>
      )}

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
  )
}
