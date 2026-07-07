import { supabase } from './supabase'
import { createNotification } from './api.notifications'

export async function getProbationEmployees() {
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name, avatar_initials, department, role, join_date, probation_end_date, probation_extended, manager:manager_id(full_name)')
    .eq('employee_type', 'probation')
    .eq('status', 'active')
    .order('probation_end_date', { ascending: true })
  if (error) throw error
  return data || []
}

export async function getMyProbationStatus(employeeId) {
  const { data: emp, error } = await supabase
    .from('employees')
    .select('id, employee_type, probation_end_date, probation_extended')
    .eq('id', employeeId)
    .single()
  if (error) throw error

  const { data: review } = await supabase
    .from('probation_reviews')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return { employee: emp, review }
}

export async function getPendingReviews() {
  const { data, error } = await supabase
    .from('probation_reviews')
    .select('*, employee:employee_id(id, full_name, avatar_initials, department, role, probation_end_date, probation_extended), manager:manager_id(full_name)')
    .in('status', ['pending_manager', 'pending_hr'])
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function getManagerPendingReviews(managerId) {
  const { data: reports } = await supabase
    .from('employees')
    .select('id')
    .eq('manager_id', managerId)
  const reportIds = (reports || []).map(r => r.id)
  if (reportIds.length === 0) return []

  const { data, error } = await supabase
    .from('probation_reviews')
    .select('*, employee:employee_id(id, full_name, avatar_initials, probation_end_date, probation_extended)')
    .in('employee_id', reportIds)
    .in('status', ['pending_manager', 'pending_hr'])
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function createProbationReview(employeeId) {
  const { data: existing } = await supabase
    .from('probation_reviews')
    .select('id')
    .eq('employee_id', employeeId)
    .in('status', ['pending_manager', 'pending_hr'])
    .maybeSingle()
  if (existing) return existing

  const { data, error } = await supabase
    .from('probation_reviews')
    .insert({ employee_id: employeeId, status: 'pending_manager' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function managerSubmitReview(reviewId, { recommendation, notes, extensionDays }, managerId) {
  if (!['confirm', 'extend', 'relieve'].includes(recommendation))
    throw new Error('Invalid recommendation.')
  if (!notes?.trim()) throw new Error('Notes are required.')
  if (recommendation === 'extend' && (!extensionDays || extensionDays <= 0))
    throw new Error('Extension duration is required when extending.')

  const { data, error } = await supabase
    .from('probation_reviews')
    .update({
      status:                 'pending_hr',
      manager_recommendation: recommendation,
      manager_notes:          notes.trim(),
      extension_days:         recommendation === 'extend' ? Number(extensionDays) : null,
      manager_id:             managerId,
      manager_reviewed_at:    new Date().toISOString(),
    })
    .eq('id', reviewId)
    .eq('status', 'pending_manager')
    .select('*, employee:employee_id(id, full_name)')
    .single()
  if (error) throw error

  try {
    const { data: hrList } = await supabase.rpc('get_hr_admin_employee_ids')
    if (hrList?.length) {
      await supabase.from('notifications').insert(
        hrList.map(hr => ({
          employee_id: hr.id,
          type:        'probation_review_submitted',
          title:       '📋 Probation Review — Awaiting Decision',
          message:     `${data.employee?.full_name}'s probation review has been submitted. Your decision is required.`,
          metadata:    { review_id: reviewId },
          is_read:     false,
        }))
      )
    }
  } catch (e) { console.warn('Probation manager review notification failed:', e.message) }

  return data
}

export async function hrDecideReview(reviewId, { decision, notes, extensionDays }, hrAdminId) {
  if (!['confirmed', 'extended', 'relieved'].includes(decision))
    throw new Error('Invalid decision.')
  if (decision === 'extended' && (!extensionDays || extensionDays <= 0))
    throw new Error('Extension duration is required.')

  const { data: review, error: fetchError } = await supabase
    .from('probation_reviews')
    .select('*, employee:employee_id(id, full_name, probation_end_date)')
    .eq('id', reviewId)
    .single()
  if (fetchError) throw fetchError
  if (review.status !== 'pending_hr') throw new Error('This review is not awaiting HR decision.')

  if (decision === 'confirmed') {
    const { error } = await supabase
      .from('employees').update({ employee_type: 'permanent' }).eq('id', review.employee.id)
    if (error) throw error
  } else if (decision === 'extended') {
    const base = new Date(review.employee.probation_end_date)
    base.setDate(base.getDate() + Number(extensionDays))
    const newEnd = base.toISOString().split('T')[0]
    const { error } = await supabase
      .from('employees')
      .update({ probation_end_date: newEnd, probation_extended: true })
      .eq('id', review.employee.id)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('employees')
      .update({ status: 'inactive', onboarding_status: 'offboarded' })
      .eq('id', review.employee.id)
    if (error) throw error
  }

  const { data, error: updateError } = await supabase
    .from('probation_reviews')
    .update({
      status:           'decided',
      hr_decision:      decision,
      hr_notes:         notes?.trim() || null,
      hr_extension_days: decision === 'extended' ? Number(extensionDays) : null,
      hr_decided_by:    hrAdminId,
      hr_decided_at:    new Date().toISOString(),
    })
    .eq('id', reviewId)
    .select()
    .single()
  if (updateError) throw updateError

  const msgs = {
    confirmed: { title: '🎉 You\'ve Been Confirmed!',  message: 'Congratulations — you\'ve been confirmed as a permanent team member.' },
    extended:  { title: 'Probation Extended',          message: `Your probation has been extended by ${extensionDays} days.` },
    relieved:  { title: 'Probation Period Ended',      message: 'Your probation period has ended. Please check with HR for next steps.' },
  }
  try {
    await createNotification({
      employeeId: review.employee.id,
      type: 'probation_decided',
      ...msgs[decision],
      metadata: { review_id: reviewId },
    })
  } catch (e) { console.warn('Probation decision notification failed:', e.message) }

  return data
}
