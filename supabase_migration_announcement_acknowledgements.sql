-- ── Announcement Acknowledgements ─────────────────────────────────────────────
-- Employees acknowledge they have read an announcement.
-- HR/Admin can see who has and hasn't acknowledged each announcement.

CREATE TABLE IF NOT EXISTS announcement_acknowledgements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES employees(id)     ON DELETE CASCADE,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_ack_announcement ON announcement_acknowledgements(announcement_id);
CREATE INDEX IF NOT EXISTS idx_ack_employee     ON announcement_acknowledgements(employee_id);

ALTER TABLE announcement_acknowledgements ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (HR needs to see everyone's acks)
CREATE POLICY "ack_read" ON announcement_acknowledgements
  FOR SELECT USING (true);

-- Employees can only insert their own acknowledgement
CREATE POLICY "ack_insert_own" ON announcement_acknowledgements
  FOR INSERT WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
  );

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE announcement_acknowledgements;

-- Verify
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'announcement_acknowledgements';
