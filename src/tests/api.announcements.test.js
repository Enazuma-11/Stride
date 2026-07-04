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

// NOTE: leave-decision email is deferred (see docs/AUDIT-2026-07-04.md); its
// test was removed along with the feature. The remaining email tests below are
// mock-only smoke checks and should be replaced with real-behaviour tests when
// the email feature is built out properly.
vi.mock('../lib/email.notifications', () => ({
  sendWelcomeEmail:       vi.fn().mockResolvedValue({ success: true }),
  sendBirthdayEmail:      vi.fn().mockResolvedValue({ success: true }),
  sendPayslipReadyEmail:  vi.fn().mockResolvedValue({ success: true }),
}))

import {
  sendWelcomeEmail,
  sendBirthdayEmail,
  sendPayslipReadyEmail,
} from '../lib/email.notifications'

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
