import { useEffect, useState } from 'react'
import AppShell from '../../components/layout/AppShell'
import { Card, Avatar, Spinner, EmptyState } from '../../components/ui'
import { C, FONTS } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

async function getAllEmployeesWithManagers() {
  const { data, error } = await supabase
    .from('employees')
    .select(`
      id, full_name, role, role_type, employee_type, department,
      email, phone, employee_code, avatar_initials, profile_photo_url,
      join_date, status,
      manager:manager_id(id, full_name, avatar_initials, role, profile_photo_url)
    `)
    .eq('status', 'active')
    .order('employee_code', { ascending: true })
  if (error) throw error
  return data || []
}

function EmployeeCard({ emp, currentEmployeeId }) {
  const isMe = emp.id === currentEmployeeId
  const joinYear = emp.join_date ? new Date(emp.join_date).getFullYear() : null

  return (
    <div style={{
      background: C.surface, borderRadius: 16,
      border: `1.5px solid ${isMe ? C.brand : C.border}`,
      boxShadow: isMe ? `0 0 0 3px ${C.brand}15, ${C.shadow}` : C.shadow,
      overflow: 'hidden', transition: 'all 0.2s',
      position: 'relative',
    }}
      onMouseEnter={e => { if (!isMe) e.currentTarget.style.boxShadow = C.shadowMd; e.currentTarget.style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = isMe ? `0 0 0 3px ${C.brand}15, ${C.shadow}` : C.shadow; e.currentTarget.style.transform = 'translateY(0)' }}
    >
      {/* Top gradient band */}
      <div style={{ height: 6, background: C.gradientH }} />

      {isMe && (
        <div style={{ position: 'absolute', top: 14, right: 12, fontSize: 10, fontWeight: 700, color: C.brand, background: C.brandLight, padding: '2px 8px', borderRadius: 10, border: `1px solid ${C.brand}30` }}>
          YOU
        </div>
      )}

      <div style={{ padding: '20px' }}>
        {/* Avatar + name */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 16 }}>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Avatar initials={emp.avatar_initials || '??'} size={64} src={emp.profile_photo_url} />
            <div style={{
              position: 'absolute', bottom: 0, right: 0,
              width: 16, height: 16, borderRadius: '50%',
              background: '#00b894', border: '2px solid #fff',
            }} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text, fontFamily: FONTS.display, marginBottom: 2 }}>
            {emp.full_name}
          </div>
          <div style={{ fontSize: 12, color: C.brand, fontWeight: 600, marginBottom: 4 }}>{emp.role}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{emp.department}</div>
        </div>

        {/* Info rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
          {/* Employee ID */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14 }}>🪪</span>
            <span style={{ fontSize: 12, fontFamily: FONTS.mono, color: C.brand, fontWeight: 600 }}>{emp.employee_code}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: C.textLight, background: C.bg, padding: '2px 8px', borderRadius: 8 }}>
              {emp.employee_type}
            </span>
          </div>

          {/* Email */}
          {emp.email && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>✉️</span>
              <a href={`mailto:${emp.email}`} style={{ fontSize: 11, color: C.textMid, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                onMouseEnter={e => e.target.style.color = C.brand}
                onMouseLeave={e => e.target.style.color = C.textMid}>
                {emp.email}
              </a>
            </div>
          )}

          {/* Phone */}
          {emp.phone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14 }}>📱</span>
              <a href={`tel:${emp.phone}`} style={{ fontSize: 12, color: C.textMid, textDecoration: 'none' }}
                onMouseEnter={e => e.target.style.color = C.brand}
                onMouseLeave={e => e.target.style.color = C.textMid}>
                {emp.phone}
              </a>
            </div>
          )}

          {/* Reporting manager */}
          {emp.manager && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.bg, borderRadius: 8, padding: '8px 10px', marginTop: 4 }}>
              <span style={{ fontSize: 12, flexShrink: 0 }}>👤</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: C.textLight, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>Reports to</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.manager.full_name}</div>
                <div style={{ fontSize: 10, color: C.textLight }}>{emp.manager.role}</div>
              </div>
              <Avatar initials={emp.manager.avatar_initials || '??'} size={28} src={emp.manager.profile_photo_url} />
            </div>
          )}

          {/* Join year */}
          {joinYear && (
            <div style={{ fontSize: 10, color: C.textLight, textAlign: 'center', marginTop: 4 }}>
              Joined {joinYear} · {new Date().getFullYear() - joinYear > 0 ? `${new Date().getFullYear() - joinYear}yr` : 'New'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function TeamDirectoryPage() {
  const { employee } = useAuth()
  const [employees, setEmployees] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [dept,      setDept]      = useState('All')

  useEffect(() => {
    getAllEmployeesWithManagers()
      .then(setEmployees)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const departments = ['All', ...new Set(employees.map(e => e.department).filter(Boolean).sort())]

  const filtered = employees.filter(e => {
    const matchSearch = !search ||
      e.full_name.toLowerCase().includes(search.toLowerCase()) ||
      e.role?.toLowerCase().includes(search.toLowerCase()) ||
      e.email?.toLowerCase().includes(search.toLowerCase()) ||
      e.employee_code?.toLowerCase().includes(search.toLowerCase())
    const matchDept = dept === 'All' || e.department === dept
    return matchSearch && matchDept
  })

  return (
    <AppShell title="Team Directory" subtitle={`${employees.length} team members`}>
      {/* Search + filter */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 16 }}>🔍</span>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, role, email or ID…"
            style={{ width: '100%', padding: '10px 14px 10px 38px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none', background: C.surface }}
            onFocus={e => e.target.style.borderColor = C.teal}
            onBlur={e => e.target.style.borderColor = C.border}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {departments.map(d => (
            <button key={d} onClick={() => setDept(d)} style={{
              padding: '8px 16px', borderRadius: 20, border: `1.5px solid ${dept === d ? C.brand : C.border}`,
              background: dept === d ? C.brandLight : C.surface,
              color: dept === d ? C.brand : C.textLight,
              fontSize: 12, fontWeight: dept === d ? 700 : 400,
              cursor: 'pointer', fontFamily: FONTS.body, transition: 'all 0.15s',
            }}>
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Total', val: employees.length, color: C.brand },
          { label: 'Showing', val: filtered.length, color: C.teal },
          { label: 'Departments', val: departments.length - 1, color: C.purple },
        ].map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textMid }}>
            <span style={{ fontWeight: 800, color: s.color, fontSize: 18, fontFamily: FONTS.display }}>{s.val}</span>
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={32} /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon="👥" title="No employees found" subtitle="Try a different search or filter." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {filtered.map(emp => (
            <EmployeeCard key={emp.id} emp={emp} currentEmployeeId={employee?.id} />
          ))}
        </div>
      )}
    </AppShell>
  )
}
