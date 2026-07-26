'use client'

import { useEffect, useState } from 'react'
import type { BoxTint } from '@/lib/levels-theme'

/**
 * The pose itself, as the therapist photographed it — the same demo pictures
 * the "Ready?" screen shows (exercises.demo_images), so a pose looks the same
 * everywhere it appears. Two frames alternating read as a short loop of the
 * movement, which tells a patient what they're about to do faster than the
 * name does.
 *
 * A locked pose keeps its picture but loses its colour and holds still: you can
 * see what's coming, and it plainly isn't yours yet. The lock sits on the
 * picture rather than replacing it.
 */
export default function PoseThumb({
  images,
  locked,
  tint,
  delayMs = 0,
  intervalMs = 900,
}: {
  images: string[]
  locked: boolean
  tint: BoxTint
  /** Stagger, so a list of poses doesn't flip in unison. */
  delayMs?: number
  intervalMs?: number
}) {
  const frames = images.filter((src) => typeof src === 'string' && src.length > 0)
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (locked || frames.length < 2) return
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let tick: ReturnType<typeof setInterval> | undefined
    const start = setTimeout(() => {
      tick = setInterval(() => setFrame((f) => (f + 1) % frames.length), intervalMs)
    }, delayMs)
    return () => {
      clearTimeout(start)
      if (tick) clearInterval(tick)
    }
  }, [locked, frames.length, delayMs, intervalMs])

  return (
    <span
      className="pose-thumb"
      aria-hidden
      style={{
        position: 'relative',
        display: 'block',
        flexShrink: 0,
        overflow: 'hidden',
        borderRadius: 'var(--radius-md)',
        // The empty state is not a broken frame: the box's own tint, holding a
        // leaf, so a pose with no pictures yet still reads as part of the box.
        background: locked ? 'var(--bg)' : tint.wash,
        border: `1px solid ${locked ? 'var(--border)' : tint.edge}`,
      }}
    >
      {/* No pictures and no lock: a leaf, so the frame reads as an empty slot
          in the box rather than as an image that failed to load. A locked pose
          with no pictures shows the lock alone — the two glyphs stacked on one
          64px square is a muddle. */}
      {frames.length === 0 && !locked && (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke={tint.ink}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ position: 'absolute', inset: '22%', width: '56%', height: '56%', opacity: 0.7 }}
        >
          <path d="M12 21c0-5 1-8 3-10" />
          <path d="M15 11c3-1 5-4 5-8-4 0-7 2-8 5-1 3 0 4 3 3Z" />
        </svg>
      )}

      {/* Every frame stays mounted and swaps by opacity, so the loop never
          shows a gap while the next picture decodes. */}
      {frames.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            // Frame 0 stays up while a locked pose holds still.
            opacity: frame === i ? 1 : 0,
            transition: 'opacity 320ms var(--ease-out)',
            filter: locked ? 'grayscale(1) contrast(0.92)' : 'none',
          }}
        />
      ))}

      {locked && (
        <>
          {/* Scrim over a photograph only — on the empty leaf placeholder there
              is nothing to darken and it would just make a grey block. */}
          {frames.length > 0 && (
            <span
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(28, 34, 30, 0.42)',
              }}
            />
          )}
          {/* White on the darkened photograph, grey on the pale placeholder —
              either way the lock keeps contrast against what's behind it. */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke={frames.length > 0 ? '#FFFFFF' : '#5C5C5C'}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              position: 'absolute',
              inset: '28%',
              width: '44%',
              height: '44%',
              filter: frames.length > 0 ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.45))' : 'none',
            }}
          >
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </>
      )}
    </span>
  )
}
