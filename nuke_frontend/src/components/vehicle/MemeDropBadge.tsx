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
          padding: '2px 8px', background: 'var(--accent-dim)',
          border: '1px solid rgba(102, 126, 234, 0.3)',
          fontSize: '10px',
          color: '#a5b4fc',
          fontWeight: 600,
        }}
      >
        <span style={{ fontSize: '9px', letterSpacing: '0.5px' }}>DROPS</span>
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
        padding: '4px 12px', background: 'var(--accent-dim)',
        border: '1px solid rgba(102, 126, 234, 0.25)',
        fontSize: '11px',
        color: '#a5b4fc',
      }}
    >
      <span>
        <strong>{count}</strong> meme drop{count !== 1 ? 's' : ''}
      </span>
    </div>
  );
}

