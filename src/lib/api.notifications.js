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
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      employee_id: employeeId,
      type,
      title,
      message,
      metadata,
      is_read: false,
    })
    .select()
    .single()
  if (error) throw error
  return data
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

// ─── DAILY CHECKS (run on page load for HR/Admin) ─────────────────────────────
// Checks birthdays and upcoming holidays and creates notifications if needed
export async function runDailyChecks(reviewerEmployeeId) {
  const today     = new Date()
  const todayStr  = today.toISOString().split('T')[0]
  const tomorrow  = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]
  const in3Days   = new Date(today); in3Days.setDate(today.getDate() + 3)
  const in3Str    = in3Days.toISOString().split('T')[0]

  // ── Birthdays ──────────────────────────────────────────────
  const { data: employees } = await supabase
    .from('employees')
    .select('id, full_name, date_of_birth')
    .eq('status', 'active')
    .not('date_of_birth', 'is', null)

  for (const emp of employees || []) {
    if (!emp.date_of_birth) continue
    const dob = new Date(emp.date_of_birth)
    const thisYearBday = `${today.getFullYear()}-${String(dob.getMonth()+1).padStart(2,'0')}-${String(dob.getDate()).padStart(2,'0')}`

    // Check if already notified today (avoid duplicates)
    const { count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('employee_id', emp.id)
      .eq('type', 'birthday_today')
      .gte('created_at', todayStr)

    if (thisYearBday === todayStr && count === 0) {
      // Notify the birthday person
      await createNotification({
        employeeId: emp.id,
        type: 'birthday_today',
        title: `🎂 Happy Birthday, ${emp.full_name.split(' ')[0]}!`,
        message: 'Wishing you a wonderful birthday from the entire SporTech team! 🎉',
        metadata: {},
      })
      // Notify HR
      await createNotification({
        employeeId: reviewerEmployeeId,
        type: 'birthday_today',
        title: `🎂 Today is ${emp.full_name}'s Birthday!`,
        message: `Don't forget to wish ${emp.full_name.split(' ')[0]} a happy birthday today.`,
        metadata: { employee_id: emp.id },
      })
    }

    // Tomorrow's birthday — notify HR
    if (thisYearBday === tomorrowStr) {
      const { count: tomorrowCount } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('employee_id', reviewerEmployeeId)
        .eq('type', 'birthday_tomorrow')
        .gte('created_at', todayStr)

      if (tomorrowCount === 0) {
        await createNotification({
          employeeId: reviewerEmployeeId,
          type: 'birthday_tomorrow',
          title: `🎁 ${emp.full_name}'s Birthday is Tomorrow`,
          message: `${emp.full_name.split(' ')[0]}'s birthday is tomorrow. Consider sending a message!`,
          metadata: { employee_id: emp.id },
        })
      }
    }
  }

  // ── Upcoming Holidays ──────────────────────────────────────
  const { data: holidays } = await supabase
    .from('holidays')
    .select('*')
    .eq('date', in3Str)

  for (const holiday of holidays || []) {
    const { count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'holiday_upcoming')
      .like('metadata->holiday_id', `"${holiday.id}"`)
      .gte('created_at', todayStr)

    if (count === 0) {
      await broadcastNotification({
        type:    'holiday_upcoming',
        title:   `🎉 ${holiday.name} in 3 days`,
        message: `${holiday.name} is on ${new Date(holiday.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}. ${holiday.type === 'mandatory' ? 'Mandatory holiday.' : 'Optional holiday.'}`,
        metadata: { holiday_id: holiday.id, date: holiday.date },
      })
    }
  }
}
