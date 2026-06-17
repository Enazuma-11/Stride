import { calcPayslipTotals, MONTH_NAMES } from '../lib/api.payslips'
import { C, FONTS } from '../lib/constants'
import { Spinner } from './ui'
import { useState } from 'react'

// ── Format currency ───────────────────────────────────────────────────────────
const fmt = (n) => `₹ ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`

// ── The payslip design (matches sample PDF layout) ────────────────────────────
export function PayslipDocument({ payslip }) {
  const emp  = payslip.employee || {}
  const { grossEarnings, totalDeductions, netSalary } = calcPayslipTotals(payslip)
  const monthName = MONTH_NAMES[payslip.month]
  const annualMultiplier = 12

  const earnings = [
    { label: 'Basic',             monthly: payslip.basic,             annual: payslip.basic * annualMultiplier },
    { label: 'HRA',               monthly: payslip.hra,               annual: payslip.hra * annualMultiplier },
    { label: 'Conveyance',        monthly: payslip.conveyance,        annual: payslip.conveyance * annualMultiplier },
    { label: 'Medical',           monthly: payslip.medical,           annual: payslip.medical * annualMultiplier },
    { label: 'LTA',               monthly: payslip.lta,               annual: payslip.lta * annualMultiplier },
    { label: 'Special Allowance', monthly: payslip.special_allowance, annual: payslip.special_allowance * annualMultiplier },
  ].filter(e => e.monthly > 0)

  if (payslip.other_earnings > 0) earnings.push({ label: 'Other Earnings', monthly: payslip.other_earnings, annual: payslip.other_earnings * 12 })

  const deductions = [
    { label: 'Provident Fund (PF)', monthly: payslip.pf_deduction },
    { label: 'Professional Tax (PT)', monthly: payslip.pt_deduction },
    { label: 'TDS', monthly: payslip.tds_deduction },
    { label: 'Loss of Pay (LOP)', monthly: payslip.lop_deduction },
    { label: 'Other Deductions', monthly: payslip.other_deductions },
  ].filter(d => d.monthly > 0)

  return (
    <div id="payslip-document" style={{
      width: 794, // A4 width in px at 96dpi
      minHeight: 1123, // A4 height
      background: '#fff',
      fontFamily: "'Inter', sans-serif",
      position: 'relative',
      overflow: 'hidden',
      padding: '40px 48px',
      fontSize: 13,
      color: '#1a1a2e',
    }}>
      {/* Watermark */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%) rotate(-30deg)',
        opacity: 0.04, pointerEvents: 'none', zIndex: 0,
        fontSize: 120, fontWeight: 900, color: '#126dad',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        whiteSpace: 'nowrap', userSelect: 'none',
      }}>
        SporTech
      </div>

      {/* Decorative corner shape */}
      <div style={{
        position: 'absolute', bottom: 0, right: 0,
        width: 220, height: 220,
        background: 'linear-gradient(135deg, #00d4aa20, #126dad15)',
        borderRadius: '100% 0 0 0',
        pointerEvents: 'none', zIndex: 0,
      }} />
      <div style={{
        position: 'absolute', bottom: 0, right: 0,
        width: 140, height: 140,
        background: 'linear-gradient(135deg, #a4ff3d20, #00d4aa20)',
        borderRadius: '100% 0 0 0',
        pointerEvents: 'none', zIndex: 0,
      }} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, paddingBottom: 20, borderBottom: '2px solid #126dad' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 56, height: 56, borderRadius: 12, background: '#fff', border: '1px solid #e8eaed', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <img src="/logo.png" style={{ width: 52, height: 52, objectFit: 'contain' }} crossOrigin="anonymous" />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#126dad', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>SporTech Innovation Lab</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Pvt. Ltd.</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#1a1a2e', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Monthly Salary Slip</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{monthName} {payslip.year}</div>
          </div>
        </div>

        {/* Employee details grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', marginBottom: 24, padding: '16px 20px', background: '#f9fafb', borderRadius: 10, border: '1px solid #e8eaed' }}>
          {[
            ['Employee ID',       emp.employee_code],
            ['Name',              emp.full_name],
            ['Designation',       emp.role],
            ['Department',        emp.department],
            ['Date of Joining',   emp.join_date ? new Date(emp.join_date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'],
            ['Month',             monthName],
            ['Total Working Days',payslip.working_days || 30],
            ['Paid Days',         payslip.paid_days || 30],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', gap: 8, padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
              <span style={{ fontWeight: 700, minWidth: 140, fontSize: 12, color: '#374151' }}>{label}</span>
              <span style={{ fontSize: 12, color: '#1a1a2e' }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Salary table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
          <thead>
            <tr style={{ background: '#126dad', color: '#fff' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 700, borderRadius: '8px 0 0 0' }}>Payable Salary</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, fontWeight: 700 }}>Monthly</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, fontWeight: 700, borderRadius: '0 8px 0 0' }}>Annual</th>
            </tr>
            <tr style={{ background: '#e8f4fc' }}>
              <td style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, color: '#126dad' }}>Gross Earnings</td>
              <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#126dad' }}>{fmt(grossEarnings)}</td>
              <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#126dad' }}>{fmt(grossEarnings * 12)}</td>
            </tr>
          </thead>
          <tbody>
            {earnings.map((e, i) => (
              <tr key={e.label} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                <td style={{ padding: '8px 14px', fontSize: 12, color: '#374151', paddingLeft: 28 }}>{e.label}</td>
                <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 12, color: '#1a1a2e' }}>{fmt(e.monthly)}</td>
                <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 12, color: '#1a1a2e' }}>{fmt(e.annual)}</td>
              </tr>
            ))}

            {/* Deductions section */}
            {deductions.length > 0 && <>
              <tr style={{ background: '#fef2f2' }}>
                <td style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, color: '#ef4444' }}>Deductions</td>
                <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#ef4444' }}>{fmt(totalDeductions)}</td>
                <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#ef4444' }}>{fmt(totalDeductions * 12)}</td>
              </tr>
              {deductions.map((d, i) => (
                <tr key={d.label} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                  <td style={{ padding: '8px 14px', fontSize: 12, color: '#374151', paddingLeft: 28 }}>{d.label}</td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 12, color: '#ef4444' }}>({fmt(d.monthly)})</td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 12, color: '#ef4444' }}>({fmt(d.monthly * 12)})</td>
                </tr>
              ))}
            </>}

            {/* Grand Total */}
            <tr style={{ background: '#126dad' }}>
              <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 800, color: '#fff', borderRadius: '0 0 0 8px' }}>Net Salary Payable</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, fontWeight: 800, color: '#fff' }}>{fmt(netSalary)}</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, fontWeight: 800, color: '#fff', borderRadius: '0 0 8px 0' }}>{fmt(netSalary * 12)}</td>
            </tr>
          </tbody>
        </table>

        {/* Payable statement */}
        <div style={{ fontSize: 12, color: '#374151', marginBottom: 24, padding: '10px 14px', background: '#f0ebfd', borderRadius: 8, border: '1px solid #9b75f120' }}>
          <strong>Salary Payable for {monthName} {payslip.year} = {fmt(netSalary)}</strong>
        </div>

        {/* Bank details + signature */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 }}>Bank Details</div>
            {[
              ['Name',        emp.full_name],
              ['Bank',        payslip.bank_name || '—'],
              ['A/C No',      payslip.account_number || '—'],
              ['Branch',      payslip.branch_name || '—'],
              ['IFSC Code',   payslip.ifsc_code || '—'],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 12, minWidth: 80 }}>{label}:</span>
                <span style={{ fontSize: 12 }}>{value}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'flex-end' }}>
            <div style={{ width: 100, height: 60, border: '1px dashed #e8eaed', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: '#b0b8c1', textAlign: 'center' }}>Company<br/>Stamp</div>
            </div>
            <div style={{ fontSize: 12, color: '#374151', textAlign: 'right' }}>
              <div style={{ fontStyle: 'italic', marginBottom: 2, color: '#6b7280' }}>Authorised Signatory</div>
              <div style={{ fontWeight: 700 }}>For, SporTech Innovation Lab Pvt Ltd</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid #e8eaed', paddingTop: 14 }}>
          <div style={{ fontSize: 11, color: '#126dad', lineHeight: 1.6 }}>
            Office No. Lg - 29, Ground Floor, Synergy Office Space, East Court, Phoenix Market City, Viman Nagar, Pune 411014
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <div style={{ fontSize: 11, color: '#126dad' }}>admin@sportechinnolab.org &nbsp;|&nbsp; +91 62626 32323</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#126dad' }}>www.sportechinnolab.com</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Download button ───────────────────────────────────────────────────────────
export function DownloadPayslipButton({ payslip }) {
  const [loading, setLoading] = useState(false)

  async function download() {
    setLoading(true)
    try {
      if (!window.html2canvas) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script')
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
          s.onload = resolve; s.onerror = reject
          document.head.appendChild(s)
        })
      }
      const el = document.getElementById('payslip-document')
      const canvas = await window.html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false })
      const link = document.createElement('a')
      const emp = payslip.employee || {}
      link.download = `${emp.employee_code || 'EMP'}-${MONTH_NAMES[payslip.month]}-${payslip.year}-Payslip.png`
      link.href = canvas.toDataURL('image/png', 1.0)
      link.click()
    } catch (e) { alert('Download failed. Please try again.') }
    finally { setLoading(false) }
  }

  return (
    <button onClick={download} disabled={loading} style={{
      padding: '10px 20px', borderRadius: 10, border: 'none',
      background: loading ? C.border : C.brand, color: loading ? C.textLight : '#fff',
      fontSize: 13, fontWeight: 700, fontFamily: FONTS.display,
      cursor: loading ? 'not-allowed' : 'pointer',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      {loading ? <><Spinner size={16} color="#fff" /> Generating…</> : '⬇ Download PDF'}
    </button>
  )
}
