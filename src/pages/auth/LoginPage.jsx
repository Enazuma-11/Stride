import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { C, FONTS } from '../../lib/constants'
import { Alert, Spinner, GlobalFonts } from '../../components/ui'
import { TwoFactorVerify } from '../../components/TwoFactorAuth'
import { useResponsive } from '../../lib/responsive'

export default function LoginPage() {
  const navigate = useNavigate()
  const r = useResponsive()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [needs2FA, setNeeds2FA] = useState(false)

  async function handleLogin() {
    if (!email || !password) { setError('Please enter your email and password.'); return }
    setLoading(true); setError('')
    try {
      const { data, error: e } = await supabase.auth.signInWithPassword({ email, password })
      if (e) throw e
      // Check if 2FA is required
      const { data: mfaData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (mfaData?.nextLevel === 'aal2' && mfaData?.currentLevel === 'aal1') {
        setNeeds2FA(true)
        return
      }
      navigate('/dashboard')
    } catch (e) {
      setError(e.message === 'Invalid login credentials' ? 'Incorrect email or password.' : e.message)
    } finally { setLoading(false) }
  }

  const inputStyle = (dark) => ({
    width: '100%', padding: '11px 14px', borderRadius: 10,
    border: dark ? '1px solid rgba(255,255,255,0.15)' : `1.5px solid ${C.border}`,
    background: dark ? 'rgba(255,255,255,0.08)' : C.surface,
    fontSize: 13, color: dark ? '#fff' : C.text,
    fontFamily: FONTS.body, outline: 'none',
  })

  const gradBtn = {
    width: '100%', padding: '13px', borderRadius: 10, border: 'none',
    background: loading ? C.border : C.brand,
    color: loading ? C.textLight : '#fff',
    fontSize: 14, fontWeight: 700, fontFamily: FONTS.display,
    cursor: loading ? 'not-allowed' : 'pointer',
    boxShadow: loading ? 'none' : C.shadowTeal,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  }

  if (needs2FA) return <TwoFactorVerify onVerified={() => navigate('/dashboard')} onCancel={() => { setNeeds2FA(false); supabase.auth.signOut() }} />

  const dark = r.isMobile

  return (
    <>
      <GlobalFonts />
      <div style={{ minHeight: '100vh', display: 'flex', background: dark ? 'linear-gradient(160deg,#0a0e1a,#0d3a5c)' : C.bg }}>

        {/* Desktop left panel */}
        {!r.isMobile && (
          <div style={{ width: '42%', background: 'linear-gradient(160deg,#0a0e1a 0%,#1a1f3c 60%,#0d3a5c 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 52px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', width: 320, height: 320, borderRadius: '50%', top: -80, left: -80, background: 'radial-gradient(circle,rgba(155,117,241,0.3),transparent)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', width: 260, height: 260, borderRadius: '50%', bottom: -60, right: -60, background: 'radial-gradient(circle,rgba(0,212,170,0.22),transparent)', pointerEvents: 'none' }} />
            <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: 320 }}>
              <div style={{ width: 88, height: 88, borderRadius: 22, background: '#fff', margin: '0 auto 28px', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src="/logo.png" style={{ width: 82, height: 82, objectFit: 'contain' }} onError={e => e.target.style.display='none'} />
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', fontFamily: FONTS.display, marginBottom: 8, lineHeight: 1.2 }}>SporTech Innovation Lab</div>
              <div style={{ height: 3, width: 70, background: C.gradientH, borderRadius: 3, margin: '14px auto', opacity: 0.8 }} />
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6, marginBottom: 44 }}>The Voice of Every Sportsperson</div>
              <div style={{ display: 'flex', gap: 28, justifyContent: 'center' }}>
                {[['👥','TEAM'],['📊','ANALYTICS'],['🚀','GROWTH']].map(([ic,lb]) => (
                  <div key={lb} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>{ic}</div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: 1.2 }}>{lb}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Form panel */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: r.isMobile ? '40px 28px' : '40px', position: 'relative', overflow: 'hidden' }}>
          {dark && <>
            <div style={{ position: 'absolute', width: 200, height: 200, borderRadius: '50%', top: -40, left: -40, background: 'radial-gradient(circle,rgba(155,117,241,0.3),transparent)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', width: 160, height: 160, borderRadius: '50%', bottom: 80, right: -30, background: 'radial-gradient(circle,rgba(0,212,170,0.2),transparent)', pointerEvents: 'none' }} />
          </>}
          <div style={{ width: '100%', maxWidth: 400, position: 'relative', zIndex: 1 }}>
            {dark && (
              <div style={{ textAlign: 'center', marginBottom: 32 }}>
                <div style={{ width: 72, height: 72, borderRadius: 18, background: '#fff', margin: '0 auto 16px', overflow: 'hidden', boxShadow: '0 6px 24px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src="/logo.png" style={{ width: 66, height: 66, objectFit: 'contain' }} onError={e => e.target.style.display='none'} />
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', fontFamily: FONTS.display, marginBottom: 4 }}>SporTech</div>
                <div style={{ height: 2, width: 50, background: C.gradientH, borderRadius: 2, margin: '8px auto 4px', opacity: 0.7 }} />
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Stride Employee Portal</div>
              </div>
            )}
            {!dark && (
              <div style={{ marginBottom: 36 }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: C.text, fontFamily: FONTS.display, marginBottom: 6 }}>Welcome back 👋</div>
                <div style={{ fontSize: 13, color: C.textLight }}>Sign in to your Stride portal</div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: dark ? 'rgba(255,255,255,0.5)' : C.textMid, display: 'block', marginBottom: 6, fontFamily: FONTS.body }}>Email</label>
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@sportechinnolab.org" style={inputStyle(dark)} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: dark ? 'rgba(255,255,255,0.5)' : C.textMid, display: 'block', marginBottom: 6, fontFamily: FONTS.body }}>Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" onKeyDown={e => e.key === 'Enter' && handleLogin()} style={inputStyle(dark)} />
              </div>
              {error && <Alert type="error" message={error} />}
              <button onClick={handleLogin} disabled={loading} style={gradBtn}>
                {loading ? <><Spinner size={16} color={C.text} /> Signing in…</> : 'Sign In →'}
              </button>
              <div style={{ textAlign: 'center', fontSize: 12, color: dark ? 'rgba(255,255,255,0.35)' : C.textLight }}>
                New employee? <Link to="/register" style={{ color: C.teal, fontWeight: 600, textDecoration: 'none' }}>Create account</Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
