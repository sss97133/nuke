# Sign in with Apple — setup runbook (all three surfaces)

Code is COMPLETE on branch `fable5/siwa` for:

| Surface | Where | Flow |
|---|---|---|
| iOS app | `apps/nuke-capture-ios` — `SignInView.swift` | native `SignInWithAppleButton` → identity token → `auth.signInWithIdToken` |
| macOS app | `apps/nuke-capture-mac` — `AppleSignIn.swift` + sign-in dialog button | native `ASAuthorizationController` → identity token → `auth.signInWithIdToken` |
| Web (nuke.ag) | `nuke_frontend/src/components/auth/Login.tsx` | "Continue with Apple" → `auth.signInWithOAuth({ provider: 'apple' })` → `/auth/callback` |

None of it works until the **human-only** config below is done (Apple
Developer portal + Supabase dashboard). Nothing in this file has been
enabled or created by the agent — these are the exact steps for Skylar.

**Why bother (beyond hating passwords):** App Store Guideline **4.8 (Login
Services)** — an app that offers any third-party login must also offer one
with Apple-grade privacy properties. Shipping Sign in with Apple natively
preempts the finding entirely, and it's the Face ID-grade sign-in the
product wants anyway.

**Two independent server-side pieces — don't conflate them:**

1. **Native apps (iOS + macOS)** use `signInWithIdToken`. Supabase only
   needs the apps' **bundle IDs in the Client IDs list**. No Services ID,
   no secret key, no 6-month rotation for native-only.
2. **Web OAuth** uses Supabase's hosted flow. This is the part that needs
   the **Services ID + the .p8 key + the generated secret** (which expires
   every 6 months — see §4).

---

## §1 Apple Developer portal — identifiers & capability

All in <https://developer.apple.com/account> → Certificates, Identifiers &
Profiles. You need the **Team ID** later: it's on the Membership details
page (10-character string, e.g. `AB12CD34EF`).

### 1a. App ID capability (iOS app)

1. Identifiers → select the `ag.nuke.capture` App ID (create it per
   `APP_STORE_LAUNCH.md` §3 if it doesn't exist yet).
2. Capabilities tab → tick **Sign In with Apple** → Save. ("Enable as a
   primary App ID" is the default and correct — it has no grouped/secondary
   apps.)
3. Xcode side is already in the repo: `project.yml` declares the
   `com.apple.developer.applesignin` entitlement; `xcodegen generate`
   writes `Generated/NukeCapture-iOS.entitlements`, and automatic signing
   regenerates the provisioning profile after the capability is on the
   App ID.

### 1b. App ID capability (macOS app, when it gets bundled)

The Mac relay currently runs as a dev `swift build` binary, which CANNOT do
Sign in with Apple (no entitlement on a bare executable — the app explains
this in its error dialog; email/password still works for dev). When you
create the bundled Xcode app per `apps/nuke-capture-mac/README.md` →
"Signing & distribution":

1. Identifiers → "+" → App ID → macOS, explicit bundle ID (recommend
   `ag.nuke.capture.mac`) → tick **Sign In with Apple** → Save.
2. In the Xcode target: Signing & Capabilities → "+ Capability" → Sign in
   with Apple.
3. Add that bundle ID to the Supabase Client IDs list (§3).

### 1c. Services ID (web — nuke.ag)

A Services ID is the OAuth `client_id` for the web flow. It must be
DIFFERENT from any App ID.

1. Identifiers → "+" → **Services IDs** → Continue.
2. Description: `Nuke web` (user-visible on the Apple consent screen).
   Identifier: **`ag.nuke.web`** (convention; any unique reverse-DNS string
   works — record what you choose, it goes into Supabase as a Client ID).
3. Register, then click the new Services ID → tick **Sign In with Apple** →
   **Configure**:
   - Primary App ID: `ag.nuke.capture`
   - Domains and Subdomains: `nuke.ag`
   - Return URLs: `https://qkgaybvrernstplzjaam.supabase.co/auth/v1/callback`
     (this is Supabase's auth callback — NOT a nuke.ag URL; Apple redirects
     here, Supabase then redirects on to the app's `redirectTo`.)
4. Save → Continue → Register. (No domain-verification file dance is
   required anymore for Sign in with Apple; Apple validates the return URL
   at runtime.)

### 1d. Key (.p8) for the web secret

1. Keys → "+" → name `Nuke Sign in with Apple` → tick **Sign in with
   Apple** → Configure → Primary App ID `ag.nuke.capture` → Save → Continue
   → Register.
2. **Download the `.p8` file — Apple lets you download it exactly once.**
   Store it somewhere durable and private (it is a signing key, not a
   secret to publish).
3. Record the **Key ID** (10 characters, shown on the key page and in the
   filename `AuthKey_<KEYID>.p8`).

After this section you hold four values:

| Value | Example shape | Used in |
|---|---|---|
| Team ID | `AB12CD34EF` | secret generation (§4) |
| Services ID | `ag.nuke.web` | Supabase Client IDs + secret generation |
| Key ID | `XY98ZW76VU` | secret generation |
| `AuthKey_<KEYID>.p8` | file | secret generation |

---

## §2 — nothing. There is deliberately no server code to deploy

Supabase GoTrue already implements the Apple provider; the edge functions
and DB are untouched by this feature.

---

## §3 Supabase dashboard — Apple provider

Dashboard → project `qkgaybvrernstplzjaam` → **Authentication** →
**Sign In / Providers** → **Apple**:

| Field | Value |
|---|---|
| Enable Sign in with Apple | ON |
| Client IDs | `ag.nuke.web,ag.nuke.capture` — comma-separated, no spaces. Add `ag.nuke.capture.mac` when the bundled Mac app exists (§1b). The Services ID entry powers the web OAuth flow; the bundle-ID entries authorize the native `signInWithIdToken` calls. |
| Secret Key (for OAuth) | the generated client-secret JWT from §4 — required for the WEB flow only |

Then **Authentication → URL Configuration → Redirect URLs**: make sure the
allowlist contains

- `https://nuke.ag/auth/callback`
- `http://localhost:5173/auth/callback` (or whatever the dev port is — the
  web button passes `redirectTo: window.location.origin + '/auth/callback'`,
  and Supabase silently falls back to the Site URL if the value isn't
  allowlisted)

(Google/GitHub already work in this project, so the Site URL itself is
presumed already correct — don't touch it.)

---

## §4 Generating the secret key (web only) — and the 6-month bomb

Apple does not accept a static client secret. The "secret" is a **JWT you
sign yourself with the .p8 key**, and Apple caps its lifetime at **6
months (15777000 seconds)**. When it expires, web Apple sign-in fails with
`invalid_client` until you generate and paste a fresh one.

**⏰ Set a recurring 5-month calendar reminder NOW: "Rotate Apple client
secret in Supabase" — this is the single most common way Sign in with
Apple silently dies in production.** Native iOS/macOS sign-in does NOT
depend on this secret and keeps working through a lapse.

Option A — Supabase's in-browser generator (easiest): the Apple provider
docs page (<https://supabase.com/docs/guides/auth/social-login/auth-apple>)
embeds a "Generate a client secret" tool that runs entirely in the browser
(keys don't leave the machine). Note: the tool does not work in Safari —
use Chrome or Firefox. Inputs: Team ID, Services ID, Key ID, the .p8
contents. Output: the JWT → paste into the Secret Key field (§3).

Option B — script (auditable, repeatable). The JWT must be exactly:

- header: `alg=ES256`, `kid=<Key ID>`
- payload: `iss=<Team ID>`, `iat=now`, `exp=now+15777000` (max),
  `aud=https://appleid.apple.com`, `sub=<Services ID>`

```bash
# one-shot, no install beyond node + jose
node --input-type=module -e '
import { SignJWT, importPKCS8 } from "jose";          // npm i jose
import { readFileSync } from "fs";
const TEAM_ID = "AB12CD34EF";                          // ← Membership page
const SERVICES_ID = "ag.nuke.web";                     // ← §1c
const KEY_ID = "XY98ZW76VU";                           // ← §1d
const pk = await importPKCS8(readFileSync("AuthKey_" + KEY_ID + ".p8", "utf8"), "ES256");
const jwt = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", kid: KEY_ID })
  .setIssuer(TEAM_ID)
  .setIssuedAt()
  .setExpirationTime(Math.floor(Date.now() / 1000) + 15777000)
  .setAudience("https://appleid.apple.com")
  .setSubject(SERVICES_ID)
  .sign(pk);
console.log(jwt);
'
```

Paste the output into Supabase → Apple provider → Secret Key → Save.

---

## §5 Test sequence

### Web (fastest validation that §1c/§3/§4 are right)

1. Open <https://nuke.ag/login> → **Continue with Apple** (top button).
2. Expect appleid.apple.com consent page (first time: choose share/hide
   email) → Face ID/Touch ID on Apple's side → redirected to
   `…supabase.co/auth/v1/callback` → `https://nuke.ag/auth/callback` →
   lands on `/` signed in.
3. Failure decoder: `invalid_client` = secret expired/wrong or Services ID
   mismatch; instant bounce back to `/login?error=oauth_failed` = check the
   Redirect URLs allowlist (§3); Apple page itself erroring = return URL in
   §1c doesn't exactly match `https://qkgaybvrernstplzjaam.supabase.co/auth/v1/callback`.
4. Verify the user: Supabase dashboard → Authentication → Users → new user
   with provider `apple` (email may be an `@privaterelay.appleid.com`
   address if "Hide My Email" was chosen — that's by design).

### iOS

1. `cd apps/nuke-capture-ios && xcodegen generate && open NukeCapture-iOS.xcodeproj`
2. Target → Signing & Capabilities → set Team. Confirm the "Sign in with
   Apple" capability shows (it comes from the generated entitlements; if
   signing complains, re-check §1a then let Xcode refresh profiles).
3. Run on a REAL device signed into iCloud (simulator SIWA is flaky;
   device is the honest test).
4. Tap the black **Sign in with Apple** button → system sheet → Face ID →
   app flips to TodayView. Email/password form still works beneath it.
5. Errors: `AuthApiError` mentioning the audience/client = bundle ID
   missing from Client IDs (§3); ASAuthorizationError 1000 = capability/
   entitlement/provisioning not aligned (§1a step 2-3, then toggle
   automatic signing).

### macOS

1. Dev binary (`swift run`): clicking "Sign in with Apple" in the sign-in
   dialog must show the explanatory failure ("needs the bundled, signed
   app…") — that's correct behavior, not a bug. Email/password is the dev
   path.
2. Bundled app (after §1b + README "Signing & distribution"): menu →
   Sign in… → **Sign in with Apple** → system sheet → Touch ID → menu
   shows "Sign out (<email>)" and the engine starts syncing.

### Cross-surface check (the actual point)

Sign in with Apple on iPhone, then on nuke.ag: both sessions must resolve
to the SAME Supabase user (same Apple `sub` claim → same identity). If the
web flow used "Hide My Email" and a previous email/password account exists
with the real email, you get a SECOND user — decide deliberately whether
to merge (Authentication → Users → link identities is not automatic across
relay addresses).

---

## §6 Checklist (copy into the session that does the config)

- [ ] §1a App ID `ag.nuke.capture`: Sign In with Apple capability ON
- [ ] §1c Services ID `ag.nuke.web`: domain `nuke.ag`, return URL
      `https://qkgaybvrernstplzjaam.supabase.co/auth/v1/callback`
- [ ] §1d Key created, `.p8` downloaded & stored, Key ID + Team ID recorded
- [ ] §4 secret JWT generated (≤6 months)
- [ ] §3 Supabase Apple provider: enabled, Client IDs
      `ag.nuke.web,ag.nuke.capture`, secret pasted
- [ ] §3 Redirect URLs include `https://nuke.ag/auth/callback` (+ localhost dev)
- [ ] ⏰ 5-month rotation reminder created
- [ ] §5 web test, iOS device test, cross-surface same-user check
- [ ] (later, when Mac app is bundled) §1b + add `ag.nuke.capture.mac` to Client IDs
