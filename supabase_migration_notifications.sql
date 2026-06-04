-- ============================================================
-- STRIDE — NOTIFICATIONS MODULE MIGRATION
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ─── NOTIFICATIONS TABLE ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}',
  is_read     BOOLEAN DEFAULT FALSE,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast unread count queries
CREATE INDEX IF NOT EXISTS idx_notifications_employee_unread
  ON notifications (employee_id, is_read, created_at DESC);

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Employees only see their own notifications
CREATE POLICY "notifications_own" ON notifications
  FOR ALL USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr', 'admin')
  );

-- Allow insert for HR/Admin to broadcast notifications
CREATE POLICY "notifications_insert" ON notifications
  FOR INSERT WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr', 'admin')
    OR auth.uid() IS NOT NULL  -- Allow service role inserts
  );

-- ─── ENABLE REAL-TIME FOR NOTIFICATIONS ──────────────────────
-- This allows Supabase Realtime to push new notifications instantly
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- ─── SEED: WELCOME NOTIFICATIONS FOR EXISTING EMPLOYEES ──────
INSERT INTO notifications (employee_id, type, title, message)
SELECT
  id,
  'onboarding',
  'Welcome to Stride! 👋',
  'Your employee portal is set up and ready. Explore your dashboard, check your leave balances, and complete your profile.'
FROM employees
WHERE status = 'active'
ON CONFLICT DO NOTHING;

-- ─── VERIFY ───────────────────────────────────────────────────
SELECT
  e.full_name,
  n.type,
  n.title,
  n.is_read,
  n.created_at
FROM notifications n
JOIN employees e ON e.id = n.employee_id
ORDER BY n.created_at DESC;
