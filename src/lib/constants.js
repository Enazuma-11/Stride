export const C = {
  bg:         '#F5F4F0',
  surface:    '#FFFFFF',
  surfaceAlt: '#FAFAF8',
  border:     '#E4E2DC',
  borderDark: '#D0CDCA',
  text:       '#1A1916',
  textMid:    '#6B6860',
  textLight:  '#A8A69F',
  brand:      '#1D3557',
  brandMid:   '#2B4E7A',
  brandLight: '#EAF0F7',
  accent:     '#E63946',
  accentSoft: '#FDF0F1',
  green:      '#2D6A4F',
  greenSoft:  '#EBF5F0',
  amber:      '#B45309',
  amberSoft:  '#FEF3C7',
  purple:     '#6D28D9',
  purpleSoft: '#EDE9FE',
  shadow:     '0 1px 3px rgba(29,53,87,0.08), 0 1px 2px rgba(29,53,87,0.04)',
  shadowMd:   '0 4px 16px rgba(29,53,87,0.10)',
}

export const LEAVE_TYPES = [
  { id: 'casual',  label: 'Casual Leave',  total: 12, color: C.brand },
  { id: 'sick',    label: 'Sick Leave',    total: 8,  color: '#7B2D8B' },
  { id: 'earned',  label: 'Earned Leave',  total: 15, color: C.green },
  { id: 'comp',    label: 'Comp Off',      total: 4,  color: C.amber },
]

// Intern leave balances are different (fewer days, no earned leave)
export const INTERN_LEAVE_TYPES = [
  { id: 'casual', label: 'Casual Leave', total: 6,  color: C.brand },
  { id: 'sick',   label: 'Sick Leave',   total: 4,  color: '#7B2D8B' },
]

export const EMPLOYEE_TYPES = [
  { value: 'permanent',  label: 'Permanent Employee', icon: '👔' },
  { value: 'intern',     label: 'Intern',             icon: '🎓' },
  { value: 'contractor', label: 'Contractor',         icon: '📋' },
  { value: 'parttime',   label: 'Part-time',          icon: '⏱️'  },
]

export const COMPANY_DOMAIN = 'sportechinnolab.org'

export const DEPARTMENTS = [
  'Engineering', 'Design', 'Product', 'Marketing',
  'Sales', 'Operations', 'HR', 'Finance', 'Other',
]

export const ROLE_TYPES = [
  { value: 'employee', label: 'Employee' },
  { value: 'manager',  label: 'Manager'  },
  { value: 'hr',       label: 'HR'       },
  { value: 'admin',    label: 'Admin'    },
]

// Which employee types require a company email
export const REQUIRES_COMPANY_EMAIL = ['permanent', 'parttime']

// Leave balances by employee type
export const LEAVE_BALANCES_BY_TYPE = {
  permanent:  [
    { leave_type: 'casual', total_days: 12 },
    { leave_type: 'sick',   total_days: 8  },
    { leave_type: 'earned', total_days: 15 },
    { leave_type: 'comp',   total_days: 4  },
  ],
  intern: [
    { leave_type: 'casual', total_days: 6 },
    { leave_type: 'sick',   total_days: 4 },
  ],
  contractor: [
    { leave_type: 'casual', total_days: 6  },
    { leave_type: 'sick',   total_days: 4  },
    { leave_type: 'comp',   total_days: 2  },
  ],
  parttime: [
    { leave_type: 'casual', total_days: 6 },
    { leave_type: 'sick',   total_days: 4 },
  ],
}
