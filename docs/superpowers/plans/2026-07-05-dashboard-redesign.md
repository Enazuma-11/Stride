# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic DashboardPage into a focused HR command center and a smart employee dashboard, adding a unified action inbox and personal smart prompts.

**Architecture:** `DashboardPage.jsx` becomes a 15-line router; `AdminLandingPage.jsx` owns the HR view (action inbox + team health); `EmployeeLandingPage.jsx` owns the employee view (pulse + smart prompts + supporting info). New `api.dashboard.js` supplies 6 dashboard-specific data fetchers.

**Tech Stack:** React 18, Vite, Supabase JS client, Vitest, existing `C` color tokens and UI components (`Card`, `Badge`, `Tag`, `Avatar`, `Button`, `EmptyState`, `SectionTitle`, `Spinner`).

## Global Constraints

- No new Supabase migrations — all queries use existing tables
- No route changes — both dashboards remain at `/dashboard`
- No changes to `HRDashboardPage.jsx`, `api.js`, or `api.attendance.js`
- Color tokens from `C` in `../../lib/constants` — no hardcoded hex except where existing code already uses them
- All existing 214 tests must continue to pass
- Fonts: Sora for headings/numbers, DM Sans for body (same `@import` as existing pages)

---

### Task 1: Data Layer — `api.dashboard.js` + tests

**Files:**
- Create: `src/lib/api.dashboard.js`
- Create: `src/tests/api.dashboard.test.js`

**Interfaces:**
- Consumes: `supabase` from `./supabase`, `todayISO` and `addDaysISO` from `./api.attendance`
- Produces:
  - `getPendingRegularizationsForHR() → Promise<Array<{id, employee_id, full_name, status, created_at}>>`
  - `getPendingTransfersForHR() → Promise<Array<{id, employee_id, full_name, to_manager_name, status, created_at}>>`
  - `getExpiringCertificationsForHR() → Promise<Array<{id, employee_id, full_name, title, expiry_date}>>`
  - `getProbationEndingSoon() → Promise<Array<{id, full_name, employee_type, joining_date, end_date, days_left}>>`
  - `getMyUnregularizedSessions(employeeId) → Promise<Array<{id, check_in, check_out, status}>>`
  - `getMyExpiringCertifications(employeeId) → Promise<Array<{id, title, expiry_date}>>`

- [ ] **Step 1: Write the failing tests**

Create `src/tests/api.dashboard.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabase } from '../lib/supabase'

vi.mock('../lib/api.attendance', () => ({
  todayISO:   vi.fn(() => '2026-07-05'),
  addDaysISO: vi.fn((date, days) => {
    const d = new Date(date)
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }),
}))

import {
  getPendingRegularizationsForHR,
  getPendingTransfersForHR,
  getExpiringCertificationsForHR,
  getProbationEndingSoon,
  getMyUnregularizedSessions,
  getMyExpiringCertifications,
} from '../lib/api.dashboard'

beforeEach(() => { vi.clearAllMocks() })

// ── getPendingRegularizationsForHR ────────────────────────────────────────────
describe('getPendingRegularizationsForHR', () => {
  it('returns mapped records', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [{ id: 'r1', employee_id: 'emp-1', status: 'pending_admin', created_at: '2026-07-01T09:00:00Z', employee: { full_name: 'Priya Sharma' } }],
            error: null,
          }),
        }),
      }),
    })
    const result = await getPendingRegularizationsForHR()
    expect(supabase.from).toHaveBeenCalledWith('attendance_regularization_requests')
    expect(result).toEqual([{ id: 'r1', employee_id: 'emp-1', full_name: 'Priya Sharma', status: 'pending_admin', created_at: '2026-07-01T09:00:00Z' }])
  })

  it('returns empty array when data is null', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    })
    expect(await getPendingRegularizationsForHR()).toEqual([])
  })

  it('throws on Supabase error', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        }),
      }),
    })
    await expect(getPendingRegularizationsForHR()).rejects.toThrow('DB error')
  })
})

// ── getPendingTransfersForHR ──────────────────────────────────────────────────
describe('getPendingTransfersForHR', () => {
  it('returns mapped records with manager name', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [{ id: 't1', employee_id: 'emp-1', status: 'pending_hr', created_at: '2026-07-01T09:00:00Z', employee: { full_name: 'Ravi Kumar' }, to_manager: { full_name: 'Neha Patel' } }],
            error: null,
          }),
        }),
      }),
    })
    const result = await getPendingTransfersForHR()
    expect(supabase.from).toHaveBeenCalledWith('manager_transfers')
    expect(result[0]).toMatchObject({ id: 't1', full_name: 'Ravi Kumar', to_manager_name: 'Neha Patel' })
  })

  it('returns empty array when data is null', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    })
    expect(await getPendingTransfersForHR()).toEqual([])
  })

  it('throws on Supabase error', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        }),
      }),
    })
    await expect(getPendingTransfersForHR()).rejects.toThrow('DB error')
  })
})

// ── getExpiringCertificationsForHR ────────────────────────────────────────────
describe('getExpiringCertificationsForHR', () => {
  it('returns mapped certification records', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'c1', employee_id: 'emp-1', title: 'Passport', expiry_date: '2026-07-20', employee: { full_name: 'Amit Joshi' } }],
              error: null,
            }),
          }),
        }),
      }),
    })
    const result = await getExpiringCertificationsForHR()
    expect(supabase.from).toHaveBeenCalledWith('employee_certifications')
    expect(result[0]).toMatchObject({ id: 'c1', full_name: 'Amit Joshi', title: 'Passport' })
  })

  it('throws on Supabase error', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      }),
    })
    await expect(getExpiringCertificationsForHR()).rejects.toThrow('DB error')
  })
})

// ── getProbationEndingSoon ────────────────────────────────────────────────────
describe('getProbationEndingSoon', () => {
  it('includes employees whose 6-month mark is within 14 days', async () => {
    // joining_date 2026-01-05 → end = 2026-07-05 → days_left = 0 → included
    // joining_date 2026-01-01 → end = 2026-07-01 → days_left = -4 → excluded
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: [
              { id: 'emp-1', full_name: 'Priya', employee_type: 'intern',    joining_date: '2026-01-05' },
              { id: 'emp-2', full_name: 'Ravi',  employee_type: 'probation', joining_date: '2026-01-01' },
            ],
            error: null,
          }),
        }),
      }),
    })
    const result = await getProbationEndingSoon()
    expect(result.some(e => e.id === 'emp-1')).toBe(true)
    expect(result.some(e => e.id === 'emp-2')).toBe(false)
  })

  it('returns empty array when no active interns/probationers', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    })
    expect(await getProbationEndingSoon()).toEqual([])
  })

  it('throws on Supabase error', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        }),
      }),
    })
    await expect(getProbationEndingSoon()).rejects.toThrow('DB error')
  })
})

// ── getMyUnregularizedSessions ────────────────────────────────────────────────
describe('getMyUnregularizedSessions', () => {
  it('returns open sessions for the employee', async () => {
    const raw = [{ id: 's1', check_in: '2026-07-03T09:00:00Z', check_out: null, status: 'present' }]
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: raw, error: null }),
            }),
          }),
        }),
      }),
    })
    const result = await getMyUnregularizedSessions('emp-1')
    expect(supabase.from).toHaveBeenCalledWith('attendance_sessions')
    expect(result).toEqual(raw)
  })

  it('returns empty array when data is null', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      }),
    })
    expect(await getMyUnregularizedSessions('emp-1')).toEqual([])
  })

  it('throws on Supabase error', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
            }),
          }),
        }),
      }),
    })
    await expect(getMyUnregularizedSessions('emp-1')).rejects.toThrow('DB error')
  })
})

// ── getMyExpiringCertifications ───────────────────────────────────────────────
describe('getMyExpiringCertifications', () => {
  it('returns certifications expiring within 30 days', async () => {
    const raw = [{ id: 'c1', title: 'Passport', expiry_date: '2026-07-20' }]
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            lte: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: raw, error: null }),
            }),
          }),
        }),
      }),
    })
    const result = await getMyExpiringCertifications('emp-1')
    expect(supabase.from).toHaveBeenCalledWith('employee_certifications')
    expect(result).toEqual(raw)
  })

  it('throws on Supabase error', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            lte: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
            }),
          }),
        }),
      }),
    })
    await expect(getMyExpiringCertifications('emp-1')).rejects.toThrow('DB error')
  })
})
```

- [ ] **Step 2: Run tests — verify they all fail**

```bash
npm test -- api.dashboard
```
Expected: 18 failures — module `../lib/api.dashboard` not found.

- [ ] **Step 3: Create `src/lib/api.dashboard.js`**

```js
import { supabase } from './supabase'
import { todayISO, addDaysISO } from './api.attendance'

export async function getPendingRegularizationsForHR() {
  const { data, error } = await supabase
    .from('attendance_regularization_requests')
    .select('id, employee_id, status, created_at, employee:employee_id(full_name)')
    .in('status', ['pending_admin', 'pending_manager'])
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    id: r.id,
    employee_id: r.employee_id,
    full_name: r.employee?.full_name || 'Unknown',
    status: r.status,
    created_at: r.created_at,
  }))
}

export async function getPendingTransfersForHR() {
  const { data, error } = await supabase
    .from('manager_transfers')
    .select('id, employee_id, status, created_at, employee:employee_id(full_name), to_manager:to_manager_id(full_name)')
    .in('status', ['pending_hr', 'pending_target'])
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    id: r.id,
    employee_id: r.employee_id,
    full_name: r.employee?.full_name || 'Unknown',
    to_manager_name: r.to_manager?.full_name || 'Unknown',
    status: r.status,
    created_at: r.created_at,
  }))
}

export async function getExpiringCertificationsForHR() {
  const today  = todayISO()
  const future = addDaysISO(today, 30)
  const { data, error } = await supabase
    .from('employee_certifications')
    .select('id, employee_id, title, expiry_date, employee:employee_id(full_name)')
    .gte('expiry_date', today)
    .lte('expiry_date', future)
    .order('expiry_date', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    id: r.id,
    employee_id: r.employee_id,
    full_name: r.employee?.full_name || 'Unknown',
    title: r.title,
    expiry_date: r.expiry_date,
  }))
}

export async function getProbationEndingSoon() {
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name, employee_type, joining_date')
    .eq('status', 'active')
    .in('employee_type', ['intern', 'probation'])
  if (error) throw error
  const today = new Date(todayISO())
  return (data || [])
    .map(e => {
      const end = new Date(e.joining_date)
      end.setMonth(end.getMonth() + 6)
      const daysLeft = Math.ceil((end - today) / 86400000)
      return { ...e, end_date: end.toISOString().split('T')[0], days_left: daysLeft }
    })
    .filter(e => e.days_left >= 0 && e.days_left <= 14)
    .sort((a, b) => a.days_left - b.days_left)
}

export async function getMyUnregularizedSessions(employeeId) {
  const cutoff = addDaysISO(todayISO(), -14)
  const { data, error } = await supabase
    .from('attendance_sessions')
    .select('id, check_in, check_out, status')
    .eq('employee_id', employeeId)
    .gte('check_in', `${cutoff}T00:00:00.000Z`)
    .is('check_out', null)
    .order('check_in', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getMyExpiringCertifications(employeeId) {
  const today  = todayISO()
  const future = addDaysISO(today, 30)
  const { data, error } = await supabase
    .from('employee_certifications')
    .select('id, title, expiry_date')
    .eq('employee_id', employeeId)
    .gte('expiry_date', today)
    .lte('expiry_date', future)
    .order('expiry_date', { ascending: true })
  if (error) throw error
  return data || []
}
```

- [ ] **Step 4: Run tests — verify all 18 pass**

```bash
npm test -- api.dashboard
```
Expected: 18 passed.

- [ ] **Step 5: Run full suite — verify no regressions**

```bash
npm test
```
Expected: 232 passed (214 existing + 18 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/api.dashboard.js src/tests/api.dashboard.test.js
git commit -m "feat: add api.dashboard.js with 6 dashboard-specific data fetchers"
```

---

### Task 2: HR / Admin Landing Page

**Files:**
- Create: `src/pages/hr/AdminLandingPage.jsx`

**Interfaces:**
- Consumes (from Task 1): `getPendingRegularizationsForHR`, `getPendingTransfersForHR`, `getExpiringCertificationsForHR`, `getProbationEndingSoon`
- Consumes (existing): `getAllLeaveRequests`, `updateLeaveStatus`, `getAllEmployees`, `getTeamAttendanceByDate`, `getHolidays`, `getAnnouncements` from `../../lib/api`; `notifyLeaveDecision` from `../../lib/api.notifications`; `todayISO` from `../../lib/api.attendance`
- Produces: default export `AdminLandingPage` — React component, no props

- [ ] **Step 1: Create `src/pages/hr/AdminLandingPage.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import { Card, Avatar, Button, Badge, Tag, Spinner, EmptyState, SectionTitle } from '../../components/ui'
import { C, LEAVE_TYPES, ATTENDANCE_STATUSES } from '../../lib/constants'
import { useResponsive, cols } from '../../lib/responsive'
import { useAuth } from '../../context/AuthContext'
import { getAllLeaveRequests, updateLeaveStatus, getAllEmployees, getAnnouncements, getHolidays } from '../../lib/api'
import { notifyLeaveDecision } from '../../lib/api.notifications'
import { todayISO } from '../../lib/api.attendance'
import { getTeamAttendanceByDate } from '../../lib/api.attendance'
import {
  getPendingRegularizationsForHR,
  getPendingTransfersForHR,
  getExpiringCertificationsForHR,
  getProbationEndingSoon,
} from '../../lib/api.dashboard'

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysUntil(dateStr) {
  return Math.ceil((new Date(dateStr) - new Date(todayISO())) / 86400000)
}

function daysSince(isoTimestamp) {
  return Math.floor((Date.now() - new Date(isoTimestamp)) / 86400000)
}

// ── Action item builder ───────────────────────────────────────────────────────
function buildActionItems(leaves, regs, transfers, certs, probation) {
  const items = []

  leaves.filter(l => l.status === 'pending').forEach(l => {
    const age  = daysSince(l.created_at)
    const lt   = LEAVE_TYPES.find(t => t.id === l.leave_type)
    items.push({
      key:         `leave-${l.id}`,
      category:    'Leave',
      employeeName: l.employee?.full_name || 'Unknown',
      description: `${lt?.label || l.leave_type} · ${l.from_date} → ${l.to_date} · ${l.days}d`,
      age:         `Pending ${age}d`,
      urgency:     Math.max(0, 10 - age),
      borderColor: age >= 5 ? C.accent : age >= 3 ? C.amber : C.brand,
      canApprove:  true,
      leaveId:     l.id,
      link:        null,
      actionLabel: null,
    })
  })

  regs.forEach(r => {
    const age = daysSince(r.created_at)
    items.push({
      key:         `reg-${r.id}`,
      category:    'Regularization',
      employeeName: r.full_name,
      description: 'Attendance regularization pending',
      age:         `Pending ${age}d`,
      urgency:     Math.max(0, 10 - age),
      borderColor: age >= 5 ? C.accent : age >= 3 ? C.amber : C.brand,
      canApprove:  false,
      link:        '/hr/attendance',
      actionLabel: 'Review →',
    })
  })

  transfers.forEach(t => {
    const age = daysSince(t.created_at)
    items.push({
      key:         `transfer-${t.id}`,
      category:    'Transfer',
      employeeName: t.full_name,
      description: `Transfer → ${t.to_manager_name}`,
      age:         `Pending ${age}d`,
      urgency:     Math.max(0, 10 - age),
      borderColor: age >= 5 ? C.accent : age >= 3 ? C.amber : C.brand,
      canApprove:  false,
      link:        '/hr/employees',
      actionLabel: 'Review →',
    })
  })

  certs.forEach(c => {
    const d = daysUntil(c.expiry_date)
    items.push({
      key:         `cert-${c.id}`,
      category:    'Certification',
      employeeName: c.full_name,
      description: `${c.title} expires`,
      age:         `In ${d}d`,
      urgency:     d,
      borderColor: d <= 7 ? C.accent : d <= 14 ? C.amber : C.brand,
      canApprove:  false,
      link:        '/hr/employees',
      actionLabel: 'View →',
    })
  })

  probation.forEach(e => {
    items.push({
      key:         `probation-${e.id}`,
      category:    'Probation',
      employeeName: e.full_name,
      description: `${e.employee_type === 'intern' ? 'Internship' : 'Probation'} ends ${e.end_date}`,
      age:         `In ${e.days_left}d`,
      urgency:     e.days_left,
      borderColor: e.days_left <= 3 ? C.accent : e.days_left <= 7 ? C.amber : C.brand,
      canApprove:  false,
      link:        '/hr/employees',
      actionLabel: 'View →',
    })
  })

  return items.sort((a, b) => a.urgency - b.urgency)
}

// ── Attendance badge ──────────────────────────────────────────────────────────
function AttendBadge({ status }) {
  const s = ATTENDANCE_STATUSES.find(a => a.value === status) || { icon: '❓', color: C.textLight, bg: C.surfaceAlt, label: 'Unknown' }
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      {s.icon} {s.label}
    </span>
  )
}

// ── Single action feed row ────────────────────────────────────────────────────
function ActionRow({ item, onLeaveAction, onNavigate }) {
  return (
    <Card style={{ padding: '14px 18px', borderLeft: `4px solid ${item.borderColor}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
              color: item.borderColor, background: item.borderColor + '18',
              padding: '2px 8px', borderRadius: 12,
            }}>{item.category}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{item.employeeName}</span>
          </div>
          <div style={{ fontSize: 12, color: C.textMid }}>{item.description}</div>
        </div>
        <div style={{ fontSize: 11, color: C.textLight, whiteSpace: 'nowrap' }}>{item.age}</div>
        {item.canApprove ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <Button variant="success" size="sm" onClick={() => onLeaveAction(item.leaveId, 'approved')}>✓ Approve</Button>
            <Button variant="ghost"   size="sm" onClick={() => onLeaveAction(item.leaveId, 'rejected')}>✕ Reject</Button>
          </div>
        ) : item.link ? (
          <button onClick={() => onNavigate(item.link)} style={{
            fontSize: 12, color: C.brand, background: 'none', border: 'none',
            cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap',
          }}>{item.actionLabel}</button>
        ) : null}
      </div>
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AdminLandingPage() {
  const { employee } = useAuth()
  const navigate     = useNavigate()
  const r            = useResponsive()
  const year         = new Date().getFullYear()

  const [leaves,          setLeaves]          = useState([])
  const [employees,       setEmployees]       = useState([])
  const [teamAtt,         setTeamAtt]         = useState([])
  const [holidays,        setHolidays]        = useState([])
  const [announcements,   setAnnouncements]   = useState([])
  const [pendingRegs,     setPendingRegs]     = useState([])
  const [pendingTransfers,setPendingTransfers]= useState([])
  const [expiringCerts,   setExpiringCerts]   = useState([])
  const [probationEnding, setProbationEnding] = useState([])
  const [loading,         setLoading]         = useState(true)

  useEffect(() => {
    Promise.all([
      getAllLeaveRequests(),
      getAllEmployees(),
      getTeamAttendanceByDate(todayISO()),
      getHolidays(year),
      getAnnouncements(),
      getPendingRegularizationsForHR(),
      getPendingTransfersForHR(),
      getExpiringCertificationsForHR(),
      getProbationEndingSoon(),
    ]).then(([lv, emps, att, hols, ann, regs, transfers, certs, probation]) => {
      setLeaves(lv)
      setEmployees(emps)
      setTeamAtt(att)
      setHolidays(hols)
      setAnnouncements(ann)
      setPendingRegs(regs)
      setPendingTransfers(transfers)
      setExpiringCerts(certs)
      setProbationEnding(probation)
    }).finally(() => setLoading(false))
  }, [])

  async function handleLeaveAction(leaveId, status) {
    try {
      const updated = await updateLeaveStatus(leaveId, status, employee.id)
      setLeaves(prev => prev.map(l => l.id === leaveId ? { ...l, status } : l))
      await notifyLeaveDecision(updated, updated.employee_id, status)
    } catch (e) {
      alert('Error: ' + e.message)
    }
  }

  if (loading) return (
    <AppShell title="HR Dashboard">
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><Spinner size={36} /></div>
    </AppShell>
  )

  const attMap       = Object.fromEntries(teamAtt.map(a => [a.employee_id, a]))
  const actionItems  = buildActionItems(leaves, pendingRegs, pendingTransfers, expiringCerts, probationEnding)
  const visibleItems = actionItems.slice(0, 15)
  const hiddenCount  = actionItems.length - 15

  const counts = {
    leaves:    leaves.filter(l => l.status === 'pending').length,
    regs:      pendingRegs.length,
    transfers: pendingTransfers.length,
    certs:     expiringCerts.length,
    probation: probationEnding.length,
  }

  const deptCounts = employees.reduce((acc, e) => {
    const dept = e.department || 'Unassigned'
    acc[dept] = (acc[dept] || 0) + 1
    return acc
  }, {})

  const typeCounts = employees.reduce((acc, e) => {
    const t = e.employee_type || 'permanent'
    acc[t] = (acc[t] || 0) + 1
    return acc
  }, {})

  const upcomingHols = holidays.filter(h => { const d = daysUntil(h.date); return d >= 0 && d <= 14 })

  const upcomingBdays = employees.filter(e => {
    if (!e.date_of_birth) return false
    const dob = new Date(e.date_of_birth)
    const thisYear = new Date(new Date().getFullYear(), dob.getMonth(), dob.getDate())
    const d = Math.ceil((thisYear - new Date(todayISO())) / 86400000)
    return d >= 0 && d <= 30
  })

  const upcomingEvents = [
    ...upcomingHols.map(h => ({ type: 'holiday', name: h.name, date: h.date, days: daysUntil(h.date) })),
    ...upcomingBdays.map(e => {
      const dob      = new Date(e.date_of_birth)
      const thisYear = new Date(new Date().getFullYear(), dob.getMonth(), dob.getDate())
      return { type: 'birthday', name: e.full_name, date: thisYear.toISOString().split('T')[0], days: Math.ceil((thisYear - new Date(todayISO())) / 86400000) }
    }),
  ].sort((a, b) => a.days - b.days).slice(0, 7)

  const sortedAnnouncements = [...announcements].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).slice(0, 3)

  return (
    <AppShell title="HR Dashboard" subtitle="What needs your attention today">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap');`}</style>

      {/* ── Layer 1: Action Inbox ── */}
      <div style={{ marginBottom: 32 }}>
        {/* Summary chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'Pending Leaves',   count: counts.leaves,    color: C.amber  },
            { label: 'Regularizations',  count: counts.regs,      color: C.amber  },
            { label: 'Transfers',        count: counts.transfers, color: C.brand  },
            { label: 'Expiring Certs',   count: counts.certs,     color: C.accent },
            { label: 'Probation Ending', count: counts.probation, color: C.accent },
          ].map(chip => (
            <div key={chip.label} style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              fontFamily: "'DM Sans',sans-serif",
              background: chip.count > 0 ? chip.color + '18' : C.surfaceAlt,
              border:     `1px solid ${chip.count > 0 ? chip.color : C.border}`,
              color:      chip.count > 0 ? chip.color : C.textLight,
            }}>
              {chip.count} {chip.label}
            </div>
          ))}
        </div>

        {/* Unified urgency feed */}
        {actionItems.length === 0 ? (
          <Card style={{ padding: '28px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>✅</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, fontFamily: "'Sora',sans-serif" }}>All caught up</div>
            <div style={{ fontSize: 12, color: C.textLight, marginTop: 4 }}>No pending actions today.</div>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleItems.map(item => (
              <ActionRow key={item.key} item={item} onLeaveAction={handleLeaveAction} onNavigate={navigate} />
            ))}
            {hiddenCount > 0 && (
              <div style={{ padding: '10px 16px', fontSize: 12, color: C.textLight, textAlign: 'center' }}>
                +{hiddenCount} more items
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Layer 2: Team Health ── */}
      <SectionTitle>Team Health</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: cols(r, { mobile: 1, tablet: 1, desktop: 3 }), gap: 20, marginTop: 12 }}>

        {/* Today's attendance */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Today's Attendance</span>
            <button onClick={() => navigate('/hr/attendance')} style={{ fontSize: 11, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Full Report →</button>
          </div>
          <Card padding="0">
            {employees.slice(0, 8).map((emp, i) => {
              const rec = attMap[emp.id]
              return (
                <div key={emp.id} style={{ padding: '10px 14px', borderBottom: i < Math.min(employees.length, 8) - 1 ? `1px solid ${C.border}` : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar initials={emp.avatar_initials || '??'} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.full_name}</div>
                    <div style={{ fontSize: 10, color: C.textLight }}>{emp.department}</div>
                  </div>
                  {rec?.check_in && <div style={{ fontSize: 10, color: C.textMid }}>{new Date(rec.check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</div>}
                  <AttendBadge status={rec?.status || 'absent'} />
                </div>
              )
            })}
            {employees.length > 8 && <div style={{ padding: '8px 14px', fontSize: 11, color: C.textLight, textAlign: 'center' }}>+{employees.length - 8} more</div>}
          </Card>
        </div>

        {/* Team breakdown */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Team Breakdown</div>
          <Card style={{ padding: '16px 18px' }}>
            {Object.entries(deptCounts).sort((a, b) => b[1] - a[1]).map(([dept, count]) => (
              <div key={dept} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: C.text, fontWeight: 500 }}>{dept}</span>
                  <span style={{ fontWeight: 700, color: C.brand }}>{count}</span>
                </div>
                <div style={{ height: 4, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${(count / employees.length) * 100}%`, height: '100%', background: C.brand, borderRadius: 4 }} />
                </div>
              </div>
            ))}
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {Object.entries(typeCounts).map(([type, count]) => (
                <div key={type} style={{ fontSize: 11, color: C.textMid }}>
                  <span style={{ fontWeight: 700, color: C.brand }}>{count}</span> {type}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Upcoming events */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Upcoming Events</div>
          {upcomingEvents.length === 0 ? (
            <Card style={{ padding: '20px', textAlign: 'center' }}><div style={{ fontSize: 12, color: C.textLight }}>No upcoming events in the next 14 days.</div></Card>
          ) : (
            <Card padding="0">
              {upcomingEvents.map((ev, i) => (
                <div key={`${ev.type}-${ev.name}-${ev.date}`} style={{ padding: '10px 14px', borderBottom: i < upcomingEvents.length - 1 ? `1px solid ${C.border}` : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 18 }}>{ev.type === 'holiday' ? '🎉' : '🎂'}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{ev.name}</div>
                    <div style={{ fontSize: 10, color: C.textLight }}>{new Date(ev.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: ev.days === 0 ? C.accent : C.teal, background: ev.days === 0 ? C.accentSoft : C.tealSoft, padding: '2px 8px', borderRadius: 20 }}>
                    {ev.days === 0 ? 'Today' : `In ${ev.days}d`}
                  </span>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>

      {/* Announcements strip */}
      {sortedAnnouncements.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <SectionTitle>Announcements</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {sortedAnnouncements.map(a => (
              <Card key={a.id} style={{ padding: '12px 16px', borderLeft: `3px solid ${a.pinned ? C.accent : C.brand}` }}>
                {a.pinned && <div style={{ fontSize: 9, color: C.accent, fontWeight: 700, letterSpacing: 1, marginBottom: 2 }}>📌 PINNED</div>}
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{a.title}</div>
                <div style={{ fontSize: 12, color: C.textMid, marginTop: 2 }}>{a.body}</div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </AppShell>
  )
}
```

- [ ] **Step 2: Verify the app loads without errors**

Start dev server and open `/dashboard` as an HR/Admin user. Check browser console for errors. The page should show the action inbox and team health sections.

- [ ] **Step 3: Commit**

```bash
git add src/pages/hr/AdminLandingPage.jsx
git commit -m "feat: add AdminLandingPage with action inbox and team health"
```

---

### Task 3: Employee Landing Page

**Files:**
- Create: `src/pages/employee/EmployeeLandingPage.jsx`

**Interfaces:**
- Consumes (from Task 1): `getMyUnregularizedSessions`, `getMyExpiringCertifications`
- Consumes (existing): `getMyLeaveBalances`, `getMyLeaveRequests`, `getAnnouncements`, `getUpcomingApprovedLeaves`, `getAllLeaveRequests` from `../../lib/api`; `getTodayAttendance`, `getHolidays`, `todayISO`, `getWeeklyHours`, `getWeekStart` from `../../lib/api.attendance`; `OnboardingWizard` from `../../components/OnboardingWizard`
- Produces: default export `EmployeeLandingPage` — React component, no props

- [ ] **Step 1: Create `src/pages/employee/EmployeeLandingPage.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import { Card, SectionTitle, Avatar, Tag, Badge, Spinner, EmptyState } from '../../components/ui'
import { C, LEAVE_TYPES, FEMALE_ONLY_LEAVES, ATTENDANCE_STATUSES } from '../../lib/constants'
import { useAuth } from '../../context/AuthContext'
import { useResponsive, cols } from '../../lib/responsive'
import { getMyLeaveBalances, getMyLeaveRequests, getAnnouncements, getUpcomingApprovedLeaves } from '../../lib/api'
import { getTodayAttendance, getHolidays, todayISO, getWeeklyHours, getWeekStart } from '../../lib/api.attendance'
import { getMyUnregularizedSessions, getMyExpiringCertifications } from '../../lib/api.dashboard'

// ── Helpers ───────────────────────────────────────────────────────────────────
function getTimeOfDay() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function daysUntil(dateStr) {
  return Math.ceil((new Date(dateStr) - new Date(todayISO())) / 86400000)
}

// ── Smart prompt builder ──────────────────────────────────────────────────────
function buildSmartPrompts({ unregularized, myRequests, expiringCerts, employee, holidays }) {
  const prompts  = []
  const today    = new Date(todayISO())

  unregularized.slice(0, 3).forEach(s => {
    const dateStr = s.check_in.split('T')[0]
    prompts.push({
      key:       `unreg-${s.id}`,
      dot:       C.accent,
      message:   `Regularize your attendance for ${new Date(dateStr).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}`,
      link:      '/attendance',
      linkLabel: 'Regularize →',
    })
  })

  const pendingLeaves = myRequests.filter(r => r.status === 'pending')
  if (pendingLeaves.length > 0) {
    const lt = LEAVE_TYPES.find(t => t.id === pendingLeaves[0].leave_type)
    prompts.push({
      key:       'pending-leave',
      dot:       C.amber,
      message:   `Your ${lt?.label || 'leave'} request is awaiting approval`,
      link:      '/leaves',
      linkLabel: 'View →',
    })
  }

  expiringCerts.forEach(c => {
    const d = Math.ceil((new Date(c.expiry_date) - today) / 86400000)
    prompts.push({
      key:       `cert-${c.id}`,
      dot:       d <= 7 ? C.accent : C.amber,
      message:   `Your ${c.title} expires in ${d} day${d !== 1 ? 's' : ''}`,
      link:      '/profile',
      linkLabel: 'View →',
    })
  })

  if (employee?.employee_type && ['intern', 'probation'].includes(employee.employee_type) && employee.joining_date) {
    const end = new Date(employee.joining_date)
    end.setMonth(end.getMonth() + 6)
    const d = Math.ceil((end - today) / 86400000)
    if (d >= 0 && d <= 14) {
      prompts.push({
        key:       'probation-end',
        dot:       d <= 3 ? C.accent : C.amber,
        message:   `Your ${employee.employee_type === 'intern' ? 'internship' : 'probation'} period ends in ${d} day${d !== 1 ? 's' : ''}`,
        link:      null,
        linkLabel: null,
      })
    }
  }

  holidays.filter(h => { const d = daysUntil(h.date); return d >= 0 && d <= 7 }).forEach(h => {
    const d = daysUntil(h.date)
    prompts.push({
      key:       `holiday-${h.id}`,
      dot:       C.teal,
      message:   `${h.name} is ${d === 0 ? 'today' : `in ${d} day${d !== 1 ? 's' : ''}`} — ${new Date(h.date).toLocaleDateString('en-IN', { weekday: 'long' })}`,
      link:      null,
      linkLabel: null,
    })
  })

  return prompts
}

// ── Leave balance card ────────────────────────────────────────────────────────
function BalanceCard({ lt, balance }) {
  const total     = Number(balance?.total_days ?? lt.total ?? 0)
  const used      = Number(balance?.used_days  ?? 0)
  const remaining = Math.max(0, total - used)
  const pct       = total > 0 ? (remaining / total) * 100 : 0
  return (
    <Card style={{ padding: '16px 18px' }}>
      <div style={{ fontSize: 10, color: C.textLight, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>{lt.label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: lt.color, lineHeight: 1, fontFamily: "'Sora',sans-serif" }}>{remaining}</span>
        <span style={{ fontSize: 12, color: C.textLight, marginBottom: 2 }}>/ {total}</span>
      </div>
      <div style={{ height: 3, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: lt.color, borderRadius: 4 }} />
      </div>
      <div style={{ fontSize: 10, color: C.textLight, marginTop: 5 }}>{total - remaining} used</div>
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function EmployeeLandingPage() {
  const { employee }  = useAuth()
  const navigate      = useNavigate()
  const r             = useResponsive()
  const year          = new Date().getFullYear()

  const [balances,       setBalances]       = useState([])
  const [myRequests,     setMyRequests]     = useState([])
  const [announcements,  setAnnouncements]  = useState([])
  const [todayAtt,       setTodayAtt]       = useState(null)
  const [weekly,         setWeekly]         = useState(null)
  const [holidays,       setHolidays]       = useState([])
  const [upcomingLeaves, setUpcomingLeaves] = useState([])
  const [unregularized,  setUnregularized]  = useState([])
  const [expiringCerts,  setExpiringCerts]  = useState([])
  const [loading,        setLoading]        = useState(true)

  useEffect(() => {
    if (!employee) return
    Promise.all([
      getMyLeaveBalances(employee.id),
      getMyLeaveRequests(employee.id),
      getAnnouncements(),
      getTodayAttendance(employee.id),
      getHolidays(year),
      getWeeklyHours(employee.id, getWeekStart(todayISO())),
      getUpcomingApprovedLeaves(),
      getMyUnregularizedSessions(employee.id),
      getMyExpiringCertifications(employee.id),
    ]).then(([bal, req, ann, att, hols, wk, upcoming, unreg, certs]) => {
      setBalances(bal)
      setMyRequests(req)
      setAnnouncements(ann)
      setTodayAtt(att)
      setHolidays(hols)
      setWeekly(wk)
      setUpcomingLeaves(upcoming)
      setUnregularized(unreg)
      setExpiringCerts(certs)
    }).finally(() => setLoading(false))
  }, [employee])

  if (loading) return (
    <AppShell title="Dashboard">
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><Spinner size={36} /></div>
    </AppShell>
  )

  const attStatus   = todayAtt ? ATTENDANCE_STATUSES.find(a => a.value === todayAtt.status) : null
  const earnedBal   = balances.find(b => b.leave_type === 'earned')
  const earnedTotal = Number(earnedBal?.total_days ?? 18)
  const earnedUsed  = Number(earnedBal?.used_days  ?? 0)
  const earnedLeft  = Math.max(0, earnedTotal - earnedUsed)
  const pendingCount = myRequests.filter(r => r.status === 'pending').length

  const prompts = buildSmartPrompts({ unregularized, myRequests, expiringCerts, employee, holidays })

  const pinnedAnn = [...announcements].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).slice(0, 3)
  const upcomingHols = holidays.filter(h => { const d = daysUntil(h.date); return d >= 0 && d <= 7 })

  return (
    <AppShell title={`Good ${getTimeOfDay()}, ${employee?.full_name?.split(' ')[0]} 👋`}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap');`}</style>

      {/* ── Layer 1: Personal Pulse ── */}
      <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: r.isMobile ? 10 : 12, marginBottom: 24 }}>
        {[
          {
            label: "Today's Status",
            val:   attStatus ? `${attStatus.icon} ${attStatus.label}` : 'Not checked in',
            sub:   todayAtt?.check_in ? new Date(todayAtt.check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : null,
            color: attStatus ? C.green : C.accent,
            bg:    attStatus ? C.greenSoft : C.accentSoft,
          },
          {
            label: 'Earned Leave Left',
            val:   String(earnedLeft),
            sub:   `${earnedUsed} used of ${earnedTotal}`,
            color: C.brand,
            bg:    C.brandLight,
          },
          {
            label: 'This Week',
            val:   weekly ? `${weekly.totalHours}h` : '—',
            sub:   weekly ? `of ${weekly.targetHours}h target` : null,
            color: C.teal,
            bg:    C.tealSoft,
          },
          {
            label: 'Pending',
            val:   String(pendingCount),
            sub:   pendingCount === 0 ? 'All clear' : `request${pendingCount > 1 ? 's' : ''} awaiting`,
            color: pendingCount > 0 ? C.amber : C.green,
            bg:    pendingCount > 0 ? C.amberSoft : C.greenSoft,
          },
        ].map(s => (
          <Card key={s.label} style={{ padding: '16px 20px', borderLeft: `3px solid ${s.color}` }}>
            <div style={{ fontSize: 10, color: C.textLight, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: "'Sora',sans-serif", marginBottom: 2 }}>{s.val}</div>
            {s.sub && <div style={{ fontSize: 10, color: C.textLight }}>{s.sub}</div>}
          </Card>
        ))}
      </div>

      {/* Weekly hours progress bar */}
      {weekly && (
        <Card style={{ padding: '14px 18px', marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>This Week</span>
            <span style={{ fontSize: 11, color: C.textMid }}>{weekly.totalHours} / {weekly.targetHours} hrs</span>
          </div>
          <div style={{ height: 5, borderRadius: 6, background: C.border, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(100, Math.round((weekly.totalHours / weekly.targetHours) * 100))}%`, background: C.brand, borderRadius: 6, transition: 'width 0.3s' }} />
          </div>
        </Card>
      )}

      {/* ── Layer 2: Smart Prompts ── */}
      <div style={{ marginBottom: 28 }}>
        <SectionTitle>Your Actions</SectionTitle>
        {prompts.length === 0 ? (
          <Card style={{ padding: '16px 20px', marginTop: 10, borderLeft: `3px solid ${C.green}`, background: C.greenSoft }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.green }}>✅ Nothing needs your attention today.</div>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {prompts.map(p => (
              <Card key={p.key} style={{ padding: '12px 16px', borderLeft: `3px solid ${p.dot}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.dot, flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 13, color: C.text }}>{p.message}</div>
                  {p.link && (
                    <button onClick={() => navigate(p.link)} style={{ fontSize: 12, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>{p.linkLabel}</button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ── Layer 3: Supporting Info ── */}
      <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 320px', gap: 20 }}>
        {/* Leave balances */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <SectionTitle>Leave Balances</SectionTitle>
            <button onClick={() => navigate('/leaves')} style={{ fontSize: 11, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Manage →</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: cols(r, { mobile: 2, tablet: 3, desktop: 4 }), gap: 10, marginBottom: 20 }}>
            {LEAVE_TYPES.filter(lt => !FEMALE_ONLY_LEAVES.includes(lt.id) || employee?.gender === 'female').map(lt => (
              <BalanceCard key={lt.id} lt={lt} balance={balances.find(b => b.leave_type === lt.id)} />
            ))}
          </div>

          {/* Recent leave requests */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <SectionTitle>Recent Leave Requests</SectionTitle>
            <button onClick={() => navigate('/leaves')} style={{ fontSize: 11, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>View all →</button>
          </div>
          {myRequests.length === 0 ? (
            <EmptyState icon="🏖️" title="No leave requests yet" subtitle="Apply for your first leave!" />
          ) : (
            <Card padding="0">
              {myRequests.slice(0, 5).map((req, i) => {
                const lt = LEAVE_TYPES.find(t => t.id === req.leave_type)
                return (
                  <div key={req.id} style={{ padding: '12px 16px', borderBottom: i < Math.min(myRequests.length, 5) - 1 ? `1px solid ${C.border}` : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <Tag label={lt?.label || req.leave_type} color={lt?.color || C.brand} />
                        <span style={{ fontSize: 11, color: C.textLight }}>{req.from_date} → {req.to_date}</span>
                      </div>
                      <div style={{ fontSize: 11, color: C.textMid }}>{req.reason}</div>
                    </div>
                    <Badge status={req.status} />
                  </div>
                )
              })}
            </Card>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Upcoming holidays */}
          <div>
            <SectionTitle>Upcoming Holidays</SectionTitle>
            {upcomingHols.length === 0 ? (
              <Card style={{ padding: '14px 16px', marginTop: 8 }}><div style={{ fontSize: 12, color: C.textLight }}>No holidays in the next 7 days.</div></Card>
            ) : (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {upcomingHols.map(h => {
                  const d = daysUntil(h.date)
                  return (
                    <Card key={h.id} style={{ padding: '10px 14px', borderLeft: `3px solid ${C.teal}` }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{h.name}</div>
                      <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>
                        {new Date(h.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                        {' · '}
                        <span style={{ color: d === 0 ? C.accent : C.teal, fontWeight: 600 }}>
                          {d === 0 ? 'Today' : `In ${d} day${d !== 1 ? 's' : ''}`}
                        </span>
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>

          {/* Announcements */}
          <div>
            <SectionTitle>Announcements</SectionTitle>
            {pinnedAnn.length === 0 ? (
              <Card style={{ padding: '14px 16px', marginTop: 8 }}><div style={{ fontSize: 12, color: C.textLight }}>No announcements yet.</div></Card>
            ) : (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pinnedAnn.map(a => (
                  <Card key={a.id} style={{ padding: '10px 14px', borderLeft: `3px solid ${a.pinned ? C.accent : C.brand}` }}>
                    {a.pinned && <div style={{ fontSize: 9, color: C.accent, fontWeight: 700, letterSpacing: 1, marginBottom: 2 }}>📌 PINNED</div>}
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{a.title}</div>
                    <div style={{ fontSize: 11, color: C.textMid, marginTop: 2 }}>{a.body}</div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming team leave */}
          {upcomingLeaves.length > 0 && (
            <div>
              <SectionTitle>Team on Leave</SectionTitle>
              <Card style={{ padding: '14px 16px', marginTop: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {upcomingLeaves.slice(0, 5).map(l => (
                    <div key={`${l.employee_id}-${l.from_date}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar initials={l.avatar_initials || '??'} size={26} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{l.full_name}</div>
                        <div style={{ fontSize: 10, color: C.textLight }}>{l.from_date}{l.from_date !== l.to_date ? ` – ${l.to_date}` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
```

- [ ] **Step 2: Verify the page loads**

Open `/dashboard` as a regular employee. Check for console errors. Confirm pulse cards, smart prompts section (or "Nothing needs your attention" card), and leave balances render correctly.

- [ ] **Step 3: Commit**

```bash
git add src/pages/employee/EmployeeLandingPage.jsx
git commit -m "feat: add EmployeeLandingPage with personal pulse and smart prompts"
```

---

### Task 4: Wire the Router

**Files:**
- Modify: `src/pages/employee/DashboardPage.jsx` (full rewrite — 549 lines → ~20 lines)

**Interfaces:**
- Consumes: `AdminLandingPage` from `../hr/AdminLandingPage`, `EmployeeLandingPage` from `./EmployeeLandingPage`, `useAuth` from `../../context/AuthContext`, `OnboardingWizard` from `../../components/OnboardingWizard`
- The old `AdminDashboard`, `EmployeeDashboard`, `BalanceCard`, `WeeklyHoursCard`, `UpcomingLeaveCard`, `AttendBadge` components that were defined in `DashboardPage.jsx` are now each defined inside their respective new page files. Safe to remove from here.

- [ ] **Step 1: Rewrite `src/pages/employee/DashboardPage.jsx`**

Replace the entire file content with:

```jsx
import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import AdminLandingPage from '../hr/AdminLandingPage'
import EmployeeLandingPage from './EmployeeLandingPage'
import OnboardingWizard from '../../components/OnboardingWizard'

export default function DashboardPage() {
  const { employee, isHR } = useAuth()
  const [showWizard, setShowWizard] = useState(false)

  useEffect(() => {
    if (employee && !employee.onboarding_completed) {
      setTimeout(() => setShowWizard(true), 800)
    }
  }, [employee])

  return (
    <>
      {showWizard && <OnboardingWizard onComplete={() => setShowWizard(false)} />}
      {isHR
        ? <AdminLandingPage />
        : <EmployeeLandingPage />
      }
    </>
  )
}
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```
Expected: 232 passed (no regressions).

- [ ] **Step 3: Start dev server and verify both views**

```bash
npm run dev
```

Open `/dashboard` as an HR/Admin user:
- Summary chips row visible with counts
- Action feed shows items (or "All caught up" if none)
- Team Health section shows attendance + breakdown + events

Open `/dashboard` as a regular employee:
- 4 pulse cards (Today's Status, Earned Leave Left, This Week, Pending)
- Smart prompts section (or "Nothing needs your attention today")
- Leave balances grid
- Right column: holidays + announcements + team leave

- [ ] **Step 4: Commit**

```bash
git add src/pages/employee/DashboardPage.jsx
git commit -m "refactor: DashboardPage becomes thin router; delegate to AdminLandingPage and EmployeeLandingPage"
```
