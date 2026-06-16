import { NavLink, useNavigate } from 'react-router-dom'
import { C, FONTS } from '../../lib/constants'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

const NAV = [
  { group: 'MAIN', items: [
    { icon: '⚡', label: 'Dashboard',        path: '/dashboard'  },
    { icon: '👤', label: 'My Profile',        path: '/profile'    },
    { icon: '🏖️', label: 'Leave Management',  path: '/leaves'     },
    { icon: '⏰', label: 'Attendance',         path: '/attendance' },
  ]},
  { group: 'COMING SOON', items: [
    { icon: '💰', label: 'Payslips',   path: null, soon: true },
    { icon: '📄', label: 'Documents',  path: null, soon: true },
    { icon: '🧾', label: 'Expenses',   path: null, soon: true },
    { icon: '👥', label: 'Team Dir.',  path: null, soon: true },
  ]},
]

const HR_NAV = [
  { group: 'HR & ADMIN', items: [
    { icon: '🛡️', label: 'HR Dashboard',      path: '/hr'           },
    { icon: '🧑‍💼', label: 'Employees',          path: '/hr/employees' },
    { icon: '📊', label: 'Attendance Report', path: '/hr/attendance'},
    { icon: '🏖️', label: 'Leave Management',  path: '/hr/leaves'    },
  ]},
]

const DARK = '#1a0f2e'  // Deep purple — from brand gradient start

export default function Sidebar() {
  const { employee, isHR } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <aside style={{
      width: 230, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      height: '100vh', position: 'sticky', top: 0, overflowY: 'auto',
      boxShadow: '2px 0 16px rgba(26,26,46,0.08)',
    }}>

      {/* ── WHITE TOP: Logo ── */}
      <div style={{
        padding: '22px 20px 16px',
        background: C.surface,
        borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: 10,
        flexShrink: 0,
      }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: C.gradientH, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
          <img src="/logo.png" alt="SporTech" style={{ width: 34, height: 34, objectFit: 'contain' }} onError={e => e.target.style.display = 'none'} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text, fontFamily: FONTS.display, lineHeight: 1.1 }}>SporTech</div>
          <div style={{ fontSize: 9, color: C.textLight, letterSpacing: 1.2, textTransform: 'uppercase' }}>Stride Portal</div>
        </div>
      </div>

      {/* ── DARK PURPLE: Employee pill + nav + footer ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: DARK, position: 'relative', overflow: 'hidden' }}>
        {/* Ambient gradient orbs */}
        <div style={{ position: 'absolute', width: 220, height: 220, borderRadius: '50%', top: -60, right: -60, background: 'radial-gradient(circle,rgba(155,117,241,0.2),transparent)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', width: 180, height: 180, borderRadius: '50%', bottom: 60, left: -50, background: 'radial-gradient(circle,rgba(0,212,170,0.12),transparent)', pointerEvents: 'none' }} />

        {/* Employee pill */}
        {employee && (
          <div style={{ margin: '14px 12px 6px', padding: '10px 12px', background: 'rgba(255,255,255,0.07)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8, border: '1px solid rgba(255,255,255,0.08)', position: 'relative', zIndex: 1, flexShrink: 0 }}>
            {employee.profile_photo_url
              ? <img src={employee.profile_photo_url} alt={employee.full_name} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid rgba(255,255,255,0.2)' }} />
              : <div style={{ width: 32, height: 32, borderRadius: '50%', background: C.gradientH, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: DARK, fontFamily: FONTS.display, flexShrink: 0 }}>
                  {employee.avatar_initials || '??'}
                </div>
            }
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: FONTS.display, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{employee.full_name}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{employee.role}</div>
            </div>
          </div>
        )}

        {/* Nav */}
        <nav style={{ flex: 1, padding: '4px 10px', display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1 }}>
          {[...NAV, ...(isHR ? HR_NAV : [])].map(group => (
            <div key={group.group}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.22)', letterSpacing: 1.5, padding: '12px 10px 5px', textTransform: 'uppercase', fontFamily: FONTS.body }}>
                {group.group}
              </div>
              {group.items.map(item => item.soon ? (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, opacity: 0.35, cursor: 'not-allowed', borderLeft: '3px solid transparent' }}>
                  <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{item.icon}</span>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: FONTS.body, flex: 1 }}>{item.label}</span>
                  <span style={{ fontSize: 9, color: C.teal, background: `${C.teal}20`, padding: '2px 7px', borderRadius: 6, fontWeight: 700, letterSpacing: 0.5 }}>SOON</span>
                </div>
              ) : (
                <NavLink key={item.label} to={item.path} style={({ isActive }) => ({
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 12px', borderRadius: 10, textDecoration: 'none',
                  transition: 'all 0.15s', marginBottom: 1,
                  borderLeft: isActive ? `3px solid ${C.teal}` : '3px solid transparent',
                  background: isActive ? 'rgba(0,212,170,0.15)' : 'transparent',
                })}>
                  {({ isActive }) => (
                    <>
                      <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{item.icon}</span>
                      <span style={{ fontSize: 12, fontFamily: FONTS.body, fontWeight: isActive ? 600 : 400, color: isActive ? C.teal : 'rgba(255,255,255,0.6)' }}>{item.label}</span>
                      {isActive && <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.teal, marginLeft: 'auto' }} />}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div style={{ padding: '10px 12px 20px', borderTop: '1px solid rgba(255,255,255,0.08)', position: 'relative', zIndex: 1, flexShrink: 0 }}>
          <div style={{ height: 3, borderRadius: 3, background: C.gradientH, marginBottom: 12, opacity: 0.7 }} />
          <button onClick={handleLogout} style={{ width: '100%', padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', borderRadius: 10, cursor: 'pointer', color: 'rgba(255,255,255,0.35)', fontFamily: FONTS.body, fontSize: 12, transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; e.currentTarget.style.color = '#ef4444' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.35)' }}>
            <span style={{ fontSize: 15 }}>🚪</span> Sign Out
          </button>
        </div>
      </div>
    </aside>
  )
}
