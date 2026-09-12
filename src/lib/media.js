// ---------------------------------------------------------------------
// Files in a cell
// ---------------------------------------------------------------------
// A sheet column full of links is one of the commonest things in a real
// dashboard: the photo of the damage, the signed delivery note, the RC
// book, the invoice PDF. Until now the only thing this app could do with
// one was DOWNLOAD it -- which means leaving the dashboard, waiting, and
// opening something in another application to answer a question that
// takes one second of looking.
//
// So a media column shows the file instead of the address of it. A
// thumbnail in the table, the thing itself in a viewer over the page, and
// the download button still there for when somebody actually wants the
// file rather than a look at it.
//
// Three decisions shape everything here:
//
//   THE ADMIN SAYS WHICH COLUMNS. Not sniffed from the data. A dashboard
//   that silently turned a column of URLs into thumbnails the day this
//   shipped would have redesigned itself, and a long link in a narrow
//   column is sometimes exactly what somebody wants to read. Marked, like
//   pills and download columns are marked.
//
//   THE KIND COMES FROM THE LINK. Not from a second setting per column,
//   because one column very often holds both a photo and a PDF -- the
//   "Attachment" column always does -- and an admin who had to promise
//   "these are all images" would be wrong by Tuesday.
//
//   GOOGLE DRIVE IS THE COMMON CASE and is handled as its own kind. A
//   Drive link says nothing about what it points at, but Drive will
//   render a thumbnail of ANYTHING -- a photo, the first page of a PDF, a
//   spreadsheet -- and its own preview page displays every type it knows.
//   So a Drive link needs no extension to be shown properly, which is
//   just as well, because it never has one.

import { driveFileId, driveImageCandidates, isDriveUrl, safeImageUrl } from './imageUrl.js'

/** Where the admin's list lives on the widget. */
export const MEDIA_COLUMNS = 'mediaColumns'

/**
 * What a link can turn out to be.
 *
 * `viewer` is how it is shown over the page; `icon` is the lucide name the
 * components map to a component, kept here so the model decides what a
 * thing IS and the component only decides how big to draw it.
 */
export const MEDIA_KINDS = {
  image: { label: 'Image', viewer: 'image', icon: 'image', thumbs: true },
  pdf: { label: 'PDF', viewer: 'frame', icon: 'file-text', thumbs: false },
  video: { label: 'Video', viewer: 'video', icon: 'video', thumbs: false },
  audio: { label: 'Audio', viewer: 'audio', icon: 'music', thumbs: false },
  drive: { label: 'Drive file', viewer: 'frame', icon: 'file', thumbs: true },
  link: { label: 'Link', viewer: 'none', icon: 'link', thumbs: false },
}

const EXTENSIONS = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'heic'],
  pdf: ['pdf'],
  video: ['mp4', 'webm', 'ogv', 'mov', 'm4v'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'],
}

/** The columns an admin has marked as holding files. */
export function mediaColumnsOf(widget) {
  return (widget?.[MEDIA_COLUMNS] || []).filter(Boolean)
}

export const isMediaColumn = (widget, column) => mediaColumnsOf(widget).includes(column)

/**
 * The extension in a URL, ignoring everything that is not the path.
 *
 * `?sz=w400` and `#page=2` are not file types, and a query string is
 * where half the links in a real sheet keep their access token.
 */
export function extensionOf(url) {
  const path = String(url || '')
    .split(/[?#]/)[0]
    .toLowerCase()
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  if (dot === -1 || dot < slash) return ''
  return path.slice(dot + 1)
}

/**
 * What this link points at.
 *
 * Extension first, because a Drive link to a .pdf still behaves best in
 * Drive's own viewer but an ordinary link to one does not need it. Then
 * Drive, which is its own answer. Then `link`, which is honest: the app
 * cannot show it, so it offers to open it.
 */
export function kindOf(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  if (isDriveUrl(raw) || driveFileId(raw)) return 'drive'

  const ext = extensionOf(raw)
  for (const [kind, list] of Object.entries(EXTENSIONS)) {
    if (list.includes(ext)) return kind
  }
  // A data: URI is only ever going to be an image in a spreadsheet.
  if (/^data:image\//i.test(raw)) return 'image'
  return 'link'
}

/**
 * Only what a browser will actually fetch.
 *
 * The same allow-list every other admin-supplied address goes through: a
 * cell is data somebody typed into a spreadsheet, and it lands in an
 * `src` here.
 */
export function mediaUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  if (/^data:image\//i.test(raw)) return raw
  return /^https?:\/\//i.test(raw) ? raw : ''
}

/** The file's own name, for a label and for the download. */
export function fileNameOf(url, fallback = '') {
  const path = String(url || '').split(/[?#]/)[0]
  const last = path.slice(path.lastIndexOf('/') + 1)
  try {
    return decodeURIComponent(last) || fallback
  } catch {
    return last || fallback
  }
}

/**
 * Every file on one row, in the order the admin listed the columns.
 *
 * One CELL can hold several, separated by commas or newlines -- which is
 * what a sheet looks like the moment somebody has two photos of the same
 * damage. Splitting on a comma is safe here because a URL cannot contain
 * an unescaped one.
 */
export function mediaOf(row, columns = []) {
  const out = []
  for (const column of columns) {
    const cell = String(row?.[column] ?? '').trim()
    if (!cell) continue
    for (const piece of cell.split(/[\n,]+/)) {
      const url = mediaUrl(piece.trim())
      if (!url) continue
      out.push({
        column,
        url,
        kind: kindOf(url),
        name: fileNameOf(url, column),
      })
    }
  }
  return out
}

export const hasMedia = (row, columns) => mediaOf(row, columns).length > 0

/**
 * The picture to draw in a table cell or on a card, or ''.
 *
 * Drive answers for everything it holds -- a photo, the first page of a
 * PDF, a slide -- which is the whole reason a Drive link needs no type.
 * Everything else can only be previewed if it is already a picture.
 *
 * `width` is what will be drawn; it is doubled inside `driveImageCandidates`
 * for the same reason every other image in this app is.
 */
export function previewUrl(item, width = 96) {
  if (!item?.url) return ''
  const id = driveFileId(item.url)
  if (id) return driveImageCandidates(id, width)[1] || ''
  if (item.kind === 'image') return safeImageUrl(item.url, { width })
  return ''
}

/**
 * What the viewer loads, and how.
 *
 * A Drive file goes to Drive's own preview page rather than to the file:
 * `/preview` renders a PDF, a document, a sheet and a video in an iframe
 * with no sign-in dance, and the direct link to a Drive PDF does not
 * render at all -- it downloads.
 */
export function viewerFor(item) {
  if (!item?.url) return { mode: 'none', src: '' }
  const kind = item.kind || kindOf(item.url)
  const spec = MEDIA_KINDS[kind] || MEDIA_KINDS.link

  const id = driveFileId(item.url)
  if (id) return { mode: 'frame', src: `https://drive.google.com/file/d/${id}/preview` }

  return { mode: spec.viewer, src: item.url }
}

/** Can this be shown at all, or only opened? */
export const canShow = (item) => viewerFor(item).mode !== 'none'

/** "Damage photo · Image", for the caption over the viewer. */
export function mediaLabel(item) {
  const kind = MEDIA_KINDS[item?.kind]?.label || 'File'
  return item?.column ? `${item.column} · ${kind}` : kind
}

/**
 * Moving between the files on one row.
 *
 * Wraps, because a row with three photos is looked at in a loop and
 * hitting a wall at the third is a dead end nobody expects. Returns the
 * same index when there is only one, so the arrows can hide themselves.
 */
export function stepMedia(index, count, by) {
  if (!Number.isFinite(count) || count <= 1) return 0
  return (((index + by) % count) + count) % count
}

/**
 * How big a preview tile is, given how many are on the card.
 *
 * One file gets a strip worth looking at; six get a row of stamps. The
 * alternative -- one fixed size -- either wastes half a card on a single
 * thumbnail or shows six pictures too small to recognise.
 */
export function tileSize(count) {
  if (count <= 1) return 84
  if (count <= 3) return 56
  return 40
}
