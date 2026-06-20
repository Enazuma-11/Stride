import { supabase } from './supabase'

// ─── LOAD FULL PROFILE ────────────────────────────────────────────────────────
export async function getFullProfile(employeeId) {
  const [
    { data: employee },
    { data: payroll },
    { data: compliance },
    { data: education },
    { data: documents },
    { data: emergency },
    { data: dependents },
    { data: skills },
    { data: certifications },
    { data: languages },
    { data: exit },
  ] = await Promise.all([
    supabase.from('employees').select('*').eq('id', employeeId).single(),
    supabase.from('employee_payroll').select('*').eq('employee_id', employeeId).maybeSingle(),
    supabase.from('employee_compliance').select('*').eq('employee_id', employeeId).maybeSingle(),
    supabase.from('employee_education').select('*').eq('employee_id', employeeId).order('end_year', { ascending: false }),
    supabase.from('employee_documents').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false }),
    supabase.from('employee_emergency_contacts').select('*').eq('employee_id', employeeId).order('priority'),
    supabase.from('employee_dependents').select('*').eq('employee_id', employeeId),
    supabase.from('employee_skills').select('*').eq('employee_id', employeeId),
    supabase.from('employee_certifications').select('*').eq('employee_id', employeeId),
    supabase.from('employee_languages').select('*').eq('employee_id', employeeId),
    supabase.from('employee_exit').select('*').eq('employee_id', employeeId).maybeSingle(),
  ])

  return { employee, payroll, compliance, education: education || [], documents: documents || [], emergency: emergency || [], dependents: dependents || [], skills: skills || [], certifications: certifications || [], languages: languages || [], exit }
}

// ─── SECTION 1 & 3: UPDATE EMPLOYEE DIRECTLY (no HR approval needed) ─────────
export async function updateEmployeeBasic(employeeId, data) {
  const { data: updated, error } = await supabase
    .from('employees')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', employeeId)
    .select()
    .single()
  if (error) throw error
  return updated
}

// ─── SECTION 2, 4, 5, 8: SUBMIT CHANGE REQUEST (needs HR approval) ────────────
export async function submitChangeRequest(employeeId, section, changes) {
  const requests = Object.entries(changes).map(([field_name, new_value]) => ({
    employee_id: employeeId,
    section,
    field_name,
    new_value: String(new_value),
    status: 'pending',
  }))

  const { data, error } = await supabase
    .from('profile_change_requests')
    .insert(requests)
    .select()
  if (error) throw error
  return data
}

// ─── HR: GET ALL PENDING CHANGE REQUESTS ─────────────────────────────────────
export async function getPendingChangeRequests() {
  const { data, error } = await supabase
    .from('profile_change_requests')
    .select(`*, employee:employee_id(id, full_name, role, department, avatar_initials)`)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ─── HR: APPROVE CHANGE REQUEST ───────────────────────────────────────────────
export async function approveChangeRequest(requestId, reviewerId) {
  const { data: req, error: fetchErr } = await supabase
    .from('profile_change_requests')
    .select('*')
    .eq('id', requestId)
    .single()
  if (fetchErr) throw fetchErr

  // Apply the change to the correct table
  await applyProfileChange(req)

  const { data, error } = await supabase
    .from('profile_change_requests')
    .update({ status: 'approved', reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq('id', requestId)
    .select()
    .single()
  if (error) throw error
  return data
}

// ─── HR: REJECT CHANGE REQUEST ────────────────────────────────────────────────
export async function rejectChangeRequest(requestId, reviewerId, notes) {
  const { data, error } = await supabase
    .from('profile_change_requests')
    .update({ status: 'rejected', reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), notes })
    .eq('id', requestId)
    .select()
    .single()
  if (error) throw error
  return data
}

async function applyProfileChange(req) {
  const tableMap = {
    work:       'employees',
    payroll:    'employee_payroll',
    compliance: 'employee_compliance',
    exit:       'employee_exit',
  }
  const table = tableMap[req.section] || 'employees'

  if (table === 'employees') {
    await supabase.from('employees').update({ [req.field_name]: req.new_value }).eq('id', req.employee_id)
  } else {
    await supabase.from(table).upsert({ employee_id: req.employee_id, [req.field_name]: req.new_value }, { onConflict: 'employee_id' })
  }
}

// ─── HR: DIRECT EDIT (bypasses approval) ─────────────────────────────────────
export async function hrUpdateEmployee(employeeId, section, data) {
  if (section === 'basic' || section === 'work' || section === 'contact') {
    return updateEmployeeBasic(employeeId, data)
  }
  const tableMap = {
    payroll:    'employee_payroll',
    compliance: 'employee_compliance',
    exit:       'employee_exit',
  }
  const table = tableMap[section]
  if (!table) throw new Error('Unknown section: ' + section)

  const { data: updated, error } = await supabase
    .from(table)
    .upsert({ employee_id: employeeId, ...data, updated_at: new Date().toISOString() }, { onConflict: 'employee_id' })
    .select()
    .single()
  if (error) throw error
  return updated
}

// ─── EDUCATION CRUD ───────────────────────────────────────────────────────────
export async function addEducation(employeeId, data) {
  const { data: row, error } = await supabase.from('employee_education').insert({ employee_id: employeeId, ...data }).select().single()
  if (error) throw error
  return row
}
export async function deleteEducation(id) {
  const { error } = await supabase.from('employee_education').delete().eq('id', id)
  if (error) throw error
}

// ─── EMERGENCY CONTACTS CRUD ──────────────────────────────────────────────────
export async function saveEmergencyContact(employeeId, data) {
  if (data.id) {
    const { data: row, error } = await supabase.from('employee_emergency_contacts').update(data).eq('id', data.id).select().single()
    if (error) throw error
    return row
  }
  const { data: row, error } = await supabase.from('employee_emergency_contacts').insert({ employee_id: employeeId, ...data }).select().single()
  if (error) throw error
  return row
}
export async function deleteEmergencyContact(id) {
  const { error } = await supabase.from('employee_emergency_contacts').delete().eq('id', id)
  if (error) throw error
}

// ─── DEPENDENTS CRUD ──────────────────────────────────────────────────────────
export async function saveDependent(employeeId, data) {
  if (data.id) {
    const { data: row, error } = await supabase.from('employee_dependents').update(data).eq('id', data.id).select().single()
    if (error) throw error
    return row
  }
  const { data: row, error } = await supabase.from('employee_dependents').insert({ employee_id: employeeId, ...data }).select().single()
  if (error) throw error
  return row
}
export async function deleteDependent(id) {
  const { error } = await supabase.from('employee_dependents').delete().eq('id', id)
  if (error) throw error
}

// ─── SKILLS CRUD ──────────────────────────────────────────────────────────────
export async function addSkill(employeeId, data) {
  const { data: row, error } = await supabase.from('employee_skills').insert({ employee_id: employeeId, ...data }).select().single()
  if (error) throw error
  return row
}
export async function deleteSkill(id) {
  const { error } = await supabase.from('employee_skills').delete().eq('id', id)
  if (error) throw error
}

// ─── CERTIFICATIONS CRUD ──────────────────────────────────────────────────────
export async function addCertification(employeeId, data) {
  const { data: row, error } = await supabase.from('employee_certifications').insert({ employee_id: employeeId, ...data }).select().single()
  if (error) throw error
  return row
}
export async function deleteCertification(id) {
  const { error } = await supabase.from('employee_certifications').delete().eq('id', id)
  if (error) throw error
}

// ─── LANGUAGES CRUD ───────────────────────────────────────────────────────────
export async function addLanguage(employeeId, data) {
  const { data: row, error } = await supabase.from('employee_languages').insert({ employee_id: employeeId, ...data }).select().single()
  if (error) throw error
  return row
}
export async function deleteLanguage(id) {
  const { error } = await supabase.from('employee_languages').delete().eq('id', id)
  if (error) throw error
}

// ─── DOCUMENT UPLOAD ──────────────────────────────────────────────────────────
export async function uploadDocument(employeeId, file, docType, uploadedBy) {
  const ext  = file.name.split('.').pop()
  const path = `${employeeId}/documents/${docType}-${Date.now()}.${ext}`

  const { error: upErr } = await supabase.storage
    .from('employee-documents')
    .upload(path, file, { upsert: true })
  if (upErr) throw upErr

  const { data: signed, error: signErr } = await supabase.storage
    .from('employee-documents')
    .createSignedUrl(path, 60 * 60 * 24 * 365)
  if (signErr) throw signErr

  const { data, error } = await supabase.from('employee_documents').upsert({
    employee_id:   employeeId,
    document_type: docType,
    file_url:      signed.signedUrl,
    file_name:     file.name,
    uploaded_at:   new Date().toISOString(),
  }, { onConflict: 'employee_id,document_type' }).select().single()
  if (error) throw error
  return data
}

export async function deleteDocument(id, fileUrl) {
  // Extract path from URL for storage deletion
  const path = fileUrl.split('employee-documents/')[1]
  if (path) await supabase.storage.from('employee-documents').remove([path])
  const { error } = await supabase.from('employee_documents').delete().eq('id', id)
  if (error) throw error
}

// ─── PROFILE PHOTO UPLOAD ─────────────────────────────────────────────────────
export async function uploadProfilePhoto(employeeId, file) {
  // Validate file type and size
  if (!file.type.startsWith('image/')) throw new Error('Please upload an image file (JPG, PNG, etc.)')
  if (file.size > 5 * 1024 * 1024)    throw new Error('Image must be under 5MB')

  // Always use .jpg extension to avoid path mismatch issues
  const path = `${employeeId}/profile/photo.jpg`

  // Remove old photo first to avoid conflicts
  await supabase.storage.from('employee-documents').remove([path]).catch(() => {})

  const { error: upErr } = await supabase.storage
    .from('employee-documents')
    .upload(path, file, { upsert: true, contentType: 'image/jpeg' })

  if (upErr) {
    if (upErr.message?.includes('Bucket not found') || upErr.message?.includes('bucket')) {
      throw new Error('Storage not set up yet. Please create the "employee-documents" bucket in Supabase → Storage.')
    }
    throw upErr
  }

  // Generate signed URL with 1 year expiry
  const { data: signedData, error: signErr } = await supabase.storage
    .from('employee-documents')
    .createSignedUrl(path, 60 * 60 * 24 * 365)

  if (signErr) throw signErr
  const photoUrl = signedData.signedUrl

  // Update using user_id to satisfy RLS policy
  const { data: { user } } = await supabase.auth.getUser()
  const { error: updateErr } = await supabase
    .from('employees')
    .update({ profile_photo_url: photoUrl })
    .eq('user_id', user.id)
  if (updateErr) throw updateErr

  return photoUrl
}

// Refresh a stored signed URL if it might be expiring
export async function refreshProfilePhotoUrl(employeeId, existingUrl) {
  if (!existingUrl) return null
  try {
    // Extract path from signed URL
    const urlObj = new URL(existingUrl)
    const pathMatch = urlObj.pathname.match(/\/object\/sign\/employee-documents\/(.+)/)
    if (!pathMatch) return existingUrl

    const path = decodeURIComponent(pathMatch[1])
    const { data, error } = await supabase.storage
      .from('employee-documents')
      .createSignedUrl(path, 60 * 60 * 24 * 365)

    if (error) return existingUrl
    return data.signedUrl
  } catch { return existingUrl }
}

// ─── ATTENDANCE OVERRIDE (HR only) ────────────────────────────────────────────
export async function overrideCheckTime(attendanceId, employeeId, date, field, newValue, reason, overriddenBy) {
  // Get current record for old value
  const { data: current } = await supabase.from('attendance').select('*').eq('id', attendanceId).single()
  const oldValue = current?.[field]

  // Update the attendance record
  const { data: updated, error } = await supabase
    .from('attendance')
    .update({ [field]: newValue })
    .eq('id', attendanceId)
    .select()
    .single()
  if (error) throw error

  // Recalculate hours if check_in or check_out changed
  if (field === 'check_in' || field === 'check_out') {
    const checkIn  = field === 'check_in'  ? newValue : current?.check_in
    const checkOut = field === 'check_out' ? newValue : current?.check_out
    if (checkIn && checkOut) {
      const hours = Math.round(((new Date(checkOut) - new Date(checkIn)) / 3600000) * 10) / 10
      await supabase.from('attendance').update({ hours_worked: hours }).eq('id', attendanceId)
    }
  }

  // Log the override
  await supabase.from('attendance_overrides').insert({
    attendance_id: attendanceId,
    employee_id:   employeeId,
    date,
    field_changed: field,
    old_value:     oldValue ? String(oldValue) : null,
    new_value:     String(newValue),
    reason,
    overridden_by: overriddenBy,
  })

  return updated
}

export async function getAttendanceOverrides(employeeId) {
  const { data, error } = await supabase
    .from('attendance_overrides')
    .select(`*, overrider:overridden_by(full_name)`)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return data || []
}
