'use client'

/**
 * The patient's photo, round, with the garden's sprig standing in when there
 * isn't one yet — the same two-leaf mark the level map and the dashboard use,
 * so an empty profile still looks like it belongs to this app rather than like a
 * missing image.
 *
 * The photo itself arrives as an already-signed URL (see lib/avatar.ts); this
 * component never touches storage.
 */

import { useRef } from 'react'

import { SprigMark } from './Sprig'

interface ProfileAvatarProps {
  /** Signed URL, or null to draw the sprig instead. */
  url: string | null
  size?: number
  alt?: string
  /** Show the camera button and accept a file. */
  editable?: boolean
  uploading?: boolean
  onPick?: (file: File) => void
  className?: string
  style?: React.CSSProperties
}

export function ProfileAvatar({
  url,
  size = 72,
  alt = 'Profile picture',
  editable = false,
  uploading = false,
  onPick,
  className,
  style,
}: ProfileAvatarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  // The button sits on the rim, so it scales with the circle rather than
  // swallowing a small one.
  const buttonSize = Math.max(26, Math.round(size * 0.34))

  return (
    <div
      className={className}
      style={{ position: 'relative', width: size, height: size, flexShrink: 0, ...style }}
    >
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
          display: 'grid',
          placeItems: 'center',
          background: url ? 'var(--surface)' : 'radial-gradient(circle at 50% 38%, #EAF5E6, #D8EBD2)',
          border: '2px solid rgba(74, 107, 90, 0.45)',
          boxShadow: '0 1px 4px rgba(38, 48, 42, 0.14)',
          opacity: uploading ? 0.55 : 1,
          transition: 'opacity var(--dur-fast) var(--ease-out)',
        }}
      >
        {url ? (
          // Plain <img>: the URL is signed and short-lived, which next/image's
          // optimizer would cache past its expiry.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={alt}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <svg
            width={size * 0.62}
            height={size * 0.62}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            // The mark's stem stops at the leaves, so nudge it down a touch to
            // sit on the circle's centre rather than above it.
            style={{ transform: 'translateY(6%)' }}
          >
            <SprigMark />
          </svg>
        )}
      </div>

      {editable && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0]
              // Reset first: picking the same file twice in a row fires no
              // change event otherwise, so a failed upload could not be retried.
              event.target.value = ''
              if (file) onPick?.(file)
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            aria-label={url ? 'Change profile picture' : 'Add a profile picture'}
            style={{
              position: 'absolute',
              right: -2,
              bottom: -2,
              width: buttonSize,
              height: buttonSize,
              display: 'grid',
              placeItems: 'center',
              borderRadius: 'var(--radius-full)',
              background: 'var(--primary)',
              color: 'white',
              border: '2px solid var(--surface)',
              boxShadow: '0 2px 6px rgba(38, 48, 42, 0.24)',
              cursor: uploading ? 'wait' : 'pointer',
              padding: 0,
            }}
          >
            <svg
              width={buttonSize * 0.52}
              height={buttonSize * 0.52}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </button>
        </>
      )}
    </div>
  )
}
