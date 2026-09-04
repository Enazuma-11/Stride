# Probation Period Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build end-to-end probation period tracking — 6-month default, one-time extension, manager recommends then HR decides, employee sees their own status.

**Architecture:** New `probation_reviews` table carries the two-step decision trail (manager → HR). `employees` gains `probation_end_date` and `probation_extended`. A new `api.probation.js` module owns all reads/writes. UI spans three surfaces: employee Profile page, manager panel in EmployeeLandingPage, and a new Probation tab in EmployeeManagementPage. Lifecycle engine fires at 30d/14d/3d before end date; the 30d firing also creates the review row.

**Tech Stack:** React 18, Supabase (PostgREST + RLS + PL/pgSQL), inline styles with `C`/`FONTS` design tokens from `src/lib/constants.js`.

## Global Constraints

- All inline styles — no CSS files, no Tailwind, no new npm packages
- Color tokens from `C` imported from `src/lib/constants.js` (e.g. `C.brand`, `C.amber`, `C.green`, `C.accent`, `C.border`, `C.surface`, `C.text`, `C.textMid`, `C.textLight`, `C.brandLight`, `C.greenSoft`, `C.amberSoft`, `C.accentSoft`)
- Font tokens from `FONTS` (e.g. `FONTS.display`, `FONTS.body`)
- RLS pattern: `employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())`
- Notification best-effort: DB write first, then `try { notification } catch (e) { console.warn(...) }`
- No new npm dependencies
- `employee_type` values: `'permanent', 'intern', 'contractor', 'parttime', 'probation'`
- `probation_reviews.status` values: `'pending_manager', 'pending_hr', 'decided'`
- `manager_recommendation` values: `'confirm', 'extend', 'relieve'`
- `hr_decision` values: `'confirmed', 'extended', 'relieved'`

---

### Task 1: SQL Migration — Schema + Lifecycle Engine

**Files:**
- Create: `supabase_migration_probation.sql`

**Interfaces:**
- Produces: `probation_reviews` table, `employees.probation_end_date`, `employees.probation_extended`, updated `run_lifecycle_reminders()` with 30d stage that auto-creates review rows

- [ ] **Step 1: Create the migration file**

Create `supabase_migration_probation.sql` at the repo root with this exact content:

```sql
-- ============================================================
-- STRIDE — PROBATION PERIOD MANAGEMENT
-- Run in: Supabase Dashboard → SQL Editor (both Production and Test)
-- ============================================================

-- ── 1. Add 'probation' to employee_type CHECK constraint ──────────────────────
ALTER TABLE employees
  DROP CONSTRAINT IF EXISTS employees_employee_type_check,
  ADD CONSTRAINT employees_employee_type_check
    CHECK (employee_type IN ('permanent', 'intern', 'contractor', 'parttime', 'probation'));

-- ── 2. Add probation columns to employees ─────────────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS probation_end_date  DATE    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS probation_extended  BOOLEAN NOT NULL DEFAULT false;

-- ── 3. Create probation_reviews table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS probation_reviews (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  status                  TEXT NOT NULL DEFAULT 'pending_manager'
                            CHECK (status IN ('pending_manager', 'pending_hr', 'decided')),
  manager_recommendation  TEXT CHECK (manager_recommendation IN ('confirm', 'extend', 'relieve')),
  manager_notes           TEXT,
  extension_days          INTEGER CHECK (extension_days IS NULL OR extension_days > 0),
  manager_id              UUID REFERENCES employees(id),
  manager_reviewed_at     TIMESTAMPTZ,

  hr_decision             TEXT CHECK (hr_decision IN ('confirmed', 'extended', 'relieved')),
  hr_notes                TEXT,
  hr_extension_days       INTEGER CHECK (hr_extension_days IS NULL OR hr_extension_days > 0),
  hr_decided_by           UUID REFERENCES employees(id),
  hr_decided_at           TIMESTAMPTZ,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_probation_reviews_employee ON probation_reviews(employee_id);
CREATE INDEX IF NOT EXISTS idx_probation_reviews_status   ON probation_reviews(status);

-- ── 4. RLS on probation_reviews ──────────────────────────────────────────────
ALTER TABLE probation_reviews ENABLE ROW LEVEL SECURITY;

-- HR/Admin: full access
DROP POLICY IF EXISTS "probation_hr_all" ON probation_reviews;
CREATE POLICY "probation_hr_all" ON probation_reviews
  FOR ALL USING (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND role_type IN ('hr', 'admin'))
  );

-- Managers: read reviews for their direct reports
DROP POLICY IF EXISTS "probation_manager_read" ON probation_reviews;
CREATE POLICY "probation_manager_read" ON probation_reviews
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM employees mgr
      JOIN employees emp ON emp.manager_id = mgr.id
      WHERE mgr.user_id = auth.uid() AND emp.id = probation_reviews.employee_id
    )
  );

-- Managers: update only pending_manager rows → pending_hr
DROP POLICY IF EXISTS "probation_manager_write" ON probation_reviews;
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

-- Employees: read their own review
DROP POLICY IF EXISTS "probation_employee_read" ON probation_reviews;
CREATE POLICY "probation_employee_read" ON probation_reviews
  FOR SELECT USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
  );

-- ── 5. Update run_lifecycle_reminders — add 30d stage + review row creation ──
CREATE OR REPLACE FUNCTION run_lifecycle_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  today     DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  r         RECORD;
  recipient RECORD;
  dedup_key TEXT;
BEGIN

  -- ═══════════════════════════════════════════════════════════════
  -- EVENT 1: BIRTHDAY — on the day, team-wide + self
  -- ═══════════════════════════════════════════════════════════════
  FOR r IN
    SELECT id, full_name, date_of_birth
    FROM employees
    WHERE status = 'active'
      AND date_of_birth IS NOT NULL
      AND EXTRACT(MONTH FROM date_of_birth) = EXTRACT(MONTH FROM today)
      AND EXTRACT(DAY   FROM date_of_birth) = EXTRACT(DAY   FROM today)
  LOOP
    dedup_key := 'lifecycle:birthday:self:' || r.id::text || ':' || today::text;
    IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
      INSERT INTO notifications (employee_id, type, title, message, metadata)
      VALUES (
        r.id, 'lifecycle_reminder',
        '🎂 Happy Birthday, ' || split_part(r.full_name, ' ', 1) || '!',
        'Wishing you a wonderful birthday from the entire SporTech team! 🎉',
        jsonb_build_object('event_type', 'birthday', 'stage', 'today')
      );
      INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
      VALUES (dedup_key, 'birthday', r.id);
    END IF;

    FOR recipient IN
      SELECT id FROM employees WHERE status = 'active' AND id != r.id
    LOOP
      dedup_key := 'lifecycle:birthday:team:' || r.id::text || ':' || today::text || ':' || recipient.id::text;
      IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
        INSERT INTO notifications (employee_id, type, title, message, metadata)
        VALUES (
          recipient.id, 'lifecycle_reminder',
          '🎂 Today is ' || r.full_name || '''s Birthday!',
          'Wish ' || split_part(r.full_name, ' ', 1) || ' a happy birthday today! 🎉',
          jsonb_build_object('event_type', 'birthday', 'stage', 'today', 'subject_employee_id', r.id)
        );
        INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
        VALUES (dedup_key, 'birthday', r.id);
      END IF;
    END LOOP;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- EVENT 2: WORK ANNIVERSARY — on the day (1+ full years), team-wide
  -- ═══════════════════════════════════════════════════════════════
  FOR r IN
    SELECT id, full_name, join_date
    FROM employees
    WHERE status = 'active'
      AND join_date IS NOT NULL
      AND EXTRACT(MONTH FROM join_date) = EXTRACT(MONTH FROM today)
      AND EXTRACT(DAY   FROM join_date) = EXTRACT(DAY   FROM today)
      AND EXTRACT(YEAR  FROM today) > EXTRACT(YEAR FROM join_date)
  LOOP
    DECLARE
      years_completed INT  := EXTRACT(YEAR FROM today)::int - EXTRACT(YEAR FROM r.join_date)::int;
      year_label      TEXT := years_completed || CASE WHEN years_completed = 1 THEN ' year' ELSE ' years' END;
    BEGIN
      dedup_key := 'lifecycle:anniversary:self:' || r.id::text || ':' || today::text;
      IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
        INSERT INTO notifications (employee_id, type, title, message, metadata)
        VALUES (
          r.id, 'lifecycle_reminder',
          '🎉 Happy Work Anniversary!',
          'Congratulations on ' || year_label || ' with SporTech! Thank you for everything you bring to the team.',
          jsonb_build_object('event_type', 'work_anniversary', 'years', years_completed)
        );
        INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
        VALUES (dedup_key, 'work_anniversary', r.id);
      END IF;

      FOR recipient IN
        SELECT id FROM employees WHERE status = 'active' AND id != r.id
      LOOP
        dedup_key := 'lifecycle:anniversary:team:' || r.id::text || ':' || today::text || ':' || recipient.id::text;
        IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
          INSERT INTO notifications (employee_id, type, title, message, metadata)
          VALUES (
            recipient.id, 'lifecycle_reminder',
            '🎉 ' || r.full_name || ' — ' || year_label || ' at SporTech!',
            'Today marks ' || r.full_name || '''s ' || year_label || ' anniversary. Congratulate them! 🙌',
            jsonb_build_object('event_type', 'work_anniversary', 'years', years_completed, 'subject_employee_id', r.id)
          );
          INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
          VALUES (dedup_key, 'work_anniversary', r.id);
        END IF;
      END LOOP;
    END;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- EVENT 3: NEW JOINER — on join_date, team-wide welcome
  -- ═══════════════════════════════════════════════════════════════
  FOR r IN
    SELECT id, full_name, role, department
    FROM employees
    WHERE status = 'active'
      AND join_date = today
  LOOP
    FOR recipient IN
      SELECT id FROM employees WHERE status = 'active' AND id != r.id
    LOOP
      dedup_key := 'lifecycle:new_joiner:team:' || r.id::text || ':' || today::text || ':' || recipient.id::text;
      IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
        INSERT INTO notifications (employee_id, type, title, message, metadata)
        VALUES (
          recipient.id, 'lifecycle_reminder',
          '👋 Welcome ' || r.full_name || ' to the team!',
          r.full_name || ' joins SporTech today as ' || r.role || ' in ' || r.department || '. Give them a warm welcome!',
          jsonb_build_object('event_type', 'new_joiner', 'subject_employee_id', r.id, 'department', r.department)
        );
        INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
        VALUES (dedup_key, 'new_joiner', r.id);
      END IF;
    END LOOP;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- EVENT 4: INTERNSHIP ENDING — 14d and 3d before end date
  -- Recipients: HR/Admin + employee's manager
  -- ═══════════════════════════════════════════════════════════════
  FOR r IN
    SELECT id, full_name, internship_end_date, manager_id
    FROM employees
    WHERE status = 'active'
      AND internship_end_date IS NOT NULL
      AND internship_end_date IN (today + 14, today + 3)
  LOOP
    DECLARE
      stage     TEXT := CASE WHEN r.internship_end_date = today + 14 THEN '14d' ELSE '3d' END;
      days_left INT  := r.internship_end_date - today;
    BEGIN
      FOR recipient IN
        SELECT id FROM employees
        WHERE status = 'active' AND role_type IN ('hr', 'admin')
        UNION
        SELECT id FROM employees
        WHERE id = r.manager_id AND status = 'active'
      LOOP
        dedup_key := 'lifecycle:internship_ending:' || stage || ':' || r.id::text || ':' || r.internship_end_date::text || ':' || recipient.id::text;
        IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
          INSERT INTO notifications (employee_id, type, title, message, metadata)
          VALUES (
            recipient.id, 'lifecycle_reminder',
            '📋 Internship Ending in ' || days_left || ' days — ' || r.full_name,
            r.full_name || '''s internship ends on ' || to_char(r.internship_end_date, 'DD Mon YYYY') || '. Please action contract extension or offboarding.',
            jsonb_build_object('event_type', 'internship_ending', 'stage', stage, 'subject_employee_id', r.id, 'end_date', r.internship_end_date)
          );
          INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
          VALUES (dedup_key, 'internship_ending', r.id);
        END IF;
      END LOOP;
    END;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- EVENT 5: PROBATION ENDING — 30d, 14d, and 3d before end date
  -- Recipients: HR/Admin + employee's manager
  -- At 30d: also creates the probation_reviews row if not already present
  -- ═══════════════════════════════════════════════════════════════
  FOR r IN
    SELECT id, full_name, probation_end_date, manager_id
    FROM employees
    WHERE status = 'active'
      AND employee_type = 'probation'
      AND probation_end_date IS NOT NULL
      AND probation_end_date IN (today + 30, today + 14, today + 3)
  LOOP
    DECLARE
      stage     TEXT := CASE WHEN r.probation_end_date = today + 30 THEN '30d'
                             WHEN r.probation_end_date = today + 14 THEN '14d'
                             ELSE '3d' END;
      days_left INT  := r.probation_end_date - today;
    BEGIN
      FOR recipient IN
        SELECT id FROM employees
        WHERE status = 'active' AND role_type IN ('hr', 'admin')
        UNION
        SELECT id FROM employees
        WHERE id = r.manager_id AND status = 'active'
      LOOP
        dedup_key := 'lifecycle:probation_ending:' || stage || ':' || r.id::text || ':' || r.probation_end_date::text || ':' || recipient.id::text;
        IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
          INSERT INTO notifications (employee_id, type, title, message, metadata)
          VALUES (
            recipient.id, 'lifecycle_reminder',
            '📋 Probation Ending in ' || days_left || ' days — ' || r.full_name,
            r.full_name || '''s probation ends on ' || to_char(r.probation_end_date, 'DD Mon YYYY') || '. Confirmation decision required.',
            jsonb_build_object('event_type', 'probation_ending', 'stage', stage, 'subject_employee_id', r.id, 'end_date', r.probation_end_date)
          );
          INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
          VALUES (dedup_key, 'probation_ending', r.id);
        END IF;
      END LOOP;

      -- At 30d: create the review row so managers can act immediately
      IF stage = '30d' THEN
        IF NOT EXISTS (
          SELECT 1 FROM probation_reviews
          WHERE employee_id = r.id
            AND status IN ('pending_manager', 'pending_hr')
        ) THEN
          INSERT INTO probation_reviews (employee_id, status)
          VALUES (r.id, 'pending_manager');
        END IF;
      END IF;
    END;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- EVENT 6: PASSPORT EXPIRY — 30d, 7d, and on expiry day
  -- Recipients: the employee + HR/Admin
  -- ═══════════════════════════════════════════════════════════════
  FOR r IN
    SELECT ec.employee_id, e.full_name, ec.passport_expiry_date
    FROM employee_compliance ec
    JOIN employees e ON e.id = ec.employee_id
    WHERE e.status = 'active'
      AND ec.passport_expiry_date IS NOT NULL
      AND ec.passport_expiry_date IN (today + 30, today + 7, today)
  LOOP
    DECLARE
      stage     TEXT := CASE WHEN r.passport_expiry_date = today + 30 THEN '30d'
                             WHEN r.passport_expiry_date = today + 7  THEN '7d'
                             ELSE '0d' END;
      days_left INT  := r.passport_expiry_date - today;
      urgency   TEXT := CASE WHEN days_left = 0 THEN 'expires TODAY'
                             ELSE 'expires in ' || days_left || ' days' END;
    BEGIN
      FOR recipient IN
        SELECT id FROM employees WHERE id = r.employee_id
        UNION
        SELECT id FROM employees WHERE status = 'active' AND role_type IN ('hr', 'admin')
      LOOP
        dedup_key := 'lifecycle:passport_expiry:' || stage || ':' || r.employee_id::text || ':' || r.passport_expiry_date::text || ':' || recipient.id::text;
        IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
          INSERT INTO notifications (employee_id, type, title, message, metadata)
          VALUES (
            recipient.id, 'lifecycle_reminder',
            '🛂 Passport ' || urgency || CASE WHEN recipient.id = r.employee_id THEN '' ELSE ' — ' || r.full_name END,
            CASE WHEN recipient.id = r.employee_id
              THEN 'Your passport ' || urgency || ' (' || to_char(r.passport_expiry_date, 'DD Mon YYYY') || '). Please renew in time.'
              ELSE r.full_name || '''s passport ' || urgency || ' on ' || to_char(r.passport_expiry_date, 'DD Mon YYYY') || '.'
            END,
            jsonb_build_object('event_type', 'passport_expiry', 'stage', stage, 'subject_employee_id', r.employee_id, 'expiry_date', r.passport_expiry_date)
          );
          INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
          VALUES (dedup_key, 'passport_expiry', r.employee_id);
        END IF;
      END LOOP;
    END;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- EVENT 7: VISA EXPIRY — 30d, 7d, and on expiry day
  -- ═══════════════════════════════════════════════════════════════
  FOR r IN
    SELECT ec.employee_id, e.full_name, ec.visa_expiry_date, ec.visa_type
    FROM employee_compliance ec
    JOIN employees e ON e.id = ec.employee_id
    WHERE e.status = 'active'
      AND ec.visa_expiry_date IS NOT NULL
      AND ec.visa_expiry_date IN (today + 30, today + 7, today)
  LOOP
    DECLARE
      stage     TEXT := CASE WHEN r.visa_expiry_date = today + 30 THEN '30d'
                             WHEN r.visa_expiry_date = today + 7  THEN '7d'
                             ELSE '0d' END;
      days_left INT  := r.visa_expiry_date - today;
      urgency   TEXT := CASE WHEN days_left = 0 THEN 'expires TODAY'
                             ELSE 'expires in ' || days_left || ' days' END;
    BEGIN
      FOR recipient IN
        SELECT id FROM employees WHERE id = r.employee_id
        UNION
        SELECT id FROM employees WHERE status = 'active' AND role_type IN ('hr', 'admin')
      LOOP
        dedup_key := 'lifecycle:visa_expiry:' || stage || ':' || r.employee_id::text || ':' || r.visa_expiry_date::text || ':' || recipient.id::text;
        IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
          INSERT INTO notifications (employee_id, type, title, message, metadata)
          VALUES (
            recipient.id, 'lifecycle_reminder',
            '🛂 Visa ' || urgency || CASE WHEN recipient.id = r.employee_id THEN '' ELSE ' — ' || r.full_name END,
            CASE WHEN recipient.id = r.employee_id
              THEN 'Your ' || COALESCE(r.visa_type, '') || ' visa ' || urgency || ' (' || to_char(r.visa_expiry_date, 'DD Mon YYYY') || ').'
              ELSE r.full_name || '''s visa ' || urgency || ' on ' || to_char(r.visa_expiry_date, 'DD Mon YYYY') || '.'
            END,
            jsonb_build_object('event_type', 'visa_expiry', 'stage', stage, 'subject_employee_id', r.employee_id, 'expiry_date', r.visa_expiry_date)
          );
          INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
          VALUES (dedup_key, 'visa_expiry', r.employee_id);
        END IF;
      END LOOP;
    END;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- EVENT 8: CERTIFICATION EXPIRY — 30d, 7d, and on expiry day
  -- ═══════════════════════════════════════════════════════════════
  FOR r IN
    SELECT ec.employee_id, e.full_name, ec.title AS cert_title, ec.expiry_date, ec.id AS cert_id
    FROM employee_certifications ec
    JOIN employees e ON e.id = ec.employee_id
    WHERE e.status = 'active'
      AND ec.expiry_date IS NOT NULL
      AND ec.expiry_date IN (today + 30, today + 7, today)
  LOOP
    DECLARE
      stage     TEXT := CASE WHEN r.expiry_date = today + 30 THEN '30d'
                             WHEN r.expiry_date = today + 7  THEN '7d'
                             ELSE '0d' END;
      days_left INT  := r.expiry_date - today;
      urgency   TEXT := CASE WHEN days_left = 0 THEN 'expires TODAY'
                             ELSE 'expires in ' || days_left || ' days' END;
    BEGIN
      FOR recipient IN
        SELECT id FROM employees WHERE id = r.employee_id
        UNION
        SELECT id FROM employees WHERE status = 'active' AND role_type IN ('hr', 'admin')
      LOOP
        dedup_key := 'lifecycle:cert_expiry:' || stage || ':' || r.cert_id::text || ':' || r.expiry_date::text || ':' || recipient.id::text;
        IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
          INSERT INTO notifications (employee_id, type, title, message, metadata)
          VALUES (
            recipient.id, 'lifecycle_reminder',
            '📜 ' || r.cert_title || ' ' || urgency || CASE WHEN recipient.id = r.employee_id THEN '' ELSE ' — ' || r.full_name END,
            CASE WHEN recipient.id = r.employee_id
              THEN 'Your certification "' || r.cert_title || '" ' || urgency || ' (' || to_char(r.expiry_date, 'DD Mon YYYY') || ').'
              ELSE r.full_name || '''s certification "' || r.cert_title || '" ' || urgency || ' on ' || to_char(r.expiry_date, 'DD Mon YYYY') || '.'
            END,
            jsonb_build_object('event_type', 'cert_expiry', 'stage', stage, 'subject_employee_id', r.employee_id, 'cert_id', r.cert_id, 'expiry_date', r.expiry_date)
          );
          INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
          VALUES (dedup_key, 'cert_expiry', r.employee_id);
        END IF;
      END LOOP;
    END;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- EVENT 9: LEAVE ENDING — fire on to_date (last day of leave)
  -- ═══════════════════════════════════════════════════════════════
  FOR r IN
    SELECT lr.id, lr.employee_id, lr.to_date, lr.leave_type
    FROM leave_requests lr
    WHERE lr.status = 'approved'
      AND lr.to_date = today
  LOOP
    dedup_key := 'lifecycle:leave_ending:' || r.id::text || ':' || r.employee_id::text;
    IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
      INSERT INTO notifications (employee_id, type, title, message, metadata)
      VALUES (
        r.employee_id, 'lifecycle_reminder',
        '👋 Back to work tomorrow!',
        'Your ' || r.leave_type || ' leave ends today. See you tomorrow! 🙌',
        jsonb_build_object('event_type', 'leave_ending', 'leave_request_id', r.id, 'leave_type', r.leave_type, 'to_date', r.to_date)
      );
      INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
      VALUES (dedup_key, 'leave_ending', r.employee_id);
    END IF;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- EVENT 10: AGING LEAVE APPROVAL — 3d and 7d waiting
  -- ═══════════════════════════════════════════════════════════════
  FOR r IN
    SELECT lr.id, lr.employee_id, lr.created_at, lr.leave_type, lr.from_date, lr.to_date,
           e.full_name AS employee_name
    FROM leave_requests lr
    JOIN employees e ON e.id = lr.employee_id
    WHERE lr.status = 'pending'
      AND (today - lr.created_at::date) IN (3, 7)
  LOOP
    DECLARE
      wait_days INT  := today - r.created_at::date;
      stage     TEXT := wait_days::text || 'd';
    BEGIN
      FOR recipient IN
        SELECT id FROM employees WHERE status = 'active' AND role_type IN ('hr', 'admin')
      LOOP
        dedup_key := 'lifecycle:leave_aging:' || stage || ':' || r.id::text || ':' || recipient.id::text;
        IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
          INSERT INTO notifications (employee_id, type, title, message, metadata)
          VALUES (
            recipient.id, 'lifecycle_reminder',
            '⏰ Leave request waiting ' || wait_days || ' days — ' || r.employee_name,
            r.employee_name || '''s ' || r.leave_type || ' leave (' || to_char(r.from_date, 'DD Mon') || '–' || to_char(r.to_date, 'DD Mon YYYY') || ') has been pending for ' || wait_days || ' days.',
            jsonb_build_object('event_type', 'leave_aging', 'stage', stage, 'leave_request_id', r.id, 'days_waiting', wait_days)
          );
          INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
          VALUES (dedup_key, 'leave_aging', r.employee_id);
        END IF;
      END LOOP;
    END;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- EVENT 11: AGING REGULARIZATION APPROVAL — 3d and 7d waiting
  -- ═══════════════════════════════════════════════════════════════
  FOR r IN
    SELECT arr.id, arr.employee_id, arr.submitted_at, arr.status,
           e.full_name AS employee_name, e.manager_id
    FROM attendance_regularization_requests arr
    JOIN employees e ON e.id = arr.employee_id
    WHERE arr.status IN ('pending_manager', 'pending_admin')
      AND (today - arr.submitted_at::date) IN (3, 7)
  LOOP
    DECLARE
      wait_days INT  := today - r.submitted_at::date;
      stage     TEXT := wait_days::text || 'd';
    BEGIN
      FOR recipient IN
        SELECT id FROM employees
        WHERE
          CASE
            WHEN r.status = 'pending_manager'
              THEN id = r.manager_id AND status = 'active'
            ELSE
              status = 'active' AND role_type IN ('hr', 'admin')
          END
      LOOP
        dedup_key := 'lifecycle:reg_aging:' || stage || ':' || r.id::text || ':' || recipient.id::text;
        IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
          INSERT INTO notifications (employee_id, type, title, message, metadata)
          VALUES (
            recipient.id, 'lifecycle_reminder',
            '⏰ Regularization waiting ' || wait_days || ' days — ' || r.employee_name,
            r.employee_name || '''s attendance regularization request has been pending for ' || wait_days || ' days. Please review.',
            jsonb_build_object('event_type', 'reg_aging', 'stage', stage, 'request_id', r.id, 'days_waiting', wait_days, 'current_status', r.status)
          );
          INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
          VALUES (dedup_key, 'reg_aging', r.employee_id);
        END IF;
      END LOOP;
    END;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- EVENT 12: AGING TRANSFER APPROVAL — 3d and 7d waiting
  -- ═══════════════════════════════════════════════════════════════
  FOR r IN
    SELECT mtr.id, mtr.employee_id, mtr.created_at, mtr.status, mtr.to_manager_id,
           e.full_name AS employee_name
    FROM manager_transfer_requests mtr
    JOIN employees e ON e.id = mtr.employee_id
    WHERE mtr.status IN ('pending_target', 'pending_hr')
      AND (today - mtr.created_at::date) IN (3, 7)
  LOOP
    DECLARE
      wait_days INT  := today - r.created_at::date;
      stage     TEXT := wait_days::text || 'd';
    BEGIN
      FOR recipient IN
        SELECT id FROM employees
        WHERE
          CASE
            WHEN r.status = 'pending_target'
              THEN id = r.to_manager_id AND status = 'active'
            ELSE
              status = 'active' AND role_type IN ('hr', 'admin')
          END
      LOOP
        dedup_key := 'lifecycle:transfer_aging:' || stage || ':' || r.id::text || ':' || recipient.id::text;
        IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
          INSERT INTO notifications (employee_id, type, title, message, metadata)
          VALUES (
            recipient.id, 'lifecycle_reminder',
            '⏰ Transfer request waiting ' || wait_days || ' days — ' || r.employee_name,
            'A manager transfer request for ' || r.employee_name || ' has been pending for ' || wait_days || ' days. Please review.',
            jsonb_build_object('event_type', 'transfer_aging', 'stage', stage, 'request_id', r.id, 'days_waiting', wait_days, 'current_status', r.status)
          );
          INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
          VALUES (dedup_key, 'transfer_aging', r.employee_id);
        END IF;
      END LOOP;
    END;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- EVENT 13: HOLIDAY REMINDER — 3 days before, all active employees
  -- ═══════════════════════════════════════════════════════════════
  FOR r IN
    SELECT id, name, date, type
    FROM holidays
    WHERE date = today + 3
  LOOP
    FOR recipient IN
      SELECT id FROM employees WHERE status = 'active'
    LOOP
      dedup_key := 'lifecycle:holiday_upcoming:' || r.id::text || ':' || recipient.id::text;
      IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
        INSERT INTO notifications (employee_id, type, title, message, metadata)
        VALUES (
          recipient.id, 'lifecycle_reminder',
          '🎉 ' || r.name || ' in 3 days',
          r.name || ' is on ' || to_char(r.date, 'Day, DD Month YYYY') || '. ' ||
          CASE WHEN r.type = 'mandatory' THEN 'Mandatory holiday.'
               WHEN r.type = 'optional'  THEN 'Optional holiday — check if you opted in.'
               ELSE '' END,
          jsonb_build_object('event_type', 'holiday_upcoming', 'holiday_id', r.id, 'date', r.date, 'holiday_type', r.type)
        );
        INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
        VALUES (dedup_key, 'holiday_upcoming', NULL);
      END IF;
    END LOOP;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- EVENT 14: MONTHLY REGULARIZATION NUDGE — day 25 to month-end
  -- ═══════════════════════════════════════════════════════════════
  IF EXTRACT(DAY FROM today) >= 25 THEN
    DECLARE
      month_start DATE := date_trunc('month', today)::date;
      year_month  TEXT := to_char(today, 'YYYY-MM');
    BEGIN
      FOR r IN
        SELECT
          a.employee_id,
          COUNT(*) AS unresolved_count
        FROM attendance a
        WHERE a.date >= month_start
          AND a.date <= today
          AND a.status IN ('half_day', 'absent')
          AND NOT EXISTS (
            SELECT 1
            FROM attendance_regularization_items ari
            JOIN attendance_regularization_requests arr ON arr.id = ari.request_id
            WHERE arr.employee_id = a.employee_id
              AND ari.date = a.date
          )
        GROUP BY a.employee_id
        HAVING COUNT(*) > 0
      LOOP
        dedup_key := 'lifecycle:reg_nudge:' || year_month || ':' || r.employee_id::text;
        IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
          INSERT INTO notifications (employee_id, type, title, message, metadata)
          VALUES (
            r.employee_id, 'lifecycle_reminder',
            'Attendance Regularization Reminder',
            'You have ' || r.unresolved_count || ' day(s) this month that may need regularization — submit before month-end.',
            jsonb_build_object('event_type', 'reg_nudge', 'month', year_month, 'count', r.unresolved_count)
          );
          INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
          VALUES (dedup_key, 'reg_nudge', r.employee_id);
        END IF;
      END LOOP;
    END;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- EVENT 15: HOLIDAY OPT-IN WINDOW NOTIFICATIONS
  -- ═══════════════════════════════════════════════════════════════
  DECLARE
    v_window_label     TEXT := NULL;
    v_closes_on        DATE := NULL;
    v_days_until_close INT  := 0;
  BEGIN
    IF EXTRACT(MONTH FROM today) = 1 AND EXTRACT(DAY FROM today) BETWEEN 1 AND 14 THEN
      v_window_label := EXTRACT(YEAR FROM today)::text || '-H1';
      v_closes_on    := (EXTRACT(YEAR FROM today)::text || '-01-14')::date;
    ELSIF EXTRACT(MONTH FROM today) = 7 AND EXTRACT(DAY FROM today) BETWEEN 1 AND 14 THEN
      v_window_label := EXTRACT(YEAR FROM today)::text || '-H2';
      v_closes_on    := (EXTRACT(YEAR FROM today)::text || '-07-14')::date;
    END IF;

    IF v_window_label IS NOT NULL THEN
      v_days_until_close := v_closes_on - today;

      FOR r IN
        SELECT id FROM employees WHERE status = 'active'
      LOOP
        dedup_key := 'lifecycle:holiday_optin_open:' || v_window_label || ':' || r.id::text;
        IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
          INSERT INTO notifications (employee_id, type, title, message, metadata)
          VALUES (
            r.id, 'lifecycle_reminder',
            'Holiday Opt-In Window Open',
            'You can now pick your optional holidays for the year. Submit your picks by ' ||
              to_char(v_closes_on, 'DD Mon YYYY') || ' in Leave Management → Holiday Calendar.',
            jsonb_build_object('event_type', 'holiday_optin_open', 'window', v_window_label, 'closes_on', v_closes_on)
          );
          INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
          VALUES (dedup_key, 'holiday_optin_open', r.id);
        END IF;

        IF v_days_until_close BETWEEN 0 AND 3 THEN
          IF NOT EXISTS (
            SELECT 1 FROM holiday_optin_submissions hos
            WHERE hos.employee_id = r.id AND hos.window_label = v_window_label
          ) THEN
            dedup_key := 'lifecycle:holiday_optin_closing:' || v_window_label || ':' || r.id::text;
            IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
              INSERT INTO notifications (employee_id, type, title, message, metadata)
              VALUES (
                r.id, 'lifecycle_reminder',
                'Holiday Picks Closing Soon',
                'The holiday opt-in window closes ' || to_char(v_closes_on, 'DD Mon YYYY') ||
                  '. Submit your optional-holiday picks before then.',
                jsonb_build_object('event_type', 'holiday_optin_closing', 'window', v_window_label, 'closes_on', v_closes_on)
              );
              INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
              VALUES (dedup_key, 'holiday_optin_closing', r.id);
            END IF;
          END IF;
        END IF;

      END LOOP;
    END IF;
  END;

END;
$$;

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'probation_reviews';
```

- [ ] **Step 2: Run in Supabase SQL Editor**

Open Supabase Dashboard → SQL Editor → paste the entire file → Run.
Expected: no errors; last result shows `probation_reviews` in table_name.

Run in BOTH Production and Test environments.

- [ ] **Step 3: Verify**

```sql
-- Confirm columns added
SELECT column_name FROM information_schema.columns
WHERE table_name = 'employees' AND column_name IN ('probation_end_date', 'probation_extended');

-- Confirm probation type is accepted
SELECT conname, consrc FROM pg_constraint
WHERE conrelid = 'employees'::regclass AND contype = 'c' AND conname LIKE '%employee_type%';

-- Confirm probation_reviews table exists with correct columns
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'probation_reviews' ORDER BY ordinal_position;
```

Expected: 2 rows for employees columns, constraint includes 'probation', 11 columns in probation_reviews.

- [ ] **Step 4: Commit**

```bash
git add supabase_migration_probation.sql
git commit -m "feat: probation schema — table, columns, RLS, lifecycle 30d stage"
```

---

### Task 2: API Module + Onboarding Update

**Files:**
- Create: `src/lib/api.probation.js`
- Modify: `src/lib/api.onboarding.js` (lines 86–134, `approveEmployee` function)

**Interfaces:**
- Consumes: `supabase` from `./supabase`, `createNotification` from `./api.notifications`
- Produces:
  - `getProbationEmployees(): Promise<Employee[]>`
  - `getMyProbationStatus(employeeId: string): Promise<{ employee, review }>`
  - `getPendingReviews(): Promise<Review[]>`
  - `getManagerPendingReviews(managerId: string): Promise<Review[]>`
  - `createProbationReview(employeeId: string): Promise<Review>`
  - `managerSubmitReview(reviewId, { recommendation, notes, extensionDays }, managerId): Promise<Review>`
  - `hrDecideReview(reviewId, { decision, notes, extensionDays }, hrAdminId): Promise<Review>`

- [ ] **Step 1: Create `src/lib/api.probation.js`**

```js
import { supabase } from './supabase'
import { createNotification } from './api.notifications'

export async function getProbationEmployees() {
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name, avatar_initials, department, role, join_date, probation_end_date, probation_extended, manager:manager_id(full_name)')
    .eq('employee_type', 'probation')
    .eq('status', 'active')
    .order('probation_end_date', { ascending: true })
  if (error) throw error
  return data || []
}

export async function getMyProbationStatus(employeeId) {
  const { data: emp, error } = await supabase
    .from('employees')
    .select('id, employee_type, probation_end_date, probation_extended')
    .eq('id', employeeId)
    .single()
  if (error) throw error

  const { data: review } = await supabase
    .from('probation_reviews')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return { employee: emp, review }
}

export async function getPendingReviews() {
  const { data, error } = await supabase
    .from('probation_reviews')
    .select('*, employee:employee_id(id, full_name, avatar_initials, department, role, probation_end_date, probation_extended), manager:manager_id(full_name)')
    .in('status', ['pending_manager', 'pending_hr'])
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function getManagerPendingReviews(managerId) {
  const { data: reports } = await supabase
    .from('employees')
    .select('id')
    .eq('manager_id', managerId)
  const reportIds = (reports || []).map(r => r.id)
  if (reportIds.length === 0) return []

  const { data, error } = await supabase
    .from('probation_reviews')
    .select('*, employee:employee_id(id, full_name, avatar_initials, probation_end_date, probation_extended)')
    .in('employee_id', reportIds)
    .in('status', ['pending_manager', 'pending_hr'])
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function createProbationReview(employeeId) {
  const { data: existing } = await supabase
    .from('probation_reviews')
    .select('id')
    .eq('employee_id', employeeId)
    .in('status', ['pending_manager', 'pending_hr'])
    .maybeSingle()
  if (existing) return existing

  const { data, error } = await supabase
    .from('probation_reviews')
    .insert({ employee_id: employeeId, status: 'pending_manager' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function managerSubmitReview(reviewId, { recommendation, notes, extensionDays }, managerId) {
  if (!['confirm', 'extend', 'relieve'].includes(recommendation))
    throw new Error('Invalid recommendation.')
  if (!notes?.trim()) throw new Error('Notes are required.')
  if (recommendation === 'extend' && (!extensionDays || extensionDays <= 0))
    throw new Error('Extension duration is required when extending.')

  const { data, error } = await supabase
    .from('probation_reviews')
    .update({
      status:                 'pending_hr',
      manager_recommendation: recommendation,
      manager_notes:          notes.trim(),
      extension_days:         recommendation === 'extend' ? Number(extensionDays) : null,
      manager_id:             managerId,
      manager_reviewed_at:    new Date().toISOString(),
    })
    .eq('id', reviewId)
    .eq('status', 'pending_manager')
    .select('*, employee:employee_id(id, full_name)')
    .single()
  if (error) throw error

  try {
    const { data: hrList } = await supabase.rpc('get_hr_admin_employee_ids')
    if (hrList?.length) {
      await supabase.from('notifications').insert(
        hrList.map(hr => ({
          employee_id: hr.id,
          type:        'probation_review_submitted',
          title:       '📋 Probation Review — Awaiting Decision',
          message:     `${data.employee?.full_name}'s probation review has been submitted. Your decision is required.`,
          metadata:    { review_id: reviewId },
          is_read:     false,
        }))
      )
    }
  } catch (e) { console.warn('Probation manager review notification failed:', e.message) }

  return data
}

export async function hrDecideReview(reviewId, { decision, notes, extensionDays }, hrAdminId) {
  if (!['confirmed', 'extended', 'relieved'].includes(decision))
    throw new Error('Invalid decision.')
  if (decision === 'extended' && (!extensionDays || extensionDays <= 0))
    throw new Error('Extension duration is required.')

  const { data: review, error: fetchError } = await supabase
    .from('probation_reviews')
    .select('*, employee:employee_id(id, full_name, probation_end_date)')
    .eq('id', reviewId)
    .single()
  if (fetchError) throw fetchError
  if (review.status !== 'pending_hr') throw new Error('This review is not awaiting HR decision.')

  if (decision === 'confirmed') {
    const { error } = await supabase
      .from('employees').update({ employee_type: 'permanent' }).eq('id', review.employee.id)
    if (error) throw error
  } else if (decision === 'extended') {
    const base = new Date(review.employee.probation_end_date)
    base.setDate(base.getDate() + Number(extensionDays))
    const newEnd = base.toISOString().split('T')[0]
    const { error } = await supabase
      .from('employees')
      .update({ probation_end_date: newEnd, probation_extended: true })
      .eq('id', review.employee.id)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('employees')
      .update({ status: 'inactive', onboarding_status: 'offboarded' })
      .eq('id', review.employee.id)
    if (error) throw error
  }

  const { data, error: updateError } = await supabase
    .from('probation_reviews')
    .update({
      status:           'decided',
      hr_decision:      decision,
      hr_notes:         notes?.trim() || null,
      hr_extension_days: decision === 'extended' ? Number(extensionDays) : null,
      hr_decided_by:    hrAdminId,
      hr_decided_at:    new Date().toISOString(),
    })
    .eq('id', reviewId)
    .select()
    .single()
  if (updateError) throw updateError

  const msgs = {
    confirmed: { title: '🎉 You\'ve Been Confirmed!',  message: 'Congratulations — you\'ve been confirmed as a permanent team member.' },
    extended:  { title: 'Probation Extended',          message: `Your probation has been extended by ${extensionDays} days.` },
    relieved:  { title: 'Probation Period Ended',      message: 'Your probation period has ended. Please check with HR for next steps.' },
  }
  try {
    await createNotification({
      employeeId: review.employee.id,
      type: 'probation_decided',
      ...msgs[decision],
      metadata: { review_id: reviewId },
    })
  } catch (e) { console.warn('Probation decision notification failed:', e.message) }

  return data
}
```

- [ ] **Step 2: Update `approveEmployee` in `src/lib/api.onboarding.js`**

Find this block (lines 86–103):

```js
export async function approveEmployee(employeeId, { role, roleType, employeeType, department, managerId, joinDate, internshipEndDate }) {
  const { data, error } = await supabase
    .from('employees')
    .update({
      status:              'active',
      onboarding_status:   'active',
      role,
      role_type:           roleType,
      employee_type:       employeeType,
      department,
      manager_id:          managerId || null,
      join_date:           joinDate,
      internship_end_date: employeeType === 'intern' ? internshipEndDate : null,
    })
```

Replace with:

```js
export async function approveEmployee(employeeId, { role, roleType, employeeType, department, managerId, joinDate, internshipEndDate }) {
  let probationEndDate = null
  if (employeeType === 'probation' && joinDate) {
    const d = new Date(joinDate)
    d.setMonth(d.getMonth() + 6)
    probationEndDate = d.toISOString().split('T')[0]
  }

  const { data, error } = await supabase
    .from('employees')
    .update({
      status:              'active',
      onboarding_status:   'active',
      role,
      role_type:           roleType,
      employee_type:       employeeType,
      department,
      manager_id:          managerId || null,
      join_date:           joinDate,
      internship_end_date: employeeType === 'intern' ? internshipEndDate : null,
      probation_end_date:  probationEndDate,
    })
```

- [ ] **Step 3: Verify in browser**

Start dev server (`npm run dev`). Open any HR page, check console for import errors.
Expected: no errors in console.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.probation.js src/lib/api.onboarding.js
git commit -m "feat: api.probation.js + set probation_end_date on approval"
```

---

### Task 3: Employee Profile — ProbationStatusCard

**Files:**
- Modify: `src/pages/employee/ProfilePage.jsx`

**Interfaces:**
- Consumes: `getMyProbationStatus(employeeId)` from `../../lib/api.probation`
- Produces: `ProbationStatusCard` component rendered at the top of ProfilePage when `employee_type === 'probation'` or `review.status === 'decided'`

- [ ] **Step 1: Add import**

At the top of `src/pages/employee/ProfilePage.jsx`, after the existing imports, add:

```js
import { getMyProbationStatus } from '../../lib/api.probation'
```

- [ ] **Step 2: Add ProbationStatusCard component**

Insert this component before the `export default function ProfilePage()` line:

```jsx
function ProbationStatusCard({ employeeId }) {
  const [data, setData] = useState(null)

  useEffect(() => {
    getMyProbationStatus(employeeId).then(setData).catch(() => {})
  }, [employeeId])

  if (!data) return null
  const { employee: emp, review } = data

  const isOnProbation = emp?.employee_type === 'probation'
  const isDecided     = review?.status === 'decided'
  if (!isOnProbation && !isDecided) return null

  // Decided outcome card
  if (isDecided) {
    const outcomes = {
      confirmed: { bg: '#e8faf0', border: '#00b89440', icon: '🎉', color: '#00b894', title: 'Confirmed as Permanent', sub: 'You\'ve completed probation and are now a permanent team member.' },
      extended:  { bg: '#fffbeb', border: `${C.amber}40`, icon: '📅', color: C.amber, title: 'Probation Extended', sub: `Extended by ${review.hr_extension_days} days. New end date: ${new Date(emp?.probation_end_date || '').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}.` },
      relieved:  { bg: C.bg,     border: C.border,       icon: '📋', color: C.textMid, title: 'Probation Period Ended', sub: 'Please check with HR for further information.' },
    }
    const o = outcomes[review.hr_decision] || outcomes.relieved
    return (
      <div style={{ background: o.bg, border: `1.5px solid ${o.border}`, borderRadius: 16, padding: '20px 24px', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 28 }}>{o.icon}</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: o.color, fontFamily: FONTS.display }}>{o.title}</div>
            <div style={{ fontSize: 13, color: C.textMid, marginTop: 4 }}>{o.sub}</div>
          </div>
        </div>
      </div>
    )
  }

  // Active probation — compute progress
  const end       = new Date(emp.probation_end_date)
  const start     = new Date(end)
  start.setMonth(start.getMonth() - 6)
  const today     = new Date()
  const totalDays = Math.max(1, Math.round((end - start) / 86400000))
  const elapsed   = Math.max(0, Math.round((today - start) / 86400000))
  const remaining = Math.max(0, Math.round((end - today) / 86400000))
  const pct       = Math.min(100, Math.round((elapsed / totalDays) * 100))
  const isUrgent  = remaining <= 30
  const barColor  = isUrgent ? C.amber : C.brand

  const statusPill = review?.status === 'pending_hr'
    ? { label: 'Under Review', color: C.amber, bg: C.amberSoft }
    : review?.status === 'pending_manager'
    ? { label: 'Review Pending', color: C.brand, bg: C.brandLight }
    : { label: 'Active', color: C.green, bg: C.greenSoft }

  return (
    <div style={{ background: C.surface, border: `1.5px solid ${isUrgent ? C.amber + '60' : C.border}`, borderRadius: 16, padding: '20px 24px', marginBottom: 24, boxShadow: isUrgent ? `0 0 0 3px ${C.amber}18` : C.shadow }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>📋 Probation Period</div>
        <span style={{ fontSize: 11, fontWeight: 700, color: statusPill.color, background: statusPill.bg, padding: '3px 10px', borderRadius: 20 }}>
          {statusPill.label}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 8, background: C.border, borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 8, transition: 'width 0.6s ease' }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.textLight }}>
        <span>{elapsed} days elapsed</span>
        <span style={{ color: isUrgent ? C.amber : C.textLight, fontWeight: isUrgent ? 700 : 400 }}>
          {remaining} days remaining
        </span>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: C.textMid }}>
        Probation ends on{' '}
        <strong style={{ color: isUrgent ? C.amber : C.text }}>
          {end.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
        </strong>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Render the card at the top of ProfilePage**

Inside `ProfilePage`, find the first `return (` statement and add `<ProbationStatusCard employeeId={employee.id} />` as the first child inside the `AppShell`. The existing `<AppShell ...>` wrapper should look like:

```jsx
return (
  <AppShell title="My Profile" ...>
    <ProbationStatusCard employeeId={employee.id} />
    {/* existing content below */}
```

Find the exact opening tag in ProfilePage and insert the card component immediately after it.

- [ ] **Step 4: Verify in browser**

Log in as a probation employee (or temporarily set `employee_type = 'probation'` and `probation_end_date` for a test user in Supabase). Navigate to `/profile`.

Expected:
- Probation card appears above the tab section
- Progress bar shows correct elapsed/remaining
- Status pill shows "Active"
- Card is absent for non-probation employees

- [ ] **Step 5: Commit**

```bash
git add src/pages/employee/ProfilePage.jsx
git commit -m "feat: ProbationStatusCard on employee Profile page"
```

---

### Task 4: Manager Review Panel

**Files:**
- Modify: `src/pages/employee/EmployeeLandingPage.jsx`

**Interfaces:**
- Consumes: `getManagerPendingReviews(managerId)` and `managerSubmitReview(reviewId, opts, managerId)` from `../../lib/api.probation`
- Produces: `ProbationReviewPanel` component rendered when `isManager && probationReviews.length > 0`

- [ ] **Step 1: Add import**

In `src/pages/employee/EmployeeLandingPage.jsx`, add to the existing import block:

```js
import { getManagerPendingReviews, managerSubmitReview } from '../../lib/api.probation'
```

- [ ] **Step 2: Add ProbationReviewPanel component**

Insert this component before `export default function EmployeeLandingPage()`:

```jsx
const REVIEW_CHOICES = [
  {
    value:   'confirm',
    icon:    '✅',
    label:   'Confirm',
    sub:     'Employee joins as a permanent team member',
    color:   '#00b894',
    bg:      '#e8faf0',
    border:  '#00b89450',
  },
  {
    value:   'extend',
    icon:    '📅',
    label:   'Extend',
    sub:     'Review continues for a custom duration',
    color:   C.amber,
    bg:      C.amberSoft,
    border:  C.amber + '50',
  },
  {
    value:   'relieve',
    icon:    '🔴',
    label:   'Relieve',
    sub:     'Offboarding process begins',
    color:   '#ef4444',
    bg:      '#fef2f2',
    border:  '#ef444440',
  },
]

function ProbationReviewPanel({ reviews, managerId, onRefresh }) {
  const [activeReview,    setActiveReview]    = useState(reviews[0]?.id || null)
  const [recommendation,  setRecommendation]  = useState('')
  const [notes,           setNotes]           = useState('')
  const [extensionDays,   setExtensionDays]   = useState('')
  const [saving,          setSaving]          = useState(false)
  const [error,           setError]           = useState('')
  const [successId,       setSuccessId]       = useState(null)

  const review = reviews.find(r => r.id === activeReview) || reviews[0]
  if (!review) return null

  const emp           = review.employee
  const end           = new Date(emp?.probation_end_date)
  const remaining     = Math.max(0, Math.round((end - new Date()) / 86400000))
  const isUrgent      = remaining <= 14
  const alreadyDone   = review.status === 'pending_hr'
  const canExtend     = !emp?.probation_extended

  async function handleSubmit() {
    setError('')
    if (!recommendation) { setError('Please select a recommendation.'); return }
    if (!notes.trim())    { setError('Notes are required.'); return }
    if (recommendation === 'extend' && !extensionDays) { setError('Enter extension duration.'); return }
    setSaving(true)
    try {
      await managerSubmitReview(review.id, { recommendation, notes, extensionDays: Number(extensionDays) }, managerId)
      setSuccessId(review.id)
      onRefresh()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ background: C.surface, borderRadius: 16, border: `1.5px solid ${isUrgent ? C.amber + '60' : C.border}`, padding: '20px 24px', marginBottom: 24, boxShadow: C.shadow }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONTS.display, marginBottom: 4 }}>
        📋 Probation Reviews
      </div>
      <div style={{ fontSize: 12, color: C.textLight, marginBottom: 16 }}>
        {reviews.length} direct report{reviews.length !== 1 ? 's' : ''} awaiting review
      </div>

      {/* Employee selector if multiple */}
      {reviews.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {reviews.map(rv => (
            <button key={rv.id} onClick={() => { setActiveReview(rv.id); setRecommendation(''); setNotes(''); setExtensionDays(''); setError('') }}
              style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: `1.5px solid ${rv.id === activeReview ? C.brand : C.border}`,
                background: rv.id === activeReview ? C.brandLight : C.surface,
                color: rv.id === activeReview ? C.brand : C.textMid,
              }}>
              {rv.employee?.full_name?.split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      {/* Employee info strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: C.bg, borderRadius: 10, marginBottom: 16 }}>
        <Avatar initials={emp?.avatar_initials || '??'} size={36} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{emp?.full_name}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{emp?.department}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: isUrgent ? C.amber : C.textMid }}>{remaining}d remaining</div>
          <div style={{ fontSize: 10, color: C.textLight }}>{end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
        </div>
      </div>

      {/* Already submitted state */}
      {alreadyDone || successId === review.id ? (
        <div style={{ padding: '16px', background: '#e8faf0', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#00b894', marginBottom: 4 }}>✓ Review Submitted</div>
          <div style={{ fontSize: 12, color: C.textMid }}>Awaiting HR decision</div>
        </div>
      ) : (
        <>
          {/* Choice cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 14 }}>
            {REVIEW_CHOICES.map(c => {
              const disabled = c.value === 'extend' && !canExtend
              const selected = recommendation === c.value
              return (
                <button key={c.value} onClick={() => !disabled && setRecommendation(c.value)} style={{
                  padding: '14px 10px', borderRadius: 12, cursor: disabled ? 'not-allowed' : 'pointer',
                  border: `2px solid ${selected ? c.color : disabled ? C.border : C.border}`,
                  background: selected ? c.bg : disabled ? C.bg : C.surface,
                  opacity: disabled ? 0.5 : 1, textAlign: 'center', transition: 'all 0.15s',
                }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{c.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: selected ? c.color : C.text }}>{c.label}</div>
                  <div style={{ fontSize: 10, color: C.textLight, marginTop: 3, lineHeight: 1.4 }}>
                    {disabled ? 'Extension already used' : c.sub}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Extension days input */}
          {recommendation === 'extend' && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: C.textMid, fontWeight: 600 }}>Extension duration (days)</label>
              <input type="number" min="1" value={extensionDays} onChange={e => setExtensionDays(e.target.value)}
                placeholder="e.g. 90"
                style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 12px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none' }} />
            </div>
          )}

          {/* Notes */}
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            placeholder="Add your notes for HR (required)…"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none', resize: 'vertical', marginBottom: 12 }} />

          {error && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 10 }}>{error}</div>}

          <button onClick={handleSubmit} disabled={saving || !recommendation} style={{
            width: '100%', padding: '11px', borderRadius: 10, border: 'none', cursor: saving || !recommendation ? 'not-allowed' : 'pointer',
            background: saving || !recommendation ? C.border : C.brand, color: '#fff',
            fontSize: 13, fontWeight: 700, fontFamily: FONTS.display,
          }}>
            {saving ? 'Submitting…' : 'Submit Review →'}
          </button>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add state and data loading**

In `EmployeeLandingPage`, add `probationReviews` state alongside the other state declarations:

```js
const [probationReviews, setProbationReviews] = useState([])
```

In the `Promise.all` block inside `useEffect`, add to the list of parallel fetches:

```js
safe('getManagerPendingReviews', getManagerPendingReviews(employee.id), []),
```

And in the `.then(([lv, emps, att, ...])` destructuring — add `probReviews` to the end of the destructuring array and call:

```js
setProbationReviews(probReviews)
```

- [ ] **Step 4: Render the panel**

In the JSX return, after the `{/* ── Layer 1: Personal Pulse ── */}` grid and before the smart prompts section, add:

```jsx
{/* Probation reviews (managers only) */}
{probationReviews.length > 0 && (
  <ProbationReviewPanel
    reviews={probationReviews}
    managerId={employee.id}
    onRefresh={() => getManagerPendingReviews(employee.id).then(setProbationReviews)}
  />
)}
```

- [ ] **Step 5: Verify in browser**

Log in as a manager who has a direct report on probation with a `pending_manager` review row. Navigate to the employee dashboard (`/`).

Expected:
- `ProbationReviewPanel` appears below the personal pulse grid
- Three choice cards are rendered; Extend is greyed out if extension already used
- Selecting a choice highlights the card with a coloured border
- Submitting transitions to "Awaiting HR decision" state

- [ ] **Step 6: Commit**

```bash
git add src/pages/employee/EmployeeLandingPage.jsx
git commit -m "feat: ProbationReviewPanel on manager dashboard"
```

---

### Task 5: HR Probation Tab

**Files:**
- Modify: `src/pages/hr/EmployeeManagementPage.jsx`

**Interfaces:**
- Consumes: `getPendingReviews()`, `getProbationEmployees()`, `hrDecideReview(reviewId, opts, hrAdminId)` from `../../lib/api.probation`
- Produces: new `probation` tab on `EmployeeManagementPage` with pending and decided sections; `employee_type` dropdown gains 'probation' option; stats grid gains Probation count

- [ ] **Step 1: Add imports**

At the top of `src/pages/hr/EmployeeManagementPage.jsx`, add to the existing import block:

```js
import { getPendingReviews, getProbationEmployees, hrDecideReview } from '../../lib/api.probation'
```

- [ ] **Step 2: Add probation state**

Inside the `EmployeeManagementPage` function, alongside existing state, add:

```js
const [probationPending,  setProbationPending]  = useState([])
const [probationDecided,  setProbationDecided]  = useState([])
const [decidingId,        setDecidingId]        = useState(null)
const [decisionForm,      setDecisionForm]      = useState({ decision: '', notes: '', extensionDays: '' })
const [decisionError,     setDecisionError]     = useState('')
const [decisionSaving,    setDecisionSaving]    = useState(false)
const [decisionSuccess,   setDecisionSuccess]   = useState('')
```

- [ ] **Step 3: Load probation data**

In the `load` function (where `getAllEmployeesForHR()`, `getPendingRegistrations()`, `getPendingHRTransferRequests()` are called), add probation fetches. Replace the existing `Promise.all` call:

```js
const [emps, pend, transfers, probPending, probEmployees] = await Promise.all([
  getAllEmployeesForHR(),
  getPendingRegistrations(),
  getPendingHRTransferRequests(),
  getPendingReviews(),
  getProbationEmployees(),
])
setEmployees(emps)
setPending(pend)
setTransferRequests(transfers)
setProbationPending(probPending)
// Decided = probation employees with a decided review (fetch from probPending is only pending;
// for history, query separately)
```

After the Promise.all, also fetch decided reviews:

```js
const { data: decided } = await supabase
  .from('probation_reviews')
  .select('*, employee:employee_id(id, full_name, avatar_initials, department)')
  .eq('status', 'decided')
  .order('hr_decided_at', { ascending: false })
  .limit(50)
setProbationDecided(decided || [])
```

Note: `supabase` is already imported in this file.

- [ ] **Step 4: Add tab to tab bar**

Find the tab bar array (line ~754):

```js
[{ id: 'employees', label: 'Employees' }, { id: 'transfers', label: `🔁 Transfer Requests${...}` }].map(...)
```

Replace with:

```js
[
  { id: 'employees',  label: 'Employees' },
  { id: 'transfers',  label: `🔁 Transfer Requests${transferRequests.length ? ` (${transferRequests.length})` : ''}` },
  { id: 'probation',  label: `📋 Probation${probationPending.length ? ` (${probationPending.length})` : ''}` },
].map(t => (
```

- [ ] **Step 5: Add HR decision handler**

Add this function inside the component:

```js
async function handleProbationDecision(reviewId, employeeExtended) {
  setDecisionError('')
  const { decision, notes, extensionDays } = decisionForm
  if (!decision) { setDecisionError('Select a decision.'); return }
  if (decision === 'extended' && !extensionDays) { setDecisionError('Enter extension duration.'); return }
  setDecisionSaving(true)
  try {
    await hrDecideReview(reviewId, { decision, notes, extensionDays: Number(extensionDays) }, employee.id)
    const successMsgs = {
      confirmed: '🎉 Confirmed as permanent team member',
      extended:  `Extended by ${extensionDays} days`,
      relieved:  'Offboarding initiated',
    }
    setDecisionSuccess(successMsgs[decision])
    setDecidingId(null)
    setDecisionForm({ decision: '', notes: '', extensionDays: '' })
    // Reload
    const [pending, probEmps] = await Promise.all([getPendingReviews(), getProbationEmployees()])
    setProbationPending(pending)
    const { data: decided } = await supabase.from('probation_reviews').select('*, employee:employee_id(id, full_name, avatar_initials, department)').eq('status', 'decided').order('hr_decided_at', { ascending: false }).limit(50)
    setProbationDecided(decided || [])
    setTimeout(() => setDecisionSuccess(''), 4000)
  } catch (e) { setDecisionError(e.message) }
  finally { setDecisionSaving(false) }
}
```

- [ ] **Step 6: Add Probation tab content**

After the `{tab === 'transfers' && (...)}` block, add:

```jsx
{tab === 'probation' && (
  <div>
    {decisionSuccess && (
      <div style={{ padding: '12px 16px', background: '#e8faf0', borderRadius: 10, border: '1.5px solid #00b89440', marginBottom: 16, fontSize: 13, fontWeight: 600, color: '#00b894' }}>
        {decisionSuccess}
      </div>
    )}

    {/* Pending section */}
    <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONTS.display, marginBottom: 14 }}>
      Pending Reviews ({probationPending.length})
    </div>

    {probationPending.length === 0 ? (
      <EmptyState icon="📋" title="No pending probation reviews" subtitle="Reviews will appear here 30 days before an employee's probation end date." />
    ) : (
      probationPending.map(review => {
        const emp       = review.employee
        const end       = new Date(emp?.probation_end_date)
        const remaining = Math.max(0, Math.round((end - new Date()) / 86400000))
        const total     = 180
        const elapsed   = Math.max(0, total - remaining)
        const pct       = Math.min(100, Math.round((elapsed / total) * 100))
        const isUrgent  = remaining <= 14
        const ringColor = isUrgent ? C.amber : C.brand
        const r2        = 20
        const circ      = 2 * Math.PI * r2
        const dash      = circ * (1 - pct / 100)
        const managerBadges = {
          confirm: { label: 'Manager: Confirm ✓', color: '#00b894', bg: '#e8faf0' },
          extend:  { label: 'Manager: Extend',    color: C.amber,   bg: C.amberSoft },
          relieve: { label: 'Manager: Relieve',   color: '#ef4444', bg: '#fef2f2' },
        }
        const mBadge = review.manager_recommendation ? managerBadges[review.manager_recommendation] : null
        const isDeciding = decidingId === review.id

        return (
          <div key={review.id} style={{ background: C.surface, border: `1.5px solid ${isUrgent ? C.amber + '50' : C.border}`, borderRadius: 14, padding: '16px 20px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {/* Countdown ring */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <svg width={52} height={52}>
                  <circle cx={26} cy={26} r={r2} fill="none" stroke={C.border} strokeWidth={4} />
                  <circle cx={26} cy={26} r={r2} fill="none" stroke={ringColor} strokeWidth={4}
                    strokeDasharray={circ} strokeDashoffset={dash}
                    strokeLinecap="round" transform="rotate(-90 26 26)" />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: ringColor, lineHeight: 1 }}>{remaining}</span>
                  <span style={{ fontSize: 8, color: C.textLight }}>days</span>
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Avatar initials={emp?.avatar_initials || '??'} size={28} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{emp?.full_name}</span>
                  <span style={{ fontSize: 11, color: C.textLight }}>{emp?.department}</span>
                </div>
                <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>
                  Probation ends {end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {emp?.probation_extended && <span style={{ marginLeft: 8, color: C.amber, fontWeight: 600 }}>⚠ Extension already used</span>}
                </div>
                {mBadge && (
                  <span style={{ display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 600, color: mBadge.color, background: mBadge.bg, padding: '2px 10px', borderRadius: 20 }}>
                    {mBadge.label}
                  </span>
                )}
                {review.status === 'pending_manager' && (
                  <span style={{ display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 600, color: C.textLight, background: C.bg, padding: '2px 10px', borderRadius: 20 }}>
                    Awaiting manager review
                  </span>
                )}
              </div>

              {review.status === 'pending_hr' && (
                <button onClick={() => { setDecidingId(isDeciding ? null : review.id); setDecisionForm({ decision: '', notes: '', extensionDays: '' }); setDecisionError('') }}
                  style={{ padding: '7px 14px', borderRadius: 10, border: `1.5px solid ${C.brand}`, background: isDeciding ? C.brandLight : C.surface, color: C.brand, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {isDeciding ? 'Cancel' : 'Decide →'}
                </button>
              )}
            </div>

            {/* Decision panel */}
            {isDeciding && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
                {review.manager_notes && (
                  <div style={{ marginBottom: 12, padding: '10px 14px', background: C.bg, borderRadius: 10, fontSize: 12 }}>
                    <div style={{ fontWeight: 700, color: C.textMid, marginBottom: 4 }}>Manager's notes:</div>
                    <div style={{ color: C.textMid, lineHeight: 1.6 }}>{review.manager_notes}</div>
                  </div>
                )}

                {/* HR decision buttons */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
                  {[
                    { value: 'confirmed', icon: '✅', label: 'Confirm',  color: '#00b894', bg: '#e8faf0' },
                    { value: 'extended',  icon: '📅', label: 'Extend',   color: C.amber,   bg: C.amberSoft, warn: emp?.probation_extended },
                    { value: 'relieved',  icon: '🔴', label: 'Relieve',  color: '#ef4444', bg: '#fef2f2' },
                  ].map(c => (
                    <button key={c.value} onClick={() => setDecisionForm(f => ({ ...f, decision: c.value }))} style={{
                      padding: '10px 8px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                      border: `2px solid ${decisionForm.decision === c.value ? c.color : C.border}`,
                      background: decisionForm.decision === c.value ? c.bg : C.surface,
                    }}>
                      <div style={{ fontSize: 18, marginBottom: 4 }}>{c.icon}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: decisionForm.decision === c.value ? c.color : C.text }}>{c.label}</div>
                      {c.warn && <div style={{ fontSize: 9, color: C.amber, marginTop: 2 }}>⚠ 2nd extension</div>}
                    </button>
                  ))}
                </div>

                {decisionForm.decision === 'extended' && (
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 12, color: C.textMid, fontWeight: 600 }}>Extension duration (days)</label>
                    <input type="number" min="1" value={decisionForm.extensionDays}
                      onChange={e => setDecisionForm(f => ({ ...f, extensionDays: e.target.value }))}
                      placeholder="e.g. 90"
                      style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 12px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none' }} />
                  </div>
                )}

                <textarea value={decisionForm.notes} onChange={e => setDecisionForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                  placeholder="HR notes (optional)…"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 12, fontFamily: FONTS.body, outline: 'none', resize: 'vertical', marginBottom: 10 }} />

                {decisionError && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{decisionError}</div>}

                <button onClick={() => handleProbationDecision(review.id, emp?.probation_extended)} disabled={decisionSaving}
                  style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: decisionSaving ? C.border : C.brand, color: '#fff', fontSize: 13, fontWeight: 700, cursor: decisionSaving ? 'not-allowed' : 'pointer', fontFamily: FONTS.display }}>
                  {decisionSaving ? 'Saving…' : 'Confirm Decision →'}
                </button>
              </div>
            )}
          </div>
        )
      })
    )}

    {/* Decided section */}
    {probationDecided.length > 0 && (
      <div style={{ marginTop: 28 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONTS.display, marginBottom: 14 }}>
          Decision History ({probationDecided.length})
        </div>
        {probationDecided.map(review => {
          const badges = {
            confirmed: { label: 'Confirmed',  color: '#00b894', bg: '#e8faf0' },
            extended:  { label: 'Extended',   color: C.amber,   bg: C.amberSoft },
            relieved:  { label: 'Relieved',   color: '#ef4444', bg: '#fef2f2' },
          }
          const b = badges[review.hr_decision] || { label: review.hr_decision, color: C.textMid, bg: C.bg }
          return (
            <div key={review.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: C.surface, borderRadius: 10, border: `1px solid ${C.border}`, marginBottom: 8 }}>
              <Avatar initials={review.employee?.avatar_initials || '??'} size={28} />
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{review.employee?.full_name}</span>
                <span style={{ fontSize: 11, color: C.textLight, marginLeft: 8 }}>{review.employee?.department}</span>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: b.color, background: b.bg, padding: '3px 10px', borderRadius: 20 }}>{b.label}</span>
              <span style={{ fontSize: 11, color: C.textLight }}>{review.hr_decided_at ? new Date(review.hr_decided_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</span>
            </div>
          )
        })}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 7: Add 'On Probation' to the employee type stats grid**

Find the stats grid in the `employees` tab section (lines ~769–774):

```js
{ label: 'Permanent',   val: employees.filter(e => e.employee_type === 'permanent'   && e.status === 'active').length, ... },
{ label: 'Interns',     val: employees.filter(e => e.employee_type === 'intern'       && e.status === 'active').length, ... },
{ label: 'Contractors', val: employees.filter(e => e.employee_type === 'contractor'   && e.status === 'active').length, ... },
```

Add after the Contractors entry:

```js
{ label: 'On Probation', val: employees.filter(e => e.employee_type === 'probation' && e.status === 'active').length, color: C.amber, bg: C.amberSoft },
```

- [ ] **Step 8: Add 'Probation' to the employee type filter and form dropdowns**

Search for `'parttime'` in `EmployeeManagementPage.jsx` — there will be at least one `<select>` or array that lists employee types. Add `{ value: 'probation', label: 'Probation' }` (or `'probation'` as a string option) to every such list.

Find the type filter dropdown and the add/edit employee form's employee type selector. In each, add:

```jsx
<option value="probation">Probation</option>
```

- [ ] **Step 9: Verify in browser**

Log in as HR. Navigate to `/hr/employees`.

Expected:
- "📋 Probation" tab appears in the tab bar
- Stats grid shows "On Probation" count
- Pending section shows employees with active `probation_reviews` rows
- Countdown ring updates based on days remaining
- "Decide →" button appears only for `pending_hr` reviews
- Decision panel shows manager notes, three choice cards, extension input if extended, notes textarea
- After deciding, success toast appears and card disappears from pending
- History section shows decided reviews with outcome badges

- [ ] **Step 10: Commit**

```bash
git add src/pages/hr/EmployeeManagementPage.jsx
git commit -m "feat: HR Probation tab with countdown rings, decision flow, history"
```
