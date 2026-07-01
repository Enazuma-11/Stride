import { useEffect, useState } from 'react'
import { Card, Avatar, Button, Spinner, Alert, EmptyState } from '../components/ui'
import { C } from '../lib/constants'
import { getSessionsForDate, hrSetSessions, todayISO } from '../lib/api.attendance'
import { getAllEmployees } from '../lib/api'

function timeToISO(dateStr, timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  // Use local time to avoid timezone shifts
  const d = new Date(dateStr + 'T00:00:00')
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

function isoToTime(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function OverrideRow({ employee, date, reviewerId, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [sessions, setSessions] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function startEditing() {
    const existing = await getSessionsForDate(employee.id, date)
    setSessions(existing.length
      ? existing.map(s => ({ checkIn: isoToTime(s.check_in), checkOut: isoToTime(s.check_out), isWFH: s.is_wfh }))
      : [{ checkIn: '', checkOut: '', isWFH: false }])
    setLoaded(true)
    setEditing(true)
  }

  function updateSession(i, field, value) {
    setSessions(ss => ss.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }
  function addSession() { setSessions(ss => [...ss, { checkIn: '', checkOut: '', isWFH: false }]) }
  function removeSession(i) { setSessions(ss => ss.filter((_, idx) => idx !== i)) }

  async function save() {
    if (!reason.trim()) { setError('Reason is required for audit trail.'); return }
    const valid = sessions.filter(s => s.checkIn && s.checkOut)
    if (valid.length === 0) { setError('At least one session with check-in and check-out is required.'); return }
    setSaving(true); setError('')
    try {
      await hrSetSessions(
        employee.id, date,
        valid.map(s => ({ checkIn: timeToISO(date, s.checkIn), checkOut: timeToISO(date, s.checkOut), isWFH: s.isWFH })),
        reviewerId, reason
      )
      setEditing(false)
      setReason('')
      onSaved()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ borderBottom: `1px solid ${C.border}`, padding: '14px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: editing ? 12 : 0 }}>
        <Avatar initials={employee?.avatar_initials || '??'} size={34} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{employee?.full_name}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{employee?.role} · {employee?.department}</div>
        </div>
        {!editing && (
          <Button variant="outline" size="sm" onClick={startEditing}>✏️ Edit Sessions</Button>
        )}
      </div>

      {editing && (
        <div>
          {sessions.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input type="time" value={s.checkIn} onChange={e => updateSession(i, 'checkIn', e.target.value)}
                style={{ padding: '6px 8px', borderRadius: 6, border: `1.5px solid ${C.border}`, fontSize: 12 }} />
              <input type="time" value={s.checkOut} onChange={e => updateSession(i, 'checkOut', e.target.value)}
                style={{ padding: '6px 8px', borderRadius: 6, border: `1.5px solid ${C.border}`, fontSize: 12 }} />
              <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={s.isWFH} onChange={e => updateSession(i, 'isWFH', e.target.checked)} /> WFH
              </label>
              {sessions.length > 1 && (
                <button onClick={() => removeSession(i)} style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer' }}>✕</button>
              )}
            </div>
          ))}
          <button onClick={addSession} style={{ background: 'none', border: 'none', color: C.brand, cursor: 'pointer', fontSize: 12, marginBottom: 10 }}>
            + Add session
          </button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (required)"
              style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: `1.5px solid ${C.border}`, fontSize: 12 }} />
            <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : '✓ Save'}</Button>
            <Button size="sm" variant="outline" onClick={() => { setEditing(false); setError('') }}>Cancel</Button>
          </div>
          {error && <div style={{ marginTop: 8 }}><Alert type="error" message={error} /></div>}
        </div>
      )}
    </div>
  )
}

export default function AttendanceOverridePanel({ reviewerId }) {
  const [date,      setDate]      = useState(todayISO())
  const [employees, setEmployees] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')

  async function load() {
    setLoading(true)
    try {
      const e = await getAllEmployees()
      setEmployees(e)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [date])

  const activeEmployees = employees
    .filter(e => e.status === 'active')
    .filter(e => !search || e.full_name.toLowerCase().includes(search.toLowerCase()))

  return (
    <Card padding="0">
      {/* Header */}
      <div style={{
        padding: '18px 24px', borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", flex: 1 }}>
          ✏️ Attendance Override
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search employee…"
          style={{ padding: '6px 12px', borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 12, width: 160, fontFamily: "'DM Sans',sans-serif" }}
        />
        <div>
          <label style={{ fontSize: 10, color: C.textLight, display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            max={todayISO()}
            min={(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0] })()}
            style={{ padding: '6px 10px', borderRadius: 7, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}
          />
        </div>
      </div>

      {/* Warning strip */}
      <div style={{
        padding: '10px 20px',
        background: C.amberSoft,
        borderBottom: `1px solid ${C.amber}20`,
        fontSize: 12, color: C.amber,
      }}>
        ⚠️ All overrides are logged with your name, timestamp and reason. You can edit attendance for up to 30 days back (current salary cycle). Half-day records automatically deduct 0.5 casual/sick leave.
      </div>

      {/* Employee rows */}
      {loading
        ? <div style={{ padding: 48, textAlign: 'center' }}><Spinner size={28} /></div>
        : activeEmployees.length === 0
          ? <EmptyState icon="👥" title="No employees found" />
          : activeEmployees.map(emp => (
              <OverrideRow key={emp.id} employee={emp} date={date} reviewerId={reviewerId} onSaved={load} />
            ))
      }
    </Card>
  )
}
