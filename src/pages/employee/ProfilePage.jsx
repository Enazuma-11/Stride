import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { TwoFactorSetup } from '../../components/TwoFactorAuth'
import AppShell from '../../components/layout/AppShell'
import { Spinner } from '../../components/ui'
import { C } from '../../lib/constants'
import { useResponsive } from '../../lib/responsive'
import { useAuth } from '../../context/AuthContext'
import {
  getFullProfile, updateEmployeeBasic, submitChangeRequest,
  hrUpdateEmployee,
  addEducation, deleteEducation,
  saveEmergencyContact, deleteEmergencyContact,
  saveDependent, deleteDependent,
  addSkill, deleteSkill,
  addCertification, deleteCertification,
  addLanguage, deleteLanguage,
  uploadDocument, deleteDocument,
  uploadProfilePhoto,
} from '../../lib/api.profile'

const SECTION_TABS = [
  { id: 'personal',   label: '👤 Personal',    free: true  },
  { id: 'security',   label: '🔐 Security',     free: true  },
  { id: 'work',       label: '💼 Work',         free: false },
  { id: 'contact',    label: '📞 Contact',      free: true  },
  { id: 'payroll',    label: '💰 Payroll',      free: false },
  { id: 'compliance', label: '📋 Compliance',   free: false },
  { id: 'emergency',  label: '🚨 Emergency',    free: true  },
  { id: 'skills',     label: '⭐ Skills',       free: true  },
  { id: 'exit',       label: '🚪 Exit',         free: false },
]

import { PersonalSection, WorkSection, ContactSection, PayrollSection, ComplianceSection, EmergencySection, SkillsSection, ExitSection, ProfileHeader, ProbationStatusCard } from './profile/sections'

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const r = useResponsive()
  const { employee: me, isHR, refetchEmployee } = useAuth()
  const [searchParams] = useSearchParams()
  const [profile,  setProfile]  = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [tab,      setTab]      = useState(searchParams.get('tab') || 'personal')

  const load = useCallback(async () => {
    if (!me) return
    setLoading(true)
    try {
      const data = await getFullProfile(me.id)
      setProfile(data)
    } finally { setLoading(false) }
  }, [me])

  useEffect(() => { load() }, [load])

  // ── update handlers ────────────────────────────────────────────────────────
  // Sanitize empty strings to null for date fields before saving
  function sanitize(data) {
    const dateFields = ['date_of_birth','join_date','probation_end_date','internship_end_date','passport_issue_date','passport_expiry_date','visa_expiry_date','last_working_day','nda_signed_date','contract_signed_date']
    const result = { ...data }
    dateFields.forEach(f => { if (result[f] === '') result[f] = null })
    return result
  }

  async function handleUpdate(section, data) {
    const cleanData = sanitize(data)
    if (section === 'basic' || section === 'contact') {
      await updateEmployeeBasic(me.id, cleanData)
      await refetchEmployee()
      await load()
    } else if (section === 'addEdu') {
      await addEducation(me.id, cleanData)
      await load()
    } else if (section === 'deleteEdu') {
      await deleteEducation(data)
      await load()
    } else if (['work','payroll','compliance','exit'].includes(section)) {
      if (isHR) {
        await hrUpdateEmployee(me.id, section, cleanData)
      } else {
        await submitChangeRequest(me.id, section, cleanData)
      }
      await load()
    }
  }

  async function handlePhotoUpload(file) {
    await uploadProfilePhoto(me.id, file)
    await refetchEmployee()
    await load()
  }

  async function handleDocUpload(file, docType) {
    await uploadDocument(me.id, file, docType, me.id)
    await load()
  }

  async function handleDocDelete(id, url) {
    await deleteDocument(id, url)
    await load()
  }

  if (loading || !profile) return (
    <AppShell title="My Profile">
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><Spinner size={36} /></div>
    </AppShell>
  )

  const { employee, payroll, compliance, education, documents, emergency, dependents, skills, certifications, languages, exit } = profile

  return (
    <AppShell title="My Profile" subtitle="Manage your personal and professional information">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap'); @keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <ProbationStatusCard employeeId={employee.id} />

      <ProfileHeader employee={employee} isHR={isHR} onPhotoUpload={handlePhotoUpload} />

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: C.surface, padding: 6, borderRadius: 10, boxShadow: C.shadow, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {SECTION_TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '7px 14px', borderRadius: 7, border: 'none',
            background: tab === t.id ? C.brand : 'transparent',
            color: tab === t.id ? '#fff' : C.textMid,
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
            fontFamily: "'Sora',sans-serif",
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            {t.label}
            {!t.free && <span style={{ fontSize: 9, opacity: 0.6 }}>🔒</span>}
          </button>
        ))}
      </div>

      {tab === 'personal'   && <PersonalSection   employee={employee}             isHR={isHR} onUpdate={handleUpdate} />}
      {tab === 'work'       && <WorkSection        employee={employee}             isHR={isHR} onUpdate={handleUpdate} />}
      {tab === 'contact'    && <ContactSection     employee={employee}             isHR={isHR} onUpdate={handleUpdate} />}
      {tab === 'payroll'    && <PayrollSection     payroll={payroll}   employeeId={me.id} isHR={isHR} onUpdate={handleUpdate} />}
      {tab === 'compliance' && <ComplianceSection  compliance={compliance} education={education} documents={documents} isHR={isHR} employeeId={me.id} onUpdate={handleUpdate} onDocUpload={handleDocUpload} onDocDelete={handleDocDelete} />}
      {tab === 'emergency'  && <EmergencySection   emergency={emergency} dependents={dependents} isHR={isHR} employeeId={me.id}
        onSaveContact={async d => { await saveEmergencyContact(me.id, d); await load() }}
        onDeleteContact={async id => { await deleteEmergencyContact(id); await load() }}
        onSaveDependent={async d => { await saveDependent(me.id, d); await load() }}
        onDeleteDependent={async id => { await deleteDependent(id); await load() }}
      />}
      {tab === 'skills'     && <SkillsSection      skills={skills} certifications={certifications} languages={languages} employeeId={me.id}
        onAddSkill={async d => { await addSkill(me.id, d); await load() }}
        onDeleteSkill={async id => { await deleteSkill(id); await load() }}
        onAddCert={async d => { await addCertification(me.id, d); await load() }}
        onDeleteCert={async id => { await deleteCertification(id); await load() }}
        onAddLang={async d => { await addLanguage(me.id, d); await load() }}
        onDeleteLang={async id => { await deleteLanguage(id); await load() }}
      />}
      {tab === 'exit'       && <ExitSection        exit={exit} isHR={isHR} employeeId={me.id} onUpdate={handleUpdate} />}
      {tab === 'security'   && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: "'Plus Jakarta Sans',sans-serif" }}>Security Settings</div>
          <TwoFactorSetup />
        </div>
      )}
    </AppShell>
  )
}
