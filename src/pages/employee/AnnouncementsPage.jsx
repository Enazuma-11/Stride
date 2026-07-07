import { useEffect, useState, useRef } from 'react'
import AppShell from '../../components/layout/AppShell'
import { Card, Avatar, Button, Spinner, EmptyState, Alert } from '../../components/ui'
import { C, FONTS } from '../../lib/constants'
import { useAuth } from '../../context/AuthContext'
import {
  getAnnouncements, createAnnouncement, updateAnnouncement,
  deleteAnnouncement, toggleReaction, addComment, deleteComment,
  acknowledgeAnnouncement, ANNOUNCEMENT_CATEGORIES,
} from '../../lib/api.announcements'
import { supabase } from '../../lib/supabase'

const EMOJI_PICKER_SET = ['👍', '❤️', '🎉', '😂', '😮', '😢', '🔥', '👏', '🙌', '💯', '🚀', '👀', '😍', '🤔', '💪', '✅']

function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7)   return `${days}d ago`
  return new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// ── Post form ────────────────────────────────────────────────────────────────
function PostForm({ onPosted, editData, onClose }) {
  const { employee } = useAuth()
  const [title,    setTitle]    = useState(editData?.title || '')
  const [body,     setBody]     = useState(editData?.body  || '')
  const [category, setCategory] = useState(editData?.category || 'general')
  const [pinned,   setPinned]   = useState(editData?.pinned || false)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  async function submit() {
    if (!title.trim() || !body.trim()) { setError('Title and message are required.'); return }
    setSaving(true); setError('')
    try {
      if (editData) {
        await updateAnnouncement(editData.id, { title, body, category, pinned })
      } else {
        await createAnnouncement({ title, body, category, pinned, postedBy: employee.id })
      }
      onPosted()
      onClose?.()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, padding: '20px 24px', boxShadow: C.shadowMd, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: FONTS.display, marginBottom: 16 }}>
        {editData ? '✏️ Edit Announcement' : '📢 Post Announcement'}
      </div>

      {/* Category pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {ANNOUNCEMENT_CATEGORIES.map(c => (
          <button key={c.value} onClick={() => setCategory(c.value)} style={{
            padding: '5px 14px', borderRadius: 20, border: `1.5px solid ${category === c.value ? c.color : C.border}`,
            background: category === c.value ? `${c.color}15` : C.surface,
            color: category === c.value ? c.color : C.textLight,
            fontSize: 12, fontWeight: category === c.value ? 700 : 400,
            cursor: 'pointer', fontFamily: FONTS.body,
          }}>{c.label}</button>
        ))}
      </div>

      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Announcement title…"
        style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 14, fontWeight: 600, fontFamily: FONTS.display, outline: 'none', marginBottom: 10, color: C.text }} />

      <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Write your announcement…" rows={4}
        style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none', resize: 'vertical', color: C.text, marginBottom: 10 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textMid, cursor: 'pointer' }}>
          <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} />
          📌 Pin to top
        </label>
        <div style={{ flex: 1 }} />
        {editData && <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>}
        <Button onClick={submit} disabled={saving} size="sm">
          {saving ? 'Posting…' : editData ? 'Update' : 'Post Announcement'}
        </Button>
      </div>
      {error && <div style={{ marginTop: 10 }}><Alert type="error" message={error} /></div>}
    </div>
  )
}

// ── Single announcement card ──────────────────────────────────────────────────
function AnnouncementCard({ ann, currentEmployee, isHR, onUpdate, allEmployees }) {
  const [showComments, setShowComments] = useState(false)
  const [comment,      setComment]      = useState('')
  const [posting,      setPosting]      = useState(false)
  const [editing,      setEditing]      = useState(false)
  const [acking,          setAcking]          = useState(false)
  const [showAcks,        setShowAcks]        = useState(false)
  const [showPicker,      setShowPicker]      = useState(false)
  const [hoveredReaction, setHoveredReaction] = useState(null)
  const pickerRef = useRef(null)

  // Close emoji picker when clicking outside
  useEffect(() => {
    if (!showPicker) return
    function handleOutside(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setShowPicker(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [showPicker])

  const hasAcknowledged = ann.acknowledgements?.some(a => a.employee_id === currentEmployee?.id)
  const ackCount = ann.acknowledgements?.length || 0
  const acknowledgedIds = new Set(ann.acknowledgements?.map(a => a.employee_id) || [])
  const notAcknowledged = (allEmployees || []).filter(e => !acknowledgedIds.has(e.id))

  async function handleAcknowledge() {
    setAcking(true)
    try {
      await acknowledgeAnnouncement(ann.id, currentEmployee.id)
      onUpdate()
    } finally { setAcking(false) }
  }

  const cat = ANNOUNCEMENT_CATEGORIES.find(c => c.value === ann.category) || ANNOUNCEMENT_CATEGORIES[0]

  // Build reaction counts from actual data (any emoji, not just preset 3)
  const reactedEmojis = [...new Set(ann.reactions?.map(r => r.emoji) || [])]
  const reactionCounts = reactedEmojis.map(emoji => ({
    emoji,
    count: ann.reactions?.filter(r => r.emoji === emoji).length || 0,
    reacted: ann.reactions?.some(r => r.emoji === emoji && r.employee_id === currentEmployee?.id),
    reactors: ann.reactions?.filter(r => r.emoji === emoji).map(r => r.employee?.full_name || 'Someone') || [],
  }))

  async function handleReaction(emoji) {
    await toggleReaction(ann.id, currentEmployee.id, emoji)
    onUpdate()
  }

  async function handleComment() {
    if (!comment.trim()) return
    setPosting(true)
    try {
      await addComment(ann.id, currentEmployee.id, comment)
      setComment('')
      onUpdate()
    } finally { setPosting(false) }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this announcement?')) return
    await deleteAnnouncement(ann.id)
    onUpdate()
  }

  async function handleDeleteComment(id) {
    await deleteComment(id)
    onUpdate()
  }

  if (editing) return <PostForm editData={ann} onPosted={onUpdate} onClose={() => setEditing(false)} />

  return (
    <div style={{
      background: C.surface, borderRadius: 16,
      border: `1px solid ${ann.pinned ? C.brand + '40' : C.border}`,
      boxShadow: ann.pinned ? `0 0 0 2px ${C.brand}20, ${C.shadow}` : C.shadow,
      overflow: 'hidden', marginBottom: 14,
    }}>
      {/* Category bar */}
      <div style={{ height: 4, background: cat.color }} />

      <div style={{ padding: '16px 20px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <Avatar initials={ann.posted_by?.avatar_initials || '??'} size={38}
            src={ann.posted_by?.profile_photo_url} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>{ann.posted_by?.full_name}</span>
              <span style={{ fontSize: 11, color: C.textLight }}>{ann.posted_by?.role}</span>
              <span style={{ fontSize: 10, color: cat.color, background: `${cat.color}15`, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{cat.label}</span>
              {ann.pinned && <span style={{ fontSize: 10, color: C.brand, fontWeight: 700 }}>📌 Pinned</span>}
            </div>
            <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>{timeAgo(ann.created_at)}</div>
          </div>
          {isHR && (
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', color: C.textLight, padding: 4 }}>✏️</button>
              <button onClick={handleDelete} style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', color: '#ef4444', padding: 4 }}>🗑</button>
            </div>
          )}
        </div>

        {/* Content */}
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: FONTS.display, marginBottom: 8 }}>{ann.title}</div>
        <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{ann.body}</div>

        {/* Reactions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          {reactionCounts.map(({ emoji, count, reacted, reactors }) => (
            <div key={emoji} style={{ position: 'relative' }}>
              <button
                onClick={() => handleReaction(emoji)}
                onMouseEnter={() => setHoveredReaction(emoji)}
                onMouseLeave={() => setHoveredReaction(null)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '5px 12px', borderRadius: 20,
                  border: `1.5px solid ${reacted ? C.brand : C.border}`,
                  background: reacted ? C.brandLight : C.surface,
                  fontSize: 14, cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                <span>{emoji}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: reacted ? C.brand : C.textMid }}>{count}</span>
              </button>
              {hoveredReaction === emoji && reactors.length > 0 && (
                <div style={{
                  position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
                  background: '#1e1e2e', color: '#fff', borderRadius: 8,
                  padding: '6px 10px', fontSize: 11, whiteSpace: 'nowrap',
                  zIndex: 200, boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
                  maxWidth: 220, pointerEvents: 'none',
                }}>
                  {reactors.slice(0, 5).join(', ')}
                  {reactors.length > 5 && ` +${reactors.length - 5} more`}
                </div>
              )}
            </div>
          ))}

          {/* Emoji picker */}
          <div style={{ position: 'relative' }} ref={pickerRef}>
            <button
              onClick={() => setShowPicker(p => !p)}
              style={{
                padding: '5px 10px', borderRadius: 20,
                border: `1.5px solid ${C.border}`, background: C.surface,
                fontSize: 15, cursor: 'pointer', color: C.textLight, lineHeight: 1,
              }}
            >＋</button>
            {showPicker && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
                background: C.surface, border: `1px solid ${C.border}`,
                borderRadius: 14, padding: 10, zIndex: 200,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2,
              }}>
                {EMOJI_PICKER_SET.map(e => {
                  const alreadyPicked = ann.reactions?.some(r => r.emoji === e && r.employee_id === currentEmployee?.id)
                  return (
                    <button key={e} onClick={() => { handleReaction(e); setShowPicker(false) }} style={{
                      padding: 6, borderRadius: 8, fontSize: 18, cursor: 'pointer',
                      border: `1.5px solid ${alreadyPicked ? C.brand : 'transparent'}`,
                      background: alreadyPicked ? C.brandLight : 'transparent',
                      transition: 'background 0.1s',
                    }}>{e}</button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Employee: acknowledge button */}
          {!isHR && (
            hasAcknowledged
              ? <span style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 20, border: '1.5px solid #00b89440', background: '#00b89412', fontSize: 12, fontWeight: 600, color: '#00b894' }}>✓ Acknowledged</span>
              : <button onClick={handleAcknowledge} disabled={acking} style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 20,
                  border: `1.5px solid ${C.border}`, background: C.surface,
                  fontSize: 12, fontWeight: 600, color: C.textMid,
                  cursor: acking ? 'not-allowed' : 'pointer', fontFamily: FONTS.body,
                }}>
                  {acking ? '…' : '✓ Acknowledge'}
                </button>
          )}

          <button onClick={() => setShowComments(!showComments)} style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 12, color: C.textLight, fontFamily: FONTS.body,
          }}>
            💬 {ann.comments?.length || 0} comment{ann.comments?.length !== 1 ? 's' : ''}
          </button>
        </div>

        {/* HR: acknowledgement tracker */}
        {isHR && (
          <div style={{ marginTop: 10 }}>
            <button onClick={() => setShowAcks(!showAcks)} style={{
              display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
              cursor: 'pointer', fontSize: 12, fontFamily: FONTS.body, padding: 0,
              color: ackCount > 0 ? '#00b894' : C.textLight,
            }}>
              ✓ {ackCount} / {allEmployees?.length || '?'} acknowledged {showAcks ? '▴' : '▾'}
            </button>
            {showAcks && (
              <div style={{ marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                {ackCount > 0 && (
                  <div style={{ marginBottom: notAcknowledged.length > 0 ? 12 : 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#00b894', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      ✓ Acknowledged ({ackCount})
                    </div>
                    {ann.acknowledgements.map(a => (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                        <Avatar initials={a.employee?.avatar_initials || '??'} size={22} />
                        <span style={{ fontSize: 12, color: C.text }}>{a.employee?.full_name}</span>
                        <span style={{ fontSize: 10, color: C.textLight, marginLeft: 'auto' }}>{timeAgo(a.acknowledged_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {notAcknowledged.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.amber, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      ⏳ Pending ({notAcknowledged.length})
                    </div>
                    {notAcknowledged.map(e => (
                      <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                        <Avatar initials={e.avatar_initials || '??'} size={22} />
                        <span style={{ fontSize: 12, color: C.textMid }}>{e.full_name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {ackCount === 0 && notAcknowledged.length === 0 && (
                  <div style={{ fontSize: 12, color: C.textLight }}>No active employees to track.</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Comments */}
        {showComments && (
          <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
            {ann.comments?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                {ann.comments.map(c => (
                  <div key={c.id} style={{ display: 'flex', gap: 10 }}>
                    <Avatar initials={c.employee?.avatar_initials || '??'} size={28} src={c.employee?.profile_photo_url} />
                    <div style={{ flex: 1, background: C.bg, borderRadius: 10, padding: '8px 12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{c.employee?.full_name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 10, color: C.textLight }}>{timeAgo(c.created_at)}</span>
                          {(c.employee_id === currentEmployee?.id || isHR) && (
                            <button onClick={() => handleDeleteComment(c.id)} style={{ background: 'none', border: 'none', fontSize: 11, cursor: 'pointer', color: '#ef444480' }}>✕</button>
                          )}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.5 }}>{c.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Comment input */}
            <div style={{ display: 'flex', gap: 10 }}>
              <Avatar initials={currentEmployee?.avatar_initials || '??'} size={28} src={currentEmployee?.profile_photo_url} />
              <div style={{ flex: 1, display: 'flex', gap: 8 }}>
                <input value={comment} onChange={e => setComment(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleComment()}
                  placeholder="Write a comment…"
                  style={{ flex: 1, padding: '8px 12px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 12, fontFamily: FONTS.body, outline: 'none' }} />
                <button onClick={handleComment} disabled={posting || !comment.trim()} style={{
                  padding: '8px 14px', borderRadius: 10, border: 'none',
                  background: posting || !comment.trim() ? C.border : C.brand,
                  color: posting || !comment.trim() ? C.textLight : '#fff',
                  fontSize: 12, fontWeight: 600, cursor: posting || !comment.trim() ? 'not-allowed' : 'pointer',
                  fontFamily: FONTS.display,
                }}>
                  {posting ? '…' : 'Post'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AnnouncementsPage() {
  const { employee, isHR } = useAuth()
  const [announcements, setAnnouncements] = useState([])
  const [allEmployees,  setAllEmployees]  = useState([])
  const [loading,       setLoading]       = useState(true)
  const [showForm,      setShowForm]      = useState(false)
  const [filter,        setFilter]        = useState('all')

  async function load() {
    try {
      const data = await getAnnouncements()
      setAnnouncements(data)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  // Fetch all active employees so HR can see who hasn't acknowledged
  useEffect(() => {
    if (!isHR) return
    supabase.from('employees').select('id, full_name, avatar_initials').eq('status', 'active')
      .then(({ data }) => setAllEmployees(data || []))
  }, [isHR])

  // Realtime subscription
  useEffect(() => {
    const sub = supabase.channel('announcements-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcement_reactions' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcement_comments' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcement_acknowledgements' }, load)
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [])

  const filtered = filter === 'all'
    ? announcements
    : announcements.filter(a => a.category === filter)

  return (
    <AppShell title="Announcements" subtitle="Company news, updates and events">
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {/* HR post form */}
        {isHR && (
          showForm
            ? <PostForm onPosted={() => { load(); setShowForm(false) }} onClose={() => setShowForm(false)} />
            : <div style={{ marginBottom: 20 }}>
                <Button onClick={() => setShowForm(true)}>📢 Post Announcement</Button>
              </div>
        )}

        {/* Category filter */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <button onClick={() => setFilter('all')} style={{
            padding: '6px 16px', borderRadius: 20, border: `1.5px solid ${filter === 'all' ? C.brand : C.border}`,
            background: filter === 'all' ? C.brandLight : C.surface,
            color: filter === 'all' ? C.brand : C.textLight,
            fontSize: 12, fontWeight: filter === 'all' ? 700 : 400, cursor: 'pointer',
          }}>All</button>
          {ANNOUNCEMENT_CATEGORIES.map(c => (
            <button key={c.value} onClick={() => setFilter(c.value)} style={{
              padding: '6px 16px', borderRadius: 20,
              border: `1.5px solid ${filter === c.value ? c.color : C.border}`,
              background: filter === c.value ? `${c.color}15` : C.surface,
              color: filter === c.value ? c.color : C.textLight,
              fontSize: 12, fontWeight: filter === c.value ? 700 : 400, cursor: 'pointer',
            }}>{c.label}</button>
          ))}
        </div>

        {/* Announcements list */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={32} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="📢" title="No announcements yet" subtitle={isHR ? "Post the first announcement for your team." : "Check back later for company updates."} />
        ) : (
          filtered.map(ann => (
            <AnnouncementCard
              key={ann.id}
              ann={ann}
              currentEmployee={employee}
              isHR={isHR}
              onUpdate={load}
              allEmployees={allEmployees}
            />
          ))
        )}
      </div>
    </AppShell>
  )
}
