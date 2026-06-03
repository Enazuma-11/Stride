-- ============================================================
-- SPORTECH EMPLOYEE PORTAL — SUPABASE SCHEMA
-- Run this entire file in: Supabase Dashboard → SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ─── EMPLOYEES ───────────────────────────────────────────────
CREATE TABLE employees (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name        TEXT NOT NULL,
  email            TEXT NOT NULL UNIQUE,
  role             TEXT NOT NULL,           -- Job title e.g. "Senior Developer"
  role_type        TEXT NOT NULL DEFAULT 'employee'
                   CHECK (role_type IN ('employee','manager','hr','admin')),
  department       TEXT NOT NULL,
  avatar_initials  TEXT NOT NULL,           -- e.g. "AM" for Amit Mehta
  manager_id       UUID REFERENCES employees(id) ON DELETE SET NULL,
  phone            TEXT,
  join_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','inactive')),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─── LEAVE BALANCES ──────────────────────────────────────────
CREATE TABLE leave_balances (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type   TEXT NOT NULL CHECK (leave_type IN ('casual','sick','earned','comp')),
  year         INT  NOT NULL DEFAULT EXTRACT(YEAR FROM NOW()),
  total_days   INT  NOT NULL,
  used_days    INT  NOT NULL DEFAULT 0,
  remaining    INT  GENERATED ALWAYS AS (total_days - used_days) STORED,
  UNIQUE (employee_id, leave_type, year)
);

-- ─── LEAVE REQUESTS ──────────────────────────────────────────
CREATE TABLE leave_requests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type   TEXT NOT NULL CHECK (leave_type IN ('casual','sick','earned','comp')),
  from_date    DATE NOT NULL,
  to_date      DATE NOT NULL,
  days         INT  NOT NULL CHECK (days > 0),
  reason       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','rejected')),
  reviewed_by  UUID REFERENCES employees(id),
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ANNOUNCEMENTS ───────────────────────────────────────────
CREATE TABLE announcements (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  pinned      BOOLEAN DEFAULT FALSE,
  created_by  UUID REFERENCES employees(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- STORED PROCEDURE — deduct leave balance on approval
-- ============================================================
CREATE OR REPLACE FUNCTION deduct_leave_balance(
  p_employee_id UUID,
  p_leave_type  TEXT,
  p_days        INT,
  p_year        INT
) RETURNS VOID AS $$
BEGIN
  UPDATE leave_balances
  SET
    used_days  = used_days + p_days,
    updated_at = NOW()
  WHERE
    employee_id = p_employee_id
    AND leave_type = p_leave_type
    AND year       = p_year;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Employees can only see their own data.
-- HR/Admin can see everything.
-- ============================================================
ALTER TABLE employees      ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements  ENABLE ROW LEVEL SECURITY;

-- Helper function to get current employee's role_type
CREATE OR REPLACE FUNCTION current_employee_role()
RETURNS TEXT AS $$
  SELECT role_type FROM employees WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- EMPLOYEES table policies
CREATE POLICY "employees_select_own" ON employees
  FOR SELECT USING (
    user_id = auth.uid()
    OR current_employee_role() IN ('hr','admin')
  );

CREATE POLICY "employees_update_own" ON employees
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "hr_manage_employees" ON employees
  FOR ALL USING (current_employee_role() IN ('hr','admin'));

-- LEAVE BALANCES policies
CREATE POLICY "lb_select_own" ON leave_balances
  FOR SELECT USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
  );

CREATE POLICY "hr_manage_balances" ON leave_balances
  FOR ALL USING (current_employee_role() IN ('hr','admin'));

-- LEAVE REQUESTS policies
CREATE POLICY "lr_select_own" ON leave_requests
  FOR SELECT USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin','manager')
  );

CREATE POLICY "lr_insert_own" ON leave_requests
  FOR INSERT WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
  );

CREATE POLICY "hr_manage_requests" ON leave_requests
  FOR UPDATE USING (current_employee_role() IN ('hr','admin'));

-- ANNOUNCEMENTS policies (everyone reads, only HR writes)
CREATE POLICY "announcements_select_all" ON announcements
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "hr_manage_announcements" ON announcements
  FOR ALL USING (current_employee_role() IN ('hr','admin'));


-- ============================================================
-- SEED DATA — Replace with your real team details
-- Step 1: Create auth users in Supabase Dashboard → Auth → Users
-- Step 2: Copy the UUID from each user and paste below
-- ============================================================

-- Insert employees (update user_id UUIDs after creating auth users)
INSERT INTO employees (full_name, email, role, role_type, department, avatar_initials, join_date) VALUES
  ('Amit Sharma',   'amit@sportech.in',   'Founder & CEO',        'admin',    'Leadership',  'AS', '2024-01-01'),
  ('Priya Nair',    'priya@sportech.in',  'HR Manager',           'hr',       'HR',          'PN', '2024-01-15'),
  ('Rahul Mehta',   'rahul@sportech.in',  'Senior Developer',     'employee', 'Engineering', 'RM', '2024-02-01'),
  ('Anjali Singh',  'anjali@sportech.in', 'UI/UX Designer',       'employee', 'Design',      'AS', '2024-03-01'),
  ('Karan Patel',   'karan@sportech.in',  'Junior Developer',     'employee', 'Engineering', 'KP', '2024-04-01');

-- Set manager relationships (Rahul and Anjali report to Amit, Karan to Rahul)
UPDATE employees SET manager_id = (SELECT id FROM employees WHERE email = 'amit@sportech.in')
  WHERE email IN ('rahul@sportech.in','anjali@sportech.in','priya@sportech.in');
UPDATE employees SET manager_id = (SELECT id FROM employees WHERE email = 'rahul@sportech.in')
  WHERE email = 'karan@sportech.in';

-- Seed leave balances for current year (2026)
INSERT INTO leave_balances (employee_id, leave_type, year, total_days)
SELECT e.id, lt.leave_type, 2026, lt.total
FROM employees e
CROSS JOIN (VALUES
  ('casual', 12), ('sick', 8), ('earned', 15), ('comp', 4)
) AS lt(leave_type, total)
WHERE e.status = 'active';

-- Sample announcement
INSERT INTO announcements (title, body, pinned, created_by)
SELECT
  'Welcome to SporTech Employee Portal! 🎉',
  'Our new employee portal is live. You can now apply for leaves, view your balances, and stay updated on company announcements right here.',
  TRUE,
  id
FROM employees WHERE email = 'amit@sportech.in';
