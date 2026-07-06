# Lifecycle Notifications Port — Design Spec

**Date:** 2026-07-06
**Scope:** Port two behaviors from the retired page-load `runDailyChecks` into scheduled SQL — (1) holiday opt-in window notifications, (2) weekly attendance report notification.

---

## Problem

When `runDailyChecks` was retired (commit `3b65cad`) in favor of the SQL lifecycle engine (`run_lifecycle_reminders()`), two behaviors were **not** ported and currently do not fire anywhere:

1. **Holiday opt-in window notifications** — telling employees the opt-in window is open, and reminding non-responders before it closes.
2. **Weekly attendance report notification** — a weekly nudge that the attendance Weekly view is ready to review.

Both were flagged as follow-up work in `project.md`. This spec ports them into the scheduled SQL model so they fire reliably, independent of whether anyone opens the app.

---

## Goals

1. Restore both notification behaviors on a reliable server-side schedule (no dependence on page loads).
2. Reach every active employee, exactly once per occurrence, using the engine's existing dedup log.
3. Keep all date logic in IST, consistent with the existing engine.
4. Deliver the weekly report at **Friday end-of-day**, not Monday.

---

## Architecture

**Approach: split by cadence** (each behavior fires on its natural schedule).

| Behavior | Home | Schedule |
|---|---|---|
| Holiday opt-in window notifications | **Event 15** appended to the existing daily `run_lifecycle_reminders()` | 9 AM IST daily (existing cron, unchanged) |
| Weekly attendance report | **New function** `run_weekly_attendance_report()` | Friday 6:30 PM IST — new cron (`0 13 * * 5` UTC) |

The holiday check is a daily window-boundary check, so it belongs in the daily job. The weekly report needs a Friday-evening delivery time, so it gets its own function and cron rather than forcing the 16-event daily function to run twice a day.

### Files

| File | Change |
|---|---|
| `supabase_migration_lifecycle_reminders.sql` | **Modify** — add Event 15 (holiday opt-in) into `run_lifecycle_reminders()`. Re-run in both projects (safe `CREATE OR REPLACE`). This file stays the single canonical definition of the daily function. |
| `supabase_migration_weekly_attendance_report.sql` | **New** — `run_weekly_attendance_report()` function + Friday cron schedule + verification queries. |

No JavaScript changes. The retired JS helpers (`getOptinWindow`, the weekly/holiday branches of `runDailyChecks`) are already deleted; their logic is re-expressed inline in SQL.

### Shared conventions (match existing engine)

- **Notification type:** reuse `'lifecycle_reminder'` (the type all 14 existing events use, already rendered by `NotificationBell`). The specific behavior is distinguished by `metadata.event_type`.
- **Dedup:** the shared `lifecycle_reminder_log` table. Each notification inserts a row with a deterministic `key`; a notification is created only if its key does not already exist. Missed runs self-heal; re-runs are no-ops.
- **Security:** `SECURITY DEFINER` with `SET search_path = public, pg_temp` — bypasses RLS safely to read every active employee and insert notifications for anyone. This is what lets a scheduled job broadcast reliably (the exact capability the page-load version lacked without the `hr_admin_lookup` RPC).
- **Timezone:** `today := (now() AT TIME ZONE 'Asia/Kolkata')::date` in both functions. All date math is IST.

---

## Event 15 — Holiday Opt-In Window Notifications

Added to `run_lifecycle_reminders()`. Dormant except during the two annual windows.

### Window derivation (inline, from IST `today`)

| Window | Open dates (IST) | Label | Closes on |
|---|---|---|---|
| H1 | Jan 1–14 | `<year>-H1` | `<year>-01-14` |
| H2 | Jul 1–14 | `<year>-H2` | `<year>-07-14` |

Outside these date ranges, Event 15 does nothing. `days_until_close := closes_on - today`.

### A. Window-open broadcast

- **When:** any daily run where the window is open.
- **To:** every active employee.
- **Dedup key:** `lifecycle:holiday_optin_open:<window_label>:<employee_id>` — fires once per person per window (self-heals if the window's first day is missed).
- **Title:** `Holiday Opt-In Window Open`
- **Message:** `You can now pick your optional holidays for the year. Submit your picks by <closes_on: DD Mon YYYY> in Leave Management → Holiday Calendar.`
- **metadata.event_type:** `holiday_optin_open` (plus `window`, `closes_on`).

### B. Closing-soon reminder

- **When:** window is open AND `days_until_close BETWEEN 0 AND 3` (the last 4 days).
- **To:** active employees who have **no** row in `holiday_optin_submissions` for this `window_label` (submitting zero picks counts as responded — not reminded).
- **Dedup key:** `lifecycle:holiday_optin_closing:<window_label>:<employee_id>` — a single reminder per person per window (not a daily nag).
- **Title:** `Holiday Picks Closing Soon`
- **Message:** `The holiday opt-in window closes <closes_on: DD Mon YYYY>. Submit your optional-holiday picks before then.`
- **metadata.event_type:** `holiday_optin_closing` (plus `window`, `closes_on`).

---

## Weekly Attendance Report — `run_weekly_attendance_report()`

New standalone function on a Friday-evening cron. Delivers **one notification per person**, tailored by role.

### Behavior

- **Schedule:** Friday 6:30 PM IST (`cron.schedule('weekly_attendance_report_friday', '0 13 * * 5', ...)`).
- **Day guard:** function computes IST `today` and proceeds only if `EXTRACT(DOW FROM today) = 5` (Friday). Redundant with the Friday-only cron, included as a safety belt.
- **Optional test parameter:** `run_weekly_attendance_report(p_as_of DATE DEFAULT NULL)` — when `NULL`, uses IST today; when provided, treats that date as "today" for simulating a Friday during manual verification. Defaulting to `NULL` means the cron call `SELECT run_weekly_attendance_report();` behaves normally.
- **Dedup key (both variants):** `lifecycle:weekly_report:<ISO year-week>:<employee_id>` using `to_char(today, 'IYYY-IW')` — once per person per ISO week.

### A. HR/Admin → team-review reminder

- **To:** active employees with `role_type IN ('hr','admin')`.
- **Title:** `Weekly Attendance Report Ready`
- **Message:** `This week's team attendance summary is ready. Review it in Attendance → Weekly.`
- **metadata.event_type:** `weekly_report_team`.

### B. Every other active employee → personal-hours nudge

- **To:** active employees with `role_type NOT IN ('hr','admin')`.
- **Title:** `Your Weekly Hours Are Ready`
- **Message:** `Your attendance summary for this week is ready to review on your Attendance page.`
- **metadata.event_type:** `weekly_report_personal`.

Each person receives exactly one notification (HR/Admin get the team version only; the team version links to the per-employee Weekly view, where HR/Admin can already see each employee's hours). At 6:30 PM Friday the work week is effectively complete, so "this week" reads correctly.

---

## Error Handling & Idempotency

- Every insert is guarded by an existence check against `lifecycle_reminder_log`; a partial/interrupted run resumes cleanly on the next run, and a duplicate run inserts nothing.
- Both functions loop over `employees WHERE status = 'active'` — deactivated employees are never notified.
- No external calls; failure of one insert does not corrupt others (each is independently keyed).

---

## Testing / Verification

Pure SQL — no JavaScript, no Vitest additions. Verification is manual, matching the existing engine's approach, and both migration files include documented queries:

1. **Holiday window-open:** temporarily confirm behavior by running `run_lifecycle_reminders()` during a window (or inspect logic against a window date), then check for `lifecycle_reminder` notifications with `metadata.event_type = 'holiday_optin_open'` and matching `lifecycle_reminder_log` rows. Re-run and confirm no duplicates.
2. **Holiday closing:** with a `holiday_optin_submissions` row present for a test employee, confirm that employee is skipped while a non-submitter receives `holiday_optin_closing`.
3. **Weekly report:** `SELECT run_weekly_attendance_report('2026-07-10');` (a Friday) → confirm HR/Admin get `weekly_report_team`, others get `weekly_report_personal`, one each; re-run → no duplicates. `SELECT run_weekly_attendance_report('2026-07-09');` (a Thursday) → confirm nothing fires (day guard).

---

## What This Is NOT

- No new notification type (reuses `lifecycle_reminder`).
- No new tables (reuses `lifecycle_reminder_log`, `holiday_optins`, `holiday_optin_submissions`, `notifications`, `employees`, `holidays`).
- No JavaScript changes.
- No change to the existing 14 events or the daily cron time.
- No change to how the Weekly view or Holiday Calendar screens are computed/rendered.

---

## Success Criteria

1. During an opt-in window, every active employee receives one "window open" notification; non-responders receive one "closing soon" notification in the final 4 days; responders do not.
2. Every Friday evening, each active employee receives exactly one weekly notification appropriate to their role.
3. Re-running either function, or recovering from a missed run, never produces duplicate notifications.
4. All timing is IST; the weekly report lands Friday evening, not Monday.
5. Both migrations run cleanly (idempotently) in Production and Test.
