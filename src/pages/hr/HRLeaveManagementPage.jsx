import { useEffect, useState } from 'react'
import AppShell from '../../components/layout/AppShell'
import { Card, Avatar, Button, Spinner, Alert, EmptyState, Badge, Input, Select } from '../../components/ui'
import { C, FONTS, LEAVE_TYPES } from '../../lib/constants'
import { useAuth } from '../../context/AuthContext'
import { useResponsive, cols } from '../../lib/responsive'
import DateRangePicker from '../../components/DateRangePicker'
import {
  getAllEmployees,
  getAllLeaveBalances,
  hrAdjustLeave,
  hrSetLeaveBalance,
  hrRecordLeave,
  getLeaveAdjustmentHistory,
} from '../../lib/api'

// ── Leave balance row for one employee ───────────────────────────────────────
function EmployeeLeaveRow({ employee, balances, onEdit, onRecord }) {
  return (
    <div style={{
      background: C.surface, borderRadius: 14,
      border: `1px solid ${C.border}`,
      padding: '16px 20px',
      marginBottom: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <Avatar initials={employee.avatar_initials || '??'} size={38} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>{employee.full_name}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{employee.department} · {employee.employee_type}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="outline" onClick={() => onRecord(employee)}>📝 Record Leave</Button>
          <Button size="sm" onClick={() => onEdit(employee)}>+ Adjust Balance</Button>
        </div>
      </div>

      {/* Balance pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {LEAVE_TYPES.map(lt => {
          const bal = balances.find(b => b.leave_type === lt.id)
          const total = bal?.total_days ?? 0
          const used  = bal?.used_days  ?? 0
          const rem   = total - used
          if (total === 0 && employee.employee_type === 'intern' && lt.id !== 'casual_sick') return null
          return (
            <div key={lt.id} style={{
              padding: '8px 14px', borderRadius: 10,
              background: `${lt.color}10`,
              border: `1px solid ${lt.color}30`,
              minWidth: 110,
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: lt.color, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
                {lt.label}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: lt.color, fontFamily: FONTS.display, lineHeight: 1 }}>{rem}</span>
                <span style={{ fontSize: 10, color: C.textLight }}>/ {total}</span>
              </div>
              <div style={{ fontSize: 9, color: C.textLight, marginTop: 2 }}>{used} used</div>
            </div>
          )
        })}
        {balances.length === 0 && (
          <div style={{ fontSize: 12, color: C.textLight, padding: '8px 0' }}>No leave balances set yet.</div>
        )}
      </div>
    </div>
  )
}

// ── Edit modal ────────────────────────────────────────────────────────────────
function EditLeaveModal({ employee, balances, reviewerId, onSaved, onClose }) {
  const [mode,      setMode]      = useState('adjust') // 'adjust' | 'set'
  const [leaveType, setLeaveType] = useState('casual_sick')
  const [amount,    setAmount]    = useState('')
  const [reason,    setReason]    = useState('')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')
  const [success,   setSuccess]   = useState('')
  const [history,   setHistory]   = useState([])
  const [loadingHist, setLoadingHist] = useState(true)

  useEffect(() => {
    getLeaveAdjustmentHistory(employee.id)
      .then(setHistory)
      .catch(() => {})
      .finally(() => setLoadingHist(false))
  }, [employee.id])

  const currentBal = balances.find(b => b.leave_type === leaveType)
  const currentTotal = currentBal?.total_days ?? 0
  const currentUsed  = currentBal?.used_days  ?? 0
  const preview = mode === 'adjust'
    ? Math.max(0, currentTotal + (parseFloat(amount) || 0))
    : Math.max(0, parseFloat(amount) || 0)

  async function handleSave() {
    if (!amount || isNaN(parseFloat(amount))) { setError('Please enter a valid number.'); return }
    if (!reason.trim()) { setError('Reason is required.'); return }
    setSaving(true); setError('')
    try {
      if (mode === 'adjust') {
        await hrAdjustLeave(employee.id, leaveType, parseFloat(amount), reason, reviewerId)
      } else {
        await hrSetLeaveBalance(employee.id, leaveType, parseFloat(amount), reason, reviewerId)
      }
      setSuccess('Leave balance updated successfully.')
      setAmount(''); setReason('')
      onSaved()
      // Refresh history
      const h = await getLeaveAdjustmentHistory(employee.id)
      setHistory(h)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const lt = LEAVE_TYPES.find(l => l.id === leaveType)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(26,26,46,0.5)',
      backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
    }}>
      <div style={{
        background: C.surface, borderRadius: 16,
        width: '100%', maxWidth: 540,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(26,26,46,0.2)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar initials={employee.avatar_initials || '??'} size={40} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>{employee.full_name}</div>
            <div style={{ fontSize: 11, color: C.textLight }}>{employee.department}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: C.textLight, padding: 4 }}>✕</button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, background: C.bg, borderRadius: 10, padding: 4 }}>
            {[['adjust','➕ Add / Deduct'],['set','📝 Set Exact Amount']].map(([m, label]) => (
              <button key={m} onClick={() => setMode(m)} style={{
                flex: 1, padding: '8px', borderRadius: 8, border: 'none',
                background: mode === m ? C.surface : 'transparent',
                color: mode === m ? C.brand : C.textLight,
                fontWeight: mode === m ? 700 : 400,
                fontSize: 12, cursor: 'pointer',
                fontFamily: FONTS.display,
                boxShadow: mode === m ? C.shadow : 'none',
              }}>
                {label}
              </button>
            ))}
          </div>

          {/* Leave type */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 6, fontFamily: FONTS.body }}>Leave Type</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {LEAVE_TYPES.map(l => (
                <button key={l.id} onClick={() => setLeaveType(l.id)} style={{
                  padding: '6px 14px', borderRadius: 20, border: `1.5px solid`,
                  borderColor: leaveType === l.id ? l.color : C.border,
                  background: leaveType === l.id ? `${l.color}15` : C.surface,
                  color: leaveType === l.id ? l.color : C.textLight,
                  fontSize: 12, fontWeight: leaveType === l.id ? 700 : 400,
                  cursor: 'pointer', fontFamily: FONTS.body,
                }}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {/* Current balance */}
          <div style={{
            background: `${lt?.color || C.brand}08`,
            border: `1px solid ${lt?.color || C.brand}20`,
            borderRadius: 10, padding: '12px 16px', marginBottom: 16,
            display: 'flex', gap: 20,
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: C.textLight, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Current Total</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: lt?.color || C.brand, fontFamily: FONTS.display }}>{currentTotal}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: C.textLight, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Used</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.textLight, fontFamily: FONTS.display }}>{currentUsed}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: C.textLight, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Remaining</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.green, fontFamily: FONTS.display }}>{currentTotal - currentUsed}</div>
            </div>
            {amount && (
              <div style={{ textAlign: 'center', borderLeft: `1px solid ${C.border}`, paddingLeft: 20 }}>
                <div style={{ fontSize: 9, color: C.textLight, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>After Change</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: lt?.color || C.brand, fontFamily: FONTS.display }}>{preview}</div>
              </div>
            )}
          </div>

          {/* Amount input */}
          <div style={{ marginBottom: 14 }}>
            <Input
              label={mode === 'adjust' ? 'Days to Add (use negative to deduct, e.g. -2)' : 'Set Total Days to'}
              value={amount}
              onChange={setAmount}
              type="number"
              placeholder={mode === 'adjust' ? 'e.g. 3 or -2' : 'e.g. 18'}
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <Input
              label="Reason (required for audit trail)"
              value={reason}
              onChange={setReason}
              placeholder="e.g. Annual entitlement top-up, Compassionate leave grant..."
              required
            />
          </div>

          {error   && <div style={{ marginBottom: 12 }}><Alert type="error"   message={error}   /></div>}
          {success && <div style={{ marginBottom: 12 }}><Alert type="success" message={success} /></div>}

          <div style={{ display: 'flex', gap: 10 }}>
            <Button onClick={handleSave} disabled={saving} fullWidth>
              {saving ? 'Saving…' : mode === 'adjust' ? '✓ Apply Adjustment' : '✓ Set Balance'}
            </Button>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </div>

        {/* Adjustment history */}
        {(history.length > 0 || loadingHist) && (
          <div style={{ padding: '0 24px 20px', borderTop: `1px solid ${C.border}`, marginTop: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, letterSpacing: 1, textTransform: 'uppercase', margin: '16px 0 10px' }}>
              Adjustment History
            </div>
            {loadingHist ? <Spinner size={20} /> : history.map(h => (
              <div key={h.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: C.text, fontWeight: 500 }}>
                    <span style={{ color: LEAVE_TYPES.find(l => l.id === h.leave_type)?.color || C.brand, fontWeight: 700 }}>
                      {LEAVE_TYPES.find(l => l.id === h.leave_type)?.label || h.leave_type}
                    </span>
                    {' '}{h.adjustment > 0 ? `+${h.adjustment}` : h.adjustment} days
                    {' '}({h.old_total} → {h.new_total})
                  </div>
                  <div style={{ color: C.textLight, fontSize: 11 }}>{h.reason}</div>
                </div>
                <div style={{ textAlign: 'right', color: C.textLight, fontSize: 10, flexShrink: 0 }}>
                  <div>{h.adjuster?.full_name}</div>
                  <div>{new Date(h.created_at).toLocaleDateString('en-IN')}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


// ── Record Leave Modal (for offline/email leaves) ─────────────────────────────
function RecordLeaveModal({ employees, reviewerId, onSaved, onClose }) {
  const [employeeId, setEmployeeId] = useState('')
  const [leaveType,  setLeaveType]  = useState('casual_sick')
  const [fromDate,   setFromDate]   = useState('')
  const [toDate,     setToDate]     = useState('')
  const [reason,     setReason]     = useState('')
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')
  const [success,    setSuccess]    = useState('')

  const days = fromDate && toDate
    ? Math.max(1, Math.ceil((new Date(toDate) - new Date(fromDate)) / 86400000) + 1)
    : 0

  const lt = LEAVE_TYPES.find(l => l.id === leaveType)
  const emp = employees.find(e => e.id === employeeId)

  async function handleSave() {
    if (!employeeId) { setError('Please select an employee.'); return }
    if (!fromDate || !toDate) { setError('Please select leave dates.'); return }
    if (!reason.trim()) { setError('Reason is required.'); return }
    if (new Date(toDate) < new Date(fromDate)) { setError('End date must be after start date.'); return }
    setSaving(true); setError('')
    try {
      await hrRecordLeave({
        employeeId,
        leaveType,
        fromDate,
        toDate,
        days,
        reason,
        recordedBy: reviewerId,
      })
      setSuccess(`✅ ${days} day${days > 1 ? 's' : ''} of ${lt?.label} recorded for ${emp?.full_name}.`)
      setFromDate(''); setToDate(''); setReason(''); setEmployeeId('')
      onSaved()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(26,26,46,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: C.surface, borderRadius: 16, width: '100%', maxWidth: 480, boxShadow: '0 24px 80px rgba(26,26,46,0.2)' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>📝 Record Leave for Employee</div>
            <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>For leaves applied outside Stride (email, WhatsApp, verbal)</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: C.textLight }}>✕</button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Employee select */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 6, fontFamily: FONTS.body }}>Employee <span style={{ color: '#ef4444' }}>*</span></label>
            <select value={employeeId} onChange={e => setEmployeeId(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none', background: C.surface }}>
              <option value="">Select employee…</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name} — {e.department}</option>)}
            </select>
          </div>

          {/* Leave type */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 8, fontFamily: FONTS.body }}>Leave Type <span style={{ color: '#ef4444' }}>*</span></label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {LEAVE_TYPES.map(l => (
                <button key={l.id} onClick={() => setLeaveType(l.id)} style={{
                  padding: '6px 14px', borderRadius: 20,
                  border: `1.5px solid ${leaveType === l.id ? l.color : C.border}`,
                  background: leaveType === l.id ? `${l.color}15` : C.surface,
                  color: leaveType === l.id ? l.color : C.textLight,
                  fontSize: 12, fontWeight: leaveType === l.id ? 700 : 400,
                  cursor: 'pointer', fontFamily: FONTS.body,
                }}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date range picker */}
          <DateRangePicker
            fromDate={fromDate}
            toDate={toDate}
            isHalfDay={false}
            label="Select Dates"
            onChange={({ fromDate: fd, toDate: td }) => { setFromDate(fd); setToDate(td) }}
          />

          {/* Duration preview */}
          {days > 0 && (
            <div style={{ background: `${lt?.color || C.brand}10`, border: `1px solid ${lt?.color || C.brand}25`, borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: C.textLight, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Duration</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: lt?.color || C.brand, fontFamily: FONTS.display }}>{days} day{days > 1 ? 's' : ''}</div>
              </div>
              <div style={{ fontSize: 12, color: C.textMid }}>
                <div>{new Date(fromDate).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                {fromDate !== toDate && <div>→ {new Date(toDate).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</div>}
              </div>
            </div>
          )}

          {/* Reason */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 6, fontFamily: FONTS.body }}>Reason <span style={{ color: '#ef4444' }}>*</span></label>
            <input value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. Applied via email on Jun 15 — approved by Amit"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none' }} />
          </div>

          {error   && <Alert type="error"   message={error}   />}
          {success && <Alert type="success" message={success} />}

          <div style={{ display: 'flex', gap: 10 }}>
            <Button onClick={handleSave} disabled={saving} fullWidth>
              {saving ? 'Recording…' : '✓ Record Leave as Approved'}
            </Button>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function HRLeaveManagementPage() {
  const { employee: me } = useAuth()
  const r = useResponsive()
  const [employees,  setEmployees]  = useState([])
  const [balances,   setBalances]   = useState([])
  const [pending,    setPending]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [editEmp,    setEditEmp]    = useState(null)
  const [showRecord, setShowRecord] = useState(false)
  const [decisionLoading, setDecisionLoading] = useState(null)

  async function load() {
    try {
      const [emps, bals, reqs] = await Promise.all([
        getAllEmployees(),
        getAllLeaveBalances(),
        getAllLeaveRequests(),
      ])
      setEmployees(emps.filter(e => e.status === 'active'))
      setBalances(bals)
      setPending(reqs.filter(r => r.status === 'pending'))
    } finally { setLoading(false) }
  }

  async function handleDecision(leaveId, status) {
    setDecisionLoading(leaveId)
    try {
      const updated = await updateLeaveStatus(leaveId, status, me.id)
      await notifyLeaveDecision(updated, updated.employee_id, status)
      load()
    } catch (e) { alert(e.message) }
    finally { setDecisionLoading(null) }
  }

  useEffect(() => { load() }, [])

  const filtered = employees.filter(e =>
    !search || e.full_name.toLowerCase().includes(search.toLowerCase()) ||
    e.department?.toLowerCase().includes(search.toLowerCase())
  )

  // Summary stats
  const totalBalances = balances.length
  const totalLeavedays = balances.reduce((sum, b) => sum + (b.total_days || 0), 0)
  const totalUsed = balances.reduce((sum, b) => sum + (b.used_days || 0), 0)

  return (
    <AppShell title="Leave Management" subtitle="View and adjust employee leave balances">
      {showRecord && (
        <RecordLeaveModal
          employees={employees}
          reviewerId={me?.id}
          onSaved={load}
          onClose={() => setShowRecord(false)}
        />
      )}

      {editEmp && (
        <EditLeaveModal
          employee={editEmp}
          balances={balances.filter(b => b.employee_id === editEmp.id)}
          reviewerId={me?.id}
          onSaved={load}
          onClose={() => setEditEmp(null)}
        />
      )}

      {/* Pending leave requests */}
      {pending.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: FONTS.display, marginBottom: 12 }}>
            🏖️ Pending Leave Requests ({pending.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pending.map(req => {
              const emp = employees.find(e => e.id === req.employee_id)
              const lt  = LEAVE_TYPES.find(t => t.id === req.leave_type)
              return (
                <div key={req.id} style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: C.gradientH, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.text, flexShrink: 0 }}>
                    {emp?.avatar_initials || '??'}
                  </div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{emp?.full_name || 'Unknown'}</div>
                    <div style={{ fontSize: 12, color: C.textLight }}>
                      {lt?.label || req.leave_type} · {req.from_date} → {req.to_date} · <strong>{req.days} day{req.days !== 1 ? 's' : ''}</strong>
                      {req.is_half_day && <span style={{ marginLeft: 6, fontSize: 10, color: C.teal, fontWeight: 700 }}>HALF DAY</span>}
                    </div>
                    {/* Show if employee has insufficient balance */}
                    {(() => {
                      const empBals = balances.filter(b => b.employee_id === req.employee_id && b.leave_type === req.leave_type && b.year === new Date().getFullYear())
                      const bal = empBals[0]
                      if (!bal) return null
                      const available = Math.max(0, Number(bal.total_days) - Number(bal.used_days || 0))
                      const unpaid = Math.max(0, Number(req.days) - available)
                      if (unpaid <= 0) return null
                      return (
                        <div style={{ fontSize: 11, color: '#d97706', background: '#fef3c7', padding: '3px 8px', borderRadius: 6, marginTop: 4, display: 'inline-block' }}>
                          ⚠️ {unpaid} day{unpaid !== 1 ? 's' : ''} will be unpaid (LOP)
                        </div>
                      )
                    })()}
                    <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>"{req.reason}"</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => handleDecision(req.id, 'approved')}
                      disabled={decisionLoading === req.id}
                      style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: C.green, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONTS.display }}>
                      {decisionLoading === req.id ? '…' : '✓ Approve'}
                    </button>
                    <button
                      onClick={() => handleDecision(req.id, 'rejected')}
                      disabled={decisionLoading === req.id}
                      style={{ padding: '7px 16px', borderRadius: 8, border: `1px solid #ef4444`, background: 'transparent', color: '#ef4444', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONTS.display }}>
                      ✕ Reject
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: cols(r, { mobile: 2, tablet: 3, desktop: 4 }), gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Active Employees', val: employees.length, color: C.brand,    icon: '👥' },
          { label: 'Total Leave Days', val: totalLeavedays,   color: C.purple,   icon: '📅' },
          { label: 'Days Used (YTD)',   val: totalUsed,        color: C.amber,    icon: '📊' },
          { label: 'Days Remaining',   val: totalLeavedays - totalUsed, color: C.green, icon: '✅' },
        ].map(s => (
          <div key={s.label} style={{
            background: C.surface, borderRadius: 14, padding: '18px 20px',
            border: `1px solid ${C.border}`, borderTop: `3px solid ${s.color}`,
            boxShadow: C.shadow,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 10, color: C.textLight, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>{s.label}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: s.color, fontFamily: FONTS.display, lineHeight: 1 }}>{s.val}</div>
              </div>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: `${s.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{s.icon}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Search + header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>
          All Employees ({filtered.length})
        </div>
        <Button onClick={() => setShowRecord(true)}>📝 Record Leave</Button>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search employee or department…"
          style={{ padding: '8px 14px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none', width: 260 }}
        />
      </div>

      {/* Employee list */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={32} /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon="👥" title="No employees found" />
      ) : (
        filtered.map(emp => (
          <EmployeeLeaveRow
            key={emp.id}
            employee={emp}
            balances={balances.filter(b => b.employee_id === emp.id)}
            onEdit={setEditEmp}
            onRecord={e => { setShowRecord(true) }}
          />
        ))
      )}
    </AppShell>
  )
}
