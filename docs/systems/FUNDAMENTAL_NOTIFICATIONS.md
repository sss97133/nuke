# Fundamental Notifications System

## Overview

A simple, essential notification system covering the basics that a platform like Nuke actually needs. Not over-engineered - just what users need to know.

## What It Covers

### User-to-User Notifications

1. **Comment on Vehicle** (`comment_on_vehicle`)
   - Someone commented on your vehicle
   - Shows comment text
   - Links to vehicle

2. **Vehicle Access Request** (`vehicle_access_request`)
   - Someone requested access to your vehicle
   - Shows requester info
   - Links to approve/decline

3. **Vehicle Contribution** (`vehicle_contribution`)
   - Someone contributed data/images to your vehicle
   - Shows what was contributed
   - Links to vehicle

4. **Vehicle Liked** (`vehicle_liked`)
   - Someone liked your vehicle
   - Shows who liked it

5. **Vehicle Favorited** (`vehicle_favorited`)
   - Someone favorited your vehicle
   - Shows who favorited it

### System-to-User Notifications

1. **Upload Completed** (`upload_completed`)
   - Your image upload finished
   - Shows count of uploaded images
   - Links to vehicle

2. **Analysis Completed** (`analysis_completed`)
   - AI analysis finished
   - Shows what was analyzed
   - Links to results

3. **Price Updated** (`price_updated`)
   - Price update on your vehicle
   - Shows old vs new price
   - Links to vehicle

4. **Similar Vehicle Found** (`similar_vehicle_found`)
   - New similar vehicle found
   - Shows vehicle details
   - Links to vehicle

5. **Auction Ending Soon** (`auction_ending_soon`)
   - Auction ending soon
   - Shows time remaining
   - Links to auction

### Organization/Shop Notifications

1. **Work Order Assigned** (`work_order_assigned`)
   - New work order assigned
   - Shows vehicle and work type
   - Links to work order

2. **Customer Uploaded Images** (`customer_uploaded_images`)
   - Customer uploaded images
   - Shows count
   - Links to vehicle

3. **Payment Received** (`payment_received`)
   - Payment received
   - Shows amount
   - Links to payment details

### Collaboration Notifications

1. **Verification Request** (`verification_request`)
   - Verification request
   - Shows what needs verification
   - Links to verify

2. **Ownership Claim** (`ownership_claim`)
   - Ownership claim
   - Shows claim details
   - Links to approve/decline

3. **Merge Proposal** (`merge_proposal`)
   - Vehicle merge proposal
   - Shows vehicles to merge
   - Links to approve/decline

## How to Use

### Create Notification

```typescript
// From Edge Function
await supabase.functions.invoke('create-notification', {
  body: {
    user_id: 'uuid',
    notification_type: 'comment_on_vehicle',
    title: 'New comment on your vehicle',
    message: 'John commented: "Nice build!"',
    vehicle_id: 'uuid',
    from_user_id: 'uuid',
    action_url: '/vehicle/uuid'
  }
})

// Or from SQL
SELECT create_user_notification(
  'user-uuid',
  'comment_on_vehicle',
  'New comment on your vehicle',
  'John commented: "Nice build!"',
  'vehicle-uuid',
  NULL,
  NULL,
  'from-user-uuid',
  '/vehicle/uuid',
  '{"comment_id": "uuid"}'::jsonb
);
```

### Common Patterns

**When someone comments:**
```typescript
await supabase.functions.invoke('create-notification', {
  body: {
    user_id: vehicleOwnerId,
    notification_type: 'comment_on_vehicle',
    title: `${commenterName} commented on your ${year} ${make} ${model}`,
    message: commentText,
    vehicle_id: vehicleId,
    from_user_id: commenterId,
    action_url: `/vehicle/${vehicleId}`,
    metadata: { comment_id: commentId }
  }
})
```

**When upload completes:**
```typescript
await supabase.functions.invoke('create-notification', {
  body: {
    user_id: userId,
    notification_type: 'upload_completed',
    title: 'Upload completed',
    message: `Successfully uploaded ${imageCount} images`,
    vehicle_id: vehicleId,
    action_url: `/vehicle/${vehicleId}`,
    metadata: { image_count: imageCount, failed_count: 0 }
  }
})
```

**When AI analysis finishes:**
```typescript
await supabase.functions.invoke('create-notification', {
  body: {
    user_id: userId,
    notification_type: 'analysis_completed',
    title: 'AI analysis completed',
    message: `Analysis finished for ${vehicleName}`,
    vehicle_id: vehicleId,
    action_url: `/vehicle/${vehicleId}`,
    metadata: { analysis_type: 'tier2', confidence: 85 }
  }
})
```

## UI Components

### Notification Bell
- Shows unread count
- Opens notification center on click
- Real-time updates

### Notification Center
- Lists all notifications
- Mark as read
- Mark all as read
- Click to navigate
- Real-time updates

## Access

**Bell Icon:** Top right of header (next to profile)
**Notification Center:** Click bell to open
**Route:** Can also access `/notifications` if needed

## Status

✅ **Database schema created**
✅ **UI components created**
✅ **Edge function created**
✅ **Integrated into header**
⏳ **Integration with existing systems** (next step)

## Next Steps

1. **Integrate with existing systems:**
   - Comment system → creates notification
   - Image upload → creates notification
   - AI analysis → creates notification
   - Vehicle interactions → creates notification

2. **Add notification preferences:**
   - Let users choose what they want to be notified about
   - Email notifications (optional)
   - Push notifications (optional)

3. **Add notification grouping:**
   - Group similar notifications
   - "5 new comments on your vehicle"
   - "3 uploads completed"

