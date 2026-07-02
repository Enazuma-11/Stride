import { supabase } from './supabase'
import { getOptinWindow } from './api.holidayOptins'

// Fires from the 25th through the last day of the month (inclusive).
export function shouldSendMonthlyRegularizationReminder(now = new Date()) {
  const day = now.getUTCDate()
  const lastDayOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  return day >= 25 && day <= lastDayOfMonth
}

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

// Returns an array of UTC-based YYYY-MM-DD working-day (Mon-Fri) strings from
// `startStr` through `endStr` inclusive, excluding any date present in `holidayDates`.
function workingDaysInRange(startStr, endStr, holidayDates) {
  const days = []
  let cursor = new Date(`${startStr}T00:00:00.000Z`)
  const end = new Date(`${endStr}T00:00:00.000Z`)
  while (cursor <= end) {
    const dow = cursor.getUTCDay() // 0=Sun ... 6=Sat
    const dateStr = cursor.toISOString().split('T')[0]
    if (dow !== 0 && dow !== 6 && !holidayDates.has(dateStr)) {
      days.push(dateStr)
    }
    cursor = new Date(cursor.getTime() + 86400000)
  }
  return days
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

  // ── Monthly regularization reminder (25th → month-end) ────────────────────
  if (shouldSendMonthlyRegularizationReminder(today)) {
    const monthStart = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`

    const { data: unresolvedDays } = await supabase
      .from('attendance')
      .select('employee_id, date, status')
      .in('status', ['half_day', 'absent'])
      .gte('date', monthStart)
      .lte('date', todayStr)

    const { data: alreadyRequestedItems } = await supabase
      .from('attendance_regularization_items')
      .select('date, request:request_id(employee_id)')
      .gte('date', monthStart)

    const requestedSet = new Set(
      (alreadyRequestedItems || []).map(i => `${i.request?.employee_id}:${i.date}`)
    )

    const byEmployee = {}
    for (const row of unresolvedDays || []) {
      if (requestedSet.has(`${row.employee_id}:${row.date}`)) continue
      byEmployee[row.employee_id] = (byEmployee[row.employee_id] || 0) + 1
    }

    // ── True absences: working days with NO attendance row at all ───────────
    const { data: monthHolidays } = await supabase
      .from('holidays')
      .select('id, date, type')
      .gte('date', monthStart)
      .lte('date', todayStr)
    // Only public/company holidays exclude the date for EVERYONE. Optional
    // holidays only exclude the date for employees who actually opted in
    // (see holiday_optins lookup below) — everyone else still owes attendance.
    const mandatoryHolidayDates = new Set(
      (monthHolidays || []).filter(h => h.type !== 'optional').map(h => h.date)
    )
    const optionalHolidays = (monthHolidays || []).filter(h => h.type === 'optional')
    const optionalHolidayIds = optionalHolidays.map(h => h.id)

    const { data: optins } = optionalHolidayIds.length
      ? await supabase
          .from('holiday_optins')
          .select('employee_id, holiday_id')
          .in('holiday_id', optionalHolidayIds)
      : { data: [] }
    const optinDatesByEmployee = {}
    for (const optin of optins || []) {
      const holiday = optionalHolidays.find(h => h.id === optin.holiday_id)
      if (!holiday) continue
      if (!optinDatesByEmployee[optin.employee_id]) optinDatesByEmployee[optin.employee_id] = new Set()
      optinDatesByEmployee[optin.employee_id].add(holiday.date)
    }

    const { data: activeEmployees } = await supabase
      .from('employees')
      .select('id')
      .eq('status', 'active')

    const { data: approvedLeaves } = await supabase
      .from('leave_requests')
      .select('employee_id, from_date, to_date')
      .eq('status', 'approved')
      .lte('from_date', todayStr)
      .gte('to_date', monthStart)

    const { data: attendanceRows } = await supabase
      .from('attendance')
      .select('employee_id, date')
      .gte('date', monthStart)
      .lte('date', todayStr)

    const hasAttendanceRow = new Set(
      (attendanceRows || []).map(r => `${r.employee_id}:${r.date}`)
    )

    const workingDays = workingDaysInRange(monthStart, todayStr, mandatoryHolidayDates)

    for (const emp of activeEmployees || []) {
      const employeeLeaves = (approvedLeaves || []).filter(l => l.employee_id === emp.id)
      const employeeOptinDates = optinDatesByEmployee[emp.id] || new Set()
      for (const day of workingDays) {
        if (employeeOptinDates.has(day)) continue // this employee opted into this optional holiday
        if (hasAttendanceRow.has(`${emp.id}:${day}`)) continue // already counted above, or a fully-worked day
        if (requestedSet.has(`${emp.id}:${day}`)) continue
        const onLeave = employeeLeaves.some(l => l.from_date <= day && day <= l.to_date)
        if (onLeave) continue
        byEmployee[emp.id] = (byEmployee[emp.id] || 0) + 1
      }
    }

    for (const [employeeId, count] of Object.entries(byEmployee)) {
      const { count: alreadyNotifiedToday } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('employee_id', employeeId)
        .eq('type', 'attendance_regularization_reminder')
        .gte('created_at', todayStr)

      if (alreadyNotifiedToday === 0) {
        await createNotification({
          employeeId,
          type: 'attendance_regularization_reminder',
          title: 'Attendance Regularization Reminder',
          message: `You have ${count} day(s) this month that may need regularization — submit before month-end.`,
          metadata: { count },
        })
      }
    }
  }

  // ── Weekly attendance report ready (every Monday) ──────────────────────────
  if (today.getUTCDay() === 1) { // 0=Sun, 1=Mon (UTC, matching this feature's date convention)
    const { count: alreadyNotifiedThisWeek } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('employee_id', reviewerEmployeeId)
      .eq('type', 'attendance_weekly_report_ready')
      .gte('created_at', todayStr)

    if (alreadyNotifiedThisWeek === 0) {
      await createNotification({
        employeeId: reviewerEmployeeId,
        type: 'attendance_weekly_report_ready',
        title: 'Weekly Attendance Report Ready',
        message: 'The attendance Weekly view has been updated for last week.',
        metadata: {},
      })
    }
  }

  // ── Holiday opt-in window notifications ────────────────────────────────────
  const optinWindow = getOptinWindow(today)
  if (optinWindow.isOpen) {
    const { data: activeEmployeesForOptin } = await supabase
      .from('employees')
      .select('id')
      .eq('status', 'active')

    // Window just opened today — notify everyone once.
    const windowOpensToday =
      optinWindow.closesOn.endsWith('-01-14') ? todayStr === `${optinWindow.label.split('-')[0]}-01-01`
      : todayStr === `${optinWindow.label.split('-')[0]}-07-01`

    if (windowOpensToday && (activeEmployeesForOptin || []).length > 0) {
      // This is an all-or-nothing broadcast (everyone gets notified or no one
      // does), so a single existence check is enough — no per-employee dedup
      // needed. Without this, two HR/Admin sessions loading TopBar on the same
      // day (e.g. two staff, or one staff with two tabs) would each pass the
      // sessionStorage gate independently and double-broadcast to everyone.
      const { count: alreadyBroadcastToday } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('type', 'holiday_optin_window_open')
        .gte('created_at', todayStr)

      if (alreadyBroadcastToday === 0) {
        await supabase.from('notifications').insert(
          (activeEmployeesForOptin || []).map(emp => ({
            employee_id: emp.id,
            type: 'holiday_optin_window_open',
            title: 'Holiday Opt-In Window Open',
            message: `You can now pick your optional holidays. Submit by ${optinWindow.closesOn}.`,
            metadata: { window: optinWindow.label },
            is_read: false,
          }))
        )
      }
    }

    // Closing-soon reminder: last 4 days of the window, only to employees
    // who have not yet confirmed their picks (even confirming zero counts
    // as responded — don't nag people who already answered).
    const closesOnDate = new Date(`${optinWindow.closesOn}T00:00:00.000Z`)
    const daysUntilClose = Math.round((closesOnDate - today) / 86400000)
    if (daysUntilClose >= 0 && daysUntilClose <= 3) {
      const { data: submitted } = await supabase
        .from('holiday_optin_submissions')
        .select('employee_id')
        .eq('window_label', optinWindow.label)
      const submittedIds = new Set((submitted || []).map(s => s.employee_id))
      const notYetResponded = (activeEmployeesForOptin || []).filter(emp => !submittedIds.has(emp.id))

      const remindersToSend = []
      for (const emp of notYetResponded) {
        const { count: alreadyRemindedToday } = await supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('employee_id', emp.id)
          .eq('type', 'holiday_optin_reminder')
          .gte('created_at', todayStr)
        if (alreadyRemindedToday === 0) {
          remindersToSend.push({
            employee_id: emp.id,
            type: 'holiday_optin_reminder',
            title: 'Holiday Picks Closing Soon',
            message: `The holiday opt-in window closes ${optinWindow.closesOn} — submit your picks before then.`,
            metadata: { window: optinWindow.label },
            is_read: false,
          })
        }
      }
      if (remindersToSend.length > 0) {
        await supabase.from('notifications').insert(remindersToSend)
      }
    }
  }
}
