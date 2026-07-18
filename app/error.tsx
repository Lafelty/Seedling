'use client'

// Route-level error boundary. Any uncaught render/runtime error below the root
// layout lands here instead of a blank white screen — important for a health
// app used unsupervised at home. `reset()` re-renders the failed segment.

import { useEffect } from 'react'
import Link from 'next/link'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Unhandled error:', error)
  }, [error])

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        padding: 'var(--space-6)',
      }}
    >
      <div className="card text-center" style={{ maxWidth: '420px' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: 'var(--space-3)' }}>🍂</div>
        <h1 style={{ color: 'var(--primary)', fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>
          Something went wrong
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-6)' }}>
          The page hit an unexpected snag. Your progress is safe — try again, or head back to your garden.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <button onClick={reset} className="btn btn-primary">
            Try again
          </button>
          <Link
            href="/"
            style={{
              padding: 'var(--space-3) var(--space-6)',
              color: 'var(--primary)',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Back to Garden
          </Link>
        </div>
      </div>
    </div>
  )
}
