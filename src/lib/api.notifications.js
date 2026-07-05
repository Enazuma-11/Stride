import { supabase } from './supabase'

// ─── GET NOTIFICATIONS FOR CURRENT EMPLOYEE ───────────────────────────────────
export async function getMyNotifications(employeeId, limit = 20) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

// ─── GET UNREAD COUNT ─────────────────────────────────────────────────────────
export async function getUnreadCount(employeeId) {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('employee_id', employeeId)
    .eq('is_read', false)
  if (error) throw error
  return count || 0
}

// ─── MARK AS READ ─────────────────────────────────────────────────────────────
export async function markAsRead(notificationId) {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', notificationId)
  if (error) throw error
}

export async function markAllAsRead(employeeId) {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('employee_id', employeeId)
    .eq('is_read', false)
  if (error) throw error
}

// ─── CREATE NOTIFICATION (used server-side / by HR actions) ──────────────────
export async function createNotification({ employeeId, type, title, message, metadata = {} }) {
  // No .select() — the caller here is often a regular employee notifying
  // someone else (e.g. HR/Admin). The INSERT's own RLS policy allows that,
  // but .select() would additionally require SELECT-visibility on the row
  // just written, which the notifications_own policy only grants for your
  // own notifications. Under RLS, INSERT ... RETURNING fails outright if
  // the inserted row isn't visible per the SELECT policy — even though the
  // insert itself was allowed — so requesting the row back here would
  // block the exact case this function exists for. No caller uses the
  // returned row (all are fire-and-forget), so this is a pure fix.
  const { error } = await supabase
    .from('notifications')
    .insert({
      employee_id: employeeId,
      type,
      title,
      message,
      metadata,
      is_read: false,
    })
  if (error) throw error
}

// ─── CREATE NOTIFICATION FOR ALL ACTIVE EMPLOYEES ────────────────────────────
export async function broadcastNotification({ type, title, message, metadata = {}, excludeEmployeeId = null }) {
  // Get all active employees
  let query = supabase.from('employees').select('id').eq('status', 'active')
  if (excludeEmployeeId) query = query.neq('id', excludeEmployeeId)
  const { data: employees, error: empError } = await query
  if (empError) throw empError

  const rows = employees.map(e => ({
    employee_id: e.id,
    type,
    title,
    message,
    metadata,
    is_read: false,
  }))

  const { error } = await supabase.from('notifications').insert(rows)
  if (error) throw error
}

// ─── SUBSCRIBE TO REAL-TIME NOTIFICATIONS ────────────────────────────────────
export function subscribeToNotifications(employeeId, onNew) {
  const channel = supabase
    .channel(`notifications:${employeeId}`)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'notifications',
        filter: `employee_id=eq.${employeeId}`,
      },
      payload => onNew(payload.new)
    )
    .subscribe()

  return () => supabase.removeChannel(channel)
}

// ─── TRIGGER LEAVE NOTIFICATION (called after HR approves/rejects) ────────────
export async function notifyLeaveDecision(leave, employeeId, status) {
  const isApproved = status === 'approved'
  await createNotification({
    employeeId,
    type:    isApproved ? 'leave_approved' : 'leave_rejected',
    title:   isApproved ? 'Leave Approved ✅' : 'Leave Rejected ❌',
    message: isApproved
      ? `Your ${leave.leave_type.replace('_', '/')} leave from ${leave.from_date} to ${leave.to_date} has been approved.`
      : `Your ${leave.leave_type.replace('_', '/')} leave from ${leave.from_date} to ${leave.to_date} was not approved.`,
    metadata: { leave_id: leave.id, from_date: leave.from_date, to_date: leave.to_date },
  })
}

// ─── TRIGGER ANNOUNCEMENT NOTIFICATION ───────────────────────────────────────
export async function notifyAnnouncement(announcement, createdById) {
  await broadcastNotification({
    type:    'announcement',
    title:   '📣 New Announcement',
    message: announcement.title,
    metadata: { announcement_id: announcement.id },
    excludeEmployeeId: createdById,
  })
}

// ─── TRIGGER ONBOARDING WELCOME ───────────────────────────────────────────────
export async function notifyWelcome(employeeId, fullName) {
  await createNotification({
    employeeId,
    type:    'onboarding',
    title:   `Welcome to Stride, ${fullName.split(' ')[0]}! 👋`,
    message: 'Your account is ready. Complete your profile to get started.',
    metadata: {},
  })
}
