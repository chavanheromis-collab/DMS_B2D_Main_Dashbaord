import { useMemo } from 'react'
import { celebrationPieces } from '../lib/celebrate'

/**
 * The whole screen celebrating, for as long as the entrance is up.
 *
 * A layer rather than a decoration on a card: an achievement is the reason
 * the entrance is worth stopping for, and paper confined to a 190px box
 * beside the wordmark is a puff nobody notices.
 *
 * Every piece is two elements, and that is not one too many. The outer one
 * travels -- the arc of a cannon shot, or a drift down the screen -- and the
 * inner one tumbles. Both on one element means two `transform` animations on
 * the same property, and the second silently wins: the paper would spin on
 * the spot or fly without turning, depending on which was declared last.
 *
 * Nothing here decides what a celebration IS. The angles, the stagger and
 * the colours are in lib/celebrate.js, where they can be tested.
 */
export default function Celebration({ seed, durationMs }) {
  const pieces = useMemo(() => celebrationPieces({ seed, durationMs }), [seed, durationMs])

  return (
    <div className="celebrate" aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.id}
          className={`celebrate-piece celebrate-${p.mode}`}
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            '--dx': `${p.dx}vw`,
            '--dy': `${p.dy}vh`,
            '--drop': `${p.drop ?? 0}vh`,
            '--sway': `${p.sway ?? 0}vw`,
            '--spin': `${p.spin}deg`,
            '--fly': `${p.duration}ms`,
            '--delay': `${p.delay}ms`,
            '--size': `${p.size}px`,
            '--colour': p.colour,
          }}
        >
          <i className={p.shape === 'circle' ? 'confetti-circle' : p.shape === 'ribbon' ? 'confetti-ribbon' : ''} />
        </span>
      ))}
    </div>
  )
}
