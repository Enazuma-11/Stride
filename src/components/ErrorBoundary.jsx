import { Component } from 'react'
import { C, FONTS } from '../lib/constants'

/**
 * Catches render-time crashes anywhere below it and shows a recoverable
 * fallback instead of a blank white screen. Also a single funnel point for
 * wiring an external error reporter (Sentry, etc.) later — see reportError().
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // Central place to forward to an error-reporting service in production.
    // eslint-disable-next-line no-console
    console.error('Unhandled UI error:', error, info?.componentStack)
    if (typeof window !== 'undefined' && typeof window.reportError === 'function') {
      try { window.reportError(error) } catch { /* never let reporting throw */ }
    }
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
    if (typeof window !== 'undefined') window.location.assign('/dashboard')
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div style={{
        minHeight: '100vh', background: C.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, fontFamily: FONTS.body,
      }}>
        <div style={{
          background: C.surface, borderRadius: 16, padding: '40px 36px',
          maxWidth: 440, width: '100%', textAlign: 'center', boxShadow: C.shadowLg,
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>😵‍💫</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.text, fontFamily: FONTS.display, marginBottom: 10 }}>
            Something went wrong
          </div>
          <div style={{ fontSize: 14, color: C.textMid, lineHeight: 1.6, marginBottom: 24 }}>
            An unexpected error occurred while rendering this page. Your data is safe —
            try reloading. If it keeps happening, contact HR.
          </div>
          <button onClick={this.handleReload} style={{
            padding: '11px 24px', borderRadius: 10, border: 'none',
            background: C.brand, color: '#fff', fontSize: 14, fontWeight: 700,
            cursor: 'pointer', fontFamily: FONTS.display,
          }}>
            Reload Stride
          </button>
        </div>
      </div>
    )
  }
}
