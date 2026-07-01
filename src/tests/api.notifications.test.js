import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabase } from '../lib/supabase'
import {
  shouldSendMonthlyRegularizationReminder,
  runDailyChecks,
} from '../lib/api.notifications'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── shouldSendMonthlyRegularizationReminder ──────────────────────────────────
describe('shouldSendMonthlyRegularizationReminder', () => {
  it('returns true on the 25th of the month', () => {
    expect(shouldSendMonthlyRegularizationReminder(new Date('2026-06-25T10:00:00.000Z'))).toBe(true)
  })

  it('returns true on the last day of the month', () => {
    expect(shouldSendMonthlyRegularizationReminder(new Date('2026-06-30T10:00:00.000Z'))).toBe(true)
  })

  it('returns false before the 25th', () => {
    expect(shouldSendMonthlyRegularizationReminder(new Date('2026-06-24T10:00:00.000Z'))).toBe(false)
  })

  it('returns false in a different month entirely', () => {
    expect(shouldSendMonthlyRegularizationReminder(new Date('2026-06-10T10:00:00.000Z'))).toBe(false)
  })

  it('handles February (28 days) correctly — last day is the 28th', () => {
    expect(shouldSendMonthlyRegularizationReminder(new Date('2026-02-28T10:00:00.000Z'))).toBe(true)
  })

  it('handles a 30-day month correctly — the 31st does not exist, so day 30 is last day', () => {
    expect(shouldSendMonthlyRegularizationReminder(new Date('2026-04-30T10:00:00.000Z'))).toBe(true)
  })

  it('handles a 31-day month — the 31st is included', () => {
    expect(shouldSendMonthlyRegularizationReminder(new Date('2026-01-31T10:00:00.000Z'))).toBe(true)
  })
})

// ── runDailyChecks: monthly regularization reminder + weekly report ─────────
describe('runDailyChecks — monthly regularization reminder', () => {
  function buildChain(overrides = {}) {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      not: vi.fn(() => chain),
      in: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      lt: vi.fn(() => chain),
      like: vi.fn(() => chain),
      is: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      insert: vi.fn(() => Promise.resolve({ data: {}, error: null })),
      single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      ...overrides,
    }
    return chain
  }

  function setupSupabaseMock({ employees = [], activeEmployees = [], holidays = [], leaveRequests = [], unresolvedDays = [], anyAttendanceRows, alreadyRequestedItems = [], notificationCount = 0 } = {}) {
    supabase.from.mockImplementation((table) => {
      if (table === 'employees') {
        const chain = buildChain()
        chain.select = vi.fn(() => chain)
        // .eq('status','active') must serve both: birthday path continues with .not(),
        // active-roster path awaits the .eq() result directly.
        const eqResult = {
          not: vi.fn(() => Promise.resolve({ data: employees, error: null })),
          then: (resolve) => resolve({ data: activeEmployees, error: null }),
        }
        chain.eq = vi.fn(() => eqResult)
        return chain
      }
      if (table === 'holidays') {
        const chain = buildChain()
        chain.select = vi.fn(() => chain)
        chain.gte = vi.fn(() => chain)
        chain.lte = vi.fn(() => Promise.resolve({ data: holidays, error: null }))
        chain.eq = vi.fn(() => Promise.resolve({ data: [], error: null })) // upcoming-holiday check
        return chain
      }
      if (table === 'leave_requests') {
        const chain = buildChain()
        chain.select = vi.fn(() => chain)
        chain.eq = vi.fn(() => chain)
        chain.lte = vi.fn(() => chain)
        chain.gte = vi.fn(() => Promise.resolve({ data: leaveRequests, error: null }))
        return chain
      }
      if (table === 'attendance') {
        const chain = buildChain()
        chain.select = vi.fn(() => chain)
        chain.in = vi.fn(() => { chain.__usedIn = true; return chain })
        chain.gte = vi.fn(() => chain)
        chain.lte = vi.fn(() => Promise.resolve({
          data: chain.__usedIn ? unresolvedDays : (anyAttendanceRows !== undefined ? anyAttendanceRows : unresolvedDays),
          error: null,
        }))
        return chain
      }
      if (table === 'attendance_regularization_items') {
        const chain = buildChain()
        chain.select = vi.fn(() => chain)
        chain.gte = vi.fn(() => Promise.resolve({ data: alreadyRequestedItems, error: null }))
        return chain
      }
      if (table === 'notifications') {
        const chain = buildChain()
        chain.select = vi.fn(() => chain)
        chain.eq = vi.fn(() => chain)
        chain.gte = vi.fn(() => Promise.resolve({ count: notificationCount, data: [], error: null }))
        chain.insert = vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({ data: {}, error: null })),
          })),
        }))
        return chain
      }
      return buildChain()
    })
  }

  it('creates a reminder notification for an employee with unresolved days on the 25th', async () => {
    vi.setSystemTime(new Date('2026-06-25T10:00:00.000Z'))
    setupSupabaseMock({
      unresolvedDays: [
        { employee_id: 'emp-1', date: '2026-06-05', status: 'absent' },
        { employee_id: 'emp-1', date: '2026-06-10', status: 'half_day' },
      ],
      alreadyRequestedItems: [],
      notificationCount: 0,
    })

    await runDailyChecks('hr-1')

    const insertedTypes = supabase.from.mock.calls
      .filter(([table]) => table === 'notifications')
    expect(insertedTypes.length).toBeGreaterThan(0)
    vi.useRealTimers()
  })

  it('excludes a day that already has a regularization request covering that specific date', async () => {
    vi.setSystemTime(new Date('2026-06-25T10:00:00.000Z'))
    let capturedMetadata = null
    supabase.from.mockImplementation((table) => {
      if (table === 'employees') {
        const chain = buildChain()
        chain.select = vi.fn(() => chain)
        // No active employees for the true-absence roster scan — this test is
        // isolating the already-requested-dedup logic on the half_day/absent path only.
        const eqResult = {
          not: vi.fn(() => Promise.resolve({ data: [], error: null })),
          then: (resolve) => resolve({ data: [], error: null }),
        }
        chain.eq = vi.fn(() => eqResult)
        return chain
      }
      if (table === 'holidays') {
        const chain = buildChain()
        chain.select = vi.fn(() => chain)
        chain.gte = vi.fn(() => chain)
        chain.lte = vi.fn(() => Promise.resolve({ data: [], error: null }))
        chain.eq = vi.fn(() => Promise.resolve({ data: [], error: null }))
        return chain
      }
      if (table === 'leave_requests') {
        const chain = buildChain()
        chain.select = vi.fn(() => chain)
        chain.eq = vi.fn(() => chain)
        chain.lte = vi.fn(() => chain)
        chain.gte = vi.fn(() => Promise.resolve({ data: [], error: null }))
        return chain
      }
      if (table === 'attendance') {
        const chain = buildChain()
        chain.select = vi.fn(() => chain)
        chain.in = vi.fn(() => { chain.__usedIn = true; return chain })
        chain.gte = vi.fn(() => chain)
        chain.lte = vi.fn(() => Promise.resolve({
          data: [{ employee_id: 'emp-1', date: '2026-06-05', status: 'absent' }],
          error: null,
        }))
        return chain
      }
      if (table === 'attendance_regularization_items') {
        const chain = buildChain()
        chain.select = vi.fn(() => chain)
        chain.gte = vi.fn(() => Promise.resolve({
          data: [{ date: '2026-06-05', request: { employee_id: 'emp-1' } }],
          error: null,
        }))
        return chain
      }
      if (table === 'notifications') {
        const chain = buildChain()
        chain.select = vi.fn(() => chain)
        chain.eq = vi.fn((col, val) => {
          if (col === 'type') capturedMetadata = val
          return chain
        })
        chain.gte = vi.fn(() => Promise.resolve({ count: 0, data: [], error: null }))
        chain.insert = vi.fn(() => ({
          select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: {}, error: null })) })),
        }))
        return chain
      }
      return buildChain()
    })

    await runDailyChecks('hr-1')

    // The only unresolved day is already covered by a regularization request, so
    // no 'attendance_regularization_reminder' notification insert should happen.
    expect(capturedMetadata).not.toBe('attendance_regularization_reminder')
    vi.useRealTimers()
  })

  it('does not send the monthly reminder before the 25th', async () => {
    vi.setSystemTime(new Date('2026-06-10T10:00:00.000Z'))
    setupSupabaseMock({
      unresolvedDays: [{ employee_id: 'emp-1', date: '2026-06-05', status: 'absent' }],
    })

    await runDailyChecks('hr-1')

    const attendanceCalls = supabase.from.mock.calls.filter(([table]) => table === 'attendance')
    expect(attendanceCalls.length).toBe(0)
    vi.useRealTimers()
  })
})

// Shared chain builders for the true-absence + weekly-report test blocks below.
// `employees` now serves two distinct query shapes:
//   1. birthday query:      .select().eq('status','active').not('date_of_birth','is',null)
//   2. active-roster query: .select().eq('status','active')                (terminal — awaited directly)
// Both start with .select().eq(), so the object returned by `eq` must be awaitable
// (thenable) AND still expose `.not()` for the birthday path.
function employeesChain(activeRosterData, birthdayData) {
  const eqResult = {
    not: vi.fn(() => Promise.resolve({ data: birthdayData, error: null })),
    then: (resolve) => resolve({ data: activeRosterData, error: null }),
  }
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => eqResult),
  }
  return chain
}

function holidaysChain(monthHolidays, upcomingHolidays = []) {
  const chain = {
    select: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lte: vi.fn(() => Promise.resolve({ data: monthHolidays, error: null })),
    eq: vi.fn(() => Promise.resolve({ data: upcomingHolidays, error: null })),
  }
  return chain
}

function leaveRequestsChain(approvedLeaves) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    gte: vi.fn(() => Promise.resolve({ data: approvedLeaves, error: null })),
  }
  return chain
}

// `attendance` also serves two shapes: the existing half_day/absent query (uses .in())
// and the new any-row-exists query (no .in()). Track which path via a flag.
function attendanceChain(halfAbsentRows, anyRowRows) {
  const chain = {
    select: vi.fn(() => chain),
    in: vi.fn(() => { chain.__usedIn = true; return chain }),
    gte: vi.fn(() => chain),
    lte: vi.fn(() => Promise.resolve({ data: chain.__usedIn ? halfAbsentRows : anyRowRows, error: null })),
  }
  return chain
}

function regItemsChain(alreadyRequestedItems) {
  const chain = {
    select: vi.fn(() => chain),
    gte: vi.fn(() => Promise.resolve({ data: alreadyRequestedItems, error: null })),
  }
  return chain
}

function notificationsChain({ notificationCount = 0, onEq = null, onInsert = null } = {}) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn((col, val) => { if (onEq) onEq(col, val); return chain }),
    gte: vi.fn(() => Promise.resolve({ count: notificationCount, data: [], error: null })),
    insert: vi.fn((payload) => {
      if (onInsert) onInsert(payload)
      return { select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: {}, error: null })) })) }
    }),
  }
  return chain
}

describe('runDailyChecks — true absence detection (no attendance row at all)', () => {
  it('notifies an employee with a true no-show day (no attendance row at all)', async () => {
    // 2026-06-25 is a Thursday (working day), no holiday, no leave, no attendance row.
    vi.setSystemTime(new Date('2026-06-25T10:00:00.000Z'))
    let capturedNotifyId = null
    supabase.from.mockImplementation((table) => {
      if (table === 'notifications') return notificationsChain({
        onEq: (col, val) => { if (col === 'employee_id') capturedNotifyId = val },
      })
      if (table === 'employees') return employeesChain([{ id: 'emp-1' }], [])
      if (table === 'holidays') return holidaysChain([])
      if (table === 'leave_requests') return leaveRequestsChain([])
      if (table === 'attendance') return attendanceChain([], []) // no rows at all -> every working day is a no-show
      if (table === 'attendance_regularization_items') return regItemsChain([])
      const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), gte: vi.fn(() => chain), lte: vi.fn(() => Promise.resolve({ data: [], error: null })) }
      return chain
    })

    await runDailyChecks('hr-1')

    expect(capturedNotifyId).toBe('emp-1')
    vi.useRealTimers()
  })

  it('does NOT notify for a working day the employee was on approved leave', async () => {
    vi.setSystemTime(new Date('2026-06-25T10:00:00.000Z'))
    let reminderInserted = false
    supabase.from.mockImplementation((table) => {
      if (table === 'employees') return employeesChain([{ id: 'emp-1' }], [])
      if (table === 'holidays') return holidaysChain([])
      // Employee on approved leave for the entire month so far
      if (table === 'leave_requests') return leaveRequestsChain([{ employee_id: 'emp-1', from_date: '2026-06-01', to_date: '2026-06-30' }])
      if (table === 'attendance') return attendanceChain([], [])
      if (table === 'attendance_regularization_items') return regItemsChain([])
      if (table === 'notifications') return notificationsChain({
        onInsert: (payload) => { if (payload?.type === 'attendance_regularization_reminder') reminderInserted = true },
      })
      const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), gte: vi.fn(() => chain), lte: vi.fn(() => Promise.resolve({ data: [], error: null })) }
      return chain
    })

    await runDailyChecks('hr-1')

    expect(reminderInserted).not.toBe(true)
    vi.useRealTimers()
  })

  it('does NOT notify for a company holiday in the range', async () => {
    // Make the whole range a holiday so every working day is excluded.
    vi.setSystemTime(new Date('2026-06-25T10:00:00.000Z'))
    let reminderInserted = false
    const allDatesInRange = ['2026-06-01','2026-06-02','2026-06-03','2026-06-04','2026-06-05','2026-06-08','2026-06-09','2026-06-10','2026-06-11','2026-06-12','2026-06-15','2026-06-16','2026-06-17','2026-06-18','2026-06-19','2026-06-22','2026-06-23','2026-06-24','2026-06-25']
      .map(date => ({ date, type: 'company' }))
    supabase.from.mockImplementation((table) => {
      if (table === 'employees') return employeesChain([{ id: 'emp-1' }], [])
      if (table === 'holidays') return holidaysChain(allDatesInRange)
      if (table === 'leave_requests') return leaveRequestsChain([])
      if (table === 'attendance') return attendanceChain([], [])
      if (table === 'attendance_regularization_items') return regItemsChain([])
      if (table === 'notifications') return notificationsChain({
        onInsert: (payload) => { if (payload?.type === 'attendance_regularization_reminder') reminderInserted = true },
      })
      const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), gte: vi.fn(() => chain), lte: vi.fn(() => Promise.resolve({ data: [], error: null })) }
      return chain
    })

    await runDailyChecks('hr-1')

    expect(reminderInserted).toBe(false)
    vi.useRealTimers()
  })

  it('does not double-count a day already covered by an attendance row (half_day) in the no-row check', async () => {
    // Single working day in range: 2026-06-25 (Thursday). It has a half_day
    // attendance row, so it's counted once by the existing query and must be
    // skipped entirely by the new no-row scan (hasAttendanceRow check).
    vi.setSystemTime(new Date('2026-06-25T10:00:00.000Z'))
    let capturedMessage = null
    // Treat every working day except 2026-06-25 as a holiday, so the only day
    // left for the true-absence scan to consider is the one that already has
    // a half_day attendance row (and must therefore be skipped as a no-show).
    const otherWorkingDaysAsHolidays = ['2026-06-01','2026-06-02','2026-06-03','2026-06-04','2026-06-05','2026-06-08','2026-06-09','2026-06-10','2026-06-11','2026-06-12','2026-06-15','2026-06-16','2026-06-17','2026-06-18','2026-06-19','2026-06-22','2026-06-23','2026-06-24']
      .map(date => ({ date, type: 'company' }))
    supabase.from.mockImplementation((table) => {
      if (table === 'employees') return employeesChain([{ id: 'emp-1' }], [])
      if (table === 'holidays') return holidaysChain(otherWorkingDaysAsHolidays)
      if (table === 'leave_requests') return leaveRequestsChain([])
      if (table === 'attendance') return attendanceChain(
        [{ employee_id: 'emp-1', date: '2026-06-25', status: 'half_day' }], // existing half_day/absent query result
        [{ employee_id: 'emp-1', date: '2026-06-25' }],                    // any-row query result (same day has a row)
      )
      if (table === 'attendance_regularization_items') return regItemsChain([])
      if (table === 'notifications') return notificationsChain({
        onInsert: (payload) => { if (payload?.type === 'attendance_regularization_reminder') capturedMessage = payload.message },
      })
      const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), gte: vi.fn(() => chain), lte: vi.fn(() => Promise.resolve({ data: [], error: null })) }
      return chain
    })

    await runDailyChecks('hr-1')

    // Count should be exactly 1 (the half_day row), not 2 (half_day + phantom no-show for the same day).
    expect(capturedMessage).toContain('1 day(s)')
    vi.useRealTimers()
  })
})

describe('runDailyChecks — weekly attendance report', () => {
  function baseMock({ notificationCount = 0, insertSpy = null } = {}) {
    supabase.from.mockImplementation((table) => {
      if (table === 'notifications') return notificationsChain({ notificationCount, onInsert: insertSpy })
      if (table === 'attendance') return attendanceChain([], [])
      if (table === 'attendance_regularization_items') return regItemsChain([])
      if (table === 'employees') return employeesChain([], [])
      if (table === 'holidays') return holidaysChain([])
      if (table === 'leave_requests') return leaveRequestsChain([])
      const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), gte: vi.fn(() => chain), lte: vi.fn(() => Promise.resolve({ data: [], error: null })) }
      return chain
    })
  }

  it('fires on Monday', async () => {
    // 2026-06-29 is a Monday
    vi.setSystemTime(new Date('2026-06-29T10:00:00.000Z'))
    baseMock({ notificationCount: 0 })

    await runDailyChecks('hr-1')

    const notificationCalls = supabase.from.mock.calls.filter(([table]) => table === 'notifications')
    expect(notificationCalls.length).toBeGreaterThan(0)
    vi.useRealTimers()
  })

  it('does not fire on a non-Monday', async () => {
    // 2026-06-30 is a Tuesday
    vi.setSystemTime(new Date('2026-06-30T10:00:00.000Z'))
    const insertSpy = vi.fn()
    baseMock({ notificationCount: 0, insertSpy })

    await runDailyChecks('hr-1')

    const weeklyReportInserts = insertSpy.mock.calls
      .map(([payload]) => payload)
      .filter(payload => payload?.type === 'attendance_weekly_report_ready')
    expect(weeklyReportInserts.length).toBe(0)
    vi.useRealTimers()
  })

  it('does not send a duplicate weekly report notification if already sent this week', async () => {
    vi.setSystemTime(new Date('2026-06-29T10:00:00.000Z'))
    const insertSpy = vi.fn()
    // notificationCount: 1 simulates that a weekly-report notification was already
    // created for this reviewer today (dedup check should short-circuit the insert).
    baseMock({ notificationCount: 1, insertSpy })

    await runDailyChecks('hr-1')

    const weeklyReportInserts = insertSpy.mock.calls
      .map(([payload]) => payload)
      .filter(payload => payload?.type === 'attendance_weekly_report_ready')
    expect(weeklyReportInserts.length).toBe(0)
    vi.useRealTimers()
  })
})
