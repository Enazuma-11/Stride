import { useEffect, useState, useCallback } from 'react'
import AppShell from '../../components/layout/AppShell'
import { Card, Avatar, Spinner, EmptyState, SectionTitle, Alert } from '../../components/ui'
import { C, ATTENDANCE_STATUSES, WORK_HOURS_BY_TYPE } from '../../lib/constants'
import { useResponsive } from '../../lib/responsive'
import { useAuth } from '../../context/AuthContext'
import {
  checkIn, checkOut, getTodayAttendance, getTodaySessions, getOpenSession,
  getMyMonthlyAttendance, getHolidays, getWeeklyHours, getWeekStart,
  formatTime, hoursWorked, todayISO,
} from '../../lib/api.attendance'

// ─── STATUS BADGE ─────────────────────────────────────────────────────────────
function StatusBadge({ status, size = 'md' }) {
  const s = ATTENDANCE_STATUSES.find(a => a.value === status)
  if (!s) return null
  return (
    <span style={{
      background: s.bg, color: s.color,
      fontSize: size === 'sm' ? 10 : 11, fontWeight: 600,
      padding: size === 'sm' ? '2px 7px' : '3px 10px',
      borderRadius: 20, whiteSpace: 'nowrap',
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      {s.icon} {s.label}
    </span>
  )
}

// ─── LIVE CLOCK ───────────────────────────────────────────────────────────────
function LiveClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 48, fontWeight: 800, color: C.brand, fontFamily: "'Sora',sans-serif", lineHeight: 1, letterSpacing: -1 }}>
        {time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
      </div>
      <div style={{ fontSize: 13, color: C.textLight, marginTop: 6 }}>
        {time.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      </div>
    </div>
  )
}

// ─── SESSIONS LIST ────────────────────────────────────────────────────────────
function SessionsList({ sessions }) {
  if (sessions.length === 0) return null
  return (
    <div style={{ margin: '20px 0', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
      {sessions.map((s, i) => (
        <div key={s.id} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 14px', borderRadius: 8, background: C.surfaceAlt, fontSize: 13,
        }}>
          <span style={{ color: C.textMid }}>
            Session {i + 1}: {formatTime(s.check_in)} – {s.check_out ? formatTime(s.check_out) : 'ongoing'}
            {s.is_wfh && <span style={{ marginLeft: 8, fontSize: 11, color: C.brand }}>🏠 WFH</span>}
          </span>
          {s.check_out && (
            <span style={{ fontWeight: 700, color: C.amber }}>
              {hoursWorked(s.check_in, s.check_out)}h
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── CHECK IN/OUT PANEL ───────────────────────────────────────────────────────
function CheckInPanel({ today, sessions, openSession, onCheckIn, onCheckOut, loading }) {
  const [isWFH, setIsWFH] = useState(false)
  const hasOpenSession = !!openSession
  const atSessionCap = sessions.length >= 5 && !hasOpenSession

  return (
    <Card style={{ padding: '32px', textAlign: 'center' }}>
      <LiveClock />

      <div style={{ margin: '28px 0 20px', display: 'flex', justifyContent: 'center', gap: 12 }}>
        {!hasOpenSession && !atSessionCap && (
          <button onClick={() => setIsWFH(w => !w)} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 16px', borderRadius: 8,
            border: `1.5px solid ${isWFH ? C.brand : C.border}`,
            background: isWFH ? C.brandLight : '#fff',
            color: isWFH ? C.brand : C.textMid,
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: "'DM Sans',sans-serif",
          }}>
            <span>🏠</span>
            {isWFH ? 'Working from Home' : 'Mark as WFH'}
          </button>
        )}
      </div>

      <SessionsList sessions={sessions} />

      {today?.status && (
        <div style={{ marginBottom: 20 }}>
          <StatusBadge status={today.status} />
          {today.hours_worked > 0 && (
            <span style={{ marginLeft: 10, fontSize: 13, color: C.textMid }}>
              {today.hours_worked}h logged today
            </span>
          )}
        </div>
      )}

      {atSessionCap && (
        <div style={{ marginBottom: 16 }}>
          <Alert type="warning" message="You've reached today's check-in limit (5 sessions). If you need to log more time, submit a regularization request below." />
        </div>
      )}

      {!hasOpenSession && !atSessionCap && (
        <button onClick={() => onCheckIn(isWFH)} disabled={loading} style={{
          padding: '16px 48px', borderRadius: 12, border: 'none',
          background: loading ? C.border : C.green,
          color: loading ? C.textLight : '#fff',
          fontSize: 16, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
          fontFamily: "'Sora',sans-serif",
          boxShadow: loading ? 'none' : `0 6px 20px ${C.green}50`,
        }}>
          {loading ? 'Checking in…' : sessions.length === 0 ? '✓ Check In' : '✓ Check In (new session)'}
        </button>
      )}

      {hasOpenSession && (
        <button onClick={onCheckOut} disabled={loading} style={{
          padding: '16px 48px', borderRadius: 12, border: 'none',
          background: loading ? C.border : C.accent,
          color: loading ? C.textLight : '#fff',
          fontSize: 16, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
          fontFamily: "'Sora',sans-serif",
          boxShadow: loading ? 'none' : `0 6px 20px ${C.accent}50`,
        }}>
          {loading ? 'Checking out…' : '✕ Check Out'}
        </button>
      )}
    </Card>
  )
}

// ─── THIS WEEK CARD ───────────────────────────────────────────────────────────
function ThisWeekCard({ weekly }) {
  if (!weekly) return null
  const pct = Math.min(100, Math.round((weekly.totalHours / weekly.targetHours) * 100))
  return (
    <Card style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>This Week</span>
        <span style={{ fontSize: 13, color: C.textMid }}>{weekly.totalHours} / {weekly.targetHours} hrs</span>
      </div>
      <div style={{ height: 8, borderRadius: 6, background: C.border, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: C.brand, borderRadius: 6, transition: 'width 0.3s' }} />
      </div>
    </Card>
  )
}

// ─── MONTHLY SUMMARY CARDS ────────────────────────────────────────────────────
function MonthlySummary({ records, holidays }) {
  const r = useResponsive()
  const holidayDates = new Set(holidays.map(h => h.date))

  const counts = records.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1
    return acc
  }, {})

  const totalHours = records.reduce((sum, r) => sum + (r.hours_worked || 0), 0)

  const stats = [
    { label: 'Present',   val: (counts.present   || 0) + (counts.wfh || 0), color: C.green,  bg: C.greenSoft  },
    { label: 'WFH',       val: counts.wfh        || 0,                       color: C.brand,  bg: C.brandLight },
    { label: 'Half Days', val: counts.half_day   || 0,                       color: C.amber,  bg: C.amberSoft  },
    { label: 'Late Marks',val: counts.late_mark  || 0,                       color: '#9A3412',bg: '#FFF7ED'    },
    { label: 'Leaves',    val: counts.leave      || 0,                       color: C.purple, bg: C.purpleSoft },
    { label: 'Total Hrs', val: `${Math.round(totalHours)}h`,                 color: C.brand,  bg: C.brandLight },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? 'repeat(3,1fr)' : 'repeat(6,1fr)', gap: 10 }}>
      {stats.map(s => (
        <Card key={s.label} style={{ padding: '14px 16px', borderLeft: `3px solid ${s.color}` }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: s.color, fontFamily: "'Sora',sans-serif" }}>{s.val}</div>
          <div style={{ fontSize: 10, color: C.textMid, marginTop: 3 }}>{s.label}</div>
        </Card>
      ))}
    </div>
  )
}

// ─── CALENDAR VIEW ────────────────────────────────────────────────────────────
function AttendanceCalendar({ year, month, records, holidays }) {
  const holidayDates = new Set(holidays.map(h => h.date))
  const recordMap    = Object.fromEntries(records.map(r => [r.date, r]))

  const firstDay = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const today = todayISO()

  const cells = []
  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <Card style={{ padding: '20px 24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 8 }}>
        {dayLabels.map(d => (
          <div key={d} style={{
            textAlign: 'center', fontSize: 10, fontWeight: 700,
            color: d === 'Sun' || d === 'Sat' ? C.accent : C.textLight,
            padding: '4px 0', textTransform: 'uppercase', letterSpacing: 0.5,
          }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />

          const dateStr  = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const record   = recordMap[dateStr]
          const isHoliday = holidayDates.has(dateStr)
          const isToday  = dateStr === today
          const dow      = new Date(dateStr).getDay()
          const isWeekend = dow === 0 || dow === 6
          const isFuture = dateStr > today

          let bg = 'transparent', color = C.textMid, dot = null
          if (isHoliday)       { bg = '#ECFEFF'; color = '#0E7490'; dot = '🎉' }
          else if (isWeekend)  { color = C.textLight }
          else if (isFuture)   { color = C.textLight }
          else if (record)     {
            const s = ATTENDANCE_STATUSES.find(a => a.value === record.status)
            if (s) { bg = s.bg; color = s.color; dot = s.icon }
          } else if (!isFuture && !isWeekend) {
            bg = C.accentSoft; color = C.accent; dot = '❌'
          }

          return (
            <div key={dateStr} title={record?.status || (isHoliday ? 'Holiday' : '')} style={{
              padding: '6px 4px', borderRadius: 6, textAlign: 'center',
              background: bg,
              border: isToday ? `2px solid ${C.brand}` : '2px solid transparent',
              cursor: 'default',
            }}>
              <div style={{ fontSize: 12, fontWeight: isToday ? 800 : 500, color }}>{day}</div>
              {dot && <div style={{ fontSize: 10, marginTop: 1 }}>{dot}</div>}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
        {ATTENDANCE_STATUSES.filter(s => !['weekend'].includes(s.value)).map(s => (
          <div key={s.value} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.textMid }}>
            <span style={{ fontSize: 12 }}>{s.icon}</span> {s.label}
          </div>
        ))}
      </div>
    </Card>
  )
}

// ─── ATTENDANCE HISTORY TABLE ─────────────────────────────────────────────────
function AttendanceTable({ records }) {
  if (!records.length) return <EmptyState icon="📋" title="No records this month" />
  return (
    <Card padding="0">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.surfaceAlt }}>
              {['Date', 'Check In', 'Check Out', 'Hours', 'Type', 'Status'].map(h => (
                <th key={h} style={{
                  padding: '10px 16px', textAlign: 'left',
                  fontSize: 10, fontWeight: 700, color: C.textLight,
                  letterSpacing: 0.5, textTransform: 'uppercase',
                  borderBottom: `1px solid ${C.border}`,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...records].reverse().map((r, i) => (
              <tr key={r.id || r.date} style={{ background: i % 2 === 0 ? C.surface : C.surfaceAlt }}>
                <td style={{ padding: '11px 16px', fontWeight: 600, color: C.text }}>
                  {new Date(r.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                </td>
                <td style={{ padding: '11px 16px', color: C.green, fontWeight: 600 }}>{formatTime(r.check_in)}</td>
                <td style={{ padding: '11px 16px', color: C.accent, fontWeight: 600 }}>{formatTime(r.check_out)}</td>
                <td style={{ padding: '11px 16px', color: C.amber, fontWeight: 700 }}>
                  {r.hours_worked ? `${r.hours_worked}h` : '—'}
                </td>
                <td style={{ padding: '11px 16px' }}>
                  {r.is_wfh
                    ? <span style={{ fontSize: 11, background: C.brandLight, color: C.brand, padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>🏠 WFH</span>
                    : <span style={{ fontSize: 11, background: C.greenSoft, color: C.green, padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>🏢 Office</span>
                  }
                </td>
                <td style={{ padding: '11px 16px' }}><StatusBadge status={r.status} size="sm" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────
export default function AttendancePage() {
  const { employee } = useAuth()
  const r = useResponsive()
  const now = new Date()
  const [year,      setYear]      = useState(now.getFullYear())
  const [month,     setMonth]     = useState(now.getMonth() + 1)
  const [today,     setToday]     = useState(null)
  const [sessions,  setSessions]  = useState([])
  const [openSession,setOpenSession]= useState(null)
  const [weekly,    setWeekly]    = useState(null)
  const [records,   setRecords]   = useState([])
  const [holidays,  setHolidays]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [actionLoad,setActionLoad]= useState(false)
  const [error,     setError]     = useState('')
  const [tab,       setTab]       = useState('today')

  const load = useCallback(async () => {
    if (!employee) return
    setLoading(true)
    try {
      const [t, sess, open, wk, r, h] = await Promise.all([
        getTodayAttendance(employee.id),
        getTodaySessions(employee.id),
        getOpenSession(employee.id),
        getWeeklyHours(employee.id, getWeekStart(todayISO())),
        getMyMonthlyAttendance(employee.id, year, month),
        getHolidays(year),
      ])
      setToday(t); setSessions(sess); setOpenSession(open); setWeekly(wk)
      setRecords(r); setHolidays(h)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [employee, year, month])

  useEffect(() => { load() }, [load])

  async function refreshToday() {
    const [t, sess, open, wk] = await Promise.all([
      getTodayAttendance(employee.id),
      getTodaySessions(employee.id),
      getOpenSession(employee.id),
      getWeeklyHours(employee.id, getWeekStart(todayISO())),
    ])
    setToday(t); setSessions(sess); setOpenSession(open); setWeekly(wk)
    return t
  }

  async function handleCheckIn(isWFH) {
    setActionLoad(true); setError('')
    try {
      const { attendance } = await checkIn(employee.id, isWFH)
      setToday(attendance)
      await refreshToday()
    } catch (e) { setError(e.message) }
    finally { setActionLoad(false) }
  }

  async function handleCheckOut() {
    setActionLoad(true); setError('')
    try {
      const { attendance } = await checkOut(employee.id)
      setToday(attendance)
      await refreshToday()
      setRecords(rs => {
        const idx = rs.findIndex(r => r.date === todayISO())
        if (idx >= 0) { const copy = [...rs]; copy[idx] = attendance; return copy }
        return attendance ? [attendance, ...rs] : rs
      })
    } catch (e) { setError(e.message) }
    finally { setActionLoad(false) }
  }

  const monthLabel = new Date(year, month - 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  if (loading) return (
    <AppShell title="Attendance">
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><Spinner size={36} /></div>
    </AppShell>
  )

  return (
    <AppShell title="Attendance" subtitle="Track your daily attendance">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap'); @keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {error && <div style={{ marginBottom: 16 }}><Alert type="error" message={error} /></div>}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: C.surface, padding: 6, borderRadius: 10, width: 'fit-content', boxShadow: C.shadow }}>
        {[{ id: 'today', label: 'Today' }, { id: 'calendar', label: 'Calendar' }, { id: 'history', label: 'History' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 20px', borderRadius: 7, border: 'none',
            background: tab === t.id ? C.brand : 'transparent',
            color: tab === t.id ? '#fff' : C.textMid,
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: "'Sora',sans-serif", transition: 'all 0.15s',
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'today' && (
        <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 340px', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <ThisWeekCard weekly={weekly} />
            <CheckInPanel
              today={today}
              sessions={sessions}
              openSession={openSession}
              onCheckIn={handleCheckIn}
              onCheckOut={handleCheckOut}
              loading={actionLoad}
            />
          </div>

          {/* Today's info sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Card style={{ padding: '20px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 14 }}>
                Office Hours
              </div>
              {[
                { label: 'Work Start',   val: '9:00 AM' },
                { label: 'Grace Period', val: 'Until 9:30 AM' },
                { label: 'Work End',     val: employee?.employee_type === 'intern' ? '2:30 PM' : '6:00 PM' },
                { label: 'Full Day',     val: `${WORK_HOURS_BY_TYPE[employee?.employee_type || 'permanent'].fullDay}+ hours` },
                { label: 'Half Day',     val: `${WORK_HOURS_BY_TYPE[employee?.employee_type || 'permanent'].halfDay}–${WORK_HOURS_BY_TYPE[employee?.employee_type || 'permanent'].fullDay} hours` },
              ].map(r => (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 13 }}>
                  <span style={{ color: C.textMid }}>{r.label}</span>
                  <span style={{ fontWeight: 600, color: C.text }}>{r.val}</span>
                </div>
              ))}
            </Card>

            <Card style={{ padding: '20px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 14 }}>
                This Month — {monthLabel}
              </div>
              <MonthlySummary records={records} holidays={holidays} />
            </Card>
          </div>
        </div>
      )}

      {(tab === 'calendar' || tab === 'history') && (
        <>
          {/* Month navigator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <button onClick={() => { if (month === 1) { setMonth(12); setYear(y => y - 1) } else setMonth(m => m - 1) }}
              style={{ padding: '6px 14px', borderRadius: 7, border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer', fontSize: 16 }}>
              ‹
            </button>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", minWidth: 160, textAlign: 'center' }}>
              {monthLabel}
            </div>
            <button onClick={() => { if (month === 12) { setMonth(1); setYear(y => y + 1) } else setMonth(m => m + 1) }}
              style={{ padding: '6px 14px', borderRadius: 7, border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer', fontSize: 16 }}>
              ›
            </button>
          </div>

          {tab === 'calendar' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <AttendanceCalendar year={year} month={month} records={records} holidays={holidays} />
              <MonthlySummary records={records} holidays={holidays} />
            </div>
          )}
          {tab === 'history' && <AttendanceTable records={records} />}
        </>
      )}
    </AppShell>
  )
}
