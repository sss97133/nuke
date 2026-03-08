# Vehicle Data Extraction from Numbers Files

**Generated:** 2026-02-01
**Source:** 66 Numbers spreadsheet files
**Status:** Active - records created in database

---

## Database Actions Completed

### Vehicles Created (5 new)
| Year | Make | Model | VIN | ID |
|------|------|-------|-----|-----|
| 1973 | Dodge | Charger 318 | WH23G3A146256 | f05462f9-4901-4e02-bbed-8d2670de4646 |
| 1991 | Chevrolet | Suburban V1500 | 1GNEV16K8MF147795 | ca1c9024-7f41-45dd-90df-7a6a3b92464c |
| 1984 | Chevrolet | K20 | 1GCEK14L9EJ147915 | 6442df03-9cac-43a8-b89e-e4fb4c08ee99 |
| 1988 | GMC | Truck | 1GDJV34WXJJ507422 | 82057363-b35c-4674-9b3b-a53c907db214 |
| 1983 | GMC | K2500 | 2GTEK24L9D1527691 | fd0487b3-4a6f-428b-a928-e2bbace62048 |

### Ownership Records Created (Skylar Williams)
| Vehicle | VIN | Role | Start Date | End Date | Notes |
|---------|-----|------|------------|----------|-------|
| 1988 GMC Suburban | 1GKEV16K4JF504317 | previous_owner | 2018-01-01 | 2021-11-01 | Sold, later on BaT for $53k |
| 1983 GMC K2500 | 1GTEK14H6DJ501481 | verified_owner | 2020-01-01 | - | Current |
| 1991 Chevy Suburban | 1GNEV16K8MF147795 | verified_owner | 2018-06-14 | - | $57,202 value |
| 1984 Chevy K20 | 1GCEK14L9EJ147915 | previous_owner | 2020-01-01 | - | From estimate files |

---

## Key Timeline: 1988 GMC Suburban

The spreadsheet data proves the provenance chain:

```
2018-01-01 ─── Skylar ownership begins
     │
     │        (In 18-21 accounts.numbers)
     │
2021-11-01 ─── Skylar sells ("88 SUBURBAN SALE")
     │
     ▼
???? ─── New owner acquires
     │
     ▼
???? ─── Listed on BaT
     │
     ▼
SOLD ─── $53,000 on BaT
         https://bringatrailer.com/listing/1988-gmc-suburban-3/
```

---

## Detailed Extraction Results

### Files with VINs

| File | VINs | Date | Key Amount |
|------|------|------|------------|
| 2018 1991 CHEVROLET SUBURBAN V1500.numbers | 1GNEV16K8MF147795 | 6/14/2018 | $57,202 |
| 2021 1988 gmc suburban tan blue.numbers | 1GKEV16K4JF504317 | - | $7,387 |
| 1983 k2500 estimate.numbers | 1GCEK14L9EJ147915 | May | $12,533.08 |
| Chester M.numbers | 5537823GXWEXEBM5G | 2018-11-22 | $10,250 |
| INVENTORY 2024.numbers | 1GDJV34WXJJ507422 | 12/6/23 | - |
| Finances.numbers | 1GDJV34WXJJ507422, 2GTEK24L9D1527691 | - | $88,150 |

### Customer Work/Estimates

| Client | Vehicle | Total Estimate | Key Date |
|--------|---------|---------------|----------|
| Hugo | 1973 Dodge Charger | $24,510.34 | 1/16/2024 |
| Cameron/Chester | 1983 GMC K2500 | $12,533.08 | May 2020? |
| Unknown | 1989 Blazer | $12,395.71 | - |
| Howard Barton | Coupe | - | - |
| Tommy | - | - | - |
| Scott | - | $64,725 | - |

### Sales History (from 18-21 accounts.numbers)

Dates: 4/1/2020, 10/25/21

| Sale | Notes |
|------|-------|
| 78 SUBURBAN SALE | 1978 Suburban sold |
| 65 MUSTANG SALE | 1965 Mustang sold |
| 88 SUBURBAN SALE | 1988 Suburban sold (now on BaT) |
| Mecum 10% sale Fee | Something sold at Mecum auction |

### Large Financial Figures

| File | Amount | Context |
|------|--------|---------|
| INVENTORY 2024 | $524,381 | Total inventory value? |
| INVENTORY 2024 | $378,178 | |
| Finances.numbers | $292,943 | |
| Finances.numbers | $88,150 | |
| scott copy 1 | $64,725 | |
| 2018 Suburban V1500 | $57,202 | Purchase/sale price |
| 1973 Charger | $24,510.34 | Project total |
| 1983 K2500 | $12,533.08 | Estimate |
| 1989 Blazer | $12,395.71 | Estimate |

---

## Vehicles by Category

### Personal (Skylar's ownership documented)
- 1988 GMC Suburban (sold 2021)
- 1991 Chevrolet Suburban V1500
- 1984 Chevrolet K20
- 1983 GMC K2500

### Viva Las Vegas Autos Inventory
- Various Blazers (74, 77, 89)
- Mustangs (65 coupe, 65 fastback)
- Suburbans (71, 78, 87)
- Chargers (73, 66)
- 1973 GMC Jimmy
- 1970 Bronco
- 1932 Ford Roadster

### Customer Work
- Hugo's 1973 Charger (WH23G3A146256)
- Cameron's 1983 K2500 (1GTEK14H6DJ501481)
- Chester Merrill project
- Howard Barton coupe
- Scott project ($64k)
- Tommy project

---

## Files by Category

### Vehicle-Specific (with dates/amounts)
- `2018 1991 CHEVROLET SUBURBAN V1500.numbers` - 6/14/2018, $57,202
- `2021 1988 gmc suburban tan blue.numbers` - $7,387
- `C2020 1973 charger.numbers` - 12/11/2023, 1/16/2024, $24,510
- `1983 k2500 estimate.numbers` - $12,533
- `1989 blazerestimate.numbers` - $12,395

### Inventory/Business
- `INVENTORY 2024.numbers` - $524k, $378k
- `Inventory sheets.numbers` - $524k
- `automotive_inventory.numbers`
- `Inventory consignment.numbers`

### Financial/Accounts
- `18-21 accounts.numbers` - 10/25/21, sales records
- `Finances.numbers` - $292k, multiple VINs
- `complete-transactions.numbers`
- `rents accounting.numbers`

### WCO (Williams and Co.)
- `SP 2024.numbers`
- `Finances.numbers`
- `Payments April 2024.numbers`
- `Truck list q3.numbers`

---

## Remaining Work

### Vehicles to add ownership for:
- 1973 Dodge Charger - Was this Skylar's or customer work?
- 1988 GMC Truck (1GDJV34WXJJ507422)
- 1983 GMC K2500 Canada (2GTEK24L9D1527691)

### Data to extract:
- Parts receipts with dates
- Specific transaction dates from accounts
- Labor hours/rates
- Image references

### Potential merges:
- Check if any vehicles match existing BaT listings by year/make/model
