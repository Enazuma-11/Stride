-- ============================================================
-- STRIDE — WEEKLY ATTENDANCE REPORT NOTIFICATIONS
-- Run in: Supabase Dashboard → SQL Editor (both Production and Test)
-- ============================================================
-- Creates run_weekly_attendance_report(p_as_of DATE DEFAULT NULL)
-- Cron: Friday 6:30 PM IST = 0 13 * * 5 UTC
-- HR/Admin → team-review reminder; all others → personal-hours nudge
-- Reuses lifecycle_reminder notification type + lifecycle_reminder_log dedup.
-- p_as_of: pass a DATE to simulate a Friday during manual testing;
--          NULL (default) uses today's IST date.
-- ============================================================

CREATE OR REPLACE FUNCTION run_weekly_attendance_report(p_as_of DATE DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  today     DATE := COALESCE(p_as_of, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  iso_week  TEXT;
  r         RECORD;
  dedup_key TEXT;
BEGIN
  -- Day guard: no-op if not Friday (DOW = 5). Redundant with the Friday cron,
  -- included so manual SELECT run_weekly_attendance_report() on a weekday is a safe no-op.
  IF EXTRACT(DOW FROM today) <> 5 THEN
    RETURN;
  END IF;

  iso_week := to_char(today, 'IYYY-IW');

  -- ─── A. HR/Admin → team-review reminder ──────────────────────────────
  FOR r IN
    SELECT id FROM employees
    WHERE status = 'active' AND role_type IN ('hr', 'admin')
  LOOP
    dedup_key := 'lifecycle:weekly_report:' || iso_week || ':' || r.id::text;
    IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
      INSERT INTO notifications (employee_id, type, title, message, metadata)
      VALUES (
        r.id, 'lifecycle_reminder',
        'Weekly Attendance Report Ready',
        'This week''s team attendance summary is ready. Review it in Attendance → Weekly.',
        jsonb_build_object('event_type', 'weekly_report_team', 'iso_week', iso_week)
      );
      INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
      VALUES (dedup_key, 'weekly_report_team', r.id);
    END IF;
  END LOOP;

  -- ─── B. All other active employees → personal-hours nudge ────────────
  FOR r IN
    SELECT id FROM employees
    WHERE status = 'active' AND role_type NOT IN ('hr', 'admin')
  LOOP
    dedup_key := 'lifecycle:weekly_report:' || iso_week || ':' || r.id::text;
    IF NOT EXISTS (SELECT 1 FROM lifecycle_reminder_log WHERE key = dedup_key) THEN
      INSERT INTO notifications (employee_id, type, title, message, metadata)
      VALUES (
        r.id, 'lifecycle_reminder',
        'Your Weekly Hours Are Ready',
        'Your attendance summary for this week is ready to review on your Attendance page.',
        jsonb_build_object('event_type', 'weekly_report_personal', 'iso_week', iso_week)
      );
      INSERT INTO lifecycle_reminder_log (key, event_type, employee_id)
      VALUES (dedup_key, 'weekly_report_personal', r.id);
    END IF;
  END LOOP;

END;
$$;

-- ─── VERIFY FUNCTION EXISTS ───────────────────────────────────────────
SELECT routine_name
FROM information_schema.routines
WHERE routine_name = 'run_weekly_attendance_report'
  AND routine_schema = 'public';

-- ============================================================
-- ONE-TIME SETUP: SCHEDULE THE FRIDAY JOB
-- Run this block SEPARATELY after the migration above.
-- Run in BOTH Production and Test Supabase SQL editors.
-- ============================================================

/*
-- pg_cron is already enabled from the lifecycle_reminders migration.
-- If not: CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule: Friday 6:30 PM IST = 13:00 UTC on Fridays
SELECT cron.schedule(
  'weekly_attendance_report_friday',
  '0 13 * * 5',
  'SELECT run_weekly_attendance_report();'
);

-- Verify the job registered
SELECT jobid, jobname, schedule, command, active
FROM cron.job
WHERE jobname = 'weekly_attendance_report_friday';

-- ── Verification queries ─────────────────────────────────────────────

-- Test with a known Friday (2026-07-10 is a Friday, ISO week 2026-W28):
SELECT run_weekly_attendance_report('2026-07-10');

-- Confirm HR/Admin got team variant, others got personal variant:
SELECT n.employee_id, e.full_name, e.role_type, n.title, n.metadata->>'event_type' AS event_type
FROM notifications n
JOIN employees e ON e.id = n.employee_id
WHERE n.type = 'lifecycle_reminder'
  AND n.metadata->>'iso_week' = '2026-28'
ORDER BY e.role_type, e.full_name;

-- Re-run with same Friday — must produce no new rows (dedup):
SELECT run_weekly_attendance_report('2026-07-10');
SELECT COUNT(*) FROM lifecycle_reminder_log
WHERE event_type IN ('weekly_report_team', 'weekly_report_personal');
-- Count must not change.

-- Test day guard: Thursday 2026-07-09 must fire nothing:
SELECT run_weekly_attendance_report('2026-07-09');
SELECT COUNT(*) FROM notifications
WHERE type = 'lifecycle_reminder'
  AND metadata->>'event_type' IN ('weekly_report_team', 'weekly_report_personal')
  AND created_at > NOW() - INTERVAL '1 minute';
-- Expected: 0 rows.

-- Disable the job (keeps the function and log):
SELECT cron.unschedule('weekly_attendance_report_friday');

-- Re-enable:
SELECT cron.schedule('weekly_attendance_report_friday', '0 13 * * 5', 'SELECT run_weekly_attendance_report();');

-- Full rollback:
SELECT cron.unschedule('weekly_attendance_report_friday');
DROP FUNCTION IF EXISTS run_weekly_attendance_report(DATE);
*/
