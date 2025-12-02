# Invoice Payment System - ERD & Architecture

**Purpose**: Payment-first onboarding - invoices become the entry point for clients  
**Status**: Architecture Document  
**Date**: November 22, 2025

---

## 📊 Entity Relationship Diagram (ERD)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        INVOICE PAYMENT SYSTEM ERD                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│   TIMELINE_EVENTS    │
├──────────────────────┤
│ id (PK)              │
│ vehicle_id (FK)      │◄──┐
│ client_id (FK)       │   │
│ title                │   │
│ event_date           │   │
│ work_started         │   │
│ work_completed       │   │
│ is_monetized         │   │
└──────────────────────┘   │
         │                  │
         │ 1:N              │
         ▼                  │
┌──────────────────────┐   │
│ GENERATED_INVOICES   │   │
├──────────────────────┤   │
│ id (PK)              │   │
│ invoice_number       │   │
│ event_id (FK) ◄──────┼───┘
│ client_id (FK)       │◄──┐
│ business_id (FK)     │   │
│                      │   │
│ invoice_date         │   │
│ due_date             │   │
│ subtotal             │   │
│ tax_amount           │   │
│ total_amount         │   │
│ amount_paid          │   │
│ amount_due           │   │
│ payment_status       │   │
│ status               │   │
│ html_content         │   │
│                      │   │
│ ┌──────────────────┐ │   │
│ │ PAYMENT FIELDS   │ │   │
│ ├──────────────────┤ │   │
│ │ payment_token    │ │   │
│ │ payment_link     │ │   │
│ │ public_access    │ │   │
│ │                  │ │   │
│ │ preferred_method │ │   │
│ │ method_details   │ │   │
│ │                  │ │   │
│ │ confirmed_at     │ │   │
│ │ confirmed_by     │ │   │
│ │ payment_notes    │ │   │
│ └──────────────────┘ │   │
└──────────────────────┘   │
         │                  │
         │ 1:1              │
         ▼                  │
┌──────────────────────┐   │
│     CLIENTS          │   │
├──────────────────────┤   │
│ id (PK)              │   │
│ client_name          │◄──┘
│ company_name         │
│ contact_email        │
│ contact_phone        │
│ address              │
│ city                 │
│ state                │
│ zip                  │
│                      │
│ is_private           │
│ blur_level           │
│                      │
│ business_entity_id   │
│ created_by           │
└──────────────────────┘
         │
         │ 1:N
         ▼
┌──────────────────────┐
│ CLIENT_PREFERENCES   │ (Future)
├──────────────────────┤
│ client_id (FK)       │
│ preferred_method     │
│ venmo_username       │
│ zelle_email          │
│ paypal_email         │
│ stripe_customer_id   │
└──────────────────────┘

┌──────────────────────┐
│   BUSINESSES         │
├──────────────────────┤
│ id (PK)              │
│ business_name        │
│ address              │
│ city                 │
│ state                │
│ zip_code             │
│ phone                │
│ email                │
│                      │
│ payment_methods      │◄──┐ (JSONB array)
│ payment_details      │   │ (JSONB)
└──────────────────────┘   │
                           │
         ┌─────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│              PAYMENT METHODS INTEGRATION                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  VENMO   │  │  ZELLE   │  │  PAYPAL  │  │  STRIPE  │   │
│  ├──────────┤  ├──────────┤  ├──────────┤  ├──────────┤   │
│  │ username │  │ email    │  │ email    │  │ customer │   │
│  │ @handle  │  │ phone    │  │ business │   │ id       │   │
│  │ QR code  │  │          │  │ API key  │   │ API key  │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                              │
│  ┌──────────┐  ┌──────────┐                               │
│  │  CASH    │  │  CHECK   │                               │
│  ├──────────┤  ├──────────┤                               │
│  │ receipt  │  │ check #  │                               │
│  │ photo    │  │ bank     │                               │
│  │          │  │          │                               │
│  └──────────┘  └──────────┘                               │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│  EVENT_FINANCIAL     │
├──────────────────────┤
│ event_id (FK)        │
│ labor_cost           │
│ parts_cost           │
│ supplies_cost        │
│ overhead_cost        │
│ tool_depreciation    │
│ total_cost (TCI)     │
│ customer_price       │
│ profit_margin        │
└──────────────────────┘

┌──────────────────────┐
│      VEHICLES        │
├──────────────────────┤
│ id (PK)              │
│ year                 │
│ make                 │
│ model                │
│ series               │
│ vin                  │
│ license_plate        │
└──────────────────────┘


┌─────────────────────────────────────────────────────────────┐
│              PUBLIC INVOICE VIEW (View)                      │
├─────────────────────────────────────────────────────────────┤
│ Combines:                                                    │
│   • generated_invoices                                       │
│   • clients                                                  │
│   • timeline_events                                          │
│   • vehicles                                                 │
│   • businesses                                               │
│                                                              │
│ Accessible via: payment_token (public, no auth required)    │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔄 Data Flow: Invoice Generation → Payment

```
STEP 1: WORK COMPLETED
──────────────────────
Timeline Event
├─ Work performed
├─ Client linked
├─ Vehicle linked
└─ Financial data calculated

        ↓ generate_invoice_from_event()

STEP 2: INVOICE GENERATED
─────────────────────────
Generated Invoice Created
├─ Invoice number: INV-20251122-0001
├─ Amounts calculated
├─ HTML receipt generated
└─ Payment link auto-generated

        ↓ generate_invoice_payment_link()

STEP 3: PAYMENT LINK CREATED
────────────────────────────
Payment Token Generated
├─ Token: A1B2C3D4E5F6G7H8
├─ Link: https://n-zero.dev/pay/A1B2C3D4E5F6G7H8
├─ Public access enabled
└─ Sent to client (email/SMS/link share)

        ↓ Client clicks link (NO LOGIN REQUIRED)

STEP 4: PUBLIC INVOICE VIEW
────────────────────────────
Client Views Invoice
├─ Full invoice details
├─ Vehicle information
├─ Service performed
├─ Payment methods available
└─ Pay button (multiple options)

        ↓ Client selects payment method

STEP 5: PAYMENT PROCESSED
──────────────────────────
Client Pays
├─ Method: Venmo/Zelle/PayPal/Stripe/Cash
├─ Amount confirmed
├─ Client name entered (optional)
├─ Notes added (optional)
└─ Invoice marked as paid

        ↓ mark_invoice_paid()

STEP 6: INVOICE UPDATED
───────────────────────
Payment Recorded
├─ payment_status: unpaid → paid
├─ amount_paid: updated
├─ payment_method: stored
├─ payment_confirmed_at: timestamp
└─ Shop notified (optional)
```

---

## 🔐 Security & Access Model

```
PUBLIC ACCESS (No Auth Required)
─────────────────────────────────
✅ View invoice via payment_token
✅ See invoice details (HTML content)
✅ See payment methods
✅ Mark invoice as paid
❌ Edit invoice
❌ View other invoices
❌ Access client data beyond invoice

AUTHENTICATED ACCESS (Shop/User Login)
───────────────────────────────────────
✅ View all invoices (via /invoices page)
✅ Generate invoices
✅ Edit invoice details
✅ View client full details
✅ Generate payment links
✅ Access payment history
✅ Export financial data

ANONYMOUS USER FLOW
───────────────────
1. Receives payment link (email/SMS/share)
2. Clicks link: https://n-zero.dev/pay/TOKEN
3. Views invoice (no login)
4. Selects payment method
5. Marks as paid
6. Gets confirmation
7. Can optionally create account (future)
```

---

## 💳 Payment Methods Data Structure

```json
{
  "preferred_payment_method": "venmo",
  "payment_method_details": {
    "venmo": {
      "username": "@shopname",
      "qr_code_url": "https://venmo.com/qr/...",
      "business_name": "Shop Name LLC"
    },
    "zelle": {
      "email": "pay@shopname.com",
      "phone": "+1-702-555-1234",
      "bank_name": "Chase"
    },
    "paypal": {
      "email": "pay@shopname.com",
      "business_name": "Shop Name",
      "paypal_link": "https://paypal.me/shopname"
    },
    "stripe": {
      "customer_id": "cus_xxxxx",
      "checkout_session_id": "cs_xxxxx",
      "payment_intent_id": "pi_xxxxx"
    },
    "cash": {
      "instructions": "Pay at shop or upon delivery",
      "receipt_required": true
    },
    "check": {
      "payable_to": "Shop Name LLC",
      "memo_line": "Invoice #INV-20251122-0001"
    }
  }
}
```

---

## 📋 Key Functions

### **1. generate_invoice_payment_link(invoice_id)**
```sql
-- Creates unique token and payment link
-- Returns: "https://n-zero.dev/pay/A1B2C3D4E5F6G7H8"
```

### **2. get_invoice_by_token(token)**
```sql
-- Public function (SECURITY DEFINER)
-- Returns full invoice data (no auth required)
-- Used by payment page
```

### **3. mark_invoice_paid(token, method, details, name, notes)**
```sql
-- Public function (SECURITY DEFINER)
-- Allows anonymous payment confirmation
-- Records payment method and timestamp
```

### **4. generate_invoice_from_event(event_id)**
```sql
-- Existing function (enhanced)
-- Now auto-generates payment link
-- Sets public_access_enabled = TRUE
```

---

## 🎯 Onboarding Flow: Financial Motivation

```
SCENARIO 1: Client Receives Invoice
───────────────────────────────────
1. Shop completes work
2. Shop generates invoice
3. System creates payment link
4. Shop shares link via:
   ├─ Email (auto-sent)
   ├─ SMS/text message
   ├─ Print QR code
   └─ Direct link share
5. Client clicks link (no account needed)
6. Client views invoice
7. Client pays via preferred method
8. System records payment
9. Client sees confirmation
10. Option: "Create account to track all invoices" ← ONBOARDING HOOK

SCENARIO 2: Shop Sends Invoice for Quote
─────────────────────────────────────────
1. Shop creates invoice (draft status)
2. Client views via link
3. Client sees: "Pay now to confirm work"
4. Client pays deposit
5. Shop starts work
6. System tracks partial payment
7. Client receives updates via same link

SCENARIO 3: Recurring Client
─────────────────────────────
1. Client pays first invoice via link
2. Client sees: "Save payment method for faster checkout"
3. Client creates account (optional)
4. Future invoices auto-populate payment preferences
5. One-click payment for repeat clients
```

---

## 🔗 Integration Points

```
PAYMENT PLATFORMS
├─ Venmo: QR code + username link
├─ Zelle: Email/phone lookup
├─ PayPal: PayPal.Me link
├─ Stripe: Embedded checkout (future)
└─ Cash: Receipt photo upload

NOTIFICATION SYSTEMS
├─ Email: Invoice sent via SMTP
├─ SMS: Payment link via Twilio (future)
├─ Push: App notifications (future)
└─ Webhook: Payment confirmations

ACCOUNTING EXPORTS
├─ CSV: Payment records
├─ QuickBooks: Transactions
├─ Xero: Payments sync
└─ Custom: Webhook integration
```

---

## 📊 Database Indexes (Performance)

```sql
-- Fast token lookup (public access)
CREATE INDEX idx_invoices_payment_token 
ON generated_invoices(payment_token) 
WHERE payment_token IS NOT NULL;

-- Payment status filtering
CREATE INDEX idx_invoices_payment_status 
ON generated_invoices(payment_status);

-- Client invoice lookup
CREATE INDEX idx_invoices_client 
ON generated_invoices(client_id);

-- Event invoice lookup
CREATE INDEX idx_invoices_event 
ON generated_invoices(event_id);
```

---

## 🎨 User Experience Flow

```
SHOP USER (Invoice Generator)
─────────────────────────────
/invoices → Generate Invoice → Payment Link Created → Share Link

CLIENT (Invoice Recipient - No Account)
────────────────────────────────────────
Receives Link → Clicks → Views Invoice → Selects Payment → Pays → Confirmed

CLIENT (Future: With Account)
──────────────────────────────
Receives Link → Clicks → Views Invoice → Pays (saved method) → Confirmed
                                     ↓
                              Optional: Create Account
                                     ↓
                         Track all invoices in dashboard
```

---

## 🔒 Privacy & Security

```
PRIVACY CONTROLS
────────────────
• Payment links are token-based (not ID-based)
• Tokens are 32-character random strings
• Links expire after payment (optional)
• Client data respects privacy settings
• Payment confirmations don't expose sensitive data

SECURITY MEASURES
─────────────────
• SECURITY DEFINER functions for public access
• Rate limiting on payment confirmation (future)
• Token rotation on suspicious activity (future)
• HTTPS-only payment links
• Payment method details encrypted (future)
```

---

**Status**: Architecture Complete  
**Next Steps**: Implementation of payment page and integration with invoice generation

