-- ============================================================
-- STRIDE — ATTENDANCE REGULARIZATION
-- Run in: Supabase Dashboard → SQL Editor (both Production and Test projects)
--
-- Why: employees need a way to request a correction to a day's recorded
-- attendance (e.g. forgot to check out, needed a 6th session). Manager
-- approves/rejects per date, then Admin/HR applies the final correction.
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_regularization_requests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  submitted_at  TIMESTAMPTZ DEFAULT NOW(),
  status        TEXT NOT NULL DEFAULT 'pending_manager'
                CHECK (status IN ('pending_manager','pending_admin','completed'))
);

CREATE TABLE IF NOT EXISTS attendance_regularization_items (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id         UUID NOT NULL REFERENCES attendance_regularization_requests(id) ON DELETE CASCADE,
  date               DATE NOT NULL,
  proposed_check_in  TIMESTAMPTZ NOT NULL,
  proposed_check_out TIMESTAMPTZ NOT NULL,
  reason             TEXT NOT NULL,
  manager_decision   TEXT NOT NULL DEFAULT 'pending' CHECK (manager_decision IN ('pending','approved','rejected')),
  admin_decision     TEXT DEFAULT NULL CHECK (admin_decision IN ('approved','rejected')),
  decided_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regularization_items_request ON attendance_regularization_items (request_id);

ALTER TABLE attendance_regularization_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_regularization_items    ENABLE ROW LEVEL SECURITY;

-- Employee sees/creates own requests; manager sees requests from their direct reports; HR/Admin see all
DROP POLICY IF EXISTS "regularization_requests_select" ON attendance_regularization_requests;
CREATE POLICY "regularization_requests_select" ON attendance_regularization_requests
  FOR SELECT USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
    OR current_employee_role() IN ('hr','admin')
  );

DROP POLICY IF EXISTS "regularization_requests_insert_own" ON attendance_regularization_requests;
CREATE POLICY "regularization_requests_insert_own" ON attendance_regularization_requests
  FOR INSERT WITH CHECK (employee_id = (SELECT id FROM employees WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "regularization_requests_update" ON attendance_regularization_requests;
CREATE POLICY "regularization_requests_update" ON attendance_regularization_requests
  FOR UPDATE USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
    OR current_employee_role() IN ('hr','admin')
  );

-- Items follow the same visibility as their parent request
DROP POLICY IF EXISTS "regularization_items_select" ON attendance_regularization_items;
CREATE POLICY "regularization_items_select" ON attendance_regularization_items
  FOR SELECT USING (
    request_id IN (
      SELECT id FROM attendance_regularization_requests r WHERE
        r.employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
        OR r.employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
        OR current_employee_role() IN ('hr','admin')
    )
  );

DROP POLICY IF EXISTS "regularization_items_insert_own" ON attendance_regularization_items;
CREATE POLICY "regularization_items_insert_own" ON attendance_regularization_items
  FOR INSERT WITH CHECK (
    request_id IN (
      SELECT id FROM attendance_regularization_requests
      WHERE employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "regularization_items_update" ON attendance_regularization_items;
CREATE POLICY "regularization_items_update" ON attendance_regularization_items
  FOR UPDATE USING (
    request_id IN (
      SELECT id FROM attendance_regularization_requests r WHERE
        r.employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
        OR r.employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
        OR current_employee_role() IN ('hr','admin')
    )
  );
