import { useEffect, useMemo, useState } from 'react'
import { Maximize2, X } from 'lucide-react'

import {
  cardLines,
  cardMinHeight,
  cardMinWidth,
  cardSpec,
  cardTone,
  moreNote,
  zoomLines,
} from '../../lib/cardView'
import { badgeStyle } from '../../lib/dataUtils'
import { liveRow } from '../../lib/openRow'

// ---------------------------------------------------------------------
// The rows, as cards
// ---------------------------------------------------------------------
// One block per record, each a different colour from the ones around it
// -- the palette cycled by position, with nothing to configure. See
// lib/cardView.js for why a decorative colour is positional. Everything
// else about the table is unchanged: the same rows arrive already
// filtered, sorted and paged, and the same tick boxes drive the same row
// operations.
//
// The look is meant to be quiet. A card is a thing somebody reads, so the
// colour is a WASH plus an edge of the same hue and one saturated rail
// down the side -- enough to tell two records apart at a glance and not
// so much that it competes with the values printed on it. Everything else
// is space: a heading that is bigger than its fields, a line under it
// saying who rather than what, and labels small and grey so the eye lands
// on the answers rather than on the questions.
//
// The card is a SUMMARY. Reading a whole record is what the zoom is for,
// and it is a popup rather than an expanding card because a card that
// grows in place reflows the grid under the cursor -- everything below it
// jumps, and the thing somebody was about to click has moved.

export default function CardGrid({
  widget,
  rows,
  columns,
  badgeCols = [],
  selectable = false,
  selection = [],
  onTick,
  onOpen,
}) {
  const [zoomed, setZoomed] = useState(null)

  const spec = useMemo(() => cardSpec(widget, columns), [widget, columns])

  // The zoomed record, re-read from the live rows on every render rather
  // than held as the object that was clicked -- a save rebuilds every row,
  // and a popup showing the values as they were when it opened is a popup
  // that appears to ignore edits. See lib/openRow.js.
  const zoomRow = useMemo(() => liveRow(rows, zoomed), [rows, zoomed])

  if (rows.length === 0) {
    return <p className="py-10 text-center text-slate-300">No rows match the current filters</p>
  }

  return (
    <>
      <div
        className="grid gap-3 p-2"
        // Fitted rather than a fixed column count: the same page is read on
        // a laptop and on a wall-mounted screen, and a card grid that is
        // always three across is three postage stamps on one and three
        // billboards on the other.
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardMinWidth(widget)}px, 1fr))` }}
      >
        {rows.map((row, index) => {
          // By position on screen, so no card is the colour of the card
          // beside it or the one under it.
          const tone = cardTone(index)
          const lines = cardLines(row, spec.fields)
          const ticked = selection.includes(row._row)
          const heading = String(row[spec.title] ?? '').trim()
          const sub = spec.subtitle ? String(row[spec.subtitle] ?? '').trim() : ''

          return (
            <article
              key={row._row}
              onClick={() => setZoomed(row)}
              style={{
                backgroundColor: tone.bg,
                borderColor: ticked ? tone.accent : tone.border,
                minHeight: cardMinHeight(widget),
              }}
              className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border text-left transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg ${
                ticked ? 'shadow-md ring-2 ring-offset-1' : 'shadow-sm'
              }`}
            >
              {/* One saturated rail down the side. A full-strength band
                  across the top cuts the card in two; down the edge it
                  reads as the card's own colour. */}
              <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: tone.accent }} />

              <div className="flex min-w-0 flex-1 flex-col gap-2 py-3 pl-4 pr-3">
                <div className="flex min-w-0 items-start gap-2">
                  {selectable && (
                    <input
                      type="checkbox"
                      checked={ticked}
                      aria-label={`Select row ${row._row}`}
                      className="mt-1 shrink-0"
                      // The card opens a zoom on click; the tick must not
                      // also do that, or selecting four records opens and
                      // closes four popups on the way.
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onTick?.(row, e.nativeEvent.shiftKey)}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <h3
                      className="truncate text-[15px] font-semibold leading-tight"
                      style={{ color: tone.fg }}
                      title={heading}
                    >
                      {heading || <span className="text-slate-300">—</span>}
                    </h3>
                    {sub && (
                      <p className="mt-0.5 truncate text-[11px] text-slate-500" title={sub}>
                        {sub}
                      </p>
                    )}
                  </div>
                  <Maximize2
                    size={13}
                    className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
                    style={{ color: tone.fg }}
                  />
                </div>

                <dl className="min-w-0 space-y-1.5">
                  {lines.map(({ column, value }) => (
                    <div key={column} className="flex min-w-0 items-baseline gap-2">
                      <dt
                        className="w-[40%] shrink-0 truncate text-[9px] font-medium uppercase tracking-wider text-slate-400"
                        title={column}
                      >
                        {column}
                      </dt>
                      <dd className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700" title={value}>
                        {badgeCols.includes(column) ? (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                            style={badgeStyle(value)}
                          >
                            {value}
                          </span>
                        ) : (
                          value
                        )}
                      </dd>
                    </div>
                  ))}

                  {lines.length === 0 && <p className="text-xs text-slate-400">Nothing filled in yet</p>}
                </dl>

                {spec.hidden > 0 && (
                  <p
                    className="mt-auto pt-1 text-[10px] font-medium"
                    style={{ color: tone.accent }}
                  >
                    {moreNote(spec.hidden)}
                  </p>
                )}
              </div>
            </article>
          )
        })}
      </div>

      {zoomRow && (
        <CardZoom
          row={zoomRow}
          widget={widget}
          spec={spec}
          // The colour of the card that was clicked, found again by its
          // place in what is on screen -- so the zoom is visibly the same
          // object rather than a white panel that appeared from nowhere.
          tone={cardTone(rows.findIndex((r) => r._row === zoomRow._row))}
          badgeCols={badgeCols}
          onOpenDetail={onOpen}
          onClose={() => setZoomed(null)}
        />
      )}
    </>
  )
}

/**
 * One record, in full.
 *
 * Every field the table shows, blanks included -- on a card a blank line
 * is noise, and here it is the answer to "was this ever filled in?". The
 * body scrolls and the heading does not, so a record with thirty fields
 * can be read without losing track of whose it is.
 */
function CardZoom({ row, widget, spec, tone, badgeCols, onOpenDetail, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const lines = zoomLines(row, spec.all)
  const heading = String(row[spec.title] ?? '').trim()
  const sub = spec.subtitle ? String(row[spec.subtitle] ?? '').trim() : ''

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[85vh] w-[480px] max-w-full flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl"
        style={{ borderColor: tone.border }}
        // The backdrop closes on a press; the panel must not, or selecting
        // a value inside it and releasing outside shuts it.
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Fixed, so a thirty-field record never scrolls its own name
            away -- and in the card's own colour, so the zoom is visibly
            the same object that was clicked. */}
        <div className="flex shrink-0 items-start gap-2 px-4 py-3" style={{ backgroundColor: tone.bg }}>
          <span className="absolute left-0 top-0 h-full w-1" style={{ backgroundColor: tone.accent }} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold leading-tight" style={{ color: tone.fg }}>
              {heading || '—'}
            </h3>
            {sub && <p className="mt-0.5 truncate text-xs text-slate-500">{sub}</p>}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-white/70 hover:text-slate-600"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <dl className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto px-4 py-1">
          {lines.map(({ column, value }) => (
            <div key={column} className="flex items-baseline gap-3 py-2">
              <dt className="w-[38%] shrink-0 break-words text-[10px] font-medium uppercase tracking-wider text-slate-400">
                {column}
              </dt>
              <dd className="min-w-0 flex-1 break-words text-[13px] text-slate-700">
                {value === '' ? (
                  <span className="text-slate-300">—</span>
                ) : badgeCols.includes(column) ? (
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={badgeStyle(value)}>
                    {value}
                  </span>
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>

        {/* The zoom READS a record. Changing one is the detail panel's job,
            and only where an admin has turned that on -- two forms for the
            same record is two places for it to be edited differently. */}
        {widget.rowDetail && onOpenDetail && (
          <div className="shrink-0 border-t border-slate-100 px-4 py-2.5 text-right">
            <button
              onClick={() => {
                onOpenDetail(row)
                onClose()
              }}
              className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white"
              style={{ backgroundColor: tone.accent }}
            >
              Open full detail
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
