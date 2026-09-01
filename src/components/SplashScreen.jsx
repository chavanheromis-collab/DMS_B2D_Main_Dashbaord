import { useCallback, useEffect, useRef, useState } from 'react'
import { entranceDuration, liveEntranceItems, resolveBrand } from '../lib/branding'
import { backdropClass, backdropOf, themeOf, themeVars } from '../lib/entranceThemes'
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

  const items = liveEntranceItems(entrance)
  const brand = resolveBrand(entrance, BRAND_NAME, BRAND_TAGLINE)
  const duration = entranceDuration(entrance, items.length)
  const theme = themeOf(entrance)
  const backdrop = backdropOf(entrance)

  // Asked for at 520px: the logo can render up to 260px wide, and the
  // entrance is the last place a soft image is acceptable.
  //
  // Through the shared fallback, which is the fix for a logo that "does not
  // load": this used to take the single best Drive URL and HIDE the image
  // when it failed, so a file whose CDN copy had not been generated yet
  // simply never appeared. Now it walks every endpoint Drive offers.
  const logo = useImageFallback(entrance?.logoUrl, 260)

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
  }, [onDone, duration])

  const letters = brand.name.split('')
  // Announcements arrive from Firestore a moment after the splash opens, so
  // they're staggered in AFTER the wordmark has finished rather than being
  // part of the same run -- otherwise a slow read would drop them into a
  // half-finished animation.
  const itemsDelay = 500 + letters.length * 45

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden ${
        leaving ? 'splash-out' : ''
      }`}
      style={{ ...themeVars(theme), background: 'var(--splash-bg)' }}
      role="presentation"
    >
      {/* Slow drifting colour fields, well below the text in contrast so the
          wordmark stays the thing your eye lands on. */}
      <div className="splash-orb splash-orb-a" />
      <div className="splash-orb splash-orb-b" />
      <div className="splash-grid" />

      <div className="relative flex flex-col items-center px-6 text-center">
        {/* An admin-supplied logo replaces the generic mark entirely -- the
            entrance is the one place a business's own identity belongs. It
            gets a soft glow behind it so a dark logo doesn't disappear into
            the near-black backdrop. */}
        {logo.url && !logo.exhausted ? (
          <div className={`splash-mark mb-6 flex items-center justify-center ${backdropClass(backdrop)}`}>
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
              className="max-h-24 w-auto max-w-[260px] object-contain"
            />
          </div>
        ) : (
          <div className="splash-mark mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-sky-400 to-teal-300 shadow-[0_0_60px_rgba(99,102,241,0.55)]">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
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
            {items.map((item, i) => (
              <div
                key={item.id}
                className="splash-item flex min-w-[190px] max-w-xs items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left backdrop-blur"
                style={{
                  animationDelay: `${itemsDelay + i * 140}ms`,
                  borderColor: `${item.color}55`,
                  background: `${item.color}1A`,
                }}
              >
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
            ))}
          </div>
        )}
      </div>

      <p
        className="splash-hint absolute bottom-8 text-[11px] tracking-wide"
        style={{ color: 'var(--splash-hint)' }}
      >
        click anywhere to continue
      </p>
    </div>
  )
}
