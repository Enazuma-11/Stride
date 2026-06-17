import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { C, FONTS } from '../lib/constants'
import { Button, Alert, Spinner } from './ui'

// ── 2FA Setup Panel (shown inside Profile settings) ──────────────────────────
export function TwoFactorSetup({ onStatusChange }) {
  const [status,     setStatus]     = useState(null)  // null | 'unverified' | 'verified'
  const [loading,    setLoading]    = useState(true)
  const [step,       setStep]       = useState('idle') // idle | enrolling | verifying | disabling
  const [qrUrl,      setQrUrl]      = useState('')
  const [secret,     setSecret]     = useState('')
  const [factorId,   setFactorId]   = useState('')
  const [code,       setCode]       = useState('')
  const [error,      setError]      = useState('')
  const [success,    setSuccess]    = useState('')
  const [saving,     setSaving]     = useState(false)

  useEffect(() => { checkStatus() }, [])

  async function checkStatus() {
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) throw error
      const totp = data?.totp?.[0]
      if (totp) {
        setFactorId(totp.id)
        setStatus(totp.status) // 'unverified' | 'verified'
      } else {
        setStatus(null)
      }
    } catch (e) { console.error('MFA status check:', e) }
    finally { setLoading(false) }
  }

  async function startEnrollment() {
    setStep('enrolling')
    setError('')
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'Stride — SporTech', friendlyName: 'Stride Portal' })
      if (error) throw error
      setQrUrl(data.totp.qr_code)
      setSecret(data.totp.secret)
      setFactorId(data.id)
    } catch (e) { setError(e.message); setStep('idle') }
  }

  async function verifyEnrollment() {
    if (code.length !== 6) { setError('Enter the 6-digit code from your authenticator app.'); return }
    setSaving(true); setError('')
    try {
      // Create challenge then verify
      const { data: challenge, error: chalErr } = await supabase.auth.mfa.challenge({ factorId })
      if (chalErr) throw chalErr

      const { data, error } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: code.trim(),
      })
      if (error) throw error

      setStatus('verified')
      setStep('idle')
      setSuccess('2FA enabled successfully! Your account is now more secure.')
      setCode('')
      onStatusChange?.('verified')
    } catch (e) { setError('Invalid code. Please try again.') }
    finally { setSaving(false) }
  }

  async function disable2FA() {
    if (!window.confirm('Are you sure you want to disable 2FA? This will make your account less secure.')) return
    setSaving(true); setError('')
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId })
      if (error) throw error
      setStatus(null)
      setFactorId('')
      setStep('idle')
      setSuccess('2FA has been disabled.')
      onStatusChange?.(null)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  if (loading) return <div style={{ padding: 20 }}><Spinner size={24} /></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Status banner */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 18px', borderRadius: 12,
        background: status === 'verified' ? '#e0fff2' : C.surfaceAlt,
        border: `1px solid ${status === 'verified' ? '#00b89430' : C.border}`,
        gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: status === 'verified' ? '#00b89415' : C.border,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, flexShrink: 0,
          }}>
            {status === 'verified' ? '🔐' : '🔓'}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>
              Two-Factor Authentication
            </div>
            <div style={{ fontSize: 11, color: status === 'verified' ? '#00b894' : C.textLight, marginTop: 2 }}>
              {status === 'verified'
                ? '✓ Enabled — your account is protected'
                : 'Not enabled — add extra security to your account'}
            </div>
          </div>
        </div>
        {status === 'verified' ? (
          <button onClick={disable2FA} disabled={saving} style={{
            padding: '7px 14px', borderRadius: 8, border: '1.5px solid #ef4444',
            background: 'transparent', color: '#ef4444',
            fontSize: 12, fontWeight: 600, fontFamily: FONTS.display, cursor: 'pointer',
          }}>
            {saving ? 'Disabling…' : 'Disable 2FA'}
          </button>
        ) : step === 'idle' ? (
          <button onClick={startEnrollment} style={{
            padding: '7px 14px', borderRadius: 8, border: 'none',
            background: C.brand, color: '#fff',
            fontSize: 12, fontWeight: 600, fontFamily: FONTS.display, cursor: 'pointer',
          }}>
            Enable 2FA
          </button>
        ) : null}
      </div>

      {/* Enrollment flow */}
      {step === 'enrolling' && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>
            Set up Google Authenticator
          </div>

          {/* Steps */}
          {[
            'Download Google Authenticator or Authy on your phone',
            'Open the app and tap "+" to add a new account',
            'Scan the QR code below',
            'Enter the 6-digit code shown in the app',
          ].map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12, color: C.textMid, alignItems: 'flex-start' }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: C.brand, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
              {s}
            </div>
          ))}

          {/* QR Code */}
          {qrUrl && (
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ padding: 12, background: '#fff', borderRadius: 12, border: `1px solid ${C.border}`, display: 'inline-block' }}>
                  <img src={qrUrl} alt="QR Code" style={{ width: 140, height: 140, display: 'block' }} />
                </div>
                <div style={{ fontSize: 10, color: C.textLight, marginTop: 6 }}>Scan with your app</div>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.textMid, marginBottom: 6 }}>
                  Can't scan? Enter manually:
                </div>
                <div style={{
                  background: C.bg, border: `1px solid ${C.border}`,
                  borderRadius: 8, padding: '8px 12px',
                  fontSize: 11, fontFamily: FONTS.mono, color: C.text,
                  wordBreak: 'break-all', letterSpacing: 1,
                }}>
                  {secret}
                </div>
                <div style={{ fontSize: 10, color: C.textLight, marginTop: 6, lineHeight: 1.5 }}>
                  In your app, choose "Enter a setup key" and paste this code. Set type to "Time-based".
                </div>
              </div>
            </div>
          )}

          {/* Verification input */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 6, fontFamily: FONTS.body }}>
              Enter the 6-digit code from your app
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                style={{
                  flex: 1, padding: '11px 14px', borderRadius: 10,
                  border: `1.5px solid ${C.border}`,
                  fontSize: 20, fontFamily: FONTS.mono, letterSpacing: 6,
                  textAlign: 'center', outline: 'none', color: C.text,
                }}
                onKeyDown={e => e.key === 'Enter' && verifyEnrollment()}
              />
              <button onClick={verifyEnrollment} disabled={saving || code.length !== 6} style={{
                padding: '11px 20px', borderRadius: 10, border: 'none',
                background: saving || code.length !== 6 ? C.border : C.brand,
                color: saving || code.length !== 6 ? C.textLight : '#fff',
                fontSize: 13, fontWeight: 700, fontFamily: FONTS.display,
                cursor: saving || code.length !== 6 ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}>
                {saving ? <Spinner size={16} color="#fff" /> : 'Verify & Enable'}
              </button>
            </div>
          </div>

          {error   && <Alert type="error"   message={error}   />}
          {success && <Alert type="success" message={success} />}

          <button onClick={() => { setStep('idle'); setError('') }} style={{ background: 'none', border: 'none', color: C.textLight, fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: FONTS.body }}>
            ← Cancel setup
          </button>
        </div>
      )}

      {error   && step === 'idle' && <Alert type="error"   message={error}   />}
      {success && step === 'idle' && <Alert type="success" message={success} />}
    </div>
  )
}

// ── 2FA Verification Screen (shown after login if 2FA is enabled) ─────────────
export function TwoFactorVerify({ onVerified, onCancel }) {
  const [code,    setCode]    = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  async function verify() {
    if (code.length !== 6) { setError('Please enter the 6-digit code.'); return }
    setLoading(true); setError('')
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const totp = factors?.totp?.[0]
      if (!totp) { onVerified?.(); return }

      const { data: challenge, error: chalErr } = await supabase.auth.mfa.challenge({ factorId: totp.id })
      if (chalErr) throw chalErr

      const { error: verErr } = await supabase.auth.mfa.verify({
        factorId:    totp.id,
        challengeId: challenge.id,
        code:        code.trim(),
      })
      if (verErr) throw verErr

      onVerified?.()
    } catch (e) {
      setError('Invalid code. Please check your authenticator app and try again.')
      setCode('')
    } finally { setLoading(false) }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #1a0f2e, #0d3a5c)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, position: 'relative', overflow: 'hidden',
      fontFamily: FONTS.body,
    }}>
      {/* Orbs */}
      <div style={{ position: 'absolute', width: 300, height: 300, borderRadius: '50%', top: -80, left: -80, background: 'radial-gradient(circle,rgba(155,117,241,0.25),transparent)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', width: 250, height: 250, borderRadius: '50%', bottom: -60, right: -60, background: 'radial-gradient(circle,rgba(0,212,170,0.2),transparent)', pointerEvents: 'none' }} />

      <div style={{
        background: C.surface, borderRadius: 20,
        padding: '36px 32px', width: '100%', maxWidth: 380,
        boxShadow: '0 24px 80px rgba(0,0,0,0.3)',
        position: 'relative', zIndex: 1,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: C.gradientH, margin: '0 auto 14px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src="/logo.png" style={{ width: 52, height: 52, objectFit: 'contain' }} onError={e => e.target.style.display='none'} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.text, fontFamily: FONTS.display, marginBottom: 4 }}>
            Two-Factor Authentication
          </div>
          <div style={{ fontSize: 12, color: C.textLight, lineHeight: 1.5 }}>
            Open your authenticator app and enter the 6-digit code for <strong>Stride Portal</strong>
          </div>
        </div>

        {/* Code input */}
        <div style={{ marginBottom: 16 }}>
          <input
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            autoFocus
            style={{
              width: '100%', padding: '16px',
              borderRadius: 12, border: `2px solid ${error ? '#ef4444' : C.border}`,
              fontSize: 32, fontFamily: FONTS.mono, letterSpacing: 12,
              textAlign: 'center', outline: 'none', color: C.text,
              transition: 'border-color 0.15s',
            }}
            onFocus={e => e.target.style.borderColor = C.teal}
            onBlur={e => e.target.style.borderColor = error ? '#ef4444' : C.border}
            onKeyDown={e => e.key === 'Enter' && verify()}
          />
        </div>

        {error && <div style={{ marginBottom: 14 }}><Alert type="error" message={error} /></div>}

        <button onClick={verify} disabled={loading || code.length !== 6} style={{
          width: '100%', padding: '13px', borderRadius: 10, border: 'none',
          background: loading || code.length !== 6 ? C.border : C.brand,
          color: loading || code.length !== 6 ? C.textLight : '#fff',
          fontSize: 14, fontWeight: 700, fontFamily: FONTS.display,
          cursor: loading || code.length !== 6 ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          marginBottom: 12,
        }}>
          {loading ? <><Spinner size={16} color="#fff" /> Verifying…</> : 'Verify →'}
        </button>

        <div style={{ textAlign: 'center', fontSize: 12, color: C.textLight }}>
          Code refreshes every 30 seconds.
          <br />
          <button onClick={onCancel} style={{ background: 'none', border: 'none', color: C.brand, fontSize: 12, cursor: 'pointer', marginTop: 4, fontFamily: FONTS.body }}>
            Sign in with a different account
          </button>
        </div>
      </div>
    </div>
  )
}
