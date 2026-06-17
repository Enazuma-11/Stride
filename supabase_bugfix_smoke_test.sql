-- ============================================================
-- STRIDE — BUG FIX MIGRATION (Smoke Test Fixes)
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ── BUG-001 FIX: Allow employees to update their own profile_photo_url ────────
-- Drop old restrictive update policy
DROP POLICY IF EXISTS "employees_update_own" ON employees;

-- Recreate with proper permissions
CREATE POLICY "employees_update_own" ON employees
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── Storage RLS fix: Allow employees to upload/read their own photos ──────────
-- Drop existing storage policies if any
DROP POLICY IF EXISTS "employee_photo_upload" ON storage.objects;
DROP POLICY IF EXISTS "employee_photo_read"   ON storage.objects;
DROP POLICY IF EXISTS "employee_doc_upload"   ON storage.objects;
DROP POLICY IF EXISTS "employee_doc_read"     ON storage.objects;
DROP POLICY IF EXISTS "employee_doc_delete"   ON storage.objects;

-- Allow authenticated users to upload to their own folder
CREATE POLICY "employee_storage_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'employee-documents'
    AND (storage.foldername(name))[1] = (
      SELECT id::text FROM employees WHERE user_id = auth.uid()
    )
  );

-- Allow authenticated users to update their own files
CREATE POLICY "employee_storage_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'employee-documents'
    AND (storage.foldername(name))[1] = (
      SELECT id::text FROM employees WHERE user_id = auth.uid()
    )
  );

-- Allow authenticated users to read their own files + HR reads all
CREATE POLICY "employee_storage_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'employee-documents'
    AND (
      (storage.foldername(name))[1] = (
        SELECT id::text FROM employees WHERE user_id = auth.uid()
      )
      OR current_employee_role() IN ('hr', 'admin')
    )
  );

-- Allow authenticated users to delete their own files
CREATE POLICY "employee_storage_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'employee-documents'
    AND (
      (storage.foldername(name))[1] = (
        SELECT id::text FROM employees WHERE user_id = auth.uid()
      )
      OR current_employee_role() IN ('hr', 'admin')
    )
  );

-- ── Fix: Clean up wrong photo URLs (Sportskeyz logo issue) ───────────────────
-- Clear any profile_photo_urls that don't contain the employee's own ID
-- This forces a fresh upload
UPDATE employees
SET profile_photo_url = NULL
WHERE profile_photo_url IS NOT NULL
  AND profile_photo_url NOT LIKE '%' || id::text || '%';

-- ── Verify all policies ───────────────────────────────────────────────────────
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'employees'
ORDER BY cmd, policyname;
