# API Access Payment System

## Overview

Users pay for platform access, then use their own API keys (OpenAI, Anthropic, Google Gemini) for AI analysis. This way:
- **Users pay you** for access to the platform
- **Users use their own API keys** - you don't pay for their API usage
- Platform tracks usage and billing

## How It Works

### 1. User Subscribes
- User pays for monthly subscription ($29.99/month) or prepaid credits
- Payment processed via Stripe
- Subscription stored in `api_access_subscriptions` table

### 2. User Adds API Keys
- User adds their own API keys in Settings → AI Providers
- Supported providers:
  - **OpenAI** (GPT-4o, GPT-4o-mini, etc.)
  - **Anthropic** (Claude 3 Haiku, Sonnet, etc.)
  - **Google Gemini** (Gemini Pro, Gemini Flash, etc.)
- Keys stored encrypted in `user_ai_providers` table

### 3. Edge Functions Use User Keys
- When processing images, edge functions:
  1. Check if user has active subscription
  2. Get user's API key for the provider
  3. Use user's key if available
  4. Fallback to system key if user doesn't have one
  5. Track usage in `api_usage_logs`

## Database Schema

### `api_access_subscriptions`
Tracks user subscriptions:
- `subscription_type`: 'monthly', 'prepaid_credits', 'pay_as_you_go'
- `status`: 'active', 'cancelled', 'expired', 'past_due'
- `credits_remaining`: For prepaid subscriptions
- `monthly_limit`: For monthly subscriptions (e.g., 1000 images/month)

### `api_usage_logs`
Tracks all API usage:
- `provider`: 'openai', 'anthropic', 'google'
- `function_name`: Which edge function was called
- `cost_cents`: Cost in cents
- `success`: Whether the call succeeded

### `user_ai_providers`
User-provided API keys:
- `provider`: 'openai', 'anthropic', 'google', 'gemini'
- `api_key_encrypted`: Encrypted API key
- `model_name`: Which model to use (e.g., 'gpt-4o', 'claude-3-haiku')

## Subscription Plans

### Monthly Subscription
- **Price**: $29.99/month
- **Includes**: 1,000 AI image analyses per month
- **Recurring**: Yes (auto-renews)

### Prepaid Credits
- **100 Images**: $4.99 (no expiration)
- **500 Images**: $19.99 (no expiration)
- **1,000 Images**: $34.99 (no expiration)

## Edge Function Updates

All edge functions that use AI APIs now:
1. Accept `user_id` parameter
2. Check for active subscription
3. Get user's API key via `getUserApiKey()` helper
4. Use user's key if available, fallback to system key
5. Log usage to `api_usage_logs`

### Updated Functions
- `analyze-image-tier1` - Uses Anthropic (Claude)
- `analyze-image` - Uses OpenAI (GPT-4o)
- `intelligent-work-detector` - Uses OpenAI
- More functions can be updated as needed

## Frontend Integration

### Subscription Checkout
```typescript
// Create checkout session
const { data } = await supabase.functions.invoke('create-api-access-checkout', {
  body: {
    subscription_type: 'monthly', // or 'prepaid_100', 'prepaid_500', 'prepaid_1000'
    success_url: window.location.origin + '/settings?api_access=success',
    cancel_url: window.location.origin + '/settings?api_access=cancelled'
  }
})

// Redirect to Stripe checkout
window.location.href = data.checkout_url
```

### Adding API Keys
Users can add their API keys in Settings → AI Providers:
- OpenAI API key
- Anthropic API key
- Google Gemini API key

## Webhook Handler

The `stripe-webhook` function handles:
- `checkout.session.completed` events
- Creates/updates `api_access_subscriptions`
- For monthly subscriptions: Creates Stripe subscription
- For prepaid credits: Adds credits to account

## Usage Tracking

Every API call is logged to `api_usage_logs`:
- User ID
- Provider used
- Function called
- Cost in cents
- Success/failure
- Timestamp

This allows:
- Billing reconciliation
- Usage analytics
- Cost tracking per user

## Security

- API keys stored encrypted in database
- RLS policies ensure users can only see their own keys
- Edge functions use service role to access keys
- Keys decrypted only when needed for API calls

## Next Steps

1. ✅ Database schema created
2. ✅ Stripe checkout function created
3. ✅ Webhook handler updated
4. ✅ Edge functions updated to use user keys
5. ⏳ Frontend UI for subscription management
6. ⏳ Frontend UI for API key management
7. ⏳ Usage dashboard for users

