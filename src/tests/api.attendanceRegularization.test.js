import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabase } from '../lib/supabase'
import { createNotification } from '../lib/api.notifications'
import {
  submitRegularizationRequest,
  getMyRegularizationRequests,
  withdrawRegularizationRequest,
} from '../lib/api.attendanceRegularization'

vi.mock('../lib/api.notifications', () => ({
  createNotification: vi.fn(() => Promise.resolve({})),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const validItems = [
  { date: '2026-06-17', proposedCheckIn: '09:00', proposedCheckOut: '18:00', reason: 'Forgot to check out' },
]

// ── submitRegularizationRequest ──────────────────────────────────────────────
describe('submitRegularizationRequest', () => {
  it('throws when items array is empty', async () => {
    await expect(submitRegularizationRequest('emp-1', [])).rejects.toThrow(/at least one date/i)
  })

  it('throws when items is missing entirely', async () => {
    await expect(submitRegularizationRequest('emp-1', undefined)).rejects.toThrow(/at least one date/i)
  })

  it('throws when an item is missing a date', async () => {
    await expect(submitRegularizationRequest('emp-1', [
      { proposedCheckIn: '09:00', proposedCheckOut: '18:00', reason: 'Reason' },
    ])).rejects.toThrow(/date/i)
  })

  it('throws when an item is missing proposedCheckIn', async () => {
    await expect(submitRegularizationRequest('emp-1', [
      { date: '2026-06-17', proposedCheckOut: '18:00', reason: 'Reason' },
    ])).rejects.toThrow(/check-in and check-out/i)
  })

  it('throws when an item is missing proposedCheckOut', async () => {
    await expect(submitRegularizationRequest('emp-1', [
      { date: '2026-06-17', proposedCheckIn: '09:00', reason: 'Reason' },
    ])).rejects.toThrow(/check-in and check-out/i)
  })

  it('throws when an item is missing a reason', async () => {
    await expect(submitRegularizationRequest('emp-1', [
      { date: '2026-06-17', proposedCheckIn: '09:00', proposedCheckOut: '18:00', reason: '' },
    ])).rejects.toThrow(/reason/i)
  })

  it('throws when an item reason is only whitespace', async () => {
    await expect(submitRegularizationRequest('emp-1', [
      { date: '2026-06-17', proposedCheckIn: '09:00', proposedCheckOut: '18:00', reason: '   ' },
    ])).rejects.toThrow(/reason/i)
  })

  it('does not write to the DB when validation fails', async () => {
    await expect(submitRegularizationRequest('emp-1', [])).rejects.toThrow()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('inserts request + items and notifies the manager when manager_id is present', async () => {
    const mockRequest = { id: 'req-1' }
    const mockEmployee = { full_name: 'Jane Doe', manager_id: 'mgr-1' }

    supabase.from
      .mockReturnValueOnce({
        // insert request
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockRequest, error: null }),
      })
      .mockReturnValueOnce({
        // insert items
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      })
      .mockReturnValueOnce({
        // fetch employee
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockEmployee, error: null }),
      })

    const result = await submitRegularizationRequest('emp-1', validItems)

    expect(result).toEqual(mockRequest)
    expect(supabase.from).toHaveBeenCalledWith('attendance_regularization_requests')
    expect(supabase.from).toHaveBeenCalledWith('attendance_regularization_items')
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'mgr-1',
      type: 'attendance_regularization_submitted',
    }))
  })

  it('falls back to notifying HR/Admin when employee has no manager_id, excluding self', async () => {
    const mockRequest = { id: 'req-2' }
    const mockEmployee = { full_name: 'HR Person', manager_id: null }
    const hrList = [{ id: 'hr-1' }]

    supabase.from
      .mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockRequest, error: null }),
      })
      .mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockEmployee, error: null }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: hrList, error: null }),
      })

    await submitRegularizationRequest('emp-1', validItems)

    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'hr-1',
      type: 'attendance_regularization_submitted',
    }))
  })

  it('throws when the request insert fails', async () => {
    supabase.from.mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Insert failed' } }),
    })

    await expect(submitRegularizationRequest('emp-1', validItems)).rejects.toThrow('Insert failed')
  })
})

// ── getMyRegularizationRequests ──────────────────────────────────────────────
describe('getMyRegularizationRequests', () => {
  it('returns requests with nested items for the employee', async () => {
    const mockRequests = [
      { id: 'req-1', employee_id: 'emp-1', status: 'pending_manager', items: [] },
    ]
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: mockRequests, error: null }),
    })

    const result = await getMyRegularizationRequests('emp-1')
    expect(supabase.from).toHaveBeenCalledWith('attendance_regularization_requests')
    expect(result).toEqual(mockRequests)
  })

  it('returns an empty array when no data', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: null }),
    })

    const result = await getMyRegularizationRequests('emp-1')
    expect(result).toEqual([])
  })

  it('throws on Supabase error', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    })

    await expect(getMyRegularizationRequests('emp-1')).rejects.toThrow('DB error')
  })
})

// ── withdrawRegularizationRequest ────────────────────────────────────────────
describe('withdrawRegularizationRequest', () => {
  it('withdraws (deletes) a request that is still pending_manager', async () => {
    const mockRequest = { id: 'req-1', employee_id: 'emp-1', status: 'pending_manager' }

    supabase.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockRequest, error: null }),
      })
      .mockReturnValueOnce({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      })

    await withdrawRegularizationRequest('req-1', 'emp-1')
    expect(supabase.from).toHaveBeenCalledWith('attendance_regularization_requests')
  })

  it('throws when request status is pending_admin', async () => {
    const mockRequest = { id: 'req-1', employee_id: 'emp-1', status: 'pending_admin' }
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockRequest, error: null }),
    })

    await expect(withdrawRegularizationRequest('req-1', 'emp-1')).rejects.toThrow(/already been reviewed/i)
  })

  it('throws when request status is completed', async () => {
    const mockRequest = { id: 'req-1', employee_id: 'emp-1', status: 'completed' }
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockRequest, error: null }),
    })

    await expect(withdrawRegularizationRequest('req-1', 'emp-1')).rejects.toThrow(/already been reviewed/i)
  })

  it('throws when the request fetch errors (e.g. not found or not owned by employee)', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
    })

    await expect(withdrawRegularizationRequest('req-1', 'emp-1')).rejects.toThrow('Not found')
  })
})
