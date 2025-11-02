import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Props {
  vehicleId: string;
  onComplete?: () => void;
}

const ReprocessEXIFButton: React.FC<Props> = ({ vehicleId, onComplete }) => {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleReprocess = async () => {
    if (!confirm('Re-scan all images for correct dates from EXIF data? This may take a minute.')) {
      return;
    }

    setProcessing(true);
    setResult(null);

    try {
      const { data: funcData, error: funcError } = await supabase.functions.invoke('reprocess-image-exif', {
        body: { vehicleId }
      });

      if (funcError) throw funcError;

      setResult(`✅ Fixed ${funcData.fixed || 0} images, ${funcData.failed || 0} failed`);
      
      if (onComplete) {
        setTimeout(() => {
          onComplete();
        }, 1500);
      }
    } catch (error: any) {
      console.error('EXIF reprocess error:', error);
      setResult(`❌ Error: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '4px' }}>
      <button
        onClick={handleReprocess}
        disabled={processing}
        style={{
          padding: '6px 12px',
          fontSize: '8pt',
          fontWeight: 700,
          border: '1px solid var(--border)',
          background: 'white',
          color: 'var(--text)',
          cursor: processing ? 'wait' : 'pointer',
          borderRadius: '4px',
          opacity: processing ? 0.6 : 1
        }}
      >
        {processing ? 'SCANNING...' : 'RE-SCAN EXIF DATES'}
      </button>
      {result && (
        <div style={{ fontSize: '7pt', color: result.startsWith('✅') ? '#10b981' : '#ef4444' }}>
          {result}
        </div>
      )}
    </div>
  );
};

export default ReprocessEXIFButton;

