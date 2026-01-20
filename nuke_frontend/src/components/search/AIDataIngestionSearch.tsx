import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase, getCurrentUserId } from '../../lib/supabase';
import { aiDataIngestion, type ExtractionResult } from '../../services/aiDataIngestion';
import { dataRouter, type DatabaseOperationPlan } from '../../services/dataRouter';
import { useToast } from '../../hooks/useToast';
import VehicleCritiqueMode from './VehicleCritiqueMode';
import { SmartInvoiceUploader } from '../SmartInvoiceUploader';
import '../../design-system.css';

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

  // Autocomplete state
  const [autocompleteResults, setAutocompleteResults] = useState<Array<{
    id: string;
    title: string;
    type: 'vehicle' | 'organization' | 'vin' | 'url';
    subtitle?: string;
  }>>([]);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [selectedAutocompleteIndex, setSelectedAutocompleteIndex] = useState(-1);
  const autocompleteDebounceRef = useRef<NodeJS.Timeout | null>(null);

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

  // Autocomplete as user types
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
      setShowAutocomplete(false);
      return;
    }

    // Check if it's a URL or VIN (don't autocomplete these)
    const isURL = !!normalizeUrlInput(trimmedInput);
    const isVIN = /^[A-HJ-NPR-Z0-9]{11,17}$/i.test(trimmedInput.replace(/[^A-Z0-9]/gi, ''));
    
    if (isURL || isVIN) {
      setAutocompleteResults([]);
      setShowAutocomplete(false);
      return;
    }

    autocompleteDebounceRef.current = setTimeout(async () => {
      try {
        const escapeILike = (s: string) => String(s || '').replace(/([%_\\])/g, '\\$1');
        const searchLower = trimmedInput.toLowerCase();
        const searchLowerSafe = escapeILike(searchLower);

        const results: Array<{
          id: string;
          title: string;
          type: 'vehicle' | 'organization' | 'vin' | 'url';
          subtitle?: string;
        }> = [];

        // Search vehicles - PostgREST doesn't support type casting in or filters
        // So we search year separately if it's a number, otherwise use text search
        let vehicleQuery = supabase
          .from('vehicles')
          .select('id, year, make, model, vin')
          .eq('is_public', true);
        
        // Check if search term is a 4-digit year
        const yearMatch = searchLower.match(/^\d{4}$/);
        if (yearMatch) {
          const year = parseInt(yearMatch[0]);
          vehicleQuery = vehicleQuery.or(`make.ilike.%${searchLowerSafe}%,model.ilike.%${searchLowerSafe}%,vin.ilike.%${searchLowerSafe}%,year.eq.${year}`);
        } else {
          vehicleQuery = vehicleQuery.or(`make.ilike.%${searchLowerSafe}%,model.ilike.%${searchLowerSafe}%,vin.ilike.%${searchLowerSafe}%`);
        }
        
        const { data: vehicles } = await vehicleQuery.limit(5);

        if (vehicles) {
          vehicles.forEach((v: any) => {
            const title = `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'Vehicle';
            results.push({
              id: v.id,
              title,
              type: 'vehicle',
              subtitle: v.vin ? `VIN: ${v.vin}` : undefined,
            });
          });
        }

        // Search organizations
        const { data: orgs } = await supabase
          .from('businesses')
          .select('id, business_name, website')
          .eq('is_public', true)
          .ilike('business_name', `%${searchLowerSafe}%`)
          .limit(3);

        if (orgs) {
          orgs.forEach((o: any) => {
            results.push({
              id: o.id,
              title: o.business_name,
              type: 'organization',
              subtitle: o.website ? new URL(o.website).hostname : undefined,
            });
          });
        }

        setAutocompleteResults(results);
        setShowAutocomplete(results.length > 0);
        setSelectedAutocompleteIndex(-1);
      } catch (error) {
        console.error('Autocomplete error:', error);
        setAutocompleteResults([]);
        setShowAutocomplete(false);
      }
    }, 300); // 300ms debounce

    return () => {
      if (autocompleteDebounceRef.current) {
        clearTimeout(autocompleteDebounceRef.current);
      }
    };
  }, [input, isProcessing, attachedImage, showPreview]);

  const isWiringIntent = (text: string) => {
    const t = (text || '').toLowerCase();
    if (!t) return false;
    // Keep this permissive; chat will ask clarifying questions anyway.
    return (
      t.includes('wiring') ||
      t.includes('harness') ||
      t.includes('pdm') ||
      t.includes('ecu') ||
      t.includes('pinout') ||
      t.includes('bulkhead') ||
      t.includes('motec') ||
      t.includes('loom') ||
      t.includes('awg') ||
      t.includes('can ') ||
      t.includes('canbus') ||
      t.includes('can-bus')
    );
  };

  const looksLikeNaturalLanguageSearch = (text: string) => {
    const t = (text || '').trim().toLowerCase();
    if (!t) return false;

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
      questions.push(`I don’t see any receipts/invoices attached to this vehicle yet. Do you want to upload them now so I can build the parts inventory from proof?`);
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
          console.warn('Failed to load vehicle data for critique:', error);
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

    console.log('processInput called', { input: effectiveText, hasImage: !!attachedImage, isProcessing });
    
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

      // Fast-path: Mecum lot URLs should instantly create/update a profile and navigate.
      // This bypasses the "preview/operation plan" flow and matches the desired share-a-link UX.
      if (!attachedImage && normalizedUrl && isMecumLotUrl(normalizedUrl)) {
        const { data, error: fnError } = await supabase.functions.invoke('extract-premium-auction', {
          body: {
            url: normalizedUrl,
            max_vehicles: 1,
          }
        });

        if (fnError) throw fnError;

        const vehicleId =
          (data as any)?.created_vehicle_ids?.[0] ||
          (data as any)?.updated_vehicle_ids?.[0] ||
          null;

        if (!vehicleId) {
          throw new Error((data as any)?.error || 'Import succeeded but no vehicle_id was returned');
        }

        // Clear UI state and navigate to the new profile
        setInput('');
        setShowPreview(false);
        setExtractionPreview(null);
        setActionsOpen(false);
        setAttachedImage(null);
        setImagePreview(null);
        setError(null);
        setIsProcessing(false);

        showToast('Mecum lot imported → profile ready', 'success');
        navigate(`/vehicle/${vehicleId}`);
        return;
      }

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
            console.log(`Found potential match: ${matchingVehicleId}, verifying with image analysis...`);
            
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
          console.error('URL matching error:', err);
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
      console.error('Processing error:', err);
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
      console.error('Save error:', err);
      setError(err.message || 'Failed to save data');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    console.log('handleKeyDown', { key: e.key, showAutocomplete, autocompleteResultsLength: autocompleteResults.length, selectedIndex: selectedAutocompleteIndex });
    
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
          // Otherwise, close autocomplete and process input
          setShowAutocomplete(false);
          setSelectedAutocompleteIndex(-1);
          // Process input directly
          if (!showPreview) {
            processInput();
          } else {
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
      console.log('Enter pressed, processing input', { showPreview, input: input.trim() });
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

  const handleAutocompleteSelect = (result: { id: string; type: string; title: string }) => {
    setShowAutocomplete(false);
    setSelectedAutocompleteIndex(-1);
    
    if (result.type === 'vehicle') {
      navigate(`/vehicle/${result.id}`);
      setInput('');
    } else if (result.type === 'organization') {
      navigate(`/org/${result.id}`);
      setInput('');
    } else {
      // For VIN or URL, just set the input
      setInput(result.title);
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
      console.error('Create org from URL error:', err);
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
          border: isDragging ? '2px solid #0ea5e9' : '2px solid var(--border)',
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
        <input
          type="text"
          placeholder="VIN, URL, search query, or image..."
          aria-label="AI input"
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
            fontSize: '8pt',
            fontFamily: '"MS Sans Serif", sans-serif',
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
            fontSize: '7pt',
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

      {/* Autocomplete Dropdown */}
      {showAutocomplete && autocompleteResults.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '4px',
            background: 'var(--white)',
            border: '2px solid var(--border)',
            boxShadow: '2px 2px 8px rgba(0,0,0,0.2)',
            zIndex: 1203,
            maxHeight: '300px',
            overflowY: 'auto',
            fontSize: '8pt'
          }}
        >
          {autocompleteResults.map((result, index) => (
            <div
              key={`${result.type}-${result.id}`}
              onClick={() => handleAutocompleteSelect(result)}
              onMouseEnter={() => setSelectedAutocompleteIndex(index)}
              style={{
                padding: '6px 8px',
                cursor: 'pointer',
                background: selectedAutocompleteIndex === index ? '#e3f2fd' : 'transparent',
                borderBottom: '1px solid var(--border-light)',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
              }}
            >
              <div style={{ fontWeight: 'bold', color: result.type === 'vehicle' ? '#1976d2' : '#388e3c' }}>
                {result.title}
              </div>
              {result.subtitle && (
                <div style={{ fontSize: '7pt', color: '#666' }}>
                  {result.subtitle}
                </div>
              )}
              <div style={{ fontSize: '7pt', color: '#999', textTransform: 'uppercase' }}>
                {result.type}
              </div>
            </div>
          ))}
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
            border: '2px solid var(--border)',
            boxShadow: '2px 2px 8px rgba(0,0,0,0.2)',
            padding: '6px',
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
                fontSize: '8pt',
                height: '20px',
                minWidth: 'auto',
                opacity: 1,
                background: showCritique ? '#c0c0c0' : 'var(--white)',
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
              fontSize: '8pt',
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
                console.log('GO button clicked', { input: input.trim(), hasImage: !!attachedImage, isProcessing });
                setActionsOpen(false);
                setShowAutocomplete(false);
                processInput();
              }}
              disabled={isProcessing || (!input.trim() && !attachedImage)}
              className="button-win95"
              style={{
                padding: '2px 8px',
                fontSize: '8pt',
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
                fontSize: '8pt',
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
          <div style={{ flex: 1, fontSize: '8pt' }}>
            {attachedImage?.name}
          </div>
          <button
            type="button"
            onClick={removeImage}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: '10pt',
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
          overflowY: 'auto',
          boxShadow: '2px 2px 8px rgba(0,0,0,0.2)'
        }}>
          <div style={{ fontSize: '9pt', fontWeight: 'bold', marginBottom: '8px' }}>
            Extracted Data Preview
          </div>

          {extractionPreview.result.vehicleData && (
            <div style={{ marginBottom: '12px', fontSize: '8pt' }}>
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
              fontSize: '8pt',
              background: extractionPreview.matchResult.shouldMerge ? '#e8f5e9' : '#fff3cd',
              border: `2px solid ${extractionPreview.matchResult.shouldMerge ? '#4caf50' : '#ffc107'}`,
              padding: '8px',
              borderRadius: '2px'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                {extractionPreview.matchResult.shouldMerge ? 'STRONG MATCH FOUND' : 'POTENTIAL MATCH'}
              </div>
              <div style={{ paddingLeft: '8px', fontSize: '7pt' }}>
                <div>Match Score: {(extractionPreview.matchResult.matchScore * 100).toFixed(0)}%</div>
                {extractionPreview.matchResult.evidence.length > 0 && (
                  <div style={{ marginTop: '4px' }}>
                    <div style={{ fontWeight: 'bold' }}>Evidence:</div>
                    {extractionPreview.matchResult.evidence.slice(0, 3).map((evidence, idx) => (
                      <div key={idx} style={{ paddingLeft: '8px', fontSize: '7pt', color: '#666' }}>
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
            <div style={{ marginBottom: '12px', fontSize: '8pt' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                {extractionPreview.result.rawData.exists ? 'Organization Found' : 'Organization Created'}
              </div>
              <div style={{ paddingLeft: '8px' }}>
                <div style={{ fontWeight: 'bold' }}>
                  {extractionPreview.result.rawData.organization.name}
                </div>
                {extractionPreview.result.rawData.organization.website && (
                  <div style={{ fontSize: '7pt', color: '#666', marginTop: '2px' }}>
                    {extractionPreview.result.rawData.organization.website}
                  </div>
                )}
                {extractionPreview.result.rawData.organization.description && (
                  <div style={{ fontSize: '7pt', color: '#666', marginTop: '4px', fontStyle: 'italic' }}>
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
                      style={{ fontSize: '8pt', padding: '4px 8px' }}
                    >
                      View Organization
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {extractionPreview.result.receiptData && !extractionPreview.result.vehicleData && (
            <div style={{ marginBottom: '12px', fontSize: '8pt' }}>
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
            <div style={{ marginBottom: '12px', fontSize: '8pt', color: '#666' }}>
              {extractionPreview.operationPlan.vehicleOperation.isNew 
                ? 'Will create new vehicle profile'
                : 'Will update existing vehicle profile'}
            </div>
          )}

          {extractionPreview.result.provider && (
            <div style={{ marginTop: '8px', fontSize: '7pt', color: '#999', fontStyle: 'italic' }}>
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
              style={{ fontSize: '8pt', padding: '4px 8px' }}
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
              style={{ fontSize: '8pt', padding: '4px 8px' }}
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
          overflowY: 'auto',
          boxShadow: '2px 2px 8px rgba(0,0,0,0.2)',
          fontSize: '8pt',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.35
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ fontWeight: 'bold' }}>Wiring Workbench</div>
            <button
              type="button"
              className="button-win95"
              style={{ padding: '2px 6px', fontSize: '8pt', height: '20px' }}
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
                style={{ padding: '2px 8px', fontSize: '8pt', height: '20px' }}
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
                style={{ padding: '2px 8px', fontSize: '8pt', height: '20px' }}
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
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
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
          background: '#fee',
          border: '2px solid #fcc',
          padding: '8px',
          fontSize: '8pt',
          color: '#c00',
          zIndex: 1202
        }}>
          {error}
        </div>
      )}

      {/* Click outside to close */}
      {/* Outside-click handling is done via window mousedown listener so the page stays usable */}
    </div>
  );
}

