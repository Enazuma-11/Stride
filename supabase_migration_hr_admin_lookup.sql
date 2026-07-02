-- ============================================================
-- STRIDE — HR/ADMIN RECIPIENT LOOKUP FUNCTION
-- Run in: Supabase Dashboard → SQL Editor (both Production and Test projects)
--
-- Why: several flows (leave application, regularization submission,
-- manager approval) need to find active HR/Admin employees to notify.
-- The employees_select_own RLS policy only lets a non-HR/Admin session
-- see its own row, so a regular employee's session querying
-- `employees WHERE role_type IN ('hr','admin')` silently returns zero
-- rows (RLS filters it out — no error, the notification is just never
-- created). This mirrors the existing current_employee_role() pattern:
-- a narrow SECURITY DEFINER function that only exposes employee IDs
-- (not any other employee data) for this one safe, specific purpose.
-- ============================================================

CREATE OR REPLACE FUNCTION get_hr_admin_employee_ids(exclude_id UUID DEFAULT NULL)
RETURNS TABLE(id UUID) AS $$
  SELECT id FROM employees
  WHERE role_type IN ('hr', 'admin')
    AND status = 'active'
    AND (exclude_id IS NULL OR id != exclude_id)
  ORDER BY created_at ASC;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
