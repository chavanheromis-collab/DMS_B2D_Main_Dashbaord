import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Lightbulb, Sparkles } from 'lucide-react'
import { parseBlocks } from '../../lib/richText'
import { countdownState, tickInterval } from '../../lib/countdown'
import AppImage from '../PageIcon.jsx'
import { safeImageUrl } from '../../lib/imageUrl'

// =====================================================================
// The three widgets that carry no data
// =====================================================================
// Everything else on the canvas is a view of a spreadsheet. These three
// are not, and that is the point of them: a dashboard made only of
// numbers is a dashboard where nobody knows which numbers matter.
//
// A note says what the section below it is for. An image puts a floor
// plan or a price list next to the figures about it. A countdown says how
// long is left. None of them read a row, and all three are the difference
// between a wall of charts and a report somebody wrote.

// ---------------------------------------------------------------------
// Inline marks
// ---------------------------------------------------------------------
/**
 * The spans of one line, rendered as real elements.
 *
 * Never `dangerouslySetInnerHTML`. The text is written by one admin and
 * read by everybody, so anything that turned it into markup would turn a
 * pasted string into script running in every other user's session. Tokens
 * in, elements out -- see lib/richText.js.
 */
function Spans({ spans }) {
  return (
    <>
      {spans.map((span, i) => {
        if (span.type === 'strong') return <strong key={i} className="font-semibold">{span.text}</strong>
        if (span.type === 'em') return <em key={i}>{span.text}</em>
        if (span.type === 'strike') return <s key={i} className="opacity-70">{span.text}</s>
        if (span.type === 'code') {
          return (
            <code key={i} className="rounded bg-slate-100 px-1 py-px font-mono text-[0.9em] text-slate-700">
              {span.text}
            </code>
          )
        }
        if (span.type === 'link') {
          return (
            <a
              key={i}
              href={span.href}
              target="_blank"
              // `noreferrer` as well as `noopener`: without it the page
              // being opened is told which dashboard linked to it.
              rel="noopener noreferrer"
              className="font-medium text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-700"
            >
              {span.text}
            </a>
          )
        }
        return <span key={i}>{span.text}</span>
      })}
    </>
  )
}

const HEADING_SIZES = ['text-xl', 'text-lg', 'text-base', 'text-sm']

function Blocks({ blocks }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-slate-600">
      {blocks.map((block, i) => {
        if (block.type === 'rule') return <hr key={i} className="border-slate-200" />

        if (block.type === 'heading') {
          const Tag = `h${Math.min(6, block.level + 1)}`
          return (
            <Tag key={i} className={`font-semibold text-slate-800 ${HEADING_SIZES[block.level - 1] || 'text-sm'}`}>
              <Spans spans={block.spans} />
            </Tag>
          )
        }

        if (block.type === 'quote') {
          return (
            <blockquote key={i} className="border-l-2 border-slate-300 pl-3 italic text-slate-500">
              <Spans spans={block.spans} />
            </blockquote>
          )
        }

        if (block.type === 'list') {
          if (block.checklist) {
            return (
              <ul key={i} className="space-y-1">
                {block.items.map((item, j) => (
                  <li key={j} className="flex items-start gap-2">
                    {/* Not an <input>. A checkbox somebody can tick but
                        which saves nothing is a promise the widget cannot
                        keep -- this is a written list, and it looks like
                        one that was written. */}
                    <span
                      className={`mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[9px] ${
                        item.checked
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-slate-300 bg-white'
                      }`}
                      aria-hidden
                    >
                      {item.checked ? '✓' : ''}
                    </span>
                    <span className={item.checked ? 'text-slate-400 line-through' : ''}>
                      <Spans spans={item.spans} />
                    </span>
                  </li>
                ))}
              </ul>
            )
          }

          const Tag = block.ordered ? 'ol' : 'ul'
          return (
            <Tag
              key={i}
              start={block.ordered ? block.start : undefined}
              className={`ml-4 space-y-1 ${block.ordered ? 'list-decimal' : 'list-disc'} marker:text-slate-400`}
            >
              {block.items.map((item, j) => (
                <li key={j}>
                  <Spans spans={item.spans} />
                </li>
              ))}
            </Tag>
          )
        }

        return (
          <p key={i}>
            <Spans spans={block.spans} />
          </p>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------
// Note
// ---------------------------------------------------------------------
/** The five looks a note can have, and what each one is FOR. */
export const NOTE_STYLES = [
  { value: 'plain', label: 'Plain text', hint: 'A caption. Says nothing about itself.' },
  { value: 'section', label: 'Section heading', hint: 'A rule and a title. Cuts a long page into parts.' },
  { value: 'callout', label: 'Callout', hint: 'A tinted panel with an icon. For a caveat people must read.' },
  { value: 'banner', label: 'Banner', hint: 'Full-width, coloured. For one announcement at the top.' },
  { value: 'quote', label: 'Quote', hint: 'Indented and italic. For somebody else’s words.' },
]

export const CALLOUT_TONES = [
  { value: 'info', label: 'Information', color: '#0284C7', bg: '#F0F9FF', border: '#BAE6FD' },
  { value: 'success', label: 'Good news', color: '#059669', bg: '#F0FDF4', border: '#BBF7D0' },
  { value: 'warning', label: 'Careful', color: '#B45309', bg: '#FFFBEB', border: '#FDE68A' },
  { value: 'danger', label: 'Problem', color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
  { value: 'tip', label: 'Tip', color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
]

const TONE_ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertTriangle,
  tip: Lightbulb,
}

/**
 * Text an admin wrote, on the canvas.
 *
 * The most-requested thing a dashboard cannot do until it can do this:
 * say what a section is, why a number excludes something, or who to ask.
 * Without it every such sentence lives in a separate email that the person
 * reading the dashboard has not got.
 */
export default function NoteWidget({ widget }) {
  const blocks = useMemo(() => parseBlocks(widget.text || ''), [widget.text])
  const tone = CALLOUT_TONES.find((t) => t.value === (widget.tone || 'info')) || CALLOUT_TONES[0]
  const style = widget.noteStyle || 'plain'
  const align = widget.align || 'left'
  const alignClass = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : ''

  if (!String(widget.text || '').trim() && !widget.title) {
    return (
      <div className="card">
        <p className="empty-state">Write something in the editor</p>
      </div>
    )
  }

  // A section heading is deliberately NOT a card. Its whole job is to
  // separate the cards below it from the cards above, and a heading in a
  // box of its own is just another tile in the row.
  if (style === 'section') {
    return (
      <div className={`page-chrome py-1 ${alignClass}`}>
        <div className={`flex items-center gap-3 ${align === 'center' ? 'justify-center' : ''}`}>
          {widget.icon && <span className="text-lg leading-none">{widget.icon}</span>}
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">{widget.title}</h2>
          {align !== 'center' && <span className="h-px flex-1 bg-gradient-to-r from-slate-300 to-transparent" />}
        </div>
        {blocks.length > 0 && (
          <div className="mt-1.5">
            <Blocks blocks={blocks} />
          </div>
        )}
      </div>
    )
  }

  if (style === 'banner') {
    const accent = widget.color || '#4F46E5'
    return (
      <div
        className={`overflow-hidden rounded-2xl px-5 py-4 ${alignClass}`}
        style={{
          background: `linear-gradient(135deg, ${accent} 0%, ${accent}CC 100%)`,
          boxShadow: '0 10px 30px -12px rgba(15,23,42,0.35)',
        }}
      >
        <div className={`flex items-start gap-3 ${align === 'center' ? 'justify-center' : ''}`}>
          {widget.icon ? (
            <span className="text-2xl leading-none">{widget.icon}</span>
          ) : (
            <Sparkles size={20} className="mt-0.5 shrink-0 text-white/80" />
          )}
          <div className="min-w-0">
            {widget.title && <h2 className="text-base font-semibold text-white">{widget.title}</h2>}
            {/* The banner's own colours have to win over the neutral greys
                the block renderer uses, or white-on-indigo text arrives as
                grey-on-indigo. */}
            <div className="[&_*]:!text-white/90 [&_a]:!text-white [&_strong]:!text-white">
              <Blocks blocks={blocks} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (style === 'callout') {
    const Icon = TONE_ICONS[tone.value] || Info
    return (
      <div
        className={`rounded-xl border px-4 py-3 ${alignClass}`}
        style={{ backgroundColor: tone.bg, borderColor: tone.border }}
      >
        <div className="flex items-start gap-2.5">
          {widget.icon ? (
            <span className="mt-px text-base leading-none">{widget.icon}</span>
          ) : (
            <Icon size={16} className="mt-0.5 shrink-0" style={{ color: tone.color }} />
          )}
          <div className="min-w-0 flex-1">
            {widget.title && (
              <p className="mb-0.5 text-sm font-semibold" style={{ color: tone.color }}>
                {widget.title}
              </p>
            )}
            <Blocks blocks={blocks} />
          </div>
        </div>
      </div>
    )
  }

  if (style === 'quote') {
    return (
      <div className="card">
        <blockquote className="border-l-[3px] pl-4" style={{ borderColor: widget.color || '#C7D2FE' }}>
          <div className="text-[15px] italic leading-relaxed text-slate-600">
            <Blocks blocks={blocks} />
          </div>
          {widget.title && <footer className="mt-2 text-[11px] font-medium text-slate-400">— {widget.title}</footer>}
        </blockquote>
      </div>
    )
  }

  return (
    <div className={`card ${alignClass}`}>
      {widget.title && (
        <h2 className="widget-title mb-1.5">
          {widget.icon} {widget.title}
        </h2>
      )}
      <Blocks blocks={blocks} />
    </div>
  )
}

// ---------------------------------------------------------------------
// Image / media
// ---------------------------------------------------------------------
export const MEDIA_FITS = [
  { value: 'contain', label: 'Fit inside — show all of it' },
  { value: 'cover', label: 'Fill the card — crop the edges' },
  { value: 'none', label: 'Actual size' },
]

/**
 * A picture on the canvas.
 *
 * Goes through the same URL handling as every other admin-supplied image
 * (lib/imageUrl.js), which is what makes a pasted Google Drive link work
 * -- Drive serves no single URL that always loads, so the candidates are
 * walked on error rather than surrendering to the first refusal.
 *
 * Deliberately an IMAGE and not an embed. An `<iframe>` here would let any
 * admin run another site's JavaScript inside every reader's session, which
 * is not a trade worth making for a widget that shows a floor plan.
 */
export function MediaWidget({ widget }) {
  const url = safeImageUrl(widget.imageUrl)
  const fit = widget.fit || 'contain'
  const caption = String(widget.caption || '').trim()

  const image = url ? (
    <AppImage
      src={widget.imageUrl}
      alt={widget.alt || widget.title || ''}
      size={Number(widget.imageWidth) > 0 ? Number(widget.imageWidth) : 900}
      fit={fit === 'none' ? 'contain' : fit}
      rounded={widget.rounded === false ? 'rounded-none' : 'rounded-xl'}
      ring={false}
      fallback=""
      className="!h-auto !w-full"
      style={{
        width: '100%',
        height: widget.imageHeight ? `${Number(widget.imageHeight)}px` : 'auto',
        maxHeight: widget.imageHeight ? `${Number(widget.imageHeight)}px` : undefined,
        objectFit: fit === 'none' ? 'none' : fit,
      }}
    />
  ) : (
    <p className="empty-state">Paste an image link in the editor</p>
  )

  // "Bare" drops the card entirely, which is the only way a logo or a
  // divider graphic can sit on the page without a box drawn round it.
  if (widget.bare) {
    return (
      <div className="flex flex-col items-center gap-1">
        {image}
        {caption && <p className="text-center text-[11px] text-slate-400">{caption}</p>}
      </div>
    )
  }

  return (
    <div className="card flex h-full flex-col">
      {widget.title && (
        <h2 className="widget-title mb-2">
          {widget.icon || '🖼️'} {widget.title}
        </h2>
      )}
      <div className="flex flex-1 items-center justify-center overflow-hidden">{image}</div>
      {caption && <p className="mt-2 text-center text-[11px] text-slate-400">{caption}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------
// Countdown / clock
// ---------------------------------------------------------------------
const UNIT_LABELS = { days: 'days', hours: 'hrs', minutes: 'min', seconds: 'sec' }

const SIZE_CLASSES = {
  small: { number: 'text-2xl', unit: 'text-[9px]', gap: 'gap-2' },
  large: { number: 'text-4xl', unit: 'text-[10px]', gap: 'gap-3' },
  huge: { number: 'text-6xl', unit: 'text-xs', gap: 'gap-4' },
}

/**
 * Time left, time since, or the time now.
 *
 * Redraws on an interval the STATE chooses rather than every second
 * regardless -- a deadline three months out changes one digit a day, and
 * ticking it 86,400 times to do that is a repaint per second in every open
 * tab for no visible difference. See lib/countdown.js.
 */
export function CountdownWidget({ widget }) {
  const [now, setNow] = useState(() => new Date())
  const state = useMemo(() => countdownState(widget, now), [widget, now])
  const interval = tickInterval(state)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), interval)
    return () => clearInterval(id)
  }, [interval])

  const size = SIZE_CLASSES[widget.size] || SIZE_CLASSES.large

  if (!state.ready) {
    return (
      <div className="card">
        <h2 className="widget-title mb-2">⏳ {widget.title}</h2>
        <p className="empty-state">{state.reason || 'Pick a date in the editor'}</p>
      </div>
    )
  }

  if (state.mode === 'clock') {
    return (
      <div className="card flex h-full flex-col items-center justify-center py-4 text-center">
        {widget.title && <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{widget.title}</p>}
        <p className={`font-bold tabular-nums leading-none ${size.number}`} style={{ color: state.color }}>
          {state.clock}
        </p>
        {widget.showDate !== false && (
          <p className="mt-2 text-xs text-slate-400">
            {widget.showWeekday !== false && `${state.weekday}, `}
            {state.date}
          </p>
        )}
      </div>
    )
  }

  const done = state.done
  const label = widget.label || widget.title

  return (
    <div className="card flex h-full flex-col items-center justify-center py-4 text-center">
      {label && <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>}

      {done ? (
        <p className={`font-bold leading-none ${size.number}`} style={{ color: state.color }}>
          {widget.doneLabel || 'Time’s up'}
        </p>
      ) : (
        <div className={`flex items-end justify-center ${size.gap}`}>
          {state.units.map((unit) => (
            <div key={unit} className="flex flex-col items-center">
              <span className={`font-bold tabular-nums leading-none ${size.number}`} style={{ color: state.color }}>
                {/* Padded so the digits do not shuffle sideways as the
                    number crosses ten -- a clock that jitters reads as
                    broken even when it is right. */}
                {unit === 'days' ? state.parts[unit] : String(state.parts[unit]).padStart(2, '0')}
              </span>
              <span className={`mt-1 font-medium uppercase tracking-wide text-slate-400 ${size.unit}`}>
                {UNIT_LABELS[unit]}
              </span>
            </div>
          ))}
        </div>
      )}

      {widget.showDate !== false && (
        <p className="mt-3 text-[11px] text-slate-400">
          {state.mode === 'since' ? 'since' : done ? 'was' : 'until'} {state.targetWeekday}, {state.targetLabel}
        </p>
      )}

      {state.urgency !== 'normal' && !done && (
        <span
          className="mt-2 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ backgroundColor: `${state.color}18`, color: state.color }}
        >
          {state.urgency === 'danger' ? 'Due now' : 'Due soon'}
        </span>
      )}
    </div>
  )
}
