-- ============================================================
-- STRIDE — SYNC employee_documents SCHEMA (Test/Dev only)
-- Run in: Supabase Dashboard → SQL Editor — TEST/DEV project ONLY
-- (Production already has these columns — confirmed via verification query.)
--
-- Why: schema comparison after the onboarding document-type fix showed
-- Test/Dev's employee_documents table is missing three columns that
-- Production has: created_at, uploaded_by, file_size. api.profile.js:22
-- runs `.order('created_at', ...)` when fetching an employee's documents,
-- which fails with "column created_at does not exist" on Test/Dev today.
-- Adding all three keeps Test/Dev's schema matching Production, as intended.
-- ============================================================

ALTER TABLE employee_documents
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS file_size   INT;

-- Backfill created_at for any existing rows so ORDER BY doesn't sort
-- everything as NULL — use uploaded_at (already present) as the best
-- available approximation.
UPDATE employee_documents
SET created_at = uploaded_at
WHERE created_at IS NULL;
