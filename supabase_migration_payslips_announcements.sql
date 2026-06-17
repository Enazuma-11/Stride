-- ============================================================
-- STRIDE — PAYSLIPS & ANNOUNCEMENTS MIGRATION
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ── PAYSLIPS TABLE ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payslips (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month           INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year            INT NOT NULL,
  -- Earnings
  basic           NUMERIC(10,2) DEFAULT 0,
  hra             NUMERIC(10,2) DEFAULT 0,
  conveyance      NUMERIC(10,2) DEFAULT 0,
  medical         NUMERIC(10,2) DEFAULT 0,
  lta             NUMERIC(10,2) DEFAULT 0,
  special_allowance NUMERIC(10,2) DEFAULT 0,
  other_earnings  NUMERIC(10,2) DEFAULT 0,
  -- Deductions
  pf_deduction    NUMERIC(10,2) DEFAULT 0,
  pt_deduction    NUMERIC(10,2) DEFAULT 0,
  tds_deduction   NUMERIC(10,2) DEFAULT 0,
  lop_deduction   NUMERIC(10,2) DEFAULT 0,
  other_deductions NUMERIC(10,2) DEFAULT 0,
  -- Bank details (snapshot at time of payslip)
  bank_name       TEXT,
  account_number  TEXT,
  branch_name     TEXT,
  ifsc_code       TEXT,
  -- Meta
  working_days    INT DEFAULT 30,
  paid_days       INT DEFAULT 30,
  notes           TEXT,
  generated_by    UUID REFERENCES employees(id),
  generated_at    TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, month, year)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payslips_employee ON payslips(employee_id, year, month DESC);
CREATE INDEX IF NOT EXISTS idx_payslips_year_month ON payslips(year, month);

-- RLS
ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payslips_own" ON payslips
  FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr', 'admin')
  );

CREATE POLICY "payslips_hr_insert" ON payslips
  FOR INSERT TO authenticated
  WITH CHECK (current_employee_role() IN ('hr', 'admin'));

CREATE POLICY "payslips_hr_update" ON payslips
  FOR UPDATE TO authenticated
  USING (current_employee_role() IN ('hr', 'admin'));

CREATE POLICY "payslips_hr_delete" ON payslips
  FOR DELETE TO authenticated
  USING (current_employee_role() IN ('hr', 'admin'));

-- ── ANNOUNCEMENTS TABLE ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  category    TEXT DEFAULT 'general', -- general | hr | event | urgent
  pinned      BOOLEAN DEFAULT FALSE,
  posted_by   UUID REFERENCES employees(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_pinned  ON announcements(pinned DESC, created_at DESC);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "announcements_read" ON announcements
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "announcements_hr_write" ON announcements
  FOR ALL TO authenticated
  USING (current_employee_role() IN ('hr', 'admin'))
  WITH CHECK (current_employee_role() IN ('hr', 'admin'));

-- ── ANNOUNCEMENT REACTIONS TABLE ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcement_reactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  emoji           TEXT NOT NULL CHECK (emoji IN ('👍','❤️','🎉')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (announcement_id, employee_id, emoji)
);

ALTER TABLE announcement_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reactions_read" ON announcement_reactions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "reactions_write" ON announcement_reactions
  FOR ALL TO authenticated
  USING (employee_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
  WITH CHECK (employee_id = (SELECT id FROM employees WHERE user_id = auth.uid()));

-- ── ANNOUNCEMENT COMMENTS TABLE ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcement_comments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_announcement ON announcement_comments(announcement_id, created_at);

ALTER TABLE announcement_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comments_read" ON announcement_comments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "comments_write" ON announcement_comments
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = (SELECT id FROM employees WHERE user_id = auth.uid()));

CREATE POLICY "comments_delete_own" ON announcement_comments
  FOR DELETE TO authenticated
  USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr', 'admin')
  );

-- Enable realtime for announcements
ALTER PUBLICATION supabase_realtime ADD TABLE announcements;
ALTER PUBLICATION supabase_realtime ADD TABLE announcement_reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE announcement_comments;

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('payslips','announcements','announcement_reactions','announcement_comments')
ORDER BY table_name;
