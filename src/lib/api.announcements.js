import { supabase } from './supabase'

// ── Get all announcements ─────────────────────────────────────────────────────
export async function getAnnouncements() {
  const { data, error } = await supabase
    .from('announcements')
    .select(`
      *,
      posted_by:posted_by(id, full_name, avatar_initials, role, profile_photo_url),
      reactions:announcement_reactions(id, emoji, employee_id),
      comments:announcement_comments(
        id, body, created_at,
        employee:employee_id(id, full_name, avatar_initials, profile_photo_url)
      )
    `)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ── Create announcement ───────────────────────────────────────────────────────
export async function createAnnouncement({ title, body, category = 'general', pinned = false, postedBy }) {
  const { data, error } = await supabase
    .from('announcements')
    .insert({ title, body, category, pinned, posted_by: postedBy })
    .select(`*, posted_by:posted_by(id, full_name, avatar_initials, role)`)
    .single()
  if (error) throw error

  // Notify all active employees
  try {
    const { data: emps } = await supabase
      .from('employees')
      .select('id')
      .eq('status', 'active')
      .neq('id', postedBy)

    if (emps?.length) {
      await supabase.from('notifications').insert(
        emps.map(e => ({
          employee_id: e.id,
          type: 'announcement',
          title: `📢 ${title}`,
          message: body.length > 100 ? body.substring(0, 100) + '...' : body,
        }))
      )
    }
  } catch (e) { console.warn('Notification send failed:', e.message) }

  return data
}

// ── Update announcement ───────────────────────────────────────────────────────
export async function updateAnnouncement(id, updates) {
  const { data, error } = await supabase
    .from('announcements')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// ── Delete announcement ───────────────────────────────────────────────────────
export async function deleteAnnouncement(id) {
  const { error } = await supabase.from('announcements').delete().eq('id', id)
  if (error) throw error
}

// ── Toggle reaction ───────────────────────────────────────────────────────────
export async function toggleReaction(announcementId, employeeId, emoji) {
  // Check if reaction exists
  const { data: existing } = await supabase
    .from('announcement_reactions')
    .select('id')
    .eq('announcement_id', announcementId)
    .eq('employee_id', employeeId)
    .eq('emoji', emoji)
    .maybeSingle()

  if (existing) {
    // Remove reaction
    await supabase.from('announcement_reactions').delete().eq('id', existing.id)
    return false // removed
  } else {
    // Add reaction
    await supabase.from('announcement_reactions').insert({
      announcement_id: announcementId,
      employee_id: employeeId,
      emoji,
    })
    return true // added
  }
}

// ── Add comment ───────────────────────────────────────────────────────────────
export async function addComment(announcementId, employeeId, body) {
  const { data, error } = await supabase
    .from('announcement_comments')
    .insert({ announcement_id: announcementId, employee_id: employeeId, body })
    .select(`*, employee:employee_id(id, full_name, avatar_initials, profile_photo_url)`)
    .single()
  if (error) throw error
  return data
}

// ── Delete comment ────────────────────────────────────────────────────────────
export async function deleteComment(id) {
  const { error } = await supabase.from('announcement_comments').delete().eq('id', id)
  if (error) throw error
}

export const ANNOUNCEMENT_CATEGORIES = [
  { value: 'general', label: '📢 General',  color: '#126dad' },
  { value: 'hr',      label: '👥 HR',       color: '#9b75f1' },
  { value: 'event',   label: '🎉 Event',    color: '#00b894' },
  { value: 'urgent',  label: '🚨 Urgent',   color: '#ef4444' },
]
