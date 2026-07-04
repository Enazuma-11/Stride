-- ============================================================
-- STRIDE — MANAGER TRANSFER REQUESTS
-- Run in: Supabase Dashboard → SQL Editor (both Production and Test projects)
--
-- Why: a manager needs a way to request moving one of their direct reports
-- to another manager. The receiving manager must accept before HR/Admin
-- gives final approval — only then does employees.manager_id actually
-- change. HR/Admin's existing direct manager-edit in Employee Management
-- is untouched and still bypasses this workflow entirely.
--
-- Also addresses a pre-existing gap: employees_select_own only lets a caller
-- see their own row (or HR/Admin see all), so a regular manager querying the
-- employees table directly — as Team Directory needs to — was silently
-- filtered down to just themselves. Fixed below via a SECURITY DEFINER RPC
-- (get_team_directory) that returns only safe directory columns, rather than
-- broadening the table's own SELECT policy (see comment above that function
-- for why: RLS is row-level, not column-level, so a broadened table policy
-- would have exposed personal columns like home address / DOB company-wide).
-- ============================================================

-- REVERT: this migration originally added a broad "any active employee can
-- read any active employee row" SELECT policy here. Final review caught that
-- Postgres RLS is row-level, not column-level, so that policy exposed every
-- column — including personal_mobile, personal_email, date_of_birth,
-- marital_status, present_address, permanent_address (added by
-- supabase_migration_profile.sql) — company-wide, far beyond what Team
-- Directory actually displays. Replaced with a SECURITY DEFINER RPC below
-- that returns only the safe directory columns; employees' own SELECT
-- policy (employees_select_own, self/HR-only, from supabase_schema.sql) is
-- left untouched.
DROP POLICY IF EXISTS "employees_select_team_directory" ON employees;

-- ─── TEAM DIRECTORY (safe columns only, RLS-safe) ──────────────────────────
-- Returns only the fields Team Directory actually renders, for any active
-- employee to see any other active employee — via SECURITY DEFINER, not a
-- broadened table policy, so no personal/home-address columns are exposed.
CREATE OR REPLACE FUNCTION get_team_directory()
RETURNS TABLE(
  id UUID, full_name TEXT, role TEXT, role_type TEXT, employee_type TEXT,
  department TEXT, email TEXT, phone TEXT, employee_code TEXT,
  avatar_initials TEXT, profile_photo_url TEXT, join_date DATE, status TEXT,
  manager_id UUID, manager_full_name TEXT, manager_avatar_initials TEXT,
  manager_role TEXT, manager_profile_photo_url TEXT
) AS $$
  SELECT
    e.id, e.full_name, e.role, e.role_type, e.employee_type,
    e.department, e.email, e.phone, e.employee_code,
    e.avatar_initials, e.profile_photo_url, e.join_date, e.status,
    e.manager_id, m.full_name, m.avatar_initials,
    m.role, m.profile_photo_url
  FROM employees e
  LEFT JOIN employees m ON m.id = e.manager_id
  WHERE e.status = 'active'
  ORDER BY e.employee_code ASC;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─── NEW TABLE ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manager_transfer_requests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  from_manager_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  to_manager_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reason            TEXT,
  status            TEXT NOT NULL DEFAULT 'pending_target'
                    CHECK (status IN ('pending_target','pending_hr','approved','rejected_by_target','rejected_by_hr','withdrawn')),
  target_decided_at TIMESTAMPTZ,
  hr_decided_by     UUID REFERENCES employees(id) ON DELETE SET NULL,
  hr_decided_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_requests_employee     ON manager_transfer_requests (employee_id);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_from_manager ON manager_transfer_requests (from_manager_id);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_to_manager   ON manager_transfer_requests (to_manager_id);

ALTER TABLE manager_transfer_requests ENABLE ROW LEVEL SECURITY;

-- Visible to the initiating manager, the target manager, or HR/Admin
DROP POLICY IF EXISTS "transfer_requests_select" ON manager_transfer_requests;
CREATE POLICY "transfer_requests_select" ON manager_transfer_requests
  FOR SELECT USING (
    from_manager_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR to_manager_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
  );

-- Only the initiating manager can create a request naming themselves as from_manager_id
DROP POLICY IF EXISTS "transfer_requests_insert" ON manager_transfer_requests;
CREATE POLICY "transfer_requests_insert" ON manager_transfer_requests
  FOR INSERT WITH CHECK (
    from_manager_id = (SELECT id FROM employees WHERE user_id = auth.uid())
  );

-- Same three parties may update (application layer restricts which status
-- transitions each party is actually allowed to make — see api.managerTransfers.js)
--
-- NOTE: intentionally no WITH CHECK here — status-transition rules are
-- enforced in application code (api.managerTransfers.js), not the DB. A
-- hand-crafted request could force this row into an out-of-order terminal
-- status, but that CANNOT change anyone's actual employees.manager_id: that
-- write only happens inside hrDecideTransfer() and is independently gated
-- by employees_update_own (self-only) / hr_manage_employees (HR-only) — so
-- this row's own status cannot be used to escalate into a real manager
-- change. Accepted as a bounded risk after final review (2026-07-03).
DROP POLICY IF EXISTS "transfer_requests_update" ON manager_transfer_requests;
CREATE POLICY "transfer_requests_update" ON manager_transfer_requests
  FOR UPDATE USING (
    from_manager_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR to_manager_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
  );

-- Verify
SELECT routine_name FROM information_schema.routines WHERE routine_name = 'get_team_directory';
SELECT table_name FROM information_schema.tables WHERE table_name = 'manager_transfer_requests';
