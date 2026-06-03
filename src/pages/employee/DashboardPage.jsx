import { useEffect, useState } from 'react'
import AppShell from '../../components/layout/AppShell'
import { Card, SectionTitle, Avatar, Tag, Badge, Spinner, EmptyState } from '../../components/ui'
import { C, LEAVE_TYPES, FEMALE_ONLY_LEAVES } from '../../lib/constants'
import { useAuth } from '../../context/AuthContext'
import { getMyLeaveBalances, getMyLeaveRequests, getAnnouncements } from '../../lib/api'
import { useNavigate } from 'react-router-dom'

function BalanceCard({ lt, balance }) {
  const remaining = balance?.remaining ?? lt.total
  const total = balance?.total_days ?? lt.total
  const pct = (remaining / total) * 100

  return (
    <Card style={{ padding: '20px' }}>
      <div style={{ fontSize: 11, color: C.textLight, fontWeight: 600, marginBottom: 10 }}>{lt.label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 10 }}>
        <span style={{ fontSize: 32, fontWeight: 800, color: lt.color, lineHeight: 1, fontFamily: "'Sora', sans-serif" }}>
          {remaining}
        </span>
        <span style={{ fontSize: 13, color: C.textLight, marginBottom: 3 }}>/ {total}</span>
      </div>
      <div style={{ height: 4, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: lt.color, borderRadius: 4, transition: 'width 0.5s' }} />
      </div>
      <div style={{ fontSize: 11, color: C.textLight, marginTop: 6 }}>{total - remaining} used</div>
    </Card>
  )
}

function RecentRequests({ requests }) {
  if (!requests.length) return <EmptyState icon="🏖️" title="No leave requests yet" subtitle="Apply for your first leave!" />
  return (
    <Card padding="0">
      {requests.slice(0, 5).map((r, i) => {
        const lt = LEAVE_TYPES.find(t => t.id === r.leave_type)
        return (
          <div key={r.id} style={{
            padding: '14px 20px',
            borderBottom: i < Math.min(requests.length, 5) - 1 ? `1px solid ${C.border}` : 'none',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <Tag label={lt?.label || r.leave_type} color={lt?.color || C.brand} />
                <span style={{ fontSize: 11, color: C.textLight }}>{r.from_date} → {r.to_date}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: C.brand }}>{r.days}d</span>
              </div>
              <div style={{ fontSize: 12, color: C.textMid }}>{r.reason}</div>
            </div>
            <Badge status={r.status} />
          </div>
        )
      })}
    </Card>
  )
}

export default function DashboardPage() {
  const { employee } = useAuth()
  const navigate = useNavigate()
  const [balances,   setBalances]   = useState([])
  const [requests,   setRequests]   = useState([])
  const [announcements, setAnnouncements] = useState([])
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    if (!employee) return
    Promise.all([
      getMyLeaveBalances(employee.id),
      getMyLeaveRequests(employee.id),
      getAnnouncements(),
    ]).then(([b, r, a]) => {
      setBalances(b); setRequests(r); setAnnouncements(a)
    }).finally(() => setLoading(false))
  }, [employee])

  if (loading) return (
    <AppShell title="Dashboard">
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><Spinner size={36} /></div>
    </AppShell>
  )

  const pending = requests.filter(r => r.status === 'pending').length

  return (
    <AppShell title={`Good ${getTimeOfDay()}, ${employee?.full_name?.split(' ')[0]} 👋`}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap'); @keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Quick stat chips */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
        {[
          { label: 'Pending Requests', val: pending, color: C.amber, bg: C.amberSoft },
          { label: 'Dept', val: employee?.department, color: C.brand, bg: C.brandLight },
          { label: 'Employee ID', val: `#${employee?.id?.toString().slice(0,6) || '—'}`, color: C.green, bg: C.greenSoft },
        ].map(s => (
          <div key={s.label} style={{
            padding: '10px 20px', borderRadius: 8,
            background: s.bg, border: `1px solid ${s.color}20`,
            fontSize: 13,
          }}>
            <span style={{ color: C.textLight, marginRight: 6 }}>{s.label}:</span>
            <span style={{ fontWeight: 700, color: s.color }}>{s.val}</span>
          </div>
        ))}
      </div>

      {/* Leave balances */}
      <SectionTitle>Leave Balances</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
        {LEAVE_TYPES.filter(lt => !FEMALE_ONLY_LEAVES.includes(lt.id) || employee?.gender === 'female').map(lt => (
          <BalanceCard key={lt.id} lt={lt} balance={balances.find(b => b.leave_type === lt.id)} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
        {/* Recent leave requests */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <SectionTitle>Recent Leave Requests</SectionTitle>
            <button onClick={() => navigate('/leaves')} style={{
              fontSize: 12, color: C.brand, background: 'none', border: 'none',
              cursor: 'pointer', fontWeight: 600,
            }}>View all →</button>
          </div>
          <RecentRequests requests={requests} />
        </div>

        {/* Announcements */}
        <div>
          <SectionTitle>Announcements</SectionTitle>
          {announcements.length === 0
            ? <EmptyState icon="📣" title="No announcements" />
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {announcements.slice(0, 4).map(a => (
                  <Card key={a.id} style={{ padding: '14px 18px', borderLeft: `3px solid ${a.pinned ? C.accent : C.brand}` }}>
                    {a.pinned && <div style={{ fontSize: 10, color: C.accent, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>📌 PINNED</div>}
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>{a.title}</div>
                    <div style={{ fontSize: 12, color: C.textMid }}>{a.body}</div>
                    <div style={{ fontSize: 10, color: C.textLight, marginTop: 6 }}>
                      {new Date(a.created_at).toLocaleDateString('en-IN')}
                    </div>
                  </Card>
                ))}
              </div>
            )
          }
        </div>
      </div>
    </AppShell>
  )
}

function getTimeOfDay() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
