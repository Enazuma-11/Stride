import { useState, useEffect } from 'react'
import { C, FONTS } from '../lib/constants'

export default function PWAInstallPrompt() {
  const [prompt, setPrompt] = useState(null)
  const [show,   setShow]   = useState(false)
  const [isIOS,  setIsIOS]  = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Check if already installed
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone
    if (isStandalone) return

    // Check if dismissed recently
    const dismissedAt = localStorage.getItem('pwa-prompt-dismissed')
    if (dismissedAt && Date.now() - parseInt(dismissedAt) < 7 * 24 * 60 * 60 * 1000) return

    // Detect iOS
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    setIsIOS(ios)

    if (ios) {
      // Show iOS instructions after 3 seconds
      setTimeout(() => setShow(true), 3000)
    } else {
      // Listen for Android/Chrome install prompt
      window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault()
        setPrompt(e)
        setTimeout(() => setShow(true), 3000)
      })
    }
  }, [])

  function dismiss() {
    setShow(false)
    localStorage.setItem('pwa-prompt-dismissed', Date.now().toString())
    setDismissed(true)
  }

  async function install() {
    if (!prompt) return
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') setShow(false)
    setPrompt(null)
  }

  if (!show || dismissed) return null

  return (
    <div style={{
      position: 'fixed', bottom: 80, left: 12, right: 12, zIndex: 9999,
      background: '#1a0f2e',
      borderRadius: 16, padding: '16px 18px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      border: '1px solid rgba(255,255,255,0.1)',
      display: 'flex', gap: 12, alignItems: 'flex-start',
      animation: 'slideUp 0.3s ease',
    }}>
      {/* App icon */}
      <div style={{ width: 44, height: 44, borderRadius: 10, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
        <img src="/logo.png" style={{ width: 40, height: 40, objectFit: 'contain' }} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: FONTS.display, marginBottom: 3 }}>
          Install Stride
        </div>
        {isIOS ? (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>
            Tap <strong style={{ color: '#fff' }}>Share</strong> → <strong style={{ color: '#fff' }}>Add to Home Screen</strong> to install
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>
            Add to your home screen for the best experience
          </div>
        )}
        {!isIOS && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={install} style={{
              padding: '7px 16px', borderRadius: 8, border: 'none',
              background: C.gradientH, color: '#1a0f2e',
              fontSize: 12, fontWeight: 700, fontFamily: FONTS.display, cursor: 'pointer',
            }}>
              Install App
            </button>
            <button onClick={dismiss} style={{
              padding: '7px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
              background: 'transparent', color: 'rgba(255,255,255,0.5)',
              fontSize: 12, fontFamily: FONTS.body, cursor: 'pointer',
            }}>
              Not now
            </button>
          </div>
        )}
      </div>

      <button onClick={dismiss} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', fontSize: 18, cursor: 'pointer', padding: 0, flexShrink: 0 }}>✕</button>
    </div>
  )
}
