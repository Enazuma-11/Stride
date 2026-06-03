import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { C } from '../../lib/constants'
import { Button, Input, Alert } from '../../components/ui'
import { signIn } from '../../lib/api'

export default function LoginPage() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const navigate = useNavigate()

  async function handleLogin() {
    if (!email || !password) { setError('Please enter email and password.'); return }
    setLoading(true); setError('')
    try {
      await signIn(email, password)
      navigate('/dashboard')
    } catch (err) {
      setError(err.message || 'Login failed. Please check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: C.brand,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans', sans-serif",
      backgroundImage: 'radial-gradient(ellipse at 70% 20%, rgba(43,78,122,0.8) 0%, transparent 60%)',
    }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap');`}</style>

      <div style={{ width: '100%', maxWidth: 420, padding: '0 20px' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: C.accent, margin: '0 auto 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28, boxShadow: `0 8px 24px ${C.accent}60`,
          }}>⚡</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', fontFamily: "'Sora', sans-serif" }}>
            SporTech Innovation Lab
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
            Employee Portal
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: '#fff', borderRadius: 16, padding: '36px 32px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.25)',
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text, fontFamily: "'Sora', sans-serif", marginBottom: 24 }}>
            Sign in to your account
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
            <Input
              label="Work Email"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@sportechinnolab.org"
              required
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <div style={{ marginBottom: 16 }}><Alert type="error" message={error} /></div>}

          <Button
            onClick={handleLogin}
            disabled={loading}
            style={{ width: '100%', padding: '13px', fontSize: 14 }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </Button>

          <div style={{ fontSize: 12, color: C.textLight, textAlign: 'center', marginTop: 20 }}>
            Forgot your password? Contact HR at{' '}
            <span style={{ color: C.brand, fontWeight: 600 }}>talent@sportechinnolab.org</span>
          </div>
        </div>

        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center', marginTop: 24 }}>
          © 2026 SporTech Innovation Lab Pvt Ltd
        </div>
      </div>
    </div>
  )
}
