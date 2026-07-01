-- ============================================================
-- STRIDE — ATTENDANCE SESSIONS (multi check-in/out per day)
-- Run in: Supabase Dashboard → SQL Editor (both Production and Test projects)
--
-- Why: attendance previously supported one check-in/check-out pair per
-- employee per day (UNIQUE employee_id, date). This adds a sessions table
-- so employees can check in/out multiple times per day (break management),
-- with the existing `attendance` table becoming a computed daily aggregate
-- recalculated from these sessions (see api.attendance.js).
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  check_in     TIMESTAMPTZ NOT NULL,
  check_out    TIMESTAMPTZ,
  is_wfh       BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_employee_checkin
  ON attendance_sessions (employee_id, check_in DESC);

ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attendance_sessions_select" ON attendance_sessions;
CREATE POLICY "attendance_sessions_select" ON attendance_sessions
  FOR SELECT USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin','manager')
  );

DROP POLICY IF EXISTS "attendance_sessions_insert_own" ON attendance_sessions;
CREATE POLICY "attendance_sessions_insert_own" ON attendance_sessions
  FOR INSERT WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
  );

DROP POLICY IF EXISTS "attendance_sessions_update" ON attendance_sessions;
CREATE POLICY "attendance_sessions_update" ON attendance_sessions
  FOR UPDATE USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
  );

DROP POLICY IF EXISTS "attendance_sessions_delete_hr" ON attendance_sessions;
CREATE POLICY "attendance_sessions_delete_hr" ON attendance_sessions
  FOR DELETE USING (current_employee_role() IN ('hr','admin'));
