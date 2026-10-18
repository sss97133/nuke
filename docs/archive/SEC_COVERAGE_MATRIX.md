# SEC Form Compliance Coverage Matrix

**Date:** 2026-01-25
**Table:** `businesses` + related tables

---

## Visual Coverage Overview

```
FORM D (Regulation D)                    FORM C (Regulation Crowdfunding)
========================                 ====================================

ISSUER INFORMATION            67%        BASIC ENTITY INFO               67%
├─ Legal name                 ✅        ├─ Legal name                   ✅
├─ DBA/trade name             ✅        ├─ Entity type                  ⚠️
├─ Incorporation state        ❌        ├─ Jurisdiction                 ❌
├─ Entity type                ⚠️        ├─ Formation date               ⚠️
├─ Year incorporated          ⚠️        ├─ Principal address            ✅
├─ EIN/Tax ID                 ⚠️        └─ Website                      ✅
├─ Address/contact            ✅
├─ Phone                      ✅
└─ Website                    ✅

RELATED PERSONS               33%        DIRECTORS/OFFICERS              20%
├─ Executive officers         📋        ├─ Names of directors           📋
├─ Directors                  ⚠️        ├─ Names of officers            📋
├─ Promoters                  ❌        ├─ 20%+ beneficial owners       ⚠️
├─ 20%+ owners                ⚠️        ├─ Prior experience             ❌
├─ Addresses                  ❌        └─ Educational background       ❌
└─ Relationships              ⚠️

INDUSTRY CLASSIFICATION       33%        BUSINESS DESCRIPTION            40%
├─ Industry group             ⚠️        ├─ Business description         ✅
├─ Revenue range              ❌        ├─ Number of employees          ✅
└─ Employee count             ✅        ├─ Risks of investment          ❌
                                       ├─ Target market                ⚠️
                                       └─ Intellectual property        ❌

OFFERING DETAILS               0%        FINANCIAL CONDITION              0%
├─ Federal exemption          ❌        ├─ Financial statements         ❌
├─ Security type              ❌        ├─ Outstanding securities       ❌
├─ Business combination?      ❌        ├─ Cap table                    ❌
├─ Minimum investment         ❌        ├─ Prior offerings (3yr)        ❌
├─ Total offering amount      ⚠️        ├─ Material indebtedness        ❌
├─ Amount sold                ❌        └─ Use of proceeds              ❌
├─ Amount remaining           ❌
├─ Investor count             ❌        OFFERING TERMS                   0%
│  ├─ Accredited              ❌        ├─ Target amount                ⚠️
│  └─ Non-accredited          ❌        ├─ Offering deadline            ❌
└─ Offering deadline          ❌        ├─ Price per security           ❌
                                       ├─ Accept oversubscriptions?    ❌
                                       ├─ Minimum investment           ❌
                                       └─ Use of proceeds              ❌

                                       OWNERSHIP STRUCTURE             14%
                                       ├─ Current ownership            ⚠️
                                       ├─ Authorized shares            ❌
                                       ├─ Outstanding by class         ❌
                                       ├─ Voting rights                ⚠️
                                       ├─ Dividend rights              ❌
                                       ├─ Liquidation preferences      ❌
                                       └─ Anti-dilution                ❌

                                       RELATED-PARTY TRANSACTIONS       0%
                                       ├─ Insider transactions         ❌
                                       ├─ Transaction amounts          ❌
                                       └─ Business purpose             ❌
```

---

## Coverage by Data Category

| Category | Status | Details |
|----------|--------|---------|
| **Basic Business Identity** | ✅ GOOD | Name, address, contact info complete |
| **Incorporation Details** | ❌ MISSING | Need jurisdiction, formation date, entity specificity |
| **Industry Classification** | ⚠️ PARTIAL | Need NAICS code, revenue range bracket |
| **Management Team** | 📋 SCATTERED | Data exists in related tables but not SEC-formatted |
| **Ownership Structure** | ⚠️ BASIC | Has percentages but missing share counts, classes, rights |
| **Financial Data** | ❌ MISSING | No statement storage, debt tracking, or use of proceeds |
| **Securities Offerings** | ❌ MISSING | No offering tracking at all |
| **Compliance History** | ❌ MISSING | No Form D/C filing dates, CIK numbers |
| **Risk Disclosures** | ❌ MISSING | No risk factor documentation |
| **Transactions** | ❌ MISSING | No related-party transaction tracking |

---

## What Exists vs. What's Needed

### Exists in Schema (Can Use Today)

| Field | Table | Coverage |
|-------|-------|----------|
| Business name (legal + DBA) | `businesses` | ✅ Full |
| Address, city, state, zip | `businesses` | ✅ Full |
| Phone, email, website | `businesses` | ✅ Full |
| Employee count | `businesses` | ✅ Full |
| Business description | `businesses` | ✅ Full |
| Business type | `businesses` | ⚠️ Partial (needs LLC/Corp specificity) |
| Registration date | `businesses` | ⚠️ Partial (can extract year) |
| Tax ID | `businesses` | ⚠️ Partial (no format validation) |
| Ownership percentages | `business_ownership` | ⚠️ Partial (no share counts) |
| Officer/director names | `business_user_roles` | 📋 Needs mapping to SEC format |
| Location coordinates | `businesses` | ✅ Full (not SEC-required) |
| Market value/asking price | `businesses` | ⚠️ Conflates sale vs. offering |

### Missing Entirely

| Requirement | Priority | Where It Belongs |
|-------------|----------|------------------|
| **Securities offering tracking** | CRITICAL | New table: `business_offerings` |
| **Financial statements** | CRITICAL | New table: `business_financial_statements` |
| **Capitalization table** | CRITICAL | New table: `business_share_classes` |
| **Outstanding debt** | HIGH | New table: `business_indebtedness` |
| **Related-party transactions** | HIGH | New table: `business_related_party_transactions` |
| **SEC-formatted persons** | HIGH | New table: `business_related_persons` |
| **Prior offering history** | MEDIUM | New table: `business_prior_offerings` |
| **Incorporation jurisdiction** | CRITICAL | Add to `businesses` |
| **NAICS code** | MEDIUM | Add to `businesses` |
| **Revenue range** | HIGH | Add to `businesses` |
| **Risk factors** | HIGH | Add to `businesses` |
| **CIK number** | LOW | Add to `businesses` |
| **Form D/C filing dates** | MEDIUM | Add to `businesses` |

---

## Compliance Readiness Score

### Overall: 35%

```
█████████░░░░░░░░░░░░░░░░ 35%

Basic Info:       ████████████████░░░░ 67%
Offering Data:    ░░░░░░░░░░░░░░░░░░░░  0%
Financial Data:   ░░░░░░░░░░░░░░░░░░░░  0%
Management Data:  ████░░░░░░░░░░░░░░░░ 20%
Ownership Data:   ███░░░░░░░░░░░░░░░░░ 14%
Compliance Data:  ░░░░░░░░░░░░░░░░░░░░  0%
```

### By Form Type

| Form | Purpose | Readiness | Blockers |
|------|---------|-----------|----------|
| **Form D** | Reg D filing (506b/506c) | 25% | Missing: offering table, exemption tracking, investor counts |
| **Form C** | Reg CF filing (crowdfunding) | 20% | Missing: financials, cap table, use of proceeds, related-party txns |
| **Reg A+** | Mini-IPO ($75M max) | 15% | Missing: audited financials, offering circular, ongoing reporting |

---

## Implementation Priority

### Can't Launch Without (Blockers)

1. `business_offerings` table - Track exemption type, amounts, dates
2. `business_share_classes` - Cap table with voting/dividend rights
3. `incorporation_jurisdiction` column - Required field on all forms
4. `revenue_range` column - Form D requirement
5. `risk_factors` column - Form C requirement

### Should Have (Best Practices)

6. `business_financial_statements` table - Investors demand this
7. `business_indebtedness` table - Material to valuation
8. `business_related_party_transactions` - Transparency/disclosure
9. NAICS code - Industry standardization
10. Prior offering history - SEC 3-year lookback

### Nice to Have (Future)

11. CIK number - If planning to go public
12. IP tracking - Valuable asset documentation
13. Target market description - Marketing clarity
14. Auditor information - Enhanced credibility

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Fully covered - field exists and meets requirement |
| ⚠️ | Partially covered - exists but needs enhancement |
| ❌ | Missing entirely - must be added |
| 📋 | Data exists in related table but not in SEC format |

---

## Files Generated

1. **Full Gap Analysis:** `SEC_FORM_COMPLIANCE_GAP_ANALYSIS.md`
   - Detailed field-by-field comparison
   - SEC requirement explanations
   - Implementation notes

2. **SQL Schema:** `../database/sec_compliance_schema_additions.sql`
   - 7 new tables
   - 12 new columns
   - RLS policies
   - Helper functions

3. **Quick Reference:** `SEC_COMPLIANCE_QUICKREF.md`
   - Implementation checklist
   - Form D vs. Form C comparison
   - Key compliance concepts

4. **Coverage Matrix:** This file
   - Visual coverage overview
   - What exists vs. what's needed
   - Priority rankings

---

**Next Action:** Run the SQL migration and update frontend types.
