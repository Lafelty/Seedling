'use client'

/**
 * What "saved" looks like: the screen dims, a sprout comes up in the middle, and
 * the whole thing gets out of the way on its own.
 *
 * The old confirmation was a line of green text under the form, which on a phone
 * sits below the fold at the exact moment the patient is looking at the button
 * they just pressed. This takes the middle of the screen instead — there is
 * nowhere else to look.
 */

import { useEffect } from 'react'

import { GrowthScene } from './GrowthStage'

interface SavedOverlayProps {
  message?: string
  /** Called when the overlay has finished — on the timer, or on a tap. */
  onDone: () => void
  /** How long it stays up, in milliseconds. */
  duration?: number
}

export function SavedOverlay({ message = 'Profile saved!', onDone, duration = 1600 }: SavedOverlayProps) {
  useEffect(() => {
    const timer = setTimeout(onDone, duration)
    return () => clearTimeout(timer)
  }, [duration, onDone])

  return (
    <div
      // Announced, not focus-trapped: nothing here needs answering, and stealing
      // focus from the Save button would leave a screen reader nowhere to return
      // to once the overlay times out.
      role="status"
      aria-live="polite"
      onClick={onDone}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-modal)',
        display: 'grid',
        placeItems: 'center',
        gap: 'var(--space-4)',
        background: 'rgba(31, 36, 33, 0.42)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        padding: 'var(--space-6)',
        cursor: 'pointer',
      }}
    >
      <div
        className="animate-scaleIn"
        style={{ display: 'grid', justifyItems: 'center', gap: 'var(--space-5)' }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-3xl)',
            color: 'white',
            textAlign: 'center',
            textShadow: '0 2px 10px rgba(0, 0, 0, 0.35)',
          }}
        >
          {message}
        </p>

        {/* A squircle rather than a circle, so it reads as a badge that was
            awarded and not as another avatar. */}
        <span
          aria-hidden
          style={{
            width: 132,
            height: 132,
            display: 'block',
            borderRadius: '34%',
            overflow: 'hidden',
            background: 'var(--surface)',
            border: '3px solid rgba(255, 255, 255, 0.9)',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.28)',
          }}
        >
          <svg width="100%" height="100%" viewBox="0 0 32 32" fill="none">
            {/* Stage 1 — the sprout breaking ground, which is the moment this
                confirmation is about. */}
            <GrowthScene stage={1} />
          </svg>
        </span>
      </div>
    </div>
  )
}
