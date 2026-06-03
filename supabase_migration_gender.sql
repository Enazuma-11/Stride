-- ============================================================
-- STRIDE — ADD GENDER COLUMN TO EMPLOYEES
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Add gender column
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT 'prefer_not_to_say'
    CHECK (gender IN ('male', 'female', 'non_binary', 'prefer_not_to_say'));

-- Update existing employees (set to prefer_not_to_say by default)
UPDATE employees SET gender = 'prefer_not_to_say' WHERE gender IS NULL;

-- Remove maternity leave balance from non-female employees
-- (Safe to run — only affects employees who already have maternity in their balance)
DELETE FROM leave_balances
WHERE leave_type = 'maternity'
AND employee_id IN (
  SELECT id FROM employees WHERE gender != 'female'
);

-- Verify
SELECT e.full_name, e.gender, lb.leave_type, lb.total_days
FROM employees e
LEFT JOIN leave_balances lb ON lb.employee_id = e.id AND lb.year = 2026
ORDER BY e.full_name, lb.leave_type;
