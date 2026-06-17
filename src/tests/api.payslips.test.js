import { describe, it, expect } from 'vitest'
import { calcPayslipTotals, MONTH_NAMES } from '../lib/api.payslips'

// ── calcPayslipTotals ─────────────────────────────────────────────────────────
describe('calcPayslipTotals', () => {
  it('calculates gross earnings correctly', () => {
    const p = {
      basic: 18000, hra: 7200, conveyance: 1600,
      medical: 1250, lta: 1500, special_allowance: 15450,
      other_earnings: 0,
      pf_deduction: 0, pt_deduction: 0, tds_deduction: 0,
      lop_deduction: 0, other_deductions: 0,
    }
    const { grossEarnings } = calcPayslipTotals(p)
    expect(grossEarnings).toBe(45000)
  })

  it('calculates deductions correctly', () => {
    const p = {
      basic: 18000, hra: 7200, conveyance: 1600,
      medical: 1250, lta: 1500, special_allowance: 15450,
      other_earnings: 0,
      pf_deduction: 1800, pt_deduction: 200, tds_deduction: 500,
      lop_deduction: 0, other_deductions: 0,
    }
    const { totalDeductions } = calcPayslipTotals(p)
    expect(totalDeductions).toBe(2500)
  })

  it('calculates net salary correctly', () => {
    const p = {
      basic: 18000, hra: 7200, conveyance: 1600,
      medical: 1250, lta: 1500, special_allowance: 15450,
      other_earnings: 0,
      pf_deduction: 1800, pt_deduction: 200, tds_deduction: 0,
      lop_deduction: 0, other_deductions: 0,
    }
    const { netSalary } = calcPayslipTotals(p)
    expect(netSalary).toBe(43000)
  })

  it('handles zero salary', () => {
    const p = {
      basic: 0, hra: 0, conveyance: 0,
      medical: 0, lta: 0, special_allowance: 0, other_earnings: 0,
      pf_deduction: 0, pt_deduction: 0, tds_deduction: 0,
      lop_deduction: 0, other_deductions: 0,
    }
    const { grossEarnings, totalDeductions, netSalary } = calcPayslipTotals(p)
    expect(grossEarnings).toBe(0)
    expect(totalDeductions).toBe(0)
    expect(netSalary).toBe(0)
  })

  it('handles missing fields gracefully (undefined defaults to 0)', () => {
    const p = { basic: 10000 } // all other fields missing
    const { grossEarnings, totalDeductions, netSalary } = calcPayslipTotals(p)
    expect(grossEarnings).toBe(10000)
    expect(totalDeductions).toBe(0)
    expect(netSalary).toBe(10000)
  })

  it('net salary can be negative if deductions exceed earnings', () => {
    const p = {
      basic: 5000, hra: 0, conveyance: 0, medical: 0, lta: 0,
      special_allowance: 0, other_earnings: 0,
      pf_deduction: 0, pt_deduction: 0, tds_deduction: 6000,
      lop_deduction: 0, other_deductions: 0,
    }
    const { netSalary } = calcPayslipTotals(p)
    expect(netSalary).toBe(-1000)
  })

  it('handles LOP deduction', () => {
    const p = {
      basic: 30000, hra: 12000, conveyance: 1600, medical: 1250,
      lta: 1500, special_allowance: 3650, other_earnings: 0,
      pf_deduction: 0, pt_deduction: 0, tds_deduction: 0,
      lop_deduction: 5000, other_deductions: 0,
    }
    const { netSalary, totalDeductions } = calcPayslipTotals(p)
    expect(totalDeductions).toBe(5000)
    expect(netSalary).toBe(45000)
  })

  it('all 7 earning components are summed', () => {
    const p = {
      basic: 1000, hra: 1000, conveyance: 1000, medical: 1000,
      lta: 1000, special_allowance: 1000, other_earnings: 1000,
      pf_deduction: 0, pt_deduction: 0, tds_deduction: 0,
      lop_deduction: 0, other_deductions: 0,
    }
    const { grossEarnings } = calcPayslipTotals(p)
    expect(grossEarnings).toBe(7000)
  })

  it('all 5 deduction components are summed', () => {
    const p = {
      basic: 50000, hra: 0, conveyance: 0, medical: 0, lta: 0,
      special_allowance: 0, other_earnings: 0,
      pf_deduction: 1000, pt_deduction: 200, tds_deduction: 500,
      lop_deduction: 300, other_deductions: 100,
    }
    const { totalDeductions } = calcPayslipTotals(p)
    expect(totalDeductions).toBe(2100)
  })
})

// ── MONTH_NAMES ───────────────────────────────────────────────────────────────
describe('MONTH_NAMES', () => {
  it('has 13 entries (index 0 is empty)', () => {
    expect(MONTH_NAMES).toHaveLength(13)
    expect(MONTH_NAMES[0]).toBe('')
  })

  it('month 1 is January', () => {
    expect(MONTH_NAMES[1]).toBe('January')
  })

  it('month 12 is December', () => {
    expect(MONTH_NAMES[12]).toBe('December')
  })

  it('month 6 is June', () => {
    expect(MONTH_NAMES[6]).toBe('June')
  })

  it('all months are properly named', () => {
    const expected = [
      '', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ]
    expect(MONTH_NAMES).toEqual(expected)
  })
})
