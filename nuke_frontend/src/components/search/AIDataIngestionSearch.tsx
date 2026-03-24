import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase, getCurrentUserId } from '../../lib/supabase';
import { aiDataIngestion, type ExtractionResult, ingestVehicle } from '../../services/aiDataIngestion';
import { dataRouter, type DatabaseOperationPlan } from '../../services/dataRouter';
import { universalSearchService, type UniversalSearchResult } from '../../services/universalSearchService';
import { classifyIntent, type SearchIntent } from '../../lib/search/intentRouter';
import { KNOWN_MAKES, MAKE_ALIASES } from '../../lib/search/dictionaries';
import { useToast } from '../../hooks/useToast';
import VehicleCritiqueMode from './VehicleCritiqueMode';
import { SmartInvoiceUploader } from '../SmartInvoiceUploader';
import '../../styles/unified-design-system.css';

/* ─── Platform detection for URL intent ─── */
const PLATFORM_PATTERNS: Array<{ pattern: RegExp; label: string; short: string }> = [
  { pattern: /bringatrailer\.com/i, label: 'Bring a Trailer', short: 'BAT' },
  { pattern: /carsandbids\.com/i, label: 'Cars & Bids', short: 'C&B' },
  { pattern: /mecum\.com/i, label: 'Mecum Auctions', short: 'MECUM' },
  { pattern: /barrett-jackson\.com/i, label: 'Barrett-Jackson', short: 'BJ' },
  { pattern: /rmsothebys\.com/i, label: "RM Sotheby's", short: 'RM' },
  { pattern: /bonhams\.com/i, label: 'Bonhams', short: 'BONHAMS' },
  { pattern: /pcarmarket\.com/i, label: 'PCarMarket', short: 'PCAR' },
  { pattern: /hagerty\.com/i, label: 'Hagerty', short: 'HAGERTY' },
  { pattern: /hemmings\.com/i, label: 'Hemmings', short: 'HEMMINGS' },
  { pattern: /collectingcars\.com/i, label: 'Collecting Cars', short: 'CC' },
  { pattern: /ebay\.com/i, label: 'eBay', short: 'EBAY' },
  { pattern: /facebook\.com\/marketplace/i, label: 'Facebook Marketplace', short: 'FBMP' },
  { pattern: /craigslist\.org/i, label: 'Craigslist', short: 'CL' },
  { pattern: /classiccars\.com/i, label: 'ClassicCars.com', short: 'CC' },
  { pattern: /autotrader\.com/i, label: 'AutoTrader', short: 'AT' },
];

function detectPlatform(url: string): { label: string; short: string } | null {
  for (const p of PLATFORM_PATTERNS) {
    if (p.pattern.test(url)) return { label: p.label, short: p.short };
  }
  return null;
}

/* ─── Make stats for browse intent ─── */
interface MakeStats {
  make: string;
  total: number;
  topModels: Array<{ model: string; count: number }>;
  avgPrice: number | null;
  yearRange: { min: number; max: number } | null;
}

async function fetchMakeStats(make: string): Promise<MakeStats | null> {
  try {
    const resolved = MAKE_ALIASES[make.toLowerCase()] || make;
    const normalizedMake = KNOWN_MAKES.find(m => m.toLowerCase() === resolved.toLowerCase()) || resolved;

    const [countRes, modelsRes, priceRes] = await Promise.all([
      supabase
        .from('vehicles')
        .select('id', { count: 'exact', head: true })
        .ilike('make', normalizedMake),
      supabase
        .from('vehicles')
        .select('model')
        .ilike('make', normalizedMake)
        .not('model', 'is', null)
        .limit(500),
      supabase
        .from('vehicles')
        .select('sale_price, year')
        .ilike('make', normalizedMake)
        .not('sale_price', 'is', null)
        .gt('sale_price', 0)
        .limit(200),
    ]);

    const total = countRes.count || 0;
    if (total === 0) return null;

    // Aggregate top models
    const modelCounts: Record<string, number> = {};
    for (const v of modelsRes.data || []) {
      if (v.model) {
        modelCounts[v.model] = (modelCounts[v.model] || 0) + 1;
      }
    }
    const topModels = Object.entries(modelCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([model, count]) => ({ model, count }));

    // Price stats
    const prices = (priceRes.data || []).map(v => v.sale_price).filter(Boolean) as number[];
    const avgPrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;

    // Year range
    const years = (priceRes.data || []).map(v => v.year).filter(Boolean) as number[];
    const yearRange = years.length > 0
      ? { min: Math.min(...years), max: Math.max(...years) }
      : null;

    return { make: normalizedMake, total, topModels, avgPrice, yearRange };
  } catch {
    return null;
  }
}

function normalizeUrlInput(value: string): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  // Strip common wrapper characters from copy/paste.
  const cleaned = raw.replace(/^[<(\[]+/, '').replace(/[>\])]+$/, '').trim();
  if (!cleaned) return null;
  if (/\s/.test(cleaned)) return null;

  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  if (/^www\./i.test(cleaned)) return `https://${cleaned}`;

  // Bare domains (e.g. ecpsgroup.com, ecpsgroup.com/contact)
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[\/?#].*)?$/i.test(cleaned)) {
    return `https://${cleaned}`;
  }

  return null;
}

function isProbablyAssetOrDocumentUrl(url: string): boolean {
  return /\.(pdf|png|jpe?g|gif|webp|svg)(?:$|[?#])/i.test(url);
}

function isLikelyVehicleListingUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.includes('bringatrailer.com/listing/')) return true;

  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    const q = u.search.toLowerCase();

    if (/[?&](vin|id)=/.test(q)) return true;

    const patterns = [
      /\/vehicle\/[^/]+/i,
      /\/inventory\/[^/]+/i,
      /\/listing\/[^/]+/i,
      /\/lot\/[^/]+/i,
      /\/car\/[^/]+/i,
      /\/auction\/[^/]+/i,
      /\/bid\/[^/]+/i,
    ];

    return patterns.some((re) => re.test(path));
  } catch {
    return false;
  }
}

function isMecumLotUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.toLowerCase().includes('mecum.com')) return false;
    const path = u.pathname.toLowerCase();
    // Mecum lot pages:
    // - /lots/<lot-id>/<slug>
    // - /lots/detail/<...>
    if (path.includes('/lots/detail/')) return true;
    return /\/lots\/\d+(?:\/|$)/i.test(path);
  } catch {
    return false;
  }
}

function isLikelyOrgWebsiteUrl(url: string): boolean {
  if (isProbablyAssetOrDocumentUrl(url)) return false;
  if (isLikelyVehicleListingUrl(url)) return false;

  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const path = u.pathname.toLowerCase();

    // Root or single-level pages are usually "org-ish".
    if (parts.length <= 1) return true;

    // Common org-ish sections
    if (
      /\/(about|contact|inventory|vehicles|sold|current|auctions?|events?)\b/i.test(path)
    ) {
      return true;
    }

    // Otherwise: don't auto-create on paste (avoid slop from deep blog/article URLs).
    return false;
  } catch {
    return false;
  }
}

/** Detect a 17-character VIN (excludes I, O, Q per FMVSS standard). */
function isVIN(text: string): boolean {
  const cleaned = text.trim().replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(cleaned) && !/[IOQ]/.test(cleaned);
}

interface ExtractionPreview {
  result: ExtractionResult;
  operationPlan?: DatabaseOperationPlan;
  matchResult?: {
    matchScore: number;
    evidence: Array<{
      imageUrl: string;
      matchType: string;
      confidence: number;
      details: string;
    }>;
    shouldMerge: boolean;
  };
  existingVehicleId?: string;
}

export default function AIDataIngestionSearch() {
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractionPreview, setExtractionPreview] = useState<ExtractionPreview | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [attachedImage, setAttachedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showCritique, setShowCritique] = useState(false);
  const [currentVehicleData, setCurrentVehicleData] = useState<any>(null);
  const [actionsOpen, setActionsOpen] = useState(false);

  // Wiring workbench (chat-like) state
  const [showWiringWorkbench, setShowWiringWorkbench] = useState(false);
  const [wiringMessages, setWiringMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const [showWiringUploader, setShowWiringUploader] = useState(false);

  // Autocomplete state - now uses UniversalSearchResult for rich results
  const [autocompleteResults, setAutocompleteResults] = useState<UniversalSearchResult[]>([]);
  const [autocompleteAISuggestion, setAutocompleteAISuggestion] = useState<string | null>(null);
  const [autocompleteTotalCount, setAutocompleteTotalCount] = useState<number | null>(null);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [selectedAutocompleteIndex, setSelectedAutocompleteIndex] = useState(-1);
  const autocompleteDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Magic Box intent state
  const [currentIntent, setCurrentIntent] = useState<SearchIntent | null>(null);
  const [detectedPlatform, setDetectedPlatform] = useState<{ label: string; short: string } | null>(null);
  const [makeStats, setMakeStats] = useState<MakeStats | null>(null);
  const [makeStatsLoading, setMakeStatsLoading] = useState(false);
  const makeStatsDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const [vinCheckResult, setVinCheckResult] = useState<{ exists: boolean; vehicleId?: string; title?: string } | null>(null);
  const [vinCheckLoading, setVinCheckLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();

  const vehicleIdFromRoute = useMemo(() => {
    const m = location.pathname.match(/\/vehicle\/([a-f0-9-]{36})/);
    return m ? m[1] : null;
  }, [location.pathname]);

  // Auto-dismiss preview when on vehicle profile page
  useEffect(() => {
    if (vehicleIdFromRoute && showPreview) {
      setShowPreview(false);
      setExtractionPreview(null);
    }
  }, [vehicleIdFromRoute, showPreview]);

  // Autocomplete as user types - uses universal search for rich results
  useEffect(() => {
    if (autocompleteDebounceRef.current) {
      clearTimeout(autocompleteDebounceRef.current);
    }

    const trimmedInput = input.trim();

    // Don't show autocomplete if:
    // - Input is too short (< 2 chars)
    // - Processing
    // - Has attached image
    // - Already showing preview
    if (trimmedInput.length < 2 || isProcessing || attachedImage || showPreview) {
      setAutocompleteResults([]);
      setAutocompleteAISuggestion(null);
      setAutocompleteTotalCount(null);
      setShowAutocomplete(false);
      return;
    }

    // Check if it's a URL (don't autocomplete URLs, they go to extraction)
    const isURL = !!normalizeUrlInput(trimmedInput);
    if (isURL) {
      setAutocompleteResults([]);
      setAutocompleteAISuggestion(null);
      setAutocompleteTotalCount(null);
      setShowAutocomplete(false);
      return;
    }

    // VINs can be searched - universal search handles them

    autocompleteDebounceRef.current = setTimeout(async () => {
      try {
        // Use universal search service for rich results with thumbnails
        const response = await universalSearchService.search(trimmedInput, {
          limit: 24,
          includeAI: true
        });

        let combinedResults = response.results;

        if (combinedResults.length < 8) {
          try {
            const safeQuery = trimmedInput.replace(/([%_\\])/g, '\\$1');
            const { data: vehicles } = await supabase
              .from('vehicles')
              .select('id, year, make, model, normalized_model, series, trim, title, sale_price, current_value')
              .eq('is_public', true)
              .or(`make.ilike.%${safeQuery}%,model.ilike.%${safeQuery}%,normalized_model.ilike.%${safeQuery}%,series.ilike.%${safeQuery}%,trim.ilike.%${safeQuery}%,title.ilike.%${safeQuery}%`)
              .limit(16);

            if (vehicles && vehicles.length > 0) {
              const fallbackResults: UniversalSearchResult[] = vehicles.map((v: any) => ({
                id: v.id,
                type: 'vehicle',
                title: `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || v.title || 'Vehicle',
                subtitle: v.trim || v.series || v.normalized_model || undefined,
                description: v.title || undefined,
                relevance_score: 0.3,
                metadata: {
                  year: v.year,
                  make: v.make,
                  model: v.model,
                  price: v.sale_price || v.current_value
                }
              }));

              const seen = new Set<string>();
              const merged = [...combinedResults, ...fallbackResults].filter((r) => {
                const key = `${r.type}:${r.id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              combinedResults = merged.slice(0, 24);
            }
          } catch {
            // Ignore fallback errors; keep edge results.
          }
        }

        setAutocompleteResults(combinedResults);
        setAutocompleteAISuggestion(response.ai_suggestion || null);
        const totalCount = Math.max(response.total_count || 0, combinedResults.length);
        setAutocompleteTotalCount(totalCount > 0 ? totalCount : combinedResults.length);
        setShowAutocomplete(combinedResults.length > 0 || !!response.ai_suggestion);
        setSelectedAutocompleteIndex(-1);

      } catch (error) {
        // Autocomplete error - fail silently
        setAutocompleteResults([]);
        setAutocompleteAISuggestion(null);
        setAutocompleteTotalCount(null);
        setShowAutocomplete(false);
      }
    }, 300); // 300ms debounce

    return () => {
      if (autocompleteDebounceRef.current) {
        clearTimeout(autocompleteDebounceRef.current);
      }
    };
  }, [input, isProcessing, attachedImage, showPreview]);

  // ── Magic Box: Intent classification on every keystroke ──
  useEffect(() => {
    const trimmed = input.trim();
    if (!trimmed) {
      setCurrentIntent(null);
      setDetectedPlatform(null);
      setMakeStats(null);
      setVinCheckResult(null);
      return;
    }

    const result = classifyIntent(trimmed);
    setCurrentIntent(result.intent);

    // URL intent: detect platform
    if (result.intent === 'EXACT_URL') {
      const normalized = normalizeUrlInput(trimmed);
      setDetectedPlatform(detectPlatform(normalized || trimmed));
      setMakeStats(null);
      setVinCheckResult(null);
    }
    // VIN intent: check if vehicle exists
    else if (result.intent === 'EXACT_VIN') {
      setDetectedPlatform(null);
      setMakeStats(null);
      setVinCheckLoading(true);
      const cleanedVin = trimmed.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      Promise.resolve(
        supabase
          .from('vehicles')
          .select('id, year, make, model')
          .ilike('vin', cleanedVin)
          .limit(1)
      ).then(({ data }) => {
          if (data && data.length > 0) {
            const v = data[0];
            setVinCheckResult({
              exists: true,
              vehicleId: v.id,
              title: [v.year, v.make, v.model].filter(Boolean).join(' '),
            });
          } else {
            setVinCheckResult({ exists: false });
          }
          setVinCheckLoading(false);
        })
        .catch(() => {
          setVinCheckResult({ exists: false });
          setVinCheckLoading(false);
        });
    }
    // Browse intent (make): fetch make stats
    else if (result.intent === 'BROWSE') {
      setDetectedPlatform(null);
      setVinCheckResult(null);
      if (makeStatsDebounceRef.current) clearTimeout(makeStatsDebounceRef.current);
      setMakeStatsLoading(true);
      makeStatsDebounceRef.current = setTimeout(async () => {
        const stats = await fetchMakeStats(trimmed.split(/\s+/)[0]);
        setMakeStats(stats);
        setMakeStatsLoading(false);
      }, 300);
    } else {
      setDetectedPlatform(null);
      setMakeStats(null);
      setVinCheckResult(null);
    }

    return () => {
      if (makeStatsDebounceRef.current) clearTimeout(makeStatsDebounceRef.current);
    };
  }, [input]);

  const isWiringIntent = (text: string) => {
    const t = (text || '').toLowerCase();
    if (!t) return false;
    // Wiring-specific keywords - be precise to avoid false positives.
    // "can bus" is wiring, but "can I see" is not.
    return (
      t.includes('wiring') ||
      /\bharness\b/.test(t) ||  // "harness" but not "harness racing"
      t.includes('pdm') ||
      t.includes('ecu') ||
      t.includes('pinout') ||
      t.includes('bulkhead') ||
      t.includes('motec') ||
      /\bloom\b/.test(t) ||     // "loom" but not "looming"
      /\bawg\b/.test(t) ||      // wire gauge
      /\bcan\s*bus\b/.test(t) ||  // "can bus" or "canbus" - NOT "can I"
      t.includes('can-bus')
    );
  };

  const looksLikeNaturalLanguageSearch = (text: string) => {
    const t = (text || '').trim().toLowerCase();
    if (!t) return false;

    // URL or VIN? Not a search query.
    if (normalizeUrlInput(t)) return false;
    if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(t)) return false;

    // Very short (1-2 chars)? Probably not useful for search.
    if (t.length < 2) return false;

    // SIMPLE HEURISTIC: If it's short text without special structure, it's a search.
    // Most people typing "porsche", "c10", "mustang" want to search.
    // Only route away from search for clear non-search patterns:
    // - URLs (handled above)
    // - VINs (handled above)
    // - Very long freeform text (>200 chars) might be data to extract
    if (t.length <= 200) return true;

    // Legacy patterns still work for longer text
    if (t.includes('?')) return true;
    if (/^(what|why|how|when|where|who|which|are|is|do|does|did|can|should|could|would)\b/i.test(t)) return true;
    if (/\b(show|find|search|look|see|browse|list)\b/i.test(t)) return true;
    if (/\b(i\s+want\s+to\s+see|i\s+wanna\s+see|i\s+want\s+to|i\s+wanna)\b/i.test(t)) return true;
    if (/\b(all\s+the|all)\b/i.test(t) && t.split(/\s+/).length <= 8) return true;
    return false;
  };

  const runWiringWorkbench = async (userText: string) => {
    const vid = vehicleIdFromRoute || currentVehicleData?.id;
    if (!vid) {
      setWiringMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `I can do wiring planning, but I need a vehicle context. Open a vehicle page or paste a /vehicle/<id> link.` }
      ]);
      setShowWiringWorkbench(true);
      return;
    }

    // Check what evidence we have attached to this vehicle (receipts/invoices/manuals).
    // If anything is missing, ask immediately (chat-driven).
    let totalDocs = 0;
    let financialDocs = 0;
    let manualDocs = 0;

    try {
      const [{ count: totalCount, error: totalErr }, { count: finCount, error: finErr }, { count: manCount, error: manErr }] = await Promise.all([
        supabase.from('vehicle_documents').select('id', { count: 'exact', head: true }).eq('vehicle_id', vid),
        supabase.from('vehicle_documents').select('id', { count: 'exact', head: true }).eq('vehicle_id', vid).in('document_type', ['receipt', 'invoice', 'service_record', 'parts_order']),
        supabase.from('vehicle_documents').select('id', { count: 'exact', head: true }).eq('vehicle_id', vid).in('document_type', ['manual'])
      ]);
      if (!totalErr) totalDocs = totalCount || 0;
      if (!finErr) financialDocs = finCount || 0;
      if (!manErr) manualDocs = manCount || 0;
    } catch {
      // If RLS blocks, we still proceed with questions.
    }

    const needsReceipts = financialDocs === 0;
    const needsManuals = manualDocs === 0;

    const questions: string[] = [];
    if (needsReceipts) {
      questions.push(`I don't see any receipts/invoices attached to this vehicle yet. Do you want to upload them now so I can build the parts inventory from proof?`);
    }
    if (needsManuals) {
      questions.push(`Do you have service manual pages (wiring diagrams / connector views / pinouts)? Uploading those lets me build accurate endpoint + pin maps.`);
    }

    // Always ask for the minimal architecture inputs if they aren't grounded by docs yet.
    questions.push(`What ECU are you using (exact model), and what PDM/fusebox (exact model)?`);
    questions.push(`Where are the main endpoints physically (zones are fine): ECU/PDM, bulkhead passthrough, fuel pump module, fans, injectors/coils, dash?`);
    questions.push(`Any networks or signal classes: CAN buses (how many), crank/cam triggers (shielded), wideband/analog sensors, DBW?`);

    const header = `WIRING WORKBENCH — ${currentVehicleData?.year || ''} ${currentVehicleData?.make || ''} ${currentVehicleData?.model || ''}`.trim();
    const inventoryLine = `Evidence check: documents=${totalDocs}, receipts/invoices=${financialDocs}, manuals=${manualDocs}.`;

    setWiringMessages((prev) => [
      ...prev,
      { role: 'assistant', text: `${header}\n${inventoryLine}\n\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}` }
    ]);
    setShowWiringWorkbench(true);
  };

  // Auto-detect vehicle page and load data
  useEffect(() => {
    const detectVehiclePage = async () => {
      const path = location.pathname;
      const vehicleMatch = path.match(/\/vehicle\/([a-f0-9-]{36})/);

      if (vehicleMatch) {
        const vehicleId = vehicleMatch[1];

        // Load vehicle data for critique mode
        try {
          const { data: vehicle } = await supabase
            .from('vehicles')
            .select('id, year, make, model, status, description')
            .eq('id', vehicleId)
            .single();

          if (vehicle) {
            setCurrentVehicleData(vehicle);
          }
        } catch (error) {
          // Failed to load vehicle data for critique - ignore
        }
      } else {
        setCurrentVehicleData(null);
        setShowCritique(false);
      }
    };

    detectVehiclePage();
  }, [location.pathname]);

  // Close actions menu on outside click
  useEffect(() => {
    if (!actionsOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setActionsOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [actionsOpen]);

  // Close popovers on outside click WITHOUT blocking the entire page (no full-screen click-catcher)
  const anyPopoverOpen = showPreview || !!imagePreview || !!error || showCritique || showWiringWorkbench;
  useEffect(() => {
    if (!anyPopoverOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      if (el.contains(e.target as Node)) return;
      setShowPreview(false);
      setExtractionPreview(null);
      setError(null);
      setShowCritique(false);
      setShowWiringWorkbench(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [anyPopoverOpen]);

  // Handle paste from clipboard
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf('image') !== -1) {
          const file = item.getAsFile();
          if (file) {
            handleImageFile(file);
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  // Handle global drag-drop from GlobalDropZone
  useEffect(() => {
    const handleGlobalDrop = (e: Event) => {
      const files = (e as CustomEvent).detail?.files as File[];
      if (!files || files.length === 0) return;

      // Single image: attach to input bar
      if (files.length === 1 && files[0].type.startsWith('image/')) {
        handleImageFile(files[0]);
        return;
      }

      // Single PDF/doc: treat as document, attach as image for now (SmartInvoiceUploader handles internally)
      if (files.length === 1) {
        handleImageFile(files[0]);
        return;
      }

      // Multiple files: attach first image, show toast about batch
      const imageFiles = files.filter(f => f.type.startsWith('image/'));
      if (imageFiles.length > 0) {
        handleImageFile(imageFiles[0]);
        if (imageFiles.length > 1) {
          showToast(`${imageFiles.length} images dropped — first attached. Use + Capture for batch upload.`, 'info');
        }
      }
    };

    window.addEventListener('nuke:global-drop', handleGlobalDrop);
    return () => window.removeEventListener('nuke:global-drop', handleGlobalDrop);
  }, []);

  const handleImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('Image file too large (max 10MB)');
      return;
    }

    setAttachedImage(file);
    setError(null);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleImageFile(file);
    }
  };

  const removeImage = () => {
    setAttachedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const processInput = async () => {
    const rawText = input.trim();
    const normalizedUrl = normalizeUrlInput(rawText);
    const effectiveText = normalizedUrl || rawText;

    if (!effectiveText && !attachedImage) {
      setError('Please enter text or attach an image');
      return;
    }

    // Wiring should be chat-driven and flexible: do NOT force users into a "query" UX.
    // If on a vehicle page and the message looks wiring-related, open the Wiring Workbench panel instead.
    if (!attachedImage && currentVehicleData && isWiringIntent(effectiveText)) {
      const msg = effectiveText;
      setShowPreview(false);
      setExtractionPreview(null);
      setError(null);
      setActionsOpen(false);
      setInput('');
      setWiringMessages((prev) => [...prev, { role: 'user', text: msg }]);
      await runWiringWorkbench(msg);
      return;
    }

    if (!attachedImage && looksLikeNaturalLanguageSearch(effectiveText)) {
      const searchQuery = effectiveText;
      setInput('');
      setShowPreview(false);
      setExtractionPreview(null);
      setActionsOpen(false);
      setError(null);
      navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
      return;
    }

    // If this is an org website URL, do the fast path immediately (non-LLM intake + queued synopsis).
    if (!attachedImage && normalizedUrl && isLikelyOrgWebsiteUrl(normalizedUrl)) {
      await createOrgFromUrlAndNavigate(normalizedUrl);
      return;
    }

    setIsProcessing(true);
    setError(null);
    setExtractionPreview(null);
    setShowWiringWorkbench(false);

    try {
      const userId = await getCurrentUserId();
      if (!userId) {
        setError('Please log in to use this feature');
        setIsProcessing(false);
        return;
      }

      // ── INGEST FAST-PATH: URLs and VINs ──────────────────────────────
      // Route vehicle listing URLs and VINs through the `ingest` edge
      // function. It handles source detection, dedup, vehicle matching/
      // creation, image attachment, enrichment via dedicated extractors
      // (BaT, C&B, Hagerty), and user discovery linking — all in one call.
      // This replaces the old flow of extract-vehicle-data-ai -> preview
      // -> manual confirm -> dataRouter.

      if (!attachedImage && normalizedUrl && !isLikelyOrgWebsiteUrl(normalizedUrl) && !isProbablyAssetOrDocumentUrl(normalizedUrl)) {
        try {
          const result = await ingestVehicle({ url: normalizedUrl, enrich: true });

          if (result.status === 'error') {
            throw new Error(result.error || 'Ingestion failed');
          }

          if (!result.vehicle_id) {
            throw new Error('Ingestion succeeded but no vehicle_id was returned');
          }

          // Clear UI state and navigate to the vehicle profile
          setInput('');
          setShowPreview(false);
          setExtractionPreview(null);
          setActionsOpen(false);
          setAttachedImage(null);
          setImagePreview(null);
          setError(null);
          setIsProcessing(false);

          const verb = result.status === 'created' ? 'Vehicle created'
            : result.status === 'duplicate' ? 'Vehicle already tracked'
            : 'Vehicle matched';
          const sourceLabel = result.source && result.source !== 'unknown' && result.source !== 'manual'
            ? ` (${result.source.replace(/_/g, ' ')})`
            : '';
          showToast(`${verb}${sourceLabel}`, result.status === 'created' ? 'success' : 'info');
          navigate(`/vehicle/${result.vehicle_id}`);
          return;
        } catch (ingestErr: any) {
          // If ingest fails, fall through to the legacy extraction flow
          // so the user still gets some result.
          console.warn('Ingest fast-path failed, falling back to legacy extraction:', ingestErr.message);
        }
      }

      // VIN fast-path: route through `ingest` for vehicle creation
      if (!attachedImage && !normalizedUrl && isVIN(effectiveText)) {
        try {
          const cleanedVin = effectiveText.replace(/[^A-Z0-9]/gi, '').toUpperCase();
          const result = await ingestVehicle({ vin: cleanedVin });

          if (result.status === 'error') {
            throw new Error(result.error || 'VIN ingestion failed');
          }

          if (!result.vehicle_id) {
            throw new Error('VIN ingestion succeeded but no vehicle_id was returned');
          }

          setInput('');
          setShowPreview(false);
          setExtractionPreview(null);
          setActionsOpen(false);
          setAttachedImage(null);
          setImagePreview(null);
          setError(null);
          setIsProcessing(false);

          const verb = result.is_new_vehicle ? 'Vehicle created from VIN' : 'Vehicle found by VIN';
          showToast(verb, result.is_new_vehicle ? 'success' : 'info');
          navigate(`/vehicle/${result.vehicle_id}`);
          return;
        } catch (vinErr: any) {
          console.warn('VIN ingest fast-path failed, falling back to legacy flow:', vinErr.message);
        }
      }

      // ── END INGEST FAST-PATH ──────────────────────────────────────────

      // Extract data - combine image and text if both provided
      let extractionResult: ExtractionResult;
      if (attachedImage) {
        // Process image with optional text context
        extractionResult = await aiDataIngestion.extractData(attachedImage, userId, rawText || undefined);
      } else {
        // Just text
        extractionResult = await aiDataIngestion.extractData(effectiveText, userId);
      }

      // Handle organization website URLs
      if (extractionResult.inputType === 'url' && extractionResult.rawData?.organization) {
        const org = extractionResult.rawData.organization;
        const exists = extractionResult.rawData.exists;
        const orgId = org?.id;
        
        if (orgId) {
          setInput('');
          setShowPreview(false);
          setExtractionPreview(null);
          setActionsOpen(false);
          setError(null);
          setIsProcessing(false);

          if (exists) {
            showToast(`Organization "${org.name}" already exists`, 'info');
          } else {
            showToast(`Organization "${org.name || 'Unknown'}" has been created`, 'success');
          }

          navigate(`/org/${orgId}`);
          return;
        }
      }

      // Handle organization/garage search queries
      if (extractionResult.inputType === 'org_search') {
        // Navigate to unified search page with search query
        const searchQuery = extractionResult.rawData?.query || effectiveText;
        // Clear input and close preview
        setInput('');
        setShowPreview(false);
        setExtractionPreview(null);
        setIsProcessing(false);
        // Navigate to unified search page
        navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
        return;
      }

      // Handle vehicle/image search queries differently
      if (extractionResult.inputType === 'search') {
        // Navigate to unified search page with search query
        const searchQuery = extractionResult.rawData?.query || effectiveText;
        // Clear input and close preview
        setInput('');
        setShowPreview(false);
        setExtractionPreview(null);
        setIsProcessing(false);
        // Navigate to unified search page
        navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
        return;
      }

      if (extractionResult.errors && extractionResult.errors.length > 0) {
        setError(extractionResult.errors.join(', '));
        setIsProcessing(false);
        return;
      }

      // Handle URLs - check for existing vehicle match first
      if (extractionResult.inputType === 'url' && extractionResult.vehicleData) {
        try {
          // Check if user has a matching vehicle (e.g., 1974 Blazer)
          const { vehicleImageMatcher } = await import('../../services/vehicleImageMatcher');
          
          // Try to find matching vehicle by specs
          const matchingVehicleId = await vehicleImageMatcher.findVehicleBySpecs(
            extractionResult.vehicleData.year || 0,
            extractionResult.vehicleData.make || '',
            extractionResult.vehicleData.model || '',
            userId
          );

          if (matchingVehicleId) {
            // Found potential match - use image matching to verify
            const matchResult = await vehicleImageMatcher.matchListingToVehicle(
              matchingVehicleId,
              effectiveText,
              userId
            );

            if (matchResult.shouldMerge) {
              // Strong match - merge automatically
              showToast(`Vehicle matched and merged! (${(matchResult.matchScore * 100).toFixed(0)}% confidence)`, 'success');
              
              // Clear input
              setInput('');
              setAttachedImage(null);
              setImagePreview(null);
              
              // Navigate to vehicle profile
              setTimeout(() => {
                navigate(`/vehicle/${matchingVehicleId}`);
              }, 500);
              
              setIsProcessing(false);
              return;
            } else if (matchResult.matchScore > 0.5) {
              // Moderate match - show preview with match evidence
              const operationPlan = await dataRouter.generateOperationPlan(
                extractionResult.vehicleData,
                extractionResult.receiptData,
                userId,
                {
                  source: extractionResult.source || 'url',
                  listingUrl: effectiveText,
                  seller: extractionResult.rawData?.seller,
                  location: extractionResult.vehicleData.location
                }
              );
              
              setExtractionPreview({
                result: extractionResult,
                operationPlan,
                matchResult: matchResult,
                existingVehicleId: matchingVehicleId
              });
              // Don't show preview automatically on vehicle profile pages
              if (!vehicleIdFromRoute) {
                setShowPreview(true);
              }
              setIsProcessing(false);
              return;
            }
          }

          // No match found or low confidence - proceed with normal flow
          const operationPlan = await dataRouter.generateOperationPlan(
            extractionResult.vehicleData,
            extractionResult.receiptData,
            userId,
            {
              source: extractionResult.source || 'url',
              listingUrl: effectiveText,
              seller: extractionResult.rawData?.seller,
              location: extractionResult.vehicleData.location
            }
          );
          
          setExtractionPreview({
            result: extractionResult,
            operationPlan
          });
          // Don't show preview automatically on vehicle profile pages
          if (!vehicleIdFromRoute) {
            setShowPreview(true);
          }
          setIsProcessing(false);
          return;
        } catch (err: any) {
          // URL matching failed - fall through to normal flow
          // Fall through to normal flow
        }
      }

      // Generate operation plan if we have vehicle data (non-URL flow)
      // Only proceed if we have required fields (make, model, year)
      let operationPlan: DatabaseOperationPlan | undefined;
      if (extractionResult.vehicleData) {
        const vd = extractionResult.vehicleData;
        if (vd.make && vd.model && vd.year) {
          operationPlan = await dataRouter.generateOperationPlan(
            extractionResult.vehicleData,
            extractionResult.receiptData,
            userId
          );
        } else {
          // If we don't have required fields, treat as search query instead
          const searchQuery = effectiveText;
          setInput('');
          setShowPreview(false);
          setExtractionPreview(null);
          setIsProcessing(false);
          navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
          return;
        }
      }

      setExtractionPreview({
        result: extractionResult,
        operationPlan
      });
      // Don't show preview automatically on vehicle profile pages - user is just browsing
      if (!vehicleIdFromRoute) {
        setShowPreview(true);
      }
    } catch (err: any) {
      // Processing error - fall back to basic search if possible
      // If AI services are down (Gateway/edge function), still allow basic search for text-only input.
      // This keeps "header search" usable even when extraction is unavailable.
      if (!attachedImage && input.trim()) {
        const searchQuery = effectiveText;
        showToast('AI extraction unavailable. Running basic search instead.', 'warning');
        setInput('');
        setShowPreview(false);
        setExtractionPreview(null);
        setActionsOpen(false);
        setError(null);
        navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
        return;
      }

      setError(err?.message || 'Failed to process input');
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmAndSave = async () => {
    setIsProcessing(true);
    setError(null);

    try {
      const userId = await getCurrentUserId();
      if (!userId) {
        setError('Please log in to save data');
        setIsProcessing(false);
        return;
      }

      // Handle vehicle matching/merging
      if (extractionPreview?.matchResult && extractionPreview.existingVehicleId) {
        // Merge with existing vehicle
        const { vehicleImageMatcher } = await import('../../services/vehicleImageMatcher');
        
        // Re-run match to get merge result
        const matchResult = await vehicleImageMatcher.matchListingToVehicle(
          extractionPreview.existingVehicleId,
          input.trim(),
          userId
        );

        if (matchResult.shouldMerge) {
          // Navigate to existing vehicle (merge already happened in edge function)
          showToast(`Vehicle merged successfully!`, 'success');
          navigate(`/vehicle/${extractionPreview.existingVehicleId}`);
        } else {
          setError('Match confidence too low to merge automatically');
          setIsProcessing(false);
          return;
        }
      } else if (extractionPreview?.operationPlan) {
        // Normal flow - create/update vehicle
        const results = await dataRouter.executeOperationPlan(
          extractionPreview.operationPlan,
          userId
        );

        // Navigate to vehicle profile
        navigate(`/vehicle/${results.vehicleId}`);
      } else {
        setError('No operation plan or match result available');
        setIsProcessing(false);
        return;
      }

      // Reset form
      setInput('');
      setAttachedImage(null);
      setImagePreview(null);
      setExtractionPreview(null);
      setShowPreview(false);
    } catch (err: any) {
      // Save error
      setError(err.message || 'Failed to save data');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle autocomplete navigation
    if (showAutocomplete && autocompleteResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedAutocompleteIndex(prev => 
          prev < autocompleteResults.length - 1 ? prev + 1 : prev
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedAutocompleteIndex(prev => prev > 0 ? prev - 1 : -1);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        // If an item is selected, navigate to it
        if (selectedAutocompleteIndex >= 0) {
          const selected = autocompleteResults[selectedAutocompleteIndex];
          handleAutocompleteSelect(selected);
        } else {
          // No item highlighted - close autocomplete and navigate to full search
          setShowAutocomplete(false);
          setSelectedAutocompleteIndex(-1);
          const trimmedInput = input.trim();
          if (trimmedInput && !showPreview) {
            const maybeUrl = normalizeUrlInput(trimmedInput);
            if (!trimmedInput.match(/^[A-HJ-NPR-Z0-9]{17}$/i) && !maybeUrl) {
              // Simple text search - navigate to search page
              navigate(`/search?q=${encodeURIComponent(trimmedInput)}`);
              setInput('');
            } else {
              processInput();
            }
          } else if (showPreview) {
            confirmAndSave();
          }
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowAutocomplete(false);
        setSelectedAutocompleteIndex(-1);
        return;
      }
    }

    // Handle Enter key when autocomplete is not showing or empty
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (!showPreview) {
        const trimmedInput = input.trim();
        const maybeUrl = normalizeUrlInput(trimmedInput);
        // If it's a simple text query (not VIN, not URL), navigate directly to search
        if (trimmedInput && !trimmedInput.match(/^[A-HJ-NPR-Z0-9]{17}$/i) && !maybeUrl) {
          // Simple text search - navigate immediately
          navigate(`/search?q=${encodeURIComponent(trimmedInput)}`);
          setInput('');
          return;
        }
        // Normalize URL-like inputs so the downstream extractor/router sees a real URL.
        if (maybeUrl && maybeUrl !== trimmedInput) {
          setInput(maybeUrl);
        }
        // Otherwise, process through AI extraction
        processInput();
      } else {
        confirmAndSave();
      }
    }
    if (e.key === 'Escape') {
      setShowPreview(false);
      setExtractionPreview(null);
      setActionsOpen(false);
      setShowAutocomplete(false);
    }
  };

  const handleAutocompleteSelect = (result: UniversalSearchResult) => {
    setShowAutocomplete(false);
    setSelectedAutocompleteIndex(-1);
    setAutocompleteAISuggestion(null);

    switch (result.type) {
      case 'vehicle':
      case 'vin_match':
        navigate(`/vehicle/${result.id}`);
        setInput('');
        break;

      case 'organization':
        navigate(`/org/${result.id}`);
        setInput('');
        break;

      case 'user':
        navigate(`/profile/${result.id}`);
        setInput('');
        break;

      case 'external_identity':
        // External identities have id format "external_<uuid>"
        const externalId = result.id.replace('external_', '');
        navigate(`/profile/external/${externalId}`);
        setInput('');
        break;

      case 'tag':
        // Tags navigate to search with that tag as query
        const tagName = result.metadata?.tag || result.title;
        navigate(`/search?q=${encodeURIComponent(tagName)}`);
        setInput('');
        break;

      default:
        // Fallback: set input and let user press Enter
        setInput(result.title);
        break;
    }
  };

  const createOrgFromUrlAndNavigate = async (url: string) => {
    // Guard against re-entry (paste can fire quickly)
    if (isProcessing) return;

    try {
      setIsProcessing(true);
      setError(null);
      setShowAutocomplete(false);
      setSelectedAutocompleteIndex(-1);
      setActionsOpen(false);
      setShowPreview(false);
      setExtractionPreview(null);

      const userId = await getCurrentUserId();
      if (!userId) {
        setError('Please log in to use this feature');
        return;
      }

      const { data, error: fnError } = await supabase.functions.invoke('create-org-from-url', {
        body: {
          url,
          queue_synopsis: true,
          queue_site_mapping: false,
        }
      });

      if (fnError) throw fnError;
      if (!data?.success || !data?.organization_id) {
        throw new Error(data?.error || 'Failed to create organization from URL');
      }

      setInput('');
      setAttachedImage(null);
      setImagePreview(null);

      const created = !!data.created;
      const merged = !!data.merged;
      const createdVisible = created && !merged;
      showToast(createdVisible ? 'Organization created' : 'Organization found', createdVisible ? 'success' : 'info');
      navigate(`/org/${data.organization_id}`);
    } catch (err: any) {
      // Create org from URL failed
      setError(err?.message || 'Failed to create organization from URL');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      ref={containerRef}
      // Keep this above the click-outside backdrop so the input is always focusable/clickable.
      style={{
        position: 'relative',
        zIndex: 1201,
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* Main Input Container - Extended responsive layout */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          background: 'var(--white)',
          border: isDragging ? '2px solid var(--accent)' : '2px solid var(--border)',
          padding: '4px 6px',
          height: '28px',
          transition: 'all 0.12s ease',
          width: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
          overflow: 'hidden'
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Intent badge — shows what the Magic Box thinks the input is */}
        {currentIntent && currentIntent !== 'QUERY' && input.trim() && (
          <span style={{
            flexShrink: 0,
            fontSize: '8px',
            fontFamily: 'Arial, sans-serif',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            padding: '1px 4px',
            border: '1px solid',
            lineHeight: '14px',
            whiteSpace: 'nowrap',
            ...(currentIntent === 'EXACT_URL' ? {
              color: '#D35400',
              borderColor: '#D35400',
              background: '#FDF2E9',
            } : currentIntent === 'EXACT_VIN' ? {
              color: '#8E44AD',
              borderColor: '#8E44AD',
              background: '#F5EEF8',
            } : currentIntent === 'BROWSE' ? {
              color: '#27AE60',
              borderColor: '#27AE60',
              background: '#EAFAF1',
            } : currentIntent === 'NAVIGATE' ? {
              color: '#2980B9',
              borderColor: '#2980B9',
              background: '#EBF5FB',
            } : currentIntent === 'MARKET' ? {
              color: '#E74C3C',
              borderColor: '#E74C3C',
              background: '#FDEDEC',
            } : {
              color: 'var(--text-secondary)',
              borderColor: 'var(--border)',
              background: 'var(--bg)',
            }),
          }}>
            {currentIntent === 'EXACT_URL' && detectedPlatform
              ? detectedPlatform.short
              : currentIntent === 'EXACT_URL'
              ? 'URL'
              : currentIntent === 'EXACT_VIN'
              ? 'VIN'
              : currentIntent === 'BROWSE'
              ? 'BROWSE'
              : currentIntent === 'NAVIGATE'
              ? 'NAV'
              : currentIntent === 'MARKET'
              ? 'MARKET'
              : currentIntent === 'MY_VEHICLES'
              ? 'GARAGE'
              : currentIntent === 'QUESTION'
              ? 'Q&A'
              : currentIntent.replace('_', ' ')}
          </span>
        )}
        <input
          type="text"
          placeholder="SEARCH, PASTE URL, VIN, OR DROP IMAGE..."
          aria-label="Magic Box — search, URL, VIN, or image"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setShowAutocomplete(true);
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData?.getData('text') || '';
            const normalized = normalizeUrlInput(pasted);
            if (!normalized) return;

            // Always normalize URL-like pastes to keep routing deterministic.
            e.preventDefault();
            setInput(normalized);
            setShowAutocomplete(false);
            setSelectedAutocompleteIndex(-1);

            // If it's an org website URL, auto-create immediately (no extra click/enter).
            if (!attachedImage && !showPreview && isLikelyOrgWebsiteUrl(normalized)) {
              void createOrgFromUrlAndNavigate(normalized);
            }
            // If it's a vehicle listing URL, auto-ingest immediately (no extra Enter).
            // Call ingestVehicle directly since processInput() captures stale state.
            else if (!attachedImage && !showPreview && !isLikelyOrgWebsiteUrl(normalized) && !isProbablyAssetOrDocumentUrl(normalized)) {
              void (async () => {
                setIsProcessing(true);
                setError(null);
                try {
                  const result = await ingestVehicle({ url: normalized, enrich: true });
                  if (result.status === 'error' || !result.vehicle_id) {
                    // Fall through — user can press Enter to retry via legacy flow
                    setIsProcessing(false);
                    return;
                  }
                  setInput('');
                  setShowPreview(false);
                  setExtractionPreview(null);
                  setActionsOpen(false);
                  setIsProcessing(false);

                  const verb = result.status === 'created' ? 'Vehicle created'
                    : result.status === 'duplicate' ? 'Vehicle already tracked'
                    : 'Vehicle matched';
                  showToast(verb, result.status === 'created' ? 'success' : 'info');
                  navigate(`/vehicle/${result.vehicle_id}`);
                } catch {
                  setIsProcessing(false);
                }
              })();
            }
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (autocompleteResults.length > 0) {
              setShowAutocomplete(true);
            }
          }}
          onBlur={() => {
            // Delay hiding to allow click on autocomplete items
            setTimeout(() => {
              setShowAutocomplete(false);
              setSelectedAutocompleteIndex(-1);
            }, 200);
          }}
          disabled={isProcessing}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            fontSize: '11px',
            fontFamily: 'Arial, sans-serif',
            background: 'transparent',
            minWidth: '80px',
            maxWidth: 'none',
            height: '100%',
            padding: '0 4px'
          }}
        />

        <button
          type="button"
          onClick={() => setActionsOpen((v) => !v)}
          className="button-win95"
          style={{
            flexShrink: 0,
            padding: '1px 3px',
            fontSize: '9px',
            height: '18px',
            minWidth: '18px',
            width: '18px',
            opacity: 1,
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: '2px',
            boxSizing: 'border-box',
            lineHeight: '1'
          }}
          title={actionsOpen ? 'Hide actions' : 'Show actions'}
        >
          ...
        </button>
      </div>

      {/* ── Magic Box Dropdown ── */}
      {/* Intent: EXACT_URL — extracting banner */}
      {currentIntent === 'EXACT_URL' && isProcessing && input.trim() && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px',
          background: 'var(--white)', border: '2px solid var(--border)', zIndex: 1203,
          fontSize: '11px', fontFamily: 'Arial, sans-serif',
        }}>
          <div style={{
            padding: '12px',
            display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <div style={{
              width: '8px', height: '8px',
              background: '#D35400',
              animation: 'magicbox-pulse 1s ease-in-out infinite',
            }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: '11px', letterSpacing: '0.04em' }}>
                EXTRACTING{detectedPlatform ? ` FROM ${detectedPlatform.label.toUpperCase()}` : ''}...
              </div>
              <div style={{
                fontSize: '9px', color: 'var(--text-secondary)', marginTop: '2px',
                fontFamily: '"Courier New", monospace',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '400px',
              }}>
                {input.trim()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Intent: EXACT_URL — pre-extraction hint (not yet processing) */}
      {currentIntent === 'EXACT_URL' && !isProcessing && input.trim() && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px',
          background: 'var(--white)', border: '2px solid var(--border)', zIndex: 1203,
          fontSize: '11px', fontFamily: 'Arial, sans-serif',
        }}>
          <div style={{
            padding: '10px 12px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#D35400' }}>
                {detectedPlatform ? detectedPlatform.label : 'VEHICLE LISTING'} DETECTED
              </div>
              <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Press ENTER to extract vehicle data
              </div>
            </div>
            <div style={{
              fontSize: '8px', fontWeight: 700, textTransform: 'uppercase',
              padding: '2px 6px', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', fontFamily: '"Courier New", monospace',
            }}>
              ENTER
            </div>
          </div>
        </div>
      )}

      {/* Intent: EXACT_VIN — VIN status panel */}
      {currentIntent === 'EXACT_VIN' && input.trim() && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px',
          background: 'var(--white)', border: '2px solid var(--border)', zIndex: 1203,
          fontSize: '11px', fontFamily: 'Arial, sans-serif',
        }}>
          {vinCheckLoading ? (
            <div style={{ padding: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '8px', height: '8px', background: '#8E44AD',
                animation: 'magicbox-pulse 1s ease-in-out infinite',
              }} />
              <div style={{ fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                CHECKING VIN...
              </div>
            </div>
          ) : vinCheckResult?.exists ? (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (vinCheckResult.vehicleId) {
                  navigate(`/vehicle/${vinCheckResult.vehicleId}`);
                  setInput('');
                }
              }}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 12px',
                background: 'transparent', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontFamily: 'Arial, sans-serif', fontSize: '11px',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', color: '#27AE60', letterSpacing: '0.04em' }}>
                  VIN FOUND
                </div>
                <div style={{ fontSize: '12px', fontWeight: 600, marginTop: '2px' }}>
                  {vinCheckResult.title || 'Vehicle'}
                </div>
                <div style={{
                  fontSize: '9px', fontFamily: '"Courier New", monospace',
                  color: 'var(--text-secondary)', marginTop: '1px',
                }}>
                  {input.trim().toUpperCase()}
                </div>
              </div>
              <div style={{
                fontSize: '8px', fontWeight: 700, textTransform: 'uppercase',
                padding: '2px 6px', border: '1px solid #27AE60', color: '#27AE60',
              }}>
                VIEW
              </div>
            </button>
          ) : (
            <div style={{ padding: '10px 12px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', color: '#8E44AD', letterSpacing: '0.04em' }}>
                    NEW VIN
                  </div>
                  <div style={{
                    fontSize: '11px', fontFamily: '"Courier New", monospace',
                    marginTop: '2px',
                  }}>
                    {input.trim().toUpperCase()}
                  </div>
                </div>
                <div style={{
                  fontSize: '8px', fontWeight: 700, textTransform: 'uppercase',
                  padding: '2px 6px', border: '1px solid #8E44AD', color: '#8E44AD',
                  cursor: 'pointer',
                }}
                  onClick={() => processInput()}
                >
                  DECODE
                </div>
              </div>
              <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Not in database. Press ENTER or click DECODE to create vehicle from VIN.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Intent: BROWSE — make stats panel (shown even if autocomplete is active) */}
      {currentIntent === 'BROWSE' && input.trim() && !isProcessing && (makeStats || makeStatsLoading) && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px',
          background: 'var(--white)', border: '2px solid var(--border)', zIndex: 1203,
          fontSize: '11px', fontFamily: 'Arial, sans-serif',
        }}>
          {makeStatsLoading ? (
            <div style={{ padding: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '8px', height: '8px', background: '#27AE60',
                animation: 'magicbox-pulse 1s ease-in-out infinite',
              }} />
              <span style={{ fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                LOADING STATS...
              </span>
            </div>
          ) : makeStats ? (
            <div style={{ padding: '10px 12px' }}>
              {/* Make header row */}
              <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                marginBottom: '8px',
              }}>
                <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase' }}>
                  {makeStats.make}
                </div>
                <div style={{
                  fontFamily: '"Courier New", monospace', fontSize: '11px',
                  color: 'var(--text-secondary)',
                }}>
                  {makeStats.total.toLocaleString()} VEHICLES
                </div>
              </div>

              {/* Stats row */}
              <div style={{
                display: 'flex', gap: '16px', fontSize: '9px', marginBottom: '8px',
                fontFamily: '"Courier New", monospace', color: 'var(--text-secondary)',
              }}>
                {makeStats.avgPrice && (
                  <span>AVG ${Math.round(makeStats.avgPrice / 1000)}K</span>
                )}
                {makeStats.yearRange && (
                  <span>{makeStats.yearRange.min}--{makeStats.yearRange.max}</span>
                )}
              </div>

              {/* Top models */}
              {makeStats.topModels.length > 0 && (
                <div>
                  <div style={{
                    fontSize: '8px', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.06em', color: 'var(--text-disabled)',
                    marginBottom: '4px',
                  }}>
                    TOP MODELS
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {makeStats.topModels.map((m) => (
                      <button
                        key={m.model}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setInput(`${makeStats.make} ${m.model}`);
                          navigate(`/search?q=${encodeURIComponent(`${makeStats.make} ${m.model}`)}`);
                          setInput('');
                        }}
                        style={{
                          padding: '3px 8px',
                          border: '1px solid var(--border)',
                          background: 'var(--bg)',
                          cursor: 'pointer',
                          fontSize: '10px',
                          fontFamily: 'Arial, sans-serif',
                          display: 'flex', alignItems: 'center', gap: '4px',
                          transition: 'background 0.12s',
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{m.model}</span>
                        <span style={{
                          fontFamily: '"Courier New", monospace',
                          fontSize: '9px', color: 'var(--text-secondary)',
                        }}>
                          {m.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Browse all */}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  navigate(`/search?q=${encodeURIComponent(input.trim())}`);
                  setInput('');
                }}
                style={{
                  width: '100%', textAlign: 'left', marginTop: '8px',
                  padding: '6px 0', border: 'none', borderTop: '1px solid var(--border)',
                  background: 'transparent', cursor: 'pointer',
                  fontSize: '10px', fontWeight: 600, color: 'var(--accent)',
                  fontFamily: 'Arial, sans-serif',
                }}
              >
                BROWSE ALL {makeStats.make.toUpperCase()} ({makeStats.total.toLocaleString()})
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* Standard autocomplete dropdown — for QUERY and other text intents */}
      {showAutocomplete && autocompleteResults.length > 0 && currentIntent !== 'EXACT_URL' && currentIntent !== 'EXACT_VIN' && !(currentIntent === 'BROWSE' && (makeStats || makeStatsLoading)) && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '2px',
            background: 'var(--white)',
            border: '2px solid var(--border)', zIndex: 1203,
            maxHeight: '420px',
            overflowY: 'auto',
            fontSize: '11px',
            fontFamily: 'Arial, sans-serif',
          }}
        >
          {/* AI Suggestion banner */}
          {autocompleteAISuggestion && autocompleteResults.length === 0 && (
            <div style={{
              padding: '10px 12px',
              background: 'var(--accent)',
              color: 'var(--bg)',
              fontSize: '11px',
              borderBottom: '1px solid var(--border-light)'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>AI Assistant</div>
              <div>{autocompleteAISuggestion}</div>
            </div>
          )}

          {/* Rich results with thumbnails */}
          {autocompleteResults.map((result, index) => {
            const typeColors: Record<string, string> = {
              vehicle: 'var(--accent)',
              organization: 'var(--success)',
              user: '#9c27b0',
              tag: 'var(--warning)',
              external_identity: '#00bcd4',
              vin_match: 'var(--error)'
            };

            return (
              <div
                key={`${result.type}-${result.id}`}
                onClick={() => handleAutocompleteSelect(result as any)}
                onMouseEnter={() => setSelectedAutocompleteIndex(index)}
                style={{
                  padding: '6px 10px',
                  cursor: 'pointer',
                  background: selectedAutocompleteIndex === index ? 'var(--accent-dim, #e3f2fd)' : 'transparent',
                  borderBottom: '1px solid var(--border-light)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'background 0.1s',
                }}
              >
                {/* Thumbnail */}
                <div style={{
                  width: '36px',
                  height: '36px',
                  background: result.image_url ? `url(${result.image_url}) center/cover` : 'var(--border)',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  border: '1px solid var(--border-light)',
                  color: 'var(--text-disabled)',
                  fontWeight: 700,
                  fontFamily: 'Arial, sans-serif',
                }}>
                  {!result.image_url && (
                    result.type === 'vehicle' ? 'V' :
                    result.type === 'organization' ? 'O' :
                    result.type === 'user' ? 'U' :
                    result.type === 'vin_match' ? '#' :
                    result.type === 'tag' ? 'T' : '?'
                  )}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                  <div style={{
                    fontWeight: 600,
                    color: 'var(--text)',
                    fontSize: '11px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {result.title}
                  </div>
                  {result.subtitle && (
                    <div style={{
                      fontSize: '9px',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontFamily: '"Courier New", monospace',
                    }}>
                      {result.subtitle}
                    </div>
                  )}
                </div>

                {/* Price if vehicle */}
                {result.metadata?.price && (
                  <div style={{
                    fontSize: '10px',
                    fontFamily: '"Courier New", monospace',
                    fontWeight: 600,
                    color: 'var(--text)',
                    flexShrink: 0,
                  }}>
                    ${typeof result.metadata.price === 'number'
                      ? (result.metadata.price >= 1000
                        ? `${Math.round(result.metadata.price / 1000)}K`
                        : result.metadata.price.toLocaleString())
                      : result.metadata.price}
                  </div>
                )}

                {/* Type badge */}
                <div style={{
                  fontSize: '7px',
                  color: typeColors[result.type] || 'var(--text-disabled)',
                  border: `1px solid ${typeColors[result.type] || 'var(--border)'}`,
                  padding: '1px 4px',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  flexShrink: 0,
                  letterSpacing: '0.02em',
                }}>
                  {result.type.replace('_', ' ')}
                </div>
              </div>
            );
          })}

          {/* AI suggestion at bottom when we have results but few */}
          {autocompleteAISuggestion && autocompleteResults.length > 0 && autocompleteResults.length < 3 && (
            <div style={{
              padding: '6px 12px',
              background: 'var(--bg)',
              color: 'var(--text-secondary)',
              fontSize: '9px',
              borderTop: '1px solid var(--border-light)',
              fontFamily: 'Arial, sans-serif',
            }}>
              {autocompleteAISuggestion}
            </div>
          )}

          {autocompleteResults.length > 0 && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const queryText = input.trim();
                if (!queryText) return;
                navigate(`/search?q=${encodeURIComponent(queryText)}`);
                setInput('');
              }}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                background: 'var(--bg)',
                border: 'none',
                borderTop: '1px solid var(--border)',
                fontSize: '10px',
                cursor: 'pointer',
                fontFamily: 'Arial, sans-serif',
                fontWeight: 600,
                color: 'var(--accent)',
              }}
            >
              {autocompleteTotalCount && autocompleteTotalCount > autocompleteResults.length
                ? `VIEW ALL ${autocompleteTotalCount.toLocaleString()} RESULTS`
                : `VIEW ALL RESULTS FOR "${input.trim().toUpperCase()}"`}
            </button>
          )}
        </div>
      )}

      {/* Actions Menu (Win95-style) */}
      {actionsOpen && (
        <div
          style={{
            position: 'absolute',
            top: '30px',
            right: 0,
            background: 'var(--white)',
            border: '2px solid var(--border)', padding: '6px',
            zIndex: 1200,
            display: 'flex',
            gap: '6px',
            alignItems: 'center'
          }}
        >
          {/* Critique Button (when on vehicle page) */}
          {currentVehicleData && (
            <button
              type="button"
              onClick={() => setShowCritique(!showCritique)}
              className="button-win95"
              style={{
                padding: '2px 6px',
                fontSize: '11px',
                height: '20px',
                minWidth: 'auto',
                opacity: 1,
                background: showCritique ? 'var(--border)' : 'var(--white)',
                whiteSpace: 'nowrap'
              }}
              title="Open critique mode to provide feedback on this vehicle"
            >
              CRIT
            </button>
          )}

          {/* Image Attachment Button */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept="image/*"
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            className="button-win95"
            style={{
              padding: '2px 6px',
              fontSize: '11px',
              height: '20px',
              minWidth: '40px',
              opacity: isProcessing ? 0.5 : 1
            }}
            title="Attach image"
          >
            IMG
          </button>

          {/* Process/Submit Button */}
          {!showPreview ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setActionsOpen(false);
                setShowAutocomplete(false);
                processInput();
              }}
              disabled={isProcessing || (!input.trim() && !attachedImage)}
              className="button-win95"
              style={{
                padding: '2px 8px',
                fontSize: '11px',
                height: '20px',
                minWidth: '35px',
                opacity: (isProcessing || (!input.trim() && !attachedImage)) ? 0.5 : 1
              }}
              title="Process input"
            >
              {isProcessing ? '...' : 'GO'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setActionsOpen(false);
                confirmAndSave();
              }}
              disabled={isProcessing}
              className="button-win95"
              style={{
                padding: '2px 8px',
                fontSize: '11px',
                height: '20px',
                minWidth: '35px',
                opacity: isProcessing ? 0.5 : 1
              }}
              title="Confirm and save"
            >
              {isProcessing ? '...' : 'OK'}
            </button>
          )}
        </div>
      )}

      {/* Image Preview */}
      {imagePreview && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: '4px',
          background: 'var(--white)',
          border: '2px solid var(--border)',
          padding: '8px',
          zIndex: 1000,
          display: 'flex',
          gap: '8px',
          alignItems: 'center'
        }}>
          <img
            src={imagePreview}
            alt="Preview"
            style={{
              width: '60px',
              height: '60px',
              objectFit: 'cover',
              border: '1px solid var(--border)'
            }}
          />
          <div style={{ flex: 1, fontSize: '11px' }}>
            {attachedImage?.name}
          </div>
          <button
            type="button"
            onClick={removeImage}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: '13px',
              padding: '2px 4px'
            }}
            title="Remove image"
          >
            X
          </button>
        </div>
      )}

      {/* Extraction Preview - Hidden on vehicle profile pages */}
      {showPreview && extractionPreview && !vehicleIdFromRoute && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: '4px',
          background: 'var(--white)',
          border: '2px solid var(--border)',
          padding: '12px',
          zIndex: 1202,
          maxHeight: '400px',
          overflowY: 'auto'}}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '8px' }}>
            Extracted Data Preview
          </div>

          {extractionPreview.result.vehicleData && (
            <div style={{ marginBottom: '12px', fontSize: '11px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Vehicle:</div>
              <div style={{ paddingLeft: '8px' }}>
                {extractionPreview.result.vehicleData.year && (
                  <div>{extractionPreview.result.vehicleData.year}</div>
                )}
                {extractionPreview.result.vehicleData.make && (
                  <div>{extractionPreview.result.vehicleData.make}</div>
                )}
                {extractionPreview.result.vehicleData.model && (
                  <div>{extractionPreview.result.vehicleData.model}</div>
                )}
                {extractionPreview.result.vehicleData.vin && (
                  <div>VIN: {extractionPreview.result.vehicleData.vin}</div>
                )}
                {extractionPreview.result.vehicleData.mileage && (
                  <div>Mileage: {extractionPreview.result.vehicleData.mileage.toLocaleString()} mi</div>
                )}
              </div>
            </div>
          )}

          {/* Vehicle Match Results */}
          {extractionPreview.matchResult && extractionPreview.existingVehicleId && (
            <div style={{ 
              marginBottom: '12px', 
              fontSize: '11px',
              background: extractionPreview.matchResult.shouldMerge ? 'var(--success-dim)' : 'var(--warning-dim)',
              border: `2px solid ${extractionPreview.matchResult.shouldMerge ? 'var(--success)' : 'var(--warning)'}`,
              padding: '8px'}}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                {extractionPreview.matchResult.shouldMerge ? 'STRONG MATCH FOUND' : 'POTENTIAL MATCH'}
              </div>
              <div style={{ paddingLeft: '8px', fontSize: '9px' }}>
                <div>Match Score: {(extractionPreview.matchResult.matchScore * 100).toFixed(0)}%</div>
                {extractionPreview.matchResult.evidence.length > 0 && (
                  <div style={{ marginTop: '4px' }}>
                    <div style={{ fontWeight: 'bold' }}>Evidence:</div>
                    {extractionPreview.matchResult.evidence.slice(0, 3).map((evidence, idx) => (
                      <div key={idx} style={{ paddingLeft: '8px', fontSize: '9px', color: 'var(--text-secondary)' }}>
                        • {evidence.matchType}: {evidence.details}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Organization Preview */}
          {extractionPreview.result.rawData?.organization && (
            <div style={{ marginBottom: '12px', fontSize: '11px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                {extractionPreview.result.rawData.exists ? 'Organization Found' : 'Organization Created'}
              </div>
              <div style={{ paddingLeft: '8px' }}>
                <div style={{ fontWeight: 'bold' }}>
                  {extractionPreview.result.rawData.organization.name}
                </div>
                {extractionPreview.result.rawData.organization.website && (
                  <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {extractionPreview.result.rawData.organization.website}
                  </div>
                )}
                {extractionPreview.result.rawData.organization.description && (
                  <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    {extractionPreview.result.rawData.organization.description}
                  </div>
                )}
                {extractionPreview.result.rawData.organization.id && (
                  <div style={{ marginTop: '8px' }}>
                    <button
                      type="button"
                      onClick={() => {
                        navigate(`/org/${extractionPreview.result.rawData.organization.id}`);
                        setShowPreview(false);
                        setInput('');
                      }}
                      className="button button-primary"
                      style={{ fontSize: '11px', padding: '4px 8px' }}
                    >
                      View Organization
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {extractionPreview.result.receiptData && !extractionPreview.result.vehicleData && (
            <div style={{ marginBottom: '12px', fontSize: '11px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Receipt:</div>
              <div style={{ paddingLeft: '8px' }}>
                {extractionPreview.result.receiptData.vendor && (
                  <div>Vendor: {extractionPreview.result.receiptData.vendor}</div>
                )}
                {extractionPreview.result.receiptData.total && (
                  <div>Total: ${extractionPreview.result.receiptData.total.toLocaleString()}</div>
                )}
              </div>
            </div>
          )}

          {extractionPreview.operationPlan && (
            <div style={{ marginBottom: '12px', fontSize: '11px', color: 'var(--text-secondary)' }}>
              {extractionPreview.operationPlan.vehicleOperation.isNew 
                ? 'Will create new vehicle profile'
                : 'Will update existing vehicle profile'}
            </div>
          )}

          {extractionPreview.result.provider && (
            <div style={{ marginTop: '8px', fontSize: '9px', color: 'var(--text-disabled)' }}>
              Processed with {extractionPreview.result.provider}
              {extractionPreview.result.model && ` / ${extractionPreview.result.model}`}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button
              type="button"
              onClick={confirmAndSave}
              disabled={isProcessing}
              className="button button-primary"
              style={{ fontSize: '11px', padding: '4px 8px' }}
            >
              Confirm & Save
            </button>
            <button
              type="button"
              onClick={() => {
                setShowPreview(false);
                setExtractionPreview(null);
              }}
              className="button button-secondary"
              style={{ fontSize: '11px', padding: '4px 8px' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Vehicle Critique Mode */}
      {showCritique && currentVehicleData && (
        <VehicleCritiqueMode
          isVisible={showCritique}
          onClose={() => setShowCritique(false)}
          vehicleId={currentVehicleData.id}
          vehicleData={currentVehicleData}
        />
      )}

      {/* Wiring Workbench (chat-like) */}
      {showWiringWorkbench && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: '4px',
          background: 'var(--white)',
          border: '2px solid var(--border)',
          padding: '10px',
          zIndex: 1202,
          maxHeight: '360px',
          overflowY: 'auto', fontSize: '11px',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.35
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ fontWeight: 'bold' }}>Wiring Workbench</div>
            <button
              type="button"
              className="button-win95"
              style={{ padding: '2px 6px', fontSize: '11px', height: '20px' }}
              onClick={() => setShowWiringWorkbench(false)}
              title="Close"
            >
              X
            </button>
          </div>

          <div style={{ display: 'grid', gap: '8px' }}>
            {wiringMessages.slice(-6).map((m, idx) => (
              <div key={idx} style={{
                padding: '8px',
                border: '1px solid var(--border)',
                background: m.role === 'user' ? 'var(--grey-50)' : 'var(--white)'
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{m.role === 'user' ? 'You' : 'AI'}</div>
                <div>{m.text}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {currentVehicleData?.id && (
              <button
                type="button"
                className="button-win95"
                style={{ padding: '2px 8px', fontSize: '11px', height: '20px' }}
                onClick={() => setShowWiringUploader(true)}
                title="Upload receipts/manuals so the workbench can prove parts + extract pinouts"
              >
                Upload receipt/manual
              </button>
            )}
            {currentVehicleData?.id && (
              <button
                type="button"
                className="button-win95"
                style={{ padding: '2px 8px', fontSize: '11px', height: '20px' }}
                onClick={() => navigate(`/vehicle/${currentVehicleData.id}/wiring`)}
                title="Open full Wiring Plan page (long-form output)"
              >
                Open Wiring Plan
              </button>
            )}
          </div>
        </div>
      )}

      {showWiringUploader && currentVehicleData?.id && (
        <SmartInvoiceUploader
          vehicleId={currentVehicleData.id}
          onClose={() => setShowWiringUploader(false)}
          onSaved={() => {
            // After saving docs, re-run a fresh evidence check so the next chat step adapts.
            setShowWiringUploader(false);
            setWiringMessages((prev) => [...prev, { role: 'assistant', text: 'Got it. I saved that document. Re-checking evidence…' }]);
             
            runWiringWorkbench('evidence refresh');
          }}
        />
      )}

      {/* Error Message */}
      {error && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: '4px',
          background: 'var(--error-dim)',
          border: '2px solid var(--error)',
          padding: '8px',
          fontSize: '11px',
          color: 'var(--error)',
          zIndex: 1202
        }}>
          {error}
        </div>
      )}

      {/* Click outside to close */}
      {/* Outside-click handling is done via window mousedown listener so the page stays usable */}

      {/* Animation keyframes for Magic Box indicators */}
      <style>{`
        @keyframes magicbox-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
