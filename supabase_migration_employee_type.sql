-- ============================================================
-- MIGRATION: Add employee_type to employees table
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- Add employee type column
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS employee_type TEXT NOT NULL DEFAULT 'permanent'
    CHECK (employee_type IN ('permanent', 'intern', 'contractor', 'parttime')),
  ADD COLUMN IF NOT EXISTS internship_end_date DATE;

-- Update existing employees (mark all as permanent by default)
UPDATE employees SET employee_type = 'permanent' WHERE employee_type IS NULL;

-- Update leave balances seeding to respect intern/contractor limits
-- (New employees seeded via api.onboarding.js automatically use correct balances)
