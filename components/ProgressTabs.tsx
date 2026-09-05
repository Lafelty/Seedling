import Link from 'next/link'

export default function ProgressTabs({ view }: { view: 'journal' | 'trends' }) {
  return (
    <nav className="progress-tabs" aria-label="Progress views">
      <Link href="/progress" aria-current={view === 'journal' ? 'page' : undefined}>Journal</Link>
      <Link href="/dashboard" aria-current={view === 'trends' ? 'page' : undefined}>Trends</Link>
    </nav>
  )
}
