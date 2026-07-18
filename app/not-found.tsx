import Link from 'next/link'

// Shown for any unmatched route. Server component — no interactivity needed.

export default function NotFound() {
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
        <div style={{ fontSize: '2.5rem', marginBottom: 'var(--space-3)' }}>🌱</div>
        <h1 style={{ color: 'var(--primary)', fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>
          Nothing grows here
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-6)' }}>
          This page doesn&apos;t exist. Let&apos;s get you back to your garden.
        </p>
        <Link href="/" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          Back to Garden
        </Link>
      </div>
    </div>
  )
}
