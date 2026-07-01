import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatTime, hoursWorked, todayISO, sessionHoursForDate, deriveDailyStatus } from '../lib/api.attendance'

// ── formatTime ────────────────────────────────────────────────────────────────
describe('formatTime', () => {
  it('returns — for null', () => {
    expect(formatTime(null)).toBe('—')
  })

  it('returns — for undefined', () => {
    expect(formatTime(undefined)).toBe('—')
  })

  it('formats a valid ISO string', () => {
    const result = formatTime('2026-06-17T09:00:00.000Z')
    expect(result).toMatch(/\d{2}:\d{2}/)
    expect(typeof result).toBe('string')
  })

  it('formats morning time correctly', () => {
    // 9:00 AM IST = 03:30 UTC
    const result = formatTime('2026-06-17T03:30:00.000Z')
    expect(result).toBeTruthy()
    expect(result).not.toBe('—')
  })
})

// ── hoursWorked ───────────────────────────────────────────────────────────────
describe('hoursWorked', () => {
  it('returns null when checkIn is missing', () => {
    expect(hoursWorked(null, '2026-06-17T18:00:00Z')).toBeNull()
  })

  it('returns null when checkOut is missing', () => {
    expect(hoursWorked('2026-06-17T09:00:00Z', null)).toBeNull()
  })

  it('returns null when both are missing', () => {
    expect(hoursWorked(null, null)).toBeNull()
  })

  it('calculates 8 hours correctly', () => {
    const checkIn  = '2026-06-17T03:30:00.000Z' // 9:00 IST
    const checkOut = '2026-06-17T11:30:00.000Z' // 17:00 IST
    expect(hoursWorked(checkIn, checkOut)).toBe(8)
  })

  it('calculates 4 hours for half day', () => {
    const checkIn  = '2026-06-17T03:30:00.000Z' // 9:00 IST
    const checkOut = '2026-06-17T07:30:00.000Z' // 13:00 IST
    expect(hoursWorked(checkIn, checkOut)).toBe(4)
  })

  it('rounds to 1 decimal place', () => {
    const checkIn  = '2026-06-17T03:30:00.000Z'
    const checkOut = '2026-06-17T09:45:00.000Z' // 6.25 hours
    const result = hoursWorked(checkIn, checkOut)
    expect(result).toBe(6.3) // rounded to 1 decimal
  })

  it('handles same check-in and check-out time', () => {
    const time = '2026-06-17T09:00:00.000Z'
    expect(hoursWorked(time, time)).toBe(0)
  })
})

// ── todayISO ──────────────────────────────────────────────────────────────────
describe('todayISO', () => {
  it('returns a string in YYYY-MM-DD format', () => {
    const result = todayISO()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('matches today\'s date', () => {
    const expected = new Date().toISOString().split('T')[0]
    expect(todayISO()).toBe(expected)
  })

  it('has no time component', () => {
    expect(todayISO()).not.toContain('T')
    expect(todayISO()).not.toContain(':')
  })
})

// ── sessionHoursForDate ────────────────────────────────────────────────────────
describe('sessionHoursForDate', () => {
  it('returns 0 if checkOut is missing (open session)', () => {
    expect(sessionHoursForDate('2026-06-17T03:30:00.000Z', null, '2026-06-17')).toBe(0)
  })

  it('counts full session on the same day', () => {
    // 9:00 - 17:00 IST same day = 03:30 - 11:30 UTC
    const hours = sessionHoursForDate('2026-06-17T03:30:00.000Z', '2026-06-17T11:30:00.000Z', '2026-06-17')
    expect(hours).toBe(8)
  })

  it('returns 0 for a date the session does not touch', () => {
    const hours = sessionHoursForDate('2026-06-17T03:30:00.000Z', '2026-06-17T11:30:00.000Z', '2026-06-18')
    expect(hours).toBe(0)
  })

  it('splits a midnight-spanning session across both days', () => {
    // 6 PM IST June 17 = 12:30 UTC June 17; 3 AM IST June 18 = 21:30 UTC June 17
    // Use plain UTC times to keep the math easy to verify: 18:00 UTC June 17 -> 03:00 UTC June 18
    const checkIn  = '2026-06-17T18:00:00.000Z'
    const checkOut = '2026-06-18T03:00:00.000Z'
    expect(sessionHoursForDate(checkIn, checkOut, '2026-06-17')).toBe(6) // 18:00 -> midnight
    expect(sessionHoursForDate(checkIn, checkOut, '2026-06-18')).toBe(3) // midnight -> 03:00
  })

  it('rounds to 1 decimal place', () => {
    const checkIn  = '2026-06-17T03:30:00.000Z'
    const checkOut = '2026-06-17T09:45:00.000Z' // 6.25 hours
    expect(sessionHoursForDate(checkIn, checkOut, '2026-06-17')).toBe(6.3)
  })
})

// ── deriveDailyStatus ──────────────────────────────────────────────────────────
describe('deriveDailyStatus', () => {
  it('returns present for an open session (not WFH)', () => {
    expect(deriveDailyStatus(0, false, true, 'permanent')).toBe('present')
  })

  it('returns wfh for an open session marked WFH', () => {
    expect(deriveDailyStatus(0, true, true, 'permanent')).toBe('wfh')
  })

  it('returns absent for 0 hours with no open session', () => {
    expect(deriveDailyStatus(0, false, false, 'permanent')).toBe('absent')
  })

  it('returns half_day for partial hours below full-day threshold', () => {
    expect(deriveDailyStatus(4, false, false, 'permanent')).toBe('half_day')
  })

  it('returns present for full-day hours met (permanent = 8h)', () => {
    expect(deriveDailyStatus(8, false, false, 'permanent')).toBe('present')
  })

  it('returns wfh for full-day hours met and WFH', () => {
    expect(deriveDailyStatus(8, true, false, 'permanent')).toBe('wfh')
  })

  it('uses the intern/contractor threshold (5.5h)', () => {
    expect(deriveDailyStatus(5.5, false, false, 'intern')).toBe('present')
    expect(deriveDailyStatus(3, false, false, 'intern')).toBe('half_day')
  })
})
