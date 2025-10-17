# Purchase Agreement System Integration Guide

## Overview
This document explains how to integrate the new automated purchase agreement system into your existing vehicle platform. The system allows verified vehicle owners to create, manage, and execute legally binding purchase agreements with digital signatures and PDF export.

## System Components

### 1. Database Schema
- **File**: `purchase_agreement_system.sql`
- **Tables**:
  - `purchase_agreements` - Main agreement data
  - `purchase_agreement_buyer_candidates` - Track potential buyers
  - `purchase_agreement_signatures` - Digital signature audit trail
- **Functions**:
  - `create_purchase_agreement_from_vehicle()` - Auto-populate from vehicle data
  - `calculate_purchase_agreement_totals()` - Auto-calculate pricing

### 2. Backend API (Elixir/Phoenix)
- **Controller**: `PurchaseAgreementController`
- **Routes**: Added to `router.ex`
- **Template**: `purchase_agreement.html` (based on your original HTML form)

**Key API Endpoints:**
```elixir
POST /api/vehicles/:vehicle_id/purchase-agreements  # Create agreement
GET  /api/purchase-agreements/:id                   # Get agreement details
PUT  /api/purchase-agreements/:id                   # Update agreement
POST /api/purchase-agreements/:id/buyer             # Add buyer
GET  /api/purchase-agreements/:id/html              # Generate HTML
POST /api/purchase-agreements/:id/sign              # Digital signature
GET  /api/purchase-agreements/:id/pdf               # Download PDF
```

### 3. Frontend Components (React/TypeScript)

#### Main Components:
1. **`PurchaseAgreementCreator`** - Create new agreements with auto-filled seller data
2. **`DigitalSignature`** - HTML5 Canvas-based signature capture
3. **`PurchaseAgreementManager`** - Full agreement lifecycle management
4. **`VehicleOwnershipActions`** - Integration with ownership verification

#### Integration Points:
- Connects to existing `vehicles` and `profiles` tables
- Uses existing ownership verification system
- Maintains current RBAC (Role-Based Access Control)

## Integration Steps

### 1. Database Setup
```sql
-- Run the purchase agreement schema
\i purchase_agreement_system.sql

-- Verify tables were created
\d purchase_agreements
\d purchase_agreement_signatures
```

### 2. Backend Integration
The controller is ready to use with your existing Supabase client. Add to your Phoenix application:

```elixir
# In your router.ex (already added)
# Purchase Agreement System (authenticated)
post "/vehicles/:vehicle_id/purchase-agreements", PurchaseAgreementController, :create
get  "/purchase-agreements/:id", PurchaseAgreementController, :show
# ... other routes
```

### 3. Frontend Integration
Add to your vehicle detail page:

```tsx
import VehicleOwnershipActions from './components/VehicleOwnershipActions';

// In your vehicle detail component
<VehicleOwnershipActions
  vehicle={vehicle}
  userProfile={userProfile}
  currentUserId={currentUser.id}
/>
```

## Permission System Integration

The system integrates with your existing ownership verification:

```typescript
// Permission checks
const canCreateAgreement = vehicle.user_id === currentUser.id && vehicle.ownership_verified;

// UI shows different states:
// - Not owner: "Contact seller" options
// - Owner but unverified: "Complete ownership verification"
// - Owner and verified: Full purchase agreement features
```

## Data Flow

### 1. Agreement Creation
```
User clicks "Create Agreement"
→ Auto-fills seller data from profile
→ Auto-fills vehicle data from vehicle record
→ User sets price and terms
→ API creates agreement with status 'draft'
```

### 2. Adding Buyer
```
Seller adds buyer information
→ Updates agreement status to 'pending_signatures'
→ Can send email invitation to buyer
```

### 3. Digital Signatures
```
Signer opens agreement
→ HTML5 canvas signature pad
→ Signature saved as base64 image + metadata
→ API stores signature with IP, timestamp, user agent
→ Agreement status updates when all signatures collected
```

### 4. Document Generation
```
Agreement data + HTML template
→ Server-side HTML generation with data substitution
→ wkhtmltopdf converts to PDF
→ PDF stored and served for download
```

## Security Features

- **Digital signature verification**: IP address, timestamp, user agent tracking
- **RLS (Row Level Security)**: Users can only access their own agreements
- **Audit trail**: All signature events logged
- **Legal compliance**: Based on your original federal disclosure form

## Customization Options

### 1. Pricing Fields
Add/modify pricing fields in the database schema:
```sql
ALTER TABLE purchase_agreements ADD COLUMN custom_fee DECIMAL(10,2) DEFAULT 0;
```

### 2. Template Customization
Edit `purchase_agreement.html` template to match your branding:
```html
<!-- Add your company logo -->
<div class="header">
  <img src="{{company_logo}}" alt="Company Logo" />
  <h1>MOTOR VEHICLE PURCHASE ORDER</h1>
</div>
```

### 3. Email Integration
Add email service integration:
```elixir
# Add email sending route
post "/purchase-agreements/:id/email", PurchaseAgreementController, :send_email
```

## Testing

### 1. Unit Tests
Test the API endpoints with different user roles:
```elixir
test "only verified owners can create agreements" do
  # Test ownership verification requirement
end

test "signature workflow completes agreement" do
  # Test digital signature process
end
```

### 2. Integration Tests
```typescript
// Test frontend components
test('PurchaseAgreementCreator renders for verified owners', () => {
  render(<PurchaseAgreementCreator vehicle={verifiedVehicle} />);
  expect(screen.getByText('Create Purchase Agreement')).toBeInTheDocument();
});
```

## Production Deployment

### 1. Dependencies
- Install `wkhtmltopdf` on your server for PDF generation
- Ensure proper SSL certificates for digital signature legal validity

### 2. Environment Variables
```bash
# PDF generation
export WKHTMLTOPDF_PATH="/usr/local/bin/wkhtmltopdf"

# Email service (optional)
export SMTP_HOST="your-smtp-server"
export SMTP_USER="your-email"
export SMTP_PASS="your-password"
```

### 3. File Storage
Configure proper file storage for generated PDFs:
```elixir
# Store PDFs in S3 or similar
config :nuke_api, :pdf_storage,
  adapter: ExAws.S3,
  bucket: "your-pdf-bucket"
```

## Legal Compliance

The system implements all elements from your original purchase agreement form:
- ✅ Federal disclosure requirements
- ✅ State sales tax calculations
- ✅ Trade-in handling
- ✅ Financing terms disclosure
- ✅ Warranty disclaimers
- ✅ Digital signature equivalency

## Future Enhancements

### 1. Face ID Verification
Add biometric verification for signatures:
```typescript
// Integrate with device biometrics
const verifyIdentity = async () => {
  const result = await navigator.credentials.create({
    publicKey: { /* WebAuthn config */ }
  });
};
```

### 2. Blockchain Signatures
For enhanced legal validity:
```elixir
# Add blockchain hash to signature record
ALTER TABLE purchase_agreement_signatures
ADD COLUMN blockchain_hash TEXT;
```

### 3. Real-time Collaboration
WebSocket integration for live agreement editing:
```javascript
// Real-time updates during agreement review
const socket = new WebSocket('/agreements/collaborate');
```

This system provides a complete DocuSign-like experience while maintaining integration with your existing vehicle platform and ownership verification system.