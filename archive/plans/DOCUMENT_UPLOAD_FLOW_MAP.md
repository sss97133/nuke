# Document Upload Flow - Complete Map

**Created**: Oct 31, 2025  
**User Issue**: "I'm seeing way too many document tools that don't work how I want. I don't know where to upload to."

---

## Current Upload Entry Points (ALL OF THEM)

### 1. ✅ WORKING: Visual Valuation Breakdown
**Location**: Top of page, after timeline  
**Button**: "🧾 Add Receipt"  
**Component**: `VisualValuationBreakdown` → `SmartInvoiceUploader`

```typescript
// VehicleProfile.tsx line 1244
<VisualValuationBreakdown
  vehicleId={vehicle.id}
  isOwner={Boolean(isRowOwner || isVerifiedOwner)}
/>

// VisualValuationBreakdown.tsx
<button onClick={() => setShowUploader(true)}>
  🧾 Add Receipt
</button>
{showUploader && (
  <SmartInvoiceUploader
    vehicleId={vehicleId}
    onClose={() => setShowUploader(false)}
    onSaved={() => {
      setShowUploader(false);
      loadValuation();
    }}
  />
)}
```

**Status**: ✅ WORKS  
**What it does**:
- Opens SmartInvoiceUploader modal
- AI parses PDF/image (GPT-4 Vision)
- Extracts vendor, date, total, line items
- Creates receipt in database
- Updates valuation automatically
- Creates timeline event on document date

---

### 2. ✅ WORKING: Image Gallery Upload
**Location**: Right column, image gallery section  
**Button**: Upload button in ImageGallery (if `showUpload={true}`)  
**Component**: `ImageGallery`

```typescript
// VehicleProfile.tsx line 1462 (in VehicleImageGallery)
<ImageGallery
  vehicleId={vehicle.id}
  onImagesUpdated={onImageUpdate}
  showUpload={canUpload}
/>
```

**Status**: ✅ WORKS  
**What it does**:
- Multi-file image upload
- EXIF metadata extraction
- AI tagging (automatic)
- Thumbnail generation
- Timeline events created
- Expert agent triggered

---

### 3. ❌ REMOVED: Build System (B&V)
**Location**: ~~Left column, inside Basic Info~~  
**Button**: ~~"Add Document"~~  
**Component**: ~~`VehicleBuildSystem`~~

**Status**: ❌ ARCHIVED Oct 31, 2025  
**Why**: Showed "$0 invested, 0 parts" and linked to broken uploader

---

### 4. ❌ REMOVED: Document Manager
**Location**: ~~Left column~~  
**Button**: ~~"Add Document"~~  
**Component**: ~~`VehicleDocumentManager`~~

**Status**: ❌ ARCHIVED Oct 31, 2025  
**Why**: Uploaded but didn't parse, showed empty preview

---

### 5. ❌ REMOVED: Receipt Manager
**Location**: ~~Left column~~  
**Button**: ~~"Upload Receipt"~~  
**Component**: ~~`ReceiptManager`~~

**Status**: ❌ ARCHIVED Oct 31, 2025  
**Why**: Redundant with SmartInvoiceUploader

---

### 6. 🤔 UNCLEAR: Add Event Wizard
**Location**: Modal triggered by various buttons  
**Button**: Multiple triggers (history button, etc.)  
**Component**: `AddEventWizard`

```typescript
// VehicleProfile.tsx line 1657
{showAddEvent && (
  <AddEventWizard
    vehicleId={vehicle.id}
    onClose={() => {
      setShowAddEvent(false);
      window.dispatchEvent(new CustomEvent('vehicle_images_updated', {
        detail: { vehicleId: vehicle.id }
      }));
    }}
    onEventAdded={() => {
      setShowAddEvent(false);
      window.dispatchEvent(new CustomEvent('vehicle_images_updated', {
        detail: { vehicleId: vehicle.id }
      }));
    }}
    currentUser={session?.user || null}
  />
)}
```

**Status**: 🤔 EXISTS but not document-focused  
**What it does**:
- Manual timeline event creation
- Can attach photos to events
- Not primarily for receipts/invoices
- More for "I did work today" entries

---

### 7. 🤔 MOBILE ONLY: MobileDocumentUploader
**Location**: Mobile view only  
**Component**: `MobileDocumentUploader` (in `MobileVehicleProfile`)

**Status**: 🤔 EXISTS  
**What it does**:
- Mobile-optimized upload
- Fixed table name (line 153): `vehicle_timeline_events`
- Fixed date logic: uses document date
- Creates timeline events

**Issue**: Separate from desktop flow, could cause confusion

---

## Visual Flow Map

```
Vehicle Profile Page
│
├─ TOP SECTION
│  └─ Visual Valuation Breakdown
│     └─ [🧾 Add Receipt] ← ✅ THIS IS THE ONE YOU WANT
│        └─ SmartInvoiceUploader (WORKS)
│           ├─ Upload PDF/image
│           ├─ AI parse (GPT-4 Vision)
│           ├─ Preview with data
│           ├─ Save receipt
│           ├─ Update valuation
│           └─ Create timeline event
│
├─ LEFT COLUMN
│  ├─ Basic Info
│  │  └─ (B&V section REMOVED)
│  ├─ Financial Products
│  ├─ Share Holders
│  ├─ Work Memory
│  ├─ (Document Manager REMOVED)
│  ├─ (Receipt Manager REMOVED)
│  └─ Enhanced Image Tagger
│
└─ RIGHT COLUMN
   └─ Image Gallery
      └─ Upload button ← ✅ FOR PHOTOS ONLY
         └─ ImageUploadService (WORKS)
            ├─ Upload images
            ├─ EXIF extraction
            ├─ AI tagging
            └─ Timeline events
```

---

## Recommendation: SINGLE UPLOAD FLOW

### Problem Right Now

**User confusion**: "I don't know where to upload to"

**Why**: Even after removing 3 components, there are still:
- ✅ Receipt upload (Valuation section)
- ✅ Photo upload (Image Gallery)
- 🤔 Event wizard (manual timeline)
- 🤔 Mobile uploader (separate flow)

### Proposed Solution: Unified Upload Modal

**One button, two tabs**:

```
┌────────────────────────────────────┐
│  Upload to Vehicle Profile         │
├────────────────────────────────────┤
│  [📸 Photos]  [🧾 Documents]       │
├────────────────────────────────────┤
│                                    │
│  Photos tab:                       │
│    - Drag/drop images              │
│    - AI tags automatically         │
│    - Timeline events created       │
│                                    │
│  Documents tab:                    │
│    - Drag/drop PDFs/receipts       │
│    - AI parses automatically       │
│    - Value updated                 │
│                                    │
└────────────────────────────────────┘
```

**Single entry point**:
- Replace both "Add Receipt" and Image Gallery upload
- One unified "Upload" button
- Modal with tabs based on file type
- Auto-detect: PDF → Documents, JPG → Photos
- Same backend (SmartInvoiceUploader + ImageGallery)

---

## Where to Upload RIGHT NOW

### For Receipts/Invoices (Like Desert Performance)
**GO HERE**: 👇

1. Scroll past timeline
2. Find "AI Expert Valuation" section
3. Click "🧾 Add Receipt" (top right of card)
4. Upload your PDF
5. AI will parse it
6. Review and save

**This is the ONLY working receipt upload.**

### For Photos (Work documentation)
**GO HERE**: 👇

1. Right column
2. Image Gallery section
3. Click upload button
4. Drop images
5. AI tags automatically

### DON'T USE:
- ❌ Any "Add Document" buttons (archived/broken)
- ❌ "B&V" section (removed)
- ❌ Manual "Add Part" flows (deprecated)

---

## Code Changes Needed for Single Upload Flow

### 1. Create UnifiedUploadModal.tsx

```typescript
interface UnifiedUploadModalProps {
  vehicleId: string;
  onClose: () => void;
  onSuccess: () => void;
  defaultTab?: 'photos' | 'documents';
}

export const UnifiedUploadModal: React.FC<UnifiedUploadModalProps> = ({
  vehicleId,
  onClose,
  onSuccess,
  defaultTab = 'photos'
}) => {
  const [activeTab, setActiveTab] = useState<'photos' | 'documents'>(defaultTab);
  
  return (
    <div className="modal">
      <div className="modal-header">
        <h3>Upload</h3>
      </div>
      
      <div className="tabs">
        <button
          className={activeTab === 'photos' ? 'active' : ''}
          onClick={() => setActiveTab('photos')}
        >
          📸 Photos
        </button>
        <button
          className={activeTab === 'documents' ? 'active' : ''}
          onClick={() => setActiveTab('documents')}
        >
          🧾 Documents
        </button>
      </div>
      
      <div className="modal-body">
        {activeTab === 'photos' ? (
          <ImageUploadZone
            vehicleId={vehicleId}
            onComplete={onSuccess}
          />
        ) : (
          <SmartInvoiceUploader
            vehicleId={vehicleId}
            onClose={onClose}
            onSaved={onSuccess}
          />
        )}
      </div>
    </div>
  );
};
```

### 2. Replace Entry Points

**Replace in VisualValuationBreakdown**:
```typescript
// OLD
<button onClick={() => setShowUploader(true)}>
  🧾 Add Receipt
</button>

// NEW
<button onClick={() => setShowUnifiedUpload(true)}>
  ⬆️ Upload
</button>

{showUnifiedUpload && (
  <UnifiedUploadModal
    vehicleId={vehicleId}
    defaultTab="documents"
    onClose={() => setShowUnifiedUpload(false)}
    onSuccess={() => {
      setShowUnifiedUpload(false);
      loadValuation();
    }}
  />
)}
```

**Replace in VehicleProfile**:
```typescript
// Add prominent upload button in header
<button
  className="button button-primary"
  onClick={() => setShowUnifiedUpload(true)}
>
  ⬆️ Upload
</button>
```

---

## Summary for User

### Current State (After Cleanup)

**Working upload points**:
1. ✅ "🧾 Add Receipt" in Valuation section (for receipts/invoices)
2. ✅ Image Gallery upload button (for photos)

**Removed (archived)**:
1. ❌ B&V "Add Document"
2. ❌ Document Manager
3. ❌ Receipt Manager

**Still confusing**:
- Two separate entry points for uploads
- Not obvious which one to use
- Desktop vs mobile have different flows

### Recommended Next Step

**Option A: Leave as-is**
- Two clear entry points
- Receipts → Valuation section
- Photos → Image Gallery
- Simple, works

**Option B: Build UnifiedUploadModal**
- One button: "⬆️ Upload"
- Auto-detect file type
- Tabs for photos/documents
- Single entry point
- ~2 hours of work

**Which do you prefer?**

---

## Files to Reference

**Current working uploaders**:
- `/nuke_frontend/src/components/SmartInvoiceUploader.tsx` (receipts)
- `/nuke_frontend/src/components/images/ImageGallery.tsx` (photos)
- `/nuke_frontend/src/services/imageUploadService.ts` (photo processing)

**Archived (reference only)**:
- `/_archive_document_uploaders/VehicleDocumentManager.tsx`
- `/_archive_document_uploaders/VehicleDocumentUploader.tsx`
- `/_archive_document_uploaders/VehicleBuildSystem.tsx`

**Entry points**:
- `/nuke_frontend/src/pages/VehicleProfile.tsx` (main page)
- `/nuke_frontend/src/components/vehicle/VisualValuationBreakdown.tsx` (receipt button)
- `/nuke_frontend/src/pages/vehicle-profile/VehicleImageGallery.tsx` (photo button)

