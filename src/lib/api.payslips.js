import { supabase } from './supabase'

// ── Get payslips for an employee ──────────────────────────────────────────────
export async function getMyPayslips(employeeId) {
  const { data, error } = await supabase
    .from('payslips')
    .select('*')
    .eq('employee_id', employeeId)
    .order('year', { ascending: false })
    .order('month', { ascending: false })
  if (error) throw error
  return data || []
}

// ── Get all payslips for HR ───────────────────────────────────────────────────
export async function getAllPayslips(year) {
  const query = supabase
    .from('payslips')
    .select(`*, employee:employee_id(id, full_name, employee_code, department, role, avatar_initials)`)
    .order('year', { ascending: false })
    .order('month', { ascending: false })
  if (year) query.eq('year', year)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

// ── Get single payslip ────────────────────────────────────────────────────────
export async function getPayslip(id) {
  const { data, error } = await supabase
    .from('payslips')
    .select(`*, employee:employee_id(id, full_name, employee_code, department, role, join_date, avatar_initials, email)`)
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

// ── Create / update payslip ───────────────────────────────────────────────────
export async function savePayslip(payslipData, generatedBy) {
  const { employeeId, month, year, ...fields } = payslipData

  const payload = {
    employee_id: employeeId,
    month, year,
    ...fields,
    generated_by: generatedBy,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('payslips')
    .upsert(payload, { onConflict: 'employee_id,month,year' })
    .select(`*, employee:employee_id(id, full_name, employee_code, department, role, join_date, avatar_initials)`)
    .single()
  if (error) throw error
  return data
}

// ── Delete payslip ────────────────────────────────────────────────────────────
export async function deletePayslip(id) {
  const { error } = await supabase.from('payslips').delete().eq('id', id)
  if (error) throw error
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function calcPayslipTotals(p) {
  const grossEarnings = (p.basic || 0) + (p.hra || 0) + (p.conveyance || 0) +
    (p.medical || 0) + (p.lta || 0) + (p.special_allowance || 0) + (p.other_earnings || 0)
  const totalDeductions = (p.pf_deduction || 0) + (p.pt_deduction || 0) +
    (p.tds_deduction || 0) + (p.lop_deduction || 0) + (p.other_deductions || 0)
  const netSalary = grossEarnings - totalDeductions
  return { grossEarnings, totalDeductions, netSalary }
}

export const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
