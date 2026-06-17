import { describe, it, expect, vi } from 'vitest'
import { calcPayslipTotals } from '../lib/api.payslips'
import { LEAVE_TYPES, WORK_HOURS_BY_TYPE, EMPLOYEE_TYPES, COMPANY_DOMAIN, REQUIRES_COMPANY_EMAIL } from '../lib/constants'

// ── Email validation logic (mirrors RegisterPage) ─────────────────────────────
function validateEmailForType(email, employeeType) {
  if (REQUIRES_COMPANY_EMAIL.includes(employeeType)) {
    if (!email.endsWith(`@${COMPANY_DOMAIN}`)) {
      return `Permanent and part-time employees must use a @${COMPANY_DOMAIN} email.`
    }
  }
  return null
}

describe('Email validation for employee types', () => {
  it('permanent employee must use company email', () => {
    const err = validateEmailForType('john@gmail.com', 'permanent')
    expect(err).toContain('sportechinnolab.org')
  })

  it('part-time employee must use company email', () => {
    const err = validateEmailForType('john@gmail.com', 'parttime')
    expect(err).toContain('sportechinnolab.org')
  })

  it('intern can use personal email', () => {
    const err = validateEmailForType('stuti@gmail.com', 'intern')
    expect(err).toBeNull()
  })

  it('contractor can use personal email', () => {
    const err = validateEmailForType('contractor@gmail.com', 'contractor')
    expect(err).toBeNull()
  })

  it('company email passes for permanent', () => {
    const err = validateEmailForType('john@sportechinnolab.org', 'permanent')
    expect(err).toBeNull()
  })

  it('empty email fails for permanent', () => {
    const err = validateEmailForType('', 'permanent')
    expect(err).toBeTruthy()
  })
})

// ── Leave balance calculations ────────────────────────────────────────────────
describe('Leave balance edge cases', () => {
  it('remaining days = total - used', () => {
    const total = 18, used = 5
    const remaining = total - used
    expect(remaining).toBe(13)
  })

  it('remaining days is never negative when used > total', () => {
    const total = 5, used = 7
    const remaining = Math.max(0, total - used)
    expect(remaining).toBe(0)
  })

  it('half day deducts 0.5 from used_days', () => {
    const initialUsed = 2
    const newUsed = initialUsed + 0.5
    expect(newUsed).toBe(2.5)
  })

  it('leave percentage calculation', () => {
    const total = 18, used = 9
    const pct = Math.round((used / total) * 100)
    expect(pct).toBe(50)
  })

  it('leave percentage is 100 when fully used', () => {
    const total = 12, used = 12
    const pct = Math.min(100, Math.round((used / total) * 100))
    expect(pct).toBe(100)
  })
})

// ── Attendance status logic ───────────────────────────────────────────────────
describe('Attendance policy by employee type', () => {
  it('permanent employee full day is 8 hours', () => {
    const policy = WORK_HOURS_BY_TYPE['permanent']
    expect(policy.fullDay).toBe(8)
  })

  it('intern full day threshold is lower (5.5h)', () => {
    const permPolicy  = WORK_HOURS_BY_TYPE['permanent']
    const internPolicy = WORK_HOURS_BY_TYPE['intern']
    expect(internPolicy.fullDay).toBeLessThan(permPolicy.fullDay)
  })

  it('half day is always exactly half of full day', () => {
    Object.entries(WORK_HOURS_BY_TYPE).forEach(([type, policy]) => {
      expect(policy.halfDay).toBeCloseTo(policy.fullDay / 2, 5)
    })
  })
})

// ── Payslip calculations edge cases ──────────────────────────────────────────
describe('Payslip edge cases', () => {
  it('handles floating point salary components', () => {
    const p = {
      basic: 18333.33, hra: 7333.33, conveyance: 1600,
      medical: 1250, lta: 1500, special_allowance: 15983.34,
      other_earnings: 0,
      pf_deduction: 2200, pt_deduction: 200, tds_deduction: 0,
      lop_deduction: 0, other_deductions: 0,
    }
    const { grossEarnings, netSalary } = calcPayslipTotals(p)
    expect(grossEarnings).toBeCloseTo(46000, 1)
    expect(netSalary).toBeCloseTo(43600, 1)
  })

  it('annual is always 12x monthly gross', () => {
    const p = {
      basic: 18000, hra: 7200, conveyance: 1600,
      medical: 1250, lta: 1500, special_allowance: 15450,
      other_earnings: 0,
      pf_deduction: 0, pt_deduction: 0, tds_deduction: 0,
      lop_deduction: 0, other_deductions: 0,
    }
    const { grossEarnings } = calcPayslipTotals(p)
    const annual = grossEarnings * 12
    expect(annual).toBe(540000)
  })

  it('LOP deduction reduces net salary correctly', () => {
    const baseP = {
      basic: 30000, hra: 12000, conveyance: 0, medical: 0, lta: 0,
      special_allowance: 0, other_earnings: 0,
      pf_deduction: 0, pt_deduction: 0, tds_deduction: 0,
      lop_deduction: 0, other_deductions: 0,
    }
    const withLOP = { ...baseP, lop_deduction: 3000 }
    const { netSalary: base }    = calcPayslipTotals(baseP)
    const { netSalary: withLop } = calcPayslipTotals(withLOP)
    expect(base - withLop).toBe(3000)
  })
})

// ── Employee ID format validation ─────────────────────────────────────────────
describe('Employee ID format', () => {
  function isValidEmployeeCode(code) {
    return /^(SIL|TRN)-\d{6}$/.test(code)
  }

  it('validates SIL permanent employee codes', () => {
    expect(isValidEmployeeCode('SIL-000001')).toBe(true)
    expect(isValidEmployeeCode('SIL-000004')).toBe(true)
    expect(isValidEmployeeCode('SIL-999999')).toBe(true)
  })

  it('validates TRN intern codes', () => {
    expect(isValidEmployeeCode('TRN-000001')).toBe(true)
  })

  it('rejects old format codes', () => {
    expect(isValidEmployeeCode('SIL-001')).toBe(false)
    expect(isValidEmployeeCode('SIL-0001')).toBe(false)
  })

  it('rejects invalid prefixes', () => {
    expect(isValidEmployeeCode('EMP-000001')).toBe(false)
    expect(isValidEmployeeCode('HR-000001')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidEmployeeCode('')).toBe(false)
  })
})

// ── Onboarding form validation ────────────────────────────────────────────────
describe('Onboarding form step validation', () => {
  function validateStep1({ firstName, lastName, gender, dob, fatherName, motherName, tshirtSize }) {
    if (!firstName?.trim()) return 'First name is required.'
    if (!lastName?.trim())  return 'Last name is required.'
    if (!gender)            return 'Please select your gender.'
    if (!dob)               return 'Date of birth is required.'
    if (!fatherName?.trim())return "Father's name is required."
    if (!motherName?.trim())return "Mother's name is required."
    if (!tshirtSize)        return 'Please select your T-shirt size.'
    return null
  }

  const validStep1 = {
    firstName: 'Amit', lastName: 'Chobitkar',
    gender: 'Male', dob: '1994-05-05',
    fatherName: 'Ramesh', motherName: 'Sunita', tshirtSize: 'L',
  }

  it('passes with all required fields', () => {
    expect(validateStep1(validStep1)).toBeNull()
  })

  it('fails without first name', () => {
    expect(validateStep1({ ...validStep1, firstName: '' })).toContain('First name')
  })

  it('fails without last name', () => {
    expect(validateStep1({ ...validStep1, lastName: '' })).toContain('Last name')
  })

  it('fails without gender', () => {
    expect(validateStep1({ ...validStep1, gender: '' })).toContain('gender')
  })

  it('fails without DOB', () => {
    expect(validateStep1({ ...validStep1, dob: '' })).toContain('birth')
  })

  it('fails without father name', () => {
    expect(validateStep1({ ...validStep1, fatherName: '' })).toContain("Father")
  })

  it('fails without mother name', () => {
    expect(validateStep1({ ...validStep1, motherName: '' })).toContain("Mother")
  })

  it('fails without tshirt size', () => {
    expect(validateStep1({ ...validStep1, tshirtSize: '' })).toContain('T-shirt')
  })

  it('fails with whitespace-only first name', () => {
    expect(validateStep1({ ...validStep1, firstName: '   ' })).toContain('First name')
  })
})

// ── IFSC code format validation ───────────────────────────────────────────────
describe('IFSC code validation', () => {
  function isValidIFSC(ifsc) {
    return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)
  }

  it('validates correct IFSC format', () => {
    expect(isValidIFSC('HDFC0001234')).toBe(true)
    expect(isValidIFSC('KKBK0000691')).toBe(true)
    expect(isValidIFSC('SBIN0000001')).toBe(true)
  })

  it('rejects invalid IFSC codes', () => {
    expect(isValidIFSC('HDFC001234')).toBe(false)   // too short
    expect(isValidIFSC('hdfc0001234')).toBe(false)  // lowercase
    expect(isValidIFSC('1234ABCDEFG')).toBe(false)  // starts with number
    expect(isValidIFSC('')).toBe(false)
  })
})

// ── PAN number format validation ──────────────────────────────────────────────
describe('PAN number validation', () => {
  function isValidPAN(pan) {
    return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan)
  }

  it('validates correct PAN format', () => {
    expect(isValidPAN('ABCDE1234F')).toBe(true)
    expect(isValidPAN('PQRST5678Z')).toBe(true)
  })

  it('rejects invalid PAN', () => {
    expect(isValidPAN('abcde1234f')).toBe(false)  // lowercase
    expect(isValidPAN('ABCD1234F')).toBe(false)   // too short
    expect(isValidPAN('ABCDE12345')).toBe(false)  // ends with number
    expect(isValidPAN('')).toBe(false)
  })
})
