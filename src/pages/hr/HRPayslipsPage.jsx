import { useEffect, useState } from 'react'
import AppShell from '../../components/layout/AppShell'
import { Card, Avatar, Button, Spinner, Alert, EmptyState, Input, Select } from '../../components/ui'
import { C, FONTS } from '../../lib/constants'
import { useAuth } from '../../context/AuthContext'
import { getAllPayslips, savePayslip, deletePayslip, calcPayslipTotals, MONTH_NAMES } from '../../lib/api.payslips'
import { supabase } from '../../lib/supabase'
import { getAllEmployees } from '../../lib/api'
import { PayslipDocument, DownloadPayslipButton } from '../../components/PayslipDocument'

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`
const curr = new Date()

const EARNINGS_FIELDS = [
  { key: 'basic',             label: 'Basic Salary' },
  { key: 'hra',               label: 'HRA' },
  { key: 'conveyance',        label: 'Conveyance' },
  { key: 'medical',           label: 'Medical Allowance' },
  { key: 'lta',               label: 'LTA' },
  { key: 'special_allowance', label: 'Special Allowance' },
  { key: 'other_earnings',    label: 'Other Earnings' },
]

const DEDUCTION_FIELDS = [
  { key: 'pf_deduction',      label: 'Provident Fund (PF)' },
  { key: 'pt_deduction',      label: 'Professional Tax (PT)' },
  { key: 'tds_deduction',     label: 'TDS' },
  { key: 'lop_deduction',     label: 'Loss of Pay (LOP)' },
  { key: 'other_deductions',  label: 'Other Deductions' },
]

function emptyForm() {
  return {
    basic: '', hra: '', conveyance: '', medical: '', lta: '',
    special_allowance: '', other_earnings: '',
    pf_deduction: '', pt_deduction: '', tds_deduction: '',
    lop_deduction: '', other_deductions: '',
    bank_name: '', account_number: '', branch_name: '', ifsc_code: '',
    working_days: '30', paid_days: '30',
  }
}

// ── Payslip form modal ────────────────────────────────────────────────────────
function PayslipFormModal({ employees, existing, month, year, onSaved, onClose, generatorId }) {
  const [employeeId, setEmployeeId] = useState(existing?.employee_id || '')
  const [form,       setForm]       = useState(() => {
    if (existing) {
      const f = emptyForm()
      Object.keys(f).forEach(k => { if (existing[k] !== undefined) f[k] = String(existing[k] || '') })
      return f
    }
    return emptyForm()
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [preview, setPreview] = useState(false)

  const set = k => v => setForm(f => ({ ...f, [k]: v }))

  // Auto-populate bank details when employee is selected
  async function handleEmployeeChange(id) {
    setEmployeeId(id)
    if (!id) return
    try {
      const { data } = await supabase
        .from('employee_payroll')
        .select('bank_name, account_number, ifsc_code, branch_name, account_holder_name')
        .eq('employee_id', id)
        .maybeSingle()
      if (data) {
        setForm(f => ({
          ...f,
          bank_name:      data.bank_name      || '',
          account_number: data.account_number || '',
          ifsc_code:      data.ifsc_code      || '',
          branch_name:    data.branch_name    || '',
        }))
      }
    } catch (e) { console.warn('Could not fetch bank details:', e.message) }
  }

  // Auto-calculate special allowance
  const grossTarget = parseFloat(form.basic || 0) + parseFloat(form.hra || 0) +
    parseFloat(form.conveyance || 0) + parseFloat(form.medical || 0) +
    parseFloat(form.lta || 0) + parseFloat(form.special_allowance || 0) +
    parseFloat(form.other_earnings || 0)

  const totalDeductions = DEDUCTION_FIELDS.reduce((s, f) => s + parseFloat(form[f.key] || 0), 0)
  const netSalary = grossTarget - totalDeductions

  const selectedEmp = employees.find(e => e.id === employeeId)

  async function handleSave() {
    if (!employeeId) { setError('Please select an employee.'); return }
    const numericForm = {}
    Object.keys(form).forEach(k => {
      if (['bank_name','account_number','branch_name','ifsc_code'].includes(k)) {
        numericForm[k] = form[k]
      } else {
        numericForm[k] = parseFloat(form[k] || '0') || 0
      }
    })
    setSaving(true); setError('')
    try {
      await savePayslip({ employeeId, month, year, ...numericForm }, generatorId)
      onSaved()
      onClose()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  // Build preview payslip object
  const previewPayslip = {
    ...form,
    ...Object.fromEntries(Object.keys(form).map(k => [k, parseFloat(form[k] || '0') || form[k]])),
    month, year,
    employee: selectedEmp ? {
      full_name: selectedEmp.full_name,
      employee_code: selectedEmp.employee_code,
      role: selectedEmp.role,
      department: selectedEmp.department,
      join_date: selectedEmp.join_date,
    } : {},
    generated_at: new Date().toISOString(),
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(26,26,46,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
      <div style={{ background: C.surface, borderRadius: 16, width: '100%', maxWidth: preview ? 860 : 560, boxShadow: '0 24px 80px rgba(26,26,46,0.2)', margin: 'auto' }}>

        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>
              {existing ? 'Edit' : 'Generate'} Payslip — {MONTH_NAMES[month]} {year}
            </div>
            <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>Fill in the salary components</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {employeeId && (
              <button onClick={() => setPreview(!preview)} style={{ padding: '7px 14px', borderRadius: 8, border: `1.5px solid ${C.brand}`, background: 'transparent', color: C.brand, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {preview ? '← Back to Form' : '👁 Preview'}
              </button>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: C.textLight }}>✕</button>
          </div>
        </div>

        {preview ? (
          <div style={{ padding: 20 }}>
            <div style={{ overflowX: 'auto', borderRadius: 12, border: `1px solid ${C.border}` }}>
              <PayslipDocument payslip={previewPayslip} />
            </div>
          </div>
        ) : (
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Employee select */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 6 }}>Employee *</label>
              <select value={employeeId} onChange={e => handleEmployeeChange(e.target.value)} disabled={!!existing}
                style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none', background: C.surface }}>
                <option value="">Select employee…</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.full_name} — {e.employee_code}</option>)}
              </select>
            </div>

            {/* Earnings */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.brand, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>
                Earnings
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {EARNINGS_FIELDS.map(f => (
                  <Input key={f.key} label={f.label} value={form[f.key]} onChange={set(f.key)} placeholder="0.00" type="number" />
                ))}
              </div>
            </div>

            {/* Deductions */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>
                Deductions
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {DEDUCTION_FIELDS.map(f => (
                  <Input key={f.key} label={f.label} value={form[f.key]} onChange={set(f.key)} placeholder="0.00" type="number" />
                ))}
              </div>
            </div>

            {/* Bank details */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>
                Bank Details
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Input label="Bank Name"       value={form.bank_name}       onChange={set('bank_name')}       placeholder="e.g. HDFC Bank" />
                <Input label="Account Number"  value={form.account_number}  onChange={set('account_number')}  placeholder="Account number" />
                <Input label="Branch Name"     value={form.branch_name}     onChange={set('branch_name')}     placeholder="e.g. Viman Nagar" />
                <Input label="IFSC Code"       value={form.ifsc_code}       onChange={set('ifsc_code')}       placeholder="e.g. HDFC0001234" />
              </div>
            </div>

            {/* Working days */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Input label="Total Working Days" value={form.working_days} onChange={set('working_days')} type="number" />
              <Input label="Paid Days"          value={form.paid_days}    onChange={set('paid_days')}    type="number" />
            </div>

            {/* Summary */}
            <div style={{ background: C.bg, borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: 10, color: C.textLight, fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>Gross Earnings</div><div style={{ fontSize: 16, fontWeight: 800, color: C.brand, fontFamily: FONTS.display }}>{fmt(grossTarget)}</div></div>
              <div><div style={{ fontSize: 10, color: C.textLight, fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>Deductions</div><div style={{ fontSize: 16, fontWeight: 800, color: '#ef4444', fontFamily: FONTS.display }}>({fmt(totalDeductions)})</div></div>
              <div><div style={{ fontSize: 10, color: C.textLight, fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>Net Payable</div><div style={{ fontSize: 16, fontWeight: 800, color: C.green, fontFamily: FONTS.display }}>{fmt(netSalary)}</div></div>
            </div>

            {error && <Alert type="error" message={error} />}

            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={handleSave} disabled={saving} fullWidth>
                {saving ? 'Saving…' : existing ? '✓ Update Payslip' : '✓ Generate Payslip'}
              </Button>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function HRPayslipsPage() {
  const { employee: me } = useAuth()
  const [employees,  setEmployees]  = useState([])
  const [payslips,   setPayslips]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [showForm,   setShowForm]   = useState(false)
  const [editing,    setEditing]    = useState(null)
  const [viewing,    setViewing]    = useState(null)
  const [month,      setMonth]      = useState(curr.getMonth() + 1)
  const [year,       setYear]       = useState(curr.getFullYear())

  async function load() {
    const [emps, slips] = await Promise.all([getAllEmployees(), getAllPayslips(year)])
    setEmployees(emps.filter(e => e.status === 'active' && e.employee_type !== 'intern'))
    setPayslips(slips.filter(s => s.month === month && s.year === year))
    setLoading(false)
  }

  useEffect(() => { load() }, [month, year])

  const monthOptions = MONTH_NAMES.slice(1).map((m, i) => ({ value: String(i + 1), label: m }))
  const yearOptions  = [2024, 2025, 2026, 2027].map(y => ({ value: String(y), label: String(y) }))

  // Employees without payslip this month
  const missing = employees.filter(e => !payslips.find(p => p.employee_id === e.id))

  return (
    <AppShell title="Payslips" subtitle="Generate and manage employee payslips">
      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <Select value={String(month)} onChange={v => setMonth(Number(v))} options={monthOptions} style={{ width: 160 }} />
        <Select value={String(year)}  onChange={v => setYear(Number(v))}  options={yearOptions}  style={{ width: 120 }} />
        <div style={{ flex: 1 }} />
        <Button onClick={() => { setEditing(null); setShowForm(true) }}>
          + Generate Payslip
        </Button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Generated',  val: payslips.length, color: C.green },
          { label: 'Pending',    val: missing.length,  color: C.amber },
          { label: 'Total Staff',val: employees.length, color: C.brand },
        ].map(s => (
          <div key={s.label} style={{ background: C.surface, borderRadius: 14, padding: '16px 20px', border: `1px solid ${C.border}`, borderTop: `3px solid ${s.color}` }}>
            <div style={{ fontSize: 10, color: C.textLight, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color, fontFamily: FONTS.display }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Pending employees */}
      {missing.length > 0 && (
        <div style={{ background: C.amberSoft, border: `1px solid ${C.amber}30`, borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.amber, marginBottom: 8 }}>
            ⏳ {missing.length} employee{missing.length > 1 ? 's' : ''} pending payslip for {MONTH_NAMES[month]} {year}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {missing.map(e => (
              <span key={e.id} onClick={() => { setEditing(null); setShowForm(true) }}
                style={{ background: '#fff', border: `1px solid ${C.amber}40`, borderRadius: 20, padding: '3px 12px', fontSize: 11, fontWeight: 600, color: C.amber, cursor: 'pointer' }}>
                {e.full_name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Generated payslips list */}
      {loading ? <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={32} /></div>
        : payslips.length === 0 ? <EmptyState icon="💰" title={`No payslips for ${MONTH_NAMES[month]} ${year}`} subtitle="Click 'Generate Payslip' to create one." />
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {payslips.map(p => {
              const emp = p.employee || {}
              const { grossEarnings, totalDeductions, netSalary } = calcPayslipTotals(p)
              return (
                <div key={p.id} style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <Avatar initials={emp.avatar_initials || '??'} size={40} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>{emp.full_name}</div>
                    <div style={{ fontSize: 11, color: C.textLight }}>{emp.employee_code} · {emp.department}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Net: {fmt(netSalary)}</div>
                    <div style={{ fontSize: 11, color: C.textLight }}>Gross: {fmt(grossEarnings)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setViewing(p)} style={{ padding: '7px 14px', borderRadius: 8, border: `1.5px solid ${C.border}`, background: C.surface, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: C.text }}>
                      👁 View
                    </button>
                    <button onClick={() => { setEditing(p); setShowForm(true) }} style={{ padding: '7px 14px', borderRadius: 8, border: `1.5px solid ${C.brand}`, background: 'transparent', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: C.brand }}>
                      ✏️ Edit
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

      {/* Payslip form modal */}
      {showForm && (
        <PayslipFormModal
          employees={employees}
          existing={editing}
          month={month}
          year={year}
          generatorId={me?.id}
          onSaved={load}
          onClose={() => { setShowForm(false); setEditing(null) }}
        />
      )}

      {/* View payslip modal */}
      {viewing && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(26,26,46,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto' }}>
          <div style={{ background: C.surface, borderRadius: 16, width: '100%', maxWidth: 860, boxShadow: '0 24px 80px rgba(26,26,46,0.2)', margin: 'auto' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: FONTS.display }}>
                {viewing.employee?.full_name} — {MONTH_NAMES[viewing.month]} {viewing.year}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <DownloadPayslipButton payslip={viewing} />
                <button onClick={() => setViewing(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: C.textLight }}>✕</button>
              </div>
            </div>
            <div style={{ padding: 20, overflowX: 'auto' }}>
              <PayslipDocument payslip={viewing} />
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
