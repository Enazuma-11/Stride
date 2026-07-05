import { C, FONTS } from '../../lib/constants'
import { useAuth } from '../../context/AuthContext'
import NotificationBell from './NotificationBell'
import { useResponsive } from '../../lib/responsive'

export default function TopBar({ title, subtitle }) {
  const { employee, isHR } = useAuth()
  const r = useResponsive()
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <header style={{
      height: r.isMobile ? 56 : 60,
      background: r.isMobile ? C.sidebar : C.surface,
      borderBottom: r.isMobile ? 'none' : `1px solid ${C.border}`,
      display: 'flex', alignItems: 'center',
      padding: r.isMobile ? '0 16px' : '0 28px',
      gap: 12, flexShrink: 0,
      boxShadow: r.isMobile ? 'none' : '0 2px 8px rgba(26,26,46,0.04)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: r.isMobile ? 15 : 17, fontWeight: 700, color: r.isMobile ? '#fff' : C.text, fontFamily: FONTS.display, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </div>
        {!r.isMobile && <div style={{ fontSize: 11, color: C.textLight, marginTop: 1, fontFamily: FONTS.body }}>{subtitle || today}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: r.isMobile ? 8 : 12 }}>
        <NotificationBell mobile={r.isMobile} />
        {employee && !r.isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, fontFamily: FONTS.display }}>{employee.full_name}</div>
              <div style={{ fontSize: 11, color: C.textLight, fontFamily: FONTS.body }}>{employee.role}</div>
            </div>
            {employee.profile_photo_url
              ? <img src={employee.profile_photo_url} alt={employee.full_name} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid ' + C.border }} onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='flex' }} />
              : null}
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: C.gradientH, display: employee.profile_photo_url ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.text, fontFamily: FONTS.display, flexShrink: 0 }}>
              {employee.avatar_initials || '??'}
            </div>
          </div>
        )}
        {employee && r.isMobile && (
          employee.profile_photo_url
              ? <img src={employee.profile_photo_url} alt={employee.full_name} style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.3)' }} />
              : <div style={{ width: 30, height: 30, borderRadius: '50%', background: C.gradientH, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>
                  {employee.avatar_initials || '??'}
                </div>
        )}
      </div>
    </header>
  )
}
