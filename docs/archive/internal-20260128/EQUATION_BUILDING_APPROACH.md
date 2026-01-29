# Equation Building Approach - Due Diligence

## Core Principle

**We build the EQUATION, not the final numbers.**

We extract reported components from websites/contracts so users can input their actual data to complete the equation.

## What We Extract (Reported Only)

### Auction Houses
- **Commission Rates**: "5% buyer's premium" → `buyer_premium_rate: 5.0`
- **Seller Commission**: "3% seller commission" → `seller_commission_rate: 3.0`
- **Fees**: "$500 listing fee" → `listing_fee: 500`
- **Equation**: `Revenue = GMV × (seller_commission_rate + buyer_premium_rate) / 100`
- **User Inputs**: Actual GMV, actual transaction counts
- **Result**: Accurate revenue calculation

### Service Businesses
- **Labor Rates**: "$125/hour" → `labor_rate: 125`
- **Parts Markup**: "30% parts markup" → `parts_markup_pct: 30.0`
- **Equation**: `Revenue = labor_rate × hours`, `Cost = parts_cost + labor_cost`
- **User Inputs**: Actual hours worked, actual parts costs
- **Result**: Accurate profit calculation

### Dealerships
- **Pricing**: "Average sale price $45k" → `average_sale_price: 45000`
- **Inventory**: "50 vehicles in stock" → `inventory_count: 50`
- **Equation**: `Revenue = inventory_count × average_sale_price`, `Margin = (sale_price - cost) / sale_price`
- **User Inputs**: Actual sale prices, actual costs per vehicle
- **Result**: Accurate margin calculation

## What We DON'T Do

❌ **Assume profit margins** (e.g., "auction houses have 3% margin")
❌ **Calculate revenue** from vehicle counts × prices
❌ **Estimate GMV** from inventory
❌ **Infer margins** from commission rates

## What We DO

✅ **Extract reported commission rates** from websites
✅ **Extract reported fees** from pricing pages
✅ **Extract reported labor rates** from service descriptions
✅ **Store equation components** in `metadata.equation_components`
✅ **Let users input actual data** to complete the equation

## Database Structure

```json
{
  "metadata": {
    "equation_components": {
      "seller_commission_rate": 3.0,  // Reported
      "buyer_premium_rate": 5.0,      // Reported
      "listing_fee": 500,              // Reported
      "labor_rate": 125,               // Reported
      "reported_annual_revenue": null, // Only if website states it
      "reported_gmv": null,            // Only if website states it
      "reported_profit_margin": null   // Only if website states it
    }
  }
}
```

## User Flow

1. **Due diligence extracts** reported components (commission rates, fees, pricing)
2. **Equation structure** is built: `Revenue = GMV × commission_rate`
3. **User inputs** their actual GMV, transaction counts, costs
4. **System calculates** accurate profit margins from user's real data
5. **Magic happens** when real data meets the equation structure

## Example: Auction House

**Extracted (Reported):**
- Seller commission: 3%
- Buyer premium: 5%
- Listing fee: $500

**Equation Built:**
```
Revenue = GMV × (0.03 + 0.05) + (listing_fee × transaction_count)
```

**User Inputs:**
- Actual GMV: $10M
- Actual transactions: 500

**Calculated:**
```
Revenue = $10M × 0.08 + ($500 × 500) = $800,000 + $250,000 = $1,050,000
```

**User then inputs costs** → Accurate profit margin calculated

