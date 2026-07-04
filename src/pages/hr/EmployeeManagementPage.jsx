import { useEffect, useState } from 'react'
import AppShell from '../../components/layout/AppShell'
import { Card, Avatar, Button, Spinner, EmptyState, Alert, Input, Select, SectionTitle } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { C, EMPLOYEE_TYPES, DEPARTMENTS, ROLE_TYPES, REQUIRES_COMPANY_EMAIL, COMPANY_DOMAIN, GENDERS } from '../../lib/constants'
import { useResponsive, cols } from '../../lib/responsive'
import { useAuth } from '../../context/AuthContext'
import { notifyWelcome } from '../../lib/api.notifications'
import {
  getAllEmployeesForHR, getPendingRegistrations,
  inviteEmployee, createEmployeeWithPassword,
  approveEmployee, rejectEmployee, deactivateEmployee, resendInvite,
  validateEmailForType,
} from '../../lib/api.onboarding'
import { getPendingHRTransferRequests, hrDecideTransfer } from '../../lib/api.managerTransfers'

// ── Badges ────────────────────────────────────────────────────────────────────
function OnboardBadge({ status }) {
  const map = {
    invited:          { bg: '#EEF2FF', color: '#4338CA', label: 'Invited'          },
    active:           { bg: C.greenSoft,  color: C.green,  label: 'Active'          },
    pending_approval: { bg: C.amberSoft,  color: C.amber,  label: 'Pending Approval'},
    rejected:         { bg: C.accentSoft, color: C.accent, label: 'Rejected'        },
    offboarded:       { bg: '#F3F4F6',    color: '#6B7280', label: 'Offboarded'     },
  }
  const s = map[status] || map.active
  return <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>{s.label}</span>
}

function TypeBadge({ type }) {
  const t = EMPLOYEE_TYPES.find(e => e.value === type)
  if (!t) return null
  const needsCompany = REQUIRES_COMPANY_EMAIL.includes(type)
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
      background: needsCompany ? C.brandLight : C.greenSoft,
      color: needsCompany ? C.brand : C.green,
    }}>{t.icon} {t.label}</span>
  )
}

// ── Modal shell ───────────────────────────────────────────────────────────────
function Modal({ title, subtitle, onClose, children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(29,53,87,0.55)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 32px 80px rgba(29,53,87,0.25)',
      }}>
        <div style={{ padding: '22px 26px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif" }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: C.textMid, marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: C.textLight, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: '22px 26px' }}>{children}</div>
      </div>
    </div>
  )
}

// ── Employee type selector (used inside HR create/invite forms) ───────────────
function TypeSelector({ value, onChange }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 8 }}>
        Employment Type <span style={{ color: C.accent }}>*</span>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
        {EMPLOYEE_TYPES.map(t => {
          const active = value === t.value
          const needsCompany = REQUIRES_COMPANY_EMAIL.includes(t.value)
          return (
            <button key={t.value} onClick={() => onChange(t.value)} style={{
              padding: '10px 8px', borderRadius: 8, cursor: 'pointer', textAlign: 'center',
              border: active ? `2px solid ${C.brand}` : `1.5px solid ${C.border}`,
              background: active ? C.brandLight : '#fff',
              transition: 'all 0.15s',
            }}>
              <div style={{ fontSize: 18, marginBottom: 4 }}>{t.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: active ? C.brand : C.text, lineHeight: 1.2 }}>{t.label}</div>
              <div style={{
                fontSize: 9, marginTop: 4, fontWeight: 600, padding: '1px 5px', borderRadius: 10,
                background: needsCompany ? C.brandLight : C.greenSoft,
                color: needsCompany ? C.brandMid : C.green,
                display: 'inline-block',
              }}>
                {needsCompany ? `@${COMPANY_DOMAIN}` : 'Personal'}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Shared form fields ────────────────────────────────────────────────────────
function EmployeeFormFields({ form, set, showTempPassword = false }) {
  const isCompanyRequired = REQUIRES_COMPANY_EMAIL.includes(form.employeeType)
  const emailWarning = form.email && form.employeeType ? validateEmailForType(form.email, form.employeeType) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Type selector */}
      <TypeSelector value={form.employeeType} onChange={set('employeeType')} />

      {form.employeeType && (
        <>
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Full Name" value={form.fullName} onChange={set('fullName')} placeholder="Rahul Mehta" required />
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 8 }}>
                Email <span style={{ color: C.accent }}>*</span>
              </label>
              <input
                type="email" value={form.email} onChange={e => set('email')(e.target.value)}
                placeholder={isCompanyRequired ? `name@${COMPANY_DOMAIN}` : 'name@gmail.com'}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8, boxSizing: 'border-box',
                  border: `1.5px solid ${emailWarning ? C.accent : (form.email && !emailWarning ? C.green : C.border)}`,
                  background: C.surfaceAlt, fontSize: 13, color: C.text,
                  fontFamily: "'DM Sans',sans-serif",
                }}
              />
              {form.email && (
                <div style={{ fontSize: 10, marginTop: 4, color: emailWarning ? C.accent : C.green }}>
                  {emailWarning ? `⚠️ ${emailWarning}` : '✓ Valid email format'}
                </div>
              )}
              {!form.email && (
                <div style={{ fontSize: 10, marginTop: 4, color: C.textLight }}>
                  {isCompanyRequired ? `🏢 Requires @${COMPANY_DOMAIN}` : '📧 Personal email (Gmail, Outlook, etc.)'}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Job Title (shown in portal)"  value={form.role} onChange={set('role')}
              placeholder={form.employeeType === 'intern' ? 'Frontend Intern' : form.employeeType === 'contractor' ? 'Freelance Designer' : 'Senior Developer'} required />
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 8 }}>
                Department <span style={{ color: C.accent }}>*</span>
              </label>
              <select value={form.department} onChange={e => set('department')(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: `1.5px solid ${C.border}`, background: C.surfaceAlt,
                  fontSize: 13, color: C.text, fontFamily: "'DM Sans',sans-serif",
                }}>
                <option value="">Select…</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Select label="Role Type" value={form.roleType} onChange={set('roleType')} options={ROLE_TYPES} required />
            <Input label="Join Date" type="date" value={form.joinDate} onChange={set('joinDate')} required />
          </div>

          {/* Internship end date — only for interns */}
          {form.employeeType === 'intern' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Input label="Internship End Date" type="date" value={form.internshipEndDate || ''}
                onChange={set('internshipEndDate')} />
              <Input label="College / Institution (optional)" value={form.college || ''}
                onChange={set('college')} placeholder="IIT Bombay" />
            </div>
          )}

          <Input label="Phone (optional)" type="tel" value={form.phone} onChange={set('phone')} placeholder="+91 98765 43210" />
          <Select label="Gender" value={form.gender || ''} onChange={set('gender')} options={[{value:'',label:'Select…'}, ...GENDERS]} />

          {showTempPassword && (
            <div>
              <Input label="Temporary Password" type="text" value={form.tempPassword}
                onChange={set('tempPassword')} placeholder="e.g. Sportech@2026" required />
              <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>
                Share this with the employee verbally or via secure message.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Modal: Invite via email ───────────────────────────────────────────────────
function InviteModal({ onClose, onSuccess }) {
  const INIT = { fullName: '', email: '', role: '', roleType: 'employee', employeeType: '', department: '', joinDate: new Date().toISOString().split('T')[0], internshipEndDate: '', phone: '', college: '' }
  const [form, setForm] = useState(INIT)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  function set(k) { return v => setForm(f => ({ ...f, [k]: v })) }

  async function submit() {
    if (!form.employeeType) { setError('Select an employment type.'); return }
    if (!form.fullName || !form.email || !form.role || !form.department) { setError('Fill all required fields.'); return }
    const emailErr = validateEmailForType(form.email, form.employeeType)
    if (emailErr) { setError(emailErr); return }
    setLoading(true); setError('')
    try {
      const emp = await inviteEmployee(form)
      onSuccess(emp, 'invited')
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <Modal title="Invite Employee via Email" subtitle="Supabase sends a set-password link to their inbox." onClose={onClose}>
      <div style={{ background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '11px 14px', marginBottom: 18, fontSize: 12, color: '#4338CA' }}>
        📧 The employee gets an email with a secure link to set their own password.
      </div>
      <EmployeeFormFields form={form} set={set} />
      {error && <div style={{ marginTop: 14 }}><Alert type="error" message={error} /></div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={loading || !form.employeeType}>
          {loading ? 'Sending…' : '📧 Send Invite'}
        </Button>
      </div>
    </Modal>
  )
}

// ── Modal: Create with temp password ─────────────────────────────────────────
function CreateModal({ onClose, onSuccess }) {
  const INIT = { fullName: '', email: '', role: '', roleType: 'employee', employeeType: '', department: '', joinDate: new Date().toISOString().split('T')[0], internshipEndDate: '', phone: '', college: '', tempPassword: '' }
  const [form, setForm] = useState(INIT)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  function set(k) { return v => setForm(f => ({ ...f, [k]: v })) }

  async function submit() {
    if (!form.employeeType) { setError('Select an employment type.'); return }
    if (!form.fullName || !form.email || !form.role || !form.department || !form.tempPassword) { setError('Fill all required fields.'); return }
    const emailErr = validateEmailForType(form.email, form.employeeType)
    if (emailErr) { setError(emailErr); return }
    setLoading(true); setError('')
    try {
      const emp = await createEmployeeWithPassword(form)
      onSuccess(emp, 'active')
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <Modal title="Create Account with Temp Password" subtitle="Account is active immediately — no email flow needed." onClose={onClose}>
      <div style={{ background: C.greenSoft, border: `1px solid ${C.green}30`, borderRadius: 8, padding: '11px 14px', marginBottom: 18, fontSize: 12, color: C.green }}>
        🔑 Share the temp password with the employee. They'll be prompted to change it on first login.
      </div>
      <EmployeeFormFields form={form} set={set} showTempPassword />
      {error && <div style={{ marginTop: 14 }}><Alert type="error" message={error} /></div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="success" onClick={submit} disabled={loading || !form.employeeType}>
          {loading ? 'Creating…' : '✓ Create Account'}
        </Button>
      </div>
    </Modal>
  )
}


// ── Modal: Edit existing employee ─────────────────────────────────────────────
function EditEmployeeModal({ employee, allEmployees, onClose, onSaved }) {
  const [form, setForm] = useState({
    role:       employee.role        || '',
    roleType:   employee.role_type   || 'employee',
    employeeType: employee.employee_type || 'permanent',
    department: employee.department  || '',
    managerId:  employee.manager_id  || '',
    joinDate:   employee.join_date   || '',
  })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  function set(k) { return v => setForm(f => ({ ...f, [k]: v })) }

  async function submit() {
    if (!form.role.trim())       { setError('Role is required.');       return }
    if (!form.department.trim()) { setError('Department is required.'); return }
    setLoading(true); setError('')
    try {
      const { data, error: err } = await supabase
        .from('employees')
        .update({
          role:          form.role,
          role_type:     form.roleType,
          employee_type: form.employeeType,
          department:    form.department,
          manager_id:    form.managerId || null,
          join_date:     form.joinDate  || null,
          updated_at:    new Date().toISOString(),
        })
        .eq('id', employee.id)
        .select('*, manager:manager_id(id, full_name, role)')
        .single()
      if (err) throw err
      onSaved(data)
      onClose()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <Modal title={`Edit — ${employee.full_name}`} subtitle="Update role, department, manager and more." onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: C.surfaceAlt, borderRadius: 10, padding: '12px 14px', marginBottom: 18 }}>
        <Avatar initials={employee.avatar_initials || '??'} size={38} />
        <div>
          <div style={{ fontWeight: 600, color: C.text, fontSize: 14 }}>{employee.full_name}</div>
          <div style={{ fontSize: 12, color: C.textLight }}>{employee.email} · {employee.employee_code}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <TypeSelector value={form.employeeType} onChange={set('employeeType')} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Input label="Job Title / Role" value={form.role} onChange={set('role')} placeholder="e.g. Full Stack Developer" required />
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 6 }}>
              Department <span style={{ color: C.accent }}>*</span>
            </label>
            <select value={form.department} onChange={e => set('department')(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1.5px solid ${C.border}`, background: C.surfaceAlt, fontSize: 13, color: C.text, outline: 'none' }}>
              <option value="">Select…</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Select label="Role Type" value={form.roleType} onChange={set('roleType')} options={ROLE_TYPES} required />
          <Input label="Join Date" type="date" value={form.joinDate} onChange={set('joinDate')} />
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 6 }}>
            Reporting Manager
          </label>
          <select value={form.managerId} onChange={e => set('managerId')(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1.5px solid ${C.border}`, background: C.surfaceAlt, fontSize: 13, color: C.text, outline: 'none' }}>
            <option value="">No manager assigned</option>
            {allEmployees
              .filter(e => e.id !== employee.id && e.status === 'active')
              .map(e => (
                <option key={e.id} value={e.id}>{e.full_name} — {e.role}</option>
              ))
            }
          </select>
        </div>
      </div>

      {error && <div style={{ marginTop: 14 }}><Alert type="error" message={error} /></div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={loading}>
          {loading ? 'Saving…' : '✓ Save Changes'}
        </Button>
      </div>
    </Modal>
  )
}

// ── Manager selector component ───────────────────────────────────────────────
function ManagerSelector({ value, onChange, excludeId }) {
  const [managers, setManagers] = useState([])
  useEffect(() => {
    supabase.from('employees')
      .select('id, full_name, role, employee_code')
      .eq('status', 'active')
      .in('role_type', ['admin', 'hr'])
      .order('full_name')
      .then(({ data }) => setManagers(data || []))
  }, [])

  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 6 }}>Reporting Manager</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1.5px solid ${C.border}`, background: C.surfaceAlt, fontSize: 13, color: C.text, outline: 'none' }}>
        <option value="">No manager assigned</option>
        {managers.filter(m => m.id !== excludeId).map(m => (
          <option key={m.id} value={m.id}>{m.full_name} — {m.role}</option>
        ))}
      </select>
    </div>
  )
}

// ── Modal: Approve self-registered employee ───────────────────────────────────
function ApproveModal({ employee, onClose, onApproved }) {
  const [form, setForm] = useState({
    role: employee.role || '', roleType: employee.role_type || 'employee',
    employeeType: employee.employee_type || 'permanent',
    department: employee.department || '', managerId: '',
    joinDate: new Date().toISOString().split('T')[0], internshipEndDate: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  function set(k) { return v => setForm(f => ({ ...f, [k]: v })) }

  async function submit() {
    if (!form.role || !form.department) { setError('Set the role and department.'); return }
    setLoading(true); setError('')
    try {
      const updated = await approveEmployee(employee.id, form)
      onApproved(updated)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <Modal title={`Approve — ${employee.full_name}`} subtitle="Confirm their details before activating access." onClose={onClose}>
      {/* Employee summary */}
      <div style={{ background: C.surfaceAlt, borderRadius: 10, padding: '12px 14px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar initials={employee.avatar_initials || '??'} size={38} />
        <div>
          <div style={{ fontWeight: 600, color: C.text, fontSize: 14 }}>{employee.full_name}</div>
          <div style={{ fontSize: 12, color: C.textMid }}>{employee.email}</div>
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>
            Registered as: <TypeBadge type={employee.employee_type} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Allow HR to correct employee type if needed */}
        <TypeSelector value={form.employeeType} onChange={set('employeeType')} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, paddingTop: 8 }}>
          <Input label="Confirm Job Title" value={form.role} onChange={set('role')} placeholder="Developer" required />
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 8 }}>
              Department <span style={{ color: C.accent }}>*</span>
            </label>
            <select value={form.department} onChange={e => set('department')(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                border: `1.5px solid ${C.border}`, background: C.surfaceAlt,
                fontSize: 13, color: C.text, fontFamily: "'DM Sans',sans-serif",
              }}>
              <option value="">Select…</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Select label="Role Type" value={form.roleType} onChange={set('roleType')} options={ROLE_TYPES} required />
          <Input label="Official Join Date" type="date" value={form.joinDate} onChange={set('joinDate')} required />
        </div>

        {form.employeeType === 'intern' && (
          <Input label="Internship End Date" type="date" value={form.internshipEndDate} onChange={set('internshipEndDate')} />
        )}

        <ManagerSelector value={form.managerId} onChange={set('managerId')} excludeId={employee.id} />
      </div>

      {error && <div style={{ marginTop: 14 }}><Alert type="error" message={error} /></div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="success" onClick={submit} disabled={loading}>
          {loading ? 'Approving…' : '✓ Approve & Activate'}
        </Button>
      </div>
    </Modal>
  )
}

// ── Pending banner ────────────────────────────────────────────────────────────
function PendingBanner({ pending, onApproveClick, onReject }) {
  if (!pending.length) return null
  return (
    <div style={{ background: C.amberSoft, border: `1px solid ${C.amber}40`, borderRadius: 10, padding: '16px 20px', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 16 }}>⏳</span>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.amber, fontFamily: "'Sora',sans-serif" }}>
          {pending.length} Self-Registration{pending.length > 1 ? 's' : ''} Awaiting Approval
        </div>
      </div>
      {pending.map(emp => (
        <div key={emp.id} style={{
          background: '#fff', borderRadius: 8, padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8,
          border: `1px solid ${C.amber}30`,
        }}>
          <Avatar initials={emp.avatar_initials || '??'} size={36} color={C.amber} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: C.text, marginBottom: 2 }}>{emp.full_name}</div>
            <div style={{ fontSize: 11, color: C.textMid, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>{emp.email}</span>
              <TypeBadge type={emp.employee_type} />
              <span style={{ color: C.textLight }}>· {new Date(emp.created_at).toLocaleDateString('en-IN')}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="success" size="sm" onClick={() => onApproveClick(emp)}>Review & Approve</Button>
            <Button variant="ghost"   size="sm" onClick={() => onReject(emp.id)}>Reject</Button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Employee table ────────────────────────────────────────────────────────────
function EmployeeTable({ employees, onResendInvite, onDeactivate, onEmployeeUpdated }) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('active')
  const [editingEmployee, setEditingEmployee] = useState(null)

  const filtered = employees
    .filter(e => statusFilter === 'all' || e.status === statusFilter)
    .filter(e => typeFilter === 'all' || e.employee_type === typeFilter)
    .filter(e => !search ||
      e.full_name.toLowerCase().includes(search.toLowerCase()) ||
      e.email.toLowerCase().includes(search.toLowerCase())
    )

  return (
    <>
    <Card padding="0">
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", marginRight: 'auto' }}>
            Team Members
          </div>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name or email…"
            style={{
              padding: '6px 12px', borderRadius: 7, border: `1px solid ${C.border}`,
              fontSize: 12, width: 180, fontFamily: "'DM Sans',sans-serif",
            }}
          />
          {/* Employee type filter */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[{ value: 'all', label: 'All types' }, ...EMPLOYEE_TYPES.map(t => ({ value: t.value, label: t.label }))].map(f => (
              <button key={f.value} onClick={() => setTypeFilter(f.value)} style={{
                padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                border: typeFilter === f.value ? `1.5px solid ${C.brand}` : `1px solid ${C.border}`,
                background: typeFilter === f.value ? C.brandLight : 'transparent',
                color: typeFilter === f.value ? C.brand : C.textMid,
                fontFamily: "'DM Sans',sans-serif",
              }}>{f.label}</button>
            ))}
          </div>
          {/* Status filter */}
          <div style={{ display: 'flex', gap: 4 }}>
            {['active', 'inactive', 'all'].map(f => (
              <button key={f} onClick={() => setStatusFilter(f)} style={{
                padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                border: statusFilter === f ? `1.5px solid ${C.accent}` : `1px solid ${C.border}`,
                background: statusFilter === f ? C.accentSoft : 'transparent',
                color: statusFilter === f ? C.accent : C.textMid,
                textTransform: 'capitalize', fontFamily: "'DM Sans',sans-serif",
              }}>{f}</button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0
        ? <EmptyState icon="👥" title="No employees found" subtitle="Try a different filter." />
        : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.surfaceAlt }}>
                  {['Employee', 'Type', 'Role', 'Department', 'Joined', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{
                      padding: '10px 14px', textAlign: 'left',
                      fontSize: 10, fontWeight: 700, color: C.textLight,
                      letterSpacing: 0.5, textTransform: 'uppercase',
                      borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((emp, i) => (
                  <tr key={emp.id} style={{ background: i % 2 === 0 ? C.surface : C.surfaceAlt }}>
                    <td style={{ padding: '11px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <Avatar initials={emp.avatar_initials || '??'} size={30}
                          color={emp.status === 'inactive' ? C.textLight : C.brand} />
                        <div>
                          <div style={{ fontWeight: 600, color: emp.status === 'inactive' ? C.textLight : C.text, fontSize: 13 }}>{emp.full_name}</div>
                          <div style={{ fontSize: 10, color: C.textLight }}>{emp.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '11px 14px' }}><TypeBadge type={emp.employee_type} /></td>
                    <td style={{ padding: '11px 14px', color: C.textMid, fontSize: 12 }}>{emp.role}</td>
                    <td style={{ padding: '11px 14px', color: C.textMid, fontSize: 12 }}>{emp.department}</td>
                    <td style={{ padding: '11px 14px', color: C.textLight, fontSize: 11 }}>
                      {emp.join_date ? new Date(emp.join_date).toLocaleDateString('en-IN') : '—'}
                      {emp.internship_end_date && (
                        <div style={{ fontSize: 10, color: C.amber }}>
                          Ends {new Date(emp.internship_end_date).toLocaleDateString('en-IN')}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px' }}><OnboardBadge status={emp.onboarding_status || emp.status} /></td>
                    <td style={{ padding: '11px 14px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {emp.onboarding_status === 'invited' && (
                          <Button variant="outline" size="sm" onClick={() => onResendInvite(emp.email)}>Resend</Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => setEditingEmployee(emp)}>✏️ Edit</Button>
                        {emp.status === 'active' && (
                          <Button variant="ghost" size="sm" onClick={() => onDeactivate(emp.id)}>Deactivate</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </Card>
    {editingEmployee && (
      <EditEmployeeModal
        employee={editingEmployee}
        allEmployees={employees}
        onClose={() => setEditingEmployee(null)}
        onSaved={(updated) => { onEmployeeUpdated?.(updated); setEditingEmployee(null) }}
      />
    )}
  </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function EmployeeManagementPage() {
  const r = useResponsive()
  const { employee: currentEmployee } = useAuth()
  const [employees, setEmployees] = useState([])
  const [pending,   setPending]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState(null)
  const [toApprove, setToApprove] = useState(null)
  const [toast,     setToast]     = useState('')
  const [tab, setTab] = useState('employees')
  const [transferRequests, setTransferRequests] = useState([])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [emps, pend, transfers] = await Promise.all([getAllEmployeesForHR(), getPendingRegistrations(), getPendingHRTransferRequests()])
      setEmployees(emps); setPending(pend); setTransferRequests(transfers)
    } finally { setLoading(false) }
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
        {[{ id: 'employees', label: 'Employees' }, { id: 'transfers', label: `🔁 Transfer Requests${transferRequests.length ? ` (${transferRequests.length})` : ''}` }].map(t => (
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
          <div style={{ display: 'grid', gridTemplateColumns: cols(r, {mobile:2, tablet:3, desktop:5}), gap: 10, marginBottom: 24 }}>
            {[
              { label: 'Active',           val: employees.filter(e => e.status === 'active').length,                          color: C.green,   bg: C.greenSoft  },
              { label: 'Permanent',        val: employees.filter(e => e.employee_type === 'permanent' && e.status === 'active').length, color: C.brand,  bg: C.brandLight },
              { label: 'Interns',          val: employees.filter(e => e.employee_type === 'intern' && e.status === 'active').length,    color: C.purple, bg: C.purpleSoft },
              { label: 'Contractors',      val: employees.filter(e => e.employee_type === 'contractor' && e.status === 'active').length, color: C.amber, bg: C.amberSoft },
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
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", marginBottom: 14 }}>Transfer Requests Awaiting Approval</div>
          {transferRequests.length === 0 ? (
            <EmptyState icon="🔁" title="Nothing pending" subtitle="Transfer requests accepted by the receiving manager will show up here." />
          ) : transferRequests.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: `1px solid ${C.border}` }}>
              <Avatar initials={r.employee?.avatar_initials || '??'} size={32} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{r.employee?.full_name}</div>
                <div style={{ fontSize: 11, color: C.textLight }}>{r.from_manager?.full_name} → {r.to_manager?.full_name}{r.reason ? ` — "${r.reason}"` : ''}</div>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleTransferDecision(r.id, 'rejected')}>Reject</Button>
              <Button size="sm" onClick={() => handleTransferDecision(r.id, 'approved')}>Approve</Button>
            </div>
          ))}
        </Card>
      )}

      {modal === 'invite'  && <InviteModal  onClose={() => setModal(null)} onSuccess={handleSuccess} />}
      {modal === 'create'  && <CreateModal  onClose={() => setModal(null)} onSuccess={handleSuccess} />}
      {modal === 'approve' && toApprove && (
        <ApproveModal employee={toApprove} onClose={() => { setModal(null); setToApprove(null) }} onApproved={handleApproved} />
      )}
    </AppShell>
  )
}
