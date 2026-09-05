'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const destinations = [
  { href: '/', label: 'Garden', path: 'M8 19a4 4 0 0 1-2.24-7.32A3.5 3.5 0 0 1 9 6.03V6a3 3 0 1 1 6 0v.04a3.5 3.5 0 0 1 3.24 5.65A4 4 0 0 1 16 19ZM12 19v3' },
  { href: '/levels', label: 'Exercises', path: 'M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v6H4zM14 15h6v6h-6z' },
  { href: '/progress', label: 'Progress', path: 'M3 3v18h18M7 16l4-7 4 4 5-8' },
  { href: '/profile', label: 'Profile', path: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0' },
] as const

/** Shared across patient routes, including their loading and error states. */
export default function PatientNavigation() {
  const pathname = usePathname()
  const active = pathname === '/dashboard' ? '/progress'
    : pathname.startsWith('/levels') ? '/levels' : pathname
  if (!destinations.some(item => item.href === active)) return null

  return <PatientNav active={active} />
}

/** Sessions opt in only before camera use or after results are saved. */
export function PatientNav({ active }: { active: string }) {
  return (
    <nav className="patient-nav" aria-label="Main navigation">
      <div className="patient-nav-inner">
        {destinations.map(item => (
          <Link key={item.href} href={item.href} className="patient-nav-link" aria-current={active === item.href ? 'page' : undefined}>
            <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={item.path} /></svg>
            <span>{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}
