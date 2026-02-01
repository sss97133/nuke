/**
 * VaultScanPage - Document Scanner PWA Entry Point
 *
 * Route: /vault/scan?token=xxx
 *
 * This page handles the Tier 2 (Private Mode) document scanning flow:
 * 1. User receives SMS with link containing session token
 * 2. Opens this page on their phone
 * 3. Scans document using camera
 * 4. OCR runs on-device (image never leaves phone)
 * 5. Only extracted text sent to server
 */

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import DocumentScanner from '../components/vault-scanner/DocumentScanner';

type Stage = 'loading' | 'invalid' | 'scanning' | 'success' | 'error';

interface SuccessData {
  vehicle?: {
    id: string;
    year?: number;
    make?: string;
    model?: string;
    vin: string;
  };
  vin: string;
}

export default function VaultScanPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [stage, setStage] = useState<Stage>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<SuccessData | null>(null);

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setStage('invalid');
      setErrorMessage('No session token provided. Please use the link from your SMS.');
      return;
    }

    if (!token.startsWith('pwa_')) {
      setStage('invalid');
      setErrorMessage('Invalid session token format.');
      return;
    }

    // Token looks valid, proceed to scanning
    setStage('scanning');
  }, [token]);

  const handleSuccess = (data: SuccessData) => {
    setSuccessData(data);
    setStage('success');
  };

  const handleError = (error: string) => {
    setErrorMessage(error);
    setStage('error');
  };

  const handleRetry = () => {
    setErrorMessage(null);
    setStage('scanning');
  };

  // Loading state
  if (stage === 'loading') {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#000',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '3px solid #333',
            borderTopColor: '#3b82f6',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px',
          }} />
          <p style={{ color: '#888' }}>Loading...</p>
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  // Invalid token state
  if (stage === 'invalid') {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#000',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}>
        <div style={{ textAlign: 'center', maxWidth: '400px' }}>
          <div style={{
            width: '64px',
            height: '64px',
            background: '#2a1a1a',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
          }}>
            <span style={{ fontSize: '32px' }}>!</span>
          </div>
          <h1 style={{ fontSize: '20px', marginBottom: '12px' }}>Invalid Link</h1>
          <p style={{ color: '#888', marginBottom: '24px' }}>{errorMessage}</p>
          <p style={{ fontSize: '14px', color: '#666' }}>
            Text a document photo to get a new link.
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (stage === 'error') {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#000',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}>
        <div style={{ textAlign: 'center', maxWidth: '400px' }}>
          <div style={{
            width: '64px',
            height: '64px',
            background: '#2a1a1a',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
          }}>
            <span style={{ fontSize: '32px' }}>!</span>
          </div>
          <h1 style={{ fontSize: '20px', marginBottom: '12px' }}>Something Went Wrong</h1>
          <p style={{ color: '#f87171', marginBottom: '24px' }}>{errorMessage}</p>
          <button
            onClick={handleRetry}
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
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Success state
  if (stage === 'success' && successData) {
    const vehicle = successData.vehicle;
    const vehicleDesc = vehicle?.year && vehicle?.make
      ? `${vehicle.year} ${vehicle.make} ${vehicle.model || ''}`
      : 'Vehicle';

    return (
      <div style={{
        minHeight: '100vh',
        background: '#000',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}>
        <div style={{ textAlign: 'center', maxWidth: '400px' }}>
          <div style={{
            width: '80px',
            height: '80px',
            background: '#1a2e1a',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
          }}>
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#22c55e"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <h1 style={{ fontSize: '24px', marginBottom: '8px' }}>Success!</h1>
          <p style={{ color: '#22c55e', fontSize: '18px', marginBottom: '24px' }}>
            {vehicleDesc} verified
          </p>

          <div style={{
            background: '#111',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '24px',
            textAlign: 'left',
          }}>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', color: '#888' }}>VIN</label>
              <p style={{ fontFamily: 'monospace', fontSize: '14px' }}>{successData.vin}</p>
            </div>
            {vehicle?.year && (
              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '12px', color: '#888' }}>Year</label>
                <p>{vehicle.year}</p>
              </div>
            )}
          </div>

          <div style={{
            background: '#1a2e1a',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '24px',
          }}>
            <p style={{ fontSize: '14px', color: '#22c55e' }}>
              Your document was processed privately. The image never left your device.
            </p>
          </div>

          <p style={{ fontSize: '14px', color: '#666' }}>
            You'll receive an SMS confirmation shortly. You can close this page.
          </p>
        </div>
      </div>
    );
  }

  // Scanning state
  return (
    <DocumentScanner
      sessionToken={token!}
      onSuccess={handleSuccess}
      onError={handleError}
    />
  );
}
