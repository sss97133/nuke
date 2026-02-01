import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import OpenAI from 'https://esm.sh/openai@4.20.1';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const openAiKey = Deno.env.get('OPENAI_API_KEY');

if (!supabaseUrl || !serviceRoleKey || !openAiKey) {
  throw new Error('Missing required environment variables for profile-image-analyst function');
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const openai = new OpenAI({ apiKey: openAiKey });

interface ImageReference {
  id: string;
  url: string;
  takenAt?: string | null;
  description?: string | null;
}

interface InsightBatch {
  batchId: string;
  vehicleId: string | null;
  vehicleName?: string | null;
  userId: string;
  date: string;
  images: ImageReference[];
}

interface InsightResult {
  batchId: string;
  summary: string;
  conditionScore: number | null;
  conditionLabel: string | null;
  estimatedValueUsd: number | null;
  laborHours: number | null;
  confidence: number | null;
  keyFindings: Array<{ title: string; detail: string; severity?: string | null }>;
  recommendations: string[];
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { batches, model: requestedModel } = (await req.json()) as { batches?: InsightBatch[]; model?: string };

    if (!Array.isArray(batches) || batches.length === 0) {
      return jsonResponse({ results: [] });
    }

    const limitedBatches = batches.slice(0, 6); // safety cap per request
    const results: InsightResult[] = [];

    for (const batch of limitedBatches) {
      if (!batch.images || batch.images.length === 0) continue;

      const selectedImages = batch.images.slice(0, 8); // limit inference payload

      const prompt = buildPrompt(batch);
      const messageContent = buildMessageContent(prompt, selectedImages);

      const primaryModel = requestedModel || 'gpt-4o-mini';
      const fallbackModel = 'gpt-4o';
      let completion;
      try {
        completion = await openai.chat.completions.create({
          model: primaryModel,
          temperature: 0.15,
          messages: [
            {
              role: 'system',
              content: 'You are an elite automotive restoration expert and certified appraiser. '
                + 'You audit vehicle photos to determine work performed, craftsmanship quality, and value impact. '
                + 'ALWAYS respond with valid JSON only.'
            },
            {
              role: 'user',
              content: messageContent as any
            }
          ]
        });
      } catch (err) {
        console.warn('profile-image-analyst: primary model failed, trying fallback');
        completion = await openai.chat.completions.create({
          model: fallbackModel,
          temperature: 0.15,
          messages: [
            {
              role: 'system',
              content: 'You are an elite automotive restoration expert and certified appraiser. '
                + 'You audit vehicle photos to determine work performed, craftsmanship quality, and value impact. '
                + 'ALWAYS respond with valid JSON only.'
            },
            {
              role: 'user',
              content: messageContent as any
            }
          ]
        });
      }

      const output = completion.choices?.[0]?.message?.content?.trim();
      if (!output) {
        continue;
      }

      const parsed = safeJsonParse(output);
      if (!parsed) {
        console.warn('profile-image-analyst: Unable to parse output JSON, storing raw summary.');
        results.push({
          batchId: batch.batchId,
          summary: output,
          conditionScore: null,
          conditionLabel: null,
          estimatedValueUsd: null,
          laborHours: null,
          confidence: null,
          keyFindings: [],
          recommendations: []
        });
        continue;
      }

      const normalized: InsightResult = {
        batchId: batch.batchId,
        summary: parsed.summary ?? 'No summary provided',
        conditionScore: parsed.condition_rating?.score ?? parsed.condition_score ?? null,
        conditionLabel: parsed.condition_rating?.label ?? parsed.condition_label ?? null,
        estimatedValueUsd: parsed.estimated_value_impact?.amount_usd ?? parsed.estimated_value_usd ?? null,
        laborHours: parsed.estimated_labor_hours ?? parsed.labor_hours ?? null,
        confidence: parsed.confidence ?? null,
        keyFindings: Array.isArray(parsed.key_findings)
          ? parsed.key_findings.map((finding: any) => ({
              title: finding.title ?? 'Key Finding',
              detail: finding.detail ?? finding.description ?? '',
              severity: finding.severity ?? null
            }))
          : [],
        recommendations: Array.isArray(parsed.recommendations)
          ? parsed.recommendations
          : typeof parsed.recommendations === 'string'
            ? [parsed.recommendations]
            : []
      };

      // Promote checklist-derived critical states into findings if present
      const checklist = parsed.checklist || {};
      if (checklist.rolling_state === 'non_runner') {
        normalized.keyFindings.unshift({
          title: 'Non-runner',
          detail: 'Likely non-operational based on trailer/winch or missing drivetrain/engine.',
          severity: 'high'
        });
      }
      if (checklist.engine_present === false) {
        normalized.keyFindings.unshift({
          title: 'Engine missing',
          detail: 'No engine visible in provided photos.',
          severity: 'high'
        });
      }
      if (checklist.tires_state === 'flat' || checklist.tires_state === 'mixed') {
        normalized.keyFindings.push({
          title: 'Flat tires',
          detail: 'One or more tires appear flat; impacts transport/runner status.',
          severity: 'medium'
        });
      }

      await persistInsight(batch, normalized, parsed);
      results.push(normalized);
    }

    return jsonResponse({ results });
  } catch (error) {
    console.error('profile-image-analyst error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});

function jsonResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}

function buildPrompt(batch: InsightBatch): string {
  return [
    `Evaluate the following vehicle photo set and respond in JSON only.`,
    `Vehicle: ${batch.vehicleName || 'Unknown Vehicle'} (${batch.vehicleId ?? 'unlinked'})`,
    `Date: ${batch.date}`,
    `User ID: ${batch.userId}`,
    '',
    'You are a master auto appraiser and mechanic across all niches. Base opinions ONLY on observable facts in the photos and clearly state uncertainty.',
    '',
    'Checklist (fill booleans or enums from images; use "unknown" if not visible):',
    '- engine_present: boolean | "unknown"',
    '- drivetrain_present: boolean | "unknown"',
    '- tires_state: "inflated" | "flat" | "mixed" | "unknown"',
    '- on_trailer_or_winch: boolean | "unknown"',
    '- rolling_state: "runner" | "non_runner" | "unknown"',
    '- interior_complete: "complete" | "partial" | "stripped" | "unknown"',
    '- rust_severity: "none" | "light" | "moderate" | "heavy" | "unknown"',
    '- glass_complete: boolean | "unknown"',
    '- lights_present: boolean | "unknown"',
    '',
    'Scoring rubric (start 10, subtract):',
    '- engine_present = false → -4 to -7 depending on other cues; set rolling_state="non_runner".',
    '- on_trailer_or_winch = true → -2 to -3 unless show active driving.',
    '- tires_state = flat/mixed → -1 to -2.',
    '- drivetrain_present = false → -2 to -4.',
    '- interior = stripped → -1 to -2.',
    '- rust_severity = moderate/heavy → -2 to -4.',
    'If non_runner likely, cap condition ≤ 3/10. Always explain deductions in rationale.',
    '',
    'Also infer operations/parts installed if receipts or visual evidence suggest (steering wheel, seats, etc.).',
    '',
    'Return JSON using this schema:',
    '{',
    '  "summary": string,',
    '  "condition_rating": { "score": number, "label": string, "rationale": string },',
    '  "estimated_value_impact": { "amount_usd": number, "direction": "increase" | "decrease" | "unknown", "rationale": string },',
    '  "estimated_labor_hours": number,',
    '  "confidence": number (0-1),',
    '  "checklist": {',
    '    "engine_present": boolean | "unknown",',
    '    "drivetrain_present": boolean | "unknown",',
    '    "tires_state": "inflated" | "flat" | "mixed" | "unknown",',
    '    "on_trailer_or_winch": boolean | "unknown",',
    '    "rolling_state": "runner" | "non_runner" | "unknown",',
    '    "interior_complete": "complete" | "partial" | "stripped" | "unknown",',
    '    "rust_severity": "none" | "light" | "moderate" | "heavy" | "unknown",',
    '    "glass_complete": boolean | "unknown",',
    '    "lights_present": boolean | "unknown"',
    '  },',
    '  "key_findings": [ { "title": string, "detail": string, "severity": "low"|"medium"|"high" } ],',
    '  "recommendations": string[]',
    '}'
  ].join('\n');
}

function buildMessageContent(prompt: string, images: ImageReference[]) {
  // chat.completions vision format
  const content: any[] = [{ type: 'text', text: prompt }];
  images.forEach((image) => {
    content.push({ type: 'text', text: `Photo ${image.id}${image.takenAt ? ` captured ${image.takenAt}` : ''}` });
    content.push({ type: 'image_url', image_url: { url: image.url } });
  });
  return content;
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

async function persistInsight(batch: InsightBatch, insight: InsightResult, raw: unknown) {
  try {
    await supabase.from('profile_image_insights').upsert({
      batch_id: batch.batchId,
      vehicle_id: batch.vehicleId,
      vehicle_name: batch.vehicleName ?? null,
      summary_date: batch.date,
      user_id: batch.userId,
      summary: insight.summary,
      condition_score: insight.conditionScore,
      condition_label: insight.conditionLabel,
      estimated_value_usd: insight.estimatedValueUsd,
      labor_hours: insight.laborHours,
      confidence: insight.confidence,
      key_findings: insight.keyFindings,
      recommendations: insight.recommendations,
      image_ids: batch.images.map((img) => img.id),
      raw_response: raw,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'batch_id'
    });
  } catch (error) {
    console.warn('profile-image-analyst: failed to persist insight', error);
  }
}

