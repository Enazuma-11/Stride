# Attendance Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single check-in/check-out-per-day, hardcoded-9-6-lateness attendance model with multi-session (break-aware) attendance, midnight-spanning hour splitting, and an employee-initiated regularization workflow with manager → admin approval.

**Architecture:** A new `attendance_sessions` table stores every check-in/check-out pair; the existing `attendance` table becomes a computed daily aggregate recalculated from sessions on every check-in/check-out. Two new tables (`attendance_regularization_requests`, `attendance_regularization_items`) drive the approval workflow. All new logic lives in `src/lib/api.attendance.js` (session + aggregate logic) and a new `src/lib/api.attendanceRegularization.js` (approval workflow).

**Tech Stack:** React 19 + Vite, Supabase (Postgres + RLS), Vitest for tests. No new dependencies.

## Global Constraints

- All dates use the existing app convention: UTC-based `date.toISOString().split('T')[0]`. No new timezone handling.
- Max 5 sessions per employee per calendar day (by `check_in` date) — `MAX_SESSIONS_PER_DAY` constant in `src/lib/constants.js`.
- `late_mark` status is never generated going forward. The DB CHECK constraint and `ATTENDANCE_STATUSES` UI entry stay (historical data may still have it) but no code path produces it for new records.
- Existing `WORK_HOURS_BY_TYPE` thresholds (`fullDay`/`halfDay` per employee type) are unchanged and reused for status derivation.
- Status derivation (new, since late-mark is dropped): `totalHours >= fullDay` → `present`/`wfh`; `0 < totalHours < fullDay` → `half_day`; `totalHours === 0` (or no closed sessions) → `absent`. This collapses the old separate half-day-threshold/late-mark distinction into a simple two-tier "did they meet the full-day bar" check, per the "judge purely on total hours" decision.
- Every SQL migration file follows the existing repo convention: header comment block, `Run in: Supabase Dashboard → SQL Editor (both Production and Test projects)`, idempotent where reasonably possible.
- Existing exported function names in `src/lib/api.attendance.js` (`checkIn`, `checkOut`, `formatTime`, `hoursWorked`, `todayISO`, `getTodayAttendance`, `getMyMonthlyAttendance`, `getTeamAttendanceByDate`, `getTeamMonthlyAttendance`, `getHolidays`, `addHoliday`, `deleteHoliday`) are preserved where they still make sense; `computeStatus` and `overrideAttendance` are removed/replaced as described in each task.

---

### Task 1: DB migration — `attendance_sessions` table

**Files:**
- Create: `supabase_migration_attendance_sessions.sql`

**Interfaces:**
- Produces: `attendance_sessions` table (`id`, `employee_id`, `check_in`, `check_out`, `is_wfh`, `created_at`) that Task 3 onward reads/writes.

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- STRIDE — ATTENDANCE SESSIONS (multi check-in/out per day)
-- Run in: Supabase Dashboard → SQL Editor (both Production and Test projects)
--
-- Why: attendance previously supported one check-in/check-out pair per
-- employee per day (UNIQUE employee_id, date). This adds a sessions table
-- so employees can check in/out multiple times per day (break management),
-- with the existing `attendance` table becoming a computed daily aggregate
-- recalculated from these sessions (see api.attendance.js).
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  check_in     TIMESTAMPTZ NOT NULL,
  check_out    TIMESTAMPTZ,
  is_wfh       BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_employee_checkin
  ON attendance_sessions (employee_id, check_in DESC);

ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attendance_sessions_select" ON attendance_sessions;
CREATE POLICY "attendance_sessions_select" ON attendance_sessions
  FOR SELECT USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin','manager')
  );

DROP POLICY IF EXISTS "attendance_sessions_insert_own" ON attendance_sessions;
CREATE POLICY "attendance_sessions_insert_own" ON attendance_sessions
  FOR INSERT WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
  );

DROP POLICY IF EXISTS "attendance_sessions_update" ON attendance_sessions;
CREATE POLICY "attendance_sessions_update" ON attendance_sessions
  FOR UPDATE USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
  );

DROP POLICY IF EXISTS "attendance_sessions_delete_hr" ON attendance_sessions;
CREATE POLICY "attendance_sessions_delete_hr" ON attendance_sessions
  FOR DELETE USING (current_employee_role() IN ('hr','admin'));
```

- [ ] **Step 2: Note for the user (not an automated step)**

This file must be run manually in both Supabase SQL Editors (Production `fqyyvdtjzswdkgrkytam` and Test `uzysmoeyrenbhpbdxled`) before Task 3's code can work end-to-end. Flag this at the end of the plan's execution, same as every other migration in this project.

- [ ] **Step 3: Commit**

```bash
git add supabase_migration_attendance_sessions.sql
git commit -m "Add attendance_sessions table migration"
```

---

### Task 2: DB migration — regularization tables

**Files:**
- Create: `supabase_migration_attendance_regularization.sql`

**Interfaces:**
- Produces: `attendance_regularization_requests` and `attendance_regularization_items` tables that Tasks 7-8 read/write.
- Consumes: `employees.manager_id` (existing column) for RLS manager-scoping.

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- STRIDE — ATTENDANCE REGULARIZATION
-- Run in: Supabase Dashboard → SQL Editor (both Production and Test projects)
--
-- Why: employees need a way to request a correction to a day's recorded
-- attendance (e.g. forgot to check out, needed a 6th session). Manager
-- approves/rejects per date, then Admin/HR applies the final correction.
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_regularization_requests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  submitted_at  TIMESTAMPTZ DEFAULT NOW(),
  status        TEXT NOT NULL DEFAULT 'pending_manager'
                CHECK (status IN ('pending_manager','pending_admin','completed'))
);

CREATE TABLE IF NOT EXISTS attendance_regularization_items (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id         UUID NOT NULL REFERENCES attendance_regularization_requests(id) ON DELETE CASCADE,
  date               DATE NOT NULL,
  proposed_check_in  TIMESTAMPTZ NOT NULL,
  proposed_check_out TIMESTAMPTZ NOT NULL,
  reason             TEXT NOT NULL,
  manager_decision   TEXT NOT NULL DEFAULT 'pending' CHECK (manager_decision IN ('pending','approved','rejected')),
  admin_decision     TEXT DEFAULT NULL CHECK (admin_decision IN ('approved','rejected')),
  decided_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regularization_items_request ON attendance_regularization_items (request_id);

ALTER TABLE attendance_regularization_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_regularization_items    ENABLE ROW LEVEL SECURITY;

-- Employee sees/creates own requests; manager sees requests from their direct reports; HR/Admin see all
DROP POLICY IF EXISTS "regularization_requests_select" ON attendance_regularization_requests;
CREATE POLICY "regularization_requests_select" ON attendance_regularization_requests
  FOR SELECT USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
    OR current_employee_role() IN ('hr','admin')
  );

DROP POLICY IF EXISTS "regularization_requests_insert_own" ON attendance_regularization_requests;
CREATE POLICY "regularization_requests_insert_own" ON attendance_regularization_requests
  FOR INSERT WITH CHECK (employee_id = (SELECT id FROM employees WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "regularization_requests_update" ON attendance_regularization_requests;
CREATE POLICY "regularization_requests_update" ON attendance_regularization_requests
  FOR UPDATE USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
    OR current_employee_role() IN ('hr','admin')
  );

-- Items follow the same visibility as their parent request
DROP POLICY IF EXISTS "regularization_items_select" ON attendance_regularization_items;
CREATE POLICY "regularization_items_select" ON attendance_regularization_items
  FOR SELECT USING (
    request_id IN (
      SELECT id FROM attendance_regularization_requests r WHERE
        r.employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
        OR r.employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
        OR current_employee_role() IN ('hr','admin')
    )
  );

DROP POLICY IF EXISTS "regularization_items_insert_own" ON attendance_regularization_items;
CREATE POLICY "regularization_items_insert_own" ON attendance_regularization_items
  FOR INSERT WITH CHECK (
    request_id IN (
      SELECT id FROM attendance_regularization_requests
      WHERE employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "regularization_items_update" ON attendance_regularization_items;
CREATE POLICY "regularization_items_update" ON attendance_regularization_items
  FOR UPDATE USING (
    request_id IN (
      SELECT id FROM attendance_regularization_requests r WHERE
        r.employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
        OR r.employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
        OR current_employee_role() IN ('hr','admin')
    )
  );
```

- [ ] **Step 2: Commit**

```bash
git add supabase_migration_attendance_regularization.sql
git commit -m "Add attendance regularization tables migration"
```

---

### Task 3: Session aggregation core logic

**Files:**
- Modify: `src/lib/api.attendance.js`
- Modify: `src/lib/constants.js`
- Test: `src/tests/api.attendance.test.js`

**Interfaces:**
- Produces: `sessionHoursForDate(checkIn, checkOut, dateStr)`, `deriveDailyStatus(totalHours, isWFH, hasOpenSession, employeeType)`, `recomputeDayAggregate(employeeId, date)` — all exported, used by Tasks 4, 6, 8.
- Consumes: `WORK_HOURS_BY_TYPE` from `constants.js` (existing).

- [ ] **Step 1: Add `MAX_SESSIONS_PER_DAY` constant**

In `src/lib/constants.js`, after the `WORK_HOURS_BY_TYPE` block (currently ending around line 91):

```js
export const MAX_SESSIONS_PER_DAY = 5
```

- [ ] **Step 2: Write the failing tests for the pure helpers**

Add to `src/tests/api.attendance.test.js` (new `describe` blocks, keep existing ones):

```js
import { sessionHoursForDate, deriveDailyStatus } from '../lib/api.attendance'

// ── sessionHoursForDate ────────────────────────────────────────────────────────
describe('sessionHoursForDate', () => {
  it('returns 0 if checkOut is missing (open session)', () => {
    expect(sessionHoursForDate('2026-06-17T03:30:00.000Z', null, '2026-06-17')).toBe(0)
  })

  it('counts full session on the same day', () => {
    // 9:00 - 17:00 IST same day = 03:30 - 11:30 UTC
    const hours = sessionHoursForDate('2026-06-17T03:30:00.000Z', '2026-06-17T11:30:00.000Z', '2026-06-17')
    expect(hours).toBe(8)
  })

  it('returns 0 for a date the session does not touch', () => {
    const hours = sessionHoursForDate('2026-06-17T03:30:00.000Z', '2026-06-17T11:30:00.000Z', '2026-06-18')
    expect(hours).toBe(0)
  })

  it('splits a midnight-spanning session across both days', () => {
    // 6 PM IST June 17 = 12:30 UTC June 17; 3 AM IST June 18 = 21:30 UTC June 17
    // Use plain UTC times to keep the math easy to verify: 18:00 UTC June 17 -> 03:00 UTC June 18
    const checkIn  = '2026-06-17T18:00:00.000Z'
    const checkOut = '2026-06-18T03:00:00.000Z'
    expect(sessionHoursForDate(checkIn, checkOut, '2026-06-17')).toBe(6) // 18:00 -> midnight
    expect(sessionHoursForDate(checkIn, checkOut, '2026-06-18')).toBe(3) // midnight -> 03:00
  })

  it('rounds to 1 decimal place', () => {
    const checkIn  = '2026-06-17T03:30:00.000Z'
    const checkOut = '2026-06-17T09:45:00.000Z' // 6.25 hours
    expect(sessionHoursForDate(checkIn, checkOut, '2026-06-17')).toBe(6.3)
  })
})

// ── deriveDailyStatus ──────────────────────────────────────────────────────────
describe('deriveDailyStatus', () => {
  it('returns present for an open session (not WFH)', () => {
    expect(deriveDailyStatus(0, false, true, 'permanent')).toBe('present')
  })

  it('returns wfh for an open session marked WFH', () => {
    expect(deriveDailyStatus(0, true, true, 'permanent')).toBe('wfh')
  })

  it('returns absent for 0 hours with no open session', () => {
    expect(deriveDailyStatus(0, false, false, 'permanent')).toBe('absent')
  })

  it('returns half_day for partial hours below full-day threshold', () => {
    expect(deriveDailyStatus(4, false, false, 'permanent')).toBe('half_day')
  })

  it('returns present for full-day hours met (permanent = 8h)', () => {
    expect(deriveDailyStatus(8, false, false, 'permanent')).toBe('present')
  })

  it('returns wfh for full-day hours met and WFH', () => {
    expect(deriveDailyStatus(8, true, false, 'permanent')).toBe('wfh')
  })

  it('uses the intern/contractor threshold (5.5h)', () => {
    expect(deriveDailyStatus(5.5, false, false, 'intern')).toBe('present')
    expect(deriveDailyStatus(3, false, false, 'intern')).toBe('half_day')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- api.attendance` (or `npx vitest run src/tests/api.attendance.test.js`)
Expected: FAIL — `sessionHoursForDate` and `deriveDailyStatus` are not exported yet.

- [ ] **Step 4: Implement the helpers and `recomputeDayAggregate`**

In `src/lib/api.attendance.js`, replace the existing `computeStatus` function (lines 6-38) and `getEmployeeType` stays as-is, with:

```js
// ─── HELPERS ─────────────────────────────────────────────────────────────────

// Hours of a session that fall within the UTC calendar day `dateStr` (YYYY-MM-DD).
// Handles sessions that span midnight by clipping to the day's [00:00, 24:00) window.
export function sessionHoursForDate(checkIn, checkOut, dateStr) {
  if (!checkIn || !checkOut) return 0
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`)
  const dayEnd   = new Date(dayStart.getTime() + 86400000)
  const inTime   = new Date(checkIn)
  const outTime  = new Date(checkOut)
  const start = inTime > dayStart ? inTime : dayStart
  const end   = outTime < dayEnd ? outTime : dayEnd
  const ms = end - start
  if (ms <= 0) return 0
  return Math.round((ms / 3600000) * 10) / 10
}

// Derives a day's attendance status purely from total hours worked — no late-mark concept.
export function deriveDailyStatus(totalHours, isWFH, hasOpenSession, employeeType = 'permanent') {
  if (hasOpenSession) return isWFH ? 'wfh' : 'present'
  if (totalHours <= 0) return 'absent'
  const policy = WORK_HOURS_BY_TYPE[employeeType] || WORK_HOURS_BY_TYPE.permanent
  if (totalHours >= policy.fullDay) return isWFH ? 'wfh' : 'present'
  return 'half_day'
}

function addDaysISO(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

// Recomputes the `attendance` aggregate row for one employee/date from
// attendance_sessions. Sessions are looked up in a [date-1, date+1) window
// on check_in so midnight-spanning sessions from the adjacent day are included.
export async function recomputeDayAggregate(employeeId, date) {
  const windowStart = `${addDaysISO(date, -1)}T00:00:00.000Z`
  const windowEnd   = `${addDaysISO(date, 1)}T00:00:00.000Z`

  const { data: sessions, error } = await supabase
    .from('attendance_sessions')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('check_in', windowStart)
    .lt('check_in', windowEnd)
    .order('check_in', { ascending: true })
  if (error) throw error

  const relevant = sessions || []
  let totalHours = 0
  let hasOpenSession = false
  let isWFH = false
  let firstCheckIn = null
  let lastCheckOut = null

  for (const s of relevant) {
    if (!s.check_out) {
      hasOpenSession = true
      if (s.is_wfh) isWFH = true
      continue
    }
    const hours = sessionHoursForDate(s.check_in, s.check_out, date)
    if (hours > 0) {
      totalHours += hours
      if (s.is_wfh) isWFH = true
      if (!firstCheckIn || new Date(s.check_in) < new Date(firstCheckIn)) firstCheckIn = s.check_in
      if (!lastCheckOut || new Date(s.check_out) > new Date(lastCheckOut)) lastCheckOut = s.check_out
    }
  }
  totalHours = Math.round(totalHours * 10) / 10

  const empType = await getEmployeeType(employeeId)
  const status  = deriveDailyStatus(totalHours, isWFH, hasOpenSession, empType)

  const { data: existing } = await supabase
    .from('attendance')
    .select('id, hr_override')
    .eq('employee_id', employeeId)
    .eq('date', date)
    .maybeSingle()

  // Don't let a live recompute clobber a day HR has manually overridden via hrSetSessions
  // (hrSetSessions itself calls recomputeDayAggregate after rewriting sessions, so this
  // only guards against a stray checkIn/checkOut recompute racing an override).
  const { data: updated, error: upsertError } = await supabase
    .from('attendance')
    .upsert({
      employee_id:  employeeId,
      date,
      check_in:     firstCheckIn,
      check_out:    hasOpenSession ? null : lastCheckOut,
      hours_worked: totalHours,
      is_wfh:       isWFH,
      status,
      hr_override:  existing?.hr_override || false,
    }, { onConflict: 'employee_id,date' })
    .select()
    .single()
  if (upsertError) throw upsertError

  if (status === 'half_day') {
    await deductHalfDayLeave(employeeId, date)
  }

  return updated
}
```

Also remove the old `computeStatus` function entirely (it's superseded by `deriveDailyStatus` + `recomputeDayAggregate`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/tests/api.attendance.test.js`
Expected: PASS (all `sessionHoursForDate`/`deriveDailyStatus` tests, plus existing `formatTime`/`hoursWorked`/`todayISO` tests still passing).

- [ ] **Step 6: Commit**

```bash
git add src/lib/api.attendance.js src/lib/constants.js src/tests/api.attendance.test.js
git commit -m "Add session-based daily aggregation (sessionHoursForDate, deriveDailyStatus, recomputeDayAggregate)"
```

---

### Task 4: Multi-session check-in/check-out

**Files:**
- Modify: `src/lib/api.attendance.js`
- Test: `src/tests/api.attendance.test.js`

**Interfaces:**
- Consumes: `recomputeDayAggregate`, `sessionHoursForDate` (Task 3), `MAX_SESSIONS_PER_DAY` (Task 3/constants.js), `supabase` client.
- Produces: `checkIn(employeeId, isWFH)`, `checkOut(employeeId)`, `getTodaySessions(employeeId)`, `getOpenSession(employeeId)` — used by Task 11 (AttendancePage UI).

- [ ] **Step 1: Write the failing tests**

Add to `src/tests/api.attendance.test.js`. These mock the Supabase client the same way `src/tests/api.leave.test.js` mocks it — check that file for the exact mock pattern before writing, then adapt:

```js
import { vi } from 'vitest'
vi.mock('../lib/supabase', () => {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lt: vi.fn(() => chain),
    order: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve({ data: null, error: null })),
    maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
    insert: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
  }
  return { supabase: { from: vi.fn(() => chain) } }
})

describe('checkIn session cap', () => {
  it('throws when employee already has an open session', async () => {
    const { supabase } = await import('../lib/supabase')
    supabase.from().maybeSingle.mockResolvedValueOnce({ data: { id: 'sess-1', check_out: null }, error: null })
    const { checkIn } = await import('../lib/api.attendance')
    await expect(checkIn('emp-1', false)).rejects.toThrow(/already checked in/i)
  })
})
```

Note for the implementer: if the existing mock pattern in `src/tests/api.leave.test.js` differs from the sketch above, follow that file's actual pattern instead — the goal is one test proving `checkIn` rejects when an open session already exists, matching this codebase's established Supabase-mocking style.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/api.attendance.test.js -t "checkIn session cap"`
Expected: FAIL — current `checkIn` doesn't check for open sessions.

- [ ] **Step 3: Implement `checkIn`, `checkOut`, `getTodaySessions`, `getOpenSession`**

In `src/lib/api.attendance.js`, replace the existing `checkIn`/`checkOut` functions (previously lines 67-135) with:

```js
// ─── CHECK IN ────────────────────────────────────────────────────────────────

export async function getOpenSession(employeeId) {
  const { data, error } = await supabase
    .from('attendance_sessions')
    .select('*')
    .eq('employee_id', employeeId)
    .is('check_out', null)
    .order('check_in', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getTodaySessions(employeeId) {
  const today = todayISO()
  const { data, error } = await supabase
    .from('attendance_sessions')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('check_in', `${today}T00:00:00.000Z`)
    .lt('check_in', `${addDaysISO(today, 1)}T00:00:00.000Z`)
    .order('check_in', { ascending: true })
  if (error) throw error
  return data || []
}

export async function checkIn(employeeId, isWFH = false) {
  const open = await getOpenSession(employeeId)
  if (open) throw new Error('You are already checked in. Please check out first.')

  const todaySessions = await getTodaySessions(employeeId)
  if (todaySessions.length >= MAX_SESSIONS_PER_DAY) {
    throw new Error(`You've reached today's check-in limit (${MAX_SESSIONS_PER_DAY} sessions). If you need to log additional work time for today, submit a regularization request.`)
  }

  const now = new Date().toISOString()
  const { data: session, error } = await supabase
    .from('attendance_sessions')
    .insert({ employee_id: employeeId, check_in: now, is_wfh: isWFH })
    .select()
    .single()
  if (error) throw error

  const attendance = await recomputeDayAggregate(employeeId, todayISO())
  return { session, attendance }
}

// ─── CHECK OUT ───────────────────────────────────────────────────────────────

export async function checkOut(employeeId) {
  const open = await getOpenSession(employeeId)
  if (!open) throw new Error('No open check-in found. Please check in first.')

  const now = new Date().toISOString()
  const { data: session, error } = await supabase
    .from('attendance_sessions')
    .update({ check_out: now })
    .eq('id', open.id)
    .select()
    .single()
  if (error) throw error

  const checkInDate  = open.check_in.split('T')[0]
  const checkOutDate = now.split('T')[0]

  await recomputeDayAggregate(employeeId, checkInDate)
  const attendance = checkOutDate !== checkInDate
    ? await recomputeDayAggregate(employeeId, checkOutDate)
    : await recomputeDayAggregate(employeeId, checkInDate)

  return { session, attendance }
}
```

Update the top-of-file import to include `MAX_SESSIONS_PER_DAY`:
```js
import { FULL_DAY_HOURS, HALF_DAY_HOURS, WORK_HOURS_BY_TYPE, MAX_SESSIONS_PER_DAY } from './constants'
```
(drop `WORK_START_HOUR`, `LATE_MARK_MINUTES` from this import — no longer used.)

`getTodayAttendance` (existing function, unchanged) continues to work as-is — it reads the `attendance` aggregate row, which `checkIn`/`checkOut` keep up to date.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/api.attendance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.attendance.js src/tests/api.attendance.test.js
git commit -m "Support multiple check-in/check-out sessions per day with a 5-session cap"
```

---

### Task 5: Weekly hours (employee + HR team view)

**Files:**
- Modify: `src/lib/api.attendance.js`
- Test: `src/tests/api.attendance.test.js`

**Interfaces:**
- Consumes: `sessionHoursForDate` (Task 3), existing `getAllEmployees` (from `src/lib/api.js`, imported where needed by callers — not by this file).
- Produces: `getWeekStart(dateStr)`, `getWeeklyHours(employeeId, weekStartISO)`, `getTeamWeeklyAttendance(weekStartISO)` — used by Task 11 (employee widget), Task 15 (HR Weekly tab), Task 16 (Dashboard widget).

- [ ] **Step 1: Write the failing tests**

```js
describe('getWeekStart', () => {
  it('returns the Monday of the week for a mid-week date', () => {
    const { getWeekStart } = require('../lib/api.attendance')
    expect(getWeekStart('2026-06-17')).toBe('2026-06-15') // Wed -> Mon
  })

  it('returns the same date if it is already Monday', () => {
    const { getWeekStart } = require('../lib/api.attendance')
    expect(getWeekStart('2026-06-15')).toBe('2026-06-15')
  })

  it('returns the prior Monday for a Sunday', () => {
    const { getWeekStart } = require('../lib/api.attendance')
    expect(getWeekStart('2026-06-21')).toBe('2026-06-15')
  })
})
```

Use ES module `import { getWeekStart } from '../lib/api.attendance'` at the top of the test file instead of `require` (matching the rest of the file's style) — the `require` above is illustrative only.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/api.attendance.test.js -t "getWeekStart"`
Expected: FAIL — not exported yet.

- [ ] **Step 3: Implement**

Add to `src/lib/api.attendance.js`:

```js
// ─── WEEKLY HOURS ─────────────────────────────────────────────────────────────

// Monday of the week containing dateStr (ISO week, Mon-Sun), UTC-based.
export function getWeekStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  const day = d.getUTCDay() // 0=Sun, 1=Mon ... 6=Sat
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().split('T')[0]
}

export async function getWeeklyHours(employeeId, weekStartISO) {
  const weekEnd = addDaysISO(weekStartISO, 7)
  const { data: rows, error } = await supabase
    .from('attendance')
    .select('date, hours_worked')
    .eq('employee_id', employeeId)
    .gte('date', weekStartISO)
    .lt('date', weekEnd)
  if (error) throw error

  const empType = await getEmployeeType(employeeId)
  const policy  = WORK_HOURS_BY_TYPE[empType] || WORK_HOURS_BY_TYPE.permanent
  const totalHours = Math.round((rows || []).reduce((sum, r) => sum + (r.hours_worked || 0), 0) * 10) / 10

  return {
    weekStart: weekStartISO,
    totalHours,
    targetHours: policy.fullDay * 5,
    dailyBreakdown: rows || [],
  }
}

export async function getTeamWeeklyAttendance(weekStartISO) {
  const weekEnd = addDaysISO(weekStartISO, 7)
  const { data: rows, error } = await supabase
    .from('attendance')
    .select(`employee_id, date, hours_worked, is_wfh, employee:employee_id(id, full_name, role, department, avatar_initials, employee_type)`)
    .gte('date', weekStartISO)
    .lt('date', weekEnd)
  if (error) throw error

  const byEmployee = {}
  for (const row of rows || []) {
    const id = row.employee_id
    if (!byEmployee[id]) {
      byEmployee[id] = {
        employee: row.employee,
        totalHours: 0,
        sessionDays: 0,
        wfhDays: 0,
      }
    }
    byEmployee[id].totalHours += row.hours_worked || 0
    if (row.hours_worked > 0) byEmployee[id].sessionDays += 1
    if (row.is_wfh) byEmployee[id].wfhDays += 1
  }

  return Object.values(byEmployee).map(e => ({
    ...e,
    totalHours: Math.round(e.totalHours * 10) / 10,
  }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/api.attendance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.attendance.js src/tests/api.attendance.test.js
git commit -m "Add weekly hours calculation for employee and HR team views"
```

---

### Task 6: HR/Admin direct session override

**Files:**
- Modify: `src/lib/api.attendance.js`
- Test: `src/tests/api.attendance.test.js`

**Interfaces:**
- Consumes: `recomputeDayAggregate` (Task 3), `addDaysISO` (Task 3, internal).
- Produces: `hrSetSessions(employeeId, date, sessions, reviewerId, reason)` — used by Task 14 (`AttendanceOverridePanel.jsx` rework) and Task 8 (`adminApplyItem`).
- Replaces: `overrideAttendance` (removed — no longer matches the session-based model).

- [ ] **Step 1: Write the failing test**

```js
describe('hrSetSessions', () => {
  it('throws when no sessions are provided', async () => {
    const { hrSetSessions } = await import('../lib/api.attendance')
    await expect(hrSetSessions('emp-1', '2026-06-17', [], 'reviewer-1', 'test')).rejects.toThrow(/at least one session/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/api.attendance.test.js -t "hrSetSessions"`
Expected: FAIL — function doesn't exist yet.

- [ ] **Step 3: Implement, and remove `overrideAttendance`**

Remove the existing `overrideAttendance` function (previously lines 271-288). Add in its place:

```js
// ─── HR/ADMIN: DIRECT SESSION OVERRIDE ───────────────────────────────────────

// Replaces the entire set of sessions for one employee/date with `sessions`
// (array of { checkIn: ISOString, checkOut: ISOString, isWFH: bool }), logs
// the change to attendance_overrides for audit, and recomputes the aggregate.
// This is the same underlying mechanism used when Admin applies an approved
// regularization item (see Task 8's adminApplyItem).
export async function hrSetSessions(employeeId, date, sessions, reviewerId, reason) {
  if (!sessions || sessions.length === 0) {
    throw new Error('Provide at least one session (check-in/check-out pair).')
  }
  if (!reason || !reason.trim()) {
    throw new Error('A reason is required for audit trail.')
  }

  const windowStart = `${date}T00:00:00.000Z`
  const windowEnd   = `${addDaysISO(date, 1)}T00:00:00.000Z`

  const { data: existingSessions } = await supabase
    .from('attendance_sessions')
    .select('id')
    .eq('employee_id', employeeId)
    .gte('check_in', windowStart)
    .lt('check_in', windowEnd)

  if (existingSessions?.length) {
    await supabase.from('attendance_sessions').delete().in('id', existingSessions.map(s => s.id))
  }

  const { data: inserted, error } = await supabase
    .from('attendance_sessions')
    .insert(sessions.map(s => ({
      employee_id: employeeId,
      check_in:    s.checkIn,
      check_out:   s.checkOut,
      is_wfh:      !!s.isWFH,
    })))
    .select()
  if (error) throw error

  await supabase.from('attendance_overrides').insert({
    attendance_id: null,
    employee_id:   employeeId,
    date,
    field_changed: 'sessions',
    old_value:     JSON.stringify(existingSessions || []),
    new_value:     JSON.stringify(inserted),
    reason,
    overridden_by: reviewerId,
  })

  const attendance = await recomputeDayAggregate(employeeId, date)
  await supabase.from('attendance').update({ hr_override: true }).eq('id', attendance.id)

  return { sessions: inserted, attendance }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/api.attendance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.attendance.js src/tests/api.attendance.test.js
git commit -m "Add HR/Admin direct session override (hrSetSessions), replacing overrideAttendance"
```

---

### Task 7: Regularization API — submit, list, withdraw

**Files:**
- Create: `src/lib/api.attendanceRegularization.js`
- Create: `src/tests/api.attendanceRegularization.test.js`

**Interfaces:**
- Consumes: `supabase` client, `createNotification` from `src/lib/api.notifications.js` (existing).
- Produces: `submitRegularizationRequest(employeeId, items)`, `getMyRegularizationRequests(employeeId)`, `withdrawRegularizationRequest(requestId, employeeId)` — used by Task 12 (`RegularizationForm.jsx`).

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabase', () => {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve({ data: { id: 'req-1' }, error: null })),
    maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
  }
  return { supabase: { from: vi.fn(() => chain) } }
})
vi.mock('../lib/api.notifications', () => ({ createNotification: vi.fn(() => Promise.resolve({})) }))

import { submitRegularizationRequest } from '../lib/api.attendanceRegularization'

describe('submitRegularizationRequest', () => {
  it('throws when items array is empty', async () => {
    await expect(submitRegularizationRequest('emp-1', [])).rejects.toThrow(/at least one date/i)
  })

  it('throws when an item is missing a reason', async () => {
    await expect(submitRegularizationRequest('emp-1', [
      { date: '2026-06-17', proposedCheckIn: '09:00', proposedCheckOut: '18:00', reason: '' },
    ])).rejects.toThrow(/reason/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/api.attendanceRegularization.test.js`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

```js
import { supabase } from './supabase'
import { createNotification } from './api.notifications'

function timeToISO(dateStr, timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCHours(h, m, 0, 0)
  return d.toISOString()
}

export async function submitRegularizationRequest(employeeId, items) {
  if (!items || items.length === 0) throw new Error('Please add at least one date to regularize.')
  for (const item of items) {
    if (!item.date) throw new Error('Each entry needs a date.')
    if (!item.proposedCheckIn || !item.proposedCheckOut) throw new Error('Each entry needs a proposed check-in and check-out time.')
    if (!item.reason || !item.reason.trim()) throw new Error('Each entry needs a reason.')
  }

  const { data: request, error: reqError } = await supabase
    .from('attendance_regularization_requests')
    .insert({ employee_id: employeeId, status: 'pending_manager' })
    .select()
    .single()
  if (reqError) throw reqError

  const { error: itemsError } = await supabase
    .from('attendance_regularization_items')
    .insert(items.map(item => ({
      request_id:         request.id,
      date:               item.date,
      proposed_check_in:  timeToISO(item.date, item.proposedCheckIn),
      proposed_check_out: timeToISO(item.date, item.proposedCheckOut),
      reason:             item.reason.trim(),
    })))
  if (itemsError) throw itemsError

  const { data: employee } = await supabase
    .from('employees')
    .select('full_name, manager_id')
    .eq('id', employeeId)
    .single()

  let recipientId = employee?.manager_id
  if (!recipientId) {
    // Exclude the submitting employee themselves — an HR/Admin with no
    // manager_id must not end up as their own request's reviewer.
    const { data: hrList } = await supabase
      .from('employees')
      .select('id')
      .in('role_type', ['hr', 'admin'])
      .eq('status', 'active')
      .neq('id', employeeId)
      .limit(1)
    recipientId = hrList?.[0]?.id
  }

  if (recipientId) {
    await createNotification({
      employeeId: recipientId,
      type: 'attendance_regularization_submitted',
      title: 'Attendance Regularization Request',
      message: `${employee?.full_name || 'An employee'} submitted a regularization request for ${items.length} date(s).`,
      metadata: { request_id: request.id },
    })
  }

  return request
}

export async function getMyRegularizationRequests(employeeId) {
  const { data: requests, error } = await supabase
    .from('attendance_regularization_requests')
    .select('*, items:attendance_regularization_items(*)')
    .eq('employee_id', employeeId)
    .order('submitted_at', { ascending: false })
  if (error) throw error
  return requests || []
}

export async function withdrawRegularizationRequest(requestId, employeeId) {
  const { data: request, error } = await supabase
    .from('attendance_regularization_requests')
    .select('*')
    .eq('id', requestId)
    .eq('employee_id', employeeId)
    .single()
  if (error) throw error
  if (request.status !== 'pending_manager') {
    throw new Error('This request has already been reviewed and can no longer be withdrawn.')
  }
  await supabase.from('attendance_regularization_requests').delete().eq('id', requestId)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/api.attendanceRegularization.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.attendanceRegularization.js src/tests/api.attendanceRegularization.test.js
git commit -m "Add regularization request submit/list/withdraw API"
```

---

### Task 8: Regularization API — manager decide, admin apply/reject

**Files:**
- Modify: `src/lib/api.attendanceRegularization.js`
- Modify: `src/tests/api.attendanceRegularization.test.js`

**Interfaces:**
- Consumes: `hrSetSessions` (Task 6), `createNotification` (existing).
- Produces: `getManagerPendingItems(managerId)`, `managerDecideItem(itemId, decision, managerId)`, `getAdminPendingItems()`, `adminApplyItem(itemId, finalCheckIn, finalCheckOut, adminId)`, `adminRejectItem(itemId, adminId)` — used by Task 13 (`RegularizationQueue.jsx`).

- [ ] **Step 1: Write the failing tests**

```js
describe('managerDecideItem', () => {
  it('rejects an invalid decision value', async () => {
    const { managerDecideItem } = await import('../lib/api.attendanceRegularization')
    await expect(managerDecideItem('item-1', 'maybe', 'mgr-1')).rejects.toThrow(/approved.*rejected|invalid decision/i)
  })
})

describe('adminApplyItem', () => {
  it('requires finalCheckIn and finalCheckOut', async () => {
    const { adminApplyItem } = await import('../lib/api.attendanceRegularization')
    await expect(adminApplyItem('item-1', null, null, 'admin-1')).rejects.toThrow(/check-in.*check-out|required/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/api.attendanceRegularization.test.js -t "managerDecideItem"`
Expected: FAIL — functions don't exist yet.

- [ ] **Step 3: Implement**

Append to `src/lib/api.attendanceRegularization.js` (add `hrSetSessions` to the import from `./api.attendance`):

```js
import { hrSetSessions } from './api.attendance'
```

```js
// ─── MANAGER QUEUE ────────────────────────────────────────────────────────────

export async function getManagerPendingItems(managerId) {
  const { data: reports } = await supabase
    .from('employees')
    .select('id')
    .eq('manager_id', managerId)
  const reportIds = (reports || []).map(r => r.id)
  if (reportIds.length === 0) return []

  const { data: items, error } = await supabase
    .from('attendance_regularization_items')
    .select('*, request:request_id(id, employee_id, employee:employee_id(full_name, avatar_initials))')
    .eq('manager_decision', 'pending')
    .order('date', { ascending: false })
  if (error) throw error

  return (items || []).filter(item => reportIds.includes(item.request?.employee_id))
}

async function recalcRequestStatus(requestId) {
  const { data: items } = await supabase
    .from('attendance_regularization_items')
    .select('manager_decision, admin_decision')
    .eq('request_id', requestId)

  const rows = items || []
  let status = 'completed'
  if (rows.some(i => i.manager_decision === 'pending')) status = 'pending_manager'
  else if (rows.some(i => i.manager_decision === 'approved' && !i.admin_decision)) status = 'pending_admin'

  await supabase.from('attendance_regularization_requests').update({ status }).eq('id', requestId)
}

export async function managerDecideItem(itemId, decision, managerId) {
  if (!['approved', 'rejected'].includes(decision)) {
    throw new Error('Invalid decision — must be "approved" or "rejected".')
  }

  const { data: item, error } = await supabase
    .from('attendance_regularization_items')
    .update({ manager_decision: decision, decided_at: new Date().toISOString() })
    .eq('id', itemId)
    .select('*, request:request_id(id, employee_id)')
    .single()
  if (error) throw error

  await recalcRequestStatus(item.request.id)

  if (decision === 'rejected') {
    await createNotification({
      employeeId: item.request.employee_id,
      type: 'attendance_regularization_decided',
      title: 'Regularization Request Rejected',
      message: `Your manager rejected your regularization request for ${item.date}.`,
      metadata: { item_id: itemId },
    })
  } else {
    const { data: hrList } = await supabase
      .from('employees')
      .select('id')
      .in('role_type', ['hr', 'admin'])
      .eq('status', 'active')
      .limit(1)
    if (hrList?.[0]?.id) {
      await createNotification({
        employeeId: hrList[0].id,
        type: 'attendance_regularization_pending_admin',
        title: 'Regularization Approved — Awaiting Admin',
        message: `A manager-approved regularization for ${item.date} is awaiting your final action.`,
        metadata: { item_id: itemId },
      })
    }
  }

  return item
}

// ─── ADMIN/HR QUEUE ───────────────────────────────────────────────────────────

export async function getAdminPendingItems(excludeEmployeeId) {
  const { data: items, error } = await supabase
    .from('attendance_regularization_items')
    .select('*, request:request_id(id, employee_id, employee:employee_id(full_name, avatar_initials))')
    .eq('manager_decision', 'approved')
    .is('admin_decision', null)
    .order('date', { ascending: false })
  if (error) throw error
  // Never let a reviewer see/apply their own regularization request in the admin queue.
  return (items || []).filter(item => item.request?.employee_id !== excludeEmployeeId)
}

export async function adminApplyItem(itemId, finalCheckIn, finalCheckOut, adminId) {
  if (!finalCheckIn || !finalCheckOut) {
    throw new Error('Both check-in and check-out are required to apply this correction.')
  }

  const { data: item, error } = await supabase
    .from('attendance_regularization_items')
    .select('*, request:request_id(id, employee_id)')
    .eq('id', itemId)
    .single()
  if (error) throw error

  await hrSetSessions(
    item.request.employee_id,
    item.date,
    [{ checkIn: finalCheckIn, checkOut: finalCheckOut, isWFH: false }],
    adminId,
    `Applied from regularization request (item ${itemId})`
  )

  await supabase
    .from('attendance_regularization_items')
    .update({ admin_decision: 'approved', decided_at: new Date().toISOString() })
    .eq('id', itemId)

  await recalcRequestStatus(item.request.id)

  await createNotification({
    employeeId: item.request.employee_id,
    type: 'attendance_regularization_decided',
    title: 'Attendance Corrected',
    message: `Your attendance for ${item.date} has been corrected as requested.`,
    metadata: { item_id: itemId },
  })

  return item
}

export async function adminRejectItem(itemId, adminId) {
  const { data: item, error } = await supabase
    .from('attendance_regularization_items')
    .update({ admin_decision: 'rejected', decided_at: new Date().toISOString() })
    .eq('id', itemId)
    .select('*, request:request_id(id, employee_id)')
    .single()
  if (error) throw error

  await recalcRequestStatus(item.request.id)

  await createNotification({
    employeeId: item.request.employee_id,
    type: 'attendance_regularization_decided',
    title: 'Regularization Request Rejected',
    message: `Admin rejected your regularization request for ${item.date}.`,
    metadata: { item_id: itemId },
  })

  return item
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/api.attendanceRegularization.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.attendanceRegularization.js src/tests/api.attendanceRegularization.test.js
git commit -m "Add manager approve/reject and admin apply/reject for regularization items"
```

---

### Task 9: Scheduled notifications — regularization reminder + weekly report

**Files:**
- Modify: `src/lib/api.notifications.js`
- Test: `src/tests/api.notifications.test.js` (create if it doesn't already exist — check first)

**Interfaces:**
- Consumes: `createNotification`, `broadcastNotification` (existing), `getWeekStart` (Task 5).
- Produces: extends `runDailyChecks(reviewerEmployeeId)` with two new checks.

- [ ] **Step 1: Check whether a notifications test file already exists**

Run: `ls src/tests/ | grep notification`
If `api.notifications.test.js` exists, add to it. If not, create it following the mocking pattern used in `src/tests/api.attendance.test.js`/`api.leave.test.js`.

- [ ] **Step 2: Write the failing test**

```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabase', () => {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    not: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lt: vi.fn(() => chain),
    is: vi.fn(() => chain),
    order: vi.fn(() => chain),
    insert: vi.fn(() => Promise.resolve({ data: {}, error: null })),
    single: vi.fn(() => Promise.resolve({ data: null, error: null })),
  }
  chain.select.mockImplementation(() => Promise.resolve({ data: [], count: 0, error: null }))
  return { supabase: { from: vi.fn(() => chain) } }
})

import { shouldSendMonthlyRegularizationReminder } from '../lib/api.notifications'

describe('shouldSendMonthlyRegularizationReminder', () => {
  it('returns true on the 25th of the month', () => {
    expect(shouldSendMonthlyRegularizationReminder(new Date('2026-06-25T10:00:00.000Z'))).toBe(true)
  })

  it('returns true on the last day of the month', () => {
    expect(shouldSendMonthlyRegularizationReminder(new Date('2026-06-30T10:00:00.000Z'))).toBe(true)
  })

  it('returns false before the 25th', () => {
    expect(shouldSendMonthlyRegularizationReminder(new Date('2026-06-24T10:00:00.000Z'))).toBe(false)
  })

  it('returns false in a different month entirely', () => {
    expect(shouldSendMonthlyRegularizationReminder(new Date('2026-06-10T10:00:00.000Z'))).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/tests/api.notifications.test.js -t "shouldSendMonthlyRegularizationReminder"`
Expected: FAIL — function not exported yet.

- [ ] **Step 4: Implement the pure date-window helper and wire it into `runDailyChecks`**

Add near the top of `src/lib/api.notifications.js` (after existing imports):

```js
// Fires from the 25th through the last day of the month (inclusive).
export function shouldSendMonthlyRegularizationReminder(now = new Date()) {
  const day = now.getUTCDate()
  const lastDayOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  return day >= 25 && day <= lastDayOfMonth
}
```

Inside `runDailyChecks(reviewerEmployeeId)`, after the existing birthday block (and before whatever closes the function), add:

```js
// ── Monthly regularization reminder (25th → month-end) ────────────────────
if (shouldSendMonthlyRegularizationReminder(today)) {
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`

  const { data: unresolvedDays } = await supabase
    .from('attendance')
    .select('employee_id, date, status')
    .in('status', ['half_day', 'absent'])
    .gte('date', monthStart)
    .lte('date', todayStr)

  const { data: alreadyRequestedItems } = await supabase
    .from('attendance_regularization_items')
    .select('date, request:request_id(employee_id)')
    .gte('date', monthStart)

  const requestedSet = new Set(
    (alreadyRequestedItems || []).map(i => `${i.request?.employee_id}:${i.date}`)
  )

  const byEmployee = {}
  for (const row of unresolvedDays || []) {
    if (requestedSet.has(`${row.employee_id}:${row.date}`)) continue
    byEmployee[row.employee_id] = (byEmployee[row.employee_id] || 0) + 1
  }

  for (const [employeeId, count] of Object.entries(byEmployee)) {
    const { count: alreadyNotifiedToday } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('employee_id', employeeId)
      .eq('type', 'attendance_regularization_reminder')
      .gte('created_at', todayStr)

    if (alreadyNotifiedToday === 0) {
      await createNotification({
        employeeId,
        type: 'attendance_regularization_reminder',
        title: 'Attendance Regularization Reminder',
        message: `You have ${count} day(s) this month that may need regularization — submit before month-end.`,
        metadata: { count },
      })
    }
  }
}

// ── Weekly attendance report ready (every Monday) ──────────────────────────
if (today.getDay() === 1) { // 0=Sun, 1=Mon
  const { count: alreadyNotifiedThisWeek } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('employee_id', reviewerEmployeeId)
    .eq('type', 'attendance_weekly_report_ready')
    .gte('created_at', todayStr)

  if (alreadyNotifiedThisWeek === 0) {
    await createNotification({
      employeeId: reviewerEmployeeId,
      type: 'attendance_weekly_report_ready',
      title: 'Weekly Attendance Report Ready',
      message: 'The attendance Weekly view has been updated for last week.',
      metadata: {},
    })
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/tests/api.notifications.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/api.notifications.js src/tests/api.notifications.test.js
git commit -m "Add monthly regularization reminder and weekly report notifications to runDailyChecks"
```

---

### Task 10: Employee Attendance page — multi-session UI + This Week card

**Files:**
- Modify: `src/pages/employee/AttendancePage.jsx`

**Interfaces:**
- Consumes: `checkIn`, `checkOut`, `getTodaySessions`, `getOpenSession`, `getWeeklyHours`, `getWeekStart`, `formatTime`, `todayISO` (all from `src/lib/api.attendance.js`, Tasks 3-5).

- [ ] **Step 1: Replace `CheckInPanel` to work off sessions instead of one check_in/check_out pair**

In `src/pages/employee/AttendancePage.jsx`, replace the `CheckInPanel` function (previously lines 50-163) with:

```js
// ─── SESSIONS LIST ────────────────────────────────────────────────────────────
function SessionsList({ sessions }) {
  if (sessions.length === 0) return null
  return (
    <div style={{ margin: '20px 0', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
      {sessions.map((s, i) => (
        <div key={s.id} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 14px', borderRadius: 8, background: C.surfaceAlt, fontSize: 13,
        }}>
          <span style={{ color: C.textMid }}>
            Session {i + 1}: {formatTime(s.check_in)} – {s.check_out ? formatTime(s.check_out) : 'ongoing'}
            {s.is_wfh && <span style={{ marginLeft: 8, fontSize: 11, color: C.brand }}>🏠 WFH</span>}
          </span>
          {s.check_out && (
            <span style={{ fontWeight: 700, color: C.amber }}>
              {hoursWorked(s.check_in, s.check_out)}h
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── CHECK IN/OUT PANEL ───────────────────────────────────────────────────────
function CheckInPanel({ today, sessions, openSession, onCheckIn, onCheckOut, loading }) {
  const [isWFH, setIsWFH] = useState(false)
  const hasOpenSession = !!openSession
  const atSessionCap = sessions.length >= 5 && !hasOpenSession

  return (
    <Card style={{ padding: '32px', textAlign: 'center' }}>
      <LiveClock />

      <div style={{ margin: '28px 0 20px', display: 'flex', justifyContent: 'center', gap: 12 }}>
        {!hasOpenSession && !atSessionCap && (
          <button onClick={() => setIsWFH(w => !w)} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 16px', borderRadius: 8,
            border: `1.5px solid ${isWFH ? C.brand : C.border}`,
            background: isWFH ? C.brandLight : '#fff',
            color: isWFH ? C.brand : C.textMid,
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: "'DM Sans',sans-serif",
          }}>
            <span>🏠</span>
            {isWFH ? 'Working from Home' : 'Mark as WFH'}
          </button>
        )}
      </div>

      <SessionsList sessions={sessions} />

      {today?.status && (
        <div style={{ marginBottom: 20 }}>
          <StatusBadge status={today.status} />
          {today.hours_worked > 0 && (
            <span style={{ marginLeft: 10, fontSize: 13, color: C.textMid }}>
              {today.hours_worked}h logged today
            </span>
          )}
        </div>
      )}

      {atSessionCap && (
        <div style={{ marginBottom: 16 }}>
          <Alert type="warning" message="You've reached today's check-in limit (5 sessions). If you need to log more time, submit a regularization request below." />
        </div>
      )}

      {!hasOpenSession && !atSessionCap && (
        <button onClick={() => onCheckIn(isWFH)} disabled={loading} style={{
          padding: '16px 48px', borderRadius: 12, border: 'none',
          background: loading ? C.border : C.green,
          color: loading ? C.textLight : '#fff',
          fontSize: 16, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
          fontFamily: "'Sora',sans-serif",
          boxShadow: loading ? 'none' : `0 6px 20px ${C.green}50`,
        }}>
          {loading ? 'Checking in…' : sessions.length === 0 ? '✓ Check In' : '✓ Check In (new session)'}
        </button>
      )}

      {hasOpenSession && (
        <button onClick={onCheckOut} disabled={loading} style={{
          padding: '16px 48px', borderRadius: 12, border: 'none',
          background: loading ? C.border : C.accent,
          color: loading ? C.textLight : '#fff',
          fontSize: 16, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
          fontFamily: "'Sora',sans-serif",
          boxShadow: loading ? 'none' : `0 6px 20px ${C.accent}50`,
        }}>
          {loading ? 'Checking out…' : '✕ Check Out'}
        </button>
      )}
    </Card>
  )
}

// ─── THIS WEEK CARD ───────────────────────────────────────────────────────────
function ThisWeekCard({ weekly }) {
  if (!weekly) return null
  const pct = Math.min(100, Math.round((weekly.totalHours / weekly.targetHours) * 100))
  return (
    <Card style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>This Week</span>
        <span style={{ fontSize: 13, color: C.textMid }}>{weekly.totalHours} / {weekly.targetHours} hrs</span>
      </div>
      <div style={{ height: 8, borderRadius: 6, background: C.border, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: C.brand, borderRadius: 6, transition: 'width 0.3s' }} />
      </div>
    </Card>
  )
}
```

- [ ] **Step 2: Update imports at the top of the file**

Replace the existing import block:
```js
import {
  checkIn, checkOut, getTodayAttendance,
  getMyMonthlyAttendance, getHolidays,
  formatTime, hoursWorked, todayISO,
} from '../../lib/api.attendance'
```
with:
```js
import {
  checkIn, checkOut, getTodayAttendance, getTodaySessions, getOpenSession,
  getMyMonthlyAttendance, getHolidays, getWeeklyHours, getWeekStart,
  formatTime, hoursWorked, todayISO,
} from '../../lib/api.attendance'
```

- [ ] **Step 3: Update the main page component's state/effects to load sessions + weekly hours, and add the "Request Regularization" entry point**

Find the main `export default function AttendancePage()` component. Update its data-loading `useEffect`/`load` function to also fetch `getTodaySessions(employee.id)`, `getOpenSession(employee.id)`, and `getWeeklyHours(employee.id, getWeekStart(todayISO()))`, storing them in new `useState` hooks (`sessions`, `openSession`, `weekly`). Pass `sessions`/`openSession` into `<CheckInPanel>` and render `<ThisWeekCard weekly={weekly} />` near the top of the page, above or beside the existing `CheckInPanel`. Update `handleCheckIn`/`handleCheckOut` to re-fetch sessions/openSession/weekly (in addition to `today`) after each action, and add a "Request Regularization" button that opens the `RegularizationForm` component (built in Task 12) — render it conditionally via a `showRegularizationForm` state flag, same pattern as other modal-toggling pages in this codebase (e.g., `showRecord` in `HRLeaveManagementPage.jsx`).

Since the exact surrounding JSX (imports of `Modal`/layout wrappers, existing `AppShell` usage) varies by what's above/below the section being replaced, read the full current file before making this edit to match the existing modal/layout pattern exactly — don't guess at wrapper components not shown in this task.

- [ ] **Step 4: Manual verification**

Run `npm run build` to confirm no syntax errors. Full behavioral verification (checking in/out, hitting the 5-session cap, opening the regularization form) happens after Task 12 is done, since the form doesn't exist until then.

- [ ] **Step 5: Commit**

```bash
git add src/pages/employee/AttendancePage.jsx
git commit -m "Rework Attendance page for multi-session check-in/out and weekly hours"
```

---

### Task 11: `RegularizationForm.jsx` — employee submission form

**Files:**
- Create: `src/components/RegularizationForm.jsx`

**Interfaces:**
- Consumes: `submitRegularizationRequest` (Task 7).
- Produces: `<RegularizationForm employeeId={...} onSubmitted={...} onClose={...} />` — used by Task 10 (AttendancePage entry point).

- [ ] **Step 1: Write the component**

Follow the modal-form pattern already established in this codebase (see `RecordLeaveModal` in `src/pages/hr/HRLeaveManagementPage.jsx` for the exact structural convention: local state per field, a rows array, add/remove row buttons, a single save handler with try/catch/setError).

```jsx
import { useState } from 'react'
import { Card, Button, Alert, Spinner } from './ui'
import { C, FONTS } from '../lib/constants'
import { submitRegularizationRequest } from '../lib/api.attendanceRegularization'

function emptyRow() {
  return { date: '', proposedCheckIn: '', proposedCheckOut: '', reason: '' }
}

export default function RegularizationForm({ employeeId, onSubmitted, onClose }) {
  const [rows, setRows] = useState([emptyRow()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function updateRow(index, field, value) {
    setRows(rs => rs.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  function addRow() { setRows(rs => [...rs, emptyRow()]) }
  function removeRow(index) { setRows(rs => rs.filter((_, i) => i !== index)) }

  async function handleSubmit() {
    setError('')
    setSaving(true)
    try {
      await submitRegularizationRequest(employeeId, rows)
      onSubmitted()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <Card style={{ width: 560, maxHeight: '85vh', overflowY: 'auto', padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: FONTS.display, marginBottom: 16 }}>
          Request Attendance Regularization
        </div>

        {rows.map((row, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, padding: 12, background: C.surfaceAlt, borderRadius: 10 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="date" value={row.date} max={new Date().toISOString().split('T')[0]}
                onChange={e => updateRow(i, 'date', e.target.value)}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 7, border: `1.5px solid ${C.border}`, fontSize: 13 }} />
              <input type="time" value={row.proposedCheckIn}
                onChange={e => updateRow(i, 'proposedCheckIn', e.target.value)}
                style={{ padding: '8px 10px', borderRadius: 7, border: `1.5px solid ${C.border}`, fontSize: 13 }} />
              <input type="time" value={row.proposedCheckOut}
                onChange={e => updateRow(i, 'proposedCheckOut', e.target.value)}
                style={{ padding: '8px 10px', borderRadius: 7, border: `1.5px solid ${C.border}`, fontSize: 13 }} />
              {rows.length > 1 && (
                <button onClick={() => removeRow(i)} style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 16 }}>✕</button>
              )}
            </div>
            <input value={row.reason} onChange={e => updateRow(i, 'reason', e.target.value)}
              placeholder="Reason (e.g. forgot to check out)"
              style={{ padding: '8px 10px', borderRadius: 7, border: `1.5px solid ${C.border}`, fontSize: 13 }} />
          </div>
        ))}

        <button onClick={addRow} style={{ background: 'none', border: 'none', color: C.brand, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
          + Add another date
        </button>

        {error && <div style={{ marginBottom: 12 }}><Alert type="error" message={error} /></div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? <><Spinner size={14} /> Submitting…</> : 'Submit Request'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Manual verification**

Run `npm run build` to confirm no syntax errors. Full behavioral verification happens once Task 10 wires this component into the Attendance page.

- [ ] **Step 3: Commit**

```bash
git add src/components/RegularizationForm.jsx
git commit -m "Add RegularizationForm component for employee regularization requests"
```

---

### Task 12: Wire `RegularizationForm` into the Attendance page

**Files:**
- Modify: `src/pages/employee/AttendancePage.jsx`

**Interfaces:**
- Consumes: `RegularizationForm` (Task 11).

- [ ] **Step 1: Add the entry point and modal toggle**

In the main `AttendancePage` component (same one touched in Task 10), add a `showRegularizationForm` state flag, a button near the `CheckInPanel` (e.g. below it) labeled "Request Regularization" that sets it to `true`, and conditionally render:
```jsx
{showRegularizationForm && (
  <RegularizationForm
    employeeId={employee.id}
    onSubmitted={() => { setShowRegularizationForm(false); load() }}
    onClose={() => setShowRegularizationForm(false)}
  />
)}
```
Add the import: `import RegularizationForm from '../../components/RegularizationForm'`.

- [ ] **Step 2: Manual verification**

Run `npm run build`. Then manually test in the browser (dev server): check in, check out, check in again (session 2), verify the session cap message appears after 5 check-ins in one day, and that "Request Regularization" opens the form and a submission succeeds without error.

- [ ] **Step 3: Commit**

```bash
git add src/pages/employee/AttendancePage.jsx
git commit -m "Wire regularization request form into Attendance page"
```

---

### Task 13: `RegularizationQueue.jsx` — shared manager/admin review component

**Files:**
- Create: `src/components/RegularizationQueue.jsx`

**Interfaces:**
- Consumes: `getManagerPendingItems`, `managerDecideItem`, `getAdminPendingItems`, `adminApplyItem`, `adminRejectItem` (Task 8).
- Produces: `<RegularizationQueue mode="manager"|"admin" reviewerId={...} />` — used by Task 14 (manager section on employee side) and Task 15 (HR Attendance page admin tab).

- [ ] **Step 1: Write the component**

```jsx
import { useEffect, useState } from 'react'
import { Card, Avatar, Button, Spinner, EmptyState, Alert } from './ui'
import { C, FONTS } from '../lib/constants'
import { formatTime } from '../lib/api.attendance'
import {
  getManagerPendingItems, managerDecideItem,
  getAdminPendingItems, adminApplyItem, adminRejectItem,
} from '../lib/api.attendanceRegularization'

function isoToTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function AdminApplyRow({ item, reviewerId, onDone }) {
  const [checkIn, setCheckIn] = useState(isoToTime(item.proposed_check_in))
  const [checkOut, setCheckOut] = useState(isoToTime(item.proposed_check_out))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function timeToISO(timeStr) {
    const [h, m] = timeStr.split(':').map(Number)
    const d = new Date(`${item.date}T00:00:00.000Z`)
    d.setUTCHours(h, m, 0, 0)
    return d.toISOString()
  }

  async function apply() {
    setSaving(true); setError('')
    try {
      await adminApplyItem(item.id, timeToISO(checkIn), timeToISO(checkOut), reviewerId)
      onDone()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function reject() {
    setSaving(true); setError('')
    try {
      await adminRejectItem(item.id, reviewerId)
      onDone()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ padding: 14, borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <Avatar initials={item.request?.employee?.avatar_initials || '??'} size={30} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{item.request?.employee?.full_name}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{item.date} — {item.reason}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="time" value={checkIn} onChange={e => setCheckIn(e.target.value)}
          style={{ padding: '6px 8px', borderRadius: 6, border: `1.5px solid ${C.border}`, fontSize: 12 }} />
        <input type="time" value={checkOut} onChange={e => setCheckOut(e.target.value)}
          style={{ padding: '6px 8px', borderRadius: 6, border: `1.5px solid ${C.border}`, fontSize: 12 }} />
        <Button size="sm" onClick={apply} disabled={saving}>Apply</Button>
        <Button size="sm" variant="outline" onClick={reject} disabled={saving}>Reject</Button>
      </div>
      {error && <div style={{ marginTop: 8 }}><Alert type="error" message={error} /></div>}
    </div>
  )
}

function ManagerRow({ item, reviewerId, onDone }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function decide(decision) {
    setSaving(true); setError('')
    try {
      await managerDecideItem(item.id, decision, reviewerId)
      onDone()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ padding: 14, borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Avatar initials={item.request?.employee?.avatar_initials || '??'} size={30} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{item.request?.employee?.full_name}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{item.date} — {item.reason}</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: C.textMid, marginBottom: 8 }}>
        Proposed: {formatTime(item.proposed_check_in)} – {formatTime(item.proposed_check_out)}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="sm" onClick={() => decide('approved')} disabled={saving}>Approve</Button>
        <Button size="sm" variant="outline" onClick={() => decide('rejected')} disabled={saving}>Reject</Button>
      </div>
      {error && <div style={{ marginTop: 8 }}><Alert type="error" message={error} /></div>}
    </div>
  )
}

export default function RegularizationQueue({ mode, reviewerId }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const data = mode === 'admin'
        ? await getAdminPendingItems(reviewerId)
        : await getManagerPendingItems(reviewerId)
      setItems(data)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [mode, reviewerId])

  return (
    <Card padding="0">
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, fontSize: 15, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>
        {mode === 'admin' ? '📋 Regularizations Awaiting Final Approval' : '📋 Team Regularization Requests'}
      </div>
      {loading
        ? <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={24} /></div>
        : items.length === 0
          ? <EmptyState icon="✅" title="Nothing pending" />
          : items.map(item => mode === 'admin'
              ? <AdminApplyRow key={item.id} item={item} reviewerId={reviewerId} onDone={load} />
              : <ManagerRow key={item.id} item={item} reviewerId={reviewerId} onDone={load} />
            )
      }
    </Card>
  )
}
```

- [ ] **Step 2: Manual verification**

Run `npm run build`. Full behavioral verification happens once Tasks 14/15 render this component in a real page.

- [ ] **Step 3: Commit**

```bash
git add src/components/RegularizationQueue.jsx
git commit -m "Add shared RegularizationQueue component for manager and admin review"
```

---

### Task 14: Manager section on the employee side + AttendanceOverridePanel session rework

**Files:**
- Modify: `src/pages/employee/AttendancePage.jsx`
- Modify: `src/components/AttendanceOverridePanel.jsx`

**Interfaces:**
- Consumes: `RegularizationQueue` (Task 13, mode="manager"), `getAllEmployees` (existing, from `src/lib/api.js`), `hrSetSessions` (Task 6), `getTodaySessions`/session-shaped data for the selected employee/date (new helper needed — see Step 2).

- [ ] **Step 1: Show the manager queue only to employees who have direct reports**

In `AttendancePage.jsx`, after loading `employees` via `getAllEmployees()` (add this fetch if not already present in the page's `load()` function), compute:
```js
const isManager = employees.some(e => e.manager_id === employee.id)
```
Render `{isManager && <RegularizationQueue mode="manager" reviewerId={employee.id} />}` near the bottom of the page, below the calendar/monthly summary section. Import `RegularizationQueue` from `'../../components/RegularizationQueue'`.

- [ ] **Step 2: Add a session-fetching helper for the override panel**

`AttendanceOverridePanel.jsx` needs to show/edit individual sessions per employee/date, not just one aggregate row. Add to `src/lib/api.attendance.js`:

```js
export async function getSessionsForDate(employeeId, date) {
  const { data, error } = await supabase
    .from('attendance_sessions')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('check_in', `${date}T00:00:00.000Z`)
    .lt('check_in', `${addDaysISO(date, 1)}T00:00:00.000Z`)
    .order('check_in', { ascending: true })
  if (error) throw error
  return data || []
}
```

- [ ] **Step 3: Rework `OverrideRow` to edit a list of sessions instead of one check-in/check-out pair**

In `src/components/AttendanceOverridePanel.jsx`, replace the `OverrideRow` function entirely:

```jsx
function OverrideRow({ employee, date, reviewerId, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [sessions, setSessions] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function startEditing() {
    const existing = await getSessionsForDate(employee.id, date)
    setSessions(existing.length
      ? existing.map(s => ({ checkIn: isoToTime(s.check_in), checkOut: isoToTime(s.check_out), isWFH: s.is_wfh }))
      : [{ checkIn: '', checkOut: '', isWFH: false }])
    setLoaded(true)
    setEditing(true)
  }

  function updateSession(i, field, value) {
    setSessions(ss => ss.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }
  function addSession() { setSessions(ss => [...ss, { checkIn: '', checkOut: '', isWFH: false }]) }
  function removeSession(i) { setSessions(ss => ss.filter((_, idx) => idx !== i)) }

  async function save() {
    if (!reason.trim()) { setError('Reason is required for audit trail.'); return }
    const valid = sessions.filter(s => s.checkIn && s.checkOut)
    if (valid.length === 0) { setError('At least one session with check-in and check-out is required.'); return }
    setSaving(true); setError('')
    try {
      await hrSetSessions(
        employee.id, date,
        valid.map(s => ({ checkIn: timeToISO(date, s.checkIn), checkOut: timeToISO(date, s.checkOut), isWFH: s.isWFH })),
        reviewerId, reason
      )
      setEditing(false)
      setReason('')
      onSaved()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ borderBottom: `1px solid ${C.border}`, padding: '14px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: editing ? 12 : 0 }}>
        <Avatar initials={employee?.avatar_initials || '??'} size={34} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{employee?.full_name}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{employee?.role} · {employee?.department}</div>
        </div>
        {!editing && (
          <Button variant="outline" size="sm" onClick={startEditing}>✏️ Edit Sessions</Button>
        )}
      </div>

      {editing && (
        <div>
          {sessions.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input type="time" value={s.checkIn} onChange={e => updateSession(i, 'checkIn', e.target.value)}
                style={{ padding: '6px 8px', borderRadius: 6, border: `1.5px solid ${C.border}`, fontSize: 12 }} />
              <input type="time" value={s.checkOut} onChange={e => updateSession(i, 'checkOut', e.target.value)}
                style={{ padding: '6px 8px', borderRadius: 6, border: `1.5px solid ${C.border}`, fontSize: 12 }} />
              <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={s.isWFH} onChange={e => updateSession(i, 'isWFH', e.target.checked)} /> WFH
              </label>
              {sessions.length > 1 && (
                <button onClick={() => removeSession(i)} style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer' }}>✕</button>
              )}
            </div>
          ))}
          <button onClick={addSession} style={{ background: 'none', border: 'none', color: C.brand, cursor: 'pointer', fontSize: 12, marginBottom: 10 }}>
            + Add session
          </button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (required)"
              style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: `1.5px solid ${C.border}`, fontSize: 12 }} />
            <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : '✓ Save'}</Button>
            <Button size="sm" variant="outline" onClick={() => { setEditing(false); setError('') }}>Cancel</Button>
          </div>
          {error && <div style={{ marginTop: 8 }}><Alert type="error" message={error} /></div>}
        </div>
      )}
    </div>
  )
}

function timeToISO(dateStr, timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const d = new Date(dateStr + 'T00:00:00')
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}
```

Update the top-of-file imports:
```js
import { getTeamAttendanceByDate, getSessionsForDate, hrSetSessions, todayISO } from '../lib/api.attendance'
```
(remove the old `overrideCheckTime` import from `api.profile.js` — no longer used.)

Update the main `AttendanceOverridePanel` component's render loop to pass `employee`/`date`/`reviewerId` instead of `record` (drop the `records.find(...)` prop since `OverrideRow` now fetches its own sessions on demand):
```jsx
activeEmployees.map(emp => (
  <OverrideRow key={emp.id} employee={emp} date={date} reviewerId={reviewerId} onSaved={load} />
))
```

- [ ] **Step 4: Manual verification**

Run `npm run build`. Manually test: as HR/Admin, open the override panel, edit an employee's sessions for a past date, save, and confirm the aggregate updates. As a manager (an employee with direct reports), confirm the "Team Regularization Requests" section appears on their Attendance page and is empty/populated correctly.

- [ ] **Step 5: Commit**

```bash
git add src/pages/employee/AttendancePage.jsx src/components/AttendanceOverridePanel.jsx src/lib/api.attendance.js
git commit -m "Add manager regularization queue to Attendance page; rework HR override to session-level editing"
```

---

### Task 15: HR Attendance page — Weekly tab + Admin regularization queue

**Files:**
- Modify: `src/pages/hr/HRAttendancePage.jsx`

**Interfaces:**
- Consumes: `getTeamWeeklyAttendance`, `getWeekStart` (Task 5), `RegularizationQueue` (Task 13, mode="admin").

- [ ] **Step 1: Read the current file to find the existing Daily/Monthly view-toggle pattern**

Read `src/pages/hr/HRAttendancePage.jsx` in full before editing — this task depends on matching its existing tab/view-switcher structure exactly, which isn't shown in this plan. Look for how it currently switches between whatever views it has (likely a `view` state var with buttons), and add a third `'weekly'` option following the same pattern.

- [ ] **Step 2: Add the Weekly view**

Add a new component in the same file:

```jsx
function WeeklyView({ weekStart, onWeekChange }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getTeamWeeklyAttendance(weekStart).then(setRows).finally(() => setLoading(false))
  }, [weekStart])

  return (
    <Card padding="0">
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>Week of {weekStart}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="outline" onClick={() => onWeekChange(-7)}>← Prev</Button>
          <Button size="sm" variant="outline" onClick={() => onWeekChange(7)}>Next →</Button>
        </div>
      </div>
      {loading
        ? <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={24} /></div>
        : rows.length === 0
          ? <EmptyState icon="📊" title="No attendance recorded this week" />
          : rows.map(r => (
              <div key={r.employee.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: `1px solid ${C.border}` }}>
                <Avatar initials={r.employee.avatar_initials} size={30} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{r.employee.full_name}</div>
                  <div style={{ fontSize: 11, color: C.textLight }}>{r.employee.department}</div>
                </div>
                <div style={{ fontSize: 12, color: C.textMid }}>{r.sessionDays} day(s) logged</div>
                <div style={{ fontSize: 12, color: C.textMid }}>{r.wfhDays} WFH</div>
                <div style={{ fontWeight: 700, color: C.brand }}>{r.totalHours}h</div>
              </div>
            ))
      }
    </Card>
  )
}
```

Add imports: `getTeamWeeklyAttendance, getWeekStart` from `'../../lib/api.attendance'`; `RegularizationQueue` from `'../../components/RegularizationQueue'`.

Add state in the main page component: `const [weekStart, setWeekStart] = useState(getWeekStart(todayISO()))`, with a handler `function shiftWeek(days) { setWeekStart(w => addDaysISO(w, days)) }` — since `addDaysISO` isn't exported from `api.attendance.js`, either export it (remove the leading nothing — just drop the `function` keyword's implicit privacy by adding `export`) or inline the equivalent logic locally in this file. Prefer exporting `addDaysISO` from `api.attendance.js` for reuse — update Task 3/5's implementation to include `export` on that helper.

Add a `'weekly'` option to whatever view-toggle UI already exists, rendering `<WeeklyView weekStart={weekStart} onWeekChange={shiftWeek} />` when selected, and a `'regularization'` option (or fold it into an existing "Admin" section if one exists) rendering `<RegularizationQueue mode="admin" reviewerId={me.id} />` (using whatever the page's existing variable name for the logged-in HR/Admin employee is — check the file for it, likely `employee` or `me` from `useAuth()`).

- [ ] **Step 3: Manual verification**

Run `npm run build`. Manually test: as HR/Admin, open the Weekly tab, page through weeks, and open the regularization admin queue to confirm manager-approved items appear and can be applied/rejected.

- [ ] **Step 4: Commit**

```bash
git add src/pages/hr/HRAttendancePage.jsx src/lib/api.attendance.js
git commit -m "Add Weekly attendance view and admin regularization queue to HR Attendance page"
```

---

### Task 16: Dashboard weekly hours widget (employee)

**Files:**
- Modify: `src/pages/employee/DashboardPage.jsx`

**Interfaces:**
- Consumes: `getWeeklyHours`, `getWeekStart` (Task 5).

- [ ] **Step 1: Read the current employee dashboard section to find where per-employee widgets are rendered**

Read `src/pages/employee/DashboardPage.jsx` around where `getTodayAttendance` is currently used (per the earlier grep, around line 463) to find the right spot to add a small weekly-hours card alongside it.

- [ ] **Step 2: Add the widget**

Add a small card (reusing the existing `Card` styling conventions in this file) showing `weekly.totalHours / weekly.targetHours hrs this week` with a thin progress bar, fetched via `getWeeklyHours(employee.id, getWeekStart(todayISO()))` in the same `Promise.all(...)` data-loading block that already fetches `getTodayAttendance`. Import `getWeeklyHours, getWeekStart` from `'../../lib/api.attendance'` (add to the existing import line).

- [ ] **Step 3: Manual verification**

Run `npm run build`. Manually check the Dashboard renders the widget with correct numbers matching what the Attendance page's own "This Week" card shows.

- [ ] **Step 4: Commit**

```bash
git add src/pages/employee/DashboardPage.jsx
git commit -m "Add weekly hours widget to employee Dashboard"
```

---

### Task 17: Final verification pass

**Files:** None (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `api.attendance.test.js` additions, `api.attendanceRegularization.test.js`, and any `api.notifications.test.js` additions from Task 9.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: clean build, no errors.

- [ ] **Step 3: Run the linter**

Run: `npm run lint`
Expected: no new errors introduced by this feature (pre-existing warnings elsewhere are out of scope).

- [ ] **Step 4: Manual end-to-end pass in the browser**

Using the dev server (or the deployed Test/Dev environment once migrations are run there): check in, check out, check in again same day (verify 2nd session), hit the 5-session cap, submit a regularization request, approve it as a manager (using a second test account with `manager_id` pointing at the first), apply it as Admin, and confirm the employee's attendance record updates and they receive the notification. Also verify the Weekly tab and Dashboard widget show consistent numbers.

- [ ] **Step 5: Final commit (if any cleanup was needed from verification)**

```bash
git add -A
git commit -m "Final cleanup pass for attendance overhaul"
```
(Only if Steps 1-4 surfaced something to fix — otherwise skip this commit.)

---

## Post-Plan Reminders

- Both new migration files (`supabase_migration_attendance_sessions.sql`, `supabase_migration_attendance_regularization.sql`) must be run manually in both Production and Test Supabase SQL Editors before this feature works end-to-end — same manual-migration pattern as every prior fix in this project.
- `git push origin main` after implementation to trigger the Vercel redeploy, same as every other change in this project.
