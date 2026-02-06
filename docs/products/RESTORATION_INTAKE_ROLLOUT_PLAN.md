# Restoration Intake: Rollout Plan

**Product**: Telegram-based photo intake for restoration companies
**Status**: Backend complete, frontend partially built
**Goal**: Validate product-market fit with 3-5 beta customers

---

## Phase 0: Pre-Launch Checklist

### Technical Readiness

| Component | Status | Owner | Notes |
|-----------|--------|-------|-------|
| Database schema | ✅ Done | - | Tables deployed |
| Telegram bot | ✅ Done | - | Deployed, webhook set |
| Business Data API | ✅ Done | - | 4 endpoints live |
| Developers page | ✅ Done | - | Design system compliant |
| Business onboarding UI | ❌ Missing | TBD | Claim/create business |
| Invite code UI | ❌ Missing | TBD | Generate/manage codes |
| Submissions dashboard | ❌ Missing | TBD | View incoming photos |
| API key generation | ✅ Done | - | Existing settings page |

### Documentation Readiness

| Document | Status | Notes |
|----------|--------|-------|
| User journeys | ✅ Done | `docs/products/RESTORATION_INTAKE_USER_JOURNEYS.md` |
| API docs | ✅ Done | `/developers` page |
| Telegram commands | ✅ Done | In bot /help |
| Boss onboarding guide | ❌ Missing | Step-by-step for business owners |
| Tech quick start | ❌ Missing | One-pager for technicians |
| Video walkthrough | ❌ Missing | 2-3 minute explainer |

### Legal/Compliance

| Item | Status | Notes |
|------|--------|-------|
| Terms of Service update | ❌ Missing | Add B2B terms |
| Privacy policy update | ❌ Missing | Data handling for photos |
| Telegram API compliance | ✅ Done | We're just a bot |
| Photo storage consent | ⚠️ Needs review | What metadata do we keep? |

---

## Phase 1: Internal Testing (Week 1)

**Duration**: 5 business days
**Goal**: Find obvious bugs before giving to real customers

### Day 1-2: Team Walkthrough

1. **Setup test business**
   - Create "Nuke Test Shop" in production
   - Generate invite codes
   - Document any setup friction

2. **Simulate technician flow**
   - Join via Telegram as if we're a tech
   - Send 20+ photos across 3 vehicles
   - Test all commands (/vehicle, /status, /done, /help)
   - Test error cases (wrong VIN, no vehicle set)

3. **Verify API data**
   - Pull submissions via API
   - Confirm photo URLs work
   - Check vehicle/technician linkage
   - Test pagination, filtering

### Day 3-4: Load Testing

1. **Concurrent users**
   - Simulate 10 technicians sending simultaneously
   - Watch for rate limiting, errors
   - Check queue processing time

2. **Photo volume**
   - Send 500+ photos in one day
   - Monitor storage costs
   - Verify AI classification holds up

### Day 5: Bug Fix Day

1. **Triage issues found**
2. **Fix critical bugs**
3. **Document known limitations**

### Exit Criteria for Phase 1

- [ ] Can complete full boss flow without errors
- [ ] Can complete full tech flow without errors
- [ ] API returns correct data
- [ ] No critical bugs open
- [ ] Team agrees it's ready for real users

---

## Phase 2: Closed Beta (Weeks 2-4)

**Duration**: 3 weeks
**Goal**: Validate with 3-5 real shops, iterate based on feedback

### Beta Customer Selection

**Ideal Beta Customer Profile**:
- Small shop (2-5 technicians)
- Already uses Telegram or willing to adopt
- Technically curious owner (will give feedback)
- Active restoration work (will generate volume)
- Located in US (timezone/support)

**How to Find**:
1. Existing Nuke users who run shops
2. Personal network (skylar's contacts)
3. Restoration forums (outreach)
4. Instagram DMs to shops

**Target**: 5 beta customers (expect 3 to actively engage)

### Beta Onboarding Process

**Week 2: First 2 Customers**

Day 1:
- 30-minute call with owner
- Screen share: create account, set up business
- Generate first invite code
- Watch them onboard first technician
- Document friction points

Day 2-3:
- Check in via text: "How's it going?"
- Monitor for first photos
- Intervene if stuck

Day 4-5:
- 15-minute feedback call
- What worked? What was confusing?
- What would make this valuable to you?

**Week 3: Add 3 More Customers**

- Same onboarding process
- But owner does it more independently
- We observe via analytics, intervene less

**Week 4: Iterate**

- Daily monitoring of all 5 shops
- Quick fixes for common issues
- Prioritize feedback for Phase 3

### Metrics to Track During Beta

| Metric | Target | Action if Below |
|--------|--------|-----------------|
| Time to first photo | < 1 hour | Simplify onboarding |
| Photos/tech/day | > 5 | Check if tech is using it |
| API usage | > 0 | Is boss getting value? |
| Support requests | < 1/day | Improve docs |
| Churn (stops using) | 0 | Call to understand why |

### Feedback Collection

1. **In-product**: Add feedback button in dashboard
2. **Weekly check-ins**: 15-min call or text thread
3. **End of beta survey**: Google Form with key questions
4. **Usage analytics**: What features are used/ignored

### Known Risks & Mitigations

| Risk | Probability | Mitigation |
|------|-------------|------------|
| Techs don't adopt Telegram | Medium | Offer SMS fallback |
| Boss sees no value | Low | Focus on export/API utility |
| AI misclassifies work | Medium | Allow corrections, retrain |
| Photos get lost | Low | Redundant storage, receipts |
| Competition launches | Low | Move fast, get testimonials |

---

## Phase 3: Public Beta (Weeks 5-8)

**Duration**: 4 weeks
**Goal**: Onboard 20-50 shops with minimal support

### Marketing Site

1. **Landing page** at `/restoration` or similar
   - Clear value prop
   - Demo video
   - Testimonials from Phase 2
   - Signup CTA

2. **SEO content**
   - "Best way to document restoration work"
   - "Telegram for auto shops"
   - Target long-tail keywords

3. **Social proof**
   - Before/after case study from beta customer
   - Quote/video testimonial

### Self-Service Onboarding

1. **Signup flow**
   - Email verification
   - Business profile creation
   - First invite code auto-generated
   - Guided tutorial (tooltips)

2. **Help resources**
   - FAQ page
   - Video tutorials (embed in dashboard)
   - In-app chat (Intercom/Crisp)

3. **Email sequences**
   - Day 0: Welcome, here's how to get started
   - Day 1: Did you invite your first tech?
   - Day 3: How's it going? Need help?
   - Day 7: Here's what other shops are doing
   - Day 14: Ready to connect your systems? (API pitch)

### Pricing Decision

**Options**:

| Model | Pros | Cons |
|-------|------|------|
| Free forever | Max adoption | No revenue, attracts non-serious |
| Freemium (5 photos/day free) | Low barrier, upsell path | Complexity |
| Free trial (30 days) | Simple, urgent to convert | May lose casual users |
| Paid from day 1 ($29/mo?) | Revenue, serious customers | Lower adoption |

**Recommendation**: Start with free trial (30 days), then $49/month flat.

### Support Model

- **Tier 1**: In-app help + FAQ (self-service)
- **Tier 2**: Email support (24-hour response)
- **Tier 3**: Scheduled call (for API integration help)

### Exit Criteria for Phase 3

- [ ] 50+ shops signed up
- [ ] 20+ actively sending photos
- [ ] < 5 support tickets per week
- [ ] 3+ testimonials collected
- [ ] Pricing validated (people will pay)

---

## Phase 4: General Availability (Month 3+)

### Launch Activities

1. **PR/Announcement**
   - Blog post
   - Social media
   - Product Hunt (if appropriate)
   - Forum posts (Rennlist, FCM, etc.)

2. **Partnerships**
   - Restoration forums as affiliates
   - Shop management software integrations
   - Parts suppliers (cross-sell opportunity)

### Scaling Considerations

| Challenge | Solution |
|-----------|----------|
| Support volume | Hire part-time support, or automate more |
| Photo storage costs | Tiered storage, auto-compress, age off |
| AI costs | Cache common classifications, batch processing |
| International | Localization, timezone handling |

---

## Open Questions

### For This Week

1. Who are our 3-5 beta customers? Names?
2. What UI is blocking beta? Priority order?
3. Who handles support during beta?
4. What's our pricing hypothesis?

### For Later

1. SMS fallback - worth building?
2. Native mobile app for bosses - ever?
3. Integration marketplace - who else?
4. White-label for franchises?

---

## Timeline Summary

| Phase | Duration | Goal | Exit Criteria |
|-------|----------|------|---------------|
| 0: Pre-launch | Now | Build missing UI | Onboarding UI complete |
| 1: Internal testing | Week 1 | Find bugs | No critical bugs |
| 2: Closed beta | Weeks 2-4 | Validate with 5 shops | Positive feedback |
| 3: Public beta | Weeks 5-8 | Scale to 50 shops | Paying customers |
| 4: GA | Month 3+ | Full launch | Sustainable growth |

---

## Appendix: Competitor Landscape

| Competitor | What They Do | Our Advantage |
|------------|--------------|---------------|
| Shop management software | Full ERP, complex | We're simple, just photos |
| WhatsApp groups | Informal sharing | We organize by vehicle |
| Dropbox/Google Drive | File storage | We add metadata, AI |
| Custom apps | Expensive to build | We're off-the-shelf |

**Key differentiator**: "Your techs already text you photos. We just make that organized."
