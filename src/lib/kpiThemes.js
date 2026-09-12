// ---------------------------------------------------------------------
// What a KPI card is made of
// ---------------------------------------------------------------------
// The SHAPE decides what the eye does with the number (see kpiShapes.js).
// The THEME decides what the card is: plain white, a soft wash of the
// colour, a solid block of it, or a dark tile in a row of dark tiles.
//
// They are separate settings because they are separate decisions and
// they multiply. Six shapes times six themes is thirty-six cards from
// two dropdowns; folding them into one list would be thirty-six entries
// in a picker, most of which nobody would ever scroll to.
//
// Every theme is expressed in the SAME custom properties the Look tab
// already uses -- `--card-bg`, `--card-text`, `--card-border-color` --
// rather than in classes of its own. Two consequences, and both are the
// reason it is done this way:
//
//   THE LOOK TAB STILL WINS. A theme is a preset; a colour somebody
//   typed is a decision. The widget's own style is applied after this,
//   so it overrides rather than fights.
//
//   THE DARK ONES ARE ALREADY HANDLED. `.card` paints a white sheen down
//   its first few centimetres, which is right on near-white and a grey
//   smear on anything darker. `card-ownbg` is the existing switch that
//   turns it off, and the dark themes ask for it by name.

/** A hex colour with an alpha suffix, for the tints. */
const tint = (color, hex) => `${color}${hex}`

/**
 * "No colour", as a value a colour field can hold.
 *
 * The same word `widgetStyle` already uses for a card with no
 * background, because it is the same idea and two spellings of it is
 * how one of them stops working.
 *
 * A KPI without a colour is a real thing to want: a page of eight cards
 * each with its own tinted wash and coloured dial is a page with no
 * emphasis left to give, and the answer is to take the colour off seven
 * of them. `<input type="color">` cannot express it -- it has no
 * empty state at all -- so it needs a switch of its own beside the
 * swatch.
 */
export const NO_COLOUR = 'transparent'

export const isColourless = (color) => String(color || '') === NO_COLOUR

/**
 * The colour a card actually draws its marks in.
 *
 * Slate, when there is none. Not nothing: a ring, a needle and a bar
 * still have to be visible, and "no colour" means "not a statement",
 * not "invisible". The wash is what actually disappears -- see
 * `kpiSurface`.
 */
export function drawColour(color, fallback = '#4F46E5') {
  if (isColourless(color)) return '#64748b'
  return color || fallback
}

/**
 * Is this colour dark enough to need light text on it?
 *
 * The usual luminance sum, and the usual threshold. It is here rather
 * than hard-coded per theme because the accent is the ADMIN's -- a solid
 * card in pale yellow and one in navy cannot both take white text, and
 * the theme has no way of knowing which it was given.
 */
export function inkOn(color) {
  const hex = String(color || '').replace('#', '')
  if (hex.length !== 6) return '#ffffff'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  // Rec. 601 luma, against the midpoint of the range. Green carries most
  // of the perceived brightness, which is why a mid green takes dark ink
  // where a mid blue of the same "strength" does not.
  //
  // 128 rather than something higher, which is the mistake worth naming:
  // at 150 a Tailwind green-500 (luma 136) took white text, and white on
  // that green is about 2.3:1 -- under every readability floor there is.
  // Dark on it is 7.4:1.
  return (r * 299 + g * 587 + b * 114) / 1000 > 128 ? '#0f172a' : '#ffffff'
}

export const KPI_THEMES = [
  {
    value: 'plain',
    label: 'Plain',
    hint: 'A white card. The colour reaches the eye through the figure itself.',
  },
  {
    value: 'tinted',
    label: 'Tinted',
    hint: 'A wash of the colour behind the number. Softer than plain, still readable in a long row.',
  },
  {
    value: 'outline',
    label: 'Outline',
    hint: 'No fill, a firm border in the colour. The quietest of them; good for a dense grid.',
  },
  {
    value: 'solid',
    label: 'Solid',
    hint: 'The whole card in the colour, the number reversed out of it. For the one figure that matters.',
  },
  {
    value: 'gradient',
    label: 'Gradient',
    hint: 'The colour, deepening across the card. Solid with more presence.',
  },
  {
    value: 'dark',
    label: 'Dark',
    hint: 'A near-black tile with the colour as the accent. For a wall display, or a row of them.',
  },
]

export const THEME_VALUES = KPI_THEMES.map((t) => t.value)

export function themeOf(widget) {
  const value = String(widget?.kpiTheme || 'plain')
  return THEME_VALUES.includes(value) ? value : 'plain'
}

/**
 * One theme, as everything the card needs to draw itself.
 *
 * Returned as one object rather than as six exported helpers because
 * every field of it has to agree with the others: ink that does not match
 * the surface is the only way a theme can actually be wrong, and keeping
 * the pair in one place is what stops them drifting.
 *
 *   `vars`   the custom properties `.card` already reads
 *   `className` the existing switches for a card that owns its background
 *   `ink` / `muted` what text on this surface must be
 *   `track`  the unfilled part of a ring or bar on this surface
 *   `onFill` true when the surface IS the accent, so a mark drawn in the
 *            accent would be invisible and has to use the ink instead
 */
export function kpiSurface(theme, color = '#4F46E5') {
  const accent = color || '#4F46E5'

  // No colour is answered before the themes, not inside each of them.
  //
  // Six themes each carrying an "unless there is no colour" branch is
  // six chances to leave one out -- and the answer is the same for all
  // of them anyway: the card keeps its shape and loses the colour.
  // Solid and gradient are the exception worth naming, because a solid
  // card of no colour is not a card; those fall back to a plain
  // surface, which is the honest reading of "solid, in nothing".
  if (isColourless(accent)) {
    const dark = theme === 'dark'
    return {
      vars: dark
        ? { '--card-bg': '#0f172a', '--card-border-color': 'rgba(148,163,184,0.22)', '--card-text': '#f8fafc' }
        : theme === 'outline'
          ? { '--card-bg': '#ffffff', '--card-border-color': '#cbd5e1', '--card-border-width': '2px', '--card-shadow': 'none' }
          : {},
      className: dark ? 'card-ownbg card-invert' : theme === 'outline' ? 'card-ownbg' : '',
      ink: dark ? '#f8fafc' : '',
      muted: dark ? 'rgba(226,232,240,0.62)' : '',
      track: dark ? 'rgba(148,163,184,0.25)' : '#e2e8f0',
      onFill: false,
      colourless: true,
    }
  }

  switch (theme) {
    case 'tinted':
      return {
        vars: { '--card-bg': tint(accent, '14'), '--card-border-color': tint(accent, '33') },
        className: '',
        ink: '#0f172a',
        muted: '#64748b',
        track: tint(accent, '24'),
        onFill: false,
      }

    case 'outline':
      return {
        vars: {
          '--card-bg': '#ffffff',
          '--card-border-color': tint(accent, '66'),
          '--card-border-width': '2px',
          // A card defined by its border does not also need a shadow;
          // the two together read as a button.
          '--card-shadow': 'none',
        },
        className: 'card-ownbg',
        ink: '#0f172a',
        muted: '#64748b',
        track: '#e2e8f0',
        onFill: false,
      }

    case 'solid': {
      const ink = inkOn(accent)
      return {
        vars: { '--card-bg': accent, '--card-border-color': accent, '--card-text': ink },
        className: 'card-ownbg',
        ink,
        // Not a grey: a muted grey on a coloured ground is dirt. The ink
        // at reduced strength stays in the same family as the surface.
        muted: ink === '#ffffff' ? 'rgba(255,255,255,0.78)' : 'rgba(15,23,42,0.62)',
        track: ink === '#ffffff' ? 'rgba(255,255,255,0.28)' : 'rgba(15,23,42,0.18)',
        onFill: true,
      }
    }

    case 'gradient': {
      const ink = inkOn(accent)
      return {
        vars: {
          '--card-bg': `linear-gradient(135deg, ${accent} 0%, ${shade(accent, -28)} 100%)`,
          '--card-border-color': 'transparent',
          '--card-text': ink,
        },
        className: 'card-ownbg',
        ink,
        muted: ink === '#ffffff' ? 'rgba(255,255,255,0.78)' : 'rgba(15,23,42,0.62)',
        track: ink === '#ffffff' ? 'rgba(255,255,255,0.28)' : 'rgba(15,23,42,0.18)',
        onFill: true,
      }
    }

    case 'dark':
      return {
        vars: {
          '--card-bg': '#0f172a',
          '--card-border-color': 'rgba(148,163,184,0.22)',
          '--card-text': '#f8fafc',
        },
        className: 'card-ownbg card-invert',
        ink: '#f8fafc',
        muted: 'rgba(226,232,240,0.62)',
        track: 'rgba(148,163,184,0.25)',
        onFill: false,
      }

    default:
      // Plain: exactly what every existing card is, expressed as nothing.
      // A theme that sets no variables cannot change a dashboard nobody
      // asked to change.
      return {
        vars: {},
        className: '',
        ink: '',
        muted: '',
        track: '#f1f5f9',
        onFill: false,
      }
  }
}

/**
 * The same hue, darker or lighter, for the gradient's far end.
 *
 * Moved in RGB rather than converted to HSL: it is one stop on one
 * gradient, and the perceptual accuracy an HSL round trip buys is not
 * worth the fifteen lines it costs.
 */
export function shade(color, amount = -20) {
  const hex = String(color || '').replace('#', '')
  if (hex.length !== 6) return color
  const move = (channel) => {
    const v = Math.max(0, Math.min(255, parseInt(channel, 16) + amount))
    return v.toString(16).padStart(2, '0')
  }
  return `#${move(hex.slice(0, 2))}${move(hex.slice(2, 4))}${move(hex.slice(4, 6))}`
}

/** The mark on a themed card: the accent, unless the card IS the accent. */
export const markColor = (surface, color) => (surface?.onFill ? surface.ink : color)

/**
 * The little up-or-down chip, coloured for the surface it sits on.
 *
 * Green and red on a white card, because that is what green and red mean
 * and nobody has to be told. On a card that is already a solid colour
 * they are dropped: a green chip on an orange card is a clash, and worse,
 * it reads as a second measurement rather than as this one's direction.
 * There the chip borrows the card's own ink and lets the arrow say it.
 */
export function deltaChip(delta, surface) {
  if (!delta) return undefined
  if (surface?.onFill || surface?.ink === '#f8fafc') {
    return {
      backgroundColor: surface.ink === '#0f172a' ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.18)',
      color: surface.ink,
    }
  }
  if (delta.dir === 'up') return { backgroundColor: '#dcfce7', color: '#15803d' }
  if (delta.dir === 'down') return { backgroundColor: '#ffe4e6', color: '#be123c' }
  return { backgroundColor: '#f1f5f9', color: '#64748b' }
}
