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
-- Also fixes a pre-existing bug: employees_select_own only lets a caller
-- see their own row (or HR/Admin see all), so a regular manager querying
-- the employees table directly — as Team Directory and this feature both
-- need to — was silently filtered down to just themselves. Invisible until
-- now because every account used to test this app so far is HR/Admin.
-- ============================================================

-- ─── FIX: let any active employee read the team directory ─────────────────
DROP POLICY IF EXISTS "employees_select_team_directory" ON employees;
CREATE POLICY "employees_select_team_directory" ON employees
  FOR SELECT USING (
    status = 'active' AND current_employee_role() IS NOT NULL
  );

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
DROP POLICY IF EXISTS "transfer_requests_update" ON manager_transfer_requests;
CREATE POLICY "transfer_requests_update" ON manager_transfer_requests
  FOR UPDATE USING (
    from_manager_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR to_manager_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
  );

-- Verify
SELECT policyname FROM pg_policies WHERE tablename = 'employees' AND policyname = 'employees_select_team_directory';
SELECT table_name FROM information_schema.tables WHERE table_name = 'manager_transfer_requests';
