import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase, getCurrentUserId } from '../../lib/supabase';
import { aiDataIngestion, type ExtractionResult } from '../../services/aiDataIngestion';
import { dataRouter, type DatabaseOperationPlan } from '../../services/dataRouter';
import { useToast } from '../../hooks/useToast';
import VehicleCritiqueMode from './VehicleCritiqueMode';
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();

  // Auto-detect vehicle page and load data
  useEffect(() => {
    const detectVehiclePage = async () => {
      const path = location.pathname;
      const vehicleMatch = path.match(/\/vehicle\/([a-f0-9-]{36})/);

      if (vehicleMatch) {
        const vehicleId = vehicleMatch[1];

        // Auto-populate the input with the current URL
        const currentUrl = `${window.location.origin}${path}`;
        setInput(currentUrl);

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
        // Clear auto-populated data when not on vehicle page
        if (input.includes('/vehicle/')) {
          setInput('');
        }
        setCurrentVehicleData(null);
      }
    };

    detectVehiclePage();
  }, [location.pathname]);

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

    setIsProcessing(true);
    setError(null);
    setExtractionPreview(null);

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
      setError(err.message || 'Failed to process input');
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
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
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
          placeholder={currentVehicleData ? "Critique this vehicle..." : (attachedImage ? "Add context..." : "VIN, URL, text...")}
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
            minWidth: 0,
            maxWidth: 'none',
            height: '100%',
            padding: 0
          }}
        />

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
            {showCritique ? 'CRIT' : 'CRIT'}
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
          {attachedImage ? 'IMG' : 'IMG'}
        </button>

        {/* Process/Submit Button */}
        {!showPreview ? (
          <button
            type="button"
            onClick={processInput}
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
            onClick={confirmAndSave}
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
            ✕
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
          zIndex: 1000,
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
                {extractionPreview.matchResult.shouldMerge ? '✓ Strong Match Found' : '⚠ Potential Match'}
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
          zIndex: 1000
        }}>
          {error}
        </div>
      )}

      {/* Click outside to close */}
      {(showPreview || imagePreview || error || showCritique) && (
        <div
          onClick={() => {
            setShowPreview(false);
            setError(null);
            setShowCritique(false);
          }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999
          }}
        />
      )}
    </div>
  );
}

