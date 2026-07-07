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
