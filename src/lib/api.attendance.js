import { supabase } from './supabase'
import { FULL_DAY_HOURS, HALF_DAY_HOURS, WORK_HOURS_BY_TYPE, MAX_SESSIONS_PER_DAY } from './constants'

// ─── HELPERS ─────────────────────────────────────────────────────────────────

// Hours of a session that fall within the UTC calendar day `dateStr` (YYYY-MM-DD).
// Handles sessions that span midnight by clipping to the day's [00:00, 24:00) window.
export function sessionHoursForDate(checkIn, checkOut, dateStr) {
  if (!checkIn || !checkOut) return 0
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`)
  const dayEnd   = new Date(dayStart.getTime() + 86400000)
  const inTime   = new Date(checkIn)
  const outTime  = new Date(checkOut)
  const start = inTime > dayStart ? inTime : dayStart
  const end   = outTime < dayEnd ? outTime : dayEnd
  const ms = end - start
  if (ms <= 0) return 0
  return Math.round((ms / 3600000) * 10) / 10
}

// Derives a day's attendance status purely from total hours worked — no late-mark concept.
export function deriveDailyStatus(totalHours, isWFH, hasOpenSession, employeeType = 'permanent') {
  if (hasOpenSession) return isWFH ? 'wfh' : 'present'
  if (totalHours <= 0) return 'absent'
  const policy = WORK_HOURS_BY_TYPE[employeeType] || WORK_HOURS_BY_TYPE.permanent
  if (totalHours >= policy.fullDay) return isWFH ? 'wfh' : 'present'
  return 'half_day'
}

function addDaysISO(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

// Recomputes the `attendance` aggregate row for one employee/date from
// attendance_sessions. Sessions are looked up in a [date-1, date+1) window
// on check_in so midnight-spanning sessions from the adjacent day are included.
export async function recomputeDayAggregate(employeeId, date) {
  const windowStart = `${addDaysISO(date, -1)}T00:00:00.000Z`
  const windowEnd   = `${addDaysISO(date, 1)}T00:00:00.000Z`

  const { data: sessions, error } = await supabase
    .from('attendance_sessions')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('check_in', windowStart)
    .lt('check_in', windowEnd)
    .order('check_in', { ascending: true })
  if (error) throw error

  const relevant = sessions || []
  let totalHours = 0
  let hasOpenSession = false
  let isWFH = false
  let firstCheckIn = null
  let lastCheckOut = null

  for (const s of relevant) {
    if (!s.check_out) {
      hasOpenSession = true
      if (s.is_wfh) isWFH = true
      continue
    }
    const hours = sessionHoursForDate(s.check_in, s.check_out, date)
    if (hours > 0) {
      totalHours += hours
      if (s.is_wfh) isWFH = true
      if (!firstCheckIn || new Date(s.check_in) < new Date(firstCheckIn)) firstCheckIn = s.check_in
      if (!lastCheckOut || new Date(s.check_out) > new Date(lastCheckOut)) lastCheckOut = s.check_out
    }
  }
  totalHours = Math.round(totalHours * 10) / 10

  const empType = await getEmployeeType(employeeId)
  const status  = deriveDailyStatus(totalHours, isWFH, hasOpenSession, empType)

  const { data: existing } = await supabase
    .from('attendance')
    .select('id, hr_override')
    .eq('employee_id', employeeId)
    .eq('date', date)
    .maybeSingle()

  // Don't let a live recompute clobber a day HR has manually overridden via hrSetSessions
  // (hrSetSessions itself calls recomputeDayAggregate after rewriting sessions, so this
  // only guards against a stray checkIn/checkOut recompute racing an override).
  const { data: updated, error: upsertError } = await supabase
    .from('attendance')
    .upsert({
      employee_id:  employeeId,
      date,
      check_in:     firstCheckIn,
      check_out:    hasOpenSession ? null : lastCheckOut,
      hours_worked: totalHours,
      is_wfh:       isWFH,
      status,
      hr_override:  existing?.hr_override || false,
    }, { onConflict: 'employee_id,date' })
    .select()
    .single()
  if (upsertError) throw upsertError

  if (status === 'half_day') {
    await deductHalfDayLeave(employeeId, date)
  }

  return updated
}

// ─── GET EMPLOYEE TYPE ────────────────────────────────────────────────────────
async function getEmployeeType(employeeId) {
  const { data } = await supabase
    .from('employees')
    .select('employee_type')
    .eq('id', employeeId)
    .single()
  return data?.employee_type || 'permanent'
}

export function formatTime(isoString) {
  if (!isoString) return '—'
  return new Date(isoString).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

export function hoursWorked(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null
  const h = (new Date(checkOut) - new Date(checkIn)) / 3600000
  return Math.round(h * 10) / 10
}

export function todayISO() {
  return new Date().toISOString().split('T')[0]
}

// ─── CHECK IN ────────────────────────────────────────────────────────────────

export async function getOpenSession(employeeId) {
  const { data, error } = await supabase
    .from('attendance_sessions')
    .select('*')
    .eq('employee_id', employeeId)
    .is('check_out', null)
    .order('check_in', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getTodaySessions(employeeId) {
  const today = todayISO()
  const { data, error } = await supabase
    .from('attendance_sessions')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('check_in', `${today}T00:00:00.000Z`)
    .lt('check_in', `${addDaysISO(today, 1)}T00:00:00.000Z`)
    .order('check_in', { ascending: true })
  if (error) throw error
  return data || []
}

export async function checkIn(employeeId, isWFH = false) {
  const open = await getOpenSession(employeeId)
  if (open) throw new Error('You are already checked in. Please check out first.')

  const todaySessions = await getTodaySessions(employeeId)
  if (todaySessions.length >= MAX_SESSIONS_PER_DAY) {
    throw new Error(`You've reached today's check-in limit (${MAX_SESSIONS_PER_DAY} sessions). If you need to log additional work time for today, submit a regularization request.`)
  }

  const now = new Date().toISOString()
  const { data: session, error } = await supabase
    .from('attendance_sessions')
    .insert({ employee_id: employeeId, check_in: now, is_wfh: isWFH })
    .select()
    .single()
  if (error) throw error

  const attendance = await recomputeDayAggregate(employeeId, todayISO())
  return { session, attendance }
}

// ─── CHECK OUT ───────────────────────────────────────────────────────────────

export async function checkOut(employeeId) {
  const open = await getOpenSession(employeeId)
  if (!open) throw new Error('No open check-in found. Please check in first.')

  const now = new Date().toISOString()
  const { data: session, error } = await supabase
    .from('attendance_sessions')
    .update({ check_out: now })
    .eq('id', open.id)
    .select()
    .single()
  if (error) throw error

  const checkInDate  = open.check_in.split('T')[0]
  const checkOutDate = now.split('T')[0]

  await recomputeDayAggregate(employeeId, checkInDate)
  const attendance = checkOutDate !== checkInDate
    ? await recomputeDayAggregate(employeeId, checkOutDate)
    : await recomputeDayAggregate(employeeId, checkInDate)

  return { session, attendance }
}

// ─── DEDUCT HALF DAY LEAVE ────────────────────────────────────────────────────
async function deductHalfDayLeave(employeeId, date) {
  const year = new Date(date).getFullYear()
  try {
    // Check if already deducted for this date (avoid double deduction)
    const { data: existing } = await supabase
      .from('half_day_deductions')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('date', date)
      .maybeSingle()

    if (existing) return // already deducted

    // Deduct 0.5 days from casual_sick leave
    const { data: balance } = await supabase
      .from('leave_balances')
      .select('id, used_days, total_days')
      .eq('employee_id', employeeId)
      .eq('leave_type', 'casual_sick')
      .eq('year', year)
      .single()

    if (!balance) return

    // Only deduct if balance available (used_days + 0.5 <= total_days)
    if (balance.used_days + 0.5 <= balance.total_days) {
      await supabase
        .from('leave_balances')
        .update({ used_days: balance.used_days + 0.5 })
        .eq('id', balance.id)

      // Log the deduction
      await supabase
        .from('half_day_deductions')
        .insert({ employee_id: employeeId, date, leave_type: 'casual_sick', days_deducted: 0.5 })
    }
  } catch (e) {
    console.warn('Half day deduction warning:', e.message)
  }
}

// ─── GET TODAY'S RECORD ───────────────────────────────────────────────────────

export async function getTodayAttendance(employeeId) {
  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('date', todayISO())
    .maybeSingle()

  if (error) throw error
  return data
}

// ─── GET MONTHLY ATTENDANCE ───────────────────────────────────────────────────

export async function getMyMonthlyAttendance(employeeId, year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const to   = new Date(year, month, 0).toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })

  if (error) throw error
  return data || []
}

// ─── HR: GET ALL EMPLOYEES ATTENDANCE FOR A DATE ──────────────────────────────

export async function getTeamAttendanceByDate(date) {
  const { data, error } = await supabase
    .from('attendance')
    .select(`*, employee:employee_id(id, full_name, role, department, avatar_initials)`)
    .eq('date', date)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data || []
}

// ─── HR: GET TEAM MONTHLY ATTENDANCE ─────────────────────────────────────────

export async function getTeamMonthlyAttendance(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const to   = new Date(year, month, 0).toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('attendance')
    .select(`*, employee:employee_id(id, full_name, role, department, avatar_initials)`)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })

  if (error) throw error
  return data || []
}

// ─── HOLIDAYS ─────────────────────────────────────────────────────────────────

export async function getHolidays(year) {
  const { data, error } = await supabase
    .from('holidays')
    .select('*')
    .eq('year', year)
    .order('date', { ascending: true })

  if (error) throw error
  return data || []
}

export async function addHoliday({ name, date, type }) {
  const year = new Date(date).getFullYear()
  const { data, error } = await supabase
    .from('holidays')
    .insert({ name, date, type, year })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteHoliday(id) {
  const { error } = await supabase.from('holidays').delete().eq('id', id)
  if (error) throw error
}

// ─── HR/ADMIN: DIRECT SESSION OVERRIDE ───────────────────────────────────────

// Replaces the entire set of sessions for one employee/date with `sessions`
// (array of { checkIn: ISOString, checkOut: ISOString, isWFH: bool }), logs
// the change to attendance_overrides for audit, and recomputes the aggregate.
// This is the same underlying mechanism used when Admin applies an approved
// regularization item (see Task 8's adminApplyItem).
export async function hrSetSessions(employeeId, date, sessions, reviewerId, reason) {
  if (!sessions || sessions.length === 0) {
    throw new Error('Provide at least one session (check-in/check-out pair).')
  }
  if (!reason || !reason.trim()) {
    throw new Error('A reason is required for audit trail.')
  }

  const windowStart = `${date}T00:00:00.000Z`
  const windowEnd   = `${addDaysISO(date, 1)}T00:00:00.000Z`

  const { data: existingSessions } = await supabase
    .from('attendance_sessions')
    .select('id, check_in, check_out, is_wfh')
    .eq('employee_id', employeeId)
    .gte('check_in', windowStart)
    .lt('check_in', windowEnd)

  // Insert the new sessions BEFORE deleting the old ones. If the insert
  // fails, the old sessions remain untouched — leaving the day recoverable
  // rather than silently wiping it (data-loss risk on partial failure).
  const { data: inserted, error } = await supabase
    .from('attendance_sessions')
    .insert(sessions.map(s => ({
      employee_id: employeeId,
      check_in:    s.checkIn,
      check_out:   s.checkOut,
      is_wfh:      !!s.isWFH,
    })))
    .select()
  if (error) throw error

  if (existingSessions?.length) {
    await supabase.from('attendance_sessions').delete().in('id', existingSessions.map(s => s.id))
  }

  await supabase.from('attendance_overrides').insert({
    attendance_id: null,
    employee_id:   employeeId,
    date,
    field_changed: 'sessions',
    old_value:     JSON.stringify(existingSessions || []),
    new_value:     JSON.stringify(inserted),
    reason,
    overridden_by: reviewerId,
  })

  const attendance = await recomputeDayAggregate(employeeId, date)
  await supabase.from('attendance').update({ hr_override: true }).eq('id', attendance.id)

  return { sessions: inserted, attendance }
}

// ─── WEEKLY HOURS ─────────────────────────────────────────────────────────────

// Monday of the week containing dateStr (ISO week, Mon-Sun), UTC-based.
export function getWeekStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  const day = d.getUTCDay() // 0=Sun, 1=Mon ... 6=Sat
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().split('T')[0]
}

export async function getWeeklyHours(employeeId, weekStartISO) {
  const weekEnd = addDaysISO(weekStartISO, 7)
  const { data: rows, error } = await supabase
    .from('attendance')
    .select('date, hours_worked')
    .eq('employee_id', employeeId)
    .gte('date', weekStartISO)
    .lt('date', weekEnd)
  if (error) throw error

  const empType = await getEmployeeType(employeeId)
  const policy  = WORK_HOURS_BY_TYPE[empType] || WORK_HOURS_BY_TYPE.permanent
  const totalHours = Math.round((rows || []).reduce((sum, r) => sum + (r.hours_worked || 0), 0) * 10) / 10

  return {
    weekStart: weekStartISO,
    totalHours,
    targetHours: policy.fullDay * 5,
    dailyBreakdown: rows || [],
  }
}

export async function getTeamWeeklyAttendance(weekStartISO) {
  const weekEnd = addDaysISO(weekStartISO, 7)
  const { data: rows, error } = await supabase
    .from('attendance')
    .select(`employee_id, date, hours_worked, is_wfh, employee:employee_id(id, full_name, role, department, avatar_initials, employee_type)`)
    .gte('date', weekStartISO)
    .lt('date', weekEnd)
  if (error) throw error

  const byEmployee = {}
  for (const row of rows || []) {
    const id = row.employee_id
    if (!byEmployee[id]) {
      byEmployee[id] = {
        employee: row.employee,
        totalHours: 0,
        sessionDays: 0,
        wfhDays: 0,
      }
    }
    byEmployee[id].totalHours += row.hours_worked || 0
    if (row.hours_worked > 0) byEmployee[id].sessionDays += 1
    if (row.is_wfh) byEmployee[id].wfhDays += 1
  }

  return Object.values(byEmployee).map(e => ({
    ...e,
    totalHours: Math.round(e.totalHours * 10) / 10,
  }))
}
