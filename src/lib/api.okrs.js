import { supabase } from './supabase'

// ── Cycles ────────────────────────────────────────────────────────────────────
export async function getOKRCycles() {
  const { data, error } = await supabase
    .from('okr_cycles')
    .select('*')
    .order('year', { ascending: false })
    .order('quarter', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createOKRCycle({ name, quarter, year, startDate, endDate }) {
  const { data, error } = await supabase
    .from('okr_cycles')
    .insert({ name, quarter, year, start_date: startDate, end_date: endDate, status: 'upcoming' })
    .select().single()
  if (error) throw error
  return data
}

export async function updateOKRCycleStatus(id, status) {
  const { data, error } = await supabase
    .from('okr_cycles').update({ status }).eq('id', id).select().single()
  if (error) throw error
  return data
}

// ── Objectives ────────────────────────────────────────────────────────────────
export async function getObjectives(cycleId, employeeId) {
  let query = supabase
    .from('objectives')
    .select(`
      *,
      employee:employee_id(id, full_name, avatar_initials, role, profile_photo_url),
      key_results(*)
    `)
    .eq('cycle_id', cycleId)
    .order('created_at', { ascending: true })

  if (employeeId) query = query.eq('employee_id', employeeId)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function getAllObjectivesForCycle(cycleId) {
  const { data, error } = await supabase
    .from('objectives')
    .select(`
      *,
      employee:employee_id(id, full_name, avatar_initials, role, department, profile_photo_url),
      key_results(*)
    `)
    .eq('cycle_id', cycleId)
    .order('employee_id')
  if (error) throw error
  return data || []
}

export async function createObjective({ cycleId, employeeId, title, description, createdBy }) {
  const { data, error } = await supabase
    .from('objectives')
    .insert({ cycle_id: cycleId, employee_id: employeeId, title, description, created_by: createdBy })
    .select(`*, key_results(*)`).single()
  if (error) throw error
  return data
}

export async function updateObjective(id, updates) {
  const { data, error } = await supabase
    .from('objectives')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).select(`*, key_results(*)`).single()
  if (error) throw error
  return data
}

export async function deleteObjective(id) {
  const { error } = await supabase.from('objectives').delete().eq('id', id)
  if (error) throw error
}

// ── Key Results ───────────────────────────────────────────────────────────────
export async function createKeyResult({ objectiveId, title, description, metricType, targetValue, unit, dueDate }) {
  const { data, error } = await supabase
    .from('key_results')
    .insert({ objective_id: objectiveId, title, description, metric_type: metricType || 'percentage', target_value: targetValue || 100, current_value: 0, unit, due_date: dueDate })
    .select().single()
  if (error) throw error
  return data
}

export async function updateKeyResult(id, updates) {
  // Recalculate progress from current/target values
  let progress = updates.progress
  if (updates.current_value !== undefined && updates.target_value !== undefined) {
    progress = updates.target_value > 0
      ? Math.min(100, Math.round((updates.current_value / updates.target_value) * 100))
      : 0
  }
  const { data, error } = await supabase
    .from('key_results')
    .update({ ...updates, progress, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) throw error

  // Recalculate parent objective progress
  await recalcObjectiveProgress(data.objective_id)
  return data
}

export async function deleteKeyResult(id) {
  const { data: kr } = await supabase.from('key_results').select('objective_id').eq('id', id).single()
  const { error } = await supabase.from('key_results').delete().eq('id', id)
  if (error) throw error
  if (kr?.objective_id) await recalcObjectiveProgress(kr.objective_id)
}

// Auto-calculate objective progress from key results average
async function recalcObjectiveProgress(objectiveId) {
  const { data: krs } = await supabase
    .from('key_results').select('progress').eq('objective_id', objectiveId)
  if (!krs?.length) return
  const avg = Math.round(krs.reduce((s, k) => s + (k.progress || 0), 0) / krs.length)
  const status = avg >= 100 ? 'completed' : avg >= 70 ? 'on_track' : avg >= 40 ? 'at_risk' : 'behind'
  await supabase.from('objectives').update({ progress: avg, status, updated_at: new Date().toISOString() }).eq('id', objectiveId)
}

// ── Check-ins ─────────────────────────────────────────────────────────────────
export async function addCheckin({ objectiveId, employeeId, note, progress }) {
  const { data, error } = await supabase
    .from('okr_checkins')
    .insert({ objective_id: objectiveId, employee_id: employeeId, note, progress })
    .select().single()
  if (error) throw error
  // Update objective progress
  await supabase.from('objectives')
    .update({ progress, updated_at: new Date().toISOString() })
    .eq('id', objectiveId)
  return data
}

export async function getCheckins(objectiveId) {
  const { data, error } = await supabase
    .from('okr_checkins')
    .select(`*, employee:employee_id(full_name, avatar_initials)`)
    .eq('objective_id', objectiveId)
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw error
  return data || []
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function getStatusColor(status) {
  return { on_track: '#00b894', at_risk: '#f59e0b', behind: '#ef4444', completed: '#126dad' }[status] || '#6b7280'
}

export function getStatusLabel(status) {
  return { on_track: 'On Track', at_risk: 'At Risk', behind: 'Behind', completed: 'Completed' }[status] || status
}

export const QUARTERS = [
  { value: 1, label: 'Q1 (Jan–Mar)' },
  { value: 2, label: 'Q2 (Apr–Jun)' },
  { value: 3, label: 'Q3 (Jul–Sep)' },
  { value: 4, label: 'Q4 (Oct–Dec)' },
]
