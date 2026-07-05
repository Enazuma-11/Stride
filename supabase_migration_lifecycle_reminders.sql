-- ============================================================
-- STRIDE — LIFECYCLE REMINDERS ENGINE
-- Run in: Supabase Dashboard → SQL Editor (both Production and Test)
-- ============================================================

-- ─── DEDUP LOG ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lifecycle_reminder_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         TEXT NOT NULL UNIQUE,
  event_type  TEXT NOT NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  fired_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_reminder_log_key      ON lifecycle_reminder_log(key);
CREATE INDEX IF NOT EXISTS idx_lifecycle_reminder_log_fired_at ON lifecycle_reminder_log(fired_at);

ALTER TABLE lifecycle_reminder_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lifecycle_log_hr_read" ON lifecycle_reminder_log
  FOR SELECT USING (current_employee_role() IN ('hr', 'admin'));

-- ─── MAIN FUNCTION ────────────────────────────────────────────
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
    -- Birthday person
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

    -- Team-wide
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
  -- EVENT 5: PROBATION ENDING / CONFIRMATION DUE — 14d and 3d before
  -- Recipients: HR/Admin + employee's manager
  -- ═══════════════════════════════════════════════════════════════
  FOR r IN
    SELECT id, full_name, probation_end_date, manager_id
    FROM employees
    WHERE status = 'active'
      AND probation_end_date IS NOT NULL
      AND probation_end_date IN (today + 14, today + 3)
  LOOP
    DECLARE
      stage     TEXT := CASE WHEN r.probation_end_date = today + 14 THEN '14d' ELSE '3d' END;
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
  -- (employee_documents has no expiry_date; employee_certifications does)
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

-- (continued in later tasks)
END;
$$;
