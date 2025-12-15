import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase, getCurrentUserId } from '../../lib/supabase';
import { aiDataIngestion, type ExtractionResult } from '../../services/aiDataIngestion';
import { dataRouter, type DatabaseOperationPlan } from '../../services/dataRouter';
import { useToast } from '../../hooks/useToast';
import VehicleCritiqueMode from './VehicleCritiqueMode';
import { SmartInvoiceUploader } from '../SmartInvoiceUploader';
import '../../design-system.css';

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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();

  const vehicleIdFromRoute = useMemo(() => {
    const m = location.pathname.match(/\/vehicle\/([a-f0-9-]{36})/);
    return m ? m[1] : null;
  }, [location.pathname]);

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
    if (!input.trim() && !attachedImage) {
      setError('Please enter text or attach an image');
      return;
    }

    // Wiring should be chat-driven and flexible: do NOT force users into a "query" UX.
    // If on a vehicle page and the message looks wiring-related, open the Wiring Workbench panel instead.
    if (!attachedImage && currentVehicleData && isWiringIntent(input.trim())) {
      const msg = input.trim();
      setShowPreview(false);
      setExtractionPreview(null);
      setError(null);
      setActionsOpen(false);
      setInput('');
      setWiringMessages((prev) => [...prev, { role: 'user', text: msg }]);
      await runWiringWorkbench(msg);
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

      // Extract data - combine image and text if both provided
      let extractionResult: ExtractionResult;
      if (attachedImage) {
        // Process image with optional text context
        extractionResult = await aiDataIngestion.extractData(attachedImage, userId, input.trim() || undefined);
      } else {
        // Just text
        extractionResult = await aiDataIngestion.extractData(input, userId);
      }

      // Handle organization/garage search queries
      if (extractionResult.inputType === 'org_search') {
        // Navigate to unified search page with search query
        const searchQuery = extractionResult.rawData?.query || input;
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
        const searchQuery = extractionResult.rawData?.query || input;
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
              input.trim(),
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
                  listingUrl: input.trim(),
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
              setShowPreview(true);
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
              listingUrl: input.trim(),
              seller: extractionResult.rawData?.seller,
              location: extractionResult.vehicleData.location
            }
          );
          
          setExtractionPreview({
            result: extractionResult,
            operationPlan
          });
          setShowPreview(true);
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
          const searchQuery = input.trim();
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
      setShowPreview(true);
    } catch (err: any) {
      console.error('Processing error:', err);
      // If AI services are down (Gateway/edge function), still allow basic search for text-only input.
      // This keeps "header search" usable even when extraction is unavailable.
      if (!attachedImage && input.trim()) {
        const searchQuery = input.trim();
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!showPreview) {
        processInput();
      } else {
        confirmAndSave();
      }
    }
    if (e.key === 'Escape') {
      setShowPreview(false);
      setExtractionPreview(null);
      setActionsOpen(false);
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
          minWidth: 0
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          type="text"
          placeholder=""
          aria-label="AI input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
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
            padding: 0
          }}
        />

        <button
          type="button"
          onClick={() => setActionsOpen((v) => !v)}
          className="button-win95"
          style={{
            padding: '2px 6px',
            fontSize: '8pt',
            height: '20px',
            minWidth: '26px',
            opacity: 1,
            whiteSpace: 'nowrap'
          }}
          title={actionsOpen ? 'Hide actions' : 'Show actions'}
        >
          ...
        </button>
      </div>

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
              onClick={() => {
                setActionsOpen(false);
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

      {/* Extraction Preview */}
      {showPreview && extractionPreview && (
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

