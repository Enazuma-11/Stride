-- ============================================================
-- STRIDE — EDUCATION DOCUMENT TYPES
-- Run in: Supabase Dashboard → SQL Editor (both Production and Test projects)
--
-- Why: OnboardingFormFull.jsx's Documents step now asks for 10th Marksheet,
-- 12th Marksheet, Graduation Certificate, and Post-Graduation Certificate
-- (replacing the single generic "Education Certificate" upload). These are
-- new document_type values not yet in the employee_documents CHECK
-- constraint, so uploading any of them will fail with a check-constraint
-- violation until this runs.
-- ============================================================

DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'employee_documents'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%document_type%'
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
    'tenth_marksheet','twelfth_marksheet',
    'graduation_certificate','postgraduation_certificate',
    'other'
  ));
