# SporTech Employee Portal — Complete Setup & Deployment Guide

## Overview
- **Frontend**: React + Vite → deployed on Vercel (free)
- **Backend + DB**: Supabase (free tier — PostgreSQL + Auth + Storage)
- **Total cost**: ₹0/month for up to 50 employees

---

## STEP 1 — Set Up Supabase (15 minutes)

### 1.1 Create your Supabase project
1. Go to **https://supabase.com** → Sign up with Google
2. Click **New Project**
3. Fill in:
   - **Name**: `sportech-portal`
   - **Database Password**: create a strong password and save it somewhere safe
   - **Region**: `Southeast Asia (Singapore)` — closest to India
4. Wait ~2 minutes for the project to be created

### 1.2 Run the database schema
1. In Supabase dashboard → click **SQL Editor** in the left sidebar
2. Click **New query**
3. Open the file `supabase_schema.sql` from this project
4. Copy the entire contents and paste into the SQL editor
5. Click **Run** (green button)
6. You should see "Success. No rows returned"

### 1.3 Get your API keys
1. Go to **Settings** → **API** in Supabase sidebar
2. Copy these two values — you'll need them in Step 3:
   - **Project URL** (looks like: `https://abcdefgh.supabase.co`)
   - **anon public key** (long string starting with `eyJ...`)

---

## STEP 2 — Create Employee Accounts (10 minutes)

For each employee in your team:

1. Go to Supabase → **Authentication** → **Users**
2. Click **Invite user** (or **Add user**)
3. Enter their work email (e.g. `rahul@sportech.in`)
4. They'll receive an email to set their password

### Link auth users to employee records
After creating auth users, you need to link them to the `employees` table:

1. Go to Supabase → **Table Editor** → `employees` table
2. For each employee, click the row and update the `user_id` column with their auth user UUID
3. You can find the UUID in **Authentication → Users** — it's the ID column

> **Tip**: Do this for your own account first so you can test as admin.

---

## STEP 3 — Configure the App (5 minutes)

1. In the project folder, find the file `.env.example`
2. Create a copy named `.env` (already done)
3. Open `.env` and replace the placeholder values:

```
VITE_SUPABASE_URL=https://your-actual-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your-actual-anon-key...
```

---

## STEP 4 — Test Locally (5 minutes)

```bash
# Install dependencies (only first time)
npm install

# Start development server
npm run dev
```

Open http://localhost:5173 in your browser.

Log in with your email and password (the one you set in Supabase Auth).

You should see the Employee Portal dashboard.

---

## STEP 5 — Deploy to Vercel (10 minutes)

### 5.1 Push code to GitHub
```bash
# In the project folder:
git init
git add .
git commit -m "Initial SporTech Employee Portal"

# Create a new repo on GitHub (https://github.com/new)
# Then:
git remote add origin https://github.com/YOUR_USERNAME/sportech-portal.git
git push -u origin main
```

### 5.2 Deploy on Vercel
1. Go to **https://vercel.com** → Sign up with GitHub
2. Click **Add New Project**
3. Import your `sportech-portal` GitHub repository
4. Vercel auto-detects it as a Vite project — no changes needed
5. Before clicking Deploy, go to **Environment Variables** and add:
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
6. Click **Deploy**
7. In ~2 minutes, your portal is live at something like:
   `https://sportech-portal.vercel.app`

### 5.3 Custom domain (optional, free)
If you own a domain (e.g. `sportech.in`):
1. In Vercel project → **Settings** → **Domains**
2. Add `portal.sportech.in`
3. Follow the DNS instructions Vercel shows you

---

## STEP 6 — Add Supabase Redirect URL (2 minutes)

So Supabase auth emails link correctly to your live domain:

1. Supabase → **Authentication** → **URL Configuration**
2. Set **Site URL** to: `https://sportech-portal.vercel.app`
3. Add to **Redirect URLs**: `https://sportech-portal.vercel.app/**`

---

## User Roles Explained

| Role | Can do |
|------|--------|
| `admin` | Everything — full access |
| `hr` | Approve/reject leaves, manage employees |
| `manager` | View team leave requests |
| `employee` | Apply leaves, view own data only |

Set a user's role in the `employees` table → `role_type` column.

---

## Adding New Employees (ongoing)

When you hire someone new:
1. Supabase → Auth → Invite user (enter their email)
2. Table Editor → `employees` → Add row with their details
3. Set their `user_id` to the UUID from Auth
4. The system auto-creates leave balances for them (or you can INSERT manually)

---

## What's Built (Module 1)

- ✅ Login with email/password
- ✅ Employee dashboard with leave balances
- ✅ Apply for leave (Casual, Sick, Earned, Comp Off)
- ✅ Leave history with status
- ✅ HR approval queue — approve/reject with one click
- ✅ Full leave requests table with filters
- ✅ Announcement board
- ✅ Role-based access (employees see own data, HR sees all)
- ✅ Row-level security — data protected at DB level

## Coming Next (Module 2+)

- Attendance tracking (check-in/out)
- Payslip uploads and viewing
- Team directory and org chart
- Document vault (offer letters, etc.)
- Expense claims

---

## Troubleshooting

**"Missing Supabase environment variables" error**
→ Check your `.env` file has the correct values. No spaces around `=`.

**Login works but profile not loading**
→ Make sure the `user_id` in the `employees` table matches the auth user UUID.

**HR panel not showing**
→ Make sure `role_type` is set to `hr` or `admin` in the `employees` table.

**Supabase RLS blocking data**
→ Check the SQL policies ran correctly. Re-run `supabase_schema.sql` if needed.

---

## Support

Built for SporTech Innovation Lab Pvt Ltd.
For any issues, continue the conversation with Claude — share the exact error message and which step you're on.
