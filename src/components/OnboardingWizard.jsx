import { useState } from 'react'
import { C, GENDERS } from '../lib/constants'
import { Input, Alert } from './ui'
import { useAuth } from '../context/AuthContext'
import { updateEmployeeBasic } from '../lib/api.profile'
import { useResponsive } from '../lib/responsive'

const STEPS = [
  { id: 1, title: 'Welcome!',          icon: '👋', subtitle: 'Let\'s get you set up in just 2 minutes' },
  { id: 2, title: 'Your Name',         icon: '✍️',  subtitle: 'How should we refer to you?' },
  { id: 3, title: 'Personal Details',  icon: '📋', subtitle: 'Basic information about you' },
  { id: 4, title: 'Contact Details',   icon: '📞', subtitle: 'How can we reach you?' },
  { id: 5, title: 'Your Address',      icon: '🏠', subtitle: 'Where are you based?' },
]

const MARITAL_OPTIONS = [
  { value: '',                  label: 'Select…'            },
  { value: 'single',            label: 'Single'             },
  { value: 'married',           label: 'Married'            },
  { value: 'divorced',          label: 'Divorced'           },
  { value: 'widowed',           label: 'Widowed'            },
  { value: 'prefer_not_to_say', label: 'Prefer not to say'  },
]

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ current, total }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        {Array.from({ length: total }, (_, i) => i + 1).map(step => (
          <div key={step} style={{
            width: 28, height: 28, borderRadius: '50%',
            background: step < current ? C.green : step === current ? C.brand : C.border,
            color: step <= current ? '#fff' : C.textLight,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700,
            transition: 'all 0.3s',
            fontFamily: "'Sora',sans-serif",
          }}>
            {step < current ? '✓' : step}
          </div>
        ))}
      </div>
      <div style={{ height: 4, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          width: `${((current - 1) / (total - 1)) * 100}%`,
          height: '100%', background: C.brand, borderRadius: 4,
          transition: 'width 0.4s ease',
        }} />
      </div>
      <div style={{ fontSize: 11, color: C.textLight, marginTop: 6, textAlign: 'right' }}>
        Step {current} of {total}
      </div>
    </div>
  )
}

// ── Step content components ───────────────────────────────────────────────────
function StepWelcome({ employee }) {
  return (
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <img src="/logo.png" alt="SporTech" style={{ width: 80, height: 80, borderRadius: 16, background: '#f5f5f5', padding: 6, marginBottom: 16, objectFit: 'contain', display: 'block', margin: '0 auto 16px' }} />
      <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, fontFamily: "'Sora',sans-serif", marginBottom: 10 }}>
        Welcome to Stride, {employee?.full_name?.split(' ')[0]}!
      </h2>
      <p style={{ fontSize: 14, color: C.textMid, lineHeight: 1.6, marginBottom: 20 }}>
        You're all set up on SporTech's employee portal.<br />
        Let's fill in a few basic details so HR has everything they need.
      </p>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 10, textAlign: 'left', marginTop: 8,
      }}>
        {[
          { icon: '🏖️', text: 'Apply & track leaves' },
          { icon: '⏰', text: 'Mark daily attendance' },
          { icon: '🔔', text: 'Get notified instantly' },
          { icon: '👤', text: 'Manage your profile' },
        ].map(f => (
          <div key={f.text} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: C.surfaceAlt, borderRadius: 8, padding: '10px 14px',
            fontSize: 13, color: C.textMid,
          }}>
            <span>{f.icon}</span> {f.text}
          </div>
        ))}
      </div>
    </div>
  )
}

function StepName({ form, set }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Input
          label="First Name"
          value={form.first_name}
          onChange={set('first_name')}
          placeholder="Rahul"
          required
        />
        <Input
          label="Last Name"
          value={form.last_name}
          onChange={set('last_name')}
          placeholder="Mehta"
          required
        />
      </div>
      <Input
        label="Middle Name (optional)"
        value={form.middle_name}
        onChange={set('middle_name')}
        placeholder="Kumar"
      />
      <Input
        label="Preferred / Nick Name (optional)"
        value={form.preferred_name}
        onChange={set('preferred_name')}
        placeholder="What should we call you?"
      />
    </div>
  )
}

function StepPersonal({ form, set }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Input
        label="Date of Birth"
        type="date"
        value={form.date_of_birth}
        onChange={set('date_of_birth')}
        required
      />
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 8 }}>
          Gender <span style={{ color: C.accent }}>*</span>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {GENDERS.map(g => (
            <button
              key={g.value}
              onClick={() => set('gender')(g.value)}
              style={{
                padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                border: `1.5px solid ${form.gender === g.value ? C.brand : C.border}`,
                background: form.gender === g.value ? C.brandLight : '#fff',
                color: form.gender === g.value ? C.brand : C.textMid,
                fontSize: 13, fontWeight: form.gender === g.value ? 700 : 400,
                textAlign: 'left', transition: 'all 0.15s',
                fontFamily: "'DM Sans',sans-serif",
              }}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 8 }}>
          Marital Status
        </label>
        <select
          value={form.marital_status}
          onChange={e => set('marital_status')(e.target.value)}
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 8,
            border: `1.5px solid ${C.border}`, background: C.surfaceAlt,
            fontSize: 13, color: C.text, fontFamily: "'DM Sans',sans-serif",
          }}
        >
          {MARITAL_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

function StepContact({ form, set }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Input
        label="Personal Mobile"
        type="tel"
        value={form.personal_mobile}
        onChange={set('personal_mobile')}
        placeholder="+91 98765 43210"
        required
      />
      <Input
        label="Personal Email (optional)"
        type="email"
        value={form.personal_email}
        onChange={set('personal_email')}
        placeholder="you@gmail.com"
      />
      <div style={{
        background: C.brandLight, borderRadius: 8,
        padding: '12px 14px', fontSize: 12, color: C.brandMid,
      }}>
        💡 Your personal contact details are only visible to HR and are kept confidential.
      </div>
    </div>
  )
}

function StepAddress({ form, set }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        fontSize: 12, fontWeight: 700, color: C.textMid,
        letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2,
      }}>
        Current / Present Address
      </div>
      <Input label="Street / Area" value={form.present_street}  onChange={set('present_street')}  placeholder="123 MG Road, Andheri West" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Input label="City"    value={form.present_city}    onChange={set('present_city')}    placeholder="Mumbai"       />
        <Input label="State"   value={form.present_state}   onChange={set('present_state')}   placeholder="Maharashtra"  />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Input label="PIN Code" value={form.present_zip}     onChange={set('present_zip')}     placeholder="400001"       />
        <Input label="Country"  value={form.present_country} onChange={set('present_country')} placeholder="India"        />
      </div>
    </div>
  )
}

// ── Main wizard ───────────────────────────────────────────────────────────────
export default function OnboardingWizard({ onComplete }) {
  const { employee, refetchEmployee } = useAuth()
  const r = useResponsive()
  const [step,    setStep]    = useState(1)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [form,    setForm]    = useState({
    first_name:      employee?.full_name?.split(' ')[0] || '',
    middle_name:     '',
    last_name:       employee?.full_name?.split(' ').slice(1).join(' ') || '',
    preferred_name:  '',
    date_of_birth:   '',
    gender:          employee?.gender || '',
    marital_status:  '',
    personal_mobile: employee?.phone || '',
    personal_email:  '',
    present_street:  '',
    present_city:    '',
    present_state:   '',
    present_zip:     '',
    present_country: 'India',
  })

  function set(k) { return v => setForm(f => ({ ...f, [k]: v })) }

  const currentStep = STEPS[step - 1]
  const isLast      = step === STEPS.length

  function validateStep() {
    if (step === 2 && !form.first_name.trim()) { setError('First name is required.'); return false }
    if (step === 3 && !form.gender)            { setError('Please select your gender.'); return false }
    if (step === 3 && !form.date_of_birth)     { setError('Date of birth is required.'); return false }
    if (step === 4 && !form.personal_mobile.trim()) { setError('Mobile number is required.'); return false }
    return true
  }

  function handleNext() {
    setError('')
    if (!validateStep()) return
    if (isLast) handleSave()
    else setStep(s => s + 1)
  }

  function handleBack() {
    setError('')
    setStep(s => s - 1)
  }

  async function handleSave() {
    setSaving(true); setError('')
    try {
      // Build full_name from parts
      const fullName = [form.first_name, form.middle_name, form.last_name]
        .filter(Boolean).join(' ')

      await updateEmployeeBasic(employee.id, {
        first_name:       form.first_name,
        middle_name:      form.middle_name,
        last_name:        form.last_name,
        full_name:        fullName,
        preferred_name:   form.preferred_name,
        display_name:     form.preferred_name || fullName,
        date_of_birth:    form.date_of_birth || null,
        gender:           form.gender,
        marital_status:   form.marital_status || null,
        personal_mobile:  form.personal_mobile,
        personal_email:   form.personal_email || null,
        present_address:  {
          street:  form.present_street,
          city:    form.present_city,
          state:   form.present_state,
          zip:     form.present_zip,
          country: form.present_country,
        },
        onboarding_completed: true,
        avatar_initials: [form.first_name[0], form.last_name[0]].filter(Boolean).join('').toUpperCase() || employee.avatar_initials,
      })

      await refetchEmployee()
      onComplete()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    // Backdrop
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(29,53,87,0.6)',
      backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: r.isMobile ? '0' : '20px',
      animation: 'fadeIn 0.2s ease',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: r.isMobile ? '20px 20px 0 0' : 16,
        width: '100%',
        maxWidth: 520,
        maxHeight: r.isMobile ? '92vh' : '90vh',
        overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(29,53,87,0.25)',
        position: r.isMobile ? 'fixed' : 'relative',
        bottom: r.isMobile ? 0 : 'auto',
        animation: 'slideUp 0.3s ease',
      }}>
        {/* Header */}
        <div style={{
          padding: '24px 28px 0',
          position: 'sticky', top: 0,
          background: '#fff', zIndex: 1,
          borderRadius: r.isMobile ? '20px 20px 0 0' : '16px 16px 0 0',
        }}>
          {/* Drag handle on mobile */}
          {r.isMobile && (
            <div style={{
              width: 40, height: 4, background: C.border,
              borderRadius: 4, margin: '0 auto 16px',
            }} />
          )}

          {/* Brand + step title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: C.brand, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 20, flexShrink: 0,
            }}>
              {currentStep.icon}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif" }}>
                {currentStep.title}
              </div>
              <div style={{ fontSize: 12, color: C.textLight }}>{currentStep.subtitle}</div>
            </div>
          </div>

          <ProgressBar current={step} total={STEPS.length} />
        </div>

        {/* Step content */}
        <div style={{ padding: '8px 28px 24px' }}>
          {step === 1 && <StepWelcome employee={employee} />}
          {step === 2 && <StepName    form={form} set={set} />}
          {step === 3 && <StepPersonal form={form} set={set} />}
          {step === 4 && <StepContact  form={form} set={set} />}
          {step === 5 && <StepAddress  form={form} set={set} />}

          {error && (
            <div style={{ marginTop: 16 }}>
              <Alert type="error" message={error} />
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div style={{
          padding: '16px 28px 24px',
          borderTop: `1px solid ${C.border}`,
          display: 'flex', gap: 10, justifyContent: 'space-between',
          position: 'sticky', bottom: 0,
          background: '#fff',
        }}>
          {step > 1 ? (
            <button onClick={handleBack} style={{
              padding: '11px 24px', borderRadius: 8,
              border: `1.5px solid ${C.border}`,
              background: 'transparent', color: C.textMid,
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              fontFamily: "'Sora',sans-serif",
            }}>
              ← Back
            </button>
          ) : (
            <div /> // spacer
          )}

          <button onClick={handleNext} disabled={saving} style={{
            padding: '11px 32px', borderRadius: 8,
            border: 'none',
            background: saving ? C.border : C.brand,
            color: saving ? C.textLight : '#fff',
            fontSize: 14, fontWeight: 700,
            cursor: saving ? 'not-allowed' : 'pointer',
            fontFamily: "'Sora',sans-serif",
            boxShadow: saving ? 'none' : `0 4px 12px ${C.brand}40`,
            flex: step === 1 ? 1 : 'auto',
          }}>
            {saving ? 'Saving…' : isLast ? '🎉 Complete Setup' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  )
}
