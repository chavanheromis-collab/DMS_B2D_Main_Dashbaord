import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, Copy, ExternalLink, Table as TableIcon } from 'lucide-react'
import { cleanSharedRow, linkOf, pageHref, sharedFrom, sharedRowText, visibleFields } from '../lib/rowShare'

/**
 * A row somebody sent, drawn as the record it is.
 *
 * The same card everywhere a message appears -- in the chat, on a banner,
 * over the page -- so a row reads the same however it reached somebody.
 *
 * White with dark text wherever it sits, including inside the sender's own
 * indigo bubble: it is a piece of the SHEET quoted into a conversation, and
 * a record printed in white-on-indigo would read as something the sender
 * wrote rather than something they are pointing at.
 *
 * `compact` is for the banner and the pop-up, where the message is the
 * interruption and the card is its evidence: fewer fields before "show all",
 * and no link away from the page the reader is on.
 */
export default function SharedRowCard({ row: raw, compact = false, className = '' }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const row = cleanSharedRow(raw)
  if (!row) return null

  const { shown, hidden } = visibleFields(row, { expanded, limit: compact ? 4 : undefined })
  const from = sharedFrom(row)
  const href = compact ? null : pageHref(row)

  async function copy(e) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(sharedRowText(row))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // No clipboard -- an insecure origin, or permission refused. The
      // values are on screen to be selected by hand.
    }
  }

  return (
    <div
      className={`overflow-hidden rounded-xl border border-slate-200 bg-white text-left text-slate-700 shadow-sm ${className}`}
    >
      <div className="flex items-start gap-2 border-b border-slate-100 bg-slate-50 px-2.5 py-1.5">
        <TableIcon size={13} className="mt-0.5 shrink-0 text-indigo-500" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-slate-800" title={row.title}>
            {row.title}
          </p>
          {from && (
            <p className="truncate text-[10px] text-slate-400" title={from}>
              {from}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={copy}
          title={copied ? 'Copied' : 'Copy as text'}
          aria-label="Copy this row as text"
          className="shrink-0 rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700"
        >
          {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
        </button>
      </div>

      <dl className="divide-y divide-slate-50 px-2.5">
        {shown.map((field) => {
          const link = linkOf(field.value)
          return (
            <div key={field.column} className="flex items-baseline gap-2 py-1">
              <dt
                className="w-[40%] shrink-0 truncate text-[9px] font-medium uppercase tracking-wider text-slate-400"
                title={field.column}
              >
                {field.column}
              </dt>
              <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[12px] text-slate-700">
                {link ? (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title={link}
                    className="inline-flex items-center gap-0.5 text-indigo-600 underline decoration-indigo-200 hover:decoration-indigo-600"
                  >
                    Open link <ExternalLink size={10} />
                  </a>
                ) : (
                  field.value || <span className="text-slate-300">—</span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>

      {(hidden > 0 || expanded || href) && (
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-2.5 py-1">
          {hidden > 0 || expanded ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setExpanded((v) => !v)
              }}
              className="text-[10px] font-medium text-indigo-600 hover:underline"
            >
              {expanded ? 'Show fewer' : `Show all ${row.fields.length} fields`}
            </button>
          ) : (
            <span />
          )}
          {href && (
            // Somebody who cannot open that page lands wherever the
            // dashboard puts people without access -- the card has already
            // told them everything the sender was allowed to.
            <Link
              to={href}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-slate-500 hover:text-indigo-600"
            >
              Open the page <ArrowUpRight size={10} />
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
