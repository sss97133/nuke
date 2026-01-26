# SEC Form C & Form D Compliance Gap Analysis
## Businesses Table Schema Audit

**Date:** 2026-01-25
**Table:** `businesses`
**Purpose:** Evaluate investment readiness against SEC filing requirements

---

## Executive Summary

The `businesses` table has strong foundation for **operational/marketplace features** but has **critical gaps** for **SEC-compliant investment offerings**. Most missing fields relate to:

1. **Legal/incorporation details** (jurisdiction, formation date, entity structure)
2. **Securities/offering terms** (exemption type, share classes, investment minimums)
3. **Financial disclosures** (revenue ranges, use of proceeds, outstanding debt)
4. **Related party information** (beneficial owners, directors, officers)
5. **Regulatory tracking** (filing history, exemptions claimed)

**Investment Readiness Score: 35%**

---

## Schema Coverage Legend

| Symbol | Meaning |
|--------|---------|
| ✅ EXISTS | Field exists and covers requirement |
| ⚠️ PARTIAL | Exists but needs enhancement or validation |
| ❌ MISSING | Does not exist, must be added |
| 📋 RELATED | Exists in related table (specify which) |

---

## SEC Form D Requirements (Regulation D Offerings)

### Issuer Information

| Requirement | Status | Current Field | Notes |
|-------------|--------|---------------|-------|
| **Legal name of issuer** | ✅ EXISTS | `legal_name` | Good - distinct from DBA |
| **Trading name/DBA** | ✅ EXISTS | `business_name` | |
| **Jurisdiction of incorporation** | ❌ MISSING | - | Need: `incorporation_jurisdiction` (state/country) |
| **Type of entity** | ⚠️ PARTIAL | `business_type` | Covers LLC/corp but needs: C-corp, S-corp, LP, LLP, trust, fund |
| **Year of incorporation** | ⚠️ PARTIAL | `registration_date` | Has date, needs year extraction or separate `year_incorporated` |
| **IRS Employer ID (EIN)** | ⚠️ PARTIAL | `tax_id` | Exists but no validation/format check |
| **Principal place of business** | ✅ EXISTS | `address`, `city`, `state`, `zip_code`, `country` | Complete |
| **Phone number** | ✅ EXISTS | `phone` | |
| **Website** | ✅ EXISTS | `website` | |

**Issuer Score: 6/9 (67%)**

---

### Related Persons (Executives, Directors, Promoters)

| Requirement | Status | Current Solution | Notes |
|-------------|--------|------------------|-------|
| **Executive officers (names, titles)** | 📋 RELATED | `business_user_roles` | Has role_title, role_type |
| **Directors (names, addresses)** | ⚠️ PARTIAL | `business_user_roles` | Has user_id → profiles, but no address linkage |
| **Promoters (names, relationships)** | ❌ MISSING | - | No "promoter" role type exists |
| **Beneficial owners >20%** | ⚠️ PARTIAL | `business_ownership` | Has ownership_percentage but no "beneficial owner" designation |
| **Addresses for related persons** | ❌ MISSING | - | Profiles table may have user addresses but not required/linked |
| **Relationship descriptions** | ⚠️ PARTIAL | `ownership_type`, `role_title` | Limited to predefined types |

**Related Persons Score: 2/6 (33%)**

**Action Required:**
- Add "promoter" to `business_user_roles.role_type` enum
- Add "beneficial_owner" flag to `business_ownership`
- Create `business_related_persons` table with full SEC-required fields:
  - `person_type` (executive, director, promoter, beneficial_owner)
  - `full_legal_name`
  - `business_address`
  - `relationship_description`
  - `ownership_percentage` (if applicable)

---

### Industry & Classification

| Requirement | Status | Current Field | Notes |
|-------------|--------|---------------|-------|
| **Industry group classification** | ⚠️ PARTIAL | `industry_focus` (array) | Needs standardization to NAICS or SIC codes |
| **Revenue range** | ❌ MISSING | - | Form D requires range brackets (e.g., $1M-$5M) |
| **Number of employees** | ✅ EXISTS | `employee_count` | |

**Industry Score: 1/3 (33%)**

**Action Required:**
- Add `naics_code` (6-digit North American Industry Classification System)
- Add `revenue_range` enum: 'no_revenues', 'under_1m', '1m_5m', '5m_25m', '25m_100m', 'over_100m'
- Add `revenue_declaration_date` to track when revenue was reported

---

### Offering Details (Form D Specific)

| Requirement | Status | Current Field | Notes |
|-------------|--------|---------------|-------|
| **Federal exemption(s) claimed** | ❌ MISSING | - | Need: Rule 504, 506(b), 506(c), Reg A+, etc. |
| **Type of securities offered** | ❌ MISSING | - | Common stock, preferred stock, LLC membership interests, debt, convertible notes |
| **Business combination transaction?** | ❌ MISSING | - | Yes/No field |
| **Minimum investment amount** | ❌ MISSING | - | Dollar amount per investor |
| **Total offering amount** | ⚠️ PARTIAL | `asking_price` | Conflates business sale vs. offering amount |
| **Amount already sold** | ❌ MISSING | - | Total proceeds to date |
| **Total remaining to be sold** | ❌ MISSING | - | Calculated field |
| **Number of investors** | ❌ MISSING | - | Count (accredited vs. non-accredited) |
| **Offering deadline** | ❌ MISSING | - | Date by which offering must close |

**Offering Score: 0/9 (0%)**

**Action Required:**
Create new table `business_offerings` with:
```sql
CREATE TABLE business_offerings (
  id UUID PRIMARY KEY,
  business_id UUID REFERENCES businesses(id),

  -- Exemption details
  federal_exemption TEXT[], -- ['506b', '506c', 'reg_cf', 'reg_a_plus']
  state_exemptions TEXT[], -- State-level exemptions claimed

  -- Security details
  security_type TEXT, -- 'common_stock', 'preferred_stock', 'llc_interests', 'convertible_note', 'safe', 'debt'
  share_class TEXT, -- 'Class A', 'Class B', etc.

  -- Offering terms
  total_offering_amount NUMERIC(15,2),
  minimum_investment NUMERIC(12,2),
  maximum_investment NUMERIC(12,2),

  -- Progress
  amount_sold NUMERIC(15,2) DEFAULT 0,
  amount_remaining NUMERIC(15,2),
  total_investors INTEGER DEFAULT 0,
  accredited_investors INTEGER DEFAULT 0,
  non_accredited_investors INTEGER DEFAULT 0,

  -- Timeline
  offering_start_date DATE,
  offering_end_date DATE,
  first_sale_date DATE,

  -- Flags
  is_business_combination BOOLEAN DEFAULT false,
  indefinite_offering BOOLEAN DEFAULT false,

  -- Tracking
  form_d_filed_date DATE,
  form_d_file_number TEXT,

  status TEXT, -- 'pending', 'active', 'closed', 'terminated'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## SEC Form C Requirements (Regulation Crowdfunding)

### Basic Entity Information

| Requirement | Status | Current Field | Notes |
|-------------|--------|---------------|-------|
| **Legal name** | ✅ EXISTS | `legal_name` | |
| **Legal status/entity type** | ⚠️ PARTIAL | `business_type` | Needs LLC/Corp/LP specificity |
| **Jurisdiction of organization** | ❌ MISSING | - | State/country of formation |
| **Date of organization** | ⚠️ PARTIAL | `registration_date` | Good if accurate |
| **Physical address (principal)** | ✅ EXISTS | `address`, `city`, `state`, `zip_code` | |
| **Website** | ✅ EXISTS | `website` | |

**Basic Info Score: 4/6 (67%)**

---

### Directors, Officers, and 20%+ Beneficial Owners

| Requirement | Status | Current Solution | Notes |
|-------------|--------|------------------|-------|
| **Names of all directors** | 📋 RELATED | `business_user_roles` (role_type='owner'/'manager') | No "director" role type |
| **Names of all officers** | 📋 RELATED | `business_user_roles` | Has role_title but not standardized (CEO, CFO, etc.) |
| **Names of 20%+ beneficial owners** | ⚠️ PARTIAL | `business_ownership` (ownership_percentage >= 20) | Exists but not flagged for disclosure |
| **Titles for each** | ⚠️ PARTIAL | `role_title`, `ownership_title` | Free text, not standardized |
| **Prior experience/background** | ❌ MISSING | - | No bio/resume fields |

**Directors/Officers Score: 1/5 (20%)**

**Action Required:**
- Add `is_sec_reportable` boolean to `business_ownership` (auto-set if ownership_percentage >= 20)
- Add officer/director fields to profiles or business_user_roles:
  - `prior_experience TEXT`
  - `educational_background TEXT`
  - `other_business_affiliations TEXT`
- Standardize `role_title` with enum for SEC officers: CEO, CFO, COO, President, Secretary, Director

---

### Business Description & Operations

| Requirement | Status | Current Field | Notes |
|-------------|--------|---------------|-------|
| **Description of business** | ✅ EXISTS | `description` | |
| **Number of employees** | ✅ EXISTS | `employee_count` | |
| **Risks of investment** | ❌ MISSING | - | Required disclosure section |
| **Target market** | ⚠️ PARTIAL | `industry_focus`, `specializations` | Not formalized |
| **Intellectual property** | ❌ MISSING | - | Patents, trademarks, copyrights |

**Business Description Score: 2/5 (40%)**

**Action Required:**
- Add `risk_factors TEXT` (long-form disclosure)
- Add `target_market_description TEXT`
- Add `intellectual_property JSONB` with structure:
  ```json
  {
    "patents": [{"number": "US123456", "status": "granted", "description": "..."}],
    "trademarks": [...],
    "copyrights": [...]
  }
  ```

---

### Financial Condition

| Requirement | Status | Current Field | Notes |
|-------------|--------|---------------|-------|
| **Discussion of financial condition** | ❌ MISSING | - | MD&A (Management Discussion & Analysis) |
| **Financial statements** | ❌ MISSING | - | Balance sheet, income statement, cash flow |
| **Outstanding securities description** | ❌ MISSING | - | Existing stock/debt structure |
| **Capitalization table** | ❌ MISSING | - | Who owns what shares |
| **Previous exempt offerings (3 years)** | ❌ MISSING | - | Prior Reg D/Reg CF raises |
| **Material indebtedness** | ⚠️ PARTIAL | - | Partial via `metadata` but not structured |
| **Use of proceeds** | ❌ MISSING | - | How capital will be used |

**Financial Score: 0/7 (0%)**

**Action Required:**
Create new table `business_financial_statements`:
```sql
CREATE TABLE business_financial_statements (
  id UUID PRIMARY KEY,
  business_id UUID REFERENCES businesses(id),

  -- Statement metadata
  statement_type TEXT, -- 'balance_sheet', 'income_statement', 'cash_flow', 'cap_table'
  period_start_date DATE,
  period_end_date DATE,
  is_audited BOOLEAN DEFAULT false,
  auditor_name TEXT,

  -- File references
  document_url TEXT, -- PDF/Excel of full statements

  -- Key figures (for quick display)
  total_assets NUMERIC(15,2),
  total_liabilities NUMERIC(15,2),
  shareholders_equity NUMERIC(15,2),
  revenue NUMERIC(15,2),
  net_income NUMERIC(15,2),
  cash_on_hand NUMERIC(15,2),

  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Create `business_indebtedness` table:
```sql
CREATE TABLE business_indebtedness (
  id UUID PRIMARY KEY,
  business_id UUID REFERENCES businesses(id),

  creditor_name TEXT NOT NULL,
  debt_type TEXT, -- 'loan', 'line_of_credit', 'bonds', 'convertible_note', 'other'
  principal_amount NUMERIC(15,2),
  outstanding_balance NUMERIC(15,2),
  interest_rate NUMERIC(5,2), -- percentage
  maturity_date DATE,
  is_secured BOOLEAN DEFAULT false,
  collateral_description TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### Offering Terms (Form C Specific)

| Requirement | Status | Current Field | Notes |
|-------------|--------|---------------|-------|
| **Target offering amount** | ⚠️ PARTIAL | `asking_price` | Conflates sale vs. raise |
| **Offering deadline** | ❌ MISSING | - | Date by which target must be met |
| **Price per security or method** | ❌ MISSING | - | Price per share or valuation formula |
| **Will accept oversubscriptions?** | ❌ MISSING | - | Yes/No + max amount |
| **Minimum investment amount** | ❌ MISSING | - | Per investor |
| **Use of proceeds** | ❌ MISSING | - | Breakdown table (e.g., 40% equipment, 30% marketing) |

**Offering Terms Score: 0/6 (0%)**

**Action Required:**
Extend `business_offerings` table (from Form D section) with:
- `accepts_oversubscriptions BOOLEAN`
- `max_oversubscription_amount NUMERIC(15,2)`
- `price_per_share NUMERIC(10,4)` or `valuation_method TEXT`
- `use_of_proceeds JSONB`:
  ```json
  {
    "equipment": {"amount": 200000, "percentage": 40},
    "marketing": {"amount": 150000, "percentage": 30},
    "working_capital": {"amount": 100000, "percentage": 20},
    "other": {"amount": 50000, "percentage": 10, "description": "Legal fees"}
  }
  ```

---

### Ownership & Capital Structure (Form C)

| Requirement | Status | Current Field | Notes |
|-------------|--------|---------------|-------|
| **Current ownership structure** | ⚠️ PARTIAL | `business_ownership` | Has percentages but not share counts |
| **Authorized shares** | ❌ MISSING | - | Total authorized vs. issued |
| **Outstanding shares by class** | ❌ MISSING | - | Common, preferred, etc. |
| **Voting rights by class** | ⚠️ PARTIAL | `voting_rights` (boolean) | Not class-level |
| **Dividend rights** | ❌ MISSING | - | Terms of dividends |
| **Liquidation preferences** | ❌ MISSING | - | Order of payout in exit |
| **Anti-dilution provisions** | ❌ MISSING | - | Protections for existing shareholders |

**Ownership Score: 1/7 (14%)**

**Action Required:**
Create `business_share_classes` table:
```sql
CREATE TABLE business_share_classes (
  id UUID PRIMARY KEY,
  business_id UUID REFERENCES businesses(id),

  share_class_name TEXT NOT NULL, -- 'Common', 'Series A Preferred', etc.

  -- Authorization
  authorized_shares INTEGER,
  issued_shares INTEGER,
  outstanding_shares INTEGER,
  treasury_shares INTEGER,

  -- Rights
  voting_rights TEXT, -- 'full', 'limited', 'none'
  votes_per_share NUMERIC(5,2) DEFAULT 1.0,
  dividend_rights TEXT,
  dividend_rate NUMERIC(5,2), -- if fixed
  liquidation_preference NUMERIC(5,2), -- multiple (e.g., 1.5x)
  liquidation_priority INTEGER, -- 1 = first in line
  conversion_rights TEXT,

  -- Anti-dilution
  anti_dilution_type TEXT, -- 'full_ratchet', 'weighted_average', 'none'

  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### Related-Party Transactions (Form C)

| Requirement | Status | Current Field | Notes |
|-------------|--------|---------------|-------|
| **Transactions with insiders** | ❌ MISSING | - | Loans, sales, leases to/from officers/directors |
| **Transaction amounts** | ❌ MISSING | - | Dollar values |
| **Business purpose** | ❌ MISSING | - | Explanation of transaction |

**Related-Party Score: 0/3 (0%)**

**Action Required:**
Create `business_related_party_transactions` table:
```sql
CREATE TABLE business_related_party_transactions (
  id UUID PRIMARY KEY,
  business_id UUID REFERENCES businesses(id),

  -- Party information
  related_party_name TEXT NOT NULL,
  related_party_relationship TEXT, -- 'officer', 'director', 'beneficial_owner', 'family_member'
  related_party_user_id UUID REFERENCES auth.users(id), -- if on platform

  -- Transaction details
  transaction_type TEXT, -- 'loan', 'lease', 'purchase', 'sale', 'service_agreement'
  transaction_date DATE,
  transaction_amount NUMERIC(12,2),
  terms TEXT, -- Description of terms (interest rate, payment schedule, etc.)
  business_purpose TEXT, -- Why transaction occurred

  -- Approvals
  board_approved BOOLEAN DEFAULT false,
  approval_date DATE,

  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Summary Gap Analysis

### Coverage by Category

| Category | Covered | Partial | Missing | Score |
|----------|---------|---------|---------|-------|
| **Issuer Information (Form D)** | 6 | 3 | 0 | 67% |
| **Related Persons (Form D)** | 0 | 4 | 2 | 33% |
| **Industry Classification (Form D)** | 1 | 1 | 1 | 33% |
| **Offering Details (Form D)** | 0 | 1 | 8 | 0% |
| **Basic Entity Info (Form C)** | 4 | 2 | 0 | 67% |
| **Directors/Officers (Form C)** | 0 | 3 | 2 | 20% |
| **Business Description (Form C)** | 2 | 1 | 2 | 40% |
| **Financial Condition (Form C)** | 0 | 1 | 6 | 0% |
| **Offering Terms (Form C)** | 0 | 1 | 5 | 0% |
| **Ownership Structure (Form C)** | 0 | 2 | 5 | 14% |
| **Related-Party Transactions (Form C)** | 0 | 0 | 3 | 0% |

### Overall Investment Readiness: 35%

---

## Priority Action Items

### Critical (Required for ANY offering)

1. **Create `business_offerings` table** - Track offering exemptions, terms, progress
2. **Create `business_financial_statements` table** - Store audited financials
3. **Create `business_share_classes` table** - Capitalization structure
4. **Add `incorporation_jurisdiction` to businesses** - State/country of formation
5. **Add `revenue_range` to businesses** - SEC-required bracket
6. **Add `use_of_proceeds` to offerings** - Required for Form C/D

### High Priority (Compliance & Due Diligence)

7. **Create `business_related_party_transactions` table** - Insider transaction disclosure
8. **Create `business_indebtedness` table** - Outstanding debt tracking
9. **Add `risk_factors` to businesses or offerings** - Investor warnings
10. **Standardize officer/director roles** - CEO, CFO, etc. vs. free-text titles
11. **Add `is_sec_reportable` flag to business_ownership** - Auto-mark 20%+ owners

### Medium Priority (Enhanced Disclosures)

12. **Add `naics_code` to businesses** - Industry classification standard
13. **Add `intellectual_property` JSONB to businesses** - Patent/trademark tracking
14. **Add officer bio fields** - `prior_experience`, `educational_background`
15. **Create `business_prior_offerings` table** - Track exempt offering history

### Low Priority (Nice to Have)

16. **Add `form_d_file_number` to offerings** - SEC filing reference
17. **Add `auditor_name` to financial statements** - External validation
18. **Add state exemption tracking** - Beyond federal (varies by state)

---

## New Tables Required (7 total)

1. `business_offerings` - Securities offerings (Reg D, Reg CF, Reg A+)
2. `business_financial_statements` - Balance sheet, income statement, cash flow
3. `business_indebtedness` - Loans, lines of credit, bonds
4. `business_share_classes` - Common stock, preferred stock, voting rights
5. `business_related_party_transactions` - Insider transactions
6. `business_related_persons` - SEC-required disclosure format (directors, officers, promoters)
7. `business_prior_offerings` - Historical fundraising (3-year lookback)

---

## New Columns Required (businesses table)

```sql
-- Critical additions
ALTER TABLE businesses ADD COLUMN incorporation_jurisdiction TEXT; -- State/country
ALTER TABLE businesses ADD COLUMN naics_code TEXT; -- Industry code (6 digits)
ALTER TABLE businesses ADD COLUMN revenue_range TEXT
  CHECK (revenue_range IN ('no_revenues', 'under_1m', '1m_5m', '5m_25m', '25m_100m', 'over_100m'));
ALTER TABLE businesses ADD COLUMN revenue_declaration_date DATE;

-- Compliance tracking
ALTER TABLE businesses ADD COLUMN is_sec_filer BOOLEAN DEFAULT false;
ALTER TABLE businesses ADD COLUMN latest_form_d_date DATE;
ALTER TABLE businesses ADD COLUMN latest_form_c_date DATE;
ALTER TABLE businesses ADD COLUMN cik_number TEXT; -- SEC Central Index Key

-- Disclosures
ALTER TABLE businesses ADD COLUMN risk_factors TEXT; -- Long-form investment risks
ALTER TABLE businesses ADD COLUMN intellectual_property JSONB DEFAULT '{}';
ALTER TABLE businesses ADD COLUMN target_market_description TEXT;
```

---

## Recommendation

**To enable SEC-compliant investment offerings, prioritize:**

1. **Phase 1 (Core Compliance):** Create offerings, financial_statements, and share_classes tables
2. **Phase 2 (Due Diligence):** Add indebtedness, related_party_transactions, and prior_offerings tables
3. **Phase 3 (Enhancements):** Standardize roles, add NAICS codes, IP tracking

Without Phase 1, the platform **cannot legally facilitate Reg D or Reg CF offerings**. The current schema supports marketplace/operational features well, but investment features require fundamental schema additions.

---

**Generated:** 2026-01-25
**Next Review:** After schema updates implemented
