import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabase } from '../lib/supabase'
import { createNotification } from '../lib/api.notifications'
import {
  requestTransfer,
  getSentTransferRequests,
  withdrawTransferRequest,
  getIncomingTransferRequests,
  targetDecideTransfer,
  getPendingHRTransferRequests,
  hrDecideTransfer,
} from '../lib/api.managerTransfers'

vi.mock('../lib/api.notifications', () => ({
  createNotification: vi.fn(() => Promise.resolve({})),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

// ── requestTransfer ───────────────────────────────────────────────────────────
describe('requestTransfer', () => {
  it('throws when required fields are missing', async () => {
    await expect(requestTransfer({ employeeId: '', fromManagerId: 'mgr-1', toManagerId: 'mgr-2' }))
      .rejects.toThrow(/required/i)
  })

  it('throws when target manager is the same as current manager', async () => {
    await expect(requestTransfer({ employeeId: 'emp-1', fromManagerId: 'mgr-1', toManagerId: 'mgr-1' }))
      .rejects.toThrow(/different from the current manager/i)
  })

  it('throws when the employee is not actually a direct report of fromManagerId', async () => {
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'emp-1', full_name: 'Jane Doe', manager_id: 'mgr-99' }, error: null }),
    })

    await expect(requestTransfer({ employeeId: 'emp-1', fromManagerId: 'mgr-1', toManagerId: 'mgr-2' }))
      .rejects.toThrow(/no longer your direct report/i)
  })

  it('throws when the employee already has a non-terminal transfer request', async () => {
    supabase.from
      .mockReturnValueOnce({
        // fetch employee
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'emp-1', full_name: 'Jane Doe', manager_id: 'mgr-1' }, error: null }),
      })
      .mockReturnValueOnce({
        // fetch existing non-terminal requests
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: [{ id: 'req-existing' }], error: null }),
      })

    await expect(requestTransfer({ employeeId: 'emp-1', fromManagerId: 'mgr-1', toManagerId: 'mgr-2' }))
      .rejects.toThrow(/already has a pending transfer request/i)
  })

  it('inserts the request and notifies the target manager', async () => {
    const mockEmployee = { id: 'emp-1', full_name: 'Jane Doe', manager_id: 'mgr-1' }
    const mockRequest = { id: 'req-1', employee_id: 'emp-1', from_manager_id: 'mgr-1', to_manager_id: 'mgr-2', status: 'pending_target' }

    supabase.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockEmployee, error: null }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      })
      .mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockRequest, error: null }),
      })

    const result = await requestTransfer({ employeeId: 'emp-1', fromManagerId: 'mgr-1', toManagerId: 'mgr-2', reason: 'Better fit' })

    expect(result).toEqual(mockRequest)
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'mgr-2',
      type: 'manager_transfer_requested',
    }))
  })
})

// ── getSentTransferRequests ───────────────────────────────────────────────────
describe('getSentTransferRequests', () => {
  it('queries by from_manager_id', async () => {
    const orderMock = vi.fn().mockResolvedValue({ data: [{ id: 'req-1' }], error: null })
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: orderMock,
    })

    const result = await getSentTransferRequests('mgr-1')
    expect(result).toEqual([{ id: 'req-1' }])
    expect(supabase.from).toHaveBeenCalledWith('manager_transfer_requests')
  })
})

// ── withdrawTransferRequest ───────────────────────────────────────────────────
describe('withdrawTransferRequest', () => {
  it('throws if the request is already in a terminal state', async () => {
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'req-1', status: 'approved' }, error: null }),
    })

    await expect(withdrawTransferRequest('req-1', 'mgr-1')).rejects.toThrow(/already been decided/i)
  })

  it('sets status to withdrawn when non-terminal', async () => {
    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })
    supabase.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'req-1', status: 'pending_target' }, error: null }),
      })
      .mockReturnValueOnce({
        update: vi.fn().mockImplementation(payload => {
          expect(payload).toEqual({ status: 'withdrawn' })
          return { eq: updateEq }
        }),
      })

    await withdrawTransferRequest('req-1', 'mgr-1')
    expect(updateEq).toHaveBeenCalledWith('id', 'req-1')
  })
})

// ── getIncomingTransferRequests ───────────────────────────────────────────────
describe('getIncomingTransferRequests', () => {
  it('queries by to_manager_id and pending_target status', async () => {
    const eqCalls = []
    const eqMock = vi.fn().mockImplementation((col, val) => { eqCalls.push([col, val]); return chain })
    const orderMock = vi.fn().mockResolvedValue({ data: [{ id: 'req-1' }], error: null })
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: eqMock,
      order: orderMock,
    }
    supabase.from.mockReturnValueOnce(chain)

    const result = await getIncomingTransferRequests('mgr-2')
    expect(result).toEqual([{ id: 'req-1' }])
    expect(eqCalls).toEqual([['to_manager_id', 'mgr-2'], ['status', 'pending_target']])
  })
})

// ── targetDecideTransfer ───────────────────────────────────────────────────────
describe('targetDecideTransfer', () => {
  it('throws on an invalid decision value', async () => {
    await expect(targetDecideTransfer('req-1', 'maybe', 'mgr-2')).rejects.toThrow(/invalid decision/i)
  })

  it('throws if the request is not pending_target', async () => {
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'req-1', status: 'pending_hr', employee: { full_name: 'Jane Doe' } }, error: null }),
    })

    await expect(targetDecideTransfer('req-1', 'accepted', 'mgr-2')).rejects.toThrow(/no longer awaiting your decision/i)
  })

  it('on accept, sets status to pending_hr and broadcasts to every active HR/Admin', async () => {
    const mockRequest = { id: 'req-1', status: 'pending_target', from_manager_id: 'mgr-1', employee: { full_name: 'Jane Doe' } }
    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })
    let insertedRows = null

    supabase.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockRequest, error: null }),
      })
      .mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: updateEq,
      })
      .mockReturnValueOnce({
        insert: vi.fn().mockImplementation(rows => { insertedRows = rows; return Promise.resolve({ data: null, error: null }) }),
      })

    supabase.rpc.mockResolvedValueOnce({ data: [{ id: 'hr-1' }, { id: 'hr-2' }], error: null })

    await targetDecideTransfer('req-1', 'accepted', 'mgr-2')

    expect(supabase.rpc).toHaveBeenCalledWith('get_hr_admin_employee_ids')
    expect(insertedRows).toHaveLength(2)
    expect(insertedRows.map(r => r.employee_id).sort()).toEqual(['hr-1', 'hr-2'])
    expect(insertedRows.every(r => r.type === 'manager_transfer_pending_hr')).toBe(true)
  })

  it('on reject, sets status to rejected_by_target and notifies the initiating manager only', async () => {
    const mockRequest = { id: 'req-1', status: 'pending_target', from_manager_id: 'mgr-1', employee: { full_name: 'Jane Doe' } }
    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })

    supabase.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockRequest, error: null }),
      })
      .mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: updateEq,
      })

    await targetDecideTransfer('req-1', 'rejected', 'mgr-2')

    expect(createNotification).toHaveBeenCalledTimes(1)
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'mgr-1',
      type: 'manager_transfer_decided',
    }))
  })
})

// ── getPendingHRTransferRequests ──────────────────────────────────────────────
describe('getPendingHRTransferRequests', () => {
  it('queries by pending_hr status', async () => {
    const eqMock = vi.fn().mockReturnThis()
    const orderMock = vi.fn().mockResolvedValue({ data: [{ id: 'req-1' }], error: null })
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: eqMock,
      order: orderMock,
    })

    const result = await getPendingHRTransferRequests()
    expect(result).toEqual([{ id: 'req-1' }])
    expect(eqMock).toHaveBeenCalledWith('status', 'pending_hr')
    expect(eqMock).toHaveBeenCalledTimes(1)
  })
})

// ── hrDecideTransfer ───────────────────────────────────────────────────────────
describe('hrDecideTransfer', () => {
  it('throws on an invalid decision value', async () => {
    await expect(hrDecideTransfer('req-1', 'maybe', 'hr-1')).rejects.toThrow(/invalid decision/i)
  })

  it('throws if the request is not pending_hr', async () => {
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'req-1', status: 'pending_target', employee: { full_name: 'Jane Doe' } }, error: null }),
    })

    await expect(hrDecideTransfer('req-1', 'approved', 'hr-1')).rejects.toThrow(/not awaiting HR approval/i)
  })

  it('on approve, updates employees.manager_id to to_manager_id and notifies the employee', async () => {
    const mockRequest = {
      id: 'req-1', status: 'pending_hr', employee_id: 'emp-1',
      from_manager_id: 'mgr-1', to_manager_id: 'mgr-2',
      employee: { full_name: 'Jane Doe' },
    }
    const employeesUpdateEq = vi.fn().mockResolvedValue({ data: null, error: null })
    const requestUpdateEq = vi.fn().mockResolvedValue({ data: null, error: null })

    supabase.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockRequest, error: null }),
      })
      .mockReturnValueOnce({
        // employees.manager_id update
        update: vi.fn().mockImplementation(payload => {
          expect(payload).toEqual({ manager_id: 'mgr-2' })
          return { eq: employeesUpdateEq }
        }),
      })
      .mockReturnValueOnce({
        // manager_transfer_requests status update
        update: vi.fn().mockImplementation(payload => {
          expect(payload.status).toBe('approved')
          expect(payload.hr_decided_by).toBe('hr-1')
          return { eq: requestUpdateEq }
        }),
      })

    await hrDecideTransfer('req-1', 'approved', 'hr-1')

    expect(employeesUpdateEq).toHaveBeenCalledWith('id', 'emp-1')
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'emp-1',
      type: 'manager_transfer_decided',
    }))
  })

  it('on reject, does not touch employees.manager_id and notifies the initiating manager only', async () => {
    const mockRequest = {
      id: 'req-1', status: 'pending_hr', employee_id: 'emp-1',
      from_manager_id: 'mgr-1', to_manager_id: 'mgr-2',
      employee: { full_name: 'Jane Doe' },
    }
    const requestUpdateEq = vi.fn().mockResolvedValue({ data: null, error: null })

    supabase.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockRequest, error: null }),
      })
      .mockReturnValueOnce({
        update: vi.fn().mockImplementation(payload => {
          expect(payload.status).toBe('rejected_by_hr')
          return { eq: requestUpdateEq }
        }),
      })

    await hrDecideTransfer('req-1', 'rejected', 'hr-1')

    // Only ONE supabase.from call for the update path (the request itself) —
    // no second call to the employees table.
    expect(supabase.from).toHaveBeenCalledTimes(2)
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'mgr-1',
      type: 'manager_transfer_decided',
    }))
  })
})
