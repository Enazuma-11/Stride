import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabase } from '../lib/supabase'
import {
  getOptinWindow,
  getOptionalHolidaysForYear,
  getMyHolidayOptins,
  saveMyHolidayOptins,
  getHolidayOptinRoster,
  hasSubmittedForWindow,
} from '../lib/api.holidayOptins'

beforeEach(() => {
  vi.clearAllMocks()
})

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

describe('getOptionalHolidaysForYear', () => {
  it('fetches only type=optional holidays for the given year, ordered by date', async () => {
    const holidays = [{ id: 'h1', name: 'Festival A', date: '2026-03-15', type: 'optional', year: 2026 }]
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: holidays, error: null }),
    })

    const result = await getOptionalHolidaysForYear(2026)
    expect(supabase.from).toHaveBeenCalledWith('holidays')
    expect(result).toEqual(holidays)
  })

  it('throws on Supabase error', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    })
    await expect(getOptionalHolidaysForYear(2026)).rejects.toThrow('DB error')
  })
})

describe('getMyHolidayOptins', () => {
  it('returns the array of holiday_ids the employee opted into for that year', async () => {
    const rows = [
      { holiday_id: 'h1', holiday: { year: 2026 } },
      { holiday_id: 'h2', holiday: { year: 2026 } },
    ]
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    })
    supabase.from().eq.mockResolvedValue({ data: rows, error: null })

    const result = await getMyHolidayOptins('emp-1', 2026)
    expect(result).toEqual(['h1', 'h2'])
  })
})

describe('saveMyHolidayOptins', () => {
  // Regression test for the "re-save throws on unique-constraint violation" bug:
  // when an employee re-saves and keeps a previously-opted-in holiday selected,
  // that holiday's `holiday_optins` row already exists in the DB. The old
  // implementation only deleted the DESELECTED subset of editableHolidayIds,
  // so the still-selected holiday's existing row was never deleted before the
  // plain `.insert()` tried to re-insert it — violating the
  // UNIQUE(employee_id, holiday_id) constraint. The fix must delete the FULL
  // editable set unconditionally before inserting, so no pre-existing row can
  // collide with the insert. This test proves the delete call covers the
  // entire editable set (including still-selected holidays), which is what
  // makes the subsequent insert collision-free.
  it('deletes the full editable set (including still-selected holidays) before inserting, so a re-save does not collide with existing rows', async () => {
    const editableHolidayIds = ['h1', 'h2', 'h3']
    // h1 was already opted into in a prior save and stays selected here —
    // this is the exact "re-save" scenario that used to throw.
    const selectedHolidayIds = ['h1', 'h3']
    let deletedIds, insertedRows

    supabase.from.mockImplementation(table => {
      if (table === 'holiday_optins') {
        return {
          delete: vi.fn().mockReturnThis(),
          in: vi.fn().mockImplementation((col, ids) => {
            deletedIds = ids
            return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
          }),
          insert: vi.fn().mockImplementation(rows => {
            insertedRows = rows
            return Promise.resolve({ data: null, error: null })
          }),
        }
      }
      if (table === 'holiday_optin_submissions') {
        return { upsert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    await saveMyHolidayOptins('emp-1', editableHolidayIds, selectedHolidayIds)

    // The delete must cover the FULL editable set (h1, h2, h3), not just the
    // deselected h2 — otherwise h1's pre-existing row survives to collide
    // with the insert below.
    expect(deletedIds).toEqual(editableHolidayIds)
    // The still-selected h1 must be included in the insert (proving no
    // crash/skip happens for a holiday that was already opted into).
    expect(insertedRows).toEqual([
      { employee_id: 'emp-1', holiday_id: 'h1' },
      { employee_id: 'emp-1', holiday_id: 'h3' },
    ])
  })

  it('deletes opt-ins for editable holidays not selected, inserts newly selected ones, and records the submission', async () => {
    const editableHolidayIds = ['h1', 'h2', 'h3']
    const selectedHolidayIds = ['h1', 'h3']
    let deletedIds, insertedRows, submissionRow

    supabase.from.mockImplementation(table => {
      if (table === 'holiday_optins') {
        return {
          delete: vi.fn().mockReturnThis(),
          in: vi.fn().mockImplementation((col, ids) => {
            deletedIds = ids
            return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
          }),
          insert: vi.fn().mockImplementation(rows => {
            insertedRows = rows
            return Promise.resolve({ data: null, error: null })
          }),
        }
      }
      if (table === 'holiday_optin_submissions') {
        return {
          upsert: vi.fn().mockImplementation(row => {
            submissionRow = row
            return Promise.resolve({ data: null, error: null })
          }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    await saveMyHolidayOptins('emp-1', editableHolidayIds, selectedHolidayIds)

    // The full editable set is now deleted unconditionally (delete-then-insert
    // replace-entirely pattern), not just the deselected subset.
    expect(deletedIds).toEqual(editableHolidayIds)
    expect(insertedRows).toEqual([
      { employee_id: 'emp-1', holiday_id: 'h1' },
      { employee_id: 'emp-1', holiday_id: 'h3' },
    ])
    expect(submissionRow.employee_id).toBe('emp-1')
    expect(submissionRow.window_label).toMatch(/^\d{4}-H[12]$/)
  })

  it('still records a submission row when nothing is selected (confirming zero is a valid response)', async () => {
    let submissionWritten = false
    supabase.from.mockImplementation(table => {
      if (table === 'holiday_optins') {
        return {
          delete: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      if (table === 'holiday_optin_submissions') {
        return {
          upsert: vi.fn().mockImplementation(() => { submissionWritten = true; return Promise.resolve({ data: null, error: null }) }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    await saveMyHolidayOptins('emp-1', ['h1'], [])
    expect(submissionWritten).toBe(true)
  })

  it('does not call insert when every editable holiday was deselected', async () => {
    let insertCalled = false
    supabase.from.mockImplementation(table => {
      if (table === 'holiday_optins') {
        return {
          delete: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
          insert: vi.fn().mockImplementation(() => { insertCalled = true; return Promise.resolve({ data: null, error: null }) }),
        }
      }
      if (table === 'holiday_optin_submissions') {
        return { upsert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    await saveMyHolidayOptins('emp-1', ['h1'], [])
    expect(insertCalled).toBe(false)
  })
})

describe('getHolidayOptinRoster', () => {
  it('returns the employees who opted into a given holiday', async () => {
    const rows = [
      { employee_id: 'e1', employee: { full_name: 'Jane Doe', avatar_initials: 'JD' } },
    ]
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: rows, error: null }),
    })

    const result = await getHolidayOptinRoster('h1')
    expect(result).toEqual([{ employee_id: 'e1', full_name: 'Jane Doe', avatar_initials: 'JD' }])
  })
})

describe('hasSubmittedForWindow', () => {
  it('returns true when a submission row exists for the window', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'sub-1' }, error: null }),
    })
    const result = await hasSubmittedForWindow('emp-1', '2026-H1')
    expect(result).toBe(true)
  })

  it('returns false when no submission row exists', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })
    const result = await hasSubmittedForWindow('emp-1', '2026-H1')
    expect(result).toBe(false)
  })
})
