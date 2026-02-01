/**
 * Price Fix Button Component
 * 
 * Shows a button on vehicle profile to trigger automatic price fix
 * Appears when price issues are detected
 */

import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface PriceFixButtonProps {
  vehicleId: string;
  batUrl?: string | null;
  salePrice?: number | null;
  batSoldPrice?: number | null;
  onFixed?: () => void;
}

export const PriceFixButton: React.FC<PriceFixButtonProps> = ({
  vehicleId,
  batUrl,
  salePrice,
  batSoldPrice,
  onFixed,
}) => {
  const [fixing, setFixing] = useState(false);
  const [status, setStatus] = useState<'idle' | 'fixing' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  // Check if price fix is needed
  const needsFix = batUrl && (salePrice === 0 || !batSoldPrice);

  if (!needsFix) {
    return null;
  }

  const handleFix = async () => {
    setFixing(true);
    setStatus('fixing');
    setMessage('Fixing price data...');

    try {
      const { data, error } = await supabase.functions.invoke('auto-fix-bat-prices', {
        body: {
          vehicle_id: vehicleId,
          action: 'check_and_fix',
        },
      });

      if (error) throw error;

      if (data?.result?.status === 'fixed') {
        setStatus('success');
        setMessage(`✅ Fixed! Price updated to $${data.result.bat_price?.toLocaleString()}`);
        onFixed?.();
        
        // Refresh after 2 seconds
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else if (data?.result?.status === 'ok') {
        setStatus('success');
        setMessage('✅ No issues found - price is correct');
      } else {
        setStatus('error');
        setMessage(data?.result?.reason || 'Could not fix price');
      }
    } catch (error: any) {
      console.error('Price fix error:', error);
      setStatus('error');
      setMessage(error.message || 'Failed to fix price');
    } finally {
      setFixing(false);
    }
  };

  return (
    <div
      style={{
        padding: '8px 12px',
        background: status === 'success' ? '#10b981' : status === 'error' ? '#ef4444' : '#f59e0b',
        color: 'white',
        borderRadius: '4px',
        fontSize: '10pt',
        marginBottom: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
      }}
    >
      <div style={{ flex: 1 }}>
        {status === 'idle' && (
          <>
            <strong>⚠️ Price Data Issue Detected</strong>
            <div style={{ fontSize: '9pt', opacity: 0.9, marginTop: '2px' }}>
              {salePrice === 0 && 'Sale price is $0'}
              {!batSoldPrice && 'BaT price is missing'}
            </div>
          </>
        )}
        {status === 'fixing' && <span>🔧 Fixing price data...</span>}
        {status === 'success' && <span>{message}</span>}
        {status === 'error' && <span>{message}</span>}
      </div>
      
      {status === 'idle' && (
        <button
          onClick={handleFix}
          disabled={fixing}
          style={{
            padding: '4px 12px',
            background: 'var(--surface)',
            color: '#f59e0b',
            border: 'none',
            borderRadius: '4px',
            cursor: fixing ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            fontSize: '9pt',
          }}
        >
          {fixing ? 'Fixing...' : 'Auto-Fix'}
        </button>
      )}
    </div>
  );
};

