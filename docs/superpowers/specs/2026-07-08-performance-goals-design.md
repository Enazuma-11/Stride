# Annual Performance Goals — Design Spec

**Date:** 2026-07-08
**Status:** Approved

---

## Goal

Add an annual performance-goal system on top of the existing OKR feature. Each active employee sets 5–8 weighted goals (points summing to exactly 100) during a yearly window. Their manager approves the goal set, then conducts a half-yearly (H1) progress review and a year-end review. At year-end the manager gives a verdict, which HR/Admin finalizes. Numeric per-goal scores stay internal (manager + HR/Admin only); employees see written comments and, after finalization, their verdict.

---

## Architecture

This builds on the existing OKR tables (`okr_cycles`, `objectives`) rather than replacing them. A new **annual** cycle type is added to `okr_cycles`; annual-cycle objectives carry a `points` weight. Three new tables model the review lifecycle: `goal_submissions` (the per-employee goal-set approval gate), `performance_reviews` (one row per employee per review event), and `performance_review_ratings` (per-goal score + comment inside a review).

Because Postgres RLS is row-level, not column-level, and employees must see comments but not scores, employees never read the review tables directly. Their view is served through a `SECURITY DEFINER` function that projects only the safe columns and enforces the "verdict only after finalized, never scores, never HR notes" rules. Managers and HR/Admin read the base tables directly under RLS.

A single `api.performance.js` module owns all reads/writes. UI spans three surfaces: the employee's Performance page (extended), the manager's dashboard, and a new Performance tab on EmployeeManagementPage.

---

## Data Model

### 1. `okr_cycles` — add annual cycle support

```sql
ALTER TABLE okr_cycles
  ADD COLUMN IF NOT EXISTS cycle_type TEXT NOT NULL DEFAULT 'quarterly'
    CHECK (cycle_type IN ('quarterly', 'annual'));

-- Annual cycles have no quarter
ALTER TABLE okr_cycles ALTER COLUMN quarter DROP NOT NULL;
```

- An **annual** cycle has `cycle_type = 'annual'`, `quarter = NULL`, `year` set (e.g. 2026), `name` like "FY2026".
- Existing quarterly cycles are untouched (`cycle_type` defaults to `'quarterly'`).
- Review/goal windows are **not stored** — they are computed from the cycle `year` (fixed dates below).

### 2. `objectives` — add points weight

```sql
ALTER TABLE objectives
  ADD COLUMN IF NOT EXISTS points INTEGER
    CHECK (points IS NULL OR (points BETWEEN 1 AND 100));
```

- `points` is `NULL` for quarterly OKR objectives (unchanged behavior).
- For annual-cycle objectives it is required (1–100); the full set for one employee in one annual cycle must sum to exactly 100 (enforced at submission — see trigger below).

### 3. `goal_submissions` — goal-set approval gate

```sql
CREATE TABLE IF NOT EXISTS goal_submissions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id         UUID NOT NULL REFERENCES okr_cycles(id) ON DELETE CASCADE,
  employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'submitted', 'approved', 'returned')),
  manager_comment  TEXT,
  manager_id       UUID REFERENCES employees(id),
  submitted_at     TIMESTAMPTZ,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, employee_id)
);
```

- One row per employee per annual cycle.
- `draft` → `submitted` (employee) → `approved` or `returned` (manager). `returned` → `submitted` again after edits.

### 4. `performance_reviews` — one row per review event

```sql
CREATE TABLE IF NOT EXISTS performance_reviews (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id           UUID NOT NULL REFERENCES okr_cycles(id) ON DELETE CASCADE,
  employee_id        UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  review_type        TEXT NOT NULL CHECK (review_type IN ('h1', 'year_end')),
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'manager_done', 'hr_finalized')),
  overall_comment    TEXT,                       -- visible to employee
  verdict            TEXT CHECK (verdict IN ('exceeds', 'meets', 'partially_meets', 'doesnt_meet')),
  hr_notes           TEXT,                        -- HR/Admin only
  manager_id         UUID REFERENCES employees(id),
  manager_reviewed_at TIMESTAMPTZ,
  hr_finalized_by    UUID REFERENCES employees(id),
  hr_finalized_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, employee_id, review_type)
);
```

- `verdict` is only set at `year_end` (H1 is a progress checkpoint, no verdict).
- H1 review flow ends at `manager_done` (no HR finalization step). Year-end flow goes `pending` → `manager_done` → `hr_finalized`.

### 5. `performance_review_ratings` — per-goal score + comment

```sql
CREATE TABLE IF NOT EXISTS performance_review_ratings (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  review_id    UUID NOT NULL REFERENCES performance_reviews(id) ON DELETE CASCADE,
  objective_id UUID NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  score        NUMERIC(5,2) CHECK (score IS NULL OR (score BETWEEN 0 AND 100)),  -- hidden from employee
  comment      TEXT,                                                             -- visible to employee
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (review_id, objective_id)
);
```

### 6. Submission validation trigger

Enforces goal count (5–8) and points sum (=100) at the moment a `goal_submissions` row transitions to `submitted`. Prevents a client bypassing the API.

```sql
CREATE OR REPLACE FUNCTION validate_goal_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  goal_count INT;
  points_sum INT;
BEGIN
  IF NEW.status = 'submitted' AND (OLD.status IS DISTINCT FROM 'submitted') THEN
    SELECT COUNT(*), COALESCE(SUM(points), 0)
      INTO goal_count, points_sum
      FROM objectives
      WHERE cycle_id = NEW.cycle_id AND employee_id = NEW.employee_id;

    IF goal_count < 5 OR goal_count > 8 THEN
      RAISE EXCEPTION 'Goal count must be between 5 and 8 (found %).', goal_count;
    END IF;
    IF points_sum <> 100 THEN
      RAISE EXCEPTION 'Goal points must sum to exactly 100 (found %).', points_sum;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_goal_submission
  BEFORE UPDATE ON goal_submissions
  FOR EACH ROW EXECUTE FUNCTION validate_goal_submission();
```

### 7. RLS

```sql
ALTER TABLE goal_submissions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_reviews        ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_review_ratings ENABLE ROW LEVEL SECURITY;
```

**`goal_submissions`:**
- Employee: read + write own rows (`employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())`). Write is how they create drafts and submit.
- Manager: read + update rows of direct reports (for approve/return).
- HR/Admin: full access (`current_employee_role() IN ('hr','admin')`).

**`performance_reviews` and `performance_review_ratings`:**
- **Employees have NO direct SELECT** (scores live here). They read via the `get_my_performance_reviews` function below.
- Manager: read + write rows for direct reports (H1 + year-end manager step).
- HR/Admin: full access (finalization + full visibility).
- Manager write policy uses `USING`/`WITH CHECK` allowing the `pending → manager_done` transition; HR finalization is covered by the HR/Admin full-access policy.

**Employee read path — `SECURITY DEFINER` function:**

```sql
CREATE OR REPLACE FUNCTION get_my_performance_reviews(p_cycle_id UUID)
RETURNS TABLE (
  review_id       UUID,
  review_type     TEXT,
  status          TEXT,
  overall_comment TEXT,
  verdict         TEXT,          -- NULL unless year_end AND hr_finalized
  objective_id    UUID,
  goal_title      TEXT,
  goal_points     INT,
  goal_comment    TEXT           -- score deliberately excluded
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_emp UUID := (SELECT id FROM employees WHERE user_id = auth.uid());
BEGIN
  RETURN QUERY
  SELECT
    pr.id, pr.review_type, pr.status, pr.overall_comment,
    CASE WHEN pr.review_type = 'year_end' AND pr.status = 'hr_finalized'
         THEN pr.verdict ELSE NULL END,
    o.id, o.title, o.points, rr.comment
  FROM performance_reviews pr
  JOIN objectives o ON o.cycle_id = pr.cycle_id AND o.employee_id = pr.employee_id
  LEFT JOIN performance_review_ratings rr ON rr.review_id = pr.id AND rr.objective_id = o.id
  WHERE pr.cycle_id = p_cycle_id
    AND pr.employee_id = v_emp
    AND pr.status IN ('manager_done', 'hr_finalized');  -- nothing shown while still pending
END;
$$;
```

This guarantees the employee never receives `score` or `hr_notes`, and only sees `verdict` after year-end finalization.

---

## Fixed Windows

Computed from the annual cycle's `year`. No stored window columns.

| Window | Opens | Closes | Who acts |
|---|---|---|---|
| Goal setting | Jan 25 | Feb 15 | Employee sets + submits; manager approves |
| New-hire goal setting | join_date | join_date + 15 days | New hires (independent of the Jan–Feb window) |
| H1 review | Jul 1 | Jul 15 | Manager scores + comments |
| Year-end review | Dec 15 | Dec 31 | Manager verdict → HR finalizes |

The API exposes helpers that answer "is the goal window open for this employee today?" (true if today ∈ [Jan 25, Feb 15] OR today ≤ join_date + 15). Windows are advisory in the UI and enforced in the API submit/review functions; HR/Admin can always act out of window.

---

## Workflow

```
Annual cycle created by HR (cycle_type='annual', year=2026, name='FY2026')

GOAL SETTING (Jan 25–Feb 15, or new-hire +15d)
  Employee adds 5–8 objectives with points (must sum to 100)
    → goal_submissions row: draft
  Employee submits
    → trigger validates count + sum
    → status: submitted; manager notified

MANAGER APPROVAL
  Approve  → status: approved (goals locked)
  Return   → status: returned + manager_comment; employee edits + resubmits

H1 REVIEW (Jul 1–15)
  performance_reviews row (review_type='h1')
  Manager: per-goal score (hidden) + per-goal comment (visible) + overall_comment (visible)
    → status: manager_done; employee notified
  Employee sees comments only (via get_my_performance_reviews). No verdict at H1.

YEAR-END REVIEW (Dec 15–31)
  performance_reviews row (review_type='year_end')
  Manager: per-goal score + comments + overall_comment + verdict
    → status: manager_done; HR/Admin notified
  HR/Admin finalizes: reviews scores + verdict, adds hr_notes, confirms
    → status: hr_finalized; employee notified
  Employee now sees overall_comment, per-goal comments, and verdict.
```

**Lifecycle notifications** (via existing engine, best-effort): goal window opening, new-hire 15-day deadline approaching, goal submission awaiting manager, manager returned goals, H1/year-end windows opening, review submitted awaiting HR finalization, and outcome to the employee.

---

## API — `src/lib/api.performance.js`

```
getAnnualCycle()                                  → active annual cycle (or most recent)
getMyGoalSet(cycleId, employeeId)                 → submission row + objectives(points)
getGoalWindowState(employee, cycleId)             → { open, reason, closesOn }
saveGoalDraft(cycleId, employeeId, goals[])       → upsert objectives + ensure draft submission
submitGoalSet(cycleId, employeeId)                → submission → 'submitted' (trigger validates)

getManagerGoalApprovals(managerId, cycleId)       → submitted sets of direct reports
approveGoalSet(submissionId, managerId)           → 'approved'
returnGoalSet(submissionId, comment, managerId)   → 'returned' + comment

getManagerReviews(managerId, cycleId, reviewType) → reports + their approved goals + any review
saveReview(reviewId|new, { ratings[], overallComment, verdict? }, managerId)  → 'manager_done'

getMyReviews(cycleId)                             → RPC get_my_performance_reviews (safe view)

getPerformanceOverview(cycleId)                   → HR: all employees' submission + review status
finalizeReview(reviewId, { hrNotes }, hrAdminId)  → 'hr_finalized' (year_end only)
```

Guard rails: `submitGoalSet` checks window open (unless HR); `saveReview` requires the goal set be `approved`; year-end `saveReview` requires a verdict; `finalizeReview` requires `review_type='year_end'` and `status='manager_done'`. All notifications best-effort (`try/catch console.warn`), DB write first.

---

## UI

### Employee — Performance page (extend existing)

An **Annual Goals** section above the existing quarterly OKR content (the OKR content stays as-is).

- **Goal-setting state** (window open, no approved set): editable goal rows (title, description, points). A live **points meter** — "72 / 100" fills like a gauge, turns green at exactly 100, shows "3 over" / "28 to go". Add row (up to 8), remove row (down to 5). Submit disabled until count ∈ [5,8] and sum = 100.
- **Status banner:** Draft · Submitted (awaiting manager) · Returned (shows manager's comment) · Approved ✓.
- **Approved state:** read-only goal cards with point-weight chips.
- **Reviews section:** after H1 / year-end, manager's overall comment + per-goal comments (no numbers). Year-end verdict badge appears only after HR finalizes.
- **4-step year tracker:** Goals Set → H1 Review → Year-End → Finalized.

### Manager — dashboard panel (same pattern as probation panel)

- **Goal Approvals** panel: direct reports with `submitted` sets → expand to see goals + points → Approve / Return (with comment).
- **Review** panel (during H1 / year-end windows): per report with an approved goal set → score each goal (0–100) + per-goal comment + overall comment + (year-end) verdict selector → Submit.

### HR/Admin — Performance tab on EmployeeManagementPage

Alongside Employees / Transfers / Probation.

- **Overview table:** every active employee × annual cycle — goal submission status, H1 status, year-end status, verdict. Full visibility of per-goal scores, manager comments, verdicts.
- **Finalize** action on year-end reviews at `manager_done`: shows manager's scores + verdict, HR notes field, Confirm → `hr_finalized`.

**Memorable touches:** points meter as a fuel gauge; verdict as a colored badge (Exceeds = teal, Meets = green, Partially = amber, Doesn't Meet = red); the 4-step year tracker on the employee page.

---

## Files Touched

| File | Change |
|---|---|
| `supabase_migration_performance_goals.sql` | New — okr_cycles/objectives columns, 3 tables, trigger, RLS, `get_my_performance_reviews` fn |
| `src/lib/api.performance.js` | New — all goal/review reads & writes |
| `src/lib/constants.js` | Add verdict labels/colors, review window constants |
| `src/pages/employee/PerformancePage.jsx` | Add Annual Goals section (goal setting, status, reviews, tracker) |
| `src/pages/employee/EmployeeLandingPage.jsx` | Add manager Goal Approvals + Review panel |
| `src/pages/hr/EmployeeManagementPage.jsx` | Add Performance tab (overview + finalize) |
| Lifecycle engine SQL | Add performance events (window open, new-hire deadline, pending approvals/reviews, finalization) |

---

## Out of Scope

- Self-assessment / employee self-rating before manager review
- Peer / 360 feedback
- Weighted score → auto-computed verdict (verdict is the manager's judgment)
- Goal editing after approval (locked; would require a returned-style reopen — future)
- Configurable window dates per cycle (dates are fixed, computed from year)
