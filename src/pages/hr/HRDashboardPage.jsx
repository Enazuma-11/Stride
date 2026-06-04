import { useEffect, useState } from 'react'
import AppShell from '../../components/layout/AppShell'
import { Card, Avatar, Button, Badge, Tag, Spinner, EmptyState, SectionTitle } from '../../components/ui'
import { C, LEAVE_TYPES } from '../../lib/constants'
import { useAuth } from '../../context/AuthContext'
import { getAllLeaveRequests, updateLeaveStatus } from '../../lib/api'

// ── Stat cards ────────────────────────────────────────────────────────────────
function StatCards({ requests }) {
  const stats = [
    { label: 'Pending Approvals',   val: requests.filter(r => r.status === 'pending').length,  color: C.amber,  bg: C.amberSoft  },
    { label: 'Approved This Month', val: requests.filter(r => r.status === 'approved').length, color: C.green,  bg: C.greenSoft  },
    { label: 'Rejected',            val: requests.filter(r => r.status === 'rejected').length, color: C.accent, bg: C.accentSoft },
    { label: 'Total Requests',      val: requests.length,                                      color: C.brand,  bg: C.brandLight },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 28 }}>
      {stats.map(s => (
        <Card key={s.label} style={{ padding: '20px 24px', borderLeft: `4px solid ${s.color}` }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: s.color, fontFamily: "'Sora',sans-serif" }}>{s.val}</div>
          <div style={{ fontSize: 12, color: C.textMid, marginTop: 4 }}>{s.label}</div>
        </Card>
      ))}
    </div>
  )
}

// ── Pending queue ─────────────────────────────────────────────────────────────
function PendingQueue({ requests, onAction }) {
  const pending = requests.filter(r => r.status === 'pending')
  if (!pending.length) return (
    <EmptyState icon="✅" title="All caught up!" subtitle="No pending leave requests." />
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {pending.map(r => {
        const emp = r.employee
        const lt  = LEAVE_TYPES.find(t => t.id === r.leave_type)
        return (
          <Card key={r.id} style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Avatar initials={emp?.avatar_initials || '??'} size={44} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: C.text, marginBottom: 2 }}>{emp?.full_name}</div>
                <div style={{ fontSize: 12, color: C.textMid, marginBottom: 8 }}>
                  {emp?.role} · {emp?.department}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                  <Tag label={lt?.label || r.leave_type} color={lt?.color || C.brand} />
                  <span style={{ fontSize: 12, color: C.textLight }}>{r.from_date} → {r.to_date}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.brand }}>{r.days} day{r.days > 1 ? 's' : ''}</span>
                </div>
                <div style={{ fontSize: 12, color: C.textMid, fontStyle: 'italic' }}>"{r.reason}"</div>
                <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>
                  Applied {new Date(r.created_at).toLocaleDateString('en-IN')}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="success" size="sm" onClick={() => onAction(r.id, 'approved')}>✓ Approve</Button>
                <Button variant="ghost"   size="sm" onClick={() => onAction(r.id, 'rejected')}>✕ Reject</Button>
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// ── All requests table ────────────────────────────────────────────────────────
function AllRequestsTable({ requests, onAction }) {
  const [filter, setFilter] = useState('all')
  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter)

  return (
    <Card padding="0">
      {/* Table header + filter */}
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", flex: 1 }}>All Leave Requests</div>
        {['all','pending','approved','rejected'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '5px 14px', borderRadius: 6,
            border: filter === f ? `1.5px solid ${C.brand}` : `1px solid ${C.border}`,
            background: filter === f ? C.brandLight : 'transparent',
            color: filter === f ? C.brand : C.textMid,
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
            fontFamily: "'DM Sans',sans-serif", textTransform: 'capitalize',
          }}>{f}</button>
        ))}
      </div>
      {filtered.length === 0
        ? <EmptyState icon="📋" title="No requests" subtitle="No records match the filter." />
        : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.surfaceAlt }}>
                  {['Employee','Type','Dates','Days','Reason','Status','Actions'].map(h => (
                    <th key={h} style={{
                      padding: '11px 16px', textAlign: 'left',
                      fontSize: 11, fontWeight: 700, color: C.textLight,
                      letterSpacing: 0.5, textTransform: 'uppercase',
                      borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const emp = r.employee
                  const lt  = LEAVE_TYPES.find(t => t.id === r.leave_type)
                  return (
                    <tr key={r.id} style={{ background: i % 2 === 0 ? C.surface : C.surfaceAlt }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Avatar initials={emp?.avatar_initials || '??'} size={28} />
                          <div>
                            <div style={{ fontWeight: 600, color: C.text, fontSize: 13 }}>{emp?.full_name}</div>
                            <div style={{ fontSize: 11, color: C.textLight }}>{emp?.department}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}><Tag label={lt?.label || r.leave_type} color={lt?.color || C.brand} /></td>
                      <td style={{ padding: '12px 16px', color: C.textMid, fontSize: 12 }}>{r.from_date}<br />{r.to_date}</td>
                      <td style={{ padding: '12px 16px', fontWeight: 700, color: C.brand }}>{r.days}</td>
                      <td style={{ padding: '12px 16px', color: C.textMid, maxWidth: 180, fontSize: 12 }}>{r.reason}</td>
                      <td style={{ padding: '12px 16px' }}><Badge status={r.status} /></td>
                      <td style={{ padding: '12px 16px' }}>
                        {r.status === 'pending' && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <Button variant="success" size="sm" onClick={() => onAction(r.id, 'approved')}>✓</Button>
                            <Button variant="ghost"   size="sm" onClick={() => onAction(r.id, 'rejected')}>✕</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      }
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function HRDashboardPage() {
  const { employee } = useAuth()
  const [requests, setRequests] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [tab, setTab]           = useState('pending')

  useEffect(() => {
    getAllLeaveRequests()
      .then(setRequests)
      .finally(() => setLoading(false))
  }, [])

  async function handleAction(leaveId, status) {
    try {
      const updated = await updateLeaveStatus(leaveId, status, employee.id)
      setRequests(rs => rs.map(r => r.id === leaveId ? { ...r, status } : r))
      // Send in-app notification
      await notifyLeaveDecision(updated, updated.employee_id, status)
      // Send email notification
      const emp = requests.find(r => r.id === leaveId)?.employee
      if (emp?.email) {
        sendLeaveDecisionEmail({
          toEmail:   emp.email,
          toName:    emp.full_name,
          status,
          leaveType: updated.leave_type?.replace('_', '/'),
          fromDate:  updated.from_date,
          toDate:    updated.to_date,
          days:      updated.days,
        }).catch(() => {})
      }
    } catch (e) {
      alert('Error: ' + e.message)
    }
  }

  if (loading) return (
    <AppShell title="HR Dashboard">
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><Spinner size={36} /></div>
    </AppShell>
  )

  return (
    <AppShell title="HR Dashboard — Leave Management" subtitle="Review and manage all employee leave requests">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap'); @keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <StatCards requests={requests} />

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: C.surface, padding: 6, borderRadius: 10, width: 'fit-content', boxShadow: C.shadow }}>
        {[{ id: 'pending', label: `Pending (${requests.filter(r=>r.status==='pending').length})` }, { id: 'all', label: 'All Requests' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 20px', borderRadius: 7, border: 'none',
            background: tab === t.id ? C.brand : 'transparent',
            color: tab === t.id ? '#fff' : C.textMid,
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: "'Sora',sans-serif",
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'pending' && <PendingQueue requests={requests} onAction={handleAction} />}
      {tab === 'all'     && <AllRequestsTable requests={requests} onAction={handleAction} />}
    </AppShell>
  )
}
