-- ============================================================
-- SPORTECH INNOVATION LAB — ACCOUNT SETUP SQL
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- IMPORTANT: Run AFTER supabase_schema.sql and both migrations.
-- This creates the employee profile rows for Amit and Edward.
-- You still need to create their AUTH accounts separately
-- (Step 2 below tells you exactly how).
-- ============================================================


-- ── STEP 1: Insert employee profiles ─────────────────────────────────────────
-- Run this block first.

INSERT INTO employees (
  full_name, email, role, role_type, employee_type,
  department, avatar_initials, join_date, status, onboarding_status
) VALUES
  (
    'Amit Chobitkar',
    'amit.chobitkar@sportechinnolab.org',
    'Founder & CEO',
    'admin',
    'permanent',
    'Leadership',
    'AC',
    CURRENT_DATE,
    'active',
    'active'
  ),
  (
    'Edward Francis Paul',
    'talent@sportechinnolab.org',
    'HR Manager',
    'hr',
    'permanent',
    'Human Resources',
    'EP',
    CURRENT_DATE,
    'active',
    'active'
  )
ON CONFLICT (email) DO UPDATE SET
  full_name        = EXCLUDED.full_name,
  role             = EXCLUDED.role,
  role_type        = EXCLUDED.role_type,
  employee_type    = EXCLUDED.employee_type,
  department       = EXCLUDED.department,
  avatar_initials  = EXCLUDED.avatar_initials,
  onboarding_status = EXCLUDED.onboarding_status;


-- ── STEP 2: Seed leave balances for both ─────────────────────────────────────

INSERT INTO leave_balances (employee_id, leave_type, year, total_days)
SELECT e.id, lt.leave_type, EXTRACT(YEAR FROM NOW())::int, lt.total_days
FROM employees e
CROSS JOIN (VALUES
  ('casual'::text, 12),
  ('sick'::text,    8),
  ('earned'::text, 15),
  ('comp'::text,    4)
) AS lt(leave_type, total_days)
WHERE e.email IN (
  'amit.chobitkar@sportechinnolab.org',
  'talent@sportechinnolab.org'
)
ON CONFLICT (employee_id, leave_type, year) DO NOTHING;


-- ── STEP 3: Welcome announcement ─────────────────────────────────────────────

INSERT INTO announcements (title, body, pinned, created_by)
SELECT
  'Welcome to SporTech Innovation Lab Employee Portal 🎉',
  'Your employee portal is now live. Apply for leaves, check your balances, and stay updated on company announcements — all in one place.',
  TRUE,
  id
FROM employees
WHERE email = 'amit.chobitkar@sportechinnolab.org'
ON CONFLICT DO NOTHING;


-- ── STEP 4: Verify the rows were created ─────────────────────────────────────
-- Run this SELECT after the inserts to confirm everything looks right.

SELECT
  id,
  full_name,
  email,
  role,
  role_type,
  employee_type,
  department,
  avatar_initials,
  status,
  onboarding_status
FROM employees
WHERE email IN (
  'amit.chobitkar@sportechinnolab.org',
  'talent@sportechinnolab.org'
)
ORDER BY role_type;


-- ============================================================
-- AFTER RUNNING THIS SQL — CREATE AUTH ACCOUNTS
-- ============================================================
--
-- Go to: Supabase Dashboard → Authentication → Users → Add user
--
-- Account 1 — Amit (Admin):
--   Email    : amit.chobitkar@sportechinnolab.org
--   Password : (set something strong, e.g.  Amit@SporTech2026! )
--   Tick     : "Auto Confirm User"  ← important, skip email verification
--
-- Account 2 — Edward (HR):
--   Email    : talent@sportechinnolab.org
--   Password : (set something strong, e.g.  Edward@SporTech2026! )
--   Tick     : "Auto Confirm User"
--
-- ── STEP 5: Link auth users to employee rows ──────────────────
-- After creating both auth accounts, copy their UUIDs from
-- Authentication → Users (the "User UID" column), then run:
--
--   UPDATE employees
--   SET user_id = 'PASTE-AMIT-UUID-HERE'
--   WHERE email = 'amit.chobitkar@sportechinnolab.org';
--
--   UPDATE employees
--   SET user_id = 'PASTE-EDWARD-UUID-HERE'
--   WHERE email = 'talent@sportechinnolab.org';
--
-- Once linked, both can log in at your portal URL.
-- Amit will see the full Admin view.
-- Edward will see the HR view with leave approvals + employee management.
-- ============================================================
