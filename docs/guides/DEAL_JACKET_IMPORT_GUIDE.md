# Deal Jacket Import System - Complete Guide

## Overview

This system allows you to dump decades of deal jackets into Dropbox, have AI parse them automatically, review/correct the data in a bulk editor, and import everything into vehicle profiles, financial tracking, and timeline attribution.

## For Managers (Doug) - How to Import Deal Jackets

### Step 1: Upload to Dropbox

1. Take photos or scan your deal jackets (the documents that track vehicle purchases, reconditioning, and sales)
2. Upload ALL of them to your connected Dropbox folder at: `/Viva Inventory/Deal Jackets/`
3. Organize by year if you want (optional): `/Viva Inventory/Deal Jackets/2024/`, `/2023/`, etc.

The system will automatically:
- Detect new images
- Run AI parsing (OpenAI Vision)
- Extract ALL data (vehicles, costs, dates, contractors, investors)
- Queue them for your review

### Step 2: Review Parsed Data (Bulk Editor)

Go to: https://n-zero.dev/org/[YOUR_ORG_ID]/bulk-editor

You'll see a list of all parsed deal jackets with:
- **Confidence Score** (0-100%): How confident the AI is
- **Status**: `needs_review` (low confidence) or `parsed` (high confidence)
- **Preview**: Year/Make/Model extracted

For each deal jacket:
1. Click to select it
2. Review the image on the left
3. Review/edit extracted data on the right:
   - Vehicle details (VIN, Year, Make, Model, Color, Odometer)
   - Financial data (Purchase Cost, Sale Price, Reconditioning Costs)
   - People (Acquired From, Sold To)
   - Contractors (Who did what work, how much they were paid)
   - Investors (Laura's investments, returns)
   - Organizations (A Car's Life LLC fees, Viva Las Vegas Autos)

4. Click "Approve & Save" when data looks correct
5. Click "Reject" if the document is illegible or not a deal jacket

### Step 3: Import All

Once you've reviewed and approved a batch:
1. Click "Import All Approved"
2. The system will:
   - Create or update vehicle profiles
   - Link vehicles to Viva Las Vegas Autos
   - Create contractor contribution records
   - Create investor transaction records
   - Generate timeline events
   - Calculate financial flows

## What the AI Extracts

From each deal jacket, the system extracts:

### Vehicle Data
- VIN#
- Year, Make, Model, Series
- Color
- Odometer
- Stock Number

### Financial Data
- **Purchase Cost** (RM Purchase Cost, ISA Purchase Cost)
- **Reconditioning Breakdown**:
  - Parts (O-Parts, L-Parts with line item details)
  - Labor (broken down by person: "Doug labor", "Skylar repairs labor", "Mike" engine work)
  - Sublet work (paint, upholstery, detail)
  - Specific services (e.g., "Ernie's Upholstery", "Lesa's Auto Paint", "Taylor Paint")
- **Sale Price**
- **Fees** (Document Fee, Dealer Handling Fee, Title, Permit)
- **Gross Profit**
- **Total Cost**

### Attribution Data
- **Investors**: "Laura Wynne $19000 Inv+359.30" → Creates investor_transaction record
- **Organizations**: "A Car's Life LLC 5%" → Tracks organizational fees
- **Contractors**: "Ernie's Upholstery ($1,500)" → Creates contractor_work_contribution
- **Founders**: "Doug labor ($1,000)" → Attributes work to Doug's profile

### People
- **Acquired From**: Name, Address, City, State, Zip
- **Sold To**: Name, Address, City, State, Zip, Email, Phone

### Dates
- **Acquisition Date**
- **Sold Date**

## For Investors (Laura) - Financial Dashboard

Go to: https://n-zero.dev/investor/dashboard

You'll see:
- **Total Invested**: Sum of all investments across all vehicles/organizations
- **Total Returned**: Sum of all returns/distributions
- **Net ROI**: (Total Returned - Total Invested) / Total Invested
- **Active Investments**: Vehicles that haven't been sold yet
- **Investment History**: Timeline of all investments and returns
- **Per-Vehicle Breakdown**: Which vehicles you funded, how much, and the return

Each investment entry shows:
- Date
- Vehicle (Year Make Model)
- Amount invested
- Return amount (if sold)
- ROI percentage
- Proof document (link to deal jacket image)

## Data Flow: Deal Jacket → Profiles

```
Deal Jacket Image
  ↓
AI Parse (OpenAI Vision API)
  ↓
Bulk Editor (Manager Review/Correction)
  ↓
Import Process:
  ├→ Vehicle Profile (VIN, specs, images)
  ├→ Financial Transactions (purchase, sale, costs)
  ├→ Contractor Contributions (Ernie, Mike, Skylar work)
  ├→ Investor Transactions (Laura's investments/returns)
  ├→ Organization Links (A Car's Life, Viva)
  ├→ Timeline Events (acquisition, reconditioning, sale)
  └→ Attribution (who did what, when)
```

## Organization Hierarchy

The system now tracks:

**Vintage Muscle LLC** (Laura's company, property owner)
  ↓ (parent company)
**A Car's Life LLC** (Doug's company, DBA Viva)
  ↓ (DBA)
**Viva! Las Vegas Autos** (Dealer, holds license)

Each deal jacket entry for "A Car's Life LLC 5%" or similar gets properly attributed up the hierarchy.

## Example: Full Import Flow

### Deal Jacket Shows:
```
1972 Chevrolet K10
VIN: CKE142Z161636
Acquired From: Richard Stephenson (Jan 15, 2024)
RM Purchase Cost: $20,000
Reconditioning:
  - Ernie's Upholstery: $500
  - Doug labor: $1,000
  - Skylar repairs: $2,000
  - Parts: $1,438.78
Total Cost: $21,938.78
Sold To: Brian Hill (Aug 8, 2024)
Sale Price: $22,600
Gross Profit: $661.22
Laura Inv: $21,116.69 + return $116.69
```

### System Creates:
1. **Vehicle Profile** for 1972 Chevrolet K10 (VIN: CKE142Z161636)
2. **Timeline Events**:
   - Jan 15, 2024: Acquired from Richard Stephenson for $20,000
   - Jan-Aug 2024: Reconditioning work (multiple events for Ernie, Doug, Skylar)
   - Aug 8, 2024: Sold to Brian Hill for $22,600
3. **Contractor Contributions**:
   - Ernie: Upholstery work, $500, attributed to Ernie's Upholstery profile
   - Doug: Labor, $1,000, attributed to Doug's profile
   - Skylar: Repairs, $2,000, attributed to Skylar's profile
4. **Investor Transaction** for Laura:
   - Investment: $21,116.69 (Jan 15, 2024)
   - Return: $116.69 (Aug 8, 2024)
   - ROI: 0.55%
5. **Financial Summary** for Viva Las Vegas Autos:
   - Purchase: -$20,000
   - Reconditioning: -$4,938.78
   - Sale: +$22,600
   - Profit: +$661.22

## Troubleshooting

### Low Confidence Scores
If the AI gives low confidence (<70%):
- The image might be blurry → Re-scan at higher resolution
- Handwriting might be unclear → Type in the corrections manually
- Document might be damaged → Mark as "needs_review" and manually enter key data

### Duplicate Vehicles
If the system detects a vehicle that might already exist (by VIN):
- The bulk editor will flag it as "POTENTIAL DUPLICATE"
- You can choose to:
  - **Merge**: Combine data from both entries
  - **Update**: Replace old data with new data
  - **Skip**: Don't import this entry

### Missing Attribution
If contractor names aren't recognized:
- Add them to the system first:
  - Go to https://n-zero.dev/create-profile
  - Enter name, role, organization
  - System will auto-link future occurrences

## Next Steps

1. **Immediate**: Upload a small batch (10-20 deal jackets) to test
2. **Review**: Check the bulk editor, correct any errors
3. **Import**: Import the batch
4. **Verify**: Check that vehicles, finances, and timelines look correct
5. **Scale**: Once confident, upload ALL deal jackets (20 years worth!)

## API Endpoints (Advanced)

For automated workflows:
- `POST /functions/v1/parse-deal-jacket` - Parse a single image
- `GET /deal_jacket_imports?status=needs_review` - Get pending reviews
- `PATCH /deal_jacket_imports/:id` - Update parsed data
- `POST /functions/v1/import-deal-jackets` - Bulk import approved jackets

## Support

Questions? Issues?
- Check the system logs at https://n-zero.dev/admin/logs
- Review this guide
- Contact Skylar (system admin)

