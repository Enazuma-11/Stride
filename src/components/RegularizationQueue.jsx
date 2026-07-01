import { useEffect, useState } from 'react'
import { Card, Avatar, Button, Spinner, EmptyState, Alert } from './ui'
import { C, FONTS } from '../lib/constants'
import { formatTime } from '../lib/api.attendance'
import {
  getManagerPendingItems, managerDecideItem,
  getAdminPendingItems, adminApplyItem, adminRejectItem,
} from '../lib/api.attendanceRegularization'

function isoToTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function AdminApplyRow({ item, reviewerId, onDone }) {
  const [checkIn, setCheckIn] = useState(isoToTime(item.proposed_check_in))
  const [checkOut, setCheckOut] = useState(isoToTime(item.proposed_check_out))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function timeToISO(timeStr) {
    const [h, m] = timeStr.split(':').map(Number)
    const d = new Date(`${item.date}T00:00:00.000Z`)
    d.setUTCHours(h, m, 0, 0)
    return d.toISOString()
  }

  async function apply() {
    setSaving(true); setError('')
    try {
      await adminApplyItem(item.id, timeToISO(checkIn), timeToISO(checkOut), reviewerId)
      onDone()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function reject() {
    setSaving(true); setError('')
    try {
      await adminRejectItem(item.id, reviewerId)
      onDone()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ padding: 14, borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <Avatar initials={item.request?.employee?.avatar_initials || '??'} size={30} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{item.request?.employee?.full_name}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{item.date} — {item.reason}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="time" value={checkIn} onChange={e => setCheckIn(e.target.value)}
          style={{ padding: '6px 8px', borderRadius: 6, border: `1.5px solid ${C.border}`, fontSize: 12 }} />
        <input type="time" value={checkOut} onChange={e => setCheckOut(e.target.value)}
          style={{ padding: '6px 8px', borderRadius: 6, border: `1.5px solid ${C.border}`, fontSize: 12 }} />
        <Button size="sm" onClick={apply} disabled={saving}>Apply</Button>
        <Button size="sm" variant="outline" onClick={reject} disabled={saving}>Reject</Button>
      </div>
      {error && <div style={{ marginTop: 8 }}><Alert type="error" message={error} /></div>}
    </div>
  )
}

function ManagerRow({ item, reviewerId, onDone }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function decide(decision) {
    setSaving(true); setError('')
    try {
      await managerDecideItem(item.id, decision, reviewerId)
      onDone()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ padding: 14, borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Avatar initials={item.request?.employee?.avatar_initials || '??'} size={30} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{item.request?.employee?.full_name}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{item.date} — {item.reason}</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: C.textMid, marginBottom: 8 }}>
        Proposed: {formatTime(item.proposed_check_in)} – {formatTime(item.proposed_check_out)}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="sm" onClick={() => decide('approved')} disabled={saving}>Approve</Button>
        <Button size="sm" variant="outline" onClick={() => decide('rejected')} disabled={saving}>Reject</Button>
      </div>
      {error && <div style={{ marginTop: 8 }}><Alert type="error" message={error} /></div>}
    </div>
  )
}

export default function RegularizationQueue({ mode, reviewerId }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const data = mode === 'admin'
        ? await getAdminPendingItems(reviewerId)
        : await getManagerPendingItems(reviewerId)
      setItems(data)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [mode, reviewerId])

  return (
    <Card padding="0">
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, fontSize: 15, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>
        {mode === 'admin' ? '📋 Regularizations Awaiting Final Approval' : '📋 Team Regularization Requests'}
      </div>
      {loading
        ? <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={24} /></div>
        : items.length === 0
          ? <EmptyState icon="✅" title="Nothing pending" />
          : items.map(item => mode === 'admin'
              ? <AdminApplyRow key={item.id} item={item} reviewerId={reviewerId} onDone={load} />
              : <ManagerRow key={item.id} item={item} reviewerId={reviewerId} onDone={load} />
            )
      }
    </Card>
  )
}
