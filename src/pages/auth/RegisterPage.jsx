import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { C, EMPLOYEE_TYPES, DEPARTMENTS, COMPANY_DOMAIN, REQUIRES_COMPANY_EMAIL } from '../../lib/constants'
import { selfRegister, validateEmailForType } from '../../lib/api.onboarding'
import { Input, Alert } from '../../components/ui'

export default function RegisterPage() {
  const navigate = useNavigate()
  const [step,    setStep]    = useState(1)   // 1=pick type, 2=fill form, 3=success
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [form,    setForm]    = useState({
    fullName: '', email: '', password: '', confirmPassword: '',
    employeeType: '', department: '', role: '', phone: '', gender: '',
  })

  function set(k) { return v => setForm(f => ({ ...f, [k]: v })) }

  const isCompanyEmailRequired = REQUIRES_COMPANY_EMAIL.includes(form.employeeType)
  const emailHint = isCompanyEmailRequired
    ? `Must be your @${COMPANY_DOMAIN} company email`
    : `Use your personal email (Gmail, Outlook, etc.)`

  // Live email validation feedback
  const emailWarning = form.email && form.employeeType
    ? validateEmailForType(form.email, form.employeeType)
    : null

  function pickType(type) {
    setForm(f => ({ ...f, employeeType: type, email: '' })) // reset email when type changes
    setError('')
    setStep(2)
  }

  async function handleSubmit() {
    setError('')
    if (!form.fullName || !form.email || !form.password || !form.department) {
      setError('Please fill in all required fields.'); return
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.'); return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.'); return
    }
    const emailErr = validateEmailForType(form.email, form.employeeType)
    if (emailErr) { setError(emailErr); return }

    setLoading(true)
    try {
      await selfRegister(form)
      setStep(3)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const selectedType = EMPLOYEE_TYPES.find(t => t.value === form.employeeType)

  return (
    <div style={{
      minHeight: '100vh', background: C.brand,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans', sans-serif", padding: '24px 20px',
      backgroundImage: 'radial-gradient(ellipse at 30% 80%, rgba(43,78,122,0.9) 0%, transparent 60%)',
    }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap');`}</style>

      <div style={{ width: '100%', maxWidth: step === 1 ? 520 : 500 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12, background: C.accent,
            margin: '0 auto 12px', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 24, boxShadow: `0 8px 24px ${C.accent}60`,
          }}>⚡</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', fontFamily: "'Sora',sans-serif" }}>
            SporTech Innovation Lab
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>
            Request Portal Access
          </div>
        </div>

        {/* ── STEP 1: Choose employee type ─────────────────────────────────── */}
        {step === 1 && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '32px 28px', boxShadow: '0 24px 64px rgba(0,0,0,0.25)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", marginBottom: 4 }}>
              What's your employment type?
            </div>
            <div style={{ fontSize: 13, color: C.textMid, marginBottom: 24 }}>
              This determines which email you should use to register.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
              {EMPLOYEE_TYPES.map(type => {
                const needsCompany = REQUIRES_COMPANY_EMAIL.includes(type.value)
                return (
                  <button key={type.value} onClick={() => pickType(type.value)} style={{
                    padding: '18px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                    border: `2px solid ${C.border}`,
                    background: '#fff',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = C.brand; e.currentTarget.style.background = C.brandLight }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = '#fff' }}
                  >
                    <div style={{ fontSize: 24, marginBottom: 8 }}>{type.icon}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>{type.label}</div>
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                      background: needsCompany ? C.brandLight : C.greenSoft,
                      color: needsCompany ? C.brand : C.green,
                    }}>
                      {needsCompany ? `@${COMPANY_DOMAIN}` : 'Personal email'}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Email legend */}
            <div style={{ background: C.surfaceAlt, borderRadius: 8, padding: '12px 14px', fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: C.textMid, marginBottom: 8 }}>Email requirements:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ background: C.brandLight, color: C.brand, padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600 }}>@{COMPANY_DOMAIN}</span>
                  <span style={{ color: C.textMid }}>Permanent employees · Part-time</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ background: C.greenSoft, color: C.green, padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600 }}>Personal email</span>
                  <span style={{ color: C.textMid }}>Interns · Contractors</span>
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: C.textMid }}>
              Already have an account?{' '}
              <Link to="/login" style={{ color: C.brand, fontWeight: 600, textDecoration: 'none' }}>Sign in</Link>
            </div>
          </div>
        )}

        {/* ── STEP 2: Fill registration form ───────────────────────────────── */}
        {step === 2 && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '32px 28px', boxShadow: '0 24px 64px rgba(0,0,0,0.25)' }}>

            {/* Type pill + back */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{selectedType?.icon}</span>
                <span style={{
                  fontSize: 12, fontWeight: 700, padding: '3px 12px', borderRadius: 20,
                  background: C.brandLight, color: C.brand,
                }}>{selectedType?.label}</span>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                  background: isCompanyEmailRequired ? C.brandLight : C.greenSoft,
                  color: isCompanyEmailRequired ? C.brandMid : C.green,
                }}>
                  {isCompanyEmailRequired ? `@${COMPANY_DOMAIN} required` : 'Personal email'}
                </span>
              </div>
              <button onClick={() => { setStep(1); setError('') }} style={{
                background: 'none', border: 'none', fontSize: 12,
                color: C.textLight, cursor: 'pointer', textDecoration: 'underline',
              }}>← Change</button>
            </div>

            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", marginBottom: 20 }}>
              Create your account
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 18 }}>
              <Input label="Full Name" value={form.fullName} onChange={set('fullName')}
                placeholder="Rahul Mehta" required />

              {/* Email field with live validation */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 8 }}>
                  Email Address <span style={{ color: C.accent }}>*</span>
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => set('email')(e.target.value)}
                  placeholder={isCompanyEmailRequired ? `you@${COMPANY_DOMAIN}` : 'you@gmail.com'}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8, boxSizing: 'border-box',
                    border: `1.5px solid ${emailWarning ? C.accent : form.email && !emailWarning ? C.green : C.border}`,
                    background: C.surfaceAlt, fontSize: 13, color: C.text,
                    fontFamily: "'DM Sans',sans-serif",
                  }}
                />
                {/* Contextual hint under email */}
                <div style={{
                  fontSize: 11, marginTop: 5,
                  color: emailWarning ? C.accent : C.textLight,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  {emailWarning
                    ? <span>⚠️ {emailWarning}</span>
                    : <span>{isCompanyEmailRequired ? '🏢' : '📧'} {emailHint}</span>
                  }
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* Department */}
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 8 }}>
                    Department <span style={{ color: C.accent }}>*</span>
                  </label>
                  <select value={form.department} onChange={e => set('department')(e.target.value)}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 8,
                      border: `1.5px solid ${C.border}`, background: C.surfaceAlt,
                      fontSize: 13, color: form.department ? C.text : C.textLight,
                      fontFamily: "'DM Sans',sans-serif",
                    }}>
                    <option value="">Select…</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <Input label="Role / Project (optional)" value={form.role}
                  onChange={set('role')} placeholder={form.employeeType === 'intern' ? 'Frontend Intern' : 'Developer'} />
              </div>

              <Input label="Phone (optional)" type="tel" value={form.phone}
                onChange={set('phone')} placeholder="+91 98765 43210" />

              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                <Input label="Password" type="password" value={form.password}
                  onChange={set('password')} placeholder="Min. 8 characters" required />
              </div>

              <Input label="Confirm Password" type="password" value={form.confirmPassword}
                onChange={set('confirmPassword')} placeholder="Re-enter password" required />
            </div>

            {error && <div style={{ marginBottom: 14 }}><Alert type="error" message={error} /></div>}

            <button onClick={handleSubmit} disabled={loading || !!emailWarning} style={{
              width: '100%', padding: '13px', borderRadius: 8,
              background: (loading || emailWarning) ? C.border : C.brand,
              color: (loading || emailWarning) ? C.textLight : '#fff',
              border: 'none', fontSize: 14, fontWeight: 700,
              cursor: (loading || emailWarning) ? 'not-allowed' : 'pointer',
              fontFamily: "'Sora',sans-serif",
              boxShadow: (loading || emailWarning) ? 'none' : `0 4px 12px ${C.brand}40`,
            }}>
              {loading ? 'Submitting…' : 'Submit Registration Request'}
            </button>

            <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: C.textMid }}>
              Already have an account?{' '}
              <Link to="/login" style={{ color: C.brand, fontWeight: 600, textDecoration: 'none' }}>Sign in</Link>
            </div>
          </div>
        )}

        {/* ── STEP 3: Success ───────────────────────────────────────────────── */}
        {step === 3 && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '40px 32px', textAlign: 'center', boxShadow: '0 24px 64px rgba(0,0,0,0.25)' }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🎉</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", marginBottom: 8 }}>
              Request Submitted!
            </div>
            <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.6, marginBottom: 20 }}>
              Your registration as a <strong>{selectedType?.label}</strong> is pending HR approval.<br />
              You'll be notified at <strong>{form.email}</strong> once activated.
            </div>

            <div style={{
              background: C.brandLight, border: `1px solid ${C.brand}20`,
              borderRadius: 10, padding: '16px 18px', marginBottom: 20, textAlign: 'left',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.brand, marginBottom: 10, letterSpacing: 0.5 }}>WHAT HAPPENS NEXT</div>
              {[
                'HR reviews your request (usually within 1 business day)',
                'Your role and department will be confirmed',
                'You\'ll receive an email when your account is activated',
                'Log in and start using the portal',
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12, color: C.textMid, marginBottom: 6 }}>
                  <span style={{ color: C.brand, fontWeight: 700, minWidth: 16 }}>{i + 1}.</span> {s}
                </div>
              ))}
            </div>

            <button onClick={() => navigate('/login')} style={{
              width: '100%', padding: '12px', borderRadius: 8,
              background: C.brand, color: '#fff', border: 'none',
              fontSize: 14, fontWeight: 700, cursor: 'pointer',
              fontFamily: "'Sora',sans-serif",
            }}>Back to Login</button>
          </div>
        )}
      </div>
    </div>
  )
}
