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
    } else {
      throw new Error('Invalid flow. Must be create_with_password or invite')
    }

    // Generate initials and employee code
    const initials = fullName.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

    // Get next employee code
    const { count } = await supabaseAdmin
      .from('employees')
      .select('*', { count: 'exact', head: true })

    const empCode = `SIL-${String((count || 0) + 1).padStart(3, '0')}`

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
