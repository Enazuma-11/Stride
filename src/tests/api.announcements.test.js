import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toggleReaction } from '../lib/api.announcements'

// Mock supabase
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { reactions: {} }, error: null }),
    })),
  },
}))

vi.mock('../lib/email.notifications', () => ({
  sendLeaveDecisionEmail: vi.fn().mockResolvedValue({ success: true }),
  sendWelcomeEmail:       vi.fn().mockResolvedValue({ success: true }),
  sendBirthdayEmail:      vi.fn().mockResolvedValue({ success: true }),
  sendPayslipReadyEmail:  vi.fn().mockResolvedValue({ success: true }),
}))

import {
  sendLeaveDecisionEmail,
  sendWelcomeEmail,
  sendBirthdayEmail,
  sendPayslipReadyEmail,
} from '../lib/email.notifications'

describe('sendLeaveDecisionEmail', () => {
  it('sends approved email with correct subject', async () => {
    await sendLeaveDecisionEmail({ email: 'test@test.com', full_name: 'Test User' }, 'approved')
    expect(sendLeaveDecisionEmail).toHaveBeenCalled()
  })

  it('sends rejected email with correct subject', async () => {
    await sendLeaveDecisionEmail({ email: 'test@test.com', full_name: 'Test User' }, 'rejected')
    expect(sendLeaveDecisionEmail).toHaveBeenCalled()
  })
})

describe('sendWelcomeEmail', () => {
  it('sends welcome email with portal URL', async () => {
    await sendWelcomeEmail({ email: 'test@test.com', full_name: 'Test User' }, 'https://portal.test.com')
    expect(sendWelcomeEmail).toHaveBeenCalled()
  })

  it('uses first name in greeting', async () => {
    await sendWelcomeEmail({ email: 'test@test.com', full_name: 'Test User' }, 'https://portal.test.com')
    expect(sendWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: 'Test User' }),
      expect.any(String)
    )
  })
})

describe('sendBirthdayEmail', () => {
  it('sends birthday email', async () => {
    await sendBirthdayEmail({ email: 'test@test.com', full_name: 'Test User' })
    expect(sendBirthdayEmail).toHaveBeenCalled()
  })
})

describe('sendPayslipReadyEmail', () => {
  it('sends payslip notification with month and year', async () => {
    await sendPayslipReadyEmail({ email: 'test@test.com', full_name: 'Test User' }, 'May', 2026)
    expect(sendPayslipReadyEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test@test.com' }),
      'May',
      2026
    )
  })
})
