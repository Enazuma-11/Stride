import '@testing-library/jest-dom'
import { vi } from 'vitest'

// ── Mock Supabase globally ────────────────────────────────────────────────────
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signOut:            vi.fn(),
      getSession:         vi.fn(),
      getUser:            vi.fn(),
      mfa: {
        listFactors:  vi.fn(),
        enroll:       vi.fn(),
        challenge:    vi.fn(),
        verify:       vi.fn(),
        unenroll:     vi.fn(),
        getAuthenticatorAssuranceLevel: vi.fn(),
      },
    },
    from: vi.fn(() => ({
      select:    vi.fn().mockReturnThis(),
      insert:    vi.fn().mockReturnThis(),
      update:    vi.fn().mockReturnThis(),
      upsert:    vi.fn().mockReturnThis(),
      delete:    vi.fn().mockReturnThis(),
      eq:        vi.fn().mockReturnThis(),
      neq:       vi.fn().mockReturnThis(),
      in:        vi.fn().mockReturnThis(),
      like:      vi.fn().mockReturnThis(),
      order:     vi.fn().mockReturnThis(),
      limit:     vi.fn().mockReturnThis(),
      single:    vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    storage: {
      from: vi.fn(() => ({
        upload:          vi.fn().mockResolvedValue({ data: {}, error: null }),
        remove:          vi.fn().mockResolvedValue({ data: {}, error: null }),
        createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://example.com/photo.jpg' }, error: null }),
      })),
    },
    channel:        vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    removeChannel:  vi.fn(),
    rpc:            vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}))

// ── Mock env variables ────────────────────────────────────────────────────────
vi.stubEnv('VITE_SUPABASE_URL',       'https://test.supabase.co')
vi.stubEnv('VITE_SUPABASE_ANON_KEY',  'test-anon-key')
vi.stubEnv('VITE_MSG91_AUTH_KEY',     'test-msg91-key')
vi.stubEnv('VITE_MSG91_EMAIL_FROM',   'donotreply@sportechinnolab.org')
vi.stubEnv('VITE_APP_URL',            'https://sportech-portal.vercel.app')
