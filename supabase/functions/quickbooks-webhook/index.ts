/**
 * QuickBooks Webhook Handler
 *
 * Receives real-time notifications from QuickBooks when data changes.
 * Used to keep financial data in sync.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, intuit-signature',
};

const QUICKBOOKS_WEBHOOK_VERIFIER = Deno.env.get('QUICKBOOKS_WEBHOOK_VERIFIER');

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // Handle GET request for webhook verification
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const challenge = url.searchParams.get('challenge');

      // QuickBooks sends a challenge during setup - respond with verifier
      if (challenge) {
        return new Response(challenge, {
          headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
        });
      }

      // Return verifier token for manual verification
      return new Response(QUICKBOOKS_WEBHOOK_VERIFIER || 'VERIFIER_NOT_SET', {
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
      });
    }

    // Handle POST - actual webhook events
    if (req.method === 'POST') {
      const signature = req.headers.get('intuit-signature');
      const payload = await req.text();

      // Verify signature (HMAC-SHA256 of payload with verifier token)
      if (QUICKBOOKS_WEBHOOK_VERIFIER && signature) {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          'raw',
          encoder.encode(QUICKBOOKS_WEBHOOK_VERIFIER),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        );
        const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
        const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(sig)));

        if (signature !== expectedSignature) {
          console.warn('Invalid webhook signature');
          // Still return 200 to prevent retries, but log the issue
        }
      }

      const data = JSON.parse(payload);

      // Log webhook event
      console.log('QuickBooks webhook received:', JSON.stringify(data, null, 2));

      // Process each notification
      for (const notification of data.eventNotifications || []) {
        const realmId = notification.realmId;
        const events = notification.dataChangeEvent?.entities || [];

        for (const event of events) {
          // Log to audit table
          await supabase.from('compliance_audit_log').insert({
            action_type: 'quickbooks_webhook',
            entity_type: event.name,
            entity_id: event.id,
            action_description: `QuickBooks ${event.operation}: ${event.name} #${event.id}`,
            previous_state: null,
            new_state: {
              realm_id: realmId,
              operation: event.operation,
              last_updated: event.lastUpdated
            },
            checksum: await generateChecksum({
              event,
              realmId,
              timestamp: new Date().toISOString()
            }),
          });

          // Handle specific entity types
          switch (event.name) {
            case 'Invoice':
            case 'Payment':
            case 'Bill':
            case 'Expense':
              // Flag that financials need refresh
              await supabase
                .from('parent_company')
                .update({
                  updated_at: new Date().toISOString(),
                  // Could add a 'financials_stale' flag here
                })
                .eq('quickbooks_realm_id', realmId);
              break;

            case 'Company':
              // Company info changed - may need to update our records
              console.log('Company info changed in QuickBooks');
              break;
          }
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders
    });

  } catch (error) {
    console.error('Webhook error:', error);
    // Always return 200 to prevent QuickBooks from retrying
    return new Response(JSON.stringify({
      received: true,
      error: error.message
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function generateChecksum(data: any): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(JSON.stringify(data));
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
