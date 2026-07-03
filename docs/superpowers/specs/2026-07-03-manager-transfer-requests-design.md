# Manager-Initiated Employee Transfer Requests — Design

**Date:** 2026-07-03
**Status:** Approved

## Problem

Today, only HR/Admin can change an employee's reporting manager (`EmployeeManagementPage.jsx`, instant, no approval). There's no way for a manager to initiate moving one of their own direct reports to another manager. This feature adds that path, with the receiving manager required to accept before HR/Admin gives final approval.

## Scope

- A manager can request to transfer one of their direct reports to another manager (any employee who currently has ≥1 direct report).
- The target manager must accept or reject the request.
- If accepted, the request moves to HR/Admin for final approval or rejection.
- Only on HR/Admin approval does `employees.manager_id` actually change.
- HR/Admin's existing direct manager-edit in Employee Management is unchanged — stays instant, bypasses this workflow entirely (they're the final approver of this flow anyway, so this isn't a loophole).

Out of scope: bulk transfers, employees requesting their own transfer, changing the requesting manager mid-flight, SLA/expiry on pending requests.

## Data Model

New table `manager_transfer_requests`:

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `employee_id` | UUID → employees | the employee being transferred |
| `from_manager_id` | UUID → employees | current manager, the initiator |
| `to_manager_id` | UUID → employees | target/receiving manager |
| `reason` | TEXT, nullable | optional note from the initiating manager |
| `status` | TEXT | `pending_target` → `pending_hr` → `approved` \| `rejected_by_target` \| `rejected_by_hr` \| `withdrawn` |
| `target_decided_at` | TIMESTAMPTZ, nullable | when target manager accepted/rejected |
| `hr_decided_by` | UUID → employees, nullable | HR/Admin who made the final call |
| `hr_decided_at` | TIMESTAMPTZ, nullable | |
| `created_at` | TIMESTAMPTZ | default now() |

**Constraint:** only one request per `employee_id` may be in a non-terminal state (`pending_target` or `pending_hr`) at a time — enforced at the application layer (check for an existing non-terminal row before inserting; matches the existing pattern of app-layer checks rather than a partial unique index, consistent with how balance checks work in `applyLeave`).

## Flow

1. **Initiate** — Manager A, on Team Directory, picks a direct report and a target manager (dropdown scoped to employees who already have ≥1 direct report, excluding the employee's current manager), optional reason, submits. Row inserted with `status='pending_target'`. Notification sent to Manager B.
2. **Target decision** — Manager B sees it in a "Transfers" panel on Team Directory (both a list and a notification link to the same place).
   - Reject → `status='rejected_by_target'`, `target_decided_at` set. Notify Manager A only. Terminal.
   - Accept → `status='pending_hr'`, `target_decided_at` set. No notification to the employee yet.
3. **HR/Admin decision** — new "Transfer Requests" tab on `EmployeeManagementPage.jsx`, listing all `pending_hr` rows.
   - Reject → `status='rejected_by_hr'`, `hr_decided_by`/`hr_decided_at` set. Notify Manager A only. Terminal.
   - Approve → `status='approved'`, `hr_decided_by`/`hr_decided_at` set, AND `employees.manager_id` updated to `to_manager_id` in the same operation. Notify the transferred employee that their manager has changed. Terminal.
4. **Withdraw** — Manager A can withdraw their own request at any point while it's `pending_target` or `pending_hr`. Sets `status='withdrawn'`. No notifications (Manager A initiated the withdrawal themselves).

## UI

- **Team Directory** (`src/pages/employee/TeamDirectoryPage.jsx`): 
  - "Transfer" action next to each direct report row (visible only to that report's manager) → opens a modal to pick target manager + optional reason.
  - New "Transfers" panel: two lists — "Sent by me" (with status + withdraw action while non-terminal) and "Awaiting my decision" (as target manager, with accept/reject actions).
- **Employee Management** (`src/pages/hr/EmployeeManagementPage.jsx`): new "Transfer Requests" tab listing `pending_hr` rows with employee, from/to manager, reason, approve/reject actions. HR's existing direct manager-edit modal is untouched.

## RLS

Mirrors the existing Attendance Regularization pattern, reusing the already-deployed `current_employee_role()` SECURITY DEFINER helper (no new RPC needed):

- **SELECT**: visible if `from_manager_id`, `to_manager_id` = caller's employee id, or `current_employee_role() IN ('hr','admin')`.
- **INSERT**: `from_manager_id` must equal caller's employee id.
- **UPDATE**: same visibility as SELECT — application logic (not RLS) restricts which status transitions each party is allowed to make (e.g. a target manager's PATCH can only move `pending_target → pending_hr/rejected_by_target`, never touch HR's stage). This matches how `updateLeaveStatus` centralizes transition logic in `api.js` rather than in the DB layer.

## Notifications

Reuses the existing `notifications` table / `createNotification` single-recipient helper (this is a single-recipient notification at each stage, not a broadcast):
- On create → target manager.
- On target rejection → initiating manager.
- On HR rejection → initiating manager.
- On HR approval → the transferred employee ("Your reporting manager has changed to X").

No broadcast-to-everyone step in this feature (unlike the Leave Overhaul's team-wide approval notice) — this is a private, need-to-know workflow between the two managers, HR, and the affected employee.

## Edge Cases

- Target manager stops having any direct reports between request creation and decision (e.g. all their reports got reassigned elsewhere) — still allowed to decide on requests already targeting them; only the *dropdown* for new requests is scoped to current managers.
- Manager A tries to transfer an employee who isn't currently their direct report (stale UI) — blocked at insert time by re-checking `employee.manager_id === callerEmployeeId`.
- Same employee already has a non-terminal request — new request attempt blocked with a clear error, consistent with the Leave Overhaul's "block upfront" pattern rather than silently queuing.
- Target manager and initiating manager are the same person (picking yourself) — blocked in the UI (excluded from the dropdown) and re-validated at insert time.
- HR/Admin approves, but the employee's manager_id had already changed by other means (e.g. direct HR edit) between accept and approval — approval still applies the transfer's `to_manager_id`, overwriting whatever was there; this is HR's own final action so it's authoritative by definition.

## Testing Plan

Following the established bug-class checklist from prior features:
- RLS: verify a manager can't see/act on requests they're not party to; verify HR/Admin sees all.
- Notification completeness: each stage sends to exactly the right single recipient, never zero, never the wrong one.
- Status-transition guards: a target manager can't skip ahead and set `approved`; HR can't act on a `pending_target` row.
- One-in-flight-per-employee constraint enforced before insert.
- Withdraw only allowed by the initiating manager, only in non-terminal states.
