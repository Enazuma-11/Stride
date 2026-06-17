import { supabase } from './supabase'

export async function getPolicyCategories() {
  const { data, error } = await supabase
    .from('policy_categories')
    .select('*')
    .order('sort_order')
  if (error) throw error
  return data || []
}

export async function getPolicies(categoryId) {
  let query = supabase
    .from('policies')
    .select(`*, category:category_id(*), publisher:published_by(full_name, avatar_initials)`)
    .order('published_at', { ascending: false })

  // Non-HR only sees published
  if (categoryId) query = query.eq('category_id', categoryId)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function createPolicy({ title, description, categoryId, version = '1.0', requiresAck = false }) {
  const { data, error } = await supabase
    .from('policies')
    .insert({ title, description, category_id: categoryId, version, requires_ack: requiresAck, is_published: false })
    .select(`*, category:category_id(*)`)
    .single()
  if (error) throw error
  return data
}

export async function uploadPolicyFile(policyId, file) {
  const ext  = file.name.split('.').pop()
  const path = `policies/${policyId}/document.${ext}`

  const { error: upErr } = await supabase.storage
    .from('employee-documents')
    .upload(path, file, { upsert: true })
  if (upErr) throw upErr

  const { data: signed } = await supabase.storage
    .from('employee-documents')
    .createSignedUrl(path, 60 * 60 * 24 * 365)

  const { error } = await supabase
    .from('policies')
    .update({ file_url: signed.signedUrl, file_name: file.name, file_size: file.size })
    .eq('id', policyId)
  if (error) throw error
  return signed.signedUrl
}

export async function publishPolicy(policyId, publishedBy) {
  const { data, error } = await supabase
    .from('policies')
    .update({ is_published: true, published_by: publishedBy, published_at: new Date().toISOString() })
    .eq('id', policyId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function unpublishPolicy(policyId) {
  const { data, error } = await supabase
    .from('policies')
    .update({ is_published: false })
    .eq('id', policyId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deletePolicy(policyId) {
  const { error } = await supabase.from('policies').delete().eq('id', policyId)
  if (error) throw error
}

export async function acknowledgePolicy(policyId, employeeId) {
  const { error } = await supabase
    .from('policy_acknowledgements')
    .upsert({ policy_id: policyId, employee_id: employeeId }, { onConflict: 'policy_id,employee_id' })
  if (error) throw error
}

export async function getMyAcknowledgements(employeeId) {
  const { data, error } = await supabase
    .from('policy_acknowledgements')
    .select('policy_id')
    .eq('employee_id', employeeId)
  if (error) throw error
  return (data || []).map(a => a.policy_id)
}
