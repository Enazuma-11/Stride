import { NavLink, useNavigate } from 'react-router-dom'
import { C } from '../../lib/constants'
import { Avatar } from '../ui'
import { useAuth } from '../../context/AuthContext'
import { signOut } from '../../lib/api'

const NAV_ITEMS = [
  { icon: '🏠', label: 'Dashboard',        path: '/dashboard'  },
  { icon: '👤', label: 'My Profile',         path: '/profile'     },
  { icon: '🏖️', label: 'Leave Management', path: '/leaves'     },
  { icon: '⏰', label: 'Attendance',        path: '/attendance' },
  { icon: '💰', label: 'Payslips',          path: '/payslips',  soon: true },
  { icon: '📁', label: 'Documents',         path: '/documents', soon: true },
  { icon: '💸', label: 'Expenses',          path: '/expenses',  soon: true },
  { icon: '👥', label: 'Team Directory',    path: '/team',      soon: true },
]

const HR_ITEMS = [
  { icon: '🛡️', label: 'HR Dashboard',       path: '/hr'             },
  { icon: '👤', label: 'Employee Management', path: '/hr/employees'   },
  { icon: '⏰', label: 'Attendance Report',   path: '/hr/attendance'  },
  { icon: '📣', label: 'Announcements',       path: '/announcements', soon: true },
]

export default function Sidebar() {
  const { employee, isHR } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <aside style={{
      width: 240, background: C.brand,
      minHeight: '100vh', display: 'flex',
      flexDirection: 'column', flexShrink: 0,
    }}>
      <div style={{ padding: '28px 24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, background: C.accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
          }}>⚡</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', fontFamily: "'Sora',sans-serif", lineHeight: 1.1 }}>SporTech</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', letterSpacing: 1.5, textTransform: 'uppercase' }}>Innovation Lab</div>
          </div>
        </div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: 1, marginTop: 10, textTransform: 'uppercase' }}>
          Stride · Employee Portal
        </div>
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '0 20px 8px' }} />

      <nav style={{ padding: '8px 12px', flex: 1, overflowY: 'auto' }}>
        <NavSection label="Main">
          {NAV_ITEMS.map(item => <NavItem key={item.path} {...item} />)}
        </NavSection>
        {isHR && (
          <NavSection label="HR & Admin">
            {HR_ITEMS.map(item => <NavItem key={item.path} {...item} />)}
          </NavSection>
        )}
      </nav>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '0 20px 8px' }} />

      {employee && (
        <div style={{ padding: '14px 16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Avatar initials={employee.avatar_initials || '??'} size={34} color={C.accent} />
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {employee.full_name}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', textTransform: 'capitalize' }}>{employee.role_type}</div>
            </div>
          </div>
          <button onClick={handleSignOut} style={{
            width: '100%', padding: '8px', borderRadius: 7,
            background: 'rgba(230,57,70,0.15)', border: '1px solid rgba(230,57,70,0.3)',
            color: '#ff8a8a', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
          }}>Sign Out</button>
        </div>
      )}
    </aside>
  )
}

function NavSection({ label, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: 2, textTransform: 'uppercase', padding: '0 8px', marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function NavItem({ icon, label, path, soon }) {
  if (soon) return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '9px 12px', borderRadius: 8, marginBottom: 2,
      color: 'rgba(255,255,255,0.28)', fontSize: 13, cursor: 'default',
    }}>
      <span style={{ fontSize: 14, opacity: 0.5 }}>{icon}</span>
      {label}
      <span style={{ marginLeft: 'auto', fontSize: 8, color: 'rgba(255,255,255,0.2)', letterSpacing: 1, textTransform: 'uppercase' }}>Soon</span>
    </div>
  )
  return (
    <NavLink to={path} style={({ isActive }) => ({
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '9px 12px', borderRadius: 8, marginBottom: 2,
      textDecoration: 'none', fontSize: 13, fontWeight: isActive ? 600 : 400,
      background: isActive ? 'rgba(255,255,255,0.12)' : 'transparent',
      border: isActive ? '1px solid rgba(255,255,255,0.15)' : '1px solid transparent',
      color: isActive ? '#fff' : 'rgba(255,255,255,0.55)',
      transition: 'all 0.15s',
    })}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      {label}
    </NavLink>
  )
}
