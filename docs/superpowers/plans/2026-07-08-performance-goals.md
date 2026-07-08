# Annual Performance Goals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an annual performance-goal system on top of the existing OKR feature — employees set 5–8 weighted goals (points sum to 100), managers approve then run H1 + year-end reviews, HR/Admin finalize year-end, with numeric scores kept internal.

**Architecture:** Extends `okr_cycles` (new `cycle_type='annual'`) and `objectives` (new `points`). Three new tables model the review lifecycle. Employees never read the review tables directly — a `SECURITY DEFINER` function projects only safe columns (comments, post-finalization verdict). A new `api.performance.js` owns all reads/writes. UI spans the employee Performance page, the manager dashboard, and a new HR Performance tab.

**Tech Stack:** React 18, Supabase (PostgREST + RLS + PL/pgSQL), inline styles with `C`/`FONTS` tokens from `src/lib/constants.js`.

## Global Constraints

- All inline styles — no CSS files, no Tailwind, no new npm packages
- Color/font tokens from `C` and `FONTS` in `src/lib/constants.js`
- RLS role helper: `current_employee_role() IN ('hr','admin')` — this function already exists in the DB
- RLS employee self-ref: `employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())`
- RLS manager self-ref: reports are `employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid())`
- Notification signature: `createNotification({ employeeId, type, title, message, metadata })` from `./api.notifications`
- Notifications best-effort: DB write first, then `try { ... } catch (e) { console.warn(...) }`
- `objectives.points`: 1–100, NULL for quarterly OKR objectives, required for annual
- Goal set rule: 5–8 goals, points sum exactly 100 (enforced by DB trigger AND API)
- `goal_submissions.status`: `'draft' | 'submitted' | 'approved' | 'returned'`
- `performance_reviews.status`: `'pending' | 'manager_done' | 'hr_finalized'`
- `performance_reviews.review_type`: `'h1' | 'year_end'`
- `verdict`: `'exceeds' | 'meets' | 'partially_meets' | 'doesnt_meet'` (year_end only)
- Fixed windows (computed from cycle year): Goal Jan 25–Feb 15; new-hire join_date→+15d; H1 Jul 1–15; Year-end Dec 15–31
- H1 review: NO verdict, NO HR finalization (manager-only checkpoint). Year-end: verdict + HR finalization.
- No unit-test framework exists — verify via SQL queries and browser (preview tools), matching the probation plan.

## File Structure

| File | Responsibility |
|---|---|
| `supabase_migration_performance_goals.sql` | Schema: okr_cycles/objectives columns, 3 tables, trigger, RLS, `get_my_performance_reviews` fn, seed annual cycle |
| `supabase_migration_performance_lifecycle.sql` | Extends `run_lifecycle_reminders()` with performance events |
| `src/lib/constants.js` | `VERDICTS` (labels+colors), `PERF_WINDOWS` helpers |
| `src/lib/api.performance.js` | All goal/review reads & writes |
| `src/pages/employee/PerformancePage.jsx` | Annual Goals section (goal setting, status, reviews, year tracker) |
| `src/pages/employee/EmployeeLandingPage.jsx` | Manager Goal Approvals + Review panels |
| `src/pages/hr/EmployeeManagementPage.jsx` | Performance tab (overview + finalize) |

---

### Task 1: SQL Migration — Schema, Trigger, RLS, Read Function

**Files:**
- Create: `supabase_migration_performance_goals.sql`

**Interfaces:**
- Produces: `okr_cycles.cycle_type`, `objectives.points`, tables `goal_submissions` / `performance_reviews` / `performance_review_ratings`, trigger `trg_validate_goal_submission`, function `get_my_performance_reviews(p_cycle_id UUID)`, seeded `FY2026` annual cycle

- [ ] **Step 1: Create the migration file**

Create `supabase_migration_performance_goals.sql` at the repo root:

```sql
-- ============================================================
-- STRIDE — ANNUAL PERFORMANCE GOALS
-- Run in: Supabase Dashboard → SQL Editor (Production and Test)
-- ============================================================

-- ── 1. Extend okr_cycles with annual cycle type ──────────────────────────────
ALTER TABLE okr_cycles
  ADD COLUMN IF NOT EXISTS cycle_type TEXT NOT NULL DEFAULT 'quarterly'
    CHECK (cycle_type IN ('quarterly', 'annual'));

ALTER TABLE okr_cycles ALTER COLUMN quarter DROP NOT NULL;

-- ── 2. Add points weight to objectives ───────────────────────────────────────
ALTER TABLE objectives
  ADD COLUMN IF NOT EXISTS points INTEGER
    CHECK (points IS NULL OR (points BETWEEN 1 AND 100));

-- ── 3. goal_submissions ──────────────────────────────────────────────────────
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
CREATE INDEX IF NOT EXISTS idx_goal_submissions_employee ON goal_submissions(employee_id, cycle_id);
CREATE INDEX IF NOT EXISTS idx_goal_submissions_status   ON goal_submissions(status);

-- ── 4. performance_reviews ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS performance_reviews (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id            UUID NOT NULL REFERENCES okr_cycles(id) ON DELETE CASCADE,
  employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  review_type         TEXT NOT NULL CHECK (review_type IN ('h1', 'year_end')),
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'manager_done', 'hr_finalized')),
  overall_comment     TEXT,
  verdict             TEXT CHECK (verdict IN ('exceeds', 'meets', 'partially_meets', 'doesnt_meet')),
  hr_notes            TEXT,
  manager_id          UUID REFERENCES employees(id),
  manager_reviewed_at TIMESTAMPTZ,
  hr_finalized_by     UUID REFERENCES employees(id),
  hr_finalized_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, employee_id, review_type)
);
CREATE INDEX IF NOT EXISTS idx_perf_reviews_employee ON performance_reviews(employee_id, cycle_id);
CREATE INDEX IF NOT EXISTS idx_perf_reviews_status   ON performance_reviews(status);

-- ── 5. performance_review_ratings ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS performance_review_ratings (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  review_id    UUID NOT NULL REFERENCES performance_reviews(id) ON DELETE CASCADE,
  objective_id UUID NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  score        NUMERIC(5,2) CHECK (score IS NULL OR (score BETWEEN 0 AND 100)),
  comment      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (review_id, objective_id)
);
CREATE INDEX IF NOT EXISTS idx_perf_ratings_review ON performance_review_ratings(review_id);

-- ── 6. Submission validation trigger (count 5–8, points = 100) ────────────────
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

DROP TRIGGER IF EXISTS trg_validate_goal_submission ON goal_submissions;
CREATE TRIGGER trg_validate_goal_submission
  BEFORE UPDATE ON goal_submissions
  FOR EACH ROW EXECUTE FUNCTION validate_goal_submission();

-- ── 7. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE goal_submissions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_reviews        ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_review_ratings ENABLE ROW LEVEL SECURITY;

-- goal_submissions: employee own; manager reports; HR/admin all
DROP POLICY IF EXISTS "goal_sub_read" ON goal_submissions;
CREATE POLICY "goal_sub_read" ON goal_submissions FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
    OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "goal_sub_write" ON goal_submissions;
CREATE POLICY "goal_sub_write" ON goal_submissions FOR ALL TO authenticated
  USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
    OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
  )
  WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
    OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
  );

-- performance_reviews: NO employee direct read. Manager reports + HR/admin.
DROP POLICY IF EXISTS "perf_review_read" ON performance_reviews;
CREATE POLICY "perf_review_read" ON performance_reviews FOR SELECT TO authenticated
  USING (
    current_employee_role() IN ('hr','admin')
    OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "perf_review_write" ON performance_reviews;
CREATE POLICY "perf_review_write" ON performance_reviews FOR ALL TO authenticated
  USING (
    current_employee_role() IN ('hr','admin')
    OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
  )
  WITH CHECK (
    current_employee_role() IN ('hr','admin')
    OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
  );

-- performance_review_ratings: NO employee direct read. Manager reports + HR/admin.
DROP POLICY IF EXISTS "perf_rating_read" ON performance_review_ratings;
CREATE POLICY "perf_rating_read" ON performance_review_ratings FOR SELECT TO authenticated
  USING (
    review_id IN (
      SELECT id FROM performance_reviews WHERE
        current_employee_role() IN ('hr','admin')
        OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
    )
  );

DROP POLICY IF EXISTS "perf_rating_write" ON performance_review_ratings;
CREATE POLICY "perf_rating_write" ON performance_review_ratings FOR ALL TO authenticated
  USING (
    review_id IN (
      SELECT id FROM performance_reviews WHERE
        current_employee_role() IN ('hr','admin')
        OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
    )
  )
  WITH CHECK (
    review_id IN (
      SELECT id FROM performance_reviews WHERE
        current_employee_role() IN ('hr','admin')
        OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
    )
  );

-- ── 8. Employee-safe read function (hides score + hr_notes; verdict gated) ────
CREATE OR REPLACE FUNCTION get_my_performance_reviews(p_cycle_id UUID)
RETURNS TABLE (
  review_id       UUID,
  review_type     TEXT,
  status          TEXT,
  overall_comment TEXT,
  verdict         TEXT,
  objective_id    UUID,
  goal_title      TEXT,
  goal_points     INT,
  goal_comment    TEXT
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
    AND pr.status IN ('manager_done', 'hr_finalized')
  ORDER BY pr.review_type, o.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_performance_reviews(UUID) TO authenticated;

-- ── 9. Seed FY2026 annual cycle ──────────────────────────────────────────────
INSERT INTO okr_cycles (name, quarter, year, start_date, end_date, status, cycle_type)
VALUES ('FY2026', NULL, 2026, '2026-01-01', '2026-12-31', 'active', 'annual')
ON CONFLICT DO NOTHING;

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('goal_submissions','performance_reviews','performance_review_ratings')
ORDER BY table_name;
```

- [ ] **Step 2: Run in Supabase SQL Editor** (MANUAL — user runs this)

Paste entire file → Run in Production and Test. Expected: no errors; final result lists the 3 new tables.

- [ ] **Step 3: Verify** (MANUAL)

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'okr_cycles' AND column_name = 'cycle_type';           -- 1 row
SELECT column_name FROM information_schema.columns
WHERE table_name = 'objectives' AND column_name = 'points';               -- 1 row
SELECT proname FROM pg_proc WHERE proname = 'get_my_performance_reviews'; -- 1 row
SELECT name, cycle_type FROM okr_cycles WHERE cycle_type = 'annual';      -- FY2026
```

- [ ] **Step 4: Commit**

```bash
git add supabase_migration_performance_goals.sql
git commit -m "feat: performance goals schema — tables, trigger, RLS, safe read fn"
```

---

### Task 2: Lifecycle Engine — Performance Events

**Files:**
- Create: `supabase_migration_performance_lifecycle.sql`

**Interfaces:**
- Consumes: `run_lifecycle_reminders()` (existing), `lifecycle_reminder_log`, `notifications`, tables from Task 1
- Produces: new performance events appended inside `run_lifecycle_reminders()`

This task re-creates `run_lifecycle_reminders()` with performance events added. Because the full function is long, the implementer MUST first read the current definition from `supabase_migration_probation.sql` (the most recent full definition, events 1–15) and append the new event block **before the final `END; $$;`**, keeping all existing events verbatim.

- [ ] **Step 1: Read the current function**

Read `supabase_migration_probation.sql` — copy the entire `CREATE OR REPLACE FUNCTION run_lifecycle_reminders() ... END; $$;` block (events 1–15). This is the base.

- [ ] **Step 2: Create the migration file**

Create `supabase_migration_performance_lifecycle.sql`. It contains the FULL `CREATE OR REPLACE FUNCTION run_lifecycle_reminders()` from Step 1, with this event block inserted immediately before the final `END;` (renumber as EVENT 16). Do not alter any existing event.

```sql
  -- ═══════════════════════════════════════════════════════════════
  -- EVENT 16: PERFORMANCE — goal window, new-hire deadline, pending reviews
  -- ═══════════════════════════════════════════════════════════════
  DECLARE
    v_cycle       RECORD;
    v_goal_open   DATE;
    v_goal_close  DATE;
  BEGIN
    SELECT id, year INTO v_cycle
    FROM okr_cycles
    WHERE cycle_type = 'annual' AND status = 'active'
    ORDER BY year DESC LIMIT 1;

    IF v_cycle.id IS NOT NULL THEN
      v_goal_open  := (v_cycle.year::text || '-01-25')::date;
      v_goal_close := (v_cycle.year::text || '-02-15')::date;

      -- 16a: Goal window opens (on Jan 25) — all active employees
      IF today = v_goal_open THEN
        FOR recipient IN SELECT id FROM employees WHERE status = 'active' LOOP
          dedup_key := 'lifecycle:goal_window_open:' || v_cycle.id::text || ':' || recipient.id::text;
          IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
            INSERT INTO notifications (employee_id, type, title, message, metadata)
            VALUES (recipient.id, 'lifecycle_reminder',
              '🎯 Goal Setting is Open',
              'Set your ' || v_cycle.year || ' performance goals (5–8 goals, 100 points total) by ' || to_char(v_goal_close, 'DD Mon') || '.',
              jsonb_build_object('event_type', 'goal_window_open', 'cycle_id', v_cycle.id));
            INSERT INTO lifecycle_reminder_log (key, event_type, employee_id) VALUES (dedup_key, 'goal_window_open', recipient.id);
          END IF;
        END LOOP;
      END IF;

      -- 16b: Goal window closing (3 days before Feb 15) — those without an approved/submitted set
      IF today = v_goal_close - 3 THEN
        FOR r IN
          SELECT e.id, e.full_name FROM employees e
          WHERE e.status = 'active'
            AND NOT EXISTS (
              SELECT 1 FROM goal_submissions gs
              WHERE gs.cycle_id = v_cycle.id AND gs.employee_id = e.id
                AND gs.status IN ('submitted','approved'))
        LOOP
          dedup_key := 'lifecycle:goal_window_closing:' || v_cycle.id::text || ':' || r.id::text;
          IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
            INSERT INTO notifications (employee_id, type, title, message, metadata)
            VALUES (r.id, 'lifecycle_reminder',
              '⏰ Goal Setting Closes in 3 Days',
              'Submit your ' || v_cycle.year || ' performance goals before ' || to_char(v_goal_close, 'DD Mon') || '.',
              jsonb_build_object('event_type', 'goal_window_closing', 'cycle_id', v_cycle.id));
            INSERT INTO lifecycle_reminder_log (key, event_type, employee_id) VALUES (dedup_key, 'goal_window_closing', r.id);
          END IF;
        END LOOP;
      END IF;

      -- 16c: New-hire goal deadline (3 days before join_date + 15) — no submitted/approved set
      FOR r IN
        SELECT e.id, e.full_name, e.manager_id, (e.join_date + 15) AS deadline
        FROM employees e
        WHERE e.status = 'active' AND e.join_date IS NOT NULL
          AND (e.join_date + 15) = today + 3
          AND NOT EXISTS (
            SELECT 1 FROM goal_submissions gs
            WHERE gs.cycle_id = v_cycle.id AND gs.employee_id = e.id
              AND gs.status IN ('submitted','approved'))
      LOOP
        dedup_key := 'lifecycle:goal_newhire_deadline:' || v_cycle.id::text || ':' || r.id::text;
        IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
          INSERT INTO notifications (employee_id, type, title, message, metadata)
          VALUES (r.id, 'lifecycle_reminder',
            '🎯 Set Your Goals — 3 Days Left',
            'As a new joiner, please set your performance goals by ' || to_char(r.deadline, 'DD Mon YYYY') || '.',
            jsonb_build_object('event_type', 'goal_newhire_deadline', 'cycle_id', v_cycle.id));
          INSERT INTO lifecycle_reminder_log (key, event_type, employee_id) VALUES (dedup_key, 'goal_newhire_deadline', r.id);
        END IF;
      END LOOP;

      -- 16d: H1 review window opens (Jul 1) — managers with approved reports
      IF today = (v_cycle.year::text || '-07-01')::date THEN
        FOR recipient IN
          SELECT DISTINCT e.manager_id AS id FROM employees e
          JOIN goal_submissions gs ON gs.employee_id = e.id AND gs.cycle_id = v_cycle.id AND gs.status = 'approved'
          WHERE e.manager_id IS NOT NULL
        LOOP
          dedup_key := 'lifecycle:h1_window_open:' || v_cycle.id::text || ':' || recipient.id::text;
          IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
            INSERT INTO notifications (employee_id, type, title, message, metadata)
            VALUES (recipient.id, 'lifecycle_reminder',
              '📊 H1 Reviews Are Open',
              'Half-yearly performance reviews for your team are open until 15 Jul.',
              jsonb_build_object('event_type', 'h1_window_open', 'cycle_id', v_cycle.id));
            INSERT INTO lifecycle_reminder_log (key, event_type, employee_id) VALUES (dedup_key, 'h1_window_open', recipient.id);
          END IF;
        END LOOP;
      END IF;

      -- 16e: Year-end review window opens (Dec 15) — managers with approved reports
      IF today = (v_cycle.year::text || '-12-15')::date THEN
        FOR recipient IN
          SELECT DISTINCT e.manager_id AS id FROM employees e
          JOIN goal_submissions gs ON gs.employee_id = e.id AND gs.cycle_id = v_cycle.id AND gs.status = 'approved'
          WHERE e.manager_id IS NOT NULL
        LOOP
          dedup_key := 'lifecycle:yearend_window_open:' || v_cycle.id::text || ':' || recipient.id::text;
          IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
            INSERT INTO notifications (employee_id, type, title, message, metadata)
            VALUES (recipient.id, 'lifecycle_reminder',
              '🏁 Year-End Reviews Are Open',
              'Year-end performance reviews (with verdict) for your team are open until 31 Dec.',
              jsonb_build_object('event_type', 'yearend_window_open', 'cycle_id', v_cycle.id));
            INSERT INTO lifecycle_reminder_log (key, event_type, employee_id) VALUES (dedup_key, 'yearend_window_open', recipient.id);
          END IF;
        END LOOP;
      END IF;

    END IF;
  END;

```

- [ ] **Step 3: Run in Supabase SQL Editor** (MANUAL)

Paste → Run in Production and Test. Expected: `CREATE FUNCTION` success, no errors.

- [ ] **Step 4: Verify** (MANUAL)

```sql
SELECT run_lifecycle_reminders();  -- returns void, no error
```

- [ ] **Step 5: Commit**

```bash
git add supabase_migration_performance_lifecycle.sql
git commit -m "feat: lifecycle events for performance goal/review windows"
```

---

### Task 3: Constants + API Module

**Files:**
- Modify: `src/lib/constants.js`
- Create: `src/lib/api.performance.js`

**Interfaces:**
- Consumes: `supabase` from `./supabase`, `createNotification` from `./api.notifications`, Task 1 schema
- Produces (constants): `VERDICTS`, `getGoalWindowState(employee)`, `getReviewWindow(year)`
- Produces (api.performance.js):
  - `getAnnualCycle(): Promise<Cycle|null>`
  - `getMyGoalSet(cycleId, employeeId): Promise<{ submission, goals }>`
  - `saveGoalDraft(cycleId, employeeId, goals): Promise<void>` — `goals: [{ id?, title, description, points }]`
  - `submitGoalSet(cycleId, employeeId): Promise<void>`
  - `getManagerGoalApprovals(managerId, cycleId): Promise<Submission[]>`
  - `approveGoalSet(submissionId, managerId): Promise<void>`
  - `returnGoalSet(submissionId, comment, managerId): Promise<void>`
  - `getManagerReviewTargets(managerId, cycleId): Promise<Target[]>`
  - `saveReview({ reviewId, cycleId, employeeId, reviewType, ratings, overallComment, verdict }, managerId): Promise<void>`
  - `getMyReviews(cycleId): Promise<Row[]>`
  - `getPerformanceOverview(cycleId): Promise<Overview[]>`
  - `finalizeReview(reviewId, hrNotes, hrAdminId): Promise<void>`

- [ ] **Step 1: Add constants to `src/lib/constants.js`**

Append at the end of the file:

```js
// ── Performance / Annual Goals ────────────────────────────────────────────────
export const VERDICTS = [
  { value: 'exceeds',          label: 'Exceeds Expectations',   color: '#0d9488', bg: '#ccfbf1' },
  { value: 'meets',            label: 'Meets Expectations',     color: '#00b894', bg: '#e8faf0' },
  { value: 'partially_meets',  label: 'Partially Meets',        color: '#f59e0b', bg: '#fef3c7' },
  { value: 'doesnt_meet',      label: 'Does Not Meet',          color: '#ef4444', bg: '#fef2f2' },
]

export function getVerdict(value) {
  return VERDICTS.find(v => v.value === value) || null
}

// Returns { open: bool, reason: string, closesOn: Date|null }
export function getGoalWindowState(employee, now = new Date()) {
  const year = now.getFullYear()
  const open  = new Date(year, 0, 25)   // Jan 25
  const close = new Date(year, 1, 15, 23, 59, 59) // Feb 15
  if (now >= open && now <= close) {
    return { open: true, reason: 'annual', closesOn: close }
  }
  if (employee?.join_date) {
    const deadline = new Date(employee.join_date)
    deadline.setDate(deadline.getDate() + 15)
    deadline.setHours(23, 59, 59)
    if (now <= deadline) {
      return { open: true, reason: 'newhire', closesOn: deadline }
    }
  }
  return { open: false, reason: 'closed', closesOn: null }
}

// Returns 'h1' | 'year_end' | null for the review window active today
export function getReviewWindow(now = new Date()) {
  const year = now.getFullYear()
  const h1Open  = new Date(year, 6, 1)   // Jul 1
  const h1Close = new Date(year, 6, 15, 23, 59, 59) // Jul 15
  const yeOpen  = new Date(year, 11, 15) // Dec 15
  const yeClose = new Date(year, 11, 31, 23, 59, 59) // Dec 31
  if (now >= h1Open && now <= h1Close) return 'h1'
  if (now >= yeOpen && now <= yeClose) return 'year_end'
  return null
}
```

- [ ] **Step 2: Create `src/lib/api.performance.js`**

```js
import { supabase } from './supabase'
import { createNotification } from './api.notifications'

// ── Cycle ─────────────────────────────────────────────────────────────────────
export async function getAnnualCycle() {
  const { data, error } = await supabase
    .from('okr_cycles')
    .select('*')
    .eq('cycle_type', 'annual')
    .order('year', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

// ── Employee: my goal set ─────────────────────────────────────────────────────
export async function getMyGoalSet(cycleId, employeeId) {
  const { data: submission } = await supabase
    .from('goal_submissions')
    .select('*')
    .eq('cycle_id', cycleId)
    .eq('employee_id', employeeId)
    .maybeSingle()

  const { data: goals, error } = await supabase
    .from('objectives')
    .select('id, title, description, points')
    .eq('cycle_id', cycleId)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: true })
  if (error) throw error

  return { submission: submission || null, goals: goals || [] }
}

// goals: [{ id?, title, description, points }]
export async function saveGoalDraft(cycleId, employeeId, goals) {
  // Ensure a draft submission row exists (unless already submitted/approved handling is caller's job)
  const { data: existing } = await supabase
    .from('goal_submissions')
    .select('id, status')
    .eq('cycle_id', cycleId)
    .eq('employee_id', employeeId)
    .maybeSingle()

  if (!existing) {
    const { error } = await supabase
      .from('goal_submissions')
      .insert({ cycle_id: cycleId, employee_id: employeeId, status: 'draft' })
    if (error) throw error
  } else if (existing.status === 'returned') {
    // reopening after a return keeps it editable; leave status as returned until resubmit
  }

  // Reconcile objectives: delete removed, upsert provided
  const { data: current } = await supabase
    .from('objectives')
    .select('id')
    .eq('cycle_id', cycleId)
    .eq('employee_id', employeeId)
  const keepIds = goals.filter(g => g.id).map(g => g.id)
  const toDelete = (current || []).filter(o => !keepIds.includes(o.id)).map(o => o.id)
  if (toDelete.length) {
    const { error } = await supabase.from('objectives').delete().in('id', toDelete)
    if (error) throw error
  }

  for (const g of goals) {
    if (g.id) {
      const { error } = await supabase.from('objectives')
        .update({ title: g.title, description: g.description || null, points: g.points, updated_at: new Date().toISOString() })
        .eq('id', g.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('objectives')
        .insert({ cycle_id: cycleId, employee_id: employeeId, title: g.title, description: g.description || null, points: g.points, created_by: employeeId })
      if (error) throw error
    }
  }

  await supabase.from('goal_submissions')
    .update({ updated_at: new Date().toISOString() })
    .eq('cycle_id', cycleId).eq('employee_id', employeeId)
}

export async function submitGoalSet(cycleId, employeeId) {
  // Client-side pre-check mirrors the DB trigger for a friendly error
  const { data: goals } = await supabase
    .from('objectives').select('points')
    .eq('cycle_id', cycleId).eq('employee_id', employeeId)
  const count = goals?.length || 0
  const sum = (goals || []).reduce((s, g) => s + (g.points || 0), 0)
  if (count < 5 || count > 8) throw new Error(`You must have 5–8 goals (currently ${count}).`)
  if (sum !== 100) throw new Error(`Points must total exactly 100 (currently ${sum}).`)

  const { data, error } = await supabase
    .from('goal_submissions')
    .update({ status: 'submitted', submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('cycle_id', cycleId).eq('employee_id', employeeId)
    .select('employee_id')
    .single()
  if (error) throw error

  // Notify manager (best-effort)
  try {
    const { data: emp } = await supabase.from('employees').select('full_name, manager_id').eq('id', employeeId).single()
    if (emp?.manager_id) {
      await createNotification({
        employeeId: emp.manager_id,
        type: 'goal_submitted',
        title: '🎯 Goals Awaiting Your Approval',
        message: `${emp.full_name} submitted their performance goals for review.`,
        metadata: { cycle_id: cycleId, employee_id: employeeId },
      })
    }
  } catch (e) { console.warn('Goal submit notification failed:', e.message) }

  return data
}

// ── Manager: goal approvals ───────────────────────────────────────────────────
export async function getManagerGoalApprovals(managerId, cycleId) {
  const { data: reports } = await supabase.from('employees').select('id').eq('manager_id', managerId)
  const ids = (reports || []).map(r => r.id)
  if (!ids.length) return []

  const { data, error } = await supabase
    .from('goal_submissions')
    .select('*, employee:employee_id(id, full_name, avatar_initials, department)')
    .eq('cycle_id', cycleId)
    .in('employee_id', ids)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: true })
  if (error) throw error

  // attach goals
  for (const sub of data) {
    const { data: goals } = await supabase
      .from('objectives').select('id, title, description, points')
      .eq('cycle_id', cycleId).eq('employee_id', sub.employee_id)
      .order('created_at', { ascending: true })
    sub.goals = goals || []
  }
  return data || []
}

export async function approveGoalSet(submissionId, managerId) {
  const { data, error } = await supabase
    .from('goal_submissions')
    .update({ status: 'approved', manager_id: managerId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', submissionId)
    .eq('status', 'submitted')
    .select('employee_id')
    .single()
  if (error) throw error
  try {
    await createNotification({
      employeeId: data.employee_id, type: 'goal_approved',
      title: '✅ Goals Approved',
      message: 'Your performance goals have been approved for the year.',
      metadata: { submission_id: submissionId },
    })
  } catch (e) { console.warn('Goal approve notification failed:', e.message) }
}

export async function returnGoalSet(submissionId, comment, managerId) {
  if (!comment?.trim()) throw new Error('Please add a comment explaining what to change.')
  const { data, error } = await supabase
    .from('goal_submissions')
    .update({ status: 'returned', manager_comment: comment.trim(), manager_id: managerId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', submissionId)
    .eq('status', 'submitted')
    .select('employee_id')
    .single()
  if (error) throw error
  try {
    await createNotification({
      employeeId: data.employee_id, type: 'goal_returned',
      title: '↩️ Goals Returned for Revision',
      message: 'Your manager asked for changes to your goals. Please review and resubmit.',
      metadata: { submission_id: submissionId },
    })
  } catch (e) { console.warn('Goal return notification failed:', e.message) }
}

// ── Manager: reviews ──────────────────────────────────────────────────────────
export async function getManagerReviewTargets(managerId, cycleId) {
  const { data: reports } = await supabase
    .from('employees').select('id, full_name, avatar_initials, department').eq('manager_id', managerId)
  const ids = (reports || []).map(r => r.id)
  if (!ids.length) return []

  // Only reports with an approved goal set are reviewable
  const { data: approved } = await supabase
    .from('goal_submissions').select('employee_id')
    .eq('cycle_id', cycleId).in('employee_id', ids).eq('status', 'approved')
  const approvedIds = (approved || []).map(a => a.employee_id)
  if (!approvedIds.length) return []

  const targets = []
  for (const emp of (reports || []).filter(r => approvedIds.includes(r.id))) {
    const { data: goals } = await supabase
      .from('objectives').select('id, title, description, points')
      .eq('cycle_id', cycleId).eq('employee_id', emp.id)
      .order('created_at', { ascending: true })
    const { data: reviews } = await supabase
      .from('performance_reviews')
      .select('*, ratings:performance_review_ratings(objective_id, score, comment)')
      .eq('cycle_id', cycleId).eq('employee_id', emp.id)
    targets.push({ employee: emp, goals: goals || [], reviews: reviews || [] })
  }
  return targets
}

// ratings: [{ objectiveId, score, comment }]
export async function saveReview({ reviewId, cycleId, employeeId, reviewType, ratings, overallComment, verdict }, managerId) {
  if (reviewType === 'year_end' && !verdict) throw new Error('A verdict is required for the year-end review.')

  let id = reviewId
  if (!id) {
    const { data, error } = await supabase
      .from('performance_reviews')
      .insert({ cycle_id: cycleId, employee_id: employeeId, review_type: reviewType,
                status: 'manager_done', overall_comment: overallComment || null,
                verdict: reviewType === 'year_end' ? verdict : null,
                manager_id: managerId, manager_reviewed_at: new Date().toISOString() })
      .select('id')
      .single()
    if (error) throw error
    id = data.id
  } else {
    const { error } = await supabase
      .from('performance_reviews')
      .update({ status: 'manager_done', overall_comment: overallComment || null,
                verdict: reviewType === 'year_end' ? verdict : null,
                manager_id: managerId, manager_reviewed_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  }

  // Upsert ratings per objective
  for (const rt of ratings) {
    const { data: existing } = await supabase
      .from('performance_review_ratings').select('id')
      .eq('review_id', id).eq('objective_id', rt.objectiveId).maybeSingle()
    if (existing) {
      const { error } = await supabase.from('performance_review_ratings')
        .update({ score: rt.score ?? null, comment: rt.comment || null, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('performance_review_ratings')
        .insert({ review_id: id, objective_id: rt.objectiveId, score: rt.score ?? null, comment: rt.comment || null })
      if (error) throw error
    }
  }

  // Notify employee (comments available now) + HR if year_end (finalization needed)
  try {
    await createNotification({
      employeeId, type: 'review_submitted',
      title: reviewType === 'h1' ? '📊 Your H1 Review is Ready' : '🏁 Your Year-End Review is Ready',
      message: 'Your manager has completed your review. View their feedback in Performance.',
      metadata: { review_id: id, review_type: reviewType },
    })
    if (reviewType === 'year_end') {
      const { data: hrList } = await supabase.from('employees').select('id').eq('status', 'active').in('role_type', ['hr', 'admin'])
      if (hrList?.length) {
        await supabase.from('notifications').insert(hrList.map(hr => ({
          employee_id: hr.id, type: 'review_awaiting_finalization',
          title: '🏁 Year-End Review Awaiting Finalization',
          message: 'A manager submitted a year-end review with a verdict. Your finalization is required.',
          metadata: { review_id: id }, is_read: false,
        })))
      }
    }
  } catch (e) { console.warn('Review notification failed:', e.message) }

  return id
}

// ── Employee: my reviews (safe RPC) ───────────────────────────────────────────
export async function getMyReviews(cycleId) {
  const { data, error } = await supabase.rpc('get_my_performance_reviews', { p_cycle_id: cycleId })
  if (error) throw error
  return data || []
}

// ── HR: overview + finalize ───────────────────────────────────────────────────
export async function getPerformanceOverview(cycleId) {
  const { data: employees } = await supabase
    .from('employees').select('id, full_name, avatar_initials, department')
    .eq('status', 'active').order('full_name')

  const { data: subs } = await supabase
    .from('goal_submissions').select('employee_id, status').eq('cycle_id', cycleId)
  const { data: reviews } = await supabase
    .from('performance_reviews')
    .select('id, employee_id, review_type, status, verdict, overall_comment, hr_notes, ratings:performance_review_ratings(objective_id, score, comment)')
    .eq('cycle_id', cycleId)

  return (employees || []).map(e => ({
    employee: e,
    submission: (subs || []).find(s => s.employee_id === e.id) || null,
    h1:      (reviews || []).find(r => r.employee_id === e.id && r.review_type === 'h1') || null,
    yearEnd: (reviews || []).find(r => r.employee_id === e.id && r.review_type === 'year_end') || null,
  }))
}

export async function finalizeReview(reviewId, hrNotes, hrAdminId) {
  const { data: review, error: fErr } = await supabase
    .from('performance_reviews').select('review_type, status, employee_id').eq('id', reviewId).single()
  if (fErr) throw fErr
  if (review.review_type !== 'year_end') throw new Error('Only year-end reviews are finalized.')
  if (review.status !== 'manager_done') throw new Error('This review is not awaiting finalization.')

  const { error } = await supabase
    .from('performance_reviews')
    .update({ status: 'hr_finalized', hr_notes: hrNotes?.trim() || null, hr_finalized_by: hrAdminId, hr_finalized_at: new Date().toISOString() })
    .eq('id', reviewId)
  if (error) throw error

  try {
    await createNotification({
      employeeId: review.employee_id, type: 'review_finalized',
      title: '🏁 Year-End Review Finalized',
      message: 'Your year-end review is complete. View your outcome in Performance.',
      metadata: { review_id: reviewId },
    })
  } catch (e) { console.warn('Finalize notification failed:', e.message) }
}
```

- [ ] **Step 3: Verify (browser)**

Start dev server. Open the app, check the browser console for import/parse errors on any page that loads constants. Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/constants.js src/lib/api.performance.js
git commit -m "feat: api.performance.js + performance constants and window helpers"
```

---

### Task 4: Employee Performance Page — Annual Goals Section

**Files:**
- Modify: `src/pages/employee/PerformancePage.jsx`

**Interfaces:**
- Consumes: `getAnnualCycle`, `getMyGoalSet`, `saveGoalDraft`, `submitGoalSet`, `getMyReviews` from `../../lib/api.performance`; `VERDICTS`, `getVerdict`, `getGoalWindowState` from `../../lib/constants`
- Produces: `AnnualGoalsSection` component rendered at the top of `PerformancePage`

- [ ] **Step 1: Add imports**

In `src/pages/employee/PerformancePage.jsx`, after the existing `api.okrs` import block, add:

```js
import { getAnnualCycle, getMyGoalSet, saveGoalDraft, submitGoalSet, getMyReviews } from '../../lib/api.performance'
import { getGoalWindowState, getVerdict } from '../../lib/constants'
```

(`C`, `FONTS` are already imported. `useEffect`, `useState` already imported. `Button`, `Input`, `Alert`, `Avatar`, `EmptyState` already imported from `../../components/ui`.)

- [ ] **Step 2: Add the `AnnualGoalsSection` component**

Insert before `export default function PerformancePage()`:

```jsx
const PTS_TARGET = 100

function PointsMeter({ sum }) {
  const pct = Math.min(100, Math.round((sum / PTS_TARGET) * 100))
  const exact = sum === PTS_TARGET
  const over = sum > PTS_TARGET
  const color = exact ? C.green : over ? '#ef4444' : C.brand
  const label = exact ? 'Perfect — 100 / 100' : over ? `${sum} / 100 · ${sum - 100} over` : `${sum} / 100 · ${100 - sum} to go`
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.textMid }}>Points</span>
        <span style={{ fontSize: 12, fontWeight: 700, color }}>{label}</span>
      </div>
      <div style={{ height: 12, background: C.border, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 8, transition: 'width 0.4s ease, background 0.3s' }} />
      </div>
    </div>
  )
}

function YearTracker({ submission, reviews }) {
  const hasApproved = submission?.status === 'approved'
  const h1Done      = reviews.some(r => r.review_type === 'h1')
  const yeDone      = reviews.some(r => r.review_type === 'year_end' && r.status === 'manager_done')
  const finalized   = reviews.some(r => r.review_type === 'year_end' && r.status === 'hr_finalized')
  const steps = [
    { label: 'Goals Set', done: hasApproved },
    { label: 'H1 Review', done: h1Done },
    { label: 'Year-End',  done: yeDone || finalized },
    { label: 'Finalized', done: finalized },
  ]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 18 }}>
      {steps.map((s, i) => (
        <div key={s.label} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: s.done ? C.green : C.border,
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>
              {s.done ? '✓' : i + 1}
            </div>
            <span style={{ fontSize: 9, color: s.done ? C.green : C.textLight, fontWeight: 600, whiteSpace: 'nowrap' }}>{s.label}</span>
          </div>
          {i < steps.length - 1 && <div style={{ flex: 1, height: 2, background: s.done ? C.green : C.border, margin: '0 4px 14px' }} />}
        </div>
      ))}
    </div>
  )
}

function AnnualGoalsSection({ employee }) {
  const [cycle,      setCycle]      = useState(null)
  const [submission, setSubmission] = useState(null)
  const [goals,      setGoals]      = useState([])
  const [reviews,    setReviews]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')

  const windowState = getGoalWindowState(employee)
  const locked = submission?.status === 'approved' || submission?.status === 'submitted'
  const editable = !locked && (windowState.open || submission?.status === 'returned')

  async function load() {
    setLoading(true)
    try {
      const c = await getAnnualCycle()
      setCycle(c)
      if (c) {
        const { submission: sub, goals: g } = await getMyGoalSet(c.id, employee.id)
        setSubmission(sub)
        setGoals(g.length ? g : [emptyGoal(), emptyGoal(), emptyGoal(), emptyGoal(), emptyGoal()])
        setReviews(await getMyReviews(c.id))
      }
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  function emptyGoal() { return { title: '', description: '', points: '' } }
  const sum = goals.reduce((s, g) => s + (parseInt(g.points) || 0), 0)

  function updateGoal(i, patch) { setGoals(gs => gs.map((g, idx) => idx === i ? { ...g, ...patch } : g)) }
  function addGoal() { if (goals.length < 8) setGoals(gs => [...gs, emptyGoal()]) }
  function removeGoal(i) { if (goals.length > 5) setGoals(gs => gs.filter((_, idx) => idx !== i)) }

  async function handleSaveDraft() {
    setSaving(true); setError('')
    try {
      const payload = goals.filter(g => g.title.trim()).map(g => ({ id: g.id, title: g.title.trim(), description: g.description, points: parseInt(g.points) || 0 }))
      await saveGoalDraft(cycle.id, employee.id, payload)
      await load()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  async function handleSubmit() {
    setSaving(true); setError('')
    try {
      const payload = goals.filter(g => g.title.trim()).map(g => ({ id: g.id, title: g.title.trim(), description: g.description, points: parseInt(g.points) || 0 }))
      await saveGoalDraft(cycle.id, employee.id, payload)
      await submitGoalSet(cycle.id, employee.id)
      await load()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  if (loading) return null
  if (!cycle) return null

  const statusBanner = {
    submitted: { text: 'Submitted — awaiting manager approval', color: C.brand, bg: C.brandLight },
    approved:  { text: '✓ Approved for the year', color: C.green, bg: C.greenSoft },
    returned:  { text: '↩️ Returned by manager — please revise and resubmit', color: C.amber, bg: C.amberSoft },
  }[submission?.status]

  return (
    <div style={{ background: C.surface, borderRadius: 16, border: `1.5px solid ${C.border}`, padding: '20px 24px', marginBottom: 24, boxShadow: C.shadow }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: C.text, fontFamily: FONTS.display }}>🎯 {cycle.year} Performance Goals</div>
        {windowState.open && !locked && (
          <span style={{ fontSize: 11, fontWeight: 700, color: C.brand, background: C.brandLight, padding: '3px 10px', borderRadius: 20 }}>
            Window open · closes {windowState.closesOn?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </span>
        )}
      </div>

      <YearTracker submission={submission} reviews={reviews} />

      {statusBanner && (
        <div style={{ padding: '10px 14px', background: statusBanner.bg, borderRadius: 10, marginBottom: 16, fontSize: 13, fontWeight: 600, color: statusBanner.color }}>
          {statusBanner.text}
          {submission?.status === 'returned' && submission?.manager_comment && (
            <div style={{ fontSize: 12, fontWeight: 400, color: C.textMid, marginTop: 6 }}>“{submission.manager_comment}”</div>
          )}
        </div>
      )}

      {/* Reviews (read-only feedback) */}
      {reviews.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          {['h1', 'year_end'].map(rt => {
            const rows = reviews.filter(r => r.review_type === rt)
            if (!rows.length) return null
            const first = rows[0]
            const verdict = first.verdict ? getVerdict(first.verdict) : null
            return (
              <div key={rt} style={{ background: C.bg, borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{rt === 'h1' ? '📊 Half-Year Review' : '🏁 Year-End Review'}</span>
                  {verdict && <span style={{ fontSize: 11, fontWeight: 700, color: verdict.color, background: verdict.bg, padding: '2px 10px', borderRadius: 20 }}>{verdict.label}</span>}
                </div>
                {first.overall_comment && <div style={{ fontSize: 12, color: C.textMid, marginBottom: 8, fontStyle: 'italic' }}>{first.overall_comment}</div>}
                {rows.filter(r => r.goal_comment).map(r => (
                  <div key={r.objective_id} style={{ fontSize: 12, color: C.textMid, padding: '4px 0', borderTop: `1px solid ${C.border}` }}>
                    <strong style={{ color: C.text }}>{r.goal_title}:</strong> {r.goal_comment}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {/* Goal editor OR read-only cards */}
      {editable ? (
        <>
          {goals.map((g, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 40px', gap: 8, marginBottom: 8, alignItems: 'start' }}>
              <div>
                <input value={g.title} onChange={e => updateGoal(i, { title: e.target.value })} placeholder={`Goal ${i + 1} title`}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none', marginBottom: 4 }} />
                <input value={g.description} onChange={e => updateGoal(i, { description: e.target.value })} placeholder="Description (optional)"
                  style={{ width: '100%', padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 11, fontFamily: FONTS.body, outline: 'none', color: C.textMid }} />
              </div>
              <input type="number" min="1" max="100" value={g.points} onChange={e => updateGoal(i, { points: e.target.value })} placeholder="pts"
                style={{ padding: '8px 12px', borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none', textAlign: 'center' }} />
              <button onClick={() => removeGoal(i)} disabled={goals.length <= 5}
                style={{ background: 'none', border: 'none', fontSize: 16, cursor: goals.length <= 5 ? 'not-allowed' : 'pointer', color: goals.length <= 5 ? C.border : '#ef444470', paddingTop: 6 }}>×</button>
            </div>
          ))}

          {goals.length < 8 && (
            <button onClick={addGoal} style={{ fontSize: 12, color: C.brand, background: 'none', border: `1px dashed ${C.brand}`, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, marginBottom: 14 }}>
              + Add Goal ({goals.length}/8)
            </button>
          )}

          <PointsMeter sum={sum} />
          {error && <Alert type="error" message={error} />}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={handleSubmit} disabled={saving || sum !== 100 || goals.filter(g => g.title.trim()).length < 5}>
              {saving ? 'Saving…' : 'Submit for Approval →'}
            </Button>
            <Button variant="outline" onClick={handleSaveDraft} disabled={saving}>Save Draft</Button>
          </div>
        </>
      ) : (
        goals.filter(g => g.title).map((g, i) => (
          <div key={g.id || i} style={{ display: 'flex', gap: 12, padding: '12px 14px', background: C.bg, borderRadius: 10, marginBottom: 8, alignItems: 'center' }}>
            <div style={{ minWidth: 44, height: 44, borderRadius: 10, background: C.brandLight, color: C.brand, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, fontFamily: FONTS.display }}>{g.points}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{g.title}</div>
              {g.description && <div style={{ fontSize: 11, color: C.textLight }}>{g.description}</div>}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 3: Render `AnnualGoalsSection` at the top of PerformancePage**

In the `PerformancePage` return, inside `<AppShell ...>`, add as the first child (before the cycle selector):

```jsx
<AppShell title="Performance & OKRs" subtitle="Objectives and Key Results">
  {employee && <AnnualGoalsSection employee={employee} />}
  {/* existing cycle selector and OKR content below unchanged */}
```

- [ ] **Step 4: Verify (browser)**

Start dev server. Log in as an employee (ensure the annual cycle exists). Navigate to Performance.

Expected:
- "🎯 2026 Performance Goals" card at the top with the 4-step tracker
- 5 empty goal rows by default; Add Goal up to 8; remove down to 5
- Points meter turns green only at exactly 100
- Submit disabled unless 5–8 goals and sum = 100
- After submit, banner shows "Submitted — awaiting manager approval" and editor locks
- Provide proof via `preview_screenshot`

- [ ] **Step 5: Commit**

```bash
git add src/pages/employee/PerformancePage.jsx
git commit -m "feat: annual goals section on employee Performance page"
```

---

### Task 5: Manager Panels — Goal Approvals + Reviews

**Files:**
- Modify: `src/pages/employee/EmployeeLandingPage.jsx`

**Interfaces:**
- Consumes: `getAnnualCycle`, `getManagerGoalApprovals`, `approveGoalSet`, `returnGoalSet`, `getManagerReviewTargets`, `saveReview` from `../../lib/api.performance`; `getReviewWindow`, `VERDICTS` from `../../lib/constants`
- Produces: `PerformanceManagerPanel` rendered on the dashboard when the manager has approvals or an open review window

- [ ] **Step 1: Add imports**

In `src/pages/employee/EmployeeLandingPage.jsx`, add:

```js
import { getAnnualCycle, getManagerGoalApprovals, approveGoalSet, returnGoalSet, getManagerReviewTargets, saveReview } from '../../lib/api.performance'
import { getReviewWindow, VERDICTS } from '../../lib/constants'
```

(`C`, `FONTS` already imported per Task 4 of the probation feature. `Avatar` is already used in this file.)

- [ ] **Step 2: Add the `PerformanceManagerPanel` component**

Insert before `export default function EmployeeLandingPage()`:

```jsx
function GoalApprovalCard({ sub, onApprove, onReturn }) {
  const [returning, setReturning] = useState(false)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const sum = (sub.goals || []).reduce((s, g) => s + (g.points || 0), 0)

  async function act(fn) {
    setBusy(true); setErr('')
    try { await fn() } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <div style={{ background: C.bg, borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Avatar initials={sub.employee?.avatar_initials || '??'} size={30} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{sub.employee?.full_name}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{sub.employee?.department} · {sub.goals?.length} goals · {sum} pts</div>
        </div>
      </div>
      {(sub.goals || []).map(g => (
        <div key={g.id} style={{ display: 'flex', gap: 10, fontSize: 12, color: C.textMid, padding: '4px 0', borderTop: `1px solid ${C.border}` }}>
          <span style={{ fontWeight: 800, color: C.brand, minWidth: 34 }}>{g.points}</span>
          <span>{g.title}</span>
        </div>
      ))}
      {returning ? (
        <div style={{ marginTop: 10 }}>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="What should change? (required)"
            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 12, fontFamily: FONTS.body, outline: 'none', resize: 'vertical', marginBottom: 8 }} />
          {err && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => act(async () => { await onReturn(sub.id, comment); })} disabled={busy}
              style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: C.amber, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Send Back</button>
            <button onClick={() => { setReturning(false); setErr('') }} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'none', fontSize: 12, cursor: 'pointer', color: C.textLight }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={() => act(async () => { await onApprove(sub.id); })} disabled={busy}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#00b894', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✓ Approve</button>
          <button onClick={() => setReturning(true)} disabled={busy}
            style={{ padding: '7px 16px', borderRadius: 8, border: `1.5px solid ${C.amber}`, background: 'none', color: C.amber, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>↩ Return</button>
        </div>
      )}
      {err && !returning && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>{err}</div>}
    </div>
  )
}

function ReviewCard({ target, reviewType, cycleId, managerId, onDone }) {
  const existing = target.reviews.find(r => r.review_type === reviewType)
  const [open, setOpen] = useState(false)
  const [ratings, setRatings] = useState(() => target.goals.map(g => {
    const rt = existing?.ratings?.find(x => x.objective_id === g.id)
    return { objectiveId: g.id, title: g.title, points: g.points, score: rt?.score ?? '', comment: rt?.comment ?? '' }
  }))
  const [overall, setOverall] = useState(existing?.overall_comment || '')
  const [verdict, setVerdict] = useState(existing?.verdict || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const done = existing?.status === 'manager_done' || existing?.status === 'hr_finalized'

  async function submit() {
    setErr('')
    if (reviewType === 'year_end' && !verdict) { setErr('Select a verdict.'); return }
    setBusy(true)
    try {
      await saveReview({
        reviewId: existing?.id, cycleId, employeeId: target.employee.id, reviewType,
        ratings: ratings.map(r => ({ objectiveId: r.objectiveId, score: r.score === '' ? null : parseFloat(r.score), comment: r.comment })),
        overallComment: overall, verdict: reviewType === 'year_end' ? verdict : undefined,
      }, managerId)
      onDone()
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <div style={{ background: C.bg, borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
      <div onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <Avatar initials={target.employee?.avatar_initials || '??'} size={30} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{target.employee?.full_name}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{target.goals.length} goals</div>
        </div>
        {done ? <span style={{ fontSize: 11, fontWeight: 700, color: '#00b894' }}>✓ Submitted</span>
              : <span style={{ fontSize: 11, color: C.brand }}>{open ? '▲' : 'Review ▾'}</span>}
      </div>

      {open && !done && (
        <div style={{ marginTop: 12 }}>
          {ratings.map((r, i) => (
            <div key={r.objectiveId} style={{ padding: '8px 0', borderTop: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}><span style={{ color: C.brand }}>{r.points}pts</span> · {r.title}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8 }}>
                <input type="number" min="0" max="100" value={r.score} placeholder="score" onChange={e => setRatings(rs => rs.map((x, idx) => idx === i ? { ...x, score: e.target.value } : x))}
                  style={{ padding: '7px 10px', borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 12, fontFamily: FONTS.body, outline: 'none', textAlign: 'center' }} />
                <input value={r.comment} placeholder="Comment (visible to employee)" onChange={e => setRatings(rs => rs.map((x, idx) => idx === i ? { ...x, comment: e.target.value } : x))}
                  style={{ padding: '7px 10px', borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 12, fontFamily: FONTS.body, outline: 'none' }} />
              </div>
            </div>
          ))}
          <textarea value={overall} onChange={e => setOverall(e.target.value)} rows={2} placeholder="Overall comment (visible to employee)"
            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 12, fontFamily: FONTS.body, outline: 'none', resize: 'vertical', margin: '10px 0' }} />
          {reviewType === 'year_end' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6, marginBottom: 10 }}>
              {VERDICTS.map(v => (
                <button key={v.value} onClick={() => setVerdict(v.value)} style={{
                  padding: '8px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                  border: `2px solid ${verdict === v.value ? v.color : C.border}`,
                  background: verdict === v.value ? v.bg : C.surface, color: verdict === v.value ? v.color : C.textMid,
                }}>{v.label}</button>
              ))}
            </div>
          )}
          {err && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{err}</div>}
          <button onClick={submit} disabled={busy}
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: busy ? C.border : C.brand, color: '#fff', fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: FONTS.display }}>
            {busy ? 'Saving…' : 'Submit Review →'}
          </button>
        </div>
      )}
    </div>
  )
}

function PerformanceManagerPanel({ managerId }) {
  const [cycle, setCycle] = useState(null)
  const [approvals, setApprovals] = useState([])
  const [targets, setTargets] = useState([])
  const reviewWindow = getReviewWindow()

  async function load() {
    const c = await getAnnualCycle()
    setCycle(c)
    if (!c) return
    setApprovals(await getManagerGoalApprovals(managerId, c.id))
    if (reviewWindow) setTargets(await getManagerReviewTargets(managerId, c.id))
  }
  useEffect(() => { load() }, [])

  if (!cycle) return null
  const showReviews = reviewWindow && targets.length > 0
  if (approvals.length === 0 && !showReviews) return null

  return (
    <div style={{ background: C.surface, borderRadius: 16, border: `1.5px solid ${C.border}`, padding: '20px 24px', marginBottom: 24, boxShadow: C.shadow }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.text, fontFamily: FONTS.display, marginBottom: 16 }}>📋 Performance — Team Actions</div>

      {approvals.length > 0 && (
        <div style={{ marginBottom: showReviews ? 20 : 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, marginBottom: 10 }}>Goal Approvals ({approvals.length})</div>
          {approvals.map(sub => (
            <GoalApprovalCard key={sub.id} sub={sub}
              onApprove={async (id) => { await approveGoalSet(id, managerId); await load() }}
              onReturn={async (id, comment) => { await returnGoalSet(id, comment, managerId); await load() }} />
          ))}
        </div>
      )}

      {showReviews && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, marginBottom: 10 }}>
            {reviewWindow === 'h1' ? 'H1 Reviews' : 'Year-End Reviews'} ({targets.length})
          </div>
          {targets.map(t => (
            <ReviewCard key={t.employee.id} target={t} reviewType={reviewWindow} cycleId={cycle.id} managerId={managerId} onDone={load} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Render the panel**

In the `EmployeeLandingPage` JSX, immediately after the `{probationReviews.length > 0 && (...)}` block (added by the probation feature), add:

```jsx
{employee && <PerformanceManagerPanel managerId={employee.id} />}
```

The panel self-hides when there is nothing to act on, so no `isManager` guard is needed.

- [ ] **Step 4: Verify (browser)**

Log in as a manager whose direct report has a `submitted` goal set. Navigate to the dashboard.

Expected:
- "📋 Performance — Team Actions" card with a "Goal Approvals" list
- Each card shows the report's goals + points; Approve and Return (with comment) work
- After approving, the card disappears
- During a review window (simulate by temporarily testing in Jul/Dec, or trust the window helper), Review cards appear for reports with approved goals
- Provide proof via `preview_screenshot`

- [ ] **Step 5: Commit**

```bash
git add src/pages/employee/EmployeeLandingPage.jsx
git commit -m "feat: manager goal-approval and review panels on dashboard"
```

---

### Task 6: HR Performance Tab

**Files:**
- Modify: `src/pages/hr/EmployeeManagementPage.jsx`

**Interfaces:**
- Consumes: `getAnnualCycle`, `getPerformanceOverview`, `finalizeReview` from `../../lib/api.performance`; `getVerdict` from `../../lib/constants`
- Produces: a `performance` tab on `EmployeeManagementPage`

- [ ] **Step 1: Add imports**

In `src/pages/hr/EmployeeManagementPage.jsx`, add:

```js
import { getAnnualCycle, getPerformanceOverview, finalizeReview } from '../../lib/api.performance'
import { getVerdict } from '../../lib/constants'
```

- [ ] **Step 2: Add state**

Inside the component, alongside existing state:

```js
const [perfCycle,     setPerfCycle]     = useState(null)
const [perfOverview,  setPerfOverview]  = useState([])
const [finalizingId,  setFinalizingId]  = useState(null)
const [hrNotesDraft,  setHrNotesDraft]  = useState('')
const [perfBusy,      setPerfBusy]      = useState(false)
const [perfError,     setPerfError]     = useState('')
```

- [ ] **Step 3: Load performance data**

In the `load` function, after the existing fetches, add:

```js
const pc = await getAnnualCycle()
setPerfCycle(pc)
if (pc) setPerfOverview(await getPerformanceOverview(pc.id))
```

Add a reload helper inside the component:

```js
async function reloadPerf() {
  if (perfCycle) setPerfOverview(await getPerformanceOverview(perfCycle.id))
}
```

- [ ] **Step 4: Add the tab to the tab bar**

Find the tab array (added by the probation feature it ends with the `probation` entry). Add:

```js
{ id: 'performance', label: `📈 Performance${
    perfOverview.filter(p => p.yearEnd?.status === 'manager_done').length
      ? ` (${perfOverview.filter(p => p.yearEnd?.status === 'manager_done').length})` : ''}` },
```

- [ ] **Step 5: Add the finalize handler**

```js
async function handleFinalize(reviewId) {
  setPerfBusy(true); setPerfError('')
  try {
    await finalizeReview(reviewId, hrNotesDraft, currentEmployee?.id)
    setFinalizingId(null); setHrNotesDraft('')
    await reloadPerf()
  } catch (e) { setPerfError(e.message) } finally { setPerfBusy(false) }
}
```

(Use the same logged-in-user variable this file already uses for the probation tab — it was `currentEmployee` there. If the probation tab used `employee`, use that instead; match the existing file.)

- [ ] **Step 6: Add the tab content**

After the `{tab === 'probation' && (...)}` block, add:

```jsx
{tab === 'performance' && (
  <div>
    {!perfCycle ? (
      <div style={{ textAlign: 'center', padding: '40px 0', color: C.textLight }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📈</div>
        <div style={{ fontWeight: 600 }}>No active annual cycle</div>
      </div>
    ) : (
      <>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONTS.display, marginBottom: 14 }}>
          {perfCycle.year} Performance Overview
        </div>
        {perfError && <div style={{ padding: '10px 14px', background: '#fef2f2', borderRadius: 10, color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{perfError}</div>}

        {perfOverview.map(row => {
          const subStatus = row.submission?.status || 'not_started'
          const subBadge = {
            not_started: { label: 'No goals',    color: C.textLight, bg: C.bg },
            draft:       { label: 'Draft',        color: C.textMid,   bg: C.bg },
            submitted:   { label: 'Submitted',    color: C.brand,     bg: C.brandLight },
            returned:    { label: 'Returned',     color: C.amber,     bg: C.amberSoft },
            approved:    { label: 'Approved',     color: C.green,     bg: C.greenSoft },
          }[subStatus]
          const ye = row.yearEnd
          const verdict = ye?.verdict ? getVerdict(ye.verdict) : null
          const canFinalize = ye?.status === 'manager_done'
          const isFinalizing = finalizingId === ye?.id

          return (
            <div key={row.employee.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Avatar initials={row.employee.avatar_initials || '??'} size={30} />
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{row.employee.full_name}</div>
                  <div style={{ fontSize: 11, color: C.textLight }}>{row.employee.department}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: subBadge.color, background: subBadge.bg, padding: '3px 10px', borderRadius: 20 }}>Goals: {subBadge.label}</span>
                <span style={{ fontSize: 11, color: C.textLight }}>H1: {row.h1 ? '✓' : '—'}</span>
                {verdict
                  ? <span style={{ fontSize: 11, fontWeight: 700, color: verdict.color, background: verdict.bg, padding: '3px 10px', borderRadius: 20 }}>{verdict.label}{ye.status === 'hr_finalized' ? ' ✓' : ''}</span>
                  : <span style={{ fontSize: 11, color: C.textLight }}>Year-end: —</span>}
                {canFinalize && (
                  <button onClick={() => { setFinalizingId(isFinalizing ? null : ye.id); setHrNotesDraft(''); setPerfError('') }}
                    style={{ padding: '6px 12px', borderRadius: 8, border: `1.5px solid ${C.brand}`, background: isFinalizing ? C.brandLight : C.surface, color: C.brand, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    {isFinalizing ? 'Cancel' : 'Finalize →'}
                  </button>
                )}
              </div>

              {isFinalizing && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                  {ye.overall_comment && <div style={{ fontSize: 12, color: C.textMid, marginBottom: 8, fontStyle: 'italic' }}>Manager: “{ye.overall_comment}”</div>}
                  {(ye.ratings || []).map(rt => (
                    <div key={rt.objective_id} style={{ fontSize: 12, color: C.textMid, padding: '3px 0' }}>
                      Score: <strong style={{ color: C.text }}>{rt.score ?? '—'}</strong>{rt.comment ? ` · ${rt.comment}` : ''}
                    </div>
                  ))}
                  <textarea value={hrNotesDraft} onChange={e => setHrNotesDraft(e.target.value)} rows={2} placeholder="HR notes (internal, optional)"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 12, fontFamily: FONTS.body, outline: 'none', resize: 'vertical', margin: '8px 0' }} />
                  <button onClick={() => handleFinalize(ye.id)} disabled={perfBusy}
                    style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: perfBusy ? C.border : C.brand, color: '#fff', fontSize: 13, fontWeight: 700, cursor: perfBusy ? 'not-allowed' : 'pointer', fontFamily: FONTS.display }}>
                    {perfBusy ? 'Finalizing…' : 'Confirm & Finalize →'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </>
    )}
  </div>
)}
```

- [ ] **Step 7: Verify (browser)**

Log in as HR. Open Employee Management → "📈 Performance" tab.

Expected:
- Overview row per active employee with goal status, H1 indicator, year-end verdict
- Numeric scores + manager comments visible in the finalize panel (HR sees everything)
- "Finalize →" appears only when a year-end review is at `manager_done`
- After finalizing, the verdict badge shows a ✓ and the button disappears
- Provide proof via `preview_screenshot`

- [ ] **Step 8: Commit**

```bash
git add src/pages/hr/EmployeeManagementPage.jsx
git commit -m "feat: HR Performance tab with overview and year-end finalization"
```

---

## Self-Review

**Spec coverage:**
- Goal setting 5–8 / 100 points → Task 1 (trigger) + Task 3 (`submitGoalSet`) + Task 4 (meter/validation) ✓
- Manager approval (approve/return) → Task 3 + Task 5 ✓
- H1 + year-end reviews, scores hidden, comments visible → Task 1 (`get_my_performance_reviews`) + Task 3 (`saveReview`) + Task 4 (employee view) + Task 5 (manager entry) ✓
- Year-end verdict (Exceeds/Meets/Partially/Doesn't Meet) → `VERDICTS` in Task 3, used in Tasks 4/5/6 ✓
- HR finalization + full visibility → Task 3 (`finalizeReview`, `getPerformanceOverview`) + Task 6 ✓
- All active employees participate; new-hire 15-day window → `getGoalWindowState` in Task 3, used in Task 4; lifecycle 16c in Task 2 ✓
- Windows Jan 25–Feb 15 / Jul 1–15 / Dec 15–31 → `getGoalWindowState` + `getReviewWindow` (Task 3), lifecycle events (Task 2) ✓
- Notifications for lifecycle events → Task 2 (window opens, deadlines) + Task 3 (submit/approve/return/review/finalize) ✓
- HR view = tab on EmployeeManagementPage → Task 6 ✓
- Builds on existing OKR tables (cycle_type, objectives.points) → Task 1 ✓

**Placeholder scan:** No TBD/TODO. All code blocks complete. Task 2 requires reading the existing function first (documented why — the full 700-line function is not duplicated to avoid drift), with the exact block to insert and its position specified.

**Type consistency:** `saveReview` signature is identical in Task 3 (definition) and Task 5 (call). `ratings` uses `objectiveId` (camelCase) in JS throughout; the DB column is `objective_id` and mapping happens inside `saveReview`. `getMyReviews` returns rows with `review_type`, `verdict`, `goal_title`, `goal_comment`, `objective_id` — matching the function's `RETURNS TABLE` in Task 1 and the consumption in Task 4. `getPerformanceOverview` returns `{ employee, submission, h1, yearEnd }` — matching Task 6's `row.employee/submission/h1/yearEnd`. Verdict values match between `VERDICTS` (Task 3) and the DB CHECK (Task 1).

**Note for implementer (Task 5 & 6):** confirm the logged-in-user variable name in `EmployeeManagementPage.jsx` — the probation feature used `currentEmployee`. Match whatever that file already uses.
