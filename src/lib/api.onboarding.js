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

  // Use Edge Function - no auth needed for self registration
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const url = `${supabaseUrl}/functions/v1/create-employee`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      flow: 'self_register',
      fullName, email, password,
      employeeType, department,
      role: role || 'New Employee',
      phone,
    }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Registration failed')
  return data.employee
}

// ── HR approves a self-registered employee ────────────────────────────────────
export async function approveEmployee(employeeId, { role, roleType, employeeType, department, managerId, joinDate, internshipEndDate }) {
  let probationEndDate = null
  if (employeeType === 'probation' && joinDate) {
    const d = new Date(joinDate)
    d.setMonth(d.getMonth() + 6)
    probationEndDate = d.toISOString().split('T')[0]
  }

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
      probation_end_date:  probationEndDate,
    })
    .eq('id', employeeId)
    .select()
    .single()
  if (error) throw error

  // Unban the user via Edge Function
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    await fetch(`${supabaseUrl}/functions/v1/create-employee`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ flow: 'approve_employee', employeeId }),
    })
  } catch (e) { console.warn('Unban warning:', e.message) }

  await seedLeaveBalances(employeeId, employeeType)

  // Notify employee their account is approved
  try {
    await supabase.from('notifications').insert({
      employee_id: employeeId,
      type:    'onboarding',
      title:   '🎉 Account Approved! Welcome to Stride',
      message: 'Your account has been approved by HR. You can now access all portal features.',
      is_read: false,
    })
  } catch (e) { console.warn('Approval notification failed:', e.message) }

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
