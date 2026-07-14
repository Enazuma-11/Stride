import { describe, it, expect } from 'vitest'
import {
  C, FONTS, LEAVE_TYPES, EMPLOYEE_TYPES, HOLIDAYS_2026,
  WORK_HOURS_BY_TYPE, REQUIRES_COMPANY_EMAIL, COMPANY_DOMAIN,
  FEMALE_ONLY_LEAVES, GENDERS, DEPARTMENTS,
} from '../lib/constants'

describe('Design Tokens (C)', () => {
  it('has all required brand colours', () => {
    expect(C.brand).toBe('#126dad')
    expect(C.purple).toBe('#9b75f1')
    expect(C.teal).toBe('#00d4aa')
    expect(C.mint).toBe('#00ffb0')
    expect(C.lime).toBe('#a4ff3d')
  })

  it('has gradient strings', () => {
    expect(C.gradient).toContain('#9b75f1')
    expect(C.gradient).toContain('#126dad')
    expect(C.gradientH).toContain('90deg')
  })

  it('has all semantic colours', () => {
    expect(C.green).toBeDefined()
    expect(C.amber).toBeDefined()
    expect(C.accent).toBeDefined()
    expect(C.text).toBeDefined()
    expect(C.bg).toBeDefined()
    expect(C.surface).toBeDefined()
    expect(C.border).toBeDefined()
  })

  it('has shadow definitions', () => {
    expect(C.shadow).toBeDefined()
    expect(C.shadowMd).toBeDefined()
    expect(C.shadowTeal).toContain('0,212,170')
  })
})

describe('FONTS', () => {
  it('has all font families', () => {
    expect(FONTS.display).toContain('Plus Jakarta Sans')
    expect(FONTS.body).toContain('Inter')
    expect(FONTS.mono).toContain('JetBrains Mono')
  })
})

describe('LEAVE_TYPES', () => {
  it('has 6 leave types', () => {
    expect(LEAVE_TYPES).toHaveLength(6)
  })

  it('each leave type has required fields', () => {
    LEAVE_TYPES.forEach(lt => {
      expect(lt).toHaveProperty('id')
      expect(lt).toHaveProperty('label')
      expect(lt).toHaveProperty('color')
      expect(lt).toHaveProperty('total')
      expect(lt.total).toBeGreaterThan(0)
    })
  })

  it('has correct leave allocations', () => {
    const earned = LEAVE_TYPES.find(l => l.id === 'earned')
    expect(earned.total).toBe(18)

    const casualSick = LEAVE_TYPES.find(l => l.id === 'casual_sick')
    expect(casualSick.total).toBe(12)

    const maternity = LEAVE_TYPES.find(l => l.id === 'maternity')
    expect(maternity.total).toBe(182)
  })

  it('maternity is female-only', () => {
    expect(FEMALE_ONLY_LEAVES).toContain('maternity')
    expect(FEMALE_ONLY_LEAVES).not.toContain('earned')
  })
})

describe('WORK_HOURS_BY_TYPE', () => {
  it('has all employee types', () => {
    expect(WORK_HOURS_BY_TYPE).toHaveProperty('permanent')
    expect(WORK_HOURS_BY_TYPE).toHaveProperty('intern')
    expect(WORK_HOURS_BY_TYPE).toHaveProperty('contractor')
    expect(WORK_HOURS_BY_TYPE).toHaveProperty('parttime')
  })

  it('permanent full day is 8 hours', () => {
    expect(WORK_HOURS_BY_TYPE.permanent.fullDay).toBe(8)
    expect(WORK_HOURS_BY_TYPE.permanent.halfDay).toBe(4)
  })

  it('intern full day is 5.5 hours', () => {
    expect(WORK_HOURS_BY_TYPE.intern.fullDay).toBe(5.5)
    expect(WORK_HOURS_BY_TYPE.intern.halfDay).toBe(2.75)
  })

  it('half day is exactly half of full day', () => {
    Object.values(WORK_HOURS_BY_TYPE).forEach(policy => {
      expect(policy.halfDay).toBe(policy.fullDay / 2)
    })
  })
})

describe('EMPLOYEE_TYPES', () => {
  it('has 5 types including probation', () => {
    expect(EMPLOYEE_TYPES).toHaveLength(5)
    expect(EMPLOYEE_TYPES.map(t => t.value)).toContain('probation')
  })

  it('each type has value and label', () => {
    EMPLOYEE_TYPES.forEach(t => {
      expect(t).toHaveProperty('value')
      expect(t).toHaveProperty('label')
    })
  })

  it('company email required for permanent and parttime', () => {
    expect(REQUIRES_COMPANY_EMAIL).toContain('permanent')
    expect(REQUIRES_COMPANY_EMAIL).toContain('parttime')
    expect(REQUIRES_COMPANY_EMAIL).not.toContain('intern')
    expect(REQUIRES_COMPANY_EMAIL).not.toContain('contractor')
  })

  it('company domain is correct', () => {
    expect(COMPANY_DOMAIN).toBe('sportechinnolab.org')
  })
})

describe('HOLIDAYS_2026', () => {
  it('has holidays defined', () => {
    expect(HOLIDAYS_2026.length).toBeGreaterThan(10)
  })

  it('all holidays have required fields', () => {
    HOLIDAYS_2026.forEach(h => {
      expect(h).toHaveProperty('date')
      expect(h).toHaveProperty('name')
      expect(h).toHaveProperty('type')
      expect(['mandatory', 'optional']).toContain(h.type)
    })
  })

  it('dates are in 2026', () => {
    HOLIDAYS_2026.forEach(h => {
      expect(h.date).toMatch(/^2026-/)
    })
  })

  it('has key mandatory holidays', () => {
    const names = HOLIDAYS_2026.map(h => h.name)
    expect(names).toContain('Republic Day')
    expect(names).toContain('Independence Day')
    expect(names).toContain('Gandhi Jayanti')
  })

  it('mandatory holidays are correct', () => {
    const mandatory = HOLIDAYS_2026.filter(h => h.type === 'mandatory')
    expect(mandatory.length).toBeGreaterThanOrEqual(4)
  })
})

describe('GENDERS', () => {
  it('has standard gender options', () => {
    const values = GENDERS.map(g => g.value)
    expect(values).toContain('male')
    expect(values).toContain('female')
    expect(values).toContain('non_binary')
    expect(values).toContain('prefer_not_to_say')
  })
})

describe('DEPARTMENTS', () => {
  it('has at least 10 departments', () => {
    expect(DEPARTMENTS.length).toBeGreaterThanOrEqual(10)
  })

  it('has core departments', () => {
    expect(DEPARTMENTS).toContain('Engineering')
    expect(DEPARTMENTS).toContain('Human Resources')
    expect(DEPARTMENTS).toContain('Finance')
    expect(DEPARTMENTS).toContain('Leadership')
  })
})
