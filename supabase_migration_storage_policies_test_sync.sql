-- ============================================================
-- STRIDE — SYNC STORAGE POLICIES (Test/Dev only)
-- Run in: Supabase Dashboard → SQL Editor — TEST/DEV project ONLY
-- (Production already has these — confirmed via verification query.)
--
-- Why: Test/Dev's storage.objects table has zero RLS policies for the
-- employee-documents bucket. Supabase enables RLS on storage.objects by
-- default, so with no policies, every upload/read/update/delete to this
-- bucket is silently denied ("new row violates row-level security
-- policy") — this is why onboarding document uploads and profile photo
-- uploads fail on Test/Dev while succeeding on Production.
--
-- This adds the same folder-scoped policies Production uses: each
-- employee can read/write/delete only files under their own
-- {employee_id}/... folder, and HR/Admin can read/delete any file.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'employee_storage_insert') THEN
    CREATE POLICY "employee_storage_insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'employee-documents'
        AND (storage.foldername(name))[1] = (
          SELECT id::text FROM employees WHERE user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'employee_storage_update') THEN
    CREATE POLICY "employee_storage_update" ON storage.objects
      FOR UPDATE TO authenticated
      USING (
        bucket_id = 'employee-documents'
        AND (storage.foldername(name))[1] = (
          SELECT id::text FROM employees WHERE user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'employee_storage_select') THEN
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
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'employee_storage_delete') THEN
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
  END IF;
END $$;
