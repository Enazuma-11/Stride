import { useState } from 'react'
import { C, FONTS } from '../lib/constants'

const DAYS   = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function toISO(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function todayISO() {
  return toISO(new Date())
}

/**
 * DateRangePicker
 * Props:
 *   fromDate  {string} — ISO date string e.g. '2026-07-01'
 *   toDate    {string} — ISO date string
 *   isHalfDay {bool}   — if true, single date selection only
 *   onChange  {fn}     — called with ({ fromDate, toDate })
 *   label     {string} — optional label override
 */
export default function DateRangePicker({ fromDate = '', toDate = '', isHalfDay = false, onChange, label }) {
  const now  = new Date()
  const init = fromDate ? new Date(fromDate + 'T00:00:00') : now

  const [year,  setYear]  = useState(init.getFullYear())
  const [month, setMonth] = useState(init.getMonth())
  const [hover, setHover] = useState('')

  // Which click are we on — 'start' or 'end'
  const [phase, setPhase] = useState(fromDate && !toDate ? 'end' : 'start')

  const today = todayISO()

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  function handleClick(iso) {
    if (iso < today) return // block past dates

    if (isHalfDay) {
      onChange({ fromDate: iso, toDate: iso })
      return
    }

    if (phase === 'start') {
      onChange({ fromDate: iso, toDate: '' })
      setPhase('end')
      setHover('')
    } else {
      // end phase
      if (iso < fromDate) {
        // clicked before start — restart
        onChange({ fromDate: iso, toDate: '' })
        setPhase('end')
        setHover('')
      } else if (iso === fromDate) {
        // same day — treat as single day leave
        onChange({ fromDate: iso, toDate: iso })
        setPhase('start')
        setHover('')
      } else {
        onChange({ fromDate, toDate: iso })
        setPhase('start')
        setHover('')
      }
    }
  }

  function isInRange(iso) {
    if (!fromDate) return false
    const end = toDate || hover
    if (!end || end <= fromDate) return false
    return iso > fromDate && iso < end
  }

  // Build calendar grid
  const daysInMonth  = new Date(year, month + 1, 0).getDate()
  const firstWeekday = new Date(year, month, 1).getDay()
  const cells = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push(iso)
  }

  // Display label for selected range
  const rangeLabel = isHalfDay
    ? (fromDate ? `${fromDate} · Half Day` : '')
    : fromDate && toDate
      ? fromDate === toDate ? fromDate : `${fromDate} → ${toDate}`
      : fromDate
        ? `${fromDate} → select end date`
        : ''

  const instruction = isHalfDay
    ? 'Select the date'
    : phase === 'start' || !fromDate
      ? 'Click to select start date'
      : 'Click to select end date'

  return (
    <div>
      {/* Label */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid }}>
          {label || '📅 Select Dates'} <span style={{ color: '#ef4444' }}>*</span>
        </label>
        {rangeLabel && (
          <span style={{ fontSize: 11, color: C.brand, fontWeight: 700 }}>{rangeLabel}</span>
        )}
      </div>

      {/* Instruction */}
      <div style={{ fontSize: 11, color: C.textLight, marginBottom: 8 }}>
        {instruction}
      </div>

      {/* Calendar */}
      <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', background: C.surface }}>

        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: C.bg, borderBottom: `1px solid ${C.border}` }}>
          <button onClick={prevMonth} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: C.textMid, lineHeight: 1, padding: '0 6px' }}>‹</button>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>
            {MONTHS[month]} {year}
          </span>
          <button onClick={nextMonth} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: C.textMid, lineHeight: 1, padding: '0 6px' }}>›</button>
        </div>

        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '8px 10px 4px' }}>
          {DAYS.map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: C.textLight }}>
              {d}
            </div>
          ))}
        </div>

        {/* Date cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '0 10px 10px', gap: 1 }}>
          {cells.map((iso, i) => {
            if (!iso) return <div key={i} />

            const isPast     = iso < today
            const isToday    = iso === today
            const isStart    = iso === fromDate
            const isEnd      = iso === toDate
            const isSelected = isStart || isEnd
            const inRange    = isInRange(iso)
            const isHovered  = !toDate && fromDate && iso === hover && iso > fromDate

            // Build style
            let bg = 'transparent'
            let cl = isPast ? '#ccc' : isToday ? C.brand : C.text
            let fw = isToday ? 700 : 400
            let br = '8px'

            if (isSelected) {
              bg = C.brand
              cl = '#fff'
              fw = 700
              br = isStart && toDate && toDate !== fromDate ? '8px 0 0 8px'
                : isEnd   && toDate !== fromDate            ? '0 8px 8px 0'
                : '8px'
            } else if (inRange) {
              bg = `${C.brand}20`
              br = '0'
            } else if (isHovered) {
              bg = `${C.brand}15`
              br = '0 8px 8px 0'
            }

            return (
              <div
                key={iso}
                onClick={() => handleClick(iso)}
                onMouseEnter={() => !isPast && phase === 'end' && fromDate && setHover(iso)}
                onMouseLeave={() => setHover('')}
                style={{
                  textAlign: 'center',
                  padding: '7px 2px',
                  borderRadius: br,
                  background: bg,
                  color: cl,
                  fontSize: 13,
                  fontWeight: fw,
                  cursor: isPast ? 'default' : 'pointer',
                  transition: 'background 0.1s',
                  outline: isToday && !isSelected ? `1.5px solid ${C.brand}` : 'none',
                  outlineOffset: '-1px',
                }}
              >
                {new Date(iso + 'T00:00:00').getDate()}
              </div>
            )
          })}
        </div>

        {/* Footer hint */}
        {!isHalfDay && fromDate && !toDate && (
          <div style={{ padding: '6px 14px 10px', fontSize: 11, color: C.brand, textAlign: 'center', borderTop: `1px solid ${C.border}` }}>
            Start: <strong>{fromDate}</strong> — now click the end date
          </div>
        )}
      </div>
    </div>
  )
}
