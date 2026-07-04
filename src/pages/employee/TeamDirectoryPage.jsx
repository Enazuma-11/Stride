import { useEffect, useState } from 'react'
import AppShell from '../../components/layout/AppShell'
import { Card, Avatar, Button, Select, Textarea, Alert, Spinner, EmptyState } from '../../components/ui'
import { C, FONTS } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  requestTransfer, getSentTransferRequests, withdrawTransferRequest,
  getIncomingTransferRequests, targetDecideTransfer,
} from '../../lib/api.managerTransfers'

async function getAllEmployeesWithManagers() {
  const { data, error } = await supabase
    .from('employees')
    .select(`
      id, full_name, role, role_type, employee_type, department,
      email, phone, employee_code, avatar_initials, profile_photo_url,
      join_date, status,
      manager:manager_id(id, full_name, avatar_initials, role, profile_photo_url)
    `)
    .eq('status', 'active')
    .order('employee_code', { ascending: true })
  if (error) throw error
  return data || []
}

function Modal({ title, subtitle, onClose, children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(29,53,87,0.55)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 32px 80px rgba(29,53,87,0.25)',
      }}>
        <div style={{ padding: '22px 26px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: C.textMid, marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: C.textLight, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: '22px 26px' }}>{children}</div>
      </div>
    </div>
  )
}

function TransferModal({ employee, eligibleManagers, currentManagerId, onClose, onSubmit }) {
  const [toManagerId, setToManagerId] = useState('')
  const [reason, setReason]           = useState('')
  const [error, setError]             = useState('')
  const [loading, setLoading]         = useState(false)

  async function submit() {
    if (!toManagerId) { setError('Please pick a target manager.'); return }
    setLoading(true); setError('')
    try {
      await onSubmit({ employeeId: employee.id, fromManagerId: currentManagerId, toManagerId, reason })
      onClose()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const options = eligibleManagers.filter(m => m.id !== currentManagerId)

  return (
    <Modal title={`Transfer ${employee.full_name}`} subtitle="The new manager must accept, then HR/Admin gives final approval." onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Select
          label="Transfer to manager"
          value={toManagerId}
          onChange={setToManagerId}
          options={[{ value: '', label: 'Select a manager…' }, ...options.map(m => ({ value: m.id, label: `${m.full_name} — ${m.role}` }))]}
          required
        />
        <Textarea label="Reason (optional)" value={reason} onChange={setReason} placeholder="Why is this transfer being requested?" />
        {error && <Alert type="error" message={error} />}
        <Button onClick={submit} disabled={loading} fullWidth>{loading ? 'Submitting…' : 'Submit Transfer Request'}</Button>
      </div>
    </Modal>
  )
}

function EmployeeCard({ emp, currentEmployeeId, onTransferClick }) {
  const isMe = emp.id === currentEmployeeId
  const iManageThem = emp.manager?.id === currentEmployeeId && !isMe
  const joinYear = emp.join_date ? new Date(emp.join_date).getFullYear() : null

  return (
    <div style={{
      background: C.surface, borderRadius: 16,
      border: `1.5px solid ${isMe ? C.brand : C.border}`,
      boxShadow: isMe ? `0 0 0 3px ${C.brand}15, ${C.shadow}` : C.shadow,
      overflow: 'hidden', transition: 'all 0.2s',
      position: 'relative',
    }}
      onMouseEnter={e => { if (!isMe) e.currentTarget.style.boxShadow = C.shadowMd; e.currentTarget.style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = isMe ? `0 0 0 3px ${C.brand}15, ${C.shadow}` : C.shadow; e.currentTarget.style.transform = 'translateY(0)' }}
    >
      {/* Top gradient band */}
      <div style={{ height: 6, background: C.gradientH }} />

      {isMe && (
        <div style={{ position: 'absolute', top: 14, right: 12, fontSize: 10, fontWeight: 700, color: C.brand, background: C.brandLight, padding: '2px 8px', borderRadius: 10, border: `1px solid ${C.brand}30` }}>
          YOU
        </div>
      )}

      <div style={{ padding: '20px' }}>
        {/* Avatar + name */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 16 }}>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Avatar initials={emp.avatar_initials || '??'} size={64} src={emp.profile_photo_url} />
            <div style={{
              position: 'absolute', bottom: 0, right: 0,
              width: 16, height: 16, borderRadius: '50%',
              background: '#00b894', border: '2px solid #fff',
            }} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text, fontFamily: FONTS.display, marginBottom: 2 }}>
            {emp.full_name}
          </div>
          <div style={{ fontSize: 12, color: C.brand, fontWeight: 600, marginBottom: 4 }}>{emp.role}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{emp.department}</div>
        </div>

        {/* Info rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
          {/* Employee ID */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14 }}>🪪</span>
            <span style={{ fontSize: 12, fontFamily: FONTS.mono, color: C.brand, fontWeight: 600 }}>{emp.employee_code}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: C.textLight, background: C.bg, padding: '2px 8px', borderRadius: 8 }}>
              {emp.employee_type}
            </span>
          </div>

          {/* Email */}
          {emp.email && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>✉️</span>
              <a href={`mailto:${emp.email}`} style={{ fontSize: 11, color: C.textMid, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                onMouseEnter={e => e.target.style.color = C.brand}
                onMouseLeave={e => e.target.style.color = C.textMid}>
                {emp.email}
              </a>
            </div>
          )}

          {/* Phone */}
          {emp.phone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14 }}>📱</span>
              <a href={`tel:${emp.phone}`} style={{ fontSize: 12, color: C.textMid, textDecoration: 'none' }}
                onMouseEnter={e => e.target.style.color = C.brand}
                onMouseLeave={e => e.target.style.color = C.textMid}>
                {emp.phone}
              </a>
            </div>
          )}

          {/* Reporting manager */}
          {emp.manager && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.bg, borderRadius: 8, padding: '8px 10px', marginTop: 4 }}>
              <span style={{ fontSize: 12, flexShrink: 0 }}>👤</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: C.textLight, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>Reports to</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.manager.full_name}</div>
                <div style={{ fontSize: 10, color: C.textLight }}>{emp.manager.role}</div>
              </div>
              <Avatar initials={emp.manager.avatar_initials || '??'} size={28} src={emp.manager.profile_photo_url} />
            </div>
          )}

          {iManageThem && (
            <button onClick={() => onTransferClick(emp)} style={{
              marginTop: 4, padding: '7px 10px', borderRadius: 8, border: `1.5px solid ${C.brand}`,
              background: 'transparent', color: C.brand, fontSize: 11, fontWeight: 700,
              cursor: 'pointer', fontFamily: FONTS.body, width: '100%',
            }}>
              🔁 Transfer to another manager
            </button>
          )}

          {/* Join year */}
          {joinYear && (
            <div style={{ fontSize: 10, color: C.textLight, textAlign: 'center', marginTop: 4 }}>
              Joined {joinYear} · {new Date().getFullYear() - joinYear > 0 ? `${new Date().getFullYear() - joinYear}yr` : 'New'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function TeamDirectoryPage() {
  const { employee } = useAuth()
  const [employees, setEmployees] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [dept,      setDept]      = useState('All')
  const [view,      setView]      = useState('directory')
  const [transferTarget, setTransferTarget] = useState(null)
  const [sent,     setSent]     = useState([])
  const [incoming, setIncoming] = useState([])
  const [actionError, setActionError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [emps, sentReqs, incomingReqs] = await Promise.all([
        getAllEmployeesWithManagers(),
        employee?.id ? getSentTransferRequests(employee.id) : Promise.resolve([]),
        employee?.id ? getIncomingTransferRequests(employee.id) : Promise.resolve([]),
      ])
      setEmployees(emps); setSent(sentReqs); setIncoming(incomingReqs)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function handleTransferSubmit(payload) {
    await requestTransfer(payload)
    const sentReqs = await getSentTransferRequests(employee.id)
    setSent(sentReqs)
  }

  async function handleWithdraw(requestId) {
    setActionError('')
    try {
      await withdrawTransferRequest(requestId, employee.id)
      setSent(rs => rs.map(r => r.id === requestId ? { ...r, status: 'withdrawn' } : r))
    } catch (e) { setActionError(e.message) }
  }

  async function handleIncomingDecision(requestId, decision) {
    setActionError('')
    try {
      await targetDecideTransfer(requestId, decision, employee.id)
      setIncoming(rs => rs.filter(r => r.id !== requestId))
    } catch (e) { setActionError(e.message) }
  }

  const departments = ['All', ...new Set(employees.map(e => e.department).filter(Boolean).sort())]
  const eligibleManagers = [...new Map(
    employees.filter(e => e.manager).map(e => [e.manager.id, e.manager])
  ).values()]

  const filtered = employees.filter(e => {
    const matchSearch = !search ||
      e.full_name.toLowerCase().includes(search.toLowerCase()) ||
      e.role?.toLowerCase().includes(search.toLowerCase()) ||
      e.email?.toLowerCase().includes(search.toLowerCase()) ||
      e.employee_code?.toLowerCase().includes(search.toLowerCase())
    const matchDept = dept === 'All' || e.department === dept
    return matchSearch && matchDept
  })

  const STATUS_LABEL = {
    pending_target: 'Awaiting new manager',
    pending_hr: 'Awaiting HR approval',
    approved: 'Approved',
    rejected_by_target: 'Rejected by new manager',
    rejected_by_hr: 'Rejected by HR',
    withdrawn: 'Withdrawn',
  }

  return (
    <AppShell title="Team Directory" subtitle={`${employees.length} team members`}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: C.surface, padding: 6, borderRadius: 10, width: 'fit-content', boxShadow: C.shadow }}>
        {[{ id: 'directory', label: 'Directory' }, { id: 'transfers', label: '🔁 Transfers' }].map(t => (
          <button key={t.id} onClick={() => setView(t.id)} style={{
            padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: view === t.id ? C.brand : 'transparent',
            color: view === t.id ? '#fff' : C.textMid,
            fontSize: 13, fontWeight: 700, fontFamily: FONTS.display,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {view === 'directory' && (
        <>
          {/* Search + filter */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 16 }}>🔍</span>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by name, role, email or ID…"
                style={{ width: '100%', padding: '10px 14px 10px 38px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none', background: C.surface }}
                onFocus={e => e.target.style.borderColor = C.teal}
                onBlur={e => e.target.style.borderColor = C.border}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {departments.map(d => (
                <button key={d} onClick={() => setDept(d)} style={{
                  padding: '8px 16px', borderRadius: 20, border: `1.5px solid ${dept === d ? C.brand : C.border}`,
                  background: dept === d ? C.brandLight : C.surface,
                  color: dept === d ? C.brand : C.textLight,
                  fontSize: 12, fontWeight: dept === d ? 700 : 400,
                  cursor: 'pointer', fontFamily: FONTS.body, transition: 'all 0.15s',
                }}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Stats bar */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
            {[
              { label: 'Total', val: employees.length, color: C.brand },
              { label: 'Showing', val: filtered.length, color: C.teal },
              { label: 'Departments', val: departments.length - 1, color: C.purple },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textMid }}>
                <span style={{ fontWeight: 800, color: s.color, fontSize: 18, fontFamily: FONTS.display }}>{s.val}</span>
                <span>{s.label}</span>
              </div>
            ))}
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={32} /></div>
          ) : filtered.length === 0 ? (
            <EmptyState icon="👥" title="No employees found" subtitle="Try a different search or filter." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
              {filtered.map(emp => (
                <EmployeeCard key={emp.id} emp={emp} currentEmployeeId={employee?.id} onTransferClick={setTransferTarget} />
              ))}
            </div>
          )}
        </>
      )}

      {view === 'transfers' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {actionError && <Alert type="error" message={actionError} />}

          <Card style={{ padding: '20px 24px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: FONTS.display, marginBottom: 14 }}>Sent by me</div>
            {sent.length === 0 ? (
              <div style={{ fontSize: 13, color: C.textLight }}>No transfer requests sent.</div>
            ) : sent.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: `1px solid ${C.border}` }}>
                <Avatar initials={r.employee?.avatar_initials || '??'} size={32} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{r.employee?.full_name} → {r.to_manager?.full_name}</div>
                  <div style={{ fontSize: 11, color: C.textLight }}>{STATUS_LABEL[r.status] || r.status}</div>
                </div>
                {['pending_target', 'pending_hr'].includes(r.status) && (
                  <Button variant="outline" size="sm" onClick={() => handleWithdraw(r.id)}>Withdraw</Button>
                )}
              </div>
            ))}
          </Card>

          <Card style={{ padding: '20px 24px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: FONTS.display, marginBottom: 14 }}>Awaiting my decision</div>
            {incoming.length === 0 ? (
              <div style={{ fontSize: 13, color: C.textLight }}>Nothing awaiting your decision.</div>
            ) : incoming.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: `1px solid ${C.border}` }}>
                <Avatar initials={r.employee?.avatar_initials || '??'} size={32} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{r.employee?.full_name}</div>
                  <div style={{ fontSize: 11, color: C.textLight }}>From {r.from_manager?.full_name}{r.reason ? ` — "${r.reason}"` : ''}</div>
                </div>
                <Button variant="outline" size="sm" onClick={() => handleIncomingDecision(r.id, 'rejected')}>Reject</Button>
                <Button size="sm" onClick={() => handleIncomingDecision(r.id, 'accepted')}>Accept</Button>
              </div>
            ))}
          </Card>
        </div>
      )}

      {transferTarget && (
        <TransferModal
          employee={transferTarget}
          eligibleManagers={eligibleManagers}
          currentManagerId={employee?.id}
          onClose={() => setTransferTarget(null)}
          onSubmit={handleTransferSubmit}
        />
      )}
    </AppShell>
  )
}
