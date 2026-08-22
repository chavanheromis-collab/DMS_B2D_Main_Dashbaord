// ---------------------------------------------------------------------
// Per-page canvas background
// ---------------------------------------------------------------------
// A page can replace the app's default backdrop with a flat colour, a
// gradient or an image, and dial back how strongly it shows through.
//
// The whole thing is painted on its OWN fixed layer behind the widgets,
// never as a background on the content container. That distinction is the
// reason this module exists: `opacity` and `blur` applied to a container
// would fade and smear the widgets sitting inside it. On a separate layer
// they affect only the backdrop, which is what "how visible is the
// background" has to mean if the dashboard is to stay readable.

export const BACKGROUND_MODES = [
  { value: '', label: 'App default', hint: 'The standard soft gradient.' },
  { value: 'color', label: 'Solid colour', hint: 'One flat colour.' },
  { value: 'gradient', label: 'Gradient', hint: 'Two colours, any angle.' },
  { value: 'image', label: 'Image', hint: 'From a URL - paste any image link.' },
]

export const IMAGE_FITS = [
  { value: 'cover', label: 'Fill the screen (crop)' },
  { value: 'contain', label: 'Fit inside (no crop)' },
  { value: 'repeat', label: 'Tile' },
]

export const IMAGE_POSITIONS = [
  { value: 'center', label: 'Centre' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
]

/** Ready-made looks, so nobody has to invent a palette to get started. */
export const BACKGROUND_PRESETS = [
  { label: 'Midnight', mode: 'gradient', gradientFrom: '#0F172A', gradientTo: '#1E3A8A', angle: 160 },
  { label: 'Sunrise', mode: 'gradient', gradientFrom: '#FEF3C7', gradientTo: '#FBCFE8', angle: 150 },
  { label: 'Mint', mode: 'gradient', gradientFrom: '#ECFDF5', gradientTo: '#CFFAFE', angle: 150 },
  { label: 'Graphite', mode: 'color', color: '#F1F5F9' },
  { label: 'Paper', mode: 'color', color: '#FFFFFF' },
]

export const DEFAULT_BACKGROUND = {
  mode: '',
  color: '#F8FAFC',
  gradientFrom: '#EEF2FF',
  gradientTo: '#CFFAFE',
  angle: 160,
  imageUrl: '',
  imageFit: 'cover',
  imagePosition: 'center',
  // "Visibility": 100 shows the backdrop at full strength, 0 hides it and
  // leaves the app default showing through.
  opacity: 100,
  blur: 0,
  // A wash between the backdrop and the widgets. The thing that makes a
  // photographic background usable at all -- without it, dark text over a
  // busy image is unreadable no matter how the image is tuned.
  overlayColor: '#FFFFFF',
  overlayOpacity: 0,
  fixed: true,
  // 'auto' works the text colour out from the background; 'light'/'dark'
  // pin it, which is the only option for an image backdrop.
  textMode: 'auto',
}

/** Is this page asking for anything other than the app default? */
export function backgroundIsSet(bg) {
  if (!bg?.mode) return false
  if (bg.mode === 'image') return Boolean(String(bg.imageUrl || '').trim())
  return true
}

// The URL allow-list, and the Google Drive rewriting that must happen before
// it, live in lib/imageUrl.js -- backgrounds and icons have to agree on what
// counts as a usable image link, and two copies of that rule would drift
// apart.
//
// Imported AND re-exported, deliberately: `export { x } from '...'` forwards
// the name to importers but creates no local binding, so `backgroundLayers`
// below would not be able to see it.
import { safeImageUrl } from './imageUrl.js'

export { safeImageUrl }

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+n) ? +n : lo))

/**
 * Turns a page's background config into the style objects for the two
 * stacked layers behind the dashboard.
 *
 * Returns `null` when the page uses the app default, so the caller renders
 * nothing at all rather than an invisible pair of divs.
 */
export function backgroundLayers(bg) {
  if (!backgroundIsSet(bg)) return null

  const cfg = { ...DEFAULT_BACKGROUND, ...bg }
  const opacity = clamp(cfg.opacity, 0, 100) / 100
  const blur = clamp(cfg.blur, 0, 40)

  const base = {
    opacity,
    // Blurring an element samples past its own edges, which would show as a
    // soft transparent border all round; scaling up slightly hides that.
    ...(blur ? { filter: `blur(${blur}px)`, transform: 'scale(1.06)' } : null),
  }

  if (cfg.mode === 'color') {
    base.background = cfg.color
  } else if (cfg.mode === 'gradient') {
    base.background = `linear-gradient(${clamp(cfg.angle, 0, 360)}deg, ${cfg.gradientFrom}, ${cfg.gradientTo})`
  } else if (cfg.mode === 'image') {
    // A full-screen backdrop needs a full-screen fetch. Without an explicit
    // width a Drive link would come back at the helper's icon-sized default
    // and stretch into a blurry mess across a wide monitor.
    const url = safeImageUrl(cfg.imageUrl, { width: 1280 })
    // A rejected URL falls back to the app default rather than painting a
    // blank slab -- a typo shouldn't leave someone staring at a void.
    if (!url) return null
    base.backgroundImage = `url(${url})`
    base.backgroundPosition = cfg.imagePosition || 'center'
    base.backgroundRepeat = cfg.imageFit === 'repeat' ? 'repeat' : 'no-repeat'
    if (cfg.imageFit !== 'repeat') base.backgroundSize = cfg.imageFit || 'cover'
    // A colour behind the image means a `contain` fit doesn't leave bare
    // white bars down the sides.
    base.backgroundColor = cfg.color || '#0F172A'
  }

  const overlayOpacity = clamp(cfg.overlayOpacity, 0, 100) / 100
  const overlay = overlayOpacity > 0 ? { background: cfg.overlayColor, opacity: overlayOpacity } : null

  return { base, overlay, fixed: cfg.fixed !== false }
}

// ---------------------------------------------------------------------
// Readable text over whatever the backdrop turns out to be
// ---------------------------------------------------------------------

export const TEXT_MODES = [
  { value: 'auto', label: 'Automatic', hint: 'Works it out from the background colour.' },
  { value: 'dark', label: 'Dark text', hint: 'For light backgrounds.' },
  { value: 'light', label: 'Light text', hint: 'For dark backgrounds.' },
]

/** #RGB or #RRGGBB -> [r, g, b], or null if it isn't a hex colour. */
function parseHex(hex) {
  const s = String(hex || '').trim()
  const short = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i)
  if (short) return short.slice(1).map((c) => parseInt(c + c, 16))
  const full = s.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (full) return full.slice(1).map((c) => parseInt(c, 16))
  return null
}

/**
 * Relative luminance, per WCAG. Not a simple average of the channels:
 * the eye is far more sensitive to green than to blue, so a pure blue and a
 * pure green of the same "average" brightness need very different text.
 */
export function luminance(hex) {
  const rgb = parseHex(hex)
  if (!rgb) return null
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Should this page use light text?
 *
 * Answers for the colour a reader actually ends up looking at, which is the
 * backdrop blended with the tint over it and faded by its own visibility --
 * a black background at 10% visibility is a pale grey, and asking for white
 * text on it would be unreadable.
 *
 * An IMAGE can't be measured from CSS, so `auto` leaves it alone and the
 * admin picks; guessing wrong on a photo is worse than not guessing.
 */
export function usesLightText(bg) {
  const cfg = { ...DEFAULT_BACKGROUND, ...(bg || {}) }
  const mode = cfg.textMode || 'auto'
  if (mode === 'light') return true
  if (mode === 'dark') return false
  if (!backgroundIsSet(cfg)) return false

  let base
  if (cfg.mode === 'color') base = luminance(cfg.color)
  else if (cfg.mode === 'gradient') {
    const a = luminance(cfg.gradientFrom)
    const b = luminance(cfg.gradientTo)
    base = a === null || b === null ? null : (a + b) / 2
  } else return false // an image: unmeasurable, so leave it to the admin

  if (base === null) return false

  // The page sits on a near-white app background, so anything the backdrop
  // doesn't cover reads as white.
  const APP_BG = 1
  const opacity = clamp(cfg.opacity, 0, 100) / 100
  let effective = APP_BG * (1 - opacity) + base * opacity

  const tint = luminance(cfg.overlayColor)
  const tintAlpha = clamp(cfg.overlayOpacity, 0, 100) / 100
  if (tint !== null && tintAlpha > 0) effective = effective * (1 - tintAlpha) + tint * tintAlpha

  // 0.42 rather than 0.5: mid-tone backgrounds read better with dark text,
  // and the widget cards themselves are light, so the page only flips once
  // the backdrop is genuinely dark.
  return effective < 0.42
}

/**
 * A small inline preview for the admin panel. Uses the same resolver, so
 * what an admin sees in the swatch is what the page will actually paint --
 * there's no second implementation to drift out of step.
 */
export function backgroundPreviewStyle(bg) {
  const layers = backgroundLayers(bg)
  if (!layers) return { background: 'linear-gradient(160deg, #f8fafc 0%, #eef2ff 100%)' }

  // The blur is dropped: it would spill past a 40px-tall swatch and read as
  // a smudge rather than as the effect it is at full size.
  const { filter, transform, ...rest } = layers.base
  return rest
}
