import { supabase } from './supabase'
import { todayISO, addDaysISO } from './api.attendance'

export async function getPendingRegularizationsForHR() {
  const { data, error } = await supabase
    .from('attendance_regularization_requests')
    .select('id, employee_id, status, submitted_at, employee:employee_id(full_name)')
    .eq('status', 'pending_admin')
    .order('submitted_at', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    id: r.id,
    employee_id: r.employee_id,
    full_name: r.employee?.full_name || 'Unknown',
    status: r.status,
    created_at: r.submitted_at,
  }))
}

export async function getPendingTransfersForHR() {
  const { data, error } = await supabase
    .from('manager_transfer_requests')
    .select('id, employee_id, status, created_at, employee:employee_id(full_name), to_manager:to_manager_id(full_name)')
    .in('status', ['pending_hr', 'pending_target'])
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    id: r.id,
    employee_id: r.employee_id,
    full_name: r.employee?.full_name || 'Unknown',
    to_manager_name: r.to_manager?.full_name || 'Unknown',
    status: r.status,
    created_at: r.created_at,
  }))
}

export async function getExpiringCertificationsForHR() {
  const today  = todayISO()
  const future = addDaysISO(today, 30)
  const { data, error } = await supabase
    .from('employee_certifications')
    .select('id, employee_id, title, expiry_date, employee:employee_id(full_name)')
    .gte('expiry_date', today)
    .lte('expiry_date', future)
    .order('expiry_date', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    id: r.id,
    employee_id: r.employee_id,
    full_name: r.employee?.full_name || 'Unknown',
    title: r.title,
    expiry_date: r.expiry_date,
  }))
}

export async function getProbationEndingSoon() {
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name, employee_type, join_date')
    .eq('status', 'active')
    .in('employee_type', ['intern', 'probation'])
  if (error) throw error
  const today = new Date(todayISO())
  return (data || [])
    .map(e => {
      const end = new Date(e.join_date)
      end.setMonth(end.getMonth() + 6)
      const daysLeft = Math.ceil((end - today) / 86400000)
      return { ...e, end_date: end.toISOString().split('T')[0], days_left: daysLeft }
    })
    .filter(e => e.days_left >= 0 && e.days_left <= 14)
    .sort((a, b) => a.days_left - b.days_left)
}

export async function getMyUnregularizedSessions(employeeId) {
  const today = todayISO()
  const cutoff = addDaysISO(today, -14)
  const { data, error } = await supabase
    .from('attendance_sessions')
    .select('id, check_in')
    .eq('employee_id', employeeId)
    .gte('check_in', `${cutoff}T00:00:00.000Z`)
    .lt('check_in', `${today}T00:00:00.000Z`)
    .is('check_out', null)
    .order('check_in', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getEmployeesForHRDashboard() {
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name, role, department, avatar_initials, email, manager_id, status, employee_type, date_of_birth')
    .eq('status', 'active')
  if (error) throw error
  return data || []
}

export async function getMyExpiringCertifications(employeeId) {
  const today  = todayISO()
  const future = addDaysISO(today, 30)
  const { data, error } = await supabase
    .from('employee_certifications')
    .select('id, title, expiry_date')
    .eq('employee_id', employeeId)
    .gte('expiry_date', today)
    .lte('expiry_date', future)
    .order('expiry_date', { ascending: true })
  if (error) throw error
  return data || []
}
