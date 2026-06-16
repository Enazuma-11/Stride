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

// ─── HR: GET ALL EMPLOYEES' LEAVE BALANCES ────────────────────────────────────
export async function getAllLeaveBalances() {
  const { data, error } = await supabase
    .from('leave_balances')
    .select(`
      *,
      employee:employee_id (id, full_name, avatar_initials, department, employee_type, status)
    `)
    .eq('year', new Date().getFullYear())
    .order('employee_id')
  if (error) throw error
  return data || []
}

// ─── HR: ADD LEAVE DAYS FOR AN EMPLOYEE ──────────────────────────────────────
export async function hrAdjustLeave(employeeId, leaveType, adjustment, reason, adjustedBy) {
  const year = new Date().getFullYear()

  // Get current balance
  const { data: balance, error: fetchErr } = await supabase
    .from('leave_balances')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('leave_type', leaveType)
    .eq('year', year)
    .maybeSingle()

  if (fetchErr) throw fetchErr

  if (balance) {
    // Update existing balance
    const newTotal = Math.max(0, balance.total_days + adjustment)
    const { data, error } = await supabase
      .from('leave_balances')
      .update({
        total_days: newTotal,
        updated_at: new Date().toISOString(),
      })
      .eq('id', balance.id)
      .select()
      .single()
    if (error) throw error

    // Log the adjustment
    await logLeaveAdjustment(employeeId, leaveType, adjustment, reason, adjustedBy, balance.total_days, newTotal)
    return data
  } else {
    // Create new balance
    const newTotal = Math.max(0, adjustment)
    const { data, error } = await supabase
      .from('leave_balances')
      .insert({
        employee_id: employeeId,
        leave_type:  leaveType,
        year,
        total_days:  newTotal,
        used_days:   0,
      })
      .select()
      .single()
    if (error) throw error

    await logLeaveAdjustment(employeeId, leaveType, adjustment, reason, adjustedBy, 0, newTotal)
    return data
  }
}

// ─── HR: SET LEAVE BALANCE DIRECTLY ──────────────────────────────────────────
export async function hrSetLeaveBalance(employeeId, leaveType, totalDays, reason, adjustedBy) {
  const year = new Date().getFullYear()

  const { data: existing } = await supabase
    .from('leave_balances')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('leave_type', leaveType)
    .eq('year', year)
    .maybeSingle()

  const oldTotal = existing?.total_days || 0

  const { data, error } = await supabase
    .from('leave_balances')
    .upsert({
      employee_id: employeeId,
      leave_type:  leaveType,
      year,
      total_days:  Math.max(0, totalDays),
      used_days:   existing?.used_days || 0,
    }, { onConflict: 'employee_id,leave_type,year' })
    .select()
    .single()
  if (error) throw error

  await logLeaveAdjustment(employeeId, leaveType, totalDays - oldTotal, reason, adjustedBy, oldTotal, totalDays)
  return data
}

// ─── LOG LEAVE ADJUSTMENT ─────────────────────────────────────────────────────
async function logLeaveAdjustment(employeeId, leaveType, adjustment, reason, adjustedBy, oldTotal, newTotal) {
  await supabase.from('leave_adjustments').insert({
    employee_id:  employeeId,
    leave_type:   leaveType,
    adjustment,
    reason,
    adjusted_by:  adjustedBy,
    old_total:    oldTotal,
    new_total:    newTotal,
    year:         new Date().getFullYear(),
  }).select()
  // Don't throw — log failure shouldn't break the main operation
}

// ─── GET LEAVE ADJUSTMENT HISTORY ────────────────────────────────────────────
export async function getLeaveAdjustmentHistory(employeeId) {
  const { data, error } = await supabase
    .from('leave_adjustments')
    .select(`*, adjuster:adjusted_by(full_name)`)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return data || []
}

// ─── HR: RECORD LEAVE ON BEHALF OF EMPLOYEE ──────────────────────────────────
export async function hrRecordLeave({ employeeId, leaveType, fromDate, toDate, days, reason, recordedBy }) {
  // Insert leave request as approved
  const { data: leave, error: leaveErr } = await supabase
    .from('leave_requests')
    .insert({
      employee_id:  employeeId,
      leave_type:   leaveType,
      from_date:    fromDate,
      to_date:      toDate,
      days,
      reason:       reason + ` (Recorded by HR)`,
      status:       'approved',
      reviewed_by:  recordedBy,
      reviewed_at:  new Date().toISOString(),
    })
    .select()
    .single()
  if (leaveErr) throw leaveErr

  // Deduct from leave balance
  const year = new Date(fromDate).getFullYear()
  const { data: bal, error: balErr } = await supabase
    .from('leave_balances')
    .select('id, used_days, total_days')
    .eq('employee_id', employeeId)
    .eq('leave_type', leaveType)
    .eq('year', year)
    .maybeSingle()

  if (balErr) throw balErr

  if (bal) {
    const newUsed = Math.min(bal.total_days, bal.used_days + days)
    await supabase
      .from('leave_balances')
      .update({ used_days: newUsed })
      .eq('id', bal.id)
  }

  return leave
}
