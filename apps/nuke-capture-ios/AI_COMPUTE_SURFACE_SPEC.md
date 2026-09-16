# AI Compute Surface — Theory & iOS Deliverable

> Status: spec / pre-production. Authored 2026-06-23 from a 4-lens audit (economics,
> iOS-UX + Apple policy, technical wiring, adversarial). Grounded in the live code; cited inline.
> Governs: `ConnectedAccountsView.swift` and any iOS surface that touches AI compute / credits.

---

## 1. The theory — one funnel, two tiers, a compute ladder

There is **one** funnel in the backend. Every Claude job asks a single question: *whose
compute runs this?* `resolveClaudeAuth` returns three sources that collapse into **two
economic tiers**:

| Tier | Source(s) | Who pays Anthropic | Metered? | Margin |
|------|-----------|--------------------|----------|--------|
| **1 — Bring your own compute** | your Claude subscription (OAuth) · your own API key (BYOK) | the **user**, directly | no | $0 to Nuke |
| **2 — Managed compute** | Nuke's platform `ANTHROPIC_API_KEY` | **Nuke** fronts it | yes | cost × 1.2 |

- Sources 1+2 (`subscription`, `user_api_key`) return un-metered — `claudeSubscriptionAuth.ts:252,277`, and the BYOK upgrade branch is explicit: *"their bill — we don't meter."*
- Source 3 (`system_api_key`) is the only path through `runMeteredPlatform` (hold → call → settle) — `claudeSubscriptionAuth.ts:344,394`. Margin is `PLATFORM_MARGIN=1.2` over Anthropic list price (`aiCredits.ts:30,42`).
- The wallet (`ai_credit_ledger`, balance via `my_ai_credit_balance` RPC) and all the Stripe machinery exist **only to support Tier 2**. The wallet is a true prepaid escrow — `holdCredits` refuses if the balance can't cover the estimate (`aiCredits.ts:79-90`), so the platform never extends credit.

**The conclusion that drives everything below:** the web exposes the whole ladder (OAuth +
BYOK + Stripe top-up); iOS today exposes only the BYOK rung. **That is an incomplete
surface, not a contradictory architecture — and it should stay mostly that way on purpose.**

---

## 2. Why iOS ≠ web is *correct* — Apple is the forcing function

The web sells a prepaid credit (`create-api-access-checkout` `wallet_10/25/50`,
`aiCredits.ts` credits the ledger 1:1) that is then **consumed inside Nuke's own functions**.
That is, unambiguously, "digital content/credits consumed in the app."

- **Guideline 3.1.1** reserves selling that for **Apple IAP** (15–30%). At a 30% cut on a
  20% margin, the platform **loses money on every funded dollar** — economically dead.
- **BYOK is IAP-exempt.** The user pays Anthropic directly, outside the app, for a service
  Nuke explicitly does not meter — the same posture as pasting your own cloud key into a dev
  tool. Apple does not tax it. (`ConnectedAccountsView.swift:61,83`.)
- **Guideline 3.1.3(b) (multiplatform)** lets a user *consume* web-purchased credit inside the
  app — **reading a balance and spending it is fine.** What's barred is in-app *solicitation*
  to buy outside (anti-steering).
- **External Purchase Link** (post-Epic, US, May 2025) is allowed without the old entitlement,
  but the Dec 2025 appeal **restored Apple's commission (12% small-biz / 27%)**, the copy is
  StoreKit-templated, it must open in the default browser, and you owe a 15-day transaction
  report. Net-negative for a zero-revenue platform.

**Therefore: iOS must not *sell* credits.** It may show a balance read-only and, at most,
route funding to the web with a bare compliant link — the exact pattern the app already uses
for QuickBooks (`ConnectedAccountsView.swift:88`).

---

## 3. iOS v1 deliverable — "bring your own compute; see which engine is driving; see what you've got"

Extend `ConnectedAccountsView.swift` **in place** (iOS room rule: develop from what exists,
never greenfield). Speak the native idiom — `List`/`Form` + `Section`, `MetricCell`
(caption2 label + monospaced value), drill-to-source, honest-blank — **not** the web's
$10/$25/$50 button card. (Idiom refs: `TodayView.swift` LiveMetricsStrip/MetricCell:534-565;
`WorthBracketView.swift:50-75` "Not priced yet" blocked state.)

**Ships in v1:**
1. **BYOK key-paste stays the primary funding primitive.** Compliant, $0-to-platform,
   IAP-exempt. It already works and writes `user_ai_providers` under `provider='anthropic'`.
2. **A "Compute" status header** (MetricCell idiom): a read-only row naming which source is
   driving — *On your Claude key* / *On your wallet* / *Not configured* — derived from the
   same `resolveClaudeAuth` order.
3. **Read-only wallet balance**, shown **only if a top-up already exists**, sourced from
   `my_ai_credit_balance` (zero-arg, RLS-scoped, confirmed HTTP 200). Honest-blank otherwise —
   never a fabricated or un-spendable number.
4. **Reject `sk-ant-oat…` pastes at the door** with: *"That's a Claude subscription token,
   not an API key — paste one that starts with `sk-ant-api…`."* (This is the exact mistake
   already live in Skylar's own row.)

**Excluded from v1 (deliberately):**
- ❌ **No in-app credit sale** (no Stripe buttons, no `$X` purchase UI) — 3.1.1.
- ❌ **No OAuth "Connect Claude subscription" button.** It rides an **unsanctioned** Claude
  Code `client_id` (`claudeSubscriptionAuth.ts:23-32,46`), Skylar's token is already **dead**
  ("Invalid bearer token"), and consumer Max/Pro terms scope usage to personal use. A reviewer
  tapping a broken Connect = Guideline 2.1 rejection that blocks **all** future updates to the
  live TestFlight build.

---

## 4. Technical wiring (when v1 is built)

iOS already has the full transport — `SupabaseService.swift` auto-attaches the user JWT to
every `.rpc()`/`.from()`/`functions.invoke`, and an `ASWebAuthenticationSession` runner
already exists (`SignInView.swift:111-128`). No new client layer.

- **Balance:** `client.rpc("my_ai_credit_balance").execute().value` → display `cents/100`.
  Refresh after any analysis returning `chargedCents>0`. Never pass a `user_id` from the client.
- **Analysis:** `functions.invoke("analyze-with-claude", body:{vehicle_id, prompt, mode, model, max_tokens})`
  and **branch on the four response shapes that exist after today's fixes**:
  `ok(text, source, chargedCents)` · `402 needsFunding` → top-up route · `429 rateLimited`
  (`source==subscription`) → offer "Run on API now" (`mode:"upgrade"`) · `503 serviceError`
  (`platform_unfunded`) → "temporarily unavailable, you were not charged" (**not** a funding prompt).
  ⚠️ **Verify** `supabase-swift` surfaces non-2xx status + JSON body (likely
  `FunctionsError.httpError(code, data)`); if it swallows the body, use a raw `URLSession`
  call to `/functions/v1/analyze-with-claude` with the JWT.
- **Data model (respect, don't special-case):** `provider='anthropic'` = BYOK (x-api-key);
  `provider='anthropic_subscription'` = OAuth bundle; the backend already re-routes
  `sk-ant-oat…` to OAuth. iOS BYOK paste is correct **as-is** for real `sk-ant-api…` keys.
- **Top-up (only if a managed path is ever wanted):** reuse `create-api-access-checkout`
  as-is, but note the gotcha — Stripe `success_url` must be `https`, so the
  custom-scheme callback needs an `https` landing bounce (`nuke.ag/topup-done` →
  `ag.nuke.capture://topup-success`) **or** just poll the balance RPC on app-foreground.
  This is the IAP-risk surface; keep it behind a build flag, **off by default.**

---

## 5. Must-fix prerequisites (before a 2nd user / before real money)

These are platform-wide, not iOS-specific, but the iOS surface widens their blast radius:

1. **Encrypt `user_ai_providers.api_key_encrypted` at rest.** It is **base64, not encrypted**
   (`claudeSubscriptionAuth.ts:182`, `ConnectedAccountsView.swift:191-192`,
   `getUserApiKey.ts` even comments "use proper encryption"). A DB dump exposes every user's
   live Anthropic key — and OAuth bundles carry **refresh tokens** that mint fresh access
   tokens indefinitely. Move to pgsodium/Vault. **Schema/auth change → needs Skylar's sign-off.**
2. **Fund the platform Anthropic account, or hide Tier 2.** It is unfunded today, so Tier 2
   returns `503 serviceError`. Do not surface a wallet balance that buys nothing.
3. **Decide the OAuth-subscription tier's fate** (see §6) — it is currently dead and legally fragile.

---

## 6. Decisions for Skylar (genuine forks — only you can call these)

1. **iOS scope:** BYOK-**only** (cleanest, zero policy surface), or BYOK + **read-only**
   web-funded balance? (Recommended: BYOK-only for v1; add read-only balance once Tier 2 is funded.)
2. **OAuth "Connect Claude" tier:** kill it platform-wide (it's an unsanctioned-client + ToS
   bet, and dead right now), or keep it **web-only** behind an explicit personal-use posture?
   (Recommended: keep web-only, feature-flagged; never on iOS.)
3. **Fund the platform Anthropic account?** If yes, Tier 2 becomes real and the wallet is worth
   surfacing. If no, the entire Stripe/wallet apparatus is dormant infrastructure — and iOS's
   compute surface is correctly *nothing beyond BYOK + a status readout*.
4. **Encrypt-at-rest now?** It's a money/secrets liability this surface expands. Recommended:
   yes, before onboarding any second user.

---

## 7. Phasing

- **Phase 0 (no iOS code):** reject `sk-ant-oat` pastes; encrypt-at-rest migration; fund-or-hide Tier 2.
- **Phase 1 (iOS v1):** Compute status header + BYOK paste hardening, all native idiom. No money UI.
- **Phase 2 (only if Tier 2 funded):** read-only wallet balance on iOS + compliant out-link to web for top-up.
- **Never (until a sanctioned client exists):** OAuth Connect on iOS; in-app credit sale.
