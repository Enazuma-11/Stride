# Lifecycle Notifications Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port two retired `runDailyChecks` behaviors into the SQL lifecycle engine — holiday opt-in window notifications (Event 15 in the daily 9 AM IST job) and weekly attendance report notifications (new Friday 6:30 PM IST cron).

**Architecture:** Two migration files. Event 15 is appended to the existing `run_lifecycle_reminders()` function by editing `supabase_migration_lifecycle_reminders.sql` (the function uses `CREATE OR REPLACE`, so re-running the full file is safe). The weekly report becomes a new standalone function `run_weekly_attendance_report()` in a new migration file with its own Friday pg_cron job. No JavaScript changes — both notification types surface through the existing `NotificationBell` component via `type = 'lifecycle_reminder'`.

**Tech Stack:** PostgreSQL PL/pgSQL, Supabase SQL Editor, pg_cron (already enabled in both Production and Test)

## Global Constraints

- All date logic in IST: `(now() AT TIME ZONE 'Asia/Kolkata')::date`
- Both functions use `SECURITY DEFINER SET search_path = public, pg_temp`
- Notification type is `'lifecycle_reminder'` — reuses the type already rendered by `NotificationBell`
- Every notification is guarded by a `lifecycle_reminder_log.key` existence check; same key = skip insert (dedup)
- H1 opt-in window: Jan 1–14 IST, label `<year>-H1`, closes on `<year>-01-14`
- H2 opt-in window: Jul 1–14 IST, label `<year>-H2`, closes on `<year>-07-14`
- "Closing-soon" = last 4 days = `days_until_close BETWEEN 0 AND 3`
- Weekly report cron: Friday 6:30 PM IST = `0 13 * * 5` UTC
- HR/Admin identified as: `role_type IN ('hr', 'admin') AND status = 'active'`
- Weekly dedup key format: `lifecycle:weekly_report:<IYYY-IW>:<employee_id>`
- No JavaScript changes; no new tables; no new notification types
- Both migrations must run cleanly in both Production and Test Supabase projects

---

### Task 1: Event 15 — Holiday Opt-In Window Notifications

**Files:**
- Modify: `supabase_migration_lifecycle_reminders.sql` — add Event 15 sub-block before the function's closing `END;`

**Interfaces:**
- Consumes: `employees` (id, status), `holiday_optin_submissions` (employee_id, window_label), `lifecycle_reminder_log` (key), `notifications` (employee_id, type, title, message, metadata)
- Produces: notifications with `metadata->>'event_type'` of `holiday_optin_open` or `holiday_optin_closing`, plus matching `lifecycle_reminder_log` rows

- [ ] **Step 1: Add Event 15 to supabase_migration_lifecycle_reminders.sql**

Open `supabase_migration_lifecycle_reminders.sql`. The function body ends with:

```
  END IF;  -- closing line of Event 14 outer IF (EXTRACT(DAY FROM today) >= 25)

END;       -- function close
$$;
```

Insert the following block **immediately before** the function's closing `END;` (right after Event 14's closing `END IF;`):

```sql
  -- ═══════════════════════════════════════════════════════════════
  -- EVENT 15: HOLIDAY OPT-IN WINDOW NOTIFICATIONS
  -- A. Window-open broadcast — once per employee per window (self-heals if first day missed)
  -- B. Closing-soon reminder — only to non-submitters, last 4 days, once per person
  -- Dormant on all days outside Jan 1–14 and Jul 1–14.
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
        -- A. Window-open broadcast — once per employee per window
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

        -- B. Closing-soon — only to non-submitters, only in last 4 days
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
```

After the insertion the end of the file should read:

```sql
  END IF;  -- Event 14 close

  -- ═══ EVENT 15 ═══
  DECLARE
    v_window_label     TEXT := NULL;
    ...
  BEGIN
    ...
  END;

END;   ← function close (the very last END before $$;)
$$;
```

- [ ] **Step 2: Run the migration in Production**

Copy the entire updated `supabase_migration_lifecycle_reminders.sql` and paste it into the **Production** Supabase SQL Editor → Run.

Expected output: a row `routine_name: run_lifecycle_reminders` from the final SELECT. No errors.

- [ ] **Step 3: Run the migration in Test**

Paste and run the same script in the **Test** Supabase SQL Editor.

Expected: same `routine_name` row. No errors.

- [ ] **Step 4: Verify Event 15 fires — H2 window is open now (Jul 1–14)**

Today's date is in the H2 window. Run in Production SQL Editor:

```sql
-- Trigger a fresh run (safe — dedup prevents double-firing existing events)
SELECT run_lifecycle_reminders();

-- Confirm window-open notifications were created
SELECT n.employee_id, n.title, n.metadata->>'event_type' AS event_type, n.created_at
FROM notifications n
WHERE n.type = 'lifecycle_reminder'
  AND n.metadata->>'event_type' = 'holiday_optin_open'
ORDER BY n.created_at DESC
LIMIT 20;
```

Expected: one row per active employee, `title = 'Holiday Opt-In Window Open'`, `event_type = 'holiday_optin_open'`.

- [ ] **Step 5: Verify dedup — re-run produces no new rows**

```sql
SELECT COUNT(*) AS before_count
FROM notifications
WHERE type = 'lifecycle_reminder' AND metadata->>'event_type' = 'holiday_optin_open';

SELECT run_lifecycle_reminders();

SELECT COUNT(*) AS after_count
FROM notifications
WHERE type = 'lifecycle_reminder' AND metadata->>'event_type' = 'holiday_optin_open';
```

Expected: `before_count = after_count`.

- [ ] **Step 6: Verify closing-soon is NOT firing yet**

Today is Jul 6; the H2 window closes Jul 14, so `v_days_until_close = 8` — outside the `BETWEEN 0 AND 3` guard. Confirm:

```sql
SELECT COUNT(*) FROM notifications
WHERE type = 'lifecycle_reminder' AND metadata->>'event_type' = 'holiday_optin_closing';
```

Expected: 0 rows.

- [ ] **Step 7: Commit**

```bash
git add supabase_migration_lifecycle_reminders.sql
git commit -m "feat: add Event 15 — holiday opt-in window notifications to lifecycle engine"
```

---

### Task 2: Weekly Attendance Report Function

**Files:**
- Create: `supabase_migration_weekly_attendance_report.sql` (at repo root, alongside all other migration files)

**Interfaces:**
- Consumes: `employees` (id, status, role_type), `lifecycle_reminder_log` (key), `notifications` (employee_id, type, title, message, metadata)
- Produces: function `run_weekly_attendance_report(p_as_of DATE DEFAULT NULL)`, pg_cron job `weekly_attendance_report_friday` (registered once via manual SQL), notifications with `event_type` `weekly_report_team` (HR/Admin) or `weekly_report_personal` (everyone else)

- [ ] **Step 1: Create supabase_migration_weekly_attendance_report.sql**

Create the file at the repo root. Full content:

```sql
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
```

- [ ] **Step 2: Run the migration in Production**

Paste the file content (everything except the `/* ... */` comment block) into the **Production** Supabase SQL Editor → Run.

Expected: `routine_name: run_weekly_attendance_report` returned. No errors.

- [ ] **Step 3: Run the migration in Test**

Paste and run the same content in the **Test** Supabase SQL Editor.

Expected: same result.

- [ ] **Step 4: Test the function with a Friday date**

Run in Production SQL Editor:

```sql
-- 2026-07-10 is a Friday (ISO week 2026-W28)
SELECT run_weekly_attendance_report('2026-07-10');

-- Confirm one notification per employee, correct variant per role
SELECT n.employee_id, e.full_name, e.role_type, n.title, n.metadata->>'event_type' AS event_type
FROM notifications n
JOIN employees e ON e.id = n.employee_id
WHERE n.type = 'lifecycle_reminder'
  AND n.metadata->>'iso_week' = '2026-28'
ORDER BY e.role_type, e.full_name;
```

Expected: HR/Admin employees → `title = 'Weekly Attendance Report Ready'`, `event_type = weekly_report_team`. All other employees → `title = 'Your Weekly Hours Are Ready'`, `event_type = weekly_report_personal`. Each employee appears exactly once.

- [ ] **Step 5: Verify day guard rejects a non-Friday**

```sql
-- Thursday 2026-07-09 — function must return early, insert nothing
SELECT run_weekly_attendance_report('2026-07-09');

SELECT COUNT(*) FROM notifications
WHERE type = 'lifecycle_reminder'
  AND metadata->>'event_type' IN ('weekly_report_team', 'weekly_report_personal')
  AND created_at > NOW() - INTERVAL '1 minute';
```

Expected: 0 rows.

- [ ] **Step 6: Verify dedup — re-run with same Friday produces no new rows**

```sql
SELECT COUNT(*) AS before_rerun FROM lifecycle_reminder_log
WHERE event_type IN ('weekly_report_team', 'weekly_report_personal');

SELECT run_weekly_attendance_report('2026-07-10');

SELECT COUNT(*) AS after_rerun FROM lifecycle_reminder_log
WHERE event_type IN ('weekly_report_team', 'weekly_report_personal');
```

Expected: `before_rerun = after_rerun`.

- [ ] **Step 7: Register the Friday cron in Production**

Copy just the cron schedule commands from the `/* ... */` block and run them in the **Production** SQL Editor:

```sql
SELECT cron.schedule(
  'weekly_attendance_report_friday',
  '0 13 * * 5',
  'SELECT run_weekly_attendance_report();'
);

SELECT jobid, jobname, schedule, command, active
FROM cron.job
WHERE jobname = 'weekly_attendance_report_friday';
```

Expected: row returned with `schedule = '0 13 * * 5'` and `active = true`.

- [ ] **Step 8: Register the Friday cron in Test**

Run the same two SQL statements in the **Test** SQL Editor.

Expected: same result.

- [ ] **Step 9: Commit**

```bash
git add supabase_migration_weekly_attendance_report.sql
git commit -m "feat: add run_weekly_attendance_report — Friday 6:30 PM IST cron"
```
