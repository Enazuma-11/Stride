-- ============================================================
-- STRIDE — UNPAID LEAVE MIGRATION
-- Run in: Supabase Dashboard → SQL Editor
-- Run on BOTH production and test projects
-- ============================================================

-- Add unpaid tracking to leave_requests
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS unpaid_days NUMERIC(5,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_days   NUMERIC(5,1) DEFAULT 0;

-- Add unpaid total to leave_balances
ALTER TABLE leave_balances
  ADD COLUMN IF NOT EXISTS unpaid_days_taken NUMERIC(5,1) DEFAULT 0;

-- ─── UPCOMING APPROVED LEAVE (company-wide, RLS-safe) ─────────────────────
-- leave_requests' RLS policy (lr_select_own) only lets a session see its
-- own rows, or an hr/admin/manager session see all rows. A regular
-- employee's session querying this table directly for "everyone's
-- upcoming leave" would be silently filtered to just their own rows — no
-- error, just wrong data. This SECURITY DEFINER function (matching the
-- existing get_hr_admin_employee_ids pattern) exposes only the minimal
-- fields needed for the company-wide "who's upcoming on leave" view,
-- for ANY authenticated caller, regardless of role.
CREATE OR REPLACE FUNCTION get_upcoming_approved_leaves(as_of_date DATE, max_rows INT DEFAULT 10)
RETURNS TABLE(employee_id UUID, full_name TEXT, avatar_initials TEXT, from_date DATE, to_date DATE) AS $$
  SELECT e.id, e.full_name, e.avatar_initials, lr.from_date, lr.to_date
  FROM leave_requests lr
  JOIN employees e ON e.id = lr.employee_id
  WHERE lr.status = 'approved' AND lr.to_date >= as_of_date
  ORDER BY lr.from_date ASC
  LIMIT max_rows;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'leave_requests'
  AND column_name IN ('unpaid_days', 'paid_days')
ORDER BY column_name;
