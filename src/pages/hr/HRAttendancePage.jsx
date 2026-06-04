import AttendanceOverridePanel from '../../components/AttendanceOverridePanel'
import { useEffect, useState, useCallback } from 'react'
import AppShell from '../../components/layout/AppShell'
import { Card, Avatar, Button, Spinner, EmptyState, Alert, Input, SectionTitle } from '../../components/ui'
import { C, ATTENDANCE_STATUSES } from '../../lib/constants'
import { useResponsive, cols } from '../../lib/responsive'
import { useAuth } from '../../context/AuthContext'
import {
  getTeamAttendanceByDate, getTeamMonthlyAttendance,
  getHolidays, addHoliday, deleteHoliday,
  overrideAttendance, todayISO,
} from '../../lib/api.attendance'
import { getAllEmployees } from '../../lib/api'

function StatusBadge({ status }) {
  const s = ATTENDANCE_STATUSES.find(a => a.value === status)
  if (!s) return <span style={{ fontSize: 11, color: C.textLight }}>—</span>
  return (
    <span style={{
      background: s.bg, color: s.color,
      fontSize: 11, fontWeight: 600, padding: '3px 10px',
      borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>{s.icon} {s.label}</span>
  )
}

// ─── TODAY'S TEAM OVERVIEW ────────────────────────────────────────────────────
function TodayOverview({ records, employees }) {
  const recMap = Object.fromEntries(records.map(r => [r.employee_id, r]))

  const activeEmployees = employees.filter(e => e.status === 'active')

  const counts = { present: 0, wfh: 0, late_mark: 0, half_day: 0, leave: 0, absent: 0 }
  activeEmployees.forEach(e => {
    const r = recMap[e.id]
    const status = r?.status || 'absent'
    if (counts[status] !== undefined) counts[status]++
    else counts.absent++
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10 }}>
        {[
          { label: 'Present',    val: counts.present,   color: C.green,   bg: C.greenSoft  },
          { label: 'WFH',        val: counts.wfh,       color: C.brand,   bg: C.brandLight },
          { label: 'Late Mark',  val: counts.late_mark, color: '#9A3412', bg: '#FFF7ED'    },
          { label: 'Half Day',   val: counts.half_day,  color: C.amber,   bg: C.amberSoft  },
          { label: 'On Leave',   val: counts.leave,     color: C.purple,  bg: C.purpleSoft },
          { label: 'Absent',     val: counts.absent,    color: C.accent,  bg: C.accentSoft },
        ].map(s => (
          <Card key={s.label} style={{ padding: '16px', textAlign: 'center', borderTop: `3px solid ${s.color}` }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color, fontFamily: "'Sora',sans-serif" }}>{s.val}</div>
            <div style={{ fontSize: 11, color: C.textMid, marginTop: 4 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Employee list */}
      <Card padding="0">
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif" }}>
            Today — {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        </div>
        {activeEmployees.length === 0
          ? <EmptyState icon="👥" title="No active employees" />
          : activeEmployees.map((emp, i) => {
              const rec = recMap[emp.id]
              return (
                <div key={emp.id} style={{
                  padding: '13px 20px',
                  borderBottom: i < activeEmployees.length - 1 ? `1px solid ${C.border}` : 'none',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <Avatar initials={emp.avatar_initials || '??'} size={34} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{emp.full_name}</div>
                    <div style={{ fontSize: 11, color: C.textLight }}>{emp.role} · {emp.department}</div>
                  </div>
                  {rec?.check_in && (
                    <div style={{ fontSize: 11, color: C.textMid }}>
                      In: <span style={{ color: C.green, fontWeight: 600 }}>
                        {new Date(rec.check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                      </span>
                      {rec.check_out && (
                        <> · Out: <span style={{ color: C.accent, fontWeight: 600 }}>
                          {new Date(rec.check_out).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                        </span></>
                      )}
                    </div>
                  )}
                  <StatusBadge status={rec?.status || 'absent'} />
                </div>
              )
            })
        }
      </Card>
    </div>
  )
}

// ─── MONTHLY TEAM REPORT ──────────────────────────────────────────────────────
function MonthlyReport({ records, employees, year, month }) {
  const activeEmployees = employees.filter(e => e.status === 'active')
  const daysInMonth = new Date(year, month, 0).getDate()
  const today = todayISO()

  // Build per-employee summary
  const summaries = activeEmployees.map(emp => {
    const empRecords = records.filter(r => r.employee_id === emp.id)
    const counts = empRecords.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc }, {})
    const totalHours = empRecords.reduce((sum, r) => sum + (r.hours_worked || 0), 0)
    return { emp, counts, totalHours }
  })

  return (
    <Card padding="0">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: C.surfaceAlt }}>
              {['Employee', 'Present', 'WFH', 'Half Day', 'Late', 'Leave', 'Absent', 'Total Hrs'].map(h => (
                <th key={h} style={{
                  padding: '10px 14px', textAlign: 'left',
                  fontSize: 10, fontWeight: 700, color: C.textLight,
                  letterSpacing: 0.5, textTransform: 'uppercase',
                  borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summaries.map(({ emp, counts, totalHours }, i) => (
              <tr key={emp.id} style={{ background: i % 2 === 0 ? C.surface : C.surfaceAlt }}>
                <td style={{ padding: '11px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar initials={emp.avatar_initials || '??'} size={28} />
                    <div>
                      <div style={{ fontWeight: 600, color: C.text }}>{emp.full_name}</div>
                      <div style={{ fontSize: 10, color: C.textLight }}>{emp.department}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '11px 14px', color: C.green,   fontWeight: 700 }}>{counts.present   || 0}</td>
                <td style={{ padding: '11px 14px', color: C.brand,   fontWeight: 700 }}>{counts.wfh       || 0}</td>
                <td style={{ padding: '11px 14px', color: C.amber,   fontWeight: 700 }}>{counts.half_day  || 0}</td>
                <td style={{ padding: '11px 14px', color: '#9A3412', fontWeight: 700 }}>{counts.late_mark || 0}</td>
                <td style={{ padding: '11px 14px', color: C.purple,  fontWeight: 700 }}>{counts.leave     || 0}</td>
                <td style={{ padding: '11px 14px', color: C.accent,  fontWeight: 700 }}>{counts.absent    || 0}</td>
                <td style={{ padding: '11px 14px', color: C.amber,   fontWeight: 700 }}>{Math.round(totalHours)}h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ─── HOLIDAYS MANAGER ─────────────────────────────────────────────────────────
function HolidaysPanel({ holidays, year, onAdd, onDelete }) {
  const [form, setForm] = useState({ name: '', date: '', type: 'public' })
  const [adding, setAdding] = useState(false)
  const [error, setError]   = useState('')

  async function submit() {
    if (!form.name || !form.date) { setError('Name and date are required.'); return }
    setAdding(true); setError('')
    try {
      await onAdd(form)
      setForm({ name: '', date: '', type: 'public' })
    } catch (e) { setError(e.message) }
    finally { setAdding(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Add holiday form */}
      <Card style={{ padding: '20px 24px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", marginBottom: 16 }}>
          Add Holiday
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 140px auto', gap: 12, alignItems: 'flex-end' }}>
          <Input label="Holiday Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))}
            placeholder="e.g. Diwali" required />
          <Input label="Date" type="date" value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} required />
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 8 }}>Type</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                border: `1.5px solid ${C.border}`, background: C.surfaceAlt,
                fontSize: 13, color: C.text, fontFamily: "'DM Sans',sans-serif",
              }}>
              <option value="public">Public</option>
              <option value="optional">Optional</option>
              <option value="company">Company</option>
            </select>
          </div>
          <button onClick={submit} disabled={adding} style={{
            padding: '10px 20px', borderRadius: 8, border: 'none',
            background: adding ? C.border : C.brand, color: adding ? C.textLight : '#fff',
            fontSize: 13, fontWeight: 700, cursor: adding ? 'not-allowed' : 'pointer',
            fontFamily: "'Sora',sans-serif", marginTop: 2,
          }}>{adding ? '…' : '+ Add'}</button>
        </div>
        {error && <div style={{ marginTop: 10 }}><Alert type="error" message={error} /></div>}
      </Card>

      {/* Holidays list */}
      <Card padding="0">
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif" }}>
            Holidays — {year}
          </div>
        </div>
        {holidays.length === 0
          ? <EmptyState icon="🎉" title="No holidays added yet" subtitle="Add company and public holidays above." />
          : holidays.map((h, i) => (
            <div key={h.id} style={{
              padding: '13px 20px',
              borderBottom: i < holidays.length - 1 ? `1px solid ${C.border}` : 'none',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{ fontSize: 24 }}>🎉</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{h.name}</div>
                <div style={{ fontSize: 11, color: C.textLight }}>
                  {new Date(h.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                background: C.brandLight, color: C.brand, textTransform: 'capitalize',
              }}>{h.type}</span>
              <button onClick={() => onDelete(h.id)} style={{
                background: 'none', border: 'none', color: C.accent,
                fontSize: 16, cursor: 'pointer', padding: '4px',
              }}>✕</button>
            </div>
          ))
        }
      </Card>
    </div>
  )
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────
export default function HRAttendancePage() {
  const { employee } = useAuth()
  const r = useResponsive()
  const now = new Date()
  const [year,      setYear]     = useState(now.getFullYear())
  const [month,     setMonth]    = useState(now.getMonth() + 1)
  const [tab,       setTab]      = useState('today')
  const [todayRecs, setTodayRecs]= useState([])
  const [monthRecs, setMonthRecs]= useState([])
  const [employees, setEmployees]= useState([])
  const [holidays,  setHolidays] = useState([])
  const [loading,   setLoading]  = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, m, e, h] = await Promise.all([
        getTeamAttendanceByDate(todayISO()),
        getTeamMonthlyAttendance(year, month),
        getAllEmployees(),
        getHolidays(year),
      ])
      setTodayRecs(t); setMonthRecs(m); setEmployees(e); setHolidays(h)
    } finally { setLoading(false) }
  }, [year, month])

  useEffect(() => { load() }, [load])

  async function handleAddHoliday(form) {
    const h = await addHoliday(form)
    setHolidays(hs => [...hs, h].sort((a, b) => a.date.localeCompare(b.date)))
  }

  async function handleDeleteHoliday(id) {
    if (!confirm('Delete this holiday?')) return
    await deleteHoliday(id)
    setHolidays(hs => hs.filter(h => h.id !== id))
  }

  const monthLabel = new Date(year, month - 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  if (loading) return (
    <AppShell title="HR — Attendance">
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><Spinner size={36} /></div>
    </AppShell>
  )

  return (
    <AppShell title="HR — Attendance" subtitle="Monitor team attendance and manage holidays">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap'); @keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: C.surface, padding: 6, borderRadius: 10, width: 'fit-content', boxShadow: C.shadow }}>
        {[
          { id: 'today',    label: "Today's View" },
          { id: 'monthly',  label: 'Monthly Report' },
          { id: 'holidays', label: 'Holidays' },
          { id: 'override', label: '✏️ Override Times' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 20px', borderRadius: 7, border: 'none',
            background: tab === t.id ? C.brand : 'transparent',
            color: tab === t.id ? '#fff' : C.textMid,
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: "'Sora',sans-serif",
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'today' && <TodayOverview records={todayRecs} employees={employees} />}

      {tab === 'monthly' && (
        <>
          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <button onClick={() => { if (month === 1) { setMonth(12); setYear(y => y-1) } else setMonth(m => m-1) }}
              style={{ padding: '6px 14px', borderRadius: 7, border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer', fontSize: 16 }}>‹</button>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", minWidth: 160, textAlign: 'center' }}>
              {monthLabel}
            </div>
            <button onClick={() => { if (month === 12) { setMonth(1); setYear(y => y+1) } else setMonth(m => m+1) }}
              style={{ padding: '6px 14px', borderRadius: 7, border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer', fontSize: 16 }}>›</button>
          </div>
          <MonthlyReport records={monthRecs} employees={employees} year={year} month={month} />
        </>
      )}

      {tab === 'override' && <AttendanceOverridePanel reviewerId={employee?.id} /> }

      {tab === 'holidays' && (
        <HolidaysPanel
          holidays={holidays} year={year}
          onAdd={handleAddHoliday} onDelete={handleDeleteHoliday}
        />
      )}
    </AppShell>
  )
}
