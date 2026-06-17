import { useEffect, useState } from 'react'
import AppShell from '../../components/layout/AppShell'
import { Card, Avatar, Button, Spinner, EmptyState, Alert, Input, ProgressBar } from '../../components/ui'
import { C, FONTS } from '../../lib/constants'
import { useAuth } from '../../context/AuthContext'
import {
  getOKRCycles, getObjectives, createObjective, updateObjective, deleteObjective,
  createKeyResult, updateKeyResult, deleteKeyResult, addCheckin, getCheckins,
  getStatusColor, getStatusLabel, QUARTERS,
} from '../../lib/api.okrs'

const METRIC_TYPES = [
  { value: 'percentage', label: '% Percentage', unit: '%' },
  { value: 'number',     label: '# Number',     unit: ''  },
  { value: 'currency',   label: '₹ Currency',   unit: '₹' },
  { value: 'boolean',    label: '✓ Done/Not Done', unit: '' },
]

// ── Progress ring ─────────────────────────────────────────────────────────────
function ProgressRing({ progress, size = 60, color = C.brand }) {
  const r = (size - 8) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (progress / 100) * circ
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={6} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        style={{ transform: 'rotate(90deg)', transformOrigin: `${size/2}px ${size/2}px`, fontSize: 12, fontWeight: 800, fill: color, fontFamily: FONTS.display }}>
        {progress}%
      </text>
    </svg>
  )
}

// ── Key Result item ───────────────────────────────────────────────────────────
function KeyResultItem({ kr, onUpdate, onDelete, canEdit }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(String(kr.current_value || 0))
  const [saving, setSaving] = useState(false)
  const color = getStatusColor(kr.status)
  const pct = kr.metric_type === 'boolean'
    ? (kr.current_value >= kr.target_value ? 100 : 0)
    : kr.progress || 0

  async function handleUpdate() {
    setSaving(true)
    try {
      await onUpdate(kr.id, {
        current_value: parseFloat(val) || 0,
        target_value:  kr.target_value,
        metric_type:   kr.metric_type,
      })
      setEditing(false)
    } finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', gap: 12, padding: '12px 16px', borderBottom: `1px solid ${C.border}`, alignItems: 'flex-start' }}>
      <div style={{ paddingTop: 2 }}>
        <ProgressRing progress={pct} size={44} color={color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 3 }}>{kr.title}</div>
        {kr.description && <div style={{ fontSize: 11, color: C.textLight, marginBottom: 6 }}>{kr.description}</div>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {editing && canEdit ? (
            <>
              <input
                value={val} onChange={e => setVal(e.target.value)} type="number"
                style={{ width: 90, padding: '5px 8px', borderRadius: 8, border: `1.5px solid ${C.teal}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none' }}
              />
              <span style={{ fontSize: 12, color: C.textLight }}>/ {kr.target_value} {kr.unit}</span>
              <button onClick={handleUpdate} disabled={saving} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: C.brand, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONTS.display }}>
                {saving ? '…' : 'Update'}
              </button>
              <button onClick={() => setEditing(false)} style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'none', fontSize: 12, cursor: 'pointer', color: C.textLight }}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <span style={{ fontSize: 13, fontWeight: 700, color }}>
                {kr.metric_type === 'boolean' ? (kr.current_value ? 'Done ✓' : 'Not done') : `${kr.current_value} / ${kr.target_value} ${kr.unit || ''}`}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, color, background: `${color}15`, padding: '2px 8px', borderRadius: 10 }}>
                {getStatusLabel(kr.status)}
              </span>
              {kr.due_date && (
                <span style={{ fontSize: 10, color: C.textLight }}>Due {new Date(kr.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
              )}
              {canEdit && (
                <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', fontSize: 11, color: C.brand, cursor: 'pointer', fontWeight: 600 }}>Update</button>
              )}
              {canEdit && (
                <button onClick={() => onDelete(kr.id)} style={{ background: 'none', border: 'none', fontSize: 11, color: '#ef444470', cursor: 'pointer' }}>Remove</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Objective card ────────────────────────────────────────────────────────────
function ObjectiveCard({ obj, currentEmployeeId, isHR, onUpdate, onDelete }) {
  const [expanded,     setExpanded]     = useState(false)
  const [addingKR,     setAddingKR]     = useState(false)
  const [addingCheckin,setAddingCheckin]= useState(false)
  const [checkins,     setCheckins]     = useState([])
  const [krForm, setKrForm] = useState({ title: '', metricType: 'percentage', targetValue: '100', unit: '', dueDate: '' })
  const [checkinNote, setCheckinNote] = useState('')
  const [checkinProg, setCheckinProg] = useState(String(obj.progress || 0))
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const canEdit = obj.employee_id === currentEmployeeId || isHR
  const color   = getStatusColor(obj.status)
  const krs     = obj.key_results || []

  async function loadCheckins() {
    const data = await getCheckins(obj.id)
    setCheckins(data)
  }

  async function handleAddKR() {
    if (!krForm.title.trim()) { setError('Key result title is required.'); return }
    setSaving(true); setError('')
    try {
      await createKeyResult({ objectiveId: obj.id, title: krForm.title, metricType: krForm.metricType, targetValue: parseFloat(krForm.targetValue) || 100, unit: krForm.unit, dueDate: krForm.dueDate || null })
      setKrForm({ title: '', metricType: 'percentage', targetValue: '100', unit: '', dueDate: '' })
      setAddingKR(false)
      onUpdate()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function handleAddCheckin() {
    if (!checkinNote.trim()) { setError('Please add a note.'); return }
    setSaving(true); setError('')
    try {
      await addCheckin({ objectiveId: obj.id, employeeId: currentEmployeeId, note: checkinNote, progress: parseInt(checkinProg) || obj.progress })
      setCheckinNote(''); setAddingCheckin(false)
      onUpdate()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: C.shadow, marginBottom: 12 }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', gap: 14, alignItems: 'flex-start' }} onClick={() => { setExpanded(!expanded); if (!expanded) loadCheckins() }}>
        <ProgressRing progress={obj.progress || 0} size={56} color={color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: FONTS.display, flex: 1 }}>{obj.title}</div>
            <span style={{ fontSize: 10, fontWeight: 700, color, background: `${color}15`, padding: '3px 10px', borderRadius: 10, flexShrink: 0 }}>
              {getStatusLabel(obj.status)}
            </span>
          </div>
          {obj.description && <div style={{ fontSize: 12, color: C.textLight, marginBottom: 8 }}>{obj.description}</div>}
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: C.textLight, flexWrap: 'wrap' }}>
            <span>📊 {krs.length} key result{krs.length !== 1 ? 's' : ''}</span>
            {obj.employee && <span>👤 {obj.employee.full_name}</span>}
            <span style={{ marginLeft: 'auto', color: C.brand }}>
              {expanded ? '▲ Collapse' : '▼ Expand'}
            </span>
          </div>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
            <button onClick={() => onDelete(obj.id)} style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', color: '#ef444470' }}>🗑</button>
          </div>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${C.border}` }}>
          {/* Key results */}
          {krs.length > 0 && (
            <div>
              <div style={{ padding: '10px 20px 0', fontSize: 10, fontWeight: 700, color: C.textLight, letterSpacing: 1, textTransform: 'uppercase' }}>Key Results</div>
              {krs.map(kr => (
                <KeyResultItem key={kr.id} kr={kr} canEdit={canEdit}
                  onUpdate={async (id, updates) => { await updateKeyResult(id, updates); onUpdate() }}
                  onDelete={async (id) => { await deleteKeyResult(id); onUpdate() }}
                />
              ))}
            </div>
          )}

          {/* Add KR form */}
          {canEdit && (
            <div style={{ padding: '12px 20px', borderTop: krs.length > 0 ? `1px solid ${C.border}` : 'none' }}>
              {addingKR ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: C.bg, borderRadius: 10, padding: '14px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Add Key Result</div>
                  <Input label="Title" value={krForm.title} onChange={v => setKrForm(f => ({ ...f, title: v }))} placeholder="e.g. Increase user signups to 500" required />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 6 }}>Metric Type</label>
                      <select value={krForm.metricType} onChange={e => setKrForm(f => ({ ...f, metricType: e.target.value }))}
                        style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, outline: 'none', background: C.surface }}>
                        {METRIC_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </div>
                    <Input label="Target Value" value={krForm.targetValue} onChange={v => setKrForm(f => ({ ...f, targetValue: v }))} placeholder="100" type="number" />
                    <Input label="Unit (optional)" value={krForm.unit} onChange={v => setKrForm(f => ({ ...f, unit: v }))} placeholder="e.g. users, %" />
                  </div>
                  <Input label="Due Date (optional)" value={krForm.dueDate} onChange={v => setKrForm(f => ({ ...f, dueDate: v }))} type="date" />
                  {error && <Alert type="error" message={error} />}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button size="sm" onClick={handleAddKR} disabled={saving}>{saving ? '…' : 'Add Key Result'}</Button>
                    <Button size="sm" variant="outline" onClick={() => { setAddingKR(false); setError('') }}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setAddingKR(true)} style={{ fontSize: 12, color: C.brand, background: 'none', border: `1px dashed ${C.brand}`, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 600 }}>
                    + Add Key Result
                  </button>
                  <button onClick={() => setAddingCheckin(true)} style={{ fontSize: 12, color: C.purple, background: 'none', border: `1px dashed ${C.purple}`, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 600 }}>
                    📝 Check-in
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Check-in form */}
          {addingCheckin && (
            <div style={{ padding: '0 20px 16px' }}>
              <div style={{ background: C.purpleSoft, borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.purple }}>📝 Progress Check-in</div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 6 }}>Progress: {checkinProg}%</label>
                  <input type="range" min={0} max={100} value={checkinProg} onChange={e => setCheckinProg(e.target.value)}
                    style={{ width: '100%', accentColor: C.purple }} />
                </div>
                <Input label="Note" value={checkinNote} onChange={setCheckinNote} placeholder="What progress did you make? Any blockers?" />
                {error && <Alert type="error" message={error} />}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button size="sm" variant="secondary" onClick={handleAddCheckin} disabled={saving}>{saving ? '…' : 'Submit Check-in'}</Button>
                  <Button size="sm" variant="outline" onClick={() => { setAddingCheckin(false); setError('') }}>Cancel</Button>
                </div>
              </div>
            </div>
          )}

          {/* Check-in history */}
          {checkins.length > 0 && (
            <div style={{ padding: '0 20px 16px', borderTop: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, letterSpacing: 1, textTransform: 'uppercase', margin: '12px 0 8px' }}>Check-in History</div>
              {checkins.map(ci => (
                <div key={ci.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.border}` }}>
                  <Avatar initials={ci.employee?.avatar_initials || '??'} size={28} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: C.text }}>{ci.employee?.full_name}</span>
                      <span style={{ fontSize: 10, color: C.purple, fontWeight: 700 }}>{ci.progress}%</span>
                      <span style={{ fontSize: 10, color: C.textLight, marginLeft: 'auto' }}>{new Date(ci.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                    </div>
                    {ci.note && <div style={{ fontSize: 12, color: C.textMid }}>{ci.note}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PerformancePage() {
  const { employee, isHR } = useAuth()
  const [cycles,     setCycles]     = useState([])
  const [activeCycle,setActiveCycle]= useState(null)
  const [objectives, setObjectives] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [showAdd,    setShowAdd]    = useState(false)
  const [newTitle,   setNewTitle]   = useState('')
  const [newDesc,    setNewDesc]    = useState('')
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')
  const [viewAll,    setViewAll]    = useState(false) // HR: view all employees

  async function loadCycles() {
    const data = await getOKRCycles()
    setCycles(data)
    const active = data.find(c => c.status === 'active') || data[0]
    setActiveCycle(active || null)
    return active
  }

  async function loadObjectives(cycle) {
    if (!cycle) return
    setLoading(true)
    try {
      const empId = (!isHR || !viewAll) ? employee?.id : undefined
      const data = await getObjectives(cycle.id, empId)
      setObjectives(data)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    loadCycles().then(loadObjectives)
  }, [])

  useEffect(() => {
    if (activeCycle) loadObjectives(activeCycle)
  }, [activeCycle, viewAll])

  async function handleAddObjective() {
    if (!newTitle.trim()) { setError('Title is required.'); return }
    if (!activeCycle)     { setError('No active cycle found.'); return }
    setSaving(true); setError('')
    try {
      await createObjective({ cycleId: activeCycle.id, employeeId: employee.id, title: newTitle, description: newDesc, createdBy: employee.id })
      setNewTitle(''); setNewDesc(''); setShowAdd(false)
      loadObjectives(activeCycle)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  // Summary stats
  const myObjectives  = objectives.filter(o => o.employee_id === employee?.id)
  const avgProgress   = myObjectives.length > 0 ? Math.round(myObjectives.reduce((s, o) => s + (o.progress || 0), 0) / myObjectives.length) : 0
  const completed     = myObjectives.filter(o => o.status === 'completed').length
  const onTrack       = myObjectives.filter(o => o.status === 'on_track').length
  const atRisk        = myObjectives.filter(o => o.status === 'at_risk' || o.status === 'behind').length

  return (
    <AppShell title="Performance & OKRs" subtitle="Objectives and Key Results">
      {/* Cycle selector */}
      {cycles.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {cycles.map(c => (
            <button key={c.id} onClick={() => setActiveCycle(c)} style={{
              padding: '7px 16px', borderRadius: 20,
              border: `1.5px solid ${activeCycle?.id === c.id ? C.brand : C.border}`,
              background: activeCycle?.id === c.id ? C.brandLight : C.surface,
              color: activeCycle?.id === c.id ? C.brand : C.textLight,
              fontSize: 12, fontWeight: activeCycle?.id === c.id ? 700 : 400,
              cursor: 'pointer',
            }}>
              {c.name}
              {c.status === 'active' && <span style={{ marginLeft: 6, fontSize: 9, color: C.green, fontWeight: 700 }}>● ACTIVE</span>}
            </button>
          ))}
        </div>
      )}

      {activeCycle && (
        <>
          {/* My progress summary */}
          {myObjectives.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Avg Progress', val: `${avgProgress}%`, color: C.brand, icon: '📊' },
                { label: 'Objectives',   val: myObjectives.length, color: C.purple, icon: '🎯' },
                { label: 'On Track',     val: onTrack,   color: C.green,  icon: '✅' },
                { label: 'At Risk',      val: atRisk,    color: C.amber,  icon: '⚠️' },
                { label: 'Completed',    val: completed, color: C.teal,   icon: '🏆' },
              ].map(s => (
                <div key={s.label} style={{ background: C.surface, borderRadius: 14, padding: '16px', border: `1px solid ${C.border}`, borderTop: `3px solid ${s.color}` }}>
                  <div style={{ fontSize: 10, color: C.textLight, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>{s.label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 20 }}>{s.icon}</span>
                    <span style={{ fontSize: 24, fontWeight: 800, color: s.color, fontFamily: FONTS.display }}>{s.val}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* HR toggle */}
          {isHR && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
              <button onClick={() => setViewAll(!viewAll)} style={{
                padding: '7px 16px', borderRadius: 20,
                border: `1.5px solid ${viewAll ? C.purple : C.border}`,
                background: viewAll ? C.purpleSoft : C.surface,
                color: viewAll ? C.purple : C.textLight,
                fontSize: 12, fontWeight: viewAll ? 700 : 400, cursor: 'pointer',
              }}>
                {viewAll ? '👥 All Employees' : '👤 My OKRs'}
              </button>
              <span style={{ fontSize: 12, color: C.textLight }}>{objectives.length} objective{objectives.length !== 1 ? 's' : ''}</span>
            </div>
          )}

          {/* Add objective */}
          <div style={{ marginBottom: 16 }}>
            {showAdd ? (
              <div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, padding: '20px', marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: FONTS.display, marginBottom: 16 }}>🎯 New Objective — {activeCycle.name}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Input label="Objective Title" value={newTitle} onChange={setNewTitle} placeholder="e.g. Launch Stride PWA to all employees" required />
                  <Input label="Description (optional)" value={newDesc} onChange={setNewDesc} placeholder="Why does this objective matter?" />
                  {error && <Alert type="error" message={error} />}
                  <div style={{ display: 'flex', gap: 10 }}>
                    <Button onClick={handleAddObjective} disabled={saving}>{saving ? 'Adding…' : '✓ Add Objective'}</Button>
                    <Button variant="outline" onClick={() => { setShowAdd(false); setError('') }}>Cancel</Button>
                  </div>
                </div>
              </div>
            ) : (
              <Button onClick={() => setShowAdd(true)}>+ Add Objective</Button>
            )}
          </div>

          {/* Objectives list */}
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={32} /></div>
          ) : objectives.length === 0 ? (
            <EmptyState icon="🎯" title="No objectives yet"
              subtitle={`Add your first objective for ${activeCycle.name}. Break it down into measurable key results.`} />
          ) : (
            objectives.map(obj => (
              <ObjectiveCard key={obj.id} obj={obj}
                currentEmployeeId={employee?.id}
                isHR={isHR}
                onUpdate={() => loadObjectives(activeCycle)}
                onDelete={async (id) => { await deleteObjective(id); loadObjectives(activeCycle) }}
              />
            ))
          )}
        </>
      )}
    </AppShell>
  )
}
