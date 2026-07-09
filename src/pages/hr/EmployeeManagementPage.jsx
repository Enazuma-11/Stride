import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import { Card, Avatar, Button, Spinner, EmptyState, Alert, Input, Select, SectionTitle } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { C, FONTS, EMPLOYEE_TYPES, DEPARTMENTS, ROLE_TYPES, REQUIRES_COMPANY_EMAIL, COMPANY_DOMAIN, GENDERS } from '../../lib/constants'
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
import { getPendingReviews, getProbationEmployees, hrDecideReview } from '../../lib/api.probation'
import { getAnnualCycle, getPerformanceOverview, finalizeReview } from '../../lib/api.performance'
import { getVerdict } from '../../lib/constants'

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
    // Any active employee can be assigned as a manager — "manager" isn't a
    // role_type, it's emergent from being referenced by another employee's
    // manager_id (same convention used by Attendance and Transfer Requests).
    // Previously restricted to role_type IN ('admin','hr'), which meant HR
    // couldn't promote a regular employee into managing anyone for the
    // first time — they'd never even appear in this dropdown.
    supabase.from('employees')
      .select('id, full_name, role, employee_code')
      .eq('status', 'active')
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
                      <span style={{ fontSize: 11, fontWeight: 700, color: subBadge.color, background: subBadge.bg, padding: '3px 10px', borderRadius: 20 }}>Goals: {subBadge.label}</span>
                      <span style={{ fontSize: 11, color: C.textLight }}>H1: {row.h1 ? '✓' : '—'}</span>
                      {verdict
                        ? <span style={{ fontSize: 11, fontWeight: 700, color: verdict.color, background: verdict.bg, padding: '3px 10px', borderRadius: 20 }}>{verdict.label}{ye.status === 'hr_finalized' ? ' ✓' : ''}</span>
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
