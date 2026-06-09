import { supabase } from './supabase'
import { REQUIRES_COMPANY_EMAIL, COMPANY_DOMAIN, LEAVE_BALANCES_BY_TYPE } from './constants'

// ─── EMAIL VALIDATION ─────────────────────────────────────────────────────────

export function validateEmailForType(email, employeeType) {
  const needsCompanyEmail = REQUIRES_COMPANY_EMAIL.includes(employeeType)
  if (needsCompanyEmail && !email.endsWith(`@${COMPANY_DOMAIN}`)) {
    return `${getTypeLabel(employeeType)}s must use a @${COMPANY_DOMAIN} company email.`
  }
  return null
}

function getTypeLabel(type) {
  const map = { permanent: 'Permanent employee', parttime: 'Part-time employee', intern: 'Intern', contractor: 'Contractor' }
  return map[type] || type
}

// ─── EDGE FUNCTION CALLER ─────────────────────────────────────────────────────
async function callEdgeFunction(body) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const url = `${supabaseUrl}/functions/v1/create-employee`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to create employee')
  return data.employee
}

// ── Flow 1: HR invites via email ──────────────────────────────────────────────
export async function inviteEmployee(params) {
  const emailError = validateEmailForType(params.email, params.employeeType)
  if (emailError) throw new Error(emailError)
  return callEdgeFunction({ flow: 'invite', ...params })
}

// ── Flow 2: HR creates with temp password ─────────────────────────────────────
export async function createEmployeeWithPassword(params) {
  const emailError = validateEmailForType(params.email, params.employeeType)
  if (emailError) throw new Error(emailError)
  return callEdgeFunction({ flow: 'create_with_password', ...params })
}

// ── Flow 3: Employee self-registers ───────────────────────────────────────────
export async function selfRegister({ fullName, email, password, employeeType, department, role, phone }) {
  const emailError = validateEmailForType(email, employeeType)
  if (emailError) throw new Error(emailError)

  const { data: signupData, error: signupError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${window.location.origin}/login`,
    },
  })
  if (signupError) throw signupError

  const initials = toInitials(fullName)
  const { data: emp, error: empError } = await supabase
    .from('employees')
    .insert({
      user_id:           signupData.user?.id || null,
      full_name:         fullName,
      email,
      role:              role || 'New Employee',
      role_type:         'employee',
      employee_type:     employeeType,
      department:        department || 'Unassigned',
      avatar_initials:   initials,
      phone:             phone || null,
      join_date:         new Date().toISOString().split('T')[0],
      status:            'inactive',
      onboarding_status: 'pending_approval',
    })
    .select()
    .single()
  if (empError) throw empError
  return emp
}

// ── HR approves a self-registered employee ────────────────────────────────────
export async function approveEmployee(employeeId, { role, roleType, employeeType, department, managerId, joinDate, internshipEndDate }) {
  const { data, error } = await supabase
    .from('employees')
    .update({
      status:              'active',
      onboarding_status:   'active',
      role,
      role_type:           roleType,
      employee_type:       employeeType,
      department,
      manager_id:          managerId || null,
      join_date:           joinDate,
      internship_end_date: employeeType === 'intern' ? internshipEndDate : null,
    })
    .eq('id', employeeId)
    .select()
    .single()
  if (error) throw error

  await seedLeaveBalances(employeeId, employeeType)
  return data
}

export async function rejectEmployee(employeeId) {
  const { error } = await supabase
    .from('employees')
    .update({ status: 'inactive', onboarding_status: 'rejected' })
    .eq('id', employeeId)
  if (error) throw error
}

export async function getPendingRegistrations() {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('onboarding_status', 'pending_approval')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function getAllEmployeesForHR() {
  const { data, error } = await supabase
    .from('employees')
    .select('*, manager:manager_id(id, full_name)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function resendInvite(email) {
  return callEdgeFunction({ flow: 'invite', email, resendOnly: true })
}

export async function deactivateEmployee(employeeId) {
  const { error } = await supabase
    .from('employees')
    .update({ status: 'inactive', onboarding_status: 'offboarded' })
    .eq('id', employeeId)
  if (error) throw error
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function toInitials(fullName) {
  return fullName.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

async function seedLeaveBalances(employeeId, employeeType, gender) {
  const year = new Date().getFullYear()
  const allBalances = LEAVE_BALANCES_BY_TYPE[employeeType] || LEAVE_BALANCES_BY_TYPE.permanent
  const balances = allBalances.filter(b => b.leave_type !== 'maternity' || gender === 'female')
  const rows = balances.map(b => ({ employee_id: employeeId, year, ...b }))
  const { error } = await supabase
    .from('leave_balances')
    .upsert(rows, { onConflict: 'employee_id,leave_type,year' })
  if (error) console.warn('Leave balance seed warning:', error.message)
}
