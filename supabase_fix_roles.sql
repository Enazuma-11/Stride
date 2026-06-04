-- ============================================================
-- STRIDE — FIX EMPLOYEE ROLES
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Update Amit's role to actual job title
UPDATE employees
SET role = 'Founder & CEO'
WHERE email = 'amit.chobitkar@sportechinnolab.org';

-- Update Edward's role
UPDATE employees
SET role = 'HR Manager'
WHERE email = 'talent@sportechinnolab.org';

-- Verify
SELECT full_name, role, role_type, department FROM employees ORDER BY created_at;
