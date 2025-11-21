# Accounting Integration Architecture

## The Problem You're Solving

```
CAR BUSINESS ACCOUNTING CHALLENGES:
═══════════════════════════════════

❌ Parts are both inventory (asset) AND expense (when installed)
❌ Labor is both direct cost (billable) AND overhead (unbillable)
❌ Tools depreciate over time (not immediate expense)
❌ Work-in-progress needs tracking (partially completed jobs)
❌ Shop overhead allocation (rent, utilities, insurance)
❌ Multiple revenue streams (work + social + partnerships)
❌ Tax implications vary by transaction type
❌ Standard accounting software doesn't understand this
```

## Your Solution: Modular Accounting Backend

```
┌─────────────────────────────────────────────────────────────┐
│                  NUKE PLATFORM                              │
│  (Captures automotive-specific transactions)                │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│           ACCOUNTING TRANSLATION LAYER                      │
│  (Converts to standard accounting entries)                  │
├─────────────────────────────────────────────────────────────┤
│  • Chart of Accounts (industry-standard)                    │
│  • Double-entry bookkeeping                                 │
│  • Journal entries                                          │
│  • General ledger                                           │
│  • Accrual vs Cash basis                                    │
└───────────────────────────┬─────────────────────────────────┘
                            │
           ┌────────────────┼────────────────┐
           │                │                │
           ▼                ▼                ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │QuickBooks│    │ Xero     │    │PennyLane │
    │  API     │    │  API     │    │  API     │
    └──────────┘    └──────────┘    └──────────┘
           │                │                │
           └────────────────┴────────────────┘
                            │
                            ▼
              USER'S EXISTING ACCOUNTING SYSTEM
```

---

## Chart of Accounts (Automotive-Specific)

```
ASSETS
├─ 1000 - Cash
├─ 1200 - Accounts Receivable (customer invoices)
├─ 1300 - Parts Inventory (on shelf)
├─ 1400 - Tools & Equipment (capitalized assets)
├─ 1450 - Accumulated Depreciation - Tools (contra-asset)
└─ 1500 - Work-in-Progress (partially completed jobs)

LIABILITIES
├─ 2000 - Accounts Payable (supplier invoices)
├─ 2100 - Customer Deposits (prepayments)
└─ 2200 - Sales Tax Payable

EQUITY
├─ 3000 - Owner's Equity
└─ 3900 - Retained Earnings

REVENUE
├─ 4000 - Labor Revenue (billable hours)
├─ 4100 - Parts Revenue (parts sold to customers)
├─ 4200 - Shop Fees Revenue (environmental, hazmat, etc.)
├─ 4300 - Partnership Revenue (Mobil 1, etc.)
├─ 4400 - Sponsorship Revenue
└─ 4500 - Viewer Revenue (tips, memberships)

COST OF GOODS SOLD (COGS)
├─ 5000 - Parts Cost (what you paid suppliers)
├─ 5100 - Direct Labor Cost (tech wages for billable work)
└─ 5200 - Subcontractor Costs

EXPENSES
├─ 6000 - Indirect Labor (non-billable admin time)
├─ 6100 - Shop Supplies (consumed but not billed)
├─ 6200 - Tool Depreciation (calculated usage)
├─ 6300 - Rent
├─ 6400 - Utilities
├─ 6500 - Insurance
├─ 6600 - Marketing
├─ 6700 - Office Supplies
└─ 6800 - Professional Services (accountant, etc.)
```

---

## Transaction Examples: How Automotive Work Maps to Accounting

### Example 1: Oil Change (Cash Basis)

```
TIMELINE EVENT:
Oil change completed, customer paid $350 cash

JOURNAL ENTRIES:
┌─────────────────────────────────────────────┐
│ Date: June 15, 2024                         │
├─────────────────────────────────────────────┤
│ Dr. Cash                        $350.00     │  ← Money received
│    Cr. Labor Revenue                $187.50 │  ← Service provided
│    Cr. Parts Revenue                 $57.00 │  ← Parts sold
│    Cr. Shop Fees Revenue             $10.00 │  ← Fees collected
│    Cr. Sales Tax Payable            $95.50  │  ← Tax owed to state
├─────────────────────────────────────────────┤
│ Dr. Parts Cost (COGS)            $40.70     │  ← What parts cost you
│    Cr. Parts Inventory              $40.70  │  ← Remove from shelf
├─────────────────────────────────────────────┤
│ Dr. Direct Labor Cost            $120.00    │  ← Tech wages
│    Cr. Cash/Payroll Payable        $120.00  │  ← Owed to tech
├─────────────────────────────────────────────┤
│ Dr. Tool Depreciation Expense     $8.50     │  ← Lift usage
│    Cr. Accumulated Depreciation     $8.50   │  ← Asset value reduced
└─────────────────────────────────────────────┘

RESULT:
Revenue:        $254.50
COGS:          -$40.70
Labor Cost:    -$120.00
Tool Depr:      -$8.50
Supplies:       -$5.00
────────────────────────
Gross Profit:   $80.30  (31.6% margin)
```

### Example 2: Restoration Project (Accrual Basis, Work-in-Progress)

```
Phase 1: Parts Ordered (not yet installed)
┌─────────────────────────────────────────────┐
│ Dr. Parts Inventory            $5,420.00    │  ← Asset on shelf
│    Cr. Accounts Payable           $5,420.00 │  ← Owe supplier
└─────────────────────────────────────────────┘

Phase 2: Work Started (moves to WIP)
┌─────────────────────────────────────────────┐
│ Dr. Work-in-Progress           $5,420.00    │  ← Job in progress
│    Cr. Parts Inventory            $5,420.00 │  ← Remove from shelf
├─────────────────────────────────────────────┤
│ Dr. Work-in-Progress           $2,600.00    │  ← Labor added to WIP
│    Cr. Direct Labor Cost          $2,600.00 │  ← Tech hours
└─────────────────────────────────────────────┘

Phase 3: Work Completed (revenue recognized)
┌─────────────────────────────────────────────┐
│ Dr. Accounts Receivable       $10,000.00    │  ← Invoice sent
│    Cr. Labor Revenue              $2,600.00 │  ← Service revenue
│    Cr. Parts Revenue              $5,250.00 │  ← Parts revenue
│    Cr. Shop Fees Revenue            $207.13 │  ← Fees revenue
│    Cr. Sales Tax Payable          $1,942.87 │  ← Tax collected
├─────────────────────────────────────────────┤
│ Dr. Cost of Goods Sold (COGS)  $8,020.00   │  ← Total costs
│    Cr. Work-in-Progress            $8,020.00│  ← Clear WIP
└─────────────────────────────────────────────┘

Phase 4: Payment Received (Net 30)
┌─────────────────────────────────────────────┐
│ Dr. Cash                      $10,000.00    │  ← Money in bank
│    Cr. Accounts Receivable      $10,000.00  │  ← Clear invoice
└─────────────────────────────────────────────┘

RESULT (Accrual):
Revenue:        $8,057.13
COGS:          -$8,020.00
────────────────────────
Gross Profit:      $37.13  (0.5% - thin margins on project work)

(Plus social value: $500 partnership = $537.13 total profit)
```

---

## Integration APIs

### QuickBooks Online API
```json
{
  "Invoice": {
    "Line": [
      {"Description": "Labor - Engine Rebuild", "Amount": 2600.00, "DetailType": "SalesItemLineDetail", "SalesItemLineDetail": {"ItemRef": {"value": "4000"}}},
      {"Description": "LS3 Crate Engine", "Amount": 6500.00, "DetailType": "SalesItemLineDetail", "SalesItemLineDetail": {"ItemRef": {"value": "4100"}}}
    ],
    "CustomerRef": {"value": "client-789"},
    "DueDate": "2025-12-21",
    "TotalAmt": 8976.24
  }
}
```

### Xero API
```json
{
  "Type": "ACCREC",
  "Contact": {"ContactID": "client-789"},
  "LineItems": [
    {"Description": "Labor - Engine Rebuild", "Quantity": 40, "UnitAmount": 65.00, "AccountCode": "4000"},
    {"Description": "Parts", "Quantity": 1, "UnitAmount": 5250.00, "AccountCode": "4100"}
  ],
  "Date": "2025-11-21",
  "DueDate": "2025-12-21",
  "Status": "DRAFT"
}
```

### PennyLane API
```json
{
  "invoice": {
    "customer": {"id": "client-789"},
    "line_items": [
      {"label": "Labor - Engine Rebuild", "quantity": 40, "unit": "hour", "unit_price": 65.00, "vat_rate": "standard"},
      {"label": "Parts", "quantity": 1, "unit_price": 5250.00, "vat_rate": "standard"}
    ],
    "date": "2025-11-21",
    "deadline": "2025-12-21",
    "currency": "USD"
  }
}
```

This is **exactly** what you need - not banking, but **accounting automation**. Want me to implement the accounting backend next?

