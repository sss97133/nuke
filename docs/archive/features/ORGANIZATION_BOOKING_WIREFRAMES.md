# Organization Booking System - Wireframes

## Design Philosophy

**Goal**: Make booking services as easy as booking an Uber or ordering on DoorDash.

**Key Principles**:
1. **Transparency** - Show all costs upfront
2. **Speed** - Quote in < 30 seconds
3. **Trust** - Show matched labor profiles and ratings
4. **Flexibility** - Customer chooses timeline vs price tradeoffs

---

## 1. Organization Profile - Service Discovery

```
┌──────────────────────────────────────────────────────────────┐
│  ← Back to Organizations        [★ Follow]  [📞 Contact]     │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  🏢 VIVA! LAS VEGAS AUTOS                                    │
│  Dealer • Las Vegas, NV • 4.8★ (287 reviews)                │
│                                                               │
│  [Banner Image: Shop exterior with classic cars]             │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  🚀 QUICK ACTIONS                                        │ │
│  │                                                          │ │
│  │  [ 📋 Request Service ]  [ 💰 Get Quote ]              │ │
│  │  [ 📞 Call (702) 555-0199 ]  [ 📧 Email ]              │ │
│  │  [ 🌐 Visit Website ]                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ▼ SERVICES OFFERED                                          │
│                                                               │
│  ┌────────────────────┐  ┌────────────────────┐             │
│  │ 🚗 CONSIGNMENT     │  │ ✨ DETAILING       │             │
│  │                    │  │                    │             │
│  │ We sell your car   │  │ Professional       │             │
│  │ Commission: 8-12%  │  │ Starting at $250   │             │
│  │                    │  │                    │             │
│  │ [Book Service]     │  │ [Get Quote]        │             │
│  └────────────────────┘  └────────────────────┘             │
│                                                               │
│  ┌────────────────────┐  ┌────────────────────┐             │
│  │ 🔧 RESTORATION     │  │ 📦 STORAGE         │             │
│  │                    │  │                    │             │
│  │ Light restoration  │  │ Indoor: $200/mo    │             │
│  │ Custom quotes      │  │ Outdoor: $100/mo   │             │
│  │                    │  │                    │             │
│  │ [Request Quote]    │  │ [Check Availability]│             │
│  └────────────────────┘  └────────────────────┘             │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ▼ CAPABILITIES & RESOURCES                                  │
│                                                               │
│  🏗️ EQUIPMENT                                                │
│  ✓ 4 Vehicle Lifts                                          │
│  ✓ Paint Booth (downdraft)                                  │
│  ✓ 2,000 sq ft Indoor Storage                               │
│  ✓ High-pressure air system                                 │
│  ✓ 3-phase electricity                                      │
│  ✓ MIG/TIG Welders                                          │
│                                                               │
│  📊 CAPACITY STATUS                                          │
│  Lifts: ████░░░░░░ 40% utilized                             │
│  Storage: ███████░░░ 70% occupied                            │
│  Paint Booth: ██░░░░░░░░ 20% booked                         │
│                                                               │
│  💡 High availability - can start work this week             │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ▼ PRODUCTS FOR SALE                                         │
│                                                               │
│  [Vehicle cards with Inquire buttons...]                     │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Service Booking Flow - Initial Request

```
┌──────────────────────────────────────────────────────────────┐
│  Book Service at Viva! Las Vegas Autos               [✕]     │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Step 1 of 4: Service Details                                │
│  ●───○───○───○                                               │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ What service do you need?                               │ │
│  │                                                          │ │
│  │ ▼ Select Service                                        │ │
│  │   ├─ Consignment Management                             │ │
│  │   ├─ Professional Detailing                             │ │
│  │   ├─ Paint Correction                                   │ │
│  │   ├─ Light Restoration                                  │ │
│  │   ├─ Mechanical Repair                                  │ │
│  │   └─ Other (describe)                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Select your vehicle (optional)                          │ │
│  │                                                          │ │
│  │ ○ 1987 Buick Grand National                            │ │
│  │ ○ 1970 Chevrolet Chevelle                              │ │
│  │ ○ Other vehicle / I'll describe                        │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Describe what you need                                  │ │
│  │                                                          │ │
│  │ [Text area:                                             │ │
│  │  "Full exterior paint - car was repainted in the 90s   │ │
│  │   and is showing some fade. Want to return to          │ │
│  │   original black with clear coat..."                   │ │
│  │                                              ]           │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  [Cancel]                              [Continue →]          │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Service Booking Flow - Timeline & Budget

```
┌──────────────────────────────────────────────────────────────┐
│  Book Service at Viva! Las Vegas Autos               [✕]     │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Step 2 of 4: Timeline & Budget                              │
│  ●───●───○───○                                               │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ When do you need this done?                             │ │
│  │                                                          │ │
│  │ ○ ASAP (within 1 week)                                 │ │
│  │   Higher urgency may cost more                          │ │
│  │                                                          │ │
│  │ ● Flexible (2-4 weeks)     ⭐ Recommended              │ │
│  │   Best rates, optimal labor matching                    │ │
│  │                                                          │ │
│  │ ○ Specific date range                                   │ │
│  │   [Start: ___] [End: ___]                              │ │
│  │                                                          │ │
│  │ ○ I'll discuss with facility                           │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Budget expectations (optional)                          │ │
│  │                                                          │ │
│  │ [Slider: $500 ─────●───────────── $5,000]              │ │
│  │                                                          │ │
│  │ 💡 Based on similar paint jobs:                         │ │
│  │    Average: $1,800 - $2,400                             │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Photos (optional but recommended)                       │ │
│  │                                                          │ │
│  │ [+] Upload photos of your vehicle                       │ │
│  │                                                          │ │
│  │ Better quotes with visual reference                     │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  [← Back]                              [Get Quote →]         │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Quote Generation - Coordination Engine Working

```
┌──────────────────────────────────────────────────────────────┐
│  Generating Your Quote...                            [✕]     │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Step 3 of 4: Quote Calculation                              │
│  ●───●───●───○                                               │
│                                                               │
│         [Animated spinner/progress indicator]                 │
│                                                               │
│  🤖 Our coordination engine is working:                      │
│                                                               │
│  ✓ Analyzing service requirements                            │
│  ✓ Checking facility capacity                                │
│  ✓ Matching skilled labor in Las Vegas area                  │
│  ✓ Calculating optimal timeline                              │
│  ⏳ Generating detailed quote...                             │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 💡 Did you know?                                        │ │
│  │                                                          │ │
│  │ The Nuke system coordinates between facilities and    │ │
│  │ independent skilled labor to get you the best quality   │ │
│  │ work at fair prices. Everyone gets paid for their      │ │
│  │ specialization!                                         │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  This usually takes 10-30 seconds...                         │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 5. Quote Results - Transparent Breakdown

```
┌──────────────────────────────────────────────────────────────┐
│  Your Custom Quote                                   [✕]     │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Step 3 of 4: Review Quote                                   │
│  ●───●───●───○                                               │
│                                                               │
│  ✓ Quote ready! We found the perfect match.                 │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  TOTAL PROJECT COST                                     │ │
│  │                                                          │ │
│  │         $2,000                                           │ │
│  │                                                          │ │
│  │  Estimated completion: 10 days                          │ │
│  │  Start date: Dec 1, 2025                                │ │
│  │  Completion: Dec 11, 2025                               │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ▼ COST BREAKDOWN                                            │
│                                                               │
│  Facility Fee (Viva! Las Vegas Autos)      $400             │
│  ├─ Paint booth access (60 hours)          $200             │
│  ├─ Indoor storage (10 days)               $100             │
│  ├─ Equipment & supplies                   $100             │
│  └─ 20% of total                                            │
│                                                               │
│  Labor Fee                                  $1,400           │
│  ├─ Master painter (40 hours)              $1,400           │
│  └─ 70% of total                                            │
│                                                               │
│  Platform Fee (Nuke)                     $200             │
│  ├─ Coordination & matching                                 │
│  ├─ Contract generation                                     │
│  ├─ Payment processing                                      │
│  └─ 10% of total                                            │
│                                                               │
│  ───────────────────────────────────────────────────        │
│  TOTAL                                      $2,000           │
│                                                               │
│  [View detailed breakdown]                                   │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ▼ YOUR MATCHED LABOR                                        │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ [Photo]  John Martinez                                  │ │
│  │          ⭐⭐⭐⭐⭐ 4.9 (73 jobs)                        │ │
│  │                                                          │ │
│  │          Master Painter                                 │
│  │          15 years experience                            │
│  │          Specializes in classic car restoration         │
│  │                                                          │ │
│  │          "John restored the paint on my '69 Camaro     │ │
│  │           and it looks showroom quality!" - Mike R.    │ │
│  │                                                          │ │
│  │          [View Full Profile]                            │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  📍 Location: 12 miles from Viva! Las Vegas Autos           │
│  ✓ Available starting Dec 1                                 │
│  ✓ Has completed 8 similar jobs this year                   │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ▼ TIMELINE & MILESTONES                                     │
│                                                               │
│  Dec 1-2:   Surface prep & masking        ⚪────────────    │
│  Dec 3-5:   Prime & sand                  ⚪────────────    │
│  Dec 6-8:   Base coat application         ⚪────────────    │
│  Dec 9-10:  Clear coat & cure             ⚪────────────    │
│  Dec 11:    Final inspection & delivery   ⚪────────────    │
│                                                               │
│  [View detailed schedule]                                    │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ⚡ Quote valid for 7 days                                  │
│                                                               │
│  [← Modify Request]            [Accept Quote & Continue →]  │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. Contract Generation

```
┌──────────────────────────────────────────────────────────────┐
│  Review Contract                                     [✕]     │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Step 4 of 4: Contract & Payment                             │
│  ●───●───●───●                                               │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  WORK CONTRACT                                          │ │
│  │  Contract #WC-2025-12345                                │ │
│  │                                                          │ │
│  │  Between:                                               │ │
│  │  • You (Customer)                                       │ │
│  │  • Viva! Las Vegas Autos (Facility)                    │ │
│  │  • John Martinez (Labor)                               │ │
│  │                                                          │ │
│  │  Scope of Work:                                         │ │
│  │  Complete exterior paint restoration of 1987 Buick     │ │
│  │  Grand National including surface preparation,         │ │
│  │  priming, base coat, and clear coat application.       │ │
│  │                                                          │ │
│  │  [Scroll to view full contract...]                     │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ▼ PAYMENT TERMS                                             │
│                                                               │
│  Deposit (50%): $1,000 - Due upon signing                   │
│  ├─ Secures schedule                                        │
│  ├─ Covers materials & supplies                             │
│  └─ Fully refundable if work cancelled before start        │
│                                                               │
│  Final Payment (50%): $1,000 - Due upon completion          │
│  ├─ Inspect work before paying                              │
│  ├─ Funds held in escrow                                    │
│  └─ Released when you approve                               │
│                                                               │
│  How payments are distributed:                               │
│  • Facility receives: $400 (20%)                            │
│  • Labor receives: $1,400 (70%)                             │
│  • Platform fee: $200 (10%)                                 │
│                                                               │
│  🔒 All payments protected by Nuke escrow                 │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ▼ GUARANTEES & PROTECTION                                   │
│                                                               │
│  ✓ Quality guarantee - work must meet agreed standards      │
│  ✓ Timeline protection - updates if delays occur            │
│  ✓ Dispute resolution - neutral arbitration available       │
│  ✓ Insurance coverage - facility is insured                 │
│  ✓ Money-back protection - refund if work not started       │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ☐ I have read and agree to the terms and conditions        │
│  ☐ I authorize payment of $1,000 deposit                    │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  💳 Payment Method                                      │ │
│  │                                                          │ │
│  │  ○ Credit Card (Visa •••• 4242)                        │ │
│  │  ○ Bank Account                                         │ │
│  │  ○ Add new payment method                              │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  [← Back]                        [Sign Contract & Pay →]    │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 7. Confirmation & Tracking

```
┌──────────────────────────────────────────────────────────────┐
│  ✓ Booking Confirmed!                                [✕]     │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  🎉 Your paint job is scheduled!                            │
│                                                               │
│  Booking #SB-2025-54321                                      │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  WHAT HAPPENS NEXT                                      │ │
│  │                                                          │ │
│  │  ✓ Contract signed by you                               │ │
│  │  ⏳ Awaiting facility signature                         │ │
│  │  ⏳ Awaiting labor signature                            │ │
│  │                                                          │ │
│  │  You'll receive email updates at each step.             │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  CONTACT INFORMATION                                    │ │
│  │                                                          │ │
│  │  Facility: Viva! Las Vegas Autos                       │ │
│  │  📞 (702) 555-0199                                      │ │
│  │  📧 info@vivalasvegas.com                              │ │
│  │                                                          │ │
│  │  Painter: John Martinez                                │ │
│  │  💬 Message on platform                                │ │
│  │  (Contact details shared once work begins)              │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  UPCOMING SCHEDULE                                      │ │
│  │                                                          │ │
│  │  Nov 28:  Drop off vehicle at Viva (optional)          │ │
│  │  Dec 1:   Work begins                                   │ │
│  │  Dec 11:  Expected completion                           │ │
│  │                                                          │ │
│  │  📅 Add to calendar                                     │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  [View Full Booking]  [Message Facility]  [Close]           │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 8. Dashboard - Active Bookings (Customer View)

```
┌──────────────────────────────────────────────────────────────┐
│  My Bookings                                   [+ New Booking]│
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Active (1)  |  Completed (3)  |  Quotes (2)                │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  IN PROGRESS                                            │ │
│  │                                                          │ │
│  │  Paint Restoration - 1987 Buick Grand National          │ │
│  │  Viva! Las Vegas Autos + John Martinez                 │ │
│  │                                                          │ │
│  │  Timeline:  Day 3 of 10                                 │ │
│  │  ████████░░░░░░░░░░░░ 30% complete                      │ │
│  │                                                          │ │
│  │  Current Phase: Prime & Sand                            │ │
│  │  Next Update: Dec 5                                     │ │
│  │                                                          │ │
│  │  Latest Update (Dec 3, 2pm):                            │ │
│  │  "Surface prep complete. Starting primer application.   │ │
│  │   Everything on schedule." - John Martinez              │ │
│  │                                                          │ │
│  │  [View Details]  [Message]  [Upload Progress Photos]   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 9. Dashboard - Facility View (Viva's Dashboard)

```
┌──────────────────────────────────────────────────────────────┐
│  Facility Dashboard - Viva! Las Vegas Autos                  │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  New Quotes (3)  |  Scheduled (2)  |  In Progress (5)       │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  📊 CAPACITY OVERVIEW                                   │ │
│  │                                                          │ │
│  │  Lifts:        ████░░░░░░ 40%   [2 of 4 in use]        │ │
│  │  Paint Booth:  ██░░░░░░░░ 20%   [Scheduled: 12 hrs]    │ │
│  │  Storage:      ███████░░░ 70%   [14 of 20 spots]       │ │
│  │                                                          │ │
│  │  💡 You can accept 3 more jobs this week                │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  NEW QUOTE REQUEST                                      │ │
│  │                                                          │ │
│  │  Paint Restoration - 1987 Buick Grand National          │ │
│  │  Customer: Mike Johnson                                 │ │
│  │                                                          │ │
│  │  System Quote: $2,000                                   │ │
│  │  ├─ Your facility fee: $400                            │ │
│  │  └─ Matched labor: John Martinez                       │ │
│  │                                                          │ │
│  │  Required Resources:                                    │ │
│  │  • Paint booth: 60 hours                                │ │
│  │  • Storage: 10 days                                     │ │
│  │                                                          │ │
│  │  Requested Timeline: Dec 1-11                           │ │
│  │  ✓ You have capacity available                          │ │
│  │                                                          │ │
│  │  [View Details]  [Accept Quote]  [Modify & Counter]    │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  💰 EARNINGS THIS MONTH                                 │ │
│  │                                                          │ │
│  │  Facility Fees: $3,200                                  │ │
│  │  Pending: $800                                          │ │
│  │  Jobs Completed: 8                                      │ │
│  │                                                          │ │
│  │  [View Financial Dashboard]                             │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 10. Dashboard - Labor View (John's Dashboard)

```
┌──────────────────────────────────────────────────────────────┐
│  Labor Dashboard - John Martinez                             │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Available Jobs (12)  |  My Jobs (3)  |  Completed (73)     │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  ⚡ NEW MATCH FOR YOU                                   │ │
│  │                                                          │ │
│  │  Paint Restoration - 1987 Buick Grand National          │ │
│  │  @ Viva! Las Vegas Autos                                │ │
│  │                                                          │ │
│  │  Payment: $1,400 (40 hours × $35/hr)                   │ │
│  │  Timeline: Dec 1-11 (flexible)                          │ │
│  │  Location: 12 miles from you                            │ │
│  │                                                          │ │
│  │  Why you're a good match:                               │ │
│  │  ✓ Master painter specialization                        │ │
│  │  ✓ 8 similar jobs completed this year                   │ │
│  │  ✓ 4.9★ rating                                          │ │
│  │  ✓ Available during requested dates                     │ │
│  │                                                          │ │
│  │  Customer notes: "Want show-quality finish"             │ │
│  │                                                          │ │
│  │  [View Full Details]  [Accept Job]  [Pass]             │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  📅 YOUR SCHEDULE                                       │ │
│  │                                                          │ │
│  │  This Week:    ████████████░░░░░░░░ 32 hours booked    │ │
│  │  Next Week:    ██████░░░░░░░░░░░░░░ 16 hours booked    │ │
│  │                                                          │ │
│  │  Available capacity: 24 hours                           │ │
│  │                                                          │ │
│  │  [View Full Calendar]                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  💰 EARNINGS                                            │ │
│  │                                                          │ │
│  │  This Month: $4,200                                     │ │
│  │  Pending: $1,400                                        │ │
│  │  Hours Worked: 96                                       │ │
│  │  Avg Rate: $43.75/hr                                    │ │
│  │                                                          │ │
│  │  [Withdraw Funds]  [View History]                      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## Key UX Improvements

### 1. **Instant Gratification**
- Quote generated in < 30 seconds
- No waiting for callbacks
- Transparent pricing upfront

### 2. **Trust Building**
- See matched labor profiles
- Read reviews from similar jobs
- Understand cost breakdown

### 3. **Progress Visibility**
- Track work in real-time
- Photos from job site
- Milestone updates

### 4. **Multi-Party Coordination**
- Customer, facility, and labor all on same platform
- Automated notifications
- Single source of truth

### 5. **Fair Compensation**
- Everyone knows what everyone else earns
- Transparent fee structure
- Escrow protection

---

## Mobile Optimization

All screens responsive for mobile:
- Stack cards vertically
- Swipeable image galleries
- Tap-to-call/message
- Mobile-optimized forms
- GPS integration for location

---

## Next: System Architecture Document

Ready to build backend coordination algorithm and capacity calculation engine!

