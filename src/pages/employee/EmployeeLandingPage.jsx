import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import { Card, SectionTitle, Avatar, Tag, Badge, Spinner, EmptyState } from '../../components/ui'
import { C, FONTS, LEAVE_TYPES, FEMALE_ONLY_LEAVES, ATTENDANCE_STATUSES } from '../../lib/constants'
import { useAuth } from '../../context/AuthContext'
import { useResponsive, cols } from '../../lib/responsive'
import { getMyLeaveBalances, getMyLeaveRequests, getAnnouncements, getUpcomingApprovedLeaves } from '../../lib/api'
import { getTodayAttendance, getHolidays, todayISO, getWeeklyHours, getWeekStart } from '../../lib/api.attendance'
import { getMyUnregularizedSessions, getMyExpiringCertifications } from '../../lib/api.dashboard'
import { getManagerPendingReviews, managerSubmitReview } from '../../lib/api.probation'
import { getAnnualCycle, getManagerGoalApprovals, approveGoalSet, returnGoalSet, getManagerReviewTargets, saveReview } from '../../lib/api.performance'
import { getReviewWindow, VERDICTS } from '../../lib/constants'

// ── Helpers ───────────────────────────────────────────────────────────────────
function getTimeOfDay() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function daysUntil(dateStr) {
  return Math.ceil((new Date(dateStr) - new Date(todayISO())) / 86400000)
}

// ── Smart prompt builder ──────────────────────────────────────────────────────
function buildSmartPrompts({ unregularized, myRequests, expiringCerts, employee, holidays }) {
  const prompts  = []
  const today    = new Date(todayISO())

  unregularized.slice(0, 3).forEach(s => {
    const dateStr = s.check_in.split('T')[0]
    prompts.push({
      key:       `unreg-${s.id}`,
      dot:       C.accent,
      message:   `Regularize your attendance for ${new Date(dateStr).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}`,
      link:      '/attendance',
      linkLabel: 'Regularize →',
    })
  })

  const pendingLeaves = myRequests.filter(r => r.status === 'pending')
  if (pendingLeaves.length > 0) {
    const lt = LEAVE_TYPES.find(t => t.id === pendingLeaves[0].leave_type)
    prompts.push({
      key:       'pending-leave',
      dot:       C.amber,
      message:   `Your ${lt?.label || 'leave'} request is awaiting approval`,
      link:      '/leaves',
      linkLabel: 'View →',
    })
  }

  expiringCerts.forEach(c => {
    const d = Math.ceil((new Date(c.expiry_date) - today) / 86400000)
    prompts.push({
      key:       `cert-${c.id}`,
      dot:       d <= 7 ? C.accent : C.amber,
      message:   `Your ${c.title} expires in ${d} day${d !== 1 ? 's' : ''}`,
      link:      '/profile?tab=skills',
      linkLabel: 'View →',
    })
  })

  if (employee?.employee_type && ['intern', 'probation'].includes(employee.employee_type) && employee.join_date) {
    const end = new Date(employee.join_date)
    end.setMonth(end.getMonth() + 6)
    const d = Math.ceil((end - today) / 86400000)
    if (d >= 0 && d <= 14) {
      prompts.push({
        key:       'probation-end',
        dot:       d <= 3 ? C.accent : C.amber,
        message:   `Your ${employee.employee_type === 'intern' ? 'internship' : 'probation'} period ends in ${d} day${d !== 1 ? 's' : ''}`,
        link:      null,
        linkLabel: null,
      })
    }
  }

  holidays.filter(h => { const d = daysUntil(h.date); return d >= 0 && d <= 7 }).forEach(h => {
    const d = daysUntil(h.date)
    prompts.push({
      key:       `holiday-${h.id}`,
      dot:       C.teal,
      message:   `${h.name} is ${d === 0 ? 'today' : `in ${d} day${d !== 1 ? 's' : ''}`} — ${new Date(h.date).toLocaleDateString('en-IN', { weekday: 'long' })}`,
      link:      null,
      linkLabel: null,
    })
  })

  return prompts
}

// ── Leave balance card ────────────────────────────────────────────────────────
function BalanceCard({ lt, balance }) {
  const total     = Number(balance?.total_days ?? lt.total ?? 0)
  const used      = Number(balance?.used_days  ?? 0)
  const remaining = Math.max(0, total - used)
  const pct       = total > 0 ? (remaining / total) * 100 : 0
  return (
    <Card style={{ padding: '16px 18px' }}>
      <div style={{ fontSize: 10, color: C.textLight, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>{lt.label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: lt.color, lineHeight: 1, fontFamily: "'Sora',sans-serif" }}>{remaining}</span>
        <span style={{ fontSize: 12, color: C.textLight, marginBottom: 2 }}>/ {total}</span>
      </div>
      <div style={{ height: 3, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: lt.color, borderRadius: 4 }} />
      </div>
      <div style={{ fontSize: 10, color: C.textLight, marginTop: 5 }}>{total - remaining} used</div>
    </Card>
  )
}

// ── Probation review panel (managers only) ────────────────────────────────────
const REVIEW_CHOICES = [
  {
    value:   'confirm',
    icon:    '✅',
    label:   'Confirm',
    sub:     'Employee joins as a permanent team member',
    color:   '#00b894',
    bg:      '#e8faf0',
    border:  '#00b89450',
  },
  {
    value:   'extend',
    icon:    '📅',
    label:   'Extend',
    sub:     'Review continues for a custom duration',
    color:   C.amber,
    bg:      C.amberSoft,
    border:  C.amber + '50',
  },
  {
    value:   'relieve',
    icon:    '🔴',
    label:   'Relieve',
    sub:     'Offboarding process begins',
    color:   '#ef4444',
    bg:      '#fef2f2',
    border:  '#ef444440',
  },
]

function ProbationReviewPanel({ reviews, managerId, onRefresh }) {
  const [activeReview,    setActiveReview]    = useState(reviews[0]?.id || null)
  const [recommendation,  setRecommendation]  = useState('')
  const [notes,           setNotes]           = useState('')
  const [extensionDays,   setExtensionDays]   = useState('')
  const [saving,          setSaving]          = useState(false)
  const [error,           setError]           = useState('')
  const [successId,       setSuccessId]       = useState(null)

  const review = reviews.find(r => r.id === activeReview) || reviews[0]
  if (!review) return null

  const emp           = review.employee
  const end           = new Date(emp?.probation_end_date)
  const remaining     = Math.max(0, Math.round((end - new Date()) / 86400000))
  const isUrgent      = remaining <= 14
  const alreadyDone   = review.status === 'pending_hr'
  const canExtend     = !emp?.probation_extended

  async function handleSubmit() {
    setError('')
    if (!recommendation) { setError('Please select a recommendation.'); return }
    if (!notes.trim())    { setError('Notes are required.'); return }
    if (recommendation === 'extend' && !extensionDays) { setError('Enter extension duration.'); return }
    setSaving(true)
    try {
      await managerSubmitReview(review.id, { recommendation, notes, extensionDays: Number(extensionDays) }, managerId)
      setSuccessId(review.id)
      onRefresh()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ background: C.surface, borderRadius: 16, border: `1.5px solid ${isUrgent ? C.amber + '60' : C.border}`, padding: '20px 24px', marginBottom: 24, boxShadow: C.shadow }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONTS.display, marginBottom: 4 }}>
        📋 Probation Reviews
      </div>
      <div style={{ fontSize: 12, color: C.textLight, marginBottom: 16 }}>
        {reviews.length} direct report{reviews.length !== 1 ? 's' : ''} awaiting review
      </div>

      {/* Employee selector if multiple */}
      {reviews.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {reviews.map(rv => (
            <button key={rv.id} onClick={() => { setActiveReview(rv.id); setRecommendation(''); setNotes(''); setExtensionDays(''); setError('') }}
              style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: `1.5px solid ${rv.id === activeReview ? C.brand : C.border}`,
                background: rv.id === activeReview ? C.brandLight : C.surface,
                color: rv.id === activeReview ? C.brand : C.textMid,
              }}>
              {rv.employee?.full_name?.split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      {/* Employee info strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: C.bg, borderRadius: 10, marginBottom: 16 }}>
        <Avatar initials={emp?.avatar_initials || '??'} size={36} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{emp?.full_name}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{emp?.department}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: isUrgent ? C.amber : C.textMid }}>{remaining}d remaining</div>
          <div style={{ fontSize: 10, color: C.textLight }}>{end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
        </div>
      </div>

      {/* Already submitted state */}
      {alreadyDone || successId === review.id ? (
        <div style={{ padding: '16px', background: '#e8faf0', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#00b894', marginBottom: 4 }}>✓ Review Submitted</div>
          <div style={{ fontSize: 12, color: C.textMid }}>Awaiting HR decision</div>
        </div>
      ) : (
        <>
          {/* Choice cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 14 }}>
            {REVIEW_CHOICES.map(c => {
              const disabled = c.value === 'extend' && !canExtend
              const selected = recommendation === c.value
              return (
                <button key={c.value} onClick={() => !disabled && setRecommendation(c.value)} style={{
                  padding: '14px 10px', borderRadius: 12, cursor: disabled ? 'not-allowed' : 'pointer',
                  border: `2px solid ${selected ? c.color : disabled ? C.border : C.border}`,
                  background: selected ? c.bg : disabled ? C.bg : C.surface,
                  opacity: disabled ? 0.5 : 1, textAlign: 'center', transition: 'all 0.15s',
                }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{c.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: selected ? c.color : C.text }}>{c.label}</div>
                  <div style={{ fontSize: 10, color: C.textLight, marginTop: 3, lineHeight: 1.4 }}>
                    {disabled ? 'Extension already used' : c.sub}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Extension days input */}
          {recommendation === 'extend' && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: C.textMid, fontWeight: 600 }}>Extension duration (days)</label>
              <input type="number" min="1" value={extensionDays} onChange={e => setExtensionDays(e.target.value)}
                placeholder="e.g. 90"
                style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 12px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none' }} />
            </div>
          )}

          {/* Notes */}
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            placeholder="Add your notes for HR (required)…"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none', resize: 'vertical', marginBottom: 12 }} />

          {error && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 10 }}>{error}</div>}

          <button onClick={handleSubmit} disabled={saving || !recommendation} style={{
            width: '100%', padding: '11px', borderRadius: 10, border: 'none', cursor: saving || !recommendation ? 'not-allowed' : 'pointer',
            background: saving || !recommendation ? C.border : C.brand, color: '#fff',
            fontSize: 13, fontWeight: 700, fontFamily: FONTS.display,
          }}>
            {saving ? 'Submitting…' : 'Submit Review →'}
          </button>
        </>
      )}
    </div>
  )
}

function GoalApprovalCard({ sub, onApprove, onReturn }) {
  const [returning, setReturning] = useState(false)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const sum = (sub.goals || []).reduce((s, g) => s + (g.points || 0), 0)

  async function act(fn) {
    setBusy(true); setErr('')
    try { await fn() } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <div style={{ background: C.bg, borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Avatar initials={sub.employee?.avatar_initials || '??'} size={30} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{sub.employee?.full_name}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{sub.employee?.department} · {sub.goals?.length} goals · {sum} pts</div>
        </div>
      </div>
      {(sub.goals || []).map(g => (
        <div key={g.id} style={{ display: 'flex', gap: 10, fontSize: 12, color: C.textMid, padding: '4px 0', borderTop: `1px solid ${C.border}` }}>
          <span style={{ fontWeight: 800, color: C.brand, minWidth: 34 }}>{g.points}</span>
          <span>{g.title}</span>
        </div>
      ))}
      {returning ? (
        <div style={{ marginTop: 10 }}>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="What should change? (required)"
            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 12, fontFamily: FONTS.body, outline: 'none', resize: 'vertical', marginBottom: 8 }} />
          {err && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => act(async () => { await onReturn(sub.id, comment); })} disabled={busy}
              style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: C.amber, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Send Back</button>
            <button onClick={() => { setReturning(false); setErr('') }} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'none', fontSize: 12, cursor: 'pointer', color: C.textLight }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={() => act(async () => { await onApprove(sub.id); })} disabled={busy}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#00b894', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✓ Approve</button>
          <button onClick={() => setReturning(true)} disabled={busy}
            style={{ padding: '7px 16px', borderRadius: 8, border: `1.5px solid ${C.amber}`, background: 'none', color: C.amber, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>↩ Return</button>
        </div>
      )}
      {err && !returning && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>{err}</div>}
    </div>
  )
}

function ReviewCard({ target, reviewType, cycleId, managerId, onDone }) {
  const existing = target.reviews.find(r => r.review_type === reviewType)
  const [open, setOpen] = useState(false)
  const [ratings, setRatings] = useState(() => target.goals.map(g => {
    const rt = existing?.ratings?.find(x => x.objective_id === g.id)
    return { objectiveId: g.id, title: g.title, points: g.points, score: rt?.score ?? '', comment: rt?.comment ?? '' }
  }))
  const [overall, setOverall] = useState(existing?.overall_comment || '')
  const [verdict, setVerdict] = useState(existing?.verdict || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const done = existing?.status === 'manager_done' || existing?.status === 'hr_finalized'

  async function submit() {
    setErr('')
    if (reviewType === 'year_end' && !verdict) { setErr('Select a verdict.'); return }
    setBusy(true)
    try {
      await saveReview({
        reviewId: existing?.id, cycleId, employeeId: target.employee.id, reviewType,
        ratings: ratings.map(r => ({ objectiveId: r.objectiveId, score: r.score === '' ? null : parseFloat(r.score), comment: r.comment })),
        overallComment: overall, verdict: reviewType === 'year_end' ? verdict : undefined,
      }, managerId)
      onDone()
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <div style={{ background: C.bg, borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
      <div onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <Avatar initials={target.employee?.avatar_initials || '??'} size={30} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{target.employee?.full_name}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{target.goals.length} goals</div>
        </div>
        {done ? <span style={{ fontSize: 11, fontWeight: 700, color: '#00b894' }}>✓ Submitted</span>
              : <span style={{ fontSize: 11, color: C.brand }}>{open ? '▲' : 'Review ▾'}</span>}
      </div>

      {open && !done && (
        <div style={{ marginTop: 12 }}>
          {ratings.map((r, i) => (
            <div key={r.objectiveId} style={{ padding: '8px 0', borderTop: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}><span style={{ color: C.brand }}>{r.points}pts</span> · {r.title}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8 }}>
                <input type="number" min="0" max="100" value={r.score} placeholder="score" onChange={e => setRatings(rs => rs.map((x, idx) => idx === i ? { ...x, score: e.target.value } : x))}
                  style={{ padding: '7px 10px', borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 12, fontFamily: FONTS.body, outline: 'none', textAlign: 'center' }} />
                <input value={r.comment} placeholder="Comment (visible to employee)" onChange={e => setRatings(rs => rs.map((x, idx) => idx === i ? { ...x, comment: e.target.value } : x))}
                  style={{ padding: '7px 10px', borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 12, fontFamily: FONTS.body, outline: 'none' }} />
              </div>
            </div>
          ))}
          <textarea value={overall} onChange={e => setOverall(e.target.value)} rows={2} placeholder="Overall comment (visible to employee)"
            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 12, fontFamily: FONTS.body, outline: 'none', resize: 'vertical', margin: '10px 0' }} />
          {reviewType === 'year_end' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6, marginBottom: 10 }}>
              {VERDICTS.map(v => (
                <button key={v.value} onClick={() => setVerdict(v.value)} style={{
                  padding: '8px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                  border: `2px solid ${verdict === v.value ? v.color : C.border}`,
                  background: verdict === v.value ? v.bg : C.surface, color: verdict === v.value ? v.color : C.textMid,
                }}>{v.label}</button>
              ))}
            </div>
          )}
          {err && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{err}</div>}
          <button onClick={submit} disabled={busy}
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: busy ? C.border : C.brand, color: '#fff', fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: FONTS.display }}>
            {busy ? 'Saving…' : 'Submit Review →'}
          </button>
        </div>
      )}
    </div>
  )
}

function PerformanceManagerPanel({ managerId }) {
  const [cycle, setCycle] = useState(null)
  const [approvals, setApprovals] = useState([])
  const [targets, setTargets] = useState([])
  const reviewWindow = getReviewWindow()

  async function load() {
    const c = await getAnnualCycle()
    setCycle(c)
    if (!c) return
    setApprovals(await getManagerGoalApprovals(managerId, c.id))
    if (reviewWindow) setTargets(await getManagerReviewTargets(managerId, c.id))
  }
  useEffect(() => { load() }, [])

  if (!cycle) return null
  const showReviews = reviewWindow && targets.length > 0
  if (approvals.length === 0 && !showReviews) return null

  return (
    <div style={{ background: C.surface, borderRadius: 16, border: `1.5px solid ${C.border}`, padding: '20px 24px', marginBottom: 24, boxShadow: C.shadow }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.text, fontFamily: FONTS.display, marginBottom: 16 }}>📋 Performance — Team Actions</div>

      {approvals.length > 0 && (
        <div style={{ marginBottom: showReviews ? 20 : 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, marginBottom: 10 }}>Goal Approvals ({approvals.length})</div>
          {approvals.map(sub => (
            <GoalApprovalCard key={sub.id} sub={sub}
              onApprove={async (id) => { await approveGoalSet(id, managerId); await load() }}
              onReturn={async (id, comment) => { await returnGoalSet(id, comment, managerId); await load() }} />
          ))}
        </div>
      )}

      {showReviews && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, marginBottom: 10 }}>
            {reviewWindow === 'h1' ? 'H1 Reviews' : 'Year-End Reviews'} ({targets.length})
          </div>
          {targets.map(t => (
            <ReviewCard key={t.employee.id} target={t} reviewType={reviewWindow} cycleId={cycle.id} managerId={managerId} onDone={load} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function EmployeeLandingPage() {
  const { employee }  = useAuth()
  const navigate      = useNavigate()
  const r             = useResponsive()
  const year          = new Date().getFullYear()

  const [balances,       setBalances]       = useState([])
  const [myRequests,     setMyRequests]     = useState([])
  const [announcements,  setAnnouncements]  = useState([])
  const [todayAtt,       setTodayAtt]       = useState(null)
  const [weekly,         setWeekly]         = useState(null)
  const [holidays,       setHolidays]       = useState([])
  const [upcomingLeaves, setUpcomingLeaves] = useState([])
  const [unregularized,  setUnregularized]  = useState([])
  const [expiringCerts,  setExpiringCerts]  = useState([])
  const [probationReviews, setProbationReviews] = useState([])
  const [loading,        setLoading]        = useState(true)
  const [loadError,      setLoadError]      = useState(null)

  useEffect(() => {
    if (!employee) return
    const safe = (label, promise, fallback) =>
      promise.catch(err => { console.error(`[Dashboard] ${label} failed:`, err); return fallback })

    Promise.all([
      safe('getMyLeaveBalances',       getMyLeaveBalances(employee.id),                    []),
      safe('getMyLeaveRequests',        getMyLeaveRequests(employee.id),                    []),
      safe('getAnnouncements',          getAnnouncements(),                                 []),
      safe('getTodayAttendance',        getTodayAttendance(employee.id),                    null),
      safe('getHolidays',               getHolidays(year),                                  []),
      safe('getWeeklyHours',            getWeeklyHours(employee.id, getWeekStart(todayISO())), null),
      safe('getUpcomingApprovedLeaves', getUpcomingApprovedLeaves(),                        []),
      safe('getMyUnregularizedSessions',getMyUnregularizedSessions(employee.id),            []),
      safe('getMyExpiringCertifications',getMyExpiringCertifications(employee.id),          []),
      safe('getManagerPendingReviews',   getManagerPendingReviews(employee.id),             []),
    ]).then(([bal, req, ann, att, hols, wk, upcoming, unreg, certs, probReviews]) => {
      setBalances(bal)
      setMyRequests(req)
      setAnnouncements(ann)
      setTodayAtt(att)
      setHolidays(hols)
      setWeekly(wk)
      setUpcomingLeaves(upcoming)
      setUnregularized(unreg)
      setExpiringCerts(certs)
      setProbationReviews(probReviews)
    }).finally(() => setLoading(false))
  }, [employee])

  if (loading) return (
    <AppShell title="Dashboard">
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><Spinner size={36} /></div>
    </AppShell>
  )

  if (loadError) return (
    <AppShell title={`Good ${getTimeOfDay()}, ${employee?.full_name?.split(' ')[0]} 👋`}>
      <Card style={{ padding: '24px', borderLeft: `4px solid ${C.accent}`, marginTop: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.accent, marginBottom: 4 }}>Failed to load dashboard</div>
        <div style={{ fontSize: 12, color: C.textMid }}>{loadError}</div>
      </Card>
    </AppShell>
  )

  const attStatus   = todayAtt ? ATTENDANCE_STATUSES.find(a => a.value === todayAtt.status) : null
  const earnedBal   = balances.find(b => b.leave_type === 'earned')
  const earnedTotal = Number(earnedBal?.total_days ?? 18)
  const earnedUsed  = Number(earnedBal?.used_days  ?? 0)
  const earnedLeft  = Math.max(0, earnedTotal - earnedUsed)
  const pendingCount = myRequests.filter(r => r.status === 'pending').length

  const prompts = buildSmartPrompts({ unregularized, myRequests, expiringCerts, employee, holidays })

  const pinnedAnn = [...announcements].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).slice(0, 3)
  const upcomingHols = holidays.filter(h => { const d = daysUntil(h.date); return d >= 0 && d <= 7 })

  return (
    <AppShell title={`Good ${getTimeOfDay()}, ${employee?.full_name?.split(' ')[0]} 👋`}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap');`}</style>

      {/* ── Layer 1: Personal Pulse ── */}
      <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: r.isMobile ? 10 : 12, marginBottom: 24 }}>
        {[
          {
            label: "Today's Status",
            val:   attStatus ? `${attStatus.icon} ${attStatus.label}` : 'Not checked in',
            sub:   todayAtt?.check_in ? new Date(todayAtt.check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : null,
            color: attStatus ? C.green : C.accent,
            bg:    attStatus ? C.greenSoft : C.accentSoft,
          },
          {
            label: 'Earned Leave Left',
            val:   String(earnedLeft),
            sub:   `${earnedUsed} used of ${earnedTotal}`,
            color: C.brand,
            bg:    C.brandLight,
          },
          {
            label: 'This Week',
            val:   weekly ? `${weekly.totalHours}h` : '—',
            sub:   weekly ? `of ${weekly.targetHours}h target` : null,
            color: C.teal,
            bg:    C.tealSoft,
          },
          {
            label: 'Pending',
            val:   String(pendingCount),
            sub:   pendingCount === 0 ? 'All clear' : `request${pendingCount > 1 ? 's' : ''} awaiting`,
            color: pendingCount > 0 ? C.amber : C.green,
            bg:    pendingCount > 0 ? C.amberSoft : C.greenSoft,
          },
        ].map(s => (
          <Card key={s.label} style={{ padding: '16px 20px', borderLeft: `3px solid ${s.color}` }}>
            <div style={{ fontSize: 10, color: C.textLight, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: "'Sora',sans-serif", marginBottom: 2 }}>{s.val}</div>
            {s.sub && <div style={{ fontSize: 10, color: C.textLight }}>{s.sub}</div>}
          </Card>
        ))}
      </div>

      {/* Weekly hours progress bar */}
      {weekly && (
        <Card style={{ padding: '14px 18px', marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>This Week</span>
            <span style={{ fontSize: 11, color: C.textMid }}>{weekly.totalHours} / {weekly.targetHours} hrs</span>
          </div>
          <div style={{ height: 5, borderRadius: 6, background: C.border, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(100, Math.round((weekly.totalHours / weekly.targetHours) * 100))}%`, background: C.brand, borderRadius: 6, transition: 'width 0.3s' }} />
          </div>
        </Card>
      )}

      {/* Probation reviews (managers only) */}
      {probationReviews.length > 0 && (
        <ProbationReviewPanel
          reviews={probationReviews}
          managerId={employee.id}
          onRefresh={() => getManagerPendingReviews(employee.id).then(setProbationReviews)}
        />
      )}

      {employee && <PerformanceManagerPanel managerId={employee.id} />}

      {/* ── Layer 2: Smart Prompts ── */}
      <div style={{ marginBottom: 28 }}>
        <SectionTitle>Your Actions</SectionTitle>
        {prompts.length === 0 ? (
          <Card style={{ padding: '16px 20px', marginTop: 10, borderLeft: `3px solid ${C.green}`, background: C.greenSoft }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.green }}>✅ Nothing needs your attention today.</div>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {prompts.map(p => (
              <Card key={p.key} style={{ padding: '12px 16px', borderLeft: `3px solid ${p.dot}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.dot, flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 13, color: C.text }}>{p.message}</div>
                  {p.link && (
                    <button onClick={() => navigate(p.link)} style={{ fontSize: 12, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>{p.linkLabel}</button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ── Layer 3: Supporting Info ── */}
      <div style={{ display: 'grid', gridTemplateColumns: r.isMobile ? '1fr' : '1fr 320px', gap: 20 }}>
        {/* Leave balances */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <SectionTitle>Leave Balances</SectionTitle>
            <button onClick={() => navigate('/leaves')} style={{ fontSize: 11, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Manage →</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: cols(r, { mobile: 2, tablet: 3, desktop: 4 }), gap: 10, marginBottom: 20 }}>
            {LEAVE_TYPES.filter(lt => !FEMALE_ONLY_LEAVES.includes(lt.id) || employee?.gender === 'female').map(lt => (
              <BalanceCard key={lt.id} lt={lt} balance={balances.find(b => b.leave_type === lt.id)} />
            ))}
          </div>

          {/* Recent leave requests */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <SectionTitle>Recent Leave Requests</SectionTitle>
            <button onClick={() => navigate('/leaves')} style={{ fontSize: 11, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>View all →</button>
          </div>
          {myRequests.length === 0 ? (
            <EmptyState icon="🏖️" title="No leave requests yet" subtitle="Apply for your first leave!" />
          ) : (
            <Card padding="0">
              {myRequests.slice(0, 5).map((req, i) => {
                const lt = LEAVE_TYPES.find(t => t.id === req.leave_type)
                return (
                  <div key={req.id} style={{ padding: '12px 16px', borderBottom: i < Math.min(myRequests.length, 5) - 1 ? `1px solid ${C.border}` : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <Tag label={lt?.label || req.leave_type} color={lt?.color || C.brand} />
                        <span style={{ fontSize: 11, color: C.textLight }}>{req.from_date} → {req.to_date}</span>
                      </div>
                      <div style={{ fontSize: 11, color: C.textMid }}>{req.reason}</div>
                    </div>
                    <Badge status={req.status} />
                  </div>
                )
              })}
            </Card>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Upcoming holidays */}
          <div>
            <SectionTitle>Upcoming Holidays</SectionTitle>
            {upcomingHols.length === 0 ? (
              <Card style={{ padding: '14px 16px', marginTop: 8 }}><div style={{ fontSize: 12, color: C.textLight }}>No holidays in the next 7 days.</div></Card>
            ) : (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {upcomingHols.map(h => {
                  const d = daysUntil(h.date)
                  return (
                    <Card key={h.id} style={{ padding: '10px 14px', borderLeft: `3px solid ${C.teal}` }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{h.name}</div>
                      <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>
                        {new Date(h.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                        {' · '}
                        <span style={{ color: d === 0 ? C.accent : C.teal, fontWeight: 600 }}>
                          {d === 0 ? 'Today' : `In ${d} day${d !== 1 ? 's' : ''}`}
                        </span>
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>

          {/* Announcements */}
          <div>
            <SectionTitle>Announcements</SectionTitle>
            {pinnedAnn.length === 0 ? (
              <Card style={{ padding: '14px 16px', marginTop: 8 }}><div style={{ fontSize: 12, color: C.textLight }}>No announcements yet.</div></Card>
            ) : (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pinnedAnn.map(a => (
                  <Card key={a.id} style={{ padding: '10px 14px', borderLeft: `3px solid ${a.pinned ? C.accent : C.brand}` }}>
                    {a.pinned && <div style={{ fontSize: 9, color: C.accent, fontWeight: 700, letterSpacing: 1, marginBottom: 2 }}>📌 PINNED</div>}
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{a.title}</div>
                    <div style={{ fontSize: 11, color: C.textMid, marginTop: 2 }}>{a.body}</div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming team leave */}
          {upcomingLeaves.length > 0 && (
            <div>
              <SectionTitle>Team on Leave</SectionTitle>
              <Card style={{ padding: '14px 16px', marginTop: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {upcomingLeaves.slice(0, 5).map(l => (
                    <div key={`${l.employee_id}-${l.from_date}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar initials={l.avatar_initials || '??'} size={26} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{l.full_name}</div>
                        <div style={{ fontSize: 10, color: C.textLight }}>{l.from_date}{l.from_date !== l.to_date ? ` – ${l.to_date}` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
