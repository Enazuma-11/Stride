-- ============================================================
-- STRIDE — ONBOARDING FORM MIGRATION
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- Add onboarding form fields to employees table
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS nick_name          TEXT,
  ADD COLUMN IF NOT EXISTS tshirt_size        TEXT,
  ADD COLUMN IF NOT EXISTS sports_interests   TEXT,
  ADD COLUMN IF NOT EXISTS hobbies            TEXT,
  ADD COLUMN IF NOT EXISTS father_name        TEXT,
  ADD COLUMN IF NOT EXISTS mother_name        TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_form_submitted BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS onboarding_submitted_at   TIMESTAMPTZ;

-- Add address fields if not present
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS present_address    JSONB,
  ADD COLUMN IF NOT EXISTS permanent_address  JSONB;

-- Add compliance fields if not present  
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS pan_number         TEXT,
  ADD COLUMN IF NOT EXISTS aadhaar_number     TEXT;

-- Notification for HR when onboarding is submitted
-- (Uses existing notifications table)

-- Verify
SELECT column_name FROM information_schema.columns
WHERE table_name = 'employees'
  AND column_name IN (
    'nick_name','tshirt_size','sports_interests','hobbies',
    'father_name','mother_name','onboarding_form_submitted',
    'pan_number','aadhaar_number'
  )
ORDER BY column_name;
