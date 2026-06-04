import { C } from '../../lib/constants'
import { Avatar } from '../ui'
import { useAuth } from '../../context/AuthContext'
import NotificationBell from './NotificationBell'
import { useEffect } from 'react'
import { runDailyChecks } from '../../lib/api.notifications'

export default function TopBar({ title, subtitle }) {
  const { employee, isHR } = useAuth()

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  // Run daily checks once per session for HR/Admin
  useEffect(() => {
    if (!employee || !isHR) return
    const lastRun = sessionStorage.getItem('dailyChecksRun')
    const todayStr = new Date().toISOString().split('T')[0]
    if (lastRun === todayStr) return
    runDailyChecks(employee.id)
      .then(() => sessionStorage.setItem('dailyChecksRun', todayStr))
      .catch(e => console.warn('Daily checks:', e.message))
  }, [employee, isHR])

  return (
    <header style={{
      height: 64, background: '#fff',
      borderBottom: `1px solid ${C.border}`,
      display: 'flex', alignItems: 'center',
      padding: '0 32px', gap: 16,
      boxShadow: '0 1px 0 rgba(0,0,0,0.03)',
      flexShrink: 0,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif" }}>
          {title}
        </div>
        <div style={{ fontSize: 11, color: C.textLight, marginTop: 1 }}>
          {subtitle || today}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Notification bell */}
        <NotificationBell />

        {/* User info */}
        {employee && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{employee.full_name}</div>
              <div style={{ fontSize: 11, color: C.textLight }}>{employee.role}</div>
            </div>
            <Avatar
              initials={employee.avatar_initials || '??'}
              size={38}
              color={isHR ? C.accent : C.brand}
            />
          </div>
        )}
      </div>
    </header>
  )
}
