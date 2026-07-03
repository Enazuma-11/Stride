import { useEffect, useState } from 'react'
import { Card, Button, Spinner, Alert, Avatar, EmptyState } from './ui'
import { C, FONTS } from '../lib/constants'
import { todayISO } from '../lib/api.attendance'
import {
  getOptinWindow, getOptionalHolidaysForYear, getMyHolidayOptins,
  saveMyHolidayOptins, getHolidayOptinRoster, hasSubmittedForWindow,
} from '../lib/api.holidayOptins'

function RosterRow({ holidayId, expanded }) {
  const [roster, setRoster] = useState(null)

  useEffect(() => {
    if (expanded && roster === null) {
      getHolidayOptinRoster(holidayId).then(setRoster)
    }
  }, [expanded, holidayId, roster])

  if (!expanded) return null
  return (
    <div style={{ padding: '8px 0 0 0', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {roster === null ? (
        <Spinner size={14} />
      ) : roster.length === 0 ? (
        <span style={{ fontSize: 11, color: C.textLight }}>No one else has opted in yet.</span>
      ) : (
        roster.map(r => (
          <div key={r.employee_id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Avatar initials={r.avatar_initials || '??'} size={20} />
            <span style={{ fontSize: 11, color: C.textMid }}>{r.full_name}</span>
          </div>
        ))
      )}
    </div>
  )
}

export default function HolidayOptinPanel({ employeeId }) {
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [window_, setWindow]    = useState(null)
  const [holidays, setHolidays] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [expandedId, setExpandedId] = useState(null)
  const [alreadySubmitted, setAlreadySubmitted] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const win = getOptinWindow(new Date())
      setWindow(win)

      const year = Number(todayISO().split('-')[0])
      const [yearHolidays, myOptins] = await Promise.all([
        getOptionalHolidaysForYear(year),
        getMyHolidayOptins(employeeId, year),
      ])
      setHolidays(yearHolidays)
      setSelected(new Set(myOptins))

      if (win.isOpen) {
        const submitted = await hasSubmittedForWindow(employeeId, win.label)
        setAlreadySubmitted(submitted)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [employeeId])

  function toggle(holidayId) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(holidayId)) next.delete(holidayId)
      else next.add(holidayId)
      return next
    })
  }

  const editableHolidays = window_?.isOpen
    ? holidays.filter(h => !window_.editableFromDate || h.date >= window_.editableFromDate)
    : []
  const editableIds = editableHolidays.map(h => h.id)

  async function handleSave() {
    setSaving(true); setError('')
    try {
      await saveMyHolidayOptins(
        employeeId,
        editableIds,
        editableIds.filter(id => selected.has(id))
      )
      setAlreadySubmitted(true)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={28} /></div>

  return (
    <Card padding="0">
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>
          🎉 Holiday Calendar
        </div>
        {window_?.isOpen ? (
          <div style={{ fontSize: 12, color: C.textLight, marginTop: 4 }}>
            {window_.editableFromDate
              ? `Window open through ${window_.closesOn} — you can revise picks from ${window_.editableFromDate} onward.`
              : `Window open through ${window_.closesOn} — pick your optional holidays for the year.`}
            {alreadySubmitted && ' You’ve already confirmed your picks — you can still make changes until the window closes.'}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: C.textLight, marginTop: 4 }}>
            Picks are locked outside the submission window. Next window opens {window_?.nextOpensOn}.
          </div>
        )}
      </div>

      {error && <div style={{ padding: '12px 24px 0' }}><Alert type="error" message={error} /></div>}

      {holidays.length === 0 ? (
        <EmptyState icon="🎉" title="No optional holidays published for this year yet" />
      ) : (
        <div>
          {holidays.map(h => {
            const isEditable = window_?.isOpen && editableIds.includes(h.id)
            return (
              <div key={h.id} style={{ padding: '14px 24px', borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={selected.has(h.id)}
                    disabled={!isEditable}
                    onChange={() => toggle(h.id)}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{h.name}</div>
                    <div style={{ fontSize: 11, color: C.textLight }}>{h.date}</div>
                  </div>
                  <button
                    onClick={() => setExpandedId(id => id === h.id ? null : h.id)}
                    style={{ background: 'none', border: 'none', color: C.brand, fontSize: 11, cursor: 'pointer' }}
                  >
                    {expandedId === h.id ? 'Hide' : 'Who else?'}
                  </button>
                </div>
                <RosterRow holidayId={h.id} expanded={expandedId === h.id} />
              </div>
            )
          })}
        </div>
      )}

      {window_?.isOpen && holidays.length > 0 && (
        <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save My Picks'}
          </Button>
        </div>
      )}
    </Card>
  )
}
