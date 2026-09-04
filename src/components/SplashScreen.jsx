import { useCallback, useEffect, useRef, useState } from 'react'
import { entranceDuration, liveEntranceItems, logoBox, resolveBrand } from '../lib/branding'
import { backdropClass, backdropOf, themeOf, themeVars } from '../lib/entranceThemes'
import { ENTRANCE_WAIT_MS, entranceIsSettled } from '../lib/entranceMemory'
import { celebrates, celebrationFor } from '../lib/celebrate'
import Celebration from './Celebration.jsx'
import { useImageFallback } from '../hooks/useImageFallback'

export const BRAND_NAME = import.meta.env?.VITE_BRAND_NAME || 'Chavan Udyog Samuh'
export const BRAND_TAGLINE = import.meta.env?.VITE_BRAND_TAGLINE || 'Business Intelligence Dashboard'

const DURATION = 2600

/**
 * Has the entrance already played and been dismissed during THIS page load?
 *
 * Module state, which is exactly the lifetime we want: it resets on every
 * refresh or fresh navigation to the app (so the entrance plays again, as
 * intended), but survives in-app route changes (so bouncing to the admin
 * panel and back doesn't replay it).
 *
 * Deliberately set on DISMISSAL rather than on mount. React StrictMode
 * mounts, unmounts and remounts every component in development; a flag set
 * at mount time would already be true by the remount and the entrance would
 * never appear while developing. Dismissal only happens after the animation
 * has actually run, which is long after StrictMode's double-mount.
 */
let dismissedThisLoad = false

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * The branded entrance. Plays on every page load — refresh it and you see it
 * again — but not when moving between pages inside the app, where it would
 * be an obstacle rather than a flourish.
 *
 * Escapable three ways (click, any key, and a timer) because the one thing
 * worse than no intro is one a user can't get past.
 */
export function useSplash() {
  const [show, setShow] = useState(() => {
    // Reduced motion skips it entirely: this animation is large, moving and
    // purely decorative, so the honest response to "I don't want motion" is
    // not to play it at all rather than to play it faster.
    if (prefersReducedMotion()) return false
    return !dismissedThisLoad
  })

  const dismiss = useCallback(() => {
    dismissedThisLoad = true
    setShow(false)
  }, [])

  return { show, dismiss }
}

export default function SplashScreen({ onDone, entrance }) {
  const [leaving, setLeaving] = useState(false)
  const doneRef = useRef(false)

  // Whether the entrance is known well enough to draw.
  //
  // It used to be drawn immediately, on whatever `entrance` happened to be
  // -- which before the read landed was nothing, so a workspace set to Sand
  // opened on Midnight and then changed in front of the reader. Not slow:
  // wrong, briefly, which is worse than late.
  //
  // A browser that has opened this dashboard before knows the answer on the
  // first frame (see lib/entranceMemory.js), so this wait is a first visit
  // only -- and it is capped, because a read that never lands must not leave
  // somebody looking at nothing.
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    if (entranceIsSettled(entrance)) return undefined
    const timer = window.setTimeout(() => setWaited(true), ENTRANCE_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [entrance])

  // Shown when the REAL read has landed -- not merely when the browser
  // remembers what it looked like. The memory says what to paint; only the
  // read says whether the announcements are in. Painting on the memory
  // alone is why the entrance arrived in three stages: logo, then wordmark,
  // then the cards shoving both of them up the screen as the column
  // re-centred around them.
  const ready = entranceIsSettled(entrance) || waited

  const items = liveEntranceItems(entrance)
  const brand = resolveBrand(entrance, BRAND_NAME, BRAND_TAGLINE)
  const duration = entranceDuration(entrance, items.length)
  const theme = themeOf(entrance)
  const backdrop = backdropOf(entrance)
  // Somebody has hit a number, so the whole screen says so -- for as long
  // as the entrance is up, which is what `duration` is.
  const celebration = celebrationFor(items)

  // Asked for at 520px: the logo can render up to 260px wide, and the
  // entrance is the last place a soft image is acceptable.
  //
  // Through the shared fallback, which is the fix for a logo that "does not
  // load": this used to take the single best Drive URL and HIDE the image
  // when it failed, so a file whose CDN copy had not been generated yet
  // simply never appeared. Now it walks every endpoint Drive offers.
  // Asked for at twice the size it is drawn at: the entrance is the one
  // place in this app where a soft logo is not acceptable, and every screen
  // worth impressing is a retina one.
  const box = logoBox(entrance)
  const logo = useImageFallback(entrance?.logoUrl, box.request)

  // One guarded exit path for all three triggers, so a click landing at the
  // same moment as the timer can't fire the transition twice.
  useEffect(() => {
    let fadeTimer

    function finish() {
      if (doneRef.current) return
      doneRef.current = true
      setLeaving(true)
      fadeTimer = window.setTimeout(onDone, 520) // let the fade-out play
    }

    // The clock starts when the entrance is on screen, not when the
    // component mounts: a splash that spent half its life invisible would
    // be gone before it was read.
    if (!ready) return undefined

    const timer = window.setTimeout(finish, duration)
    window.addEventListener('keydown', finish)
    window.addEventListener('pointerdown', finish)
    return () => {
      // Both timers must be cleared: StrictMode unmounts and remounts this
      // component immediately in development, and a surviving fade timer
      // would dismiss the freshly remounted splash mid-animation.
      window.clearTimeout(timer)
      window.clearTimeout(fadeTimer)
      window.removeEventListener('keydown', finish)
      window.removeEventListener('pointerdown', finish)
    }
  }, [onDone, duration, ready])

  const letters = brand.name.split('')
  // Announcements arrive from Firestore a moment after the splash opens, so
  // they're staggered in AFTER the wordmark has finished rather than being
  // part of the same run -- otherwise a slow read would drop them into a
  // half-finished animation.
  const itemsDelay = 500 + letters.length * 45

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col overflow-hidden ${leaving ? 'splash-out' : ''}`}
      style={{
        ...themeVars(theme),
        background: 'var(--splash-bg)',
        // Held back rather than painted in the wrong colours. Fading in
        // rather than appearing, so a first visit reads as the entrance
        // arriving and not as a flicker.
        opacity: ready ? 1 : 0,
        transition: 'opacity 220ms ease',
      }}
      aria-hidden={!ready}
      role="presentation"
    >
      {/* Slow drifting colour fields, well below the text in contrast so the
          wordmark stays the thing your eye lands on. */}
      <div className="splash-orb splash-orb-a" />
      <div className="splash-orb splash-orb-b" />
      <div className="splash-grid" />

      {/* Held until the entrance is actually on screen: paper thrown behind
          a hidden splash is paper nobody sees. */}
      {celebration && ready && <Celebration seed={celebration.seed} durationMs={duration} />}

      {/* The content COLUMN, which takes what is left after the hint has
          had its line -- rather than being centred in the whole screen with
          the hint floating over it. With a tall logo, a long name and three
          announcements, those two used to collide: the hint sat at
          `bottom-8` and the cards grew down into it, and on a laptop the
          last row was already touching. Given the room instead, they cannot
          overlap at any size -- and if the entrance genuinely will not fit,
          it scrolls rather than hiding what did not. */}
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-6 text-center">
        {/* An admin-supplied logo replaces the generic mark entirely -- the
            entrance is the one place a business's own identity belongs. It
            gets a soft glow behind it so a dark logo doesn't disappear into
            the near-black backdrop. */}
        {logo.url && !logo.exhausted ? (
          // The gap is a setting and can be negative: a logo file is very
          // often mostly transparent, and the browser cannot see that. See
          // lib/branding.js.
          <div
            className={`splash-mark flex items-center justify-center ${backdropClass(backdrop)}`}
            style={{ marginBottom: box.gap }}
          >
            <img
              key={logo.url}
              src={logo.url}
              alt=""
              // Google refuses image requests carrying a referrer from an
              // origin it does not know, which is every deployment of this
              // dashboard -- without this a perfectly public file 403s, and
              // that was the other half of "the logo does not load".
              referrerPolicy="no-referrer"
              decoding="async"
              onError={logo.onError}
              className="w-auto object-contain"
              style={{ maxHeight: box.height, maxWidth: box.maxWidth }}
            />
          </div>
        ) : (
          // The built-in mark follows the same setting, or an admin who
          // sized the entrance for their own logo would find the stock one
          // ignoring them the day the URL broke.
          <div
            className="splash-mark flex items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-sky-400 to-teal-300 shadow-[0_0_60px_rgba(99,102,241,0.55)]"
            style={{
              height: Math.round(box.height * 0.67),
              width: Math.round(box.height * 0.67),
              marginBottom: box.gap,
            }}
          >
            <svg viewBox="0 0 24 24" className="h-1/2 w-1/2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
              <path d="M4 19V10" />
              <path d="M10 19V5" />
              <path d="M16 19v-6" />
              <path d="M22 19H2" strokeWidth="1.6" opacity="0.6" />
            </svg>
          </div>
        )}

        {/* Per-letter reveal. Spaces keep their width via a non-breaking
            space, or the wordmark collapses into one run of letters. */}
        <h1
          className="splash-title text-3xl font-bold tracking-tight sm:text-5xl"
          style={{ color: 'var(--splash-title)' }}
        >
          {letters.map((ch, i) => (
            <span
              key={`${ch}-${i}`}
              className="splash-letter"
              style={{ animationDelay: `${180 + i * 45}ms` }}
            >
              {ch === ' ' ? ' ' : ch}
            </span>
          ))}
        </h1>

        <p
          className="splash-tagline mt-3 text-xs uppercase tracking-[0.32em] sm:text-sm"
          style={{ animationDelay: `${260 + letters.length * 45}ms`, color: 'var(--splash-tagline)' }}
        >
          {brand.tagline}
        </p>

        <div
          className="splash-rule mt-7 h-px w-40"
          style={{
            background:
              'linear-gradient(to right, transparent, var(--splash-rule), transparent)',
          }}
        />

        {/* --- Campaigns, achievements and notices ---------------------- */}
        {items.length > 0 && (
          <div className="mt-7 flex max-w-2xl flex-wrap items-stretch justify-center gap-2.5">
            {items.map((item, i) => {
              // An achievement is somebody hitting a number, and the reason
              // it is on the way in is that everyone should see it. A notice
              // about the car park is not that, and gets no paper.
              const won = celebrates(item)
              return (
              <div
                key={item.id}
                className={`splash-item relative flex min-w-[190px] max-w-xs items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left backdrop-blur ${
                  won ? 'splash-item-win' : ''
                }`}
                style={{
                  animationDelay: `${itemsDelay + i * 140}ms`,
                  borderColor: `${item.color}55`,
                  background: `${item.color}1A`,
                  ...(won ? { '--pop-delay': `${itemsDelay + i * 140}ms` } : null),
                }}
              >
                {/* Fired once the card has arrived, or the paper comes out
                    of a card that is not there yet. */}
                <span className="text-xl leading-none">{item.icon}</span>
                <div className="min-w-0">
                  <p
                    className="text-sm font-semibold leading-snug"
                    style={{ color: 'var(--splash-item-text)' }}
                  >
                    {item.title}
                  </p>
                  {item.subtitle && (
                    <p
                      className="mt-0.5 text-[11px] leading-snug"
                      style={{ color: 'var(--splash-item-sub)' }}
                    >
                      {item.subtitle}
                    </p>
                  )}
                </div>
              </div>
              )
            })}
          </div>
        )}
      </div>

      <p
        className="splash-hint relative shrink-0 pb-7 text-center text-[11px] tracking-wide"
        style={{ color: 'var(--splash-hint)' }}
      >
        click anywhere to continue
      </p>
    </div>
  )
}
