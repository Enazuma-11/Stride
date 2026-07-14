-- ============================================================
-- STRIDE — SECURITY HARDENING
-- Run in: Supabase Dashboard → SQL Editor (Production AND Test)
--
-- Closes:
--   CRITICAL-1  Employee self-escalation to admin via employees UPDATE
--   HIGH-2      notifications INSERT open to any authenticated user
--   MEDIUM-3    okr_checkins world read/write; chat channel membership open
-- ============================================================

-- ── Helper: cached current employee id (per-statement STABLE) ─────────────────
-- Lets policies avoid repeating the subquery and lets Postgres cache the lookup.
CREATE OR REPLACE FUNCTION current_employee_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT id FROM employees WHERE user_id = auth.uid() LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION current_employee_id() TO authenticated;

-- ══════════════════════════════════════════════════════════════════
-- CRITICAL-1: Block employees from editing their own privileged fields
-- RLS cannot do column-level WITH CHECK, so we guard with a trigger.
-- HR/Admin are exempt (they legitimately manage these via hr_manage_employees).
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION guard_employee_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only constrain non-HR actors editing their OWN row.
  IF current_employee_role() NOT IN ('hr', 'admin')
     AND OLD.user_id = auth.uid() THEN
    IF NEW.role_type      IS DISTINCT FROM OLD.role_type
    OR NEW.employee_type  IS DISTINCT FROM OLD.employee_type
    OR NEW.status         IS DISTINCT FROM OLD.status
    OR NEW.onboarding_status IS DISTINCT FROM OLD.onboarding_status
    OR NEW.manager_id     IS DISTINCT FROM OLD.manager_id
    OR NEW.email          IS DISTINCT FROM OLD.email
    OR NEW.join_date      IS DISTINCT FROM OLD.join_date
    OR NEW.probation_end_date IS DISTINCT FROM OLD.probation_end_date
    OR NEW.probation_extended IS DISTINCT FROM OLD.probation_extended THEN
      RAISE EXCEPTION 'You are not allowed to modify privileged employee fields. Submit a change request for HR approval.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_employee_self_update ON employees;
CREATE TRIGGER trg_guard_employee_self_update
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION guard_employee_self_update();

-- ══════════════════════════════════════════════════════════════════
-- HIGH-2: Tighten notifications INSERT — remove the blanket bypass.
-- Cross-employee notifications are created by SECURITY DEFINER functions
-- (which run with elevated rights) or by HR/Admin. A plain employee may
-- only insert notifications addressed to themselves.
-- ══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "notifications_insert" ON notifications;
CREATE POLICY "notifications_insert" ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = current_employee_id()
    OR current_employee_role() IN ('hr', 'admin')
  );

-- ══════════════════════════════════════════════════════════════════
-- MEDIUM-3a: okr_checkins — scope to owner, their manager, or HR/Admin.
-- Previously: USING (true) WITH CHECK (true) — any employee could read
-- and write anyone's check-in notes.
-- ══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "checkins_all" ON okr_checkins;

CREATE POLICY "checkins_read" ON okr_checkins
  FOR SELECT TO authenticated
  USING (
    employee_id = current_employee_id()
    OR current_employee_role() IN ('hr', 'admin')
    OR employee_id IN (SELECT id FROM employees WHERE manager_id = current_employee_id())
  );

CREATE POLICY "checkins_write" ON okr_checkins
  FOR ALL TO authenticated
  USING (
    employee_id = current_employee_id()
    OR current_employee_role() IN ('hr', 'admin')
  )
  WITH CHECK (
    employee_id = current_employee_id()
    OR current_employee_role() IN ('hr', 'admin')
  );

-- ══════════════════════════════════════════════════════════════════
-- MEDIUM-3b: chat_channel_members — a member may only manage their OWN
-- membership; HR/Admin manage all. Previously USING (true) let anyone
-- add themselves to any channel and read its messages.
-- ══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "members_all" ON chat_channel_members;

CREATE POLICY "members_read" ON chat_channel_members
  FOR SELECT TO authenticated
  USING (true);  -- membership lists are visible; message access is gated below

CREATE POLICY "members_write_own" ON chat_channel_members
  FOR ALL TO authenticated
  USING (
    employee_id = current_employee_id()
    OR current_employee_role() IN ('hr', 'admin')
  )
  WITH CHECK (
    employee_id = current_employee_id()
    OR current_employee_role() IN ('hr', 'admin')
  );

-- ══════════════════════════════════════════════════════════════════
-- MEDIUM-3c: chat_messages read — gate channel messages on actual
-- membership instead of the blanket `channel_id IS NOT NULL`.
-- ══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "messages_read" ON chat_messages;
CREATE POLICY "messages_read" ON chat_messages
  FOR SELECT TO authenticated
  USING (
    -- Channel messages: only if the viewer is a member of that channel
    (channel_id IS NOT NULL AND channel_id IN (
      SELECT channel_id FROM chat_channel_members WHERE employee_id = current_employee_id()
    ))
    -- Direct messages: only the two participants
    OR (conversation_id IS NOT NULL AND conversation_id IN (
      SELECT id FROM chat_conversations WHERE
        member_one = current_employee_id() OR member_two = current_employee_id()
    ))
    OR current_employee_role() IN ('hr', 'admin')
  );

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT tgname FROM pg_trigger WHERE tgname = 'trg_guard_employee_self_update';
SELECT policyname FROM pg_policies
WHERE tablename IN ('notifications','okr_checkins','chat_channel_members','chat_messages')
ORDER BY tablename, policyname;
