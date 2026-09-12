import { useEffect, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  File,
  FileText,
  Image as ImageIcon,
  Link as LinkIcon,
  Music,
  Video,
  X,
} from 'lucide-react'

import { MEDIA_KINDS, mediaLabel, previewUrl, stepMedia, viewerFor } from '../lib/media'
import { triggerDownload } from '../lib/downloadActions'
import { useImageFallback } from '../hooks/useImageFallback'

// ---------------------------------------------------------------------
// Looking at what is in the cell
// ---------------------------------------------------------------------
// A tile, and the thing itself over the page.
//
// The two are deliberately one file: what a tile shows and what opening
// it shows are the same decision made twice, and a PDF that draws a page
// in the table and then refuses to open is worse than one that never
// offered.

const ICONS = {
  image: ImageIcon,
  'file-text': FileText,
  video: Video,
  music: Music,
  file: File,
  link: LinkIcon,
}

export function MediaIcon({ kind, size = 13, className = '' }) {
  const Glyph = ICONS[MEDIA_KINDS[kind]?.icon] || LinkIcon
  return <Glyph size={size} className={className} />
}

/**
 * One file, as small as the place it is in.
 *
 * Where a picture can be drawn it is drawn -- including the first page of
 * a PDF, which Drive renders and which is the single most useful thing on
 * this screen: "is this the right invoice" is answered by looking, not by
 * downloading.
 *
 * Where one cannot, the icon says WHICH KIND rather than "file". A row of
 * identical grey squares is a row that has to be clicked to be read.
 */
export function MediaTile({ item, size = 40, onOpen, showName = false }) {
  const thumb = previewUrl(item, size)
  const { url, exhausted, onError } = useImageFallback(thumb, size)
  const drawable = Boolean(thumb) && Boolean(url) && !exhausted

  return (
    <button
      type="button"
      onClick={(e) => {
        // Inside a table cell and inside a card, both of which do
        // something else when clicked.
        e.stopPropagation()
        onOpen?.(item)
      }}
      title={`${item.name} — ${mediaLabel(item)}`}
      aria-label={`Open ${item.name}`}
      className="group relative shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-all hover:border-indigo-400 hover:shadow-md"
      style={{ width: size, height: size }}
    >
      {drawable ? (
        <img
          src={url}
          alt=""
          onError={onError}
          // Google refuses image requests carrying a referrer from an
          // origin it does not know, which is every deployment of this.
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-slate-50 text-slate-400 group-hover:text-indigo-500">
          <MediaIcon kind={item.kind} size={Math.max(12, Math.round(size * 0.38))} />
          {size >= 48 && (
            <span className="px-1 text-[8px] font-semibold uppercase tracking-wide">
              {MEDIA_KINDS[item.kind]?.label || 'File'}
            </span>
          )}
        </span>
      )}

      {/* A PDF whose first page is drawn still has to say it is a PDF --
          a page of text at 40px is a grey rectangle. */}
      {drawable && item.kind !== 'image' && (
        <span className="absolute bottom-0 right-0 flex items-center justify-center rounded-tl bg-slate-900/70 px-1 py-px text-[7px] font-bold uppercase text-white">
          {item.kind === 'drive' ? 'Drive' : MEDIA_KINDS[item.kind]?.label}
        </span>
      )}

      {showName && (
        <span className="absolute inset-x-0 bottom-0 truncate bg-slate-900/60 px-1 py-0.5 text-[8px] text-white">
          {item.column}
        </span>
      )}
    </button>
  )
}

/**
 * The files on one row, as a strip.
 *
 * Capped, with the overflow counted rather than wrapped onto a second
 * line: in a table cell a second line changes the height of every row in
 * the table, and on a card it pushes the fields off the bottom.
 */
export function MediaStrip({ items, size = 28, max = 4, onOpen, showName = false }) {
  if (!items || items.length === 0) return null
  const shown = items.slice(0, max)
  const rest = items.length - shown.length

  return (
    <span className="inline-flex items-center gap-1">
      {shown.map((item, i) => (
        <MediaTile key={`${item.column}-${i}`} item={item} size={size} onOpen={onOpen} showName={showName} />
      ))}
      {rest > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onOpen?.(items[max])
          }}
          className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-semibold text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
          style={{ height: size }}
        >
          +{rest}
        </button>
      )}
    </span>
  )
}

/**
 * The file itself, over the page.
 *
 * Dark rather than the white card every other dialog in this app uses,
 * and for a reason that is not decoration: a photo and a scanned page are
 * both judged against what is behind them, and a white surround makes an
 * under-exposed photo look correct and a scan look grey.
 *
 * It pages through the row's files. A row with three photos of the same
 * damage is looked at as three photos, and closing and reopening twice to
 * do it is the sort of thing that makes people go back to the spreadsheet.
 */
export default function MediaViewer({ items, index = 0, onIndex, onClose }) {
  const [failed, setFailed] = useState(false)
  const item = items?.[index]
  const view = viewerFor(item)

  useEffect(() => setFailed(false), [item?.url])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') onIndex(stepMedia(index, items.length, 1))
      if (e.key === 'ArrowLeft') onIndex(stepMedia(index, items.length, -1))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [index, items, onIndex, onClose])

  if (!item) return null
  const many = items.length > 1

  return (
    <div
      className="no-print fixed inset-0 z-[10040] flex flex-col bg-slate-950/90 backdrop-blur-sm"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={mediaLabel(item)}
    >
      {/* --- what it is, and what else can be done with it ------------- */}
      <div
        className="flex shrink-0 items-center gap-2 px-3 py-2 text-white"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <MediaIcon kind={item.kind} size={15} className="shrink-0 text-white/70" />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold">{item.name}</span>
          <span className="block truncate text-[10px] text-white/60">{mediaLabel(item)}</span>
        </span>

        {many && (
          <span className="ml-2 shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold tabular-nums">
            {index + 1} / {items.length}
          </span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-1">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-white/80 hover:bg-white/15 hover:text-white"
          >
            <ExternalLink size={13} /> Open
          </a>
          <button
            onClick={() => triggerDownload(item.url, item.name)}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-white/80 hover:bg-white/15 hover:text-white"
          >
            <Download size={13} /> Download
          </button>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-white/70 hover:bg-white/15 hover:text-white"
          >
            <X size={16} />
          </button>
        </span>
      </div>

      {/* --- the thing itself ------------------------------------------ */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-3">
        {many && (
          <Arrow side="left" onClick={() => onIndex(stepMedia(index, items.length, -1))} />
        )}

        <div
          className="flex h-full w-full items-center justify-center"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {failed || view.mode === 'none' ? (
            <Unshowable item={item} />
          ) : view.mode === 'image' ? (
            <img
              src={view.src}
              alt={item.name}
              referrerPolicy="no-referrer"
              onError={() => setFailed(true)}
              className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            />
          ) : view.mode === 'video' ? (
            <video src={view.src} controls autoPlay className="max-h-full max-w-full rounded-lg shadow-2xl" />
          ) : view.mode === 'audio' ? (
            <div className="rounded-2xl bg-white/10 p-6 text-center">
              <Music size={40} className="mx-auto mb-3 text-white/70" />
              <audio src={view.src} controls autoPlay className="w-[min(80vw,420px)]" />
            </div>
          ) : (
            /* A PDF, a Drive file, a document. The browser's own viewer
               and Drive's own viewer are both better than anything worth
               writing here, and both are one iframe. */
            <iframe
              src={view.src}
              title={item.name}
              className="h-full w-full rounded-lg border-0 bg-white shadow-2xl"
              allow="autoplay"
            />
          )}
        </div>

        {many && <Arrow side="right" onClick={() => onIndex(stepMedia(index, items.length, 1))} />}
      </div>
    </div>
  )
}

function Arrow({ side, onClick }) {
  const Glyph = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-label={side === 'left' ? 'Previous file' : 'Next file'}
      className={`absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/15 p-2 text-white backdrop-blur transition-colors hover:bg-white/30 ${
        side === 'left' ? 'left-4' : 'right-4'
      }`}
    >
      <Glyph size={20} />
    </button>
  )
}

/**
 * What to show when it cannot be shown.
 *
 * Not an empty frame and not a broken-image glyph. A link this app cannot
 * render is still a link that works, and saying which kind it is and
 * offering to open it is the whole of what is left to do.
 */
function Unshowable({ item }) {
  return (
    <div className="max-w-sm rounded-2xl bg-white/10 p-6 text-center text-white">
      <MediaIcon kind={item.kind} size={36} className="mx-auto mb-3 text-white/70" />
      <p className="truncate text-sm font-semibold">{item.name}</p>
      <p className="mt-1 text-[11px] text-white/70">
        This one cannot be shown here — it will open in its own tab.
      </p>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-800 hover:bg-slate-100"
      >
        <ExternalLink size={13} /> Open it
      </a>
    </div>
  )
}
