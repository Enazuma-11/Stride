# Probation Period Management — Design Spec

**Date:** 2026-07-07
**Status:** Approved

---

## Goal

Track new employees through a 6-month probation period. Manager submits a review recommendation near the end; HR makes the final call (confirm as permanent, extend once with a custom duration, or relieve). Both HR and the manager receive lifecycle notifications. The employee can see their own probation status and is notified of the outcome.

---

## Architecture

Two-step approval flow (manager → HR), matching the existing patterns used by `manager_transfer_requests` and `attendance_regularization_requests`. A new `probation_reviews` table carries the full decision trail. The `employees` table gains two narrow columns (`probation_end_date`, `probation_extended`) and a new `employee_type` value (`'probation'`).

A new API module (`api.probation.js`) owns all probation reads and writes. UI is spread across three surfaces: the employee's Profile page, the manager's dashboard, and a new Probation tab on EmployeeManagementPage.

---

## Data Model

### 1. `employee_type` enum — add `'probation'`

Migration alters the existing CHECK constraint on `employees.employee_type` to include `'probation'`:

```sql
ALTER TABLE employees
  DROP CONSTRAINT IF EXISTS employees_employee_type_check,
  ADD CONSTRAINT employees_employee_type_check
    CHECK (employee_type IN ('permanent', 'intern', 'contractor', 'parttime', 'probation'));
```

### 2. New columns on `employees`

```sql
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS probation_end_date  DATE    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS probation_extended  BOOLEAN NOT NULL DEFAULT false;
```

- `probation_end_date` is set at onboarding to `join_date + 6 months`. Overwritten (once) when HR approves an extension.
- `probation_extended` is `false` by default; flipped to `true` when HR approves an extension. Once `true`, the Extend path is disabled for the manager on second review and flagged for HR.

### 3. `probation_reviews` table

```sql
CREATE TABLE probation_reviews (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  -- Manager step
  status                  TEXT NOT NULL DEFAULT 'pending_manager'
                            CHECK (status IN ('pending_manager', 'pending_hr', 'decided')),
  manager_recommendation  TEXT CHECK (manager_recommendation IN ('confirm', 'extend', 'relieve')),
  manager_notes           TEXT,
  extension_days          INTEGER CHECK (extension_days IS NULL OR extension_days > 0),
  manager_id              UUID REFERENCES employees(id),
  manager_reviewed_at     TIMESTAMPTZ,

  -- HR step
  hr_decision             TEXT CHECK (hr_decision IN ('confirmed', 'extended', 'relieved')),
  hr_notes                TEXT,
  hr_extension_days       INTEGER CHECK (hr_extension_days IS NULL OR hr_extension_days > 0),
  hr_decided_by           UUID REFERENCES employees(id),
  hr_decided_at           TIMESTAMPTZ,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_probation_reviews_employee ON probation_reviews(employee_id);
CREATE INDEX idx_probation_reviews_status   ON probation_reviews(status);
```

**Row lifecycle:** one row is created per review cycle. An employee can have at most two rows — the original 6-month review and one extension review. The lifecycle engine creates the row (status = `pending_manager`) when it fires the 30-day reminder; the manager and HR each update it in turn.

### 4. RLS

```sql
ALTER TABLE probation_reviews ENABLE ROW LEVEL SECURITY;

-- HR/Admin can read and write all rows
CREATE POLICY "probation_hr_all" ON probation_reviews
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE user_id = auth.uid() AND role IN ('hr', 'admin')
    )
  );

-- Managers can read reviews for their direct reports + write the manager step
CREATE POLICY "probation_manager_read" ON probation_reviews
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM employees mgr
      JOIN employees emp ON emp.manager_id = mgr.id
      WHERE mgr.user_id = auth.uid() AND emp.id = probation_reviews.employee_id
    )
  );

CREATE POLICY "probation_manager_write" ON probation_reviews
  FOR UPDATE
  USING (
    status = 'pending_manager' AND
    EXISTS (
      SELECT 1 FROM employees mgr
      JOIN employees emp ON emp.manager_id = mgr.id
      WHERE mgr.user_id = auth.uid() AND emp.id = probation_reviews.employee_id
    )
  )
  WITH CHECK (
    status = 'pending_hr' AND
    EXISTS (
      SELECT 1 FROM employees mgr
      JOIN employees emp ON emp.manager_id = mgr.id
      WHERE mgr.user_id = auth.uid() AND emp.id = probation_reviews.employee_id
    )
  );

-- Employees can read their own review (to see status)
CREATE POLICY "probation_employee_read" ON probation_reviews
  FOR SELECT USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
  );
```

---

## Workflow

```
New employee onboarded with employee_type = 'probation'
  → probation_end_date = join_date + 6 months

Lifecycle engine (30 days before probation_end_date)
  → Creates probation_reviews row (status = 'pending_manager')
  → Notifies manager + all HR/Admin

Manager submits review
  → recommendation: confirm | extend | relieve
  → notes (required)
  → extension_days (required if extend; disabled if probation_extended = true)
  → status → 'pending_hr'
  → HR/Admin notified

HR makes final decision
  ├─ confirmed  → employees: employee_type = 'permanent'
  │               probation_reviews: hr_decision = 'confirmed', status = 'decided'
  │               Employee notified: "🎉 You've been confirmed as a permanent team member"
  │
  ├─ extended   → employees: probation_end_date += hr_extension_days, probation_extended = true
  │               probation_reviews: hr_decision = 'extended', status = 'decided'
  │               Lifecycle engine schedules new review 30 days before new end date
  │               Employee notified: "Your probation has been extended by N days"
  │
  └─ relieved   → employees: status = 'inactive', onboarding_status = 'offboarded'
                  probation_reviews: hr_decision = 'relieved', status = 'decided'
                  Employee notified: "Your probation period has ended"
```

**Guard rails:**
- Manager cannot review their own probation (excluded by RLS + API check).
- If `probation_extended = true`, the Extend option is disabled in the manager review form with label "Extension already used". HR can still choose to extend but it is flagged with a warning.
- Relieved employees go through the same `deactivateEmployee()` path already used in `api.js`.

---

## API — `src/lib/api.probation.js`

```
getProbationEmployees()            → all active probation employees with review status
getMyProbationStatus(employeeId)   → employee's own probation_end_date + latest review
getPendingReviews()                → reviews with status pending_manager or pending_hr (HR only)

createProbationReview(employeeId)  → creates row status='pending_manager' (lifecycle engine)
managerSubmitReview(reviewId, { recommendation, notes, extensionDays }, managerId)
hrDecideReview(reviewId, { decision, notes, extensionDays }, hrAdminId)
```

Each write function:
1. Validates guard rails before touching the DB
2. Applies the DB change first
3. Fires notifications as best-effort (try/catch, no surface to caller)

---

## UI

### Employee — Profile page

A "Probation Status" card rendered only when `employee_type = 'probation'`, inserted above the existing personal info section.

**Active state:**
- Visual timeline bar: elapsed days (filled, brand blue) / remaining days (empty). Colour shifts to amber when ≤ 30 days remain.
- Text: "Probation ends on [date] · [N] days remaining"
- Status pill: `Active` / `Under Review` (once pending_hr) / `Decision Pending`

**Outcome state (full-card takeover):**
- Confirmed: green card, ✓ icon, "You've been confirmed as a permanent team member"
- Extended: amber card, calendar icon, "Probation extended by N days — new end date [date]"
- Relieved: neutral grey card, "Your probation period has ended"

### Manager — Dashboard / Team panel

A "Probation Reviews" section surfaces when the manager has direct reports on probation with a pending review.

**Review form (large illustrated choice cards):**
- Three cards side by side: **Confirm** / **Extend** / **Relieve**
- Each card has an icon, label, and a one-line consequence ("Joins as a permanent team member" / "Review continues for custom duration" / "Offboarding process begins")
- Selected card highlights with a bold brand-coloured border
- Notes textarea (required)
- If Extend selected: "Extension duration" number input (days) appears below
- If `probation_extended = true`: Extend card is greyed out, labelled "Extension already used"
- Submit button: "Submit Review" → transitions to "Awaiting HR decision" state

### HR/Admin — EmployeeManagementPage, new "Probation" tab

Sits alongside the existing Employees / Transfers tabs.

**Pending section:**
- Cards per employee: avatar with circular countdown ring (urgency at a glance), name, end date, days left, manager recommendation badge (once submitted: "Manager: Confirm ✓" / "Manager: Extend" / "Manager: Relieve")
- HR action panel: Confirm / Extend / Relieve buttons
  - Extend: custom days input, warning badge if `probation_extended = true`
- On decision: brief success state inline — "🎉 [Name] is now a permanent team member" / "Extended by N days" / "Offboarding initiated"

**Decided section (history):**
- Collapsed timeline entries: name · outcome badge · decided by · date
- Expandable to see full review notes

### Notifications

| Trigger | Recipients | Message |
|---|---|---|
| 30 days before probation_end_date | Manager + all HR/Admin | "[Name]'s probation ends in 30 days — review required" |
| Manager submits review | All HR/Admin | "[Name]'s probation review submitted by manager — awaiting your decision" |
| HR decides: confirmed | Employee | "🎉 You've been confirmed as a permanent team member" |
| HR decides: extended | Employee | "Your probation has been extended by N days. New end date: [date]" |
| HR decides: relieved | Employee | "Your probation period has ended. Please check with HR for next steps." |

---

## Files Touched

| File | Change |
|---|---|
| `supabase_migration_probation.sql` | New — creates table, adds columns, RLS, indexes |
| `src/lib/api.probation.js` | New — all probation reads/writes |
| `src/pages/employee/ProfilePage.jsx` | Add ProbationStatusCard component |
| `src/pages/hr/EmployeeManagementPage.jsx` | Add Probation tab |
| `src/pages/employee/EmployeeLandingPage.jsx` | Add ProbationReviewPanel (rendered when `isManager` is true, same pattern as regularization queue in AttendancePage) |
| `src/lib/api.js` | Update `createEmployee` / onboarding to set `probation_end_date` |
| Lifecycle engine SQL | Add event: 30 days before `probation_end_date` for `employee_type = 'probation'` |

---

## Out of Scope

- Probation for interns (handled separately by `internship_end_date`)
- Bulk probation decisions
- Custom probation durations at onboarding (always 6 months)
