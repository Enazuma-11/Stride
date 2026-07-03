# Leave Overhaul — Design Spec

**Date:** 2026-07-03
**Status:** Approved by user, ready for implementation planning
**Scope:** Employee-chosen unpaid leave, and team-wide visibility when leave is approved. This is a standalone feature, independent of the Attendance Overhaul and Holiday Opt-In Calendar (both already shipped).

## Goals

Today's leave system has two gaps:

1. **No employee choice over paid/unpaid.** There is already a dormant, unused mechanism (`updateLeaveStatus` in `src/lib/api.js`, and a never-applied migration `supabase_migration_unpaid_leave.sql`) that *automatically* splits a leave request into paid/unpaid at approval time, based on whatever balance happens to be available — the employee has no say. This design replaces that automatic, after-the-fact split with an explicit, upfront employee choice.
2. **No team visibility into who's on leave.** When a leave request is approved today, only the requesting employee is notified. Nobody else finds out unless told directly.

## Key Decisions

- **Employee choice, not automatic calculation.** The Apply form gains a "Take this as unpaid leave" checkbox, available for every existing leave type (`casual`, `sick`, `earned`, `comp`) — not a new leave type of its own.
- **Unpaid leave bypasses the balance entirely.** Checking the box means the request does not touch `leave_balances.used_days` at all. It's tracked separately (`leave_balances.unpaid_days_taken`, already scaffolded by the existing unapplied migration). An employee can choose unpaid even with plenty of balance remaining — e.g. to preserve it for later.
- **Insufficient balance blocks the request upfront**, if unpaid isn't checked. If an employee applies for more days than their remaining balance covers and hasn't checked "unpaid," the application is rejected immediately with a clear message directing them to either shorten the dates or mark it unpaid. This replaces today's dormant auto-split-at-approval behavior, which must be removed as part of this work — it directly conflicts with the "employee decides upfront" model.
- **Approval notifies everyone, not just the requester.** When HR/a manager approves a leave request, every active employee gets an in-app notification with just the employee's name and dates (e.g., "Priya is on leave Jul 10–12") — no leave type, no reason. Keeps visibility useful for planning without exposing personal detail.
- **A persistent "Upcoming Leave" widget on the employee Dashboard** shows a running, chronological list of approved leave (nearest first) — company-wide, matching the notification's own scope, not scoped to a manager's direct reports. Visual style: avatar + name + date range per row (validated via the visual brainstorming companion — the simple list format, not a calendar-grid or timeline-strip, was the chosen direction).

## Data Model

No new tables. Reuses the two columns already scaffolded (but never applied) by `supabase_migration_unpaid_leave.sql`:

```sql
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS unpaid_days NUMERIC(5,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_days   NUMERIC(5,1) DEFAULT 0;

ALTER TABLE leave_balances
  ADD COLUMN IF NOT EXISTS unpaid_days_taken NUMERIC(5,1) DEFAULT 0;
```

This migration will need to actually be run (it never was) as part of implementing this feature — same manual-run pattern as every other migration in this project.

## Apply Flow (Employee)

- New checkbox on the Apply form: "Take this as unpaid leave." Unchecked by default.
- If checked: `applyLeave` writes the full requested day-count to `unpaid_days` (0 to `paid_days`), and does **not** touch `leave_balances.used_days`. `leave_balances.unpaid_days_taken` is incremented by the requested day-count instead, at submission time (not deferred to approval) — since the employee has already made the paid/unpaid decision, there's nothing left to calculate at approval.
- If unchecked: before submission, compute `available = total_days - used_days` for the selected leave type/year. If the requested day-count exceeds `available`, block submission with an error message (e.g. "You only have 3 days of Casual/Sick remaining — reduce the dates or mark this as unpaid leave.") rather than allowing it through. If within balance, proceed exactly as today (deduct from `used_days` at approval, unchanged).
- The existing half-day toggle, reason field, and manager/HR approval workflow are unaffected.

## Approval Flow (HR/Manager)

- `updateLeaveStatus`'s existing auto-split block (the code that currently computes `paidDays`/`unpaidDays` from available balance at approval time) is **removed**. By the time a request reaches approval, the paid/unpaid decision was already made and recorded at submission time by the employee.
- On approval, in addition to the existing employee-only notification, broadcast a company-wide notification (reusing the `broadcastNotification` helper already established in this codebase) with just the employee's name and leave dates.
- Rejection behavior is unchanged — no team broadcast on rejection, only the existing employee-facing notification.

## Dashboard Widget (Employee)

- A new card/section on the employee Dashboard: "Upcoming Leave" — lists approved leave requests with a future or current end date, ordered by start date ascending (soonest first).
- Each row: avatar, employee name, date range (e.g. "Jul 10 – 12"). No leave type, no reason — matching the notification's privacy level.
- Company-wide, not limited to the viewing employee's manager/team.
- A sensible cap on how many rows to show (e.g. the next 5-10 upcoming) rather than an unbounded list, to keep the Dashboard widget compact — exact number left to implementation, not a hard requirement.

## Edge Cases

- **Employee has zero balance and checks "unpaid":** works exactly the same as any other unpaid request — no balance involved at all.
- **Employee has zero balance and does NOT check "unpaid":** blocked immediately (0 available days means any positive day-count exceeds it).
- **Cancelling an already-submitted unpaid leave request:** existing cancellation flow (`cancelLeave` or equivalent) should reverse whatever was recorded — if it was unpaid, decrement `unpaid_days_taken` back down; if it was paid (approved with balance deduction), existing balance-reversal behavior is unchanged. Implementation should check the existing cancellation code path for how balance reversal already works today and mirror that pattern for the unpaid case.
- **Half-day + unpaid combination:** the checkbox applies regardless of half-day status — a half-day (0.5 days) can be marked unpaid the same as a full day.

## Testing Plan

Following the explicit lesson already established in this codebase (Attendance Overhaul, Holiday Opt-In Calendar): both post-launch bug waves stemmed from RLS cross-employee access gaps, non-broadcast notifications, and timezone/date-boundary math. This feature's specific risk areas to test deliberately:
- The upfront balance-blocking check must use the correct current-year balance row (matching existing `year = new Date(leave.from_date).getFullYear()` pattern already used in this codebase — verify this doesn't carry a local/UTC mismatch risk given it's already-existing code, not new).
- The approval-time broadcast notification must reach every active employee, not a single recipient — reuse `broadcastNotification`, not a hand-rolled loop.
- Removing the old auto-split block must not silently break the *balance-sufficient* approval path (deducting `used_days` on approval when the employee didn't request unpaid) — that part of `updateLeaveStatus` needs to still work, just without the paid/unpaid-split calculation.

## Out of Scope

- Changing how leave *types* work (casual/sick/earned/comp) — unchanged.
- Manager-only or team-scoped visibility — explicitly company-wide per the design decision above.
- A calendar-grid or timeline visualization for the Dashboard widget — the simple list format was the chosen direction after visual comparison.
- Any change to the leave request/approval workflow itself (who approves, in what order) — unchanged.
