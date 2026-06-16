import { useRef, useState, useEffect } from 'react'
import { C, FONTS } from '../lib/constants'
import { Button, Spinner } from './ui'

// ── QR Code generator (pure JS, no library needed) ───────────────────────────
// Uses Google Charts API for QR generation
function QRCode({ value, size = 80 }) {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&bgcolor=ffffff&color=1a0f2e&qzone=1`
  return (
    <img
      src={url}
      alt="QR Code"
      style={{ width: size, height: size, borderRadius: 6, display: 'block' }}
      crossOrigin="anonymous"
    />
  )
}

// ── The actual card design ────────────────────────────────────────────────────
function ICardDesign({ employee, forCapture = false }) {
  const profileUrl = `https://sportech-portal.vercel.app/profile`
  const isIntern = employee.employee_type === 'intern'
  const accentColor = isIntern ? '#7acc1e' : '#126dad'

  return (
    <div
      id="icard-capture"
      style={{
        width: 340,
        background: '#fff',
        borderRadius: forCapture ? 0 : 16,
        overflow: 'hidden',
        boxShadow: forCapture ? 'none' : '0 8px 40px rgba(26,26,46,0.15)',
        fontFamily: FONTS.body,
        border: forCapture ? 'none' : `1px solid ${C.border}`,
      }}
    >
      {/* Header band */}
      <div style={{
        background: 'linear-gradient(135deg, #1a0f2e 0%, #126dad 60%, #00d4aa 100%)',
        padding: '20px 20px 40px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Orb effects */}
        <div style={{ position: 'absolute', width: 120, height: 120, borderRadius: '50%', top: -30, right: -30, background: 'radial-gradient(circle,rgba(155,117,241,0.4),transparent)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', width: 100, height: 100, borderRadius: '50%', bottom: 0, left: 20, background: 'radial-gradient(circle,rgba(0,212,170,0.3),transparent)', pointerEvents: 'none' }} />

        {/* Company row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, position: 'relative', zIndex: 1 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
            <img src="/logo.png" style={{ width: 26, height: 26, objectFit: 'contain' }} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', fontFamily: FONTS.display, lineHeight: 1 }}>SporTech Innovation Lab</div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.6)', letterSpacing: 1, textTransform: 'uppercase' }}>Pvt. Ltd.</div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: 0.8,
              color: isIntern ? '#1a0f2e' : '#fff',
              background: isIntern ? '#a4ff3d' : 'rgba(255,255,255,0.2)',
              padding: '3px 8px', borderRadius: 20,
              border: isIntern ? 'none' : '1px solid rgba(255,255,255,0.3)',
            }}>
              {isIntern ? 'INTERN' : 'EMPLOYEE'}
            </span>
          </div>
        </div>

        {/* Photo */}
        <div style={{ display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            border: '3px solid rgba(255,255,255,0.9)',
            overflow: 'hidden',
            background: 'linear-gradient(135deg, #9b75f1, #126dad)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            flexShrink: 0,
          }}>
            {employee.profile_photo_url
              ? <img src={employee.profile_photo_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} crossOrigin="anonymous" />
              : <span style={{ fontSize: 28, fontWeight: 800, color: '#fff', fontFamily: FONTS.display }}>{employee.avatar_initials || '??'}</span>
            }
          </div>
        </div>
      </div>

      {/* White body */}
      <div style={{ padding: '0 20px 20px', marginTop: -24, position: 'relative' }}>
        {/* Name card float */}
        <div style={{
          background: '#fff',
          borderRadius: 12,
          padding: '14px 16px',
          boxShadow: '0 4px 20px rgba(26,26,46,0.10)',
          textAlign: 'center',
          marginBottom: 14,
          border: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text, fontFamily: FONTS.display, marginBottom: 2 }}>
            {employee.full_name}
          </div>
          <div style={{ fontSize: 11, color: accentColor, fontWeight: 600, marginBottom: 1 }}>
            {employee.role}
          </div>
          <div style={{ fontSize: 10, color: C.textLight }}>
            {employee.department}
          </div>
        </div>

        {/* Employee ID */}
        <div style={{
          background: `${accentColor}10`,
          border: `1.5px solid ${accentColor}30`,
          borderRadius: 10, padding: '10px 14px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 14,
        }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.textLight, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2 }}>Employee ID</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: accentColor, fontFamily: FONTS.mono, letterSpacing: 1 }}>
              {employee.employee_code}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.textLight, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2 }}>Joined</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.text, fontFamily: FONTS.mono }}>
              {employee.join_date
                ? new Date(employee.join_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                : '—'}
            </div>
          </div>
        </div>

        {/* QR + info row */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
          <div style={{ flexShrink: 0 }}>
            <QRCode value={profileUrl} size={72} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, color: C.textLight, fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 }}>SCAN TO VERIFY</div>
            <div style={{ fontSize: 10, color: C.textMid, lineHeight: 1.5 }}>
              Scan QR code to verify employee identity on the Stride portal.
            </div>
            <div style={{ marginTop: 6, fontSize: 9, color: accentColor, fontFamily: FONTS.mono, wordBreak: 'break-all' }}>
              sportech-portal.vercel.app
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          borderTop: `1px solid ${C.border}`,
          paddingTop: 12,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontSize: 9, color: C.textLight, lineHeight: 1.5 }}>
            This card is property of<br />
            <span style={{ fontWeight: 700, color: C.text }}>SporTech Innovation Lab Pvt. Ltd.</span>
          </div>
          <div style={{
            fontSize: 8, color: '#fff',
            background: accentColor,
            padding: '3px 8px', borderRadius: 6, fontWeight: 700, letterSpacing: 0.5,
          }}>
            STRIDE
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main exported component ───────────────────────────────────────────────────
export default function EmployeeICard({ employee }) {
  const [downloading, setDownloading] = useState(false)
  const [show, setShow] = useState(false)

  async function downloadCard() {
    setDownloading(true)
    try {
      // Use html2canvas via CDN
      if (!window.html2canvas) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script')
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
          script.onload = resolve
          script.onerror = reject
          document.head.appendChild(script)
        })
      }

      const element = document.getElementById('icard-capture')
      const canvas = await window.html2canvas(element, {
        scale: 3, // High resolution for printing
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
      })

      const link = document.createElement('a')
      link.download = `${employee.employee_code}-${employee.full_name.replace(/\s+/g, '-')}-ICard.png`
      link.href = canvas.toDataURL('image/png', 1.0)
      link.click()
    } catch (e) {
      console.error('Download failed:', e)
      alert('Download failed. Please try again.')
    } finally {
      setDownloading(false)
    }
  }

  if (!show) {
    return (
      <button
        onClick={() => setShow(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 20px', borderRadius: 10, border: `1.5px solid ${C.border}`,
          background: C.surface, color: C.text,
          fontSize: 13, fontWeight: 600, fontFamily: FONTS.display,
          cursor: 'pointer', transition: 'all 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = C.brand; e.currentTarget.style.color = C.brand }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.text }}
      >
        🪪 View I-Card
      </button>
    )
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(26,26,46,0.6)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <ICardDesign employee={employee} />

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={downloadCard}
            disabled={downloading}
            style={{
              padding: '11px 24px', borderRadius: 10, border: 'none',
              background: downloading ? C.border : C.brand,
              color: downloading ? C.textLight : '#fff',
              fontSize: 13, fontWeight: 700, fontFamily: FONTS.display,
              cursor: downloading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            {downloading
              ? <><Spinner size={16} color="#fff" /> Generating…</>
              : '⬇ Download I-Card'}
          </button>
          <button
            onClick={() => setShow(false)}
            style={{
              padding: '11px 20px', borderRadius: 10,
              border: '1.5px solid rgba(255,255,255,0.2)',
              background: 'transparent', color: '#fff',
              fontSize: 13, fontWeight: 600, fontFamily: FONTS.display,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>
          Downloads as high-resolution PNG — ready for printing
        </div>
      </div>
    </div>
  )
}
