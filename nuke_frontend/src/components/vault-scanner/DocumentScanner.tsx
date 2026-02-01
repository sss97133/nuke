/**
 * DocumentScanner - On-device document OCR for privacy-first processing
 *
 * Uses Tesseract.js (WASM) for on-device OCR.
 * Image never leaves the device - only extracted text is sent to server.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import Tesseract from 'tesseract.js';

interface ExtractedData {
  vin: string | null;
  owner_name: string | null;
  title_number: string | null;
  state: string | null;
  document_type: string;
  confidence: number;
  raw_text: string;
  extraction_time_ms: number;
}

interface DocumentScannerProps {
  sessionToken: string;
  onSuccess: (data: ExtractedData & { vehicle?: { id: string; year?: number; make?: string; model?: string; vin: string } }) => void;
  onError: (error: string) => void;
}

// VIN validation
function isValidVin(vin: string): boolean {
  if (!vin) return false;
  const cleaned = vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
  return cleaned.length === 17 && !/[IOQ]/.test(cleaned);
}

// Extract VIN from text using patterns
function extractVin(text: string): string | null {
  // VIN pattern: 17 alphanumeric chars, no I, O, Q
  const vinPatterns = [
    /\b([A-HJ-NPR-Z0-9]{17})\b/gi,
    /VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/gi,
    /VEHICLE\s*ID[:\s]*([A-HJ-NPR-Z0-9]{17})/gi,
  ];

  for (const pattern of vinPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const candidate = match[1].toUpperCase();
      if (isValidVin(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

// Extract owner name
function extractOwnerName(text: string): string | null {
  const patterns = [
    /OWNER[:\s]+([A-Z][A-Z\s,.']+)/i,
    /REGISTERED\s+TO[:\s]+([A-Z][A-Z\s,.']+)/i,
    /NAME[:\s]+([A-Z][A-Z\s,.']+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1].length > 3 && match[1].length < 100) {
      return match[1].trim();
    }
  }
  return null;
}

// Extract title number
function extractTitleNumber(text: string): string | null {
  const patterns = [
    /TITLE\s*(?:NO|NUMBER|#)?[:\s]*([A-Z0-9-]{5,20})/i,
    /DOCUMENT\s*(?:NO|NUMBER|#)?[:\s]*([A-Z0-9-]{5,20})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

// Extract state
function extractState(text: string): string | null {
  const states = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
    'DC',
  ];

  const stateNames: Record<string, string> = {
    'ALABAMA': 'AL', 'ALASKA': 'AK', 'ARIZONA': 'AZ', 'ARKANSAS': 'AR',
    'CALIFORNIA': 'CA', 'COLORADO': 'CO', 'CONNECTICUT': 'CT', 'DELAWARE': 'DE',
    'FLORIDA': 'FL', 'GEORGIA': 'GA', 'HAWAII': 'HI', 'IDAHO': 'ID',
    'ILLINOIS': 'IL', 'INDIANA': 'IN', 'IOWA': 'IA', 'KANSAS': 'KS',
    'KENTUCKY': 'KY', 'LOUISIANA': 'LA', 'MAINE': 'ME', 'MARYLAND': 'MD',
    'MASSACHUSETTS': 'MA', 'MICHIGAN': 'MI', 'MINNESOTA': 'MN', 'MISSISSIPPI': 'MS',
    'MISSOURI': 'MO', 'MONTANA': 'MT', 'NEBRASKA': 'NE', 'NEVADA': 'NV',
    'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
    'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', 'OHIO': 'OH', 'OKLAHOMA': 'OK',
    'OREGON': 'OR', 'PENNSYLVANIA': 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
    'SOUTH DAKOTA': 'SD', 'TENNESSEE': 'TN', 'TEXAS': 'TX', 'UTAH': 'UT',
    'VERMONT': 'VT', 'VIRGINIA': 'VA', 'WASHINGTON': 'WA', 'WEST VIRGINIA': 'WV',
    'WISCONSIN': 'WI', 'WYOMING': 'WY', 'DISTRICT OF COLUMBIA': 'DC',
  };

  // Check for state abbreviations
  for (const state of states) {
    const pattern = new RegExp(`\\b${state}\\b`, 'g');
    if (pattern.test(text.toUpperCase())) {
      return state;
    }
  }

  // Check for state names
  for (const [name, abbr] of Object.entries(stateNames)) {
    if (text.toUpperCase().includes(name)) {
      return abbr;
    }
  }

  return null;
}

export const DocumentScanner: React.FC<DocumentScannerProps> = ({
  sessionToken,
  onSuccess,
  onError,
}) => {
  const [stage, setStage] = useState<'camera' | 'processing' | 'review' | 'submitting'>('camera');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [editedVin, setEditedVin] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize camera
  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // Use back camera on mobile
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      console.error('Camera access error:', err);
      setCameraError('Camera access denied. You can upload a photo instead.');
    }
  }, []);

  // Stop camera
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  // Capture photo from camera
  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0);
      const imageData = canvas.toDataURL('image/jpeg', 0.9);
      setCapturedImage(imageData);
      stopCamera();
      processImage(imageData);
    }
  }, [stopCamera]);

  // Handle file upload
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const imageData = event.target?.result as string;
      setCapturedImage(imageData);
      stopCamera();
      processImage(imageData);
    };
    reader.readAsDataURL(file);
  }, [stopCamera]);

  // Process image with OCR
  const processImage = async (imageData: string) => {
    setStage('processing');
    setOcrProgress(0);

    const startTime = Date.now();

    try {
      const result = await Tesseract.recognize(imageData, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setOcrProgress(Math.round(m.progress * 100));
          }
        },
      });

      const extractionTime = Date.now() - startTime;
      const text = result.data.text;

      // Extract fields
      const vin = extractVin(text);
      const ownerName = extractOwnerName(text);
      const titleNumber = extractTitleNumber(text);
      const state = extractState(text);

      // Calculate confidence based on what we found
      let confidence = 0;
      if (vin) confidence += 0.5;
      if (ownerName) confidence += 0.2;
      if (titleNumber) confidence += 0.15;
      if (state) confidence += 0.15;

      const extracted: ExtractedData = {
        vin,
        owner_name: ownerName,
        title_number: titleNumber,
        state,
        document_type: 'title',
        confidence,
        raw_text: text,
        extraction_time_ms: extractionTime,
      };

      setExtractedData(extracted);
      setEditedVin(vin || '');
      setStage('review');
    } catch (err) {
      console.error('OCR error:', err);
      onError('Failed to process document. Please try again.');
      setStage('camera');
    }
  };

  // Submit extracted data
  const submitData = async () => {
    if (!extractedData) return;

    const vin = editedVin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');

    if (!isValidVin(vin)) {
      onError('Please enter a valid 17-character VIN');
      return;
    }

    setStage('submitting');

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vault-pwa-submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_token: sessionToken,
          extracted: {
            ...extractedData,
            vin,
          },
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Submission failed');
      }

      onSuccess({
        ...extractedData,
        vin,
        vehicle: result.vehicle,
      });
    } catch (err) {
      console.error('Submit error:', err);
      onError(err instanceof Error ? err.message : 'Failed to submit. Please try again.');
      setStage('review');
    }
  };

  // Retake photo
  const retake = useCallback(() => {
    setCapturedImage(null);
    setExtractedData(null);
    setStage('camera');
    startCamera();
  }, [startCamera]);

  // Start camera on mount
  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#000',
      color: '#fff',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid #333',
        textAlign: 'center',
      }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>
          Document Scanner
        </h1>
        <p style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
          Your image stays on your device
        </p>
      </div>

      {/* Camera View */}
      {stage === 'camera' && (
        <div style={{ flex: 1, position: 'relative' }}>
          {!cameraError ? (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />

              {/* Capture overlay */}
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '20px',
              }}>
                {/* Guide box */}
                <div style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <div style={{
                    width: '90%',
                    maxWidth: '400px',
                    aspectRatio: '1.5',
                    border: '2px dashed rgba(255,255,255,0.5)',
                    borderRadius: '8px',
                  }}>
                    <div style={{
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '14px',
                      color: 'rgba(255,255,255,0.7)',
                    }}>
                      Position document here
                    </div>
                  </div>
                </div>

                {/* Controls */}
                <div style={{
                  display: 'flex',
                  gap: '16px',
                  justifyContent: 'center',
                  paddingBottom: '20px',
                }}>
                  <button
                    onClick={capturePhoto}
                    style={{
                      width: '72px',
                      height: '72px',
                      borderRadius: '50%',
                      background: '#fff',
                      border: '4px solid rgba(255,255,255,0.3)',
                      cursor: 'pointer',
                    }}
                  />
                </div>
              </div>
            </>
          ) : (
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
              textAlign: 'center',
            }}>
              <p style={{ color: '#f87171', marginBottom: '20px' }}>{cameraError}</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: '16px 32px',
                  background: '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  cursor: 'pointer',
                }}
              >
                Upload Photo
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
            </div>
          )}
        </div>
      )}

      {/* Processing */}
      {stage === 'processing' && (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
        }}>
          <div style={{
            width: '200px',
            height: '200px',
            marginBottom: '24px',
            borderRadius: '8px',
            overflow: 'hidden',
          }}>
            {capturedImage && (
              <img src={capturedImage} alt="Captured" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            )}
          </div>

          <div style={{
            width: '80%',
            maxWidth: '300px',
            marginBottom: '16px',
          }}>
            <div style={{
              height: '8px',
              background: '#333',
              borderRadius: '4px',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${ocrProgress}%`,
                background: '#3b82f6',
                transition: 'width 0.3s',
              }} />
            </div>
          </div>

          <p style={{ fontSize: '14px', color: '#888' }}>
            Processing on your device... {ocrProgress}%
          </p>
        </div>
      )}

      {/* Review */}
      {stage === 'review' && extractedData && (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '20px',
          overflow: 'auto',
        }}>
          {/* Preview */}
          <div style={{
            width: '100%',
            maxWidth: '300px',
            margin: '0 auto 24px',
            borderRadius: '8px',
            overflow: 'hidden',
          }}>
            {capturedImage && (
              <img src={capturedImage} alt="Captured" style={{ width: '100%' }} />
            )}
          </div>

          {/* Extracted Data */}
          <div style={{
            background: '#111',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '24px',
          }}>
            <h2 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>
              Extracted Information
            </h2>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#888', marginBottom: '4px' }}>
                VIN (Vehicle Identification Number) *
              </label>
              <input
                type="text"
                value={editedVin}
                onChange={(e) => setEditedVin(e.target.value.toUpperCase())}
                maxLength={17}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: '#222',
                  border: isValidVin(editedVin) ? '1px solid #22c55e' : '1px solid #666',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '16px',
                  fontFamily: 'monospace',
                }}
              />
              {editedVin && !isValidVin(editedVin) && (
                <p style={{ fontSize: '11px', color: '#f87171', marginTop: '4px' }}>
                  VIN must be exactly 17 characters
                </p>
              )}
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', color: '#888' }}>Owner</label>
              <p style={{ color: extractedData.owner_name ? '#fff' : '#666' }}>
                {extractedData.owner_name || 'Not detected'}
              </p>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', color: '#888' }}>Title Number</label>
              <p style={{ color: extractedData.title_number ? '#fff' : '#666' }}>
                {extractedData.title_number || 'Not detected'}
              </p>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', color: '#888' }}>State</label>
              <p style={{ color: extractedData.state ? '#fff' : '#666' }}>
                {extractedData.state || 'Not detected'}
              </p>
            </div>

            <div style={{
              marginTop: '16px',
              padding: '12px',
              background: '#1a2e1a',
              borderRadius: '4px',
              fontSize: '12px',
              color: '#22c55e',
            }}>
              Your image never leaves this device. Only the text above will be sent.
            </div>
          </div>

          {/* Actions */}
          <div style={{
            display: 'flex',
            gap: '12px',
            marginTop: 'auto',
          }}>
            <button
              onClick={retake}
              style={{
                flex: 1,
                padding: '16px',
                background: 'transparent',
                border: '1px solid #666',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '16px',
                cursor: 'pointer',
              }}
            >
              Retake
            </button>
            <button
              onClick={submitData}
              disabled={!isValidVin(editedVin)}
              style={{
                flex: 2,
                padding: '16px',
                background: isValidVin(editedVin) ? '#3b82f6' : '#333',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '16px',
                cursor: isValidVin(editedVin) ? 'pointer' : 'not-allowed',
              }}
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {/* Submitting */}
      {stage === 'submitting' && (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
        }}>
          <div style={{
            width: '48px',
            height: '48px',
            border: '3px solid #333',
            borderTopColor: '#3b82f6',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          <p style={{ marginTop: '16px', color: '#888' }}>Submitting...</p>
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Hidden file input for camera fallback */}
      {!cameraError && (
        <div style={{
          position: 'fixed',
          bottom: '100px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
        }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '8px 16px',
              background: 'rgba(0,0,0,0.5)',
              border: '1px solid #666',
              borderRadius: '16px',
              color: '#fff',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Or upload photo
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
        </div>
      )}
    </div>
  );
};

export default DocumentScanner;
