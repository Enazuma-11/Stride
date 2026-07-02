# Holiday Opt-In Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let employees individually opt into `type='optional'` holidays (public/company holidays stay mandatory for everyone), via two fixed annual windows, with shared visibility into who opted into what and scheduled reminder notifications.

**Architecture:** Two new tables (`holiday_optins`, `holiday_optin_submissions`) plus a new `src/lib/api.holidayOptins.js` module following this codebase's established per-feature-file pattern (mirroring `api.attendanceRegularization.js`). The monthly absence-reminder in `api.notifications.js` is updated to treat `optional` holidays as per-employee rather than blanket-excluded. Two new scheduled-notification blocks are added to the existing `runDailyChecks` function.

**Tech Stack:** React + Vite, Supabase (Postgres + RLS + PostgREST), Vitest.

## Global Constraints

- Windows are fixed and automatic: **Jan 1–14** (picks for the whole year) and **Jul 1–14** (revise Jul–Dec only; Jan–Jun locked once passed). All window/date math is UTC-based, matching this codebase's existing convention (`toISOString().split('T')[0]`).
- No cap on how many optional holidays an employee may select.
- Default when a window is not acted on: **opted out of everything** for that window.
- Opting in = personal day off, no check-in expected, doesn't count against attendance for that employee. Not opting in = normal working day for that employee.
- Shared visibility: **any** employee (not just HR) can see who opted into a given optional holiday.
- Notifications: window-open (all active employees) and a not-yet-responded reminder in the last 4 days of the window (only to employees without a submission row for that window) — **broadcast to every eligible recipient, never `list[0]` only** (this exact bug shipped once already in the Attendance Overhaul and must not repeat).
- RLS: employees manage their own `holiday_optins`/`holiday_optin_submissions` rows; a separate permissive SELECT policy lets everyone read all rows of both tables (no HR-only gating).
- No `.select()` chained after any `notifications` insert for a recipient other than the caller — this triggers a RETURNING-clause RLS failure even when the INSERT's own policy passes (this exact bug shipped once already in the Attendance Overhaul).

---

### Task 1: Database migration — `holiday_optins` and `holiday_optin_submissions`

**Files:**
- Create: `supabase_migration_holiday_optins.sql`

**Interfaces:**
- Produces: two new tables, `holiday_optins(id, employee_id, holiday_id, created_at)` and `holiday_optin_submissions(id, employee_id, window_label, confirmed_at)`, both RLS-enabled with a self-manage + everyone-can-read policy pair.

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- STRIDE — HOLIDAY OPT-IN CALENDAR
-- Run in: Supabase Dashboard → SQL Editor (both Production and Test projects)
--
-- Why: employees now individually choose which `type='optional'` holidays
-- they personally observe (public/company holidays stay mandatory for
-- everyone, unchanged). Two annual windows: Jan 1-14 (whole year),
-- Jul 1-14 (revise Jul-Dec only). See
-- docs/superpowers/specs/2026-07-02-holiday-optin-design.md.
-- ============================================================

CREATE TABLE IF NOT EXISTS holiday_optins (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  holiday_id   UUID NOT NULL REFERENCES holidays(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, holiday_id)
);

CREATE TABLE IF NOT EXISTS holiday_optin_submissions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  window_label TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, window_label)
);

CREATE INDEX IF NOT EXISTS idx_holiday_optins_holiday ON holiday_optins (holiday_id);
CREATE INDEX IF NOT EXISTS idx_holiday_optins_employee ON holiday_optins (employee_id);

ALTER TABLE holiday_optins            ENABLE ROW LEVEL SECURITY;
ALTER TABLE holiday_optin_submissions ENABLE ROW LEVEL SECURITY;

-- Everyone can see everyone's opt-ins (shared visibility — not HR-only)
DROP POLICY IF EXISTS "holiday_optins_select_all" ON holiday_optins;
CREATE POLICY "holiday_optins_select_all" ON holiday_optins
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Employees manage only their own opt-in rows
DROP POLICY IF EXISTS "holiday_optins_manage_own" ON holiday_optins;
CREATE POLICY "holiday_optins_manage_own" ON holiday_optins
  FOR INSERT WITH CHECK (employee_id = (SELECT id FROM employees WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "holiday_optins_delete_own" ON holiday_optins;
CREATE POLICY "holiday_optins_delete_own" ON holiday_optins
  FOR DELETE USING (employee_id = (SELECT id FROM employees WHERE user_id = auth.uid()));

-- Submissions: same shape — everyone can read, employees write only their own
DROP POLICY IF EXISTS "holiday_optin_submissions_select_all" ON holiday_optin_submissions;
CREATE POLICY "holiday_optin_submissions_select_all" ON holiday_optin_submissions
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "holiday_optin_submissions_manage_own" ON holiday_optin_submissions;
CREATE POLICY "holiday_optin_submissions_manage_own" ON holiday_optin_submissions
  FOR INSERT WITH CHECK (employee_id = (SELECT id FROM employees WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "holiday_optin_submissions_update_own" ON holiday_optin_submissions;
CREATE POLICY "holiday_optin_submissions_update_own" ON holiday_optin_submissions
  FOR UPDATE USING (employee_id = (SELECT id FROM employees WHERE user_id = auth.uid()));
```

- [ ] **Step 2: Self-review against the RLS lesson**

Confirm both SELECT policies use `auth.uid() IS NOT NULL` (any authenticated session, not `current_employee_role() IN ('hr','admin')`) — this is what makes the shared "who opted in" visibility work for every employee, not just HR. Confirm no policy on either table requires `.select()` after insert (the app code in Task 3 must not chain `.select()` on these inserts, for the same RETURNING-clause reason documented in Global Constraints).

- [ ] **Step 3: Commit**

```bash
git add supabase_migration_holiday_optins.sql
git commit -m "Add holiday_optins and holiday_optin_submissions tables migration"
```

---

### Task 2: Window computation helper (TDD)

**Files:**
- Create: `src/lib/api.holidayOptins.js`
- Test: `src/tests/api.holidayOptins.test.js`

**Interfaces:**
- Produces: `getOptinWindow(now = new Date())` → one of:
  - `{ isOpen: true, label: string, editableFromDate: string|null, closesOn: string }` when a window is currently open. `label` is `'<year>-H1'` or `'<year>-H2'`. `editableFromDate` is `null` for H1 (whole year editable) and `'<year>-07-01'` for H2 (only Jul–Dec editable). `closesOn` is the window's last day, `'<year>-01-14'` or `'<year>-07-14'`.
  - `{ isOpen: false, nextLabel: string, nextOpensOn: string }` when no window is open. `nextOpensOn` is the next Jan 1 or Jul 1, whichever is soonest after `now`.
- Consumes: nothing (pure function, no I/O).

- [ ] **Step 1: Write the failing tests**

```javascript
import { describe, it, expect } from 'vitest'
import { getOptinWindow } from '../lib/api.holidayOptins'

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tests/api.holidayOptins.test.js`
Expected: FAIL — `getOptinWindow` is not defined (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```javascript
import { supabase } from './supabase'

// ─── WINDOW COMPUTATION ────────────────────────────────────────────────────
// Two fixed annual windows, UTC-based (dates here are pure DATE values with
// no wall-clock component, so this doesn't carry the local/UTC clock-time
// bug class from the Attendance Overhaul — but day-boundary math still does).
export function getOptinWindow(now = new Date()) {
  const year  = now.getUTCFullYear()
  const day   = now.getUTCDate()
  const month = now.getUTCMonth() + 1 // 1-indexed

  const pad = n => String(n).padStart(2, '0')

  if (month === 1 && day >= 1 && day <= 14) {
    return {
      isOpen: true,
      label: `${year}-H1`,
      editableFromDate: null,
      closesOn: `${year}-01-14`,
    }
  }

  if (month === 7 && day >= 1 && day <= 14) {
    return {
      isOpen: true,
      label: `${year}-H2`,
      editableFromDate: `${year}-07-01`,
      closesOn: `${year}-07-14`,
    }
  }

  // Closed — figure out the next window
  if (month < 7 || (month === 7 && day < 1)) {
    // Before Jul 1 this year (and after Jan 14, since that case is handled above)
    return { isOpen: false, nextLabel: `${year}-H2`, nextOpensOn: `${year}-07-01` }
  }
  // On/after Jul 15 this year — next window is Jan 1 of next year
  return { isOpen: false, nextLabel: `${year + 1}-H1`, nextOpensOn: `${year + 1}-01-01` }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/api.holidayOptins.test.js`
Expected: PASS — all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.holidayOptins.js src/tests/api.holidayOptins.test.js
git commit -m "Add getOptinWindow with UTC day-boundary tests"
```

---

### Task 3: Core read/write API functions

**Files:**
- Modify: `src/lib/api.holidayOptins.js`
- Test: `src/tests/api.holidayOptins.test.js`

**Interfaces:**
- Consumes: `getOptinWindow` from Task 2 (used only by `saveMyHolidayOptins` to determine the current `window_label` — the caller is expected to have already checked `isOpen` before calling; `saveMyHolidayOptins` re-derives the label from `getOptinWindow(new Date())` rather than trusting a caller-supplied value, to avoid a client clock/label mismatch).
- Produces:
  - `getOptionalHolidaysForYear(year)` → `Promise<Array<{id, name, date, type, year}>>`
  - `getMyHolidayOptins(employeeId, year)` → `Promise<Array<string>>` (array of `holiday_id`s the employee has opted into, for optional holidays in that year)
  - `saveMyHolidayOptins(employeeId, editableHolidayIds, selectedHolidayIds)` → `Promise<void>`. `editableHolidayIds` is the full set of holiday IDs eligible for editing in the current window (already filtered by the caller using `getOptinWindow().editableFromDate`); `selectedHolidayIds` is the subset the employee wants opted-in. Replaces the employee's opt-in rows for exactly the editable set (delete-then-insert, matching the existing `hrSetSessions` "replace entirely" pattern) and writes/updates a `holiday_optin_submissions` row for the current window.
  - `getHolidayOptinRoster(holidayId)` → `Promise<Array<{employee_id, full_name, avatar_initials}>>`
  - `hasSubmittedForWindow(employeeId, windowLabel)` → `Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabase } from '../lib/supabase'
import {
  getOptionalHolidaysForYear,
  getMyHolidayOptins,
  saveMyHolidayOptins,
  getHolidayOptinRoster,
  hasSubmittedForWindow,
} from '../lib/api.holidayOptins'

beforeEach(() => {
  vi.clearAllMocks()
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

    // h2 was editable but not selected -> deleted; h1, h3 were selected -> not deleted
    expect(deletedIds).toEqual(['h2'])
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tests/api.holidayOptins.test.js`
Expected: FAIL — the five new functions are not defined.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/api.holidayOptins.js`:

```javascript
// ─── OPTIONAL HOLIDAYS ─────────────────────────────────────────────────────
export async function getOptionalHolidaysForYear(year) {
  const { data, error } = await supabase
    .from('holidays')
    .select('*')
    .eq('year', year)
    .eq('type', 'optional')
    .order('date', { ascending: true })
  if (error) throw error
  return data || []
}

// ─── MY OPT-INS ────────────────────────────────────────────────────────────
export async function getMyHolidayOptins(employeeId, year) {
  const { data, error } = await supabase
    .from('holiday_optins')
    .select('holiday_id, holiday:holiday_id(year)')
    .eq('employee_id', employeeId)
  if (error) throw error
  return (data || [])
    .filter(row => row.holiday?.year === year)
    .map(row => row.holiday_id)
}

// ─── SAVE MY OPT-INS (replace-entirely for the editable set) ───────────────
export async function saveMyHolidayOptins(employeeId, editableHolidayIds, selectedHolidayIds) {
  const selectedSet = new Set(selectedHolidayIds)
  const toDelete = editableHolidayIds.filter(id => !selectedSet.has(id))

  if (toDelete.length > 0) {
    await supabase
      .from('holiday_optins')
      .delete()
      .in('holiday_id', toDelete)
      .eq('employee_id', employeeId)
  }

  if (selectedHolidayIds.length > 0) {
    await supabase
      .from('holiday_optins')
      .insert(selectedHolidayIds.map(holidayId => ({
        employee_id: employeeId,
        holiday_id: holidayId,
      })))
  }

  const { label } = getOptinWindow(new Date())
  await supabase
    .from('holiday_optin_submissions')
    .upsert({ employee_id: employeeId, window_label: label, confirmed_at: new Date().toISOString() }, { onConflict: 'employee_id,window_label' })
}

// ─── SHARED VISIBILITY: WHO OPTED INTO A GIVEN HOLIDAY ──────────────────────
export async function getHolidayOptinRoster(holidayId) {
  const { data, error } = await supabase
    .from('holiday_optins')
    .select('employee_id, employee:employee_id(full_name, avatar_initials)')
    .eq('holiday_id', holidayId)
  if (error) throw error
  return (data || []).map(row => ({
    employee_id: row.employee_id,
    full_name: row.employee?.full_name,
    avatar_initials: row.employee?.avatar_initials,
  }))
}

// ─── HAS THIS EMPLOYEE ALREADY CONFIRMED FOR THE CURRENT WINDOW? ────────────
export async function hasSubmittedForWindow(employeeId, windowLabel) {
  const { data } = await supabase
    .from('holiday_optin_submissions')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('window_label', windowLabel)
    .maybeSingle()
  return !!data
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/api.holidayOptins.test.js`
Expected: PASS — all tests from Task 2 and Task 3.

- [ ] **Step 5: Self-review against the RLS lesson**

Confirm none of these functions chain `.select()` after an `insert`/`delete`/`upsert` on `holiday_optins` or `holiday_optin_submissions` — matching the Global Constraints rule. Confirm `saveMyHolidayOptins` re-derives `window_label` from `getOptinWindow(new Date())` server-side (well, client-side but freshly computed) rather than trusting any caller-supplied label.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api.holidayOptins.js src/tests/api.holidayOptins.test.js
git commit -m "Add core holiday opt-in read/write API functions"
```

---

### Task 4: Employee UI — Holiday Calendar panel

**Files:**
- Create: `src/components/HolidayOptinPanel.jsx`
- Modify: `src/pages/employee/LeavePage.jsx`

**Interfaces:**
- Consumes: `getOptinWindow`, `getOptionalHolidaysForYear`, `getMyHolidayOptins`, `saveMyHolidayOptins`, `getHolidayOptinRoster`, `hasSubmittedForWindow` from Task 2/3. `todayISO` from `../lib/api.attendance` (already exported, used elsewhere in this codebase for "current year" derivation). `Card`, `Button`, `Spinner`, `Alert`, `Avatar` from `../components/ui` (existing UI kit already used by `RegularizationForm.jsx`/`RegularizationQueue.jsx` — read those two files first for exact import paths and styling conventions before writing this component).
- Produces: default-exported `HolidayOptinPanel({ employeeId })` component, self-contained (does its own data loading), to be rendered inside a new tab on `LeavePage.jsx`.

- [ ] **Step 1: Read existing UI conventions**

Read `src/components/RegularizationForm.jsx` and `src/components/RegularizationQueue.jsx` in full to confirm the exact `Card`/`Button`/`Alert`/`Avatar` import paths, the `C`/`FONTS` design-token import from `../lib/constants`, and general styling conventions (inline `style={{...}}` objects, no CSS modules) used throughout this codebase, before writing any JSX below.

- [ ] **Step 2: Write `HolidayOptinPanel.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { Card, Button, Spinner, Alert, Avatar, EmptyState } from './ui'
import { C, FONTS } from '../lib/constants'
import { todayISO } from '../lib/api.attendance'
import {
  getOptinWindow, getOptionalHolidaysForYear, getMyHolidayOptins,
  saveMyHolidayOptins, getHolidayOptinRoster, hasSubmittedForWindow,
} from '../lib/api.holidayOptins'

function RosterRow({ holidayId, expanded, onToggle }) {
  const [roster, setRoster] = useState(null)

  useEffect(() => {
    if (expanded && roster === null) {
      getHolidayOptinRoster(holidayId).then(setRoster)
    }
  }, [expanded, holidayId, roster])

  if (!expanded) return null
  return (
    <div style={{ padding: '8px 0 0 0', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {roster === null ? (
        <Spinner size={14} />
      ) : roster.length === 0 ? (
        <span style={{ fontSize: 11, color: C.textLight }}>No one else has opted in yet.</span>
      ) : (
        roster.map(r => (
          <div key={r.employee_id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Avatar initials={r.avatar_initials || '??'} size={20} />
            <span style={{ fontSize: 11, color: C.textMid }}>{r.full_name}</span>
          </div>
        ))
      )}
    </div>
  )
}

export default function HolidayOptinPanel({ employeeId }) {
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [window_, setWindow]    = useState(null)
  const [holidays, setHolidays] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [expandedId, setExpandedId] = useState(null)
  const [alreadySubmitted, setAlreadySubmitted] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const win = getOptinWindow(new Date())
      setWindow(win)

      const year = Number(todayISO().split('-')[0])
      const [yearHolidays, myOptins] = await Promise.all([
        getOptionalHolidaysForYear(year),
        getMyHolidayOptins(employeeId, year),
      ])
      setHolidays(yearHolidays)
      setSelected(new Set(myOptins))

      if (win.isOpen) {
        const submitted = await hasSubmittedForWindow(employeeId, win.label)
        setAlreadySubmitted(submitted)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [employeeId])

  function toggle(holidayId) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(holidayId)) next.delete(holidayId)
      else next.add(holidayId)
      return next
    })
  }

  const editableHolidays = window_?.isOpen
    ? holidays.filter(h => !window_.editableFromDate || h.date >= window_.editableFromDate)
    : []
  const editableIds = editableHolidays.map(h => h.id)

  async function handleSave() {
    setSaving(true); setError('')
    try {
      await saveMyHolidayOptins(
        employeeId,
        editableIds,
        editableIds.filter(id => selected.has(id))
      )
      setAlreadySubmitted(true)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={28} /></div>

  return (
    <Card padding="0">
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>
          🎉 Holiday Calendar
        </div>
        {window_?.isOpen ? (
          <div style={{ fontSize: 12, color: C.textLight, marginTop: 4 }}>
            {window_.editableFromDate
              ? `Window open through ${window_.closesOn} — you can revise picks from ${window_.editableFromDate} onward.`
              : `Window open through ${window_.closesOn} — pick your optional holidays for the year.`}
            {alreadySubmitted && ' You’ve already confirmed your picks — you can still make changes until the window closes.'}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: C.textLight, marginTop: 4 }}>
            Picks are locked outside the submission window. Next window opens {window_?.nextOpensOn}.
          </div>
        )}
      </div>

      {error && <div style={{ padding: '12px 24px 0' }}><Alert type="error" message={error} /></div>}

      {holidays.length === 0 ? (
        <EmptyState icon="🎉" title="No optional holidays published for this year yet" />
      ) : (
        <div>
          {holidays.map(h => {
            const isEditable = window_?.isOpen && editableIds.includes(h.id)
            return (
              <div key={h.id} style={{ padding: '14px 24px', borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={selected.has(h.id)}
                    disabled={!isEditable}
                    onChange={() => toggle(h.id)}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{h.name}</div>
                    <div style={{ fontSize: 11, color: C.textLight }}>{h.date}</div>
                  </div>
                  <button
                    onClick={() => setExpandedId(id => id === h.id ? null : h.id)}
                    style={{ background: 'none', border: 'none', color: C.brand, fontSize: 11, cursor: 'pointer' }}
                  >
                    {expandedId === h.id ? 'Hide' : 'Who else?'}
                  </button>
                </div>
                <RosterRow holidayId={h.id} expanded={expandedId === h.id} onToggle={() => {}} />
              </div>
            )
          })}
        </div>
      )}

      {window_?.isOpen && holidays.length > 0 && (
        <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save My Picks'}
          </Button>
        </div>
      )}
    </Card>
  )
}
```

- [ ] **Step 3: Wire the new tab into `LeavePage.jsx`**

Read the full current `src/pages/employee/LeavePage.jsx` first to confirm the exact tab-array shape and `employee` variable name in scope (from `useAuth()`, matching the pattern already used by `AttendancePage.jsx`). Add:
- Import: `import HolidayOptinPanel from '../../components/HolidayOptinPanel'`
- A new entry in the existing tab array: `{ id: 'holidays', label: 'Holiday Calendar' }`
- A new render block following the existing `tab === 'xxx' && <Component/>` convention: `{tab === 'holidays' && <HolidayOptinPanel employeeId={employee.id} />}`

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: succeeds with no new errors.

- [ ] **Step 5: Manual verification**

Start the dev server (`npm run dev`), log in as an employee, navigate to Leave Management → Holiday Calendar tab, and confirm: the panel loads without error; if today's date is outside a window, checkboxes are disabled and the "next window opens" message shows; if you temporarily test with a system-clock date inside a window (or note this as something to verify once a real window is open), checkboxes are enabled and "Save My Picks" works.

- [ ] **Step 6: Commit**

```bash
git add src/components/HolidayOptinPanel.jsx src/pages/employee/LeavePage.jsx
git commit -m "Add employee-facing Holiday Calendar opt-in panel"
```

---

### Task 5: Make the monthly absence-reminder per-employee-aware for optional holidays

**Files:**
- Modify: `src/lib/api.notifications.js:262-349` (the "Monthly regularization reminder" block inside `runDailyChecks`)
- Test: `src/tests/api.notifications.test.js`

**Interfaces:**
- Consumes: `holiday_optins` table (read-only, via a plain `supabase.from('holiday_optins').select(...)` call — this runs as part of `runDailyChecks`, which is invoked by an HR/Admin session per the existing calling convention, so it already has read access under `current_employee_role() IN ('hr','admin')`; the shared `auth.uid() IS NOT NULL` SELECT policy from Task 1 covers this regardless of caller role).
- Produces: no new exported functions — this task only changes internal behavior of the existing `runDailyChecks`.

- [ ] **Step 1: Read the current block in full**

Read `src/lib/api.notifications.js` lines 262–349 (the exact current text is reproduced in the "before" block below — confirm it matches before editing, since line numbers may have shifted since this plan was written).

- [ ] **Step 2: Write the failing test**

Add to `src/tests/api.notifications.test.js` (adjust the existing mock setup for `runDailyChecks` tests in this file to match — read the file first to see the established mocking pattern for this function, particularly how `supabase.from` is mocked per-table via `mockImplementation`):

```javascript
it('does not count an optional holiday as absence for an employee who opted in, but does for one who did not', async () => {
  // Fixed "today" inside the monthly-reminder window (26th of some month)
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-26T00:00:00.000Z'))

  const optionalHoliday = { date: '2026-03-10', type: 'optional' }
  const employees = [{ id: 'emp-opted-in' }, { id: 'emp-opted-out' }]

  supabase.from.mockImplementation(table => {
    if (table === 'attendance') {
      return {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
    }
    if (table === 'attendance_regularization_items') {
      return {
        select: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
    }
    if (table === 'holidays') {
      return {
        select: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockResolvedValue({ data: [optionalHoliday], error: null }),
      }
    }
    if (table === 'employees') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: employees, error: null }),
      }
    }
    if (table === 'leave_requests') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
    }
    if (table === 'holiday_optins') {
      return {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({
          data: [{ employee_id: 'emp-opted-in', holiday_id: 'h-optional' }],
          error: null,
        }),
      }
    }
    if (table === 'notifications') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    }
    throw new Error(`Unexpected table: ${table}`)
  })

  const notifySpy = vi.mocked(createNotification)
  await runDailyChecks('reviewer-1')

  const optedInCall = notifySpy.mock.calls.find(([arg]) => arg.employeeId === 'emp-opted-in')
  const optedOutCall = notifySpy.mock.calls.find(([arg]) => arg.employeeId === 'emp-opted-out')

  // emp-opted-in should NOT be nudged about 2026-03-10 (they opted in — it's their day off)
  if (optedInCall) expect(optedInCall[0].message).not.toContain('1 day')
  // emp-opted-out SHOULD be nudged — it's a normal working day for them
  expect(optedOutCall).toBeTruthy()

  vi.useRealTimers()
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/tests/api.notifications.test.js -t "optional holiday"`
Expected: FAIL (current code blanket-excludes ALL holiday dates, including optional ones, for every employee — `emp-opted-out` would incorrectly NOT be nudged either, since the holiday is currently excluded for everyone).

- [ ] **Step 4: Modify the implementation**

In `src/lib/api.notifications.js`, replace the block from the `monthHolidays` query through the `workingDays` computation:

**Before:**
```javascript
    // ── True absences: working days with NO attendance row at all ───────────
    const { data: monthHolidays } = await supabase
      .from('holidays')
      .select('date, type')
      .gte('date', monthStart)
      .lte('date', todayStr)
    const holidayDates = new Set((monthHolidays || []).map(h => h.date))

    const { data: activeEmployees } = await supabase
      .from('employees')
      .select('id')
      .eq('status', 'active')

    const { data: approvedLeaves } = await supabase
      .from('leave_requests')
      .select('employee_id, from_date, to_date')
      .eq('status', 'approved')
      .lte('from_date', todayStr)
      .gte('to_date', monthStart)

    const { data: attendanceRows } = await supabase
      .from('attendance')
      .select('employee_id, date')
      .gte('date', monthStart)
      .lte('date', todayStr)

    const hasAttendanceRow = new Set(
      (attendanceRows || []).map(r => `${r.employee_id}:${r.date}`)
    )

    const workingDays = workingDaysInRange(monthStart, todayStr, holidayDates)

    for (const emp of activeEmployees || []) {
      const employeeLeaves = (approvedLeaves || []).filter(l => l.employee_id === emp.id)
      for (const day of workingDays) {
        if (hasAttendanceRow.has(`${emp.id}:${day}`)) continue // already counted above, or a fully-worked day
        if (requestedSet.has(`${emp.id}:${day}`)) continue
        const onLeave = employeeLeaves.some(l => l.from_date <= day && day <= l.to_date)
        if (onLeave) continue
        byEmployee[emp.id] = (byEmployee[emp.id] || 0) + 1
      }
    }
```

**After:**
```javascript
    // ── True absences: working days with NO attendance row at all ───────────
    const { data: monthHolidays } = await supabase
      .from('holidays')
      .select('id, date, type')
      .gte('date', monthStart)
      .lte('date', todayStr)
    // Only public/company holidays exclude the date for EVERYONE. Optional
    // holidays only exclude the date for employees who actually opted in
    // (see holiday_optins lookup below) — everyone else still owes attendance.
    const mandatoryHolidayDates = new Set(
      (monthHolidays || []).filter(h => h.type !== 'optional').map(h => h.date)
    )
    const optionalHolidays = (monthHolidays || []).filter(h => h.type === 'optional')
    const optionalHolidayIds = optionalHolidays.map(h => h.id)

    const { data: optins } = optionalHolidayIds.length
      ? await supabase
          .from('holiday_optins')
          .select('employee_id, holiday_id')
          .in('holiday_id', optionalHolidayIds)
      : { data: [] }
    const optinDatesByEmployee = {}
    for (const optin of optins || []) {
      const holiday = optionalHolidays.find(h => h.id === optin.holiday_id)
      if (!holiday) continue
      if (!optinDatesByEmployee[optin.employee_id]) optinDatesByEmployee[optin.employee_id] = new Set()
      optinDatesByEmployee[optin.employee_id].add(holiday.date)
    }

    const { data: activeEmployees } = await supabase
      .from('employees')
      .select('id')
      .eq('status', 'active')

    const { data: approvedLeaves } = await supabase
      .from('leave_requests')
      .select('employee_id, from_date, to_date')
      .eq('status', 'approved')
      .lte('from_date', todayStr)
      .gte('to_date', monthStart)

    const { data: attendanceRows } = await supabase
      .from('attendance')
      .select('employee_id, date')
      .gte('date', monthStart)
      .lte('date', todayStr)

    const hasAttendanceRow = new Set(
      (attendanceRows || []).map(r => `${r.employee_id}:${r.date}`)
    )

    const workingDays = workingDaysInRange(monthStart, todayStr, mandatoryHolidayDates)

    for (const emp of activeEmployees || []) {
      const employeeLeaves = (approvedLeaves || []).filter(l => l.employee_id === emp.id)
      const employeeOptinDates = optinDatesByEmployee[emp.id] || new Set()
      for (const day of workingDays) {
        if (employeeOptinDates.has(day)) continue // this employee opted into this optional holiday
        if (hasAttendanceRow.has(`${emp.id}:${day}`)) continue // already counted above, or a fully-worked day
        if (requestedSet.has(`${emp.id}:${day}`)) continue
        const onLeave = employeeLeaves.some(l => l.from_date <= day && day <= l.to_date)
        if (onLeave) continue
        byEmployee[emp.id] = (byEmployee[emp.id] || 0) + 1
      }
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/tests/api.notifications.test.js -t "optional holiday"`
Expected: PASS.

- [ ] **Step 6: Run the full notifications test suite to check for regressions**

Run: `npx vitest run src/tests/api.notifications.test.js`
Expected: PASS — all tests, including the pre-existing ones from the Attendance Overhaul (they use `type` values other than `'optional'` in their holiday mocks, or no holidays at all, so `mandatoryHolidayDates` should behave identically to the old blanket `holidayDates` for those cases — confirm this by reading the existing tests' holiday mock data before concluding no regression).

- [ ] **Step 7: Commit**

```bash
git add src/lib/api.notifications.js src/tests/api.notifications.test.js
git commit -m "Make monthly absence-reminder per-employee-aware for optional holidays"
```

---

### Task 6: Scheduled window-open and reminder notifications

**Files:**
- Modify: `src/lib/api.notifications.js`
- Test: `src/tests/api.notifications.test.js`

**Interfaces:**
- Consumes: `getOptinWindow` from `./api.holidayOptins` (new import into `api.notifications.js`).
- Produces: no new exported functions — extends `runDailyChecks` with two new blocks.

- [ ] **Step 1: Write the failing tests**

```javascript
describe('holiday opt-in window notifications', () => {
  it('notifies every active employee when the window opens', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    const employees = [{ id: 'emp-1' }, { id: 'emp-2' }]
    let insertedRows

    supabase.from.mockImplementation(table => {
      if (table === 'employees') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: employees, error: null }) }
      }
      if (table === 'notifications') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
          insert: vi.fn().mockImplementation(rows => { insertedRows = rows; return Promise.resolve({ data: null, error: null }) }),
        }
      }
      // other tables used by the monthly-reminder block, returning empty results
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
    })

    await runDailyChecks('reviewer-1')

    expect(insertedRows).toBeTruthy()
    expect(insertedRows.map(r => r.employee_id).sort()).toEqual(['emp-1', 'emp-2'])
    expect(insertedRows[0].type).toBe('holiday_optin_window_open')

    vi.useRealTimers()
  })

  it('does not fire the window-open notification on a day outside any window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T00:00:00.000Z'))

    let notificationsInsertCalled = false
    supabase.from.mockImplementation(table => {
      if (table === 'notifications') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
          insert: vi.fn().mockImplementation(() => { notificationsInsertCalled = true; return Promise.resolve({ data: null, error: null }) }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
    })

    await runDailyChecks('reviewer-1')
    expect(notificationsInsertCalled).toBe(false)

    vi.useRealTimers()
  })

  it('sends the closing-soon reminder only to employees without a submission row for the current window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-12T00:00:00.000Z')) // within the last 4 days of H1 (closes Jan 14)

    const employees = [{ id: 'emp-responded' }, { id: 'emp-not-responded' }]
    let insertedRows

    supabase.from.mockImplementation(table => {
      if (table === 'employees') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: employees, error: null }) }
      }
      if (table === 'holiday_optin_submissions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [{ employee_id: 'emp-responded' }], error: null }),
        }
      }
      if (table === 'notifications') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
          insert: vi.fn().mockImplementation(rows => { insertedRows = rows; return Promise.resolve({ data: null, error: null }) }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
    })

    await runDailyChecks('reviewer-1')

    const reminderRows = (insertedRows || []).filter(r => r.type === 'holiday_optin_reminder')
    expect(reminderRows.map(r => r.employee_id)).toEqual(['emp-not-responded'])

    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tests/api.notifications.test.js -t "holiday opt-in window"`
Expected: FAIL — no such notification blocks exist yet.

- [ ] **Step 3: Add the import**

At the top of `src/lib/api.notifications.js`, add:
```javascript
import { getOptinWindow } from './api.holidayOptins'
```

- [ ] **Step 4: Add the two new blocks to `runDailyChecks`**

Insert immediately before the final closing `}` of `runDailyChecks` (after the existing "Weekly attendance report ready" block):

```javascript
  // ── Holiday opt-in window notifications ────────────────────────────────────
  const optinWindow = getOptinWindow(today)
  if (optinWindow.isOpen) {
    const { data: activeEmployeesForOptin } = await supabase
      .from('employees')
      .select('id')
      .eq('status', 'active')

    // Window just opened today — notify everyone once.
    const windowOpensToday =
      optinWindow.closesOn.endsWith('-01-14') ? todayStr === `${optinWindow.label.split('-')[0]}-01-01`
      : todayStr === `${optinWindow.label.split('-')[0]}-07-01`

    if (windowOpensToday && (activeEmployeesForOptin || []).length > 0) {
      await supabase.from('notifications').insert(
        (activeEmployeesForOptin || []).map(emp => ({
          employee_id: emp.id,
          type: 'holiday_optin_window_open',
          title: 'Holiday Opt-In Window Open',
          message: `You can now pick your optional holidays. Submit by ${optinWindow.closesOn}.`,
          metadata: { window: optinWindow.label },
          is_read: false,
        }))
      )
    }

    // Closing-soon reminder: last 4 days of the window, only to employees
    // who have not yet confirmed their picks (even confirming zero counts
    // as responded — don't nag people who already answered).
    const closesOnDate = new Date(`${optinWindow.closesOn}T00:00:00.000Z`)
    const daysUntilClose = Math.round((closesOnDate - today) / 86400000)
    if (daysUntilClose >= 0 && daysUntilClose <= 3) {
      const { data: submitted } = await supabase
        .from('holiday_optin_submissions')
        .select('employee_id')
        .eq('window_label', optinWindow.label)
      const submittedIds = new Set((submitted || []).map(s => s.employee_id))
      const notYetResponded = (activeEmployeesForOptin || []).filter(emp => !submittedIds.has(emp.id))

      const remindersToSend = []
      for (const emp of notYetResponded) {
        const { count: alreadyRemindedToday } = await supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('employee_id', emp.id)
          .eq('type', 'holiday_optin_reminder')
          .gte('created_at', todayStr)
        if (alreadyRemindedToday === 0) {
          remindersToSend.push({
            employee_id: emp.id,
            type: 'holiday_optin_reminder',
            title: 'Holiday Picks Closing Soon',
            message: `The holiday opt-in window closes ${optinWindow.closesOn} — submit your picks before then.`,
            metadata: { window: optinWindow.label },
            is_read: false,
          })
        }
      }
      if (remindersToSend.length > 0) {
        await supabase.from('notifications').insert(remindersToSend)
      }
    }
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/tests/api.notifications.test.js -t "holiday opt-in window"`
Expected: PASS — all 3 tests.

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npm test`
Expected: PASS — all tests, no regressions in the pre-existing weekly-report or monthly-reminder tests.

- [ ] **Step 7: Self-review against the broadcast-completeness lesson**

Confirm the window-open notification inserts one row per active employee (bulk insert, not `list[0]`) and the reminder inserts one row per not-yet-responded employee — matching the exact lesson from the regularization-notification bug.

- [ ] **Step 8: Commit**

```bash
git add src/lib/api.notifications.js src/tests/api.notifications.test.js
git commit -m "Add scheduled holiday opt-in window-open and closing-soon reminders"
```

---

### Task 7: Final verification pass

**Files:** None (verification only, matching the Attendance Overhaul's Task 17 pattern).

**Interfaces:** None.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — every test, including all pre-existing suites.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 3: Run lint and diff against the pre-feature baseline**

Run: `npx eslint src/lib/api.holidayOptins.js src/components/HolidayOptinPanel.jsx src/pages/employee/LeavePage.jsx src/lib/api.notifications.js`
Compare any findings against `git show main:<file>` (or the commit before Task 1) to confirm any reported issues are pre-existing, not newly introduced — matching the exact verification method used at the end of the Attendance Overhaul.

- [ ] **Step 4: Explicit RLS/broadcast/boundary self-review checklist**

Confirm, by re-reading the relevant code (not just recalling intent):
- Every `holiday_optins`/`holiday_optin_submissions` write in `api.holidayOptins.js` scopes to `employee_id: employeeId` (never someone else's ID) and never chains `.select()` after insert/upsert/delete.
- The window-open and reminder notification blocks in `runDailyChecks` insert one row per eligible recipient via a bulk array, never a single `list[0]` pick.
- `getOptinWindow`'s boundary tests (Task 2) all pass, specifically the Jan 14→15 and Jul 14→15 transitions and the UTC-vs-local-time test.
- The monthly absence-reminder's `optionalHolidayIds.length ? ... : { data: [] }` guard (Task 5) correctly avoids an unnecessary/malformed query when there are no optional holidays that month.

- [ ] **Step 5: Manual verification note**

Document in the final report: full window-cycle testing (an actual Jan 1–14 or Jul 1–14 window) cannot be exercised end-to-end without either waiting for a real window or temporarily manipulating the system clock in a test environment — recommend the user do a manual pass once the next real window opens, checking: the window-open notification arrives for multiple test accounts, picks save and persist correctly, the roster ("who else?") view shows other opted-in employees, and picks lock correctly the day after the window closes.
