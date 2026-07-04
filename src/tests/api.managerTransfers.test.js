import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabase } from '../lib/supabase'
import { createNotification } from '../lib/api.notifications'
import {
  requestTransfer,
  getSentTransferRequests,
  withdrawTransferRequest,
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
