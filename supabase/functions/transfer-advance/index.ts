/**
 * transfer-advance
 *
 * Ingests incoming signals (email, SMS, platform events, manual advances)
 * and advances transfer milestones accordingly.
 *
 * Uses AI to classify free-form text against the milestone vocabulary.
 *
 * Actions:
 *   advance_manual      — directly advance a named milestone
 *   ingest_signal       — AI classifies signal → advances milestone
 *   ingest_email        — parse email webhook payload → classify → advance
 *   ingest_sms          — parse SMS webhook payload → classify → advance
 *   get_next_milestone  — what's the next pending required milestone?
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

// Human-readable descriptions for AI classification
const MILESTONE_DESCRIPTIONS: Record<string, string> = {
  agreement_reached:       'Buyer and seller have agreed on price and terms',
  contact_exchanged:       'Buyer and seller have exchanged personal contact info (email, phone)',
  discussion_complete:     'All pre-sale discussions, Q&A complete',
  contract_drafted:        'A purchase/sale contract has been drafted',
  contract_signed_seller:  'Seller has signed the purchase agreement',
  contract_signed_buyer:   'Buyer has signed the purchase agreement',
  deposit_triggered:       'Deposit payment has been requested or invoiced',
  deposit_sent:            'Buyer has sent the deposit payment',
  deposit_received:        'Seller has received the deposit',
  deposit_confirmed:       'Deposit payment has cleared and been confirmed',
  full_payment_triggered:  'Full/final payment has been requested or invoiced',
  full_payment_sent:       'Buyer has sent the full/final payment',
  full_payment_received:   'Seller has received the full payment',
  payment_confirmed:       'Full payment has cleared and been confirmed',
  inspection_scheduled:    'A pre-purchase inspection has been scheduled',
  inspection_live:         'Inspection is currently in progress',
  inspection_completed:    'Pre-purchase inspection has been completed',
  insurance_triggered:     'Buyer has been asked to provide proof of insurance',
  insurance_confirmed:     'Buyer has provided confirmed proof of insurance',
  title_sent:              'Seller has sent the title document',
  title_in_transit:        'Title is in transit to the buyer',
  title_received:          'Buyer has received the title',
  shipping_requested:      'Shipping/transport for the vehicle has been requested',
  shipping_initiated:      'Vehicle has been picked up by transport carrier',
  vehicle_arrived:         'Vehicle has arrived at buyer\'s location',
  transfer_complete:       'Transfer is fully complete — title received, vehicle delivered, all obligations met',
  obligations_defined:     'All obligations (reconditioning, extras) have been agreed upon',
  obligation_met:          'A specific obligation has been fulfilled',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case 'advance_manual':
        return await advanceManual(supabase, body);
      case 'ingest_signal':
        return await ingestSignal(supabase, body);
      case 'ingest_email':
        return await ingestEmail(supabase, body);
      case 'ingest_sms':
        return await ingestSms(supabase, body);
      case 'get_next_milestone':
        return await getNextMilestone(supabase, body);
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error('[transfer-advance] error:', err);
    return json({ error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// advance_manual
// Directly mark a specific milestone as completed. No AI needed.
// ---------------------------------------------------------------------------
async function advanceManual(supabase: ReturnType<typeof createClient>, body: {
  transfer_id: string;
  milestone_type: string;
  completed_at?: string;
  completed_by_user_id?: string;
  notes?: string;
  evidence_id?: string;
}) {
  const { transfer_id, milestone_type, notes, evidence_id } = body;
  if (!transfer_id || !milestone_type) {
    return json({ error: 'transfer_id and milestone_type required' }, 400);
  }

  const completed_at = body.completed_at ?? new Date().toISOString();

  const { data, error } = await supabase
    .from('transfer_milestones')
    .update({
      status: 'completed',
      completed_at,
      completed_by_user_id: body.completed_by_user_id ?? null,
      notes: notes ?? null,
      evidence_id: evidence_id ?? null,
    })
    .eq('transfer_id', transfer_id)
    .eq('milestone_type', milestone_type)
    .select()
    .single();

  if (error) return json({ error: String(error) }, 500);

  // Advance transfer status to in_progress if still pending
  await supabase
    .from('ownership_transfers')
    .update({ status: 'in_progress' })
    .eq('id', transfer_id)
    .eq('status', 'pending');

  // If this is the final milestone, mark transfer complete
  if (milestone_type === 'transfer_complete') {
    await supabase
      .from('ownership_transfers')
      .update({ status: 'completed', completed_at })
      .eq('id', transfer_id);
  }

  return json({ milestone: data, advanced: true });
}

// ---------------------------------------------------------------------------
// ingest_signal
// AI classifies free-form text signal → identifies which milestone(s) to advance.
// ---------------------------------------------------------------------------
async function ingestSignal(supabase: ReturnType<typeof createClient>, body: {
  transfer_id: string;
  signal_type: 'email' | 'sms' | 'platform_event' | 'manual' | 'document';
  signal_text: string;
  signal_metadata?: Record<string, unknown>;
  signal_source?: string;
  signal_at?: string;
  user_id?: string;
  existing_comm_id?: string; // pass to avoid double-storing when called from ingest_email/ingest_sms
}) {
  const { transfer_id, signal_type, signal_text, signal_metadata, signal_at, user_id, existing_comm_id } = body;
  if (!transfer_id || !signal_text) {
    return json({ error: 'transfer_id and signal_text required' }, 400);
  }

  // Get current transfer state
  const { data: transfer } = await supabase
    .from('ownership_transfers')
    .select('*, milestones:transfer_milestones(*)')
    .eq('id', transfer_id)
    .single();

  if (!transfer) return json({ error: 'Transfer not found' }, 404);

  // Get pending milestones — show all non-done milestones up to 15, prioritizing required ones
  const allPending = (transfer.milestones ?? [])
    .filter((m: { status: string }) => m.status !== 'completed' && m.status !== 'skipped')
    .sort((a: { sequence: number }, b: { sequence: number }) => a.sequence - b.sequence);

  // Include required milestones first, then fill with optional ones up to 15
  const required = allPending.filter((m: { required: boolean }) => m.required).slice(0, 15);
  const optional = allPending.filter((m: { required: boolean }) => !m.required).slice(0, 5);
  const pendingMilestones = [...required, ...optional]
    .sort((a: { sequence: number }, b: { sequence: number }) => a.sequence - b.sequence)
    .slice(0, 15);

  const pendingTypes = pendingMilestones.map((m: { milestone_type: string }) => m.milestone_type);

  // Classify signal with AI
  const classified = await classifySignal(signal_text, pendingTypes, transfer);

  // Store the communication record (skip if already stored by ingest_email/ingest_sms)
  let commId = existing_comm_id;
  if (!commId) {
    const { data: comm } = await supabase
      .from('transfer_communications')
      .insert({
        transfer_id,
        source: signal_type,
        direction: 'inbound',
        body_text: signal_text,
        received_at: signal_at ?? new Date().toISOString(),
        milestone_type_inferred: classified.milestone_type ?? null,
        ai_classification_confidence: classified.confidence ?? null,
        raw_metadata: signal_metadata ?? null,
      })
      .select('id')
      .single();
    commId = comm?.id;
  } else {
    // Update the existing record with classification results
    await supabase
      .from('transfer_communications')
      .update({
        milestone_type_inferred: classified.milestone_type ?? null,
        ai_classification_confidence: classified.confidence ?? null,
      })
      .eq('id', commId);
  }
  const comm = { id: commId };

  if (!classified.milestone_type) {
    return json({
      classified: false,
      reason: classified.reason,
      communication_id: comm?.id,
    });
  }

  // Advance the identified milestone
  // Note: evidence_id FKs to transfer_documents, not transfer_communications —
  // so we omit it here and link via linked_milestone_id on the communication instead.
  const advanceResult = await advanceManual(supabase, {
    transfer_id,
    milestone_type: classified.milestone_type,
    completed_at: signal_at ?? new Date().toISOString(),
    completed_by_user_id: user_id,
    notes: `Auto-advanced from ${signal_type}: ${classified.reason}`,
  });

  // Link communication → milestone
  if (comm?.id) {
    const { data: ms } = await supabase
      .from('transfer_milestones')
      .select('id')
      .eq('transfer_id', transfer_id)
      .eq('milestone_type', classified.milestone_type)
      .single();
    if (ms?.id) {
      await supabase
        .from('transfer_communications')
        .update({ linked_milestone_id: ms.id })
        .eq('id', comm.id);
    }
  }

  return json({
    classified: true,
    milestone_advanced: classified.milestone_type,
    confidence: classified.confidence,
    reason: classified.reason,
    communication_id: comm?.id,
  });
}

// ---------------------------------------------------------------------------
// ingest_email
// Parse email webhook (SendGrid, Postmark, etc.) and advance milestones.
// ---------------------------------------------------------------------------
async function ingestEmail(supabase: ReturnType<typeof createClient>, body: {
  transfer_id?: string;
  vehicle_id?: string;
  from_email: string;
  to_email: string;
  subject: string;
  body_text: string;
  body_html?: string;
  received_at?: string;
  attachments?: Array<{ filename: string; content_type: string; url?: string }>;
  raw?: Record<string, unknown>;
}) {
  const { from_email, subject, body_text, received_at, attachments } = body;

  // Resolve transfer_id from vehicle_id if not provided
  let transfer_id = body.transfer_id;
  if (!transfer_id && body.vehicle_id) {
    const { data } = await supabase
      .from('ownership_transfers')
      .select('id')
      .eq('vehicle_id', body.vehicle_id)
      .in('status', ['pending', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    transfer_id = data?.id;
  }

  if (!transfer_id) return json({ error: 'Could not resolve transfer_id' }, 400);

  const combinedText = `Subject: ${subject}\n\nFrom: ${from_email}\n\n${body_text}`;

  // Note any attachments in the text for better classification
  const attachmentNote = attachments?.length
    ? `\n\n[Attachments: ${attachments.map((a) => a.filename).join(', ')}]`
    : '';

  // Store communication with richer metadata
  const { data: comm } = await supabase
    .from('transfer_communications')
    .insert({
      transfer_id,
      source: 'email',
      direction: 'inbound',
      subject,
      body_text,
      from_address: from_email,
      to_address: body.to_email,
      received_at: received_at ?? new Date().toISOString(),
      has_attachments: (attachments?.length ?? 0) > 0,
      attachment_names: attachments?.map((a) => a.filename) ?? [],
    })
    .select('id')
    .single();

  // Classify and advance — pass existing comm_id to avoid double-storage
  return await ingestSignal(supabase, {
    transfer_id,
    signal_type: 'email',
    signal_text: combinedText + attachmentNote,
    signal_at: received_at,
    existing_comm_id: comm?.id,
  });
}

// ---------------------------------------------------------------------------
// ingest_sms
// Parse SMS webhook (Twilio, etc.) and advance milestones.
// ---------------------------------------------------------------------------
async function ingestSms(supabase: ReturnType<typeof createClient>, body: {
  transfer_id?: string;
  vehicle_id?: string;
  from_number: string;
  to_number: string;
  body_text: string;
  received_at?: string;
  media_urls?: string[];
}) {
  const { from_number, body_text, received_at } = body;

  let transfer_id = body.transfer_id;
  if (!transfer_id && body.vehicle_id) {
    const { data } = await supabase
      .from('ownership_transfers')
      .select('id')
      .eq('vehicle_id', body.vehicle_id)
      .in('status', ['pending', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    transfer_id = data?.id;
  }

  if (!transfer_id) return json({ error: 'Could not resolve transfer_id' }, 400);

  const mediaNote = body.media_urls?.length
    ? `\n[MMS media attached: ${body.media_urls.length} file(s)]`
    : '';

  const { data: comm } = await supabase
    .from('transfer_communications')
    .insert({
      transfer_id,
      source: 'sms',
      direction: 'inbound',
      body_text,
      from_address: from_number,
      to_address: body.to_number,
      received_at: received_at ?? new Date().toISOString(),
      has_attachments: (body.media_urls?.length ?? 0) > 0,
    })
    .select('id')
    .single();

  return await ingestSignal(supabase, {
    transfer_id,
    signal_type: 'sms',
    signal_text: `SMS from ${from_number}: ${body_text}${mediaNote}`,
    signal_at: received_at,
    existing_comm_id: comm?.id,
  });
}

// ---------------------------------------------------------------------------
// get_next_milestone
// Returns the next pending required milestone for a transfer.
// ---------------------------------------------------------------------------
async function getNextMilestone(supabase: ReturnType<typeof createClient>, body: {
  transfer_id: string;
}) {
  const { transfer_id } = body;
  if (!transfer_id) return json({ error: 'transfer_id required' }, 400);

  const { data: milestones } = await supabase
    .from('transfer_milestones')
    .select('*')
    .eq('transfer_id', transfer_id)
    .in('status', ['pending', 'in_progress', 'overdue'])
    .order('sequence', { ascending: true })
    .limit(1);

  const next = milestones?.[0] ?? null;
  return json({
    next_milestone: next,
    description: next ? MILESTONE_DESCRIPTIONS[next.milestone_type] : null,
  });
}

// ---------------------------------------------------------------------------
// AI signal classifier
// Identifies which milestone a signal text is evidence of.
// Returns null if no confident match.
// ---------------------------------------------------------------------------
async function classifySignal(
  signalText: string,
  pendingMilestoneTypes: string[],
  transfer: Record<string, unknown>,
): Promise<{ milestone_type: string | null; confidence: number; reason: string }> {
  if (!pendingMilestoneTypes.length) {
    return { milestone_type: null, confidence: 0, reason: 'No pending milestones' };
  }

  const milestoneList = pendingMilestoneTypes
    .map((t) => `- ${t}: ${MILESTONE_DESCRIPTIONS[t] ?? t}`)
    .join('\n');

  const prompt = `You are classifying a communication in a vehicle ownership transfer.

Current transfer: vehicle sale, agreed price $${transfer.agreed_price ?? 'unknown'}

Pending milestones (in order):
${milestoneList}

Communication to classify:
"""
${signalText.slice(0, 2000)}
"""

Which single milestone does this communication most clearly provide evidence of completing?
If none clearly apply, return null.

Respond with JSON only:
{
  "milestone_type": "<type from list above or null>",
  "confidence": <0-100>,
  "reason": "<one sentence explanation>"
}`;

  try {
    // Try Anthropic first, fall back to OpenAI
    if (ANTHROPIC_API_KEY) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 256,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await res.json();
      const text = data.content?.[0]?.text ?? '{}';
      const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
      return {
        milestone_type: parsed.milestone_type ?? null,
        confidence: parsed.confidence ?? 0,
        reason: parsed.reason ?? '',
      };
    } else if (OPENAI_API_KEY) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 256,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(text);
      return {
        milestone_type: parsed.milestone_type ?? null,
        confidence: parsed.confidence ?? 0,
        reason: parsed.reason ?? '',
      };
    }
  } catch (err) {
    console.error('[transfer-advance] AI classification error:', err);
  }

  // Fallback: keyword heuristic (no AI available)
  return keywordFallback(signalText, pendingMilestoneTypes);
}

// Simple keyword-based fallback when no AI key available
function keywordFallback(
  text: string,
  pendingTypes: string[],
): { milestone_type: string | null; confidence: number; reason: string } {
  const t = text.toLowerCase();

  const KEYWORDS: Array<[string, string[]]> = [
    ['contact_exchanged',      ['my email', 'my phone', 'reach me at', 'contact me', 'text me']],
    ['deposit_sent',           ['sent the deposit', 'wire sent', 'payment sent', 'zelle sent', 'venmo sent']],
    ['deposit_received',       ['deposit received', 'received your deposit', 'got the deposit']],
    ['deposit_confirmed',      ['deposit cleared', 'deposit confirmed', 'funds cleared']],
    ['full_payment_sent',      ['sent the full', 'wire sent', 'final payment sent', 'paid in full']],
    ['full_payment_received',  ['full payment received', 'received your payment', 'got the funds']],
    ['payment_confirmed',      ['payment confirmed', 'funds confirmed', 'all clear', 'cleared']],
    ['inspection_scheduled',   ['inspection scheduled', 'ppi scheduled', 'inspector coming', 'inspection set']],
    ['inspection_completed',   ['inspection complete', 'ppi done', 'inspection results', 'inspector report']],
    ['title_sent',             ['title sent', 'mailed the title', 'title in the mail', 'shipped title']],
    ['title_received',         ['title received', 'got the title', 'title arrived']],
    ['shipping_initiated',     ['picked up', 'carrier picked', 'on the truck', 'loaded up', 'driver has it']],
    ['vehicle_arrived',        ['car arrived', 'vehicle arrived', 'delivered', 'picked it up', 'it\'s here']],
    ['transfer_complete',      ['all done', 'transfer complete', 'deal closed', 'all squared away']],
  ];

  for (const [type, keywords] of KEYWORDS) {
    if (!pendingTypes.includes(type)) continue;
    if (keywords.some((kw) => t.includes(kw))) {
      return { milestone_type: type, confidence: 60, reason: `Keyword match for "${type}"` };
    }
  }

  return { milestone_type: null, confidence: 0, reason: 'No keyword match found' };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
