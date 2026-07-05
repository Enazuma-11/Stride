-- ============================================================
-- STRIDE — LIFECYCLE REMINDERS ENGINE
-- Run in: Supabase Dashboard → SQL Editor (both Production and Test)
-- ============================================================

-- ─── DEDUP LOG ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lifecycle_reminder_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         TEXT NOT NULL UNIQUE,
  event_type  TEXT NOT NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  fired_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_reminder_log_key      ON lifecycle_reminder_log(key);
CREATE INDEX IF NOT EXISTS idx_lifecycle_reminder_log_fired_at ON lifecycle_reminder_log(fired_at);

ALTER TABLE lifecycle_reminder_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lifecycle_log_hr_read" ON lifecycle_reminder_log
  FOR SELECT USING (current_employee_role() IN ('hr', 'admin'));
