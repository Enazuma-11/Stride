import { C, FONTS } from '../../lib/constants'
import { useResponsive } from '../../lib/responsive'

export function GlobalFonts() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Inter', sans-serif; background: #f5f7fa; color: #1a1a2e; -webkit-font-smoothing: antialiased; }
      @keyframes spin    { to { transform: rotate(360deg); } }
      @keyframes fadeUp  { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
      @keyframes slideUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
      @keyframes fadeIn  { from { opacity:0; } to { opacity:1; } }
    `}</style>
  )
}

export function GradientBorder({ children, style = {}, radius = 16 }) {
  return (
    <div style={{ background: C.gradientH, padding: '2px', borderRadius: radius + 2, ...style }}>
      <div style={{ background: C.surface, borderRadius: radius, overflow: 'hidden' }}>{children}</div>
    </div>
  )
}

export function Card({ children, style = {}, padding = '20px 24px', onClick }) {
  return (
    <div onClick={onClick} style={{
      background: C.surface, borderRadius: 14,
      border: `1px solid ${C.border}`, boxShadow: C.shadow,
      padding, cursor: onClick ? 'pointer' : 'default', ...style,
    }}>
      {children}
    </div>
  )
}

export function Avatar({ initials = '??', size = 36, color, src }) {
  if (src) return <img src={src} alt={initials} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `2px solid ${C.border}` }} />
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: C.gradientH,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 700, color: C.text,
      fontFamily: FONTS.display, flexShrink: 0, letterSpacing: -0.5,
    }}>
      {initials}
    </div>
  )
}

export function Badge({ status }) {
  const map = {
    pending:  { label: 'Pending',  color: '#d97706', bg: '#fef3c7', border: '#fbbf24'  },
    approved: { label: 'Approved', color: '#00b894', bg: 'transparent', border: '#00b894' },
    rejected: { label: 'Rejected', color: '#ef4444', bg: 'transparent', border: '#ef4444' },
    active:   { label: 'Active',   color: '#00b894', bg: '#e0fff2',  border: '#00b894' },
    inactive: { label: 'Inactive', color: C.textLight, bg: C.surfaceAlt, border: C.border },
  }
  const s = map[status] || { label: status, color: C.brand, bg: C.brandLight, border: C.brand }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 700, border: `1.5px solid ${s.border}`, fontFamily: FONTS.body,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.color }} />
      {s.label}
    </span>
  )
}

export function Tag({ label, color = C.brand }) {
  return (
    <span style={{
      background: `${color}12`, color, padding: '3px 12px', borderRadius: 20,
      fontSize: 11, fontWeight: 600, border: `1px solid ${color}30`, fontFamily: FONTS.body,
    }}>
      {label}
    </span>
  )
}

export function Button({ children, onClick, variant = 'primary', size = 'md', disabled = false, style = {}, fullWidth = false }) {
  const sizes = { sm: { padding: '7px 14px', fontSize: 12, borderRadius: 8 }, md: { padding: '10px 20px', fontSize: 13, borderRadius: 10 }, lg: { padding: '13px 28px', fontSize: 14, borderRadius: 12 } }
  const variants = {
    primary:   { background: disabled ? C.border : C.brand, color: disabled ? C.textLight : '#fff', border: 'none', boxShadow: disabled ? 'none' : '0 2px 8px rgba(18,109,173,0.3)' },
    brand:     { background: disabled ? C.border : C.brand, color: disabled ? C.textLight : '#fff', border: 'none', boxShadow: 'none' },
    outline:   { background: 'transparent', color: disabled ? C.textLight : C.brand, border: `1.5px solid ${disabled ? C.border : C.brand}`, boxShadow: 'none' },
    teal:      { background: 'transparent', color: disabled ? C.textLight : C.teal, border: `1.5px solid ${disabled ? C.border : C.teal}`, boxShadow: 'none' },
    ghost:     { background: 'transparent', color: disabled ? C.textLight : C.textMid, border: 'none', boxShadow: 'none' },
    danger:    { background: disabled ? C.border : '#ef4444', color: '#fff', border: 'none', boxShadow: 'none' },
    secondary: { background: disabled ? C.border : C.purple, color: '#fff', border: 'none', boxShadow: 'none' },
  }
  const v = variants[variant] || variants.primary
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...sizes[size], ...v, fontFamily: FONTS.display, fontWeight: 700,
      cursor: disabled ? 'not-allowed' : 'pointer', transition: 'all 0.15s ease',
      width: fullWidth ? '100%' : 'auto',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      ...style,
    }}>
      {children}
    </button>
  )
}

export function Input({ label, value, onChange, placeholder, type = 'text', required, error, style = {} }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {label && <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, fontFamily: FONTS.body }}>{label}{required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}</label>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${error ? '#ef4444' : C.border}`, background: C.surface, fontSize: 13, color: C.text, fontFamily: FONTS.body, outline: 'none', width: '100%', transition: 'border-color 0.15s' }}
        onFocus={e => e.target.style.borderColor = C.teal}
        onBlur={e => e.target.style.borderColor = error ? '#ef4444' : C.border}
      />
      {error && <div style={{ fontSize: 11, color: '#ef4444' }}>{error}</div>}
    </div>
  )
}

export function Select({ label, value, onChange, options = [], required, style = {} }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {label && <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, fontFamily: FONTS.body }}>{label}{required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}</label>}
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${C.border}`, background: C.surface, fontSize: 13, color: C.text, fontFamily: FONTS.body, outline: 'none', width: '100%', cursor: 'pointer' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

export function Textarea({ label, value, onChange, placeholder, rows = 3, style = {} }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {label && <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, fontFamily: FONTS.body }}>{label}</label>}
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
        style={{ padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${C.border}`, background: C.surface, fontSize: 13, color: C.text, fontFamily: FONTS.body, outline: 'none', resize: 'vertical', width: '100%' }} />
    </div>
  )
}

export function Alert({ type = 'info', message }) {
  const s = { success: { bg: '#e0fff2', color: '#00b894', border: '#00b89440', icon: '✅' }, error: { bg: '#fef2f2', color: '#ef4444', border: '#ef444440', icon: '⚠️' }, warning: { bg: '#fef3c7', color: '#d97706', border: '#fbbf2440', icon: '⚠️' }, info: { bg: C.brandLight, color: C.brand, border: `${C.brand}40`, icon: 'ℹ️' } }[type] || { bg: C.brandLight, color: C.brand, border: `${C.brand}40`, icon: 'ℹ️' }
  return (
    <div style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: s.color, fontFamily: FONTS.body }}>
      <span>{s.icon}</span><span>{message}</span>
    </div>
  )
}

export function Spinner({ size = 24, color = C.teal }) {
  return <div style={{ width: size, height: size, border: `2.5px solid ${color}30`, borderTop: `2.5px solid ${color}`, borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
}

export function EmptyState({ icon = '📭', title, subtitle }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: C.textLight, fontFamily: FONTS.body }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.textMid, marginBottom: 6 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12 }}>{subtitle}</div>}
    </div>
  )
}

export function SectionTitle({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, letterSpacing: 1.2, textTransform: 'uppercase', fontFamily: FONTS.body }}>{children}</div>
      {action}
    </div>
  )
}

export function ProgressBar({ value, max, color = C.brand, height = 4 }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div style={{ height, background: C.border, borderRadius: height, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: height, transition: 'width 0.4s ease' }} />
    </div>
  )
}

export function ResponsiveTable({ columns, rows, keyField = 'id' }) {
  const r = useResponsive()
  if (r.isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map(row => (
          <Card key={row[keyField]}>
            {columns.filter(c => !c.mobileHide).map(col => (
              <div key={col.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 11, color: C.textLight, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{col.label}</span>
                <span style={{ fontSize: 13, color: C.text }}>{col.render ? col.render(row) : row[col.key]}</span>
              </div>
            ))}
          </Card>
        ))}
      </div>
    )
  }
  return (
    <div style={{ borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: C.surfaceAlt }}>
            {columns.map(col => <th key={col.key} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: C.textLight, letterSpacing: 0.8, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`, fontFamily: FONTS.body, whiteSpace: 'nowrap' }}>{col.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row[keyField]} style={{ background: i % 2 === 0 ? C.surface : C.surfaceAlt }}>
              {columns.map(col => <td key={col.key} style={{ padding: '12px 16px', fontFamily: FONTS.body, borderBottom: `1px solid ${C.border}` }}>{col.render ? col.render(row) : row[col.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
