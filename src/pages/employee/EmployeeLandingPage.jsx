import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import { Card, SectionTitle, Avatar, Tag, Badge, Spinner, EmptyState } from '../../components/ui'
import { C, LEAVE_TYPES, FEMALE_ONLY_LEAVES, ATTENDANCE_STATUSES } from '../../lib/constants'
import { useAuth } from '../../context/AuthContext'
import { useResponsive, cols } from '../../lib/responsive'
import { getMyLeaveBalances, getMyLeaveRequests, getAnnouncements, getUpcomingApprovedLeaves } from '../../lib/api'
import { getTodayAttendance, getHolidays, todayISO, getWeeklyHours, getWeekStart } from '../../lib/api.attendance'
import { getMyUnregularizedSessions, getMyExpiringCertifications } from '../../lib/api.dashboard'

// ── Helpers ───────────────────────────────────────────────────────────────────
function getTimeOfDay() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function daysUntil(dateStr) {
  return Math.ceil((new Date(dateStr) - new Date(todayISO())) / 86400000)
}

// ── Smart prompt builder ──────────────────────────────────────────────────────
function buildSmartPrompts({ unregularized, myRequests, expiringCerts, employee, holidays }) {
  const prompts  = []
  const today    = new Date(todayISO())

  unregularized.slice(0, 3).forEach(s => {
    const dateStr = s.check_in.split('T')[0]
    prompts.push({
      key:       `unreg-${s.id}`,
      dot:       C.accent,
      message:   `Regularize your attendance for ${new Date(dateStr).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}`,
      link:      '/attendance',
      linkLabel: 'Regularize →',
    })
  })

  const pendingLeaves = myRequests.filter(r => r.status === 'pending')
  if (pendingLeaves.length > 0) {
    const lt = LEAVE_TYPES.find(t => t.id === pendingLeaves[0].leave_type)
    prompts.push({
      key:       'pending-leave',
      dot:       C.amber,
      message:   `Your ${lt?.label || 'leave'} request is awaiting approval`,
      link:      '/leaves',
      linkLabel: 'View →',
    })
  }

  expiringCerts.forEach(c => {
    const d = Math.ceil((new Date(c.expiry_date) - today) / 86400000)
    prompts.push({
      key:       `cert-${c.id}`,
      dot:       d <= 7 ? C.accent : C.amber,
      message:   `Your ${c.title} expires in ${d} day${d !== 1 ? 's' : ''}`,
      link:      '/profile',
      linkLabel: 'View →',
    })
  })

  if (employee?.employee_type && ['intern', 'probation'].includes(employee.employee_type) && employee.join_date) {
    const end = new Date(employee.join_date)
    end.setMonth(end.getMonth() + 6)
    const d = Math.ceil((end - today) / 86400000)
    if (d >= 0 && d <= 14) {
      prompts.push({
        key:       'probation-end',
        dot:       d <= 3 ? C.accent : C.amber,
        message:   `Your ${employee.employee_type === 'intern' ? 'internship' : 'probation'} period ends in ${d} day${d !== 1 ? 's' : ''}`,
        link:      null,
        linkLabel: null,
      })
    }
  }

  holidays.filter(h => { const d = daysUntil(h.date); return d >= 0 && d <= 7 }).forEach(h => {
    const d = daysUntil(h.date)
    prompts.push({
      key:       `holiday-${h.id}`,
      dot:       C.teal,
      message:   `${h.name} is ${d === 0 ? 'today' : `in ${d} day${d !== 1 ? 's' : ''}`} — ${new Date(h.date).toLocaleDateString('en-IN', { weekday: 'long' })}`,
      link:      null,
      linkLabel: null,
    })
  })

  return prompts
}

// ── Leave balance card ────────────────────────────────────────────────────────
function BalanceCard({ lt, balance }) {
  const total     = Number(balance?.total_days ?? lt.total ?? 0)
  const used      = Number(balance?.used_days  ?? 0)
  const remaining = Math.max(0, total - used)
  const pct       = total > 0 ? (remaining / total) * 100 : 0
  return (
    <Card style={{ padding: '16px 18px' }}>
      <div style={{ fontSize: 10, color: C.textLight, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>{lt.label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: lt.color, lineHeight: 1, fontFamily: "'Sora',sans-serif" }}>{remaining}</span>
        <span style={{ fontSize: 12, color: C.textLight, marginBottom: 2 }}>/ {total}</span>
      </div>
      <div style={{ height: 3, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: lt.color, borderRadius: 4 }} />
      </div>
      <div style={{ fontSize: 10, color: C.textLight, marginTop: 5 }}>{total - remaining} used</div>
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function EmployeeLandingPage() {
  const { employee }  = useAuth()
  const navigate      = useNavigate()
  const r             = useResponsive()
  const year          = new Date().getFullYear()

  const [balances,       setBalances]       = useState([])
  const [myRequests,     setMyRequests]     = useState([])
  const [announcements,  setAnnouncements]  = useState([])
  const [todayAtt,       setTodayAtt]       = useState(null)
  const [weekly,         setWeekly]         = useState(null)
  const [holidays,       setHolidays]       = useState([])
  const [upcomingLeaves, setUpcomingLeaves] = useState([])
  const [unregularized,  setUnregularized]  = useState([])
  const [expiringCerts,  setExpiringCerts]  = useState([])
  const [loading,        setLoading]        = useState(true)
  const [loadError,      setLoadError]      = useState(null)

  useEffect(() => {
    if (!employee) return
    Promise.all([
      getMyLeaveBalances(employee.id),
      getMyLeaveRequests(employee.id),
      getAnnouncements(),
      getTodayAttendance(employee.id),
      getHolidays(year),
      getWeeklyHours(employee.id, getWeekStart(todayISO())),
      getUpcomingApprovedLeaves(),
      getMyUnregularizedSessions(employee.id),
      getMyExpiringCertifications(employee.id),
    ]).then(([bal, req, ann, att, hols, wk, upcoming, unreg, certs]) => {
      setBalances(bal)
      setMyRequests(req)
      setAnnouncements(ann)
      setTodayAtt(att)
      setHolidays(hols)
      setWeekly(wk)
      setUpcomingLeaves(upcoming)
      setUnregularized(unreg)
      setExpiringCerts(certs)
    }).catch(err => {
      console.error('Employee dashboard load failed:', err)
      setLoadError(err.message || 'Failed to load dashboard data.')
    }).finally(() => setLoading(false))
  }, [employee])

  if (loading) return (
    <AppShell title="Dashboard">
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><Spinner size={36} /></div>
    </AppShell>
  )

  if (loadError) return (
    <AppShell title={`Good ${getTimeOfDay()}, ${employee?.full_name?.split(' ')[0]} 👋`}>
      <Card style={{ padding: '24px', borderLeft: `4px solid ${C.accent}`, marginTop: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.accent, marginBottom: 4 }}>Failed to load dashboard</div>
        <div style={{ fontSize: 12, color: C.textMid }}>{loadError}</div>
      </Card>
    </AppShell>
  )

  const attStatus   = todayAtt ? ATTENDANCE_STATUSES.find(a => a.value === todayAtt.status) : null
  const earnedBal   = balances.find(b => b.leave_type === 'earned')
  const earnedTotal = Number(earnedBal?.total_days ?? 18)
  const earnedUsed  = Number(earnedBal?.used_days  ?? 0)
  const earnedLeft  = Math.max(0, earnedTotal - earnedUsed)
  const pendingCount = myRequests.filter(r => r.status === 'pending').length

  const prompts = buildSmartPrompts({ unregularized, myRequests, expiringCerts, employee, holidays })

  const pinnedAnn = [...announcements].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).slice(0, 3)
  const upcomingHols = holidays.filter(h => { const d = daysUntil(h.date); return d >= 0 && d <= 7 })

  return (
    <AppShell title={`Good ${getTimeOfDay()}, ${employee?.full_name?.split(' ')[0]} 👋`}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap');`}</style>

      {/* ── Layer 1: Personal Pulse ── */}
      <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: r.isMobile ? 10 : 12, marginBottom: 24 }}>
        {[
          {
            label: "Today's Status",
            val:   attStatus ? `${attStatus.icon} ${attStatus.label}` : 'Not checked in',
            sub:   todayAtt?.check_in ? new Date(todayAtt.check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : null,
            color: attStatus ? C.green : C.accent,
            bg:    attStatus ? C.greenSoft : C.accentSoft,
          },
          {
            label: 'Earned Leave Left',
            val:   String(earnedLeft),
            sub:   `${earnedUsed} used of ${earnedTotal}`,
            color: C.brand,
            bg:    C.brandLight,
          },
          {
            label: 'This Week',
            val:   weekly ? `${weekly.totalHours}h` : '—',
            sub:   weekly ? `of ${weekly.targetHours}h target` : null,
            color: C.teal,
            bg:    C.tealSoft,
          },
          {
            label: 'Pending',
            val:   String(pendingCount),
            sub:   pendingCount === 0 ? 'All clear' : `request${pendingCount > 1 ? 's' : ''} awaiting`,
            color: pendingCount > 0 ? C.amber : C.green,
            bg:    pendingCount > 0 ? C.amberSoft : C.greenSoft,
          },
        ].map(s => (
          <Card key={s.label} style={{ padding: '16px 20px', borderLeft: `3px solid ${s.color}` }}>
            <div style={{ fontSize: 10, color: C.textLight, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: "'Sora',sans-serif", marginBottom: 2 }}>{s.val}</div>
            {s.sub && <div style={{ fontSize: 10, color: C.textLight }}>{s.sub}</div>}
          </Card>
        ))}
      </div>

      {/* Weekly hours progress bar */}
      {weekly && (
        <Card style={{ padding: '14px 18px', marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>This Week</span>
            <span style={{ fontSize: 11, color: C.textMid }}>{weekly.totalHours} / {weekly.targetHours} hrs</span>
          </div>
          <div style={{ height: 5, borderRadius: 6, background: C.border, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(100, Math.round((weekly.totalHours / weekly.targetHours) * 100))}%`, background: C.brand, borderRadius: 6, transition: 'width 0.3s' }} />
          </div>
        </Card>
      )}

      {/* ── Layer 2: Smart Prompts ── */}
      <div style={{ marginBottom: 28 }}>
        <SectionTitle>Your Actions</SectionTitle>
        {prompts.length === 0 ? (
          <Card style={{ padding: '16px 20px', marginTop: 10, borderLeft: `3px solid ${C.green}`, background: C.greenSoft }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.green }}>✅ Nothing needs your attention today.</div>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {prompts.map(p => (
              <Card key={p.key} style={{ padding: '12px 16px', borderLeft: `3px solid ${p.dot}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.dot, flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 13, color: C.text }}>{p.message}</div>
                  {p.link && (
                    <button onClick={() => navigate(p.link)} style={{ fontSize: 12, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>{p.linkLabel}</button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ── Layer 3: Supporting Info ── */}
      <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 320px', gap: 20 }}>
        {/* Leave balances */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <SectionTitle>Leave Balances</SectionTitle>
            <button onClick={() => navigate('/leaves')} style={{ fontSize: 11, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Manage →</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: cols(r, { mobile: 2, tablet: 3, desktop: 4 }), gap: 10, marginBottom: 20 }}>
            {LEAVE_TYPES.filter(lt => !FEMALE_ONLY_LEAVES.includes(lt.id) || employee?.gender === 'female').map(lt => (
              <BalanceCard key={lt.id} lt={lt} balance={balances.find(b => b.leave_type === lt.id)} />
            ))}
          </div>

          {/* Recent leave requests */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <SectionTitle>Recent Leave Requests</SectionTitle>
            <button onClick={() => navigate('/leaves')} style={{ fontSize: 11, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>View all →</button>
          </div>
          {myRequests.length === 0 ? (
            <EmptyState icon="🏖️" title="No leave requests yet" subtitle="Apply for your first leave!" />
          ) : (
            <Card padding="0">
              {myRequests.slice(0, 5).map((req, i) => {
                const lt = LEAVE_TYPES.find(t => t.id === req.leave_type)
                return (
                  <div key={req.id} style={{ padding: '12px 16px', borderBottom: i < Math.min(myRequests.length, 5) - 1 ? `1px solid ${C.border}` : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <Tag label={lt?.label || req.leave_type} color={lt?.color || C.brand} />
                        <span style={{ fontSize: 11, color: C.textLight }}>{req.from_date} → {req.to_date}</span>
                      </div>
                      <div style={{ fontSize: 11, color: C.textMid }}>{req.reason}</div>
                    </div>
                    <Badge status={req.status} />
                  </div>
                )
              })}
            </Card>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Upcoming holidays */}
          <div>
            <SectionTitle>Upcoming Holidays</SectionTitle>
            {upcomingHols.length === 0 ? (
              <Card style={{ padding: '14px 16px', marginTop: 8 }}><div style={{ fontSize: 12, color: C.textLight }}>No holidays in the next 7 days.</div></Card>
            ) : (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {upcomingHols.map(h => {
                  const d = daysUntil(h.date)
                  return (
                    <Card key={h.id} style={{ padding: '10px 14px', borderLeft: `3px solid ${C.teal}` }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{h.name}</div>
                      <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>
                        {new Date(h.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                        {' · '}
                        <span style={{ color: d === 0 ? C.accent : C.teal, fontWeight: 600 }}>
                          {d === 0 ? 'Today' : `In ${d} day${d !== 1 ? 's' : ''}`}
                        </span>
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>

          {/* Announcements */}
          <div>
            <SectionTitle>Announcements</SectionTitle>
            {pinnedAnn.length === 0 ? (
              <Card style={{ padding: '14px 16px', marginTop: 8 }}><div style={{ fontSize: 12, color: C.textLight }}>No announcements yet.</div></Card>
            ) : (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pinnedAnn.map(a => (
                  <Card key={a.id} style={{ padding: '10px 14px', borderLeft: `3px solid ${a.pinned ? C.accent : C.brand}` }}>
                    {a.pinned && <div style={{ fontSize: 9, color: C.accent, fontWeight: 700, letterSpacing: 1, marginBottom: 2 }}>📌 PINNED</div>}
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{a.title}</div>
                    <div style={{ fontSize: 11, color: C.textMid, marginTop: 2 }}>{a.body}</div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming team leave */}
          {upcomingLeaves.length > 0 && (
            <div>
              <SectionTitle>Team on Leave</SectionTitle>
              <Card style={{ padding: '14px 16px', marginTop: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {upcomingLeaves.slice(0, 5).map(l => (
                    <div key={`${l.employee_id}-${l.from_date}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar initials={l.avatar_initials || '??'} size={26} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{l.full_name}</div>
                        <div style={{ fontSize: 10, color: C.textLight }}>{l.from_date}{l.from_date !== l.to_date ? ` – ${l.to_date}` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
