'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--background)',
      padding: 'var(--space-4)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        background: 'var(--surface)',
        borderRadius: 'var(--radius-xl)',
        padding: 'var(--space-8)',
        border: '1px solid var(--border)',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
      }}>
        <h1 style={{
          fontSize: 'var(--text-2xl)',
          fontWeight: 600,
          fontFamily: 'var(--font-display)',
          color: 'var(--ink)',
          marginBottom: 'var(--space-2)',
          textAlign: 'center',
        }}>
          Welcome back
        </h1>
        <p style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--muted)',
          textAlign: 'center',
          marginBottom: 'var(--space-6)',
        }}>
          You must login to use this application
        </p>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label
              htmlFor="email"
              style={{
                display: 'block',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                color: 'var(--ink)',
                marginBottom: 'var(--space-2)',
              }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: '100%',
                padding: 'var(--space-3)',
                fontSize: 'var(--text-base)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--background)',
                color: 'var(--ink)',
              }}
              placeholder="you@example.com"
            />
          </div>

          <div style={{ marginBottom: 'var(--space-6)' }}>
            <label
              htmlFor="password"
              style={{
                display: 'block',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                color: 'var(--ink)',
                marginBottom: 'var(--space-2)',
              }}
            >
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: 'var(--space-3)',
                  paddingRight: 'var(--space-12)',
                  fontSize: 'var(--text-base)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--background)',
                  color: 'var(--ink)',
                }}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: 'var(--space-3)',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--muted)',
                  padding: 'var(--space-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {showPassword ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div style={{
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-4)',
              background: '#FEE2E2',
              border: '1px solid #FCA5A5',
              borderRadius: 'var(--radius-md)',
              color: '#991B1B',
              fontSize: 'var(--text-sm)',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: 'var(--space-3)',
              fontSize: 'var(--text-base)',
              fontWeight: 600,
              color: 'white',
              background: loading ? 'var(--muted)' : 'var(--primary)',
              border: 'none',
              borderRadius: 'var(--radius-full)',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 200ms ease',
            }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p style={{
          marginTop: 'var(--space-6)',
          textAlign: 'center',
          fontSize: 'var(--text-sm)',
          color: 'var(--muted)',
        }}>
          Don't have an account?{' '}
          <Link
            href="/signup"
            style={{
              color: 'var(--primary)',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
