# SEC Compliance Quick Reference

**Generated:** 2026-01-25
**Investment Readiness:** 35%

---

## What We Have vs. What We Need

### Current State (businesses table)

**Strong Areas:**
- Basic business information (name, address, contact)
- Operational metrics (employees, revenue, projects)
- Location data (GPS coordinates)
- Business relationships (ownership, roles, fleet)
- Reputation/performance tracking

**Critical Gaps:**
- No securities offering tracking
- No financial statement storage
- No capitalization table (share classes)
- No debt/indebtedness tracking
- No related-party transaction disclosure
- Missing incorporation details (jurisdiction, formation date)
- No SEC filing history

---

## Implementation Checklist

### Phase 1: Core Compliance (Required for ANY offering)

- [ ] Create `business_offerings` table
  - Track Reg D, Reg CF, Reg A+ offerings
  - Federal/state exemptions claimed
  - Offering amounts, dates, investor counts
  - Use of proceeds breakdown

- [ ] Create `business_financial_statements` table
  - Balance sheet, income statement, cash flow
  - Audit status and auditor information
  - Key figures extractable for quick display

- [ ] Create `business_share_classes` table
  - Common stock, preferred stock
  - Voting rights, dividend rights
  - Liquidation preferences, conversion rights
  - Anti-dilution provisions

- [ ] Add to businesses table:
  - `incorporation_jurisdiction` (state/country)
  - `year_incorporated`
  - `naics_code` (industry classification)
  - `revenue_range` (SEC-required bracket)
  - `risk_factors` (investment warnings)

**Estimated Effort:** 2-3 days

---

### Phase 2: Due Diligence & Transparency

- [ ] Create `business_indebtedness` table
  - Loans, lines of credit, bonds
  - Terms, maturity dates, interest rates
  - Security/collateral descriptions

- [ ] Create `business_related_party_transactions` table
  - Insider transactions (loans, leases, purchases)
  - Fair market value determinations
  - Board approvals

- [ ] Create `business_related_persons` table
  - Directors, officers, promoters
  - 20%+ beneficial owners
  - SEC-compliant address and background info

- [ ] Create `business_prior_offerings` table
  - Historical fundraising (3-year lookback)
  - Form D/C filing numbers

**Estimated Effort:** 1-2 days

---

### Phase 3: Enhancements & Validation

- [ ] Add SEC filing tracking columns:
  - `is_sec_filer`, `cik_number`
  - `latest_form_d_date`, `latest_form_c_date`

- [ ] Add intellectual property tracking:
  - `intellectual_property` (JSONB: patents, trademarks, copyrights)

- [ ] Standardize business_user_roles:
  - Add "promoter" to role_type enum
  - Standardize officer titles (CEO, CFO, etc.)

- [ ] Add computed column to business_ownership:
  - `is_sec_reportable` (auto-set if ownership >= 20%)

**Estimated Effort:** 1 day

---

## Form D vs. Form C Requirements

| Requirement Category | Form D (Reg D) | Form C (Reg CF) | Current Coverage |
|----------------------|----------------|-----------------|------------------|
| **Basic entity info** | Required | Required | 67% |
| **Officers/directors** | Required | Required + bios | 20% |
| **Offering terms** | Required | Required | 0% |
| **Financial statements** | Not required* | Required (audited) | 0% |
| **Use of proceeds** | Optional | Required | 0% |
| **Cap table** | Optional | Required | 14% |
| **Related-party transactions** | Optional | Required | 0% |
| **Risk factors** | Optional | Required | 0% |

*Form D doesn't require financial statements to be filed, but investors will demand them in practice.

---

## SQL Migration File

Location: `/Users/skylar/nuke/database/sec_compliance_schema_additions.sql`

**What it includes:**
- 7 new tables (offerings, financials, share classes, debt, related parties, etc.)
- 12 new columns for businesses table
- RLS policies for all new tables
- Helper functions (calculate total debt, check if offering fully subscribed)
- Comments and documentation

**How to run:**
```bash
cd /Users/skylar/nuke
supabase db push database/sec_compliance_schema_additions.sql
```

---

## Key Compliance Concepts

### Exemption Types

| Exemption | Max Raise | Investor Limits | Advertising | Disclosure |
|-----------|-----------|-----------------|-------------|------------|
| **Rule 506(b)** | Unlimited | 35 non-accredited + unlimited accredited | No general solicitation | Form D filing |
| **Rule 506(c)** | Unlimited | Accredited only | General solicitation OK | Form D + verification |
| **Reg CF** | $5M/year | Unlimited | Crowdfunding OK | Form C + ongoing reports |
| **Reg A+** | $75M (Tier 2) | Unlimited | General solicitation OK | Offering circular + audited financials |

### Accredited Investor Definition

- Income: $200k+ individual / $300k+ joint (last 2 years)
- Net Worth: $1M+ (excluding primary residence)
- Professional: Series 7, 65, 82 license holders
- Entity: $5M+ in assets

### 20% Beneficial Owner Threshold

SEC requires disclosure of anyone who owns 20%+ of voting securities. This triggers:
- Form D/Form C disclosure requirements
- Reporting in capitalization table
- Insider transaction tracking
- Potential Section 16 reporting (if publicly traded)

---

## Next Steps

1. **Review gap analysis:** `/Users/skylar/nuke/docs/SEC_FORM_COMPLIANCE_GAP_ANALYSIS.md`
2. **Run SQL migration:** `/Users/skylar/nuke/database/sec_compliance_schema_additions.sql`
3. **Update TypeScript types** in `nuke_frontend` to match new schema
4. **Build admin UI** for managing offerings, financials, cap table
5. **Implement Form D/C export** functions to generate SEC filings
6. **Add validation logic** to ensure required fields are complete before filing

---

## Contact & Resources

- **SEC EDGAR Filing System:** https://www.sec.gov/edgar
- **Form D Instructions:** https://www.sec.gov/files/formd.pdf
- **Form C Instructions:** https://www.sec.gov/files/formc.pdf
- **Reg CF Portal Rules:** https://www.sec.gov/info/smallbus/secg/rccomplianceguide-051316.htm

---

**Questions?** Review the full gap analysis for detailed field mappings and compliance requirements.
