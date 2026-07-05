# Dashboard Redesign Design Spec
**Date:** 2026-07-05
**Scope:** HR/Admin landing page + Employee landing page — both served from `/dashboard`

---

## Problem

The current `DashboardPage.jsx` (549 lines) serves two completely different audiences — HR/Admin and employees — in a single monolithic file with one massive `useEffect`. The HR view only surfaces leave requests; it misses regularizations, transfers, expiring certifications, and probation endings. The employee view shows data but never tells the employee what to do next. Both pages feel like data dumps, not intelligent tools.

---

## Goals

1. Split the monolithic file into focused, independently maintainable pages
2. Give HR/Admin a unified "needs attention" action inbox across all pending workflows
3. Give employees a personal pulse + smart prompts that change based on their actual situation
4. Maintain the existing clean & professional visual language (existing `C` tokens, `Card`/`Badge`/`Avatar` components)

---

## Architecture

### Files Changed

| File | Change |
|---|---|
| `src/pages/employee/DashboardPage.jsx` | Rewritten as ~15-line router — delegates to `AdminLandingPage` or `EmployeeLandingPage` based on `isHR` |
| `src/pages/hr/AdminLandingPage.jsx` | **New** — HR/Admin command center (extracted + redesigned from `AdminDashboard`) |
| `src/pages/employee/EmployeeLandingPage.jsx` | **New** — Employee dashboard (extracted + redesigned from `EmployeeDashboard`) |
| `src/lib/api.dashboard.js` | **New** — dashboard-specific data fetchers |
| `src/pages/hr/HRDashboardPage.jsx` | **Untouched** — leave management detail page |
| `src/lib/api.js`, `src/lib/api.attendance.js` | **Untouched** — existing API functions stay where they are |

No routing changes. Both dashboards remain at `/dashboard`. All existing imports in other files are unaffected.

### Data Flow

`DashboardPage.jsx` reads `isHR` from `useAuth()` and renders either `<AdminLandingPage>` or `<EmployeeLandingPage>`. Each page owns its own `useEffect` and state — no shared data loading.

---

## New API File: `src/lib/api.dashboard.js`

Five functions. All use the existing `supabase` client. All return plain arrays (no throwing on empty).

### HR Functions

```js
getPendingRegularizationsForHR()
```
Queries `attendance_regularization` joined with `employees` (for `full_name`).
Filter: `status IN ('pending_admin', 'pending_manager')`.
Returns: `[{ id, employee_id, full_name, date, status, created_at }]`

```js
getPendingTransfersForHR()
```
Queries `manager_transfers` joined with `employees` (for `full_name`) and a second join for `to_manager_name`.
Filter: `status IN ('pending_hr', 'pending_target')`.
Returns: `[{ id, employee_id, full_name, to_manager_name, status, created_at }]`

```js
getExpiringCertificationsForHR()
```
Queries `employee_certifications` joined with `employees` (for `full_name`).
Filter: `expiry_date` between today (IST) and today + 30 days.
Returns: `[{ id, employee_id, full_name, certification_name, expiry_date }]`

```js
getProbationEndingSoon()
```
Queries `employees`.
Filter: `status = 'active'` AND `employee_type IN ('intern', 'probation')` AND `joining_date + interval '6 months'` falls within today + 14 days.
Calculation done client-side: `endDate = new Date(joining_date); endDate.setMonth(endDate.getMonth() + 6)`.
Returns: `[{ id, full_name, employee_type, joining_date, end_date, days_left }]`

### Employee Functions

```js
getMyUnregularizedSessions(employeeId)
```
Queries `attendance_sessions`.
Filter: `employee_id = employeeId` AND `date >= today - 14 days` AND `check_out IS NULL`.
Returns: `[{ id, date, check_in, status }]` — sessions that may need regularization or correction.

```js
getMyExpiringCertifications(employeeId)
```
Queries `employee_certifications`.
Filter: `employee_id = employeeId` AND `expiry_date` between today (IST) and today + 30 days.
Returns: `[{ id, certification_name, expiry_date }]`

---

## HR / Admin Landing Page (`AdminLandingPage.jsx`)

### Layer 1 — Action Inbox

**Summary chips row** (horizontal, wraps on mobile): one chip per category showing the pending count. Chips with count > 0 are colored; chips at zero are muted.

| Chip label | Color when active | Data source |
|---|---|---|
| `N Pending Leaves` | `C.amber` | `leave_requests` status=pending |
| `N Regularizations` | `C.amber` | `getPendingRegularizationsForHR()` |
| `N Transfers` | `C.brand` | `getPendingTransfersForHR()` |
| `N Expiring Certs` | `C.accent` | `getExpiringCertificationsForHR()` |
| `N Probation Ending` | `C.accent` | `getProbationEndingSoon()` |

**Unified urgency feed** below the chips. All items across all five categories are merged into one list, sorted by urgency score:
- Urgency = days until deadline (or days since created for open requests)
- Red border (`C.accent`): ≤ 7 days or pending > 5 days
- Amber border (`C.amber`): 7–14 days or pending 3–5 days
- Blue border (`C.brand`): informational / > 14 days

Each row:
```
[color border] [category tag] [employee name]   [description]        [age/deadline]   [action link]
  🔴            Probation       Priya Sharma      Ends in 3 days       3 days left      View →
  🔴            Leave           Ravi Kumar        Earned · 2 days      Pending 6 days   Approve / Reject
  🟡            Certification   Amit Joshi        Passport             Expires 12d      View →
  🔵            Transfer        Neha Patel        → Rahul Sharma       Pending 2 days   Review →
```

Action links navigate to the relevant management page:
- Leave → inline approve/reject buttons (calls existing `updateLeaveStatus`)
- Regularization → `/hr/attendance`
- Transfer → `/hr/employees`
- Certification / Probation → `/hr/employees` (employee detail)

**Empty state:** When all five counts are zero, render a single full-width card: `✅ All caught up — no pending actions today.`

Max items shown in feed: 15. If more exist, show `+N more items` footer with "View all →" links per category.

### Layer 2 — Team Health

Three-column grid (collapses to 1 col on mobile). All data already fetched by existing calls.

**Column 1 — Today's Attendance**
List of active employees with avatar, name, department, check-in time, and `AttendBadge`. Shows first 8 rows. `+N more` if overflow. "Full Report →" links to `/hr/attendance`.

**Column 2 — Team Breakdown**
Department bar chart (same as current `AdminDashboard`). Employment type chips below.

**Column 3 — Upcoming Events**
Merged list: holidays in next 14 days + birthdays in next 30 days, sorted by date. Each row shows the event name/person name, date, and days-until chip.

**Announcements strip** below the three-column grid. Compact cards, pinned first. Max 3 shown.

### Data Loading

```js
// All fetched in parallel in one useEffect
Promise.all([
  getAllLeaveRequests(),              // existing
  getAllEmployees(),                  // existing
  getTeamAttendanceByDate(todayISO()), // existing
  getHolidays(year),                 // existing
  getAnnouncements(),                // existing
  getPendingRegularizationsForHR(),  // new
  getPendingTransfersForHR(),        // new
  getExpiringCertificationsForHR(),  // new
  getProbationEndingSoon(),          // new
])
```

---

## Employee Landing Page (`EmployeeLandingPage.jsx`)

### Layer 1 — Personal Pulse

Greeting header: `Good {morning/afternoon/evening}, {firstName} 👋` (same `getTimeOfDay()` helper, moved to a shared utils location or copied).

Four stat cards in a row (2×2 on mobile):

| Card | Value | Color |
|---|---|---|
| Today's Status | Check-in time if present, otherwise "Not checked in" | Green if present, accent if absent |
| Earned Leave Left | Remaining earned leave days + thin progress bar | `C.brand` |
| This Week | `{logged}h / {target}h` + progress bar | `C.teal` |
| Pending | Count of pending leave + regularization requests | `C.amber` (0 = muted) |

### Layer 2 — Smart Prompts

Only rendered if there is at least one prompt. Otherwise renders:
```
✅ Nothing needs your attention today.
```
(Styled as a muted green-tinted card, not an empty state — this is a positive signal.)

Prompt items, in priority order:

| Trigger | Message | Link |
|---|---|---|
| `getMyUnregularizedSessions()` returns items | `Regularize your attendance for {date}` (one per session, max 3) | `/attendance` |
| Pending leave request exists | `Your {type} leave request is awaiting approval` | `/leaves` |
| Certification expiry ≤ 30 days | `Your {cert_name} expires in {N} days` | `/profile` |
| Probation ends ≤ 14 days (client-side calc) | `Your probation period ends in {N} days` | — |
| Holiday within 7 days | `{Holiday name} is in {N} days — {weekday}` | — |

Each prompt row: colored left dot + message + optional action link. Red dot ≤ 7 days, amber 7–30 days, blue informational.

Certification and probation data: reuse what's already loaded — `employee` object from `useAuth()` (has `joining_date`, `employee_type`) and a new fetch for `getMyExpiringCertifications(employeeId)` — same query as HR version but filtered to `employee_id = me`.

Add `getMyExpiringCertifications(employeeId)` to `api.dashboard.js` as a sixth function.

### Layer 3 — Supporting Info

Two-column grid (stacked on mobile):

**Left — Leave Balances**
The existing `BalanceCard` grid, unchanged. Gender-filtered (maternity only for female). "Manage →" links to `/leaves`.

**Right column (top to bottom):**
1. Recent Leave Requests — last 5, same existing row style. "View all →" to `/leaves`.
2. Upcoming Holidays — next 7 days only (not 14, less noise for employees). Same existing style.
3. Announcements — top 3, pinned first. Same existing style.
4. Upcoming Team Leave — compact avatar list of teammates on leave in the next 7 days. Same `UpcomingLeaveCard` component.

### Data Loading

```js
Promise.all([
  getMyLeaveBalances(employee.id),           // existing
  getMyLeaveRequests(employee.id),           // existing
  getAnnouncements(),                        // existing
  getTodayAttendance(employee.id),           // existing
  getHolidays(year),                         // existing
  getWeeklyHours(employee.id, weekStart),    // existing
  getUpcomingApprovedLeaves(),               // existing
  getMyUnregularizedSessions(employee.id),  // new
  getMyExpiringCertifications(employee.id), // new
])
```

---

## Visual Conventions (both pages)

- **Color only for status** — not decoration. Red = urgent/overdue. Amber = approaching/pending. Green = healthy/complete. Blue = informational.
- **Left border on cards** = the urgency signal. 4px solid `C.accent` / `C.amber` / `C.brand`.
- **Typography** — `Sora` for numbers and headings, `DM Sans` for body. Same as current.
- **No new UI components needed** — `Card`, `Badge`, `Tag`, `Avatar`, `Button`, `EmptyState`, `Spinner`, `SectionTitle` all reused from `../../components/ui`.
- **Responsive** — uses existing `useResponsive()` + `cols()` helpers throughout.

---

## What This Is NOT

- No new routes
- No changes to leave approval logic
- No changes to attendance APIs
- No new Supabase migrations (all queries use existing tables)
- No email or notification changes
- No changes to `HRDashboardPage.jsx`

---

## Success Criteria

1. HR opens `/dashboard` and immediately sees everything that needs a decision — across leaves, regularizations, transfers, certifications, and probation — in one feed
2. Employee opens `/dashboard` and sees their current status in under 3 seconds, plus any prompts specific to them
3. If there is nothing pending on either side, the page communicates that clearly (not just empty)
4. `DashboardPage.jsx` is ≤ 20 lines
5. All 214 existing tests continue to pass (no existing API functions changed)
