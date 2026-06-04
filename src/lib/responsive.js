// ─── RESPONSIVE UTILITIES ─────────────────────────────────────────────────────
// Single source of truth for all breakpoints and responsive helpers

export const BP = {
  mobile:  768,
  tablet:  1024,
}

// Returns true if window width is below breakpoint
export function isMobile()  { return typeof window !== 'undefined' && window.innerWidth < BP.mobile  }
export function isTablet()  { return typeof window !== 'undefined' && window.innerWidth < BP.tablet  }

// React hook for responsive state
import { useState, useEffect } from 'react'

export function useResponsive() {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200)

  useEffect(() => {
    function handle() { setWidth(window.innerWidth) }
    window.addEventListener('resize', handle)
    return () => window.removeEventListener('resize', handle)
  }, [])

  return {
    width,
    isMobile:  width < BP.mobile,
    isTablet:  width < BP.tablet,
    isDesktop: width >= BP.tablet,
  }
}

// Responsive grid helper
// Usage: grid(r, { mobile: 1, tablet: 2, desktop: 4 })
export function cols(r, { mobile = 1, tablet = 2, desktop = 4 }) {
  if (r.isMobile) return `repeat(${mobile}, 1fr)`
  if (r.isTablet) return `repeat(${tablet}, 1fr)`
  return `repeat(${desktop}, 1fr)`
}
