import { useEffect, useState } from 'react'
import { Card, Avatar, Button, Input, Spinner, Alert, EmptyState } from '../components/ui'
import { C } from '../lib/constants'
import { getTeamAttendanceByDate, todayISO } from '../lib/api.attendance'
import { overrideCheckTime } from '../lib/api.profile'
import { getAllEmployees } from '../lib/api'

function timeToISO(date, timeStr) {
  // Combine a date string with HH:MM to full ISO
  const [h, m] = timeStr.split(':').map(Number)
  const d = new Date(date)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

function isoToTime(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function OverrideRow({ record, employee, reviewerId, onSaved }) {
  const [editing,  setEditing]  = useState(false)
  const [checkIn,  setCheckIn]  = useState(isoToTime(record?.check_in))
  const [checkOut, setCheckOut] = useState(isoToTime(record?.check_out))
  const [reason,   setReason]   = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  async function save() {
    if (!reason.trim()) { setError('Reason is required.'); return }
    setSaving(true); setError('')
    try {
      if (checkIn && checkIn !== isoToTime(record?.check_in)) {
        await overrideCheckTime(
          record.id, employee.id, record.date,
          'check_in', timeToISO(record.date, checkIn),
          reason, reviewerId
        )
      }
      if (checkOut && checkOut !== isoToTime(record?.check_out)) {
        await overrideCheckTime(
          record.id, employee.id, record.date,
          'check_out', timeToISO(record.date, checkOut),
          reason, reviewerId
        )
      }
      setEditing(false)
      onSaved()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{
      padding: '14px 20px',
      borderBottom: `1px solid ${C.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar initials={employee?.avatar_initials || '??'} size={34} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{employee?.full_name}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{employee?.department}</div>
        </div>

        {!editing ? (
          <>
            <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: C.textLight, marginBottom: 2 }}>Check In</div>
                <div style={{ fontWeight: 700, color: record?.check_in ? C.green : C.textLight }}>
                  {record?.check_in ? isoToTime(record.check_in) : '—'}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: C.textLight, marginBottom: 2 }}>Check Out</div>
                <div style={{ fontWeight: 700, color: record?.check_out ? C.accent : C.textLight }}>
                  {record?.check_out ? isoToTime(record.check_out) : '—'}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: C.textLight, marginBottom: 2 }}>Hours</div>
                <div style={{ fontWeight: 700, color: C.amber }}>
                  {record?.hours_worked ? `${record.hours_worked}h` : '—'}
                </div>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              ✏️ Edit
            </Button>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: C.textLight, display: 'block', marginBottom: 4 }}>Check In</label>
              <input type="time" value={checkIn} onChange={e => setCheckIn(e.target.value)}
                style={{ padding: '7px 10px', borderRadius: 7, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: "'DM Sans',sans-serif" }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: C.textLight, display: 'block', marginBottom: 4 }}>Check Out</label>
              <input type="time" value={checkOut} onChange={e => setCheckOut(e.target.value)}
                style={{ padding: '7px 10px', borderRadius: 7, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: "'DM Sans',sans-serif" }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: C.textLight, display: 'block', marginBottom: 4 }}>Reason *</label>
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Employee forgot to check out"
                style={{ padding: '7px 10px', borderRadius: 7, border: `1.5px solid ${C.border}`, fontSize: 13, width: 220, fontFamily: "'DM Sans',sans-serif" }} />
            </div>
            <Button size="sm" onClick={save} disabled={saving}>{saving ? '…' : 'Save'}</Button>
            <Button size="sm" variant="outline" onClick={() => { setEditing(false); setError('') }}>Cancel</Button>
          </div>
        )}
      </div>
      {error && <div style={{ marginTop: 8 }}><Alert type="error" message={error} /></div>}
    </div>
  )
}

export default function AttendanceOverridePanel({ reviewerId }) {
  const [date,      setDate]      = useState(todayISO())
  const [records,   setRecords]   = useState([])
  const [employees, setEmployees] = useState([])
  const [loading,   setLoading]   = useState(true)

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

  const activeEmployees = employees.filter(e => e.status === 'active')

  return (
    <Card padding="0">
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", flex: 1 }}>
          ✏️ Attendance Override
        </div>
        <div>
          <label style={{ fontSize: 11, color: C.textLight, display: 'block', marginBottom: 4 }}>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 7, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: "'DM Sans',sans-serif" }} />
        </div>
      </div>

      <div style={{ padding: '12px 20px', background: C.amberSoft, borderBottom: `1px solid ${C.amber}20`, fontSize: 12, color: C.amber }}>
        ⚠️ All overrides are logged with your name, timestamp, and reason. Use only for legitimate corrections.
      </div>

      {loading
        ? <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={28} /></div>
        : activeEmployees.length === 0
          ? <EmptyState icon="👥" title="No active employees" />
          : activeEmployees.map(emp => {
              const record = records.find(r => r.employee_id === emp.id)
              return (
                <OverrideRow
                  key={emp.id}
                  record={record}
                  employee={emp}
                  reviewerId={reviewerId}
                  onSaved={load}
                />
              )
            })
      }
    </Card>
  )
}
