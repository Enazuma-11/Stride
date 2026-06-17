import { useEffect, useState, useRef } from 'react'
import AppShell from '../../components/layout/AppShell'
import { Card, Avatar, Button, Spinner, EmptyState, Alert } from '../../components/ui'
import { C, FONTS } from '../../lib/constants'
import { useAuth } from '../../context/AuthContext'
import {
  getPolicyCategories, getPolicies, createPolicy,
  uploadPolicyFile, publishPolicy, unpublishPolicy,
  deletePolicy, acknowledgePolicy, getMyAcknowledgements,
} from '../../lib/api.policies'

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function PolicyCard({ policy, isHR, isAcknowledged, onAcknowledge, onPublish, onDelete }) {
  const cat = policy.category
  return (
    <div style={{
      background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`,
      padding: '18px 20px', boxShadow: C.shadow, transition: 'all 0.15s',
      borderLeft: `4px solid ${cat?.color || C.brand}`,
    }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = C.shadowMd}
      onMouseLeave={e => e.currentTarget.style.boxShadow = C.shadow}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: `${cat?.color || C.brand}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
          {cat?.icon || '📄'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: FONTS.display, flex: 1 }}>{policy.title}</div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {policy.requires_ack && (
                <span style={{ fontSize: 10, fontWeight: 700, color: isAcknowledged ? C.green : C.amber, background: isAcknowledged ? C.greenSoft : C.amberSoft, padding: '2px 8px', borderRadius: 10 }}>
                  {isAcknowledged ? '✓ Acknowledged' : '⚠ Requires Ack'}
                </span>
              )}
              {isHR && (
                <span style={{ fontSize: 10, fontWeight: 700, color: policy.is_published ? C.green : C.textLight, background: policy.is_published ? C.greenSoft : C.bg, padding: '2px 8px', borderRadius: 10, border: `1px solid ${policy.is_published ? C.green : C.border}` }}>
                  {policy.is_published ? 'Published' : 'Draft'}
                </span>
              )}
              <span style={{ fontSize: 10, color: C.textLight, background: C.bg, padding: '2px 8px', borderRadius: 10 }}>v{policy.version}</span>
            </div>
          </div>
          {policy.description && <div style={{ fontSize: 12, color: C.textLight, marginBottom: 8 }}>{policy.description}</div>}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {policy.file_url && (
              <a href={policy.file_url} target="_blank" rel="noopener noreferrer" style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 8, border: `1.5px solid ${C.brand}`,
                color: C.brand, textDecoration: 'none', fontSize: 12, fontWeight: 600,
                background: C.brandLight,
              }}>
                ⬇ Download {policy.file_name && `· ${policy.file_name}`} {policy.file_size && `(${formatSize(policy.file_size)})`}
              </a>
            )}
            {policy.requires_ack && !isAcknowledged && !isHR && (
              <button onClick={() => onAcknowledge(policy.id)} style={{
                padding: '6px 14px', borderRadius: 8, border: 'none',
                background: C.brand, color: '#fff',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONTS.display,
              }}>
                ✓ I've Read This
              </button>
            )}
            {policy.published_at && (
              <span style={{ fontSize: 11, color: C.textLight }}>
                Published {new Date(policy.published_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                {policy.publisher && ` by ${policy.publisher.full_name}`}
              </span>
            )}
            {isHR && (
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button onClick={() => onPublish(policy)} style={{
                  padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  border: `1.5px solid ${policy.is_published ? C.amber : C.green}`,
                  color: policy.is_published ? C.amber : C.green,
                  background: policy.is_published ? C.amberSoft : C.greenSoft,
                }}>
                  {policy.is_published ? 'Unpublish' : 'Publish'}
                </button>
                <button onClick={() => onDelete(policy.id)} style={{ padding: '5px 10px', borderRadius: 8, fontSize: 11, border: `1px solid #ef444430`, color: '#ef4444', background: 'none', cursor: 'pointer' }}>
                  🗑
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function AddPolicyModal({ categories: propCategories, onClose, onAdded, publishedBy }) {
  const [categories,  setCategories]  = useState(propCategories || [])
  const [title,       setTitle]       = useState('')
  const [description, setDescription] = useState('')
  const [categoryId,  setCategoryId]  = useState('')

  useEffect(() => {
    getPolicyCategories().then(cats => {
      setCategories(cats)
      if (cats.length > 0 && !categoryId) setCategoryId(cats[0].id)
    })
  }, [])
  const [version,     setVersion]     = useState('1.0')
  const [requiresAck, setRequiresAck] = useState(false)
  const [file,        setFile]        = useState(null)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')
  const fileRef = useRef()

  async function submit() {
    if (!title.trim())  { setError('Title is required.'); return }
    if (!categoryId)    { setError('Please select a category.'); return }
    setSaving(true); setError('')
    try {
      const policy = await createPolicy({ title, description, categoryId, version, requiresAck })
      if (file) await uploadPolicyFile(policy.id, file)
      onAdded()
      onClose()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(26,26,46,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: C.surface, borderRadius: 16, width: '100%', maxWidth: 520, boxShadow: '0 24px 80px rgba(26,26,46,0.2)', padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>📄 Add Policy / Document</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: C.textLight }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 6 }}>Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Leave Policy 2026"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none' }} />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 6 }}>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Brief description of this document…"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none', resize: 'vertical' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 6 }}>Category *</label>
              <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, outline: 'none', background: C.surface }}>
                {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 6 }}>Version</label>
              <input value={version} onChange={e => setVersion(e.target.value)} placeholder="1.0"
                style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, outline: 'none' }} />
            </div>
          </div>

          {/* File upload */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 6 }}>Document File (PDF, DOC, etc.)</label>
            <div onClick={() => fileRef.current?.click()}
              style={{ border: `2px dashed ${file ? C.green : C.border}`, borderRadius: 10, padding: '16px', textAlign: 'center', cursor: 'pointer', background: file ? C.greenSoft : C.bg }}>
              <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.ppt,.pptx" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0])} />
              {file ? (
                <div style={{ fontSize: 13, color: C.green, fontWeight: 600 }}>✅ {file.name} ({formatSize(file.size)})</div>
              ) : (
                <div style={{ fontSize: 12, color: C.textLight }}>📎 Click to upload · PDF, DOC, PPTX · Max 20MB</div>
              )}
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textMid, cursor: 'pointer' }}>
            <input type="checkbox" checked={requiresAck} onChange={e => setRequiresAck(e.target.checked)} style={{ accentColor: C.brand }} />
            Require employees to acknowledge reading this
          </label>

          {error && <Alert type="error" message={error} />}

          <div style={{ display: 'flex', gap: 10 }}>
            <Button onClick={submit} disabled={saving} fullWidth>{saving ? 'Saving…' : '✓ Save as Draft'}</Button>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PolicyCentrePage() {
  const { employee, isHR } = useAuth()
  const [categories,    setCategories]    = useState([])
  const [policies,      setPolicies]      = useState([])
  const [acknowledged,  setAcknowledged]  = useState([])
  const [loading,       setLoading]       = useState(true)
  const [activeCategory,setActiveCategory]= useState('all')
  const [showAdd,       setShowAdd]       = useState(false)

  async function load() {
    const [cats, pols, acks] = await Promise.all([
      getPolicyCategories(),
      getPolicies(),
      employee ? getMyAcknowledgements(employee.id) : Promise.resolve([]),
    ])
    setCategories(cats)
    setPolicies(isHR ? pols : pols.filter(p => p.is_published))
    setAcknowledged(acks)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleAcknowledge(policyId) {
    await acknowledgePolicy(policyId, employee.id)
    setAcknowledged(prev => [...prev, policyId])
  }

  async function handlePublish(policy) {
    if (policy.is_published) await unpublishPolicy(policy.id)
    else await publishPolicy(policy.id, employee.id)
    load()
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this policy?')) return
    await deletePolicy(id)
    load()
  }

  const filtered = activeCategory === 'all'
    ? policies
    : policies.filter(p => p.category_id === activeCategory)

  const pendingAck = policies.filter(p => p.is_published && p.requires_ack && !acknowledged.includes(p.id)).length

  return (
    <AppShell title="Policy Centre" subtitle="Company policies, handbooks and guidelines">
      {/* Pending acknowledgements banner */}
      {!isHR && pendingAck > 0 && (
        <div style={{ background: C.amberSoft, border: `1px solid ${C.amber}30`, borderRadius: 12, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <div style={{ fontSize: 13, color: '#92400e' }}>
            <strong>{pendingAck} document{pendingAck > 1 ? 's' : ''}</strong> require your acknowledgement. Please read and confirm.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* Sidebar — categories */}
        <div style={{ width: 200, flexShrink: 0 }}>
          {isHR && (
            <Button onClick={() => setShowAdd(true)} fullWidth style={{ marginBottom: 14 }}>
              + Add Document
            </Button>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button onClick={() => setActiveCategory('all')} style={{
              padding: '9px 14px', borderRadius: 10, border: 'none', textAlign: 'left',
              background: activeCategory === 'all' ? C.brandLight : 'transparent',
              color: activeCategory === 'all' ? C.brand : C.textMid,
              fontSize: 13, fontWeight: activeCategory === 'all' ? 700 : 400,
              cursor: 'pointer', fontFamily: FONTS.body,
            }}>
              📋 All Documents
              <span style={{ float: 'right', fontSize: 11, color: C.textLight }}>{policies.length}</span>
            </button>
            {categories.map(cat => {
              const count = policies.filter(p => p.category_id === cat.id).length
              return (
                <button key={cat.id} onClick={() => setActiveCategory(cat.id)} style={{
                  padding: '9px 14px', borderRadius: 10, border: 'none', textAlign: 'left',
                  background: activeCategory === cat.id ? `${cat.color}15` : 'transparent',
                  color: activeCategory === cat.id ? cat.color : C.textMid,
                  fontSize: 13, fontWeight: activeCategory === cat.id ? 700 : 400,
                  cursor: 'pointer', fontFamily: FONTS.body,
                }}>
                  {cat.icon} {cat.name}
                  {count > 0 && <span style={{ float: 'right', fontSize: 11, color: C.textLight }}>{count}</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={32} /></div>
          ) : filtered.length === 0 ? (
            <EmptyState icon="📄" title="No documents yet"
              subtitle={isHR ? "Click 'Add Document' to upload your first policy." : "No policies published yet. Check back later."} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.map(policy => (
                <PolicyCard
                  key={policy.id}
                  policy={policy}
                  isHR={isHR}
                  isAcknowledged={acknowledged.includes(policy.id)}
                  onAcknowledge={handleAcknowledge}
                  onPublish={handlePublish}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {showAdd && (
        <AddPolicyModal
          categories={categories}
          publishedBy={employee?.id}
          onClose={() => setShowAdd(false)}
          onAdded={load}
        />
      )}
    </AppShell>
  )
}
