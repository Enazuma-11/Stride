import { C } from '../../lib/constants'

export function Card({ children, style = {}, padding = '24px' }) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      boxShadow: C.shadow,
      padding,
      ...style,
    }}>
      {children}
    </div>
  )
}

export function Avatar({ initials = '??', size = 36, color = C.brand }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.33, fontWeight: 700,
      fontFamily: "'Sora', sans-serif",
      flexShrink: 0, userSelect: 'none',
    }}>
      {initials}
    </div>
  )
}

const BADGE_MAP = {
  pending:  { bg: C.amberSoft, color: C.amber,  label: 'Pending'  },
  approved: { bg: C.greenSoft, color: C.green,  label: 'Approved' },
  rejected: { bg: C.accentSoft,color: C.accent, label: 'Rejected' },
}

export function Badge({ status }) {
  const s = BADGE_MAP[status] || BADGE_MAP.pending
  return (
    <span style={{
      background: s.bg, color: s.color,
      fontSize: 11, fontWeight: 600,
      padding: '3px 10px', borderRadius: 20,
      letterSpacing: 0.3, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

export function Tag({ label, color }) {
  return (
    <span style={{
      background: color + '18', color,
      fontSize: 11, fontWeight: 600,
      padding: '3px 10px', borderRadius: 20,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

export function Button({ children, onClick, variant = 'primary', size = 'md', disabled = false, style = {} }) {
  const sizes = { sm: '7px 14px', md: '10px 22px', lg: '13px 30px' }
  const variants = {
    primary:  { background: C.brand,  color: '#fff', border: 'none', shadow: `0 4px 12px ${C.brand}40` },
    danger:   { background: C.accent, color: '#fff', border: 'none', shadow: `0 4px 12px ${C.accent}40` },
    ghost:    { background: 'transparent', color: C.accent, border: `1.5px solid ${C.border}`, shadow: 'none' },
    outline:  { background: 'transparent', color: C.brand,  border: `1.5px solid ${C.brand}`, shadow: 'none' },
    success:  { background: C.green,  color: '#fff', border: 'none', shadow: `0 4px 12px ${C.green}40` },
  }
  const v = variants[variant] || variants.primary
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: sizes[size],
        borderRadius: 8,
        border: v.border,
        background: disabled ? C.border : v.background,
        color: disabled ? C.textLight : v.color,
        boxShadow: disabled ? 'none' : v.shadow,
        fontSize: size === 'sm' ? 12 : 13,
        fontWeight: 700,
        fontFamily: "'Sora', sans-serif",
        cursor: disabled ? 'not-allowed' : 'pointer',
        letterSpacing: 0.2,
        transition: 'opacity 0.15s',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

export function Spinner({ size = 24 }) {
  return (
    <div style={{
      width: size, height: size,
      border: `2px solid ${C.border}`,
      borderTop: `2px solid ${C.brand}`,
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
    }} />
  )
}

export function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700,
      letterSpacing: 2, textTransform: 'uppercase',
      color: C.textLight, marginBottom: 14,
    }}>
      {children}
    </div>
  )
}

export function EmptyState({ icon = '📭', title, subtitle }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.textMid, fontFamily: "'Sora', sans-serif" }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13, color: C.textLight, marginTop: 6 }}>{subtitle}</div>}
    </div>
  )
}

export function Input({ label, type = 'text', value, onChange, placeholder, required }) {
  return (
    <div>
      {label && (
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 8 }}>
          {label}{required && <span style={{ color: C.accent }}> *</span>}
        </label>
      )}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        style={{
          width: '100%', padding: '10px 14px', borderRadius: 8,
          border: `1.5px solid ${C.border}`, background: C.surfaceAlt,
          fontSize: 13, color: C.text, boxSizing: 'border-box',
          fontFamily: "'DM Sans', sans-serif",
        }}
      />
    </div>
  )
}

export function Select({ label, value, onChange, options, required }) {
  return (
    <div>
      {label && (
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 8 }}>
          {label}{required && <span style={{ color: C.accent }}> *</span>}
        </label>
      )}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        style={{
          width: '100%', padding: '10px 14px', borderRadius: 8,
          border: `1.5px solid ${C.border}`, background: C.surfaceAlt,
          fontSize: 13, color: C.text,
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

export function Textarea({ label, value, onChange, placeholder, rows = 3, required }) {
  return (
    <div>
      {label && (
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 8 }}>
          {label}{required && <span style={{ color: C.accent }}> *</span>}
        </label>
      )}
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        required={required}
        style={{
          width: '100%', padding: '10px 14px', borderRadius: 8,
          border: `1.5px solid ${C.border}`, background: C.surfaceAlt,
          fontSize: 13, color: C.text, resize: 'vertical', boxSizing: 'border-box',
          fontFamily: "'DM Sans', sans-serif",
        }}
      />
    </div>
  )
}

export function Alert({ type = 'error', message }) {
  const map = {
    error:   { bg: C.accentSoft, color: C.accent, icon: '⚠️' },
    success: { bg: C.greenSoft,  color: C.green,  icon: '✅' },
    info:    { bg: C.brandLight, color: C.brand,  icon: 'ℹ️' },
  }
  const s = map[type]
  return (
    <div style={{
      background: s.bg, color: s.color,
      padding: '12px 16px', borderRadius: 8,
      fontSize: 13, fontWeight: 500,
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span>{s.icon}</span> {message}
    </div>
  )
}
