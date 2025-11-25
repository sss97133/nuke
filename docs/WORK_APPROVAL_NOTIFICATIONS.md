# Work Approval Notification System

## Overview

Complete notification system for work approval requests with:
- **User inbox integration**: Notifications appear in user inboxes
- **Vehicle & organization linking**: All notifications linked to vehicles and organizations
- **Permission-based responses**: Users can respond based on their org role
- **Reversal capability**: Incorrect approvals/rejections can be reversed
- **Complete audit log**: Track record of all events

## How It Works

### 1. Notification Creation

When a high-probability work match (≥90%) is found:

1. **Notification created** in `work_approval_notifications`
2. **Inbox entry created** in `user_notifications` (for inbox UI)
3. **Sent to organization members** (owners/managers prioritized)

### 2. User Response

Users can respond based on their organization role:

- **Full permission** (owner, co_founder, board_member, manager): Can approve/reject
- **Limited permission** (employee, technician, contractor): Can approve/reject
- **View only** (contributor): Cannot respond

### 3. Response Tracking

All responses tracked in `notification_response_history`:
- Who responded
- When they responded
- What role they had
- Response action (approve/reject)
- IP address and user agent

### 4. Reversal

Only owners/managers can reverse responses:
- Reverse previous approval → Work unlinked
- Reverse previous rejection → Work can be re-approved
- All reversals tracked in history

## API Usage

### Get User Notifications

```typescript
// Get pending work approval notifications
const { data } = await supabase
  .from('work_approval_notifications')
  .select('*')
  .eq('user_id', userId)
  .eq('response_status', 'pending')
  .order('created_at', { ascending: false });
```

### Check Response Permission

```typescript
// Check if user can respond
const { data } = await supabase.rpc('can_user_respond_to_notification', {
  p_user_id: userId,
  p_notification_id: notificationId
});

if (data?.can_respond) {
  // User can respond
}
```

### Respond to Notification

```typescript
// Approve work
const { data } = await supabase.rpc('respond_to_work_approval', {
  p_notification_id: notificationId,
  p_user_id: userId,
  p_response_action: 'approve', // or 'reject'
  p_response_notes: 'We did perform this work',
  p_ip_address: null,
  p_user_agent: null
});
```

### Reverse Response

```typescript
// Reverse previous response
const { data } = await supabase.rpc('reverse_work_approval_response', {
  p_notification_id: notificationId,
  p_user_id: userId,
  p_reversal_reason: 'Incorrect approval - we did not do this work',
  p_new_response_action: 'reject', // Optional: new response
  p_ip_address: null,
  p_user_agent: null
});
```

### Get Response History

```typescript
// Get complete history for a notification
const { data } = await supabase
  .from('notification_response_history')
  .select('*')
  .eq('notification_id', notificationId)
  .order('created_at', { ascending: true });
```

## Frontend Integration

### Notification Inbox Component

```typescript
const WorkApprovalNotifications = () => {
  const { data: notifications } = useQuery({
    queryKey: ['work-approval-notifications', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('work_approval_notifications')
        .select(`
          *,
          vehicles(year, make, model),
          businesses(business_name)
        `)
        .eq('user_id', userId)
        .eq('response_status', 'pending')
        .order('created_at', { ascending: false });
      return data;
    }
  });

  return (
    <div>
      {notifications?.map(notif => (
        <NotificationCard
          key={notif.id}
          notification={notif}
          onApprove={() => handleApprove(notif.id)}
          onReject={() => handleReject(notif.id)}
        />
      ))}
    </div>
  );
};
```

### Response Handler

```typescript
const handleApprove = async (notificationId: string) => {
  const { data, error } = await supabase.rpc('respond_to_work_approval', {
    p_notification_id: notificationId,
    p_user_id: userId,
    p_response_action: 'approve',
    p_response_notes: null
  });

  if (error) {
    console.error('Approval error:', error);
    return;
  }

  // Refresh notifications
  queryClient.invalidateQueries(['work-approval-notifications']);
};
```

### Reversal UI

```typescript
const ReversalButton = ({ notificationId, previousResponse }) => {
  const [showReversalModal, setShowReversalModal] = useState(false);

  const handleReversal = async (reason: string, newAction?: string) => {
    const { data, error } = await supabase.rpc('reverse_work_approval_response', {
      p_notification_id: notificationId,
      p_user_id: userId,
      p_reversal_reason: reason,
      p_new_response_action: newAction
    });

    if (error) {
      console.error('Reversal error:', error);
      return;
    }

    // Refresh
    queryClient.invalidateQueries(['work-approval-notifications']);
  };

  return (
    <button onClick={() => setShowReversalModal(true)}>
      Reverse {previousResponse === 'approved' ? 'Approval' : 'Rejection'}
    </button>
  );
};
```

## Response History View

```typescript
const ResponseHistory = ({ notificationId }) => {
  const { data: history } = useQuery({
    queryKey: ['notification-history', notificationId],
    queryFn: async () => {
      const { data } = await supabase
        .from('notification_response_history')
        .select(`
          *,
          responded_by:auth.users(email)
        `)
        .eq('notification_id', notificationId)
        .order('created_at', { ascending: true });
      return data;
    }
  });

  return (
    <div>
      <h3>Response History</h3>
      {history?.map(entry => (
        <div key={entry.id}>
          <p>
            {entry.responded_by_role} {entry.response_action}ed
            {entry.is_reversal && ' (REVERSAL)'}
          </p>
          <p>{entry.response_notes}</p>
          <p>{new Date(entry.created_at).toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
};
```

## Permission Levels

### Full Permission
- **Roles**: owner, co_founder, board_member, manager
- **Can**: Approve, reject, reverse any response
- **Use case**: Organization leadership

### Limited Permission
- **Roles**: employee, technician, contractor
- **Can**: Approve, reject (cannot reverse)
- **Use case**: Staff who perform work

### View Only
- **Roles**: contributor
- **Can**: View notifications only
- **Use case**: General contributors

## Notification Flow

```
1. Work match found (≥90% probability)
   ↓
2. create_work_approval_notification() called
   ↓
3. Notification created for org members
   ↓
4. User sees notification in inbox
   ↓
5. User responds (approve/reject)
   ↓
6. Response recorded in history
   ↓
7. Work match updated
   ↓
8. If approved: Work contribution auto-created
   ↓
9. If incorrect: Owner/manager can reverse
   ↓
10. Reversal recorded in history
```

## Example

**Scenario**: Upholstery work detected at 707 Yucca, 99% match to Ernies Upholstery

1. **Notification created**:
   ```
   Title: "Work Approval Request: upholstery on 1977 Chevrolet K5 Blazer"
   Message: "Did you perform upholstery work on this 1977 Chevrolet K5 Blazer around 2024-09-15? Match confidence: 99%"
   ```

2. **Sent to**: Ernies Upholstery owners/managers

3. **User responds**: "Approve" with notes "Yes, we reupholstered the seats"

4. **Result**:
   - Work contribution created
   - Linked to Ernies Upholstery
   - Vehicle owner sees work in history

5. **If incorrect**: Owner can reverse and reject

## Benefits

1. **Automatic attribution**: Work automatically attributed to right organization
2. **Permission-based**: Only authorized users can respond
3. **Reversible**: Mistakes can be corrected
4. **Audit trail**: Complete history of all responses
5. **Linked data**: All notifications linked to vehicles and organizations

