import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { C } from '../../lib/constants'
import { Spinner } from '../ui'

export function ProtectedRoute({ children, requireHR = false }) {
  const { session, employee, loading, isHR } = useAuth()

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', background: C.brand,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
      }}>
        <div style={{ fontSize: 32 }}>⚡</div>
        <Spinner size={28} />
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Loading SporTech Portal…</div>
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  if (requireHR && !isHR) return <Navigate to="/dashboard" replace />

  return children
}
