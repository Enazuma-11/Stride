// ─── EMAIL NOTIFICATIONS VIA RESEND ──────────────────────────────────────────
// This file is called from the frontend for immediate emails
// (leave decisions, welcome emails)
// Scheduled emails (birthdays, holidays, attendance alerts)
// are handled by Supabase Edge Functions — see SETUP_GUIDE.md

const RESEND_API_URL = 'https://api.resend.com/emails'
const FROM_EMAIL     = 'notifications@sportechinnolab.org'
const FROM_NAME      = 'Stride · SporTech Innovation Lab'

// NOTE: VITE_RESEND_API_KEY must be set in your .env and Vercel environment variables
function getApiKey() {
  return import.meta.env.VITE_RESEND_API_KEY
}

async function sendEmail({ to, subject, html }) {
  const apiKey = getApiKey()
  if (!apiKey) {
    console.warn('VITE_RESEND_API_KEY not set — email not sent')
    return null
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    `${FROM_NAME} <${FROM_EMAIL}>`,
      to:      [to],
      subject,
      html,
    }),
  })

  if (!res.ok) {
    const err = await res.json()
    console.error('Resend error:', err)
    return null
  }
  return await res.json()
}

// ─── EMAIL TEMPLATES ──────────────────────────────────────────────────────────
function baseTemplate(content) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin:0;padding:0;background:#F5F4F0;font-family:'Helvetica Neue',sans-serif;">
      <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(29,53,87,0.10);">
        <!-- Header -->
        <div style="background:#1D3557;padding:24px 32px;display:flex;align-items:center;gap:12px;">
          <div style="width:36px;height:36px;background:#E63946;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;">⚡</div>
          <div>
            <div style="color:#fff;font-size:16px;font-weight:700;">SporTech Innovation Lab</div>
            <div style="color:rgba(255,255,255,0.5);font-size:11px;letter-spacing:1px;">STRIDE EMPLOYEE PORTAL</div>
          </div>
        </div>
        <!-- Body -->
        <div style="padding:32px;">
          ${content}
        </div>
        <!-- Footer -->
        <div style="padding:16px 32px;background:#F5F4F0;text-align:center;font-size:11px;color:#A8A69F;">
          This is an automated notification from Stride · SporTech Innovation Lab Pvt Ltd<br>
          <a href="${import.meta.env.VITE_APP_URL || 'https://stride.vercel.app'}" style="color:#1D3557;">Open Portal</a>
        </div>
      </div>
    </body>
    </html>
  `
}

// ── Leave decision email ──────────────────────────────────────
export async function sendLeaveDecisionEmail({ toEmail, toName, status, leaveType, fromDate, toDate, days }) {
  const isApproved = status === 'approved'
  const subject = isApproved
    ? `✅ Your leave has been approved`
    : `❌ Your leave request was not approved`

  const html = baseTemplate(`
    <h2 style="margin:0 0 8px;font-size:22px;color:#1A1916;">
      ${isApproved ? '✅ Leave Approved' : '❌ Leave Not Approved'}
    </h2>
    <p style="color:#6B6860;margin:0 0 24px;">Hi ${toName.split(' ')[0]},</p>
    <div style="background:${isApproved ? '#EBF5F0' : '#FDF0F1'};border-radius:8px;padding:20px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="color:#6B6860;padding:6px 0;">Leave Type</td><td style="font-weight:600;color:#1A1916;">${leaveType}</td></tr>
        <tr><td style="color:#6B6860;padding:6px 0;">From</td><td style="font-weight:600;color:#1A1916;">${fromDate}</td></tr>
        <tr><td style="color:#6B6860;padding:6px 0;">To</td><td style="font-weight:600;color:#1A1916;">${toDate}</td></tr>
        <tr><td style="color:#6B6860;padding:6px 0;">Duration</td><td style="font-weight:600;color:#1A1916;">${days} day${days > 1 ? 's' : ''}</td></tr>
      </table>
    </div>
    <p style="color:#6B6860;font-size:13px;">
      ${isApproved
        ? 'Your leave has been approved. Enjoy your time off!'
        : 'Your leave request was not approved. Please reach out to HR for more details.'
      }
    </p>
  `)

  return sendEmail({ to: toEmail, subject, html })
}

// ── Welcome email ─────────────────────────────────────────────
export async function sendWelcomeEmail({ toEmail, toName, portalUrl }) {
  const html = baseTemplate(`
    <h2 style="margin:0 0 8px;font-size:22px;color:#1A1916;">Welcome to Stride! 👋</h2>
    <p style="color:#6B6860;margin:0 0 24px;">Hi ${toName.split(' ')[0]}, your SporTech employee portal account is ready.</p>
    <div style="background:#EAF0F7;border-radius:8px;padding:20px;margin-bottom:24px;">
      <p style="margin:0 0 12px;font-weight:600;color:#1D3557;">Here's what you can do on Stride:</p>
      <ul style="margin:0;padding-left:20px;color:#6B6860;font-size:14px;line-height:1.8;">
        <li>Apply for leaves and track your balances</li>
        <li>Mark your daily attendance</li>
        <li>Complete your employee profile</li>
        <li>Stay updated on company announcements</li>
      </ul>
    </div>
    <a href="${portalUrl}" style="display:inline-block;background:#1D3557;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">
      Open My Portal →
    </a>
  `)

  return sendEmail({
    to: toEmail,
    subject: `Welcome to Stride — Your SporTech Employee Portal is Ready`,
    html,
  })
}

// ── Birthday email ────────────────────────────────────────────
export async function sendBirthdayEmail({ toEmail, toName }) {
  const html = baseTemplate(`
    <div style="text-align:center;padding:20px 0;">
      <div style="font-size:64px;margin-bottom:16px;">🎂</div>
      <h2 style="margin:0 0 12px;font-size:24px;color:#1A1916;">Happy Birthday, ${toName.split(' ')[0]}!</h2>
      <p style="color:#6B6860;font-size:15px;line-height:1.6;">
        Wishing you a wonderful birthday full of joy and celebration.<br>
        The entire SporTech team wishes you all the best! 🎉
      </p>
    </div>
  `)

  return sendEmail({
    to: toEmail,
    subject: `🎂 Happy Birthday from the SporTech team!`,
    html,
  })
}

// ── Holiday reminder email ────────────────────────────────────
export async function sendHolidayReminderEmail({ toEmail, holidayName, holidayDate, isOptional }) {
  const html = baseTemplate(`
    <h2 style="margin:0 0 8px;font-size:22px;color:#1A1916;">🎉 Upcoming Holiday</h2>
    <p style="color:#6B6860;margin:0 0 24px;">Just a reminder about an upcoming holiday.</p>
    <div style="background:#ECFEFF;border-radius:8px;padding:20px;margin-bottom:24px;">
      <div style="font-size:18px;font-weight:700;color:#0E7490;margin-bottom:8px;">${holidayName}</div>
      <div style="font-size:14px;color:#6B6860;">${new Date(holidayDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
      <div style="margin-top:8px;font-size:12px;color:#0E7490;font-weight:600;">${isOptional ? 'Optional Holiday' : 'Mandatory Holiday'}</div>
    </div>
    ${isOptional ? '<p style="color:#6B6860;font-size:13px;">This is an optional holiday. You may choose to take it as one of your 6 optional holiday picks.</p>' : ''}
  `)

  return sendEmail({
    to: toEmail,
    subject: `🎉 Upcoming Holiday: ${holidayName} in 3 days`,
    html,
  })
}
