import React, { useState } from 'react';
import { WorkSessionAnalyzer } from '../../services/workSessionAnalyzer';

interface CleanupPhotoEventsButtonProps {
  vehicleId: string;
  isOwner: boolean;
}

/**
 * One-time cleanup button to convert existing "Photo Added" spam into intelligent work sessions
 * 
 * Run this once per vehicle to:
 * 1. Group all existing photos by upload session
 * 2. Analyze with AI what work was performed
 * 3. Replace 100+ "Photo Added" events with 5-10 meaningful work session events
 */
export const CleanupPhotoEventsButton: React.FC<CleanupPhotoEventsButtonProps> = ({
  vehicleId,
  isOwner
}) => {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  if (!isOwner) return null;

  const handleCleanup = async () => {
    if (!confirm(
      'This will analyze all your photos with AI and replace individual "Photo Added" events with intelligent work session summaries. Continue?'
    )) {
      return;
    }

    setProcessing(true);
    setResult(null);

    try {
      const response = await WorkSessionAnalyzer.reprocessExistingPhotoEvents(vehicleId);

      if (response.success) {
        setResult(
          `✅ Success! Created ${response.sessionsCreated} work session events and removed ${response.eventsRemoved} redundant "Photo Added" entries.`
        );
        
        // Refresh timeline
        window.dispatchEvent(new CustomEvent('vehicle_timeline_updated', { 
          detail: { vehicleId } 
        }));
      } else {
        setResult('❌ Cleanup failed. Please try again.');
      }
    } catch (error) {
      console.error('Cleanup error:', error);
      setResult('❌ Error during cleanup.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div style={{ 
      padding: '12px', 
      background: 'var(--grey-50)', 
      border: '1px solid var(--border)',
      borderRadius: '2px',
      marginBottom: '12px'
    }}>
      <div style={{ fontSize: '9pt', fontWeight: 'bold', marginBottom: '6px' }}>
        Timeline Cleanup Tool
      </div>
      <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
        Convert individual "Photo Added" events into intelligent work session summaries using AI analysis.
      </div>
      
      <button
        onClick={handleCleanup}
        disabled={processing}
        style={{
          padding: '6px 12px',
          background: processing ? 'var(--grey-300)' : 'var(--accent)',
          color: 'white',
          border: '1px solid var(--border)',
          borderRadius: '2px',
          cursor: processing ? 'not-allowed' : 'pointer',
          fontSize: '8pt',
          fontWeight: 'bold'
        }}
      >
        {processing ? 'Analyzing photos with AI...' : 'Clean Up Timeline'}
      </button>

      {result && (
        <div style={{
          marginTop: '8px',
          padding: '8px',
          background: result.startsWith('✅') ? '#dcfce7' : '#fee2e2',
          border: `1px solid ${result.startsWith('✅') ? '#86efac' : '#fca5a5'}`,
          borderRadius: '2px',
          fontSize: '8pt'
        }}>
          {result}
        </div>
      )}
    </div>
  );
};

