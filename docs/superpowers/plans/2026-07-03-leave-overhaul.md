# Leave Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let employees explicitly choose unpaid leave upfront (bypassing balance entirely), block over-balance paid requests instead of silently auto-splitting them at approval, and give every employee visibility into upcoming approved leave company-wide via a notification and a Dashboard widget.

**Architecture:** Extends the existing `leave_requests`/`leave_balances` tables with two already-drafted-but-never-applied columns (`unpaid_days`/`paid_days`, `unpaid_days_taken`), removes a dormant auto-split code path in `updateLeaveStatus`, and adds a narrow `SECURITY DEFINER` RPC (matching the established pattern from `get_hr_admin_employee_ids`) so any employee's session can read company-wide approved-leave data despite `leave_requests`' self-scoped RLS policy.

**Tech Stack:** React + Vite, Supabase (Postgres + RLS + PostgREST), Vitest.

## Global Constraints

- Unpaid leave bypasses `leave_balances` entirely — never touches `used_days`, only increments `unpaid_days_taken`.
- If an employee applies for paid (non-unpaid) leave exceeding their remaining balance, the request is **blocked upfront** with a clear error — no silent auto-split at approval time. The existing auto-split block in `updateLeaveStatus` (added before this plan, never shipped because its migration was never run) must be removed.
- Approval broadcasts to **every active employee** (name + dates only, no leave type/reason) — reuse the existing `broadcastNotification` helper, never a single-recipient shortcut (this exact bug already shipped once in this codebase and must not repeat).
- `leave_requests`' RLS policy (`lr_select_own`) only allows a session to see its own rows, or an hr/admin/manager session to see all rows. A regular employee's session querying "upcoming approved leave company-wide" directly against this table would be silently filtered to only their own rows (the exact bug class that shipped in the Attendance Overhaul's `employees_select_own` policy) — this must go through a `SECURITY DEFINER` RPC instead, not a direct table query.
- All new/modified date math must be consistent with this codebase's existing UTC convention (`toISOString().split('T')[0]`) where relevant to date-only comparisons.

---

### Task 1: Database migration — unpaid columns + upcoming-leave RPC

**Files:**
- Modify: `supabase_migration_unpaid_leave.sql` (already exists in the repo root, drafted previously but never run — you are extending it, not replacing it)

**Interfaces:**
- Produces: two already-drafted columns (`leave_requests.unpaid_days`, `leave_requests.paid_days`, `leave_balances.unpaid_days_taken` — all already present in the file), plus a new function `get_upcoming_approved_leaves(as_of_date DATE, max_rows INT DEFAULT 10)` returning `TABLE(employee_id UUID, full_name TEXT, avatar_initials TEXT, from_date DATE, to_date DATE)`.

- [ ] **Step 1: Read the current file**

Read `supabase_migration_unpaid_leave.sql` in full. It currently contains:
```sql
-- ============================================================
-- STRIDE — UNPAID LEAVE MIGRATION
-- Run in: Supabase Dashboard → SQL Editor
-- Run on BOTH production and test projects
-- ============================================================

-- Add unpaid tracking to leave_requests
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS unpaid_days NUMERIC(5,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_days   NUMERIC(5,1) DEFAULT 0;

-- Add unpaid total to leave_balances
ALTER TABLE leave_balances
  ADD COLUMN IF NOT EXISTS unpaid_days_taken NUMERIC(5,1) DEFAULT 0;

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'leave_requests'
  AND column_name IN ('unpaid_days', 'paid_days')
ORDER BY column_name;
```
Confirm this matches before editing — if it doesn't, STOP and escalate rather than guessing.

- [ ] **Step 2: Append the RPC function**

Add this block after the `ALTER TABLE leave_balances` statement and before the final `-- Verify` block:

```sql
-- ─── UPCOMING APPROVED LEAVE (company-wide, RLS-safe) ─────────────────────
-- leave_requests' RLS policy (lr_select_own) only lets a session see its
-- own rows, or an hr/admin/manager session see all rows. A regular
-- employee's session querying this table directly for "everyone's
-- upcoming leave" would be silently filtered to just their own rows — no
-- error, just wrong data. This SECURITY DEFINER function (matching the
-- existing get_hr_admin_employee_ids pattern) exposes only the minimal
-- fields needed for the company-wide "who's upcoming on leave" view,
-- for ANY authenticated caller, regardless of role.
CREATE OR REPLACE FUNCTION get_upcoming_approved_leaves(as_of_date DATE, max_rows INT DEFAULT 10)
RETURNS TABLE(employee_id UUID, full_name TEXT, avatar_initials TEXT, from_date DATE, to_date DATE) AS $$
  SELECT e.id, e.full_name, e.avatar_initials, lr.from_date, lr.to_date
  FROM leave_requests lr
  JOIN employees e ON e.id = lr.employee_id
  WHERE lr.status = 'approved' AND lr.to_date >= as_of_date
  ORDER BY lr.from_date ASC
  LIMIT max_rows;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

- [ ] **Step 3: Self-review**

Confirm the RPC's `RETURNS TABLE` only exposes `employee_id, full_name, avatar_initials, from_date, to_date` — no `leave_type`, no `reason`, matching the spec's privacy requirement (name + dates only). Confirm `LANGUAGE sql SECURITY DEFINER STABLE` matches the exact style of the existing `get_hr_admin_employee_ids` function (check `supabase_migration_hr_admin_lookup.sql` for the reference pattern if you want to compare).

- [ ] **Step 4: Commit**

```bash
git add supabase_migration_unpaid_leave.sql
git commit -m "Add get_upcoming_approved_leaves RPC to the unpaid-leave migration"
```

---

### Task 2: `applyLeave` — unpaid flag + upfront balance blocking (TDD)

**Files:**
- Modify: `src/lib/api.js:81-119` (the `applyLeave` function)
- Test: `src/tests/api.leave.test.js`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `applyLeave({ employeeId, leaveType, fromDate, toDate, days, reason, isHalfDay, isUnpaid })` — adds a new `isUnpaid` parameter (default `false`) to the existing signature. Later tasks (Task 5, the UI) call this with `isUnpaid` set from the new checkbox.

- [ ] **Step 1: Read the current file**

Read `src/lib/api.js` in full (it's ~420 lines) to confirm the current exact content of `applyLeave` (lines 81-119) matches what's shown below, and to see the existing test file's mocking conventions before writing new tests.

- [ ] **Step 2: Write the failing tests**

Add to `src/tests/api.leave.test.js`, inside the existing `describe('applyLeave', ...)` block (after the existing tests, before the closing `})`):

```javascript
it('when isUnpaid is true, does NOT check balance and inserts with unpaid_days = days, paid_days = 0', async () => {
  const mockLeave = { id: 'leave-unpaid', ...leaveData, status: 'pending' }
  let insertedRow

  supabase.from.mockImplementation(table => {
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
  // Balance must never be queried for an unpaid request
  expect(supabase.from).not.toHaveBeenCalledWith('leave_balances')
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/tests/api.leave.test.js -t "isUnpaid"`
Expected: FAIL — `applyLeave` doesn't yet accept/handle `isUnpaid`, and the balance-check throw doesn't exist.

- [ ] **Step 4: Write the implementation**

Replace `applyLeave` in `src/lib/api.js` (lines 81-119) with:

```javascript
export async function applyLeave({ employeeId, leaveType, fromDate, toDate, days, reason, isHalfDay = false, isUnpaid = false }) {
  let paidDays = days
  let unpaidDays = 0

  if (isUnpaid) {
    paidDays = 0
    unpaidDays = days
  } else {
    // Block upfront if the request exceeds remaining balance — no silent
    // auto-split at approval time. The employee decides now, not HR later.
    const year = new Date(fromDate).getFullYear()
    const { data: bal } = await supabase
      .from('leave_balances')
      .select('id, total_days, used_days')
      .eq('employee_id', employeeId)
      .eq('leave_type', leaveType)
      .eq('year', year)
      .maybeSingle()

    const available = bal ? Math.max(0, Number(bal.total_days) - Number(bal.used_days || 0)) : 0
    if (days > available) {
      throw new Error(`You only have ${available} day${available !== 1 ? 's' : ''} remaining — reduce the dates or mark this as unpaid leave.`)
    }
  }

  const { data, error } = await supabase
    .from('leave_requests')
    .insert({
      employee_id: employeeId,
      leave_type:  leaveType,
      from_date:   fromDate,
      to_date:     toDate,
      days,
      reason,
      is_half_day: isHalfDay,
      status:      'pending',
      paid_days:   paidDays,
      unpaid_days: unpaidDays,
    })
    .select('*')
    .single()
  if (error) throw error

  // Notify HR + Admin
  // RPC, not a direct table query — the employees_select_own RLS policy
  // would otherwise silently return zero rows for a regular employee's
  // session, so the notification would never be created (no error).
  try {
    const { data: hrAdmins } = await supabase
      .rpc('get_hr_admin_employee_ids', { exclude_id: employeeId })
    if (hrAdmins?.length) {
      await supabase.from('notifications').insert(
        hrAdmins.map(hr => ({
          employee_id: hr.id,
          type: 'leave_request',
          title: '🏖️ New Leave Request',
          message: 'An employee applied for ' + leaveType.replace(/_/g, ' ') + ' leave (' + days + ' day' + (days !== 1 ? 's' : '') + ') from ' + fromDate + ' to ' + toDate + '.',
          is_read: false,
        }))
      )
    }
  } catch (e) { console.warn('Leave apply notification failed:', e.message) }

  return data
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/tests/api.leave.test.js`
Expected: PASS — all tests in this file, including the 3 new ones and every pre-existing `applyLeave` test (the pre-existing "inserts a leave request with pending status" test doesn't pass `isUnpaid`, so it defaults to `false`; confirm its mock setup either already includes a `leave_balances` handler or update it minimally to avoid an "Unexpected table" throw — read the existing test first to see its current mock shape before deciding).

- [ ] **Step 6: Commit**

```bash
git add src/lib/api.js src/tests/api.leave.test.js
git commit -m "Add unpaid-leave flag and upfront balance blocking to applyLeave"
```

---

### Task 3: `updateLeaveStatus` — remove auto-split, add approval broadcast (TDD)

**Files:**
- Modify: `src/lib/api.js:121-182` (the `updateLeaveStatus` function)
- Test: `src/tests/api.leave.test.js`

**Interfaces:**
- Consumes: `broadcastNotification` from `./api.notifications` (already exists, signature `{ type, title, message, metadata = {}, excludeEmployeeId = null }`, does a bulk insert with no `.select()` chained — already RLS-safe, confirmed in an earlier feature's final review).
- Produces: `updateLeaveStatus(leaveId, status, reviewedBy)` — same signature as today, but the paid/unpaid split calculation is removed (the split was already decided at `applyLeave` time by Task 2) and a company-wide broadcast is added on approval.

- [ ] **Step 1: Read the current file**

Read the current `updateLeaveStatus` (lines 121-182 of `src/lib/api.js`) and confirm it matches what's shown in the "before" block below, allowing for minor line-number drift.

- [ ] **Step 2: Write the failing tests**

Add to `src/tests/api.leave.test.js`, in a new `describe('updateLeaveStatus', ...)` block (or the existing one if `src/tests/api.leave.test.js` already has one — read the file first and add to the existing block if present, matching its established mocking conventions rather than creating a duplicate describe):

```javascript
it('on approval, still deducts used_days from balance (paid-request path unaffected by removing auto-split)', async () => {
  const mockLeave = { id: 'leave-1', employee_id: 'emp-1', leave_type: 'casual_sick', from_date: '2026-07-15', to_date: '2026-07-15', days: 1, status: 'approved' }
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

  await updateLeaveStatus('leave-1', 'approved', 'reviewer-1')

  // used_days should simply be incremented by the request's day-count —
  // no paid/unpaid split calculation should run here anymore.
  expect(balUpdatePayload).toEqual({ used_days: 3 })
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
```

Note: this file will need `broadcastNotification` mocked at module level. Check the top of `src/tests/api.leave.test.js` for an existing `vi.mock('../lib/api.notifications', ...)` block — if one exists, add `broadcastNotification: vi.fn(() => Promise.resolve())` to it; if none exists, add:
```javascript
vi.mock('../lib/api.notifications', () => ({
  broadcastNotification: vi.fn(() => Promise.resolve()),
}))
```
at the top of the file, and import it: `import { broadcastNotification } from '../lib/api.notifications'`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/tests/api.leave.test.js -t "updateLeaveStatus"`
Expected: FAIL — the auto-split logic is still present (so the "does not write paid_days/unpaid_days" test fails), and `broadcastNotification` isn't called yet.

- [ ] **Step 4: Write the implementation**

Replace `updateLeaveStatus` in `src/lib/api.js` (lines 121-182) with:

```javascript
export async function updateLeaveStatus(leaveId, status, reviewedBy) {
  const { data, error } = await supabase
    .from('leave_requests')
    .update({
      status,
      reviewed_by:  reviewedBy,
      reviewed_at:  new Date().toISOString(),
    })
    .eq('id', leaveId)
    .select('*, employee:employee_id(full_name)')
    .single()
  if (error) throw error

  // Update leave balance if approved — the paid/unpaid split was already
  // decided by the employee at apply time (see applyLeave), so this only
  // ever adds the full requested day-count to used_days for a paid
  // request. Unpaid requests never touch leave_balances at all (bypassed
  // entirely at apply time), so this block only runs for paid approvals.
  if (status === 'approved') {
    const leave = data
    const year = new Date(leave.from_date).getFullYear()
    const { data: bal } = await supabase
      .from('leave_balances')
      .select('id, used_days')
      .eq('employee_id', leave.employee_id)
      .eq('leave_type', leave.leave_type)
      .eq('year', year)
      .maybeSingle()

    if (bal) {
      const newUsed = Number(bal.used_days || 0) + Number(leave.days)
      const { error: balErr } = await supabase
        .from('leave_balances')
        .update({ used_days: newUsed })
        .eq('id', bal.id)
      if (balErr) console.error('Balance update error:', balErr.message)
    }

    // Team-wide visibility — name + dates only, no leave type or reason.
    try {
      await broadcastNotification({
        type: 'leave_approved_team',
        title: '🏖️ Team Leave',
        message: `${data.employee?.full_name || 'An employee'} is on leave ${leave.from_date}${leave.from_date !== leave.to_date ? ` – ${leave.to_date}` : ''}.`,
        metadata: { leave_id: leaveId },
      })
    } catch (e) { console.warn('Leave approval broadcast failed:', e.message) }
  }

  // Notify employee of decision
  try {
    const isApproved = status === 'approved'
    await supabase.from('notifications').insert({
      employee_id: data.employee_id,
      type:    isApproved ? 'leave_approved' : 'leave_rejected',
      title:   isApproved ? '✅ Leave Approved' : '❌ Leave Rejected',
      message: `Your ${data.leave_type?.replace('_', ' ')} leave from ${data.from_date} to ${data.to_date} has been ${status}.`,
      is_read: false,
    })
  } catch (e) { console.warn('Leave notification failed:', e.message) }

  return data
}
```

Also add the import at the top of `src/lib/api.js`, near any existing imports from that module (check if `./api.notifications` is already imported anywhere in this file first — if not, add a new import line):
```javascript
import { broadcastNotification } from './api.notifications'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/tests/api.leave.test.js`
Expected: PASS — all tests in this file.

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npm test`
Expected: PASS — every test in the repo. Pay particular attention to any pre-existing test that asserted on the OLD `select('*')` shape from `updateLeaveStatus` (now `select('*, employee:employee_id(full_name)')`) — if any pre-existing test's mock doesn't account for the joined `employee` field and fails, update that mock to match, don't work around it by reverting the select.

- [ ] **Step 7: Commit**

```bash
git add src/lib/api.js src/tests/api.leave.test.js
git commit -m "Remove auto-split from updateLeaveStatus; broadcast team-wide notification on approval"
```

---

### Task 4: `cancelLeave` — reverse unpaid_days_taken on cancellation (TDD)

**Files:**
- Modify: `src/lib/api.js` (the `cancelLeave` function, currently starting around line 186)
- Test: `src/tests/api.leave.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `cancelLeave(leaveId, employeeId)` — same signature, extended to also reverse `unpaid_days_taken` when the cancelled leave had `unpaid_days > 0`.

- [ ] **Step 1: Read the current file**

Read `cancelLeave` in `src/lib/api.js` in full (starting around line 186) to confirm its current exact structure before editing — specifically confirm the existing `leave.status === 'approved'` balance-restoration block and how it fetches/updates `leave_balances`.

- [ ] **Step 2: Write the failing test**

Add to `src/tests/api.leave.test.js`, in the existing `describe('cancelLeave', ...)` block if one exists (read the file first; add to it if present, matching its conventions):

```javascript
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

  await cancelLeave('leave-1', 'emp-1')

  // used_days must be unaffected (this leave never touched it), and
  // unpaid_days_taken must drop back to 0.
  expect(balUpdatePayload.used_days).toBe(5)
  expect(balUpdatePayload.unpaid_days_taken).toBe(0)
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

  await cancelLeave('leave-1', 'emp-1')

  expect(balUpdatePayload.used_days).toBe(3) // 5 - 2
  expect(balUpdatePayload.unpaid_days_taken).toBe(0) // unchanged, was already 0
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/tests/api.leave.test.js -t "unpaid_days_taken"`
Expected: FAIL — `cancelLeave` doesn't yet read/reverse `unpaid_days`/`unpaid_days_taken`.

- [ ] **Step 4: Write the implementation**

Locate the existing balance-restoration block inside `cancelLeave`:

```javascript
  // Restore balance if leave was approved
  if (leave.status === 'approved') {
    const year = new Date(leave.from_date).getFullYear()
    const { data: bal } = await supabase
      .from('leave_balances')
      .select('id, used_days')
      .eq('employee_id', leave.employee_id)
      .eq('leave_type', leave.leave_type)
      .eq('year', year)
      .maybeSingle()
    if (bal) {
      const restored = Math.max(0, (bal.used_days || 0) - Number(leave.days))
      await supabase.from('leave_balances').update({ used_days: restored }).eq('id', bal.id)
    }
  }
```

Replace it with:

```javascript
  // Restore balance if leave was approved. paid_days reverses used_days
  // (as before); unpaid_days reverses unpaid_days_taken instead — these
  // were split at apply time (see applyLeave), never both nonzero for the
  // same request.
  if (leave.status === 'approved') {
    const year = new Date(leave.from_date).getFullYear()
    const { data: bal } = await supabase
      .from('leave_balances')
      .select('id, used_days, unpaid_days_taken')
      .eq('employee_id', leave.employee_id)
      .eq('leave_type', leave.leave_type)
      .eq('year', year)
      .maybeSingle()
    if (bal) {
      const restoredUsed   = Math.max(0, (bal.used_days || 0) - Number(leave.paid_days || 0))
      const restoredUnpaid = Math.max(0, (bal.unpaid_days_taken || 0) - Number(leave.unpaid_days || 0))
      await supabase.from('leave_balances').update({ used_days: restoredUsed, unpaid_days_taken: restoredUnpaid }).eq('id', bal.id)
    }
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/tests/api.leave.test.js`
Expected: PASS — all tests in this file, including pre-existing `cancelLeave` tests (a pre-existing test using `leave.days` without `paid_days`/`unpaid_days` set would now compute `restoredUsed` from `undefined` treated as `0` via `Number(leave.paid_days || 0)` — if a pre-existing test's fixture doesn't set `paid_days`, its expected `used_days` restoration value may need updating; read the existing test and its fixture before assuming it still passes unmodified).

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — every test in the repo.

- [ ] **Step 7: Commit**

```bash
git add src/lib/api.js src/tests/api.leave.test.js
git commit -m "Reverse unpaid_days_taken (not used_days) when cancelling unpaid leave"
```

---

### Task 5: Apply form UI — unpaid checkbox + blocking error display

**Files:**
- Modify: `src/pages/employee/LeavePage.jsx` (the `ApplyForm` component, currently starting around line 55)

**Interfaces:**
- Consumes: `applyLeave` from `../../lib/api` with its new `isUnpaid` parameter (Task 2).

- [ ] **Step 1: Read the current file**

Read the full current `ApplyForm` component in `src/pages/employee/LeavePage.jsx` (lines 54-168 or thereabouts) to confirm its exact current structure — the `form` state shape, the existing "unpaid warning" preview block (`unpaidWarning`, lines ~96-114 per the earlier exploration), and how errors are currently displayed (`error` state + `<Alert type="error" message={error} />`), before making any changes.

- [ ] **Step 2: Add the checkbox to form state and the submit handler**

In the `ApplyForm` component:
1. Add `isUnpaid: false` to the initial `form` state object (alongside the existing `leaveType`, `fromDate`, `toDate`, `reason`, `isHalfDay`).
2. In the `submit()` function, pass `isUnpaid: form.isUnpaid` to the `applyLeave(...)` call.
3. Reset `isUnpaid: false` in the `setForm(...)` call after a successful submission, alongside the other fields already being reset.

- [ ] **Step 3: Add the checkbox UI**

Add a toggle matching the existing "Half Day Leave" toggle's visual style (same component right below it in the JSX, following the exact same pattern — a clickable row with a pill-style switch), with label "Take this as unpaid leave" and helper text "Won't count against your leave balance." Wire its `onClick`/state exactly like the existing half-day toggle does (`onClick={() => setForm(f => ({ ...f, isUnpaid: !f.isUnpaid }))}`).

- [ ] **Step 4: Update the existing unpaid-preview warning block**

The current `unpaidWarning` block (computed via `_selBal`/`_available`/`_unpaid`) previews what WOULD become unpaid under the old automatic-split model. Since that model is being replaced:
- When `form.isUnpaid` is `true`: don't show the old warning at all (there's no "shortfall" concept anymore — the whole request is unpaid by choice). Instead show a neutral confirmation, e.g.: "This leave will not be deducted from your balance."
- When `form.isUnpaid` is `false`: keep computing `_available` the same way, but if `days > _available`, this is now a **blocking** condition, not just a warning — show the error inline (same style as the existing amber warning box is fine visually, but the copy should make clear the request will be rejected on submit if unchanged, e.g. "You only have X days remaining — this request will be blocked unless you reduce the dates or mark it unpaid.").

The actual block/allow enforcement itself lives server-side in `applyLeave` (Task 2) — this UI change is about giving the employee an accurate heads-up before they click submit, not implementing the check twice. If they submit anyway and it's blocked, the existing `catch (e) { setError(e.message) }` path in `submit()` will surface the thrown error from `applyLeave` correctly with no further changes needed.

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: succeeds with no new errors.

- [ ] **Step 6: Manual verification note**

Document in the final report that live browser verification of the checkbox toggling, the updated warning copy, and the actual blocked-submission flow should be done via a dev server + real Supabase session if available in this session's environment; if not possible, note this explicitly rather than claiming it was tested.

- [ ] **Step 7: Commit**

```bash
git add src/pages/employee/LeavePage.jsx
git commit -m "Add unpaid-leave checkbox and upfront-block messaging to Apply form"
```

---

### Task 6: `getUpcomingApprovedLeaves` + Dashboard "Upcoming Leave" widget

**Files:**
- Modify: `src/lib/api.js` (add one new function)
- Modify: `src/pages/employee/DashboardPage.jsx`

**Interfaces:**
- Consumes: the `get_upcoming_approved_leaves` RPC from Task 1.
- Produces: `getUpcomingApprovedLeaves(limit = 10)` → `Promise<Array<{employee_id, full_name, avatar_initials, from_date, to_date}>>`. A new `UpcomingLeaveCard({ leaves })` component rendered in `EmployeeDashboard` (and, since the widget is company-wide and not admin-only, also visible when `isHR` — confirm by reading `AdminDashboard`'s current structure whether it shares layout with `EmployeeDashboard` or is fully separate, and place the widget in whichever component(s) are actually rendered for every logged-in user, not just one variant).

- [ ] **Step 1: Read the current files**

Read `src/lib/api.js`'s existing RPC-calling functions for the established pattern (e.g. how `get_hr_admin_employee_ids` is called elsewhere in this codebase via `supabase.rpc(...)`). Read the full current `src/pages/employee/DashboardPage.jsx` — specifically the `WeeklyHoursCard` component (as a close analog: a small self-contained presentational card taking pre-loaded data as a prop, not doing its own fetching) and the `baseLoads`/`Promise.all` destructuring pattern in `DashboardPage()` (lines ~480-511 per the earlier exploration) — to confirm the exact current structure before editing.

- [ ] **Step 2: Add `getUpcomingApprovedLeaves` to `src/lib/api.js`**

Add near the other leave-related functions (e.g. after `getAllLeaveRequests`):

```javascript
// ─── UPCOMING APPROVED LEAVE (company-wide) ────────────────────────────────
export async function getUpcomingApprovedLeaves(limit = 10) {
  const todayStr = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .rpc('get_upcoming_approved_leaves', { as_of_date: todayStr, max_rows: limit })
  if (error) throw error
  return data || []
}
```

- [ ] **Step 3: Add the `UpcomingLeaveCard` component and wire it into `DashboardPage.jsx`**

In `src/pages/employee/DashboardPage.jsx`:

1. Add `getUpcomingApprovedLeaves` to the existing import from `'../../lib/api'`.
2. Add a new component, placed near `WeeklyHoursCard` (matching its style conventions — read `WeeklyHoursCard`'s actual current styling before writing this, since the brief can't see the file's exact current design tokens):

```jsx
function UpcomingLeaveCard({ leaves }) {
  if (!leaves || leaves.length === 0) return null
  return (
    <Card style={{ padding: '16px 18px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🏖️ Upcoming Leave</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {leaves.map(l => (
          <div key={`${l.employee_id}-${l.from_date}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Avatar initials={l.avatar_initials || '??'} size={26} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{l.full_name}</div>
              <div style={{ fontSize: 10, color: '#888' }}>
                {l.from_date}{l.from_date !== l.to_date ? ` – ${l.to_date}` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
```

Adjust the exact `Card`/`Avatar` import paths and style values to match whatever `WeeklyHoursCard` and the rest of this file actually use — this is a starting point, not a verbatim requirement, since the brief was written without direct sight of this file's current styling conventions. Verify `Avatar` is already imported in this file (it likely is, given other dashboard cards use avatars); if not, add it to the existing UI-kit import.

3. Add `upcomingLeaves` state: `const [upcomingLeaves, setUpcomingLeaves] = useState([])`.
4. Add `getUpcomingApprovedLeaves()` to the `baseLoads` array (append it, don't insert in the middle — this avoids any risk of shifting the positional destructuring for existing entries, matching the exact lesson from an earlier feature in this codebase where a mid-array insertion once risked corrupting sibling data; appending at the end means every existing destructured variable keeps its position).
5. Update the destructuring in the `.then([...])` callback to capture the new trailing value and call `setUpcomingLeaves(...)`.
6. Render `<UpcomingLeaveCard leaves={upcomingLeaves} />` in both `EmployeeDashboard` and `AdminDashboard` (read both components first to confirm whether they're structurally separate enough that the card needs to be added to each individually, or whether one shared wrapper renders both — adapt to what you actually find).

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: succeeds with no new errors.

- [ ] **Step 5: Self-review**

Confirm `getUpcomingApprovedLeaves` calls `supabase.rpc('get_upcoming_approved_leaves', ...)` — not a direct `.from('leave_requests')` query, since that would hit the RLS self-scoping trap described in the Global Constraints. Confirm the new `baseLoads` entry was appended at the end of the array, not inserted in the middle, and that the destructuring was updated to match.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api.js src/pages/employee/DashboardPage.jsx
git commit -m "Add company-wide Upcoming Leave widget to the employee Dashboard"
```

---

### Task 7: Final verification pass

**Files:** None (verification only, matching the pattern used at the end of prior features in this codebase).

**Interfaces:** None.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — every test, including all pre-existing suites.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 3: Run lint and diff against the pre-feature baseline**

Run: `npx eslint src/lib/api.js src/pages/employee/LeavePage.jsx src/pages/employee/DashboardPage.jsx`
Compare any findings against `git show main:<file>` (or the commit before Task 1) to confirm any reported issues are pre-existing, not newly introduced by this feature.

- [ ] **Step 4: Explicit RLS/broadcast/blocking self-review checklist**

Confirm, by re-reading the relevant code (not just recalling intent):
- `getUpcomingApprovedLeaves` (Task 6) goes through the `get_upcoming_approved_leaves` RPC, never a direct `leave_requests` table query.
- `updateLeaveStatus`'s approval broadcast (Task 3) uses `broadcastNotification` (which internally does a bulk insert with no `.select()` chained), not a hand-rolled single-recipient notification.
- `applyLeave`'s blocking check (Task 2) genuinely prevents the insert from happening when over balance and unpaid isn't checked — re-read the function to confirm the `throw` happens before the `leave_requests` insert, not after.
- `cancelLeave`'s reversal logic (Task 4) correctly distinguishes `paid_days` (reverses `used_days`) from `unpaid_days` (reverses `unpaid_days_taken`) and doesn't double-reverse or cross-apply either.

- [ ] **Step 5: Manual verification note**

Document in the final report: full manual browser verification (checking the checkbox actually toggles, the blocked-submission error displays correctly, the Dashboard widget renders real company-wide data, and the approval broadcast is received by a second test account) requires either a live dev server + real Supabase session or the user's own manual pass after this migration is run in their Supabase projects — note explicitly which of these were or weren't possible in this session's environment, don't claim untested behavior as verified.
