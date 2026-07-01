-- ============================================================
-- STRIDE — ONBOARDING DOCUMENT TYPE FIX
-- Run in: Supabase Dashboard → SQL Editor (both Production and Test projects)
--
-- Why: OnboardingFormFull.jsx (the pre-approval onboarding form) uploads
-- documents with document_type values ('education_certificate',
-- 'experience_certificate', 'resume', 'bank_proof', 'prev_offer_letter',
-- 'prev_salary_slips') that are NOT in the original doc_type CHECK
-- constraint from supabase_migration_profile.sql. Only 'offer_letter'
-- matches. Every other document upload during onboarding will fail
-- with a check-constraint violation once the gender/marital_status
-- fix (OnboardingFormFull.jsx) is deployed and an employee reaches
-- Step 4 of the form.
--
-- This also ensures the (employee_id, document_type) unique constraint
-- required by the app's `onConflict: 'employee_id,document_type'` upsert
-- calls (api.profile.js, OnboardingFormFull.jsx) actually exists —
-- without it, Postgres rejects the upsert with "no unique or exclusion
-- constraint matching the ON CONFLICT specification".
--
-- Also: some environments (confirmed on Production) never got the
-- doc_type -> document_type / doc_name -> file_name column rename that
-- Test/Dev already has. api.profile.js and OnboardingFormFull.jsx both
-- write document_type/file_name/uploaded_at, so on an un-renamed table
-- every document upload (not just onboarding) fails with
-- "column document_type does not exist". Normalize columns first.
-- ============================================================

-- Bring the table to the column names the app code actually uses,
-- regardless of which naming this environment currently has.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_documents' AND column_name = 'doc_type')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_documents' AND column_name = 'document_type') THEN
    ALTER TABLE employee_documents RENAME COLUMN doc_type TO document_type;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_documents' AND column_name = 'doc_name')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_documents' AND column_name = 'file_name') THEN
    ALTER TABLE employee_documents RENAME COLUMN doc_name TO file_name;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_documents' AND column_name = 'uploaded_at') THEN
    ALTER TABLE employee_documents ADD COLUMN uploaded_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Widen the CHECK constraint to include all document_type values the
-- app actually sends. Constraint name may vary if it was renamed
-- manually in the past, so drop dynamically by inspecting the catalog.
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'employee_documents'::regclass
    AND contype = 'c'
    AND (pg_get_constraintdef(oid) ILIKE '%document_type%'
         OR pg_get_constraintdef(oid) ILIKE '%doc_type%')
  LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE employee_documents DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE employee_documents
  ADD CONSTRAINT employee_documents_document_type_check
  CHECK (document_type IN (
    'offer_letter','experience_letter','resignation_letter',
    'pan_card','aadhaar','passport','visa',
    'marksheet','degree_certificate','certification',
    'nda','employment_contract','handbook_acknowledgment',
    'education_certificate','experience_certificate','resume',
    'bank_proof','prev_offer_letter','prev_salary_slips',
    'other'
  ));

-- Ensure the unique constraint needed for onConflict upserts exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'employee_documents'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%employee_id%document_type%'
  ) THEN
    ALTER TABLE employee_documents
      ADD CONSTRAINT employee_documents_employee_id_document_type_key
      UNIQUE (employee_id, document_type);
  END IF;
END $$;
