import { Navigate } from 'react-router-dom'
import OnboardingFormFull from '../OnboardingFormFull'
import { useAuth } from '../../context/AuthContext'
import { C } from '../../lib/constants'
import { Spinner } from '../ui'

export function ProtectedRoute({ children, requireHR = false }) {
  const { session, employee, loading, isHR } = useAuth()

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', background: C.brand,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
      }}>
        <img src="/logo.png" alt="SporTech" style={{ width: 64, borderRadius: 12, background: '#fff', padding: 4 }} />
        <Spinner size={28} />
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Loading Stride…</div>
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  // Employee registered but not approved yet
  if (employee && employee.onboarding_status === 'pending_approval') {
    return (
      <div style={{
        minHeight: '100vh', background: C.brand,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'DM Sans', sans-serif", padding: '20px',
      }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap');`}</style>
        <div style={{
          background: '#fff', borderRadius: 16, padding: '40px 36px',
          maxWidth: 460, width: '100%', textAlign: 'center',
          boxShadow: '0 24px 64px rgba(0,0,0,0.25)',
        }}>
          <img src="/logo.png" alt="SporTech" style={{ width: 72, borderRadius: 14, marginBottom: 20, objectFit: 'contain' }} />
          <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", marginBottom: 10 }}>
            Approval Pending
          </div>
          <div style={{ fontSize: 14, color: C.textMid, lineHeight: 1.6, marginBottom: 24 }}>
            Your registration request has been submitted successfully. HR is reviewing your details and will activate your account shortly.
          </div>
          <div style={{
            background: C.brandLight, border: `1px solid ${C.brand}20`,
            borderRadius: 10, padding: '16px 20px', marginBottom: 24, textAlign: 'left',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.brand, marginBottom: 10, letterSpacing: 0.5 }}>
              WHAT HAPPENS NEXT
            </div>
            {[
              'HR reviews your registration details',
              'Your role and department get confirmed',
              'You receive an email when activated',
              'Log in and start using Stride',
            ].map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12, color: C.textMid, marginBottom: 6 }}>
                <span style={{ color: C.brand, fontWeight: 700, minWidth: 16 }}>{i + 1}.</span> {s}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: C.textLight }}>
            Usually approved within 1 business day.<br />
            Questions? Contact <span style={{ color: C.brand, fontWeight: 600 }}>talent@sportechinnolab.org</span>
          </div>
        </div>
      </div>
    )
  }

  // First-time employee — show onboarding form
  if (
    employee &&
    employee.onboarding_status === 'active' &&
    !employee.onboarding_form_submitted &&
    employee.role_type === 'employee'
  ) {
    return <OnboardingFormFull />
  }

  // Rejected registration
  if (employee && employee.onboarding_status === 'rejected') {
    return (
      <div style={{
        minHeight: '100vh', background: C.brand,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'DM Sans', sans-serif", padding: '20px',
      }}>
        <div style={{
          background: '#fff', borderRadius: 16, padding: '40px 36px',
          maxWidth: 420, width: '100%', textAlign: 'center',
          boxShadow: '0 24px 64px rgba(0,0,0,0.25)',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", marginBottom: 10 }}>
            Registration Not Approved
          </div>
          <div style={{ fontSize: 14, color: C.textMid, lineHeight: 1.6, marginBottom: 20 }}>
            Your registration request was not approved. Please contact HR for more information.
          </div>
          <div style={{ fontSize: 12, color: C.textLight }}>
            Contact: <span style={{ color: C.brand, fontWeight: 600 }}>talent@sportechinnolab.org</span>
          </div>
        </div>
      </div>
    )
  }

  if (requireHR && !isHR) return <Navigate to="/dashboard" replace />

  return children
}
