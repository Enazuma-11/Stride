import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ErrorBoundary from '../components/ErrorBoundary'

function Boom() {
  throw new Error('kaboom')
}

describe('ErrorBoundary', () => {
  let consoleSpy
  beforeEach(() => {
    // React logs the caught error; silence it to keep test output clean.
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Healthy content</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('Healthy content')).toBeInTheDocument()
  })

  it('renders the recovery fallback when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload stride/i })).toBeInTheDocument()
  })

  it('forwards the error to window.reportError when available', () => {
    const reporter = vi.fn()
    window.reportError = reporter
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )
    expect(reporter).toHaveBeenCalled()
    delete window.reportError
  })
})
