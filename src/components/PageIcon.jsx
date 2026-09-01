import { useImageFallback } from '../hooks/useImageFallback'

/**
 * An admin-supplied image, presented properly and made to actually load.
 *
 * Two problems this solves.
 *
 * LOADING. No single Google Drive endpoint serves every file, so a Drive
 * link yields several candidate URLs and this walks them on error rather
 * than giving up on the first refusal (see lib/imageUrl.js). Google also
 * rejects image requests that carry a referrer from an unknown origin, so
 * `referrerPolicy="no-referrer"` is set -- without it a perfectly public
 * file still 403s.
 *
 * LOOKING RIGHT. A fixed square box with `object-cover` keeps a wide logo
 * and a tall one on the same grid; a hairline ring stops a white-background
 * logo dissolving into a white card; and the image is fetched at TWICE its
 * displayed size, because a 20px icon fetched at 20px is visibly soft on any
 * modern screen.
 *
 * When everything fails it falls back to the emoji -- never a broken-image
 * glyph, which is the one thing that always looks unfinished.
 */
export default function AppImage({
  src,
  fallback = '📊',
  size = 20,
  rounded = 'rounded-md',
  ring = true,
  fit = 'cover',
  alt = '',
  className = '',
  style,
}) {
  const { url, onError } = useImageFallback(src, size)

  if (!url) {
    if (!fallback) return null
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center leading-none ${className}`}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.86), ...style }}
        aria-hidden
      >
        {fallback}
      </span>
    )
  }

  return (
    <img
      key={url}
      src={url}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      // Google's image hosts refuse requests that carry a referrer from an
      // origin they don't know, which is every dashboard deployment.
      referrerPolicy="no-referrer"
      onError={onError}
      className={`shrink-0 bg-white ${fit === 'contain' ? 'object-contain' : 'object-cover'} ${rounded} ${
        ring ? 'shadow-sm ring-1 ring-slate-900/10' : ''
      } ${className}`}
      style={{ width: size, height: size, ...style }}
    />
  )
}

/** A page's mark: its image when one is set and usable, otherwise its emoji. */
export function PageIcon({ page, size = 18, className = '', ring = true }) {
  return (
    <AppImage
      src={page?.iconUrl}
      fallback={page?.icon || '📊'}
      size={size}
      ring={ring}
      className={className}
      alt={page?.name ? `${page.name} icon` : ''}
    />
  )
}
