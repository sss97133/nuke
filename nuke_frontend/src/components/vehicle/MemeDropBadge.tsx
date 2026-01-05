import { useEffect, useState } from 'react';
import { StreamActionsService } from '../../services/streamActionsService';

interface MemeDropBadgeProps {
  vehicleId: string;
  compact?: boolean;
}

export default function MemeDropBadge({ vehicleId, compact = false }: MemeDropBadgeProps) {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    
    const loadCount = async () => {
      try {
        const dropCount = await StreamActionsService.getVehicleDropCount(vehicleId);
        if (mounted) setCount(dropCount);
      } catch {
        if (mounted) setCount(0);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadCount();

    // Listen for new meme drops
    const handleMemeDropped = () => {
      loadCount();
    };
    window.addEventListener('meme_dropped', handleMemeDropped);

    return () => {
      mounted = false;
      window.removeEventListener('meme_dropped', handleMemeDropped);
    };
  }, [vehicleId]);

  if (loading || count === null || count === 0) return null;

  if (compact) {
    return (
      <span
        title={`${count} meme drop${count !== 1 ? 's' : ''}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 8px',
          borderRadius: '12px',
          background: 'linear-gradient(135deg, rgba(102, 126, 234, 0.2) 0%, rgba(118, 75, 162, 0.2) 100%)',
          border: '1px solid rgba(102, 126, 234, 0.3)',
          fontSize: '10px',
          color: '#a5b4fc',
          fontWeight: 600,
        }}
      >
        <span>🔥</span>
        <span>{count}</span>
      </span>
    );
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 12px',
        borderRadius: '16px',
        background: 'linear-gradient(135deg, rgba(102, 126, 234, 0.15) 0%, rgba(118, 75, 162, 0.15) 100%)',
        border: '1px solid rgba(102, 126, 234, 0.25)',
        fontSize: '11px',
        color: '#a5b4fc',
      }}
    >
      <span style={{ fontSize: '14px' }}>🔥</span>
      <span>
        <strong>{count}</strong> meme drop{count !== 1 ? 's' : ''}
      </span>
    </div>
  );
}

