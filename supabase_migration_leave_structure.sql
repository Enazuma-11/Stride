-- ============================================================
-- STRIDE — LEAVE STRUCTURE UPDATE MIGRATION
-- SporTech Innovation Lab Pvt Ltd
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ─── STEP 1: Update leave_balances check constraint ───────────
-- Drop old constraint and add new one with correct leave types

ALTER TABLE leave_balances
  DROP CONSTRAINT IF EXISTS leave_balances_leave_type_check;

ALTER TABLE leave_balances
  ADD CONSTRAINT leave_balances_leave_type_check
  CHECK (leave_type IN (
    'earned',
    'casual_sick',
    'statutory',
    'maternity',
    'bereavement',
    'exam'
  ));

-- ─── STEP 2: Update leave_requests check constraint ───────────
ALTER TABLE leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_leave_type_check;

ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_leave_type_check
  CHECK (leave_type IN (
    'earned',
    'casual_sick',
    'statutory',
    'maternity',
    'bereavement',
    'exam'
  ));

-- ─── STEP 3: Update Amit's leave balances (permanent) ─────────
-- First remove old balances
DELETE FROM leave_balances
WHERE employee_id = (SELECT id FROM employees WHERE email = 'amit.chobitkar@sportechinnolab.org');

-- Insert correct balances
INSERT INTO leave_balances (employee_id, leave_type, year, total_days)
SELECT e.id, lt.leave_type, 2026, lt.total_days
FROM employees e
CROSS JOIN (VALUES
  ('earned',      18 ),
  ('casual_sick', 12 ),
  ('statutory',   10 ),
  ('maternity',   182),
  ('bereavement', 7  ),
  ('exam',        7  )
) AS lt(leave_type, total_days)
WHERE e.email = 'amit.chobitkar@sportechinnolab.org'
ON CONFLICT (employee_id, leave_type, year) DO UPDATE
  SET total_days = EXCLUDED.total_days;

-- ─── STEP 4: Update Edward's leave balances (permanent) ───────
DELETE FROM leave_balances
WHERE employee_id = (SELECT id FROM employees WHERE email = 'talent@sportechinnolab.org');

INSERT INTO leave_balances (employee_id, leave_type, year, total_days)
SELECT e.id, lt.leave_type, 2026, lt.total_days
FROM employees e
CROSS JOIN (VALUES
  ('earned',      18 ),
  ('casual_sick', 12 ),
  ('statutory',   10 ),
  ('maternity',   182),
  ('bereavement', 7  ),
  ('exam',        7  )
) AS lt(leave_type, total_days)
WHERE e.email = 'talent@sportechinnolab.org'
ON CONFLICT (employee_id, leave_type, year) DO UPDATE
  SET total_days = EXCLUDED.total_days;

-- ─── STEP 5: Clear old holidays and insert correct 2026 list ──
DELETE FROM holidays WHERE year = 2026;

INSERT INTO holidays (name, date, type, year) VALUES
  ('Pongal / Makar Sankranti',           '2026-01-14', 'optional',  2026),
  ('Republic Day',                        '2026-01-26', 'mandatory', 2026),
  ('Chhatrapati Shivaji Maharaj Jayanti', '2026-02-19', 'optional',  2026),
  ('Holi',                                '2026-03-03', 'optional',  2026),
  ('Gudi Padwa',                          '2026-03-19', 'optional',  2026),
  ('Parsi New Year',                      '2026-03-20', 'optional',  2026),
  ('Ram Navami',                          '2026-03-26', 'optional',  2026),
  ('Mahavir Jayanti',                     '2026-03-31', 'optional',  2026),
  ('Good Friday',                         '2026-04-03', 'optional',  2026),
  ('Dr Babasaheb Ambedkar Jayanti',       '2026-04-14', 'optional',  2026),
  ('Maharashtra Day & Labour Day',         '2026-05-01', 'mandatory', 2026),
  ('Bakrid / Id-ul-Zuha',                 '2026-05-28', 'optional',  2026),
  ('Muharram',                            '2026-06-26', 'optional',  2026),
  ('Independence Day',                    '2026-08-15', 'mandatory', 2026),
  ('Id-e-Milad',                          '2026-08-26', 'optional',  2026),
  ('Ganesh Chaturthi',                    '2026-09-14', 'optional',  2026),
  ('Mahatma Gandhi Jayanti',              '2026-10-02', 'mandatory', 2026),
  ('Dasara (Vijaya Dashami)',             '2026-10-20', 'optional',  2026),
  ('Govardhan Pooja',                     '2026-11-09', 'optional',  2026),
  ('Bhai Dooj',                           '2026-11-10', 'optional',  2026),
  ('Guru Nanak Jayanti',                  '2026-11-24', 'optional',  2026),
  ('Christmas',                           '2026-12-25', 'optional',  2026)
ON CONFLICT (date) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type;

-- ─── STEP 6: Verify ───────────────────────────────────────────
SELECT e.full_name, lb.leave_type, lb.total_days, lb.remaining
FROM leave_balances lb
JOIN employees e ON e.id = lb.employee_id
WHERE lb.year = 2026
ORDER BY e.full_name, lb.leave_type;
