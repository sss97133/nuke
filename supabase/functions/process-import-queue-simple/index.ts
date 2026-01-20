import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { firecrawlScrape } from "../_shared/firecrawl.ts";

// Simple helpers for deterministic source-specific parsing
const UA = 'Mozilla/5.0 (compatible; NukeBot/1.0)';

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  return await res.text();
}

function extractBat(html: string, url: string) {
  // title: "LS6-Powered, Grand Sport-Style 1963 Chevrolet Corvette Coupe 6-Speed | Bring a Trailer"
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = (titleMatch?.[1] || '').replace(/\s*\|\s*Bring a Trailer.*$/i, '').trim();
  // year/make/model from title tokens
  const yearMatch = title.match(/(19|20)\d{2}/);
  const year = yearMatch ? parseInt(yearMatch[0]) : null;
  const rest = title.replace(yearMatch ? yearMatch[0] : '', '').trim();
  const parts = rest.split(/\s+/);
  const make = parts.length > 0 ? parts[0].replace(/[^A-Za-z0-9]/g, '') : '';
  const model = parts.slice(1).join(' ').trim();
  if (!year || !make || !model) throw new Error('BaT parse failed (core fields)');

  // current bid or sale price
  let price: number | null = null;
  const bidMatch = html.match(/Current Bid:\s*[^$]*\$([\d,]+)/i) || html.match(/Sold for\s*\$([\d,]+)/i);
  if (bidMatch) price = parseInt(bidMatch[1].replace(/,/g, ''), 10);

  // description: main content block text (fallback to title)
  let description = '';
  const descMatch = html.match(/<div[^>]+class="listing\-body"[^>]*>([\s\S]*?)<\/div>/i);
  if (descMatch) {
    description = descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (!description) description = title;

  // images from gallery JSON
  const images: string[] = [];
  const imgRe = /"full":"(https:[^"]+)"/g;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    images.push(m[1].replace(/\\u0026/g, '&'));
  }

  return { year, make, model, asking_price: price, mileage: null, description, images, source: 'Bring a Trailer' };
}

function extractKsl(html: string, url: string) {
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const rawTitle = (titleMatch?.[1] || '').replace(/\s*\|\s*KSL.*$/i, '').trim();
  // Try to pull year as leading token
  const yearMatch = rawTitle.match(/^(19|20)\d{2}/);
  const year = yearMatch ? parseInt(yearMatch[0]) : null;
  const rest = rawTitle.replace(yearMatch ? yearMatch[0] : '', '').trim();
  const parts = rest.split(/\s+/);
  const make = parts.length > 0 ? parts[0] : '';
  const model = parts.slice(1).join(' ').trim();
  if (!make || !model) throw new Error('KSL parse failed (core fields)');

  // Price
  let price: number | null = null;
  const priceMatch = html.match(/\$[\s]*([\d,]+)\s*<\/[^>]*price/i) || html.match(/itemprop="price"[^>]*content="([\d.]+)"/i);
  if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''), 10);

  // Mileage
  let mileage: number | null = null;
  const milMatch = html.match(/Mileage[^0-9]*([\d,]+)\s*miles?/i);
  if (milMatch) mileage = parseInt(milMatch[1].replace(/,/g, ''), 10);

  // Description
  let description = '';
  const descMatch = html.match(/<div[^>]+class="description"[^>]*>([\s\S]*?)<\/div>/i);
  if (descMatch) description = descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!description) description = rawTitle;

  // Images
  const images: string[] = [];
  const imgRe = /<img[^>]+src="(https:[^"]+)"[^>]*>/g;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    if (!m[1].includes('logo')) images.push(m[1]);
  }

  return { year, make, model, asking_price: price, mileage, description, images, source: 'cars.ksl.com' };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('🚀 Simple process-import-queue called');

    const supabase = createClient(
      (Deno.env.get('SUPABASE_URL') ?? '').trim(),
      (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim()
    );

    const { batch_size = 3, priority_only = true } = await req.json() || {};

    console.log(`📦 Processing batch of ${batch_size} items (priority_only: ${priority_only})`);

    // Get queue items
    let query = supabase
      .from('import_queue')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .limit(batch_size);

    if (priority_only) {
      query = query.gte('priority', 10);
    }

    const { data: queueItems, error: queueError } = await query;

    if (queueError) {
      throw new Error(`Queue fetch error: ${queueError.message}`);
    }

    if (!queueItems || queueItems.length === 0) {
      console.log('📭 No queue items to process');
      return new Response(JSON.stringify({
        success: true,
        processed: 0,
        message: 'No items in queue'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`📋 Found ${queueItems.length} items to process`);

    // Do Firecrawl + AI extraction directly in this function
    const processedItems = [];

    for (const item of queueItems) {
      console.log(`🔄 Processing: ${item.listing_url}`);

      try {
        // Best-effort: mark as processing (avoid repeat work)
        try {
          await supabase
            .from('import_queue')
            .update({ status: 'processing' })
            .eq('id', item.id)
            .eq('status', 'pending');
        } catch {
          // ignore
        }

        // Source-specific deterministic extraction first
        let vehicleData: any = null;
        let usedSourceSpecific = false;

        const urlStr = String(item.listing_url || '');
        if (urlStr.includes('bringatrailer.com')) {
          const html = await fetchHtml(urlStr);
          vehicleData = extractBat(html, urlStr);
          usedSourceSpecific = true;
        } else if (urlStr.includes('cars.ksl.com')) {
          const html = await fetchHtml(urlStr);
          vehicleData = extractKsl(html, urlStr);
          usedSourceSpecific = true;
        }

        // Step 1: Firecrawl extraction (generic) only if no source-specific path
        const firecrawlApiKey = (Deno.env.get('FIRECRAWL_API_KEY') ?? '').trim();
        if (!firecrawlApiKey) {
          throw new Error('FIRECRAWL_API_KEY not found');
        }

        if (!usedSourceSpecific) {
          const firecrawl = await firecrawlScrape(
            {
              url: item.listing_url,
              formats: ['markdown'],
              onlyMainContent: true,
              waitFor: 3000,
            },
            {
              apiKey: firecrawlApiKey,
              timeoutMs: 45000,
              maxAttempts: 3,
            }
          );

          const markdown = (firecrawl.data?.markdown || '').trim();
          if (!markdown) {
            // Include the normalized Firecrawl error (helps debug 401/402/429/etc.)
            throw new Error(firecrawl.error || 'Firecrawl returned no markdown');
          }

          console.log(`📄 Firecrawl extracted content for: ${item.listing_url}`);

          // Step 2: AI extraction with Claude
          const claudeApiKey = (
            Deno.env.get('NUKE_CLAUDE_API') ||
            Deno.env.get('anthropic_api_key') ||
            Deno.env.get('ANTHROPIC_API_KEY') ||
            ''
          ).trim();
          if (!claudeApiKey) {
            throw new Error('Claude API key not found');
          }

          const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': claudeApiKey,
              'Content-Type': 'application/json',
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: 'claude-3-haiku-20240307',
              max_tokens: 1000,
              messages: [{
                role: 'user',
                content: `Extract vehicle info from: ${item.listing_url}

Content: ${markdown.substring(0, 8000)}

Return JSON only:
{
  "year": number,
  "make": "string",
  "model": "string",
  "asking_price": number,
  "mileage": number,
  "description": "string"
}`
              }]
            })
          });

          if (!claudeResponse.ok) {
            throw new Error(`Claude ${claudeResponse.status}`);
          }

          const claudeData = await claudeResponse.json();
          const responseText = claudeData.content?.[0]?.text;

          if (!responseText) {
            throw new Error('No Claude response');
          }

          // Try strict JSON first; fallback to extracting first JSON object blob; otherwise construct minimal fallback
          vehicleData = null;
          const match = responseText.match(/\{[\s\S]*\}/);
          try {
            vehicleData = JSON.parse(responseText);
          } catch {
            if (match) {
              try {
                vehicleData = JSON.parse(match[0]);
              } catch {
                // ignore and fall through to minimal fallback
              }
            }
          }

          if (!vehicleData || typeof vehicleData !== 'object') {
            // Minimal fallback: keep blank (not fake) values; only reject if listing missing entirely
            vehicleData = {
              year: null,
              make: '',
              model: '',
              asking_price: null,
              mileage: null,
              description: (responseText || '').slice(0, 500)
            };
          }
        }

        // Ensure required fields are populated to satisfy DB NOT NULL constraints; use blanks, not fake strings
        vehicleData.make = vehicleData.make ?? '';
        vehicleData.model = vehicleData.model ?? '';

        if (!vehicleData.make || !vehicleData.model) {
          throw new Error('Missing core fields (make/model)');
        }

        console.log(`🤖 Extracted: ${vehicleData.year ?? 'n/a'} ${vehicleData.make} ${vehicleData.model}`);

        // Step 3: Save to database (manual de-dupe by discovery_url)
        let vehicleId: string | null = null;

        const { data: existingVehicle } = await supabase
          .from('vehicles')
          .select('id')
          .eq('discovery_url', item.listing_url)
          .maybeSingle();

        if (existingVehicle?.id) {
          vehicleId = existingVehicle.id;
          console.log(`ℹ️ Vehicle already exists for URL, reusing id ${vehicleId}`);
        } else {
          const { data: inserted, error: dbError } = await supabase
            .from('vehicles')
            .insert({
              year: vehicleData.year || null,
              make: vehicleData.make || null,
              model: vehicleData.model || null,
              asking_price: vehicleData.asking_price || null,
              mileage: vehicleData.mileage || null,
              description: vehicleData.description || null,
              discovery_url: item.listing_url,
              source: 'process_import_queue_simple',
              created_at: new Date().toISOString()
            })
            .select('id')
            .single();

          if (dbError) {
            const code = (dbError as any).code || '';
            const msg = (dbError as any).message || '';
            if (code === '23505' || msg.toLowerCase().includes('duplicate key')) {
              const { data: dupExisting, error: dupErr } = await supabase
                .from('vehicles')
                .select('id')
                .eq('discovery_url', item.listing_url)
                .maybeSingle();

              if (dupErr) {
                throw new Error(`DB duplicate fetch error: ${dupErr.message}`);
              }

              vehicleId = dupExisting?.id ?? null;
              console.log(`ℹ️ Duplicate URL; reused existing id ${vehicleId ?? 'unknown'}`);
            } else {
              throw new Error(`DB error: ${dbError.message}`);
            }
          } else {
            vehicleId = inserted.id;
            console.log(`💾 Vehicle saved: ID ${vehicleId}`);
          }
        }

        // Final safeguard: ensure we have an id associated
        if (!vehicleId) {
          const { data: fallbackVehicle, error: fallbackErr } = await supabase
            .from('vehicles')
            .select('id')
            .eq('discovery_url', item.listing_url)
            .maybeSingle();

          if (fallbackErr) {
            throw new Error(`DB fallback fetch error: ${fallbackErr.message}`);
          }

          vehicleId = fallbackVehicle?.id ?? null;
        }

        processedItems.push({
          id: item.id,
          url: item.listing_url,
          success: true,
          vehicleId
        });

        // Mark as complete (avoid reprocessing)
        await supabase
          .from('import_queue')
          .update({
            status: 'complete',
            raw_data: {
              ...(item.raw_data || {}),
              processed_at: new Date().toISOString(),
              vehicle_id: vehicleId,
            },
          })
          .eq('id', item.id);

      } catch (error: any) {
        console.error(`❌ Processing failed for ${item.listing_url}:`, error.message);
        processedItems.push({
          id: item.id,
          url: item.listing_url,
          success: false,
          error: error.message
        });

        // Mark as failed so we don't fail in a loop
        try {
          await supabase
            .from('import_queue')
            .update({
              status: 'failed',
              raw_data: {
                ...(item.raw_data || {}),
                failed_at: new Date().toISOString(),
                last_error: error?.message || String(error),
              },
            })
            .eq('id', item.id);
        } catch {
          // ignore
        }
      }
    }

    const successCount = processedItems.filter(item => item.success).length;

    console.log(`🎯 Batch complete: ${successCount}/${processedItems.length} successful`);

    return new Response(JSON.stringify({
      success: true,
      processed: processedItems.length,
      successful: successCount,
      items: processedItems
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('❌ Process queue error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});