/**
 * Vehicle Expert Agent - Comprehensive AI Valuation Pipeline
 * 
 * Follows the proper data pipeline:
 * 1. Research vehicle Y/M/M → Become instant expert
 * 2. Assemble literature (manuals, forums, market data)
 * 3. Assess images → Tally value
 * 4. Extract environmental data (5 W's)
 * 5. Generate comprehensive valuation with evidence
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getLLMConfig, callLLM, type LLMProvider, type AnalysisTier } from './_shared/llmProvider.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  Deno.env.get('SERVICE_ROLE_KEY') ??
  '';

// IMPORTANT: Avoid module-load crashes.
// If SUPABASE_URL / SERVICE_ROLE_KEY are missing or invalid in a deployment, createClient()
// can throw before our request handler runs. Keep it lazy + re-initializable.
let supabase: any = null;
const getSupabaseClient = () => {
  if (supabase) return supabase;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  return supabase;
};

interface VehicleContext {
  year: number;
  make: string;
  model: string;
  vin?: string;
  
  // Literature assembled
  buildManual?: string;
  serviceManual?: string;
  forumKnowledge?: string[];
  commonIssues?: string[];
  
  // Market intelligence
  marketSales: Array<{
    price: number;
    condition: string;
    date: string;
    source: string;
  }>;
  marketAverage: number;
  marketRange: { low: number; high: number };
  
  // Current state
  totalImages: number;
  photoDateRange: { earliest: string; latest: string };
}

interface ValuedComponent {
  name: string;
  partNumber?: string;
  condition: string;        // "Excellent", "Good", "Fair", "Poor"
  conditionGrade: number;   // 1-10
  estimatedValue: number;
  newPrice?: number;
  evidence: {
    imageUrls: string[];
    photoCount: number;
    location: string;       // "Front driver side", "Engine bay"
    datePhotographed: string;
  };
  confidence: number;
  reasoning: string;        // WHY this value
}

interface EnvironmentalContext {
  // From EXIF
  gpsLocations: Array<{ lat: number; lng: number; address?: string; count: number }>;
  cameraEquipment: string[];
  photoTimeline: Array<{ date: string; photoCount: number; location?: string }>;
  
  // From visual analysis
  workEnvironment: 'professional_shop' | 'home_garage' | 'driveway' | 'field' | 'storage';
  weatherConditions: string[];  // Seen in photos
  toolsVisible: string[];       // Professional vs DIY
  
  // 5 W's derived
  who: string[];       // Who worked on it (from environment clues)
  what: string[];      // What work was performed
  when: string;        // Timeline of work
  where: string;       // Where work happened
  why: string;         // Why (restoration, repair, modification)
}

interface ExpertValuation {
  vehicleContext: VehicleContext;
  components: ValuedComponent[];
  environmental: EnvironmentalContext;
  
  // Final assessment
  purchasePrice: number;
  documentedValue: number;      // Sum of components found
  estimatedTotalValue: number;  // Purchase + documented
  confidence: number;
  
  // Narrative explanation
  summary: string;
  valueJustification: string;   // WHY this value (answers the question)
  recommendations: string[];
  warnings: string[];
}

/**
 * CHAT MODE: Handle vehicle chat conversation where AI IS the vehicle
 */
async function handleChatMode(
  vehicleId: string,
  question: string,
  vehicleVin?: string,
  vehicleNickname?: string,
  vehicleYmm?: string,
  vehicleYear?: number,
  vehicleMake?: string,
  vehicleModel?: string,
  conversationHistory: Array<{ role: string; content: string }> = [],
  llmProvider?: string,
  llmModel?: string,
  analysisTier?: string,
  userId?: string
): Promise<Response> {
  try {
    // Deterministic "Cursor-like tools" for robustness:
    // - /context: show what evidence exists for this vehicle (docs, receipt-like images, timeline)
    // - /search <term>: search across vehicle_documents, receipt-like images, and timeline events
    const rawQuestion = String(question || '');
    const trimmedQuestion = rawQuestion.trim();
    const qLower = trimmedQuestion.toLowerCase();

    // Get LLM configuration
    let llmConfig: any | null = null;
    try {
      llmConfig = await getLLMConfig(
        supabase,
        userId || null,
        llmProvider,
        llmModel,
        // IMPORTANT: don't force a tier default here.
        // If analysisTier is omitted, allow preferred model/provider (or fallback order) to choose.
        (analysisTier as any) || undefined
      );
    } catch (cfgErr: any) {
      const msg = (cfgErr?.message || '').toString();
      if (msg.toLowerCase().includes('no llm provider available') || msg.toLowerCase().includes('no api keys')) {
        return new Response(
          JSON.stringify({
            skipped: true,
            reason: 'llm_unavailable',
            detail: msg || 'No LLM provider available',
            timestamp: new Date().toISOString()
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          }
        );
      }
      throw cfgErr;
    }
    
    // Get vehicle data
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id, year, make, model, vin, mileage, color, purchase_price, current_value')
      .eq('id', vehicleId)
      .single();
    
    if (vehicleError || !vehicle) {
      throw new Error(`Vehicle not found: ${vehicleId}`);
    }
    
    // Determine vehicle identity (nickname > YMM > VIN)
    const vehicleIdentity = vehicleNickname || 
                           vehicleYmm || 
                           (vehicleYear && vehicleMake && vehicleModel ? `${vehicleYear} ${vehicleMake} ${vehicleModel}` : null) ||
                           (vehicle.year && vehicle.make && vehicle.model ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : null) ||
                           vehicleVin || 
                           vehicle.vin || 
                           `Vehicle ${vehicleId.substring(0, 8)}`;
    
    // Gather vehicle history and context (service role reads; never assume empty)
    const { data: timelineEvents } = await supabase
      .from('timeline_events')
      .select('event_type, title, description, event_date, mileage_at_event, receipt_amount')
      .eq('vehicle_id', vehicleId)
      .order('event_date', { ascending: false })
      .limit(20);
    
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('id, category, taken_at')
      .eq('vehicle_id', vehicleId)
      .limit(5);

    // "Receipt-like" images (docs that were uploaded as images but not yet promoted to vehicle_documents).
    // This is critical so the agent doesn't incorrectly say "no receipts" when there are doc-flagged images.
    const { data: receiptLikeImages } = await supabase
      .from('vehicle_images')
      .select('id, caption, description, created_at, is_document, doc_flag, document_classification, document_category')
      .eq('vehicle_id', vehicleId)
      .or('is_document.eq.true,doc_flag.eq.true')
      .order('created_at', { ascending: false })
      .limit(25);
    
    // IMPORTANT: Use vehicle_documents as the source of truth for uploaded receipts/invoices/manuals.
    // The project has multiple receipt schemas across time; vehicle_documents is consistently written by SmartInvoiceUploader.
    const { data: vehicleDocs } = await supabase
      .from('vehicle_documents')
      .select('id, document_type, title, vendor_name, amount, currency, document_date, file_url, created_at')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false })
      .limit(30);

    const docs = Array.isArray(vehicleDocs) ? vehicleDocs : [];
    const receiptDocTypes = new Set(['receipt', 'invoice', 'service_record', 'parts_order']);
    const manualDocTypes = new Set(['manual']);
    const receiptDocs = docs.filter((d: any) => receiptDocTypes.has(String(d?.document_type || '').toLowerCase()));
    const manualDocs = docs.filter((d: any) => manualDocTypes.has(String(d?.document_type || '').toLowerCase()));

    const receiptLike = Array.isArray(receiptLikeImages) ? receiptLikeImages : [];

    // --- Deterministic tool responses ---
    const makeToolResponse = (payload: any) =>
      new Response(JSON.stringify(payload), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });

    const truncate = (s: unknown, max = 1400): string => {
      const str = typeof s === 'string' ? s : (() => { try { return JSON.stringify(s, null, 2); } catch { return String(s ?? ''); } })();
      if (!str) return '';
      if (str.length <= max) return str;
      return str.slice(0, Math.max(0, max - 20)) + '\n... (truncated)';
    };

    const isUuid = (v: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

    // /context: show evidence snapshot without calling LLM (fast + grounded)
    if (qLower === '/context' || qLower === 'context' || qLower === 'show context') {
      const vehicleIdentityForUi =
        vehicleNickname ||
        vehicleYmm ||
        (vehicleYear && vehicleMake && vehicleModel ? `${vehicleYear} ${vehicleMake} ${vehicleModel}` : null) ||
        (vehicle.year && vehicle.make && vehicle.model ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : null) ||
        vehicleVin ||
        vehicle.vin ||
        `Vehicle ${vehicleId.substring(0, 8)}`;

      return makeToolResponse({
        response: `Context snapshot for ${vehicleIdentityForUi}.`,
        ui: {
          text: `Context snapshot for ${vehicleIdentityForUi}.`,
          intent: 'other',
          cards: [
            {
              type: 'context_snapshot',
              vehicle: {
                id: vehicleId,
                identity: vehicleIdentityForUi,
                year: vehicle.year,
                make: vehicle.make,
                model: vehicle.model,
                vin: vehicle.vin || null
              },
              counts: {
                timeline_events_loaded: timelineEvents?.length || 0,
                vehicle_documents_loaded: docs.length,
                receipts_in_vehicle_documents: receiptDocs.length,
                manuals_in_vehicle_documents: manualDocs.length,
                receipt_like_images: receiptLike.length,
                recent_photos_loaded: images?.length || 0
              },
              recent_documents: docs.slice(0, 8).map((d: any) => ({
                ref: `vehicle_document:${d.id}`,
                document_type: d.document_type,
                title: d.title,
                vendor_name: d.vendor_name,
                amount: d.amount,
                currency: d.currency,
                document_date: d.document_date,
                file_url: d.file_url
              })),
              receipt_like_images: receiptLike.slice(0, 8).map((img: any) => ({
                ref: `vehicle_image:${img.id}`,
                classification: img.document_classification,
                category: img.document_category,
                caption: img.caption,
                created_at: img.created_at
              })),
              next_suggestions: [
                { id: 'search_vehicle', label: 'Search receipts/docs/images', payload: { suggested_user_text: '/search wiring' } },
                { id: 'upload_document', label: 'Upload receipt/manual', payload: { hint: 'Upload receipts/invoices/manual pinouts to improve accuracy.' } }
              ]
            }
          ]
        },
        vehicle_identity: vehicleIdentityForUi,
        context_used: {
          timeline_events: timelineEvents?.length || 0,
          receipts: receiptDocs.length,
          manuals: manualDocs.length,
          vehicle_documents: docs.length,
          receipt_like_images: receiptLike.length,
          images: images?.length || 0
        }
      });
    }

    // /search <term>: deterministic search across docs + receipt-like images + timeline events
    if (qLower.startsWith('/search')) {
      const term = trimmedQuestion.replace(/^\/search\s*/i, '').trim();
      if (!term) {
        return makeToolResponse({
          response: 'Usage: /search <term>',
          ui: {
            text: 'Usage: /search <term>',
            intent: 'other',
            cards: [
              {
                type: 'clarifying_questions',
                questions: [
                  'What should I search for? Example: /search motec, /search painless, /search fuel pump, /search invoice'
                ]
              }
            ]
          }
        });
      }

      const ilike = `%${term}%`;
      const { data: matchingDocs } = await supabase
        .from('vehicle_documents')
        .select('id, document_type, title, vendor_name, amount, currency, document_date, file_url, created_at')
        .eq('vehicle_id', vehicleId)
        .or(`title.ilike.${ilike},vendor_name.ilike.${ilike},document_type.ilike.${ilike}`)
        .order('created_at', { ascending: false })
        .limit(20);

      const { data: matchingImages } = await supabase
        .from('vehicle_images')
        .select('id, caption, description, created_at, is_document, doc_flag, document_classification, document_category')
        .eq('vehicle_id', vehicleId)
        .or(`caption.ilike.${ilike},description.ilike.${ilike},document_classification.ilike.${ilike},document_category.ilike.${ilike}`)
        .order('created_at', { ascending: false })
        .limit(20);

      const { data: matchingEvents } = await supabase
        .from('timeline_events')
        .select('id, event_type, title, description, event_date, receipt_amount')
        .eq('vehicle_id', vehicleId)
        .or(`title.ilike.${ilike},description.ilike.${ilike},event_type.ilike.${ilike}`)
        .order('event_date', { ascending: false })
        .limit(20);

      const docsRes = Array.isArray(matchingDocs) ? matchingDocs : [];
      const imgsRes = Array.isArray(matchingImages) ? matchingImages : [];
      const eventsRes = Array.isArray(matchingEvents) ? matchingEvents : [];

      return makeToolResponse({
        response: `Search results for "${term}".`,
        ui: {
          text: `Search results for "${term}".`,
          intent: 'other',
          cards: [
            {
              type: 'search_results',
              query: term,
              totals: { documents: docsRes.length, images: imgsRes.length, timeline_events: eventsRes.length },
              results: [
                ...docsRes.slice(0, 10).map((d: any) => ({
                  kind: 'vehicle_document',
                  ref: `vehicle_document:${d.id}`,
                  title: d.title || d.document_type,
                  subtitle: [d.document_type, d.vendor_name].filter(Boolean).join(' — '),
                  file_url: d.file_url || null
                })),
                ...imgsRes.slice(0, 10).map((img: any) => ({
                  kind: 'vehicle_image',
                  ref: `vehicle_image:${img.id}`,
                  title: img.caption || img.document_classification || img.document_category || 'Image',
                  subtitle: [
                    img.is_document || img.doc_flag ? 'doc-like' : null,
                    img.document_classification,
                    img.document_category
                  ].filter(Boolean).join(' — '),
                })),
                ...eventsRes.slice(0, 10).map((e: any) => ({
                  kind: 'timeline_event',
                  ref: `timeline_event:${e.id}`,
                  title: e.title || e.event_type || 'Event',
                  subtitle: e.event_date ? new Date(e.event_date).toLocaleDateString() : ''
                }))
              ].slice(0, 25),
              next_suggestions: [
                { id: 'upload_document', label: 'Upload receipt/manual', payload: { hint: 'Upload receipts/invoices/manual pinouts to improve accuracy.' } }
              ]
            }
          ]
        }
      });
    }

    // /open <ref>: open a specific source and show its structured contents (no LLM)
    if (qLower.startsWith('/open')) {
      const arg = trimmedQuestion.replace(/^\/open\s*/i, '').trim();
      if (!arg) {
        return makeToolResponse({
          response: 'Usage: /open <ref> (ex: /open vehicle_document:<uuid>, /open receipt:<uuid>, /open vehicle_image:<uuid>, /open timeline_event:<uuid>)',
          ui: {
            text: 'Usage: /open <ref>',
            intent: 'other',
            cards: [
              {
                type: 'clarifying_questions',
                questions: [
                  'Paste a reference like vehicle_document:<uuid>, receipt:<uuid>, vehicle_image:<uuid>, or timeline_event:<uuid>.',
                  'Tip: run /context or /search to find refs, then click attach/open in the UI.'
                ]
              }
            ]
          }
        });
      }

      const parts = arg.split(':');
      const kind = String(parts[0] || '').trim();
      const id = String(parts[1] || '').trim();
      if (!kind || !id || !isUuid(id)) {
        return makeToolResponse({
          response: 'Invalid ref. Expected: kind:uuid',
          ui: {
            text: 'Invalid ref. Expected: kind:uuid',
            intent: 'other',
            cards: [
              {
                type: 'clarifying_questions',
                questions: [
                  'Example: /open vehicle_document:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                  'Run /context to get valid refs for this vehicle.'
                ]
              }
            ]
          }
        });
      }

      // Helper: load a receipt + items by receipt id
      const loadReceipt = async (receiptId: string) => {
        const { data: r } = await supabase
          .from('receipts')
          .select('id, vendor_name, receipt_date, total, subtotal, tax, currency, payment_method, invoice_number, purchase_order, status, raw_json, created_at')
          .eq('id', receiptId)
          .single();

        const { data: items } = await supabase
          .from('receipt_items')
          .select('id, description, part_number, brand, category, quantity, unit_price, line_total, sku, upc, installation_status, installation_date, confidence_score, extracted_by_ai')
          .eq('receipt_id', receiptId)
          .order('created_at', { ascending: true })
          .limit(50);

        return { receipt: r || null, items: Array.isArray(items) ? items : [] };
      };

      // VEHICLE DOCUMENT
      if (kind === 'vehicle_document' || kind === 'vehicle_documents') {
        const { data: doc } = await supabase
          .from('vehicle_documents')
          .select('id, vehicle_id, uploaded_by, document_type, title, description, file_url, file_type, amount, vendor_name, currency, created_at, updated_at')
          .eq('id', id)
          .single();

        if (!doc) {
          return makeToolResponse({ response: 'Document not found.', ui: { text: 'Document not found.', intent: 'other', cards: [] } });
        }

        // Link to receipt rows created by ReceiptPersistService (source_document_table='vehicle_documents')
        const { data: linkedReceipt } = await supabase
          .from('receipts')
          .select('id')
          .eq('source_document_table', 'vehicle_documents')
          .eq('source_document_id', id)
          .limit(1)
          .maybeSingle();

        const receiptBundle = linkedReceipt?.id ? await loadReceipt(linkedReceipt.id) : { receipt: null, items: [] };

        return makeToolResponse({
          response: `Opened vehicle document ${id}.`,
          ui: {
            text: `Opened document: ${doc.title || doc.document_type || 'Document'}`,
            intent: 'other',
            cards: [
              {
                type: 'source_open',
                ref: `vehicle_document:${doc.id}`,
                source_kind: 'vehicle_document',
                title: doc.title || doc.document_type || 'Document',
                metadata: {
                  document_type: doc.document_type,
                  vendor_name: doc.vendor_name,
                  amount: doc.amount,
                  currency: doc.currency,
                  file_type: doc.file_type,
                  created_at: doc.created_at
                },
                links: doc.file_url ? [{ label: 'Open file', url: doc.file_url }] : [],
                receipt: receiptBundle.receipt
                  ? {
                      ref: `receipt:${receiptBundle.receipt.id}`,
                      vendor_name: receiptBundle.receipt.vendor_name,
                      receipt_date: receiptBundle.receipt.receipt_date,
                      total: receiptBundle.receipt.total,
                      currency: receiptBundle.receipt.currency,
                      invoice_number: receiptBundle.receipt.invoice_number,
                      status: receiptBundle.receipt.status
                    }
                  : null,
                receipt_items: receiptBundle.items.slice(0, 25),
                excerpts: [
                  doc.description ? { label: 'Description', text: truncate(doc.description, 800) } : null,
                  receiptBundle.receipt?.raw_json ? { label: 'Receipt raw_json', text: truncate(receiptBundle.receipt.raw_json, 1200) } : null
                ].filter(Boolean)
              }
            ]
          }
        });
      }

      // RECEIPT
      if (kind === 'receipt' || kind === 'receipts') {
        const bundle = await loadReceipt(id);
        if (!bundle.receipt) {
          return makeToolResponse({ response: 'Receipt not found.', ui: { text: 'Receipt not found.', intent: 'other', cards: [] } });
        }
        return makeToolResponse({
          response: `Opened receipt ${id}.`,
          ui: {
            text: `Opened receipt: ${bundle.receipt.vendor_name || 'Receipt'}`,
            intent: 'other',
            cards: [
              {
                type: 'source_open',
                ref: `receipt:${bundle.receipt.id}`,
                source_kind: 'receipt',
                title: bundle.receipt.vendor_name || 'Receipt',
                metadata: {
                  receipt_date: bundle.receipt.receipt_date,
                  total: bundle.receipt.total,
                  subtotal: bundle.receipt.subtotal,
                  tax: bundle.receipt.tax,
                  currency: bundle.receipt.currency,
                  payment_method: bundle.receipt.payment_method,
                  invoice_number: bundle.receipt.invoice_number,
                  purchase_order: bundle.receipt.purchase_order,
                  status: bundle.receipt.status,
                  created_at: bundle.receipt.created_at
                },
                links: [],
                receipt: { ref: `receipt:${bundle.receipt.id}` },
                receipt_items: bundle.items.slice(0, 25),
                excerpts: bundle.receipt.raw_json ? [{ label: 'Receipt raw_json', text: truncate(bundle.receipt.raw_json, 1400) }] : []
              }
            ]
          }
        });
      }

      // VEHICLE IMAGE
      if (kind === 'vehicle_image' || kind === 'vehicle_images') {
        const { data: img } = await supabase
          .from('vehicle_images')
          .select('id, vehicle_id, image_url, safe_preview_url, category, caption, description, created_at, taken_at, is_document, doc_flag, document_classification, document_category, ai_scan_metadata, components, tags')
          .eq('id', id)
          .single();

        if (!img) {
          return makeToolResponse({ response: 'Image not found.', ui: { text: 'Image not found.', intent: 'other', cards: [] } });
        }

        // Try to find receipts linked to this image (if any pipeline wrote source_document_table='vehicle_images')
        const { data: imageReceipt } = await supabase
          .from('receipts')
          .select('id')
          .eq('source_document_table', 'vehicle_images')
          .eq('source_document_id', id)
          .limit(1)
          .maybeSingle();

        const bundle = imageReceipt?.id ? await loadReceipt(imageReceipt.id) : { receipt: null, items: [] };

        return makeToolResponse({
          response: `Opened image ${id}.`,
          ui: {
            text: `Opened image: ${img.caption || img.document_classification || img.document_category || 'Image'}`,
            intent: 'other',
            cards: [
              {
                type: 'source_open',
                ref: `vehicle_image:${img.id}`,
                source_kind: 'vehicle_image',
                title: img.caption || img.document_classification || img.document_category || 'Image',
                metadata: {
                  category: img.category,
                  taken_at: img.taken_at,
                  created_at: img.created_at,
                  is_document: img.is_document || img.doc_flag || false,
                  document_classification: img.document_classification,
                  document_category: img.document_category
                },
                links: [
                  img.safe_preview_url ? { label: 'Preview', url: img.safe_preview_url } : null,
                  img.image_url ? { label: 'Original', url: img.image_url } : null
                ].filter(Boolean),
                receipt: bundle.receipt ? { ref: `receipt:${bundle.receipt.id}`, vendor_name: bundle.receipt.vendor_name } : null,
                receipt_items: bundle.items.slice(0, 15),
                excerpts: [
                  img.description ? { label: 'Description', text: truncate(img.description, 700) } : null,
                  img.ai_scan_metadata ? { label: 'AI scan metadata', text: truncate(img.ai_scan_metadata, 900) } : null,
                  img.components ? { label: 'Components', text: truncate(img.components, 900) } : null,
                  img.tags ? { label: 'Tags', text: truncate(img.tags, 900) } : null
                ].filter(Boolean)
              }
            ]
          }
        });
      }

      // TIMELINE EVENT
      if (kind === 'timeline_event' || kind === 'timeline_events') {
        const { data: ev } = await supabase
          .from('timeline_events')
          .select('id, event_type, title, description, event_date, mileage_at_event, cost_amount, cost_currency, receipt_data, metadata, parts_used, parts_mentioned, tools_mentioned, labor_hours, service_provider_name, invoice_number, verification_documents')
          .eq('id', id)
          .single();

        if (!ev) {
          return makeToolResponse({ response: 'Timeline event not found.', ui: { text: 'Timeline event not found.', intent: 'other', cards: [] } });
        }

        return makeToolResponse({
          response: `Opened timeline event ${id}.`,
          ui: {
            text: `Opened event: ${ev.title || ev.event_type || 'Event'}`,
            intent: 'other',
            cards: [
              {
                type: 'source_open',
                ref: `timeline_event:${ev.id}`,
                source_kind: 'timeline_event',
                title: ev.title || ev.event_type || 'Event',
                metadata: {
                  event_type: ev.event_type,
                  event_date: ev.event_date,
                  mileage_at_event: ev.mileage_at_event,
                  cost_amount: ev.cost_amount,
                  cost_currency: ev.cost_currency,
                  service_provider_name: ev.service_provider_name,
                  invoice_number: ev.invoice_number,
                  labor_hours: ev.labor_hours
                },
                links: [],
                receipt: null,
                receipt_items: [],
                excerpts: [
                  ev.description ? { label: 'Description', text: truncate(ev.description, 900) } : null,
                  ev.parts_used ? { label: 'Parts used', text: truncate(ev.parts_used, 900) } : null,
                  ev.receipt_data ? { label: 'Receipt data', text: truncate(ev.receipt_data, 1200) } : null,
                  ev.metadata ? { label: 'Metadata', text: truncate(ev.metadata, 900) } : null
                ].filter(Boolean)
              }
            ]
          }
        });
      }

      return makeToolResponse({
        response: `Unknown ref kind "${kind}".`,
        ui: {
          text: `Unknown ref kind "${kind}".`,
          intent: 'other',
          cards: [
            { type: 'clarifying_questions', questions: ['Supported: vehicle_document, receipt, vehicle_image, timeline_event'] }
          ]
        }
      });
    }
    
    // Build vehicle advisor prompt (not a roleplay; optimized for actionable guidance)
    const vehicleContext = `
YOU ARE: Nuke Vehicle Expert (service advisor + parts planner). You do NOT roleplay as the vehicle.
You help the user get work done: identify needed parts, estimate labor, provide options, and propose next actions.

IMPORTANT CAPABILITY:
- The UI CAN upload and save documents (receipts/invoices/manuals) directly into this vehicle profile.
- If you need proof of parts purchased, or need pinouts/diagrams, ask the user to click the "Upload receipt/manual" action.

VEHICLE CONTEXT:
- Year: ${vehicle.year || vehicleYear || 'Unknown'}
- Make: ${vehicle.make || vehicleMake || 'Unknown'}
- Model: ${vehicle.model || vehicleModel || 'Unknown'}
- VIN: ${vehicle.vin || vehicleVin || 'Not available'}
- Current Mileage: ${vehicle.mileage ? vehicle.mileage.toLocaleString() + ' miles' : 'Unknown'}
- Color: ${vehicle.color || 'Unknown'}
- Purchase Price: ${vehicle.purchase_price ? '$' + vehicle.purchase_price.toLocaleString() : 'Unknown'}
- Current Value: ${vehicle.current_value ? '$' + vehicle.current_value.toLocaleString() : 'Unknown'}

RECENT HISTORY (${timelineEvents?.length || 0} events):
${timelineEvents && timelineEvents.length > 0 
  ? timelineEvents.map(e => 
      `- ${e.event_date ? new Date(e.event_date).toLocaleDateString() : 'Date unknown'}: ${e.title}${e.description ? ' - ' + e.description : ''}${e.mileage_at_event ? ' (at ' + e.mileage_at_event.toLocaleString() + ' miles)' : ''}${e.receipt_amount ? ' - Cost: $' + parseFloat(e.receipt_amount).toLocaleString() : ''}`
    ).join('\n')
  : 'No documented history yet.'}

DOCUMENTS ON FILE (${docs.length}):
- Receipts/Invoices: ${receiptDocs.length}
- Manuals: ${manualDocs.length}
 - Receipt-like images (not yet attached as documents): ${receiptLike.length}
${docs.length > 0
  ? docs.slice(0, 10).map((d: any) => {
      const dt = String(d?.document_type || 'document');
      const title = String(d?.title || dt);
      const vendor = d?.vendor_name ? ` — ${String(d.vendor_name)}` : '';
      const amt = typeof d?.amount === 'number' ? ` — ${d.currency || 'USD'} ${Number(d.amount).toFixed(2)}` : '';
      const date = d?.document_date ? ` (${new Date(d.document_date).toLocaleDateString()})` : '';
      return `- ${dt}: ${title}${vendor}${amt}${date}`;
    }).join('\n')
  : 'No documents attached yet. If you need receipts/pinouts/diagrams, ask the user to upload them.'}

RECEIPT-LIKE IMAGES (${receiptLike.length}):
${receiptLike.length > 0
  ? receiptLike.slice(0, 8).map((img: any) => {
      const cls = String(img?.document_classification || '').trim();
      const cat = String(img?.document_category || '').trim();
      const caption = String(img?.caption || '').trim();
      const created = img?.created_at ? new Date(img.created_at).toLocaleDateString() : 'date unknown';
      return `- vehicle_image:${img.id} (${created})${cls ? ` — ${cls}` : ''}${cat ? ` — ${cat}` : ''}${caption ? ` — ${caption}` : ''}`;
    }).join('\n')
  : 'None flagged. If you have receipts as photos, upload them or mark them as documents.'}

PHOTOS: ${images?.length || 0} photos documented${images && images.length > 0 ? ` (categories: ${[...new Set(images.map(i => i.category).filter(Boolean))].join(', ') || 'various'})` : ''}

RESPONSE RULES (IMPORTANT):
- Be interactive and execution-focused. Default to giving concrete options, not a generic explanation.
- If the user is asking for parts, provide parts options immediately (with fitment questions only if required).
- Always include cost breakdown, BUT do not invent hard numbers. If you don't have evidence, set unknowns to 0 and explicitly state assumptions and LOW confidence.
- If you need to ground on a specific document, ask the user to run /context, /search, and /open a ref (vehicle_document:..., receipt:..., vehicle_image:..., timeline_event:...) and to attach it in the chat.
- Provide 2-3 options (e.g. Budget / Balanced / Premium) and recommend one.
- Include a "do it for me" option: propose a draft work order payload the UI can create.
- Keep it concise; prefer bullet points and short sections.
- DO NOT output random external links. If you include a URL, it must start with https:// and must be a vendor search page; otherwise omit it.
- Return ONLY valid JSON matching this schema:
{
  "text": "string (short, user-facing summary)",
  "intent": "parts|diagnosis|plan|quote|other",
  "cards": [
    { "type": "clarifying_questions", "questions": ["..."] },
    {
      "type": "estimate",
      "totals": {
        "parts_low": 0,
        "parts_high": 0,
        "labor_hours_low": 0,
        "labor_hours_high": 0,
        "labor_rate_usd_per_hr": 150,
        "total_low": 0,
        "total_high": 0
      },
      "assumptions": ["..."],
      "confidence": "low|medium|high",
      "evidence": [{ "type": "receipt|catalog|vehicle_data|other", "ref": "string" }]
    },
    {
      "type": "parts_options",
      "items": [
        {
          "name": "string",
          "qty": 1,
          "options": [
            { "vendor": "string", "part_number": "string", "price_estimate_usd": 0, "url": "string" }
          ]
        }
      ]
    },
    {
      "type": "next_actions",
      "actions": [
        {
          "id": "draft_work_order",
          "label": "Draft work order",
          "payload": {
            "work_order_draft": { "title": "string", "description": "string", "urgency": "normal", "funds_committed": null }
          }
        },
        {
          "id": "upload_document",
          "label": "Upload receipt/manual",
          "payload": { "hint": "Upload receipts/invoices/manual pinouts to improve accuracy." }
        }
      ]
    }
  ]
}
`;

    // Build conversation messages
    const messages = [
      {
        role: 'system',
        content: vehicleContext
      },
      ...conversationHistory.filter(m => m.role !== 'system'), // Remove any existing system messages
      {
        role: 'user',
        content: question
      }
    ];
    
    console.log(`Chat request: ${question.substring(0, 100)}...`);
    console.log(`Vehicle context: ${vehicleIdentity}, ${timelineEvents?.length || 0} events, ${docs.length} docs (receipts=${receiptDocs.length}, manuals=${manualDocs.length})`);
    
    // Call LLM
    const response = await callLLM(
      llmConfig,
      messages,
      { temperature: 0.4, maxTokens: 1200 }
    );

    const raw = (response.content || '').trim();

    // Prefer structured JSON UI. Be tolerant: if the model returns extra text, try to extract JSON.
    let ui: any = null;
    try {
      ui = JSON.parse(raw);
    } catch {
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match && match[0]) ui = JSON.parse(match[0]);
      } catch {
        ui = null;
      }
    }

    const answer =
      (ui && typeof ui === 'object' && typeof ui.text === 'string' && ui.text.trim())
        ? ui.text.trim()
        : (raw || 'I could not generate a response. Please try again.');

    // Deterministic safety net: if the user asks about receipts/docs or wiring and we have no docs,
    // ensure there's an Upload action so the UI can actually collect missing evidence.
    try {
      const q = (question || '').toLowerCase();
      const looksDocRelated =
        q.includes('receipt') ||
        q.includes('invoice') ||
        q.includes('manual') ||
        q.includes('pinout') ||
        q.includes('diagram') ||
        q.includes('wiring') ||
        q.includes('harness') ||
        q.includes('motec') ||
        q.includes('pdm') ||
        q.includes('ecu');

      if (ui && typeof ui === 'object') {
        if (!Array.isArray(ui.cards)) ui.cards = [];
        const hasNextActions = ui.cards.some((c: any) => c && c.type === 'next_actions');
        const hasUpload = ui.cards.some((c: any) =>
          c && c.type === 'next_actions' && Array.isArray(c.actions) && c.actions.some((a: any) => String(a?.id || '') === 'upload_document')
        );

        if ((docs.length === 0 || looksDocRelated) && !hasUpload) {
          const actionsCard = hasNextActions
            ? ui.cards.find((c: any) => c && c.type === 'next_actions')
            : null;
          if (actionsCard) {
            if (!Array.isArray(actionsCard.actions)) actionsCard.actions = [];
            actionsCard.actions.push({ id: 'upload_document', label: 'Upload receipt/manual', payload: { hint: 'Upload receipts/invoices/manual pinouts to improve accuracy.' } });
          } else {
            ui.cards.push({
              type: 'next_actions',
              actions: [{ id: 'upload_document', label: 'Upload receipt/manual', payload: { hint: 'Upload receipts/invoices/manual pinouts to improve accuracy.' } }]
            });
          }
        }

        // If the conversation is about wiring/harness routing, request the 3D panel.
        // The frontend will auto-load a model from the user's uploads or the system registry when available.
        const looksHarnessRelated =
          q.includes('wiring') ||
          q.includes('harness') ||
          q.includes('loom') ||
          q.includes('routing') ||
          q.includes('grommet') ||
          q.includes('firewall') ||
          q.includes('bulkhead') ||
          q.includes('pdm') ||
          q.includes('ecu');

        const hasModelViewer = Array.isArray(ui.cards) && ui.cards.some((c: any) => c && c.type === 'model_viewer');
        if (looksHarnessRelated && !hasModelViewer) {
          ui.cards.unshift({
            type: 'model_viewer',
            title: '3D harness drafting'
          });
        }
      }
    } catch {
      // ignore UI patch failures
    }

    // Best-effort: if parts are requested and the model didn't include URLs, provide real vendor search URLs.
    try {
      if (ui && typeof ui === 'object' && Array.isArray(ui.cards)) {
        const year = vehicle.year || vehicleYear || '';
        const make = vehicle.make || vehicleMake || '';
        const model = vehicle.model || vehicleModel || '';
        const ymm = [year, make, model].filter(Boolean).join(' ');
        const summitSearch = (q: string) => `https://www.summitracing.com/search?keyword=${encodeURIComponent(q)}`;
        const jegsSearch = (q: string) => `https://www.jegs.com/i/search?searchTerm=${encodeURIComponent(q)}`;

        const normalizeVendorUrl = (rawUrl: unknown): string | null => {
          if (typeof rawUrl !== 'string') return null;
          const s = rawUrl.trim();
          if (!s) return null;
          if (s.startsWith('/')) return null;
          const withProtocol = s.startsWith('http://') || s.startsWith('https://') ? s : (s.startsWith('www.') ? `https://${s}` : s);
          try {
            const u = new URL(withProtocol);
            if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
            const host = u.hostname.toLowerCase();
            const allowedHosts = ['summitracing.com', 'jegs.com', 'rockauto.com'];
            if (!allowedHosts.some(h => host === h || host.endsWith(`.${h}`))) return null;
            return u.toString();
          } catch {
            return null;
          }
        };

        for (const card of ui.cards) {
          if (card && card.type === 'parts_options' && Array.isArray(card.items)) {
            for (const item of card.items) {
              if (!item || typeof item !== 'object') continue;
              const name = String(item.name || '').trim();
              if (!name) continue;
              if (!Array.isArray(item.options)) item.options = [];

              // Sanitize model-provided URLs and remove hallucinated pricing unless backed by evidence.
              for (const opt of item.options) {
                if (!opt || typeof opt !== 'object') continue;
                const normalized = normalizeVendorUrl((opt as any).url);
                if (normalized) (opt as any).url = normalized;
                else delete (opt as any).url;

                // If there's no evidence for pricing, don't present it as a fact.
                const evidence = (opt as any).evidence;
                const hasEvidence = Array.isArray(evidence) ? evidence.length > 0 : Boolean(evidence);
                if (!hasEvidence) {
                  delete (opt as any).price_estimate_usd;
                }
              }

              // Always provide deterministic vendor SEARCH links (safe, https, non-404 relative).
              const query = `${ymm} ${name}`.trim();
              const existingVendors = new Set(item.options.map((o: any) => String(o?.vendor || '').toLowerCase()));
              if (!existingVendors.has('summit racing')) item.options.unshift({ vendor: 'Summit Racing', part_number: '', url: summitSearch(query) });
              if (!existingVendors.has('jegs')) item.options.unshift({ vendor: 'Jegs', part_number: '', url: jegsSearch(query) });
            }
          }
        }
      }
    } catch {
      // ignore enrichment failures
    }

    console.log(`Chat response generated (${response.duration_ms}ms)`);

    return new Response(JSON.stringify({
      response: answer,
      ui,
      vehicle_identity: vehicleIdentity,
      context_used: {
        timeline_events: timelineEvents?.length || 0,
        receipts: receiptDocs.length,
        manuals: manualDocs.length,
        vehicle_documents: docs.length,
        images: images?.length || 0
      }
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error: any) {
    console.error('❌ Chat mode error:', error);
    // Production-safe: chat is optional; never break the UI with a 500.
    return new Response(
      JSON.stringify({
        skipped: true,
        reason: 'chat_error',
        error: error?.message || String(error),
        errorType: error?.name,
        stack: error?.stack,
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      }
    });
  }
  
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({
          skipped: true,
          reason: 'missing_supabase_secrets',
          error: 'Missing Supabase secrets',
          detail: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY) for vehicle-expert-agent.',
          timestamp: new Date().toISOString()
        }),
        {
          // This pipeline is optional: never break the UI with a 500.
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    // Ensure Supabase client exists only after we confirm env is present.
    if (!getSupabaseClient()) {
      return new Response(
        JSON.stringify({
          skipped: true,
          reason: 'missing_supabase_secrets',
          error: 'Missing Supabase secrets',
          detail: 'Unable to initialize Supabase client (check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).',
          timestamp: new Date().toISOString()
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    // Be tolerant of bad/empty bodies (never 500 for parsing).
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const {
      vehicleId,
      queueId,
      question, // Optional: if provided, switch to chat mode
      vehicle_vin, // Optional: vehicle VIN for identity
      vehicle_nickname, // Optional: vehicle nickname for identity
      vehicle_ymm, // Optional: year/make/model string
      vehicle_year, // Optional: year
      vehicle_make, // Optional: make
      vehicle_model, // Optional: model
      conversation_history, // Optional: chat history
      llmProvider, // Optional: 'openai' | 'anthropic' | 'google'
      llmModel, // Optional: specific model name
      analysisTier, // Optional: 'tier1' | 'tier2' | 'tier3' | 'expert'
      userId // Optional: for user API keys
    } = body || {};
    
    if (!vehicleId) {
      return new Response(
        JSON.stringify({
          skipped: true,
          reason: 'invalid_request',
          error: 'vehicleId is required',
          timestamp: new Date().toISOString()
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }
    
    // CHAT MODE: If question is provided, handle as chat conversation
    if (question) {
      console.log(`💬 Vehicle Expert Agent chat mode for: ${vehicleId}`);
      return await handleChatMode(
        vehicleId,
        question,
        vehicle_vin,
        vehicle_nickname,
        vehicle_ymm,
        vehicle_year,
        vehicle_make,
        vehicle_model,
        conversation_history || [],
        llmProvider,
        llmModel,
        analysisTier,
        userId
      );
    }
    
    // VALUATION MODE: Original analysis pipeline
    console.log(`🤖 Vehicle Expert Agent starting analysis for: ${vehicleId}${queueId ? ` (queue: ${queueId})` : ''}`);
    console.log(`📊 Analysis config: tier=${analysisTier || 'expert'}, provider=${llmProvider || 'auto'}, model=${llmModel || 'auto'}`);
    
    // Get LLM configuration
    let llmConfig: any | null = null;
    try {
      llmConfig = await getLLMConfig(
        supabase,
        userId || null,
        llmProvider,
        llmModel,
        // Default to tier2 for production stability (avoids forcing Anthropic-only models).
        (analysisTier as any) || 'tier2'
      );
    } catch (cfgErr: any) {
      const msg = (cfgErr?.message || '').toString();
      // Production-safe behavior: if no LLM provider keys are configured, do NOT 500.
      // This pipeline is optional and should never break core ownership flow UX.
      if (msg.toLowerCase().includes('no llm provider available') || msg.toLowerCase().includes('no api keys')) {
        return new Response(JSON.stringify({
          skipped: true,
          reason: 'llm_unavailable',
          detail: msg || 'No LLM provider available',
          timestamp: new Date().toISOString()
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      throw cfgErr;
    }
    
    console.log(`✅ Using LLM: ${llmConfig.provider}/${llmConfig.model} (${llmConfig.source} key)`);
    
    // Health check: Verify vehicle exists
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id, year, make, model')
      .eq('id', vehicleId)
      .single();
    
    if (vehicleError || !vehicle) {
      throw new Error(`Vehicle not found: ${vehicleId}`);
    }
    
    console.log(`✅ Vehicle verified: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    
    // STEP 1: Research Vehicle & Become Expert
    console.log(`📚 STEP 1: Researching vehicle context...`);
    const vehicleContext = await researchVehicle(vehicleId, llmConfig);
    console.log(`✅ Research complete: ${vehicleContext.year} ${vehicleContext.make} ${vehicleContext.model}`);
    console.log(`   - Market data: ${vehicleContext.marketSales.length} sales found`);
    console.log(`   - Photo timeline: ${vehicleContext.totalImages} images`);
    
    // STEP 2: Assess Images & Tally Value
    console.log(`💰 STEP 2: Assessing images and tallying value...`);
    const components = await assessImagesAndTallyValue(vehicleId, vehicleContext, llmConfig);
    console.log(`✅ Value assessment complete: ${components.length} components identified`);
    
    // STEP 3: Extract Environmental Data (5 W's)
    console.log(`🌍 STEP 3: Extracting environmental context...`);
    const environmental = await extractEnvironmentalContext(vehicleId, llmConfig);
    console.log(`✅ Environmental analysis complete`);
    console.log(`   - Work environment: ${environmental.workEnvironment}`);
    console.log(`   - Locations: ${environmental.gpsLocations.length} unique places`);
    
    // STEP 4: Generate Expert Valuation
    console.log(`📊 STEP 4: Generating expert valuation...`);
    const valuation = await generateExpertValuation(
      vehicleId,
      vehicleContext,
      components,
      environmental,
      llmConfig
    );
    
    // STEP 5: Save to database
    await saveValuation(vehicleId, valuation);
    
    console.log(`✅ Analysis complete for ${vehicleId}: $${valuation.estimatedTotalValue} (confidence: ${valuation.confidence}%)`);
    
    return new Response(JSON.stringify(valuation), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error: any) {
    console.error('❌ Expert agent error:', error);
    console.error('Stack:', error.stack);
    
    // Production-safe: never 500 the UI for this optional pipeline.
    // Still return full details to the client so we can debug.
    return new Response(
      JSON.stringify({
        skipped: true,
        reason: 'internal_error',
        error: error?.message || String(error),
        errorType: error?.name,
        stack: error?.stack,
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }
});

/**
 * STEP 1: Research Vehicle & Become Instant Expert
 */
async function researchVehicle(vehicleId: string, llmConfig: any): Promise<VehicleContext> {
  // Get basic vehicle data
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('year, make, model, vin, purchase_price, purchase_date')
    .eq('id', vehicleId)
    .single();
  
  if (!vehicle) throw new Error('Vehicle not found');
  
  // Get photo timeline
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('taken_at, latitude, longitude')
    .eq('vehicle_id', vehicleId)
    .order('taken_at', { ascending: true });
  
  const photoDateRange = {
    earliest: images?.[0]?.taken_at || 'Unknown',
    latest: images?.[images.length - 1]?.taken_at || 'Unknown'
  };
  
  // Research market sales for this Y/M/M
  const { data: marketSales } = await supabase
    .from('market_data')
    .select('price_value, condition, created_at, source')
    .eq('make', vehicle.make)
    .eq('year', vehicle.year)
    .limit(20);
  
  const sales = (marketSales || []).map(s => ({
    price: parseFloat(s.price_value) || 0,
    condition: s.condition || 'Unknown',
    date: s.created_at,
    source: s.source
  })).filter(s => s.price > 0);
  
  const marketAverage = sales.length > 0
    ? sales.reduce((sum, s) => sum + s.price, 0) / sales.length
    : 0;
  
  const marketRange = sales.length > 0
    ? {
        low: Math.min(...sales.map(s => s.price)),
        high: Math.max(...sales.map(s => s.price))
      }
    : { low: 0, high: 0 };
  
  // Assemble vehicle literature using AI
  const literaturePrompt = `You are a vehicle expert researching a ${vehicle.year} ${vehicle.make} ${vehicle.model}.

Research and provide:
1. Common issues for this year/make/model
2. Key specs (engine options, transmission, notable features)
3. What makes this vehicle valuable or problematic
4. Typical restoration/modification points
5. Forum knowledge (what enthusiasts care about)

Be specific to THIS exact year/make/model. Return as JSON:
{
  "commonIssues": ["issue1", "issue2"],
  "keySpecs": "...",
  "valueDrivers": ["driver1", "driver2"],
  "forumKnowledge": ["fact1", "fact2"]
}`;

  console.log(`  🔍 Researching vehicle literature using ${llmConfig.provider}/${llmConfig.model}...`);
  const litResponse = await callLLM(
    llmConfig,
    [{ role: 'user', content: literaturePrompt }],
    { temperature: 0.3 }
  );
  
  const literature = JSON.parse(
    litResponse.content?.match(/\{[\s\S]*\}/)?.[0] || '{}'
  );
  console.log(`  ✅ Literature research complete (${litResponse.duration_ms}ms)`);
  
  return {
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    vin: vehicle.vin,
    commonIssues: literature.commonIssues || [],
    forumKnowledge: literature.forumKnowledge || [],
    marketSales: sales,
    marketAverage,
    marketRange,
    totalImages: images?.length || 0,
    photoDateRange
  };
}

/**
 * STEP 2: Assess Images & Tally Value
 */
async function assessImagesAndTallyValue(
  vehicleId: string,
  context: VehicleContext,
  llmConfig: any
): Promise<ValuedComponent[]> {
  // Get all images
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, image_url, variants, taken_at, category, latitude, longitude')
    .eq('vehicle_id', vehicleId)
    .order('taken_at', { ascending: true });
  
  if (!images || images.length === 0) return [];
  
  // Sample images for analysis (don't analyze all 160, too expensive)
  // Take every 5th image to get good coverage
  const sampledImages = images.filter((_, idx) => idx % 5 === 0).slice(0, 30);
  
  const components: ValuedComponent[] = [];
  
  // Batch analyze images using GPT-4 Vision
  const analysisPrompt = `You are an expert appraiser for a ${context.year} ${context.make} ${context.model}.

VEHICLE KNOWLEDGE:
- Common issues: ${context.commonIssues.join(', ')}
- Market average: $${context.marketAverage.toLocaleString()}
- Known for: ${context.forumKnowledge.join('; ')}

TASK: Analyze these photos and identify EVERY component/part visible that has VALUE.
For each component found, provide:
1. Specific name (e.g., "Front Dana 44 Axle", not just "Axle")
2. Condition grade (1-10) based on visual inspection
3. Estimated value in current condition
4. What photo evidence shows
5. WHY this value (explain reasoning)

Return JSON array:
[{
  "name": "Front Dana 44 Axle Assembly",
  "condition": "Very Good",
  "conditionGrade": 8,
  "estimatedValue": 450,
  "newPrice": 895,
  "location": "Front undercarriage",
  "evidence": "Visible in photos 3, 7, 12. Light surface rust but solid structure.",
  "reasoning": "Dana 44 front axle for 1974 Bronco runs $800-1000 new. This unit shows light surface rust but no structural damage, good gear oil, intact boots. Worth ~50% of new value."
}]

Focus on SUBSTANTIVE parts worth >$50. Ignore minor items.`;

  const imageContent = sampledImages.map(img => ({
    type: 'image_url' as const,
    image_url: {
      url: img.variants?.medium || img.image_url,
      detail: 'high' as const
    }
  }));
  
  console.log(`  🔍 Analyzing ${sampledImages.length} images using ${llmConfig.provider}/${llmConfig.model}...`);
  const response = await callLLM(
    llmConfig,
    [{
      role: 'user',
      content: [
        { type: 'text', text: analysisPrompt },
        ...imageContent
      ]
    }],
    { maxTokens: 4000, temperature: 0.3, vision: true }
  );
  
  console.log(`  ✅ Image analysis complete (${response.duration_ms}ms, ${response.usage?.total_tokens || 'unknown'} tokens)`);
  const content = response.content || '';
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  
  if (jsonMatch) {
    const parsedComponents = JSON.parse(jsonMatch[0]);
    
    for (const comp of parsedComponents) {
      // Find which specific images show this component
      const relatedImages = images.filter(img => 
        comp.evidence?.toLowerCase().includes(`photo ${images.indexOf(img) + 1}`) ||
        (img.category && comp.location?.toLowerCase().includes(img.category.toLowerCase()))
      ).slice(0, 5);
      
      components.push({
        name: comp.name,
        partNumber: comp.partNumber,
        condition: comp.condition,
        conditionGrade: comp.conditionGrade,
        estimatedValue: comp.estimatedValue || 0,
        newPrice: comp.newPrice,
        evidence: {
          imageUrls: relatedImages.map(i => i.variants?.thumbnail || i.image_url),
          photoCount: relatedImages.length,
          location: comp.location || 'Unknown',
          datePhotographed: relatedImages[0]?.taken_at || 'Unknown'
        },
        confidence: comp.conditionGrade >= 7 ? 90 : comp.conditionGrade >= 5 ? 75 : 60,
        reasoning: comp.reasoning || ''
      });
    }
  }
  
  return components;
}

/**
 * STEP 3: Extract Environmental Context (5 W's)
 */
async function extractEnvironmentalContext(vehicleId: string, llmConfig: any): Promise<EnvironmentalContext> {
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('taken_at, latitude, longitude, exif_data, image_url, variants')
    .eq('vehicle_id', vehicleId);
  
  if (!images || images.length === 0) {
    return {
      gpsLocations: [],
      cameraEquipment: [],
      photoTimeline: [],
      workEnvironment: 'home_garage',
      weatherConditions: [],
      toolsVisible: [],
      who: [],
      what: [],
      when: 'Unknown',
      where: 'Unknown',
      why: 'Unknown'
    };
  }
  
  // Extract GPS locations
  const gpsMap = new Map<string, number>();
  images.forEach(img => {
    if (img.latitude && img.longitude) {
      const key = `${img.latitude.toFixed(4)},${img.longitude.toFixed(4)}`;
      gpsMap.set(key, (gpsMap.get(key) || 0) + 1);
    }
  });
  
  const gpsLocations = Array.from(gpsMap.entries()).map(([coords, count]) => {
    const [lat, lng] = coords.split(',').map(Number);
    return { lat, lng, count };
  });
  
  // Extract camera equipment
  const cameras = new Set<string>();
  images.forEach(img => {
    const exif = img.exif_data;
    if (exif?.camera?.Make && exif?.camera?.Model) {
      cameras.add(`${exif.camera.Make} ${exif.camera.Model}`);
    }
  });
  
  // Build photo timeline
  const timelineMap = new Map<string, number>();
  images.forEach(img => {
    const date = img.taken_at?.split('T')[0] || 'Unknown';
    timelineMap.set(date, (timelineMap.get(date) || 0) + 1);
  });
  
  const photoTimeline = Array.from(timelineMap.entries())
    .map(([date, photoCount]) => ({ date, photoCount }))
    .sort((a, b) => a.date.localeCompare(b.date));
  
  // Analyze work environment using AI on sample photos
  const sampleImages = images.filter((_, idx) => idx % 10 === 0).slice(0, 5);
  
  const envPrompt = `Analyze these photos to determine the work environment and context.

Identify:
1. Work environment type (professional shop, home garage, driveway, etc.)
2. Weather/lighting conditions visible
3. Tools visible (professional vs DIY)
4. WHO: Clues about who did the work (professional shop, owner, friend)
5. WHAT: Type of work being performed (restoration, repair, modification, inspection)
6. WHERE: Specific location characteristics
7. WHY: Purpose of the work (preserve, upgrade, fix issues, prepare for sale)

Return JSON:
{
  "workEnvironment": "home_garage|professional_shop|driveway|field|storage",
  "weatherConditions": ["sunny", "indoor"],
  "toolsVisible": ["floor jack", "impact wrench"],
  "who": ["Owner (DIY setup)", "Professional mechanic"],
  "what": ["Suspension replacement", "Rust repair"],
  "where": "Home garage with concrete floor, good lighting",
  "why": "Restoration - bringing vehicle to showroom condition"
}`;

  const envImages = sampleImages.map(img => ({
    type: 'image_url' as const,
    image_url: {
      url: img.variants?.medium || img.image_url,
      detail: 'low' as const
    }
  }));
  
  console.log(`  🔍 Extracting environmental context using ${llmConfig.provider}/${llmConfig.model}...`);
  const envResponse = await callLLM(
    llmConfig,
    [{
      role: 'user',
      content: [
        { type: 'text', text: envPrompt },
        ...envImages
      ]
    }],
    { maxTokens: 1000, temperature: 0.3, vision: true }
  );
  
  console.log(`  ✅ Environmental extraction complete (${envResponse.duration_ms}ms)`);
  const envData = JSON.parse(
    envResponse.content?.match(/\{[\s\S]*\}/)?.[0] || '{}'
  );
  
  return {
    gpsLocations,
    cameraEquipment: Array.from(cameras),
    photoTimeline,
    workEnvironment: envData.workEnvironment || 'home_garage',
    weatherConditions: envData.weatherConditions || [],
    toolsVisible: envData.toolsVisible || [],
    who: envData.who || [],
    what: envData.what || [],
    when: photoTimeline.length > 0 
      ? `${photoTimeline[0].date} to ${photoTimeline[photoTimeline.length - 1].date}`
      : 'Unknown',
    where: envData.where || (gpsLocations.length > 0 ? `${gpsLocations.length} locations` : 'Unknown'),
    why: envData.why || 'Unknown'
  };
}

/**
 * STEP 4: Generate Expert Valuation with WHY
 */
async function generateExpertValuation(
  vehicleId: string,
  context: VehicleContext,
  components: ValuedComponent[],
  environmental: EnvironmentalContext,
  llmConfig: any
): Promise<ExpertValuation> {
  // Get purchase price from database
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('purchase_price')
    .eq('id', vehicleId)
    .single();
  
  const purchasePrice = vehicle?.purchase_price || 0;
  const documentedValue = components.reduce((sum, c) => sum + c.estimatedValue, 0);
  const estimatedTotalValue = purchasePrice + documentedValue;
  
  // Generate narrative explanation
  const summary = `${context.year} ${context.make} ${context.model} analysis based on ${context.totalImages} photos taken between ${context.photoDateRange.earliest} and ${context.photoDateRange.latest}.`;
  
  const valueJustification = `
PURCHASE FLOOR: $${purchasePrice.toLocaleString()} establishes baseline value.

DOCUMENTED COMPONENTS (${components.length} identified):
${components.map(c => 
  `- ${c.name}: $${c.estimatedValue} (${c.condition} - ${c.conditionGrade}/10)
   Evidence: ${c.evidence.photoCount} photos showing ${c.evidence.location}
   ${c.reasoning}`
).join('\n\n')}

WORK CONTEXT:
- Environment: ${environmental.workEnvironment.replace(/_/g, ' ')}
- Who: ${environmental.who.join(', ')}
- What: ${environmental.what.join(', ')}
- When: ${environmental.when}
- Where: ${environmental.where}
- Why: ${environmental.why}

TOTAL VALUE: $${estimatedTotalValue.toLocaleString()} 
($${purchasePrice.toLocaleString()} purchase + $${documentedValue.toLocaleString()} documented components)

This valuation is based on visual evidence from photos. Components were identified and condition-assessed through detailed image analysis. Market reference: $${context.marketAverage.toLocaleString()} (${context.marketSales.length} comparable sales).
`.trim();
  
  const recommendations: string[] = [];
  const warnings: string[] = [];
  
  // Generate recommendations
  if (documentedValue < context.marketAverage * 0.2) {
    recommendations.push('Consider documenting additional work with receipts and photos');
  }
  
  if (components.filter(c => c.conditionGrade < 5).length > 0) {
    warnings.push('Some components in poor condition may affect value');
  }
  
  if (purchasePrice > context.marketAverage * 1.3) {
    warnings.push(`Purchase price was ${((purchasePrice / context.marketAverage - 1) * 100).toFixed(0)}% above market average`);
  }
  
  if (environmental.workEnvironment === 'field' || environmental.workEnvironment === 'storage') {
    warnings.push('Outdoor storage visible in photos may indicate exposure damage');
  }
  
  return {
    vehicleContext: context,
    components,
    environmental,
    purchasePrice,
    documentedValue,
    estimatedTotalValue,
    confidence: components.length > 5 ? 85 : components.length > 2 ? 70 : 60,
    summary,
    valueJustification,
    recommendations,
    warnings
  };
}

/**
 * Save valuation to database
 */
async function saveValuation(vehicleId: string, valuation: ExpertValuation): Promise<void> {
  // Update vehicle current_value
  await supabase
    .from('vehicles')
    .update({
      current_value: valuation.estimatedTotalValue
    })
    .eq('id', vehicleId);
  
  // Save detailed valuation for audit trail
  await supabase
    .from('vehicle_valuations')
    .insert({
      vehicle_id: vehicleId,
      estimated_value: valuation.estimatedTotalValue,
      documented_components: valuation.documentedValue,
      confidence_score: valuation.confidence,
      components: valuation.components,
      environmental_context: valuation.environmental,
      value_justification: valuation.valueJustification,
      methodology: 'expert_agent_v1'
    });
  
  // **CRITICAL**: Update vehicles.current_value to unify all pricing displays
  await supabase
    .from('vehicles')
    .update({ 
      current_value: valuation.estimatedTotalValue,
      updated_at: new Date().toISOString()
    })
    .eq('id', vehicleId);
  
  // Record price change in history (trigger will handle this automatically via vehicles update)
  // But also add expert agent metadata for audit trail
  await supabase
    .from('vehicle_price_history')
    .insert({
      vehicle_id: vehicleId,
      price_type: 'current',
      value: valuation.estimatedTotalValue,
      source: 'expert_agent',
      confidence: Math.round(valuation.confidence ?? 0),
      as_of: new Date().toISOString()
    });
  
  // Enrich existing tags with value data
  for (const component of valuation.components) {
    // Find matching tags
    const { data: matchingTags } = await supabase
      .from('image_tags')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .ilike('tag_name', `%${component.name.split(' ')[0]}%`)
      .limit(10);
    
    if (matchingTags && matchingTags.length > 0) {
      // Enrich with value data
      await supabase
        .from('image_tags')
        .update({
          metadata: {
            estimated_value_cents: Math.round(component.estimatedValue * 100),
            condition_grade: component.conditionGrade,
            condition_label: component.condition,
            part_number: component.partNumber,
            reasoning: component.reasoning,
            expert_assessed: true,
            assessed_at: new Date().toISOString()
          }
        })
        .in('id', matchingTags.map(t => t.id));
    }
  }
}

