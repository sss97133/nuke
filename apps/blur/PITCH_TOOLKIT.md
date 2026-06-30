# Blur — Product Definition & Pitch Toolkit

*For the team that takes this from an engineer's project to investment-grade.
This is a working tool: tight, defensible, and meant to be revised. It answers
the three questions that gate everything — **Product, Cost, Client** — then
gives the positioning, the deck, the identity direction, and the honest risk
register an angel will probe.*

> **Bar:** if it convinces a sharp comms/PMF lead, it convinces angels and
> whales. So every claim here is either sourced or flagged as an assumption.
> Nothing is hand-waved.

---

## 1. The three answers (bulletproof, concise)

### What is the product?
**Blur is a private photo app that organizes itself.** It works as smoothly as
Apple Photos, but with a real engine under the hood: it **finds the photos you
missed** (the strays that belong in an album you already started), groups your
library **passively** so you never sort by hand, and lets you **flip to exactly
the group you want to show** while everything else stays blurred. **Free,
anonymous, on-device — nothing leaves your phone.**

- One-liner: **"The private photo app that organizes itself — and shows people
  exactly what you mean."**
- North star: **Apple Photos smoothness; better power under the hood.**

### What does it cost?
Three lenses an investor will ask about:
1. **Cost to run:** the free tier is **~$0 marginal** — all work is on-device,
   no servers, no cloud storage. This is structurally cheaper than every
   account-based competitor.
2. **Cost to build:** **low and leveraged** — we reuse proven plumbing (a
   shipped iOS app shell, an existing image-intelligence engine, dedup, and a
   multi-provider AI router). v0 (free tier) is ~1 week to TestFlight; the
   differentiating clustering engine is the main net-new build.
3. **Cost to the user:** free + a paid "it organizes itself" tier at
   **~$20–30/yr** — the proven, sustainable price band for the category, and a
   deliberate **undercut** of the predatory $5–8/*week* cleaners that dominate
   today. *(Use-of-funds / raise figures: to be set with real numbers — §10.)*

### Who is the client?
**Beachhead (narrow on purpose):** iPhone users with **large, chaotic photo
libraries (10k+)** who **regularly show their phone to others** and **refuse to
sort manually.** Enthusiasts, collectors, makers, parents.
- **The wedge behavior** is show-and-tell: handing someone your phone, flipping
  to *the* photo. That's where "blur everything else" is felt.
- **Broad market** = privacy-conscious iPhone users generally (the trust layer,
  not the beachhead).
- **First community to seed** = Nuke's automotive enthusiasts — built-in
  distribution and the exact "big library, loves to show their build" profile.
- *(Second audience, for the deck itself: the angel/whale. Same doc, two
  readers — keep both in mind.)*

---

## 2. Why now (timing the angels will test)

- **Apple Photos hits real walls at scale.** Documented user-reported limits:
  smart albums choke past ~50–100; the People album can't be structured; memory
  videos break above ~500 photos; no "find the strays" flow. The default app
  *creates the pain we solve.*
- **On-device AI just became viable.** Apple's Vision framework + (iOS 26)
  on-device Foundation Models make private, server-free intelligence real for
  the first time — our whole privacy claim now stands on shipping technology.
- **Privacy is a buying criterion, not a footnote** — and the monetized
  incumbents (cleaners, vaults) are account/subscription/cloud-first. The
  *anonymous, on-device, passive* lane is **validated by small players and
  owned by no one at scale.**

## 3. The market & the gap (sourced)

- Photo-cleaner/organizer is a **~$40M/month** category, **~95% of revenue on
  iOS**, forecast ~$2.3B→$6.1B by 2033. *(Third-party estimates — Appfigures/
  Sensor Tower; verify before quoting in a live deck.)*
- It's captured by **manual, swipe-to-clean** apps with **predatory weekly
  pricing.** None own *passive + private + finds-what-you-missed.*
- **The gap = our position.** We don't need to beat Apple Photos at everything;
  we beat it on the three things it does badly (stray-finding, scale,
  show-safely) while matching its smoothness.

## 4. Scope — what it IS / what it is NOT (the discipline)

Tight scope is the bulletproofing. We deliver exactly this and say no to the rest.

**Blur IS:** a private, passive iPhone photo organizer with (a) self-building
galleries, (b) a stray-finder that completes albums you started, (c)
flip-to-show with everything-else-blurred, (d) instant retrieval — all
on-device, no account.

**Blur is NOT (v1):** a cloud backup, a social network/feed, a photo editor, a
storage cleaner, an Android app, or anything that requires an account or sends
your photos anywhere. *Every "not" is a scope cut that keeps the promise.*

## 5. Positioning & messaging

- **Category we enter:** Photo & Video (private organizer) — *not* "cleaner,"
  *not* "vault."
- **The three pillars** (the deck's spine):
  1. **Private by architecture** — anonymous, on-device, airplane-mode-proof.
  2. **Passive** — it organizes itself; you stop sorting.
  3. **Finds what you missed** — completes the albums you care about.
- **Competitive one-liners:**
  - *vs Apple Photos:* "Same smoothness, an engine that actually organizes."
  - *vs cleaners (Gemini/Slidebox):* "We organize, you don't swipe — and we
    don't charge you by the week."
  - *vs vaults (Keepsafe):* "Not a locked silo. Your whole library, made safe
    to show."

## 6. Defensibility & risk register (pre-answer the hard questions)

| The angel will ask | Our honest answer |
|---|---|
| "Won't Apple just do this?" | Apple optimizes for everyone and won't ship *no-account* or *third-party-key* intelligence; our edge is the gaps they structurally won't fill + privacy stance. Risk is real; we move first and stay narrow. |
| "What's the moat?" | Not the tech alone (Vision is public). The moat is **the engine + UX + brand trust + Nuke's reusable studio shell** producing fast, and a community beachhead. Be honest: early moat is execution & positioning, not patents. |
| "Is the AI actually hard?" | Dedup/event-grouping is cheap (reused). True 80k subject-clustering is genuine engineering (our work). The **stray-finder is the tractable, high-value first cut** — we lead with what we can ship well. |
| "How do you make money anonymously?" | Free on-device; paid managed tier (~$20–30/yr). **We do not depend on AI-referral revenue** (no public consumer program exists — verified). Monetize convenience, not data. |
| "How does a no-account app grow?" | The show-and-tell moment is inherently social; seed via Nuke's community; ASO into an underserved category. |

## 7. The deck (outline to fill with identity)

12 slides, angel-standard:
1. **Hook** — the frantic-scroll / hand-someone-your-phone moment.
2. **Product** — the one-liner + a 10-second demo gif.
3. **Why now** (§2).
4. **Market & gap** (§3).
5. **Client / beachhead** (§1.3).
6. **How it works** — the three pillars (§5), under-the-hood without jargon.
7. **Demo** — self-organizing + stray-finder + flip-to-show.
8. **Business model** — free→paid, pricing, ~$0 run cost (§1.2).
9. **Moat & defensibility** (§6).
10. **Traction plan** — TestFlight → Nuke community → ASO; the learning metrics.
11. **The team / the studio** — Nuke ships; Blur is product #1, the template.
12. **The ask** — raise + use of funds (§10).

## 8. Visual & market identity direction (territory, for the designer to own)

Strategic scaffolding — not final design; this is hers to create and revise:
- **Feel:** calm, private, premium-simple. The opposite of loud "cleaner" apps
  with red alert badges. Closer to Apple's own restraint than to utility-app
  clutter.
- **The name "Blur" as a visual idea:** focus vs. blur, depth-of-field, the one
  sharp thing in a soft field. The logo/motion can literally be "everything
  blurred except the one that matters."
- **Tone:** trustworthy, quiet confidence, no dark-pattern urgency. "Your
  photos. Your phone. Organized."
- **Proof of polish:** the product must *demo* as smooth as Apple Photos — the
  identity should promise that and the build must deliver it (§north star).
- *(Note: Nuke's internal design system is industrial/dense — Blur should have
  its own consumer-soft identity, not inherit nuke's look.)*

## 9. The product must deliver on what it says (the build contract)

Investment-grade means the demo can't crack. The non-negotiables:
- **Smoothness parity with Apple Photos** — instant thumbnails, no jank, native
  feel. (We reuse Apple's own PhotoKit rendering to get there.)
- **The stray-finder must feel like magic, not noise** — seed from the user's
  *own* albums (high-precision), let the user confirm. Quality over coverage.
- **The privacy claim must be literally true** — airplane-mode-proof, Data-Not-
  Collected. The honesty *is* the marketing.

## 10. What we need to lock (decisions for you + her)

1. **Beachhead ICP** — confirm "big-library show-and-tell enthusiast," or
   re-aim. *Drives the entire identity + deck.*
2. **Name/brand** — "Blur" is likely taken on the App Store; lock the store
   name + identity (bundle `ag.nuke.blur` can stay regardless).
3. **The raise & use of funds** — real numbers for slide 12 (design/brand, App
   Store + legal/privacy-policy, optional managed-inference infra, ASO/
   marketing). Engineer-side build is low; the spend is identity + GTM.
4. **Is v1 optimizing users+learning or revenue?** — sets whether the deck
   leads with traction or unit economics.

---

*Next tools I can produce on request: the actual slide deck (filled), a
one-page teaser, the landing page copy, the App Store listing copy, or a
revised version of any section above as her identity work evolves.*
