# Attendance Overhaul — Design Spec

**Date:** 2026-07-01
**Status:** Approved by user, ready for implementation planning
**Scope:** Attendance module only. Leave/Holiday overhaul is a separate, independent project (not covered here).

## Goals

The current attendance system has four problems this design fixes:

1. Work-start time and "late mark" are hardcoded globally (9:00 AM + 30 min grace), which doesn't work for remote employees on flexible schedules.
2. Only one check-in/check-out pair is supported per employee per day — no break/multi-session support.
3. A session spanning midnight (e.g. 6 PM–3 AM) is credited entirely to one day, when the post-midnight portion should count toward the next day.
4. There's no way for an employee to request a correction to a day's recorded attendance, and no approval workflow for such corrections.

## Key Decisions

- **Lateness is dropped entirely.** Attendance status is judged purely on total hours worked per day against the existing per-employee-type thresholds (`WORK_HOURS_BY_TYPE` — unchanged). The `late_mark` status value stops being generated; the DB column/constraint can remain for historical rows.
- Multiple check-in/check-out sessions per day are allowed, **capped at 5 sessions per employee per calendar day**. A 6th attempt is blocked with a message directing the employee to submit a regularization request instead.
- Sessions spanning midnight are **split at the midnight boundary** when computing each day's total hours (see Overnight Splitting below).
- Regularization requests carry **employee-proposed check-in/check-out times + a reason**, per date, and can bundle multiple dates in one submission.
- Approval chain: **Manager approves/rejects each date-line individually** → approved lines go to **Admin/HR, who applies the correction** (or rejects). If the employee has no `manager_id` assigned, their request skips straight to the Admin/HR queue. If the employee IS a manager/HR/Admin themselves, their own requests route to a *different* HR/Admin reviewer (never self-approving).
- HR/Admin gets a **direct session-level override tool** (extends the existing `AttendanceOverridePanel`) — not gated by approval, since HR/Admin already have that authority today. This is the same underlying write path used when Admin applies an approved regularization.
- HR/Admin gets a **Weekly view** (new tab alongside existing Daily/Monthly views) plus an **automated weekly in-app notification** (every Monday, covering the prior week). No email — this app's email integration (MSG91/Resend) is unwired/dead code today; out of scope to fix here.
- Employees see a **"This Week" hours widget** on both the Attendance page (primary) and the Dashboard (secondary, smaller).
- A **scheduled monthly reminder** runs daily from the 25th through the last day of each month, notifying employees who have unregularized half_day/absent days that month.

## Data Model

### New table: `attendance_sessions`
```sql
CREATE TABLE attendance_sessions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  check_in     TIMESTAMPTZ NOT NULL,
  check_out    TIMESTAMPTZ,           -- null while session is open
  is_wfh       BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
```
- No unique constraint on (employee_id, date) — a day has many sessions.
- App-level check: at most 5 sessions whose `check_in` falls on a given calendar day, per employee.
- App-level check: cannot open a new session while one is already open (no `check_out`) for that employee.

### `attendance` table (existing, repurposed)
Structure unchanged (`employee_id`, `date`, `check_in`, `check_out`, `hours_worked`, `is_wfh`, `status`, `hr_override`, `override_note`). Semantics change: this becomes a **computed daily aggregate**, recalculated whenever a session opens/closes for that date (or the adjacent date, for overnight spillover):
- `check_in` = earliest session check-in that day
- `check_out` = latest session check-out that day (null if any session that day is still open)
- `hours_worked` = sum of all session durations attributed to that day (see Overnight Splitting)
- `status` = derived from `hours_worked` vs. `WORK_HOURS_BY_TYPE` thresholds (no late-mark check)
- `hr_override`/`override_note` unchanged in meaning

### New tables: regularization
```sql
CREATE TABLE attendance_regularization_requests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  submitted_at  TIMESTAMPTZ DEFAULT NOW(),
  status        TEXT NOT NULL DEFAULT 'pending_manager'
                CHECK (status IN ('pending_manager','pending_admin','completed'))
                -- request-level status is a derived convenience label for list views only;
                -- per-item manager_decision/admin_decision is the actual source of truth.
                -- Derivation: 'pending_manager' if any item still has manager_decision='pending';
                -- else 'pending_admin' if any item is manager-approved but admin_decision is null;
                -- else 'completed' once every item has a final outcome (approved+applied or
                -- rejected at either stage) -- a request with some rejected and some completed
                -- items is still labeled 'completed' (fully resolved), individual outcomes are
                -- only visible at the item level.
);

CREATE TABLE attendance_regularization_items (
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
```
RLS: employees see/insert their own requests; managers see items where the request's employee has `manager_id = (their own employee id)`; HR/Admin see everything. Item decisions are only writable by the appropriate role at the appropriate stage.

## Attendance Capture Flow (Employee)

- Check-in/check-out button behaves as today, but after check-out, resets to "Check In" (doesn't lock the day) — enabling further sessions.
- A running list on the Attendance page shows each of today's sessions with duration, plus a live running total.
- WFH toggle stays per-session, set at check-in.
- "This Week" card (Attendance page, primary; Dashboard, secondary/smaller): total hours this week vs. weekly target (5 × the employee's daily full-day hours from `WORK_HOURS_BY_TYPE`), with a progress bar.
- "Request Regularization" entry point opens the multi-date form (date picker(s) + proposed check-in/out + reason per date). Only past dates are eligible. Editable/withdrawable only while still `pending_manager`.

## Overnight Splitting (Algorithm)

For each session, when computing a date's total hours:
- If `check_in` and `check_out` are on the same calendar day: full duration credits to that day.
- If `check_out` is on a later calendar day than `check_in`: split at each midnight boundary crossed. `(midnight − check_in)` credits to the check-in's day; `(check_out − midnight)` credits to the check-out's day. (Sessions spanning more than one midnight are handled the same way, generalized across each day boundary crossed, though in practice sessions are expected to span at most one midnight given the 5-session/day cap.)
- An open session (no `check_out` yet) contributes 0 hours to the aggregate; the client shows live elapsed time on the open session separately, without persisting it until check-out.

## Regularization Workflow

1. Employee submits → request status `pending_manager`, one item per date. Notifies manager (or Admin/HR directly if no `manager_id`, or if employee IS themselves manager/HR/Admin — routed to a different HR/Admin reviewer).
2. Manager reviews each date-line independently: system-recorded times shown side-by-side with proposed times and reason.
   - Approve → item moves to `pending_admin` (parent request status becomes `pending_admin` once all items have left `pending_manager`).
   - Reject → item finalized `rejected`, employee notified immediately with manager's decision.
3. Admin/HR reviews manager-approved items: can adjust times before applying.
   - Apply → writes/replaces `attendance_sessions` for that employee/date with the (possibly admin-adjusted) approved times, recomputes the day's aggregate, item finalized `completed`, employee notified.
   - Reject → item finalized `rejected`, employee notified with reason.
4. Applying replaces that date's sessions entirely (not merged with prior sessions) to avoid double-counting.

## HR/Admin Tooling

- **Extended override tool** (`AttendanceOverridePanel.jsx`): shows full session list for a selected employee/date, with add/edit/delete per session. Saving recomputes the day's aggregate. Same write path as regularization "Apply."
- **Weekly view** (new tab: Daily | Monthly | Weekly on HR Attendance page): one row per employee for the selected week — total hours, session count, WFH day count, unresolved-regularization flag.
- **Weekly notification**: every Monday, in-app notification to HR/Admin linking to the Weekly tab for the prior week.

## Notifications Summary

| Event | Recipient |
|---|---|
| Regularization submitted | Manager (or Admin/HR if no manager / self-is-manager case) |
| Manager approves item | Admin/HR |
| Manager rejects item | Employee |
| Admin applies item | Employee |
| Admin rejects item | Employee |
| Monthly reminder (25th–month-end, daily, stops once covered) | Employee, if unregularized half_day/absent days exist that month |
| Weekly report ready (every Monday) | HR/Admin |

## Edge Cases

- Session cap reached → blocked with message pointing to regularization.
- Forgotten check-out → shown as an open session indefinitely until checked out or regularized; day stays incomplete/absent in the meantime.
- Manager is also HR/Admin reviewing their own request → routed to a different HR/Admin.
- Date bucketing uses the existing app convention (UTC-based `toISOString().split('T')[0]`) — no new timezone handling introduced.

## Testing Plan

- Vitest unit tests (extending `src/tests/api.attendance.test.js`): multi-session daily aggregation, midnight-split math (several boundary cases), session cap enforcement, regularization state transitions, no-manager/self-manager routing.
- Update existing `computeStatus`/half-day-deduction tests to drop late-mark assertions.
- Manual verification: check-in/out across midnight in a real browser session, HR override editing sessions, manager/admin queues showing correctly scoped requests.

## Out of Scope

- Leave/Holiday overhaul (separate project, to be designed next).
- Email delivery for any notification in this design (app-wide email integration is unwired; in-app notifications only).
