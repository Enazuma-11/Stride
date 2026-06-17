-- ============================================================
-- STRIDE — OKRs, PERFORMANCE & REPORTING MANAGER FIX
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── Fix: ensure manager_id column exists on employees ────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES employees(id);

-- ── OKR CYCLES TABLE ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS okr_cycles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,            -- e.g. "Q2 2026"
  quarter     INT  NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  year        INT  NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  status      TEXT DEFAULT 'active'     CHECK (status IN ('upcoming','active','completed')),
  created_by  UUID REFERENCES employees(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE okr_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "okr_cycles_read"  ON okr_cycles FOR SELECT TO authenticated USING (true);
CREATE POLICY "okr_cycles_write" ON okr_cycles FOR ALL    TO authenticated
  USING (current_employee_role() IN ('hr','admin'))
  WITH CHECK (current_employee_role() IN ('hr','admin'));

-- ── OBJECTIVES TABLE ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS objectives (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id     UUID NOT NULL REFERENCES okr_cycles(id) ON DELETE CASCADE,
  employee_id  UUID NOT NULL REFERENCES employees(id)  ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  progress     INT  DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  status       TEXT DEFAULT 'on_track' CHECK (status IN ('on_track','at_risk','behind','completed')),
  created_by   UUID REFERENCES employees(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_objectives_employee ON objectives(employee_id, cycle_id);
CREATE INDEX IF NOT EXISTS idx_objectives_cycle    ON objectives(cycle_id);

ALTER TABLE objectives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "objectives_read" ON objectives FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
    OR employee_id IN (
      SELECT id FROM employees WHERE manager_id = (
        SELECT id FROM employees WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "objectives_write" ON objectives FOR ALL TO authenticated
  USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
  )
  WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
  );

-- ── KEY RESULTS TABLE ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS key_results (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  objective_id  UUID NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  metric_type   TEXT DEFAULT 'percentage' CHECK (metric_type IN ('percentage','number','boolean','currency')),
  target_value  NUMERIC(12,2) DEFAULT 100,
  current_value NUMERIC(12,2) DEFAULT 0,
  unit          TEXT,                    -- e.g. '%', 'users', '₹'
  progress      INT  DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  status        TEXT DEFAULT 'on_track' CHECK (status IN ('on_track','at_risk','behind','completed')),
  due_date      DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_key_results_objective ON key_results(objective_id);

ALTER TABLE key_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "key_results_read" ON key_results FOR SELECT TO authenticated
  USING (
    objective_id IN (
      SELECT id FROM objectives WHERE
        employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
        OR current_employee_role() IN ('hr','admin')
    )
  );

CREATE POLICY "key_results_write" ON key_results FOR ALL TO authenticated
  USING (
    objective_id IN (
      SELECT id FROM objectives WHERE
        employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
        OR current_employee_role() IN ('hr','admin')
    )
  )
  WITH CHECK (
    objective_id IN (
      SELECT id FROM objectives WHERE
        employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
        OR current_employee_role() IN ('hr','admin')
    )
  );

-- ── OKR CHECK-INS TABLE ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS okr_checkins (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  objective_id UUID NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  employee_id  UUID NOT NULL REFERENCES employees(id)  ON DELETE CASCADE,
  note         TEXT,
  progress     INT  NOT NULL CHECK (progress BETWEEN 0 AND 100),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE okr_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checkins_all" ON okr_checkins FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Seed Q2 2026 cycle ────────────────────────────────────────────────────────
INSERT INTO okr_cycles (name, quarter, year, start_date, end_date, status)
VALUES ('Q2 2026', 2, 2026, '2026-04-01', '2026-06-30', 'active')
ON CONFLICT DO NOTHING;

INSERT INTO okr_cycles (name, quarter, year, start_date, end_date, status)
VALUES ('Q3 2026', 3, 2026, '2026-07-01', '2026-09-30', 'upcoming')
ON CONFLICT DO NOTHING;

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('okr_cycles','objectives','key_results','okr_checkins')
ORDER BY table_name;
