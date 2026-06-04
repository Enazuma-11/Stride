import { useEffect, useState } from 'react'
import AppShell from '../../components/layout/AppShell'
import { Card, Badge, Tag, Spinner, Alert, EmptyState, Select, Input, Textarea, SectionTitle } from '../../components/ui'
import { C, LEAVE_TYPES, FEMALE_ONLY_LEAVES } from '../../lib/constants'
import { useResponsive, cols } from '../../lib/responsive'
import { useAuth } from '../../context/AuthContext'
import { getMyLeaveBalances, getMyLeaveRequests, applyLeave } from '../../lib/api'

// Filter leave types based on employee gender
function getApplicableLeaveTypes(gender) {
  return LEAVE_TYPES.filter(lt => {
    if (FEMALE_ONLY_LEAVES.includes(lt.id)) return gender === 'female'
    return true
  })
}

// ── Balance strip ─────────────────────────────────────────────────────────────
function BalanceStrip({ balances, gender }) {
  const applicable = getApplicableLeaveTypes(gender)
  const r = useResponsive()
  const colCount = applicable.length <= 4 ? applicable.length : 4
  return (
    <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr 1fr' : `repeat(${colCount},1fr)`, gap: r.isMobile ? 10 : 12, marginBottom: 28 }}>
      {applicable.map(lt => {
        const b = balances.find(x => x.leave_type === lt.id)
        const remaining = b?.remaining ?? lt.total
        const total     = b?.total_days ?? lt.total
        const pct       = total > 0 ? (remaining / total) * 100 : 0
        return (
          <Card key={lt.id} style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: 11, color: C.textLight, fontWeight: 600, marginBottom: 8 }}>
              {lt.label}
              {FEMALE_ONLY_LEAVES.includes(lt.id) && (
                <span style={{ marginLeft: 6, fontSize: 9, background: C.pinkSoft || '#FCE7F3', color: C.pink || '#9D174D', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>
                  ♀
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, marginBottom: 8 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: lt.color, lineHeight: 1, fontFamily: "'Sora',sans-serif" }}>
                {remaining}
              </span>
              <span style={{ fontSize: 12, color: C.textLight, marginBottom: 2 }}>/ {total} days</span>
            </div>
            <div style={{ height: 3, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: lt.color, borderRadius: 4 }} />
            </div>
            {lt.info && <div style={{ fontSize: 10, color: C.textLight, marginTop: 6 }}>{lt.info}</div>}
          </Card>
        )
      })}
    </div>
  )
}

// ── Apply form ────────────────────────────────────────────────────────────────
function ApplyForm({ employeeId, gender, onApplied }) {
  const r = useResponsive()
  const applicable = getApplicableLeaveTypes(gender)
  const [form, setForm]       = useState({ leaveType: 'casual_sick', fromDate: '', toDate: '', reason: '' })
  const [loading, setLoad]    = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState(false)

  const days = form.fromDate && form.toDate
    ? Math.max(0, Math.round((new Date(form.toDate) - new Date(form.fromDate)) / 86400000) + 1)
    : 0

  async function submit() {
    if (!form.fromDate || !form.toDate || !form.reason.trim()) { setError('All fields are required.'); return }
    if (new Date(form.toDate) < new Date(form.fromDate)) { setError('End date must be after start date.'); return }
    setLoad(true); setError('')
    try {
      const newLeave = await applyLeave({ employeeId, ...form, days })
      onApplied(newLeave)
      setSuccess(true)
      setForm({ leaveType: 'casual_sick', fromDate: '', toDate: '', reason: '' })
      setTimeout(() => setSuccess(false), 3000)
    } catch (e) { setError(e.message) }
    finally { setLoad(false) }
  }

  return (
    <Card style={{ padding: '28px 32px' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", marginBottom: 24 }}>
        Apply for Leave
      </div>

      {success && <div style={{ marginBottom: 16 }}><Alert type="success" message="Leave application submitted! HR will review it shortly." /></div>}
      {error   && <div style={{ marginBottom: 16 }}><Alert type="error"   message={error} /></div>}

      <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <Select
          label="Leave Type"
          value={form.leaveType}
          onChange={v => setForm(f => ({ ...f, leaveType: v }))}
          options={applicable.map(lt => ({ value: lt.id, label: lt.label }))}
          required
        />
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <div style={{
            padding: '10px 18px', borderRadius: 8,
            background: days > 0 ? C.brandLight : C.surfaceAlt,
            border: `1.5px solid ${days > 0 ? C.brand + '40' : C.border}`,
            fontSize: 13, color: days > 0 ? C.brand : C.textLight, fontWeight: 600,
          }}>
            {days > 0 ? `${days} working day${days > 1 ? 's' : ''}` : 'Select dates'}
          </div>
        </div>
        <Input label="From Date" type="date" value={form.fromDate} onChange={v => setForm(f => ({ ...f, fromDate: v }))} required />
        <Input label="To Date"   type="date" value={form.toDate}   onChange={v => setForm(f => ({ ...f, toDate: v }))}   required />
      </div>

      <div style={{ marginBottom: 24 }}>
        <Textarea label="Reason" value={form.reason} onChange={v => setForm(f => ({ ...f, reason: v }))}
          placeholder="Brief reason for your leave…" required />
      </div>

      <button onClick={submit} disabled={loading} style={{
        padding: '12px 28px', borderRadius: 8, border: 'none',
        background: loading ? C.border : C.brand, color: loading ? C.textLight : '#fff',
        fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
        fontFamily: "'Sora',sans-serif", boxShadow: loading ? 'none' : `0 4px 12px ${C.brand}40`,
      }}>
        {loading ? 'Submitting…' : 'Submit Application'}
      </button>
    </Card>
  )
}

// ── History table ─────────────────────────────────────────────────────────────
function HistoryTable({ requests }) {
  if (!requests.length) return <EmptyState icon="🏖️" title="No leave requests yet" subtitle="Your leave history will appear here." />
  return (
    <Card padding="0">
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif" }}>Leave History</div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.surfaceAlt }}>
              {['Type','From','To','Days','Reason','Applied On','Status'].map(h => (
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
            {requests.map((r, i) => {
              const lt = LEAVE_TYPES.find(t => t.id === r.leave_type)
              return (
                <tr key={r.id} style={{ background: i % 2 === 0 ? C.surface : C.surfaceAlt }}>
                  <td style={{ padding: '12px 16px' }}><Tag label={lt?.label || r.leave_type} color={lt?.color || C.brand} /></td>
                  <td style={{ padding: '12px 16px', color: C.textMid }}>{r.from_date}</td>
                  <td style={{ padding: '12px 16px', color: C.textMid }}>{r.to_date}</td>
                  <td style={{ padding: '12px 16px', fontWeight: 700, color: C.brand }}>{r.days}</td>
                  <td style={{ padding: '12px 16px', color: C.textMid, maxWidth: 200 }}>{r.reason}</td>
                  <td style={{ padding: '12px 16px', color: C.textLight }}>{new Date(r.created_at).toLocaleDateString('en-IN')}</td>
                  <td style={{ padding: '12px 16px' }}><Badge status={r.status} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LeavePage() {
  const { employee } = useAuth()
  const [balances, setBalances] = useState([])
  const [requests, setRequests] = useState([])
  const [tab, setTab]           = useState('overview')
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    if (!employee) return
    Promise.all([
      getMyLeaveBalances(employee.id),
      getMyLeaveRequests(employee.id),
    ]).then(([b, r]) => { setBalances(b); setRequests(r) })
      .finally(() => setLoading(false))
  }, [employee])

  if (loading) return (
    <AppShell title="Leave Management">
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><Spinner size={36} /></div>
    </AppShell>
  )

  const gender = employee?.gender || 'prefer_not_to_say'

  return (
    <AppShell title="Leave Management" subtitle="Manage your leave requests and balances">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap'); @keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 28, background: C.surface, padding: 6, borderRadius: 10, width: 'fit-content', boxShadow: C.shadow }}>
        {[{ id: 'overview', label: 'Overview' }, { id: 'apply', label: 'Apply Leave' }, { id: 'history', label: 'History' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 20px', borderRadius: 7, border: 'none',
            background: tab === t.id ? C.brand : 'transparent',
            color: tab === t.id ? '#fff' : C.textMid,
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: "'Sora',sans-serif", transition: 'all 0.15s',
          }}>{t.label}</button>
        ))}
      </div>

      {(tab === 'overview' || tab === 'apply') && (
        <div style={{ marginBottom: 28 }}>
          <SectionTitle>Your Leave Balances</SectionTitle>
          <BalanceStrip balances={balances} gender={gender} />
        </div>
      )}

      {tab === 'overview' && <HistoryTable requests={requests} />}
      {tab === 'apply'    && <ApplyForm employeeId={employee.id} gender={gender} onApplied={l => setRequests(r => [l, ...r])} />}
      {tab === 'history'  && <HistoryTable requests={requests} />}
    </AppShell>
  )
}
