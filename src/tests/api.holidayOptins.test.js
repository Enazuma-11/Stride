import { describe, it, expect } from 'vitest'
import { getOptinWindow } from '../lib/api.holidayOptins'

describe('getOptinWindow', () => {
  it('is closed on Dec 31, with next window Jan 1 of the following year', () => {
    const result = getOptinWindow(new Date('2025-12-31T12:00:00.000Z'))
    expect(result.isOpen).toBe(false)
    expect(result.nextOpensOn).toBe('2026-01-01')
    expect(result.nextLabel).toBe('2026-H1')
  })

  it('is open (H1) on Jan 1, editable for the whole year', () => {
    const result = getOptinWindow(new Date('2026-01-01T00:00:00.000Z'))
    expect(result.isOpen).toBe(true)
    expect(result.label).toBe('2026-H1')
    expect(result.editableFromDate).toBeNull()
    expect(result.closesOn).toBe('2026-01-14')
  })

  it('is open (H1) on Jan 14, the last day of the window', () => {
    const result = getOptinWindow(new Date('2026-01-14T23:00:00.000Z'))
    expect(result.isOpen).toBe(true)
    expect(result.label).toBe('2026-H1')
  })

  it('is closed on Jan 15, the day after H1 closes, with next window Jul 1', () => {
    const result = getOptinWindow(new Date('2026-01-15T00:00:00.000Z'))
    expect(result.isOpen).toBe(false)
    expect(result.nextOpensOn).toBe('2026-07-01')
    expect(result.nextLabel).toBe('2026-H2')
  })

  it('is closed on Jun 30, with next window Jul 1', () => {
    const result = getOptinWindow(new Date('2026-06-30T23:59:59.000Z'))
    expect(result.isOpen).toBe(false)
    expect(result.nextOpensOn).toBe('2026-07-01')
  })

  it('is open (H2) on Jul 1, editable only from Jul 1 onward', () => {
    const result = getOptinWindow(new Date('2026-07-01T00:00:00.000Z'))
    expect(result.isOpen).toBe(true)
    expect(result.label).toBe('2026-H2')
    expect(result.editableFromDate).toBe('2026-07-01')
    expect(result.closesOn).toBe('2026-07-14')
  })

  it('is open (H2) on Jul 14, the last day of the window', () => {
    const result = getOptinWindow(new Date('2026-07-14T10:00:00.000Z'))
    expect(result.isOpen).toBe(true)
    expect(result.label).toBe('2026-H2')
  })

  it('is closed on Jul 15, with next window Jan 1 of the following year', () => {
    const result = getOptinWindow(new Date('2026-07-15T00:00:00.000Z'))
    expect(result.isOpen).toBe(false)
    expect(result.nextOpensOn).toBe('2027-01-01')
    expect(result.nextLabel).toBe('2027-H1')
  })

  it('uses UTC day boundaries, not local time', () => {
    // 2026-01-14T23:30:00.000Z is still Jan 14 in UTC — must be open
    const result = getOptinWindow(new Date('2026-01-14T23:30:00.000Z'))
    expect(result.isOpen).toBe(true)
  })
})
