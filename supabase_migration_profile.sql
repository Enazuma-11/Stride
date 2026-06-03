-- ============================================================
-- STRIDE — FULL EMPLOYEE PROFILE SCHEMA
-- SporTech Innovation Lab Pvt Ltd
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ─── SECTION 1 & 2: EXTEND EMPLOYEES TABLE ───────────────────
ALTER TABLE employees
  -- Section 1: Basic & Personal
  ADD COLUMN IF NOT EXISTS first_name          TEXT,
  ADD COLUMN IF NOT EXISTS middle_name         TEXT,
  ADD COLUMN IF NOT EXISTS last_name           TEXT,
  ADD COLUMN IF NOT EXISTS preferred_name      TEXT,
  ADD COLUMN IF NOT EXISTS display_name        TEXT,
  ADD COLUMN IF NOT EXISTS date_of_birth       DATE,
  ADD COLUMN IF NOT EXISTS marital_status      TEXT CHECK (marital_status IN ('single','married','divorced','widowed','prefer_not_to_say')),
  ADD COLUMN IF NOT EXISTS bio                 TEXT,
  ADD COLUMN IF NOT EXISTS profile_photo_url   TEXT,
  ADD COLUMN IF NOT EXISTS employee_code       TEXT UNIQUE,  -- Company ID e.g. SIL-001

  -- Section 2: Work & Hierarchy
  ADD COLUMN IF NOT EXISTS division            TEXT,
  ADD COLUMN IF NOT EXISTS work_location       TEXT,
  ADD COLUMN IF NOT EXISTS employment_status   TEXT DEFAULT 'active'
    CHECK (employment_status IN ('active','inactive','on_leave','onboarding')),
  ADD COLUMN IF NOT EXISTS probation_end_date  DATE,
  ADD COLUMN IF NOT EXISTS source_of_hire      TEXT
    CHECK (source_of_hire IN ('referral','job_board','campus','social_media','agency','direct','other')),
  ADD COLUMN IF NOT EXISTS tenure_start_date   DATE,

  -- Section 3: Corporate Contact
  ADD COLUMN IF NOT EXISTS work_phone          TEXT,
  ADD COLUMN IF NOT EXISTS work_extension      TEXT,
  ADD COLUMN IF NOT EXISTS desk_id             TEXT,

  -- Section 3: Personal Contact
  ADD COLUMN IF NOT EXISTS personal_mobile     TEXT,
  ADD COLUMN IF NOT EXISTS personal_email      TEXT,

  -- Section 3: Addresses
  ADD COLUMN IF NOT EXISTS present_address     JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS permanent_address   JSONB DEFAULT '{}';

-- ─── SECTION 4: PAYROLL & BANKING ────────────────────────────
CREATE TABLE IF NOT EXISTS employee_payroll (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id           UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  base_salary           NUMERIC(12,2),
  pay_type              TEXT CHECK (pay_type IN ('salary','hourly','contract')),
  pay_frequency         TEXT CHECK (pay_frequency IN ('monthly','bi_weekly','weekly')),
  overtime_eligible     BOOLEAN DEFAULT FALSE,
  effective_from        DATE,
  -- Banking
  bank_name             TEXT,
  account_holder_name   TEXT,
  account_number        TEXT,
  ifsc_code             TEXT,
  swift_code            TEXT,
  -- Tax
  tax_status            TEXT,
  tax_declarations      JSONB DEFAULT '{}',
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SECTION 5: COMPLIANCE & DOCUMENTS ───────────────────────
CREATE TABLE IF NOT EXISTS employee_compliance (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id           UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE UNIQUE,
  -- Identity
  aadhaar_number        TEXT,
  pan_number            TEXT,
  pan_card_url          TEXT,
  -- Passport & Visa
  passport_number       TEXT,
  passport_country      TEXT,
  passport_issue_date   DATE,
  passport_expiry_date  DATE,
  visa_type             TEXT,
  visa_number           TEXT,
  visa_expiry_date      DATE,
  visa_sponsor          TEXT,
  -- Onboarding docs
  nda_signed            BOOLEAN DEFAULT FALSE,
  nda_signed_date       DATE,
  contract_signed       BOOLEAN DEFAULT FALSE,
  contract_signed_date  DATE,
  handbook_acknowledged BOOLEAN DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SECTION 5: EDUCATION ────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_education (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  institution       TEXT NOT NULL,
  degree            TEXT,
  major             TEXT,
  start_year        INT,
  end_year          INT,
  grade             TEXT,
  certificate_url   TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SECTION 5: DOCUMENTS VAULT ──────────────────────────────
CREATE TABLE IF NOT EXISTS employee_documents (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  doc_type      TEXT NOT NULL
    CHECK (doc_type IN (
      'offer_letter','experience_letter','resignation_letter',
      'pan_card','aadhaar','passport','visa',
      'marksheet','degree_certificate','certification',
      'nda','employment_contract','handbook_acknowledgment',
      'other'
    )),
  doc_name      TEXT NOT NULL,
  file_url      TEXT NOT NULL,
  file_size     INT,
  uploaded_by   UUID REFERENCES employees(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SECTION 6: EMERGENCY CONTACTS ───────────────────────────
CREATE TABLE IF NOT EXISTS employee_emergency_contacts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  priority      INT DEFAULT 1,   -- 1 = primary, 2 = secondary
  full_name     TEXT NOT NULL,
  relationship  TEXT NOT NULL,
  phone         TEXT NOT NULL,
  alt_phone     TEXT,
  email         TEXT,
  address       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SECTION 6: DEPENDENTS ───────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_dependents (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id           UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  full_name             TEXT NOT NULL,
  relationship          TEXT NOT NULL,
  gender                TEXT,
  date_of_birth         DATE,
  health_insurance_id   TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SECTION 7: SKILLS & CERTIFICATIONS ──────────────────────
CREATE TABLE IF NOT EXISTS employee_skills (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  skill_name    TEXT NOT NULL,
  category      TEXT,   -- e.g. "Technical", "Soft Skill"
  proficiency   TEXT CHECK (proficiency IN ('beginner','intermediate','advanced','expert')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_certifications (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  issuing_authority TEXT,
  license_number   TEXT,
  issue_date       DATE,
  expiry_date      DATE,
  certificate_url  TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_languages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  language    TEXT NOT NULL,
  proficiency TEXT CHECK (proficiency IN ('basic','conversational','professional','native')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SECTION 8: EXIT & SEPARATION ────────────────────────────
CREATE TABLE IF NOT EXISTS employee_exit (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id                 UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE UNIQUE,
  last_working_day            DATE,
  notice_period_followed      BOOLEAN,
  reason_for_leaving          TEXT
    CHECK (reason_for_leaving IN (
      'resignation','retirement','end_of_contract',
      'termination','redundancy','other'
    )),
  resignation_letter_url      TEXT,
  -- Exit checklist
  it_assets_returned          BOOLEAN DEFAULT FALSE,
  accounts_deactivated        BOOLEAN DEFAULT FALSE,
  handover_notes_completed    BOOLEAN DEFAULT FALSE,
  exit_interview_completed    BOOLEAN DEFAULT FALSE,
  exit_interview_notes        TEXT,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PROFILE CHANGE REQUESTS (HR approval queue) ─────────────
CREATE TABLE IF NOT EXISTS profile_change_requests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  section       TEXT NOT NULL,   -- e.g. 'work', 'payroll', 'compliance'
  field_name    TEXT NOT NULL,
  old_value     TEXT,
  new_value     TEXT NOT NULL,
  status        TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  reviewed_by   UUID REFERENCES employees(id),
  reviewed_at   TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ATTENDANCE OVERRIDE LOG ──────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_overrides (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attendance_id UUID REFERENCES attendance(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  field_changed TEXT NOT NULL,   -- 'check_in', 'check_out', 'status'
  old_value     TEXT,
  new_value     TEXT NOT NULL,
  reason        TEXT NOT NULL,
  overridden_by UUID NOT NULL REFERENCES employees(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────
ALTER TABLE employee_payroll             ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_compliance          ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_education           ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_documents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_emergency_contacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_dependents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_skills              ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_certifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_languages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_exit                ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_change_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_overrides         ENABLE ROW LEVEL SECURITY;

-- Employees see own data, HR sees all
DO $$ DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employee_payroll','employee_compliance','employee_education',
    'employee_documents','employee_emergency_contacts','employee_dependents',
    'employee_skills','employee_certifications','employee_languages',
    'employee_exit','profile_change_requests','attendance_overrides'
  ] LOOP
    EXECUTE format('
      CREATE POLICY "%s_own" ON %s
        FOR ALL USING (
          employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
          OR current_employee_role() IN (''hr'',''admin'')
        )', t, t);
  END LOOP;
END $$;

-- HR manages change requests
CREATE POLICY "hr_manage_change_requests" ON profile_change_requests
  FOR UPDATE USING (current_employee_role() IN ('hr','admin'));

-- ─── STORAGE BUCKET FOR PROFILE DOCUMENTS ────────────────────
-- Run this separately in Supabase Storage settings:
-- Create a bucket named: employee-documents
-- Set to private (not public)
-- Enable RLS

-- ─── GENERATE EMPLOYEE CODES FOR EXISTING EMPLOYEES ──────────
UPDATE employees
SET employee_code = 'SIL-00' || ROW_NUMBER() OVER (ORDER BY created_at)::TEXT
WHERE employee_code IS NULL;

-- ─── VERIFY ───────────────────────────────────────────────────
SELECT
  e.full_name,
  e.employee_code,
  e.gender,
  e.marital_status,
  e.employment_status
FROM employees e
ORDER BY e.created_at;
