import PWAInstallPrompt     from './components/PWAInstallPrompt'
import TeamDirectoryPage     from './pages/employee/TeamDirectoryPage'
import PerformancePage       from './pages/employee/PerformancePage'
import PayslipsPage          from './pages/employee/PayslipsPage'
import AnnouncementsPage     from './pages/employee/AnnouncementsPage'
import HRPayslipsPage        from './pages/hr/HRPayslipsPage'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import LoginPage              from './pages/auth/LoginPage'
import RegisterPage           from './pages/auth/RegisterPage'
import SetPasswordPage        from './pages/auth/SetPasswordPage'
import DashboardPage          from './pages/employee/DashboardPage'
import LeavePage              from './pages/employee/LeavePage'
import AttendancePage         from './pages/employee/AttendancePage'
import ProfilePage            from './pages/employee/ProfilePage'
import HRDashboardPage        from './pages/hr/HRDashboardPage'
import EmployeeManagementPage from './pages/hr/EmployeeManagementPage'
import HRAttendancePage       from './pages/hr/HRAttendancePage'
import HRLeaveManagementPage  from './pages/hr/HRLeaveManagementPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login"        element={<LoginPage />} />
          <Route path="/register"     element={<RegisterPage />} />
          <Route path="/set-password" element={<SetPasswordPage />} />

          <Route path="/dashboard"  element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/leaves"     element={<ProtectedRoute><LeavePage /></ProtectedRoute>} />
          <Route path="/attendance" element={<ProtectedRoute><AttendancePage /></ProtectedRoute>} />
          <Route path="/profile"    element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />

          <Route path="/hr"             element={<ProtectedRoute requireHR><HRDashboardPage /></ProtectedRoute>} />
          <Route path="/hr/employees"   element={<ProtectedRoute requireHR><EmployeeManagementPage /></ProtectedRoute>} />
          <Route path="/hr/attendance"  element={<ProtectedRoute requireHR><HRAttendancePage /></ProtectedRoute>} />
          <Route path="/hr/leaves"      element={<ProtectedRoute requireHR><HRLeaveManagementPage /></ProtectedRoute>} />
          <Route path="/hr/payslips"    element={<ProtectedRoute requireHR><HRPayslipsPage /></ProtectedRoute>} />
          <Route path="/payslips"        element={<ProtectedRoute><PayslipsPage /></ProtectedRoute>} />
          <Route path="/announcements"   element={<ProtectedRoute><AnnouncementsPage /></ProtectedRoute>} />
          <Route path="/team"             element={<ProtectedRoute><TeamDirectoryPage /></ProtectedRoute>} />
          <Route path="/performance"      element={<ProtectedRoute><PerformancePage /></ProtectedRoute>} />

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        <PWAInstallPrompt />
  </BrowserRouter>
    </AuthProvider>
  )
}
