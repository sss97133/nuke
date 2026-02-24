# Invoice Manager - Visual Walkthrough

**URL**: https://nuke.ag/invoices  
**Status**: ✅ Live in Production  

---

## 📸 Page Layout

```
╔══════════════════════════════════════════════════════════════════════════╗
║  [nuke] [Home] [Vehicles] [Organizations] [Financials] 👤 Profile    ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  INVOICE MANAGER                                                         ║
║                                                                          ║
║  [ALL] [DRAFT] [SENT] [UNPAID] [PAID]                        [EXPORT]  ║
║                                                                          ║
║  ┌────────────────────────────────────────────────────────────────────┐ ║
║  │ INV-20251121-0001                           $165.50    UNPAID      │ ║
║  ├────────────────────────────────────────────────────────────────────┤ ║
║  │ John Smith • Photo Added • 1973 GMC K5                            │ ║
║  │ Date: Nov 21, 2025 • Due: Nov 21, 2025                            │ ║
║  │                                                                    │ ║
║  │                      [PREVIEW] [SEND] [RECORD PAYMENT] ───────────┤ ║
║  └────────────────────────────────────────────────────────────────────┘ ║
║                                                                          ║
║  ┌────────────────────────────────────────────────────────────────────┐ ║
║  │ INV-20251120-0003                         $8,976.24      PARTIAL   │ ║
║  ├────────────────────────────────────────────────────────────────────┤ ║
║  │ Smith Automotive • Engine Rebuild • 1985 Chevrolet C10            │ ║
║  │ Date: Nov 20, 2025 • Due: Dec 20, 2025 (Net 30)                   │ ║
║  │                                                                    │ ║
║  │                                   [PREVIEW] [RECORD PAYMENT] ─────┤ ║
║  └────────────────────────────────────────────────────────────────────┘ ║
║                                                                          ║
║  ┌────────────────────────────────────────────────────────────────────┐ ║
║  │ INV-20251119-0008                           $450.00        PAID    │ ║
║  ├────────────────────────────────────────────────────────────────────┤ ║
║  │ Mike Jones • Oil Change • 1992 GMC K1500                          │ ║
║  │ Date: Nov 19, 2025 • Due: Nov 19, 2025                            │ ║
║  │                                                                    │ ║
║  │                                               [PREVIEW] ───────────┤ ║
║  └────────────────────────────────────────────────────────────────────┘ ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## 🔍 When You Click "PREVIEW"

```
╔══════════════════════════════════════════════════════════════════════════╗
║  Invoice Preview - INV-20251121-0001                         [CLOSE]    ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  ┌────────────────────────────────────────────────────────────────────┐ ║
║  │                                                                    │ ║
║  │  VIVA! LAS VEGAS AUTOS                                            │ ║
║  │  707 Yucca St                                                     │ ║
║  │  Boulder City, NV 89005                                           │ ║
║  │  Phone: 702-624-6793 | Email: shkylar@gmail.com                  │ ║
║  │  ════════════════════════════════════════════════════════════     │ ║
║  │                                                                    │ ║
║  │  INVOICE #INV-20251121-0001                                       │ ║
║  │                                                                    │ ║
║  │  ┌─────────────────────┐  ┌────────────────────────────────┐     │ ║
║  │  │ BILL TO:            │  │ Invoice Date: Nov 21, 2025     │     │ ║
║  │  │ John Smith          │  │ Due Date: Nov 21, 2025         │     │ ║
║  │  │ Smith Automotive    │  │ Work Date: Apr 30, 2025        │     │ ║
║  │  │                     │  │ Status: UNPAID                 │     │ ║
║  │  └─────────────────────┘  └────────────────────────────────┘     │ ║
║  │                                                                    │ ║
║  │  ┌──────────────────────────────────────────────────────────────┐│ ║
║  │  │ Description          Qty    Rate           Amount           ││ ║
║  │  ├──────────────────────────────────────────────────────────────┤│ ║
║  │  │ Labor - Photo Added  2.5hrs $48.00/hr     $120.00          ││ ║
║  │  │ Mobil 1 5W-30       1      $45.00         $45.00           ││ ║
║  │  │   (#M1-5W30)                                               ││ ║
║  │  │ Shop Supplies       1      $5.00          $5.00            ││ ║
║  │  └──────────────────────────────────────────────────────────────┘│ ║
║  │                                                                    │ ║
║  │                                          Subtotal:     $165.50     │ ║
║  │                                          Tax (0%):      $0.00      │ ║
║  │                                          ═══════════════════════   │ ║
║  │                                     TOTAL DUE:        $165.50      │ ║
║  │                                                                    │ ║
║  │  Payment due upon completion. Thank you for your business!        │ ║
║  │                                                                    │ ║
║  └────────────────────────────────────────────────────────────────────┘ ║
║                                                                          ║
║  ┌────────────────────────────────────────────────────────────────────┐ ║
║  │      [EMAIL TO CLIENT]    [DOWNLOAD PDF]    [EXPORT TO QB]        │ ║
║  └────────────────────────────────────────────────────────────────────┘ ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## 🎯 Key Features Demonstrated

### **Invoice List View**:
- Clean card layout per invoice
- Invoice number prominently displayed
- Client name, event title, vehicle shown
- Amount in large text
- Status color-coded:
  - 🟢 PAID (green)
  - 🟡 PARTIAL (yellow)  
  - 🔴 UNPAID (red)
  - ⚪ DRAFT (gray)

### **Filter Buttons**:
```
[ALL]    - Show everything
[DRAFT]  - Invoices not sent yet
[SENT]   - Sent but not paid
[UNPAID] - Sent and waiting for payment
[PAID]   - Completed transactions
```

### **Action Buttons**:
```
[PREVIEW]         - View HTML receipt
[SEND]            - Mark as sent to client
[RECORD PAYMENT]  - Log payment received
```

### **Preview Modal**:
- Full HTML receipt display
- Professional formatting
- Itemized line items
- Business letterhead
- Client billing address
- Payment terms
- Future action buttons:
  - EMAIL TO CLIENT
  - DOWNLOAD PDF
  - EXPORT TO QB

---

## 💡 Real-World Example

### **Invoice #INV-20251121-0001**

**Generated From**: Timeline event (Photo Added - Oil Change)  
**Client**: John Smith (Privacy: MEDIUM → "John █████")  
**Date**: November 21, 2025  
**Due**: November 21, 2025 (Due on completion)  

**Line Items**:
```
Labor - Photo Added       2.5hrs @ $48/hr    $120.00
Mobil 1 5W-30 (#M1-5W30)  1 @ $45.00         $45.00
Shop Supplies             1 @ $5.00           $5.00
                                        ─────────────
                          Subtotal:           $165.50
                          Tax (0%):             $0.00
                          ═════════════════════════
                          TOTAL DUE:          $165.50
```

**Payment Status**: UNPAID  
**Invoice Status**: DRAFT  

**Available Actions**:
- ✅ Preview (see full HTML receipt)
- ✅ Send (mark as sent to client)
- ✅ Record Payment (log payment received)
- 🔜 Email to Client (integration pending)
- 🔜 Download PDF (generation pending)
- 🔜 Export to QuickBooks (OAuth pending)

---

This is **one of three** new financial pages you can access right now:

1. `/invoices` ← **This one** (Invoice Manager)
2. `/financials` (P&L Dashboard)
3. `/suppliers` (Supplier Performance)

Want to see the Supplier Dashboard or Financial Dashboard instead?
