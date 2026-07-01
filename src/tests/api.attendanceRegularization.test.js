import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabase } from '../lib/supabase'
import { createNotification } from '../lib/api.notifications'
import {
  submitRegularizationRequest,
  getMyRegularizationRequests,
  withdrawRegularizationRequest,
  getManagerPendingItems,
  managerDecideItem,
  getAdminPendingItems,
  adminApplyItem,
  adminRejectItem,
} from '../lib/api.attendanceRegularization'
import { hrSetSessions } from '../lib/api.attendance'

vi.mock('../lib/api.notifications', () => ({
  createNotification: vi.fn(() => Promise.resolve({})),
}))

vi.mock('../lib/api.attendance', () => ({
  hrSetSessions: vi.fn(() => Promise.resolve({})),
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

// ── getManagerPendingItems ───────────────────────────────────────────────────
describe('getManagerPendingItems', () => {
  it('returns an empty array when the manager has no direct reports', async () => {
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    const result = await getManagerPendingItems('mgr-1')
    expect(result).toEqual([])
  })

  it('returns only pending items belonging to the manager\'s direct reports', async () => {
    const reports = [{ id: 'emp-1' }, { id: 'emp-2' }]
    const items = [
      { id: 'item-1', manager_decision: 'pending', request: { employee_id: 'emp-1' } },
      { id: 'item-2', manager_decision: 'pending', request: { employee_id: 'emp-9' } }, // not a report
    ]

    supabase.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: reports, error: null }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: items, error: null }),
      })

    const result = await getManagerPendingItems('mgr-1')
    expect(result).toEqual([items[0]])
  })

  it('throws on Supabase error fetching items', async () => {
    supabase.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [{ id: 'emp-1' }], error: null }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      })

    await expect(getManagerPendingItems('mgr-1')).rejects.toThrow('DB error')
  })
})

// ── managerDecideItem ─────────────────────────────────────────────────────────
describe('managerDecideItem', () => {
  it('rejects an invalid decision value', async () => {
    await expect(managerDecideItem('item-1', 'maybe', 'mgr-1')).rejects.toThrow(/approved.*rejected|invalid decision/i)
  })

  it('does not touch the database when the decision is invalid', async () => {
    await expect(managerDecideItem('item-1', 'maybe', 'mgr-1')).rejects.toThrow()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('approves an item, recalculates request status, and notifies HR/admin', async () => {
    const item = { id: 'item-1', date: '2026-06-17', manager_decision: 'approved', request: { id: 'req-1', employee_id: 'emp-1' } }
    const rollupItems = [{ manager_decision: 'approved', admin_decision: null }]
    const hrList = [{ id: 'hr-1' }]

    supabase.from
      .mockReturnValueOnce({
        // update item
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: item, error: null }),
      })
      .mockReturnValueOnce({
        // recalcRequestStatus: fetch items
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: rollupItems, error: null }),
      })
      .mockReturnValueOnce({
        // recalcRequestStatus: update request status
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      })
      .mockReturnValueOnce({
        // fetch hr/admin recipient
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: hrList, error: null }),
      })

    const result = await managerDecideItem('item-1', 'approved', 'mgr-1')

    expect(result).toEqual(item)
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'hr-1',
      type: 'attendance_regularization_pending_admin',
    }))
  })

  it('rejects an item, recalculates request status, and notifies the employee', async () => {
    const item = { id: 'item-1', date: '2026-06-17', manager_decision: 'rejected', request: { id: 'req-1', employee_id: 'emp-1' } }
    const rollupItems = [{ manager_decision: 'rejected', admin_decision: null }]

    supabase.from
      .mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: item, error: null }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: rollupItems, error: null }),
      })
      .mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      })

    const result = await managerDecideItem('item-1', 'rejected', 'mgr-1')

    expect(result).toEqual(item)
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'emp-1',
      type: 'attendance_regularization_decided',
      title: 'Regularization Request Rejected',
    }))
  })

  it('throws on Supabase error updating the item', async () => {
    supabase.from.mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    })

    await expect(managerDecideItem('item-1', 'approved', 'mgr-1')).rejects.toThrow('DB error')
  })
})

// ── getAdminPendingItems ──────────────────────────────────────────────────────
describe('getAdminPendingItems', () => {
  it('excludes items belonging to the excluded employee (self-approval prevention)', async () => {
    const items = [
      { id: 'item-1', request: { employee_id: 'hr-1' } }, // reviewer's own request — must be excluded
      { id: 'item-2', request: { employee_id: 'emp-2' } },
    ]
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: items, error: null }),
    })

    const result = await getAdminPendingItems('hr-1')
    expect(result).toEqual([items[1]])
    expect(result.some(i => i.request.employee_id === 'hr-1')).toBe(false)
  })

  it('returns all items when excludeEmployeeId matches none of them', async () => {
    const items = [
      { id: 'item-1', request: { employee_id: 'emp-1' } },
      { id: 'item-2', request: { employee_id: 'emp-2' } },
    ]
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: items, error: null }),
    })

    const result = await getAdminPendingItems('someone-else')
    expect(result).toEqual(items)
  })

  it('returns an empty array when there is no data', async () => {
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: null }),
    })

    const result = await getAdminPendingItems('admin-1')
    expect(result).toEqual([])
  })

  it('throws on Supabase error', async () => {
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    })

    await expect(getAdminPendingItems('admin-1')).rejects.toThrow('DB error')
  })
})

// ── adminApplyItem ────────────────────────────────────────────────────────────
describe('adminApplyItem', () => {
  it('requires finalCheckIn and finalCheckOut', async () => {
    await expect(adminApplyItem('item-1', null, null, 'admin-1')).rejects.toThrow(/check-in.*check-out|required/i)
  })

  it('requires finalCheckIn when only finalCheckOut is given', async () => {
    await expect(adminApplyItem('item-1', null, '2026-06-17T18:00:00.000Z', 'admin-1')).rejects.toThrow(/check-in.*check-out|required/i)
  })

  it('requires finalCheckOut when only finalCheckIn is given', async () => {
    await expect(adminApplyItem('item-1', '2026-06-17T09:00:00.000Z', null, 'admin-1')).rejects.toThrow(/check-in.*check-out|required/i)
  })

  it('does not touch the database when validation fails', async () => {
    await expect(adminApplyItem('item-1', null, null, 'admin-1')).rejects.toThrow()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('calls hrSetSessions with the correct argument order and applies the correction', async () => {
    const item = { id: 'item-1', date: '2026-06-17', request: { id: 'req-1', employee_id: 'emp-1' } }
    const rollupItems = [{ manager_decision: 'approved', admin_decision: 'approved' }]
    const checkIn = '2026-06-17T09:00:00.000Z'
    const checkOut = '2026-06-17T18:00:00.000Z'

    supabase.from
      .mockReturnValueOnce({
        // fetch item
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: item, error: null }),
      })
      .mockReturnValueOnce({
        // update item admin_decision
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      })
      .mockReturnValueOnce({
        // recalcRequestStatus: fetch items
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: rollupItems, error: null }),
      })
      .mockReturnValueOnce({
        // recalcRequestStatus: update request status
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      })

    const result = await adminApplyItem('item-1', checkIn, checkOut, 'admin-1')

    expect(hrSetSessions).toHaveBeenCalledWith(
      'emp-1',
      '2026-06-17',
      [{ checkIn, checkOut, isWFH: false }],
      'admin-1',
      expect.stringContaining('item-1')
    )
    expect(result).toEqual(item)
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'emp-1',
      type: 'attendance_regularization_decided',
      title: 'Attendance Corrected',
    }))
  })

  it('throws on Supabase error fetching the item', async () => {
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    })

    await expect(adminApplyItem('item-1', '2026-06-17T09:00:00.000Z', '2026-06-17T18:00:00.000Z', 'admin-1')).rejects.toThrow('DB error')
  })
})

// ── adminRejectItem ───────────────────────────────────────────────────────────
describe('adminRejectItem', () => {
  it('rejects the item, recalculates request status, and notifies the employee', async () => {
    const item = { id: 'item-1', date: '2026-06-17', request: { id: 'req-1', employee_id: 'emp-1' } }
    const rollupItems = [{ manager_decision: 'approved', admin_decision: 'rejected' }]

    supabase.from
      .mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: item, error: null }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: rollupItems, error: null }),
      })
      .mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      })

    const result = await adminRejectItem('item-1', 'admin-1')

    expect(result).toEqual(item)
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'emp-1',
      type: 'attendance_regularization_decided',
      title: 'Regularization Request Rejected',
    }))
  })

  it('throws on Supabase error', async () => {
    supabase.from.mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    })

    await expect(adminRejectItem('item-1', 'admin-1')).rejects.toThrow('DB error')
  })
})

// ── recalcRequestStatus rollup (via managerDecideItem / adminApplyItem behavior) ─
describe('request status rollup', () => {
  it('sets status to pending_manager when any item is still manager-pending', async () => {
    const item = { id: 'item-1', date: '2026-06-17', manager_decision: 'approved', request: { id: 'req-1', employee_id: 'emp-1' } }
    const rollupItems = [
      { manager_decision: 'approved', admin_decision: null },
      { manager_decision: 'pending', admin_decision: null },
    ]
    const hrList = [{ id: 'hr-1' }]
    let capturedUpdate

    supabase.from
      .mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: item, error: null }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: rollupItems, error: null }),
      })
      .mockReturnValueOnce({
        update: vi.fn((payload) => { capturedUpdate = payload; return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) } }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: hrList, error: null }),
      })

    await managerDecideItem('item-1', 'approved', 'mgr-1')
    expect(capturedUpdate).toEqual({ status: 'pending_manager' })
  })

  it('sets status to pending_admin when all items are manager-approved but not yet admin-decided', async () => {
    const item = { id: 'item-1', date: '2026-06-17', manager_decision: 'approved', request: { id: 'req-1', employee_id: 'emp-1' } }
    const rollupItems = [
      { manager_decision: 'approved', admin_decision: null },
      { manager_decision: 'approved', admin_decision: null },
    ]
    const hrList = [{ id: 'hr-1' }]
    let capturedUpdate

    supabase.from
      .mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: item, error: null }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: rollupItems, error: null }),
      })
      .mockReturnValueOnce({
        update: vi.fn((payload) => { capturedUpdate = payload; return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) } }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: hrList, error: null }),
      })

    await managerDecideItem('item-1', 'approved', 'mgr-1')
    expect(capturedUpdate).toEqual({ status: 'pending_admin' })
  })

  it('sets status to completed when all items have both manager and admin decisions (none pending)', async () => {
    const item = { id: 'item-1', date: '2026-06-17', request: { id: 'req-1', employee_id: 'emp-1' } }
    const rollupItems = [
      { manager_decision: 'approved', admin_decision: 'approved' },
      { manager_decision: 'rejected', admin_decision: null },
    ]
    let capturedUpdate

    supabase.from
      .mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: item, error: null }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: rollupItems, error: null }),
      })
      .mockReturnValueOnce({
        update: vi.fn((payload) => { capturedUpdate = payload; return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) } }),
      })

    await managerDecideItem('item-1', 'rejected', 'mgr-1')
    expect(capturedUpdate).toEqual({ status: 'completed' })
  })
})
