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
      background: C.surface,
      borderRight: `1px solid ${C.border}`,
      boxShadow: '2px 0 12px rgba(26,26,46,0.04)',
      display: 'flex', flexDirection: 'column',
      height: '100vh', position: 'sticky', top: 0, overflowY: 'auto',
    }}>
      {/* Logo */}
      <div style={{ padding: '22px 20px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: C.gradientH, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
          <img src="/logo.png" alt="SporTech" style={{ width: 34, height: 34, objectFit: 'contain' }} onError={e => e.target.style.display = 'none'} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text, fontFamily: FONTS.display, lineHeight: 1.1 }}>SporTech</div>
          <div style={{ fontSize: 9, color: C.textLight, letterSpacing: 1.2, textTransform: 'uppercase' }}>Stride Portal</div>
        </div>
      </div>

      {/* Employee pill */}
      {employee && (
        <div style={{ margin: '0 12px 8px', padding: '10px 12px', background: C.bg, borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: C.gradientH, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.text, fontFamily: FONTS.display, flexShrink: 0 }}>
            {employee.avatar_initials || '??'}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, fontFamily: FONTS.display, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{employee.full_name}</div>
            <div style={{ fontSize: 10, color: C.textLight, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{employee.role}</div>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav style={{ flex: 1, padding: '4px 10px', display: 'flex', flexDirection: 'column' }}>
        {[...NAV, ...(isHR ? HR_NAV : [])].map(group => (
          <div key={group.group}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#b0b8c1', letterSpacing: 1.5, padding: '12px 10px 5px', textTransform: 'uppercase', fontFamily: FONTS.body }}>
              {group.group}
            </div>
            {group.items.map(item => item.soon ? (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, opacity: 0.4, cursor: 'not-allowed', borderLeft: '3px solid transparent' }}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{item.icon}</span>
                <span style={{ fontSize: 12, color: C.textLight, fontFamily: FONTS.body, flex: 1 }}>{item.label}</span>
                <span style={{ fontSize: 9, color: C.teal, background: `${C.teal}18`, padding: '2px 7px', borderRadius: 6, fontWeight: 700, letterSpacing: 0.5 }}>SOON</span>
              </div>
            ) : (
              <NavLink key={item.label} to={item.path} style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 10, textDecoration: 'none',
                transition: 'all 0.15s', marginBottom: 1,
                borderLeft: isActive ? `3px solid ${C.teal}` : '3px solid transparent',
                background: isActive ? 'linear-gradient(90deg, rgba(0,212,170,0.12), rgba(18,109,173,0.06))' : 'transparent',
              })}>
                {({ isActive }) => (
                  <>
                    <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{item.icon}</span>
                    <span style={{ fontSize: 12, fontFamily: FONTS.body, fontWeight: isActive ? 600 : 400, color: isActive ? C.brand : C.textLight }}>{item.label}</span>
                    {isActive && <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.teal, marginLeft: 'auto' }} />}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: '10px 12px 20px', borderTop: `1px solid ${C.border}` }}>
        <div style={{ height: 4, borderRadius: 4, background: C.gradientH, marginBottom: 12, opacity: 0.8 }} />
        <button onClick={handleLogout} style={{ width: '100%', padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', borderRadius: 10, cursor: 'pointer', color: C.textLight, fontFamily: FONTS.body, fontSize: 12, transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = '#ef4444' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textLight }}>
          <span style={{ fontSize: 15 }}>🚪</span> Sign Out
        </button>
      </div>
    </aside>
  )
}
