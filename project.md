# STRIDE — PROJECT REFERENCE
**Last updated:** 2026-06-20
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
`ec70916` — Fix all notification events - leave apply, approve, reject, announcements, onboarding

## LOCALLY BUILT (NOT YET PUSHED)
- `src/lib/api.js` — cancelLeave added, applyLeave includes is_half_day, leave deduction uses direct update
- `src/pages/employee/LeavePage.jsx` — half-day toggle, cancel button, fixed balance display
- `src/pages/hr/HRLeaveManagementPage.jsx` — pending leave requests section with approve/reject

---

## TEAM

| Code | Name | Email | Role | Auth |
|---|---|---|---|---|
| SIL-000001 | Dr. Pinaze Dubash | pinaze@sportechinnolab.org | Founder & Board Advisor | ✅ Created |
| SIL-000002 | Sanand Salil Mitra | sanand@sportechinnolab.org | Founder & CTO | ✅ Created |
| SIL-000003 | Edward Francis Paul | talent@sportechinnolab.org | HR Manager | ✅ |
| SIL-000004 | Amit Chobitkar | amit.chobitkar@sportechinnolab.org | Founder & CEO / Admin | ✅ |
| SIL-000005 | Sanjusha Nagwani | sanjusha.nagwani@sportechinnolab.org | Full Stack Developer | ✅ |
| TRN-000001 | Stuti Gohil | sng19.work@gmail.com | Intern | ✅ |

---

## MODULES STATUS

### ✅ Auth
- Login / Logout (uses window.location.href for reliable redirect)
- Register (self-registration)
- Set Password
- ProtectedRoute with pending/rejected/onboarding gates
- 2FA (TOTP via Google Authenticator) — requires MFA enabled in Supabase dashboard

### ✅ Dashboard
- Admin/HR view — stats, pending approvals, attendance summary, birthdays, holidays
- Employee view — leave balances, today's attendance, announcements

### ✅ Leave Management (Employee)
- Apply leave — full day and half day (0.5 day deduction)
- Cancel leave — pending (direct) or approved (restores balance)
- Leave history with status badges
- Gender-aware leave types (maternity = female only)
- Balance cards with progress bars
- **KNOWN: cancelLeave + half-day UI not yet pushed — in local build**

### ✅ Leave Management (HR)
- View all employees' balances
- Adjust/set individual leave balances with audit trail
- Record offline leave for employee
- **KNOWN: Pending approval section not yet pushed — in local build**
- Approve/reject via HR Dashboard (HRDashboardPage.jsx) — wired and working

### ✅ Attendance
- Check in / check out
- WFH toggle
- Late mark auto-detection
- Half day auto-detection on checkout
- Half day deducts 0.5 from casual_sick leave balance
- Monthly calendar view
- HR attendance override (30 days back)
- HR attendance report with export

### ✅ Profile (8 tabs)
- Personal, Work, Contact, Payroll, Compliance, Emergency, Skills, Exit
- Profile photo upload (uses createSignedUrl, not getPublicUrl)
- 2FA setup in Security tab
- I-Card with QR code + download
- Exit: Employee can submit resignation; HR has separate exit process checklist
- **KNOWN: Document upload in Compliance uses correct signed URL — pushed**

### ✅ Employee Management (HR)
- Create with password
- Invite via email
- Self-registration approval
- Edit employee (role, department, manager, join date)
- Deactivate employee
- Reporting manager assignment

### ✅ Onboarding Form
- 4-step form: Personal → Contact → Bank → Compliance/Documents
- Triggers on first login for invited employees
- Saves to profile, payroll, compliance tables
- Uploads documents to Supabase Storage
- Notifies HR on submission
- Gate: employees cannot access portal until form submitted

### ✅ Payslips
- HR generates per employee per month
- Components: Basic, HRA, Conveyance, Medical, LTA, Special Allowance + deductions
- Bank details auto-populated from employee payroll profile
- Preview before save
- Download as high-res PNG
- Employee views own payslips at /payslips
- HR/Admin goes to /hr/payslips (sidebar routes correctly by role)

### ✅ Announcements
- HR/Admin posts with categories (General/HR/Event/Urgent)
- Pin to top
- Emoji reactions (👍❤️🎉)
- Comments with delete
- Real-time updates
- Notifies all employees on post

### ✅ Team Directory
- Searchable employee cards
- Filter by department
- Shows: photo, name, role, dept, employee ID, email, phone, reporting manager
- Current user highlighted with "YOU" badge

### ✅ Performance / OKRs
- Quarterly cycles (Q2 2026 active, Q3 2026 upcoming)
- Add objectives with description
- Key results with metric types (%, number, ₹, done/not-done)
- Progress rings auto-calculate from key results
- Check-in with notes + progress slider
- Status: On Track / At Risk / Behind / Completed
- HR can toggle between own OKRs and all employees

### ✅ Policy Centre
- Categories: HR Policies, Company Handbook, Benefits, IT & Security, Legal & Compliance, Operations
- HR uploads PDF/doc, saves as draft, publishes when ready
- Employees see published documents, can download
- Optional acknowledgement requirement
- **FIX APPLIED: policy_categories RLS policy added manually in Supabase**

### ✅ Internal Chat
- Channels: #general, #random, #engineering, #hr (HR/Admin creates more)
- Direct messages between any two employees
- File attachments
- Emoji reactions (👍❤️😂😮😢🎉)
- Real-time (Supabase realtime subscription)
- Delete own messages

### ✅ PWA
- manifest.json with SporTech Stride name
- Service worker with full offline caching
- Icons: 8 sizes (72px to 512px)
- iOS splash screens: 10 sizes (iPhone 5 to iPhone 14 Pro Max + iPad)
- Install prompt (Android auto-banner, iOS instructions)
- Offline fallback page

### ✅ Notifications
- In-app bell with unread count
- Real-time via Supabase subscription
- Events covered:
  - Employee applies leave → HR + Admin notified
  - HR approves/rejects leave → Employee notified
  - HR records leave → Employee notified
  - New announcement → All employees notified
  - Employee approved/onboarded → Employee welcome notification
  - Employee submits onboarding form → HR + Admin notified
  - Birthday today → Employee + HR notified (daily check)
  - Holiday in 3 days → All employees notified (daily check)

### ✅ Test Suite (Vitest)
- 112 tests across 6 files — all passing
- `npm test` to run, `npm run test:coverage` for coverage report

---

## PENDING ACTIVATION (Needs manual action)

| Item | Action Required |
|---|---|
| 2FA | Enable TOTP in Supabase → Authentication → MFA |
| MSG91 Email | Verify domain in GoDaddy + add DNS records |
| Custom domain | Add CNAME in GoDaddy → `portal.sportechinnolab.org` |
| Storage bucket | Create `employee-documents` bucket in Supabase Storage (private) |

---

## DATABASE MIGRATIONS (Production — all run)

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
| policy_categories RLS fix (manual SQL) | ✅ |

---

## KEY FILE PATHS

```
src/
  App.jsx                          — routes
  lib/
    constants.js                   — design tokens, leave types, holidays
    supabase.js                    — supabase client
    api.js                         — core: auth, profile, leave, announcements
    api.attendance.js              — check-in/out, monthly data, HR override
    api.profile.js                 — profile photo upload, document upload
    api.onboarding.js              — employee creation flows, approveEmployee
    api.notifications.js           — notifications CRUD, realtime, daily checks
    api.payslips.js                — payslip CRUD, calcPayslipTotals, MONTH_NAMES
    api.announcements.js           — announcements, reactions, comments
    api.okrs.js                    — OKR cycles, objectives, key results, check-ins
    api.policies.js                — policy centre CRUD
    api.chat.js                    — channels, DMs, messages, reactions
    email.notifications.js         — MSG91 email (ready, awaiting domain)
    responsive.js                  — useResponsive hook
  components/
    layout/
      AppShell.jsx                 — main layout wrapper
      Sidebar.jsx                  — white top, dark purple nav, teal active
      TopBar.jsx                   — shows profile photo
      BottomNav.jsx                — mobile bottom nav
      ProtectedRoute.jsx           — auth gates including onboarding form gate
      NotificationBell.jsx         — realtime notification bell
    ui/index.jsx                   — Card, Avatar, Badge, Button, Input, etc.
    OnboardingFormFull.jsx         — 4-step onboarding form
    EmployeeICard.jsx              — I-Card with QR code
    PayslipDocument.jsx            — payslip renderer + download
    TwoFactorAuth.jsx              — 2FA setup and verify
    PWAInstallPrompt.jsx           — PWA install banner
    AttendanceOverridePanel.jsx    — HR attendance override
  pages/
    auth/
      LoginPage.jsx
      RegisterPage.jsx
      SetPasswordPage.jsx
    employee/
      DashboardPage.jsx
      LeavePage.jsx                — ⚠️ LOCAL BUILD NOT PUSHED (half-day + cancel)
      AttendancePage.jsx
      ProfilePage.jsx
      PayslipsPage.jsx
      AnnouncementsPage.jsx
      TeamDirectoryPage.jsx
      PerformancePage.jsx
      PolicyCentrePage.jsx
      ChatPage.jsx
    hr/
      HRDashboardPage.jsx          — leave approvals here
      HRAttendancePage.jsx
      EmployeeManagementPage.jsx
      HRLeaveManagementPage.jsx    — ⚠️ LOCAL BUILD NOT PUSHED (pending section)
      HRPayslipsPage.jsx
  tests/
    setup.js
    constants.test.js
    api.attendance.test.js
    api.payslips.test.js
    api.leave.test.js
    api.announcements.test.js
    validation.test.js
  context/AuthContext.jsx          — session, employee, isHR, refetchEmployee
supabase/functions/create-employee/index.ts  — Edge Function
public/
  manifest.json, sw.js, offline.html, logo.png
  icons/ (8 sizes), splash/ (10 sizes)
```

---

## DESIGN SYSTEM

| Token | Value |
|---|---|
| Brand blue | #126dad |
| Purple | #9b75f1 |
| Teal | #00d4aa |
| Gradient | linear-gradient(90deg, #9b75f1, #126dad, #00d4aa, #a4ff3d) |
| Sidebar dark | #1a0f2e |
| Font display | Plus Jakarta Sans |
| Font body | Inter |
| Font mono | JetBrains Mono |

---

## KNOWN ISSUES / TODO

| Priority | Issue | Status |
|---|---|---|
| 🔴 HIGH | LeavePage half-day + cancel not pushed | Locally built, needs push |
| 🔴 HIGH | HRLeaveManagementPage pending section not pushed | Locally built, needs push |
| 🟡 MED | 2FA QR code not working | Needs MFA enabled in Supabase dashboard |
| 🟡 MED | MSG91 email not sending | Awaiting GoDaddy domain verification |
| 🟡 MED | Custom domain not configured | Awaiting GoDaddy access |
| 🟢 LOW | Test suite doesn't cover chat, policy, OKR modules | Future work |
| 🟢 LOW | Documents module (personal file locker) | Not yet built |
| 🟢 LOW | Expenses module | Not yet built |

---

## NEXT FEATURES (Backlog)

1. Documents module — personal file locker per employee
2. Expenses module — submit, approve, track
3. Push notifications via MSG91
4. Custom domain setup
5. Performance reviews (self + manager)
6. Analytics dashboard
