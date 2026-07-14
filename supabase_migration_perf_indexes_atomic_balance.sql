-- ============================================================
-- STRIDE — PERFORMANCE INDEXES + ATOMIC LEAVE BALANCE
-- Run in: Supabase Dashboard → SQL Editor (Production AND Test)
--
-- Fixes:
--   MEDIUM-6  Non-atomic read-modify-write of leave_balances (lost-update race)
--   Adds missing FK/filter indexes used by RLS subqueries and hot queries
-- ============================================================

-- ── 1. Atomic leave-balance adjustment ───────────────────────────────────────
-- Replaces the JS read-then-write (updateLeaveStatus / cancelLeave) with a
-- single atomic UPDATE. GREATEST(0, …) preserves the existing Math.max(0, …)
-- clamping so a balance never goes negative. SECURITY DEFINER so it runs
-- regardless of the caller's row-level policy, but it self-authorizes:
-- only HR/Admin or the balance's owner may adjust it.
CREATE OR REPLACE FUNCTION apply_leave_balance_delta(
  p_employee_id UUID,
  p_leave_type  TEXT,
  p_year        INT,
  p_used_delta  NUMERIC,
  p_unpaid_delta NUMERIC DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_employee_role() NOT IN ('hr', 'admin')
     AND p_employee_id <> current_employee_id() THEN
    RAISE EXCEPTION 'Not authorized to adjust this leave balance.';
  END IF;

  UPDATE leave_balances
     SET used_days         = GREATEST(0, COALESCE(used_days, 0) + p_used_delta),
         unpaid_days_taken = GREATEST(0, COALESCE(unpaid_days_taken, 0) + p_unpaid_delta)
   WHERE employee_id = p_employee_id
     AND leave_type  = p_leave_type
     AND year        = p_year;
END;
$$;
GRANT EXECUTE ON FUNCTION apply_leave_balance_delta(UUID, TEXT, INT, NUMERIC, NUMERIC) TO authenticated;

-- ── 2. Missing indexes on FK / filter columns ────────────────────────────────
-- These columns appear in RLS subqueries, joins, and status filters but had
-- no supporting index, forcing sequential scans as the tables grow.
CREATE INDEX IF NOT EXISTS idx_employees_manager         ON employees(manager_id);
CREATE INDEX IF NOT EXISTS idx_employees_user            ON employees(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_balances_lookup     ON leave_balances(employee_id, leave_type, year);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee   ON leave_requests(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_goal_submissions_manager  ON goal_submissions(manager_id);
CREATE INDEX IF NOT EXISTS idx_perf_reviews_manager      ON performance_reviews(manager_id);
CREATE INDEX IF NOT EXISTS idx_probation_reviews_mgr     ON probation_reviews(manager_id);
CREATE INDEX IF NOT EXISTS idx_notifications_employee    ON notifications(employee_id, is_read);

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT proname FROM pg_proc WHERE proname = 'apply_leave_balance_delta';
