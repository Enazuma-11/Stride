import { useEffect, useState } from 'react'
import { Card, Avatar, Button, Spinner, Alert, EmptyState } from '../components/ui'
import { C, ATTENDANCE_STATUSES } from '../lib/constants'
import { getTeamAttendanceByDate, todayISO } from '../lib/api.attendance'
import { overrideCheckTime } from '../lib/api.profile'
import { getAllEmployees } from '../lib/api'
import { supabase } from '../lib/supabase'

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

function StatusBadge({ status }) {
  const s = ATTENDANCE_STATUSES.find(a => a.value === status)
  if (!s) return <span style={{ fontSize: 11, color: C.textLight }}>No record</span>
  return (
    <span style={{
      background: s.bg, color: s.color,
      fontSize: 10, fontWeight: 600, padding: '2px 8px',
      borderRadius: 20, whiteSpace: 'nowrap',
    }}>{s.icon} {s.label}</span>
  )
}

function OverrideRow({ record, employee, reviewerId, date, onSaved }) {
  const [editing,  setEditing]  = useState(false)
  const [checkIn,  setCheckIn]  = useState(isoToTime(record?.check_in))
  const [checkOut, setCheckOut] = useState(isoToTime(record?.check_out))
  const [wfh,      setWfh]      = useState(record?.is_wfh || false)
  const [reason,   setReason]   = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  async function save() {
    if (!reason.trim()) { setError('Reason is required for audit trail.'); return }
    if (!checkIn)       { setError('Check-in time is required.'); return }
    setSaving(true); setError('')

    try {
      let recordId = record?.id

      // If no record exists yet, create one first
      if (!recordId) {
        const { data: newRecord, error: createErr } = await supabase
          .from('attendance')
          .insert({
            employee_id: employee.id,
            date,
            is_wfh:      wfh,
            status:      'present',
            hr_override: true,
          })
          .select()
          .single()
        if (createErr) throw createErr
        recordId = newRecord.id
      }

      // Override check-in
      if (checkIn) {
        await overrideCheckTime(
          recordId, employee.id, date,
          'check_in', timeToISO(date, checkIn),
          reason, reviewerId
        )
      }

      // Override check-out
      if (checkOut) {
        await overrideCheckTime(
          recordId, employee.id, date,
          'check_out', timeToISO(date, checkOut),
          reason, reviewerId
        )
      }

      // Update WFH flag
      await supabase.from('attendance').update({ is_wfh: wfh }).eq('id', recordId)

      setEditing(false)
      setReason('')
      onSaved()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar initials={employee?.avatar_initials || '??'} size={34} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{employee?.full_name}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{employee?.role} · {employee?.department}</div>
        </div>

        {!editing ? (
          <>
            <div style={{ display: 'flex', gap: 20, fontSize: 12, alignItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: C.textLight, fontSize: 10, marginBottom: 3 }}>CHECK IN</div>
                <div style={{ fontWeight: 700, color: record?.check_in ? C.green : C.textLight }}>
                  {record?.check_in ? isoToTime(record.check_in) : '—'}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: C.textLight, fontSize: 10, marginBottom: 3 }}>CHECK OUT</div>
                <div style={{ fontWeight: 700, color: record?.check_out ? C.accent : C.textLight }}>
                  {record?.check_out ? isoToTime(record.check_out) : '—'}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: C.textLight, fontSize: 10, marginBottom: 3 }}>HOURS</div>
                <div style={{ fontWeight: 700, color: C.amber }}>
                  {record?.hours_worked ? `${record.hours_worked}h` : '—'}
                </div>
              </div>
              <StatusBadge status={record?.status} />
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              ✏️ Edit
            </Button>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: 10, color: C.textLight, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Check In *</label>
              <input type="time" value={checkIn} onChange={e => setCheckIn(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: 7, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: "'DM Sans',sans-serif", width: 120 }} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: C.textLight, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Check Out</label>
              <input type="time" value={checkOut} onChange={e => setCheckOut(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: 7, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: "'DM Sans',sans-serif", width: 120 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <input type="checkbox" id={`wfh-${employee.id}`} checked={wfh} onChange={e => setWfh(e.target.checked)} />
              <label htmlFor={`wfh-${employee.id}`} style={{ fontSize: 12, cursor: 'pointer', color: C.textMid }}>WFH</label>
            </div>
            <div>
              <label style={{ fontSize: 10, color: C.textLight, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Reason *</label>
              <input
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="e.g. Forgot to check out"
                style={{ padding: '8px 10px', borderRadius: 7, border: `1.5px solid ${C.border}`, fontSize: 12, width: 200, fontFamily: "'DM Sans',sans-serif" }}
              />
            </div>
            <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : '✓ Save'}</Button>
            <Button size="sm" variant="outline" onClick={() => { setEditing(false); setError('') }}>Cancel</Button>
          </div>
        )}
      </div>
      {error && (
        <div style={{ padding: '0 20px 12px' }}>
          <Alert type="error" message={error} />
        </div>
      )}
    </div>
  )
}

export default function AttendanceOverridePanel({ reviewerId }) {
  const [date,      setDate]      = useState(todayISO())
  const [records,   setRecords]   = useState([])
  const [employees, setEmployees] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')

  async function load() {
    setLoading(true)
    try {
      const [r, e] = await Promise.all([
        getTeamAttendanceByDate(date),
        getAllEmployees(),
      ])
      setRecords(r)
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
              <OverrideRow
                key={emp.id}
                record={records.find(r => r.employee_id === emp.id)}
                employee={emp}
                reviewerId={reviewerId}
                date={date}
                onSaved={load}
              />
            ))
      }
    </Card>
  )
}
