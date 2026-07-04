import { supabase } from './supabase'
import { createNotification } from './api.notifications'

// ─── INITIATE A TRANSFER REQUEST (manager) ───────────────────────────────────
export async function requestTransfer({ employeeId, fromManagerId, toManagerId, reason }) {
  if (!employeeId || !fromManagerId || !toManagerId) {
    throw new Error('Employee, current manager, and target manager are all required.')
  }
  if (fromManagerId === toManagerId) {
    throw new Error('Target manager must be different from the current manager.')
  }

  const { data: employee, error: empError } = await supabase
    .from('employees')
    .select('id, full_name, manager_id')
    .eq('id', employeeId)
    .single()
  if (empError) throw empError
  if (employee.manager_id !== fromManagerId) {
    throw new Error('This employee is no longer your direct report.')
  }

  const { data: existing, error: existingError } = await supabase
    .from('manager_transfer_requests')
    .select('id')
    .eq('employee_id', employeeId)
    .in('status', ['pending_target', 'pending_hr'])
  if (existingError) throw existingError
  if (existing && existing.length > 0) {
    throw new Error('This employee already has a pending transfer request.')
  }

  const { data: request, error: insertError } = await supabase
    .from('manager_transfer_requests')
    .insert({
      employee_id: employeeId,
      from_manager_id: fromManagerId,
      to_manager_id: toManagerId,
      reason: reason?.trim() || null,
    })
    .select()
    .single()
  if (insertError) throw insertError

  // Notification delivery is best-effort — the request itself is already
  // committed above, so a notification hiccup must not surface as a
  // failure to the manager who successfully submitted it.
  try {
    await createNotification({
      employeeId: toManagerId,
      type: 'manager_transfer_requested',
      title: 'Team Transfer Request',
      message: `${employee.full_name} — you've been asked to take over as their manager.`,
      metadata: { request_id: request.id },
    })
  } catch (e) { console.warn('Transfer request notification failed:', e.message) }

  return request
}

// ─── LIST REQUESTS I'VE SENT (manager) ───────────────────────────────────────
export async function getSentTransferRequests(managerId) {
  const { data, error } = await supabase
    .from('manager_transfer_requests')
    .select('*, employee:employee_id(full_name, avatar_initials), to_manager:to_manager_id(full_name, avatar_initials)')
    .eq('from_manager_id', managerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ─── WITHDRAW A REQUEST (manager, only while non-terminal) ───────────────────
export async function withdrawTransferRequest(requestId, managerId) {
  const { data: request, error } = await supabase
    .from('manager_transfer_requests')
    .select('*')
    .eq('id', requestId)
    .eq('from_manager_id', managerId)
    .single()
  if (error) throw error
  if (!['pending_target', 'pending_hr'].includes(request.status)) {
    throw new Error('This request has already been decided and can no longer be withdrawn.')
  }

  const { error: updateError } = await supabase
    .from('manager_transfer_requests')
    .update({ status: 'withdrawn' })
    .eq('id', requestId)
  if (updateError) throw updateError
}
