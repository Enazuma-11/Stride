import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import LoginPage              from './pages/auth/LoginPage'
import RegisterPage           from './pages/auth/RegisterPage'
import SetPasswordPage        from './pages/auth/SetPasswordPage'
import DashboardPage          from './pages/employee/DashboardPage'
import LeavePage              from './pages/employee/LeavePage'
import HRDashboardPage        from './pages/hr/HRDashboardPage'
import EmployeeManagementPage from './pages/hr/EmployeeManagementPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/login"        element={<LoginPage />} />
          <Route path="/register"     element={<RegisterPage />} />
          <Route path="/set-password" element={<SetPasswordPage />} />

          {/* Employee */}
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/leaves"    element={<ProtectedRoute><LeavePage /></ProtectedRoute>} />

          {/* HR only */}
          <Route path="/hr"          element={<ProtectedRoute requireHR><HRDashboardPage /></ProtectedRoute>} />
          <Route path="/hr/employees" element={<ProtectedRoute requireHR><EmployeeManagementPage /></ProtectedRoute>} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
