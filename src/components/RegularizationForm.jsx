import { useState } from 'react'
import { Card, Button, Alert, Spinner } from './ui'
import { C, FONTS } from '../lib/constants'
import { submitRegularizationRequest } from '../lib/api.attendanceRegularization'

function emptyRow() {
  return { date: '', proposedCheckIn: '', proposedCheckOut: '', reason: '' }
}

const today = new Date().toISOString().split('T')[0]

export default function RegularizationForm({ employeeId, onSubmitted, onClose }) {
  const [rows, setRows] = useState([emptyRow()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function updateRow(index, field, value) {
    setRows(rs => rs.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  function addRow() { setRows(rs => [...rs, emptyRow()]) }
  function removeRow(index) { setRows(rs => rs.filter((_, i) => i !== index)) }

  async function handleSubmit() {
    setError('')
    setSaving(true)
    try {
      await submitRegularizationRequest(employeeId, rows)
      onSubmitted()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(26,26,46,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <Card style={{ width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', padding: 0 }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>Request Attendance Regularization</div>
            <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>Submit corrected check-in/check-out times for review</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: C.textLight }}>✕</button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, padding: 12, background: C.surfaceAlt, borderRadius: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="date"
                  value={row.date}
                  max={today}
                  onChange={e => updateRow(i, 'date', e.target.value)}
                  style={{ flex: 1, padding: '8px 10px', borderRadius: 7, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none' }}
                />
                <input
                  type="time"
                  value={row.proposedCheckIn}
                  onChange={e => updateRow(i, 'proposedCheckIn', e.target.value)}
                  style={{ padding: '8px 10px', borderRadius: 7, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none' }}
                />
                <input
                  type="time"
                  value={row.proposedCheckOut}
                  onChange={e => updateRow(i, 'proposedCheckOut', e.target.value)}
                  style={{ padding: '8px 10px', borderRadius: 7, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none' }}
                />
                {rows.length > 1 && (
                  <button onClick={() => removeRow(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, padding: 4 }}>✕</button>
                )}
              </div>
              <input
                value={row.reason}
                onChange={e => updateRow(i, 'reason', e.target.value)}
                placeholder="Reason (e.g. forgot to check out)"
                style={{ padding: '8px 10px', borderRadius: 7, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none' }}
              />
            </div>
          ))}

          <button onClick={addRow} style={{ background: 'none', border: 'none', color: C.brand, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 16, padding: 0 }}>
            + Add another date
          </button>

          {error && <div style={{ marginBottom: 12 }}><Alert type="error" message={error} /></div>}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? <><Spinner size={14} /> Submitting…</> : 'Submit Request'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
