export function getDownloadActions(row, columns = []) {
  if (!row || !Array.isArray(columns)) return []

  return columns
    .map((column) => {
      const url = String(row[column] ?? '').trim()
      if (!url) return null

      return {
        column,
        label: String(column || 'Download'),
        url,
      }
    })
    .filter(Boolean)
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`
}

export async function fetchDownloadMeta(url) {
  if (!url) return null

  try {
    const head = await fetch(url, { method: 'HEAD', mode: 'cors', cache: 'no-store' })
    const length = Number(head.headers.get('Content-Length') || '')
    if (head.ok && Number.isFinite(length) && length > 0) return formatBytes(length)
  } catch {
    // Some file hosts do not expose headers on a HEAD request; fall through.
  }

  try {
    const response = await fetch(url, { method: 'GET', mode: 'cors', cache: 'no-store' })
    const length = Number(response.headers.get('Content-Length') || '')
    if (response.ok && Number.isFinite(length) && length > 0) return formatBytes(length)
  } catch {
    // Best-effort metadata only: the download still works even when size is unknown.
  }

  return null
}

export function triggerDownload(url, fileName = 'download') {
  if (!url) return

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noopener noreferrer'
  anchor.target = '_self'
  if (fileName) anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
