-- ============================================================
-- STRIDE — ANNUAL PERFORMANCE GOALS
-- Run in: Supabase Dashboard → SQL Editor (Production and Test)
-- ============================================================

-- ── 1. Extend okr_cycles with annual cycle type ──────────────────────────────
ALTER TABLE okr_cycles
  ADD COLUMN IF NOT EXISTS cycle_type TEXT NOT NULL DEFAULT 'quarterly'
    CHECK (cycle_type IN ('quarterly', 'annual'));

ALTER TABLE okr_cycles ALTER COLUMN quarter DROP NOT NULL;

-- ── 2. Add points weight to objectives ───────────────────────────────────────
ALTER TABLE objectives
  ADD COLUMN IF NOT EXISTS points INTEGER
    CHECK (points IS NULL OR (points BETWEEN 1 AND 100));

-- ── 3. goal_submissions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goal_submissions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id         UUID NOT NULL REFERENCES okr_cycles(id) ON DELETE CASCADE,
  employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'submitted', 'approved', 'returned')),
  manager_comment  TEXT,
  manager_id       UUID REFERENCES employees(id),
  submitted_at     TIMESTAMPTZ,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_goal_submissions_employee ON goal_submissions(employee_id, cycle_id);
CREATE INDEX IF NOT EXISTS idx_goal_submissions_status   ON goal_submissions(status);

-- ── 4. performance_reviews ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS performance_reviews (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id            UUID NOT NULL REFERENCES okr_cycles(id) ON DELETE CASCADE,
  employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  review_type         TEXT NOT NULL CHECK (review_type IN ('h1', 'year_end')),
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'manager_done', 'hr_finalized')),
  overall_comment     TEXT,
  verdict             TEXT CHECK (verdict IN ('exceeds', 'meets', 'partially_meets', 'doesnt_meet')),
  hr_notes            TEXT,
  manager_id          UUID REFERENCES employees(id),
  manager_reviewed_at TIMESTAMPTZ,
  hr_finalized_by     UUID REFERENCES employees(id),
  hr_finalized_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, employee_id, review_type)
);
CREATE INDEX IF NOT EXISTS idx_perf_reviews_employee ON performance_reviews(employee_id, cycle_id);
CREATE INDEX IF NOT EXISTS idx_perf_reviews_status   ON performance_reviews(status);

-- ── 5. performance_review_ratings ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS performance_review_ratings (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  review_id    UUID NOT NULL REFERENCES performance_reviews(id) ON DELETE CASCADE,
  objective_id UUID NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  score        NUMERIC(5,2) CHECK (score IS NULL OR (score BETWEEN 0 AND 100)),
  comment      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (review_id, objective_id)
);
CREATE INDEX IF NOT EXISTS idx_perf_ratings_review ON performance_review_ratings(review_id);

-- ── 6. Submission validation trigger (count 5–8, points = 100) ────────────────
CREATE OR REPLACE FUNCTION validate_goal_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  goal_count INT;
  points_sum INT;
BEGIN
  IF NEW.status = 'submitted' AND (OLD.status IS DISTINCT FROM 'submitted') THEN
    SELECT COUNT(*), COALESCE(SUM(points), 0)
      INTO goal_count, points_sum
      FROM objectives
      WHERE cycle_id = NEW.cycle_id AND employee_id = NEW.employee_id;

    IF goal_count < 5 OR goal_count > 8 THEN
      RAISE EXCEPTION 'Goal count must be between 5 and 8 (found %).', goal_count;
    END IF;
    IF points_sum <> 100 THEN
      RAISE EXCEPTION 'Goal points must sum to exactly 100 (found %).', points_sum;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_goal_submission ON goal_submissions;
CREATE TRIGGER trg_validate_goal_submission
  BEFORE UPDATE ON goal_submissions
  FOR EACH ROW EXECUTE FUNCTION validate_goal_submission();

-- ── 7. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE goal_submissions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_reviews        ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_review_ratings ENABLE ROW LEVEL SECURITY;

-- goal_submissions: employee own; manager reports; HR/admin all
DROP POLICY IF EXISTS "goal_sub_read" ON goal_submissions;
CREATE POLICY "goal_sub_read" ON goal_submissions FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
    OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "goal_sub_write" ON goal_submissions;
CREATE POLICY "goal_sub_write" ON goal_submissions FOR ALL TO authenticated
  USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
    OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
  )
  WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr','admin')
    OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
  );

-- performance_reviews: NO employee direct read. Manager reports + HR/admin.
DROP POLICY IF EXISTS "perf_review_read" ON performance_reviews;
CREATE POLICY "perf_review_read" ON performance_reviews FOR SELECT TO authenticated
  USING (
    current_employee_role() IN ('hr','admin')
    OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "perf_review_write" ON performance_reviews;
CREATE POLICY "perf_review_write" ON performance_reviews FOR ALL TO authenticated
  USING (
    current_employee_role() IN ('hr','admin')
    OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
  )
  WITH CHECK (
    current_employee_role() IN ('hr','admin')
    OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
  );

-- performance_review_ratings: NO employee direct read. Manager reports + HR/admin.
DROP POLICY IF EXISTS "perf_rating_read" ON performance_review_ratings;
CREATE POLICY "perf_rating_read" ON performance_review_ratings FOR SELECT TO authenticated
  USING (
    review_id IN (
      SELECT id FROM performance_reviews WHERE
        current_employee_role() IN ('hr','admin')
        OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
    )
  );

DROP POLICY IF EXISTS "perf_rating_write" ON performance_review_ratings;
CREATE POLICY "perf_rating_write" ON performance_review_ratings FOR ALL TO authenticated
  USING (
    review_id IN (
      SELECT id FROM performance_reviews WHERE
        current_employee_role() IN ('hr','admin')
        OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
    )
  )
  WITH CHECK (
    review_id IN (
      SELECT id FROM performance_reviews WHERE
        current_employee_role() IN ('hr','admin')
        OR employee_id IN (SELECT id FROM employees WHERE manager_id = (SELECT id FROM employees WHERE user_id = auth.uid()))
    )
  );

-- ── 8. Employee-safe read function (hides score + hr_notes; verdict gated) ────
CREATE OR REPLACE FUNCTION get_my_performance_reviews(p_cycle_id UUID)
RETURNS TABLE (
  review_id       UUID,
  review_type     TEXT,
  status          TEXT,
  overall_comment TEXT,
  verdict         TEXT,
  objective_id    UUID,
  goal_title      TEXT,
  goal_points     INT,
  goal_comment    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_emp UUID := (SELECT id FROM employees WHERE user_id = auth.uid());
BEGIN
  RETURN QUERY
  SELECT
    pr.id, pr.review_type, pr.status, pr.overall_comment,
    CASE WHEN pr.review_type = 'year_end' AND pr.status = 'hr_finalized'
         THEN pr.verdict ELSE NULL END,
    o.id, o.title, o.points, rr.comment
  FROM performance_reviews pr
  JOIN objectives o ON o.cycle_id = pr.cycle_id AND o.employee_id = pr.employee_id
  LEFT JOIN performance_review_ratings rr ON rr.review_id = pr.id AND rr.objective_id = o.id
  WHERE pr.cycle_id = p_cycle_id
    AND pr.employee_id = v_emp
    AND pr.status IN ('manager_done', 'hr_finalized')
  ORDER BY pr.review_type, o.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_performance_reviews(UUID) TO authenticated;

-- ── 9. Seed FY2026 annual cycle ──────────────────────────────────────────────
INSERT INTO okr_cycles (name, quarter, year, start_date, end_date, status, cycle_type)
VALUES ('FY2026', NULL, 2026, '2026-01-01', '2026-12-31', 'active', 'annual')
ON CONFLICT DO NOTHING;

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('goal_submissions','performance_reviews','performance_review_ratings')
ORDER BY table_name;
