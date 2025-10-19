# Clearing House Integration Guide

## Plug and Play Setup

When you get your clearing house partner, just update this file with their API details.

---

## What You Need From Them

1. **API Key** - Your authentication token
2. **API URL** - Their base endpoint (e.g., `https://api.clearinghouse.com/v1`)
3. **Webhook URL** - For payment confirmations
4. **Account ID** - Your merchant account number
5. **Documentation** - Their API docs

---

## Where to Add It

**File**: `nuke_frontend/src/services/paymentProvider.ts`

**Line 74**: Update `ClearingHouseProvider` class

### Replace These Lines:

```typescript
// Line 80-82: Add your keys
this.apiKey = apiKey || process.env.CLEARING_HOUSE_API_KEY || '';
this.apiUrl = apiUrl || process.env.CLEARING_HOUSE_API_URL || '';

// Line 88-102: Replace with their API
async createPaymentSession(params: PaymentParams): Promise<PaymentSession> {
  const response = await fetch(`${this.apiUrl}/create-payment`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount: params.amount,
      user_id: params.userId,
      payment_method: 'rtp', // or 'ach' or 'fednow'
      callback_url: params.successUrl
    })
  });

  const data = await response.json();
  
  return {
    sessionId: data.session_id,
    paymentUrl: data.payment_url,
    status: 'pending'
  };
}

// Line 117-127: Replace with their verify endpoint
async verifyPayment(sessionId: string): Promise<PaymentVerification> {
  const response = await fetch(`${this.apiUrl}/verify/${sessionId}`, {
    headers: { 'Authorization': `Bearer ${this.apiKey}` }
  });
  
  const data = await response.json();
  
  return {
    verified: data.status === 'completed',
    amount: data.amount,
    userId: data.user_id,
    transactionId: data.transaction_id
  };
}
```

---

## Environment Variables to Set

**In Supabase** (Edge Functions → Secrets):
```
CLEARING_HOUSE_API_KEY=your_api_key_here
CLEARING_HOUSE_API_URL=https://api.yourpartner.com/v1
CLEARING_HOUSE_ACCOUNT_ID=your_account_id
```

**In Vercel** (if needed frontend-side):
```
VITE_CLEARING_HOUSE_NAME=Your Partner Name
```

---

## Edge Function for Webhooks

**Create**: `supabase/functions/clearing-house-webhook/index.ts`

```typescript
Deno.serve(async (req) => {
  // Verify webhook signature (your clearing house method)
  const signature = req.headers.get('X-Clearing-House-Signature');
  const body = await req.text();
  
  // Verify signature matches
  if (!verifySignature(body, signature)) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event = JSON.parse(body);

  // Handle payment completed event
  if (event.type === 'payment.completed') {
    const { user_id, amount, transaction_id } = event.data;

    // Add credits to user
    const { createClient } = await import('jsr:@supabase/supabase-js@2');
    const supabase = createClient(
      Deno.env.get('PROJECT_URL')!,
      Deno.env.get('SERVICE_ROLE_KEY')!
    );

    await supabase.rpc('add_credits_to_user', {
      p_user_id: user_id,
      p_credits: amount
    });

    // Record transaction
    await supabase.from('credit_transactions').insert({
      user_id,
      amount,
      transaction_type: 'purchase',
      reference_id: transaction_id,
      metadata: { provider: 'clearing_house' }
    });
  }

  return new Response('OK');
});
```

---

## Fee Structure

**Update these based on your clearing house**:

**File**: `nuke_frontend/src/services/paymentProvider.ts`
**Line 69-71**:

```typescript
feePercent = 1.5;  // UPDATE: Your actual % fee
feeFixed = 4.5;    // UPDATE: Your actual fixed fee in cents
settlementTime = 'instant'; // UPDATE: 'instant', '1-2 hours', '1-2 days'
```

---

## Testing Checklist

When your clearing house partner is ready:

- [ ] Get API credentials
- [ ] Update `ClearingHouseProvider` class
- [ ] Set environment variables
- [ ] Deploy edge function
- [ ] Set up webhook endpoint
- [ ] Test $3 payment
- [ ] Test $100 payment
- [ ] Test payout to builder
- [ ] Monitor for failures

---

## Current Status

✅ **Code structure ready** - Just plug in API details
✅ **Abstraction layer** - Easy to swap providers
✅ **Multi-provider support** - Can offer crypto + bank + cards
✅ **Fee calculation** - Automatic per provider

⏳ **Waiting for**: Your clearing house API documentation

**Time to integrate**: 1-2 hours once you have their API docs


