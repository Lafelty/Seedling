import type { ReactNode } from 'react'
import Image from 'next/image'
import Brand from '@/components/Brand'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="auth-layout">
    <section className="auth-story" aria-label="Welcome to NeuGrow">
      <div className="auth-brand"><Brand /></div>
      <div className="auth-story-copy"><p className="auth-story-label">Your movement. Your growth.</p><h2>Small steps.<br />Room to grow.</h2><p>Make time for your daily practice.<br />Watch your garden grow with you.</p></div>
      <Image className="auth-art" src="/images/botanical-welcome.webp" alt="A young ginkgo tree growing from a mound of moss" fill sizes="(min-width: 900px) 50vw, 100vw" priority />
    </section>
    <section className="auth-form-side"><div className="auth-mobile-brand"><Brand /></div><div className="auth-form-card">{children}</div><p className="auth-footer">Grow at your own pace.</p></section>
  </main>
}
