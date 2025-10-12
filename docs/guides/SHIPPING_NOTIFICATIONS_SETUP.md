# Shipping Notification System Setup

## Overview
The shipping notification system allows responsible parties (like you) to keep vehicle buyers updated on shipping progress via SMS notifications using Twilio.

## Features
- **Automatic Status Updates**: Recipients get notified when shipping status changes (pending → in progress → completed)
- **Manual Updates**: Send custom messages to all active recipients
- **Buyer Priority**: Mark the actual buyer for special notifications
- **Multiple Recipients**: Add as many notification recipients as needed (buyer, broker, family members, etc.)
- **SMS & Email Support**: Choose notification method per recipient

## Database Setup
1. Apply the migration to create notification tables:
```bash
# Apply the notification migration
cd /Users/skylar/nuke
# Copy contents of supabase/migrations/20250920_shipping_notifications.sql
# Paste into Supabase SQL editor and run
```

## Twilio Configuration
1. **Get your Twilio credentials** from https://console.twilio.com
   - Account SID
   - Auth Token  
   - Phone Number (must be a Twilio number)

2. **Add to Supabase Edge Functions**:
   - Go to Supabase Dashboard → Edge Functions
   - Select `send-shipping-notification` function
   - Add these environment variables:
     - `TWILIO_ACCOUNT_SID`: Your Twilio Account SID
     - `TWILIO_AUTH_TOKEN`: Your Twilio Auth Token
     - `TWILIO_PHONE_NUMBER`: Your Twilio phone number (with country code, e.g., +12025551234)

3. **Deploy the Edge Function**:
```bash
supabase functions deploy send-shipping-notification
```

## Usage

### Adding Recipients
1. Go to any shipping task in your vehicle profile
2. Find the "Shipping Notifications" section below the task details
3. Click "Add Recipient"
4. Enter:
   - Name (e.g., "John - Buyer")
   - Phone number (with country code, e.g., +12025551234)
   - Email (optional)
   - Notification method (SMS, Email, or Both)
   - Check "This is the vehicle buyer" if applicable

### Sending Notifications
**Automatic**: When you change a task status (pending → in progress), all active recipients get notified automatically.

**Manual**: Use the text field at the bottom of the notification section to send custom updates like:
- "Vehicle loaded on truck, departing at 3pm"
- "Cleared customs, arriving at port tomorrow"
- "Delay due to weather, new ETA Friday"

### Example Workflow for Your St Barths Shipment

1. **Add the buyer as recipient**:
   - Name: [Buyer's name]
   - Phone: [Their phone with country code]
   - Check "This is the vehicle buyer"

2. **When truck picks up the vehicle**:
   - Change status to "In Progress"
   - Buyer gets automatic notification: "Shipping status updated to: in_progress for Enclosed carrier to Miami"
   - Send manual update: "1932 Roadster picked up by enclosed carrier, ETA Miami port tomorrow 4pm"

3. **When loaded on boat**:
   - Update the boat container task to "In Progress"
   - Send manual update: "Vehicle loaded in container #ABC123, vessel departs Miami tonight"

4. **At customs clearance**:
   - Send manual update: "Arrived St Barths, clearing customs today"

5. **Final delivery**:
   - Change to "Completed"
   - Send manual update: "Vehicle delivered to FBM Garage, ready for pickup"

## Testing
1. Add yourself as a recipient first to test
2. Send a test notification
3. Verify you receive the SMS
4. Then add the actual buyer

## Costs
- Twilio charges ~$0.0075 per SMS in the US
- International rates vary (check Twilio pricing)
- Consider informing buyer about message frequency

## Troubleshooting
- **SMS not sending**: Check Twilio credentials in Supabase Edge Functions
- **Phone number errors**: Ensure country code is included (+1 for US)
- **No notifications**: Check recipient is marked as "Active"
