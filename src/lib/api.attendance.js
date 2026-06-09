import { supabase } from './supabase'
import { FULL_DAY_HOURS, HALF_DAY_HOURS, WORK_START_HOUR, LATE_MARK_MINUTES } from './constants'

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function computeStatus(checkIn, checkOut, isWFH) {
  if (!checkIn) return 'absent'
  const inTime  = new Date(checkIn)
  const outTime = checkOut ? new Date(checkOut) : null

  // Late mark: arrived more than grace period after work start
  const scheduledStart = new Date(inTime)
  scheduledStart.setHours(WORK_START_HOUR, LATE_MARK_MINUTES, 0, 0)
  const isLate = inTime > scheduledStart

  if (!outTime) return isLate ? 'late_mark' : isWFH ? 'wfh' : 'present'

  const hoursWorked = (outTime - inTime) / 3600000

  if (hoursWorked >= FULL_DAY_HOURS) {
    if (isLate)  return 'late_mark'
    if (isWFH)   return 'wfh'
    return 'present'
  }
  if (hoursWorked >= HALF_DAY_HOURS) return 'half_day'
  return 'late_mark'
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

export async function checkIn(employeeId, isWFH = false) {
  const today = todayISO()

  // Prevent duplicate check-in
  const { data: existing } = await supabase
    .from('attendance')
    .select('id, check_in')
    .eq('employee_id', employeeId)
    .eq('date', today)
    .single()

  if (existing?.check_in) throw new Error('You have already checked in today.')

  const now = new Date().toISOString()
  const status = computeStatus(now, null, isWFH)

  const { data, error } = await supabase
    .from('attendance')
    .upsert({
      employee_id: employeeId,
      date:        today,
      check_in:    now,
      is_wfh:      isWFH,
      status,
    }, { onConflict: 'employee_id,date' })
    .select()
    .single()

  if (error) throw error
  return data
}

// ─── CHECK OUT ───────────────────────────────────────────────────────────────

export async function checkOut(employeeId) {
  const today = todayISO()
  const now   = new Date().toISOString()

  const { data: existing, error: fetchError } = await supabase
    .from('attendance')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('date', today)
    .single()

  if (fetchError || !existing) throw new Error('No check-in found for today. Please check in first.')
  if (existing.check_out)      throw new Error('You have already checked out today.')

  const status = computeStatus(existing.check_in, now, existing.is_wfh)
  const hours  = hoursWorked(existing.check_in, now)

  const { data, error } = await supabase
    .from('attendance')
    .update({ check_out: now, status, hours_worked: hours })
    .eq('id', existing.id)
    .select()
    .single()

  if (error) throw error

  // Auto-deduct 0.5 casual_sick leave for half day
  if (status === 'half_day') {
    await deductHalfDayLeave(employeeId, existing.date)
  }

  return data
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

// ─── HR: MANUALLY OVERRIDE ATTENDANCE STATUS ─────────────────────────────────

export async function overrideAttendance(employeeId, date, status, note) {
  const { data, error } = await supabase
    .from('attendance')
    .upsert({
      employee_id:   employeeId,
      date,
      status,
      hr_override:   true,
      override_note: note || null,
    }, { onConflict: 'employee_id,date' })
    .select()
    .single()

  if (error) throw error
  return data
}
