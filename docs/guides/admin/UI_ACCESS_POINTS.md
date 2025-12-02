# UI Access Points for Backend Tools

**Deployment**: November 22, 2025  
**Status**: ✅ Live in Production  

---

## 🎯 Where to Access New Backend Capabilities

### **1. Timeline Event Modal** (PRIMARY ACCESS POINT)

**Location**: Click any event on vehicle timeline  
**File**: `nuke_frontend/src/components/TimelineEventModal.tsx`  
**URL**: Any vehicle profile → Timeline → Click event

```
┌──────────────────────────────────────────────────────────┐
│  [PREV]  Event Title  [NEXT]  3/12  [CLOSE]             │
├──────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌───────────────────────────────────┐ │
│  │             │  │  [SHOW FINANCIAL DATA] ← CLICK    │ │
│  │   IMAGE     │  │                                    │ │
│  │             │  │  ┌─────────────────────────────┐  │ │
│  │             │  │  │ Client: John █████          │  │ │
│  │             │  │  │ Privacy: MEDIUM             │  │ │
│  │             │  │  └─────────────────────────────┘  │ │
│  │             │  │                                    │ │
│  │             │  │  ┌─────────────────────────────┐  │ │
│  │             │  │  │ TCI Breakdown:              │  │ │
│  │             │  │  │ Labor:      $187.50         │  │ │
│  │             │  │  │ Parts:       $45.00         │  │ │
│  │             │  │  │ Supplies:     $5.00         │  │ │
│  │             │  │  │ Tools:        $8.50         │  │ │
│  │             │  │  │ Shop Fees:   $10.00         │  │ │
│  │             │  │  │ ─────────────────           │  │ │
│  │             │  │  │ TOTAL:      $256.00         │  │ │
│  │             │  │  │                             │  │ │
│  │             │  │  │ Customer:   $350.00         │  │ │
│  │             │  │  │ Profit:      $94.00 (26.9%)│  │ │
│  │             │  │  └─────────────────────────────┘  │ │
│  │             │  │                                    │ │
│  │             │  │  ┌─────────────────────────────┐  │ │
│  │             │  │  │ Parts & Suppliers:          │  │ │
│  │             │  │  │ Mobil 1 5W-30 (#M1-5W30)    │  │ │
│  │             │  │  │ $28.50 → $45.00 (57.9%)     │  │ │
│  │             │  │  │ AutoZone ★★★★☆ 96.8%        │  │ │
│  │             │  │  └─────────────────────────────┘  │ │
│  │             │  │                                    │ │
│  │             │  │  ┌─────────────────────────────┐  │ │
│  │             │  │  │ Social Value:               │  │ │
│  │             │  │  │ 2,430 views • 10.04% rate   │  │ │
│  │             │  │  │ Partnerships:    $85.00     │  │ │
│  │             │  │  │ Viewer Tips:     $42.50     │  │ │
│  │             │  │  │ ─────────────────           │  │ │
│  │             │  │  │ Total Social:   $127.50     │  │ │
│  │             │  │  └─────────────────────────────┘  │ │
│  │             │  │                                    │ │
│  │             │  │  ┌─────────────────────────────┐  │ │
│  │             │  │  │ COMBINED PROFIT: $221.50    │  │ │
│  │             │  │  │ 63.3% margin                │  │ │
│  │             │  │  └─────────────────────────────┘  │ │
│  │             │  │                                    │ │
│  │             │  │  ┌─────────────────────────────┐  │ │
│  │             │  │  │ Turnaround: 52.5hrs         │  │ │
│  │             │  │  │ Order→Delivery: 29.3hrs     │  │ │
│  │             │  │  │ Delivery→Install: 20.1hrs   │  │ │
│  │             │  │  │ Work Duration: 2.5hrs       │  │ │
│  │             │  │  └─────────────────────────────┘  │ │
│  │             │  │                                    │ │
│  │             │  │  [GENERATE INVOICE] ← PRIMARY   │  │ │
│  │             │  │  [Add Details]                  │  │ │
│  │             │  │  [Correct] [Tag People]         │  │ │
│  └─────────────┘  └───────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

**Features Available**:
- ✅ **Client Display** (privacy-masked automatically)
- ✅ **TCI Breakdown** (labor, parts, supplies, overhead, tools, fees)
- ✅ **Profit Margin** (work profit calculation)
- ✅ **Parts Details** (with supplier ratings)
- ✅ **Social Value** (partnerships, tips, engagement)
- ✅ **Combined Profit** (work + social)
- ✅ **Turnaround Metrics** (if parts were tracked)
- ✅ **Generate Invoice** (one-click invoice creation)

---

### **2. Vehicle Profile Page** (FUTURE ACCESS POINT)

**Location**: `/vehicle/:id`  
**Suggested Addition**: Financial tab/section

```
Vehicle Profile Tabs:
├─ Overview (existing)
├─ Timeline (existing)
├─ Documents (existing)
├─ BUILD (existing)
└─ FINANCIALS (NEW) ← Add this
   ├─ TCI Summary
   ├─ Invoices Generated
   ├─ Payment Status
   ├─ Profitability Chart
   └─ Export to Accounting
```

---

### **3. Organization/Shop Dashboard** (FUTURE)

**Location**: `/org/:id` or new `/shop/dashboard`  
**Purpose**: Business-level financial overview

```
Shop Dashboard:
├─ Active Jobs (WIP)
├─ Unbilled Events
├─ Outstanding Invoices
├─ Monthly P&L
├─ Supplier Performance
├─ Tool Usage Reports
└─ Export to QuickBooks/Xero
```

---

### **4. User Profile - Contributions** (FUTURE)

**Location**: `/profile/:id`  
**Purpose**: Technician-level earnings/work tracking

```
Technician Profile:
├─ Jobs Completed
├─ Hours Worked
├─ Earnings This Month
├─ Skills/Certifications
├─ Personal Labor Rate
└─ Performance Metrics
```

---

## 🎨 Current UI Updates (Deployed)

### **Timeline Event Modal - Right Sidebar**

**New Sections Added**:

1. **Financial Data Toggle**
   ```
   [SHOW FINANCIAL DATA] button
   └─ Expands/collapses all financial sections
   ```

2. **Client Info Section**
   ```
   Client: John █████ [PRIVATE]
   └─ Auto-masked based on privacy settings
   ```

3. **TCI Breakdown Card**
   ```
   TCI (Total Cost Involved)
   ├─ Labor: $187.50
   ├─ Parts: $45.00
   ├─ Supplies: $5.00
   ├─ Overhead: $12.00
   ├─ Tools: $8.50
   ├─ Shop Fees: $10.00
   └─ TOTAL: $268.00
   
   Customer: $350.00
   Profit: $82.00 (23.4%)
   ```

4. **Parts with Supplier Ratings**
   ```
   Parts & Suppliers
   ├─ Mobil 1 5W-30 (#M1-5W30)
   │  $28.50 → $45.00 (57.9%)
   │  AutoZone ★★★★☆ 96.8%
   └─ Fram Filter (#XG7317)
      $7.20 → $12.00 (66.7%)
      O'Reilly ★★★★★ 98.2%
   ```

5. **Social Value Card**
   ```
   Social Value
   2,430 views • 10.04% engagement
   ├─ Partnerships: $85.00
   ├─ Sponsorships: $0.00
   ├─ Viewer Tips: $42.50
   └─ Total Social: $127.50
   ```

6. **Combined Profit Highlight**
   ```
   💰 COMBINED PROFIT: $209.50
   59.9% margin
   (Work profit + Social value)
   ```

7. **Turnaround Metrics**
   ```
   Turnaround: 52.5hrs total
   ├─ Order→Delivery: 29.3hrs
   ├─ Delivery→Install: 20.1hrs
   └─ Work Duration: 2.5hrs
   ```

8. **Generate Invoice Button**
   ```
   [GENERATE INVOICE] ← One-click
   └─ Creates invoice in generated_invoices table
   └─ Ready to send to client
   ```

---

## 📊 Data Flow: UI → Backend

```
USER CLICKS EVENT IN TIMELINE
         │
         ▼
TimelineEventModal Opens
         │
         ├─→ Load event images (existing)
         ├─→ Load AI description (existing)
         └─→ Load financial data (NEW)
              │
              ├─→ complete_event_summary view
              │   ├─ Client (privacy-masked)
              │   ├─ TCI breakdown
              │   ├─ Social value
              │   ├─ Turnaround metrics
              │   └─ Counts
              │
              ├─→ event_parts_used
              │   └─ JOIN supplier_ratings
              │       └─ Shows supplier performance
              │
              ├─→ event_tools_used
              │   └─ Tool depreciation costs
              │
              └─→ event_knowledge_applied
                  └─ Referenced procedures/specs
         │
         ▼
USER SEES:
├─ Complete cost breakdown
├─ Profit margin
├─ Supplier performance
├─ Social revenue
├─ Combined profitability
└─ Invoice generation option

USER CLICKS [GENERATE INVOICE]
         │
         ▼
Frontend calls:
  EventFinancialService.generateInvoice(eventId)
         │
         ▼
Backend executes:
  generate_invoice_from_event(eventId)
         │
         ├─→ Calculates TCI
         ├─→ Applies rates (contract > user > shop)
         ├─→ Calculates shop fees
         ├─→ Generates invoice number
         ├─→ Creates generated_invoices record
         └─→ Returns invoice_id
         │
         ▼
USER GETS:
├─ Invoice generated
├─ Invoice number (INV-20251121-0001)
└─ Ready to send/export

NEXT: (Future UI)
├─ Preview invoice (HTML)
├─ Send email
├─ Generate PDF
└─ Export to QuickBooks/Xero
```

---

## 🔧 Future UI Enhancements

### **Priority 1: Invoice Management Page**
```
/invoices
├─ List all invoices
├─ Filter by status (draft, sent, paid)
├─ Preview invoice HTML
├─ Send email to client
├─ Export to accounting software
└─ Record payment
```

### **Priority 2: Financial Dashboard**
```
/shop/financials
├─ Monthly P&L
├─ TCI trends
├─ Supplier performance chart
├─ Social value tracking
├─ Outstanding invoices
└─ Export options
```

### **Priority 3: Contract Management**
```
/contracts
├─ Active contracts
├─ Create new contract
├─ Set custom rates
├─ Waive fees
└─ Link to clients/vehicles
```

### **Priority 4: Supplier Dashboard**
```
/suppliers
├─ Supplier list with ratings
├─ Delivery history
├─ Quality incidents
├─ Price comparison
└─ Turnaround analytics
```

### **Priority 5: Knowledge Base**
```
/knowledge
├─ Search procedures
├─ Browse by category
├─ Torque specs lookup
├─ Common issues database
└─ Usage statistics
```

---

## 🎨 UI Component Hierarchy

```
Current Implementation:
═════════════════════

VehicleProfile.tsx
└─→ VehicleTimeline.tsx
    └─→ TimelineEventModal.tsx ✅ UPDATED
        ├─→ EventFinancialService.ts (NEW)
        │   ├─ getEventFinancialSummary()
        │   ├─ getEventParts()
        │   ├─ getEventTools()
        │   ├─ getEventKnowledge()
        │   ├─ calculateTCI()
        │   ├─ calculateTurnaround()
        │   └─ generateInvoice()
        │
        └─→ Financial Data Display:
            ├─ Client info (privacy-aware)
            ├─ TCI breakdown
            ├─ Parts with supplier ratings
            ├─ Social value
            ├─ Combined profit
            ├─ Turnaround metrics
            └─ Generate invoice button

Future Components:
══════════════════

├─ InvoiceList.tsx (list/manage invoices)
├─ InvoicePreview.tsx (review before sending)
├─ FinancialDashboard.tsx (business overview)
├─ ContractManager.tsx (create/edit contracts)
├─ SupplierDashboard.tsx (supplier analytics)
├─ KnowledgeBase.tsx (search procedures/specs)
└─ AccountingExport.tsx (sync to QB/Xero)
```

---

## 🚀 What Users Can Do NOW

### **In Timeline Pop-up**:

1. **View Event Financials**
   - Click "SHOW FINANCIAL DATA"
   - See complete TCI breakdown
   - See profit margin
   - See social value

2. **Check Supplier Performance**
   - Auto-displayed with parts
   - See star rating
   - See on-time percentage

3. **See Combined Profitability**
   - Work profit + Social value
   - True margin calculation

4. **Generate Invoice**
   - One-click invoice creation
   - Auto-numbered
   - Auto-calculated
   - Ready to send

### **Behind the Scenes (Auto-Running)**:

- ✅ Privacy masking (client names)
- ✅ TCI calculation
- ✅ Rate resolution (contract > user > shop)
- ✅ Fee calculation
- ✅ Supplier rating updates
- ✅ Turnaround tracking
- ✅ Social value aggregation

---

## 📊 User Workflow Example

```
SHOP OWNER WORKFLOW:
════════════════════

1. Complete oil change on vehicle
   └─ Timeline event auto-created (from image upload)

2. Click event in timeline
   └─ Modal opens with photos

3. Click "SHOW FINANCIAL DATA"
   └─ Sees:
      • TCI: $268.00
      • Customer Price: $350.00
      • Profit: $82.00 (23.4%)
      • Parts from AutoZone (rated ★★★★☆)
      • Turnaround: 52.5hrs

4. Verify numbers look good
   └─ All auto-calculated from actual data

5. Click "GENERATE INVOICE"
   └─ Invoice #INV-20251121-0001 created
   └─ HTML receipt ready
   └─ Alert shows invoice ID

6. (Future) Send invoice
   └─ Email to client
   └─ PDF attachment
   └─ Payment link

7. (Future) Export to accounting
   └─ Click "Export to QuickBooks"
   └─ Journal entries auto-created
   └─ Appears in QB automatically

8. Customer pays
   └─ Record payment
   └─ Status: unpaid → paid
   └─ Accounting entries updated
```

---

## 🎯 Integration Points for Future UI

### **What's Ready in Backend**:

| Feature | Backend Status | Frontend Needed |
|---------|---------------|-----------------|
| Client Management | ✅ Complete | Create/Edit clients page |
| TCI Calculation | ✅ Auto-runs | ✅ Displayed in modal |
| Invoice Generation | ✅ Working | Preview/Send UI |
| Supplier Ratings | ✅ Auto-updates | ✅ Displayed with parts |
| Turnaround Tracking | ✅ Calculated | ✅ Displayed in modal |
| Social Value | ✅ Aggregating | ✅ Displayed in modal |
| Contract Management | ✅ Complete | Create/Edit contracts page |
| Rate Settings | ✅ Complete | Shop/User settings page |
| Knowledge Base | ✅ Complete | Search/Browse interface |
| Accounting Export | ✅ Complete | Export settings page |
| Journal Entries | ✅ Auto-created | View/Edit journal page |
| Financial Reports | ✅ Functions ready | Dashboard with charts |

---

## 💡 Key Access Pattern

```
PRIMARY: Timeline Event Modal
└─ 80% of backend features accessible here
   └─ Most common user workflow
   
SECONDARY: Dedicated Management Pages
└─ 20% of features (contracts, settings, exports)
   └─ Less frequent admin tasks
```

**Philosophy**: 
- Put financial data where users already are (timeline)
- Don't make them navigate to separate pages
- One-click access to invoice generation
- Progressive disclosure (hide until needed)

---

## ✅ Status

**Timeline Modal**: ✅ Updated and deployed  
**Financial Service**: ✅ Created and integrated  
**Backend Functions**: ✅ All working  
**Sample Data**: ✅ Tested  

**Users can now**:
- View complete financial breakdown in timeline pop-up
- See supplier performance ratings
- Generate invoices with one click
- Track true profitability (work + social)

**Next**: Build dedicated pages for invoice management, contracts, and accounting exports.

---

Generated: November 22, 2025

