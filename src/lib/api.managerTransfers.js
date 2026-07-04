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

  // Guard against naming a deactivated/offboarded employee as the target
  // manager. deactivateEmployee() only flips status — it never reassigns or
  // clears manager_id on that person's former reports — so a stale manager_id
  // reference (and the eligible-managers dropdown derived from it) could
  // otherwise surface someone who no longer works here.
  const { data: targetManager, error: targetError } = await supabase
    .from('employees')
    .select('id, status')
    .eq('id', toManagerId)
    .single()
  if (targetError) throw targetError
  if (targetManager.status !== 'active') {
    throw new Error('Target manager is not an active employee.')
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
    .select('id, status')
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

// ─── LIST REQUESTS AWAITING MY DECISION (target manager) ─────────────────────
export async function getIncomingTransferRequests(managerId) {
  const { data, error } = await supabase
    .from('manager_transfer_requests')
    .select('*, employee:employee_id(full_name, avatar_initials), from_manager:from_manager_id(full_name, avatar_initials)')
    .eq('to_manager_id', managerId)
    .eq('status', 'pending_target')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ─── TARGET MANAGER DECISION ──────────────────────────────────────────────────
export async function targetDecideTransfer(requestId, decision, targetManagerId) {
  if (!['accepted', 'rejected'].includes(decision)) {
    throw new Error('Invalid decision — must be "accepted" or "rejected".')
  }

  const { data: request, error } = await supabase
    .from('manager_transfer_requests')
    .select('*, employee:employee_id(full_name)')
    .eq('id', requestId)
    .eq('to_manager_id', targetManagerId)
    .single()
  if (error) throw error
  if (request.status !== 'pending_target') {
    throw new Error('This request is no longer awaiting your decision.')
  }

  const newStatus = decision === 'accepted' ? 'pending_hr' : 'rejected_by_target'
  const { error: updateError } = await supabase
    .from('manager_transfer_requests')
    .update({ status: newStatus, target_decided_at: new Date().toISOString() })
    .eq('id', requestId)
  if (updateError) throw updateError

  // Notification delivery is best-effort — the decision itself is already
  // committed above, so a notification hiccup must not surface as a
  // failure to the manager who successfully recorded their decision.
  try {
    if (decision === 'accepted') {
      // Broadcast to every active HR/Admin, not just one — mirrors
      // attendance regularization's pending_admin notification. RPC, not a
      // direct table query, because employees_select_own would otherwise
      // silently return zero HR/Admin rows to this (non-HR) caller.
      const { data: hrList } = await supabase.rpc('get_hr_admin_employee_ids')
      if (hrList?.length) {
        await supabase.from('notifications').insert(
          hrList.map(hr => ({
            employee_id: hr.id,
            type: 'manager_transfer_pending_hr',
            title: 'Transfer Request — Awaiting Approval',
            message: `${request.employee.full_name}'s transfer has been accepted by the new manager and needs your approval.`,
            metadata: { request_id: requestId },
            is_read: false,
          }))
        )
      }
    } else {
      await createNotification({
        employeeId: request.from_manager_id,
        type: 'manager_transfer_decided',
        title: 'Transfer Request Rejected',
        message: `The target manager declined your transfer request for ${request.employee.full_name}.`,
        metadata: { request_id: requestId },
      })
    }
  } catch (e) { console.warn('Transfer decision notification failed:', e.message) }

  return { ...request, status: newStatus }
}

// ─── HR/ADMIN QUEUE ────────────────────────────────────────────────────────────
export async function getPendingHRTransferRequests() {
  const { data, error } = await supabase
    .from('manager_transfer_requests')
    .select('*, employee:employee_id(full_name, avatar_initials), from_manager:from_manager_id(full_name), to_manager:to_manager_id(full_name)')
    .eq('status', 'pending_hr')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ─── HR/ADMIN FINAL DECISION ───────────────────────────────────────────────────
export async function hrDecideTransfer(requestId, decision, hrAdminId) {
  if (!['approved', 'rejected'].includes(decision)) {
    throw new Error('Invalid decision — must be "approved" or "rejected".')
  }

  const { data: request, error } = await supabase
    .from('manager_transfer_requests')
    .select('*, employee:employee_id(full_name)')
    .eq('id', requestId)
    .single()
  if (error) throw error
  if (request.status !== 'pending_hr') {
    throw new Error('This request is not awaiting HR approval.')
  }

  // Apply the actual manager change BEFORE marking the request approved —
  // if this write fails, the request stays pending_hr (retriable) instead
  // of being marked approved without the change having actually happened.
  if (decision === 'approved') {
    const { error: managerError } = await supabase
      .from('employees')
      .update({ manager_id: request.to_manager_id })
      .eq('id', request.employee_id)
    if (managerError) throw managerError
  }

  const newStatus = decision === 'approved' ? 'approved' : 'rejected_by_hr'
  const { error: updateError } = await supabase
    .from('manager_transfer_requests')
    .update({ status: newStatus, hr_decided_by: hrAdminId, hr_decided_at: new Date().toISOString() })
    .eq('id', requestId)
  if (updateError) throw updateError

  // Notification delivery is best-effort — the decision itself is already
  // committed above, so a notification hiccup must not surface as a
  // failure to the HR/Admin who successfully recorded it.
  try {
    if (decision === 'approved') {
      await createNotification({
        employeeId: request.employee_id,
        type: 'manager_transfer_decided',
        title: 'Your Reporting Manager Has Changed',
        message: 'Your reporting manager has been updated following an approved transfer.',
        metadata: { request_id: requestId },
      })
    } else {
      await createNotification({
        employeeId: request.from_manager_id,
        type: 'manager_transfer_decided',
        title: 'Transfer Request Rejected',
        message: `HR rejected your transfer request for ${request.employee.full_name}.`,
        metadata: { request_id: requestId },
      })
    }
  } catch (e) { console.warn('Transfer HR decision notification failed:', e.message) }

  return { ...request, status: newStatus }
}
