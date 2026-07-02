-- ============================================================
-- STRIDE — RE-APPLY NOTIFICATIONS INSERT POLICY
-- Run in: Supabase Dashboard → SQL Editor (both Production and Test projects)
--
-- Why: submitting a regularization request as a regular (non-HR/Admin)
-- employee with no manager failed with "new row violates row-level
-- security policy for table notifications". This is the first time
-- this code path (a regular employee inserting a notification for
-- someone else — the HR/Admin recipient) has actually run against the
-- live database, since it was previously blocked by an unrelated RLS
-- bug (fixed in supabase_migration_hr_admin_lookup.sql) that meant no
-- recipient was ever found. The notifications_insert policy in
-- supabase_migration_notifications.sql is already written correctly
-- (with a permissive `auth.uid() IS NOT NULL` clause covering exactly
-- this case), but that file has no DROP POLICY IF EXISTS guard, so if
-- it was ever run more than once, or under slightly different
-- conditions, a stale definition could still be live. This safely
-- resets the policy to its correct definition — a no-op if it was
-- already correct.
-- ============================================================

DROP POLICY IF EXISTS "notifications_insert" ON notifications;
CREATE POLICY "notifications_insert" ON notifications
  FOR INSERT WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())
    OR current_employee_role() IN ('hr', 'admin')
    OR auth.uid() IS NOT NULL  -- Allow any authenticated session to notify another employee
  );
