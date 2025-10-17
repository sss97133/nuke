# Streamlined Role-Based Access Control System

## Overview

This documentation describes the consolidated role-based access control system that extends existing infrastructure instead of creating redundant systems. The approach reuses proven verification workflows while adding the requested roles: `consigner`, `enthusiast`, `historian`, `curator`, `moderator`, `collector`.

## Architecture Philosophy

**Key Principle**: *Update existing systems instead of creating new ones*

- ✅ **Consolidated**: Extended existing `vehicle_contributors` table with new roles
- ✅ **Streamlined**: Reused existing ownership verification workflow patterns
- ✅ **Non-redundant**: Avoided creating competing role tables
- ✅ **Extensible**: Built flexible role requirements system

## Database Schema

### Core Tables

#### 1. `vehicle_contributors` (EXISTING - EXTENDED)
```sql
-- Extended with new role types
CHECK (role IN (
  -- Existing ownership-related roles
  'owner', 'previous_owner', 'restorer', 'contributor', 'mechanic',

  -- New roles requested by user
  'consigner', 'enthusiast', 'historian', 'curator', 'moderator', 'collector',

  -- Professional service roles
  'appraiser', 'detailer', 'inspector', 'photographer', 'sales_agent',
  'transport_driver', 'buyer', 'seller', 'witness',

  -- Extended contributor types
  'public_contributor', 'verified_contributor', 'specialist', 'expert'
));
```

#### 2. `role_applications` (NEW)
Extends existing ownership verification workflow for role applications:
```sql
CREATE TABLE role_applications (
  id UUID PRIMARY KEY,
  vehicle_id UUID REFERENCES vehicles(id),
  user_id UUID REFERENCES profiles(id),
  requested_role TEXT NOT NULL,
  status TEXT CHECK (status IN ('pending', 'documents_uploaded', 'under_review', 'approved', 'rejected', 'expired')),
  justification TEXT NOT NULL,
  supporting_documents JSONB DEFAULT '[]',
  approval_level_required TEXT CHECK (approval_level_required IN ('standard', 'elevated', 'admin')),
  -- ... timestamps and metadata
);
```

#### 3. `role_requirements` (NEW)
Configurable requirements for each role:
```sql
CREATE TABLE role_requirements (
  role_name TEXT NOT NULL UNIQUE,
  requires_documents BOOLEAN DEFAULT false,
  requires_owner_approval BOOLEAN DEFAULT true,
  approval_level TEXT CHECK (approval_level IN ('standard', 'elevated', 'admin')),
  description TEXT NOT NULL,
  permissions JSONB DEFAULT '{}'
);
```

## Role Hierarchy & Permissions

### Permission Levels
- **`full`**: Complete vehicle management (legal owners, moderators)
- **`edit`**: Can modify vehicle data (consigners, curators, appraisers)
- **`contribute`**: Can add content (enthusiasts, historians, collectors)
- **`view`**: Read-only access (viewers)

### Role Definitions

| Role | Permission Level | Requires Documents | Requires Owner Approval | Description |
|------|-----------------|-------------------|------------------------|-------------|
| `legal_owner` | `full` | Yes (title) | No | Verified legal owner via ownership verification |
| `moderator` | `full` | No | No (admin level) | Platform moderator with administrative access |
| `consigner` | `edit` | Yes | Yes | Professional consigner handling vehicle sale |
| `curator` | `edit` | No | Yes | Museum or collection curator |
| `appraiser` | `edit` | Yes | Yes | Professional vehicle appraiser |
| `previous_owner` | `edit` | Yes | No | Someone who previously owned this vehicle |
| `restorer` | `edit` | No | Yes | Professional or skilled restorer |
| `enthusiast` | `contribute` | No | Yes | Enthusiast with deep knowledge of vehicle type |
| `historian` | `contribute` | No | No | Researcher documenting vehicle history |
| `collector` | `contribute` | No | Yes | Collector with expertise in vehicle type |
| `uploader` | `contribute` | No | No | Database uploader (needs ownership verification) |

## Approval Workflow

### Step-by-Step Process

1. **Application Submission**
   ```typescript
   // User submits role application
   const application = {
     vehicle_id: "uuid",
     user_id: "uuid",
     requested_role: "historian",
     justification: "I've researched this model extensively...",
     supporting_documents: ["research_paper.pdf"]
   };
   ```

2. **Automatic Review Assignment**
   - Reuses existing `verification_reviewers` table
   - Auto-assigns based on approval level required
   - Standard roles → regular reviewers
   - Elevated roles → senior reviewers
   - Admin roles → supervisors

3. **Review & Approval**
   ```sql
   -- Admin/reviewer approves application
   SELECT approve_role_application(
     application_id := 'uuid',
     reviewer_id := 'reviewer_uuid',
     reviewer_notes := 'Verified expertise in muscle cars'
   );
   ```

4. **Role Assignment**
   - Automatically creates entry in `vehicle_contributors`
   - Sets `verified = true` and `verified_by = reviewer_id`
   - Updates application status to 'approved'

## Frontend Integration

### Updated OwnershipService

The existing `OwnershipService.ts` has been extended to handle all new roles:

```typescript
interface OwnershipStatus {
  status: 'legal_owner' | 'contributor_owner' | 'previous_owner' | 'restorer' |
          'contributor' | 'uploader' | 'viewer' | 'no_access' |
          'consigner' | 'enthusiast' | 'historian' | 'curator' | 'moderator' |
          'collector' | 'appraiser' | 'detailer' | 'inspector' | 'photographer' |
          'sales_agent';
  permissionLevel: 'full' | 'edit' | 'contribute' | 'view';
  // ...
}
```

### Permission Checking
```typescript
// Check if user can perform action
const canEdit = await OwnershipService.hasPermission(vehicleId, session, 'edit');

// Get comprehensive ownership status
const ownership = await OwnershipService.getOwnershipStatus(vehicleId, session);
if (ownership.status === 'historian') {
  // Show research tools
}
```

## Security Model

### Row Level Security (RLS)
- **Role Applications**: Users can view their own applications; vehicle owners can view applications for their vehicles
- **Role Requirements**: Publicly readable for transparency
- **Vehicle Contributors**: Existing RLS maintained

### Audit Trail
- All role approvals logged with reviewer information
- Metadata tracks application source and approval notes
- Reuses existing `verification_audit_log` patterns

## API Usage Examples

### Submit Role Application
```javascript
const applicationData = {
  vehicle_id: vehicleId,
  user_id: session.user.id,
  requested_role: 'historian',
  justification: 'I have extensively researched this vehicle model and have published papers on its historical significance.',
  supporting_documents: ['research_paper.pdf', 'publication_list.pdf']
};

const result = await supabase
  .from('role_applications')
  .insert(applicationData);
```

### Query Role Requirements
```javascript
const { data: requirements } = await supabase
  .from('role_requirements')
  .select('*')
  .eq('role_name', 'curator');
```

### Approve Application (Admin)
```javascript
const { data } = await supabase
  .rpc('approve_role_application', {
    application_id: 'uuid',
    reviewer_id: session.user.id,
    reviewer_notes: 'Verified museum credentials'
  });
```

## Migration Path

The system was implemented via migration `20250928233651_consolidate_role_system.exs`:

1. ✅ Extended existing `vehicle_contributors` role constraint
2. ✅ Created `role_applications` table reusing verification patterns
3. ✅ Created `role_requirements` configuration table
4. ✅ Added `approve_role_application()` function
5. ✅ Configured RLS policies
6. ✅ Pre-populated role requirements for requested roles
7. ✅ Updated frontend `OwnershipService` to handle all roles

## Benefits of This Approach

### ✅ Avoided Redundancies
- Did NOT create competing `user_roles` or `vehicle_permissions` tables
- Extended existing proven `vehicle_contributors` system
- Reused existing verification reviewers and workflow

### ✅ Maintainable & Extensible
- Single source of truth: `vehicle_contributors` table
- Flexible role requirements system
- Easy to add new roles by updating constraint + role_requirements

### ✅ Consistent with Existing Patterns
- Same verification workflow as ownership verification
- Same RLS security model
- Same audit logging approach

### ✅ User Experience
- Familiar application process (like ownership verification)
- Clear role hierarchy and permissions
- Transparent requirements for each role

## Future Enhancements

### Ownership Transfer System
The existing role system can support ownership transfer by:
1. Creating new `ownership_transfer` applications
2. Reusing verification workflow for transfer approval
3. Updating `vehicle_contributors` when approved
4. Supporting dealer intermediary roles

### Dealer Intermediary Integration
- Add `dealer_intermediary` role to existing system
- Extend `business_user_roles` for DMV service businesses
- Use existing workflow for dealer verification

This consolidated approach provides all requested functionality while maintaining clean, streamlined code and avoiding the redundancies that plague many role systems.