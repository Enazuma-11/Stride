import { useState } from 'react'
import { C, FONTS } from '../lib/constants'

const DAYS   = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function padded(n) { return String(n).padStart(2, '0') }

function toISO(date) {
  return `${date.getFullYear()}-${padded(date.getMonth()+1)}-${padded(date.getDate())}`
}

const TODAY = toISO(new Date())

export default function DateRangePicker({
  fromDate = '',
  toDate   = '',
  isHalfDay = false,
  onChange,
  label,
}) {
  const initDate = fromDate ? new Date(fromDate + 'T00:00:00') : new Date()
  const [viewYear,  setViewYear]  = useState(initDate.getFullYear())
  const [viewMonth, setViewMonth] = useState(initDate.getMonth())
  const [hover,     setHover]     = useState('')

  // Derive phase from props — no internal phase state
  // If fromDate is set and toDate is not → user needs to pick end date
  const awaitingEnd = !isHalfDay && fromDate !== '' && toDate === ''

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  function handleDayClick(iso) {
    if (iso < TODAY) return

    if (isHalfDay) {
      onChange({ fromDate: iso, toDate: iso })
      return
    }

    if (!awaitingEnd) {
      // First click — set start, clear end
      onChange({ fromDate: iso, toDate: '' })
    } else {
      // Second click — set end
      if (iso < fromDate) {
        // Clicked before start — restart with this as new start
        onChange({ fromDate: iso, toDate: '' })
      } else if (iso === fromDate) {
        // Same day — single day leave
        onChange({ fromDate: iso, toDate: iso })
      } else {
        // Valid end date
        onChange({ fromDate, toDate: iso })
      }
    }
    setHover('')
  }

  function isInRange(iso) {
    const end = awaitingEnd ? (hover || '') : toDate
    if (!fromDate || !end) return false
    return iso > fromDate && iso < end
  }

  // Build calendar grid
  const daysInMonth  = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay()
  const cells = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${viewYear}-${padded(viewMonth+1)}-${padded(d)}`)
  }

  const rangeLabel = isHalfDay
    ? (fromDate ? `${fromDate} · Half Day` : '')
    : fromDate && toDate
      ? fromDate === toDate ? fromDate : `${fromDate} → ${toDate}`
      : fromDate ? `${fromDate} → pick end date` : ''

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid }}>
          {label || '📅 Select Dates'} <span style={{ color: '#ef4444' }}>*</span>
        </label>
        {rangeLabel && (
          <span style={{ fontSize: 11, color: C.brand, fontWeight: 700 }}>{rangeLabel}</span>
        )}
      </div>
      <div style={{ fontSize: 11, color: awaitingEnd ? C.brand : C.textLight, marginBottom: 8, fontWeight: awaitingEnd ? 600 : 400 }}>
        {isHalfDay ? 'Click a date' : awaitingEnd ? '⬇ Now click the end date' : 'Click to set start date'}
      </div>

      {/* Calendar box */}
      <div style={{ border: `1.5px solid ${awaitingEnd ? C.brand : C.border}`, borderRadius: 14, overflow: 'hidden', background: C.surface, transition: 'border-color 0.2s' }}>

        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: C.bg, borderBottom: `1px solid ${C.border}` }}>
          <button type="button" onClick={prevMonth}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: C.textMid, padding: '0 4px', lineHeight: 1 }}>
            ‹
          </button>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>
            {MONTHS[viewMonth]} {viewYear}
          </span>
          <button type="button" onClick={nextMonth}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: C.textMid, padding: '0 4px', lineHeight: 1 }}>
            ›
          </button>
        </div>

        {/* Day labels */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', padding: '8px 12px 2px' }}>
          {DAYS.map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: C.textLight, padding: '2px 0' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', padding: '0 12px 12px', gap: 1 }}>
          {cells.map((iso, i) => {
            if (!iso) return <div key={`e${i}`} />

            const isPast     = iso < TODAY
            const isToday    = iso === TODAY
            const isStart    = iso === fromDate
            const isEnd      = iso === toDate
            const isSelected = isStart || isEnd
            const inRange    = isInRange(iso)
            const isHov      = awaitingEnd && !toDate && iso === hover && iso > fromDate

            let bg = 'transparent'
            let fg = isPast ? `${C.textLight}60` : isToday ? C.brand : C.text
            let fw = isToday ? 700 : 400
            let br = '8px'

            if (isSelected) {
              bg = C.brand; fg = '#fff'; fw = 700
              br = (isStart && toDate && toDate !== fromDate) ? '8px 0 0 8px'
                 : (isEnd   && toDate !== fromDate)          ? '0 8px 8px 0'
                 : '8px'
            } else if (inRange) {
              bg = `${C.brand}18`; br = '0'
            } else if (isHov) {
              bg = `${C.brand}12`; br = '0 8px 8px 0'
            }

            return (
              <div
                key={iso}
                onClick={() => !isPast && handleDayClick(iso)}
                onMouseEnter={() => awaitingEnd && !isPast && setHover(iso)}
                onMouseLeave={() => setHover('')}
                style={{
                  textAlign: 'center', padding: '8px 2px',
                  borderRadius: br, background: bg, color: fg,
                  fontSize: 13, fontWeight: fw,
                  cursor: isPast ? 'default' : 'pointer',
                  transition: 'background 0.1s',
                  boxSizing: 'border-box',
                  ...(isToday && !isSelected ? { outline: `1.5px solid ${C.brand}`, outlineOffset: '-1px' } : {}),
                }}
              >
                {parseInt(iso.split('-')[2], 10)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
