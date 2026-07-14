import { supabase } from './supabase'
import { createNotification } from './api.notifications'

// ── Cycle ─────────────────────────────────────────────────────────────────────
export async function getAnnualCycle() {
  const { data, error } = await supabase
    .from('okr_cycles')
    .select('*')
    .eq('cycle_type', 'annual')
    .order('year', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

// ── Employee: my goal set ─────────────────────────────────────────────────────
export async function getMyGoalSet(cycleId, employeeId) {
  const { data: submission } = await supabase
    .from('goal_submissions')
    .select('*')
    .eq('cycle_id', cycleId)
    .eq('employee_id', employeeId)
    .maybeSingle()

  const { data: goals, error } = await supabase
    .from('objectives')
    .select('id, title, description, points')
    .eq('cycle_id', cycleId)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: true })
  if (error) throw error

  return { submission: submission || null, goals: goals || [] }
}

// goals: [{ id?, title, description, points }]
export async function saveGoalDraft(cycleId, employeeId, goals) {
  // Ensure a draft submission row exists (unless already submitted/approved handling is caller's job)
  const { data: existing } = await supabase
    .from('goal_submissions')
    .select('id, status')
    .eq('cycle_id', cycleId)
    .eq('employee_id', employeeId)
    .maybeSingle()

  if (!existing) {
    const { error } = await supabase
      .from('goal_submissions')
      .insert({ cycle_id: cycleId, employee_id: employeeId, status: 'draft' })
    if (error) throw error
  } else if (existing.status === 'returned') {
    // reopening after a return keeps it editable; leave status as returned until resubmit
  }

  // Reconcile objectives: delete removed, upsert provided
  const { data: current } = await supabase
    .from('objectives')
    .select('id')
    .eq('cycle_id', cycleId)
    .eq('employee_id', employeeId)
  const keepIds = goals.filter(g => g.id).map(g => g.id)
  const toDelete = (current || []).filter(o => !keepIds.includes(o.id)).map(o => o.id)
  if (toDelete.length) {
    const { error } = await supabase.from('objectives').delete().in('id', toDelete)
    if (error) throw error
  }

  for (const g of goals) {
    if (g.id) {
      const { error } = await supabase.from('objectives')
        .update({ title: g.title, description: g.description || null, points: g.points, updated_at: new Date().toISOString() })
        .eq('id', g.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('objectives')
        .insert({ cycle_id: cycleId, employee_id: employeeId, title: g.title, description: g.description || null, points: g.points, created_by: employeeId })
      if (error) throw error
    }
  }

  await supabase.from('goal_submissions')
    .update({ updated_at: new Date().toISOString() })
    .eq('cycle_id', cycleId).eq('employee_id', employeeId)
}

export async function submitGoalSet(cycleId, employeeId) {
  // Client-side pre-check mirrors the DB trigger for a friendly error
  const { data: goals } = await supabase
    .from('objectives').select('points')
    .eq('cycle_id', cycleId).eq('employee_id', employeeId)
  const count = goals?.length || 0
  const sum = (goals || []).reduce((s, g) => s + (g.points || 0), 0)
  if (count < 5 || count > 8) throw new Error(`You must have 5–8 goals (currently ${count}).`)
  if (sum !== 100) throw new Error(`Points must total exactly 100 (currently ${sum}).`)

  const { data, error } = await supabase
    .from('goal_submissions')
    .update({ status: 'submitted', submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('cycle_id', cycleId).eq('employee_id', employeeId)
    .select('employee_id')
    .single()
  if (error) throw error

  // Notify manager (best-effort)
  try {
    const { data: emp } = await supabase.from('employees').select('full_name, manager_id').eq('id', employeeId).single()
    if (emp?.manager_id) {
      await createNotification({
        employeeId: emp.manager_id,
        type: 'goal_submitted',
        title: '🎯 Goals Awaiting Your Approval',
        message: `${emp.full_name} submitted their performance goals for review.`,
        metadata: { cycle_id: cycleId, employee_id: employeeId },
      })
    }
  } catch (e) { console.warn('Goal submit notification failed:', e.message) }

  return data
}

// ── Manager: goal approvals ───────────────────────────────────────────────────
export async function getManagerGoalApprovals(managerId, cycleId) {
  const { data: reports } = await supabase.from('employees').select('id').eq('manager_id', managerId)
  const ids = (reports || []).map(r => r.id)
  if (!ids.length) return []

  const { data, error } = await supabase
    .from('goal_submissions')
    .select('*, employee:employee_id(id, full_name, avatar_initials, department)')
    .eq('cycle_id', cycleId)
    .in('employee_id', ids)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: true })
  if (error) throw error
  if (!data?.length) return []

  // Attach goals — fetch all in one query, then group by employee (avoids N+1).
  const submittedIds = data.map(s => s.employee_id)
  const { data: allGoals } = await supabase
    .from('objectives').select('id, title, description, points, employee_id')
    .eq('cycle_id', cycleId).in('employee_id', submittedIds)
    .order('created_at', { ascending: true })
  const goalsByEmployee = {}
  for (const g of allGoals || []) {
    ;(goalsByEmployee[g.employee_id] ||= []).push({ id: g.id, title: g.title, description: g.description, points: g.points })
  }
  for (const sub of data) sub.goals = goalsByEmployee[sub.employee_id] || []
  return data
}

export async function approveGoalSet(submissionId, managerId) {
  const { data, error } = await supabase
    .from('goal_submissions')
    .update({ status: 'approved', manager_id: managerId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', submissionId)
    .eq('status', 'submitted')
    .select('employee_id')
    .single()
  if (error) throw error
  try {
    await createNotification({
      employeeId: data.employee_id, type: 'goal_approved',
      title: '✅ Goals Approved',
      message: 'Your performance goals have been approved for the year.',
      metadata: { submission_id: submissionId },
    })
  } catch (e) { console.warn('Goal approve notification failed:', e.message) }
}

export async function returnGoalSet(submissionId, comment, managerId) {
  if (!comment?.trim()) throw new Error('Please add a comment explaining what to change.')
  const { data, error } = await supabase
    .from('goal_submissions')
    .update({ status: 'returned', manager_comment: comment.trim(), manager_id: managerId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', submissionId)
    .eq('status', 'submitted')
    .select('employee_id')
    .single()
  if (error) throw error
  try {
    await createNotification({
      employeeId: data.employee_id, type: 'goal_returned',
      title: '↩️ Goals Returned for Revision',
      message: 'Your manager asked for changes to your goals. Please review and resubmit.',
      metadata: { submission_id: submissionId },
    })
  } catch (e) { console.warn('Goal return notification failed:', e.message) }
}

// ── Manager: reviews ──────────────────────────────────────────────────────────
export async function getManagerReviewTargets(managerId, cycleId) {
  const { data: reports } = await supabase
    .from('employees').select('id, full_name, avatar_initials, department').eq('manager_id', managerId)
  const ids = (reports || []).map(r => r.id)
  if (!ids.length) return []

  // Only reports with an approved goal set are reviewable
  const { data: approved } = await supabase
    .from('goal_submissions').select('employee_id')
    .eq('cycle_id', cycleId).in('employee_id', ids).eq('status', 'approved')
  const approvedIds = (approved || []).map(a => a.employee_id)
  if (!approvedIds.length) return []

  // Batch goals + reviews across all approved reports (avoids N+1), group in JS.
  const { data: allGoals } = await supabase
    .from('objectives').select('id, title, description, points, employee_id')
    .eq('cycle_id', cycleId).in('employee_id', approvedIds)
    .order('created_at', { ascending: true })
  const { data: allReviews } = await supabase
    .from('performance_reviews')
    .select('*, ratings:performance_review_ratings(objective_id, score, comment)')
    .eq('cycle_id', cycleId).in('employee_id', approvedIds)

  const goalsByEmployee = {}
  for (const g of allGoals || []) {
    ;(goalsByEmployee[g.employee_id] ||= []).push({ id: g.id, title: g.title, description: g.description, points: g.points })
  }
  const reviewsByEmployee = {}
  for (const rv of allReviews || []) {
    ;(reviewsByEmployee[rv.employee_id] ||= []).push(rv)
  }

  return (reports || [])
    .filter(r => approvedIds.includes(r.id))
    .map(emp => ({ employee: emp, goals: goalsByEmployee[emp.id] || [], reviews: reviewsByEmployee[emp.id] || [] }))
}

// ratings: [{ objectiveId, score, comment }]
export async function saveReview({ reviewId, cycleId, employeeId, reviewType, ratings, overallComment, verdict }, managerId) {
  if (reviewType === 'year_end' && !verdict) throw new Error('A verdict is required for the year-end review.')

  let id = reviewId
  if (!id) {
    const { data, error } = await supabase
      .from('performance_reviews')
      .insert({ cycle_id: cycleId, employee_id: employeeId, review_type: reviewType,
                status: 'manager_done', overall_comment: overallComment || null,
                verdict: reviewType === 'year_end' ? verdict : null,
                manager_id: managerId, manager_reviewed_at: new Date().toISOString() })
      .select('id')
      .single()
    if (error) throw error
    id = data.id
  } else {
    const { error } = await supabase
      .from('performance_reviews')
      .update({ status: 'manager_done', overall_comment: overallComment || null,
                verdict: reviewType === 'year_end' ? verdict : null,
                manager_id: managerId, manager_reviewed_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  }

  // Upsert ratings per objective
  for (const rt of ratings) {
    const { data: existing } = await supabase
      .from('performance_review_ratings').select('id')
      .eq('review_id', id).eq('objective_id', rt.objectiveId).maybeSingle()
    if (existing) {
      const { error } = await supabase.from('performance_review_ratings')
        .update({ score: rt.score ?? null, comment: rt.comment || null, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('performance_review_ratings')
        .insert({ review_id: id, objective_id: rt.objectiveId, score: rt.score ?? null, comment: rt.comment || null })
      if (error) throw error
    }
  }

  // Notify employee (comments available now) + HR if year_end (finalization needed)
  try {
    await createNotification({
      employeeId, type: 'review_submitted',
      title: reviewType === 'h1' ? '📊 Your H1 Review is Ready' : '🏁 Your Year-End Review is Ready',
      message: 'Your manager has completed your review. View their feedback in Performance.',
      metadata: { review_id: id, review_type: reviewType },
    })
    if (reviewType === 'year_end') {
      const { data: hrList } = await supabase.from('employees').select('id').eq('status', 'active').in('role_type', ['hr', 'admin'])
      if (hrList?.length) {
        await supabase.from('notifications').insert(hrList.map(hr => ({
          employee_id: hr.id, type: 'review_awaiting_finalization',
          title: '🏁 Year-End Review Awaiting Finalization',
          message: 'A manager submitted a year-end review with a verdict. Your finalization is required.',
          metadata: { review_id: id }, is_read: false,
        })))
      }
    }
  } catch (e) { console.warn('Review notification failed:', e.message) }

  return id
}

// ── Employee: my reviews (safe RPC) ───────────────────────────────────────────
export async function getMyReviews(cycleId) {
  const { data, error } = await supabase.rpc('get_my_performance_reviews', { p_cycle_id: cycleId })
  if (error) throw error
  return data || []
}

// ── HR: overview + finalize ───────────────────────────────────────────────────
export async function getPerformanceOverview(cycleId) {
  const { data: employees } = await supabase
    .from('employees').select('id, full_name, avatar_initials, department')
    .eq('status', 'active').order('full_name')

  const { data: subs } = await supabase
    .from('goal_submissions').select('employee_id, status').eq('cycle_id', cycleId)
  const { data: reviews } = await supabase
    .from('performance_reviews')
    .select('id, employee_id, review_type, status, verdict, overall_comment, hr_notes, ratings:performance_review_ratings(objective_id, score, comment)')
    .eq('cycle_id', cycleId)

  return (employees || []).map(e => ({
    employee: e,
    submission: (subs || []).find(s => s.employee_id === e.id) || null,
    h1:      (reviews || []).find(r => r.employee_id === e.id && r.review_type === 'h1') || null,
    yearEnd: (reviews || []).find(r => r.employee_id === e.id && r.review_type === 'year_end') || null,
  }))
}

export async function finalizeReview(reviewId, hrNotes, hrAdminId) {
  const { data: review, error: fErr } = await supabase
    .from('performance_reviews').select('review_type, status, employee_id').eq('id', reviewId).single()
  if (fErr) throw fErr
  if (review.review_type !== 'year_end') throw new Error('Only year-end reviews are finalized.')
  if (review.status !== 'manager_done') throw new Error('This review is not awaiting finalization.')

  const { error } = await supabase
    .from('performance_reviews')
    .update({ status: 'hr_finalized', hr_notes: hrNotes?.trim() || null, hr_finalized_by: hrAdminId, hr_finalized_at: new Date().toISOString() })
    .eq('id', reviewId)
  if (error) throw error

  try {
    await createNotification({
      employeeId: review.employee_id, type: 'review_finalized',
      title: '🏁 Year-End Review Finalized',
      message: 'Your year-end review is complete. View your outcome in Performance.',
      metadata: { review_id: reviewId },
    })
  } catch (e) { console.warn('Finalize notification failed:', e.message) }
}
