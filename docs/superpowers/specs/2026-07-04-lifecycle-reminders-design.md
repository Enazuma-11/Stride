# Lifecycle Reminders — Intelligent Event Engine

**Date:** 2026-07-04  
**Scope:** Automated, reliable, escalating reminders for employment transitions, compliance expiry, people milestones, and operational aging — powered by a daily scheduled SQL job.

---

## 1. Purpose & Impact

### Problem
Today, reminders for important lifecycle events (probation ending, documents expiring, leave returning, aged approvals) only fire **when an HR/Admin happens to open a page**. If nobody logs in on someone's internship-end date or over a weekend, the reminder never fires. This leaves gaps where things are forgotten until it's late — and the current page-load triggers also cause N+1 queries and slow HR's dashboard.

### Solution
A **single, reliable daily job** (SQL function on Supabase's pg_cron scheduler) that runs at a fixed time every morning, independent of who's logged in. It scans for upcoming lifecycle events across 12 event types, fires escalating reminders (multi-stage for deadlines), and consolidates all existing page-triggered reminders (birthdays, holidays, regularization nudges) into one trustworthy system.

### Success Criteria
- ✅ Every lifecycle event fires on time, every day, no dependency on user login
- ✅ Escalating reminders: deadline-type events fire at 14 days → 3 days → on-the-day, each stage exactly once (no daily spam)
- ✅ Consolidates 3 existing reminders (birthdays, holidays, regularization) into the reliable job, fixing their fragility
- ✅ Each recipient sees exactly what they need to act on (no cross-role noise)
- ✅ Timezone-correct: dates judged against India's calendar, not UTC
- ✅ Setup is one-time on Supabase (1 migration, 1 enable command), just like existing migrations

---

## 2. Event Catalog

Every event the engine watches, when it fires, and who gets notified.

| # | Event | Timing | Recipients | Escalation | Current Status |
|---|---|---|---|---|---|
| **1** | Birthday | On the day | All active employees (team-wide 🎉) | No (single fire) | Exists, page-triggered → moving to job |
| **2** | Work anniversary | On the day (1+ years) | All active employees (team-wide 🎉) | No (single fire) | New |
| **3** | New joiner | On join date | All active employees (team-wide 👋) | No (single fire) | New |
| **4** | Internship ending | 14d before → 3d before | HR/Admin + employee's manager | Yes, 2 stages | New |
| **5** | Probation ending / Confirmation due | 14d before → 3d before | HR/Admin + employee's manager | Yes, 2 stages | New |
| **6** | Passport expiry | 30d → 7d → 0d | Employee + HR/Admin | Yes, 3 stages | New |
| **7** | Visa expiry | 30d → 7d → 0d | Employee + HR/Admin | Yes, 3 stages | New |
| **8** | Uploaded document expiry | 30d → 7d → 0d | Employee + HR/Admin | Yes, 3 stages | New |
| **9** | Leave ending (back to work) | 1d before return | The employee | No (single fire) | New |
| **10** | Aging approval (leave) | 3d waiting → 7d waiting | Whoever's sitting on it (manager or HR, per stage) | Yes, 2 stages | New |
| **11** | Aging approval (regularization) | 3d waiting → 7d waiting | Whoever's sitting on it (manager or HR, per stage) | Yes, 2 stages | New (consolidates existing nudge) |
| **12** | Aging approval (transfer) | 3d waiting → 7d waiting | Whoever's sitting on it (target mgr → HR, per stage) | Yes, 2 stages | New |
| **13** | Holiday reminder | Configurable (Supabase function sets it) | All active employees | No (single fire) | Exists, page-triggered → moving to job |
| **14** | Monthly regularization reminder | 1st of month, 9 AM IST | Active employees with pending regularization | No (single fire) | Exists, page-triggered → moving to job |

**Notes:**
- "Aging approval" reminders respect the stage of the approval: e.g., a transfer waiting on the **target manager** nudges the target; once **HR** gets it, the reminder nudges HR instead.
- All times are IST (Asia/Kolkata) — "on the day" means `(now() AT TIME ZONE 'Asia/Kolkata')::date`.
- "Escalation" means the event fires multiple times as the deadline approaches, with each stage firing exactly once (never repeating daily).

---

## 3. Architecture

### The Job: `run_lifecycle_reminders()`

A single **SECURITY DEFINER** SQL function, scheduled to run once daily at a fixed time (9 AM IST default, configurable).

**What it does:**
1. Computes "today" as IST date (not UTC): `(now() AT TIME ZONE 'Asia/Kolkata')::date`
2. Scans all relevant tables (`employees`, `leave_requests`, `attendance_regularization`, `manager_transfer_requests`, `employee_compliance`, `employee_documents`)
3. For each event within its firing window (e.g., "today is exactly 14 days before probation ends", or "today is the leave-return date"), checks for a **dedup key**
4. If no notification with that key exists, inserts one row into the existing `notifications` table
5. Uses **deterministic dedup keys** so missed runs self-heal: if the job doesn't run on Monday, it catches up on Tuesday (as long as the event is still in range)

### Dedup Keys (Why They Matter)

Each notification carries a deterministic key like:
- `lifecycle:birthday:<employeeId>:<birthMonth>:<birthDay>:<recipientId>`
- `lifecycle:probation:14d:<employeeId>:<probationDate>:<recipientId>`
- `lifecycle:leave_aging:3d:<leaveRequestId>:<recipientId>`

**Before inserting**, the function queries:
```sql
SELECT COUNT(*) FROM notifications 
WHERE key = $1 AND created_at >= (now() - interval '30 days')
```

If count > 0, skip. This is why:
- **Each stage fires exactly once** (no repeating daily until someone acts)
- **Missed runs self-heal** (Tuesday's run catches Monday's missed 14d-before fires, as long as 14d-before is still in the window)
- **Can't double-fire** even if the function runs twice by accident

### Consolidating Existing Reminders

The three reminders that currently run on page-load (`runDailyChecks` in `TopBar.jsx`) get moved into this job:
- Birthday → event #1
- Holiday reminder → event #13
- Monthly regularization nudge → event #14

The page-load trigger is removed; those events now fire from the scheduled job only. Since the dedup key includes the date/month, no double-firing during the transition.

### Timezone Correctness

The function uses **IST throughout**, so:
- A birthday on 2026-07-05 in IST fires on 2026-07-05, regardless of when UTC thinks it is
- An internship ending 2026-07-15 shows "14 days before" on 2026-07-01 (IST), not whenever UTC thinks it is
- Solves the off-by-one gap flagged in the audit

### Recipients Resolution

All recipients are resolved **in the SQL query itself**, not in the app:
- **Team-wide**: `SELECT id FROM employees WHERE status = 'active'`
- **HR/Admin**: `SELECT id FROM employees WHERE status = 'active' AND role_type IN ('hr', 'admin')`
- **A manager**: `SELECT manager_id FROM employees WHERE id = $1` (handles NULL safely)
- **The employee**: just their own ID
- **"Whoever's sitting on it"**: per-stage-aware, e.g. a transfer waiting on **target manager** looks up the `to_manager_id`; once it moves to **HR**, looks up HR recipients

---

## 4. Data Model

### New Table: `lifecycle_reminder_log`

Tracks which reminders have fired, to prevent duplicates and self-heal across missed runs.

```sql
CREATE TABLE lifecycle_reminder_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT NOT NULL UNIQUE,  -- deterministic key: "lifecycle:probation:14d:<empId>:<date>:<recipientId>"
  event_type TEXT NOT NULL,  -- "birthday", "probation", "passport_expiry", etc.
  employee_id UUID,          -- the employee affected (if applicable)
  fired_at TIMESTAMPTZ DEFAULT NOW(),
  created_notification_id UUID REFERENCES notifications(id) ON DELETE SET NULL
);

CREATE INDEX idx_lifecycle_reminder_log_key ON lifecycle_reminder_log(key);
CREATE INDEX idx_lifecycle_reminder_log_fired_at ON lifecycle_reminder_log(fired_at);
```

This log is the **single source of truth** for "has this event already fired?" Notifications go to the existing `notifications` table (so they show up in the bell like everything else); the log just tracks that we've processed it.

### Modified: `notifications` table

No schema changes. Each lifecycle notification is a normal row:
```sql
INSERT INTO notifications (
  employee_id, type, title, message, metadata, created_at
) VALUES (
  $1, 'lifecycle_reminder', $2, $3, jsonb_build_object('event_type', 'probation', 'stage', '14d'), NOW()
);
```

---

## 5. Testing Strategy

### SQL Verification Block (in the migration file)

After the function is created, the migration includes a **verification query**:

```sql
-- Verify the function exists and can be called
SELECT routine_name FROM information_schema.routines 
WHERE routine_name = 'run_lifecycle_reminders' AND routine_schema = 'public';
```

### Manual Test (documented in README or migration comments)

Before deploying, run a manual spot-check in a test environment:

1. **Seed test data**: Create a test employee with `probation_end_date = TODAY + 14 days`
2. **Call the function**: `SELECT run_lifecycle_reminders();`
3. **Verify output**: Check that exactly one notification row exists (for HR + manager), with the right `key`
4. **Call again**: `SELECT run_lifecycle_reminders();` a second time
5. **Verify no duplicate**: Confirm **no new notification** was inserted (the dedup key blocked it)
6. **Repeat for one expiry event** and **one aging-approval case** to verify multi-stage behavior

This is the same pattern as other database functions in the app (`get_team_directory`, etc.) — verified by SQL query, not JavaScript tests, because the logic lives in the database.

---

## 6. Rollout & Deployment

### One-Time Setup on Supabase (you'll do this)

**Step 1: Run the migration in both Supabase projects**

The migration file (`supabase_migration_lifecycle_reminders.sql`) creates:
- The `run_lifecycle_reminders()` function
- The `lifecycle_reminder_log` table
- Indexes

Run it exactly like you run other migrations (copy-paste into the Supabase SQL editor in both Production and Test).

**Step 2: Enable pg_cron and schedule the job**

In each Supabase project's SQL editor, run (once per project):

```sql
-- Enable the cron extension (one-time)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the job to run daily at 9 AM IST (one-time)
SELECT cron.schedule(
  'lifecycle_reminders_daily',
  '0 3 * * *',  -- UTC 3 AM = IST 8:30 AM (IST is UTC+5:30)
  'SELECT run_lifecycle_reminders();'
);
```

(Note: Supabase cron runs in UTC, so `3 AM UTC` = `8:30 AM IST`. Adjust if you prefer a different time.)

**Until Step 2 is done, nothing fires.** So there's no risk of partial deployment.

### Transition from Page-Load Triggers

Once the job is scheduled, the browser triggers (`runDailyChecks` in `TopBar.jsx`) are retired:
- Remove the `useEffect` that calls `runDailyChecks` from TopBar
- Delete the `runDailyChecks` function and its dedup logic from `api.notifications.js`
- The three events (birthday, holiday, regularization) now fire from the job only

No double-notifications during the transition because the dedup keys are deterministic — day-old reminders from the job will have the same key as the old page-triggered ones, so they don't re-fire.

### Monitoring & Debugging

If a reminder doesn't fire:
- **Check the log:** Query `SELECT * FROM lifecycle_reminder_log WHERE fired_at > (now() - interval '24 hours')` to see which reminders processed today
- **Check notifications:** `SELECT * FROM notifications WHERE type = 'lifecycle_reminder' AND created_at > (now() - interval '24 hours')` to see what landed in the bell
- **Check the cron job:** In Supabase's "Database" → "Cron Jobs" view, confirm `lifecycle_reminders_daily` is there and the last run timestamp
- **Manually trigger:** `SELECT run_lifecycle_reminders();` in the SQL editor to test immediately (won't hurt; dedup keys prevent double-firing)

---

## 7. Out of Scope (Deliberately Deferred)

1. **Email versions** of lifecycle reminders — kept in-app only, as per the earlier audit decision. The code is ready for email to be wired in later; for now, notifications are in-app bell + dashboard only.
2. **HR "upcoming lifecycle events" dashboard** — a natural follow-up once the job is proven. This spec lays the data groundwork; a dashboard page is separate.
3. **Configurable thresholds** — the timings (14d, 3d, 30d, 7d, etc.) are hard-coded in the function for v1, proven by this feature's use. A config table to adjust them can come later if Amit wants that flexibility.

---

## 8. Success Criteria & Verification

| Criterion | How to Verify |
|---|---|
| Every event fires on time, every day | Query `lifecycle_reminder_log` after 24 hours; confirm rows for each event type |
| Escalating reminders fire exactly once per stage | Seed a probation-ending employee; check log and notifications for exactly 2 rows (14d, 3d) |
| No double-firing even if job runs twice | Manually call the function twice in a row; confirm second call creates no new notifications |
| Existing reminders are consolidated | Birthday/holiday/regularization reminders come from the job (no page-load triggers); behavior is identical to before |
| Timezone is correct | Test with an IST-based birthday/date; confirm it fires on the IST day, not UTC day |
| Recipients are correct | Spot-check one notification's recipient list: e.g., a probation reminder has HR + manager, a passport expiry has employee + HR |
| Setup is self-contained | A new Supabase project with just the migration + the two cron commands can run the job (no special app code needed) |

---

## 9. Technical Assumptions & Dependencies

- **Supabase pg_cron** is available (it is; standard on Supabase)
- **SECURITY DEFINER** functions work with RLS (they do; that's the whole point)
- **Asia/Kolkata timezone** is available in Postgres (it is; standard PostgreSQL)
- **`notifications` table exists** with id, employee_id, type, title, message, metadata, created_at (it does)
- **Existing lifecycle fields exist**: `join_date`, `internship_end_date`, `probation_end_date` on employees; `from_date`, `to_date` on leave_requests; `passport_expiry_date`, `visa_expiry_date` on employee_compliance; `expiry_date` on employee_documents (they do)

---

## 10. Rollback / Disable Plan

If the job causes issues:

1. **Disable the cron job** (keeps the function and log table):
   ```sql
   SELECT cron.unschedule('lifecycle_reminders_daily');
   ```
   The job stops firing immediately; old reminders that landed in the bell stay there.

2. **Re-enable the page-load triggers** (if needed for continuity):
   ```javascript
   // Restore runDailyChecks in TopBar.jsx
   // Restore runDailyChecks and shouldSendMonthlyRegularizationReminder in api.notifications.js
   ```

3. **Full rollback** (delete the job, log table, and function):
   ```sql
   SELECT cron.unschedule('lifecycle_reminders_daily');
   DROP TABLE lifecycle_reminder_log;
   DROP FUNCTION run_lifecycle_reminders();
   ```

No migrations are run on the main schema tables, so no risk of data loss.

---

## 11. Related Documents

- **Audit document:** `/docs/AUDIT-2026-07-04.md` — explains why this feature is needed (reliability of existing reminders)
- **Manager Transfer Requests:** `/docs/superpowers/specs/2026-07-03-manager-transfer-requests-design.md` — adds one more event type to monitor (aging transfer approvals)
- **Existing reminder logic:** `src/lib/api.notifications.js` — `runDailyChecks`, `shouldSendMonthlyRegularizationReminder` (functions that will be moved into the job)
