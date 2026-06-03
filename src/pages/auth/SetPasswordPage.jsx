import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { C } from '../../lib/constants'
import { Input, Alert } from '../../components/ui'

export default function SetPasswordPage() {
  const navigate  = useNavigate()
  const [password, setPassword]   = useState('')
  const [confirm,  setConfirm]    = useState('')
  const [loading,  setLoading]    = useState(false)
  const [error,    setError]      = useState('')
  const [ready,    setReady]      = useState(false)
  const [name,     setName]       = useState('')

  useEffect(() => {
    // Supabase puts the access_token in the URL hash after invite click
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setReady(true)
        setName(session.user.user_metadata?.full_name || '')
      } else {
        // Try to exchange the hash token
        supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
            setReady(true)
            setName(session?.user?.user_metadata?.full_name || '')
          }
        })
      }
    })
  }, [])

  async function handleSet() {
    setError('')
    if (!password || !confirm) { setError('Please enter and confirm your password.'); return }
    if (password !== confirm)  { setError('Passwords do not match.'); return }
    if (password.length < 8)   { setError('Password must be at least 8 characters.'); return }

    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error

      // Update onboarding status
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        await supabase
          .from('employees')
          .update({ onboarding_status: 'active', must_change_password: false })
          .eq('user_id', session.user.id)
      }
      navigate('/dashboard')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: C.brand,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans', sans-serif", padding: '24px 20px',
    }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap');`}</style>

      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 13, background: C.accent,
            margin: '0 auto 14px', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 26,
          }}>⚡</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', fontFamily: "'Sora',sans-serif" }}>
            SporTech Innovation Lab
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, padding: '36px 32px', boxShadow: '0 24px 64px rgba(0,0,0,0.25)' }}>
          {!ready ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔗</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.text, fontFamily: "'Sora',sans-serif" }}>
                Verifying your invite link…
              </div>
              <div style={{ fontSize: 13, color: C.textMid, marginTop: 8 }}>
                If nothing happens, check that you clicked the link from your email directly.
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 17, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", marginBottom: 6 }}>
                Welcome{name ? `, ${name.split(' ')[0]}` : ''}! 👋
              </div>
              <div style={{ fontSize: 13, color: C.textMid, marginBottom: 24 }}>
                Set your password to activate your SporTech Portal account.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
                <Input label="New Password" type="password" value={password}
                  onChange={setPassword} placeholder="Min. 8 characters" required />
                <Input label="Confirm Password" type="password" value={confirm}
                  onChange={setConfirm} placeholder="Re-enter password" required />
              </div>

              {/* Password strength hint */}
              <div style={{
                background: C.brandLight, borderRadius: 8, padding: '12px 14px',
                marginBottom: 16, fontSize: 12, color: C.brandMid,
              }}>
                💡 Use a mix of letters, numbers, and symbols for a strong password.
              </div>

              {error && <div style={{ marginBottom: 16 }}><Alert type="error" message={error} /></div>}

              <button onClick={handleSet} disabled={loading} style={{
                width: '100%', padding: '13px', borderRadius: 8,
                background: loading ? C.border : C.brand,
                color: loading ? C.textLight : '#fff',
                border: 'none', fontSize: 14, fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: "'Sora',sans-serif",
              }}>
                {loading ? 'Activating account…' : 'Set Password & Enter Portal'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
