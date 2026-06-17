import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabase } from '../lib/supabase'
import {
  toggleReaction,
  ANNOUNCEMENT_CATEGORIES,
} from '../lib/api.announcements'
import {
  sendLeaveDecisionEmail,
  sendWelcomeEmail,
  sendBirthdayEmail,
  sendPayslipReadyEmail,
} from '../lib/email.notifications'

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn()
})

// ── ANNOUNCEMENT_CATEGORIES ───────────────────────────────────────────────────
describe('ANNOUNCEMENT_CATEGORIES', () => {
  it('has 4 categories', () => {
    expect(ANNOUNCEMENT_CATEGORIES).toHaveLength(4)
  })

  it('has general, hr, event, urgent', () => {
    const values = ANNOUNCEMENT_CATEGORIES.map(c => c.value)
    expect(values).toContain('general')
    expect(values).toContain('hr')
    expect(values).toContain('event')
    expect(values).toContain('urgent')
  })

  it('each category has value, label, color', () => {
    ANNOUNCEMENT_CATEGORIES.forEach(cat => {
      expect(cat).toHaveProperty('value')
      expect(cat).toHaveProperty('label')
      expect(cat).toHaveProperty('color')
      expect(cat.color).toMatch(/^#[0-9a-f]{6}$/i)
    })
  })

  it('urgent category is red', () => {
    const urgent = ANNOUNCEMENT_CATEGORIES.find(c => c.value === 'urgent')
    expect(urgent.color).toBe('#ef4444')
  })
})

// ── toggleReaction ────────────────────────────────────────────────────────────
describe('toggleReaction', () => {
  it('adds reaction when none exists', async () => {
    supabase.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({ data: {}, error: null }),
      })

    const result = await toggleReaction('ann1', 'emp1', '👍')
    expect(result).toBe(true) // added
  })

  it('removes reaction when one exists', async () => {
    supabase.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'react1' }, error: null }),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: {}, error: null }),
        }),
      })

    const result = await toggleReaction('ann1', 'emp1', '👍')
    expect(result).toBe(false) // removed
  })
})

// ── Email notifications (MSG91) ───────────────────────────────────────────────
describe('sendLeaveDecisionEmail', () => {
  it('sends approved email with correct subject', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'success', message: 'Email queued' }),
    })

    await sendLeaveDecisionEmail({
      toEmail:   'test@sportechinnolab.org',
      toName:    'Sanjusha Nagwani',
      status:    'approved',
      leaveType: 'Casual / Sick Leave',
      fromDate:  'Jun 16, 2026',
      toDate:    'Jun 17, 2026',
      days:      2,
    })

    expect(fetch).toHaveBeenCalledWith(
      'https://api.msg91.com/api/v5/email/send',
      expect.objectContaining({ method: 'POST' })
    )

    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.subject.toLowerCase()).toContain('approved')
    expect(body.to[0].email).toBe('test@sportechinnolab.org')
  })

  it('sends rejected email with correct subject', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'success' }),
    })

    await sendLeaveDecisionEmail({
      toEmail:   'test@sportechinnolab.org',
      toName:    'Amit Chobitkar',
      status:    'rejected',
      leaveType: 'Earned Leave',
      fromDate:  'Jul 15, 2026',
      toDate:    'Jul 18, 2026',
      days:      3,
    })

    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.subject.toLowerCase()).toContain('not approved')
  })

  it('does not throw when auth key is missing', async () => {
    vi.stubEnv('VITE_MSG91_AUTH_KEY', '')
    // Should warn and return null, not throw
    const result = await sendLeaveDecisionEmail({
      toEmail: 'test@test.com', toName: 'Test', status: 'approved',
      leaveType: 'Earned', fromDate: '2026-07-01', toDate: '2026-07-01', days: 1,
    })
    expect(result).toBeNull()
    vi.stubEnv('VITE_MSG91_AUTH_KEY', 'test-msg91-key')
  })
})

describe('sendWelcomeEmail', () => {
  it('sends welcome email with portal URL', async () => {
    global.fetch.mockResolvedValue({
      ok: true, json: async () => ({ type: 'success' }),
    })

    await sendWelcomeEmail({
      toEmail:    'new@sportechinnolab.org',
      toName:     'Edward Francis Paul',
      portalUrl:  'https://sportech-portal.vercel.app',
    })

    expect(fetch).toHaveBeenCalled()
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.to[0].email).toBe('new@sportechinnolab.org')
  })

  it('uses first name in greeting', async () => {
    global.fetch.mockResolvedValue({
      ok: true, json: async () => ({ type: 'success' }),
    })

    await sendWelcomeEmail({
      toEmail: 'test@test.com', toName: 'Sanjusha Nagwani',
      portalUrl: 'https://test.com',
    })

    const body = JSON.parse(fetch.mock.calls[0][1].body)
    // When no template ID, HTML body should contain first name
    if (body.content) {
      expect(body.content[0].value).toContain('Sanjusha')
    }
  })
})

describe('sendBirthdayEmail', () => {
  it('sends birthday email', async () => {
    global.fetch.mockResolvedValue({
      ok: true, json: async () => ({ type: 'success' }),
    })

    await sendBirthdayEmail({
      toEmail: 'birthday@sportechinnolab.org',
      toName:  'Amit Chobitkar',
    })

    expect(fetch).toHaveBeenCalled()
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.subject).toContain('Birthday')
  })
})

describe('sendPayslipReadyEmail', () => {
  it('sends payslip notification with month and year', async () => {
    global.fetch.mockResolvedValue({
      ok: true, json: async () => ({ type: 'success' }),
    })

    await sendPayslipReadyEmail({
      toEmail:   'emp@sportechinnolab.org',
      toName:    'Sanjusha Nagwani',
      month:     'June',
      year:      2026,
      portalUrl: 'https://sportech-portal.vercel.app',
    })

    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.subject).toContain('June')
    expect(body.subject).toContain('2026')
  })
})
