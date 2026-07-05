# STRIDE — PROJECT REFERENCE
**Last updated:** 2026-07-05 (Lifecycle Reminders deployed)
**Update this file every 3-4 prompts**

---

## INFRASTRUCTURE

| Item | Value |
|---|---|
| Repo | github.com/Enazuma-11/Stride |
| Local (Amit) | ~/Downloads/sportech-portal-clean |
| Production URL | sportech-portal.vercel.app |
| Test URL | sportech-portal-test.vercel.app |
| Production Supabase | fqyyvdtjzswdkgrkytam |
| Test Supabase | uzysmoeyrenbhpbdxled |
| Stack | React + Vite + Supabase + Vercel |

---

## LATEST PUSHED COMMIT
`3b65cad` — Retire page-load runDailyChecks — lifecycle reminders now handled by scheduled SQL job

## LOCALLY BUILT (NOT YET PUSHED)
- (nothing pending — working tree matches origin/main)

## IN PROGRESS
- (nothing in progress)

## RECENTLY COMPLETED

### Lifecycle Reminders Engine (2026-07-05) ✅ DEPLOYED
Spec: `docs/superpowers/specs/2026-07-04-lifecycle-reminders-design.md`
Plan: `docs/superpowers/plans/2026-07-04-lifecycle-reminders.md`
- A daily pg_cron job (`run_lifecycle_reminders()` at 3:30 AM UTC = 9 AM IST) fires 14 event types reliably, independent of user login
- Events covered: birthday, work anniversary, new joiner, internship ending (14d/3d), probation ending (14d/3d), passport expiry (30d/7d/0d), visa expiry (30d/7d/0d), certification expiry (30d/7d/0d), leave ending (back-to-work), aging leave approval (3d/7d), aging regularization (3d/7d), aging transfer (3d/7d), holiday reminder (3d before), monthly regularization nudge (from 25th)
- New `lifecycle_reminder_log` table with deterministic dedup keys — each stage fires exactly once, missed runs self-heal
- All date logic in IST (`Asia/Kolkata` timezone) — fixes the off-by-one boundary bug identified in the audit
- SECURITY DEFINER function with `SET search_path = public, pg_temp` — bypasses RLS safely to cross-query all employees
- Retired the page-load `runDailyChecks` trigger from `TopBar.jsx` and deleted `runDailyChecks`, `shouldSendMonthlyRegularizationReminder`, `workingDaysInRange` from `api.notifications.js`
- 214 tests passing (net reduction from 236 — deleted the 22 stubs testing retired functions; all real coverage intact)
- ⚠️ **Two behaviors not yet ported**: weekly attendance report notification (Mondays) and holiday opt-in window notifications — these were in runDailyChecks but not included in the lifecycle spec; follow-up task queued
- `supabase_migration_lifecycle_reminders.sql` ✅ run in both Production and Test; cron job active in both

### Whole-Project Audit + Bug Fixes (2026-07-04)
Audit doc: `docs/AUDIT-2026-07-04.md`
- BUG-1 fixed: `ProfilePage.jsx` crashed on Exit tab due to missing `FONTS` import — added to constants import (one-line fix)
- BUG-2 fixed: `HRDashboardPage.jsx` leave approval showed a misleading error alert due to `sendLeaveDecisionEmail` called without import — removed the email block (email is deferred until MSG91 domain is verified)
- BUG-4 fixed: `api.announcements.test.js` had a misfiled `sendLeaveDecisionEmail` test with wrong signature testing only a mock — removed (was providing false confidence on the email path)
- BUG-3 (leave-decision emails never send anywhere) deferred — depends on MSG91 domain verification
- 5 "make it smarter" opportunities documented in audit; Lifecycle Reminders was the first

### Manager Transfer Requests (2026-07-03)
Built via 6-task plan (subagent-driven-development) + a final whole-branch review round + one fix-and-re-review pass.
Spec: `docs/superpowers/specs/2026-07-03-manager-transfer-requests-design.md`
Plan: `docs/superpowers/plans/2026-07-03-manager-transfer-requests.md`
- A manager can request transferring one of their direct reports to another manager (Team Directory → "Transfer" button on a managed report's card). The receiving manager must accept before HR/Admin gives final approval — only on HR/Admin approval does `employees.manager_id` actually change.
- New `manager_transfer_requests` table with a `pending_target → pending_hr → approved | rejected_by_target | rejected_by_hr | withdrawn` status machine; only one non-terminal request per employee at a time; the initiating manager can withdraw anytime before a terminal state.
- Notifications at every stage: target manager on request creation, every active HR/Admin (broadcast) when the target manager accepts, the initiating manager on either rejection, and the transferred employee on final HR approval only.
- HR's existing direct manager-edit in Employee Management is untouched — still instant, no approval needed; the new flow is an additional path, not a replacement.
- Planning caught a real pre-existing bug before any code shipped: the `employees` table had no SELECT policy letting a regular (non-HR/Admin) employee see any row but their own, silently breaking Team Directory for everyone except HR/Admin (invisible until now since the only accounts ever tested with are HR/Admin).
- Final whole-branch review then caught that the *fix* for that bug (a broadened `employees` SELECT policy) was itself too broad — Postgres RLS is row-level, not column-level, so it would have exposed home address, DOB, marital status, and personal email/mobile company-wide, far beyond what Team Directory displays. Corrected to a `SECURITY DEFINER` RPC (`get_team_directory`) that returns only the safe directory columns, with the base table reverted back to self/HR-only — verified column-by-column that every personal field is excluded.
- One accepted, documented risk left in place after review: `manager_transfer_requests`' UPDATE policy has no `WITH CHECK` (status-transition rules are enforced in app code, not the DB) — bounded because `employees.manager_id` itself stays independently protected by separate self/HR-only policies, so this can't be used to force a real manager change.
- Post-merge fix (2026-07-03): a re-audit found the eligible-managers dropdown could offer a deactivated/offboarded employee as a transfer target, since `deactivateEmployee()` never clears `manager_id` on that person's former reports and `get_team_directory()`'s manager join didn't check the manager's own status. Fixed both server-side (`requestTransfer` now rejects an inactive target manager) and at the data layer (the RPC's manager join now requires `status = 'active'`).
- Post-merge fix (2026-07-03): discovered HR's existing direct manager-edit (`ManagerSelector` in Employee Management) restricted the "Reporting Manager" dropdown to `role_type IN ('admin','hr')` — meaning HR had no way to promote a regular employee into managing anyone for the first time (they'd never appear in the list). Removed that restriction; any active employee can now be assigned as a manager, matching how "manager" works everywhere else in the app (an emergent property of `manager_id`, not a role_type).
- 238 tests passing (up from 219 at the start of this feature)
- ⚠️ `supabase_migration_manager_transfers.sql` still needs to be run manually in both Supabase projects — see Pending Actions below

### Leave Overhaul (2026-07-03)
Built via 7-task plan (subagent-driven-development) + a final whole-branch review round.
Spec: `docs/superpowers/specs/2026-07-03-leave-overhaul-design.md`
Plan: `docs/superpowers/plans/2026-07-03-leave-overhaul.md`
- Employee chooses "unpaid leave" upfront at apply time (checkbox) — bypasses the balance system entirely, tracked separately via `leave_balances.unpaid_days_taken`. Replaces the old dormant auto paid/unpaid split that used to run at approval time (removed).
- Requests exceeding remaining paid balance are now blocked upfront at apply time, with a message telling the employee to reduce the dates or mark it unpaid — no more silent split.
- Team-wide visibility on approval: every active employee gets an in-app notification (name + dates only, via `broadcastNotification`), plus a persistent "Upcoming Leave" list widget on the Dashboard (both Employee and Admin views)
- New `get_upcoming_approved_leaves` SECURITY DEFINER RPC (added to `supabase_migration_unpaid_leave.sql`) — required because `leave_requests`' RLS policy only lets a session see its own rows, so a direct query for "everyone's upcoming leave" would silently return just the querying employee's own rows
- Final whole-branch review caught 2 Critical cross-task bugs the per-task reviews missed: `unpaid_days_taken` was never actually incremented anywhere, and `updateLeaveStatus` was deducting the full day-count (not just `paid_days`) from balance on approval, corrupting balances for approved unpaid requests — both fixed and re-verified (numeric round-trip trace: apply → approve → cancel) before merge
- Known minor follow-up (not merge-blocking): cancelling a still-*pending* (never approved) unpaid request doesn't reverse `unpaid_days_taken`
- 219 tests passing (up from 209 at the start of this feature)
- ⚠️ `supabase_migration_unpaid_leave.sql` still needs to be run manually in both Supabase projects — see Pending Actions below (now also adds the RPC, not just the two balance columns)

### Holiday Opt-In Calendar (2026-07-03)
Built via 7-task plan (subagent-driven-development) + a final whole-branch review round.
Spec: `docs/superpowers/specs/2026-07-02-holiday-optin-design.md`
Plan: `docs/superpowers/plans/2026-07-02-holiday-optin-calendar.md`
- Per-employee opt-in for `type='optional'` holidays only — `public`/`company` stay mandatory for everyone, unchanged
- Two fixed annual windows: Jan 1–14 (picks for the whole year), Jul 1–14 (revise Jul–Dec picks only; Jan–Jun locked)
- No cap on selections; silence = opted out of everything that window
- Shared visibility — any employee (not just HR) can see who opted into a given holiday, on the new "Holiday Calendar" tab (Leave Management page)
- Window-open + not-yet-responded reminder notifications, via `runDailyChecks`, deduped so a window-open broadcast can't double-fire across multiple HR sessions
- New tables: `holiday_optins`, `holiday_optin_submissions` (migration: `supabase_migration_holiday_optins.sql` — ⚠️ **must be run manually in both Supabase projects**, not yet applied as of this writing)
- Explicitly designed to avoid the Attendance Overhaul's bug classes (RLS cross-employee access, notification broadcast completeness, date-boundary math) — all held up end-to-end per the final review
- Final whole-branch review caught one real Critical bug the per-task reviews couldn't see (re-saving picks would throw a unique-constraint error on nearly every real re-save) — fixed and re-verified before merge
- 209 tests passing (up from 185 at the start of this feature)

### Attendance Overhaul (2026-07-02)
Built via 17-task plan (subagent-driven-development) + a final whole-branch review round.
Spec: `docs/superpowers/specs/2026-07-01-attendance-overhaul-design.md`
Plan: `docs/superpowers/plans/2026-07-01-attendance-overhaul.md`
- Drops late-mark entirely — status judged purely on total hours worked
- Multiple check-in/out sessions per day (capped at 5), midnight-spanning sessions split across the two calendar days
- Weekly hours: employee widget (Attendance page + Dashboard), HR/Admin Weekly tab, Monday notification
- Employee regularization requests (proposed times + reason, multi-date) → manager approve/reject per date → Admin/HR applies correction; employees can view status and withdraw pending requests
- HR/Admin direct session-level override (`AttendanceOverridePanel.jsx` reworked to edit the full session list per day)
- Monthly regularization reminder (25th → month-end), including true no-show absence detection (not just half-days) — excludes weekends, company holidays, approved leave, already-requested dates
- New tables: `attendance_sessions`, `attendance_regularization_requests`, `attendance_regularization_items` (migrations: `supabase_migration_attendance_sessions.sql`, `supabase_migration_attendance_regularization.sql` — ✅ run in Test/Dev 2026-07-02, confirm Production status below)
- 183 tests passing (up from 105 at start of the overhaul)

**Post-launch fix (2026-07-02, commit `1b341e2`):** a no-manager employee's regularization request was silently orphaned — notified to HR/Admin correctly, but the item stayed `manager_decision='pending'` (never auto-approved past the manager stage), so it was invisible to both `getAdminPendingItems` (requires `manager_decision='approved'`) and `getManagerPendingItems` (requires the employee to have that reviewer as `manager_id`). Fixed: manager-less requests now insert with `manager_decision='approved'` and request `status='pending_admin'` directly. Also added a guard blocking regularization submissions for any date within an approved leave request.

---

## TEAM

| Code | Name | Email | Role | Auth |
|---|---|---|---|---|
| SIL-000001 | Dr. Pinaze Dubash | pinaze@sportechinnolab.org | Founder & Board Advisor | ✅ |
| SIL-000002 | Sanand Salil Mitra | sanand@sportechinnolab.org | Founder & CTO | ✅ |
| SIL-000003 | Edward Francis Paul | talent@sportechinnolab.org | HR Manager | ✅ |
| SIL-000004 | Amit Chobitkar | amit.chobitkar@sportechinnolab.org | Founder & CEO / Admin | ✅ |
| SIL-000005 | Sanjusha Nagwani | sanjusha.nagwani@sportechinnolab.org | Full Stack Developer | ✅ |
| TRN-000001 | Stuti Gohil | sng19.work@gmail.com | Intern | ✅ |

---

## SANITY CHECK RESULTS (2026-06-22)

| Module | Status | Notes |
|---|---|---|
| Routes & Imports | ✅ All OK | All 17 pages imported and routed |
| Sidebar paths | ✅ All OK | All 15 paths match routes |
| Leave (Employee) | ✅ All OK | half-day, cancel, unpaid warning, balance cards |
| Leave API | ✅ All OK | direct update, paid/unpaid split, notifications |
| HR Leave | ✅ All OK | pending section, approve/reject, unpaid warning |
| Attendance | ✅ All OK | check-in/out, WFH, late mark, half-day deduction |
| Profile | ✅ All OK | 8 tabs, photo upload, document upload, I-Card, 2FA, exit |
| Notifications | ✅ All OK | all 8 events covered, realtime bell |
| Chat | ✅ All OK | channels, DMs, file attach, reactions, realtime |
| Policy Centre | ✅ All OK | categories load in modal, HR write gated by RLS |
| OKRs | ✅ All OK | cycles, objectives, key results, check-ins, auto-calc |
| Announcements | ✅ All OK | post, react, comment, notify all, realtime |
| Payslips | ✅ All OK | HR generate, employee view, bank auto-fill, download |
| Auth & ProtectedRoute | ✅ All OK | session, gates, 2FA, logout |
| Employee Management | ✅ All OK | create, invite, approve, edit, deactivate |
| Team Directory | ✅ All OK | search, filter, manager join, YOU badge |
| PWA | ✅ All OK | manifest, SW, offline, 8 icons |
| Tests | ✅ 105/105 passing | 6 test files |

---

## MODULES STATUS

### ✅ Auth
- Login / Logout (window.location.href for reliable redirect)
- Register (self-registration with pending approval gate) — fixed 2026-07-01: create-employee edge function was blocking self_register with platform JWT gate + a code-level "missing auth header" check that ran unconditionally; self_register now correctly skips both
- Set Password
- ProtectedRoute: pending_approval, rejected, onboarding form, requireHR gates
- 2FA TOTP — requires MFA enabled in Supabase dashboard

### ✅ Leave Management (Employee)
- Apply leave — full day and half day (0.5 day deduction)
- Real-time unpaid warning when balance insufficient
- Cancel leave — pending (direct) or approved (restores balance + notifies HR)
- Leave history with status badges + UNPAID badge
- Balance cards with progress bars + unpaid days count
- Gender-aware leave types (maternity = female only)

### ✅ Leave Management (HR)
- Pending requests section with Approve/Reject buttons
- Unpaid warning shown on each pending request
- Adjust/set individual leave balances with audit trail
- Record offline leave for employee
- Leave approval deducts paid days + tracks unpaid days separately

### ✅ Attendance (overhauled 2026-07-02 — see RECENTLY COMPLETED)
- Multi-session check-in/out (up to 5/day) with WFH toggle per session
- No more late-mark — status judged purely on total hours worked; midnight-spanning sessions split across the two calendar days
- Weekly hours (employee widget + HR Weekly tab), monthly calendar view
- Regularization workflow: employee requests → manager approves/rejects per date → Admin/HR applies; employee can view/withdraw pending requests
- HR attendance override — full session-level editing per employee/date
- HR attendance report with export
- ⚠️ Requires `supabase_migration_attendance_sessions.sql` and `supabase_migration_attendance_regularization.sql` to be run manually — see PENDING ACTIONS

### ✅ Profile (8 tabs)
- Personal, Work, Contact, Payroll, Compliance, Emergency, Skills, Exit
- Profile photo upload (createSignedUrl — private storage)
- Document upload in Compliance (createSignedUrl + correct column name)
- 2FA setup in Security tab
- I-Card with QR code + html2canvas download
- Employee can submit resignation (date + reason)
- HR has separate exit process checklist

### ✅ Employee Management (HR)
- Create with password + seed leave balances
- Invite via email
- Self-registration approval with role/dept/manager assignment
- Edit employee modal (role, dept, manager, join date, employee type)
- Deactivate employee
- Reporting manager dropdown (all active employees)

### ✅ Onboarding Form
- 4-step: Personal → Contact → Bank → Compliance/Documents
- Triggered on first login for invited employees
- Saves to profile, payroll, compliance tables
- Notifies HR on submission
- Gate: employees blocked until form submitted
- Fixed 2026-07-01: gender/marital_status now normalized to lowercase/underscored enum values before saving (was violating DB CHECK constraints on every submission)
- Fixed 2026-07-01: document_type CHECK constraint widened to match actual upload types; Test/Dev's employee_documents table + storage RLS policies synced to match Production
- Documents step now asks for 10th Marksheet, 12th Marksheet (both required), Graduation Certificate, Post-Graduation Certificate (at least one of the two required) — replaces the old single "Education Certificate" upload

### ✅ Payslips
- HR generates per employee/month with all components
- Bank details auto-populated from employee_payroll table
- Preview before save, download as PNG
- LOP deduction field available (feeds from unpaid leaves)
- Employee views own at /payslips, HR/Admin at /hr/payslips

### ✅ Announcements
- HR/Admin posts (General/HR/Event/Urgent categories)
- Pin to top, emoji reactions (👍❤️🎉), comments
- Real-time updates via Supabase
- Notifies all employees on post

### ✅ Team Directory
- Searchable cards with department filter
- Shows: photo, name, role, dept, employee ID, email, phone
- Reporting manager shown with their photo + role
- Current user highlighted with YOU badge

### ✅ Performance / OKRs
- Q2 2026 active, Q3 2026 upcoming
- Objectives with key results (%, number, ₹, boolean)
- Progress rings auto-calculate from key results average
- Check-in with notes + progress slider
- Status: On Track / At Risk / Behind / Completed
- HR toggles between own OKRs and all employees

### ✅ Policy Centre
- Categories: HR Policies, Handbook, Benefits, IT & Security, Legal, Operations
- HR uploads, saves draft, publishes — employees see published only
- File download via signed URL
- Optional acknowledgement — pending ack banner shown
- Category dropdown loads fresh in modal (useEffect)

### ✅ Internal Chat
- Channels: #general, #random, #engineering, #hr (HR/Admin creates more)
- Direct messages (any employee → any employee)
- File attachments, emoji reactions, delete own messages
- Real-time via Supabase realtime subscriptions

### ✅ Notifications
- In-app bell with unread count, realtime
- Events: leave apply → HR, leave approve/reject → employee, leave cancel → HR,
  HR record leave → employee, announcement → all, onboarding → HR,
  account approved → employee, birthday → employee+HR, holiday 3-day warning → all
- Lifecycle Reminders Engine (pg_cron, 9 AM IST daily): 14 event types covering people milestones, employment transitions, compliance expiry, operational aging — fires reliably regardless of user login; dedup log prevents double-firing

### ✅ PWA
- Standalone app, start at /dashboard
- Full offline caching, offline fallback page
- 8 icon sizes, 10 iOS splash screens
- Install prompt (Android auto, iOS manual)

### ✅ Tests
- 214 tests across 9 files — all passing
- api.attendance, api.leave, api.payslips, api.announcements, constants, validation, api.managerTransfers, api.holidayOptins, api.leaveBalances

---

## PENDING ACTIONS (Manual steps required)

| Priority | Item | Action |
|---|---|---|
| 🔴 HIGH | SQL: lr_delete_own policy | Run in both Supabase: `CREATE POLICY "lr_delete_own" ON leave_requests FOR DELETE TO authenticated USING (employee_id = (SELECT id FROM employees WHERE user_id = auth.uid()));` |
| 🔴 HIGH | SQL: supabase_migration_unpaid_leave.sql | Run in both Supabase — adds unpaid_days, paid_days columns, and get_upcoming_approved_leaves RPC (required for the Dashboard "Upcoming Leave" widget) |
| 🔴 HIGH | SQL: supabase_migration_attendance_sessions.sql | Run in both Supabase — required for the new Attendance overhaul (multi-session check-in/out won't work until this runs) |
| 🔴 HIGH | SQL: supabase_migration_attendance_regularization.sql | Run in both Supabase — required for the regularization request/approval workflow |
| 🔴 HIGH | SQL: supabase_migration_hr_admin_lookup.sql | Run in both Supabase — required for HR/Admin to actually receive regularization/leave notifications (RLS was silently blocking them without this) |
| 🔴 HIGH | SQL: supabase_migration_notifications_insert_fix.sql | Run in both Supabase — re-applies the notifications_insert RLS policy (a manager-less employee's first regularization submission hit "row violates row-level security policy" on this table) |
| 🔴 HIGH | SQL: supabase_migration_holiday_optins.sql | Run in both Supabase — required for the new Holiday Opt-In Calendar (employees can't pick optional holidays until this runs) |
| 🔴 HIGH | SQL: supabase_migration_manager_transfers.sql | Run in both Supabase — required for Manager Transfer Requests (adds the table + the get_team_directory RPC that Team Directory now depends on to load at all) |
| ✅ DONE | SQL: supabase_migration_lifecycle_reminders.sql | ✅ Run in both Supabase — lifecycle_reminder_log table + run_lifecycle_reminders() function + pg_cron job active at 3:30 UTC (9 AM IST) |
| 🟡 MED | 2FA | Enable TOTP in Supabase → Authentication → MFA |
| 🟡 MED | MSG91 Email | Verify sportechinnolab.org domain in GoDaddy |
| 🟡 MED | Custom domain | Add CNAME in GoDaddy → portal.sportechinnolab.org |
| 🟡 MED | Storage bucket | Create employee-documents bucket (private) in both Supabase projects |

---

## DATABASE MIGRATIONS

### Production (fqyyvdtjzswdkgrkytam) — Status

| File | Status |
|---|---|
| supabase_schema.sql | ✅ |
| supabase_migration_attendance.sql | ✅ |
| supabase_migration_profile.sql | ✅ |
| supabase_migration_onboarding_wizard.sql | ✅ |
| supabase_migration_notifications.sql | ✅ |
| supabase_migration_gender.sql | ✅ |
| supabase_migration_halfday.sql | ✅ |
| supabase_migration_leave_adjustments.sql | ✅ |
| supabase_migration_payslips_announcements.sql | ✅ |
| supabase_migration_onboarding_form.sql | ✅ |
| supabase_bugfix_smoke_test.sql | ✅ |
| supabase_migration_founders_resequence.sql | ✅ |
| supabase_migration_okrs.sql | ✅ |
| supabase_migration_policy_chat.sql | ✅ |
| policy_categories RLS (manual SQL) | ✅ |
| lr_delete_own RLS (manual SQL) | ⚠️ PENDING |
| supabase_migration_unpaid_leave.sql | ⚠️ PENDING |
| supabase_migration_onboarding_documents_fix.sql | ✅ |
| supabase_migration_education_docs.sql | ✅ |
| supabase_migration_attendance_sessions.sql | ⚠️ PENDING |
| supabase_migration_attendance_regularization.sql | ⚠️ PENDING |
| supabase_migration_holiday_optins.sql | ⚠️ PENDING |
| supabase_migration_manager_transfers.sql | ⚠️ PENDING |
| supabase_migration_lifecycle_reminders.sql | ✅ DEPLOYED |

### Test (uzysmoeyrenbhpbdxled) — Status

| File | Status |
|---|---|
| supabase_test_environment_schema.sql | ✅ |
| seed_test_data.sql | ✅ |
| policy_categories RLS (manual SQL) | ✅ |
| lr_delete_own RLS (manual SQL) | ⚠️ PENDING |
| supabase_migration_unpaid_leave.sql | ⚠️ PENDING |
| supabase_migration_onboarding_documents_fix.sql | ✅ |
| supabase_migration_employee_documents_schema_sync.sql | ✅ (Test-only fix — Production already had these columns) |
| supabase_migration_storage_policies_test_sync.sql | ✅ (Test-only fix — Production already had these policies) |
| supabase_migration_education_docs.sql | ✅ |
| supabase_migration_attendance_sessions.sql | ⚠️ PENDING |
| supabase_migration_attendance_regularization.sql | ⚠️ PENDING |
| supabase_migration_holiday_optins.sql | ⚠️ PENDING |
| supabase_migration_manager_transfers.sql | ⚠️ PENDING |

---

## KEY FILE PATHS

```
src/
  App.jsx                          — 17 routes defined
  lib/
    constants.js                   — design tokens, LEAVE_TYPES, FEMALE_ONLY_LEAVES, DEPARTMENTS
    supabase.js                    — Supabase client
    api.js                         — auth, leave CRUD, cancelLeave, applyLeave (isHalfDay), updateLeaveStatus (direct update, paid/unpaid split)
    api.attendance.js              — checkIn/checkOut, deductHalfDayLeave, overrideAttendance
    api.profile.js                 — uploadProfilePhoto (createSignedUrl), uploadDocument (createSignedUrl, document_type col)
    api.onboarding.js              — createEmployeeWithPassword, inviteEmployee, approveEmployee, seedLeaveBalances
    api.notifications.js           — all events, realtime subscription, runDailyChecks
    api.payslips.js                — savePayslip, getMyPayslips, calcPayslipTotals
    api.announcements.js           — createAnnouncement (notifies all), toggleReaction, addComment
    api.okrs.js                    — cycles, objectives, key results, checkins, recalcObjectiveProgress
    api.policies.js                — getPolicies, createPolicy, uploadPolicyFile (createSignedUrl), publishPolicy, acknowledgePolicy
    api.chat.js                    — channels, DMs, messages, reactions, uploadChatFile
    email.notifications.js         — MSG91 (awaiting domain)
  components/
    layout/
      Sidebar.jsx                  — overflowY:auto (scrollable), window.location.href logout
      ProtectedRoute.jsx           — gates: session, pending, rejected, onboarding form, requireHR
      NotificationBell.jsx         — realtime, unread count, mark read
    ui/index.jsx                   — Card, Avatar, Badge (status-aware), Button, Input, Select, Spinner, EmptyState, Alert
    OnboardingFormFull.jsx         — 4-step form, notifies HR on submit
    EmployeeICard.jsx              — QR via api.qrserver.com, html2canvas download
    PayslipDocument.jsx            — PNG download
    TwoFactorAuth.jsx              — TwoFactorSetup, TwoFactorVerify
  pages/
    employee/
      LeavePage.jsx                — half-day toggle, cancel, unpaid warning, balance cards
      AttendancePage.jsx           — checkin/checkout, WFH, monthly calendar
      ProfilePage.jsx              — 8 tabs, photo, documents, I-Card, 2FA, exit
      PayslipsPage.jsx             — employee view
      AnnouncementsPage.jsx        — post (HR), react, comment, realtime
      TeamDirectoryPage.jsx        — search, filter, manager join
      PerformancePage.jsx          — OKRs, progress rings, check-ins
      PolicyCentrePage.jsx         — categories load in modal, upload, publish, acknowledge
      ChatPage.jsx                 — channels+DMs, files, reactions, realtime
      DashboardPage.jsx            — stats, leave balances, attendance, announcements
    hr/
      HRDashboardPage.jsx          — pending leaves (approve/reject), stats, attendance
      HRLeaveManagementPage.jsx    — pending requests, balances, adjust, record offline
      HRPayslipsPage.jsx           — generate, bank auto-fill, preview, download
      HRAttendancePage.jsx         — team view, override
      EmployeeManagementPage.jsx   — create, invite, approve, edit (EditEmployeeModal + ManagerSelector), deactivate
  tests/                           — 105 tests, all passing
  context/AuthContext.jsx          — session, employee, isHR, isAdmin, refetchEmployee
supabase/functions/create-employee/index.ts
public/ — manifest.json, sw.js, offline.html, logo.png, icons/, splash/
project.md — THIS FILE
```

---

## DESIGN SYSTEM

| Token | Value |
|---|---|
| Brand blue | #126dad |
| Purple | #9b75f1 |
| Teal | #00d4aa |
| Sidebar dark | #1a0f2e |
| Gradient | linear-gradient(90deg, #9b75f1, #126dad, #00d4aa, #a4ff3d) |
| Font display | Plus Jakarta Sans |
| Font body | Inter |
| Font mono | JetBrains Mono |

---

## BACKLOG

1. Documents module — personal file locker per employee (upload PAN, Aadhaar, certificates)
2. Expenses module — submit, approve, track reimbursements
3. Push notifications via MSG91 (pending domain verification)
4. Custom domain portal.sportechinnolab.org
5. Analytics dashboard — headcount, leave trends, attendance heatmap
