'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function SetupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    fetch('/api/auth/methods')
      .then(r => r.ok ? r.json() as Promise<{ setupRequired: boolean }> : { setupRequired: false })
      .then(m => {
        if (!(m as { setupRequired: boolean }).setupRequired) router.replace('/login')
        else setChecking(false)
      })
      .catch(() => setChecking(false))
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) { setError('passwords do not match'); return }
    if (password.length < 8) { setError('password must be at least 8 characters'); return }
    setLoading(true)
    try {
      const resp = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: 'Setup failed' }))
        setError((body as { error?: string }).error ?? `Setup failed (${resp.status})`)
        setLoading(false)
        return
      }
      router.push('/')
    } catch {
      setError('Gateway unreachable. Is the server running?')
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#080808' }}>
        <div style={{ fontSize: '12px', color: '#555', fontFamily: 'monospace' }}>checking...</div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#080808', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>
      <div style={{ width: 360, background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 8, padding: '32px 28px' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#10b981', letterSpacing: 1 }}>Anway</div>
          <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>First-run setup</div>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Admin email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus placeholder="you@company.com"
              style={{ width: '100%', background: '#111', border: '1px solid #2a2a2a', borderRadius: 5, padding: '8px 10px', color: '#e5e5e5', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Min 8 characters"
              style={{ width: '100%', background: '#111', border: '1px solid #2a2a2a', borderRadius: 5, padding: '8px 10px', color: '#e5e5e5', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Confirm password</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required placeholder="••••••••"
              style={{ width: '100%', background: '#111', border: '1px solid #2a2a2a', borderRadius: 5, padding: '8px 10px', color: '#e5e5e5', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          {error && <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 12 }}>{error}</div>}
          <button type="submit" disabled={loading}
            style={{ width: '100%', padding: '9px 0', background: '#10b981', border: 'none', borderRadius: 5, color: '#000', fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Creating account…' : 'Create admin account'}
          </button>
        </form>
      </div>
    </div>
  )
}
