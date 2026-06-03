-- ============================================================
-- STRIDE — ATTENDANCE MODULE MIGRATION
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ─── ATTENDANCE TABLE ─────────────────────────────────────────
CREATE TABLE attendance (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id    UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date           DATE NOT NULL,
  check_in       TIMESTAMPTZ,
  check_out      TIMESTAMPTZ,
  hours_worked   NUMERIC(4,1),
  is_wfh         BOOLEAN DEFAULT FALSE,
  status         TEXT NOT NULL DEFAULT 'absent'
                 CHECK (status IN ('present','wfh','half_day','late_mark','leave','holiday','absent','weekend')),
  hr_override    BOOLEAN DEFAULT FALSE,
  override_note  TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, date)
);

-- ─── HOLIDAYS TABLE ───────────────────────────────────────────
CREATE TABLE holidays (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  date       DATE NOT NULL UNIQUE,
  type       TEXT NOT NULL DEFAULT 'public'
             CHECK (type IN ('public','optional','company')),
  year       INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays   ENABLE ROW LEVEL SECURITY;

-- Employees see own attendance, HR sees all
CREATE POLICY "attendance_select_own" ON attendance
  FOR SELECT USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin','manager')
  );

CREATE POLICY "attendance_insert_own" ON attendance
  FOR INSERT WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
  );

CREATE POLICY "attendance_update_own" ON attendance
  FOR UPDATE USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
  );

CREATE POLICY "hr_manage_attendance" ON attendance
  FOR ALL USING (current_employee_role() IN ('hr','admin'));

-- Everyone can read holidays
CREATE POLICY "holidays_select_all" ON holidays
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "hr_manage_holidays" ON holidays
  FOR ALL USING (current_employee_role() IN ('hr','admin'));


-- ─── SEED: PUBLIC HOLIDAYS FOR 2026 (INDIA) ──────────────────
INSERT INTO holidays (name, date, type, year) VALUES
  ('New Year''s Day',        '2026-01-01', 'public',  2026),
  ('Republic Day',           '2026-01-26', 'public',  2026),
  ('Holi',                   '2026-03-03', 'public',  2026),
  ('Independence Day',       '2026-08-15', 'public',  2026),
  ('Gandhi Jayanti',         '2026-10-02', 'public',  2026),
  ('Dussehra',               '2026-10-12', 'public',  2026),
  ('Diwali',                 '2026-10-31', 'public',  2026),
  ('Christmas',              '2026-12-25', 'public',  2026)
ON CONFLICT (date) DO NOTHING;
