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
