-- ============================================================
-- STRIDE — HALF DAY DEDUCTIONS TABLE
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Track half-day leave deductions to prevent double deduction
CREATE TABLE IF NOT EXISTS half_day_deductions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  leave_type    TEXT NOT NULL DEFAULT 'casual_sick',
  days_deducted NUMERIC(3,1) NOT NULL DEFAULT 0.5,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, date)
);

-- RLS
ALTER TABLE half_day_deductions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "half_day_own" ON half_day_deductions
  FOR ALL USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr', 'admin')
  );

-- Also update leave_balances to support decimal used_days
ALTER TABLE leave_balances
  ALTER COLUMN used_days TYPE NUMERIC(5,1);

-- Verify
SELECT 'half_day_deductions table created successfully' as status;
