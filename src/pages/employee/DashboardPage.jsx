import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import { Card, SectionTitle, Avatar, Tag, Badge, Spinner, EmptyState } from '../../components/ui'
import { C, LEAVE_TYPES, FEMALE_ONLY_LEAVES, ATTENDANCE_STATUSES } from '../../lib/constants'
import { useAuth } from '../../context/AuthContext'
import { getMyLeaveBalances, getMyLeaveRequests, getAnnouncements, getAllEmployees } from '../../lib/api'
import OnboardingWizard from '../../components/OnboardingWizard'
import { useResponsive, cols } from '../../lib/responsive'
import { getTodayAttendance, getTeamAttendanceByDate, getHolidays, todayISO } from '../../lib/api.attendance'
import { getAllLeaveRequests } from '../../lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────
function getTimeOfDay() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function daysUntil(dateStr) {
  const diff = new Date(dateStr) - new Date(todayISO())
  return Math.ceil(diff / 86400000)
}

// ── Leave balance mini card ───────────────────────────────────────────────────
function BalanceCard({ lt, balance }) {
  const remaining = balance?.remaining ?? lt.total
  const total     = balance?.total_days ?? lt.total
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

// ── Attendance status badge ───────────────────────────────────────────────────
function AttendBadge({ status }) {
  const s = ATTENDANCE_STATUSES.find(a => a.value === status) || { icon: '❓', color: C.textLight, bg: C.surfaceAlt, label: 'Unknown' }
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20 }}>
      {s.icon} {s.label}
    </span>
  )
}

// ── EMPLOYEE DASHBOARD ────────────────────────────────────────────────────────
function EmployeeDashboard({ employee, balances, requests, announcements, todayAtt, holidays, setShowWizard }) {
  const navigate = useNavigate()
  const r = useResponsive()
  const pending  = requests.filter(r => r.status === 'pending').length
  const upcoming = holidays.filter(h => { const d = daysUntil(h.date); return d >= 0 && d <= 7 })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Top stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: r.isMobile ? 10 : 12 }}>
        {[
          { label: 'Employee ID',       val: employee?.employee_code || `SIL-???`, color: C.brand,  bg: C.brandLight },
          { label: 'Department',        val: employee?.department,                 color: C.teal,   bg: C.tealSoft   },
          { label: 'Pending Leaves',    val: pending,                             color: C.amber,  bg: C.amberSoft  },
          { label: "Today's Status",    val: todayAtt ? ATTENDANCE_STATUSES.find(a => a.value === todayAtt.status)?.label || 'Checked In' : 'Not Checked In',
            color: todayAtt ? C.green : C.accent, bg: todayAtt ? C.greenSoft : C.accentSoft },
        ].map(s => (
          <Card key={s.label} style={{ padding: '16px 20px', borderLeft: `3px solid ${s.color}` }}>
            <div style={{ fontSize: 10, color: C.textLight, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: s.color, fontFamily: "'Sora',sans-serif" }}>{s.val}</div>
          </Card>
        ))}
      </div>

      {/* Leave balances */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SectionTitle>Leave Balances</SectionTitle>
          <button onClick={() => navigate('/leaves')} style={{ fontSize: 11, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Manage →</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: cols(r, {mobile:2, tablet:3, desktop:5}), gap: 10 }}>
          {LEAVE_TYPES.filter(lt => !FEMALE_ONLY_LEAVES.includes(lt.id) || employee?.gender === 'female').map(lt => (
            <BalanceCard key={lt.id} lt={lt} balance={balances.find(b => b.leave_type === lt.id)} />
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 320px', gap: 20 }}>
        {/* Recent leave requests */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <SectionTitle>Recent Leave Requests</SectionTitle>
            <button onClick={() => navigate('/leaves')} style={{ fontSize: 11, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>View all →</button>
          </div>
          {requests.length === 0
            ? <EmptyState icon="🏖️" title="No leave requests yet" subtitle="Apply for your first leave!" />
            : (
              <Card padding="0">
                {requests.slice(0, 5).map((r, i) => {
                  const lt = LEAVE_TYPES.find(t => t.id === r.leave_type)
                  return (
                    <div key={r.id} style={{ padding: '13px 20px', borderBottom: i < 4 ? `1px solid ${C.border}` : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <Tag label={lt?.label || r.leave_type} color={lt?.color || C.brand} />
                          <span style={{ fontSize: 11, color: C.textLight }}>{r.from_date} → {r.to_date}</span>
                        </div>
                        <div style={{ fontSize: 11, color: C.textMid }}>{r.reason}</div>
                      </div>
                      <Badge status={r.status} />
                    </div>
                  )
                })}
              </Card>
            )
          }
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Upcoming holidays */}
          <div>
            <SectionTitle>Upcoming Holidays</SectionTitle>
            {upcoming.length === 0
              ? <Card style={{ padding: '16px 18px' }}><div style={{ fontSize: 12, color: C.textLight }}>No holidays in the next 7 days.</div></Card>
              : upcoming.map(h => (
                <Card key={h.id} style={{ padding: '12px 16px', marginBottom: 8, borderLeft: `3px solid ${C.teal}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{h.name}</div>
                  <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>
                    {new Date(h.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {' · '}
                    <span style={{ color: daysUntil(h.date) === 0 ? C.accent : C.teal, fontWeight: 600 }}>
                      {daysUntil(h.date) === 0 ? 'Today' : `In ${daysUntil(h.date)} day${daysUntil(h.date) > 1 ? 's' : ''}`}
                    </span>
                  </div>
                </Card>
              ))
            }
          </div>

          {/* Announcements */}
          <div>
            <SectionTitle>Announcements</SectionTitle>
            {announcements.length === 0
              ? <Card style={{ padding: '16px 18px' }}><div style={{ fontSize: 12, color: C.textLight }}>No announcements yet.</div></Card>
              : announcements.slice(0, 3).map(a => (
                <Card key={a.id} style={{ padding: '12px 16px', marginBottom: 8, borderLeft: `3px solid ${a.pinned ? C.accent : C.brand}` }}>
                  {a.pinned && <div style={{ fontSize: 9, color: C.accent, fontWeight: 700, letterSpacing: 1, marginBottom: 3 }}>📌 PINNED</div>}
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{a.title}</div>
                  <div style={{ fontSize: 11, color: C.textMid, marginTop: 2 }}>{a.body}</div>
                </Card>
              ))
            }
          </div>
        </div>
      </div>
    </div>
  )
}

// ── ADMIN/HR DASHBOARD ────────────────────────────────────────────────────────
function AdminDashboard({ employee, employees, teamAttendance, allLeaves, announcements, holidays, balances, myRequests }) {
  const navigate  = useNavigate()
  const r = useResponsive()
  const today     = new Date()
  const activeEmp = employees.filter(e => e.status === 'active')

  // Attendance breakdown
  const attMap    = Object.fromEntries(teamAttendance.map(r => [r.employee_id, r]))
  const present   = activeEmp.filter(e => ['present','wfh','late_mark'].includes(attMap[e.id]?.status)).length
  const onLeave   = activeEmp.filter(e => attMap[e.id]?.status === 'leave').length
  const absent    = activeEmp.filter(e => !attMap[e.id]).length
  const wfh       = activeEmp.filter(e => attMap[e.id]?.status === 'wfh').length

  // Leave requests
  const pendingLeaves = allLeaves.filter(l => l.status === 'pending')

  // Upcoming holidays (next 14 days)
  const upcomingHols = holidays.filter(h => { const d = daysUntil(h.date); return d >= 0 && d <= 14 })

  // Upcoming birthdays (next 30 days)
  const upcomingBdays = employees.filter(e => {
    if (!e.date_of_birth) return false
    const dob  = new Date(e.date_of_birth)
    const thisYear = new Date(today.getFullYear(), dob.getMonth(), dob.getDate())
    const diff = Math.ceil((thisYear - today) / 86400000)
    return diff >= 0 && diff <= 30
  }).sort((a, b) => {
    const dobA = new Date(a.date_of_birth), dobB = new Date(b.date_of_birth)
    const dA = new Date(today.getFullYear(), dobA.getMonth(), dobA.getDate())
    const dB = new Date(today.getFullYear(), dobB.getMonth(), dobB.getDate())
    return dA - dB
  })

  // Dept breakdown
  const deptCounts = activeEmp.reduce((acc, e) => {
    acc[e.department] = (acc[e.department] || 0) + 1
    return acc
  }, {})

  // Employment type breakdown
  const typeCounts = activeEmp.reduce((acc, e) => {
    acc[e.employee_type] = (acc[e.employee_type] || 0) + 1
    return acc
  }, {})

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── Row 1: Headcount stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: cols(r, {mobile:2, tablet:3, desktop:5}), gap: r.isMobile ? 10 : 12 }}>
        {[
          { label: 'Total Headcount', val: activeEmp.length,                      color: C.brand,  bg: C.brandLight },
          { label: 'Present Today',   val: present,                               color: C.green,  bg: C.greenSoft  },
          { label: 'Working Remotely',val: wfh,                                   color: '#0E7490',bg: '#ECFEFF'    },
          { label: 'On Leave',        val: onLeave,                               color: C.purple, bg: C.purpleSoft },
          { label: 'Pending Approvals',val: pendingLeaves.length,                 color: C.amber,  bg: C.amberSoft  },
        ].map(s => (
          <Card key={s.label} style={{ padding: '18px 20px', borderTop: `3px solid ${s.color}` }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color, fontFamily: "'Sora',sans-serif" }}>{s.val}</div>
            <div style={{ fontSize: 11, color: C.textMid, marginTop: 4 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {/* ── Row 2: Today's team attendance ── */}
      <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr', gap: 20 }}>
        {/* Today's attendance list */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <SectionTitle>Today's Attendance</SectionTitle>
            <button onClick={() => navigate('/hr/attendance')} style={{ fontSize: 11, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Full Report →</button>
          </div>
          <Card padding="0">
            {activeEmp.slice(0, 8).map((emp, i) => {
              const rec = attMap[emp.id]
              return (
                <div key={emp.id} style={{ padding: '11px 16px', borderBottom: i < Math.min(activeEmp.length, 8) - 1 ? `1px solid ${C.border}` : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar initials={emp.avatar_initials || '??'} size={30} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{emp.full_name}</div>
                    <div style={{ fontSize: 10, color: C.textLight }}>{emp.department}</div>
                  </div>
                  {rec?.check_in && (
                    <div style={{ fontSize: 10, color: C.textMid }}>
                      {new Date(rec.check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                    </div>
                  )}
                  <AttendBadge status={rec?.status || 'absent'} />
                </div>
              )
            })}
            {activeEmp.length > 8 && (
              <div style={{ padding: '10px 16px', fontSize: 11, color: C.textLight, textAlign: 'center' }}>
                +{activeEmp.length - 8} more employees
              </div>
            )}
          </Card>
        </div>

        {/* Pending leave approvals */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <SectionTitle>Pending Leave Approvals</SectionTitle>
            <button onClick={() => navigate('/hr')} style={{ fontSize: 11, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Review All →</button>
          </div>
          {pendingLeaves.length === 0
            ? <Card style={{ padding: '24px', textAlign: 'center' }}>
                <div style={{ fontSize: 20, marginBottom: 6 }}>✅</div>
                <div style={{ fontSize: 12, color: C.textLight }}>All leave requests reviewed</div>
              </Card>
            : (
              <Card padding="0">
                {pendingLeaves.slice(0, 5).map((l, i) => {
                  const emp = employees.find(e => e.id === l.employee_id) || l.employee || {}
                  const lt  = LEAVE_TYPES.find(t => t.id === l.leave_type)
                  return (
                    <div key={l.id} style={{ padding: '12px 16px', borderBottom: i < Math.min(pendingLeaves.length, 5) - 1 ? `1px solid ${C.border}` : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar initials={emp?.avatar_initials || '??'} size={30} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{emp?.full_name || 'Employee'}</div>
                        <div style={{ fontSize: 10, color: C.textMid }}>{lt?.label || l.leave_type} · {l.from_date} → {l.to_date}</div>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: C.amber, background: C.amberSoft, padding: '2px 8px', borderRadius: 20 }}>{l.days}d</span>
                    </div>
                  )
                })}
                {pendingLeaves.length > 5 && (
                  <div style={{ padding: '10px 16px', fontSize: 11, color: C.textLight, textAlign: 'center' }}>
                    +{pendingLeaves.length - 5} more pending
                  </div>
                )}
              </Card>
            )
          }
        </div>
      </div>

      {/* ── Row 3: Team breakdown, birthdays, holidays ── */}
      <div style={{ display: 'grid', gridTemplateColumns: cols(r, {mobile:1, tablet:2, desktop:3}), gap: 20 }}>

        {/* Department breakdown */}
        <div>
          <SectionTitle>Team by Department</SectionTitle>
          <Card style={{ padding: '16px 20px' }}>
            {Object.entries(deptCounts).sort((a,b) => b[1]-a[1]).map(([dept, count]) => (
              <div key={dept} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: C.text, fontWeight: 500 }}>{dept}</span>
                  <span style={{ fontWeight: 700, color: C.brand }}>{count}</span>
                </div>
                <div style={{ height: 4, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${(count / activeEmp.length) * 100}%`, height: '100%', background: C.brand, borderRadius: 4 }} />
                </div>
              </div>
            ))}
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {Object.entries(typeCounts).map(([type, count]) => (
                <div key={type} style={{ fontSize: 11, color: C.textMid }}>
                  <span style={{ fontWeight: 700, color: C.brand }}>{count}</span> {type}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Upcoming birthdays */}
        <div>
          <SectionTitle>Upcoming Birthdays 🎂</SectionTitle>
          {upcomingBdays.length === 0
            ? <Card style={{ padding: '24px', textAlign: 'center' }}><div style={{ fontSize: 12, color: C.textLight }}>No birthdays in the next 30 days.</div></Card>
            : (
              <Card padding="0">
                {upcomingBdays.slice(0, 5).map((emp, i) => {
                  const dob = new Date(emp.date_of_birth)
                  const thisYear = new Date(today.getFullYear(), dob.getMonth(), dob.getDate())
                  const daysLeft = Math.ceil((thisYear - today) / 86400000)
                  return (
                    <div key={emp.id} style={{ padding: '11px 16px', borderBottom: i < upcomingBdays.length - 1 ? `1px solid ${C.border}` : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar initials={emp.avatar_initials || '??'} size={30} color={'#DB2777'} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{emp.full_name}</div>
                        <div style={{ fontSize: 10, color: C.textLight }}>
                          {dob.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        color: daysLeft === 0 ? '#DB2777' : C.textMid,
                        background: daysLeft === 0 ? '#FCE7F3' : C.surfaceAlt,
                        padding: '2px 8px', borderRadius: 20,
                      }}>
                        {daysLeft === 0 ? '🎉 Today!' : `In ${daysLeft}d`}
                      </span>
                    </div>
                  )
                })}
              </Card>
            )
          }
        </div>

        {/* Upcoming holidays */}
        <div>
          <SectionTitle>Upcoming Holidays 🎉</SectionTitle>
          {upcomingHols.length === 0
            ? <Card style={{ padding: '24px', textAlign: 'center' }}><div style={{ fontSize: 12, color: C.textLight }}>No holidays in the next 14 days.</div></Card>
            : (
              <Card padding="0">
                {upcomingHols.map((h, i) => {
                  const d = daysUntil(h.date)
                  return (
                    <div key={h.id} style={{ padding: '11px 16px', borderBottom: i < upcomingHols.length - 1 ? `1px solid ${C.border}` : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ fontSize: 20 }}>🎉</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{h.name}</div>
                        <div style={{ fontSize: 10, color: C.textLight }}>
                          {new Date(h.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                          {' · '}
                          <span style={{ textTransform: 'capitalize' }}>{h.type}</span>
                        </div>
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        color: d === 0 ? C.accent : C.teal,
                        background: d === 0 ? C.accentSoft : C.tealSoft,
                        padding: '2px 8px', borderRadius: 20,
                      }}>
                        {d === 0 ? 'Today' : `In ${d}d`}
                      </span>
                    </div>
                  )
                })}
              </Card>
            )
          }
        </div>
      </div>

      {/* ── Row 4: Announcements + my own leave summary ── */}
      <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr', gap: 20 }}>
        <div>
          <SectionTitle>Announcements</SectionTitle>
          {announcements.length === 0
            ? <Card style={{ padding: '20px' }}><div style={{ fontSize: 12, color: C.textLight }}>No announcements yet.</div></Card>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {announcements.slice(0, 3).map(a => (
                  <Card key={a.id} style={{ padding: '14px 18px', borderLeft: `3px solid ${a.pinned ? C.accent : C.brand}` }}>
                    {a.pinned && <div style={{ fontSize: 9, color: C.accent, fontWeight: 700, letterSpacing: 1, marginBottom: 3 }}>📌 PINNED</div>}
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 3 }}>{a.title}</div>
                    <div style={{ fontSize: 12, color: C.textMid }}>{a.body}</div>
                  </Card>
                ))}
              </div>
            )
          }
        </div>
        <div>
          <SectionTitle>My Leave Balances</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {LEAVE_TYPES.filter(lt => !FEMALE_ONLY_LEAVES.includes(lt.id) || employee?.gender === 'female').slice(0, 4).map(lt => (
              <BalanceCard key={lt.id} lt={lt} balance={balances.find(b => b.leave_type === lt.id)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { employee, isHR } = useAuth()
  const [balances,       setBalances]       = useState([])
  const [myRequests,     setMyRequests]     = useState([])
  const [announcements,  setAnnouncements]  = useState([])
  const [todayAtt,       setTodayAtt]       = useState(null)
  const [employees,      setEmployees]      = useState([])
  const [teamAttendance, setTeamAttendance] = useState([])
  const [allLeaves,      setAllLeaves]      = useState([])
  const [holidays,       setHolidays]       = useState([])
  const [loading,        setLoading]        = useState(true)
  const [showWizard,     setShowWizard]     = useState(false)

  useEffect(() => {
    if (!employee) return
    const year = new Date().getFullYear()

    const baseLoads = [
      getMyLeaveBalances(employee.id),
      getMyLeaveRequests(employee.id),
      getAnnouncements(),
      getTodayAttendance(employee.id),
      getHolidays(year),
    ]

    const adminLoads = isHR ? [
      getAllEmployees(),
      getTeamAttendanceByDate(todayISO()),
      getAllLeaveRequests(),
    ] : [
      Promise.resolve([]),
      Promise.resolve([]),
      Promise.resolve([]),
    ]

    // Show onboarding wizard for new employees
    if (!employee.onboarding_completed) {
      setTimeout(() => setShowWizard(true), 800)
    }

    Promise.all([...baseLoads, ...adminLoads])
      .then(([b, r, a, att, hols, emps, teamAtt, leaves]) => {
        setBalances(b); setMyRequests(r); setAnnouncements(a)
        setTodayAtt(att); setHolidays(hols)
        if (isHR) { setEmployees(emps); setTeamAttendance(teamAtt); setAllLeaves(leaves) }
      })
      .finally(() => setLoading(false))
  }, [employee, isHR])

  if (loading) return (
    <AppShell title="Dashboard">
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><Spinner size={36} /></div>
    </AppShell>
  )

  return (
    <AppShell title={`Good ${getTimeOfDay()}, ${employee?.full_name?.split(' ')[0]} 👋`}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap'); @keyframes spin { to { transform: rotate(360deg); } }`}</style>
      {/* Onboarding wizard */}
      {showWizard && (
        <OnboardingWizard onComplete={() => setShowWizard(false)} />
      )}

      {isHR
        ? <AdminDashboard
            employee={employee}
            employees={employees}
            teamAttendance={teamAttendance}
            allLeaves={allLeaves}
            announcements={announcements}
            holidays={holidays}
            balances={balances}
            myRequests={myRequests}
          />
        : <EmployeeDashboard
            employee={employee}
            balances={balances}
            requests={myRequests}
            announcements={announcements}
            todayAtt={todayAtt}
            holidays={holidays}
            setShowWizard={setShowWizard}
          />
      }
    </AppShell>
  )
}
