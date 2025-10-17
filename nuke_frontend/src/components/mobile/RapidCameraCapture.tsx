import React, { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { ImageUploadService } from '../../services/imageUploadService';
import { extractImageMetadata } from '../../utils/imageMetadata';
import '../../design-system.css';

interface CaptureContext {
  lastVehicleId?: string;
  lastVehicleName?: string;
  activeWorkSession?: string;
  captureCount: number;
  lastCaptureTime?: Date;
}

interface GuardrailSettings {
  autoDetectVIN: boolean;
  useRecentContext: boolean;
  useGPSLocation: boolean;
  batchSimilarPhotos: boolean;
  privacyMode: 'none' | 'blur_plates' | 'full';
}

const RapidCameraCapture: React.FC = () => {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureContext, setCaptureContext] = useState<CaptureContext>({
    captureCount: 0
  });
  const [recentCaptures, setRecentCaptures] = useState<string[]>([]);
  const [guardrails, setGuardrails] = useState<GuardrailSettings>({
    autoDetectVIN: true,
    useRecentContext: true,
    useGPSLocation: false,
    batchSimilarPhotos: true,
    privacyMode: 'none'
  });
  const [showSettings, setShowSettings] = useState(false);

  // Load context on mount
  useEffect(() => {
    loadCaptureContext();
  }, [user]);

  const loadCaptureContext = async () => {
    if (!user) return;

    try {
      // Get last viewed vehicle from local storage or recent activity
      const lastVehicle = localStorage.getItem('lastViewedVehicle');
      if (lastVehicle) {
        const vehicleData = JSON.parse(lastVehicle);
        setCaptureContext(prev => ({
          ...prev,
          lastVehicleId: vehicleData.id,
          lastVehicleName: `${vehicleData.year} ${vehicleData.make} ${vehicleData.model}`
        }));
      }

      // Check for active work session
      const { data: workSession } = await supabase
        .from('work_sessions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single();

      if (workSession) {
        setCaptureContext(prev => ({
          ...prev,
          activeWorkSession: workSession.id
        }));
      }
    } catch (error) {
      console.error('Error loading context:', error);
    }
  };

  const handleCapture = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0 || !user) return;

    setIsCapturing(true);
    const capturedUrls: string[] = [];

    try {
      for (const file of Array.from(files)) {
        // Extract metadata for intelligent filing
        const metadata = await extractImageMetadata(file);
        
        // Determine target vehicle based on guardrails
        let targetVehicleId = await determineTargetVehicle(file, metadata);
        
        if (!targetVehicleId && captureContext.lastVehicleId) {
          // Use recent context if no vehicle determined
          targetVehicleId = captureContext.lastVehicleId;
        }

        if (targetVehicleId) {
          // Upload to determined vehicle
          const result = await ImageUploadService.uploadImage(
            targetVehicleId,
            file,
            determineCategory(metadata)
          );

          if (result.success && result.imageUrl) {
            capturedUrls.push(result.imageUrl);
            
            // Update capture context
            setCaptureContext(prev => ({
              ...prev,
              captureCount: prev.captureCount + 1,
              lastCaptureTime: new Date()
            }));
          }
        } else {
          // Queue for later filing if no target determined
          await queueForLaterFiling(file, metadata);
        }
      }

      // Update recent captures for preview
      setRecentCaptures(prev => [...capturedUrls, ...prev].slice(0, 5));

      // Show success feedback
      showFeedback(`${files.length} photo${files.length > 1 ? 's' : ''} captured!`);

    } catch (error) {
      console.error('Capture error:', error);
      showFeedback('Failed to capture photos', 'error');
    } finally {
      setIsCapturing(false);
    }
  }, [user, captureContext, guardrails]);

  const determineTargetVehicle = async (file: File, metadata: any): Promise<string | null> => {
    // AI-powered vehicle detection based on guardrails
    if (guardrails.autoDetectVIN && metadata.text?.includes('VIN')) {
      // Extract and match VIN
      const vinMatch = metadata.text.match(/[A-Z0-9]{17}/);
      if (vinMatch) {
        const { data: vehicle } = await supabase
          .from('vehicles')
          .select('id')
          .eq('vin', vinMatch[0])
          .single();
        
        if (vehicle) return vehicle.id;
      }
    }

    // GPS-based detection
    if (guardrails.useGPSLocation && metadata.gps) {
      // Check if GPS matches known work locations
      // This would integrate with shop locations or frequent work spots
    }

    return null;
  };

  const determineCategory = (metadata: any): string => {
    // Intelligent categorization based on image content
    if (metadata.text?.toLowerCase().includes('receipt')) return 'receipt';
    if (metadata.text?.toLowerCase().includes('title')) return 'document';
    if (metadata.isCloseUp) return 'detail';
    if (metadata.showsMultipleParts) return 'overview';
    return 'general';
  };

  const queueForLaterFiling = async (file: File, metadata: any) => {
    // Store in local queue for batch processing
    const queueKey = `imageQueue_${user?.id}`;
    const queue = JSON.parse(localStorage.getItem(queueKey) || '[]');
    
    queue.push({
      timestamp: new Date().toISOString(),
      fileName: file.name,
      metadata: metadata,
      // Store file as base64 for offline capability
      fileData: await fileToBase64(file)
    });

    localStorage.setItem(queueKey, JSON.stringify(queue));
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const showFeedback = (message: string, type: 'success' | 'error' = 'success') => {
    // Simple feedback mechanism - could be enhanced with toast notifications
    const feedback = document.createElement('div');
    feedback.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: ${type === 'success' ? '#4caf50' : '#f44336'};
      color: white;
      padding: 12px 24px;
      border-radius: 4px;
      font-size: 8pt;
      z-index: 9999;
    `;
    feedback.textContent = message;
    document.body.appendChild(feedback);
    
    setTimeout(() => {
      feedback.remove();
    }, 3000);
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: 1000
    }}>
      {/* Main Camera Button */}
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={isCapturing}
        style={{
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          background: isCapturing ? '#757575' : '#424242',
          color: 'white',
          border: 'none',
          fontSize: '24px',
          cursor: isCapturing ? 'not-allowed' : 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s'
        }}
      >
        {isCapturing ? '⏳' : '📷'}
      </button>

      {/* Hidden file input with camera capture */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={(e) => handleCapture(e.target.files)}
        style={{ display: 'none' }}
      />

      {/* Context indicator */}
      {captureContext.lastVehicleName && (
        <div style={{
          position: 'absolute',
          bottom: '70px',
          right: '0',
          background: 'rgba(66, 66, 66, 0.9)',
          color: 'white',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '7pt',
          whiteSpace: 'nowrap',
          maxWidth: '200px',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          📍 {captureContext.lastVehicleName}
        </div>
      )}

      {/* Settings toggle */}
      <button
        onClick={() => setShowSettings(!showSettings)}
        style={{
          position: 'absolute',
          top: '-30px',
          right: '0',
          width: '30px',
          height: '30px',
          borderRadius: '50%',
          background: '#616161',
          color: 'white',
          border: 'none',
          fontSize: '14px',
          cursor: 'pointer'
        }}
      >
        ⚙️
      </button>

      {/* Recent captures preview */}
      {recentCaptures.length > 0 && (
        <div style={{
          position: 'absolute',
          bottom: '0',
          right: '70px',
          display: 'flex',
          gap: '4px'
        }}>
          {recentCaptures.slice(0, 3).map((url, index) => (
            <div
              key={index}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '4px',
                overflow: 'hidden',
                border: '2px solid white',
                boxShadow: '0 1px 4px rgba(0,0,0,0.2)'
              }}
            >
              <img 
                src={url} 
                alt={`Recent ${index + 1}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Capture count badge */}
      {captureContext.captureCount > 0 && (
        <div style={{
          position: 'absolute',
          top: '-5px',
          right: '-5px',
          background: '#f44336',
          color: 'white',
          borderRadius: '50%',
          width: '24px',
          height: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '10px',
          fontWeight: 'bold'
        }}>
          {captureContext.captureCount}
        </div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div style={{
          position: 'absolute',
          bottom: '70px',
          right: '0',
          background: 'white',
          border: '1px solid #bdbdbd',
          borderRadius: '4px',
          padding: '12px',
          width: '250px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '8pt' }}>Capture Settings</h4>
          
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '8pt' }}>
            <input
              type="checkbox"
              checked={guardrails.autoDetectVIN}
              onChange={(e) => setGuardrails(prev => ({ ...prev, autoDetectVIN: e.target.checked }))}
            />
            Auto-detect VIN
          </label>

          <label style={{ display: 'block', marginBottom: '4px', fontSize: '8pt' }}>
            <input
              type="checkbox"
              checked={guardrails.useRecentContext}
              onChange={(e) => setGuardrails(prev => ({ ...prev, useRecentContext: e.target.checked }))}
            />
            Use recent vehicle
          </label>

          <label style={{ display: 'block', marginBottom: '4px', fontSize: '8pt' }}>
            <input
              type="checkbox"
              checked={guardrails.batchSimilarPhotos}
              onChange={(e) => setGuardrails(prev => ({ ...prev, batchSimilarPhotos: e.target.checked }))}
            />
            Batch similar photos
          </label>

          <div style={{ marginTop: '8px', fontSize: '8pt' }}>
            <label>Privacy Mode:</label>
            <select
              value={guardrails.privacyMode}
              onChange={(e) => setGuardrails(prev => ({ ...prev, privacyMode: e.target.value as any }))}
              style={{ width: '100%', fontSize: '8pt', marginTop: '2px' }}
            >
              <option value="none">None</option>
              <option value="blur_plates">Blur License Plates</option>
              <option value="full">Full Privacy</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
};

export default RapidCameraCapture;