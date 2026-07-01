import { supabase } from './supabase'
import { createNotification } from './api.notifications'

function timeToISO(dateStr, timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCHours(h, m, 0, 0)
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

  const { data: request, error: reqError } = await supabase
    .from('attendance_regularization_requests')
    .insert({ employee_id: employeeId, status: 'pending_manager' })
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
    })))
  if (itemsError) throw itemsError

  const { data: employee } = await supabase
    .from('employees')
    .select('full_name, manager_id')
    .eq('id', employeeId)
    .single()

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
      type: 'attendance_regularization_submitted',
      title: 'Attendance Regularization Request',
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
