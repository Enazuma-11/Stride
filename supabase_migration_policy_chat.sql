-- ============================================================
-- STRIDE — POLICY CENTRE + INTERNAL CHAT MIGRATION
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── POLICY CENTRE ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS policy_categories (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL UNIQUE,
  icon       TEXT DEFAULT '📄',
  color      TEXT DEFAULT '#126dad',
  sort_order INT  DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO policy_categories (name, icon, color, sort_order) VALUES
  ('HR Policies',       '👥', '#9b75f1', 1),
  ('Company Handbook',  '📖', '#126dad', 2),
  ('Benefits',          '🎁', '#00b894', 3),
  ('IT & Security',     '🔒', '#0891b2', 4),
  ('Legal & Compliance','⚖️', '#f59e0b', 5),
  ('Operations',        '⚙️', '#6b7280', 6)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS policies (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title        TEXT NOT NULL,
  description  TEXT,
  category_id  UUID REFERENCES policy_categories(id),
  file_url     TEXT,
  file_name    TEXT,
  file_size    INT,
  version      TEXT DEFAULT '1.0',
  is_published BOOLEAN DEFAULT FALSE,
  requires_ack BOOLEAN DEFAULT FALSE,  -- employees must acknowledge reading
  published_by UUID REFERENCES employees(id),
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policies_category ON policies(category_id, is_published);

ALTER TABLE policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "policies_read" ON policies
  FOR SELECT TO authenticated
  USING (is_published = true OR current_employee_role() IN ('hr','admin'));

CREATE POLICY "policies_hr_write" ON policies
  FOR ALL TO authenticated
  USING (current_employee_role() IN ('hr','admin'))
  WITH CHECK (current_employee_role() IN ('hr','admin'));

-- Track employee acknowledgements
CREATE TABLE IF NOT EXISTS policy_acknowledgements (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  policy_id   UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  acknowledged_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (policy_id, employee_id)
);

ALTER TABLE policy_acknowledgements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ack_all" ON policy_acknowledgements FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── INTERNAL CHAT ─────────────────────────────────────────────────────────────

-- Channels (company-wide)
CREATE TABLE IF NOT EXISTS chat_channels (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,         -- e.g. "general", "engineering"
  description TEXT,
  is_private  BOOLEAN DEFAULT FALSE,
  created_by  UUID REFERENCES employees(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO chat_channels (name, description) VALUES
  ('general',     'Company-wide announcements and conversations'),
  ('random',      'Off-topic, fun conversations'),
  ('engineering', 'Technical discussions'),
  ('hr',          'HR updates and queries')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "channels_read"     ON chat_channels FOR SELECT TO authenticated USING (true);
CREATE POLICY "channels_hr_write" ON chat_channels FOR ALL    TO authenticated
  USING (current_employee_role() IN ('hr','admin'))
  WITH CHECK (current_employee_role() IN ('hr','admin'));

-- Channel members
CREATE TABLE IF NOT EXISTS chat_channel_members (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id  UUID NOT NULL REFERENCES chat_channels(id)  ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id)       ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (channel_id, employee_id)
);

ALTER TABLE chat_channel_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_all" ON chat_channel_members FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Direct message conversations
CREATE TABLE IF NOT EXISTS chat_conversations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_one   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  member_two   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (member_one, member_two)
);

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conversations_read" ON chat_conversations FOR ALL TO authenticated
  USING (
    member_one = (SELECT id FROM employees WHERE user_id = auth.uid()) OR
    member_two = (SELECT id FROM employees WHERE user_id = auth.uid())
  )
  WITH CHECK (
    member_one = (SELECT id FROM employees WHERE user_id = auth.uid()) OR
    member_two = (SELECT id FROM employees WHERE user_id = auth.uid())
  );

-- Messages (shared for channels + DMs)
CREATE TABLE IF NOT EXISTS chat_messages (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id     UUID REFERENCES chat_channels(id)      ON DELETE CASCADE,
  conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id      UUID NOT NULL REFERENCES employees(id)  ON DELETE CASCADE,
  body           TEXT,
  file_url       TEXT,
  file_name      TEXT,
  file_type      TEXT,
  reactions      JSONB DEFAULT '{}',   -- { "👍": ["emp_id1","emp_id2"], "❤️": [] }
  edited         BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  CHECK (channel_id IS NOT NULL OR conversation_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_messages_channel  ON chat_messages(channel_id,  created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conv     ON chat_messages(conversation_id, created_at DESC);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_read" ON chat_messages FOR SELECT TO authenticated
  USING (
    channel_id IS NOT NULL OR
    conversation_id IN (
      SELECT id FROM chat_conversations WHERE
        member_one = (SELECT id FROM employees WHERE user_id = auth.uid()) OR
        member_two = (SELECT id FROM employees WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "messages_insert" ON chat_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = (SELECT id FROM employees WHERE user_id = auth.uid()));

CREATE POLICY "messages_update" ON chat_messages FOR UPDATE TO authenticated
  USING (sender_id = (SELECT id FROM employees WHERE user_id = auth.uid()));

CREATE POLICY "messages_delete" ON chat_messages FOR DELETE TO authenticated
  USING (
    sender_id = (SELECT id FROM employees WHERE user_id = auth.uid()) OR
    current_employee_role() IN ('hr','admin')
  );

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_channels;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_conversations;

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('policies','policy_categories','policy_acknowledgements','chat_channels','chat_conversations','chat_messages','chat_channel_members')
ORDER BY table_name;
