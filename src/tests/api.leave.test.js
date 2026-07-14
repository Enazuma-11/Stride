import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabase } from '../lib/supabase'
import {
  getMyLeaveBalances,
  getMyLeaveRequests,
  applyLeave,
  updateLeaveStatus,
  cancelLeave,
  hrAdjustLeave,
  hrSetLeaveBalance,
  hrRecordLeave,
} from '../lib/api'
import { broadcastNotification } from '../lib/api.notifications'

vi.mock('../lib/api.notifications', () => ({
  broadcastNotification: vi.fn(() => Promise.resolve()),
}))

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
    // isUnpaid defaults to false, so applyLeave queries leave_balances before
    // inserting — this mock must satisfy both the balance-check chain and
    // the leave_requests insert chain since it's a single universal handler.
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'bal-1', total_days: 12, used_days: 0 }, // 12 remaining, request is 3 days
        error: null,
      }),
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
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'bal-1', total_days: 12, used_days: 0 }, // sufficient balance so the insert path is reached
        error: null,
      }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Insert failed' } }),
        }),
      }),
    })
    await expect(applyLeave(leaveData)).rejects.toThrow('Insert failed')
  })

  it('looks up HR/Admin recipients via RPC (not a direct table query, since RLS would silently return zero rows for a regular employee session) and notifies each', async () => {
    const mockLeave = { id: 'leave1', ...leaveData, status: 'pending' }
    const hrAdmins = [{ id: 'hr-1' }, { id: 'admin-1' }]
    let notificationRows

    supabase.from.mockImplementation(table => {
      if (table === 'leave_balances') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'bal-1', total_days: 12, used_days: 0 }, // sufficient balance
            error: null,
          }),
        }
      }
      if (table === 'leave_requests') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockLeave, error: null }),
            }),
          }),
        }
      }
      if (table === 'notifications') {
        return {
          insert: vi.fn().mockImplementation(rows => {
            notificationRows = rows
            return Promise.resolve({ data: null, error: null })
          }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })
    supabase.rpc.mockResolvedValueOnce({ data: hrAdmins, error: null })

    await applyLeave(leaveData)

    expect(supabase.rpc).toHaveBeenCalledWith('get_hr_admin_employee_ids', { exclude_id: 'emp1' })
    expect(notificationRows).toHaveLength(2)
    expect(notificationRows.map(r => r.employee_id)).toEqual(['hr-1', 'admin-1'])
    expect(notificationRows[0].type).toBe('leave_request')
  })

  it('when isUnpaid is true, does NOT block on balance but inserts with unpaid_days = days, paid_days = 0, and increments leave_balances.unpaid_days_taken by days', async () => {
    const mockLeave = { id: 'leave-unpaid', ...leaveData, status: 'pending' }
    let insertedRow
    let balUpdatePayload

    supabase.from.mockImplementation(table => {
      if (table === 'leave_balances') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'bal-1', total_days: 12, used_days: 0, unpaid_days_taken: 1 },
            error: null,
          }),
          update: vi.fn().mockImplementation(payload => {
            balUpdatePayload = payload
            return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
          }),
        }
      }
      if (table === 'leave_requests') {
        return {
          insert: vi.fn().mockImplementation(row => {
            insertedRow = row
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: mockLeave, error: null }),
              }),
            }
          }),
        }
      }
      if (table === 'notifications') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    })
    supabase.rpc.mockResolvedValueOnce({ data: [], error: null })

    await applyLeave({ ...leaveData, isUnpaid: true })

    expect(insertedRow.unpaid_days).toBe(leaveData.days)
    expect(insertedRow.paid_days).toBe(0)
    // Balance IS touched for an unpaid request now — but only to WRITE
    // (increment unpaid_days_taken), never to read-and-block.
    expect(supabase.from).toHaveBeenCalledWith('leave_balances')
    expect(balUpdatePayload.unpaid_days_taken).toBe(1 + leaveData.days)
  })

  it('when isUnpaid is false and requested days exceed remaining balance, throws and does not insert', async () => {
    supabase.from.mockImplementation(table => {
      if (table === 'leave_balances') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'bal-1', total_days: 12, used_days: 10 }, // only 2 days remaining
            error: null,
          }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    // leaveData.days is 3 (see the shared fixture below) — exceeds the 2 remaining
    await expect(applyLeave({ ...leaveData, isUnpaid: false })).rejects.toThrow(/2 day.*remaining|remaining.*2 day/i)
    expect(supabase.from).not.toHaveBeenCalledWith('leave_requests')
  })

  it('when isUnpaid is false and requested days are within remaining balance, inserts with paid_days = days, unpaid_days = 0', async () => {
    const mockLeave = { id: 'leave-paid', ...leaveData, status: 'pending' }
    let insertedRow

    supabase.from.mockImplementation(table => {
      if (table === 'leave_balances') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'bal-1', total_days: 12, used_days: 2 }, // 10 remaining, request is 3 days
            error: null,
          }),
        }
      }
      if (table === 'leave_requests') {
        return {
          insert: vi.fn().mockImplementation(row => {
            insertedRow = row
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: mockLeave, error: null }),
              }),
            }
          }),
        }
      }
      if (table === 'notifications') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    })
    supabase.rpc.mockResolvedValueOnce({ data: [], error: null })

    await applyLeave({ ...leaveData, isUnpaid: false })

    expect(insertedRow.paid_days).toBe(leaveData.days)
    expect(insertedRow.unpaid_days).toBe(0)
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
    const mockBal = { id: 'bal1', used_days: 2, total_days: 18, unpaid_days_taken: 0 }
    // Mock chain: update leave → fetch balance → update balance → update paid/unpaid → notify
    supabase.from
      .mockReturnValueOnce({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockLeave, error: null }),
            }),
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
      .mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      })

    const result = await updateLeaveStatus('leave1', 'approved', 'hr1')
    expect(result.status).toBe('approved')
  })

  it('does NOT deduct balance when rejected', async () => {
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
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    })

    await updateLeaveStatus('leave1', 'rejected', 'hr1')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('on approval, still deducts used_days from balance (paid-request path unaffected by removing auto-split)', async () => {
    const mockLeave = { id: 'leave-1', employee_id: 'emp-1', leave_type: 'casual_sick', from_date: '2026-07-15', to_date: '2026-07-15', days: 1, paid_days: 1, unpaid_days: 0, status: 'approved' }
    let balUpdatePayload

    supabase.from.mockImplementation(table => {
      if (table === 'leave_requests') {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockLeave, error: null }),
        }
      }
      if (table === 'leave_balances') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'bal-1', used_days: 2 }, error: null }),
          update: vi.fn().mockImplementation(payload => { balUpdatePayload = payload; return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) } }),
        }
      }
      if (table === 'notifications') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    supabase.rpc.mockResolvedValue({ error: null })
    await updateLeaveStatus('leave-1', 'approved', 'reviewer-1')

    // Balance is now adjusted atomically via the RPC — used_days is incremented
    // by paid_days (1), not read-then-written.
    void balUpdatePayload
    expect(supabase.rpc).toHaveBeenCalledWith('apply_leave_balance_delta', {
      p_employee_id: 'emp-1', p_leave_type: 'casual_sick', p_year: 2026,
      p_used_delta: 1, p_unpaid_delta: 0,
    })
  })

  it('on approval of an unpaid request (paid_days: 0), used_days is left unchanged — approval is a genuine no-op on balance', async () => {
    const mockLeave = { id: 'leave-1', employee_id: 'emp-1', leave_type: 'casual_sick', from_date: '2026-07-15', to_date: '2026-07-16', days: 2, status: 'approved', paid_days: 0, unpaid_days: 2 }
    let balUpdatePayload

    supabase.from.mockImplementation(table => {
      if (table === 'leave_requests') {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockLeave, error: null }),
        }
      }
      if (table === 'leave_balances') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'bal-1', used_days: 2 }, error: null }),
          update: vi.fn().mockImplementation(payload => { balUpdatePayload = payload; return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) } }),
        }
      }
      if (table === 'notifications') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    supabase.rpc.mockResolvedValue({ error: null })
    await updateLeaveStatus('leave-1', 'approved', 'reviewer-1')

    // paid_days is 0 for an all-unpaid request, so the atomic adjustment
    // increments used_days by 0 — approval is a genuine no-op on balance.
    void balUpdatePayload
    expect(supabase.rpc).toHaveBeenCalledWith('apply_leave_balance_delta', {
      p_employee_id: 'emp-1', p_leave_type: 'casual_sick', p_year: 2026,
      p_used_delta: 0, p_unpaid_delta: 0,
    })
  })

  it('does not write to leave_requests.paid_days/unpaid_days on approval (that was already decided at apply time)', async () => {
    const mockLeave = { id: 'leave-1', employee_id: 'emp-1', leave_type: 'casual_sick', from_date: '2026-07-15', to_date: '2026-07-15', days: 1, status: 'approved' }
    const leaveRequestsUpdateCalls = []

    supabase.from.mockImplementation(table => {
      if (table === 'leave_requests') {
        return {
          update: vi.fn().mockImplementation(payload => { leaveRequestsUpdateCalls.push(payload); return {
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockLeave, error: null }),
          }}),
        }
      }
      if (table === 'leave_balances') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'bal-1', used_days: 0 }, error: null }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
        }
      }
      if (table === 'notifications') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    await updateLeaveStatus('leave-1', 'approved', 'reviewer-1')

    // Only one update call to leave_requests (status/reviewed_by/reviewed_at)
    // — no second update writing paid_days/unpaid_days.
    expect(leaveRequestsUpdateCalls).toHaveLength(1)
    expect(leaveRequestsUpdateCalls[0]).not.toHaveProperty('paid_days')
    expect(leaveRequestsUpdateCalls[0]).not.toHaveProperty('unpaid_days')
  })

  it('on approval, broadcasts a company-wide notification with the employee name and dates, no leave type or reason', async () => {
    const mockLeave = { id: 'leave-1', employee_id: 'emp-1', leave_type: 'casual_sick', from_date: '2026-07-15', to_date: '2026-07-16', days: 2, status: 'approved' }

    // Need the employee's name for the broadcast message — updateLeaveStatus
    // must fetch it via a join (mockLeave doesn't include full_name by default).
    supabase.from.mockImplementation(table => {
      if (table === 'leave_requests') {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { ...mockLeave, employee: { full_name: 'Jane Doe' } }, error: null }),
        }
      }
      if (table === 'leave_balances') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'bal-1', used_days: 0 }, error: null }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
        }
      }
      if (table === 'notifications') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    await updateLeaveStatus('leave-1', 'approved', 'reviewer-1')

    expect(broadcastNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'leave_approved_team',
      message: expect.stringContaining('Jane Doe'),
    }))
    expect(broadcastNotification).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('2026-07-15'),
    }))
    // Must not leak leave type or reason into the broadcast message
    const call = vi.mocked(broadcastNotification).mock.calls.find(([arg]) => arg.type === 'leave_approved_team')
    expect(call[0].message).not.toContain('casual_sick')
  })

  it('on rejection, does not call broadcastNotification', async () => {
    const mockLeave = { id: 'leave-1', employee_id: 'emp-1', leave_type: 'casual_sick', from_date: '2026-07-15', to_date: '2026-07-15', days: 1, status: 'rejected' }

    supabase.from.mockImplementation(table => {
      if (table === 'leave_requests') {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockLeave, error: null }),
        }
      }
      if (table === 'notifications') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    await updateLeaveStatus('leave-1', 'rejected', 'reviewer-1')

    expect(broadcastNotification).not.toHaveBeenCalled()
  })
})

// ── cancelLeave ───────────────────────────────────────────────────────────────
describe('cancelLeave', () => {
  it('when cancelling an approved leave that had unpaid_days > 0, reverses unpaid_days_taken (not used_days) for that portion', async () => {
    const mockLeave = { id: 'leave-1', employee_id: 'emp-1', leave_type: 'casual_sick', from_date: '2026-07-15', to_date: '2026-07-16', days: 2, status: 'approved', unpaid_days: 2, paid_days: 0 }
    let balUpdatePayload

    supabase.from.mockImplementation(table => {
      if (table === 'leave_requests') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockLeave, error: null }),
          delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
        }
      }
      if (table === 'leave_balances') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'bal-1', used_days: 5, unpaid_days_taken: 2 }, error: null }),
          update: vi.fn().mockImplementation(payload => { balUpdatePayload = payload; return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) } }),
        }
      }
      if (table === 'notifications') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    supabase.rpc.mockResolvedValue({ error: null })
    await cancelLeave('leave-1', 'emp-1')

    // Reversal is atomic: used_days is untouched (paid_days 0 → delta 0) and
    // unpaid_days_taken is reduced by unpaid_days (2).
    void balUpdatePayload
    expect(supabase.rpc).toHaveBeenCalledWith('apply_leave_balance_delta', {
      p_employee_id: 'emp-1', p_leave_type: 'casual_sick', p_year: 2026,
      p_used_delta: 0, p_unpaid_delta: -2,
    })
  })

  it('when cancelling an approved leave that had paid_days > 0, reverses used_days as before (unaffected by the unpaid-reversal logic)', async () => {
    const mockLeave = { id: 'leave-1', employee_id: 'emp-1', leave_type: 'casual_sick', from_date: '2026-07-15', to_date: '2026-07-16', days: 2, status: 'approved', unpaid_days: 0, paid_days: 2 }
    let balUpdatePayload

    supabase.from.mockImplementation(table => {
      if (table === 'leave_requests') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockLeave, error: null }),
          delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
        }
      }
      if (table === 'leave_balances') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'bal-1', used_days: 5, unpaid_days_taken: 0 }, error: null }),
          update: vi.fn().mockImplementation(payload => { balUpdatePayload = payload; return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) } }),
        }
      }
      if (table === 'notifications') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    supabase.rpc.mockResolvedValue({ error: null })
    await cancelLeave('leave-1', 'emp-1')

    // used_days reversed by paid_days (2); unpaid_days_taken unchanged (delta 0).
    void balUpdatePayload
    expect(supabase.rpc).toHaveBeenCalledWith('apply_leave_balance_delta', {
      p_employee_id: 'emp-1', p_leave_type: 'casual_sick', p_year: 2026,
      p_used_delta: -2, p_unpaid_delta: 0,
    })
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
