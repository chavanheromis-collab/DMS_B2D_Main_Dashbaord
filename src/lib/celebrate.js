// ---------------------------------------------------------------------
// The entrance, when somebody has hit a number
// ---------------------------------------------------------------------
// An achievement on the way in was a card the same shape as a notice about
// the car park. It is not the same thing, and the reason for putting it on
// the entrance at all is that everyone should see it -- so the whole screen
// celebrates, for as long as the entrance is up.
//
// A birthday, not a firework display. Two things happen, and they are
// different on purpose:
//
//   THE POP. Cannons at the bottom corners fire inward and upward the
//   moment the entrance opens, throwing paper across the middle of the
//   screen. It is one loud instant, and it is what makes the entrance feel
//   like an event rather than a page.
//
//   THE FALL. Paper drifting down from above the top edge, staggered right
//   across the entrance's own duration, so it is still coming down when the
//   entrance ends rather than finishing in the first second and leaving
//   somebody watching a still picture for two more.
//
// ACHIEVEMENTS ONLY, and that restraint is the feature. Confetti on every
// announcement is confetti on nothing: within a week it reads as wallpaper,
// and the one card that matters no longer stands out from the three that do
// not.
//
// The pieces are computed here and drawn elsewhere, for the usual reason: a
// burst is arithmetic -- an angle, a distance, a delay -- and arithmetic in
// a render is arithmetic nobody can test. It is also DETERMINISTIC, because
// React re-renders the splash several times while it plays and a burst
// dealt from `Math.random()` would deal a new hand each time, teleporting
// every piece of paper mid-flight.

/** Party colours: bright, warm, and none of them the app's own indigo. */
export const CELEBRATION_COLOURS = [
  '#F59E0B',
  '#EF4444',
  '#EC4899',
  '#8B5CF6',
  '#0EA5E9',
  '#10B981',
  '#FACC15',
  '#FB7185',
]

export const CONFETTI_SHAPES = ['rect', 'circle', 'ribbon']

/** How much paper. Enough to fill a screen, few enough to draw at 60fps. */
export const CELEBRATION_COUNT = 110

/** Of that, how much is thrown by the cannons rather than falling. */
const SHOT_SHARE = 0.42

/**
 * A small, fast, seeded generator.
 *
 * Deterministic on purpose -- see the note at the top about re-renders.
 */
function seeded(seed) {
  const text = String(seed)
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h += 0x6d2b79f5
    let t = h
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const paper = (rand) => ({
  size: Math.round(7 + rand() * 9),
  colour: CELEBRATION_COLOURS[Math.floor(rand() * CELEBRATION_COLOURS.length)],
  shape: CONFETTI_SHAPES[Math.floor(rand() * CONFETTI_SHAPES.length)],
  spin: Math.round(-900 + rand() * 1800),
})

/**
 * The whole celebration: every piece, where it starts, where it goes, and
 * when.
 *
 * Positions are percentages of the SCREEN, so one calculation serves a phone
 * and a wall display. `durationMs` is the entrance's own length -- the fall
 * is spread across it, which is what makes the celebration last exactly as
 * long as the thing it is celebrating instead of guessing.
 */
export function celebrationPieces({ seed = 'win', durationMs = 3000, count = CELEBRATION_COUNT } = {}) {
  const rand = seeded(seed)
  const total = Math.max(0, Math.min(240, Math.round(count)))
  const shots = Math.round(total * SHOT_SHARE)
  const span = Math.max(600, Math.min(12000, Math.round(durationMs)))
  const pieces = []

  // --- the pop --------------------------------------------------------
  // Two cannons at the bottom corners, firing inward and up. Fanned rather
  // than random: each piece gets its own slice of the arc and jitters
  // inside it, because pure randomness clumps and a clump reads as a
  // mistake rather than as a burst.
  for (let i = 0; i < shots; i += 1) {
    const left = i % 2 === 0
    const slice = (Math.floor(i / 2) + rand()) / Math.max(1, shots / 2)
    // 20deg to 78deg above the horizon, aimed across the screen.
    const angle = (20 + slice * 58) * (Math.PI / 180)
    const power = 62 + rand() * 58

    pieces.push({
      id: `s${i}`,
      mode: 'shot',
      // Just off the corner, so the cannon itself is not on screen.
      x: left ? -4 : 104,
      y: 104,
      dx: Math.round(Math.cos(angle) * power * (left ? 1 : -1)),
      // Negative is up the screen.
      dy: -Math.round(Math.sin(angle) * power),
      // How far past the apex it falls before it is gone.
      drop: Math.round(70 + rand() * 60),
      // A second volley, so it reads as a celebration rather than as one
      // event. Never later than a third of the way in -- paper thrown at
      // the end has no time to land.
      delay: Math.round((i % 4 === 3 ? span * 0.22 : 0) + rand() * 260),
      duration: Math.round(1500 + rand() * 900),
      ...paper(rand),
    })
  }

  // --- the fall -------------------------------------------------------
  // Spread across the whole entrance, so paper is still coming down as it
  // ends. The last piece starts at 80% of the way through: any later and it
  // is on screen for an instant before the fade takes it.
  for (let i = shots; i < total; i += 1) {
    const fall = Math.round(2600 + rand() * 2400)
    pieces.push({
      id: `f${i}`,
      mode: 'fall',
      x: Math.round(rand() * 100),
      y: -12,
      // Drift, not a straight drop. Paper does not fall in a line.
      dx: Math.round(-14 + rand() * 28),
      dy: 130,
      sway: Math.round(3 + rand() * 9),
      delay: Math.round(((i - shots) / Math.max(1, total - shots)) * span * 0.8 + rand() * 200),
      duration: fall,
      ...paper(rand),
    })
  }

  return pieces
}

/** Does this announcement deserve the screen? */
export function celebrates(item) {
  return item?.kind === 'achievement'
}

/**
 * Whether these announcements call for a celebration, and what to seed it
 * with.
 *
 * Seeded on the achievements' own ids: the same board celebrates the same
 * way every time it is opened, and a different one looks different.
 */
export function celebrationFor(items) {
  const won = (items || []).filter(celebrates)
  if (won.length === 0) return null
  return { seed: won.map((item) => item.id || item.title || 'win').join('|'), count: won.length }
}

/** When the last piece finishes, so nothing is drawn after it. */
export function celebrationDuration(pieces) {
  return (pieces || []).reduce((longest, p) => Math.max(longest, p.delay + p.duration), 0)
}
