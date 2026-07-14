# Database Migrations — Run Order

All SQL lives as loose files in the repo root and is applied **manually** in the
Supabase SQL Editor. Run each file **once per environment** (Production **and**
Test), in the order below. Every file is idempotent (`IF NOT EXISTS` /
`DROP … IF EXISTS`), so re-running is safe.

> **New environment?** Run the whole list top to bottom.
> **Existing environment?** You only need the files under "Recent hardening" at
> the bottom that you haven't applied yet.

## 1. Core schema & seed
1. `supabase_schema.sql` — base tables, `current_employee_role()`, core RLS
2. `seed_admin_accounts.sql` — founder/HR employee rows (create Auth users separately)
3. `supabase_fix_roles.sql` — role_type corrections

## 2. Onboarding
4. `supabase_migration_onboarding.sql`
5. `supabase_migration_onboarding_form.sql`
6. `supabase_migration_onboarding_wizard.sql`
7. `supabase_migration_onboarding_documents_fix.sql`
8. `supabase_migration_employee_documents_schema_sync.sql`
9. `supabase_migration_education_docs.sql`
10. `supabase_migration_employee_type.sql`
11. `supabase_migration_gender.sql`
12. `supabase_migration_profile.sql`

## 3. Attendance & leave
13. `supabase_migration_attendance.sql`
14. `supabase_migration_attendance_sessions.sql`
15. `supabase_migration_halfday.sql`
16. `supabase_migration_attendance_regularization.sql`
17. `supabase_migration_leave_structure.sql`
18. `supabase_migration_leave_adjustments.sql`
19. `supabase_migration_unpaid_leave.sql`
20. `supabase_migration_holiday_optins.sql`

## 4. Notifications, comms, docs
21. `supabase_migration_notifications.sql`
22. `supabase_migration_notifications_insert_fix.sql` *(superseded by security hardening — see §7)*
23. `supabase_migration_payslips_announcements.sql`
24. `supabase_migration_announcement_acknowledgements.sql`
25. `supabase_migration_policy_chat.sql`
26. `supabase_migration_hr_admin_lookup.sql`

## 5. Performance & people ops
27. `supabase_migration_okrs.sql`
28. `supabase_migration_manager_transfers.sql`
29. `supabase_migration_probation.sql`
30. `supabase_migration_performance_goals.sql`
31. `supabase_migration_performance_lifecycle.sql` *(re-creates `run_lifecycle_reminders()` with all 16 events — run **after** probation)*
32. `supabase_migration_weekly_attendance_report.sql`

## 6. Storage & environment sync
33. `supabase_migration_storage_policies_test_sync.sql`
34. `supabase_bugfix_smoke_test.sql`
35. `supabase_migration_founders_resequence.sql` *(one-off data fix — optional)*

## 7. Recent hardening (apply if not yet run)
36. `supabase_migration_security_hardening.sql`
    — blocks employee self-escalation, tightens notifications/okr_checkins/chat RLS
37. `supabase_migration_perf_indexes_atomic_balance.sql`
    — `apply_leave_balance_delta()` RPC + missing indexes

---

## Notes & known drift
- `lifecycle_reminders` has three generations: `supabase_migration_lifecycle_reminders.sql`
  → `…_weekly_attendance_report.sql` → `…_probation.sql` → `…_performance_lifecycle.sql`.
  **The performance_lifecycle version is authoritative** — it contains every event.
  Running it last guarantees the function is complete.
- `notifications_insert_fix.sql` opened INSERT to any authenticated user; the
  **security_hardening** migration replaces that policy. Always apply hardening last.
- Long-term: migrate these into the Supabase CLI (`supabase/migrations/`) so
  ordering and Prod/Test parity are enforced automatically instead of by hand.
