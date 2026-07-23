import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import { Card, Avatar, Button, Spinner, EmptyState, Badge } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { C, FONTS } from '../../lib/constants'
import { useResponsive, cols } from '../../lib/responsive'
import { useAuth } from '../../context/AuthContext'
import { notifyWelcome } from '../../lib/api.notifications'
import {
  getAllEmployeesForHR, getPendingRegistrations,
  rejectEmployee, deactivateEmployee, resendInvite,
} from '../../lib/api.onboarding'
import { getPendingHRTransferRequests, hrDecideTransfer } from '../../lib/api.managerTransfers'
import { getPendingReviews, hrDecideReview } from '../../lib/api.probation'
import { getAnnualCycle, getPerformanceOverview, finalizeReview } from '../../lib/api.performance'
import { getVerdict } from '../../lib/constants'

import { InviteModal, CreateModal, ApproveModal, PendingBanner, EmployeeTable } from './employee-management/components'

export default function EmployeeManagementPage() {
  const r = useResponsive()
  const { employee: currentEmployee } = useAuth()
  const [employees, setEmployees] = useState([])
  const [pending,   setPending]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState(null)
  const [toApprove, setToApprove] = useState(null)
  const [toast,     setToast]     = useState('')
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('tab') || 'employees')
  const [transferRequests, setTransferRequests] = useState([])
  const [probationPending,  setProbationPending]  = useState([])
  const [probationDecided,  setProbationDecided]  = useState([])
  const [decidingId,        setDecidingId]        = useState(null)
  const [decisionForm,      setDecisionForm]      = useState({ decision: '', notes: '', extensionDays: '' })
  const [decisionError,     setDecisionError]     = useState('')
  const [decisionSaving,    setDecisionSaving]    = useState(false)
  const [decisionSuccess,   setDecisionSuccess]   = useState('')
  const [perfCycle,     setPerfCycle]     = useState(null)
  const [perfOverview,  setPerfOverview]  = useState([])
  const [finalizingId,  setFinalizingId]  = useState(null)
  const [hrNotesDraft,  setHrNotesDraft]  = useState('')
  const [perfBusy,      setPerfBusy]      = useState(false)
  const [perfError,     setPerfError]     = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [emps, pend, transfers, probPending] = await Promise.all([
        getAllEmployeesForHR(),
        getPendingRegistrations(),
        getPendingHRTransferRequests(),
        getPendingReviews(),
      ])
      setEmployees(emps)
      setPending(pend)
      setTransferRequests(transfers)
      setProbationPending(probPending)
      const { data: decided } = await supabase
        .from('probation_reviews')
        .select('*, employee:employee_id(id, full_name, avatar_initials, department)')
        .eq('status', 'decided')
        .order('hr_decided_at', { ascending: false })
        .limit(50)
      setProbationDecided(decided || [])
      const pc = await getAnnualCycle()
      setPerfCycle(pc)
      if (pc) setPerfOverview(await getPerformanceOverview(pc.id))
    } finally { setLoading(false) }
  }

  async function reloadPerf() {
    if (perfCycle) setPerfOverview(await getPerformanceOverview(perfCycle.id))
  }

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 3500) }

  function handleSuccess(emp, status) {
    setEmployees(es => [{ ...emp, onboarding_status: status }, ...es])
    setModal(null)
    showToast(`✅ ${emp.full_name} added successfully!`)
    // Send welcome notification
    if (emp.id) notifyWelcome(emp.id, emp.full_name).catch(() => {})
  }

  async function handleReject(empId) {
    if (!confirm('Reject this registration request?')) return
    try {
      await rejectEmployee(empId)
      setPending(ps => ps.filter(p => p.id !== empId))
      setEmployees(es => es.map(e => e.id === empId ? { ...e, onboarding_status: 'rejected', status: 'inactive' } : e))
      showToast('Registration rejected.')
    } catch (e) { alert(e.message) }
  }

  function handleApproveClick(emp) { setToApprove(emp); setModal('approve') }

  function handleApproved(updated) {
    setPending(ps => ps.filter(p => p.id !== updated.id))
    setEmployees(es => es.map(e => e.id === updated.id ? updated : e))
    setModal(null); setToApprove(null)
    showToast(`✅ ${updated.full_name} is now active!`)
    // Send welcome notification
    if (updated.id) notifyWelcome(updated.id, updated.full_name).catch(() => {})
  }

  async function handleResendInvite(email) {
    try { await resendInvite(email); showToast(`📧 Invite resent to ${email}`) }
    catch (e) { alert(e.message) }
  }

  async function handleDeactivate(empId) {
    const emp = employees.find(e => e.id === empId)
    if (!confirm(`Deactivate ${emp?.full_name}? They will lose portal access.`)) return
    try {
      await deactivateEmployee(empId)
      setEmployees(es => es.map(e => e.id === empId ? { ...e, status: 'inactive', onboarding_status: 'offboarded' } : e))
      showToast(`${emp?.full_name} deactivated.`)
    } catch (e) { alert(e.message) }
  }

  async function handleTransferDecision(requestId, decision) {
    try {
      await hrDecideTransfer(requestId, decision, currentEmployee?.id)
      setTransferRequests(rs => rs.filter(r => r.id !== requestId))
      showToast(decision === 'approved' ? '✅ Transfer approved.' : 'Transfer rejected.')
    } catch (e) { alert(e.message) }
  }

  async function handleProbationDecision(reviewId) {
    setDecisionError('')
    const { decision, notes, extensionDays } = decisionForm
    if (!decision) { setDecisionError('Select a decision.'); return }
    if (decision === 'extended' && !extensionDays) { setDecisionError('Enter extension duration.'); return }
    setDecisionSaving(true)
    try {
      await hrDecideReview(reviewId, { decision, notes, extensionDays: Number(extensionDays) }, currentEmployee?.id)
      const successMsgs = {
        confirmed: '🎉 Confirmed as permanent team member',
        extended:  `Extended by ${extensionDays} days`,
        relieved:  'Offboarding initiated',
      }
      setDecisionSuccess(successMsgs[decision])
      setDecidingId(null)
      setDecisionForm({ decision: '', notes: '', extensionDays: '' })
      const [pending] = await Promise.all([getPendingReviews()])
      setProbationPending(pending)
      const { data: decided } = await supabase
        .from('probation_reviews')
        .select('*, employee:employee_id(id, full_name, avatar_initials, department)')
        .eq('status', 'decided')
        .order('hr_decided_at', { ascending: false })
        .limit(50)
      setProbationDecided(decided || [])
      setTimeout(() => setDecisionSuccess(''), 4000)
    } catch (e) { setDecisionError(e.message) }
    finally { setDecisionSaving(false) }
  }

  async function handleFinalize(reviewId) {
    setPerfBusy(true); setPerfError('')
    try {
      await finalizeReview(reviewId, hrNotesDraft, currentEmployee?.id)
      setFinalizingId(null); setHrNotesDraft('')
      await reloadPerf()
    } catch (e) { setPerfError(e.message) } finally { setPerfBusy(false) }
  }

  if (loading) return (
    <AppShell title="Employee Management">
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><Spinner size={36} /></div>
    </AppShell>
  )

  return (
    <AppShell title="Employee Management" subtitle="Onboard, manage, and offboard team members">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap'); @keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 24, zIndex: 2000,
          background: C.text, color: '#fff', padding: '12px 20px',
          borderRadius: 10, fontSize: 13, fontWeight: 600,
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
        }}>{toast}</div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: C.surface, padding: 6, borderRadius: 10, width: 'fit-content', boxShadow: C.shadow }}>
        {[
          { id: 'employees',  label: 'Employees' },
          { id: 'transfers',  label: `🔁 Transfer Requests${transferRequests.length ? ` (${transferRequests.length})` : ''}` },
          { id: 'probation',  label: `📋 Probation${probationPending.length ? ` (${probationPending.length})` : ''}` },
          { id: 'performance', label: `📈 Performance${
              perfOverview.filter(p => p.yearEnd?.status === 'manager_done').length
                ? ` (${perfOverview.filter(p => p.yearEnd?.status === 'manager_done').length})` : ''}` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: tab === t.id ? C.brand : 'transparent',
            color: tab === t.id ? '#fff' : C.textMid,
            fontSize: 13, fontWeight: 700, fontFamily: "'Sora',sans-serif",
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'employees' && (
        <>
          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: cols(r, {mobile:2, tablet:3, desktop:6}), gap: 10, marginBottom: 24 }}>
            {[
              { label: 'Active',           val: employees.filter(e => e.status === 'active').length,                          color: C.green,   bg: C.greenSoft  },
              { label: 'Permanent',        val: employees.filter(e => e.employee_type === 'permanent' && e.status === 'active').length, color: C.brand,  bg: C.brandLight },
              { label: 'Interns',          val: employees.filter(e => e.employee_type === 'intern' && e.status === 'active').length,    color: C.purple, bg: C.purpleSoft },
              { label: 'Contractors',      val: employees.filter(e => e.employee_type === 'contractor' && e.status === 'active').length, color: C.amber, bg: C.amberSoft },
              { label: 'On Probation',     val: employees.filter(e => e.employee_type === 'probation' && e.status === 'active').length,   color: C.amber, bg: C.amberSoft },
              { label: 'Pending Approval', val: pending.length,                                                               color: C.accent,  bg: C.accentSoft },
            ].map(s => (
              <Card key={s.label} style={{ padding: '16px 18px', borderLeft: `4px solid ${s.color}` }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: s.color, fontFamily: "'Sora',sans-serif" }}>{s.val}</div>
                <div style={{ fontSize: 11, color: C.textMid, marginTop: 3 }}>{s.label}</div>
              </Card>
            ))}
          </div>

          <PendingBanner pending={pending} onApproveClick={handleApproveClick} onReject={handleReject} />

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
            <Button variant="outline" size="sm" onClick={() => setModal('create')}>🔑 Create with Password</Button>
            <Button size="sm" onClick={() => setModal('invite')}>📧 Invite via Email</Button>
          </div>

          <EmployeeTable
            employees={employees}
            onResendInvite={handleResendInvite}
            onDeactivate={handleDeactivate}
            onEmployeeUpdated={(updated) => setEmployees(emps => emps.map(e => e.id === updated.id ? updated : e))}
          />
        </>
      )}

      {tab === 'transfers' && (
        <Card style={{ padding: '20px 24px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", marginBottom: 14 }}>Transfer Requests</div>
          {transferRequests.length === 0 ? (
            <EmptyState icon="🔁" title="Nothing pending" subtitle="Transfer requests will appear here." />
          ) : transferRequests.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: `1px solid ${C.border}` }}>
              <Avatar initials={r.employee?.avatar_initials || '??'} size={32} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{r.employee?.full_name}</div>
                <div style={{ fontSize: 11, color: C.textLight }}>{r.from_manager?.full_name} → {r.to_manager?.full_name}{r.reason ? ` — "${r.reason}"` : ''}</div>
              </div>
              {r.status === 'pending_target' ? (
                <span style={{ fontSize: 11, color: C.amber, fontWeight: 600, padding: '4px 10px', background: C.amberSoft, borderRadius: 20 }}>Awaiting receiving manager</span>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => handleTransferDecision(r.id, 'rejected')}>Reject</Button>
                  <Button size="sm" onClick={() => handleTransferDecision(r.id, 'approved')}>Approve</Button>
                </>
              )}
            </div>
          ))}
        </Card>
      )}

      {tab === 'probation' && (
        <div>
          {decisionSuccess && (
            <div style={{ padding: '12px 16px', background: '#e8faf0', borderRadius: 10, border: '1.5px solid #00b89440', marginBottom: 16, fontSize: 13, fontWeight: 600, color: '#00b894' }}>
              {decisionSuccess}
            </div>
          )}

          {/* Pending section */}
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONTS.display, marginBottom: 14 }}>
            Pending Reviews ({probationPending.length})
          </div>

          {probationPending.length === 0 ? (
            <EmptyState icon="📋" title="No pending probation reviews" subtitle="Reviews will appear here 30 days before an employee's probation end date." />
          ) : (
            probationPending.map(review => {
              const emp       = review.employee
              const end       = new Date(emp?.probation_end_date)
              const remaining = Math.max(0, Math.round((end - new Date()) / 86400000))
              const total     = 180
              const elapsed   = Math.max(0, total - remaining)
              const pct       = Math.min(100, Math.round((elapsed / total) * 100))
              const isUrgent  = remaining <= 14
              const ringColor = isUrgent ? C.amber : C.brand
              const r2        = 20
              const circ      = 2 * Math.PI * r2
              const dash      = circ * (1 - pct / 100)
              const managerBadges = {
                confirm: { label: 'Manager: Confirm ✓', color: '#00b894', bg: '#e8faf0' },
                extend:  { label: 'Manager: Extend',    color: C.amber,   bg: C.amberSoft },
                relieve: { label: 'Manager: Relieve',   color: '#ef4444', bg: '#fef2f2' },
              }
              const mBadge = review.manager_recommendation ? managerBadges[review.manager_recommendation] : null
              const isDeciding = decidingId === review.id

              return (
                <div key={review.id} style={{ background: C.surface, border: `1.5px solid ${isUrgent ? C.amber + '50' : C.border}`, borderRadius: 14, padding: '16px 20px', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    {/* Countdown ring */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <svg width={52} height={52}>
                        <circle cx={26} cy={26} r={r2} fill="none" stroke={C.border} strokeWidth={4} />
                        <circle cx={26} cy={26} r={r2} fill="none" stroke={ringColor} strokeWidth={4}
                          strokeDasharray={circ} strokeDashoffset={dash}
                          strokeLinecap="round" transform="rotate(-90 26 26)" />
                      </svg>
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: ringColor, lineHeight: 1 }}>{remaining}</span>
                        <span style={{ fontSize: 8, color: C.textLight }}>days</span>
                      </div>
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Avatar initials={emp?.avatar_initials || '??'} size={28} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{emp?.full_name}</span>
                        <span style={{ fontSize: 11, color: C.textLight }}>{emp?.department}</span>
                      </div>
                      <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>
                        Probation ends {end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {emp?.probation_extended && <span style={{ marginLeft: 8, color: C.amber, fontWeight: 600 }}>⚠ Extension already used</span>}
                      </div>
                      {mBadge && (
                        <span style={{ display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 600, color: mBadge.color, background: mBadge.bg, padding: '2px 10px', borderRadius: 20 }}>
                          {mBadge.label}
                        </span>
                      )}
                      {review.status === 'pending_manager' && (
                        <span style={{ display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 600, color: C.textLight, background: C.surfaceAlt, padding: '2px 10px', borderRadius: 20 }}>
                          Awaiting manager review
                        </span>
                      )}
                    </div>

                    {review.status === 'pending_hr' && (
                      <button onClick={() => { setDecidingId(isDeciding ? null : review.id); setDecisionForm({ decision: '', notes: '', extensionDays: '' }); setDecisionError('') }}
                        style={{ padding: '7px 14px', borderRadius: 10, border: `1.5px solid ${C.brand}`, background: isDeciding ? C.brandLight : C.surface, color: C.brand, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        {isDeciding ? 'Cancel' : 'Decide →'}
                      </button>
                    )}
                  </div>

                  {/* Decision panel */}
                  {isDeciding && (
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
                      {review.manager_notes && (
                        <div style={{ marginBottom: 12, padding: '10px 14px', background: C.surfaceAlt, borderRadius: 10, fontSize: 12 }}>
                          <div style={{ fontWeight: 700, color: C.textMid, marginBottom: 4 }}>Manager's notes:</div>
                          <div style={{ color: C.textMid, lineHeight: 1.6 }}>{review.manager_notes}</div>
                        </div>
                      )}

                      {/* HR decision buttons */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
                        {[
                          { value: 'confirmed', icon: '✅', label: 'Confirm',  color: '#00b894', bg: '#e8faf0' },
                          { value: 'extended',  icon: '📅', label: 'Extend',   color: C.amber,   bg: C.amberSoft, warn: emp?.probation_extended },
                          { value: 'relieved',  icon: '🔴', label: 'Relieve',  color: '#ef4444', bg: '#fef2f2' },
                        ].map(c => (
                          <button key={c.value} onClick={() => setDecisionForm(f => ({ ...f, decision: c.value }))} style={{
                            padding: '10px 8px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                            border: `2px solid ${decisionForm.decision === c.value ? c.color : C.border}`,
                            background: decisionForm.decision === c.value ? c.bg : C.surface,
                          }}>
                            <div style={{ fontSize: 18, marginBottom: 4 }}>{c.icon}</div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: decisionForm.decision === c.value ? c.color : C.text }}>{c.label}</div>
                            {c.warn && <div style={{ fontSize: 9, color: C.amber, marginTop: 2 }}>⚠ 2nd extension</div>}
                          </button>
                        ))}
                      </div>

                      {decisionForm.decision === 'extended' && (
                        <div style={{ marginBottom: 10 }}>
                          <label style={{ fontSize: 12, color: C.textMid, fontWeight: 600 }}>Extension duration (days)</label>
                          <input type="number" min="1" value={decisionForm.extensionDays}
                            onChange={e => setDecisionForm(f => ({ ...f, extensionDays: e.target.value }))}
                            placeholder="e.g. 90"
                            style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 12px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none', boxSizing: 'border-box' }} />
                        </div>
                      )}

                      <textarea value={decisionForm.notes} onChange={e => setDecisionForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                        placeholder="HR notes (optional)…"
                        style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 12, fontFamily: FONTS.body, outline: 'none', resize: 'vertical', marginBottom: 10, boxSizing: 'border-box' }} />

                      {decisionError && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{decisionError}</div>}

                      <button onClick={() => handleProbationDecision(review.id)} disabled={decisionSaving}
                        style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: decisionSaving ? C.border : C.brand, color: '#fff', fontSize: 13, fontWeight: 700, cursor: decisionSaving ? 'not-allowed' : 'pointer', fontFamily: FONTS.display }}>
                        {decisionSaving ? 'Saving…' : 'Confirm Decision →'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })
          )}

          {/* Decided section */}
          {probationDecided.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONTS.display, marginBottom: 14 }}>
                Decision History ({probationDecided.length})
              </div>
              {probationDecided.map(review => {
                const badges = {
                  confirmed: { label: 'Confirmed',  color: '#00b894', bg: '#e8faf0' },
                  extended:  { label: 'Extended',   color: C.amber,   bg: C.amberSoft },
                  relieved:  { label: 'Relieved',   color: '#ef4444', bg: '#fef2f2' },
                }
                const b = badges[review.hr_decision] || { label: review.hr_decision, color: C.textMid, bg: C.surfaceAlt }
                return (
                  <div key={review.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: C.surface, borderRadius: 10, border: `1px solid ${C.border}`, marginBottom: 8 }}>
                    <Avatar initials={review.employee?.avatar_initials || '??'} size={28} />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{review.employee?.full_name}</span>
                      <span style={{ fontSize: 11, color: C.textLight, marginLeft: 8 }}>{review.employee?.department}</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: b.color, background: b.bg, padding: '3px 10px', borderRadius: 20 }}>{b.label}</span>
                    <span style={{ fontSize: 11, color: C.textLight }}>{review.hr_decided_at ? new Date(review.hr_decided_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'performance' && (
        <div>
          {!perfCycle ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: C.textLight }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📈</div>
              <div style={{ fontWeight: 600 }}>No active annual cycle</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONTS.display, marginBottom: 14 }}>
                {perfCycle.year} Performance Overview
              </div>
              {perfError && <div style={{ padding: '10px 14px', background: '#fef2f2', borderRadius: 10, color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{perfError}</div>}

              {perfOverview.map(row => {
                const subStatus = row.submission?.status || 'not_started'
                const subBadge = {
                  not_started: { label: 'No goals',    color: C.textLight, bg: C.bg },
                  draft:       { label: 'Draft',        color: C.textMid,   bg: C.bg },
                  submitted:   { label: 'Submitted',    color: C.brand,     bg: C.brandLight },
                  returned:    { label: 'Returned',     color: C.amber,     bg: C.amberSoft },
                  approved:    { label: 'Approved',     color: C.green,     bg: C.greenSoft },
                }[subStatus]
                const ye = row.yearEnd
                const verdict = ye?.verdict ? getVerdict(ye.verdict) : null
                const canFinalize = ye?.status === 'manager_done'
                const isFinalizing = finalizingId === ye?.id

                return (
                  <div key={row.employee.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <Avatar initials={row.employee.avatar_initials || '??'} size={30} />
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{row.employee.full_name}</div>
                        <div style={{ fontSize: 11, color: C.textLight }}>{row.employee.department}</div>
                      </div>
                      <Badge label={`Goals: ${subBadge.label}`} color={subBadge.color} bg={subBadge.bg} ariaLabel={`Goals status: ${subBadge.label}`} />
                      <span style={{ fontSize: 11, color: C.textLight }}>H1: {row.h1 ? '✓' : '—'}</span>
                      {verdict
                        ? <Badge label={`${verdict.label}${ye.status === 'hr_finalized' ? ' ✓' : ''}`} color={verdict.color} bg={verdict.bg} ariaLabel={`Year-end verdict: ${verdict.label}${ye.status === 'hr_finalized' ? ' (finalized)' : ''}`} />
                        : <span style={{ fontSize: 11, color: C.textLight }}>Year-end: —</span>}
                      {canFinalize && (
                        <button onClick={() => { setFinalizingId(isFinalizing ? null : ye.id); setHrNotesDraft(''); setPerfError('') }}
                          style={{ padding: '6px 12px', borderRadius: 8, border: `1.5px solid ${C.brand}`, background: isFinalizing ? C.brandLight : C.surface, color: C.brand, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                          {isFinalizing ? 'Cancel' : 'Finalize →'}
                        </button>
                      )}
                    </div>

                    {isFinalizing && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                        {ye.overall_comment && <div style={{ fontSize: 12, color: C.textMid, marginBottom: 8, fontStyle: 'italic' }}>Manager: “{ye.overall_comment}”</div>}
                        {(ye.ratings || []).map(rt => (
                          <div key={rt.objective_id} style={{ fontSize: 12, color: C.textMid, padding: '3px 0' }}>
                            Score: <strong style={{ color: C.text }}>{rt.score ?? '—'}</strong>{rt.comment ? ` · ${rt.comment}` : ''}
                          </div>
                        ))}
                        <textarea value={hrNotesDraft} onChange={e => setHrNotesDraft(e.target.value)} rows={2} placeholder="HR notes (internal, optional)"
                          style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 12, fontFamily: FONTS.body, outline: 'none', resize: 'vertical', margin: '8px 0' }} />
                        <button onClick={() => handleFinalize(ye.id)} disabled={perfBusy}
                          style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: perfBusy ? C.border : C.brand, color: '#fff', fontSize: 13, fontWeight: 700, cursor: perfBusy ? 'not-allowed' : 'pointer', fontFamily: FONTS.display }}>
                          {perfBusy ? 'Finalizing…' : 'Confirm & Finalize →'}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}

      {modal === 'invite'  && <InviteModal  onClose={() => setModal(null)} onSuccess={handleSuccess} />}
      {modal === 'create'  && <CreateModal  onClose={() => setModal(null)} onSuccess={handleSuccess} />}
      {modal === 'approve' && toApprove && (
        <ApproveModal employee={toApprove} onClose={() => { setModal(null); setToApprove(null) }} onApproved={handleApproved} />
      )}
    </AppShell>
  )
}
