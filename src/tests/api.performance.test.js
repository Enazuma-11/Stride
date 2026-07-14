import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabase } from '../lib/supabase'
import {
  submitGoalSet,
  returnGoalSet,
  saveReview,
  finalizeReview,
} from '../lib/api.performance'

vi.mock('../lib/api.notifications', () => ({
  createNotification: vi.fn(() => Promise.resolve({})),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

// Helper: make supabase.from('objectives').select().eq().eq() resolve to goals
function mockObjectives(goals) {
  supabase.from.mockReturnValue({
    select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: goals, error: null }) }) }),
  })
}

// Helper: make supabase.from('performance_reviews').select().eq().single() resolve to review
function mockReviewFetch(review) {
  supabase.from.mockReturnValue({
    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: review, error: null }) }) }),
  })
}

describe('submitGoalSet — goal count / points guard rails', () => {
  it('throws when fewer than 5 goals', async () => {
    mockObjectives([{ points: 50 }, { points: 50 }])
    await expect(submitGoalSet('cycle-1', 'emp-1')).rejects.toThrow(/5.?8 goals/)
  })

  it('throws when more than 8 goals', async () => {
    mockObjectives(Array.from({ length: 9 }, () => ({ points: 11 })))
    await expect(submitGoalSet('cycle-1', 'emp-1')).rejects.toThrow(/5.?8 goals/)
  })

  it('throws when points do not total exactly 100', async () => {
    mockObjectives([{ points: 20 }, { points: 20 }, { points: 20 }, { points: 20 }, { points: 15 }])
    await expect(submitGoalSet('cycle-1', 'emp-1')).rejects.toThrow(/100/)
  })

  it('does not throw the validation error for 5 goals summing to 100', async () => {
    // 5 valid goals; the update chain resolves so submission proceeds.
    const goals = [{ points: 20 }, { points: 20 }, { points: 20 }, { points: 20 }, { points: 20 }]
    supabase.from.mockImplementation((table) => {
      if (table === 'objectives') {
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: goals, error: null }) }) }) }
      }
      if (table === 'goal_submissions') {
        return {
          update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { employee_id: 'emp-1' }, error: null }) }) }) }) }),
        }
      }
      if (table === 'employees') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { full_name: 'Jane', manager_id: null }, error: null }) }) }) }
      }
      return {}
    })
    await expect(submitGoalSet('cycle-1', 'emp-1')).resolves.not.toThrow()
  })
})

describe('returnGoalSet — comment required', () => {
  it('throws when the comment is empty', async () => {
    await expect(returnGoalSet('sub-1', '   ', 'mgr-1')).rejects.toThrow(/comment/i)
  })
})

describe('saveReview — year-end verdict required', () => {
  it('throws when a year_end review has no verdict', async () => {
    await expect(
      saveReview({ cycleId: 'c1', employeeId: 'e1', reviewType: 'year_end', ratings: [], overallComment: 'ok' }, 'mgr-1')
    ).rejects.toThrow(/verdict/i)
  })
})

describe('finalizeReview — guard rails', () => {
  it('throws when the review is not a year_end review', async () => {
    mockReviewFetch({ review_type: 'h1', status: 'manager_done', employee_id: 'e1' })
    await expect(finalizeReview('rev-1', 'notes', 'hr-1')).rejects.toThrow(/year-end/i)
  })

  it('throws when the review is not awaiting finalization', async () => {
    mockReviewFetch({ review_type: 'year_end', status: 'pending', employee_id: 'e1' })
    await expect(finalizeReview('rev-1', 'notes', 'hr-1')).rejects.toThrow(/not awaiting finalization/i)
  })
})
