import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import PWAInstallPrompt from './components/PWAInstallPrompt'
import { Spinner } from './components/ui'
import { C } from './lib/constants'

// Auth pages are tiny and on the critical first-paint path — keep eager.
import LoginPage       from './pages/auth/LoginPage'
import RegisterPage    from './pages/auth/RegisterPage'
import SetPasswordPage from './pages/auth/SetPasswordPage'

// Everything behind auth is route-split so each page is its own chunk.
const DashboardPage          = lazy(() => import('./pages/employee/DashboardPage'))
const LeavePage              = lazy(() => import('./pages/employee/LeavePage'))
const AttendancePage         = lazy(() => import('./pages/employee/AttendancePage'))
const ProfilePage            = lazy(() => import('./pages/employee/ProfilePage'))
const PayslipsPage           = lazy(() => import('./pages/employee/PayslipsPage'))
const AnnouncementsPage      = lazy(() => import('./pages/employee/AnnouncementsPage'))
const TeamDirectoryPage      = lazy(() => import('./pages/employee/TeamDirectoryPage'))
const PerformancePage        = lazy(() => import('./pages/employee/PerformancePage'))
const PolicyCentrePage       = lazy(() => import('./pages/employee/PolicyCentrePage'))
const ChatPage               = lazy(() => import('./pages/employee/ChatPage'))
const HRDashboardPage        = lazy(() => import('./pages/hr/HRDashboardPage'))
const EmployeeManagementPage = lazy(() => import('./pages/hr/EmployeeManagementPage'))
const HRAttendancePage       = lazy(() => import('./pages/hr/HRAttendancePage'))
const HRLeaveManagementPage  = lazy(() => import('./pages/hr/HRLeaveManagementPage'))
const HRPayslipsPage         = lazy(() => import('./pages/hr/HRPayslipsPage'))

function RouteFallback() {
  return (
    <div style={{
      minHeight: '100vh', background: C.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Spinner size={28} />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login"        element={<LoginPage />} />
            <Route path="/register"     element={<RegisterPage />} />
            <Route path="/set-password" element={<SetPasswordPage />} />

            <Route path="/dashboard"  element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
            <Route path="/leaves"     element={<ProtectedRoute><LeavePage /></ProtectedRoute>} />
            <Route path="/attendance" element={<ProtectedRoute><AttendancePage /></ProtectedRoute>} />
            <Route path="/profile"    element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />

            <Route path="/hr"            element={<ProtectedRoute requireHR><HRDashboardPage /></ProtectedRoute>} />
            <Route path="/hr/employees"  element={<ProtectedRoute requireHR><EmployeeManagementPage /></ProtectedRoute>} />
            <Route path="/hr/attendance" element={<ProtectedRoute requireHR><HRAttendancePage /></ProtectedRoute>} />
            <Route path="/hr/leaves"     element={<ProtectedRoute requireHR><HRLeaveManagementPage /></ProtectedRoute>} />
            <Route path="/hr/payslips"   element={<ProtectedRoute requireHR><HRPayslipsPage /></ProtectedRoute>} />
            <Route path="/payslips"      element={<ProtectedRoute><PayslipsPage /></ProtectedRoute>} />
            <Route path="/announcements" element={<ProtectedRoute><AnnouncementsPage /></ProtectedRoute>} />
            <Route path="/team"          element={<ProtectedRoute><TeamDirectoryPage /></ProtectedRoute>} />
            <Route path="/performance"   element={<ProtectedRoute><PerformancePage /></ProtectedRoute>} />
            <Route path="/policies"      element={<ProtectedRoute><PolicyCentrePage /></ProtectedRoute>} />
            <Route path="/chat"          element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
        <PWAInstallPrompt />
      </BrowserRouter>
    </AuthProvider>
  )
}
