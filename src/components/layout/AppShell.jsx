import { C } from '../../lib/constants'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import BottomNav from './BottomNav'
import { useResponsive } from '../../lib/responsive'

export default function AppShell({ title, subtitle, children }) {
  const r = useResponsive()

  return (
    <div style={{
      display: 'flex', minHeight: '100vh',
      background: C.bg,
      fontFamily: "'DM Sans', sans-serif",
    }}>
      {/* Sidebar — desktop only */}
      {!r.isMobile && <Sidebar />}

      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        overflow: 'hidden', minWidth: 0,
        // On mobile, add bottom padding for the bottom nav
        paddingBottom: r.isMobile ? 64 : 0,
      }}>
        <TopBar title={title} subtitle={subtitle} />
        <main style={{
          flex: 1, overflowY: 'auto',
          padding: r.isMobile ? '16px' : '28px 32px',
        }}>
          {children}
        </main>
      </div>

      {/* Bottom nav — mobile only */}
      {r.isMobile && <BottomNav />}
    </div>
  )
}
