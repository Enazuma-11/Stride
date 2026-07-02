import { supabase } from './supabase'
import { createNotification } from './api.notifications'
import { hrSetSessions } from './api.attendance'

function timeToISO(dateStr, timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  // `<input type="time">` gives a local wall-clock HH:MM with no timezone info.
  // Anchor to local midnight (not UTC) so the browser's own timezone offset
  // is applied once, correctly, when toISOString() converts to UTC for storage.
  const d = new Date(`${dateStr}T00:00:00`)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

// ─── SUBMIT A REGULARIZATION REQUEST (employee) ──────────────────────────────
export async function submitRegularizationRequest(employeeId, items) {
  if (!items || items.length === 0) throw new Error('Please add at least one date to regularize.')
  for (const item of items) {
    if (!item.date) throw new Error('Each entry needs a date.')
    if (!item.proposedCheckIn || !item.proposedCheckOut) throw new Error('Each entry needs a proposed check-in and check-out time.')
    if (!item.reason || !item.reason.trim()) throw new Error('Each entry needs a reason.')
  }

  const { data: employee, error: empError } = await supabase
    .from('employees')
    .select('full_name, manager_id')
    .eq('id', employeeId)
    .single()
  if (empError) throw empError

  const { data: employeeLeaves } = await supabase
    .from('leave_requests')
    .select('from_date, to_date, status')
    .eq('employee_id', employeeId)
  const approvedLeaves = (employeeLeaves || []).filter(l => l.status === 'approved')

  const leaveItem = items.find(item =>
    approvedLeaves.some(l => item.date >= l.from_date && item.date <= l.to_date)
  )
  if (leaveItem) {
    throw new Error(`You are on approved leave on ${leaveItem.date} — attendance cannot be regularized for a leave day.`)
  }

  // If the employee has no manager, the request skips the manager stage
  // entirely and goes straight into the Admin/HR queue.
  const hasManager = !!employee?.manager_id
  const initialManagerDecision = hasManager ? 'pending' : 'approved'

  const { data: request, error: reqError } = await supabase
    .from('attendance_regularization_requests')
    .insert({ employee_id: employeeId, status: hasManager ? 'pending_manager' : 'pending_admin' })
    .select()
    .single()
  if (reqError) throw reqError

  const { error: itemsError } = await supabase
    .from('attendance_regularization_items')
    .insert(items.map(item => ({
      request_id:         request.id,
      date:               item.date,
      proposed_check_in:  timeToISO(item.date, item.proposedCheckIn),
      proposed_check_out: timeToISO(item.date, item.proposedCheckOut),
      reason:             item.reason.trim(),
      manager_decision:   initialManagerDecision,
    })))
  if (itemsError) throw itemsError

  let recipientId = employee?.manager_id
  if (!recipientId) {
    // Exclude the submitting employee themselves — an HR/Admin with no
    // manager_id must not end up as their own request's reviewer.
    const { data: hrList } = await supabase
      .from('employees')
      .select('id')
      .in('role_type', ['hr', 'admin'])
      .eq('status', 'active')
      .neq('id', employeeId)
      .limit(1)
    recipientId = hrList?.[0]?.id
  }

  if (recipientId) {
    await createNotification({
      employeeId: recipientId,
      type: hasManager ? 'attendance_regularization_submitted' : 'attendance_regularization_pending_admin',
      title: hasManager ? 'Attendance Regularization Request' : 'Regularization Request — Awaiting Admin',
      message: `${employee?.full_name || 'An employee'} submitted a regularization request for ${items.length} date(s).`,
      metadata: { request_id: request.id },
    })
  }

  return request
}

// ─── GET MY REGULARIZATION REQUESTS (employee) ───────────────────────────────
export async function getMyRegularizationRequests(employeeId) {
  const { data: requests, error } = await supabase
    .from('attendance_regularization_requests')
    .select('*, items:attendance_regularization_items(*)')
    .eq('employee_id', employeeId)
    .order('submitted_at', { ascending: false })
  if (error) throw error
  return requests || []
}

// ─── WITHDRAW A REGULARIZATION REQUEST (employee, only while pending_manager) ─
export async function withdrawRegularizationRequest(requestId, employeeId) {
  const { data: request, error } = await supabase
    .from('attendance_regularization_requests')
    .select('*')
    .eq('id', requestId)
    .eq('employee_id', employeeId)
    .single()
  if (error) throw error
  if (request.status !== 'pending_manager') {
    throw new Error('This request has already been reviewed and can no longer be withdrawn.')
  }
  await supabase.from('attendance_regularization_requests').delete().eq('id', requestId)
}

// ─── MANAGER QUEUE ────────────────────────────────────────────────────────────

export async function getManagerPendingItems(managerId) {
  const { data: reports } = await supabase
    .from('employees')
    .select('id')
    .eq('manager_id', managerId)
  const reportIds = (reports || []).map(r => r.id)
  if (reportIds.length === 0) return []

  const { data: items, error } = await supabase
    .from('attendance_regularization_items')
    .select('*, request:request_id(id, employee_id, employee:employee_id(full_name, avatar_initials))')
    .eq('manager_decision', 'pending')
    .order('date', { ascending: false })
  if (error) throw error

  return (items || []).filter(item => reportIds.includes(item.request?.employee_id))
}

async function recalcRequestStatus(requestId) {
  const { data: items } = await supabase
    .from('attendance_regularization_items')
    .select('manager_decision, admin_decision')
    .eq('request_id', requestId)

  const rows = items || []
  let status = 'completed'
  if (rows.some(i => i.manager_decision === 'pending')) status = 'pending_manager'
  else if (rows.some(i => i.manager_decision === 'approved' && !i.admin_decision)) status = 'pending_admin'

  await supabase.from('attendance_regularization_requests').update({ status }).eq('id', requestId)
}

export async function managerDecideItem(itemId, decision, managerId) {
  if (!['approved', 'rejected'].includes(decision)) {
    throw new Error('Invalid decision — must be "approved" or "rejected".')
  }

  const { data: item, error } = await supabase
    .from('attendance_regularization_items')
    .update({ manager_decision: decision, decided_at: new Date().toISOString() })
    .eq('id', itemId)
    .select('*, request:request_id(id, employee_id)')
    .single()
  if (error) throw error

  await recalcRequestStatus(item.request.id)

  if (decision === 'rejected') {
    await createNotification({
      employeeId: item.request.employee_id,
      type: 'attendance_regularization_decided',
      title: 'Regularization Request Rejected',
      message: `Your manager rejected your regularization request for ${item.date}.`,
      metadata: { item_id: itemId },
    })
  } else {
    const { data: hrList } = await supabase
      .from('employees')
      .select('id')
      .in('role_type', ['hr', 'admin'])
      .eq('status', 'active')
      .limit(1)
    if (hrList?.[0]?.id) {
      await createNotification({
        employeeId: hrList[0].id,
        type: 'attendance_regularization_pending_admin',
        title: 'Regularization Approved — Awaiting Admin',
        message: `A manager-approved regularization for ${item.date} is awaiting your final action.`,
        metadata: { item_id: itemId },
      })
    }
  }

  return item
}

// ─── ADMIN/HR QUEUE ───────────────────────────────────────────────────────────

export async function getAdminPendingItems(excludeEmployeeId) {
  const { data: items, error } = await supabase
    .from('attendance_regularization_items')
    .select('*, request:request_id(id, employee_id, employee:employee_id(full_name, avatar_initials))')
    .eq('manager_decision', 'approved')
    .is('admin_decision', null)
    .order('date', { ascending: false })
  if (error) throw error
  // Never let a reviewer see/apply their own regularization request in the admin queue.
  return (items || []).filter(item => item.request?.employee_id !== excludeEmployeeId)
}

export async function adminApplyItem(itemId, finalCheckIn, finalCheckOut, adminId) {
  if (!finalCheckIn || !finalCheckOut) {
    throw new Error('Both check-in and check-out are required to apply this correction.')
  }

  const { data: item, error } = await supabase
    .from('attendance_regularization_items')
    .select('*, request:request_id(id, employee_id)')
    .eq('id', itemId)
    .single()
  if (error) throw error

  await hrSetSessions(
    item.request.employee_id,
    item.date,
    [{ checkIn: finalCheckIn, checkOut: finalCheckOut, isWFH: false }],
    adminId,
    `Applied from regularization request (item ${itemId})`
  )

  await supabase
    .from('attendance_regularization_items')
    .update({ admin_decision: 'approved', decided_at: new Date().toISOString() })
    .eq('id', itemId)

  await recalcRequestStatus(item.request.id)

  await createNotification({
    employeeId: item.request.employee_id,
    type: 'attendance_regularization_decided',
    title: 'Attendance Corrected',
    message: `Your attendance for ${item.date} has been corrected as requested.`,
    metadata: { item_id: itemId },
  })

  return item
}

export async function adminRejectItem(itemId, adminId) {
  const { data: item, error } = await supabase
    .from('attendance_regularization_items')
    .update({ admin_decision: 'rejected', decided_at: new Date().toISOString() })
    .eq('id', itemId)
    .select('*, request:request_id(id, employee_id)')
    .single()
  if (error) throw error

  await recalcRequestStatus(item.request.id)

  await createNotification({
    employeeId: item.request.employee_id,
    type: 'attendance_regularization_decided',
    title: 'Regularization Request Rejected',
    message: `Admin rejected your regularization request for ${item.date}.`,
    metadata: { item_id: itemId },
  })

  return item
}
