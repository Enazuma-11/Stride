# Manager Transfer Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a manager request moving one of their direct reports to another manager, requiring the receiving manager to accept and then HR/Admin to give final approval before `employees.manager_id` actually changes.

**Architecture:** A new `manager_transfer_requests` table drives a 3-stage status machine (`pending_target` → `pending_hr` → `approved`/`rejected_by_target`/`rejected_by_hr`/`withdrawn`), mirroring the existing Attendance Regularization two-stage-decision pattern. All API logic lives in a new `src/lib/api.managerTransfers.js`, matching the codebase's one-file-per-feature convention (`api.attendanceRegularization.js`, `api.holidayOptins.js`). UI additions land in two existing pages: `TeamDirectoryPage.jsx` (initiate + manager-side accept/reject/withdraw) and `EmployeeManagementPage.jsx` (HR-side approve/reject).

**Tech Stack:** React + Vite, Supabase (Postgres + RLS + SECURITY DEFINER functions), Vitest for API-layer tests.

## Global Constraints

- RLS: never assume a direct table query sees company-wide data for a non-HR/Admin caller — the `employees_select_own` and `manager_transfer_requests` RLS policies are self/HR-scoped by design. Cross-employee broadcasts (e.g. "every HR/Admin") MUST use the existing `get_hr_admin_employee_ids` RPC, never a direct query, per the established pattern in `api.attendanceRegularization.js`.
- Broadcast completeness: any "notify everyone eligible" step must insert one row per recipient via a bulk array insert — never pick a single recipient (`list[0]`).
- Never chain `.select()` after an insert/update of a row that isn't guaranteed visible to the caller's own SELECT policy — this throws even when the write itself was allowed (the "RETURNING-clause RLS trap"). Every insert/update in this plan is checked against this before being written.
- UTC/timestamp consistency: use `new Date().toISOString()` for all decision timestamps, matching every other feature in this codebase.
- Status-transition guards belong in the application layer (`api.managerTransfers.js`), not just RLS — RLS controls *visibility*, not which status transitions a given party is allowed to make. Every mutating function must check the row's current status before writing.
- Notification delivery is best-effort and wrapped in try/catch — a notification failure must never surface as a failure of the write it's attached to (matches every notification call site in `api.attendanceRegularization.js` and `api.js`).
- Positional array destructuring: if a new `Promise.all([...])` load is added to an existing page's data-loading block, append it at the END of the array, never insert mid-array.

---

### Task 1: Database migration — employees RLS fix + manager_transfer_requests table

**Files:**
- Create: `supabase_migration_manager_transfers.sql`

**Interfaces:**
- Produces: table `manager_transfer_requests` with columns `id, employee_id, from_manager_id, to_manager_id, reason, status, target_decided_at, hr_decided_by, hr_decided_at, created_at`. Produces a new RLS policy `employees_select_team_directory` on the existing `employees` table.
- Consumes: existing `current_employee_role()` SECURITY DEFINER function (defined in `supabase_schema.sql`), existing `employees` table.

This task also fixes a pre-existing bug discovered during planning: the `employees` table's only SELECT policies are `employees_select_own` (self row only) and `hr_manage_employees` (HR/Admin, via `FOR ALL`). A regular employee (role_type `employee` — there is no distinct `manager` role_type in use; managers are just employees referenced by another employee's `manager_id`) querying `employees` directly, as `TeamDirectoryPage.jsx` and this feature both need to, gets silently filtered down to only their own row. This has been invisible because the only accounts anyone tests with are HR/Admin, who bypass the restriction entirely. This task adds a policy so any authenticated active employee can read all active employees' rows — which is exactly what Team Directory already intends to show everyone.

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- STRIDE — MANAGER TRANSFER REQUESTS
-- Run in: Supabase Dashboard → SQL Editor (both Production and Test projects)
--
-- Why: a manager needs a way to request moving one of their direct reports
-- to another manager. The receiving manager must accept before HR/Admin
-- gives final approval — only then does employees.manager_id actually
-- change. HR/Admin's existing direct manager-edit in Employee Management
-- is untouched and still bypasses this workflow entirely.
--
-- Also fixes a pre-existing bug: employees_select_own only lets a caller
-- see their own row (or HR/Admin see all), so a regular manager querying
-- the employees table directly — as Team Directory and this feature both
-- need to — was silently filtered down to just themselves. Invisible until
-- now because every account used to test this app so far is HR/Admin.
-- ============================================================

-- ─── FIX: let any active employee read the team directory ─────────────────
DROP POLICY IF EXISTS "employees_select_team_directory" ON employees;
CREATE POLICY "employees_select_team_directory" ON employees
  FOR SELECT USING (
    status = 'active' AND current_employee_role() IS NOT NULL
  );

-- ─── NEW TABLE ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manager_transfer_requests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  from_manager_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  to_manager_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reason            TEXT,
  status            TEXT NOT NULL DEFAULT 'pending_target'
                    CHECK (status IN ('pending_target','pending_hr','approved','rejected_by_target','rejected_by_hr','withdrawn')),
  target_decided_at TIMESTAMPTZ,
  hr_decided_by     UUID REFERENCES employees(id) ON DELETE SET NULL,
  hr_decided_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_requests_employee     ON manager_transfer_requests (employee_id);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_from_manager ON manager_transfer_requests (from_manager_id);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_to_manager   ON manager_transfer_requests (to_manager_id);

ALTER TABLE manager_transfer_requests ENABLE ROW LEVEL SECURITY;

-- Visible to the initiating manager, the target manager, or HR/Admin
DROP POLICY IF EXISTS "transfer_requests_select" ON manager_transfer_requests;
CREATE POLICY "transfer_requests_select" ON manager_transfer_requests
  FOR SELECT USING (
    from_manager_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR to_manager_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
  );

-- Only the initiating manager can create a request naming themselves as from_manager_id
DROP POLICY IF EXISTS "transfer_requests_insert" ON manager_transfer_requests;
CREATE POLICY "transfer_requests_insert" ON manager_transfer_requests
  FOR INSERT WITH CHECK (
    from_manager_id = (SELECT id FROM employees WHERE user_id = auth.uid())
  );

-- Same three parties may update (application layer restricts which status
-- transitions each party is actually allowed to make — see api.managerTransfers.js)
DROP POLICY IF EXISTS "transfer_requests_update" ON manager_transfer_requests;
CREATE POLICY "transfer_requests_update" ON manager_transfer_requests
  FOR UPDATE USING (
    from_manager_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR to_manager_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
  );

-- Verify
SELECT policyname FROM pg_policies WHERE tablename = 'employees' AND policyname = 'employees_select_team_directory';
SELECT table_name FROM information_schema.tables WHERE table_name = 'manager_transfer_requests';
```

- [ ] **Step 2: Commit**

```bash
git add supabase_migration_manager_transfers.sql
git commit -m "Add manager_transfer_requests table + employees team-directory RLS fix"
```

---

### Task 2: API — initiate, list sent, withdraw

**Files:**
- Create: `src/lib/api.managerTransfers.js`
- Test: `src/tests/api.managerTransfers.test.js`

**Interfaces:**
- Consumes: `supabase` (`src/lib/supabase.js`), `createNotification` (`src/lib/api.notifications.js`, signature `createNotification({ employeeId, type, title, message, metadata })`).
- Produces: `requestTransfer({ employeeId, fromManagerId, toManagerId, reason })` → Promise<request row>. `getSentTransferRequests(managerId)` → Promise<array>. `withdrawTransferRequest(requestId, managerId)` → Promise<void>. These three are consumed by Task 5 (Team Directory UI).

- [ ] **Step 1: Write the failing tests**

```javascript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tests/api.managerTransfers.test.js`
Expected: FAIL — `Cannot find module '../lib/api.managerTransfers'` (file doesn't exist yet).

- [ ] **Step 3: Implement `requestTransfer`, `getSentTransferRequests`, `withdrawTransferRequest`**

```javascript
import { supabase } from './supabase'
import { createNotification } from './api.notifications'

// ─── INITIATE A TRANSFER REQUEST (manager) ───────────────────────────────────
export async function requestTransfer({ employeeId, fromManagerId, toManagerId, reason }) {
  if (!employeeId || !fromManagerId || !toManagerId) {
    throw new Error('Employee, current manager, and target manager are all required.')
  }
  if (fromManagerId === toManagerId) {
    throw new Error('Target manager must be different from the current manager.')
  }

  const { data: employee, error: empError } = await supabase
    .from('employees')
    .select('id, full_name, manager_id')
    .eq('id', employeeId)
    .single()
  if (empError) throw empError
  if (employee.manager_id !== fromManagerId) {
    throw new Error('This employee is no longer your direct report.')
  }

  const { data: existing, error: existingError } = await supabase
    .from('manager_transfer_requests')
    .select('id')
    .eq('employee_id', employeeId)
    .in('status', ['pending_target', 'pending_hr'])
  if (existingError) throw existingError
  if (existing && existing.length > 0) {
    throw new Error('This employee already has a pending transfer request.')
  }

  const { data: request, error: insertError } = await supabase
    .from('manager_transfer_requests')
    .insert({
      employee_id: employeeId,
      from_manager_id: fromManagerId,
      to_manager_id: toManagerId,
      reason: reason?.trim() || null,
    })
    .select()
    .single()
  if (insertError) throw insertError

  // Notification delivery is best-effort — the request itself is already
  // committed above, so a notification hiccup must not surface as a
  // failure to the manager who successfully submitted it.
  try {
    await createNotification({
      employeeId: toManagerId,
      type: 'manager_transfer_requested',
      title: 'Team Transfer Request',
      message: `${employee.full_name} — you've been asked to take over as their manager.`,
      metadata: { request_id: request.id },
    })
  } catch (e) { console.warn('Transfer request notification failed:', e.message) }

  return request
}

// ─── LIST REQUESTS I'VE SENT (manager) ───────────────────────────────────────
export async function getSentTransferRequests(managerId) {
  const { data, error } = await supabase
    .from('manager_transfer_requests')
    .select('*, employee:employee_id(full_name, avatar_initials), to_manager:to_manager_id(full_name, avatar_initials)')
    .eq('from_manager_id', managerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ─── WITHDRAW A REQUEST (manager, only while non-terminal) ───────────────────
export async function withdrawTransferRequest(requestId, managerId) {
  const { data: request, error } = await supabase
    .from('manager_transfer_requests')
    .select('*')
    .eq('id', requestId)
    .eq('from_manager_id', managerId)
    .single()
  if (error) throw error
  if (!['pending_target', 'pending_hr'].includes(request.status)) {
    throw new Error('This request has already been decided and can no longer be withdrawn.')
  }

  const { error: updateError } = await supabase
    .from('manager_transfer_requests')
    .update({ status: 'withdrawn' })
    .eq('id', requestId)
  if (updateError) throw updateError
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/api.managerTransfers.test.js`
Expected: PASS (all tests in this file)

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.managerTransfers.js src/tests/api.managerTransfers.test.js
git commit -m "Add requestTransfer, getSentTransferRequests, withdrawTransferRequest"
```

---

### Task 3: API — target manager decision + incoming queue

**Files:**
- Modify: `src/lib/api.managerTransfers.js`
- Modify: `src/tests/api.managerTransfers.test.js`

**Interfaces:**
- Consumes: `supabase.rpc('get_hr_admin_employee_ids')` (existing RPC, defined in `supabase_migration_hr_admin_lookup.sql`, returns `[{ id }]` for all active HR/Admin), `createNotification` (as above).
- Produces: `getIncomingTransferRequests(managerId)` → Promise<array>. `targetDecideTransfer(requestId, decision, targetManagerId)` where `decision` is `'accepted'|'rejected'` → Promise<updated request>. Both consumed by Task 5 (Team Directory UI).

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/api.managerTransfers.test.js`:

```javascript
import {
  getIncomingTransferRequests,
  targetDecideTransfer,
} from '../lib/api.managerTransfers'

// ── getIncomingTransferRequests ───────────────────────────────────────────────
describe('getIncomingTransferRequests', () => {
  it('queries by to_manager_id and pending_target status', async () => {
    const eqStatus = vi.fn().mockReturnThis()
    const orderMock = vi.fn().mockResolvedValue({ data: [{ id: 'req-1' }], error: null })
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: orderMock,
    })

    const result = await getIncomingTransferRequests('mgr-2')
    expect(result).toEqual([{ id: 'req-1' }])
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tests/api.managerTransfers.test.js`
Expected: FAIL — `getIncomingTransferRequests is not a function` / `targetDecideTransfer is not a function`

- [ ] **Step 3: Implement `getIncomingTransferRequests` and `targetDecideTransfer`**

Append to `src/lib/api.managerTransfers.js`:

```javascript
// ─── LIST REQUESTS AWAITING MY DECISION (target manager) ─────────────────────
export async function getIncomingTransferRequests(managerId) {
  const { data, error } = await supabase
    .from('manager_transfer_requests')
    .select('*, employee:employee_id(full_name, avatar_initials), from_manager:from_manager_id(full_name, avatar_initials)')
    .eq('to_manager_id', managerId)
    .eq('status', 'pending_target')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ─── TARGET MANAGER DECISION ──────────────────────────────────────────────────
export async function targetDecideTransfer(requestId, decision, targetManagerId) {
  if (!['accepted', 'rejected'].includes(decision)) {
    throw new Error('Invalid decision — must be "accepted" or "rejected".')
  }

  const { data: request, error } = await supabase
    .from('manager_transfer_requests')
    .select('*, employee:employee_id(full_name)')
    .eq('id', requestId)
    .eq('to_manager_id', targetManagerId)
    .single()
  if (error) throw error
  if (request.status !== 'pending_target') {
    throw new Error('This request is no longer awaiting your decision.')
  }

  const newStatus = decision === 'accepted' ? 'pending_hr' : 'rejected_by_target'
  const { error: updateError } = await supabase
    .from('manager_transfer_requests')
    .update({ status: newStatus, target_decided_at: new Date().toISOString() })
    .eq('id', requestId)
  if (updateError) throw updateError

  // Notification delivery is best-effort — the decision itself is already
  // committed above, so a notification hiccup must not surface as a
  // failure to the manager who successfully recorded their decision.
  try {
    if (decision === 'accepted') {
      // Broadcast to every active HR/Admin, not just one — mirrors
      // attendance regularization's pending_admin notification. RPC, not a
      // direct table query, because employees_select_own would otherwise
      // silently return zero HR/Admin rows to this (non-HR) caller.
      const { data: hrList } = await supabase.rpc('get_hr_admin_employee_ids')
      if (hrList?.length) {
        await supabase.from('notifications').insert(
          hrList.map(hr => ({
            employee_id: hr.id,
            type: 'manager_transfer_pending_hr',
            title: 'Transfer Request — Awaiting Approval',
            message: `${request.employee.full_name}'s transfer has been accepted by the new manager and needs your approval.`,
            metadata: { request_id: requestId },
            is_read: false,
          }))
        )
      }
    } else {
      await createNotification({
        employeeId: request.from_manager_id,
        type: 'manager_transfer_decided',
        title: 'Transfer Request Rejected',
        message: `The target manager declined your transfer request for ${request.employee.full_name}.`,
        metadata: { request_id: requestId },
      })
    }
  } catch (e) { console.warn('Transfer decision notification failed:', e.message) }

  return { ...request, status: newStatus }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/api.managerTransfers.test.js`
Expected: PASS (all tests in this file)

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.managerTransfers.js src/tests/api.managerTransfers.test.js
git commit -m "Add getIncomingTransferRequests, targetDecideTransfer"
```

---

### Task 4: API — HR/Admin queue + final decision

**Files:**
- Modify: `src/lib/api.managerTransfers.js`
- Modify: `src/tests/api.managerTransfers.test.js`

**Interfaces:**
- Consumes: `createNotification` (as above), `supabase.from('employees').update(...)`.
- Produces: `getPendingHRTransferRequests()` → Promise<array>. `hrDecideTransfer(requestId, decision, hrAdminId)` where `decision` is `'approved'|'rejected'` → Promise<updated request>. Both consumed by Task 6 (Employee Management UI).

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/api.managerTransfers.test.js`:

```javascript
import {
  getPendingHRTransferRequests,
  hrDecideTransfer,
} from '../lib/api.managerTransfers'

// ── getPendingHRTransferRequests ──────────────────────────────────────────────
describe('getPendingHRTransferRequests', () => {
  it('queries by pending_hr status', async () => {
    const orderMock = vi.fn().mockResolvedValue({ data: [{ id: 'req-1' }], error: null })
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: orderMock,
    })

    const result = await getPendingHRTransferRequests()
    expect(result).toEqual([{ id: 'req-1' }])
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tests/api.managerTransfers.test.js`
Expected: FAIL — `getPendingHRTransferRequests is not a function` / `hrDecideTransfer is not a function`

- [ ] **Step 3: Implement `getPendingHRTransferRequests` and `hrDecideTransfer`**

Append to `src/lib/api.managerTransfers.js`:

```javascript
// ─── HR/ADMIN QUEUE ────────────────────────────────────────────────────────────
export async function getPendingHRTransferRequests() {
  const { data, error } = await supabase
    .from('manager_transfer_requests')
    .select('*, employee:employee_id(full_name, avatar_initials), from_manager:from_manager_id(full_name), to_manager:to_manager_id(full_name)')
    .eq('status', 'pending_hr')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ─── HR/ADMIN FINAL DECISION ───────────────────────────────────────────────────
export async function hrDecideTransfer(requestId, decision, hrAdminId) {
  if (!['approved', 'rejected'].includes(decision)) {
    throw new Error('Invalid decision — must be "approved" or "rejected".')
  }

  const { data: request, error } = await supabase
    .from('manager_transfer_requests')
    .select('*, employee:employee_id(full_name)')
    .eq('id', requestId)
    .single()
  if (error) throw error
  if (request.status !== 'pending_hr') {
    throw new Error('This request is not awaiting HR approval.')
  }

  // Apply the actual manager change BEFORE marking the request approved —
  // if this write fails, the request stays pending_hr (retriable) instead
  // of being marked approved without the change having actually happened.
  if (decision === 'approved') {
    const { error: managerError } = await supabase
      .from('employees')
      .update({ manager_id: request.to_manager_id })
      .eq('id', request.employee_id)
    if (managerError) throw managerError
  }

  const newStatus = decision === 'approved' ? 'approved' : 'rejected_by_hr'
  const { error: updateError } = await supabase
    .from('manager_transfer_requests')
    .update({ status: newStatus, hr_decided_by: hrAdminId, hr_decided_at: new Date().toISOString() })
    .eq('id', requestId)
  if (updateError) throw updateError

  // Notification delivery is best-effort — the decision itself is already
  // committed above, so a notification hiccup must not surface as a
  // failure to the HR/Admin who successfully recorded it.
  try {
    if (decision === 'approved') {
      await createNotification({
        employeeId: request.employee_id,
        type: 'manager_transfer_decided',
        title: 'Your Reporting Manager Has Changed',
        message: 'Your reporting manager has been updated following an approved transfer.',
        metadata: { request_id: requestId },
      })
    } else {
      await createNotification({
        employeeId: request.from_manager_id,
        type: 'manager_transfer_decided',
        title: 'Transfer Request Rejected',
        message: `HR rejected your transfer request for ${request.employee.full_name}.`,
        metadata: { request_id: requestId },
      })
    }
  } catch (e) { console.warn('Transfer HR decision notification failed:', e.message) }

  return { ...request, status: newStatus }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/api.managerTransfers.test.js`
Expected: PASS (all tests in this file — full file should now report all `describe` blocks passing)

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS — all existing suites plus the new `api.managerTransfers.test.js` file, total test count increased by the number of tests added in Tasks 2–4.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api.managerTransfers.js src/tests/api.managerTransfers.test.js
git commit -m "Add getPendingHRTransferRequests, hrDecideTransfer"
```

---

### Task 5: UI — Team Directory (initiate + manager-side accept/reject/withdraw)

**Files:**
- Modify: `src/pages/employee/TeamDirectoryPage.jsx`

**Interfaces:**
- Consumes: `requestTransfer`, `getSentTransferRequests`, `withdrawTransferRequest`, `getIncomingTransferRequests`, `targetDecideTransfer` (all from `src/lib/api.managerTransfers.js`, exact signatures from Tasks 2–3).
- Produces: no new exports — this is a leaf page component.

No automated tests for this task (this codebase has no component-level test harness — every prior UI-only task in this project, e.g. the Leave Overhaul's Dashboard widget and Apply form, was verified via `npm run build` + manual/browser review instead). Verify via Step 4 below.

- [ ] **Step 1: Add the API imports and local state**

In `src/pages/employee/TeamDirectoryPage.jsx`, replace the top imports and add transfer-related state to the page component:

```javascript
import { useEffect, useState } from 'react'
import AppShell from '../../components/layout/AppShell'
import { Card, Avatar, Button, Select, Textarea, Alert, Spinner, EmptyState } from '../../components/ui'
import { C, FONTS } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  requestTransfer, getSentTransferRequests, withdrawTransferRequest,
  getIncomingTransferRequests, targetDecideTransfer,
} from '../../lib/api.managerTransfers'
```

(Keep the existing `getAllEmployeesWithManagers` and `EmployeeCard` exactly as-is — they aren't touched in this task except for the new "Transfer" button added to `EmployeeCard` in Step 2.)

- [ ] **Step 2: Add the Transfer button to EmployeeCard and a local Modal component**

Modify `EmployeeCard`'s signature and add a Transfer button (only rendered when the viewer manages this employee), and add a `Modal` component (copied from the existing pattern in `src/pages/hr/EmployeeManagementPage.jsx:43`, since this codebase has no shared Modal component — every page that needs one defines its own):

```javascript
function Modal({ title, subtitle, onClose, children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(29,53,87,0.55)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 32px 80px rgba(29,53,87,0.25)',
      }}>
        <div style={{ padding: '22px 26px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: C.textMid, marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: C.textLight, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: '22px 26px' }}>{children}</div>
      </div>
    </div>
  )
}

function TransferModal({ employee, eligibleManagers, currentManagerId, onClose, onSubmit }) {
  const [toManagerId, setToManagerId] = useState('')
  const [reason, setReason]           = useState('')
  const [error, setError]             = useState('')
  const [loading, setLoading]         = useState(false)

  async function submit() {
    if (!toManagerId) { setError('Please pick a target manager.'); return }
    setLoading(true); setError('')
    try {
      await onSubmit({ employeeId: employee.id, fromManagerId: currentManagerId, toManagerId, reason })
      onClose()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const options = eligibleManagers.filter(m => m.id !== currentManagerId)

  return (
    <Modal title={`Transfer ${employee.full_name}`} subtitle="The new manager must accept, then HR/Admin gives final approval." onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Select
          label="Transfer to manager"
          value={toManagerId}
          onChange={setToManagerId}
          options={[{ value: '', label: 'Select a manager…' }, ...options.map(m => ({ value: m.id, label: `${m.full_name} — ${m.role}` }))]}
          required
        />
        <Textarea label="Reason (optional)" value={reason} onChange={setReason} placeholder="Why is this transfer being requested?" />
        {error && <Alert type="error" message={error} />}
        <Button onClick={submit} disabled={loading} fullWidth>{loading ? 'Submitting…' : 'Submit Transfer Request'}</Button>
      </div>
    </Modal>
  )
}

function EmployeeCard({ emp, currentEmployeeId, onTransferClick }) {
  const isMe = emp.id === currentEmployeeId
  const iManageThem = emp.manager?.id === currentEmployeeId && !isMe
  const joinYear = emp.join_date ? new Date(emp.join_date).getFullYear() : null
```

(The rest of `EmployeeCard`'s JSX is unchanged up through the "Join year" block. Add the Transfer button right after the "Reporting manager" block, before "Join year":)

```javascript
          {iManageThem && (
            <button onClick={() => onTransferClick(emp)} style={{
              marginTop: 4, padding: '7px 10px', borderRadius: 8, border: `1.5px solid ${C.brand}`,
              background: 'transparent', color: C.brand, fontSize: 11, fontWeight: 700,
              cursor: 'pointer', fontFamily: FONTS.body, width: '100%',
            }}>
              🔁 Transfer to another manager
            </button>
          )}
```

And update the card's render call site (in the page's grid) to pass the new prop — see Step 3.

- [ ] **Step 3: Add the Transfers panel and wire everything into the page component**

Replace the `export default function TeamDirectoryPage()` function with:

```javascript
export default function TeamDirectoryPage() {
  const { employee } = useAuth()
  const [employees, setEmployees] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [dept,      setDept]      = useState('All')
  const [view,      setView]      = useState('directory')
  const [transferTarget, setTransferTarget] = useState(null)
  const [sent,     setSent]     = useState([])
  const [incoming, setIncoming] = useState([])
  const [actionError, setActionError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [emps, sentReqs, incomingReqs] = await Promise.all([
        getAllEmployeesWithManagers(),
        employee?.id ? getSentTransferRequests(employee.id) : Promise.resolve([]),
        employee?.id ? getIncomingTransferRequests(employee.id) : Promise.resolve([]),
      ])
      setEmployees(emps); setSent(sentReqs); setIncoming(incomingReqs)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function handleTransferSubmit(payload) {
    await requestTransfer(payload)
    const sentReqs = await getSentTransferRequests(employee.id)
    setSent(sentReqs)
  }

  async function handleWithdraw(requestId) {
    setActionError('')
    try {
      await withdrawTransferRequest(requestId, employee.id)
      setSent(rs => rs.map(r => r.id === requestId ? { ...r, status: 'withdrawn' } : r))
    } catch (e) { setActionError(e.message) }
  }

  async function handleIncomingDecision(requestId, decision) {
    setActionError('')
    try {
      await targetDecideTransfer(requestId, decision, employee.id)
      setIncoming(rs => rs.filter(r => r.id !== requestId))
    } catch (e) { setActionError(e.message) }
  }

  const departments = ['All', ...new Set(employees.map(e => e.department).filter(Boolean).sort())]
  const eligibleManagers = [...new Map(
    employees.filter(e => e.manager).map(e => [e.manager.id, e.manager])
  ).values()]

  const filtered = employees.filter(e => {
    const matchSearch = !search ||
      e.full_name.toLowerCase().includes(search.toLowerCase()) ||
      e.role?.toLowerCase().includes(search.toLowerCase()) ||
      e.email?.toLowerCase().includes(search.toLowerCase()) ||
      e.employee_code?.toLowerCase().includes(search.toLowerCase())
    const matchDept = dept === 'All' || e.department === dept
    return matchSearch && matchDept
  })

  const STATUS_LABEL = {
    pending_target: 'Awaiting new manager',
    pending_hr: 'Awaiting HR approval',
    approved: 'Approved',
    rejected_by_target: 'Rejected by new manager',
    rejected_by_hr: 'Rejected by HR',
    withdrawn: 'Withdrawn',
  }

  return (
    <AppShell title="Team Directory" subtitle={`${employees.length} team members`}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: C.surface, padding: 6, borderRadius: 10, width: 'fit-content', boxShadow: C.shadow }}>
        {[{ id: 'directory', label: 'Directory' }, { id: 'transfers', label: '🔁 Transfers' }].map(t => (
          <button key={t.id} onClick={() => setView(t.id)} style={{
            padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: view === t.id ? C.brand : 'transparent',
            color: view === t.id ? '#fff' : C.textMid,
            fontSize: 13, fontWeight: 700, fontFamily: FONTS.display,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {view === 'directory' && (
        <>
          {/* Search + filter */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 16 }}>🔍</span>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by name, role, email or ID…"
                style={{ width: '100%', padding: '10px 14px 10px 38px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none', background: C.surface }}
                onFocus={e => e.target.style.borderColor = C.teal}
                onBlur={e => e.target.style.borderColor = C.border}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {departments.map(d => (
                <button key={d} onClick={() => setDept(d)} style={{
                  padding: '8px 16px', borderRadius: 20, border: `1.5px solid ${dept === d ? C.brand : C.border}`,
                  background: dept === d ? C.brandLight : C.surface,
                  color: dept === d ? C.brand : C.textLight,
                  fontSize: 12, fontWeight: dept === d ? 700 : 400,
                  cursor: 'pointer', fontFamily: FONTS.body, transition: 'all 0.15s',
                }}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Stats bar */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
            {[
              { label: 'Total', val: employees.length, color: C.brand },
              { label: 'Showing', val: filtered.length, color: C.teal },
              { label: 'Departments', val: departments.length - 1, color: C.purple },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textMid }}>
                <span style={{ fontWeight: 800, color: s.color, fontSize: 18, fontFamily: FONTS.display }}>{s.val}</span>
                <span>{s.label}</span>
              </div>
            ))}
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={32} /></div>
          ) : filtered.length === 0 ? (
            <EmptyState icon="👥" title="No employees found" subtitle="Try a different search or filter." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
              {filtered.map(emp => (
                <EmployeeCard key={emp.id} emp={emp} currentEmployeeId={employee?.id} onTransferClick={setTransferTarget} />
              ))}
            </div>
          )}
        </>
      )}

      {view === 'transfers' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {actionError && <Alert type="error" message={actionError} />}

          <Card style={{ padding: '20px 24px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: FONTS.display, marginBottom: 14 }}>Sent by me</div>
            {sent.length === 0 ? (
              <div style={{ fontSize: 13, color: C.textLight }}>No transfer requests sent.</div>
            ) : sent.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: `1px solid ${C.border}` }}>
                <Avatar initials={r.employee?.avatar_initials || '??'} size={32} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{r.employee?.full_name} → {r.to_manager?.full_name}</div>
                  <div style={{ fontSize: 11, color: C.textLight }}>{STATUS_LABEL[r.status] || r.status}</div>
                </div>
                {['pending_target', 'pending_hr'].includes(r.status) && (
                  <Button variant="outline" size="sm" onClick={() => handleWithdraw(r.id)}>Withdraw</Button>
                )}
              </div>
            ))}
          </Card>

          <Card style={{ padding: '20px 24px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: FONTS.display, marginBottom: 14 }}>Awaiting my decision</div>
            {incoming.length === 0 ? (
              <div style={{ fontSize: 13, color: C.textLight }}>Nothing awaiting your decision.</div>
            ) : incoming.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: `1px solid ${C.border}` }}>
                <Avatar initials={r.employee?.avatar_initials || '??'} size={32} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{r.employee?.full_name}</div>
                  <div style={{ fontSize: 11, color: C.textLight }}>From {r.from_manager?.full_name}{r.reason ? ` — "${r.reason}"` : ''}</div>
                </div>
                <Button variant="outline" size="sm" onClick={() => handleIncomingDecision(r.id, 'rejected')}>Reject</Button>
                <Button size="sm" onClick={() => handleIncomingDecision(r.id, 'accepted')}>Accept</Button>
              </div>
            ))}
          </Card>
        </div>
      )}

      {transferTarget && (
        <TransferModal
          employee={transferTarget}
          eligibleManagers={eligibleManagers}
          currentManagerId={employee?.id}
          onClose={() => setTransferTarget(null)}
          onSubmit={handleTransferSubmit}
        />
      )}
    </AppShell>
  )
}
```

- [ ] **Step 4: Verify the build succeeds and manually smoke-test**

Run: `npm run build`
Expected: builds cleanly with no new errors/warnings.

If a dev server is available in this environment, start it, log in as an employee who manages at least one direct report, navigate to Team Directory, and confirm: the "🔁 Transfer to another manager" button appears only on cards for your own direct reports; the modal's manager dropdown excludes your own name; submitting without picking a manager shows "Please pick a target manager."; the "Transfers" tab shows the new request under "Sent by me" with status "Awaiting new manager". If no dev server is available, state explicitly that this step was not run and defer it, per this project's established practice for UI-only tasks.

- [ ] **Step 5: Commit**

```bash
git add src/pages/employee/TeamDirectoryPage.jsx
git commit -m "Add manager transfer initiate/accept/reject/withdraw UI to Team Directory"
```

---

### Task 6: UI — Employee Management (HR/Admin approval tab)

**Files:**
- Modify: `src/pages/hr/EmployeeManagementPage.jsx`

**Interfaces:**
- Consumes: `getPendingHRTransferRequests`, `hrDecideTransfer` (from `src/lib/api.managerTransfers.js`, exact signatures from Task 4).
- Produces: no new exports — this is a leaf page component.

No automated tests for this task, consistent with Task 5 — verify via Step 3 below.

- [ ] **Step 1: Add imports, tab state, and data loading**

Add to the top imports of `src/pages/hr/EmployeeManagementPage.jsx`:

```javascript
import { getPendingHRTransferRequests, hrDecideTransfer } from '../../lib/api.managerTransfers'
```

In the `EmployeeManagementPage` function, add tab state (following the exact `tab`/`setTab` pattern already used in `src/pages/hr/HRAttendancePage.jsx:312`) and load transfer requests alongside the existing `Promise.all`:

```javascript
  const [tab, setTab] = useState('employees')
  const [transferRequests, setTransferRequests] = useState([])
```

Modify the existing `load()` function's `Promise.all` call — append the new load at the END of the array (never insert mid-array, per the Global Constraints):

```javascript
  async function load() {
    setLoading(true)
    try {
      const [emps, pend, transfers] = await Promise.all([getAllEmployeesForHR(), getPendingRegistrations(), getPendingHRTransferRequests()])
      setEmployees(emps); setPending(pend); setTransferRequests(transfers)
    } finally { setLoading(false) }
  }
```

- [ ] **Step 2: Add the tab bar and Transfer Requests panel**

`hrDecideTransfer`'s third argument is the acting HR/Admin's employee id — this page doesn't currently call `useAuth()`. Add it right after `const r = useResponsive()` in `EmployeeManagementPage`:

```javascript
  const { employee: currentEmployee } = useAuth()
```

Then add a handler function alongside the other `handle*` functions in `EmployeeManagementPage`:

```javascript
  async function handleTransferDecision(requestId, decision) {
    try {
      await hrDecideTransfer(requestId, decision, currentEmployee?.id)
      setTransferRequests(rs => rs.filter(r => r.id !== requestId))
      showToast(decision === 'approved' ? '✅ Transfer approved.' : 'Transfer rejected.')
    } catch (e) { alert(e.message) }
  }
```

Add the tab bar right after the `<style>` block and before the toast block in the returned JSX, and wrap the existing stats/banner/buttons/table block in a `tab === 'employees'` conditional. Add the new panel for `tab === 'transfers'`:

```javascript
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: C.surface, padding: 6, borderRadius: 10, width: 'fit-content', boxShadow: C.shadow }}>
        {[{ id: 'employees', label: 'Employees' }, { id: 'transfers', label: `🔁 Transfer Requests${transferRequests.length ? ` (${transferRequests.length})` : ''}` }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: tab === t.id ? C.brand : 'transparent',
            color: tab === t.id ? '#fff' : C.textMid,
            fontSize: 13, fontWeight: 700, fontFamily: "'Sora',sans-serif",
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'employees' && (
        <>
          {/* Stats, PendingBanner, action buttons, EmployeeTable — exactly as before */}
        </>
      )}

      {tab === 'transfers' && (
        <Card style={{ padding: '20px 24px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif", marginBottom: 14 }}>Transfer Requests Awaiting Approval</div>
          {transferRequests.length === 0 ? (
            <EmptyState icon="🔁" title="Nothing pending" subtitle="Transfer requests accepted by the receiving manager will show up here." />
          ) : transferRequests.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: `1px solid ${C.border}` }}>
              <Avatar initials={r.employee?.avatar_initials || '??'} size={32} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{r.employee?.full_name}</div>
                <div style={{ fontSize: 11, color: C.textLight }}>{r.from_manager?.full_name} → {r.to_manager?.full_name}{r.reason ? ` — "${r.reason}"` : ''}</div>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleTransferDecision(r.id, 'rejected')}>Reject</Button>
              <Button size="sm" onClick={() => handleTransferDecision(r.id, 'approved')}>Approve</Button>
            </div>
          ))}
        </Card>
      )}
```

Move the existing block (Stats grid, `<PendingBanner>`, action buttons row, `<EmployeeTable>`) that currently sits directly in the returned JSX into the `tab === 'employees'` conditional shown above, unchanged.

- [ ] **Step 3: Verify the build succeeds and manually smoke-test**

Run: `npm run build`
Expected: builds cleanly with no new errors/warnings.

If a dev server is available, log in as HR/Admin, navigate to Employee Management, confirm the "Employees" tab still shows exactly what it did before this change, and that a `pending_hr` transfer request (create one via the Team Directory flow end-to-end first) appears under "🔁 Transfer Requests" with Approve/Reject buttons that work. If no dev server is available, state explicitly that this step was not run and defer it.

- [ ] **Step 4: Run the full test suite one more time**

Run: `npm test`
Expected: PASS — no regressions from the UI changes (these pages have no component tests, so this just confirms the API-layer suite is still green).

- [ ] **Step 5: Commit**

```bash
git add src/pages/hr/EmployeeManagementPage.jsx
git commit -m "Add HR/Admin Transfer Requests approval tab to Employee Management"
```
