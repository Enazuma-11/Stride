import { useEffect, useState } from 'react'
import AppShell from '../../components/layout/AppShell'
import { Card, Badge, Spinner, EmptyState, Button } from '../../components/ui'
import { C, FONTS } from '../../lib/constants'
import { useAuth } from '../../context/AuthContext'
import { getMyPayslips, calcPayslipTotals, MONTH_NAMES } from '../../lib/api.payslips'
import { PayslipDocument, DownloadPayslipButton } from '../../components/PayslipDocument'

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`

export default function PayslipsPage() {
  const { employee } = useAuth()
  const [payslips,  setPayslips]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [selected,  setSelected]  = useState(null)

  useEffect(() => {
    if (!employee) return
    getMyPayslips(employee.id)
      .then(data => { setPayslips(data); if (data.length > 0) setSelected(data[0]) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [employee])

  return (
    <AppShell title="Payslips" subtitle="View and download your monthly salary slips">
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={32} /></div>
      ) : payslips.length === 0 ? (
        <EmptyState icon="💰" title="No payslips yet" subtitle="Your payslips will appear here once HR generates them." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 20, alignItems: 'start' }}>
          {/* Left: payslip list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
              Your Payslips
            </div>
            {payslips.map(p => {
              const { netSalary } = calcPayslipTotals(p)
              const isSelected = selected?.id === p.id
              return (
                <div key={p.id} onClick={() => setSelected(p)} style={{
                  padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                  background: isSelected ? C.brandLight : C.surface,
                  border: `1.5px solid ${isSelected ? C.brand : C.border}`,
                  transition: 'all 0.15s',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: isSelected ? C.brand : C.text, fontFamily: FONTS.display }}>
                    {MONTH_NAMES[p.month]} {p.year}
                  </div>
                  <div style={{ fontSize: 12, color: isSelected ? C.brand : C.textLight, marginTop: 2 }}>
                    {fmt(netSalary)}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Right: payslip view */}
          {selected && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>
                    {MONTH_NAMES[selected.month]} {selected.year} Payslip
                  </div>
                  <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>
                    Generated {new Date(selected.generated_at).toLocaleDateString('en-IN')}
                  </div>
                </div>
                <DownloadPayslipButton payslip={{ ...selected, employee }} />
              </div>
              <div style={{ overflowX: 'auto', borderRadius: 14, border: `1px solid ${C.border}`, boxShadow: C.shadow }}>
                <PayslipDocument payslip={{ ...selected, employee }} />
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  )
}
