# Service Categories and Location-Based Collaboration

## Overview

This system enables:
1. **Service Status Tracking**: Mark vehicles as "currently in service" or "service archive"
2. **Location-Based Collaboration**: Organizations at the same physical location (e.g., 707 Yucca St) can collaborate on vehicles
3. **Work Exchange**: Companies can see and add work records to each other's vehicle profiles

## Service Categories

### Service Status Values

- `currently_in_service`: Vehicle is actively being worked on
- `service_archive`: Service work completed, archived
- `NULL`: Not in service (default)

### Setting Service Status

```sql
-- Mark vehicle as currently in service
UPDATE organization_vehicles
SET service_status = 'currently_in_service'
WHERE vehicle_id = 'your-vehicle-id' AND organization_id = 'your-org-id';

-- Archive completed service
UPDATE organization_vehicles
SET service_status = 'service_archive'
WHERE vehicle_id = 'your-vehicle-id' AND organization_id = 'your-org-id';
```

## Location-Based Collaboration

### Setting Up Collaboration at 707 Yucca

**Step 1: Register organizations at the location**

```sql
-- Company A registers at 707 Yucca
INSERT INTO location_collaborations (
  location_address,
  location_name,
  organization_id,
  can_view_vehicles,
  can_add_work,
  can_view_work_history,
  can_upload_images,
  granted_by_organization_id,
  granted_by_user_id
) VALUES (
  '707 Yucca St',
  '707 Yucca St HQ',
  'company-a-org-id',
  true,  -- Can see other orgs' vehicles
  true,  -- Can add work to other orgs' vehicles
  true,  -- Can see work history
  false, -- Cannot upload images (restricted)
  'company-a-org-id',
  'user-who-granted-id'
);

-- Company B registers at same location
INSERT INTO location_collaborations (
  location_address,
  location_name,
  organization_id,
  can_view_vehicles,
  can_add_work,
  can_view_work_history,
  can_upload_images
) VALUES (
  '707 Yucca St',
  '707 Yucca St HQ',
  'company-b-org-id',
  true,
  true,
  true,
  false
);
```

**Step 2: View collaborating organizations**

```sql
-- Get all organizations at 707 Yucca
SELECT * FROM get_location_collaborators('707 Yucca St');
```

**Step 3: View vehicles accessible for collaboration**

```sql
-- Get all vehicles Company A can see/work on at 707 Yucca
SELECT * FROM get_collaborative_vehicles('company-a-org-id', '707 Yucca St');
```

## Adding Work Contributions

### Company A adds work to Company B's vehicle

```sql
-- Company A performs work on Company B's vehicle
INSERT INTO vehicle_work_contributions (
  vehicle_id,
  contributing_organization_id,
  vehicle_owner_organization_id,
  work_type,
  work_description,
  work_date,
  labor_hours,
  labor_rate,
  total_cost,
  status,
  performed_by_user_id
) VALUES (
  'vehicle-id-from-company-b',
  'company-a-org-id',  -- Who did the work
  'company-b-org-id',  -- Who owns the vehicle
  'repair',
  'Replaced brake pads and rotors, bled brake system',
  CURRENT_DATE,
  2.5,  -- hours
  150.00,  -- rate per hour
  375.00,  -- total (2.5 * 150)
  'completed',
  'user-who-did-work-id'
);
```

### Link work contribution to timeline event

```sql
-- If you also create a timeline event, link them
UPDATE vehicle_work_contributions
SET timeline_event_id = 'timeline-event-id'
WHERE id = 'work-contribution-id';
```

## Viewing Work History

### Get all work contributions for a vehicle

```sql
-- See all work done on a vehicle (by any collaborating organization)
SELECT * FROM get_vehicle_work_contributions('vehicle-id');

-- See only work done by a specific organization
SELECT * FROM get_vehicle_work_contributions('vehicle-id', 'company-a-org-id');
```

### Example: View work history with organization names

```sql
SELECT 
  vwc.work_date,
  b.business_name as performed_by,
  vwc.work_type,
  vwc.work_description,
  vwc.labor_hours,
  vwc.total_cost,
  vwc.status
FROM vehicle_work_contributions vwc
JOIN businesses b ON b.id = vwc.contributing_organization_id
WHERE vwc.vehicle_id = 'your-vehicle-id'
ORDER BY vwc.work_date DESC;
```

## Permissions Model

### Collaboration Permissions

- **can_view_vehicles**: Can see vehicles from other organizations at the location
- **can_add_work**: Can add work records/timeline events to other orgs' vehicles
- **can_view_work_history**: Can see work history from other organizations
- **can_upload_images**: Can upload images to other orgs' vehicles (restricted by default)

### Setting Permissions

```sql
-- Update collaboration permissions
UPDATE location_collaborations
SET 
  can_add_work = true,
  can_upload_images = false  -- Keep images restricted
WHERE organization_id = 'org-id' AND location_address = '707 Yucca St';
```

## Use Cases

### Use Case 1: Multi-Shop Collaboration

**Scenario**: 707 Yucca has 3 shops:
- Shop A: Engine work
- Shop B: Body/paint
- Shop C: Interior/upholstery

**Workflow**:
1. Vehicle comes to Shop A for engine work
2. Shop A marks vehicle as `currently_in_service`
3. Shop A completes engine work, adds work contribution
4. Vehicle moves to Shop B for paint
5. Shop B sees vehicle (via location collaboration), adds their work
6. Vehicle moves to Shop C for interior
7. Shop C adds their work
8. All shops mark vehicle as `service_archive` when complete

### Use Case 2: Shared Facility

**Scenario**: Multiple companies share 707 Yucca facility

**Workflow**:
1. Company A has a vehicle in their inventory
2. Company B needs to do work on it (they're at same location)
3. Company B can:
   - See the vehicle (if `can_view_vehicles = true`)
   - Add work records (if `can_add_work = true`)
   - See previous work history (if `can_view_work_history = true`)
4. All work is tracked with attribution to Company B

## Frontend Integration

### Filter vehicles by service status

```typescript
// Get vehicles currently in service
const { data } = await supabase
  .from('organization_vehicles')
  .select('*, vehicles(*)')
  .eq('organization_id', orgId)
  .eq('service_status', 'currently_in_service');

// Get service archive
const { data: archive } = await supabase
  .from('organization_vehicles')
  .select('*, vehicles(*)')
  .eq('organization_id', orgId)
  .eq('service_status', 'service_archive');
```

### Get collaborative vehicles

```typescript
// Get vehicles accessible for collaboration
const { data } = await supabase.rpc('get_collaborative_vehicles', {
  p_organization_id: orgId,
  p_location_address: '707 Yucca St'
});
```

### Add work contribution

```typescript
// Add work from collaborating organization
const { data, error } = await supabase
  .from('vehicle_work_contributions')
  .insert({
    vehicle_id: vehicleId,
    contributing_organization_id: myOrgId,
    vehicle_owner_organization_id: ownerOrgId,
    work_type: 'repair',
    work_description: 'Replaced transmission',
    work_date: new Date().toISOString().split('T')[0],
    labor_hours: 4.0,
    labor_rate: 150.00,
    total_cost: 600.00,
    status: 'completed',
    performed_by_user_id: userId
  });
```

## Security

- RLS policies ensure organizations can only:
  - View their own location collaborations
  - Add work if they have `can_add_work` permission
  - View work contributions on vehicles they own or contributed to
- All work contributions are attributed to the contributing organization
- Vehicle owners can see all work done on their vehicles

## Next Steps

1. **Frontend UI**: Build service status filters and collaboration views
2. **Work Order Integration**: Link `vehicle_work_contributions` to `work_orders`
3. **Notifications**: Notify vehicle owners when work is added by collaborators
4. **Billing Integration**: Track costs and revenue attribution per organization

