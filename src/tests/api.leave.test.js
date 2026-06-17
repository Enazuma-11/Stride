import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabase } from '../lib/supabase'
import {
  getMyLeaveBalances,
  getMyLeaveRequests,
  applyLeave,
  updateLeaveStatus,
  hrAdjustLeave,
  hrSetLeaveBalance,
  hrRecordLeave,
} from '../lib/api'

// Helper to create chainable Supabase mock
function mockChain(finalResult) {
  const chain = {
    select:      vi.fn().mockReturnThis(),
    insert:      vi.fn().mockReturnThis(),
    update:      vi.fn().mockReturnThis(),
    upsert:      vi.fn().mockReturnThis(),
    delete:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    in:          vi.fn().mockReturnThis(),
    order:       vi.fn().mockReturnThis(),
    limit:       vi.fn().mockReturnThis(),
    single:      vi.fn().mockResolvedValue(finalResult),
    maybeSingle: vi.fn().mockResolvedValue(finalResult),
  }
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── getMyLeaveBalances ────────────────────────────────────────────────────────
describe('getMyLeaveBalances', () => {
  it('returns leave balances for an employee', async () => {
    const mockBalances = [
      { id: '1', employee_id: 'emp1', leave_type: 'earned', total_days: 18, used_days: 2, year: 2026 },
      { id: '2', employee_id: 'emp1', leave_type: 'casual_sick', total_days: 12, used_days: 0, year: 2026 },
    ]
    const chain = mockChain(null)
    chain.eq = vi.fn().mockReturnThis()
    Object.assign(chain, { data: mockBalances, error: null })

    supabase.from.mockReturnValue({
      ...chain,
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: mockBalances, error: null }),
        }),
      }),
    })

    const result = await getMyLeaveBalances('emp1')
    expect(supabase.from).toHaveBeenCalledWith('leave_balances')
    expect(result).toEqual(mockBalances)
  })

  it('throws on Supabase error', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        }),
      }),
    })
    await expect(getMyLeaveBalances('emp1')).rejects.toThrow('DB error')
  })
})

// ── applyLeave ────────────────────────────────────────────────────────────────
describe('applyLeave', () => {
  const leaveData = {
    employeeId: 'emp1',
    leaveType:  'earned',
    fromDate:   '2026-07-15',
    toDate:     '2026-07-17',
    days:       3,
    reason:     'Family vacation',
  }

  it('inserts a leave request with pending status', async () => {
    const mockLeave = { id: 'leave1', ...leaveData, status: 'pending' }
    supabase.from.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockLeave, error: null }),
        }),
      }),
    })

    const result = await applyLeave(leaveData)
    expect(supabase.from).toHaveBeenCalledWith('leave_requests')
    expect(result.status).toBe('pending')
  })

  it('throws when insertion fails', async () => {
    supabase.from.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Insert failed' } }),
        }),
      }),
    })
    await expect(applyLeave(leaveData)).rejects.toThrow('Insert failed')
  })
})

// ── updateLeaveStatus ─────────────────────────────────────────────────────────
describe('updateLeaveStatus', () => {
  it('updates status to approved', async () => {
    const mockLeave = {
      id: 'leave1', employee_id: 'emp1',
      leave_type: 'earned', days: 3,
      from_date: '2026-07-15', status: 'approved',
    }
    supabase.from.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockLeave, error: null }),
          }),
        }),
      }),
    })
    supabase.rpc.mockResolvedValue({ data: null, error: null })

    const result = await updateLeaveStatus('leave1', 'approved', 'hr1')
    expect(result.status).toBe('approved')
    // Should call RPC to deduct balance when approved
    expect(supabase.rpc).toHaveBeenCalledWith('deduct_leave_balance', expect.any(Object))
  })

  it('does NOT call deduct_leave_balance when rejected', async () => {
    const mockLeave = {
      id: 'leave1', employee_id: 'emp1',
      leave_type: 'earned', days: 3,
      from_date: '2026-07-15', status: 'rejected',
    }
    supabase.from.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockLeave, error: null }),
          }),
        }),
      }),
    })

    await updateLeaveStatus('leave1', 'rejected', 'hr1')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})

// ── hrAdjustLeave ─────────────────────────────────────────────────────────────
describe('hrAdjustLeave', () => {
  it('increases leave balance by adjustment amount', async () => {
    const existing = { id: 'bal1', total_days: 18, used_days: 2 }
    const updated  = { id: 'bal1', total_days: 21, used_days: 2 }

    supabase.from
      .mockReturnValueOnce({
        // First call: fetch existing balance
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        // Second call: update balance
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: updated, error: null }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        // Third call: log adjustment
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      })

    const result = await hrAdjustLeave('emp1', 'earned', 3, 'Annual top-up', 'hr1')
    expect(result.total_days).toBe(21)
  })

  it('never sets balance below zero', async () => {
    const existing = { id: 'bal1', total_days: 2, used_days: 0 }

    supabase.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        update: vi.fn().mockImplementation(updateData => {
          // Verify total_days is not negative
          expect(updateData.total_days).toBeGreaterThanOrEqual(0)
          return {
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { ...existing, total_days: 0 }, error: null }),
              }),
            }),
          }
        }),
      })
      .mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      })

    await hrAdjustLeave('emp1', 'earned', -10, 'Correction', 'hr1')
  })
})

// ── hrSetLeaveBalance ─────────────────────────────────────────────────────────
describe('hrSetLeaveBalance', () => {
  it('sets balance to exact amount', async () => {
    const existing = { id: 'bal1', total_days: 18, used_days: 5 }
    const updated  = { id: 'bal1', total_days: 20, used_days: 5 }

    supabase.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: updated, error: null }),
          }),
        }),
      })
      .mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      })

    const result = await hrSetLeaveBalance('emp1', 'earned', 20, 'Reset', 'hr1')
    expect(result.total_days).toBe(20)
  })
})

// ── hrRecordLeave ─────────────────────────────────────────────────────────────
describe('hrRecordLeave', () => {
  const recordData = {
    employeeId: 'emp1',
    leaveType:  'casual_sick',
    fromDate:   '2026-06-16',
    toDate:     '2026-06-17',
    days:       2,
    reason:     'Cousin Wedding',
    recordedBy: 'hr1',
  }

  it('creates leave request with approved status', async () => {
    const mockLeave = { id: 'leave1', ...recordData, status: 'approved' }
    const mockBal   = { id: 'bal1', used_days: 2, total_days: 12 }

    supabase.from
      .mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockLeave, error: null }),
          }),
        }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: mockBal, error: null }),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      })

    const result = await hrRecordLeave(recordData)
    expect(result.status).toBe('approved')
    expect(supabase.from).toHaveBeenCalledWith('leave_requests')
  })

  it('appends (Recorded by HR) to reason', async () => {
    const mockLeave = { id: 'leave1', reason: 'Cousin Wedding (Recorded by HR)', status: 'approved' }

    supabase.from
      .mockReturnValueOnce({
        insert: vi.fn().mockImplementation(data => {
          expect(data.reason).toContain('(Recorded by HR)')
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockLeave, error: null }),
            }),
          }
        }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      })

    await hrRecordLeave(recordData)
  })
})
