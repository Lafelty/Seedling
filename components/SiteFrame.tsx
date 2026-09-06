'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, ChartLineUp, FlowerLotus, SquaresFour, UserCircle, Users, GearSix, Plus, List, X, ArrowLeft } from '@phosphor-icons/react'
import Brand from '@/components/Brand'

const patientLinks = [
  { href: '/', label: 'Garden', icon: FlowerLotus },
  { href: '/levels', label: 'Exercises', icon: SquaresFour },
  { href: '/progress', label: 'Progress', icon: ChartLineUp },
  { href: '/profile', label: 'Profile', icon: UserCircle },
]
const adminLinks = [
  { href: '/admin', label: 'Exercises', icon: SquaresFour },
  { href: '/admin/groups', label: 'Manage Boxes', icon: FlowerLotus },
  { href: '/admin/patients', label: 'Patients', icon: Users },
  { href: '/starconfig', label: 'Star settings', icon: GearSix },
]

/** Navigation only. Each protected page continues to enforce its own access. */
export default function SiteFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      menuButton.current?.focus()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])
  const admin = pathname.startsWith('/admin') || pathname === '/starconfig'
  const patient = pathname === '/' || pathname.startsWith('/levels') || ['/progress', '/dashboard', '/profile'].includes(pathname)
  if (!admin && !patient) return <>{children}</>
  const links = admin ? adminLinks : patientLinks
  const active = admin
    ? pathname.startsWith('/admin/users') ? '/admin/patients' : pathname.startsWith('/admin/exercises') ? '/admin' : pathname
    : pathname === '/dashboard' ? '/progress' : pathname.startsWith('/levels') ? '/levels' : pathname
  const section = links.find(link => link.href === active)?.label ?? 'Workspace'

  return <div className={`site-frame ${admin ? 'site-frame-admin' : 'site-frame-patient'}`}>
    <header className="mobile-brand-bar">
      <Link href={admin ? '/admin' : '/'} aria-label="NeuGrow home"><Brand /></Link>
      <span className="workspace-label">{admin ? 'Care workspace' : 'Your daily practice'}</span>
      {admin && <button ref={menuButton} className="icon-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="site-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={22} /> : <List size={22} />}</button>}
    </header>
    <aside className="site-sidebar" data-open={menuOpen}>
      <Link className="sidebar-brand" href={admin ? '/admin' : '/'} aria-label="NeuGrow home"><Brand /></Link>
      <div className="sidebar-workspace"><span className="workspace-dot" />{admin ? 'Care workspace' : 'Personal garden'}</div>
      <nav id="site-navigation" aria-label={admin ? 'Admin navigation' : 'Desktop navigation'}>
        {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className="sidebar-link" aria-current={active === href ? 'page' : undefined} onClick={() => setMenuOpen(false)}><Icon size={21} weight={active === href ? 'fill' : 'regular'} /><span>{label}</span>{active === href && <span className="sidebar-current" />}</Link>)}
      </nav>
      <div className="sidebar-bottom">
        {admin ? <>
          <Link href="/admin/exercises/new" className="btn btn-primary sidebar-create" onClick={() => setMenuOpen(false)}><Plus size={18} />New Exercise</Link>
          <Link href="/" className="sidebar-link"><ArrowLeft size={19} />Patient view</Link>
        </> : <div className="sidebar-note"><FlowerLotus size={26} weight="light" /><p>A little movement.<br />A little more growth.</p><span>One session at a time.</span></div>}
      </div>
    </aside>
    <div className="site-content">
      <div className="desktop-location-bar"><span>{admin ? 'Care workspace' : 'Your space'}<span className="location-divider">/</span><strong>{section}</strong></span><span className="location-note">{admin ? <Link href="/">Open patient view <ArrowUpRight size={15} /></Link> : 'Make room for a little progress.'}</span></div>
      {children}
    </div>
  </div>
}
