import { C, FONTS } from '../../lib/constants'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import BottomNav from './BottomNav'
import { useResponsive } from '../../lib/responsive'

export default function AppShell({ title, subtitle, children }) {
  const r = useResponsive()
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.bg, fontFamily: FONTS.body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes fadeUp  { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes slideUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeIn  { from { opacity:0; } to { opacity:1; } }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 4px; }
      `}</style>
      {!r.isMobile && <Sidebar />}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, paddingBottom: r.isMobile ? 64 : 0 }}>
        <TopBar title={title} subtitle={subtitle} />
        <main style={{ flex: 1, overflowY: 'auto', padding: r.isMobile ? '16px' : '24px 28px' }}>
          {children}
        </main>
      </div>
      {r.isMobile && <BottomNav />}
    </div>
  )
}
