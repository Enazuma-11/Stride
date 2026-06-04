import { useEffect, useState, useCallback } from 'react'
import AppShell from '../../components/layout/AppShell'
import { Card, Avatar, Button, Spinner, Alert, Input, Select, Textarea, SectionTitle } from '../../components/ui'
import { C, GENDERS, DEPARTMENTS, EMPLOYEE_TYPES } from '../../lib/constants'
import { useResponsive } from '../../lib/responsive'
import { useAuth } from '../../context/AuthContext'
import {
  getFullProfile, updateEmployeeBasic, submitChangeRequest,
  addEducation, deleteEducation,
  saveEmergencyContact, deleteEmergencyContact,
  saveDependent, deleteDependent,
  addSkill, deleteSkill,
  addCertification, deleteCertification,
  addLanguage, deleteLanguage,
  uploadDocument, deleteDocument,
  uploadProfilePhoto,
} from '../../lib/api.profile'

const SECTION_TABS = [
  { id: 'personal',   label: '👤 Personal',    free: true  },
  { id: 'work',       label: '💼 Work',         free: false },
  { id: 'contact',    label: '📞 Contact',      free: true  },
  { id: 'payroll',    label: '💰 Payroll',      free: false },
  { id: 'compliance', label: '📋 Compliance',   free: false },
  { id: 'emergency',  label: '🚨 Emergency',    free: true  },
  { id: 'skills',     label: '⭐ Skills',       free: true  },
  { id: 'exit',       label: '🚪 Exit',         free: false },
]

const MARITAL_OPTIONS = [
  { value: '', label: 'Select…' },
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
]

const SOURCE_OPTIONS = [
  { value: '', label: 'Select…' },
  { value: 'referral', label: 'Employee Referral' },
  { value: 'job_board', label: 'Job Board' },
  { value: 'campus', label: 'Campus Placement' },
  { value: 'social_media', label: 'Social Media' },
  { value: 'agency', label: 'Recruitment Agency' },
  { value: 'direct', label: 'Direct Application' },
  { value: 'other', label: 'Other' },
]

const PROFICIENCY_OPTIONS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'expert', label: 'Expert' },
]

const LANG_OPTIONS = [
  { value: 'basic', label: 'Basic' },
  { value: 'conversational', label: 'Conversational' },
  { value: 'professional', label: 'Professional' },
  { value: 'native', label: 'Native' },
]

// ── Reusable field row ────────────────────────────────────────────────────────
function FieldRow({ label, value, placeholder = '—' }) {
  return (
    <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, padding: '12px 0' }}>
      <div style={{ width: 200, fontSize: 12, color: C.textLight, fontWeight: 600, flexShrink: 0, paddingTop: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: value ? C.text : C.textLight, flex: 1 }}>{value || placeholder}</div>
    </div>
  )
}

// ── Section wrapper with edit toggle ─────────────────────────────────────────
function SectionCard({ title, subtitle, isFree, isHR, onSave, children, editChildren }) {
  const [editing, setEditing] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [success, setSuccess] = useState('')

  const canEdit = isFree || isHR

  async function handleSave() {
    setSaving(true); setError(''); setSuccess('')
    try {
      await onSave()
      setSuccess(isFree ? 'Saved successfully.' : 'Change request submitted — pending HR approval.')
      setEditing(false)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Card style={{ padding: '24px 28px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>{subtitle}</div>}
        </div>
        {canEdit && !editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            {isFree ? '✏️ Edit' : '📝 Request Change'}
          </Button>
        )}
      </div>

      {!isFree && !isHR && !editing && (
        <div style={{
          background: C.amberSoft, border: `1px solid ${C.amber}30`,
          borderRadius: 8, padding: '10px 14px', marginBottom: 16,
          fontSize: 12, color: C.amber,
        }}>
          🔒 Changes to this section require HR approval.
        </div>
      )}

      {success && <div style={{ marginBottom: 12 }}><Alert type="success" message={success} /></div>}
      {error   && <div style={{ marginBottom: 12 }}><Alert type="error"   message={error}   /></div>}

      {editing ? (
        <>
          {editChildren}
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : isFree ? 'Save Changes' : 'Submit for HR Approval'}
            </Button>
            <Button variant="outline" onClick={() => { setEditing(false); setError('') }}>Cancel</Button>
          </div>
        </>
      ) : children}
    </Card>
  )
}

// ── SECTION 1: Personal ───────────────────────────────────────────────────────
function PersonalSection({ employee, isHR, onUpdate }) {
  const [form, setForm] = useState({
    first_name: employee.first_name || '',
    middle_name: employee.middle_name || '',
    last_name: employee.last_name || '',
    preferred_name: employee.preferred_name || '',
    display_name: employee.display_name || employee.full_name || '',
    date_of_birth: employee.date_of_birth || '',
    gender: employee.gender || '',
    marital_status: employee.marital_status || '',
    bio: employee.bio || '',
  })
  function set(k) { return v => setForm(f => ({ ...f, [k]: v })) }

  const age = form.date_of_birth
    ? Math.floor((new Date() - new Date(form.date_of_birth)) / (365.25 * 24 * 3600 * 1000))
    : null

  return (
    <SectionCard
      title="Basic & Personal Information"
      isFree={true}
      isHR={isHR}
      onSave={() => onUpdate('basic', form)}
      editChildren={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr 1fr', gap: 12 }}>
            <Input label="First Name"  value={form.first_name}  onChange={set('first_name')}  placeholder="Amit"    />
            <Input label="Middle Name" value={form.middle_name} onChange={set('middle_name')} placeholder="Kumar"   />
            <Input label="Last Name"   value={form.last_name}   onChange={set('last_name')}   placeholder="Chobitkar" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <Input label="Preferred / Nick Name" value={form.preferred_name} onChange={set('preferred_name')} placeholder="Amit" />
            <Input label="Display Name"          value={form.display_name}   onChange={set('display_name')}   placeholder="Amit Chobitkar" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr 1fr', gap: 12 }}>
            <Input label="Date of Birth" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} />
            <Select label="Gender"         value={form.gender}         onChange={set('gender')}         options={[{ value: '', label: 'Select…' }, ...GENDERS]} />
            <Select label="Marital Status" value={form.marital_status} onChange={set('marital_status')} options={MARITAL_OPTIONS} />
          </div>
          <Textarea label="Bio / About Me" value={form.bio} onChange={set('bio')} placeholder="A short bio about yourself…" rows={3} />
        </div>
      }
    >
      <FieldRow label="Full Name"       value={[employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' ') || employee.full_name} />
      <FieldRow label="Preferred Name"  value={employee.preferred_name} />
      <FieldRow label="Display Name"    value={employee.display_name || employee.full_name} />
      <FieldRow label="Date of Birth"   value={employee.date_of_birth ? `${new Date(employee.date_of_birth).toLocaleDateString('en-IN')} (Age ${age})` : null} />
      <FieldRow label="Gender"          value={GENDERS.find(g => g.value === employee.gender)?.label} />
      <FieldRow label="Marital Status"  value={MARITAL_OPTIONS.find(m => m.value === employee.marital_status)?.label} />
      <FieldRow label="Employee ID"     value={employee.employee_code} />
      <FieldRow label="Bio"             value={employee.bio} />
    </SectionCard>
  )
}

// ── SECTION 2: Work ───────────────────────────────────────────────────────────
function WorkSection({ employee, isHR, onUpdate }) {
  const [form, setForm] = useState({
    role: employee.role || '',
    department: employee.department || '',
    division: employee.division || '',
    work_location: employee.work_location || '',
    employee_type: employee.employee_type || 'permanent',
    employment_status: employee.employment_status || 'active',
    join_date: employee.join_date || '',
    probation_end_date: employee.probation_end_date || '',
    source_of_hire: employee.source_of_hire || '',
  })
  function set(k) { return v => setForm(f => ({ ...f, [k]: v })) }

  const tenure = employee.join_date
    ? Math.floor((new Date() - new Date(employee.join_date)) / (365.25 * 24 * 3600 * 1000))
    : null

  return (
    <SectionCard
      title="Work & Hierarchy Information"
      subtitle="Changes require HR approval"
      isFree={isHR}
      isHR={isHR}
      onSave={() => onUpdate('work', form)}
      editChildren={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <Input label="Job Title / Designation" value={form.role}       onChange={set('role')}       placeholder="Senior Developer" />
            <Select label="Department"             value={form.department} onChange={set('department')} options={DEPARTMENTS.map(d => ({ value: d, label: d }))} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <Input label="Division"       value={form.division}      onChange={set('division')}      placeholder="Engineering Division" />
            <Input label="Work Location"  value={form.work_location} onChange={set('work_location')} placeholder="Mumbai HQ / Remote" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr 1fr', gap: 12 }}>
            <Select label="Employment Type"   value={form.employee_type}      onChange={set('employee_type')}      options={EMPLOYEE_TYPES.map(t => ({ value: t.value, label: t.label }))} />
            <Select label="Employment Status" value={form.employment_status}  onChange={set('employment_status')}  options={[{value:'active',label:'Active'},{value:'inactive',label:'Inactive'},{value:'on_leave',label:'On Leave'},{value:'onboarding',label:'Onboarding'}]} />
            <Select label="Source of Hire"    value={form.source_of_hire}     onChange={set('source_of_hire')}     options={SOURCE_OPTIONS} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <Input label="Date of Joining"    type="date" value={form.join_date}          onChange={set('join_date')} />
            <Input label="Probation End Date" type="date" value={form.probation_end_date} onChange={set('probation_end_date')} />
          </div>
        </div>
      }
    >
      <FieldRow label="Job Title"         value={employee.role} />
      <FieldRow label="Department"        value={employee.department} />
      <FieldRow label="Division"          value={employee.division} />
      <FieldRow label="Work Location"     value={employee.work_location} />
      <FieldRow label="Employment Type"   value={EMPLOYEE_TYPES.find(t => t.value === employee.employee_type)?.label} />
      <FieldRow label="Employment Status" value={employee.employment_status} />
      <FieldRow label="Date of Joining"   value={employee.join_date ? `${new Date(employee.join_date).toLocaleDateString('en-IN')} (${tenure}yr tenure)` : null} />
      <FieldRow label="Probation End"     value={employee.probation_end_date ? new Date(employee.probation_end_date).toLocaleDateString('en-IN') : null} />
      <FieldRow label="Source of Hire"    value={SOURCE_OPTIONS.find(s => s.value === employee.source_of_hire)?.label} />
      <FieldRow label="Reporting Manager" value={employee.manager?.full_name} />
    </SectionCard>
  )
}

// ── SECTION 3: Contact ────────────────────────────────────────────────────────
function ContactSection({ employee, isHR, onUpdate }) {
  const addr = employee.present_address || {}
  const perm = employee.permanent_address || {}
  const [form, setForm] = useState({
    work_phone: employee.work_phone || '',
    work_extension: employee.work_extension || '',
    desk_id: employee.desk_id || '',
    personal_mobile: employee.personal_mobile || employee.phone || '',
    personal_email: employee.personal_email || '',
    present_street: addr.street || '',
    present_city: addr.city || '',
    present_state: addr.state || '',
    present_country: addr.country || 'India',
    present_zip: addr.zip || '',
    permanent_street: perm.street || '',
    permanent_city: perm.city || '',
    permanent_state: perm.state || '',
    permanent_country: perm.country || 'India',
    permanent_zip: perm.zip || '',
  })
  function set(k) { return v => setForm(f => ({ ...f, [k]: v })) }

  function buildSaveData() {
    return {
      work_phone: form.work_phone,
      work_extension: form.work_extension,
      desk_id: form.desk_id,
      personal_mobile: form.personal_mobile,
      personal_email: form.personal_email,
      present_address: { street: form.present_street, city: form.present_city, state: form.present_state, country: form.present_country, zip: form.present_zip },
      permanent_address: { street: form.permanent_street, city: form.permanent_city, state: form.permanent_state, country: form.permanent_country, zip: form.permanent_zip },
    }
  }

  return (
    <SectionCard title="Contact Information" isFree={true} isHR={isHR}
      onSave={() => onUpdate('basic', buildSaveData())}
      editChildren={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, letterSpacing: 1, textTransform: 'uppercase' }}>Corporate</div>
          <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr 1fr', gap: 12 }}>
            <Input label="Work Phone"    value={form.work_phone}      onChange={set('work_phone')}      placeholder="+91 22 1234 5678" />
            <Input label="Extension"     value={form.work_extension}  onChange={set('work_extension')}  placeholder="101" />
            <Input label="Desk ID"       value={form.desk_id}         onChange={set('desk_id')}         placeholder="A-203" />
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 }}>Personal</div>
          <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <Input label="Personal Mobile" type="tel"   value={form.personal_mobile} onChange={set('personal_mobile')} placeholder="+91 98765 43210" />
            <Input label="Personal Email"  type="email" value={form.personal_email}  onChange={set('personal_email')}  placeholder="you@gmail.com" />
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 }}>Present Address</div>
          <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <Input label="Street"  value={form.present_street}  onChange={set('present_street')}  placeholder="123 MG Road" />
            <Input label="City"    value={form.present_city}    onChange={set('present_city')}    placeholder="Mumbai" />
            <Input label="State"   value={form.present_state}   onChange={set('present_state')}   placeholder="Maharashtra" />
            <Input label="Country" value={form.present_country} onChange={set('present_country')} placeholder="India" />
            <Input label="ZIP"     value={form.present_zip}     onChange={set('present_zip')}     placeholder="400001" />
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 }}>Permanent Address</div>
          <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <Input label="Street"  value={form.permanent_street}  onChange={set('permanent_street')}  placeholder="123 MG Road" />
            <Input label="City"    value={form.permanent_city}    onChange={set('permanent_city')}    placeholder="Pune" />
            <Input label="State"   value={form.permanent_state}   onChange={set('permanent_state')}   placeholder="Maharashtra" />
            <Input label="Country" value={form.permanent_country} onChange={set('permanent_country')} placeholder="India" />
            <Input label="ZIP"     value={form.permanent_zip}     onChange={set('permanent_zip')}     placeholder="411001" />
          </div>
        </div>
      }
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Corporate</div>
      <FieldRow label="Work Email"    value={employee.email} />
      <FieldRow label="Work Phone"    value={employee.work_phone} />
      <FieldRow label="Extension"     value={employee.work_extension} />
      <FieldRow label="Desk ID"       value={employee.desk_id} />
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, letterSpacing: 1.5, textTransform: 'uppercase', margin: '16px 0 8px' }}>Personal</div>
      <FieldRow label="Mobile"        value={employee.personal_mobile || employee.phone} />
      <FieldRow label="Personal Email" value={employee.personal_email} />
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, letterSpacing: 1.5, textTransform: 'uppercase', margin: '16px 0 8px' }}>Address</div>
      <FieldRow label="Present Address"   value={addr.street ? `${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}` : null} />
      <FieldRow label="Permanent Address" value={perm.street ? `${perm.street}, ${perm.city}, ${perm.state} ${perm.zip}` : null} />
    </SectionCard>
  )
}

// ── SECTION 4: Payroll ────────────────────────────────────────────────────────
function PayrollSection({ payroll, isHR, employeeId, onUpdate }) {
  const p = payroll || {}
  const [form, setForm] = useState({
    base_salary: p.base_salary || '',
    pay_type: p.pay_type || 'salary',
    pay_frequency: p.pay_frequency || 'monthly',
    overtime_eligible: p.overtime_eligible || false,
    bank_name: p.bank_name || '',
    account_holder_name: p.account_holder_name || '',
    account_number: p.account_number || '',
    ifsc_code: p.ifsc_code || '',
    tax_status: p.tax_status || '',
  })
  function set(k) { return v => setForm(f => ({ ...f, [k]: v })) }

  return (
    <SectionCard title="Payroll, Tax & Banking" subtitle="Changes require HR approval" isFree={isHR} isHR={isHR}
      onSave={() => onUpdate('payroll', form)}
      editChildren={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr 1fr', gap: 12 }}>
            <Input label="Base Salary (₹)" type="number" value={form.base_salary} onChange={set('base_salary')} placeholder="50000" />
            <Select label="Pay Type"      value={form.pay_type}      onChange={set('pay_type')}      options={[{value:'salary',label:'Salary'},{value:'hourly',label:'Hourly'},{value:'contract',label:'Contract'}]} />
            <Select label="Pay Frequency" value={form.pay_frequency} onChange={set('pay_frequency')} options={[{value:'monthly',label:'Monthly'},{value:'bi_weekly',label:'Bi-weekly'},{value:'weekly',label:'Weekly'}]} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="checkbox" checked={form.overtime_eligible} onChange={e => set('overtime_eligible')(e.target.checked)} id="ot" />
            <label htmlFor="ot" style={{ fontSize: 13, color: C.text, cursor: 'pointer' }}>Overtime Eligible</label>
          </div>
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, marginBottom: 12 }}>Bank Details</div>
            <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
              <Input label="Bank Name"           value={form.bank_name}           onChange={set('bank_name')}           placeholder="HDFC Bank" />
              <Input label="Account Holder Name" value={form.account_holder_name} onChange={set('account_holder_name')} placeholder="Amit Chobitkar" />
              <Input label="Account Number"      value={form.account_number}      onChange={set('account_number')}      placeholder="1234567890" />
              <Input label="IFSC Code"           value={form.ifsc_code}           onChange={set('ifsc_code')}           placeholder="HDFC0001234" />
            </div>
          </div>
          <Input label="Tax Status / Declaration" value={form.tax_status} onChange={set('tax_status')} placeholder="e.g. New Tax Regime" />
        </div>
      }
    >
      {isHR ? (
        <>
          <FieldRow label="Base Salary"    value={p.base_salary ? `₹${Number(p.base_salary).toLocaleString('en-IN')}` : null} />
          <FieldRow label="Pay Type"       value={p.pay_type} />
          <FieldRow label="Pay Frequency"  value={p.pay_frequency} />
          <FieldRow label="Overtime"       value={p.overtime_eligible ? 'Eligible' : 'Not eligible'} />
          <FieldRow label="Bank"           value={p.bank_name} />
          <FieldRow label="Account"        value={p.account_number ? `****${p.account_number.slice(-4)}` : null} />
          <FieldRow label="IFSC"           value={p.ifsc_code} />
          <FieldRow label="Tax Status"     value={p.tax_status} />
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: '32px', color: C.textLight, fontSize: 13 }}>
          🔒 Payroll details are confidential. Only HR can view this section.
        </div>
      )}
    </SectionCard>
  )
}

// ── SECTION 5: Compliance ─────────────────────────────────────────────────────
function ComplianceSection({ compliance, education, documents, isHR, employeeId, onUpdate, onDocUpload, onDocDelete }) {
  const c = compliance || {}
  const [form, setForm] = useState({
    aadhaar_number: c.aadhaar_number || '',
    pan_number: c.pan_number || '',
    passport_number: c.passport_number || '',
    passport_country: c.passport_country || '',
    passport_issue_date: c.passport_issue_date || '',
    passport_expiry_date: c.passport_expiry_date || '',
    visa_type: c.visa_type || '',
    visa_number: c.visa_number || '',
    visa_expiry_date: c.visa_expiry_date || '',
    nda_signed: c.nda_signed || false,
    nda_signed_date: c.nda_signed_date || '',
    contract_signed: c.contract_signed || false,
    handbook_acknowledged: c.handbook_acknowledged || false,
  })
  function set(k) { return v => setForm(f => ({ ...f, [k]: v })) }
  const [eduForm, setEduForm] = useState({ institution: '', degree: '', major: '', start_year: '', end_year: '' })
  const [addingEdu, setAddingEdu] = useState(false)
  const [uploadingDoc, setUploadingDoc] = useState(false)

  return (
    <SectionCard title="Compliance, Documents & Education" subtitle="Changes require HR approval" isFree={isHR} isHR={isHR}
      onSave={() => onUpdate('compliance', form)}
      editChildren={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <Input label="Aadhaar Number" value={form.aadhaar_number} onChange={set('aadhaar_number')} placeholder="1234 5678 9012" />
            <Input label="PAN Number"     value={form.pan_number}     onChange={set('pan_number')}     placeholder="ABCDE1234F" />
          </div>
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, marginBottom: 12 }}>Passport</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
              <Input label="Passport No."    value={form.passport_number}      onChange={set('passport_number')}      placeholder="A1234567" />
              <Input label="Country"         value={form.passport_country}     onChange={set('passport_country')}     placeholder="India" />
              <Input label="Issue Date"      type="date" value={form.passport_issue_date}  onChange={set('passport_issue_date')} />
              <Input label="Expiry Date"     type="date" value={form.passport_expiry_date} onChange={set('passport_expiry_date')} />
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, marginBottom: 12 }}>Onboarding Docs</div>
            <div style={{ display: 'flex', gap: 20 }}>
              {[['nda_signed','NDA Signed'],['contract_signed','Contract Signed'],['handbook_acknowledged','Handbook Acknowledged']].map(([key,label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form[key]} onChange={e => set(key)(e.target.checked)} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>
      }
    >
      <FieldRow label="Aadhaar" value={c.aadhaar_number ? `****-****-${c.aadhaar_number.slice(-4)}` : null} />
      <FieldRow label="PAN"     value={c.pan_number} />
      <FieldRow label="Passport" value={c.passport_number ? `${c.passport_number} (Exp: ${c.passport_expiry_date || '—'})` : null} />
      <FieldRow label="NDA"      value={c.nda_signed ? `Signed ${c.nda_signed_date || ''}` : 'Not signed'} />
      <FieldRow label="Contract" value={c.contract_signed ? 'Signed' : 'Not signed'} />
      <FieldRow label="Handbook" value={c.handbook_acknowledged ? 'Acknowledged' : 'Pending'} />

      {/* Education */}
      <div style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textLight, letterSpacing: 1.5, textTransform: 'uppercase' }}>Education</div>
          <button onClick={() => setAddingEdu(true)} style={{ fontSize: 11, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>+ Add</button>
        </div>
        {addingEdu && (
          <div style={{ background: C.surfaceAlt, borderRadius: 8, padding: '14px', marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
              <Input label="Institution" value={eduForm.institution} onChange={v => setEduForm(f => ({ ...f, institution: v }))} placeholder="IIT Bombay" />
              <Input label="Degree"      value={eduForm.degree}      onChange={v => setEduForm(f => ({ ...f, degree: v }))}      placeholder="B.Tech" />
              <Input label="Major"       value={eduForm.major}       onChange={v => setEduForm(f => ({ ...f, major: v }))}       placeholder="Computer Science" />
              <Input label="Start Year"  value={eduForm.start_year}  onChange={v => setEduForm(f => ({ ...f, start_year: v }))} placeholder="2018" />
              <Input label="End Year"    value={eduForm.end_year}    onChange={v => setEduForm(f => ({ ...f, end_year: v }))}   placeholder="2022" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button size="sm" onClick={async () => { await onUpdate('addEdu', eduForm); setAddingEdu(false); setEduForm({ institution: '', degree: '', major: '', start_year: '', end_year: '' }) }}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => setAddingEdu(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {education.map(e => (
          <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
            <div>
              <div style={{ fontWeight: 600, color: C.text }}>{e.institution}</div>
              <div style={{ color: C.textMid }}>{e.degree}{e.major ? ` — ${e.major}` : ''} {e.end_year ? `(${e.end_year})` : ''}</div>
            </div>
            <button onClick={() => onUpdate('deleteEdu', e.id)} style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 14 }}>✕</button>
          </div>
        ))}
      </div>

      {/* Documents */}
      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textLight, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 }}>Document Vault</div>
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', borderRadius: 8, border: `1.5px dashed ${C.border}`,
          cursor: 'pointer', fontSize: 12, color: C.textMid, marginBottom: 12,
        }}>
          {uploadingDoc ? '⏳ Uploading…' : '📎 Upload Document'}
          <input type="file" hidden onChange={async (e) => {
            if (!e.target.files[0]) return
            setUploadingDoc(true)
            try { await onDocUpload(e.target.files[0], 'other') }
            finally { setUploadingDoc(false) }
          }} />
        </label>
        {documents.map(d => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 16 }}>📄</span>
            <a href={d.file_url} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: 12, color: C.brand, textDecoration: 'none', fontWeight: 500 }}>
              {d.doc_name}
            </a>
            <span style={{ fontSize: 10, color: C.textLight }}>{d.doc_type}</span>
            <button onClick={() => onDocDelete(d.id, d.file_url)} style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 13 }}>✕</button>
          </div>
        ))}
        {documents.length === 0 && <div style={{ fontSize: 12, color: C.textLight }}>No documents uploaded yet.</div>}
      </div>
    </SectionCard>
  )
}

// ── SECTION 6: Emergency Contacts ─────────────────────────────────────────────
function EmergencySection({ emergency, dependents, isHR, employeeId, onSaveContact, onDeleteContact, onSaveDependent, onDeleteDependent }) {
  const [adding, setAdding] = useState(false)
  const [addingDep, setAddingDep] = useState(false)
  const emptyContact = { full_name: '', relationship: '', phone: '', alt_phone: '', email: '', priority: emergency.length + 1 }
  const emptyDep     = { full_name: '', relationship: '', gender: '', date_of_birth: '', health_insurance_id: '' }
  const [contactForm, setContactForm] = useState(emptyContact)
  const [depForm,     setDepForm]     = useState(emptyDep)

  return (
    <Card style={{ padding: '24px 28px', marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", marginBottom: 20 }}>
        Emergency Contacts & Dependents
      </div>

      {/* Contacts */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textLight, letterSpacing: 1.5, textTransform: 'uppercase' }}>Emergency Contacts</div>
        <button onClick={() => setAdding(true)} style={{ fontSize: 11, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>+ Add Contact</button>
      </div>
      {adding && (
        <div style={{ background: C.surfaceAlt, borderRadius: 8, padding: '14px', marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
            <Input label="Full Name"     value={contactForm.full_name}    onChange={v => setContactForm(f => ({ ...f, full_name: v }))}    placeholder="Priya Chobitkar" />
            <Input label="Relationship"  value={contactForm.relationship} onChange={v => setContactForm(f => ({ ...f, relationship: v }))} placeholder="Spouse" />
            <Input label="Phone"         value={contactForm.phone}        onChange={v => setContactForm(f => ({ ...f, phone: v }))}        placeholder="+91 98765 43210" />
            <Input label="Alt Phone"     value={contactForm.alt_phone}    onChange={v => setContactForm(f => ({ ...f, alt_phone: v }))}    placeholder="Optional" />
            <Input label="Email"         value={contactForm.email}        onChange={v => setContactForm(f => ({ ...f, email: v }))}        placeholder="Optional" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" onClick={async () => { await onSaveContact(contactForm); setAdding(false); setContactForm(emptyContact) }}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {emergency.length === 0 && !adding && <div style={{ fontSize: 12, color: C.textLight, marginBottom: 16 }}>No emergency contacts added yet.</div>}
      {emergency.map(c => (
        <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px solid ${C.border}` }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{c.full_name} <span style={{ color: C.textLight, fontWeight: 400 }}>— {c.relationship}</span></div>
            <div style={{ fontSize: 12, color: C.textMid }}>{c.phone}{c.alt_phone ? ` / ${c.alt_phone}` : ''}</div>
          </div>
          <button onClick={() => onDeleteContact(c.id)} style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
      ))}

      {/* Dependents */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '20px 0 12px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textLight, letterSpacing: 1.5, textTransform: 'uppercase' }}>Dependents</div>
        <button onClick={() => setAddingDep(true)} style={{ fontSize: 11, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>+ Add Dependent</button>
      </div>
      {addingDep && (
        <div style={{ background: C.surfaceAlt, borderRadius: 8, padding: '14px', marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
            <Input label="Full Name"          value={depForm.full_name}           onChange={v => setDepForm(f => ({ ...f, full_name: v }))}           placeholder="Arjun Chobitkar" />
            <Input label="Relationship"       value={depForm.relationship}        onChange={v => setDepForm(f => ({ ...f, relationship: v }))}        placeholder="Son" />
            <Select label="Gender"            value={depForm.gender}              onChange={v => setDepForm(f => ({ ...f, gender: v }))}              options={[{value:'',label:'Select…'},...GENDERS]} />
            <Input label="Date of Birth"      type="date" value={depForm.date_of_birth}      onChange={v => setDepForm(f => ({ ...f, date_of_birth: v }))} />
            <Input label="Health Insurance ID" value={depForm.health_insurance_id} onChange={v => setDepForm(f => ({ ...f, health_insurance_id: v }))} placeholder="Optional" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" onClick={async () => { await onSaveDependent(depForm); setAddingDep(false); setDepForm(emptyDep) }}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => setAddingDep(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {dependents.length === 0 && !addingDep && <div style={{ fontSize: 12, color: C.textLight }}>No dependents added yet.</div>}
      {dependents.map(d => (
        <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13, color: C.text }}>{d.full_name} <span style={{ color: C.textLight }}>— {d.relationship}</span></div>
          <button onClick={() => onDeleteDependent(d.id)} style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
      ))}
    </Card>
  )
}

// ── SECTION 7: Skills ─────────────────────────────────────────────────────────
function SkillsSection({ skills, certifications, languages, employeeId, onAddSkill, onDeleteSkill, onAddCert, onDeleteCert, onAddLang, onDeleteLang }) {
  const [skillForm, setSkillForm] = useState({ skill_name: '', category: 'Technical', proficiency: 'intermediate' })
  const [certForm,  setCertForm]  = useState({ title: '', issuing_authority: '', license_number: '', issue_date: '', expiry_date: '' })
  const [langForm,  setLangForm]  = useState({ language: '', proficiency: 'professional' })

  const PROF_COLORS = { beginner: C.textLight, intermediate: C.amber, advanced: C.green, expert: C.brand }

  return (
    <Card style={{ padding: '24px 28px', marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", marginBottom: 20 }}>
        Skills & Certifications
      </div>

      {/* Skills */}
      <SectionTitle>Technical Skills & Competencies</SectionTitle>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {skills.map(s => (
          <div key={s.id} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: C.brandLight, borderRadius: 20, padding: '5px 12px',
            fontSize: 12, color: C.brand, fontWeight: 600,
          }}>
            {s.skill_name}
            <span style={{ fontSize: 9, color: PROF_COLORS[s.proficiency] || C.textLight, fontWeight: 700, textTransform: 'uppercase' }}>{s.proficiency}</span>
            <button onClick={() => onDeleteSkill(s.id)} style={{ background: 'none', border: 'none', color: C.textLight, cursor: 'pointer', fontSize: 12, padding: 0 }}>×</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 140px auto', gap: 8, marginBottom: 20 }}>
        <Input label="" value={skillForm.skill_name} onChange={v => setSkillForm(f => ({ ...f, skill_name: v }))} placeholder="e.g. React, Python…" />
        <select value={skillForm.category} onChange={e => setSkillForm(f => ({ ...f, category: e.target.value }))}
          style={{ padding: '10px 10px', borderRadius: 8, border: `1.5px solid ${C.border}`, background: C.surfaceAlt, fontSize: 12, fontFamily: "'DM Sans',sans-serif" }}>
          {['Technical','Soft Skill','Domain','Leadership','Other'].map(c => <option key={c}>{c}</option>)}
        </select>
        <Select label="" value={skillForm.proficiency} onChange={v => setSkillForm(f => ({ ...f, proficiency: v }))} options={PROFICIENCY_OPTIONS} />
        <button onClick={async () => { await onAddSkill(skillForm); setSkillForm({ skill_name: '', category: 'Technical', proficiency: 'intermediate' }) }}
          style={{ padding: '10px 16px', borderRadius: 8, background: C.brand, color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 2 }}>
          + Add
        </button>
      </div>

      {/* Languages */}
      <SectionTitle>Language Proficiencies</SectionTitle>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {languages.map(l => (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.purpleSoft, borderRadius: 20, padding: '5px 12px', fontSize: 12, color: C.purple, fontWeight: 600 }}>
            {l.language} <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>{l.proficiency}</span>
            <button onClick={() => onDeleteLang(l.id)} style={{ background: 'none', border: 'none', color: C.textLight, cursor: 'pointer', fontSize: 12, padding: 0 }}>×</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px auto', gap: 8, marginBottom: 20 }}>
        <Input label="" value={langForm.language} onChange={v => setLangForm(f => ({ ...f, language: v }))} placeholder="e.g. Hindi, English…" />
        <Select label="" value={langForm.proficiency} onChange={v => setLangForm(f => ({ ...f, proficiency: v }))} options={LANG_OPTIONS} />
        <button onClick={async () => { await onAddLang(langForm); setLangForm({ language: '', proficiency: 'professional' }) }}
          style={{ padding: '10px 16px', borderRadius: 8, background: C.purple, color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 2 }}>
          + Add
        </button>
      </div>

      {/* Certifications */}
      <SectionTitle>Professional Certifications</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 8, marginBottom: 14 }}>
        <Input label="" value={certForm.title}            onChange={v => setCertForm(f => ({ ...f, title: v }))}            placeholder="AWS Solutions Architect" />
        <Input label="" value={certForm.issuing_authority} onChange={v => setCertForm(f => ({ ...f, issuing_authority: v }))} placeholder="Amazon Web Services" />
        <Input label="" value={certForm.license_number}   onChange={v => setCertForm(f => ({ ...f, license_number: v }))}   placeholder="License No." />
        <Input label="" type="date" value={certForm.expiry_date} onChange={v => setCertForm(f => ({ ...f, expiry_date: v }))} />
        <button onClick={async () => { await onAddCert(certForm); setCertForm({ title: '', issuing_authority: '', license_number: '', issue_date: '', expiry_date: '' }) }}
          style={{ padding: '10px 16px', borderRadius: 8, background: C.green, color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 2 }}>
          + Add
        </button>
      </div>
      {certifications.map(cert => (
        <div key={cert.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
          <div>
            <div style={{ fontWeight: 600, color: C.text }}>{cert.title}</div>
            <div style={{ fontSize: 11, color: C.textMid }}>{cert.issuing_authority}{cert.expiry_date ? ` · Expires ${cert.expiry_date}` : ''}</div>
          </div>
          <button onClick={() => onDeleteCert(cert.id)} style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
      ))}
    </Card>
  )
}

// ── SECTION 8: Exit ───────────────────────────────────────────────────────────
function ExitSection({ exit, isHR, employeeId, onUpdate }) {
  const e = exit || {}
  const [form, setForm] = useState({
    last_working_day: e.last_working_day || '',
    notice_period_followed: e.notice_period_followed || false,
    reason_for_leaving: e.reason_for_leaving || '',
    it_assets_returned: e.it_assets_returned || false,
    accounts_deactivated: e.accounts_deactivated || false,
    handover_notes_completed: e.handover_notes_completed || false,
    exit_interview_completed: e.exit_interview_completed || false,
    exit_interview_notes: e.exit_interview_notes || '',
  })
  function set(k) { return v => setForm(f => ({ ...f, [k]: v })) }

  const checklist = [
    { key: 'it_assets_returned',        label: 'IT Assets Returned'           },
    { key: 'accounts_deactivated',      label: 'Corporate Accounts Deactivated'},
    { key: 'handover_notes_completed',  label: 'Handover Notes Completed'      },
    { key: 'exit_interview_completed',  label: 'Exit Interview Completed'       },
  ]

  return (
    <SectionCard title="Separation & Exit Details" subtitle="HR manages exit process" isFree={isHR} isHR={isHR}
      onSave={() => onUpdate('exit', form)}
      editChildren={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <Input label="Last Working Day" type="date" value={form.last_working_day} onChange={set('last_working_day')} />
            <Select label="Reason for Leaving" value={form.reason_for_leaving} onChange={set('reason_for_leaving')}
              options={[
                {value:'',label:'Select…'},
                {value:'resignation',label:'Resignation'},
                {value:'retirement',label:'Retirement'},
                {value:'end_of_contract',label:'End of Contract'},
                {value:'termination',label:'Termination'},
                {value:'redundancy',label:'Redundancy'},
                {value:'other',label:'Other'},
              ]} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.notice_period_followed} onChange={e => set('notice_period_followed')(e.target.checked)} />
              Notice Period Followed
            </label>
            {checklist.map(({ key, label }) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={form[key]} onChange={e => set(key)(e.target.checked)} />
                {label}
              </label>
            ))}
          </div>
          <Textarea label="Exit Interview Notes" value={form.exit_interview_notes} onChange={set('exit_interview_notes')} rows={3} placeholder="Summary of exit interview…" />
        </div>
      }
    >
      {!e.last_working_day ? (
        <div style={{ fontSize: 13, color: C.textLight, padding: '12px 0' }}>No exit process initiated.</div>
      ) : (
        <>
          <FieldRow label="Last Working Day"      value={e.last_working_day ? new Date(e.last_working_day).toLocaleDateString('en-IN') : null} />
          <FieldRow label="Reason"                value={e.reason_for_leaving} />
          <FieldRow label="Notice Period"         value={e.notice_period_followed ? 'Followed' : 'Not followed'} />
          <div style={{ marginTop: 12 }}>
            {checklist.map(({ key, label }) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 13 }}>
                <span style={{ color: e[key] ? C.green : C.accent }}>{e[key] ? '✅' : '⬜'}</span>
                <span style={{ color: e[key] ? C.text : C.textMid }}>{label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </SectionCard>
  )
}

// ── PROFILE PHOTO ─────────────────────────────────────────────────────────────
function ProfileHeader({ employee, isHR, onPhotoUpload }) {
  const r = useResponsive()
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')

  return (
    <Card style={{ padding: '24px 28px', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: r.isMobile ? 'flex-start' : 'center', gap: 16, flexWrap: r.isMobile ? 'wrap' : 'nowrap' }}>
        {/* Photo */}
        <div style={{ position: 'relative' }}>
          {employee.profile_photo_url
            ? <img src={employee.profile_photo_url} alt={employee.full_name} style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', border: `3px solid ${C.brand}` }} />
            : <Avatar initials={employee.avatar_initials || '??'} size={80} color={C.brand} />
          }
          <label style={{
            position: 'absolute', bottom: 0, right: 0,
            width: 26, height: 26, borderRadius: '50%',
            background: C.brand, border: '2px solid #fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: 12,
          }}>
            {uploading ? '⏳' : '📷'}
            <input type="file" accept="image/*" hidden onChange={async (e) => {
              if (!e.target.files[0]) return
              setUploading(true)
              try { setPhotoError(''); await onPhotoUpload(e.target.files[0]) }
              catch (err) { setPhotoError(err.message) }
              finally { setUploading(false) }
            }} />
          </label>
        </div>

        {/* Photo error */}
        {photoError && (
          <div style={{ position: 'absolute', top: 84, left: 0, fontSize: 10, color: C.accent, width: 80, textAlign: 'center', lineHeight: 1.3 }}>
            {photoError}
          </div>
        )}

        {/* Info */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.text, fontFamily: "'Sora',sans-serif" }}>
            {employee.display_name || employee.full_name}
          </div>
          <div style={{ fontSize: 13, color: C.textMid, marginTop: 2 }}>{employee.role} · {employee.department}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {employee.employee_code && (
              <span style={{ fontSize: 11, background: C.brandLight, color: C.brand, padding: '2px 10px', borderRadius: 20, fontWeight: 600 }}>
                {employee.employee_code}
              </span>
            )}
            <span style={{ fontSize: 11, background: C.greenSoft, color: C.green, padding: '2px 10px', borderRadius: 20, fontWeight: 600, textTransform: 'capitalize' }}>
              {employee.employment_status || 'active'}
            </span>
            <span style={{ fontSize: 11, background: C.surfaceAlt, color: C.textMid, padding: '2px 10px', borderRadius: 20, fontWeight: 600 }}>
              {employee.email}
            </span>
          </div>
        </div>
      </div>
    </Card>
  )
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const r = useResponsive()
  const { employee: me, isHR, refetchEmployee } = useAuth()
  const [profile,  setProfile]  = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [tab,      setTab]      = useState('personal')

  const load = useCallback(async () => {
    if (!me) return
    setLoading(true)
    try {
      const data = await getFullProfile(me.id)
      setProfile(data)
    } finally { setLoading(false) }
  }, [me])

  useEffect(() => { load() }, [load])

  // ── update handlers ────────────────────────────────────────────────────────
  async function handleUpdate(section, data) {
    if (section === 'basic' || section === 'contact') {
      await updateEmployeeBasic(me.id, data)
      await refetchEmployee()
      await load()
    } else if (section === 'addEdu') {
      await addEducation(me.id, data)
      await load()
    } else if (section === 'deleteEdu') {
      await deleteEducation(data)
      await load()
    } else if (['work','payroll','compliance','exit'].includes(section)) {
      if (isHR) {
        const { hrUpdateEmployee } = await import('../../lib/api.profile')
        await hrUpdateEmployee(me.id, section, data)
      } else {
        await submitChangeRequest(me.id, section, data)
      }
      await load()
    }
  }

  async function handlePhotoUpload(file) {
    await uploadProfilePhoto(me.id, file)
    await refetchEmployee()
    await load()
  }

  async function handleDocUpload(file, docType) {
    await uploadDocument(me.id, file, docType, me.id)
    await load()
  }

  async function handleDocDelete(id, url) {
    await deleteDocument(id, url)
    await load()
  }

  if (loading || !profile) return (
    <AppShell title="My Profile">
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><Spinner size={36} /></div>
    </AppShell>
  )

  const { employee, payroll, compliance, education, documents, emergency, dependents, skills, certifications, languages, exit } = profile

  return (
    <AppShell title="My Profile" subtitle="Manage your personal and professional information">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap'); @keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <ProfileHeader employee={employee} isHR={isHR} onPhotoUpload={handlePhotoUpload} />

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: C.surface, padding: 6, borderRadius: 10, boxShadow: C.shadow, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {SECTION_TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '7px 14px', borderRadius: 7, border: 'none',
            background: tab === t.id ? C.brand : 'transparent',
            color: tab === t.id ? '#fff' : C.textMid,
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
            fontFamily: "'Sora',sans-serif",
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            {t.label}
            {!t.free && <span style={{ fontSize: 9, opacity: 0.6 }}>🔒</span>}
          </button>
        ))}
      </div>

      {tab === 'personal'   && <PersonalSection   employee={employee}             isHR={isHR} onUpdate={handleUpdate} />}
      {tab === 'work'       && <WorkSection        employee={employee}             isHR={isHR} onUpdate={handleUpdate} />}
      {tab === 'contact'    && <ContactSection     employee={employee}             isHR={isHR} onUpdate={handleUpdate} />}
      {tab === 'payroll'    && <PayrollSection     payroll={payroll}   employeeId={me.id} isHR={isHR} onUpdate={handleUpdate} />}
      {tab === 'compliance' && <ComplianceSection  compliance={compliance} education={education} documents={documents} isHR={isHR} employeeId={me.id} onUpdate={handleUpdate} onDocUpload={handleDocUpload} onDocDelete={handleDocDelete} />}
      {tab === 'emergency'  && <EmergencySection   emergency={emergency} dependents={dependents} isHR={isHR} employeeId={me.id}
        onSaveContact={async d => { await saveEmergencyContact(me.id, d); await load() }}
        onDeleteContact={async id => { await deleteEmergencyContact(id); await load() }}
        onSaveDependent={async d => { await saveDependent(me.id, d); await load() }}
        onDeleteDependent={async id => { await deleteDependent(id); await load() }}
      />}
      {tab === 'skills'     && <SkillsSection      skills={skills} certifications={certifications} languages={languages} employeeId={me.id}
        onAddSkill={async d => { await addSkill(me.id, d); await load() }}
        onDeleteSkill={async id => { await deleteSkill(id); await load() }}
        onAddCert={async d => { await addCertification(me.id, d); await load() }}
        onDeleteCert={async id => { await deleteCertification(id); await load() }}
        onAddLang={async d => { await addLanguage(me.id, d); await load() }}
        onDeleteLang={async id => { await deleteLanguage(id); await load() }}
      />}
      {tab === 'exit'       && <ExitSection        exit={exit} isHR={isHR} employeeId={me.id} onUpdate={handleUpdate} />}
    </AppShell>
  )
}
