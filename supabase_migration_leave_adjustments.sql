-- ============================================================
-- STRIDE — LEAVE ADJUSTMENTS AUDIT TABLE
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

CREATE TABLE IF NOT EXISTS leave_adjustments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type   TEXT NOT NULL,
  adjustment   NUMERIC(5,1) NOT NULL,   -- positive = added, negative = deducted
  old_total    NUMERIC(5,1) NOT NULL,
  new_total    NUMERIC(5,1) NOT NULL,
  reason       TEXT NOT NULL,
  adjusted_by  UUID REFERENCES employees(id),
  year         INT NOT NULL DEFAULT EXTRACT(YEAR FROM NOW()),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_leave_adjustments_employee
  ON leave_adjustments (employee_id, created_at DESC);

-- RLS
ALTER TABLE leave_adjustments ENABLE ROW LEVEL SECURITY;

-- Employees can see their own adjustments, HR sees all
CREATE POLICY "leave_adjustments_own" ON leave_adjustments
  FOR ALL USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr', 'admin')
  );

-- Also ensure leave_balances has the right constraint for upsert
-- (should already exist but adding IF NOT EXISTS to be safe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leave_balances_employee_id_leave_type_year_key'
  ) THEN
    ALTER TABLE leave_balances
      ADD CONSTRAINT leave_balances_employee_id_leave_type_year_key
      UNIQUE (employee_id, leave_type, year);
  END IF;
END $$;

-- Verify
SELECT 'leave_adjustments table created' as status;
