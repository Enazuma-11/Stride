import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Cache heavy third-party libs in their own long-lived chunks so app
        // deploys don't invalidate them and route chunks stay small.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@supabase')) return 'vendor-supabase'
            if (id.includes('react') || id.includes('scheduler')) return 'vendor-react'
            return 'vendor'
          }
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/tests/setup.js',
    exclude: ['node_modules', 'dist', '.claude/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/lib/**', 'src/components/**'],
      exclude: ['src/lib/supabase.js'],
    },
  },
})
