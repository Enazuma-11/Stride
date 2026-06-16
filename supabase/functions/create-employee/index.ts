// Supabase Edge Function: create-employee
// Handles both "create with password" and "invite via email" flows
// Uses service_role key securely on the server side

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify the requesting user is HR/Admin
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing authorization header')

    // Create admin client with service role key
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Create regular client to verify the caller's role
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_ANON_KEY'),
      { global: { headers: { Authorization: authHeader } } }
    )

    // Verify caller is HR or Admin
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) throw new Error('Unauthorized')

    const { data: caller, error: callerError } = await supabaseClient
      .from('employees')
      .select('role_type')
      .eq('user_id', user.id)
      .single()

    if (callerError || !['hr', 'admin'].includes(caller?.role_type)) {
      throw new Error('Only HR or Admin can create employee accounts')
    }

    // Parse request body
    const body = await req.json()
    const {
      flow,               // 'create_with_password' | 'invite'
      fullName,
      email,
      tempPassword,
      role,
      roleType,
      employeeType,
      department,
      managerId,
      joinDate,
      internshipEndDate,
      phone,
      gender,
      college,
    } = body

    let authUser

    if (flow === 'create_with_password') {
      // Create user with password - active immediately
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })
      if (error) throw error
      authUser = data.user

    } else if (flow === 'invite') {
      // Send invite email - user sets own password
      const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName },
        redirectTo: `${Deno.env.get('SITE_URL') || 'https://sportech-portal.vercel.app'}/set-password`,
      })
      if (error) throw error
      authUser = data.user
    } else if (flow === 'approve_employee') {
      // HR approves self-registered employee - unban them
      const { data: emp } = await supabaseAdmin
        .from('employees')
        .select('user_id')
        .eq('id', body.employeeId)
        .single()

      if (emp?.user_id) {
        await supabaseAdmin.auth.admin.updateUserById(emp.user_id, { ban_duration: 'none' })
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )

    } else if (flow === 'self_register') {
      // Self registration - create unconfirmed user, employee row as inactive
      // No auth check needed for self registration
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: body.password,
        email_confirm: true,  // auto confirm so they can log in after HR approval
        user_metadata: { full_name: fullName },
      })
      if (error) throw error
      authUser = data.user

      // Create employee as inactive pending HR approval
      const initials = fullName.trim().split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
      const { data: emp, error: empError } = await supabaseAdmin
        .from('employees')
        .insert({
          user_id:           authUser.id,
          full_name:         fullName,
          email,
          role:              body.role || 'New Employee',
          role_type:         'employee',
          employee_type:     employeeType || 'permanent',
          department:        department || 'Unassigned',
          avatar_initials:   initials,
          phone:             phone || null,
          join_date:         new Date().toISOString().split('T')[0],
          status:            'inactive',
          onboarding_status: 'pending_approval',
          onboarding_completed: false,
        })
        .select()
        .single()

      if (empError) {
        await supabaseAdmin.auth.admin.deleteUser(authUser.id)
        throw empError
      }

      // Block login until HR approves by banning the user
      await supabaseAdmin.auth.admin.updateUserById(authUser.id, { ban_duration: '87600h' }) // 10 years

      return new Response(
        JSON.stringify({ success: true, employee: emp }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )

    } else {
      throw new Error('Invalid flow. Must be create_with_password, invite, or self_register')
    }

    // Generate initials and employee code
    const initials = fullName.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

    // Get next employee code based on type
    const prefix = employeeType === 'intern' ? 'TRN' : 'SIL'
    const { data: lastEmp } = await supabaseAdmin
      .from('employees')
      .select('employee_code')
      .like('employee_code', prefix + '-%')
      .order('employee_code', { ascending: false })
      .limit(1)
      .single()

    let nextNum = 1
    if (lastEmp?.employee_code) {
      const parts = lastEmp.employee_code.split('-')
      nextNum = parseInt(parts[1] || '0', 10) + 1
    }
    const empCode = `${prefix}-${String(nextNum).padStart(6, '0')}`

    // Create employee profile
    const { data: employee, error: empError } = await supabaseAdmin
      .from('employees')
      .insert({
        user_id:             authUser.id,
        full_name:           fullName,
        email,
        role,
        role_type:           roleType,
        employee_type:       employeeType,
        department,
        avatar_initials:     initials,
        manager_id:          managerId || null,
        phone:               phone || null,
        gender:              gender || 'prefer_not_to_say',
        join_date:           joinDate,
        internship_end_date: employeeType === 'intern' && internshipEndDate ? internshipEndDate : null,
        status:              'active',
        onboarding_status:   flow === 'invite' ? 'invited' : 'active',
        onboarding_completed: false,
        must_change_password: flow === 'create_with_password',
        employee_code:       empCode,
      })
      .select()
      .single()

    if (empError) {
      // Clean up auth user if employee insert failed
      await supabaseAdmin.auth.admin.deleteUser(authUser.id)
      throw empError
    }

    // Seed leave balances based on employee type
    const leaveBalances = getLeaveBalances(employeeType, gender)
    const year = new Date().getFullYear()
    const balanceRows = leaveBalances.map(b => ({
      employee_id: employee.id,
      year,
      ...b,
    }))

    await supabaseAdmin
      .from('leave_balances')
      .upsert(balanceRows, { onConflict: 'employee_id,leave_type,year' })

    // Send welcome notification
    await supabaseAdmin
      .from('notifications')
      .insert({
        employee_id: employee.id,
        type:        'onboarding',
        title:       `Welcome to Stride, ${fullName.split(' ')[0]}! 👋`,
        message:     'Your account is ready. Complete your profile to get started.',
      })

    return new Response(
      JSON.stringify({ success: true, employee }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('create-employee error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})

// Leave balances by employee type and gender
function getLeaveBalances(employeeType, gender) {
  const permanent = [
    { leave_type: 'earned',      total_days: 18  },
    { leave_type: 'casual_sick', total_days: 12  },
    { leave_type: 'statutory',   total_days: 10  },
    { leave_type: 'bereavement', total_days: 7   },
    { leave_type: 'exam',        total_days: 7   },
  ]

  if (gender === 'female') {
    permanent.push({ leave_type: 'maternity', total_days: 182 })
  }

  if (employeeType === 'intern') {
    return [{ leave_type: 'casual_sick', total_days: 12 }]
  }

  if (employeeType === 'contractor') {
    return [
      { leave_type: 'casual_sick', total_days: 12 },
      { leave_type: 'earned',      total_days: 9  },
    ]
  }

  if (employeeType === 'parttime') {
    return [
      { leave_type: 'casual_sick', total_days: 6  },
      { leave_type: 'earned',      total_days: 9  },
    ]
  }

  return permanent
}

// Note: approveEmployee is handled in api.onboarding.js
// When HR approves, call this edge function with flow: 'approve_employee'
// to unban the user
