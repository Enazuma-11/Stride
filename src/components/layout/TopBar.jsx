import { C } from '../../lib/constants'
import { Avatar } from '../ui'
import { useAuth } from '../../context/AuthContext'
import NotificationBell from './NotificationBell'
import { useEffect } from 'react'
import { runDailyChecks } from '../../lib/api.notifications'
import { useResponsive } from '../../lib/responsive'

export default function TopBar({ title, subtitle }) {
  const { employee, isHR } = useAuth()
  const r = useResponsive()

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const todayShort = new Date().toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

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
      height: r.isMobile ? 56 : 64,
      background: r.isMobile ? C.brand : '#fff',
      borderBottom: `1px solid ${r.isMobile ? 'transparent' : C.border}`,
      display: 'flex', alignItems: 'center',
      padding: r.isMobile ? '0 16px' : '0 32px',
      gap: 12,
      boxShadow: r.isMobile ? '0 2px 8px rgba(29,53,87,0.15)' : '0 1px 0 rgba(0,0,0,0.03)',
      flexShrink: 0,
    }}>
      {/* Title */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: r.isMobile ? 15 : 16,
          fontWeight: 700,
          color: r.isMobile ? '#fff' : C.text,
          fontFamily: "'Sora',sans-serif",
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {title}
        </div>
        {!r.isMobile && (
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 1 }}>
            {subtitle || today}
          </div>
        )}
        {r.isMobile && subtitle && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
            {subtitle}
          </div>
        )}
      </div>

      {/* Right side */}
      <div style={{ display: 'flex', alignItems: 'center', gap: r.isMobile ? 8 : 12 }}>
        {/* Notification bell — adapted for mobile */}
        <div style={{ position: 'relative' }}>
          <NotificationBell mobile={r.isMobile} />
        </div>

        {/* User avatar — mobile shows only avatar, desktop shows name + avatar */}
        {employee && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {!r.isMobile && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{employee.full_name}</div>
                <div style={{ fontSize: 11, color: C.textLight }}>{employee.role}</div>
              </div>
            )}
            <Avatar
              initials={employee.avatar_initials || '??'}
              size={r.isMobile ? 32 : 38}
              color={isHR ? C.accent : (r.isMobile ? 'rgba(255,255,255,0.2)' : C.brand)}
            />
          </div>
        )}
      </div>
    </header>
  )
}
