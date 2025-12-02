# My Organizations - Comprehensive Wireframe & Backend

## Overview
"My Organizations" is a personal dashboard showing all organizations the user is affiliated with, owns, or manages. It's the central hub for managing organizational relationships, roles, and activities.

---

## Core Philosophy

**My Organizations = Personal Organizational Identity + Management Hub**

Unlike the public "Organizations" browse page, "My Organizations" is:
- **Personal**: Only organizations YOU are part of
- **Actionable**: Quick access to manage, edit, and contribute
- **Role-Aware**: Different views/actions based on your role
- **Activity-Focused**: Shows your contributions and impact

---

## Page Layout

```
┌─────────────────────────────────────────────────────────┐
│  MY ORGANIZATIONS                                       │
│  [Filter: All | Active | Past] [Sort] [Create New]     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │ SUMMARY STATS                                    │  │
│  │ • Active Organizations: 3                        │  │
│  │ • Total Vehicles: 127                            │  │
│  │ • Your Contributions: 342                        │  │
│  │ • Total Value: $2.4M                             │  │
│  └─────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │ ORGANIZATION CARD                                 │  │
│  │ [Logo] Vintage Auto Restoration                  │  │
│  │ Role: Owner | Status: Active | Since: 2020      │  │
│  │                                                  │  │
│  │ Quick Stats:                                     │  │
│  │ • 45 vehicles in inventory                      │  │
│  │ • 12 active listings                            │  │
│  │ • $1.2M total value                              │  │
│  │ • 89 contributions this month                   │  │
│  │                                                  │  │
│  │ [View Profile] [Manage Inventory] [Settings]     │  │
│  └─────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │ ORGANIZATION CARD                                 │  │
│  │ [Logo] Classic Car Dealership                    │  │
│  │ Role: Manager | Status: Active | Since: 2022    │  │
│  │                                                  │  │
│  │ Quick Stats:                                     │  │
│  │ • 67 vehicles in inventory                      │  │
│  │ • 8 active listings                             │  │
│  │ • $890K total value                              │  │
│  │ • 23 contributions this month                   │  │
│  │                                                  │  │
│  │ [View Profile] [Manage Inventory] [Settings]     │  │
│  └─────────────────────────────────────────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Organization Card Components

### 1. **Header Section**
- Organization logo/avatar
- Organization name (clickable → org profile)
- Business type badge (Dealership, Restoration Shop, etc.)
- Verification badge (if verified)

### 2. **Role & Status**
- Your role (Owner, Manager, Employee, etc.)
- Status badge (Active, Past, Pending)
- Start date / End date (if past)
- Role color coding (green=owner, blue=manager, orange=employee)

### 3. **Quick Stats** (Role-Based)
- **For Owners/Managers:**
  - Total vehicles in inventory
  - Active listings count
  - Total inventory value
  - Pending verifications
  - Team member count
  
- **For Employees/Contributors:**
  - Your contribution count
  - Vehicles you've worked on
  - Recent activity timeline
  - Your impact metrics

### 4. **Quick Actions** (Role-Based)
- **For Owners:**
  - [View Profile] → Public org page
  - [Manage Inventory] → Inventory management
  - [Settings] → Org settings, team, permissions
  - [Financials] → Revenue, expenses, transactions
  - [Analytics] → Performance metrics
  
- **For Managers:**
  - [View Profile]
  - [Manage Inventory]
  - [Team] → Manage team members
  - [Settings] → Limited settings
  
- **For Employees:**
  - [View Profile]
  - [My Work] → Vehicles you're assigned to
  - [Contribute] → Add data/images

### 5. **Recent Activity Preview**
- Last 3-5 contributions/events
- Timeline of recent changes
- Notifications/alerts

---

## Views & Filters

### Filter Options
- **All** - All organizations (active + past)
- **Active** - Currently active affiliations
- **Past** - Historical affiliations
- **By Role** - Filter by your role (owner, manager, employee)
- **By Type** - Filter by business type (dealership, shop, etc.)

### Sort Options
- **Recently Active** - Most recent activity first
- **Alphabetical** - A-Z by name
- **Value** - Highest inventory value first
- **Contributions** - Most contributions first
- **Date Joined** - When you joined

### View Modes
- **Cards** (default) - Visual cards with stats
- **List** - Compact table view
- **Timeline** - Chronological view of affiliations

---

## Detailed Organization View

When clicking an organization card, show expanded view:

```
┌─────────────────────────────────────────────────────────┐
│  VINTAGE AUTO RESTORATION                                │
│  [Back] [Edit] [Settings]                               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  YOUR ROLE: Owner | Active since 2020                  │
│                                                         │
│  TABS: [Overview] [Inventory] [Team] [Financials]    │
│        [Analytics] [Settings]                          │
│                                                         │
│  OVERVIEW TAB:                                          │
│  • Organization profile info                           │
│  • Your permissions summary                            │
│  • Quick stats dashboard                               │
│  • Recent activity feed                                 │
│                                                         │
│  INVENTORY TAB:                                         │
│  • All vehicles in organization inventory              │
│  • Filter by status (in stock, sold, consignment)      │
│  • Add/remove vehicles                                  │
│  • Bulk actions                                         │
│                                                         │
│  TEAM TAB:                                              │
│  • All team members                                     │
│  • Invite new members                                   │
│  • Manage roles/permissions                             │
│                                                         │
│  FINANCIALS TAB:                                        │
│  • Revenue/expenses                                     │
│  • Transactions                                         │
│  • Invoices                                             │
│                                                         │
│  ANALYTICS TAB:                                         │
│  • Performance metrics                                  │
│  • Contribution stats                                   │
│  • Inventory value trends                               │
│                                                         │
│  SETTINGS TAB:                                          │
│  • Organization details                                 │
│  • Privacy settings                                     │
│  • Permissions                                          │
│  • Leave organization                                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Backend Schema

### Existing Tables (Already Implemented)

1. **`businesses`** - Organization profiles
   - `id`, `business_name`, `business_type`, `logo_url`
   - `discovered_by`, `uploaded_by`
   - `is_public`, `is_verified`
   - `latitude`, `longitude`

2. **`organization_contributors`** - User-org relationships
   - `id`, `organization_id`, `user_id`
   - `role` (owner, manager, employee, etc.)
   - `status` (active, inactive, pending)
   - `start_date`, `end_date`
   - `contribution_count`

3. **`business_ownership`** - Legal ownership
   - `id`, `business_id`, `owner_id`
   - `ownership_percentage`
   - `ownership_type` (founder, partner, investor)
   - `status` (active, pending, transferred)

4. **`organization_vehicles`** - Org inventory
   - `id`, `organization_id`, `vehicle_id`
   - `relationship_type` (owner, in_stock, consignment, etc.)
   - `linked_by_user_id`

### New Tables Needed

#### 1. **`user_organization_preferences`**
```sql
CREATE TABLE IF NOT EXISTS user_organization_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  -- Display preferences
  is_pinned BOOLEAN DEFAULT false,  -- Pin to top of list
  display_order INTEGER DEFAULT 0,  -- Custom sort order
  notification_settings JSONB DEFAULT '{}',  -- Per-org notification prefs
  
  -- Quick access
  favorite_actions TEXT[],  -- Quick action buttons to show
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, organization_id)
);
```

#### 2. **`organization_activity_summary`** (Materialized View)
```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS organization_activity_summary AS
SELECT 
  oc.organization_id,
  oc.user_id,
  COUNT(DISTINCT ov.vehicle_id) as vehicle_count,
  COUNT(DISTINCT CASE WHEN ov.relationship_type = 'in_stock' THEN ov.vehicle_id END) as in_stock_count,
  COUNT(DISTINCT CASE WHEN ov.relationship_type = 'sold' THEN ov.vehicle_id END) as sold_count,
  SUM(CASE WHEN v.current_value IS NOT NULL THEN v.current_value ELSE 0 END) as total_value,
  COUNT(DISTINCT te.id) as contribution_count,
  MAX(te.created_at) as last_activity_at
FROM organization_contributors oc
LEFT JOIN organization_vehicles ov ON ov.organization_id = oc.organization_id
LEFT JOIN vehicles v ON v.id = ov.vehicle_id
LEFT JOIN timeline_events te ON te.organization_id = oc.organization_id
WHERE oc.status = 'active'
GROUP BY oc.organization_id, oc.user_id;
```

---

## API/Service Layer

### `MyOrganizationsService.ts`

```typescript
export interface MyOrganization {
  id: string;
  organization_id: string;
  organization: {
    id: string;
    business_name: string;
    business_type: string;
    logo_url?: string;
    is_verified: boolean;
  };
  role: string;
  status: string;
  start_date: string;
  end_date?: string;
  contribution_count: number;
  stats: {
    vehicle_count: number;
    in_stock_count: number;
    total_value: number;
    last_activity_at?: string;
  };
  preferences?: {
    is_pinned: boolean;
    display_order: number;
  };
}

export class MyOrganizationsService {
  // Get all organizations for current user
  static async getMyOrganizations(filters?: {
    status?: 'active' | 'inactive' | 'all';
    role?: string;
    sortBy?: 'recent' | 'name' | 'value' | 'contributions';
  }): Promise<MyOrganization[]>
  
  // Get detailed organization view
  static async getOrganizationDetails(orgId: string): Promise<OrganizationDetails>
  
  // Update role/status
  static async updateAffiliation(affiliationId: string, updates: {
    role?: string;
    status?: string;
  }): Promise<{ success: boolean }>
  
  // Pin/unpin organization
  static async togglePin(organizationId: string, isPinned: boolean): Promise<{ success: boolean }>
  
  // Get organization stats
  static async getOrganizationStats(orgId: string): Promise<OrganizationStats>
}
```

---

## Component Structure

### `MyOrganizations.tsx` (Main Page)
- Summary stats header
- Filter/sort controls
- Organization cards list
- Empty state
- Create new organization button

### `OrganizationCard.tsx` (Reusable Card)
- Organization header
- Role/status badge
- Quick stats
- Quick actions
- Recent activity preview

### `OrganizationDetailView.tsx` (Expanded View)
- Tab navigation
- Overview tab
- Inventory tab
- Team tab
- Financials tab
- Analytics tab
- Settings tab

---

## Key Features

### 1. **Role-Based Permissions**
- Different views/actions based on role
- Owners see everything
- Managers see limited settings
- Employees see their work only

### 2. **Quick Actions**
- Context-aware buttons
- One-click access to common tasks
- Customizable per organization

### 3. **Activity Tracking**
- Contribution counts
- Recent activity timeline
- Impact metrics

### 4. **Organization Management**
- Create new organizations
- Leave organizations
- Transfer ownership
- Manage team members

### 5. **Analytics & Insights**
- Inventory value trends
- Contribution stats
- Performance metrics
- Comparison across organizations

---

## Implementation Phases

### Phase 1: Basic List View
- ✅ Load organizations from `organization_contributors`
- ✅ Display organization cards
- ✅ Show role/status
- ✅ Basic filtering (active/past)

### Phase 2: Enhanced Stats
- ⏳ Add quick stats to cards
- ⏳ Create `organization_activity_summary` view
- ⏳ Display vehicle counts, values

### Phase 3: Detailed Views
- ⏳ Organization detail page
- ⏳ Tab navigation
- ⏳ Role-based permissions

### Phase 4: Preferences & Customization
- ⏳ Pin organizations
- ⏳ Custom sort order
- ⏳ Notification settings
- ⏳ Favorite actions

### Phase 5: Analytics
- ⏳ Performance dashboards
- ⏳ Contribution tracking
- ⏳ Value trends

---

## Integration Points

- **Profile Page**: Link from "Organizations" tab
- **Organization Browse**: Link to create/join organizations
- **Vehicle Management**: Quick access to org inventory
- **Team Management**: Invite/manage members
- **Financials**: Revenue/expense tracking

