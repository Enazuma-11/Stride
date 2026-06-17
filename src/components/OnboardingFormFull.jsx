import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { C, FONTS } from '../lib/constants'
import { Alert, Spinner } from './ui'
import { uploadProfilePhoto } from '../lib/api.profile'
import { useAuth } from '../context/AuthContext'

const STEPS = [
  { id: 1, title: 'Personal Info',     icon: '👤', desc: 'Basic personal details' },
  { id: 2, title: 'Contact & Address', icon: '📍', desc: 'Where you live' },
  { id: 3, title: 'Bank & Compliance', icon: '🏦', desc: 'Payment & tax details' },
  { id: 4, title: 'Documents',         icon: '📄', desc: 'Upload required files' },
]

const TSHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']

const DOC_TYPES = [
  { key: 'profile_photo',       label: 'Profile Photo',                    desc: 'Passport-sized photo for company records', required: true,  accept: 'image/*',       maxMB: 5  },
  { key: 'education_cert',      label: 'Education Certificate',            desc: 'Copies of your academic certificates/degrees', required: true, accept: '.pdf,image/*', maxMB: 10 },
  { key: 'experience_cert',     label: 'Experience Certificate',           desc: 'Previous employment certificates (if applicable)', required: false, accept: '.pdf,image/*', maxMB: 10 },
  { key: 'resume',              label: 'Resume / CV',                      desc: 'Your updated resume', required: true, accept: '.pdf,image/*', maxMB: 10 },
  { key: 'bank_proof',          label: 'Bank Account Proof',               desc: 'Cancelled cheque / passbook / screenshot', required: true, accept: '.pdf,image/*', maxMB: 10 },
  { key: 'offer_letter',        label: 'Signed Offer Letter',              desc: 'Your signed copy of the offer letter', required: true, accept: '.pdf,image/*', maxMB: 10 },
  { key: 'prev_offer_letter',   label: 'Previous Company Offer Letter',    desc: 'If applicable', required: false, accept: '.pdf', maxMB: 10 },
  { key: 'prev_salary_slips',   label: 'Last 3 Months Salary Slips',      desc: 'From previous employer, if applicable', required: false, accept: '.pdf', maxMB: 10 },
]

function StepIndicator({ currentStep }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, marginBottom: 32 }}>
      {STEPS.map((step, i) => (
        <div key={step.id} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: '50%',
              background: currentStep > step.id ? C.green
                : currentStep === step.id ? C.brand : C.border,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: currentStep > step.id ? 18 : 14,
              color: currentStep >= step.id ? '#fff' : C.textLight,
              fontWeight: 700, transition: 'all 0.3s',
              boxShadow: currentStep === step.id ? `0 0 0 4px ${C.brand}25` : 'none',
            }}>
              {currentStep > step.id ? '✓' : step.icon}
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: currentStep === step.id ? C.brand : C.textLight, textAlign: 'center', maxWidth: 70 }}>
              {step.title}
            </div>
          </div>
          {i < STEPS.length - 1 && (
            <div style={{ width: 48, height: 2, background: currentStep > step.id ? C.green : C.border, margin: '0 4px', marginBottom: 20, transition: 'background 0.3s' }} />
          )}
        </div>
      ))}
    </div>
  )
}

function FieldGroup({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.brand, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 14, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, required, children, hint }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: 'block', marginBottom: 6, fontFamily: FONTS.body }}>
        {label} {required && <span style={{ color: '#ef4444' }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

function TextInput({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none', color: C.text, background: C.surface }}
      onFocus={e => e.target.style.borderColor = C.teal}
      onBlur={e => e.target.style.borderColor = C.border}
    />
  )
}

function RadioGroup({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map(opt => (
        <button key={opt} onClick={() => onChange(opt)} style={{
          padding: '8px 16px', borderRadius: 20,
          border: `1.5px solid ${value === opt ? C.brand : C.border}`,
          background: value === opt ? C.brandLight : C.surface,
          color: value === opt ? C.brand : C.textMid,
          fontSize: 13, fontWeight: value === opt ? 700 : 400,
          cursor: 'pointer', fontFamily: FONTS.body, transition: 'all 0.15s',
        }}>
          {opt}
        </button>
      ))}
    </div>
  )
}

function FileUploadField({ docType, file, onChange }) {
  const ref = useRef()
  return (
    <div style={{
      border: `1.5px dashed ${file ? C.green : C.border}`,
      borderRadius: 12, padding: '16px', textAlign: 'center',
      background: file ? C.greenSoft : C.surfaceAlt,
      cursor: 'pointer', transition: 'all 0.2s',
    }} onClick={() => ref.current?.click()}>
      <input ref={ref} type="file" accept={docType.accept} style={{ display: 'none' }}
        onChange={e => onChange(e.target.files[0])} />
      {file ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>✅</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.green }}>{file.name}</div>
            <div style={{ fontSize: 11, color: C.textLight }}>{(file.size / 1024 / 1024).toFixed(2)} MB</div>
          </div>
          <button onClick={e => { e.stopPropagation(); onChange(null) }}
            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, marginLeft: 8 }}>✕</button>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 24, marginBottom: 6 }}>📎</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 2 }}>{docType.label}</div>
          <div style={{ fontSize: 11, color: C.textLight, marginBottom: 6 }}>{docType.desc}</div>
          <div style={{ fontSize: 11, color: C.brand, fontWeight: 600 }}>
            Click to upload · {docType.accept === 'image/*' ? 'Image only' : 'PDF or Image'} · Max {docType.maxMB}MB
          </div>
          {docType.required && <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 700 }}>REQUIRED</span>}
        </div>
      )}
    </div>
  )
}

export default function OnboardingForm() {
  const { employee, refetchEmployee } = useAuth()
  const navigate = useNavigate()
  const [step, setStep]     = useState(1)
  const [error, setError]   = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // Step 1 — Personal
  const [firstName,    setFirstName]    = useState(employee?.full_name?.split(' ')[0] || '')
  const [lastName,     setLastName]     = useState(employee?.full_name?.split(' ').slice(1).join(' ') || '')
  const [nickName,     setNickName]     = useState('')
  const [gender,       setGender]       = useState(employee?.gender || '')
  const [dob,          setDob]          = useState('')
  const [fatherName,   setFatherName]   = useState('')
  const [motherName,   setMotherName]   = useState('')
  const [maritalStatus,setMaritalStatus]= useState('')
  const [hobbies,      setHobbies]      = useState('')
  const [tshirtSize,   setTshirtSize]   = useState('')
  const [sportsInterest,setSportsInterest] = useState('')

  // Step 2 — Contact & Address
  const [phone,        setPhone]        = useState(employee?.phone || '')
  const [presentAddr,  setPresentAddr]  = useState('')
  const [presentCity,  setPresentCity]  = useState('')
  const [presentState, setPresentState] = useState('')
  const [presentPin,   setPresentPin]   = useState('')
  const [sameAddress,  setSameAddress]  = useState(false)
  const [permAddr,     setPermAddr]     = useState('')
  const [permCity,     setPermCity]     = useState('')
  const [permState,    setPermState]    = useState('')
  const [permPin,      setPermPin]      = useState('')

  // Step 3 — Bank & Compliance
  const [bankName,     setBankName]     = useState('')
  const [accountNo,    setAccountNo]    = useState('')
  const [branchName,   setBranchName]   = useState('')
  const [ifscCode,     setIfscCode]     = useState('')
  const [panNumber,    setPanNumber]    = useState('')
  const [aadhaarNo,    setAadhaarNo]    = useState('')

  // Step 4 — Documents
  const [files, setFiles] = useState({})
  const setFile = key => file => setFiles(f => ({ ...f, [key]: file }))

  function validateStep() {
    setError('')
    if (step === 1) {
      if (!firstName.trim()) return 'First name is required.'
      if (!lastName.trim())  return 'Last name is required.'
      if (!gender)           return 'Please select your gender.'
      if (!dob)              return 'Date of birth is required.'
      if (!fatherName.trim())return "Father's name is required."
      if (!motherName.trim())return "Mother's name is required."
      if (!tshirtSize)       return 'Please select your T-shirt size.'
    }
    if (step === 2) {
      if (!phone.trim())       return 'Phone number is required.'
      if (!presentAddr.trim()) return 'Present address is required.'
      if (!presentCity.trim()) return 'City is required.'
      if (!presentPin.trim())  return 'Pincode is required.'
      if (!sameAddress) {
        if (!permAddr.trim())  return 'Permanent address is required.'
        if (!permCity.trim())  return 'Permanent city is required.'
        if (!permPin.trim())   return 'Permanent pincode is required.'
      }
    }
    if (step === 3) {
      if (!bankName.trim())  return 'Bank name is required.'
      if (!accountNo.trim()) return 'Account number is required.'
      if (!branchName.trim())return 'Branch name is required.'
      if (!ifscCode.trim())  return 'IFSC code is required.'
      if (!panNumber.trim()) return 'PAN number is required.'
    }
    if (step === 4) {
      const requiredDocs = DOC_TYPES.filter(d => d.required)
      for (const doc of requiredDocs) {
        if (!files[doc.key]) return `Please upload: ${doc.label}`
      }
    }
    return null
  }

  function handleNext() {
    const err = validateStep()
    if (err) { setError(err); return }
    setError('')
    setStep(s => s + 1)
    window.scrollTo(0, 0)
  }

  async function handleSubmit() {
    const err = validateStep()
    if (err) { setError(err); return }
    setSaving(true); setError('')
    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`
      const presentAddress = { line1: presentAddr, city: presentCity, state: presentState, pincode: presentPin }
      const permanentAddress = sameAddress ? presentAddress : { line1: permAddr, city: permCity, state: permState, pincode: permPin }

      // 1. Update employee record
      const { error: empErr } = await supabase
        .from('employees')
        .update({
          full_name:         fullName,
          nick_name:         nickName || null,
          gender,
          date_of_birth:     dob,
          father_name:       fatherName,
          mother_name:       motherName,
          marital_status:    maritalStatus || null,
          hobbies:           hobbies || null,
          tshirt_size:       tshirtSize,
          sports_interests:  sportsInterest || null,
          phone,
          present_address:   presentAddress,
          permanent_address: permanentAddress,
          pan_number:        panNumber || null,
          aadhaar_number:    aadhaarNo || null,
          avatar_initials:   `${firstName[0]}${lastName[0]}`.toUpperCase(),
          onboarding_completed:        true,
          onboarding_form_submitted:   true,
          onboarding_submitted_at:     new Date().toISOString(),
          onboarding_status:           'active',
        })
        .eq('user_id', (await supabase.auth.getUser()).data.user.id)
      if (empErr) throw empErr

      // 2. Save payroll / bank details
      await supabase.from('employee_payroll').upsert({
        employee_id:    employee.id,
        bank_name:      bankName,
        account_number: accountNo,
        branch_name:    branchName,
        ifsc_code:      ifscCode,
      }, { onConflict: 'employee_id' })

      // 3. Save compliance (PAN, Aadhaar)
      await supabase.from('employee_compliance').upsert({
        employee_id:    employee.id,
        pan_number:     panNumber,
        aadhaar_number: aadhaarNo,
      }, { onConflict: 'employee_id' })

      // 4. Upload profile photo
      if (files.profile_photo) {
        await uploadProfilePhoto(employee.id, files.profile_photo)
      }

      // 5. Upload other documents
      const docUploadMap = {
        education_cert:    'education_certificate',
        experience_cert:   'experience_certificate',
        resume:            'resume',
        bank_proof:        'bank_proof',
        offer_letter:      'offer_letter',
        prev_offer_letter: 'prev_offer_letter',
        prev_salary_slips: 'prev_salary_slips',
      }

      for (const [fileKey, docType] of Object.entries(docUploadMap)) {
        if (!files[fileKey]) continue
        const file = files[fileKey]
        const ext  = file.name.split('.').pop()
        const path = `${employee.id}/documents/${docType}.${ext}`
        await supabase.storage.from('employee-documents').upload(path, file, { upsert: true })

        const { data: signed } = await supabase.storage
          .from('employee-documents')
          .createSignedUrl(path, 60 * 60 * 24 * 365)

        if (signed?.signedUrl) {
          await supabase.from('employee_documents').upsert({
            employee_id:   employee.id,
            document_type: docType,
            file_url:      signed.signedUrl,
            file_name:     file.name,
            uploaded_at:   new Date().toISOString(),
          }, { onConflict: 'employee_id,document_type' })
        }
      }

      // 6. Notify HR
      const { data: hrList } = await supabase
        .from('employees')
        .select('id')
        .in('role_type', ['hr', 'admin'])
        .eq('status', 'active')

      if (hrList?.length) {
        await supabase.from('notifications').insert(
          hrList.map(hr => ({
            employee_id: hr.id,
            type: 'onboarding',
            title: 'Onboarding Form Submitted',
            message: `${fullName} has completed the onboarding form. Please review their profile.`,
          }))
        )
      }

      await refetchEmployee()
      navigate('/dashboard')
    } catch (e) {
      console.error(e)
      setError(e.message || 'Something went wrong. Please try again.')
    } finally { setSaving(false) }
  }

  const currentStepInfo = STEPS[step - 1]

  return (
    <div style={{
      minHeight: '100vh', background: C.bg,
      fontFamily: FONTS.body,
    }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap'); * { box-sizing: border-box; } @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }`}</style>

      {/* Top bar */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: C.shadow }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: C.gradientH, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <img src="/logo.png" style={{ width: 34, height: 34, objectFit: 'contain' }} onError={e => e.target.style.display='none'} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.text, fontFamily: FONTS.display }}>SporTech Stride</div>
          <div style={{ fontSize: 11, color: C.textLight }}>Employee Onboarding</div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: C.textLight }}>
          Welcome, <strong style={{ color: C.text }}>{employee?.full_name}</strong>
        </div>
      </div>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.text, fontFamily: FONTS.display, marginBottom: 6 }}>
            👋 Welcome to SporTech!
          </div>
          <div style={{ fontSize: 14, color: C.textLight, lineHeight: 1.6 }}>
            Please complete this onboarding form to get started.<br />
            All fields marked <span style={{ color: '#ef4444' }}>*</span> are required.
          </div>
        </div>

        {/* Step indicator */}
        <StepIndicator currentStep={step} />

        {/* Card */}
        <div style={{ background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, padding: '28px 28px', boxShadow: C.shadowMd, animation: 'fadeUp 0.3s ease' }}>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.text, fontFamily: FONTS.display, marginBottom: 4 }}>
              {currentStepInfo.icon} {currentStepInfo.title}
            </div>
            <div style={{ fontSize: 12, color: C.textLight }}>{currentStepInfo.desc}</div>
          </div>

          {/* ── STEP 1: Personal ── */}
          {step === 1 && (
            <>
              <FieldGroup title="Name">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="First Name" required><TextInput value={firstName} onChange={setFirstName} placeholder="Amit" /></Field>
                  <Field label="Last Name" required><TextInput value={lastName} onChange={setLastName} placeholder="Chobitkar" /></Field>
                </div>
                <Field label="Nick Name / Preferred Name" hint="What would you like to be called?">
                  <TextInput value={nickName} onChange={setNickName} placeholder="e.g. Ammo" />
                </Field>
              </FieldGroup>

              <FieldGroup title="Personal Details">
                <Field label="Gender" required>
                  <RadioGroup options={['Male', 'Female', 'Non-binary', 'Prefer not to say']} value={gender} onChange={setGender} />
                </Field>
                <Field label="Date of Birth" required>
                  <input type="date" value={dob} onChange={e => setDob(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: FONTS.body, outline: 'none', color: C.text }} />
                </Field>
                <Field label="Marital Status">
                  <RadioGroup options={['Single', 'Married', 'Divorced', 'Widowed', 'Prefer not to say']} value={maritalStatus} onChange={setMaritalStatus} />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="Father's Name" required><TextInput value={fatherName} onChange={setFatherName} placeholder="Father's full name" /></Field>
                  <Field label="Mother's Name" required><TextInput value={motherName} onChange={setMotherName} placeholder="Mother's full name" /></Field>
                </div>
              </FieldGroup>

              <FieldGroup title="Fun Stuff 🎉">
                <Field label="Your Hobbies" required>
                  <TextInput value={hobbies} onChange={setHobbies} placeholder="e.g. Reading, Trekking, Photography" />
                </Field>
                <Field label="Sports you play or follow">
                  <TextInput value={sportsInterest} onChange={setSportsInterest} placeholder="e.g. Cricket, Football, Badminton" />
                </Field>
                <Field label="T-Shirt Size" required hint="For company merchandise and events">
                  <RadioGroup options={TSHIRT_SIZES} value={tshirtSize} onChange={setTshirtSize} />
                </Field>
              </FieldGroup>
            </>
          )}

          {/* ── STEP 2: Contact & Address ── */}
          {step === 2 && (
            <>
              <FieldGroup title="Contact">
                <Field label="Phone Number" required>
                  <TextInput value={phone} onChange={setPhone} placeholder="+91 98765 43210" type="tel" />
                </Field>
              </FieldGroup>

              <FieldGroup title="Present Address">
                <Field label="Street Address" required>
                  <TextInput value={presentAddr} onChange={setPresentAddr} placeholder="Flat/House No, Street, Area" />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="City" required><TextInput value={presentCity} onChange={setPresentCity} placeholder="Pune" /></Field>
                  <Field label="Pincode" required><TextInput value={presentPin} onChange={setPresentPin} placeholder="411014" /></Field>
                </div>
                <Field label="State">
                  <TextInput value={presentState} onChange={setPresentState} placeholder="Maharashtra" />
                </Field>
              </FieldGroup>

              <FieldGroup title="Permanent Address">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textMid, cursor: 'pointer', marginBottom: 8 }}>
                  <input type="checkbox" checked={sameAddress} onChange={e => setSameAddress(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: C.brand }} />
                  Same as present address
                </label>
                {!sameAddress && (
                  <>
                    <Field label="Street Address" required>
                      <TextInput value={permAddr} onChange={setPermAddr} placeholder="Flat/House No, Street, Area" />
                    </Field>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <Field label="City" required><TextInput value={permCity} onChange={setPermCity} placeholder="Nagpur" /></Field>
                      <Field label="Pincode" required><TextInput value={permPin} onChange={setPermPin} placeholder="440001" /></Field>
                    </div>
                    <Field label="State">
                      <TextInput value={permState} onChange={setPermState} placeholder="Maharashtra" />
                    </Field>
                  </>
                )}
              </FieldGroup>
            </>
          )}

          {/* ── STEP 3: Bank & Compliance ── */}
          {step === 3 && (
            <>
              <FieldGroup title="Bank Details">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="Bank Name" required><TextInput value={bankName} onChange={setBankName} placeholder="HDFC Bank" /></Field>
                  <Field label="Branch Name" required><TextInput value={branchName} onChange={setBranchName} placeholder="Viman Nagar, Pune" /></Field>
                </div>
                <Field label="Account Number" required>
                  <TextInput value={accountNo} onChange={setAccountNo} placeholder="Account number" />
                </Field>
                <Field label="IFSC Code" required hint="11-character code on your cheque book">
                  <TextInput value={ifscCode} onChange={setIfscCode} placeholder="HDFC0001234" />
                </Field>
              </FieldGroup>

              <FieldGroup title="Compliance & Tax">
                <div style={{ background: C.amberSoft, border: `1px solid ${C.amber}30`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#92400e', marginBottom: 4 }}>
                  🔒 This information is encrypted and only accessible to HR & Admin.
                </div>
                <Field label="PAN Number" required hint="e.g. ABCDE1234F">
                  <TextInput value={panNumber} onChange={v => setPanNumber(v.toUpperCase())} placeholder="ABCDE1234F" />
                </Field>
                <Field label="Aadhaar Number" hint="12-digit number (optional)">
                  <TextInput value={aadhaarNo} onChange={setAadhaarNo} placeholder="XXXX XXXX XXXX" />
                </Field>
              </FieldGroup>
            </>
          )}

          {/* ── STEP 4: Documents ── */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: C.brandLight, border: `1px solid ${C.brand}20`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: C.brand }}>
                📎 All files are securely stored and only accessible to you and HR.
                Required documents are marked with <span style={{ color: '#ef4444', fontWeight: 700 }}>REQUIRED</span>.
              </div>
              {DOC_TYPES.map(doc => (
                <FileUploadField key={doc.key} docType={doc} file={files[doc.key]} onChange={setFile(doc.key)} />
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ marginTop: 16 }}>
              <Alert type="error" message={error} />
            </div>
          )}

          {/* Navigation */}
          <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'space-between' }}>
            {step > 1 ? (
              <button onClick={() => { setStep(s => s - 1); setError('') }} style={{
                padding: '11px 20px', borderRadius: 10, border: `1.5px solid ${C.border}`,
                background: C.surface, color: C.textMid, fontSize: 13, fontWeight: 600,
                fontFamily: FONTS.display, cursor: 'pointer',
              }}>
                ← Back
              </button>
            ) : <div />}

            {step < 4 ? (
              <button onClick={handleNext} style={{
                padding: '11px 28px', borderRadius: 10, border: 'none',
                background: C.brand, color: '#fff',
                fontSize: 13, fontWeight: 700, fontFamily: FONTS.display, cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(18,109,173,0.3)',
              }}>
                Next →
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={saving} style={{
                padding: '11px 28px', borderRadius: 10, border: 'none',
                background: saving ? C.border : C.green,
                color: saving ? C.textLight : '#fff',
                fontSize: 13, fontWeight: 700, fontFamily: FONTS.display,
                cursor: saving ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
                boxShadow: saving ? 'none' : '0 2px 8px rgba(0,184,148,0.3)',
              }}>
                {saving ? <><Spinner size={16} color="#fff" /> Submitting…</> : '✓ Complete Onboarding'}
              </button>
            )}
          </div>
        </div>

        {/* Step info */}
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: C.textLight }}>
          Step {step} of {STEPS.length} — {currentStepInfo.title}
        </div>
      </div>
    </div>
  )
}
