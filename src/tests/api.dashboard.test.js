import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabase } from '../lib/supabase'

vi.mock('../lib/api.attendance', () => ({
  todayISO:   vi.fn(() => '2026-07-05'),
  addDaysISO: vi.fn((date, days) => {
    const d = new Date(date)
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }),
}))

import {
  getPendingRegularizationsForHR,
  getPendingTransfersForHR,
  getExpiringCertificationsForHR,
  getProbationEndingSoon,
  getMyUnregularizedSessions,
  getMyExpiringCertifications,
} from '../lib/api.dashboard'

beforeEach(() => { vi.clearAllMocks() })

// ── getPendingRegularizationsForHR ────────────────────────────────────────────
describe('getPendingRegularizationsForHR', () => {
  it('returns mapped records', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [{ id: 'r1', employee_id: 'emp-1', status: 'pending_admin', created_at: '2026-07-01T09:00:00Z', employee: { full_name: 'Priya Sharma' } }],
            error: null,
          }),
        }),
      }),
    })
    const result = await getPendingRegularizationsForHR()
    expect(supabase.from).toHaveBeenCalledWith('attendance_regularization_requests')
    expect(result).toEqual([{ id: 'r1', employee_id: 'emp-1', full_name: 'Priya Sharma', status: 'pending_admin', created_at: '2026-07-01T09:00:00Z' }])
  })

  it('returns empty array when data is null', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    })
    expect(await getPendingRegularizationsForHR()).toEqual([])
  })

  it('throws on Supabase error', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        }),
      }),
    })
    await expect(getPendingRegularizationsForHR()).rejects.toThrow('DB error')
  })
})

// ── getPendingTransfersForHR ──────────────────────────────────────────────────
describe('getPendingTransfersForHR', () => {
  it('returns mapped records with manager name', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [{ id: 't1', employee_id: 'emp-1', status: 'pending_hr', created_at: '2026-07-01T09:00:00Z', employee: { full_name: 'Ravi Kumar' }, to_manager: { full_name: 'Neha Patel' } }],
            error: null,
          }),
        }),
      }),
    })
    const result = await getPendingTransfersForHR()
    expect(supabase.from).toHaveBeenCalledWith('manager_transfer_requests')
    expect(result[0]).toMatchObject({ id: 't1', full_name: 'Ravi Kumar', to_manager_name: 'Neha Patel' })
  })

  it('returns empty array when data is null', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    })
    expect(await getPendingTransfersForHR()).toEqual([])
  })

  it('throws on Supabase error', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        }),
      }),
    })
    await expect(getPendingTransfersForHR()).rejects.toThrow('DB error')
  })
})

// ── getExpiringCertificationsForHR ────────────────────────────────────────────
describe('getExpiringCertificationsForHR', () => {
  it('returns mapped certification records', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'c1', employee_id: 'emp-1', title: 'Passport', expiry_date: '2026-07-20', employee: { full_name: 'Amit Joshi' } }],
              error: null,
            }),
          }),
        }),
      }),
    })
    const result = await getExpiringCertificationsForHR()
    expect(supabase.from).toHaveBeenCalledWith('employee_certifications')
    expect(result[0]).toMatchObject({ id: 'c1', full_name: 'Amit Joshi', title: 'Passport' })
  })

  it('returns empty array when data is null', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    })
    expect(await getExpiringCertificationsForHR()).toEqual([])
  })

  it('throws on Supabase error', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      }),
    })
    await expect(getExpiringCertificationsForHR()).rejects.toThrow('DB error')
  })
})

// ── getProbationEndingSoon ────────────────────────────────────────────────────
describe('getProbationEndingSoon', () => {
  it('includes employees whose 6-month mark is within 14 days', async () => {
    // join_date 2026-01-05 → end = 2026-07-05 → days_left = 0 → included
    // join_date 2026-01-01 → end = 2026-07-01 → days_left = -4 → excluded
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: [
              { id: 'emp-1', full_name: 'Priya', employee_type: 'intern',    join_date: '2026-01-05' },
              { id: 'emp-2', full_name: 'Ravi',  employee_type: 'probation', join_date: '2026-01-01' },
            ],
            error: null,
          }),
        }),
      }),
    })
    const result = await getProbationEndingSoon()
    expect(result.some(e => e.id === 'emp-1')).toBe(true)
    expect(result.some(e => e.id === 'emp-2')).toBe(false)
  })

  it('returns empty array when no active interns/probationers', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    })
    expect(await getProbationEndingSoon()).toEqual([])
  })

  it('throws on Supabase error', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        }),
      }),
    })
    await expect(getProbationEndingSoon()).rejects.toThrow('DB error')
  })
})

// ── getMyUnregularizedSessions ────────────────────────────────────────────────
describe('getMyUnregularizedSessions', () => {
  it('returns open sessions for the employee', async () => {
    const raw = [{ id: 's1', date: '2026-07-03', check_in: '2026-07-03T09:00:00Z' }]
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            lt: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: raw, error: null }),
              }),
            }),
          }),
        }),
      }),
    })
    const result = await getMyUnregularizedSessions('emp-1')
    expect(supabase.from).toHaveBeenCalledWith('attendance_sessions')
    expect(result).toEqual(raw)
  })

  it('returns empty array when data is null', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            lt: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
    })
    expect(await getMyUnregularizedSessions('emp-1')).toEqual([])
  })

  it('throws on Supabase error', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            lt: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
              }),
            }),
          }),
        }),
      }),
    })
    await expect(getMyUnregularizedSessions('emp-1')).rejects.toThrow('DB error')
  })
})

// ── getMyExpiringCertifications ───────────────────────────────────────────────
describe('getMyExpiringCertifications', () => {
  it('returns certifications expiring within 30 days', async () => {
    const raw = [{ id: 'c1', title: 'Passport', expiry_date: '2026-07-20' }]
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            lte: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: raw, error: null }),
            }),
          }),
        }),
      }),
    })
    const result = await getMyExpiringCertifications('emp-1')
    expect(supabase.from).toHaveBeenCalledWith('employee_certifications')
    expect(result).toEqual(raw)
  })

  it('returns empty array when data is null', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            lte: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      }),
    })
    expect(await getMyExpiringCertifications('emp-1')).toEqual([])
  })

  it('throws on Supabase error', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            lte: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
            }),
          }),
        }),
      }),
    })
    await expect(getMyExpiringCertifications('emp-1')).rejects.toThrow('DB error')
  })
})
