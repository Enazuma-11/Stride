import { NavLink } from 'react-router-dom'
import { C } from '../../lib/constants'
import { useAuth } from '../../context/AuthContext'

const MAIN_NAV = [
  { icon: '🏠', label: 'Home',      path: '/dashboard'  },
  { icon: '🏖️', label: 'Leaves',    path: '/leaves'     },
  { icon: '⏰', label: 'Attendance', path: '/attendance' },
  { icon: '👤', label: 'Profile',   path: '/profile'    },
]

const HR_NAV = [
  { icon: '🏠', label: 'Home',      path: '/dashboard'   },
  { icon: '🏖️', label: 'Leaves',    path: '/leaves'      },
  { icon: '⏰', label: 'Attend.',   path: '/attendance'  },
  { icon: '🛡️', label: 'HR',        path: '/hr'          },
  { icon: '👤', label: 'Profile',   path: '/profile'     },
]

export default function BottomNav() {
  const { isHR } = useAuth()
  const items = isHR ? HR_NAV : MAIN_NAV

  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
      background: '#fff',
      borderTop: `1px solid ${C.border}`,
      display: 'flex',
      boxShadow: '0 -4px 16px rgba(29,53,87,0.08)',
      // Safe area for iPhone home indicator
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {items.map(item => (
        <NavLink
          key={item.path}
          to={item.path}
          style={({ isActive }) => ({
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '10px 4px 8px',
            textDecoration: 'none',
            color: isActive ? C.brand : C.textLight,
            borderTop: isActive ? `2px solid ${C.brand}` : '2px solid transparent',
            background: isActive ? C.brandLight : 'transparent',
            transition: 'all 0.15s',
            minHeight: 56,
          })}
        >
          {({ isActive }) => (
            <>
              <span style={{ fontSize: 20, lineHeight: 1, marginBottom: 3 }}>{item.icon}</span>
              <span style={{
                fontSize: 10, fontWeight: isActive ? 700 : 500,
                letterSpacing: 0.3, textAlign: 'center',
              }}>{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
