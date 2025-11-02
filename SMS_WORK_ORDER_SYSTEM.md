# SMS Work Order System - Twilio Integration

## ✅ Phase 1: COMPLETE - Labor Rate Setting
- ✅ Labor rate editor modal for shop owners
- ✅ Display labor rate on organization profile
- ✅ Database column: `businesses.labor_rate`

## ✅ Phase 2: COMPLETE - Work Order Submission (Web UI)
- ✅ Work orders database schema (`work_orders`, `work_order_status_history`)
- ✅ Status workflow: `pending` → `quoted` → `approved` → `scheduled` → `in_progress` → `completed` → `paid`
- ✅ "Request Work" button on organization profiles
- ✅ Work order submission form (title, description, urgency, vehicle, contact info)
- ✅ Automatic estimate calculation based on labor rate
- ✅ Status history tracking (audit trail)

## 🚧 Phase 3: SMS-to-Work-Order (Twilio Integration)

### Customer Journey:
1. Customer texts Twilio number: "Need upholstery repair on my 1977 K5 Blazer. Torn seats."
2. System creates work order with `status='pending'`, `request_source='sms'`
3. Shop owner receives notification + sees work order in dashboard
4. Shop owner replies via SMS or web: "I can do that for $450. Quote valid for 7 days."
5. System updates work order to `status='quoted'`, sends quote to customer via SMS
6. Customer replies: "Approved. When can I schedule?"
7. System updates to `status='approved'`, shop owner schedules via web or SMS
8. System updates to `status='scheduled'`, sends confirmation SMS with date/time
9. Work completes, system tracks actual hours/costs, updates to `completed`
10. Payment processed, updates to `paid`

### Technical Implementation:

#### 1. Twilio Setup
```bash
# Install Twilio SDK
npm install twilio @twilio/conversations
```

#### 2. Twilio Phone Number Configuration
- Purchase Twilio phone number
- Configure webhook for incoming SMS: `https://n-zero.dev/api/sms/incoming`
- Enable two-way SMS conversations

#### 3. Supabase Edge Function: `sms-work-order-handler`
```typescript
// /supabase/functions/sms-work-order-handler/index.ts
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

// Handles incoming SMS messages
Deno.serve(async (req: Request) => {
  const formData = await req.formData();
  const from = formData.get('From'); // Customer phone number
  const body = formData.get('Body'); // SMS text
  const to = formData.get('To');     // Shop's Twilio number

  // 1. Find organization by Twilio number
  const org = await supabase
    .from('businesses')
    .select('*')
    .eq('twilio_phone_number', to)
    .single();

  // 2. Parse SMS with AI (GPT-4) to extract:
  //    - Work description
  //    - Vehicle info (year, make, model)
  //    - Urgency
  //    - Customer name
  const aiParsed = await parseWorkOrderFromSMS(body);

  // 3. Create work order
  const { data: workOrder } = await supabase
    .from('work_orders')
    .insert({
      organization_id: org.id,
      customer_phone: from,
      title: aiParsed.title,
      description: aiParsed.description,
      urgency: aiParsed.urgency,
      request_source: 'sms',
      original_sms_body: body,
      status: 'pending'
    })
    .select()
    .single();

  // 4. Create Twilio conversation for two-way messaging
  const twilioClient = twilio(twilioAccountSid, twilioAuthToken);
  const conversation = await twilioClient.conversations.v1.conversations.create({
    friendlyName: `Work Order #${workOrder.id.slice(0, 8)}`
  });

  await workOrder.update({ sms_conversation_id: conversation.sid });

  // 5. Send confirmation SMS to customer
  await twilioClient.messages.create({
    to: from,
    from: to,
    body: `Work order received! ${org.business_name} will review and send a quote shortly. Order #${workOrder.id.slice(0, 8)}`
  });

  // 6. Notify shop owner (push notification + email)
  await notifyShopOwner(org.id, workOrder);

  return new Response('OK', { status: 200 });
});
```

#### 4. Database Schema Updates
```sql
-- Add Twilio fields to businesses table
ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS twilio_phone_number TEXT,
ADD COLUMN IF NOT EXISTS twilio_account_sid TEXT,
ADD COLUMN IF NOT EXISTS twilio_auth_token TEXT,
ADD COLUMN IF NOT EXISTS sms_notifications_enabled BOOLEAN DEFAULT true;

-- Add SMS tracking to work_orders (already in schema)
-- - sms_conversation_id: Twilio conversation SID
-- - original_sms_body: Original customer text
-- - request_source: 'sms'

-- SMS message history table
CREATE TABLE IF NOT EXISTS work_order_sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  body TEXT NOT NULL,
  direction TEXT CHECK (direction IN ('inbound', 'outbound')),
  twilio_sid TEXT UNIQUE,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 5. Shop Owner SMS Reply Flow
- Shop owner can reply via web dashboard or SMS
- Replies are sent via Twilio Conversations API
- System parses replies for:
  - Quotes: "I can do that for $X"
  - Scheduling: "Can you come in on Friday at 2pm?"
  - Updates: "We're starting work now"
  - Completion: "Work is done! Total: $X"

#### 6. AI SMS Parser (OpenAI)
```typescript
async function parseWorkOrderFromSMS(smsBody: string) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `Extract work order details from customer SMS. Return JSON:
{
  "title": "Brief summary (e.g. Upholstery repair)",
  "description": "Full description from SMS",
  "urgency": "low|normal|high|emergency",
  "vehicleInfo": "Year Make Model if mentioned",
  "customerName": "Name if mentioned"
}`
      }, {
        role: 'user',
        content: smsBody
      }],
      response_format: { type: 'json_object' }
    })
  });
  
  const aiResult = await response.json();
  return JSON.parse(aiResult.choices[0].message.content);
}
```

#### 7. Work Order Dashboard for Shop Owners
- `/org/:id/work-orders` - New page showing:
  - Pending requests (needs quote)
  - Quoted (awaiting customer approval)
  - Approved (needs scheduling)
  - Scheduled (upcoming work)
  - In Progress (current jobs)
  - Completed (awaiting payment)
  - Paid (history)
- Quick actions:
  - Send quote via SMS
  - Approve/reject
  - Schedule
  - Mark complete
  - Two-way SMS conversation view

#### 8. Environment Variables Needed
```env
TWILIO_ACCOUNT_SID=ACxxx...
TWILIO_AUTH_TOKEN=xxx...
TWILIO_PHONE_NUMBER=+1234567890
OPENAI_API_KEY=sk-xxx... (already have)
```

### Cost Estimates (Twilio):
- Phone number: ~$1/month
- SMS (USA): $0.0079 per message
- Example: 100 work orders/month with 5 SMS each = 500 messages = ~$4/month

### Next Steps:
1. Set up Twilio account
2. Purchase phone number
3. Create `sms-work-order-handler` edge function
4. Add SMS fields to `businesses` table
5. Build shop owner work order dashboard
6. Test SMS → work order → quote → approval flow
7. Deploy to production

### Alternative: Simpler "SMS Forwarding" Version
Instead of full Twilio conversations, could start with:
1. Customer texts shop's Twilio number
2. Twilio forwards SMS to email
3. Shop owner replies via email → converted to SMS
4. Work order created manually via web form

This is cheaper but less automated.

---

## Current Status:
- ✅ Phase 1 & 2 deployed to production
- 🚧 Phase 3 ready for implementation (requires Twilio account setup)

**Test the current system:**
- Visit Ernie's Upholstery: `https://n-zero.dev/org/e796ca48-f3af-41b5-be13-5335bb422b41`
- Click "Request Work" to submit a work order
- Shop owner can set labor rate via "Set Labor Rate" button

