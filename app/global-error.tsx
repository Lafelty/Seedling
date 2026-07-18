'use client'

// Last-resort boundary for errors thrown in the root layout itself. It replaces
// the whole document, so it must render its own <html>/<body>. Kept dependency-
// free and inline-styled — the global stylesheet may not have loaded.

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Fatal error:', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#FAF9F7',
          fontFamily: 'Inter, system-ui, sans-serif',
          color: '#2D2D2D',
        }}
      >
        <div style={{ maxWidth: '420px', textAlign: 'center', padding: '24px' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🍂</div>
          <h1 style={{ color: '#4A6B5A', fontSize: '1.5rem', marginBottom: '8px' }}>
            Something went wrong
          </h1>
          <p style={{ color: '#6B6B6B', fontSize: '0.875rem', marginBottom: '24px' }}>
            The app hit an unexpected error. Please try again.
          </p>
          <button
            onClick={reset}
            style={{
              padding: '14px 24px',
              background: '#4A6B5A',
              color: 'white',
              border: 'none',
              borderRadius: '9999px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
