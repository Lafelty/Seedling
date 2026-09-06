'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FlowerLotus, SquaresFour, ChartLineUp, UserCircle } from '@phosphor-icons/react'

const destinations = [
  { href: '/', label: 'Garden', icon: FlowerLotus },
  { href: '/levels', label: 'Exercises', icon: SquaresFour },
  { href: '/progress', label: 'Progress', icon: ChartLineUp },
  { href: '/profile', label: 'Profile', icon: UserCircle },
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
            <item.icon aria-hidden="true" size={23} weight={active === item.href ? 'fill' : 'regular'} />
            <span>{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}
