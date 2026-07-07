import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import { Card, Avatar, Button, Spinner, SectionTitle } from '../../components/ui'
import { C, LEAVE_TYPES, ATTENDANCE_STATUSES } from '../../lib/constants'
import { useResponsive, cols } from '../../lib/responsive'
import { useAuth } from '../../context/AuthContext'
import { getAllLeaveRequests, updateLeaveStatus, getAnnouncements } from '../../lib/api'
import { notifyLeaveDecision } from '../../lib/api.notifications'
import { todayISO, getTeamAttendanceByDate, getHolidays } from '../../lib/api.attendance'
import {
  getPendingRegularizationsForHR,
  getPendingTransfersForHR,
  getExpiringCertificationsForHR,
  getProbationEndingSoon,
  getEmployeesForHRDashboard,
} from '../../lib/api.dashboard'

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysUntil(dateStr) {
  return Math.ceil((new Date(dateStr) - new Date(todayISO())) / 86400000)
}

function daysSince(isoTimestamp) {
  return Math.floor((Date.now() - new Date(isoTimestamp)) / 86400000)
}

// ── Action item builder ───────────────────────────────────────────────────────
function buildActionItems(leaves, regs, transfers, certs, probation) {
  const items = []

  leaves.filter(l => l.status === 'pending').forEach(l => {
    const age  = daysSince(l.created_at)
    const lt   = LEAVE_TYPES.find(t => t.id === l.leave_type)
    items.push({
      key:         `leave-${l.id}`,
      category:    'Leave',
      employeeName: l.employee?.full_name || 'Unknown',
      description: `${lt?.label || l.leave_type} · ${l.from_date} → ${l.to_date} · ${l.days}d`,
      age:         `Pending ${age}d`,
      urgency:     Math.max(0, 10 - age),
      borderColor: age >= 5 ? C.accent : age >= 3 ? C.amber : C.brand,
      canApprove:  true,
      leaveId:     l.id,
      link:        null,
      actionLabel: null,
    })
  })

  regs.forEach(r => {
    const age = daysSince(r.created_at)
    items.push({
      key:         `reg-${r.id}`,
      category:    'Regularization',
      employeeName: r.full_name,
      description: 'Attendance regularization pending',
      age:         `Pending ${age}d`,
      urgency:     Math.max(0, 10 - age),
      borderColor: age >= 5 ? C.accent : age >= 3 ? C.amber : C.brand,
      canApprove:  false,
      link:        '/hr/attendance',
      actionLabel: 'Review →',
    })
  })

  transfers.forEach(t => {
    const age = daysSince(t.created_at)
    items.push({
      key:         `transfer-${t.id}`,
      category:    'Transfer',
      employeeName: t.full_name,
      description: `Transfer → ${t.to_manager_name}`,
      age:         `Pending ${age}d`,
      urgency:     Math.max(0, 10 - age),
      borderColor: age >= 5 ? C.accent : age >= 3 ? C.amber : C.brand,
      canApprove:  false,
      link:        '/hr/employees',
      actionLabel: 'Review →',
    })
  })

  certs.forEach(c => {
    const d = daysUntil(c.expiry_date)
    items.push({
      key:         `cert-${c.id}`,
      category:    'Certification',
      employeeName: c.full_name,
      description: `${c.title} expires`,
      age:         `In ${d}d`,
      urgency:     d,
      borderColor: d <= 7 ? C.accent : d <= 14 ? C.amber : C.brand,
      canApprove:  false,
      link:        '/hr/employees',
      actionLabel: 'View →',
    })
  })

  probation.forEach(e => {
    items.push({
      key:         `probation-${e.id}`,
      category:    'Probation',
      employeeName: e.full_name,
      description: `${e.employee_type === 'intern' ? 'Internship' : 'Probation'} ends ${e.end_date}`,
      age:         `In ${e.days_left}d`,
      urgency:     e.days_left,
      borderColor: e.days_left <= 3 ? C.accent : e.days_left <= 7 ? C.amber : C.brand,
      canApprove:  false,
      link:        '/hr/employees',
      actionLabel: 'View →',
    })
  })

  return items.sort((a, b) => a.urgency - b.urgency)
}

// ── Attendance badge ──────────────────────────────────────────────────────────
function AttendBadge({ status }) {
  const s = ATTENDANCE_STATUSES.find(a => a.value === status) || { icon: '❓', color: C.textLight, bg: C.surfaceAlt, label: 'Unknown' }
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      {s.icon} {s.label}
    </span>
  )
}

// ── Single action feed row ────────────────────────────────────────────────────
function ActionRow({ item, onLeaveAction, onNavigate }) {
  return (
    <Card style={{ padding: '14px 18px', borderLeft: `4px solid ${item.borderColor}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
              color: item.borderColor, background: item.borderColor + '18',
              padding: '2px 8px', borderRadius: 12,
            }}>{item.category}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{item.employeeName}</span>
          </div>
          <div style={{ fontSize: 12, color: C.textMid }}>{item.description}</div>
        </div>
        <div style={{ fontSize: 11, color: C.textLight, whiteSpace: 'nowrap' }}>{item.age}</div>
        {item.canApprove ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <Button variant="success" size="sm" onClick={() => onLeaveAction(item.leaveId, 'approved')}>✓ Approve</Button>
            <Button variant="ghost"   size="sm" onClick={() => onLeaveAction(item.leaveId, 'rejected')}>✕ Reject</Button>
          </div>
        ) : item.link ? (
          <button onClick={() => onNavigate(item.link)} style={{
            fontSize: 12, color: C.brand, background: 'none', border: 'none',
            cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap',
          }}>{item.actionLabel}</button>
        ) : null}
      </div>
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AdminLandingPage() {
  const { employee } = useAuth()
  const navigate     = useNavigate()
  const r            = useResponsive()
  const year         = new Date().getFullYear()

  const [leaves,          setLeaves]          = useState([])
  const [employees,       setEmployees]       = useState([])
  const [teamAtt,         setTeamAtt]         = useState([])
  const [holidays,        setHolidays]        = useState([])
  const [announcements,   setAnnouncements]   = useState([])
  const [pendingRegs,     setPendingRegs]     = useState([])
  const [pendingTransfers,setPendingTransfers]= useState([])
  const [expiringCerts,   setExpiringCerts]   = useState([])
  const [probationEnding, setProbationEnding] = useState([])
  const [loading,         setLoading]         = useState(true)
  const [loadError,       setLoadError]       = useState(null)

  useEffect(() => {
    const safe = (label, promise, fallback) =>
      promise.catch(err => { console.error(`[HR Dashboard] ${label} failed:`, err); return fallback })
    Promise.all([
      safe('getAllLeaveRequests',          getAllLeaveRequests(),                    []),
      safe('getEmployeesForHRDashboard',   getEmployeesForHRDashboard(),            []),
      safe('getTeamAttendanceByDate',      getTeamAttendanceByDate(todayISO()),     []),
      safe('getHolidays',                  getHolidays(year),                       []),
      safe('getAnnouncements',             getAnnouncements(),                      []),
      safe('getPendingRegularizationsForHR', getPendingRegularizationsForHR(),      []),
      safe('getPendingTransfersForHR',     getPendingTransfersForHR(),              []),
      safe('getExpiringCertificationsForHR', getExpiringCertificationsForHR(),      []),
      safe('getProbationEndingSoon',       getProbationEndingSoon(),                []),
    ]).then(([lv, emps, att, hols, ann, regs, transfers, certs, probation]) => {
      setLeaves(lv)
      setEmployees(emps)
      setTeamAtt(att)
      setHolidays(hols)
      setAnnouncements(ann)
      setPendingRegs(regs)
      setPendingTransfers(transfers)
      setExpiringCerts(certs)
      setProbationEnding(probation)
    }).finally(() => setLoading(false))
  }, [])

  async function handleLeaveAction(leaveId, status) {
    try {
      const updated = await updateLeaveStatus(leaveId, status, employee.id)
      setLeaves(prev => prev.map(l => l.id === leaveId ? { ...l, status } : l))
      await notifyLeaveDecision(updated, updated.employee_id, status)
    } catch (e) {
      alert('Error: ' + e.message)
    }
  }

  if (loading) return (
    <AppShell title="HR Dashboard">
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><Spinner size={36} /></div>
    </AppShell>
  )

  if (loadError) return (
    <AppShell title="HR Dashboard">
      <Card style={{ padding: '24px', borderLeft: `4px solid ${C.accent}`, marginTop: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.accent, marginBottom: 4 }}>Failed to load dashboard</div>
        <div style={{ fontSize: 12, color: C.textMid }}>{loadError}</div>
      </Card>
    </AppShell>
  )

  const attMap       = Object.fromEntries(teamAtt.map(a => [a.employee_id, a]))
  const actionItems  = buildActionItems(leaves, pendingRegs, pendingTransfers, expiringCerts, probationEnding)
  const visibleItems = actionItems.slice(0, 15)
  const hiddenCount  = actionItems.length - 15

  const counts = {
    leaves:    leaves.filter(l => l.status === 'pending').length,
    regs:      pendingRegs.length,
    transfers: pendingTransfers.length,
    certs:     expiringCerts.length,
    probation: probationEnding.length,
  }

  const deptCounts = employees.reduce((acc, e) => {
    const dept = e.department || 'Unassigned'
    acc[dept] = (acc[dept] || 0) + 1
    return acc
  }, {})

  const typeCounts = employees.reduce((acc, e) => {
    const t = e.employee_type || 'permanent'
    acc[t] = (acc[t] || 0) + 1
    return acc
  }, {})

  const upcomingHols = holidays.filter(h => { const d = daysUntil(h.date); return d >= 0 && d <= 14 })

  const upcomingBdays = employees.filter(e => {
    if (!e.date_of_birth) return false
    const dob = new Date(e.date_of_birth)
    const thisYear = new Date(new Date().getFullYear(), dob.getMonth(), dob.getDate())
    const d = Math.ceil((thisYear - new Date(todayISO())) / 86400000)
    return d >= 0 && d <= 30
  })

  const upcomingEvents = [
    ...upcomingHols.map(h => ({ type: 'holiday', name: h.name, date: h.date, days: daysUntil(h.date) })),
    ...upcomingBdays.map(e => {
      const dob      = new Date(e.date_of_birth)
      const thisYear = new Date(new Date().getFullYear(), dob.getMonth(), dob.getDate())
      return { type: 'birthday', name: e.full_name, date: thisYear.toISOString().split('T')[0], days: Math.ceil((thisYear - new Date(todayISO())) / 86400000) }
    }),
  ].sort((a, b) => a.days - b.days).slice(0, 7)

  const sortedAnnouncements = [...announcements].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).slice(0, 3)

  return (
    <AppShell title="HR Dashboard" subtitle="What needs your attention today">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap');`}</style>

      {/* ── Layer 1: Action Inbox ── */}
      <div style={{ marginBottom: 32 }}>
        {/* Summary chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'Pending Leaves',   count: counts.leaves,    color: C.amber  },
            { label: 'Regularizations',  count: counts.regs,      color: C.amber  },
            { label: 'Transfers',        count: counts.transfers, color: C.brand  },
            { label: 'Expiring Certs',   count: counts.certs,     color: C.accent },
            { label: 'Probation Ending', count: counts.probation, color: C.accent },
          ].map(chip => (
            <div key={chip.label} style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              fontFamily: "'DM Sans',sans-serif",
              background: chip.count > 0 ? chip.color + '18' : C.surfaceAlt,
              border:     `1px solid ${chip.count > 0 ? chip.color : C.border}`,
              color:      chip.count > 0 ? chip.color : C.textLight,
            }}>
              {chip.count} {chip.label}
            </div>
          ))}
        </div>

        {/* Unified urgency feed */}
        {actionItems.length === 0 ? (
          <Card style={{ padding: '28px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>✅</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, fontFamily: "'Sora',sans-serif" }}>All caught up</div>
            <div style={{ fontSize: 12, color: C.textLight, marginTop: 4 }}>No pending actions today.</div>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleItems.map(item => (
              <ActionRow key={item.key} item={item} onLeaveAction={handleLeaveAction} onNavigate={navigate} />
            ))}
            {hiddenCount > 0 && (
              <div style={{ padding: '10px 16px', fontSize: 12, color: C.textLight, textAlign: 'center' }}>
                +{hiddenCount} more items
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Layer 2: Team Health ── */}
      <SectionTitle>Team Health</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: cols(r, { mobile: 1, tablet: 1, desktop: 3 }), gap: 20, marginTop: 12 }}>

        {/* Today's attendance */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Today's Attendance</span>
            <button onClick={() => navigate('/hr/attendance')} style={{ fontSize: 11, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Full Report →</button>
          </div>
          <Card padding="0">
            {employees.slice(0, 8).map((emp, i) => {
              const rec = attMap[emp.id]
              return (
                <div key={emp.id} style={{ padding: '10px 14px', borderBottom: i < Math.min(employees.length, 8) - 1 ? `1px solid ${C.border}` : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar initials={emp.avatar_initials || '??'} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.full_name}</div>
                    <div style={{ fontSize: 10, color: C.textLight }}>{emp.department}</div>
                  </div>
                  {rec?.check_in && <div style={{ fontSize: 10, color: C.textMid }}>{new Date(rec.check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</div>}
                  <AttendBadge status={rec?.status || 'absent'} />
                </div>
              )
            })}
            {employees.length > 8 && <div style={{ padding: '8px 14px', fontSize: 11, color: C.textLight, textAlign: 'center' }}>+{employees.length - 8} more</div>}
          </Card>
        </div>

        {/* Team breakdown */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Team Breakdown</div>
          <Card style={{ padding: '16px 18px' }}>
            {Object.entries(deptCounts).sort((a, b) => b[1] - a[1]).map(([dept, count]) => (
              <div key={dept} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: C.text, fontWeight: 500 }}>{dept}</span>
                  <span style={{ fontWeight: 700, color: C.brand }}>{count}</span>
                </div>
                <div style={{ height: 4, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${(count / employees.length) * 100}%`, height: '100%', background: C.brand, borderRadius: 4 }} />
                </div>
              </div>
            ))}
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {Object.entries(typeCounts).map(([type, count]) => (
                <div key={type} style={{ fontSize: 11, color: C.textMid }}>
                  <span style={{ fontWeight: 700, color: C.brand }}>{count}</span> {type}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Upcoming events */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Upcoming Events</div>
          {upcomingEvents.length === 0 ? (
            <Card style={{ padding: '20px', textAlign: 'center' }}><div style={{ fontSize: 12, color: C.textLight }}>No upcoming events in the next 14 days.</div></Card>
          ) : (
            <Card padding="0">
              {upcomingEvents.map((ev, i) => (
                <div key={`${ev.type}-${ev.name}-${ev.date}`} style={{ padding: '10px 14px', borderBottom: i < upcomingEvents.length - 1 ? `1px solid ${C.border}` : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 18 }}>{ev.type === 'holiday' ? '🎉' : '🎂'}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{ev.name}</div>
                    <div style={{ fontSize: 10, color: C.textLight }}>{new Date(ev.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: ev.days === 0 ? C.accent : C.teal, background: ev.days === 0 ? C.accentSoft : C.tealSoft, padding: '2px 8px', borderRadius: 20 }}>
                    {ev.days === 0 ? 'Today' : `In ${ev.days}d`}
                  </span>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>

      {/* Announcements strip */}
      {sortedAnnouncements.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <SectionTitle>Announcements</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {sortedAnnouncements.map(a => (
              <Card key={a.id} style={{ padding: '12px 16px', borderLeft: `3px solid ${a.pinned ? C.accent : C.brand}` }}>
                {a.pinned && <div style={{ fontSize: 9, color: C.accent, fontWeight: 700, letterSpacing: 1, marginBottom: 2 }}>📌 PINNED</div>}
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{a.title}</div>
                <div style={{ fontSize: 12, color: C.textMid, marginTop: 2 }}>{a.body}</div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </AppShell>
  )
}
