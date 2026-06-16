-- ============================================================
-- STRIDE — FOUNDERS + ID RESEQUENCE MIGRATION
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ── Step 1: Update existing employee codes ────────────────────────────────────
UPDATE employees SET employee_code = 'SIL-000003' WHERE email = 'talent@sportechinnolab.org';
UPDATE employees SET employee_code = 'SIL-000004' WHERE email = 'amit.chobitkar@sportechinnolab.org';
UPDATE employees SET employee_code = 'SIL-000005' WHERE email = 'sanjusha.nagwani@sportechinnolab.org';
UPDATE employees SET employee_code = 'TRN-000001' WHERE email = 'sng19.work@gmail.com';

-- ── Step 2: Add gender column if missing ─────────────────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS gender TEXT;

-- ── Step 3: Create auth accounts for founders ────────────────────────────────
-- Note: Run these via Supabase Auth Admin or Edge Function
-- Here we prepare the employee rows assuming auth will be created separately

-- Founder 1: Dr. Pinaze Dubash
-- First check if auth user exists, if not we'll insert employee row with null user_id
-- and link later when auth account is created

INSERT INTO employees (
  user_id, full_name, email, role, role_type, employee_type,
  department, avatar_initials, gender, join_date,
  status, onboarding_status, onboarding_completed, employee_code
)
SELECT
  au.id,
  'Dr. Pinaze Dubash',
  'pinaze@sportechinnolab.org',
  'Founder & Board Advisor',
  'admin',
  'permanent',
  'Board Administration',
  'PD',
  'female',
  '2021-04-26',
  'active',
  'active',
  true,
  'SIL-000001'
FROM auth.users au
WHERE au.email = 'pinaze@sportechinnolab.org'
ON CONFLICT (employee_code) DO NOTHING;

-- If auth user doesn't exist yet, insert without user_id
INSERT INTO employees (
  full_name, email, role, role_type, employee_type,
  department, avatar_initials, gender, join_date,
  status, onboarding_status, onboarding_completed, employee_code
)
SELECT
  'Dr. Pinaze Dubash',
  'pinaze@sportechinnolab.org',
  'Founder & Board Advisor',
  'admin',
  'permanent',
  'Board Administration',
  'PD',
  'female',
  '2021-04-26',
  'active',
  'active',
  true,
  'SIL-000001'
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'pinaze@sportechinnolab.org'
)
ON CONFLICT (employee_code) DO NOTHING;

-- Founder 2: Sanand Salil Mitra
INSERT INTO employees (
  user_id, full_name, email, role, role_type, employee_type,
  department, avatar_initials, gender, join_date,
  status, onboarding_status, onboarding_completed, employee_code
)
SELECT
  au.id,
  'Sanand Salil Mitra',
  'sanand@sportechinnolab.org',
  'Founder & CTO',
  'admin',
  'permanent',
  'Engineering',
  'SS',
  'male',
  '2021-04-26',
  'active',
  'active',
  true,
  'SIL-000002'
FROM auth.users au
WHERE au.email = 'sanand@sportechinnolab.org'
ON CONFLICT (employee_code) DO NOTHING;

INSERT INTO employees (
  full_name, email, role, role_type, employee_type,
  department, avatar_initials, gender, join_date,
  status, onboarding_status, onboarding_completed, employee_code
)
SELECT
  'Sanand Salil Mitra',
  'sanand@sportechinnolab.org',
  'Founder & CTO',
  'admin',
  'permanent',
  'Engineering',
  'SS',
  'male',
  '2021-04-26',
  'active',
  'active',
  true,
  'SIL-000002'
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'sanand@sportechinnolab.org'
)
ON CONFLICT (employee_code) DO NOTHING;

-- ── Step 4: Seed leave balances for founders ─────────────────────────────────
INSERT INTO leave_balances (employee_id, leave_type, year, total_days, used_days)
SELECT e.id, lt.leave_type, 2026, lt.total_days, 0
FROM employees e
CROSS JOIN (VALUES
  ('earned',      18),
  ('casual_sick', 12),
  ('statutory',   10),
  ('bereavement', 7 ),
  ('exam',        7 ),
  ('maternity',   182)
) AS lt(leave_type, total_days)
WHERE e.email IN ('pinaze@sportechinnolab.org', 'sanand@sportechinnolab.org')
  AND e.email NOT IN (
    SELECT DISTINCT emp.email FROM leave_balances lb
    JOIN employees emp ON emp.id = lb.employee_id
    WHERE emp.email IN ('pinaze@sportechinnolab.org', 'sanand@sportechinnolab.org')
  )
ON CONFLICT DO NOTHING;

-- Remove maternity from Sanand
DELETE FROM leave_balances
WHERE employee_id = (SELECT id FROM employees WHERE email = 'sanand@sportechinnolab.org')
AND leave_type = 'maternity';

-- ── Step 5: Update employee_code generation function ─────────────────────────
-- This ensures future employees get the right format based on type
CREATE OR REPLACE FUNCTION generate_employee_code(emp_type TEXT)
RETURNS TEXT AS $$
DECLARE
  prefix TEXT;
  last_code TEXT;
  next_num INT;
BEGIN
  -- Determine prefix
  IF emp_type = 'intern' THEN
    prefix := 'TRN';
  ELSE
    prefix := 'SIL';
  END IF;

  -- Get highest existing number for this prefix
  SELECT employee_code INTO last_code
  FROM employees
  WHERE employee_code LIKE prefix || '-%'
  ORDER BY employee_code DESC
  LIMIT 1;

  IF last_code IS NULL THEN
    next_num := 1;
  ELSE
    next_num := CAST(SPLIT_PART(last_code, '-', 2) AS INT) + 1;
  END IF;

  RETURN prefix || '-' || LPAD(next_num::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT employee_code, full_name, role, department, status, join_date
FROM employees
ORDER BY employee_code;
