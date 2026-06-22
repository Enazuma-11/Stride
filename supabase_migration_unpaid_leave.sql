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

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'leave_requests'
  AND column_name IN ('unpaid_days', 'paid_days')
ORDER BY column_name;
