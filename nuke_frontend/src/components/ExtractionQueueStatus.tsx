/**
 * Extraction Queue Status
 * Shows pending/processing content extraction jobs for a vehicle
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface ExtractionQueueStatusProps {
  vehicleId: string;
}

interface QueueItem {
  id: string;
  content_type: string;
  raw_content: string;
  status: string;
  confidence_score: number;
  created_at: string;
  error_message?: string;
}

const ExtractionQueueStatus: React.FC<ExtractionQueueStatusProps> = ({ vehicleId }) => {
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadQueue();
    
    // Poll for updates every 5 seconds
    const interval = setInterval(loadQueue, 5000);
    return () => clearInterval(interval);
  }, [vehicleId]);

  const loadQueue = async () => {
    try {
      const { data, error } = await supabase
        .from('content_extraction_queue')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        console.error('Error loading queue:', error);
        return;
      }

      setQueueItems(data || []);
    } catch (err) {
      console.error('Error loading queue:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading || queueItems.length === 0) {
    return null;
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case 'pending': return 'Pending';
      case 'processing': return '⚙️';
      case 'completed': return '✓';
      case 'failed': return '✗';
      default: return '○';
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'pending': return '#f59e0b';
      case 'processing': return '#3b82f6';
      case 'completed': return '#10b981';
      case 'failed': return '#ef4444';
      default: return '#9ca3af';
    }
  };

  const contentTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      listing_url: 'Listing',
      youtube_video: 'Video',
      vin_data: 'VIN',
      specs_data: 'Specs',
      price_data: 'Price',
      timeline_event: 'Event',
      image_url: 'Image',
      document_url: 'Document',
      contact_info: 'Contact'
    };
    return labels[type] || type;
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '12px',
        background: 'var(--yellow-50)',
        border: '2px solid var(--yellow-200)',
        marginBottom: '12px'
      }}
    >
      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>
        Processing Content ({queueItems.length})
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {queueItems.map((item) => (
          <div
            key={item.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px',
              background: 'var(--white)',
              border: '2px solid var(--border)',
              fontSize: '11px'
            }}
          >
            <span
              style={{
                fontSize: '14px',
                color: statusColor(item.status)
              }}
              title={item.status}
            >
              {statusIcon(item.status)}
            </span>

            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: 'var(--gray-900)' }}>
                {contentTypeLabel(item.content_type)}
              </div>
              <div
                style={{
                  color: 'var(--gray-600)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '300px'
                }}
              >
                {item.raw_content}
              </div>
            </div>

            <div
              style={{
                fontSize: '10px',
                color: 'var(--gray-500)',
                textAlign: 'right'
              }}
            >
              <div>
                {Math.round(item.confidence_score * 100)}%
              </div>
              <div>
                {item.status === 'processing' ? 'Processing...' : 'Queued'}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: '10px', color: 'var(--gray-600)', marginTop: '4px' }}>
        Data will be automatically extracted and added to the profile
      </div>
    </div>
  );
};

export default ExtractionQueueStatus;

