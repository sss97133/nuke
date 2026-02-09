# Twilio Phone Auth (SMS OTP) – Get external users logged in

Phone login (Data Room gate, Login page) uses **Supabase Auth** with **Twilio** to send SMS codes. If users see *"We can't send text codes right now. Please use your email instead"* or error **20003**, Twilio is misconfigured in the **hosted** Supabase project.

## 1. Fix Twilio in Supabase (hosted project)

1. Open **[Supabase Dashboard](https://supabase.com/dashboard)** → your project (**qkgaybvrernstplzjaam**).
2. Go to **Authentication** → **Providers** (or **Settings** → **Auth**).
3. Find **Phone** and turn it **ON**.
4. Under **SMS Provider**, choose **Twilio** and set:
   - **Twilio Account SID** – from [Twilio Console](https://console.twilio.com) → Account Info (starts with `AC…`).
   - **Twilio Auth Token** – same page, “Auth Token” (click to reveal).
   - **Twilio Message Service SID** (optional but recommended) – [Messaging](https://console.twilio.com/us1/develop/sms/services) → create or use a Messaging Service SID (starts with `MG…`). Using a Message Service gives a consistent sender and better deliverability.

Save. No deploy or repo change needed; Supabase uses these settings immediately.

## 2. Why 20003 happens

**Twilio error 20003** = “Authenticate” → Twilio rejected the request because:

- **Account SID** or **Auth Token** in Supabase are wrong, or
- They were rotated in Twilio and Supabase wasn’t updated, or
- The Twilio account is suspended or restricted.

Fix: copy **Account SID** and **Auth Token** again from [Twilio Console](https://console.twilio.com) and paste them into Supabase **Authentication → Providers → Phone → Twilio**. No quotes, no extra spaces.

## 3. Verify it works

From repo root (with `.env` / `nuke_api/.env` holding `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` or `SUPABASE_ANON_KEY`):

```bash
npm run test:phone-otp -- +1XXXXXXXXXX
```

Replace `+1XXXXXXXXXX` with a real number (e.g. your phone). You should see “OTP sent” and receive an SMS. If you see an error, the message will point to credentials or rate limits.

## 4. Email fallback

Until Twilio is fixed, users can still get in:

- **Data Room**: choose the **Email** tab and enter an email; they get access without a code.
- **Login**: use **Email** or **Sign in with Google/GitHub** instead of phone.

So external users can log in; fixing Twilio restores **phone/SMS OTP** as well.
