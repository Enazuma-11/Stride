import { supabase } from './supabase'

// ── Call Supabase Edge Function (handles admin API securely) ─────────────────
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

import { REQUIRES_COMPANY_EMAIL, COMPANY_DOMAIN, LEAVE_BALANCES_BY_TYPE } from './constants'

// ─── EMAIL VALIDATION ─────────────────────────────────────────────────────────

export function validateEmailForType(email, employeeType) {
  const needsCompanyEmail = REQUIRES_COMPANY_EMAIL.includes(employeeType)
  if (needsCompanyEmail && !email.endsWith(`@${COMPANY_DOMAIN}`)) {
    return `${getTypeLabel(employeeType)}s must use a @${COMPANY_DOMAIN} company email.`
  }
  if (!needsCompanyEmail && email.endsWith(`@${COMPANY_DOMAIN}`)) {
    return null // personal email preferred but company email also accepted for interns/contractors
  }
  return null // valid
}

function getTypeLabel(type) {
  const map = { permanent: 'Permanent employee', parttime: 'Part-time employee', intern: 'Intern', contractor: 'Contractor' }
  return map[type] || type
}

// ── Flow 1: HR invites via email ──────────────────────────────────────────────
export async function inviteEmployee({ fullName, email, role, roleType, employeeType, department, managerId, joinDate, internshipEndDate, phone }) {
  const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: `${window.location.origin}/set-password`,
  })
  if (inviteError) throw inviteError

  const initials = toInitials(fullName)
  const { data: emp, error: empError } = await supabase
    .from('employees')
    .insert({
      user_id:            inviteData.user.id,
      full_name:          fullName,
      email,
      role,
      role_type:          roleType,
      employee_type:      employeeType,
      department,
      avatar_initials:    initials,
      manager_id:         managerId || null,
      phone:              phone || null,
      join_date:          joinDate,
      internship_end_date: employeeType === 'intern' ? internshipEndDate : null,
      status:             'active',
      onboarding_status:  'invited',
    })
    .select()
    .single()
  if (empError) throw empError

  await seedLeaveBalances(emp.id, employeeType, form?.gender || 'prefer_not_to_say')
  return emp
}

// ── Flow 2: HR creates with temp password ─────────────────────────────────────
export async function createEmployeeWithPassword({ fullName, email, role, roleType, employeeType, department, managerId, joinDate, internshipEndDate, phone, tempPassword }) {
  const { data: userData, error: userError } = await supabase.auth.admin.createUser({
    email,
    password:      tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (userError) throw userError

  const initials = toInitials(fullName)
  const { data: emp, error: empError } = await supabase
    .from('employees')
    .insert({
      user_id:             userData.user.id,
      full_name:           fullName,
      email,
      role,
      role_type:           roleType,
      employee_type:       employeeType,
      department,
      avatar_initials:     initials,
      manager_id:          managerId || null,
      phone:               phone || null,
      join_date:           joinDate,
      internship_end_date: employeeType === 'intern' ? internshipEndDate : null,
      status:              'active',
      onboarding_status:   'active',
      must_change_password: true,
    })
    .select()
    .single()
  if (empError) throw empError

  await seedLeaveBalances(emp.id, employeeType, form?.gender || 'prefer_not_to_say')
  return emp
}

// ── Flow 3: Employee self-registers ───────────────────────────────────────────
export async function selfRegister({ fullName, email, password, employeeType, department, role, phone }) {
  // Validate email against employee type
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

  await seedLeaveBalances(employeeId, employeeType, form?.gender || 'prefer_not_to_say')
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
  const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${window.location.origin}/set-password`,
  })
  if (error) throw error
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
