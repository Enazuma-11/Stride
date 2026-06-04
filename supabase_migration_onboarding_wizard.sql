-- ============================================================
-- STRIDE — ONBOARDING WIZARD MIGRATION
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;

-- Mark existing employees as already onboarded
UPDATE employees
SET onboarding_completed = TRUE
WHERE status = 'active'
AND (
  full_name IS NOT NULL
  AND date_of_birth IS NOT NULL
  AND gender IS NOT NULL
  AND gender != 'prefer_not_to_say'
);

-- Verify
SELECT full_name, onboarding_completed, gender, date_of_birth
FROM employees
ORDER BY created_at;
