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
  teal:       '#0E7490',
  tealSoft:   '#ECFEFF',
  pink:       '#9D174D',
  pinkSoft:   '#FCE7F3',
  shadow:     '0 1px 3px rgba(29,53,87,0.08), 0 1px 2px rgba(29,53,87,0.04)',
  shadowMd:   '0 4px 16px rgba(29,53,87,0.10)',
}

// ─── LEAVE TYPES — Full-time permanent employees ──────────────
export const LEAVE_TYPES = [
  { id: 'earned',      label: 'Earned Leave',      total: 18,  color: C.green,   info: 'Accrued leave for rest & vacation'         },
  { id: 'casual_sick', label: 'Casual / Sick Leave',total: 12,  color: C.brand,   info: 'For personal needs or illness'             },
  { id: 'statutory',   label: 'Statutory Leave',    total: 10,  color: C.teal,    info: 'Choose 6 optional + 4 mandatory holidays'  },
  { id: 'maternity',   label: 'Maternity Leave',    total: 182, color: C.pink,    info: '26 weeks as per Maternity Benefit Act'     },
  { id: 'bereavement', label: 'Bereavement Leave',  total: 7,   color: '#6B7280', info: 'For loss of immediate family member'       },
  { id: 'exam',        label: 'Exam Leave',         total: 7,   color: C.purple,  info: 'For professional or academic examinations' },
]

// ─── LEAVE TYPES — Interns (1 paid leave per month = 12/year) ─
export const INTERN_LEAVE_TYPES = [
  { id: 'casual_sick', label: 'Paid Leave', total: 12, color: C.brand, info: '1 paid leave per month' },
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

// ─── LEAVE BALANCES BY EMPLOYEE TYPE ─────────────────────────
export const LEAVE_BALANCES_BY_TYPE = {
  permanent: [
    { leave_type: 'earned',      total_days: 18  },
    { leave_type: 'casual_sick', total_days: 12  },
    { leave_type: 'statutory',   total_days: 10  },
    { leave_type: 'maternity',   total_days: 182 },
    { leave_type: 'bereavement', total_days: 7   },
    { leave_type: 'exam',        total_days: 7   },
  ],
  intern: [
    { leave_type: 'casual_sick', total_days: 12 },
  ],
  contractor: [
    { leave_type: 'casual_sick', total_days: 12 },
    { leave_type: 'earned',      total_days: 9  },
  ],
  parttime: [
    { leave_type: 'casual_sick', total_days: 6  },
    { leave_type: 'earned',      total_days: 9  },
  ],
}

// ─── HOLIDAYS 2026 ────────────────────────────────────────────
// 4 Mandatory + employee picks 6 from Optional (10 statutory total)
export const HOLIDAYS_2026 = [
  { date: '2026-01-14', name: 'Pongal / Makar Sankranti',          type: 'optional'  },
  { date: '2026-01-26', name: 'Republic Day',                       type: 'mandatory' },
  { date: '2026-02-19', name: 'Chhatrapati Shivaji Maharaj Jayanti',type: 'optional'  },
  { date: '2026-03-03', name: 'Holi',                               type: 'optional'  },
  { date: '2026-03-19', name: 'Gudi Padwa',                         type: 'optional'  },
  { date: '2026-03-20', name: 'Parsi New Year',                     type: 'optional'  },
  { date: '2026-03-26', name: 'Ram Navami',                         type: 'optional'  },
  { date: '2026-03-31', name: 'Mahavir Jayanti',                    type: 'optional'  },
  { date: '2026-04-03', name: 'Good Friday',                        type: 'optional'  },
  { date: '2026-04-14', name: 'Dr Babasaheb Ambedkar Jayanti',      type: 'optional'  },
  { date: '2026-05-01', name: 'Maharashtra Day & Labour Day',        type: 'mandatory' },
  { date: '2026-05-28', name: 'Bakrid / Id-ul-Zuha',                type: 'optional'  },
  { date: '2026-06-26', name: 'Muharram',                           type: 'optional'  },
  { date: '2026-08-15', name: 'Independence Day',                   type: 'mandatory' },
  { date: '2026-08-26', name: 'Id-e-Milad',                         type: 'optional'  },
  { date: '2026-09-14', name: 'Ganesh Chaturthi',                   type: 'optional'  },
  { date: '2026-10-02', name: 'Mahatma Gandhi Jayanti',             type: 'mandatory' },
  { date: '2026-10-20', name: 'Dasara (Vijaya Dashami)',            type: 'optional'  },
  { date: '2026-11-09', name: 'Govardhan Pooja',                    type: 'optional'  },
  { date: '2026-11-10', name: 'Bhai Dooj',                          type: 'optional'  },
  { date: '2026-11-24', name: 'Guru Nanak Jayanti',                 type: 'optional'  },
  { date: '2026-12-25', name: 'Christmas',                          type: 'optional'  },
]

export const MANDATORY_HOLIDAYS = HOLIDAYS_2026.filter(h => h.type === 'mandatory')
export const OPTIONAL_HOLIDAYS  = HOLIDAYS_2026.filter(h => h.type === 'optional')
export const OPTIONAL_HOLIDAY_PICKS = 6   // employee must choose 6 from optional list

// ─── ATTENDANCE ───────────────────────────────────────────────
export const WORK_START_HOUR   = 9
export const WORK_END_HOUR     = 18
export const FULL_DAY_HOURS    = 8
export const HALF_DAY_HOURS    = 4
export const LATE_MARK_MINUTES = 30

export const ATTENDANCE_STATUSES = [
  { value: 'present',   label: 'Present',   color: '#2D6A4F', bg: '#EBF5F0', icon: '✅' },
  { value: 'wfh',       label: 'WFH',       color: '#1D3557', bg: '#EAF0F7', icon: '🏠' },
  { value: 'half_day',  label: 'Half Day',  color: '#B45309', bg: '#FEF3C7', icon: '🌓' },
  { value: 'late_mark', label: 'Late Mark', color: '#9A3412', bg: '#FFF7ED', icon: '⏰' },
  { value: 'leave',     label: 'On Leave',  color: '#6D28D9', bg: '#EDE9FE', icon: '🏖️' },
  { value: 'holiday',   label: 'Holiday',   color: '#0E7490', bg: '#ECFEFF', icon: '🎉' },
  { value: 'absent',    label: 'Absent',    color: '#E63946', bg: '#FDF0F1', icon: '❌' },
  { value: 'weekend',   label: 'Weekend',   color: '#A8A69F', bg: '#F5F4F0', icon: '📅' },
]

// ─── GENDER ───────────────────────────────────────────────────
export const GENDERS = [
  { value: 'male',              label: 'Male'               },
  { value: 'female',            label: 'Female'             },
  { value: 'non_binary',        label: 'Non-binary'         },
  { value: 'prefer_not_to_say', label: 'Prefer not to say'  },
]

// Leave types that are gender-restricted
export const FEMALE_ONLY_LEAVES = ['maternity']
