import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatTime, hoursWorked, todayISO } from '../lib/api.attendance'

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
