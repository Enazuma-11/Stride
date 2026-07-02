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

export async function applyLeave({ employeeId, leaveType, fromDate, toDate, days, reason, isHalfDay = false }) {
  const { data, error } = await supabase
    .from('leave_requests')
    .insert({
      employee_id: employeeId,
      leave_type:  leaveType,
      from_date:   fromDate,
      to_date:     toDate,
      days,
      reason,
      is_half_day: isHalfDay,
      status:      'pending',
    })
    .select('*')
    .single()
  if (error) throw error

  // Notify HR + Admin
  // RPC, not a direct table query — the employees_select_own RLS policy
  // would otherwise silently return zero rows for a regular employee's
  // session, so the notification would never be created (no error).
  try {
    const { data: hrAdmins } = await supabase
      .rpc('get_hr_admin_employee_ids', { exclude_id: employeeId })
    if (hrAdmins?.length) {
      await supabase.from('notifications').insert(
        hrAdmins.map(hr => ({
          employee_id: hr.id,
          type: 'leave_request',
          title: '🏖️ New Leave Request',
          message: 'An employee applied for ' + leaveType.replace(/_/g, ' ') + ' leave (' + days + ' day' + (days !== 1 ? 's' : '') + ') from ' + fromDate + ' to ' + toDate + '.',
          is_read: false,
        }))
      )
    }
  } catch (e) { console.warn('Leave apply notification failed:', e.message) }

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

  // Update leave balance if approved — handle paid/unpaid split
  if (status === 'approved') {
    const leave = data
    const year = new Date(leave.from_date).getFullYear()
    const { data: bal } = await supabase
      .from('leave_balances')
      .select('id, used_days, total_days, unpaid_days_taken')
      .eq('employee_id', leave.employee_id)
      .eq('leave_type', leave.leave_type)
      .eq('year', year)
      .maybeSingle()

    if (bal) {
      const available  = Math.max(0, Number(bal.total_days) - Number(bal.used_days || 0))
      const totalDays  = Number(leave.days)
      const paidDays   = Math.min(available, totalDays)
      const unpaidDays = Math.max(0, totalDays - paidDays)
      const newUsed    = Number(bal.used_days || 0) + paidDays
      const newUnpaid  = Number(bal.unpaid_days_taken || 0) + unpaidDays

      // Update balance
      const { error: balErr } = await supabase
        .from('leave_balances')
        .update({ used_days: newUsed, unpaid_days_taken: newUnpaid })
        .eq('id', bal.id)
      if (balErr) console.error('Balance update error:', balErr.message)

      // Record paid/unpaid split on the leave request
      await supabase
        .from('leave_requests')
        .update({ paid_days: paidDays, unpaid_days: unpaidDays })
        .eq('id', leaveId)
    }
  }

  // Notify employee of decision
  try {
    const isApproved = status === 'approved'
    await supabase.from('notifications').insert({
      employee_id: data.employee_id,
      type:    isApproved ? 'leave_approved' : 'leave_rejected',
      title:   isApproved ? '✅ Leave Approved' : '❌ Leave Rejected',
      message: `Your ${data.leave_type?.replace('_', ' ')} leave from ${data.from_date} to ${data.to_date} has been ${status}.`,
      is_read: false,
    })
  } catch (e) { console.warn('Leave notification failed:', e.message) }

  return data
}

// ─── CANCEL LEAVE ────────────────────────────────────────────────────────────

export async function cancelLeave(leaveId, employeeId) {
  const { data: leave, error: fetchErr } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('id', leaveId)
    .single()
  if (fetchErr) throw fetchErr

  // Restore balance if leave was approved
  if (leave.status === 'approved') {
    const year = new Date(leave.from_date).getFullYear()
    const { data: bal } = await supabase
      .from('leave_balances')
      .select('id, used_days')
      .eq('employee_id', leave.employee_id)
      .eq('leave_type', leave.leave_type)
      .eq('year', year)
      .maybeSingle()
    if (bal) {
      const restored = Math.max(0, (bal.used_days || 0) - Number(leave.days))
      await supabase.from('leave_balances').update({ used_days: restored }).eq('id', bal.id)
    }
  }

  const { error } = await supabase.from('leave_requests').delete().eq('id', leaveId)
  if (error) throw error

  // Notify HR
  try {
    const { data: hrAdmins } = await supabase
      .from('employees').select('id').in('role_type', ['hr','admin']).eq('status','active').neq('id', employeeId)
    if (hrAdmins?.length) {
      await supabase.from('notifications').insert(
        hrAdmins.map(hr => ({
          employee_id: hr.id,
          type: 'leave_request',
          title: '🚫 Leave Cancelled',
          message: `An employee cancelled their ${leave.leave_type?.replace(/_/g,' ')} leave (${leave.from_date} to ${leave.to_date}).`,
          is_read: false,
        }))
      )
    }
  } catch (e) { console.warn('Cancel notification failed:', e.message) }
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

  // Notify employee that HR recorded a leave
  try {
    await supabase.from('notifications').insert({
      employee_id: employeeId,
      type:    'leave_approved',
      title:   '✅ Leave Recorded by HR',
      message: `HR has recorded your ${leaveType.replace(/_/g, ' ')} leave from ${fromDate} to ${toDate} (${days} day${days > 1 ? 's' : ''}).`,
      is_read: false,
    })
  } catch (e) { console.warn('HR record leave notification failed:', e.message) }

  return leave
}
