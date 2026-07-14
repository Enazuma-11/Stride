import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useAuth } from '../context/AuthContext'
import { ProtectedRoute } from '../components/layout/ProtectedRoute'

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('react-router-dom', () => ({
  Navigate: ({ to }) => <div>NAVIGATE:{to}</div>,
}))
vi.mock('../components/OnboardingFormFull', () => ({ default: () => <div>ONBOARDING FORM</div> }))

const activeEmployee = {
  role_type: 'employee',
  onboarding_status: 'active',
  onboarding_form_submitted: true,
}

beforeEach(() => vi.clearAllMocks())

describe('ProtectedRoute', () => {
  it('shows the loading screen while auth resolves', () => {
    useAuth.mockReturnValue({ loading: true })
    render(<ProtectedRoute><div>Secret</div></ProtectedRoute>)
    expect(screen.getByText(/Loading Stride/i)).toBeInTheDocument()
    expect(screen.queryByText('Secret')).not.toBeInTheDocument()
  })

  it('redirects to /login when there is no session', () => {
    useAuth.mockReturnValue({ loading: false, session: null })
    render(<ProtectedRoute><div>Secret</div></ProtectedRoute>)
    expect(screen.getByText('NAVIGATE:/login')).toBeInTheDocument()
  })

  it('renders children for an authenticated, active employee', () => {
    useAuth.mockReturnValue({ loading: false, session: { user: { id: 'u1' } }, employee: activeEmployee, isHR: false })
    render(<ProtectedRoute><div>Secret</div></ProtectedRoute>)
    expect(screen.getByText('Secret')).toBeInTheDocument()
  })

  it('redirects a non-HR user away from an HR-only route', () => {
    useAuth.mockReturnValue({ loading: false, session: { user: { id: 'u1' } }, employee: activeEmployee, isHR: false })
    render(<ProtectedRoute requireHR><div>HR Secret</div></ProtectedRoute>)
    expect(screen.getByText('NAVIGATE:/dashboard')).toBeInTheDocument()
    expect(screen.queryByText('HR Secret')).not.toBeInTheDocument()
  })

  it('allows an HR user into an HR-only route', () => {
    useAuth.mockReturnValue({ loading: false, session: { user: { id: 'u1' } }, employee: { ...activeEmployee, role_type: 'hr' }, isHR: true })
    render(<ProtectedRoute requireHR><div>HR Secret</div></ProtectedRoute>)
    expect(screen.getByText('HR Secret')).toBeInTheDocument()
  })

  it('shows the pending-approval screen for an unapproved registration', () => {
    useAuth.mockReturnValue({
      loading: false, session: { user: { id: 'u1' } },
      employee: { role_type: 'employee', onboarding_status: 'pending_approval' }, isHR: false,
    })
    render(<ProtectedRoute><div>Secret</div></ProtectedRoute>)
    expect(screen.getByText(/Approval Pending/i)).toBeInTheDocument()
  })
})
