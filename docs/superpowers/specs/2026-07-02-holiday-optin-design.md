# Holiday Opt-In Calendar — Design Spec

**Date:** 2026-07-02
**Status:** Approved by user, ready for implementation planning
**Scope:** Optional-holiday opt-in system only. The related "notify team when a regular leave request is approved" requirement is deferred to the separate Leave Overhaul design (not covered here).

## Goals

Today, the `holidays` table is a flat, company-wide list — every listed holiday (regardless of `type`) applies identically to every employee. This design adds per-employee choice for holidays marked `type = 'optional'` (e.g. regional/optional festivals), while `public` and `company` holidays remain mandatory for everyone exactly as they work today.

## Key Decisions

- **Opt-in model:** HR marks a holiday `type = 'optional'` using the existing Holidays panel (no new publish step). Each employee individually chooses which optional holidays they personally want off.
- **No cap** on how many optional holidays an employee can opt into.
- **Two submission windows per year, on fixed automatic dates (UTC-based, matching the app's existing date convention):**
  - **Window 1 — Jan 1–14:** employee selects their picks for the *entire year's* optional holidays.
  - **Window 2 — Jul 1–14:** employee may revise picks, but **only for holidays from Jul 1 onward**. Jan–Jun picks are locked once those dates have passed — no retroactive changes.
  - Outside these windows, the picks UI is read-only.
- **Default when a window is not acted on: opted out of everything.** No penalty, no forced choice — silence just means "no optional holidays this window."
- **Effect of opting in:** that date becomes a personal day off — no check-in expected, doesn't count against attendance for that employee specifically. Not opting in means it's a normal working day for that employee.
- **Shared visibility:** any employee (not just HR) can see who opted into a given optional holiday. No separate HR-only report is needed — the same view serves everyone.
- **Reminders:** an in-app notification fires when a window opens, and a second reminder partway through (a few days before close) — but **only** to employees who haven't yet explicitly confirmed their picks for that window (confirming with zero selections still counts as "responded," so they're not nagged again).

## Data Model

### New table: `holiday_optins`
```sql
CREATE TABLE holiday_optins (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  holiday_id   UUID NOT NULL REFERENCES holidays(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, holiday_id)
);
```
- One row = "this employee opted into this holiday." No row = opted out. Only ever references `holidays` rows where `type = 'optional'` — enforced at the application layer, not a DB constraint, keeping the table generic.
- RLS: employees may insert/delete their own rows (`employee_id = self`); a separate permissive SELECT policy allows every authenticated employee to read all rows (this is what powers the shared "who opted in" visibility — deliberately not restricted to HR).
- Window-open/closed enforcement happens at the application layer (mirrors the existing pattern used elsewhere in this codebase, e.g. `hrSetSessions`'s 30-day-back window), not via time-based RLS.

### New table: `holiday_optin_submissions`
```sql
CREATE TABLE holiday_optin_submissions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  window_label TEXT NOT NULL,  -- e.g. '2026-H1', '2026-H2'
  confirmed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, window_label)
);
```
- Records that an employee explicitly confirmed their picks for a given window (even confirming zero selections writes a row here). Exists solely to distinguish "chose nothing on purpose" from "never opened the page," so the partway-through reminder only targets employees who genuinely haven't responded.
- RLS: employees may insert their own row for the current window; readable the same way as `holiday_optins`.

### `holidays` table — unchanged
No schema change. Any row with `type = 'optional'` automatically becomes eligible for opt-in; no separate publish flag needed.

## Window Computation

A helper function (mirroring the existing `shouldSendMonthlyRegularizationReminder` pattern) determines, for a given UTC date:
- Which half-year window is currently open, if any (`'2026-H1'` = Jan 1–14, `'2026-H2'` = Jul 1–14).
- For H2, which holidays are eligible for editing (only `date >= July 1` of that year — Jan–Jun holidays are excluded from the editable set, shown read-only alongside the rest of the year's picks if displayed at all).

Since holidays are date-only values (no wall-clock time component), the IST/UTC timezone-shift bug class from the Attendance overhaul does not apply here — but UTC day-boundary math for "is today within the window" still needs the same care already established in this codebase's notification scheduling code.

## Employee Experience

- A new "Holiday Calendar" section on the Leave Management page lists the year's `type = 'optional'` holidays with a checkbox per holiday.
- Checkboxes are editable only while a window is open; read-only otherwise, with a note on when the next window opens.
- Saving replaces the employee's opt-in set for the currently-editable holidays (delete-then-insert to match the eligible set, matching the existing "replace entirely" pattern already used by `hrSetSessions`) and writes/updates the `holiday_optin_submissions` row for the current window (recording "confirmed," even if zero were selected).
- Each holiday row can be expanded to show the list of other employees who opted into that same date (shared visibility, not HR-gated).

## HR Experience

- No new workflow. HR marks a holiday `type = 'optional'` via the existing Holidays panel exactly as today.
- HR sees the same shared visibility view as every other employee — no separate admin-only report.

## Notifications

| Event | Recipient |
|---|---|
| Window opens (Jan 1, Jul 1) | All active employees |
| Window closing soon (a few days before Jan 14 / Jul 14) | Active employees who have not yet submitted a `holiday_optin_submissions` row for the current window |

Both reuse the existing `runDailyChecks` scheduled-notification pattern and `createNotification`/broadcast-insert conventions already established in this codebase — including the "notify every eligible recipient, not just one" lesson from the Attendance overhaul's regularization-notification bug.

## Integration with Existing Attendance Logic

The monthly absence-reminder logic (`api.notifications.js`, built during the Attendance Overhaul) currently treats every row in `holidays` as excluding that date for every employee when computing "working days." This must change to be per-employee-aware for `type = 'optional'` holidays specifically:
- `public`/`company` holidays: excluded for everyone, unchanged.
- `optional` holidays: excluded only for employees who have a matching `holiday_optins` row for that date; everyone else still has that date counted as a normal working day (expected to check in).

## Edge Cases

- **New employee joins mid-year, after a window has closed:** defaults to opted-out-of-everything until the next window opens (Jan or Jul, whichever comes first) — no special-cased ad-hoc window, consistent with the "silence = opt out" default.
- **HR adds a new optional holiday mid-window:** it becomes immediately selectable for the remainder of the currently-open window (no separate re-publish step required, since eligibility is computed live from `holidays.type = 'optional'`).
- **HR deletes an optional holiday an employee already opted into:** the `ON DELETE CASCADE` on `holiday_optins.holiday_id` removes the now-orphaned opt-in row automatically.

## Testing Plan

Applying the explicit lesson from the Attendance Overhaul's post-launch bug wave — these are called out deliberately, not left implicit:
- **RLS verification, not just policy-file inspection:** trace which Postgres role/session executes each write and cross-employee read (self opt-in/opt-out, shared "who opted in" read by a non-HR employee) and confirm behavior against the actual RLS policies, not just that the SQL "looks permissive."
- **Window boundary date math:** Dec 31 → Jan 1, Jan 14 → Jan 15, Jun 30 → Jul 1, Jul 14 → Jul 15, all UTC-based, with explicit unit tests at each boundary.
- **Notification broadcast completeness:** verify the window-open and reminder notifications reach *every* eligible recipient (all active employees / all non-submitted employees), not a single arbitrarily-picked one — this exact bug shipped once already in the regularization feature.
- **Reminder correctness:** an employee who explicitly submits zero selections must not receive the partway-through reminder for that window.
- Vitest unit tests extending the existing `src/tests/` suite, following the same patterns as `api.attendanceRegularization.test.js` and `api.notifications.test.js`.

## Out of Scope

- "Notify the team when a regular (casual/sick/earned/comp) leave request is approved" — deferred to the Leave Overhaul design.
- Any change to `public`/`company` holiday behavior — unchanged, mandatory for everyone as today.
- A cap on how many optional holidays an employee may select — explicitly unlimited per this design.
