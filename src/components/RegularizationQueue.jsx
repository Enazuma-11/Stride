import { useEffect, useState } from 'react'
import { Card, Avatar, Button, Spinner, EmptyState, Alert } from './ui'
import { C, FONTS } from '../lib/constants'
import { formatTime } from '../lib/api.attendance'
import {
  getManagerPendingItems, managerDecideItem,
  getAdminPendingItems, adminApplyItem, adminRejectItem,
  getManagerPendingRequests,
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
    // `<input type="time">` gives a local wall-clock HH:MM with no timezone
    // info — anchor to local midnight so it round-trips symmetrically with
    // isoToTime() above (which reads back via local getHours/getMinutes).
    const d = new Date(`${item.date}T00:00:00`)
    d.setHours(h, m, 0, 0)
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
  const [pendingManagerRequests, setPendingManagerRequests] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      if (mode === 'admin') {
        const [adminItems, managerQueue] = await Promise.all([
          getAdminPendingItems(reviewerId),
          getManagerPendingRequests(),
        ])
        setItems(adminItems)
        setPendingManagerRequests(managerQueue)
      } else {
        setItems(await getManagerPendingItems(reviewerId))
      }
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
        : <>
            {items.length === 0 && pendingManagerRequests.length === 0
              ? <EmptyState icon="✅" title="Nothing pending" />
              : items.map(item => mode === 'admin'
                  ? <AdminApplyRow key={item.id} item={item} reviewerId={reviewerId} onDone={load} />
                  : <ManagerRow key={item.id} item={item} reviewerId={reviewerId} onDone={load} />
                )
            }
            {mode === 'admin' && pendingManagerRequests.length > 0 && (
              <div style={{ padding: '12px 20px', borderTop: items.length > 0 ? `1px solid ${C.border}` : 'none' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  Awaiting Manager Approval ({pendingManagerRequests.length})
                </div>
                {pendingManagerRequests.map(r => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.border}` }}>
                    <Avatar initials={r.employee?.avatar_initials || '??'} size={28} />
                    <div style={{ flex: 1, fontSize: 13, color: C.textMid }}>{r.employee?.full_name}</div>
                    <span style={{ fontSize: 11, color: C.amber, fontWeight: 600, padding: '3px 10px', background: C.amberSoft, borderRadius: 20 }}>Pending manager</span>
                  </div>
                ))}
              </div>
            )}
          </>
      }
    </Card>
  )
}
