import { supabase } from './supabase'

// ─── WINDOW COMPUTATION ────────────────────────────────────────────────────
// Two fixed annual windows, UTC-based (dates here are pure DATE values with
// no wall-clock component, so this doesn't carry the local/UTC clock-time
// bug class from the Attendance Overhaul — but day-boundary math still does).
export function getOptinWindow(now = new Date()) {
  const year  = now.getUTCFullYear()
  const day   = now.getUTCDate()
  const month = now.getUTCMonth() + 1 // 1-indexed

  const pad = n => String(n).padStart(2, '0')

  if (month === 1 && day >= 1 && day <= 14) {
    return {
      isOpen: true,
      label: `${year}-H1`,
      editableFromDate: null,
      closesOn: `${year}-01-14`,
    }
  }

  if (month === 7 && day >= 1 && day <= 14) {
    return {
      isOpen: true,
      label: `${year}-H2`,
      editableFromDate: `${year}-07-01`,
      closesOn: `${year}-07-14`,
    }
  }

  // Closed — figure out the next window
  if (month < 7 || (month === 7 && day < 1)) {
    // Before Jul 1 this year (and after Jan 14, since that case is handled above)
    return { isOpen: false, nextLabel: `${year}-H2`, nextOpensOn: `${year}-07-01` }
  }
  // On/after Jul 15 this year — next window is Jan 1 of next year
  return { isOpen: false, nextLabel: `${year + 1}-H1`, nextOpensOn: `${year + 1}-01-01` }
}

// ─── OPTIONAL HOLIDAYS ─────────────────────────────────────────────────────
export async function getOptionalHolidaysForYear(year) {
  const { data, error } = await supabase
    .from('holidays')
    .select('*')
    .eq('year', year)
    .eq('type', 'optional')
    .order('date', { ascending: true })
  if (error) throw error
  return data || []
}

// ─── MY OPT-INS ────────────────────────────────────────────────────────────
export async function getMyHolidayOptins(employeeId, year) {
  const { data, error } = await supabase
    .from('holiday_optins')
    .select('holiday_id, holiday:holiday_id(year)')
    .eq('employee_id', employeeId)
  if (error) throw error
  return (data || [])
    .filter(row => row.holiday?.year === year)
    .map(row => row.holiday_id)
}

// ─── SAVE MY OPT-INS (replace-entirely for the editable set) ───────────────
export async function saveMyHolidayOptins(employeeId, editableHolidayIds, selectedHolidayIds) {
  const selectedSet = new Set(selectedHolidayIds)
  const toDelete = editableHolidayIds.filter(id => !selectedSet.has(id))

  if (toDelete.length > 0) {
    await supabase
      .from('holiday_optins')
      .delete()
      .in('holiday_id', toDelete)
      .eq('employee_id', employeeId)
  }

  if (selectedHolidayIds.length > 0) {
    await supabase
      .from('holiday_optins')
      .insert(selectedHolidayIds.map(holidayId => ({
        employee_id: employeeId,
        holiday_id: holidayId,
      })))
  }

  const { label } = getOptinWindow(new Date())
  await supabase
    .from('holiday_optin_submissions')
    .upsert({ employee_id: employeeId, window_label: label, confirmed_at: new Date().toISOString() }, { onConflict: 'employee_id,window_label' })
}

// ─── SHARED VISIBILITY: WHO OPTED INTO A GIVEN HOLIDAY ──────────────────────
export async function getHolidayOptinRoster(holidayId) {
  const { data, error } = await supabase
    .from('holiday_optins')
    .select('employee_id, employee:employee_id(full_name, avatar_initials)')
    .eq('holiday_id', holidayId)
  if (error) throw error
  return (data || []).map(row => ({
    employee_id: row.employee_id,
    full_name: row.employee?.full_name,
    avatar_initials: row.employee?.avatar_initials,
  }))
}

// ─── HAS THIS EMPLOYEE ALREADY CONFIRMED FOR THE CURRENT WINDOW? ────────────
export async function hasSubmittedForWindow(employeeId, windowLabel) {
  const { data } = await supabase
    .from('holiday_optin_submissions')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('window_label', windowLabel)
    .maybeSingle()
  return !!data
}
