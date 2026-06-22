# STRIDE — PROJECT REFERENCE
**Last updated:** 2026-06-22
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
`38df042` — Unpaid leave - warning on apply, auto-split on approval, LOP tracking

## LOCALLY BUILT (NOT YET PUSHED)
- `src/tests/api.announcements.test.js` — email tests rewritten with proper mocks
- `src/tests/api.leave.test.js` — leave approval test updated for direct balance update
- `project.md` — this file

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
- Register (self-registration with pending approval gate)
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

### ✅ Attendance
- Check-in / check-out with WFH toggle
- Late mark auto-detection (after 9:30am)
- Half day auto-detection on early checkout (deducts 0.5 from casual_sick)
- Monthly calendar view
- HR attendance override (30 days back)
- HR attendance report with export

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

### ✅ PWA
- Standalone app, start at /dashboard
- Full offline caching, offline fallback page
- 8 icon sizes, 10 iOS splash screens
- Install prompt (Android auto, iOS manual)

### ✅ Tests
- 105 tests across 6 files — all passing
- api.attendance, api.leave, api.payslips, api.announcements, constants, validation

---

## PENDING ACTIONS (Manual steps required)

| Priority | Item | Action |
|---|---|---|
| 🔴 HIGH | SQL: lr_delete_own policy | Run in both Supabase: `CREATE POLICY "lr_delete_own" ON leave_requests FOR DELETE TO authenticated USING (employee_id = (SELECT id FROM employees WHERE user_id = auth.uid()));` |
| 🔴 HIGH | SQL: supabase_migration_unpaid_leave.sql | Run in both Supabase — adds unpaid_days, paid_days columns |
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

### Test (uzysmoeyrenbhpbdxled) — Status

| File | Status |
|---|---|
| supabase_test_environment_schema.sql | ✅ |
| seed_test_data.sql | ✅ |
| policy_categories RLS (manual SQL) | ✅ |
| lr_delete_own RLS (manual SQL) | ⚠️ PENDING |
| supabase_migration_unpaid_leave.sql | ⚠️ PENDING |

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
