-- ============================================================
-- STRIDE EMPLOYEE PORTAL — SUPABASE SCHEMA
-- SporTech Innovation Lab Pvt Ltd
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ─── EMPLOYEES ───────────────────────────────────────────────
CREATE TABLE employees (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name        TEXT NOT NULL,
  email            TEXT NOT NULL UNIQUE,
  role             TEXT NOT NULL,
  role_type        TEXT NOT NULL DEFAULT 'employee'
                   CHECK (role_type IN ('employee','manager','hr','admin')),
  employee_type    TEXT NOT NULL DEFAULT 'permanent'
                   CHECK (employee_type IN ('permanent','intern','contractor','parttime')),
  department       TEXT NOT NULL,
  avatar_initials  TEXT NOT NULL,
  manager_id       UUID REFERENCES employees(id) ON DELETE SET NULL,
  phone            TEXT,
  join_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  internship_end_date DATE,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','inactive')),
  onboarding_status TEXT NOT NULL DEFAULT 'active'
                   CHECK (onboarding_status IN ('invited','active','pending_approval','rejected','offboarded')),
  must_change_password BOOLEAN DEFAULT FALSE,
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
-- ============================================================
ALTER TABLE employees      ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements  ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's role
CREATE OR REPLACE FUNCTION current_employee_role()
RETURNS TEXT AS $$
  SELECT role_type FROM employees WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- EMPLOYEES policies
CREATE POLICY "employees_select_own" ON employees
  FOR SELECT USING (
    user_id = auth.uid()
    OR current_employee_role() IN ('hr','admin')
  );

CREATE POLICY "employees_update_own" ON employees
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "hr_manage_employees" ON employees
  FOR ALL USING (current_employee_role() IN ('hr','admin'));

CREATE POLICY "allow_self_registration" ON employees
  FOR INSERT WITH CHECK (
    status = 'inactive'
    AND onboarding_status = 'pending_approval'
  );

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

-- ANNOUNCEMENTS policies
CREATE POLICY "announcements_select_all" ON announcements
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "hr_manage_announcements" ON announcements
  FOR ALL USING (current_employee_role() IN ('hr','admin'));
