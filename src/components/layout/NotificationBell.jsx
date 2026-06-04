import { useEffect, useState, useRef } from 'react'
import { C, NOTIFICATION_TYPES } from '../../lib/constants'
import {
  getMyNotifications, getUnreadCount,
  markAsRead, markAllAsRead,
  subscribeToNotifications,
} from '../../lib/api.notifications'
import { useAuth } from '../../context/AuthContext'

function timeAgo(isoString) {
  const diff = (new Date() - new Date(isoString)) / 1000
  if (diff < 60)    return 'just now'
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function NotificationBell() {
  const { employee } = useAuth()
  const [open,         setOpen]         = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount,  setUnreadCount]  = useState(0)
  const [loading,      setLoading]      = useState(true)
  const drawerRef = useRef(null)

  // Load notifications
  async function load() {
    if (!employee) return
    try {
      const [notifs, count] = await Promise.all([
        getMyNotifications(employee.id),
        getUnreadCount(employee.id),
      ])
      setNotifications(notifs)
      setUnreadCount(count)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    load()
  }, [employee])

  // Real-time subscription
  useEffect(() => {
    if (!employee) return
    const unsubscribe = subscribeToNotifications(employee.id, (newNotif) => {
      setNotifications(prev => [newNotif, ...prev])
      setUnreadCount(c => c + 1)
      // Show browser notification if permitted
      if (Notification.permission === 'granted') {
        new Notification(newNotif.title, { body: newNotif.message, icon: '/favicon.svg' })
      }
    })
    return unsubscribe
  }, [employee])

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (drawerRef.current && !drawerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Request browser notification permission
  useEffect(() => {
    if (Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  async function handleOpen() {
    setOpen(o => !o)
    if (!open) load()
  }

  async function handleMarkRead(id) {
    await markAsRead(id)
    setNotifications(ns => ns.map(n => n.id === id ? { ...n, is_read: true } : n))
    setUnreadCount(c => Math.max(0, c - 1))
  }

  async function handleMarkAllRead() {
    if (!employee) return
    await markAllAsRead(employee.id)
    setNotifications(ns => ns.map(n => ({ ...n, is_read: true })))
    setUnreadCount(0)
  }

  return (
    <div ref={drawerRef} style={{ position: 'relative' }}>
      {/* Bell button */}
      <button onClick={handleOpen} style={{
        position: 'relative',
        width: 40, height: 40, borderRadius: 10,
        background: open ? C.brandLight : 'transparent',
        border: open ? `1.5px solid ${C.brand}30` : `1.5px solid ${C.border}`,
        cursor: 'pointer', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontSize: 18, transition: 'all 0.15s',
      }}>
        🔔
        {unreadCount > 0 && (
          <div style={{
            position: 'absolute', top: -4, right: -4,
            background: C.accent, color: '#fff',
            fontSize: 10, fontWeight: 800,
            width: 18, height: 18, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid #fff',
            fontFamily: "'Sora',sans-serif",
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </div>
        )}
      </button>

      {/* Notification drawer */}
      {open && (
        <div style={{
          position: 'absolute', top: 48, right: 0,
          width: 380, maxHeight: 520,
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          boxShadow: '0 12px 40px rgba(29,53,87,0.16)',
          zIndex: 1000,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '16px 18px 14px',
            borderBottom: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: "'Sora',sans-serif" }}>
              Notifications
              {unreadCount > 0 && (
                <span style={{
                  marginLeft: 8, fontSize: 11, fontWeight: 700,
                  background: C.accent, color: '#fff',
                  padding: '2px 7px', borderRadius: 20,
                }}>{unreadCount} new</span>
              )}
            </div>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} style={{
                fontSize: 11, color: C.brand, background: 'none',
                border: 'none', cursor: 'pointer', fontWeight: 600,
              }}>
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: C.textLight, fontSize: 13 }}>Loading…</div>
            ) : notifications.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🔕</div>
                <div style={{ fontSize: 13, color: C.textLight }}>You're all caught up!</div>
              </div>
            ) : (
              notifications.map(n => {
                const nt = NOTIFICATION_TYPES[n.type] || { icon: '📌', color: C.brand }
                return (
                  <div
                    key={n.id}
                    onClick={() => !n.is_read && handleMarkRead(n.id)}
                    style={{
                      padding: '14px 18px',
                      borderBottom: `1px solid ${C.border}`,
                      display: 'flex', gap: 12, alignItems: 'flex-start',
                      background: n.is_read ? C.surface : `${nt.color}08`,
                      cursor: n.is_read ? 'default' : 'pointer',
                      transition: 'background 0.15s',
                    }}
                  >
                    {/* Icon circle */}
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: `${nt.color}18`,
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 16,
                      flexShrink: 0,
                    }}>
                      {nt.icon}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: n.is_read ? 500 : 700,
                        color: C.text, marginBottom: 3, lineHeight: 1.3,
                      }}>
                        {n.title}
                      </div>
                      <div style={{
                        fontSize: 12, color: C.textMid, lineHeight: 1.4,
                        marginBottom: 4,
                      }}>
                        {n.message}
                      </div>
                      <div style={{ fontSize: 10, color: C.textLight }}>
                        {timeAgo(n.created_at)}
                      </div>
                    </div>

                    {/* Unread dot */}
                    {!n.is_read && (
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: nt.color, flexShrink: 0, marginTop: 4,
                      }} />
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div style={{
              padding: '10px 18px',
              borderTop: `1px solid ${C.border}`,
              textAlign: 'center',
            }}>
              <button onClick={() => { setNotifications([]); load() }} style={{
                fontSize: 11, color: C.textLight, background: 'none',
                border: 'none', cursor: 'pointer',
              }}>
                Refresh
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
