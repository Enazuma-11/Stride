// ─── SPORTECH BRAND DESIGN SYSTEM v2 ─────────────────────────────────────────
export const C = {
  brand:       '#126dad',
  brandDark:   '#0d5a94',
  brandLight:  '#e8f4fc',
  brandMid:    '#126dad',
  purple:      '#9b75f1',
  purpleDark:  '#7c5cd4',
  purpleSoft:  '#f0ebfd',
  teal:        '#00d4aa',
  tealDark:    '#00a888',
  tealSoft:    '#e0fff7',
  mint:        '#00ffb0',
  mintSoft:    '#e0fff7',
  lime:        '#a4ff3d',
  limeDark:    '#7acc1e',
  limeSoft:    '#f2ffe0',
  gradient:    'linear-gradient(135deg, #9b75f1 0%, #126dad 35%, #00d4aa 70%, #a4ff3d 100%)',
  gradientH:   'linear-gradient(90deg, #9b75f1 0%, #126dad 35%, #00d4aa 70%, #a4ff3d 100%)',
  gradientSoft:'linear-gradient(135deg, #f0ebfd 0%, #e8f4fc 50%, #e0fff7 100%)',
  sidebar:     '#0a0e1a',
  green:       '#00b894',
  greenSoft:   '#e0fff2',
  amber:       '#f59e0b',
  amberSoft:   '#fef3c7',
  accent:      '#ef4444',
  accentSoft:  '#fef2f2',
  text:        '#1a1a2e',
  textMid:     '#374151',
  textLight:   '#6b7280',
  bg:          '#f5f7fa',
  surface:     '#ffffff',
  surfaceAlt:  '#f9fafb',
  border:      '#e8eaed',
  shadow:      '0 1px 3px rgba(26,26,46,0.06), 0 1px 2px rgba(26,26,46,0.04)',
  shadowMd:    '0 4px 16px rgba(26,26,46,0.08)',
  shadowLg:    '0 8px 32px rgba(26,26,46,0.10)',
  shadowGrad:  '0 8px 40px rgba(155,117,241,0.15)',
  shadowTeal:  '0 4px 14px rgba(0,212,170,0.3)',
}

export const FONTS = {
  display: "'Plus Jakarta Sans', sans-serif",
  body:    "'Inter', sans-serif",
  mono:    "'JetBrains Mono', monospace",
}

export const LEAVE_TYPES = [
  { id: 'earned',      label: 'Earned Leave',        color: C.brand,     total: 18  },
  { id: 'casual_sick', label: 'Casual / Sick Leave',  color: C.purple,    total: 12  },
  { id: 'statutory',   label: 'Statutory Holiday',    color: '#0891b2',   total: 10  },
  { id: 'maternity',   label: 'Maternity Leave',      color: '#db2777',   total: 182 },
  { id: 'bereavement', label: 'Bereavement Leave',    color: C.textLight, total: 7   },
  { id: 'exam',        label: 'Exam / Study Leave',   color: C.limeDark,  total: 7   },
]

export const FEMALE_ONLY_LEAVES = ['maternity']

export const LEAVE_BALANCES_BY_TYPE = {
  permanent: [
    { leave_type: 'earned',      total_days: 18 },
    { leave_type: 'casual_sick', total_days: 12 },
    { leave_type: 'statutory',   total_days: 10 },
    { leave_type: 'bereavement', total_days: 7  },
    { leave_type: 'exam',        total_days: 7  },
  ],
  intern:     [{ leave_type: 'casual_sick', total_days: 12 }],
  contractor: [{ leave_type: 'casual_sick', total_days: 12 }, { leave_type: 'earned', total_days: 9 }],
  parttime:   [{ leave_type: 'casual_sick', total_days: 6  }, { leave_type: 'earned', total_days: 9 }],
}

export const ATTENDANCE_STATUSES = [
  { value: 'present',   label: 'Present',   color: '#00b894', bg: '#e0fff2',   icon: '✅' },
  { value: 'wfh',       label: 'WFH',       color: C.brand,   bg: C.brandLight,icon: '🏠' },
  { value: 'half_day',  label: 'Half Day',  color: C.amber,   bg: C.amberSoft, icon: '🌗' },
  { value: 'late_mark', label: 'Late Mark', color: C.purple,  bg: C.purpleSoft,icon: '⏰' },
  { value: 'leave',     label: 'On Leave',  color: '#0891b2', bg: '#e0f2fe',   icon: '🏖️' },
  { value: 'absent',    label: 'Absent',    color: C.accent,  bg: C.accentSoft,icon: '❌' },
]

export const WORK_START_HOUR   = 9
export const LATE_MARK_MINUTES = 30
export const FULL_DAY_HOURS    = 8
export const HALF_DAY_HOURS    = 4

export const WORK_HOURS_BY_TYPE = {
  permanent:  { fullDay: 8,   halfDay: 4    },
  parttime:   { fullDay: 8,   halfDay: 4    },
  contractor: { fullDay: 5.5, halfDay: 2.75 },
  intern:     { fullDay: 5.5, halfDay: 2.75 },
}

export const MAX_SESSIONS_PER_DAY = 5

export const EMPLOYEE_TYPES = [
  { value: 'permanent',  label: 'Permanent Employee' },
  { value: 'intern',     label: 'Intern'             },
  { value: 'contractor', label: 'Contractor'         },
  { value: 'parttime',   label: 'Part-time'          },
]

export const REQUIRES_COMPANY_EMAIL = ['permanent', 'parttime']
export const COMPANY_DOMAIN = 'sportechinnolab.org'

export const DEPARTMENTS = [
  'Engineering','Product','Design','Marketing','Sales','Operations',
  'Human Resources','Finance','Legal','Leadership','Customer Success','Data & Analytics',
]

export const ROLE_TYPES = [
  { value: 'employee', label: 'Employee'   },
  { value: 'hr',       label: 'HR Manager' },
  { value: 'admin',    label: 'Admin'      },
]

export const GENDERS = [
  { value: 'male',             label: 'Male'             },
  { value: 'female',           label: 'Female'           },
  { value: 'non_binary',       label: 'Non-binary'       },
  { value: 'prefer_not_to_say',label: 'Prefer not to say'},
]

export const NOTIFICATION_TYPES = {
  birthday_today:     { icon: '🎂', label: 'Birthday',         color: '#DB2777' },
  birthday_tomorrow:  { icon: '🎁', label: 'Birthday Tomorrow', color: '#DB2777' },
  holiday_upcoming:   { icon: '🎉', label: 'Upcoming Holiday',  color: '#0891b2' },
  leave_approved:     { icon: '✅', label: 'Leave Approved',    color: '#00b894' },
  leave_rejected:     { icon: '❌', label: 'Leave Rejected',    color: '#ef4444' },
  announcement:       { icon: '📣', label: 'Announcement',      color: '#126dad' },
  attendance_missing: { icon: '⏰', label: 'Attendance Alert',  color: '#f59e0b' },
  onboarding:         { icon: '👋', label: 'Welcome',           color: '#9b75f1' },
}

export const HOLIDAYS_2026 = [
  { date: '2026-01-26', name: 'Republic Day',           type: 'mandatory' },
  { date: '2026-03-02', name: 'Holi',                   type: 'optional'  },
  { date: '2026-03-30', name: 'Ram Navami',              type: 'optional'  },
  { date: '2026-04-02', name: 'Good Friday',             type: 'optional'  },
  { date: '2026-04-14', name: 'Dr. Ambedkar Jayanti',    type: 'optional'  },
  { date: '2026-05-01', name: 'Maharashtra Day',          type: 'mandatory' },
  { date: '2026-06-02', name: 'Eid ul-Adha',             type: 'optional'  },
  { date: '2026-07-06', name: 'Muharram',                type: 'optional'  },
  { date: '2026-08-15', name: 'Independence Day',         type: 'mandatory' },
  { date: '2026-08-26', name: 'Janmashtami',              type: 'optional'  },
  { date: '2026-09-06', name: 'Ganesh Chaturthi',         type: 'optional'  },
  { date: '2026-10-02', name: 'Gandhi Jayanti',           type: 'mandatory' },
  { date: '2026-10-07', name: 'Dussehra',                type: 'optional'  },
  { date: '2026-10-20', name: 'Diwali - Laxmi Puja',     type: 'optional'  },
  { date: '2026-10-21', name: 'Diwali - Bali Pratipada', type: 'optional'  },
  { date: '2026-11-05', name: 'Guru Nanak Jayanti',       type: 'optional'  },
  { date: '2026-11-25', name: 'Id-E-Milad',               type: 'optional'  },
  { date: '2026-12-25', name: 'Christmas',                type: 'optional'  },
]
