import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import AdminLandingPage from '../hr/AdminLandingPage'
import EmployeeLandingPage from './EmployeeLandingPage'
import OnboardingWizard from '../../components/OnboardingWizard'

export default function DashboardPage() {
  const { employee, isHR } = useAuth()
  const [showWizard, setShowWizard] = useState(false)

  useEffect(() => {
    if (employee && !employee.onboarding_completed) {
      setTimeout(() => setShowWizard(true), 800)
    }
  }, [employee])

  return (
    <>
      {showWizard && <OnboardingWizard onComplete={() => setShowWizard(false)} />}
      {isHR
        ? <AdminLandingPage />
        : <EmployeeLandingPage />
      }
    </>
  )
}
