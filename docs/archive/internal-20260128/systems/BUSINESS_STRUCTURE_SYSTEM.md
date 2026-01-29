# Business Structure System - Complete Implementation

## ✅ What Was Built

### 1. Navigation
- **Added "Organizations" button** to main navigation with BuildingStorefrontIcon
- **Added "Admin Dashboard"** link in admin section
- Both routes functional and visible in UI

### 2. Database Schema (`20250105_shops_business_structure.sql`)

**New Tables:**
- `shop_locations` - Physical addresses (HQ, branches)
- `shop_licenses` - Business licenses tied to locations
- `shop_departments` - Operational departments
- `department_presets` - Pre-configured department templates

**Key Features:**
- **Locations**: Name, address, HQ flag, contact info
- **Licenses**: Types (dealer, garage, repair, etc.), numbers, expiration tracking
- **Departments**: Types (sales, service, consignment, etc.), hierarchies, cost centers
- **Staff Extensions**: Department assignments, job titles, hire dates, rates

**Real-World Example (Viva Las Vegas Autos):**
```
SHOP: Viva Las Vegas Autos (LLC, DBA)
  └─ LOCATION: 707 Yucca St (HQ)
      ├─ LICENSE: Dealer License #NV123456
      ├─ LICENSE: Garage License #NV789012
      ├─ DEPARTMENT: Showroom (showroom type)
      ├─ DEPARTMENT: Consignment (consignment type)
      │   ├─ Doug Williams (owner, undefined role)
      │   └─ Skylar Williams (admin, operator)
      ├─ DEPARTMENT: Service Bay (service type)
      │   └─ Ernie (department head, location manager)
      └─ DEPARTMENT: Admin & Finance
```

### 3. Department Presets System

**Automotive Dealer Presets:**
- Sales Department (sales_manager, salesperson, finance_manager)
- Consignment Department (consignment_manager, salesperson)
- Showroom (showroom_manager, porter)
- Service Department (service_manager, technician, service_advisor)
- Parts Department (parts_manager, parts_specialist)
- Finance & Admin (finance_manager, admin)

**Shop/Garage Presets:**
- Service Bay (shop_manager, mechanic, apprentice)
- Body Shop (body_shop_manager, body_technician, painter)
- Detailing (detail_manager, detailer)
- Parts Counter (parts_manager, counter_staff)

**Builder Presets:**
- Custom Build Shop (master_builder, fabricator, welder)
- Paint & Body (paint_manager, painter, body_man)

**Transporter Presets:**
- Transport Operations (dispatcher, driver, coordinator)

### 4. Frontend Components

**ShopStructureBuilder Component** (`/components/shops/ShopStructureBuilder.tsx`)

**Features:**
- **4 Tabs**: Locations, Licenses, Departments, Staff
- **Real database queries** for all data
- **Add locations** with HQ designation
- **One-click department creation** using presets
- **License management** with expiration tracking
- **Staff assignment** to departments

**Locations Tab:**
- Add new locations (name, address, HQ flag)
- "Add Default Departments" button creates all recommended depts for business type
- Shows all locations with HQ badge

**Licenses Tab:**
- View all licenses
- Link licenses to specific locations
- Track expiration dates

**Departments Tab:**
- Shows recommended departments based on org_type
- View existing departments with location context
- Department hierarchy support

**Staff Tab:**
- View all active shop members
- See department assignments
- Role and status display

### 5. Integration

**Shops Page Updated:**
- "Manage Structure" button on each shop card
- Opens modal with ShopStructureBuilder
- Full CRUD operations on locations, licenses, departments

## 🎯 User Flow Example: Viva Las Vegas Autos Setup

1. **Create Shop**
   - Name: "Viva Las Vegas Autos"
   - Type: Dealer
   - Legal: LLC with DBA

2. **Add Location**
   - Name: "707 Yucca St HQ"
   - Address: 707 Yucca St, Las Vegas, NV 89101
   - Mark as Headquarters: ✓

3. **Add Licenses**
   - Dealer License #NV123456 → 707 Yucca St
   - Garage License #NV789012 → 707 Yucca St

4. **Create Departments** (One-Click)
   - Sales Department
   - Consignment Department
   - Showroom
   - Service Department
   - Parts Department
   - Finance & Admin

5. **Assign Staff**
   - Doug Williams → Owner → Consignment Dept
   - Skylar Williams → Admin → Consignment Dept (operator role)
   - Ernie → Staff → Service Dept → Mark as Department Head

## 📊 Database Features

### Smart Functions

**`get_shop_org_chart(shop_id)`**
- Returns full org chart with locations, departments, staff counts, licenses
- One query gets complete business structure

**`create_default_departments(shop_id, location_id, business_type)`**
- Auto-creates all recommended departments for business type
- Saves hours of manual setup

### Views

**`expiring_licenses`**
- Shows licenses expiring within 90 days
- Automatic renewal alerts
- Sorted by expiration date

### Triggers

- Auto-update `shops.updated_at` when locations/licenses/departments change
- Keeps parent shop timestamp current

### RLS Policies

- **Shop members** can view all locations/licenses/departments
- **Owners/Admins** can manage structure
- **Department presets** are public (read-only)

## 🔧 Technical Specs

**Enums Created:**
- `license_type` - 12 types of automotive licenses
- `department_type` - 12 common department types

**Shop Members Extended:**
- `department_id` - Links staff to departments
- `job_title` - Custom role name
- `hire_date` - Employment start date
- `hourly_rate` - Compensation tracking
- `is_department_head` - Leadership flag

**Indexes:**
- All foreign keys indexed
- HQ locations indexed
- Expiring licenses indexed
- Department hierarchy indexed

## 🚀 How to Use

### Deploy Migration
```bash
psql $DATABASE_URL < supabase/migrations/20250105_shops_business_structure.sql
```

### Access in UI
1. Navigate to `/shops` (Organizations in nav)
2. Click "Manage Structure" on any shop
3. Use tabs to build out structure:
   - Add locations
   - Register licenses
   - Create departments (use presets!)
   - Assign staff

### API Usage

```tsx
// Get org chart
const { data } = await supabase.rpc('get_shop_org_chart', {
  p_shop_id: shopId
});

// Create default departments
await supabase.rpc('create_default_departments', {
  p_shop_id: shopId,
  p_location_id: locationId,
  p_business_type: 'dealer'
});

// Check expiring licenses
const { data } = await supabase
  .from('expiring_licenses')
  .select('*')
  .eq('shop_id', shopId);
```

## 📋 Real Data Throughout

✅ **Locations**: Full CRUD with real inserts/queries
✅ **Licenses**: Database-backed with expiration tracking
✅ **Departments**: Presets from database, real creation
✅ **Staff**: Department assignments via foreign keys
✅ **RLS**: Proper security on all tables
✅ **Functions**: Working RPCs for complex operations

## 🎁 Bonus Features

### Department Hierarchy
- Departments can have parent departments
- Supports organizational trees
- E.g., "Service Bay 1" under "Service Department"

### Cost Center Tracking
- Budget tracking per department
- Cost center codes
- Financial reporting ready

### License Alerts
- `expiring_licenses` view auto-tracks
- 90-day warning window
- Can build notifications on top

### Flexible Staff Structure
- Undefined roles (like Doug & Skylar)
- Department heads
- Hourly rate tracking
- Hire date tracking

## 🔮 Future Enhancements (Optional)

1. **License Upload**: Attach document scans to licenses
2. **Department Budgets**: Track actual vs. budgeted costs
3. **Staff Scheduling**: Assign staff to departments by shift
4. **License Renewal Workflow**: Auto-generate renewal tasks
5. **Org Chart Visualization**: Graph view of business structure
6. **Department Performance**: Metrics per department
7. **Multi-location Routing**: Route jobs to optimal location

## Summary

Complete business structure system with real database backing. Users can now build out complex organizations with multiple locations, licenses, departments, and staff assignments. All grounded in real automotive business operations like Viva Las Vegas Autos.

**Files:**
- Migration: `/supabase/migrations/20250105_shops_business_structure.sql`
- Component: `/components/shops/ShopStructureBuilder.tsx`
- Page: `/pages/Shops.tsx` (updated)
- Nav: `/components/layout/MainNavigation.tsx` (updated)
