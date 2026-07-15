#!/usr/bin/env node
/**
 * CRITICAL-1 verification — privilege-escalation guard.
 *
 * Signs in as a REGULAR (non-HR) employee using the public anon key — the
 * exact path an attacker would use — and confirms the DB trigger
 * `trg_guard_employee_self_update` blocks self-escalation while still
 * allowing a legitimate non-privileged self-update.
 *
 * You supply everything via env vars; this script never stores or prints
 * secrets. Run against your TEST environment (it performs a real update).
 *
 * Usage:
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_ANON_KEY=eyJ... \
 *   EMP_EMAIL=employee@example.com \
 *   EMP_PASSWORD='the-password' \
 *   node scripts/verify-critical1.mjs
 */
import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_ANON_KEY, EMP_EMAIL, EMP_PASSWORD } = process.env

const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'EMP_EMAIL', 'EMP_PASSWORD']
  .filter(k => !process.env[k])
if (missing.length) {
  console.error('Missing required env vars: ' + missing.join(', '))
  process.exit(2)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

function line(ok, label, detail) {
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
  return ok
}

const results = []

// ── Sign in as the employee ───────────────────────────────────────────────────
const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
  email: EMP_EMAIL, password: EMP_PASSWORD,
})
if (authErr || !auth?.user) {
  console.error('Could not sign in as the employee:', authErr?.message || 'no session')
  process.exit(2)
}
const userId = auth.user.id

// Fetch own employee row (confirms not HR/admin, gives us a baseline).
const { data: me, error: meErr } = await supabase
  .from('employees')
  .select('id, role_type, status, profile_photo_url')
  .eq('user_id', userId)
  .single()
if (meErr || !me) {
  console.error('Could not read own employee row:', meErr?.message)
  process.exit(2)
}
if (['hr', 'admin'].includes(me.role_type)) {
  console.error(`This account is '${me.role_type}'. Use a REGULAR employee — HR/admin are exempt from the guard by design.`)
  process.exit(2)
}
console.log(`Signed in as role_type='${me.role_type}'. Running checks…\n`)

// ── Check 1: escalate role_type → admin (MUST be blocked) ─────────────────────
{
  const { data, error } = await supabase
    .from('employees').update({ role_type: 'admin' }).eq('user_id', userId).select('role_type')
  const blocked = !!error || !(data && data.length && data[0].role_type === 'admin')
  results.push(line(blocked, 'role_type escalation blocked',
    error ? `rejected: "${error.message}"` : (data?.[0]?.role_type === 'admin' ? 'NOT blocked — role_type changed!' : 'no row changed')))
}

// ── Check 2: flip own status → inactive (MUST be blocked) ─────────────────────
{
  const { data, error } = await supabase
    .from('employees').update({ status: 'inactive' }).eq('user_id', userId).select('status')
  const blocked = !!error || !(data && data.length && data[0].status === 'inactive')
  results.push(line(blocked, 'status change blocked',
    error ? `rejected: "${error.message}"` : (data?.[0]?.status === 'inactive' ? 'NOT blocked — status changed!' : 'no row changed')))
}

// ── Check 3: legitimate non-privileged self-update (MUST be allowed) ──────────
{
  const marker = me.profile_photo_url || null // write back the same value — no visible change
  const { data, error } = await supabase
    .from('employees').update({ profile_photo_url: marker }).eq('user_id', userId).select('id')
  const allowed = !error && data && data.length === 1
  results.push(line(allowed, 'legitimate self-update allowed',
    error ? `wrongly rejected: "${error.message}"` : 'ok'))
}

// ── Confirm role really did not change in the DB ──────────────────────────────
{
  const { data } = await supabase.from('employees').select('role_type, status').eq('user_id', userId).single()
  const intact = data?.role_type === me.role_type && data?.status === me.status
  results.push(line(intact, 'DB state unchanged after attack',
    `role_type='${data?.role_type}', status='${data?.status}'`))
}

await supabase.auth.signOut()

const allPass = results.every(Boolean)
console.log(`\n${allPass ? '✅ CRITICAL-1 CLOSED — guard works as intended.' : '❌ CRITICAL-1 NOT closed — see failures above.'}`)
process.exit(allPass ? 0 : 1)
