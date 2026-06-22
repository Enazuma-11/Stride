import { useEffect, useState } from 'react'
import AppShell from '../../components/layout/AppShell'
import { Card, Badge, Tag, Spinner, Alert, EmptyState, Select, Input, Textarea, SectionTitle } from '../../components/ui'
import { C, LEAVE_TYPES, FEMALE_ONLY_LEAVES, FONTS } from '../../lib/constants'
import { useResponsive } from '../../lib/responsive'
import { useAuth } from '../../context/AuthContext'
import { getMyLeaveBalances, getMyLeaveRequests, applyLeave, cancelLeave } from '../../lib/api'




function getApplicableLeaveTypes(gender) {
  return LEAVE_TYPES.filter(lt => {
    if (FEMALE_ONLY_LEAVES.includes(lt.id)) return gender === 'female'
    return true
  })
}

// ── Balance cards ─────────────────────────────────────────────────────────────
function BalanceStrip({ balances, gender }) {
  const applicable = getApplicableLeaveTypes(gender)
  const r = useResponsive()
  return (
    <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr 1fr' : `repeat(${Math.min(applicable.length, 4)}, 1fr)`, gap: 12, marginBottom: 24 }}>
      {applicable.map(lt => {
        const b         = balances.find(x => x.leave_type === lt.id)
        const used      = Number(b?.used_days  ?? 0)
        const total     = Number(b?.total_days ?? lt.total)
        const remaining = Math.max(0, total - used)
        const pct       = total > 0 ? (remaining / total) * 100 : 0
        return (
          <Card key={lt.id} style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 11, color: C.textLight, fontWeight: 600, marginBottom: 8 }}>{lt.label}</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 8 }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: lt.color, lineHeight: 1, fontFamily: FONTS.display }}>{remaining}</span>
              <span style={{ fontSize: 12, color: C.textLight, marginBottom: 2 }}>/ {total} days</span>
            </div>
            <div style={{ height: 3, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: lt.color, borderRadius: 4, transition: 'width 0.4s' }} />
            </div>
            <div style={{ fontSize: 10, color: C.textLight, marginTop: 4 }}>{used} used · {remaining} remaining</div>
            {b?.unpaid_days_taken > 0 && (
              <div style={{ fontSize: 10, color: '#ef4444', marginTop: 2, fontWeight: 600 }}>{b.unpaid_days_taken} unpaid</div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

// ── Apply form ────────────────────────────────────────────────────────────────
function ApplyForm({ employeeId, gender, balances, onApplied }) {
  const r          = useResponsive()
  const applicable = getApplicableLeaveTypes(gender)
  const [form, setForm]       = useState({ leaveType: 'casual_sick', fromDate: '', toDate: '', reason: '', isHalfDay: false })
  const [loading, setLoad]    = useState(false)
  const [error,   setError]   = useState('')
  const [success, setSuccess] = useState(false)
  const set = k => v => setForm(f => ({ ...f, [k]: v }))

  function handleHalfDay(val) {
    setForm(f => ({ ...f, isHalfDay: val, fromDate: '', toDate: '' }))
  }

  const days = form.isHalfDay ? 0.5
    : (form.fromDate && form.toDate)
      ? Math.max(0, Math.round((new Date(form.toDate) - new Date(form.fromDate)) / 86400000) + 1)
      : 0

  async function submit() {
    if (!form.fromDate || !form.reason.trim()) { setError('Date and reason are required.'); return }
    if (!form.isHalfDay && !form.toDate)       { setError('End date is required.'); return }
    if (!form.isHalfDay && new Date(form.toDate) < new Date(form.fromDate)) { setError('End date must be after start date.'); return }
    setLoad(true); setError('')
    try {
      const newLeave = await applyLeave({
        employeeId,
        leaveType:  form.leaveType,
        fromDate:   form.fromDate,
        toDate:     form.isHalfDay ? form.fromDate : form.toDate,
        days,
        reason:     form.isHalfDay ? `${form.reason} (Half Day)` : form.reason,
        isHalfDay:  form.isHalfDay,
      })
      onApplied(newLeave)
      setSuccess(true)
      setForm({ leaveType: 'casual_sick', fromDate: '', toDate: '', reason: '', isHalfDay: false })
      setTimeout(() => setSuccess(false), 3000)
    } catch (e) { setError(e.message) }
    finally { setLoad(false) }
  }

  // Pre-compute unpaid warning to avoid IIFE crash in JSX
  const _selBal     = balances.find(b => b.leave_type === form.leaveType)
  const _available  = _selBal ? Math.max(0, Number(_selBal.total_days) - Number(_selBal.used_days || 0)) : 0
  const _unpaid     = days > 0 ? Math.max(0, days - _available) : 0
  const _ltLabel    = LEAVE_TYPES.find(lt => lt.id === form.leaveType)?.label || ''
  const unpaidWarning = (days > 0 && _unpaid > 0) ? (
    <div style={{ background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 10, padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 18, flexShrink: 0 }}>⚠️</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 2 }}>
          Insufficient {_ltLabel} balance
        </div>
        <div style={{ fontSize: 12, color: '#92400e' }}>
          You have <strong>{_available} day{_available !== 1 ? 's' : ''}</strong> remaining.
          {' '}<strong>{_unpaid} day{_unpaid !== 1 ? 's' : ''}</strong> will be treated as <strong>unpaid leave (LOP)</strong> and may affect your salary.
        </div>
      </div>
    </div>
  ) : null

  return (
    <Card style={{ padding: '24px 28px' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: FONTS.display, marginBottom: 20 }}>
        Apply for Leave
      </div>

      {success && <div style={{ marginBottom: 14 }}><Alert type="success" message="Leave application submitted! HR will review it shortly." /></div>}
      {error   && <div style={{ marginBottom: 14 }}><Alert type="error"   message={error} /></div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Select label="Leave Type" value={form.leaveType} onChange={set('leaveType')}
          options={applicable.map(lt => ({ value: lt.id, label: lt.label }))} required />

        {/* Half day toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: form.isHalfDay ? `${C.teal}12` : C.bg, borderRadius: 10, border: `1.5px solid ${form.isHalfDay ? C.teal : C.border}`, cursor: 'pointer', transition: 'all 0.15s' }}
          onClick={() => handleHalfDay(!form.isHalfDay)}>
          <div style={{ width: 36, height: 20, borderRadius: 10, background: form.isHalfDay ? C.teal : C.border, position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
            <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: form.isHalfDay ? 18 : 2, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: form.isHalfDay ? C.teal : C.text }}>Half Day Leave</div>
            <div style={{ fontSize: 11, color: C.textLight }}>Only 0.5 days will be deducted from your balance</div>
          </div>
          {days > 0 && (
            <div style={{ fontSize: 13, fontWeight: 700, color: form.isHalfDay ? C.teal : C.brand }}>
              {days} day{days !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        {/* Dates */}
        <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : form.isHalfDay ? '1fr' : '1fr 1fr', gap: 12 }}>
          <Input label={form.isHalfDay ? 'Date' : 'From Date'} type="date" value={form.fromDate}
            onChange={v => setForm(f => ({ ...f, fromDate: v, toDate: f.isHalfDay ? v : f.toDate }))} required />
          {!form.isHalfDay && (
            <Input label="To Date" type="date" value={form.toDate} onChange={v => setForm(f => ({ ...f, toDate: v }))} required />
          )}
        </div>

        <Textarea label="Reason" value={form.reason} onChange={set('reason')} placeholder="Brief reason for your leave…" required />

        {/* Unpaid leave warning - plain variables, no IIFE */}
        {unpaidWarning}

        <button onClick={submit} disabled={loading || days === 0}
          style={{ padding: '12px 24px', borderRadius: 10, border: 'none', background: loading || days === 0 ? C.border : C.brand, color: loading || days === 0 ? C.textLight : '#fff', fontSize: 13, fontWeight: 700, cursor: loading || days === 0 ? 'not-allowed' : 'pointer', fontFamily: FONTS.display }}>
          {loading ? 'Submitting…' : 'Submit Leave Application'}
        </button>
      </div>
    </Card>
  )
}

// ── History with cancel ───────────────────────────────────────────────────────
function HistoryTable({ requests, employeeId, onCancelled }) {
  const [cancelling, setCancelling] = useState(null)
  const [error,      setError]      = useState('')

  async function handleCancel(leave) {
    const isApproved = leave.status === 'approved'
    const confirmed  = window.confirm(
      isApproved
        ? `This leave was approved. Cancelling will restore ${leave.days} day(s) to your balance. Continue?`
        : 'Cancel this leave request?'
    )
    if (!confirmed) return
    setCancelling(leave.id); setError('')
    try {
      await cancelLeave(leave.id, employeeId)
      onCancelled(leave.id)
    } catch (e) { setError(e.message) }
    finally { setCancelling(null) }
  }

  if (!requests.length) return <EmptyState icon="🏖️" title="No leave requests yet" subtitle="Your leave history will appear here." />

  return (
    <Card padding="0">
      {error && <div style={{ padding: '12px 16px' }}><Alert type="error" message={error} /></div>}
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>Leave History</div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.surfaceAlt }}>
              {['Type', 'Dates', 'Days', 'Reason', 'Applied', 'Status', ''].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: C.textLight, letterSpacing: 0.8, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {requests.map((r, i) => {
              const lt        = LEAVE_TYPES.find(t => t.id === r.leave_type)
              const canCancel = r.status === 'pending' || r.status === 'approved'
              const isSameDay = r.from_date === r.to_date
              return (
                <tr key={r.id} style={{ background: i % 2 === 0 ? C.surface : C.surfaceAlt }}>
                  <td style={{ padding: '11px 14px' }}>
                    <Tag label={lt?.label || r.leave_type} color={lt?.color || C.brand} />
                    {r.is_half_day && <span style={{ marginLeft: 6, fontSize: 9, color: C.teal, fontWeight: 700, background: `${C.teal}15`, padding: '1px 6px', borderRadius: 8 }}>HALF</span>}
                  </td>
                  <td style={{ padding: '11px 14px', color: C.textMid, whiteSpace: 'nowrap' }}>
                    {isSameDay ? r.from_date : `${r.from_date} → ${r.to_date}`}
                  </td>
                  <td style={{ padding: '11px 14px', fontWeight: 700, color: C.brand }}>{r.days}</td>
                  <td style={{ padding: '11px 14px', color: C.textMid, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason}</td>
                  <td style={{ padding: '11px 14px', color: C.textLight, whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleDateString('en-IN')}</td>
                  <td style={{ padding: '11px 14px' }}><Badge status={r.status} /></td>
                  <td style={{ padding: '11px 14px' }}>
                    {canCancel && (
                      <button onClick={() => handleCancel(r)} disabled={cancelling === r.id}
                        style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid #ef444440`, background: 'transparent', color: '#ef4444', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: FONTS.body }}>
                        {cancelling === r.id ? '…' : '✕ Cancel'}
                      </button>
                    )}
                  </td>
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
  const [tab,      setTab]      = useState('overview')
  const [loading,  setLoading]  = useState(true)

  async function load() {
    if (!employee) return
    const [b, r] = await Promise.all([getMyLeaveBalances(employee.id), getMyLeaveRequests(employee.id)])
    setBalances(b)
    setRequests(r)
    setLoading(false)
  }

  useEffect(() => { load() }, [employee])

  if (loading) return (
    <AppShell title="Leave Management">
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><Spinner size={36} /></div>
    </AppShell>
  )

  const gender = employee?.gender || 'prefer_not_to_say'

  return (
    <AppShell title="Leave Management" subtitle="Manage your leave requests and balances">
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: C.surface, padding: 5, borderRadius: 10, width: 'fit-content', boxShadow: C.shadow }}>
        {[
          { id: 'overview', label: '📊 Overview' },
          { id: 'apply',    label: '+ Apply'     },
          { id: 'history',  label: '📋 History'  },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 18px', borderRadius: 7, border: 'none',
            background: tab === t.id ? C.brand : 'transparent',
            color: tab === t.id ? '#fff' : C.textMid,
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: FONTS.display, transition: 'all 0.15s',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Balance strip shown on overview + apply tabs */}
      {(tab === 'overview' || tab === 'apply') && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Your Leave Balances</SectionTitle>
          <BalanceStrip balances={balances} gender={gender} />
        </div>
      )}

      {tab === 'overview' && (
        <HistoryTable
          requests={requests.slice(0, 5)}
          employeeId={employee.id}
          onCancelled={id => { setRequests(r => r.filter(x => x.id !== id)); load() }}
        />
      )}
      {tab === 'apply' && (
        <ApplyForm
          employeeId={employee.id}
          gender={gender}
          balances={balances}
          onApplied={l => { setRequests(r => [l, ...r]); setTab('overview'); load() }}
        />
      )}
      {tab === 'history' && (
        <HistoryTable
          requests={requests}
          employeeId={employee.id}
          onCancelled={id => { setRequests(r => r.filter(x => x.id !== id)); load() }}
        />
      )}
    </AppShell>
  )
}
