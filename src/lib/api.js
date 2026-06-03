import { supabase } from './supabase'

// ─── AUTH ─────────────────────────────────────────────────────────────────────

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// ─── EMPLOYEES ────────────────────────────────────────────────────────────────

export async function getMyProfile(userId) {
  const { data, error } = await supabase
    .from('employees')
    .select('*, manager:manager_id(id, full_name, role)')
    .eq('user_id', userId)
    .single()
  if (error) throw error
  return data
}

export async function getAllEmployees() {
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name, role, department, avatar_initials, email, manager_id, status')
    .eq('status', 'active')
    .order('full_name')
  if (error) throw error
  return data
}

// ─── LEAVE BALANCES ───────────────────────────────────────────────────────────

export async function getMyLeaveBalances(employeeId) {
  const { data, error } = await supabase
    .from('leave_balances')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('year', new Date().getFullYear())
  if (error) throw error
  return data
}

// ─── LEAVE REQUESTS ───────────────────────────────────────────────────────────

export async function getMyLeaveRequests(employeeId) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function getAllLeaveRequests() {
  const { data, error } = await supabase
    .from('leave_requests')
    .select(`
      *,
      employee:employee_id (
        id, full_name, role, department, avatar_initials
      )
    `)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function applyLeave({ employeeId, leaveType, fromDate, toDate, days, reason }) {
  const { data, error } = await supabase
    .from('leave_requests')
    .insert({
      employee_id: employeeId,
      leave_type:  leaveType,
      from_date:   fromDate,
      to_date:     toDate,
      days,
      reason,
      status:      'pending',
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateLeaveStatus(leaveId, status, reviewedBy) {
  const { data, error } = await supabase
    .from('leave_requests')
    .update({
      status,
      reviewed_by:  reviewedBy,
      reviewed_at:  new Date().toISOString(),
    })
    .eq('id', leaveId)
    .select()
    .single()
  if (error) throw error

  // Update leave balance if approved
  if (status === 'approved') {
    const leave = data
    await supabase.rpc('deduct_leave_balance', {
      p_employee_id: leave.employee_id,
      p_leave_type:  leave.leave_type,
      p_days:        leave.days,
      p_year:        new Date(leave.from_date).getFullYear(),
    })
  }
  return data
}

// ─── ANNOUNCEMENTS ────────────────────────────────────────────────────────────

export async function getAnnouncements() {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw error
  return data
}
