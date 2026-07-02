-- ============================================================
-- STRIDE — HOLIDAY OPT-IN CALENDAR
-- Run in: Supabase Dashboard → SQL Editor (both Production and Test projects)
--
-- Why: employees now individually choose which `type='optional'` holidays
-- they personally observe (public/company holidays stay mandatory for
-- everyone, unchanged). Two annual windows: Jan 1-14 (whole year),
-- Jul 1-14 (revise Jul-Dec only). See
-- docs/superpowers/specs/2026-07-02-holiday-optin-design.md.
-- ============================================================

CREATE TABLE IF NOT EXISTS holiday_optins (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  holiday_id   UUID NOT NULL REFERENCES holidays(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, holiday_id)
);

CREATE TABLE IF NOT EXISTS holiday_optin_submissions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  window_label TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, window_label)
);

CREATE INDEX IF NOT EXISTS idx_holiday_optins_holiday ON holiday_optins (holiday_id);
CREATE INDEX IF NOT EXISTS idx_holiday_optins_employee ON holiday_optins (employee_id);

ALTER TABLE holiday_optins            ENABLE ROW LEVEL SECURITY;
ALTER TABLE holiday_optin_submissions ENABLE ROW LEVEL SECURITY;

-- Everyone can see everyone's opt-ins (shared visibility — not HR-only)
DROP POLICY IF EXISTS "holiday_optins_select_all" ON holiday_optins;
CREATE POLICY "holiday_optins_select_all" ON holiday_optins
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Employees manage only their own opt-in rows
DROP POLICY IF EXISTS "holiday_optins_manage_own" ON holiday_optins;
CREATE POLICY "holiday_optins_manage_own" ON holiday_optins
  FOR INSERT WITH CHECK (employee_id = (SELECT id FROM employees WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "holiday_optins_delete_own" ON holiday_optins;
CREATE POLICY "holiday_optins_delete_own" ON holiday_optins
  FOR DELETE USING (employee_id = (SELECT id FROM employees WHERE user_id = auth.uid()));

-- Submissions: same shape — everyone can read, employees write only their own
DROP POLICY IF EXISTS "holiday_optin_submissions_select_all" ON holiday_optin_submissions;
CREATE POLICY "holiday_optin_submissions_select_all" ON holiday_optin_submissions
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "holiday_optin_submissions_manage_own" ON holiday_optin_submissions;
CREATE POLICY "holiday_optin_submissions_manage_own" ON holiday_optin_submissions
  FOR INSERT WITH CHECK (employee_id = (SELECT id FROM employees WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "holiday_optin_submissions_update_own" ON holiday_optin_submissions;
CREATE POLICY "holiday_optin_submissions_update_own" ON holiday_optin_submissions
  FOR UPDATE USING (employee_id = (SELECT id FROM employees WHERE user_id = auth.uid()));
