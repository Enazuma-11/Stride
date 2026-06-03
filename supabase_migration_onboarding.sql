-- ============================================================
-- MIGRATION: Add onboarding columns to employees table
-- Run this in Supabase Dashboard → SQL Editor
-- (Run AFTER the main supabase_schema.sql)
-- ============================================================

-- Add onboarding tracking columns
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'active'
    CHECK (onboarding_status IN ('invited','active','pending_approval','rejected','offboarded')),
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;

-- Update existing employees to have correct onboarding status
UPDATE employees SET onboarding_status = 'active' WHERE status = 'active';
UPDATE employees SET onboarding_status = 'offboarded' WHERE status = 'inactive';


-- ── RLS policies for self-registration ───────────────────────────────────────

-- Allow unauthenticated INSERT for self-registration (status=inactive only)
-- This lets the /register page create a pending employee row before HR approves
CREATE POLICY "allow_self_registration" ON employees
  FOR INSERT
  WITH CHECK (
    status = 'inactive'
    AND onboarding_status = 'pending_approval'
  );

-- HR can update any employee (for approvals)
DROP POLICY IF EXISTS "hr_manage_employees" ON employees;
CREATE POLICY "hr_manage_employees" ON employees
  FOR ALL
  USING (current_employee_role() IN ('hr', 'admin'));


-- ── Allow the Supabase Admin API (used by invite/create flows) ────────────────
-- The invite and createUser flows use the service_role key on the backend.
-- For a Vite frontend app, these must go through a Supabase Edge Function
-- to keep the service_role key secret.
-- See SETUP_GUIDE.md → Step 7 for the Edge Function setup.


-- ── View: pending registrations (convenience) ────────────────────────────────
CREATE OR REPLACE VIEW pending_registrations AS
  SELECT * FROM employees
  WHERE onboarding_status = 'pending_approval'
  ORDER BY created_at DESC;
